// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared email helpers to eliminate duplication across API routes, MCP, and agent.
 *
 * Includes: DO stub helpers, sender validation, message-ID generation,
 * threading, HTML utilities, and tool-logic (getFullEmail / getFullThread).
 */
import type { MailboxDO } from "../durableObject";
import type { EmailDetail } from "../../shared/email";
import { Folders } from "../../shared/folders";
import type { Env } from "../types";
import { formatQuotedDate } from "../../shared/dates";

const MAILBOX_LIST_PAGE_LIMIT = 100;
export const INTERNAL_EMAIL_HEADER = "x-nish-internal-email";

function normalizeDomain(domain: string) {
	return domain.toLowerCase().trim().replace(/^@+/, "");
}

function domainFromAddress(address: string) {
	const match = address.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})\b/i);
	return match ? normalizeDomain(match[1]) : null;
}

export function getOwnedEmailDomains(env: Env) {
	const domains = new Set<string>();
	const domainsRaw = env.DOMAINS || "";
	for (const domain of domainsRaw.split(",")) {
		const normalized = normalizeDomain(domain);
		if (normalized) domains.add(normalized);
	}
	const addresses = Array.isArray(env.EMAIL_ADDRESSES) ? env.EMAIL_ADDRESSES : [];
	for (const address of addresses) {
		const domain = domainFromAddress(address);
		if (domain) domains.add(domain);
	}
	return [...domains].sort((a, b) => a.localeCompare(b));
}

export function isOwnedEmailAddress(env: Env, address: string) {
	const domain = domainFromAddress(address);
	if (!domain) return false;
	return getOwnedEmailDomains(env).includes(domain);
}

export function isOwnedInternalEmail(
	env: Env,
	sender: string,
	recipients: string[],
) {
	return (
		isOwnedEmailAddress(env, sender) &&
		recipients.some((recipient) => isOwnedEmailAddress(env, recipient))
	);
}

type RecipientInput = string | string[] | undefined | null;

function normalizeRecipientInput(input: RecipientInput) {
	if (!input) return [];
	return (Array.isArray(input) ? input : [input])
		.flatMap((value) => value.split(","))
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean);
}

export function isOwnedDomainDelivery(
	env: Env,
	sender: string,
	...recipientFields: RecipientInput[]
) {
	const recipients = recipientFields.flatMap(normalizeRecipientInput);
	return isOwnedInternalEmail(env, sender, recipients);
}

export const OWNED_DOMAIN_DELIVERY_ERROR =
	"Owned-domain recipients are internal; do not send them through email.";

function timingSafeStringEqual(left: string, right: string) {
	if (left.length !== right.length) return false;
	let diff = 0;
	for (let index = 0; index < left.length; index += 1) {
		diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
	}
	return diff === 0;
}

export function hasTrustedInternalEmailHeader(
	env: Env,
	headers: Array<{ key?: string | null; value?: string | null }> | undefined,
) {
	const token = String(env.INTERNAL_EMAIL_TOKEN || "").trim();
	if (!token || !headers?.length) return false;
	return headers.some((header) => {
		const key = String(header.key || "").trim().toLowerCase();
		const value = String(header.value || "").trim();
		return key === INTERNAL_EMAIL_HEADER && timingSafeStringEqual(value, token);
	});
}

export function isTrustedInternalOwnedEmail(
	env: Env,
	sender: string,
	recipients: string[],
	headers: Array<{ key?: string | null; value?: string | null }> | undefined,
) {
	// The signed header is the trust boundary. SMTP envelope fields can be
	// provider-shaped on routed internal sends, so do not require them here.
	return (
		isOwnedInternalEmail(env, sender, recipients) &&
		hasTrustedInternalEmailHeader(env, headers)
	);
}

// ── DO Stub ────────────────────────────────────────────────────────

/**
 * Resolve a MailboxDO stub from a mailbox email address.
 */
