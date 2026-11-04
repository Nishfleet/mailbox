import { env, runInDurableObject } from "cloudflare:test";
import { getAgentByName } from "agents";
import { afterEach, expect, it, vi } from "vitest";
import type { EmailAgent } from "./agent";
import { AUTO_DRAFT_TRIGGER_FAILED, triggerAutoDraft, type AutoDraftTriggerPayload } from "./lib/auto-draft-trigger";
import type { Env } from "./types";

const testEnv = env as unknown as Env;

function payload(mailboxId: string): AutoDraftTriggerPayload {
	return {
		mailboxId,
		emailId: "email-1",
		sender: "sender@example.com",
		subject: "Question about pricing",
		threadId: "email-1",
	};
}

function failureLines(errors: { mock: { calls: unknown[][] } }): string[] {
	return errors.mock.calls
		.map(([line]) => String(line))
		.filter((line) => line.includes(AUTO_DRAFT_TRIGGER_FAILED));
}

afterEach(() => {
	vi.restoreAllMocks();
});

it("reaches onNewEmail on the real EmailAgent with its name set, and logs no failure (#17)", async () => {
	const mailboxId = "hello@0509.io";
	const errors = vi.spyOn(console, "error").mockImplementation(() => {});
	const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});

	await triggerAutoDraft(testEnv, payload(mailboxId));

	expect(failureLines(errors)).toEqual([]);
	expect(warnings.mock.calls.map(([line]) => String(line)))
		.toContainEqual(expect.stringContaining(`Auto-draft daily limit reached for ${mailboxId}`));

	const agent = await getAgentByName(testEnv.EMAIL_AGENT, mailboxId);
	await runInDurableObject(agent, (instance: EmailAgent) => {
		expect(instance.name).toBe(mailboxId);
	});
});

it("logs a non-2xx answer from onNewEmail as one line without customer data", async () => {
	const mailboxId = "support@0509.io";
	const errors = vi.spyOn(console, "error").mockImplementation(() => {});
	const agent = await getAgentByName(testEnv.EMAIL_AGENT, mailboxId);
	await runInDurableObject(agent, (instance: EmailAgent) => {
		vi.spyOn(instance, "handleNewEmail").mockRejectedValue(new Error("draft failed"));
	});

	await triggerAutoDraft(testEnv, payload(mailboxId));

	const failures = failureLines(errors);
	expect(failures).toHaveLength(1);
	const line: unknown = JSON.parse(failures[0]);
	expect(line).toMatchObject({ event: AUTO_DRAFT_TRIGGER_FAILED, mailboxId, status: 500 });
	expect(failures[0]).toContain("draft failed");
	expect(failures[0]).not.toContain("sender@example.com");
	expect(failures[0]).not.toContain("pricing");
});
