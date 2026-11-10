// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { app } from "./index";
import type { Env } from "./types";

const MAILBOX_ID = "hello@0509.io";
const MAILBOX_KEY = `mailboxes/${MAILBOX_ID}.json`;
const BASE = `/api/v1/mailboxes/${MAILBOX_ID}`;

const ORIGINAL_EMAIL = {
	id: "email-1",
	folder_id: "inbox",
	subject: "Question",
	sender: "customer@example.com",
	recipient: MAILBOX_ID,
	message_id: "original@example.com",
	email_references: null,
	thread_id: "thread-1",
	in_reply_to: null,
};

const ZERO_ATTENTION = {
	unreadInboxCount: 0,
	needsReplyCount: 0,
	draftCount: 0,
	moneyCount: 0,
	leadCount: 0,
	agingCount: 0,
	topItems: [],
};

function makeHarness({ mailboxes = [MAILBOX_ID] }: { mailboxes?: string[] } = {}) {
	const objects = new Map<string, string>(
		mailboxes.map((id) => [`mailboxes/${id}.json`, JSON.stringify({ fromName: id })]),
	);
	objects.set("attachments/email-1/att-1/report.pdf", "pdf-bytes");

	const bucket = {
		head: vi.fn((key: string) => Promise.resolve(objects.has(key) ? { key } : null)),
		get: vi.fn((key: string): Promise<{ body: string; json: () => Promise<unknown> } | null> => {
			const value = objects.get(key);
			if (value === undefined) return Promise.resolve(null);
			return Promise.resolve({ body: value, json: () => Promise.resolve(JSON.parse(value) as unknown) });
		}),
		put: vi.fn((key: string, value: string) => {
			objects.set(key, value);
			return Promise.resolve();
		}),
		delete: vi.fn((keys: string | string[]) => {
			for (const key of [keys].flat()) objects.delete(key);
			return Promise.resolve();
		}),
		list: vi.fn(() =>
			Promise.resolve({
				objects: [...objects.keys()]
					.filter((key) => key.startsWith("mailboxes/"))
					.map((key) => ({ key })),
				truncated: false,
			}),
		),
	};

	const stub = {
		getFolders: vi.fn(() => Promise.resolve([{ id: "inbox", name: "Inbox" }])),
		getInboxUnreadCount: vi.fn(() => Promise.resolve(2)),
		getAttentionSummary: vi.fn(() => Promise.resolve(ZERO_ATTENTION)),
		getEmails: vi.fn(() => Promise.resolve([{ id: "email-1" }])),
		countEmails: vi.fn(() => Promise.resolve(1)),
		getThreadedEmails: vi.fn(() => Promise.resolve([{ id: "email-1" }])),
		countThreadedEmails: vi.fn(() => Promise.resolve(1)),
		getEmail: vi.fn((id: string) =>
			Promise.resolve(id === ORIGINAL_EMAIL.id ? ORIGINAL_EMAIL : null),
		),
		updateEmail: vi.fn((id: string, patch: object) =>
			Promise.resolve(id === ORIGINAL_EMAIL.id ? { ...ORIGINAL_EMAIL, ...patch } : null),
		),
		deleteEmail: vi.fn((id: string) =>
			Promise.resolve(id === ORIGINAL_EMAIL.id ? [{ id: "att-1", filename: "report.pdf" }] : null),
		),
		moveEmail: vi.fn((id: string, folderId: string) =>
			Promise.resolve(id === ORIGINAL_EMAIL.id && folderId === "archive"),
		),
		getThreadEmails: vi.fn(() => Promise.resolve([ORIGINAL_EMAIL])),
		markThreadRead: vi.fn(() => Promise.resolve()),
		checkSendRateLimit: vi.fn((): Promise<string | null> => Promise.resolve(null)),
		createEmail: vi.fn(() => Promise.resolve()),
		createFolder: vi.fn((id: string, name: string) =>
			Promise.resolve(id === "inbox" ? null : { id, name }),
		),
		updateFolder: vi.fn((id: string, name: string) =>
			Promise.resolve(id === "custom" ? { id, name } : null),
		),
		deleteFolder: vi.fn((id: string) => Promise.resolve(id === "custom")),
		searchEmails: vi.fn(() => Promise.resolve([{ id: "email-1" }])),
		countSearchResults: vi.fn(() => Promise.resolve(1)),
		getAttachment: vi.fn((id: string) =>
			Promise.resolve(
				id === "att-1" ? { id, filename: "report.pdf", mimetype: "application/pdf" } : null,
			),
		),
	};

	const emailBinding = { send: vi.fn(() => Promise.resolve({ messageId: "sent-1" })) };

	const env = {
		BUCKET: bucket,
		MAILBOX: { idFromName: (name: string) => name, get: () => stub },
		EMAIL: emailBinding,
		DOMAINS: "0509.io",
		EMAIL_ADDRESSES: [],
	} as unknown as Env;

	const waits: Promise<unknown>[] = [];
	const ctx = {
		waitUntil: (promise: Promise<unknown>) => {
			waits.push(promise);
		},
		passThroughOnException: () => {},
		props: {},
	} as unknown as ExecutionContext;

	const request = (path: string, init?: RequestInit) => app.request(path, init, env, ctx);
	const json = (path: string, method: string, body: unknown) =>
		request(path, {
			method,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

	return { bucket, stub, emailBinding, waits, request, json };
}

const OUTGOING = {
	to: "customer@example.com",
	from: MAILBOX_ID,
	subject: "Re: Question",
	text: "Thanks for writing.",
};

describe("config route", () => {
	it("returns the configured domains", async () => {
		const { request } = makeHarness();
		const res = await request("/api/v1/config");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ domains: ["0509.io"], emailAddresses: [] });
	});

	it("gives a cross-origin caller no CORS allow header", async () => {
		const { request } = makeHarness();
		const res = await request("/api/v1/config", { headers: { Origin: "https://evil.example" } });
		expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});
});

