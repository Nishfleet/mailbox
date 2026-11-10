// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import PostalMime from "postal-mime";
import { z } from "zod";
import { sendEmail } from "./email-sender";
import { attachmentKey, contentDisposition, safeFilename, storeAttachments, type StoredAttachment } from "./lib/attachments";
import {
	validateSender,
	SenderValidationError,
	generateMessageId,
	buildThreadingHeaders,
	listMailboxes,
	getMailboxStub,
	isTrustedInternalOwnedEmail,
	INTERNAL_EMAIL_HEADER,
	isOwnedDomainDelivery,
	OWNED_DOMAIN_DELIVERY_ERROR,
} from "./lib/email-helpers";
import { SendEmailRequestSchema } from "./lib/schemas";
import { isHighConfidenceSpam } from "./lib/spam.js";
import { handleReplyEmail, handleForwardEmail } from "./routes/reply-forward";
import { Folders } from "../shared/folders";
import { MailboxSettingsSchema, parseMailboxSettings } from "../shared/mailbox-settings";
import { mailboxDisplayName, mailboxSettingsKey, readMailboxSettings } from "./lib/mailbox-settings";
import type { Env } from "./types";
import { requireMailbox, type MailboxContext } from "./lib/mailbox";
import { buildAttentionSummary } from "./lib/attention";
import { mapWithConcurrency, withTimeout } from "./lib/async";
import { triggerAutoDraft } from "./lib/auto-draft-trigger";

type AppContext = Context<MailboxContext>;

// -- Request body schemas (kept for validation) ---------------------

const CreateMailboxBody = z.object({
	email: z.string().email(),
	name: z.string().min(1),
	settings: MailboxSettingsSchema.optional(),
});

const UpdateMailboxBody = z.object({ settings: MailboxSettingsSchema });

const UpdateEmailBody = z.object({ read: z.boolean().optional(), starred: z.boolean().optional() });

const MoveEmailBody = z.object({ folderId: z.string().min(1) });

const FolderBody = z.object({ name: z.string().min(1) });

const DraftBody = z.object({
	to: z.string().optional(),
	cc: z.string().optional(),
	bcc: z.string().optional(),
	subject: z.string().optional(),
	body: z.string(),
	in_reply_to: z.string().optional(),
	thread_id: z.string().optional(),
	draft_id: z.string().optional(),
});

const MAILBOX_COUNT_TIMEOUT_MS = 5000;
const MAILBOX_NAME_TIMEOUT_MS = 5000;
const MAILBOX_COUNT_CONCURRENCY = 6;
const MAILBOX_LIST_BUDGET_MS = 12000;
const MAILBOX_COUNT_START_BUFFER_MS = 500;

// -- Helpers --------------------------------------------------------

