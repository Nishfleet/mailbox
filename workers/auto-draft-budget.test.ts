// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Auto-drafting must skip spam and stop after a daily per-mailbox cap, so a
 * burst of inbound mail cannot run up Workers AI cost without limit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Folders } from "../shared/folders";
import {
	AUTO_DRAFT_BUDGET_KEY,
	DEFAULT_AUTO_DRAFT_DAILY_LIMIT,
	parseAutoDraftDailyLimit,
	takeAutoDraftSlot,
} from "./lib/auto-draft-budget";

function memoryStorage() {
	const data = new Map<string, unknown>();
	return {
		data,
		get: vi.fn(async (key: string) => data.get(key)),
		put: vi.fn(async (key: string, value: unknown) => {
			data.set(key, value);
		}),
	};
}

describe("parseAutoDraftDailyLimit", () => {
	it("defaults when unset or invalid", () => {
		expect(DEFAULT_AUTO_DRAFT_DAILY_LIMIT).toBe(200);
		for (const raw of [undefined, null, "", "  ", "abc", "-1", "1.5"]) {
			expect(parseAutoDraftDailyLimit(raw)).toBe(DEFAULT_AUTO_DRAFT_DAILY_LIMIT);
		}
	});

	it("accepts a whole number, including 0 to turn auto-drafting off", () => {
		expect(parseAutoDraftDailyLimit("50")).toBe(50);
		expect(parseAutoDraftDailyLimit(" 7 ")).toBe(7);
		expect(parseAutoDraftDailyLimit("0")).toBe(0);
	});
});

describe("takeAutoDraftSlot", () => {
	it("allows drafts up to the limit, then refuses for the rest of the UTC day", async () => {
		const storage = memoryStorage();
		const day1 = new Date("2026-10-15T08:00:00Z");

		expect(await takeAutoDraftSlot(storage, 2, day1)).toMatchObject({ allowed: true, used: 1 });
		expect(await takeAutoDraftSlot(storage, 2, day1)).toMatchObject({ allowed: true, used: 2 });
		expect(await takeAutoDraftSlot(storage, 2, new Date("2026-10-15T23:59:59Z"))).toMatchObject({
			allowed: false,
			used: 2,
			limit: 2,
		});
		expect(storage.data.get(AUTO_DRAFT_BUDGET_KEY)).toEqual({ day: "2026-10-15", count: 2 });

		// Next UTC day: the count starts again.
		expect(await takeAutoDraftSlot(storage, 2, new Date("2026-10-16T00:00:01Z"))).toMatchObject({
			allowed: true,
			used: 1,
			day: "2026-10-16",
		});
	});

	it("refuses everything when the limit is 0", async () => {
		const storage = memoryStorage();
		expect((await takeAutoDraftSlot(storage, 0)).allowed).toBe(false);
		expect(storage.put).not.toHaveBeenCalled();
	});
});

// ── EmailAgent.handleNewEmail ──────────────────────────────────────

const generateText = vi.fn(async () => ({ steps: [], text: "" }));

// The real AIChatAgent needs the Workers runtime; this stand-in gives the
// agent an env, Durable Object storage and chat history.
vi.mock("@cloudflare/ai-chat", () => ({
	AIChatAgent: class {
		env: unknown;
		ctx: unknown;
		messages: unknown[] = [];
		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
		async persistMessages(messages: unknown[]) {
			this.messages = messages;
		}
	},
}));
vi.mock("workers-ai-provider", () => ({ createWorkersAI: () => () => ({}) }));
vi.mock("ai", async (importOriginal) => ({
	...(await importOriginal<typeof import("ai")>()),
	generateText: (...args: unknown[]) => generateText(...(args as [])),
	convertToModelMessages: async (m: unknown) => m,
}));

const { EmailAgent } = await import("./agent/index");

const MAILBOX_ID = "support@0509.io";

type TestEmail = {
	id: string;
	folder_id: string;
	body: string;
	internal_owned: boolean;
	injection_checked?: number;
};

function makeAgent(
	opts: {
		limit?: string;
		folder?: string;
		emailId?: string;
		thread?: TestEmail[];
	} = {},
) {
	const storage = memoryStorage();
	const email: TestEmail = {
		id: "e1",
		folder_id: opts.folder ?? Folders.INBOX,
		body: "<p>Hello, I have a question about my order.</p>",
		internal_owned: false,
	};
	const emails = new Map<string, TestEmail>([[email.id, email]]);
	for (const item of opts.thread ?? []) emails.set(item.id, item);
	const thread = opts.thread ?? [email];
	const stub = {
		getEmail: vi.fn(async (id: string) => emails.get(id) ?? null),
		getEmails: vi.fn(async () => thread),
		markInjectionChecked: vi.fn((id: string) => {
			const item = emails.get(id);
			if (item) item.injection_checked = 1;
		}),
		createEmail: vi.fn(async () => {}),
	};
	const aiRun = vi.fn(async () => ({ response: "NO" }));
	const env = {
		MAILBOX: { idFromName: (name: string) => name, get: () => stub },
		BUCKET: { get: vi.fn(async () => null) },
		AI: { run: aiRun },
		...(opts.limit !== undefined ? { AUTO_DRAFT_DAILY_LIMIT: opts.limit } : {}),
	};
	const agent = new EmailAgent({ storage } as never, env as never);
	const run = (emailId = opts.emailId ?? "e1") =>
		agent.handleNewEmail({
			mailboxId: MAILBOX_ID,
			emailId,
			sender: "customer@example.com",
			subject: "Order question",
			threadId: "t1",
		});
	return { run, storage, aiRun, stub, emails, thread };
}