describe("mailbox routes", () => {
	it("lists mailboxes with unread counts", async () => {
		const { request } = makeHarness();
		const res = await request("/api/v1/mailboxes");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([
			{ id: MAILBOX_ID, email: MAILBOX_ID, name: MAILBOX_ID, unreadInboxCount: 2 },
		]);
	});

	it("fails the list when the mailbox directory cannot be read", async () => {
		vi.useFakeTimers();
		try {
			const { request, bucket } = makeHarness();
			bucket.list.mockReturnValueOnce(new Promise(() => {}));
			vi.spyOn(console, "warn").mockImplementationOnce(() => {});
			const pending = request("/api/v1/mailboxes");
			await vi.runOnlyPendingTimersAsync();
			const res = await pending;
			expect(res.status).toBe(503);
		} finally {
			vi.useRealTimers();
		}
	});

	it("builds the attention summary", async () => {
		const { request } = makeHarness();
		const res = await request("/api/v1/attention");
		expect(res.status).toBe(200);
		const body = await res.json<{ mailboxCount: number; mailboxDirectoryStatus: string }>();
		expect(body.mailboxCount).toBe(1);
		expect(body.mailboxDirectoryStatus).toBe("ok");
	});

	it("marks the attention summary unavailable when the directory fails", async () => {
		const { request, bucket } = makeHarness();
		bucket.list.mockRejectedValueOnce(new Error("R2 down"));
		vi.spyOn(console, "error").mockImplementationOnce(() => {});
		const res = await request("/api/v1/attention");
		const body = await res.json<{ mailboxDirectoryStatus: string }>();
		expect(body.mailboxDirectoryStatus).toBe("unavailable");
	});

	it("creates a mailbox", async () => {
		const { json, bucket } = makeHarness({ mailboxes: [] });
		const res = await json("/api/v1/mailboxes", "POST", { email: "Sales@0509.io", name: "Sales" });
		expect(res.status).toBe(201);
		expect(bucket.put).toHaveBeenCalledWith("mailboxes/sales@0509.io.json", expect.any(String));
	});

	it("returns the name given at create from the list and read routes", async () => {
		const { json, request } = makeHarness({ mailboxes: [] });
		const created = await json("/api/v1/mailboxes", "POST", { email: "verify@0509.io", name: "Verify" });
		expect(created.status).toBe(201);

		const list = await request("/api/v1/mailboxes");
		expect(await list.json()).toEqual([
			{ id: "verify@0509.io", email: "verify@0509.io", name: "Verify", unreadInboxCount: 2 },
		]);

		const read = await request("/api/v1/mailboxes/verify@0509.io");
		expect(await read.json()).toMatchObject({
			id: "verify@0509.io",
			email: "verify@0509.io",
			name: "Verify",
			settings: { fromName: "Verify" },
		});
	});

	it("falls back to the address when the mailbox has no stored name", async () => {
		const { json, request } = makeHarness();
		await json(BASE, "PUT", { settings: {} });

		const read = await request(BASE);
		expect(await read.json()).toMatchObject({ name: MAILBOX_ID });

		const list = await request("/api/v1/mailboxes");
		expect(await list.json()).toEqual([
			{ id: MAILBOX_ID, email: MAILBOX_ID, name: MAILBOX_ID, unreadInboxCount: 2 },
		]);
	});

	it("keeps the list within its time budget when a mailbox name read hangs", async () => {
		vi.useFakeTimers();
		try {
			const { request, bucket } = makeHarness();
			bucket.get.mockReturnValueOnce(new Promise(() => {}));
			vi.spyOn(console, "warn").mockImplementationOnce(() => {});
			const pending = request("/api/v1/mailboxes");
			await vi.runOnlyPendingTimersAsync();
			const res = await pending;
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual([
				{ id: MAILBOX_ID, email: MAILBOX_ID, name: MAILBOX_ID, unreadInboxCount: 2 },
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("refuses to create a mailbox that exists", async () => {
		const { json } = makeHarness();
		const res = await json("/api/v1/mailboxes", "POST", { email: MAILBOX_ID, name: "Hello" });
		expect(res.status).toBe(409);
	});

	it("reads a mailbox", async () => {
		const { request } = makeHarness();
		const res = await request(BASE);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ id: MAILBOX_ID, settings: { fromName: MAILBOX_ID } });
	});

	it("returns 404 for an unknown mailbox", async () => {
		const { request } = makeHarness();
		const res = await request("/api/v1/mailboxes/nobody@0509.io");
		expect(res.status).toBe(404);
	});

	it("updates mailbox settings", async () => {
		const { json } = makeHarness();
		const res = await json(BASE, "PUT", { settings: { fromName: "Hello team" } });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ settings: { fromName: "Hello team" } });
	});

	it("refuses to update an unknown mailbox", async () => {
		const { json } = makeHarness();
		const res = await json("/api/v1/mailboxes/nobody@0509.io", "PUT", { settings: {} });
		expect(res.status).toBe(404);
	});

	it("deletes a mailbox", async () => {
		const { request, bucket } = makeHarness();
		const res = await request(BASE, { method: "DELETE" });
		expect(res.status).toBe(204);
		expect(bucket.delete).toHaveBeenCalledWith(MAILBOX_KEY);
	});

	it("refuses to delete an unknown mailbox", async () => {
		const { request } = makeHarness();
		const res = await request("/api/v1/mailboxes/nobody@0509.io", { method: "DELETE" });
		expect(res.status).toBe(404);
	});
});

describe("email routes", () => {
	it("lists emails in a folder with a total", async () => {
		const { request } = makeHarness();
		const res = await request(`${BASE}/emails?folder=inbox`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ emails: [{ id: "email-1" }], totalCount: 1 });
	});

	it("returns 404 when listing emails of an unknown mailbox", async () => {
		const { request } = makeHarness();
		const res = await request("/api/v1/mailboxes/nobody@0509.io/emails");
		expect(res.status).toBe(404);
	});

	it("stores and sends a new email", async () => {
		const { json, stub, emailBinding, waits } = makeHarness();
		const res = await json(`${BASE}/emails`, "POST", OUTGOING);
		await Promise.all(waits);
		expect(res.status).toBe(202);
		expect(stub.createEmail).toHaveBeenCalledOnce();
		expect(emailBinding.send).toHaveBeenCalledOnce();
	});

	it("refuses to send from another address", async () => {
		const { json, emailBinding } = makeHarness();
		const res = await json(`${BASE}/emails`, "POST", { ...OUTGOING, from: "other@0509.io" });
		expect(res.status).toBe(400);
		expect(emailBinding.send).not.toHaveBeenCalled();
	});

	it("refuses to send when the rate limit is hit", async () => {
		const { json, stub } = makeHarness();
		stub.checkSendRateLimit.mockResolvedValueOnce("Too many emails");
		const res = await json(`${BASE}/emails`, "POST", OUTGOING);
		expect(res.status).toBe(429);
	});

	it("saves a draft", async () => {
		const { json, stub } = makeHarness();
		const res = await json(`${BASE}/drafts`, "POST", { to: "customer@example.com", body: "Draft" });
		expect(res.status).toBe(201);
		expect(stub.createEmail).toHaveBeenCalledWith("draft", expect.anything(), []);
	});

	it("refuses a draft to an owned-domain address", async () => {
		const { json, stub } = makeHarness();
		const res = await json(`${BASE}/drafts`, "POST", { to: "sales@0509.io", body: "Draft" });
		expect(res.status).toBe(400);
		expect(stub.createEmail).not.toHaveBeenCalled();
	});

	it("reads an email", async () => {
		const { request } = makeHarness();
		const res = await request(`${BASE}/emails/email-1`);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ id: "email-1" });
	});

	it("returns 404 for an unknown email", async () => {
		const { request } = makeHarness();
		const res = await request(`${BASE}/emails/missing`);
		expect(res.status).toBe(404);
	});

	it("marks an email read", async () => {
		const { json } = makeHarness();
		const res = await json(`${BASE}/emails/email-1`, "PUT", { read: true });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ read: true });
	});

	it("returns 404 when updating an unknown email", async () => {
		const { json } = makeHarness();
		const res = await json(`${BASE}/emails/missing`, "PUT", { read: true });
		expect(res.status).toBe(404);
	});

	it("deletes an email and its attachment files", async () => {
		const { request, bucket } = makeHarness();
		const res = await request(`${BASE}/emails/email-1`, { method: "DELETE" });
		expect(res.status).toBe(204);
		expect(bucket.delete).toHaveBeenCalledWith(["attachments/email-1/att-1/report.pdf"]);
	});

	it("returns 404 when deleting an unknown email", async () => {
		const { request } = makeHarness();
		const res = await request(`${BASE}/emails/missing`, { method: "DELETE" });
		expect(res.status).toBe(404);
	});

	it("moves an email", async () => {
		const { json } = makeHarness();
		const res = await json(`${BASE}/emails/email-1/move`, "POST", { folderId: "archive" });
		expect(res.status).toBe(200);
	});

	it("refuses a move to an unknown folder", async () => {
		const { json } = makeHarness();
		const res = await json(`${BASE}/emails/email-1/move`, "POST", { folderId: "nowhere" });
		expect(res.status).toBe(400);
	});
});