function slugify(text: string) { // can return "" for non-alphanumeric input
	return text.toString().toLowerCase()
		.replace(/\s+/g, "-").replace(/[^\w-]+/g, "")
		.replace(/--+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

function intQuery(c: AppContext, key: string): number | undefined {
	const v = c.req.query(key);
	if (!v) return undefined;
	const n = Number(v);
	return Number.isNaN(n) ? undefined : n;
}

function boolQuery(c: AppContext, key: string): boolean | undefined {
	const v = c.req.query(key);
	if (v === undefined || v === "") return undefined;
	return v === "true" || v === "1";
}

async function getMailboxName(env: Env, mailboxId: string, timeoutMs: number): Promise<string> {
	try {
		const settings = await withTimeout(
			readMailboxSettings(env, mailboxId),
			timeoutMs,
			() => console.warn(`Timed out loading display name for ${mailboxId}`),
		);
		return mailboxDisplayName(mailboxId, settings);
	} catch (error) {
		console.error(`Failed to load display name for ${mailboxId}`, error);
		return mailboxId;
	}
}

async function getInboxUnreadCount(
	env: Env,
	mailboxId: string,
	timeoutMs: number = MAILBOX_COUNT_TIMEOUT_MS,
): Promise<number | null> {
	try {
		const stub = getMailboxStub(env, mailboxId);
		return await withTimeout(
			stub.getInboxUnreadCount(),
			timeoutMs,
			() => console.warn(`Timed out loading unread inbox count for ${mailboxId}`),
		);
	} catch (error) {
		console.error(`Failed to load unread inbox count for ${mailboxId}`, error);
		return null;
	}
}

// -- App & middleware -----------------------------------------------

const app = new Hono<MailboxContext>();
app.use("/api/*", cors({
	origin: (origin) => {
		// Same-origin requests have no Origin header — allow them.
		if (!origin) return origin;
		// In development, allow localhost for Vite dev server.
		try {
			const url = new URL(origin);
			if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
		} catch { /* invalid origin */ }
		// Block all other cross-origin requests. The app is served from the
		// same origin as the API, so legitimate browser requests never send
		// an Origin header. Returning undefined omits Access-Control-Allow-Origin.
		return undefined;
	},
}));
app.use("/api/v1/mailboxes/:mailboxId/*", requireMailbox);

// -- Config ---------------------------------------------------------

app.get("/api/v1/config", (c) => {
	const domainsRaw = c.env.DOMAINS || "";
	const domains = domainsRaw.split(",").map((d) => d.trim()).filter(Boolean);
	const emailAddresses = c.env.EMAIL_ADDRESSES ?? [];
	return c.json({ domains, emailAddresses });
});

// -- Mailboxes ------------------------------------------------------

app.get("/api/v1/mailboxes", async (c) => {
	const deadlineMs = Date.now() + MAILBOX_LIST_BUDGET_MS;
	const directoryBudgetMs = deadlineMs - Date.now() - MAILBOX_COUNT_START_BUFFER_MS;
	const allMailboxes = directoryBudgetMs > 0
		? await withTimeout(
				listMailboxes(c.env.BUCKET),
				directoryBudgetMs,
				() => console.warn("Timed out loading mailbox directory"),
			)
		: null;
	if (!allMailboxes) {
		return c.json({ error: "Mailbox directory unavailable" }, 503);
	}
	const mailboxes = await mapWithConcurrency(
		allMailboxes,
		MAILBOX_COUNT_CONCURRENCY,
		async (m) => {
			const nameBudgetMs = deadlineMs - Date.now() - MAILBOX_COUNT_START_BUFFER_MS;
			const name =
				nameBudgetMs > 0
					? await getMailboxName(
							c.env,
							m.id,
							Math.min(MAILBOX_NAME_TIMEOUT_MS, nameBudgetMs),
						)
					: m.id;
			const remainingMs = deadlineMs - Date.now() - MAILBOX_COUNT_START_BUFFER_MS;
			return {
				...m,
				name,
				unreadInboxCount:
					remainingMs > 0
						? await getInboxUnreadCount(
								c.env,
								m.id,
								Math.min(MAILBOX_COUNT_TIMEOUT_MS, remainingMs),
							)
						: null,
			};
		},
	);
	return c.json(mailboxes);
});

app.get("/api/v1/attention", async (c) => {
	return c.json(await buildAttentionSummary(c.env));
});

app.post("/api/v1/mailboxes", zValidator("json", CreateMailboxBody), async (c) => {
	const { name, settings, email: rawEmail } = c.req.valid("json");
	const email = rawEmail.toLowerCase();
	const allowedAddresses = (c.env.EMAIL_ADDRESSES ?? []) as string[];
	if (allowedAddresses.length > 0 && !allowedAddresses.map((a) => a.toLowerCase()).includes(email)) {
		return c.json({ error: "Mailbox creation is restricted to configured EMAIL_ADDRESSES" }, 403);
	}
	const key = mailboxSettingsKey(email);
	if (await c.env.BUCKET.head(key)) return c.json({ error: "Mailbox already exists" }, 409);
	const defaultSettings = { fromName: name, forwarding: { enabled: false, email: "" }, signature: { enabled: false, text: "" }, autoReply: { enabled: false, subject: "", message: "" } };
	const finalSettings = { ...defaultSettings, ...settings };
	await c.env.BUCKET.put(key, JSON.stringify(finalSettings));
	const stub = getMailboxStub(c.env, email);
	await stub.getFolders();
	return c.json({ id: email, email, name, settings: finalSettings }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const obj = await c.env.BUCKET.get(mailboxSettingsKey(mailboxId));
	if (!obj) return c.json({ error: "Not found" }, 404);
	const settings = parseMailboxSettings(await obj.json());
	return c.json({
		id: mailboxId,
		name: mailboxDisplayName(mailboxId, settings),
		email: mailboxId,
		settings,
	});
});

app.put("/api/v1/mailboxes/:mailboxId", zValidator("json", UpdateMailboxBody), async (c) => {
	const mailboxId = c.req.param("mailboxId");
	const { settings } = c.req.valid("json");
	const key = mailboxSettingsKey(mailboxId);
	if (!(await c.env.BUCKET.head(key))) return c.json({ error: "Not found" }, 404);
	await c.env.BUCKET.put(key, JSON.stringify(settings));
	return c.json({ id: mailboxId, name: mailboxDisplayName(mailboxId, settings), email: mailboxId, settings });
});

app.delete("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const key = mailboxSettingsKey(mailboxId);
	if (!(await c.env.BUCKET.head(key))) return c.json({ error: "Not found" }, 404);
	await c.env.BUCKET.delete(key); // TODO: also delete DO data and R2 attachment blobs
	return c.body(null, 204);
});

// -- Emails ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const folder = c.req.query("folder");
	const thread_id = c.req.query("thread_id");
	const threaded = boolQuery(c, "threaded");
	const page = intQuery(c, "page");
	const limit = intQuery(c, "limit");
	const sortColumn = c.req.query("sortColumn");
	const sortDirection = c.req.query("sortDirection") as "ASC" | "DESC" | undefined;
	const stub = c.var.mailboxStub;

	if (threaded && folder) {
		const emails = await stub.getThreadedEmails({ folder, page, limit });
		const totalCount = await stub.countThreadedEmails(folder);
		return c.json({ emails, totalCount });
	}
	const emails = await stub.getEmails({ folder, thread_id, page, limit, sortColumn, sortDirection });
	if (folder) {
		const totalCount = await stub.countEmails({ folder, thread_id });
		return c.json({ emails, totalCount });
	}
	return c.json(emails);
});

