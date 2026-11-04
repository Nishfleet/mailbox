import { describe, expect, it, vi } from "vitest";
import { AI_GATEWAY, findArtifactSentences, verifyDraft } from "./lib/ai";

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
	generateText: async () => ({ steps: [], text: "" }),
	convertToModelMessages: async (m: unknown) => m,
}));

const { EmailAgent } = await import("./agent/index");

function fakeAi(reply: string) {
	return { run: vi.fn(async () => ({ response: reply })) };
}

const CLEAN_DRAFT =
	"Hi Sam,\n\nThanks for the order. Your refund is on its way, see https://0509.io/docs/refunds for the timeline.\n\nBest,\nAsha";

describe("verifyDraft", () => {
	it("returns a clean draft unchanged without calling the model", async () => {
		const ai = fakeAi("1");
		expect(await verifyDraft(ai as unknown as Ai, CLEAN_DRAFT)).toBe(CLEAN_DRAFT);
		expect(ai.run).not.toHaveBeenCalled();
	});

	it("flags tool and drafting commentary", () => {
		expect(
			findArtifactSentences(
				"Thanks for writing. Drafted via draft_reply to email f17c9a14. [Auto-triggered] The operator can review and send from the UI.",
			),
		).toEqual([
			"Drafted via draft_reply to email f17c9a14.",
			"[Auto-triggered] The operator can review and send from the UI.",
		]);
	});

	it("removes only the sentences the model confirms, with a short answer and the gateway", async () => {
		const ai = fakeAi("1");
		const draft = `${CLEAN_DRAFT}\nDraft saved.`;
		expect(await verifyDraft(ai as unknown as Ai, draft)).toBe(CLEAN_DRAFT);
		expect(ai.run).toHaveBeenCalledTimes(1);
		const [, input, options] = ai.run.mock.calls[0] as unknown as [
			string,
			{ max_tokens: number },
			{ gateway: unknown },
		];
		expect(input.max_tokens).toBeLessThanOrEqual(16);
		expect(options.gateway).toEqual(AI_GATEWAY);
	});

	it("keeps the draft when the model says no flagged sentence is commentary", async () => {
		const ai = fakeAi("NONE");
		const draft = `${CLEAN_DRAFT}\nHere is the reply you asked for about delivery times.`;
		expect(await verifyDraft(ai as unknown as Ai, draft)).toBe(draft);
	});

	it("keeps the quoted block of an HTML draft", async () => {
		const ai = fakeAi("1");
		const quoted = "<blockquote><p>Where is my refund?</p></blockquote>";
		const result = await verifyDraft(
			ai as unknown as Ai,
			`<p>Your refund was sent today and should arrive this week.</p><p>Draft created.</p>${quoted}`,
		);
		expect(result).not.toContain("Draft created");
		expect(result).toContain("Your refund was sent today");
		expect(result.endsWith(quoted)).toBe(true);
	});

	it("returns an empty body when the model fails, as before", async () => {
		const ai = { run: vi.fn(async () => Promise.reject(new Error("down"))) };
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await verifyDraft(ai as unknown as Ai, `${CLEAN_DRAFT}\nDraft saved.`)).toBe("");
		vi.mocked(console.error).mockRestore();
	});
});

describe("EmailAgent injection scan", () => {
	function makeAgent(scanReply: string) {
		const data = new Map<string, unknown>();
		const storage = {
			get: vi.fn(async (key: string) => data.get(key)),
			put: vi.fn(async (key: string, value: unknown) => {
				data.set(key, value);
			}),
		};
		const emails = new Map(
			["e1", "e2", "e3"].map((id, i) => [
				id,
				{
					id,
					folder_id: "inbox",
					internal_owned: false,
					date: `2026-11-0${i + 1}T10:00:00Z`,
					body: `<p>Message ${id}: when will my order arrive?</p>`,
				},
			]),
		);
		const stub = {
			getEmail: vi.fn(async (id: string) => emails.get(id)),
			getEmails: vi.fn(async () => [...emails.values()]),
			createEmail: vi.fn(async () => {}),
		};
		const ai = fakeAi(scanReply);
		const env = {
			MAILBOX: { idFromName: (name: string) => name, get: () => stub },
			BUCKET: { get: vi.fn(async () => null) },
			AI: ai,
		};
		const agent = new EmailAgent({ storage } as never, env as never);
		const run = (emailId: string) =>
			agent.handleNewEmail({
				mailboxId: "support@0509.io",
				emailId,
				sender: "customer@example.com",
				subject: "Order",
				threadId: "t1",
			});
		return { run, ai };
	}

	it("scans each email in a thread once, not again on every reply", async () => {
		const { run, ai } = makeAgent("NO");
		await run("e3");
		expect(ai.run).toHaveBeenCalledTimes(3);
		for (const [, , options] of ai.run.mock.calls as unknown as [string, unknown, { gateway: unknown }][]) {
			expect(options.gateway).toEqual(AI_GATEWAY);
		}
		await run("e3");
		expect(ai.run).toHaveBeenCalledTimes(3);
	});

	it("does not cache an email flagged as injection", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { run, ai } = makeAgent("YES");
		await run("e1");
		await run("e1");
		expect(ai.run).toHaveBeenCalledTimes(2);
		vi.mocked(console.warn).mockRestore();
	});
});