describe("thread routes", () => {
	it("reads a thread", async () => {
		const { request } = makeHarness();
		const res = await request(`${BASE}/threads/thread-1`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([ORIGINAL_EMAIL]);
	});

	it("returns 404 for a thread in an unknown mailbox", async () => {
		const { request } = makeHarness();
		const res = await request("/api/v1/mailboxes/nobody@0509.io/threads/thread-1");
		expect(res.status).toBe(404);
	});

	it("marks a thread read", async () => {
		const { request, stub } = makeHarness();
		const res = await request(`${BASE}/threads/thread-1/read`, { method: "POST" });
		expect(res.status).toBe(200);
		expect(stub.markThreadRead).toHaveBeenCalledWith("thread-1");
	});

	it("returns 404 when marking a thread in an unknown mailbox", async () => {
		const { request } = makeHarness();
		const res = await request("/api/v1/mailboxes/nobody@0509.io/threads/thread-1/read", { method: "POST" });
		expect(res.status).toBe(404);
	});
});

describe("reply and forward routes", () => {
	it("replies in the original thread", async () => {
		const { json, stub, emailBinding, waits } = makeHarness();
		const res = await json(`${BASE}/emails/email-1/reply`, "POST", OUTGOING);
		await Promise.all(waits);
		expect(res.status).toBe(202);
		expect(stub.markThreadRead).toHaveBeenCalledWith("thread-1");
		expect(emailBinding.send).toHaveBeenCalledOnce();
	});

	it("returns 404 when replying to an unknown email", async () => {
		const { json } = makeHarness();
		const res = await json(`${BASE}/emails/missing/reply`, "POST", OUTGOING);
		expect(res.status).toBe(404);
	});

	it("forwards an email", async () => {
		const { json, emailBinding, waits } = makeHarness();
		const res = await json(`${BASE}/emails/email-1/forward`, "POST", { ...OUTGOING, subject: "Fwd: Question" });
		await Promise.all(waits);
		expect(res.status).toBe(202);
		expect(emailBinding.send).toHaveBeenCalledOnce();
	});

	it("returns 404 when forwarding an unknown email", async () => {
		const { json } = makeHarness();
		const res = await json(`${BASE}/emails/missing/forward`, "POST", OUTGOING);
		expect(res.status).toBe(404);
	});
});

describe("folder routes", () => {
	it("lists folders", async () => {
		const { request } = makeHarness();
		const res = await request(`${BASE}/folders`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([{ id: "inbox", name: "Inbox" }]);
	});

	it("returns 404 for folders of an unknown mailbox", async () => {
		const { request } = makeHarness();
		const res = await request("/api/v1/mailboxes/nobody@0509.io/folders");
		expect(res.status).toBe(404);
	});

	it("creates a folder from its name", async () => {
		const { json } = makeHarness();
		const res = await json(`${BASE}/folders`, "POST", { name: "Big Clients" });
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ id: "big-clients", name: "Big Clients" });
	});

	it("refuses a folder name with no letters or digits", async () => {
		const { json } = makeHarness();
		const res = await json(`${BASE}/folders`, "POST", { name: "!!!" });
		expect(res.status).toBe(400);
	});

	it("renames a folder", async () => {
		const { json } = makeHarness();
		const res = await json(`${BASE}/folders/custom`, "PUT", { name: "Renamed" });
		expect(res.status).toBe(200);
	});

	it("returns 404 when renaming an unknown folder", async () => {
		const { json } = makeHarness();
		const res = await json(`${BASE}/folders/missing`, "PUT", { name: "Renamed" });
		expect(res.status).toBe(404);
	});

	it("deletes a folder", async () => {
		const { request } = makeHarness();
		const res = await request(`${BASE}/folders/custom`, { method: "DELETE" });
		expect(res.status).toBe(204);
	});

	it("refuses to delete a system folder", async () => {
		const { request } = makeHarness();
		const res = await request(`${BASE}/folders/inbox`, { method: "DELETE" });
		expect(res.status).toBe(400);
	});
});