app.post("/api/v1/mailboxes/:mailboxId/emails", zValidator("json", SendEmailRequestSchema), async (c) => {
	const mailboxId = c.req.param("mailboxId");
	const body = c.req.valid("json");
	const { to, cc, bcc, from, subject, html, text, attachments, in_reply_to, references, thread_id } = body;

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}
	if (isOwnedDomainDelivery(c.env, fromEmail, to, cc, bcc)) {
		return c.json({ error: OWNED_DOMAIN_DELIVERY_ERROR }, 400);
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	const stub = c.var.mailboxStub;
	const rateLimitError = await stub.checkSendRateLimit();
	if (rateLimitError) return c.json({ error: rateLimitError }, 429);
	const attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);

	await stub.createEmail(Folders.SENT, {
		id: messageId, subject, sender: fromEmail, recipient: toStr,
		cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
		bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
		date: new Date().toISOString(), body: html || text || "",
		in_reply_to: in_reply_to || null, email_references: references ? JSON.stringify(references) : null,
		thread_id: thread_id || in_reply_to || messageId, message_id: outgoingMessageId,
		raw_headers: JSON.stringify([
			{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
			{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
			...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
			...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
			{ key: "subject", value: subject }, { key: "date", value: new Date().toISOString() },
			{ key: "message-id", value: `<${outgoingMessageId}>` },
		]),
	}, attachmentData);

	c.executionCtx.waitUntil(
		sendEmail(c.env.EMAIL, {
			to, cc, bcc, from, subject, html, text,
			attachments: attachments?.map((att) => ({ content: att.content, filename: att.filename, type: att.type, disposition: att.disposition || "attachment", contentId: att.contentId })),
			...(in_reply_to ? { headers: buildThreadingHeaders(in_reply_to, references || []) } : {}),
		}).catch((e) => console.error("Deferred email delivery failed:", (e as Error).message)),
	);
	return c.json({ id: messageId, status: "sent" }, 202);
});

app.post("/api/v1/mailboxes/:mailboxId/drafts", zValidator("json", DraftBody), async (c) => {
	const mailboxId = c.req.param("mailboxId");
	const { to, cc, bcc, subject, body, in_reply_to, thread_id, draft_id } = c.req.valid("json");
	if (isOwnedDomainDelivery(c.env, mailboxId, to, cc, bcc)) {
		return c.json({ error: OWNED_DOMAIN_DELIVERY_ERROR }, 400);
	}
	const stub = c.var.mailboxStub;
	if (draft_id) await stub.deleteEmail(draft_id); // not atomic — create-then-delete would be safer
	const messageId = crypto.randomUUID();
	const now = new Date().toISOString();
	await stub.createEmail(Folders.DRAFT, {
		id: messageId, subject: subject || "", sender: mailboxId.toLowerCase(),
		recipient: (to || "").toLowerCase(), cc: cc?.toLowerCase() || null, bcc: bcc?.toLowerCase() || null,
		date: now, body, in_reply_to: in_reply_to || null, email_references: null,
		thread_id: thread_id || in_reply_to || messageId,
	}, []);
	return c.json({ id: messageId, status: "draft", subject: subject || "", recipient: to || "", date: now }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const email = await c.var.mailboxStub.getEmail(c.req.param("id")!);
	if (!email) return c.json({ error: "Email not found" }, 404);
	return new Response(JSON.stringify(email), {
		headers: { "Content-Type": "application/json" },
	});
});

app.put("/api/v1/mailboxes/:mailboxId/emails/:id", zValidator("json", UpdateEmailBody), async (c) => {
	const email = await c.var.mailboxStub.updateEmail(c.req.param("id"), c.req.valid("json"));
	return email ? c.json(email) : c.json({ error: "Email not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const id = c.req.param("id")!;
	const attachments = await c.var.mailboxStub.deleteEmail(id);
	if (attachments === null) return c.json({ error: "Not found" }, 404);
	if (attachments.length > 0) await c.env.BUCKET.delete(attachments.map((att) => attachmentKey({ ...att, email_id: id })));
	return c.body(null, 204);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move", zValidator("json", MoveEmailBody), async (c) => {
	const { folderId } = c.req.valid("json");
	const success = await c.var.mailboxStub.moveEmail(c.req.param("id"), folderId);
	return success ? c.json({ status: "moved" }) : c.json({ error: "Folder not found" }, 400);
});

// -- Threads --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId", async (c: AppContext) => {
	return c.json(await c.var.mailboxStub.getThreadEmails(c.req.param("threadId")!));
});

app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read", async (c: AppContext) => {
	await c.var.mailboxStub.markThreadRead(c.req.param("threadId")!);
	return c.json({ status: "marked_read" });
});