describe("EmailAgent auto-draft guards", () => {
	beforeEach(() => {
		generateText.mockClear();
	});

	it("drafts normally while under the daily limit", async () => {
		const { run } = makeAgent({ limit: "5" });
		const result = await run();
		expect(result).toMatchObject({ status: "draft_generated" });
		expect(generateText).toHaveBeenCalledTimes(1);
	});

	it("stops drafting and logs once the daily limit is reached", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { run, aiRun } = makeAgent({ limit: "2" });

		await run();
		await run();
		expect(generateText).toHaveBeenCalledTimes(2);
		const aiCallsBefore = aiRun.mock.calls.length;

		const third = await run();
		expect(third).toMatchObject({ status: "skipped_daily_limit", used: 2, limit: 2 });
		expect(generateText).toHaveBeenCalledTimes(2);
		// No AI call at all (not even the injection scan) once capped.
		expect(aiRun.mock.calls.length).toBe(aiCallsBefore);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("Auto-draft daily limit reached"));
		warn.mockRestore();
	});

	it("scans a single email once and records the injection check", async () => {
		const { run, aiRun, stub } = makeAgent({ limit: "5" });
		await run();
		expect(aiRun).toHaveBeenCalledTimes(1);
		expect(stub.markInjectionChecked).toHaveBeenCalledWith("e1");
	});

	it("does not rescan older thread emails that are already checked", async () => {
		const old: TestEmail = {
			id: "e0",
			folder_id: Folders.INBOX,
			body: "<p>Earlier message.</p>",
			internal_owned: false,
			injection_checked: 1,
		};
		const current: TestEmail = {
			id: "e1",
			folder_id: Folders.INBOX,
			body: "<p>Hello, I have a question about my order.</p>",
			internal_owned: false,
		};
		const { run, aiRun, stub } = makeAgent({ limit: "5", thread: [old, current] });
		await run();
		expect(aiRun).toHaveBeenCalledTimes(1);
		expect(stub.markInjectionChecked).toHaveBeenCalledTimes(1);
		expect(stub.markInjectionChecked).toHaveBeenCalledWith("e1");
	});

	it("scans an unchecked earlier thread email only once", async () => {
		const old: TestEmail = {
			id: "e0",
			folder_id: Folders.INBOX,
			body: "<p>Earlier message.</p>",
			internal_owned: false,
		};
		const current: TestEmail = {
			id: "e1",
			folder_id: Folders.INBOX,
			body: "<p>Hello, I have a question about my order.</p>",
			internal_owned: false,
		};
		const { run, aiRun, stub, emails, thread } = makeAgent({
			limit: "5",
			thread: [old, current],
		});
		await run();
		expect(aiRun).toHaveBeenCalledTimes(2);
		expect(stub.markInjectionChecked).toHaveBeenCalledWith("e0");
		expect(stub.markInjectionChecked).toHaveBeenCalledWith("e1");

		const reply: TestEmail = {
			id: "e2",
			folder_id: Folders.INBOX,
			body: "<p>Following up.</p>",
			internal_owned: false,
		};
		emails.set(reply.id, reply);
		thread.push(reply);
		await run("e2");
		expect(aiRun).toHaveBeenCalledTimes(3);
		expect(stub.markInjectionChecked).toHaveBeenCalledTimes(3);
	});

	it("uses the default limit of 200 when the var is unset", async () => {
		const { run, storage } = makeAgent();
		const today = new Date().toISOString().slice(0, 10);
		storage.data.set(AUTO_DRAFT_BUDGET_KEY, { day: today, count: 200 });
		vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(await run()).toMatchObject({ status: "skipped_daily_limit", limit: 200 });
		expect(generateText).not.toHaveBeenCalled();
		vi.mocked(console.warn).mockRestore();
	});

	it("skips email stored in the Spam folder without using AI or the budget", async () => {
		const { run, storage, aiRun } = makeAgent({ folder: Folders.SPAM });
		expect(await run()).toEqual({ status: "skipped_spam" });
		expect(generateText).not.toHaveBeenCalled();
		expect(aiRun).not.toHaveBeenCalled();
		expect(storage.put).not.toHaveBeenCalled();
	});
});
