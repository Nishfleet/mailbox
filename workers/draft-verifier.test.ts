// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { verifyDraft } from "./lib/ai";

function makeAi(response = "NONE") {
	const run = vi.fn(() => ({ response }));
	return { ai: { run } as unknown as Ai, run };
}

describe("verifyDraft regex-first cleanup", () => {
	it("does not call the model for a clean draft", async () => {
		const { ai, run } = makeAi();
		const body = "Hi Sam,\n\nHere is the email address I promised: sam@example.com\n\nThanks,\nAlex";

		const result = await verifyDraft(ai, body);

		expect(result).toBe(body);
		expect(run).not.toHaveBeenCalled();
	});

	it("strips a Here is wrapper and sends only the flagged span to the model", async () => {
		const { ai, run } = makeAi();
		const body = "Here is the draft: Hi Sam,\n\nThanks for waiting.";

		const result = await verifyDraft(ai, body);

		expect(result).toBe("Hi Sam,\n\nThanks for waiting.");
		expect(run).toHaveBeenCalledTimes(1);
		const call = run.mock.calls[0] as unknown as unknown[];
		const prompt = JSON.stringify(call);
		expect(prompt).toContain("Here is the draft:");
		expect(prompt).not.toContain("Thanks for waiting.");
		expect(call[2]).toEqual({ gateway: { id: "default" } });
	});

	it("strips Draft labels, artifact notices, and tool-call JSON", async () => {
		const { ai } = makeAi();
		const body = [
			"Draft:",
			"Hi Sam,",
			"",
			"Draft saved.",
			"```json",
			'{"name":"draft_reply","arguments":{"body":"Thanks"}}',
			"```",
			"Thanks for waiting.",
		].join("\n");

		expect(await verifyDraft(ai, body)).toBe("Hi Sam,\n\nThanks for waiting.");
	});

	it("removes an unfenced nested tool-call JSON object", async () => {
		const { ai } = makeAi();
		const body = 'Hi Sam,\n\n{"name":"draft_reply","arguments":{"body":"Thanks"}}\n\nThanks for waiting.';

		expect(await verifyDraft(ai, body)).toBe("Hi Sam,\n\nThanks for waiting.");
	});

	it("keeps legitimate here-is content and the quoted reply block", async () => {
		const { ai, run } = makeAi();
		const quoted = '<br><blockquote>Earlier message</blockquote>';
		const body = `<p>Draft: Here is the invite link: https://example.com/invite</p>${quoted}`;

		const result = await verifyDraft(ai, body);

		expect(result).toContain("Here is the invite link");
		expect(result).not.toContain("<p>Draft:");
		expect(result.endsWith(quoted)).toBe(true);
		expect(run).toHaveBeenCalledTimes(1);
	});
});