// -- Reply / Forward ------------------------------------------------

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/reply", ...handleReplyEmail);
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/forward", ...handleForwardEmail);

// -- Folders --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => c.json(await c.var.mailboxStub.getFolders()));

app.post("/api/v1/mailboxes/:mailboxId/folders", zValidator("json", FolderBody), async (c) => {
	const { name } = c.req.valid("json");
	const slug = slugify(name);
	if (!slug) return c.json({ error: "Folder name must contain alphanumeric characters" }, 400);
	const f = await c.var.mailboxStub.createFolder(slug, name);
	return f ? c.json(f, 201) : c.json({ error: "Folder with this name already exists" }, 409);
});

app.put("/api/v1/mailboxes/:mailboxId/folders/:id", zValidator("json", FolderBody), async (c) => {
	const { name } = c.req.valid("json");
	const f = await c.var.mailboxStub.updateFolder(c.req.param("id"), name);
	return f ? c.json(f) : c.json({ error: "Folder not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const ok = await c.var.mailboxStub.deleteFolder(c.req.param("id")!);
	return ok ? c.body(null, 204) : c.json({ error: "Folder not found or cannot be deleted" }, 400);
});

// -- Search ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/search", async (c: AppContext) => {
	const searchOpts = {
		query: c.req.query("query") || "", folder: c.req.query("folder"), from: c.req.query("from"),
		to: c.req.query("to"), subject: c.req.query("subject"), date_start: c.req.query("date_start"),
		date_end: c.req.query("date_end"), is_read: boolQuery(c, "is_read"),
		is_starred: boolQuery(c, "is_starred"), has_attachment: boolQuery(c, "has_attachment"),
	};
	const stub = c.var.mailboxStub;
	const emails = await stub.searchEmails({ ...searchOpts, page: intQuery(c, "page"), limit: intQuery(c, "limit") });
	const totalCount = await stub.countSearchResults(searchOpts);
	return c.json({ emails, totalCount });
});