describe("search and attachment routes", () => {
	it("searches emails", async () => {
		const { request, stub } = makeHarness();
		const res = await request(`${BASE}/search?query=invoice&is_read=false`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ emails: [{ id: "email-1" }], totalCount: 1 });
		expect(stub.searchEmails).toHaveBeenCalledWith(expect.objectContaining({ query: "invoice", is_read: false }));
	});

	it("returns 404 when searching an unknown mailbox", async () => {
		const { request } = makeHarness();
		const res = await request("/api/v1/mailboxes/nobody@0509.io/search?query=x");
		expect(res.status).toBe(404);
	});

	it("downloads an attachment with a safe file name", async () => {
		const { request } = makeHarness();
		const res = await request(`${BASE}/emails/email-1/attachments/att-1`);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("application/pdf");
		expect(res.headers.get("Content-Disposition")).toContain('filename="report.pdf"');
		expect(await res.text()).toBe("pdf-bytes");
	});

	it("returns 404 for an unknown attachment", async () => {
		const { request } = makeHarness();
		const res = await request(`${BASE}/emails/email-1/attachments/missing`);
		expect(res.status).toBe(404);
	});
});

describe("request body validation", () => {
	const badBodies: [string, string, string, unknown][] = [
		["create mailbox", "POST", "/api/v1/mailboxes", { email: "not-an-email", name: "X" }],
		["update settings", "PUT", BASE, { settings: { forwarding: "yes" } }],
		["send email", "POST", `${BASE}/emails`, { to: "customer@example.com" }],
		["save draft", "POST", `${BASE}/drafts`, { to: "customer@example.com" }],
		["update email", "PUT", `${BASE}/emails/email-1`, { read: "yes" }],
		["move email", "POST", `${BASE}/emails/email-1/move`, {}],
		["create folder", "POST", `${BASE}/folders`, { name: 42 }],
		["rename folder", "PUT", `${BASE}/folders/custom`, {}],
		["reply", "POST", `${BASE}/emails/email-1/reply`, { to: "customer@example.com" }],
		["forward", "POST", `${BASE}/emails/email-1/forward`, { to: "customer@example.com" }],
	];

	it.each(badBodies)("refuses a bad %s body with 400", async (_name, method, path, body) => {
		const { json, bucket, stub } = makeHarness();
		const res = await json(path, method, body);
		expect(res.status).toBe(400);
		expect(bucket.put).not.toHaveBeenCalled();
		expect(stub.createEmail).not.toHaveBeenCalled();
	});

	it("stores only known settings keys", async () => {
		const { json, bucket } = makeHarness();
		const res = await json(BASE, "PUT", { settings: { fromName: "Hello team", injected: "x" } });
		expect(res.status).toBe(200);
		expect(bucket.put).toHaveBeenCalledWith(MAILBOX_KEY, JSON.stringify({ fromName: "Hello team" }));
	});
});