export function getMailboxStub(
	env: Env,
	mailboxId: string,
): DurableObjectStub<MailboxDO> {
	const ns = env.MAILBOX;
	const id = ns.idFromName(mailboxId);
	return ns.get(id);
}

// ── Mailbox Listing ────────────────────────────────────────────────

/**
 * List all mailboxes from R2 bucket metadata.
 */
export async function listMailboxes(
	bucket: R2Bucket,
): Promise<{ id: string; email: string }[]> {
	const objects: R2Object[] = [];
	let cursor: string | undefined;
	let pageCount = 0;
	const seenCursors = new Set<string>();

	do {
		if (cursor) {
			if (seenCursors.has(cursor)) {
				throw new Error("R2 mailbox listing returned a repeated cursor");
			}
			seenCursors.add(cursor);
		}
		if (pageCount >= MAILBOX_LIST_PAGE_LIMIT) {
			throw new Error("R2 mailbox listing exceeded the page limit");
		}
		const list = await bucket.list({ prefix: "mailboxes/", cursor });
		pageCount += 1;
		objects.push(...list.objects);
		if (list.truncated && !list.cursor) {
			throw new Error("R2 mailbox listing was truncated without a cursor");
		}
		cursor = list.truncated ? list.cursor : undefined;
	} while (cursor);

	return objects.map((obj) => {
		const id = obj.key.replace("mailboxes/", "").replace(".json", "");
		return { id, email: id };
	});
}

// ── Sender Validation ──────────────────────────────────────────────

/**
 * Normalise to/from addresses and validate the sender matches the mailbox.
 * Returns the normalised values or throws with a user-facing message.
 */
export function validateSender(
	to: string | string[],
	from: string | { email: string; name: string },
	mailboxId: string,
): { toStr: string; fromEmail: string; fromDomain: string } {
	const toStr = (Array.isArray(to) ? to.join(", ") : to).toLowerCase();
	const fromEmail = (typeof from === "string" ? from : from.email).toLowerCase();

	if (fromEmail !== mailboxId.toLowerCase()) {
		throw new SenderValidationError("From address must match the mailbox email address");
	}

	const fromDomain = fromEmail.split("@")[1];
	if (!fromDomain) {
		throw new SenderValidationError("Invalid sender email address");
	}

	return { toStr, fromEmail, fromDomain };
}

export class SenderValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SenderValidationError";
	}
}

// ── Message ID ─────────────────────────────────────────────────────

/**
 * Generate an internal UUID and a proper RFC 2822 Message-ID.
 */
export function generateMessageId(fromDomain: string): {
	messageId: string;
	outgoingMessageId: string;
} {
	const messageId = crypto.randomUUID();
	const outgoingMessageId = `${messageId}@${fromDomain}`;
	return { messageId, outgoingMessageId };
}

// ── Threading ──────────────────────────────────────────────────────

/**
 * Build the References chain and In-Reply-To from an original email.
 */
export function buildReferencesChain(original: EmailDetail): {
	originalMsgId: string;
	references: string[];
	threadId: string;
} {
	const originalMsgId = original.message_id || original.id;
	let existingRefs: string[] = [];
	if (original.email_references) {
		try {
			existingRefs = JSON.parse(original.email_references);
		} catch {
			// Malformed JSON in email_references — treat as empty
		}
	}
	const references = [...existingRefs, originalMsgId].filter(Boolean);
	const threadId = original.thread_id || original.id;
	return { originalMsgId, references, threadId };
}

/**
 * Build threading headers (In-Reply-To + References) for the email binding.
 */
export function buildThreadingHeaders(
	originalMsgId: string,
	references: string[],
): Record<string, string> {
	return {
		"In-Reply-To": `<${originalMsgId}>`,
		...(references.length > 0
			? { References: references.map((r) => `<${r}>`).join(" ") }
			: {}),
	};
}

// ── Draft-follows-in_reply_to ──────────────────────────────────────

/**
 * If the given email is a draft with an in_reply_to, resolve the real original.
 * Used by reply/forward routes to avoid threading against the draft itself.
 */