// -- Attachments ----------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId", async (c: AppContext) => {
	const emailId = c.req.param("emailId")!;
	const attachmentId = c.req.param("attachmentId")!;
	const attachment = await c.var.mailboxStub.getAttachment(attachmentId);
	if (!attachment) return c.json({ error: "Attachment not found" }, 404);
	const obj = await c.env.BUCKET.get(attachmentKey({ ...attachment, email_id: emailId }));
	if (!obj) return c.json({ error: "Attachment file not found" }, 404);
	const headers = new Headers();
	headers.set("Content-Type", attachment.mimetype);
	headers.set("Content-Disposition", contentDisposition(attachment.filename));
	return new Response(obj.body, { headers });
});

// -- Receive inbound email ------------------------------------------

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;

async function streamToArrayBuffer(stream: ReadableStream, streamSize: number) {
	if (streamSize > MAX_EMAIL_SIZE) throw new Error(`Email too large: ${streamSize} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`);
	if (streamSize <= 0) throw new Error(`Invalid stream size: ${streamSize}`);
	const result = new Uint8Array(streamSize);
	let bytesRead = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (bytesRead + value.length > streamSize) { reader.cancel(); throw new Error(`Stream exceeds declared size`); }
		result.set(value, bytesRead);
		bytesRead += value.length;
	}
	return result;
}

/**
 * The subset of Cloudflare's ForwardableEmailMessage this Worker uses.
 * `event.raw` is fully consumed by streamToArrayBuffer() below (that is what
 * stores the mail), and Cloudflare's documented "store then forward" pattern
 * reads the raw stream first and calls message.forward() afterwards, so
 * forwarding after storing is the supported order.
 * See: https://developers.cloudflare.com/email-service/examples/email-routing/email-storage/
 */
type IncomingEmailEvent = {
	raw: ReadableStream;
	rawSize: number;
	from?: string;
	to?: string;
	headers?: Headers;
	forward?: (rcptTo: string, headers?: Headers) => Promise<unknown>;
};

type ForwardingRule = { target: string; spam: boolean; internal: boolean };

type InboundMailKind = { spam: boolean; internalOwned: boolean };

/**
 * Read the forwarding rule for a mailbox, or null when it should not forward.
 * Never throws: a malformed or unreadable settings object means "do not forward".
 */
async function getForwardingRule(env: Env, mailboxId: string): Promise<ForwardingRule | null> {
	const forwarding = (await readMailboxSettings(env, mailboxId))?.forwarding;
	const target = forwarding?.email?.trim() ?? "";
	if (!forwarding?.enabled || !target) return null;
	return { target, spam: forwarding.spam !== false, internal: forwarding.internal !== false };
}

/**
 * Apply the mailbox's `forwarding` setting to an inbound message.
 *
 * - Only forwards when the mailbox exists, forwarding is enabled and the
 *   address is non-empty.
 * - Failures are logged with console.error and swallowed: a broken forward must
 *   never undo, delay or fail storing the mail, and must never rethrow (the
 *   caller re-throws only on real processing errors).
 */
async function applyMailboxForwarding(
	env: Env,
	mailboxId: string,
	event: IncomingEmailEvent,
	kind: InboundMailKind,
) {
	const rule = await getForwardingRule(env, mailboxId);
	if (!rule) return;
	if (kind.spam && !rule.spam) return;
	if (kind.internalOwned && !rule.internal) return;
	if (typeof event.forward !== "function") return;
	const { target } = rule;
	try {
		await event.forward(target);
		console.log(`Forwarded email for ${mailboxId} to ${target}`);
	} catch (e) {
		console.error(`Failed to forward email for ${mailboxId} to ${target}:`, (e as Error).message, (e as Error).stack);
	}
}

