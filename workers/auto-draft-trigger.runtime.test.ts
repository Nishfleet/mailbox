import { env, runInDurableObject } from "cloudflare:test";
import { getAgentByName } from "agents";
import { afterEach, expect, it, vi } from "vitest";
import type { EmailAgent } from "./agent";
import { AUTO_DRAFT_TRIGGER_FAILED, triggerAutoDraft } from "./lib/auto-draft-trigger";
import type { Env } from "./types";

const MAILBOX_ID = "hello@0509.io";

afterEach(() => {
	vi.restoreAllMocks();
});

it("reaches the real EmailAgent with its name set, and logs its non-2xx answer without customer data (#17)", async () => {
	const errors = vi.spyOn(console, "error").mockImplementation(() => {});

	await triggerAutoDraft(env as unknown as Env, {
		mailboxId: MAILBOX_ID,
		emailId: "email-1",
		sender: "sender@example.com",
		subject: "Question about pricing",
		threadId: "email-1",
	});

	const failures = errors.mock.calls
		.map(([line]) => String(line))
		.filter((line) => line.includes(AUTO_DRAFT_TRIGGER_FAILED));
	expect(failures.join("\n")).not.toContain("Missing namespace or room headers");
	expect(failures).toHaveLength(1);
	const line = JSON.parse(failures[0]);
	expect(line).toMatchObject({ event: AUTO_DRAFT_TRIGGER_FAILED, mailboxId: MAILBOX_ID, status: 500 });
	expect(failures[0]).not.toContain("sender@example.com");
	expect(failures[0]).not.toContain("pricing");

	const agent = await getAgentByName((env as unknown as Env).EMAIL_AGENT, MAILBOX_ID);
	await runInDurableObject(agent, (instance: EmailAgent) => {
		expect(instance.name).toBe(MAILBOX_ID);
	});
});