export async function resolveOriginalEmail(
	stub: DurableObjectStub<MailboxDO>,
	email: EmailDetail,
): Promise<EmailDetail> {
	if (email.folder_id === Folders.DRAFT && email.in_reply_to) {
		const realOriginal = (await stub.getEmail(email.in_reply_to));
		if (realOriginal) return realOriginal;
	}
	return email;
}

// ── HTML Utilities ─────────────────────────────────────────────────

/**
 * Escape all five OWASP-recommended HTML special characters in plain text.
 * Safe for use in both text content and attribute contexts.
 */
export function escapeHtml(text: string): string {
	if (!text) return "";
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Convert plain text to a simple HTML block with preserved whitespace.
 * Uses both `white-space:pre-wrap` (modern clients) and `<br>` tags
 * (clients that strip inline styles, e.g. Outlook) as a belt-and-suspenders approach.
 */
export function textToHtml(text: string): string {
	if (!text) return "";
	const escaped = escapeHtml(text).replace(/\n/g, "<br>");
	return `<div style="white-space:pre-wrap">${escaped}</div>`;
}

/**
 * Strip HTML tags and normalize whitespace to produce plain text.
 * Removes <style> and <script> blocks first to avoid injecting their
 * content into the output.
 */
export function stripHtmlToText(html: string): string {
	if (!html) return "";
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Format a date string for use in quoted reply blocks.
 * @deprecated Use `formatQuotedDate` from `shared/dates` directly.
 */
export const formatEmailDate = formatQuotedDate;

/**
 * Build a quoted reply block HTML string from original email data.
 */
export function buildQuotedReplyBlock(original: {
	date?: string;
	sender?: string;
	body?: string;
}): string {
	if (!original.body) return "";
	
	// HTML-escape sender and date to prevent injection
	const originalSender = escapeHtml(original.sender || "unknown");
	const originalDate = escapeHtml(formatEmailDate(original.date || ""));

	// Sanitize the body to plain text to prevent stored XSS.
	// The original HTML renders safely in the sandboxed iframe, but quoted
	// reply blocks are injected into the compose editor and outgoing emails
	// where raw HTML would execute. Convert to escaped plain text instead.
	const plainBody = stripHtmlToText(original.body);
	const bodyToQuote = escapeHtml(plainBody).replace(/\n/g, "<br>");

	return `<br><blockquote style="border-left: 2px solid #ccc; margin: 0; padding-left: 1em; color: #666;">On ${originalDate}, ${originalSender} wrote:<br><br>${bodyToQuote}</blockquote>`;
}

// ── Tool Logic (getFullEmail / getFullThread) ──────────────────────

type MailboxThreadReaderStub = {
	getThreadEmails: (threadId: string) => Promise<EmailDetail[]>;
};

/**
 * Fetch a single email and return it with both HTML and plain-text body.
 * Returns null if the email is not found.
 */
export async function getFullEmail(
	stub: DurableObjectStub<MailboxDO>,
	emailId: string,
) {
	const email = (await stub.getEmail(emailId));
	if (!email) return null;

	const textBody = email.body ? stripHtmlToText(email.body) : "";
	return { ...email, body_text: textBody, body_html: email.body };
}

/**
 * Fetch all emails in a thread with full bodies in a single DO call.
 * Uses `getThreadEmails` which runs 2 SQL queries (emails + attachments)
 * instead of the previous N+1 pattern (1 list query + N getEmail calls).
 */
export async function getFullThread(
	stub: DurableObjectStub<MailboxDO>,
	threadId: string,
) {
	const threadStub = stub as unknown as MailboxThreadReaderStub;
	const emails = await threadStub.getThreadEmails(threadId);

	const enriched = emails.map((email) => {
		const textBody = email.body ? stripHtmlToText(email.body) : "";
		return { ...email, body_text: textBody };
	});

	// Already sorted ASC by the DO query, but ensure consistency
	enriched.sort(
		(a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
	);

	return { thread_id: threadId, message_count: enriched.length, messages: enriched };
}