async function receiveEmail(
	event: IncomingEmailEvent,
	env: Env,
	ctx: ExecutionContext,
) {
	const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
	const parsedEmail = await new PostalMime().parse(rawEmail);

	if (!parsedEmail.to?.length || !parsedEmail.to[0].address) throw new Error("received email with empty to");

	const allowedAddresses = ((env.EMAIL_ADDRESSES ?? []) as string[]).map((a) => a.toLowerCase());
	const allRecipients = parsedEmail.to.map((t) => t.address?.toLowerCase()).filter(Boolean) as string[];
	const ccRecipients = (parsedEmail.cc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];
	const bccRecipients = (parsedEmail.bcc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];
	const sender = (parsedEmail.from?.address || "").toLowerCase();
	const isInternalOwnedNotification = isTrustedInternalOwnedEmail(env, sender, [
		...allRecipients,
		...ccRecipients,
		...bccRecipients,
	], parsedEmail.headers);
	const isSpam = !isInternalOwnedNotification && isHighConfidenceSpam(event.headers);

	let mailboxId: string | undefined;
	if (allowedAddresses.length > 0) {
		mailboxId = allRecipients.find((addr) => allowedAddresses.includes(addr));
		if (!mailboxId) { console.log(`Ignoring email: no recipient matches EMAIL_ADDRESSES.`); return; }
	} else { mailboxId = allRecipients[0]; }
	if (!mailboxId) throw new Error("received email with no valid recipient address");

	const messageId = crypto.randomUUID();
	if (!(await env.BUCKET.head(mailboxSettingsKey(mailboxId)))) { console.log(`Ignoring email for ${mailboxId}: mailbox does not exist`); return; }

	const stub = getMailboxStub(env, mailboxId);

	const attachmentData: StoredAttachment[] = [];
	if (parsedEmail.attachments) {
		for (const att of parsedEmail.attachments) {
			const attId = crypto.randomUUID();
			const filename = safeFilename(att.filename);
			await env.BUCKET.put(attachmentKey({ email_id: messageId, id: attId, filename }), att.content);
			attachmentData.push({ id: attId, email_id: messageId, filename, mimetype: att.mimeType,
				size: typeof att.content === "string" ? att.content.length : att.content.byteLength,
				content_id: att.contentId || null, disposition: att.disposition || "attachment" });
		}
	}

	const extractMsgId = (s: string) => { const m = s.match(/<([^>]+)>/); return m ? m[1] : s.trim().split(/\s+/)[0]; };
	const inReplyTo = parsedEmail.inReplyTo ? extractMsgId(parsedEmail.inReplyTo) : null;
	const emailReferences = parsedEmail.references ? parsedEmail.references.split(/\s+/).filter(Boolean).map(extractMsgId) : [];
	let threadId = emailReferences[0] || inReplyTo || messageId;

	if (!inReplyTo && emailReferences.length === 0) {
		const subjectThread = await stub.findThreadBySubject(parsedEmail.subject || "", parsedEmail.from?.address || undefined);
		if (subjectThread) threadId = subjectThread;
	}

	const originalMessageId = parsedEmail.messageId ? extractMsgId(parsedEmail.messageId) : null;
	const storedHeaders = (parsedEmail.headers || []).filter(
		(header) => String(header.key || "").trim().toLowerCase() !== INTERNAL_EMAIL_HEADER,
	);

	await stub.createEmail(isSpam ? Folders.SPAM : Folders.INBOX, {
		id: messageId, subject: parsedEmail.subject || "",
		sender, recipient: allRecipients.join(", "),
		cc: ccRecipients.join(", ") || null, bcc: bccRecipients.join(", ") || null,
		date: new Date().toISOString(), // uses receive time, not the email's Date header
		read: isInternalOwnedNotification || isSpam,
		internal_owned: isInternalOwnedNotification,
		body: parsedEmail.html || parsedEmail.text || "",
		in_reply_to: inReplyTo, email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
		thread_id: threadId, message_id: originalMessageId, raw_headers: JSON.stringify(storedHeaders),
	}, attachmentData);

	// Brand mail must also reach Nish's Gmail while this inbox keeps storing it
	// (issue #14). Deliberately placed immediately after the store and before the
	// spam/internal early returns: those messages are stored too, and a
	// false-positive spam classification is exactly the brand mail that must not
	// disappear. A failed forward is logged and swallowed inside
	// applyMailboxForwarding, so it can never lose the stored copy and never
	// rethrows into the caller's retry-on-error semantics.
	await applyMailboxForwarding(env, mailboxId, event, {
		spam: isSpam,
		internalOwned: isInternalOwnedNotification,
	});

	if (isInternalOwnedNotification) {
		console.log(`Stored internal owned-domain email for ${mailboxId} without auto-drafting.`);
		return;
	}
	if (isSpam) {
		console.log(`Stored high-confidence spam email for ${mailboxId} without auto-drafting.`);
		return;
	}

	ctx.waitUntil(triggerAutoDraft(env, {
		mailboxId, emailId: messageId, sender, subject: parsedEmail.subject || "", threadId,
	}));
}

export { app, receiveEmail };
export { getForwardingRule, applyMailboxForwarding, type IncomingEmailEvent };
