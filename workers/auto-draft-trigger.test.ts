// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { receiveEmail, type IncomingEmailEvent } from "./index";
import { AUTO_DRAFT_TRIGGER_FAILED } from "./lib/auto-draft-trigger";
import { mailboxSettingsKey } from "./lib/mailbox-settings";
import type { Env } from "./types";

const MAILBOX_ID = "hello@0509.io";

const RAW_BYTES = new TextEncoder().encode([
	"From: Sender <sender@example.com>",
	`To: ${MAILBOX_ID}`,
	"Subject: Question about pricing",
	"Message-ID: <q1@example.com>",
	"Content-Type: text/plain; charset=utf-8",
	"",
	"How much is the annual plan?",
	"",
].join("\r\n"));

function makeEvent(): IncomingEmailEvent {
	return {
		raw: new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(RAW_BYTES);
				controller.close();
			},
		}),
		rawSize: RAW_BYTES.byteLength,
		from: "sender@example.com",
		to: MAILBOX_ID,
		headers: new Headers(),
	};
}

async function deliver(agentNamespace: unknown) {
	const waits: Promise<unknown>[] = [];
	const mailboxKey = mailboxSettingsKey(MAILBOX_ID);
	const env = {
		BUCKET: {
			head: vi.fn(async (key: string) => (key === mailboxKey ? {} : null)),
			get: vi.fn(async (key: string) => (key === mailboxKey ? { json: async () => ({}) } : null)),
			put: vi.fn(async () => {}),
		},
		MAILBOX: {
			idFromName: (name: string) => name,
			get: () => ({
				createEmail: vi.fn(async () => {}),
				findThreadBySubject: vi.fn(async () => null),
				getFolders: vi.fn(async () => ({})),
			}),
		},
		EMAIL_AGENT: agentNamespace,
		EMAIL_ADDRESSES: [],
	} as unknown as Env;
	const ctx = {
		waitUntil: (p: Promise<unknown>) => { waits.push(p); },
		passThroughOnException: () => {},
	} as unknown as ExecutionContext;

	await receiveEmail(makeEvent(), env, ctx);
	await Promise.all(waits);
}

function failureLines(spy: MockInstance<typeof console.error>) {
	return spy.mock.calls
		.map((args) => {
			try { return JSON.parse(String(args[0])); } catch { return null; }
		})
		.filter((line) => line?.event === AUTO_DRAFT_TRIGGER_FAILED);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("auto-draft trigger on incoming mail (#17)", () => {
	it("writes a structured error line when the agent call throws", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const namespace = {
			idFromName: (name: string) => name,
			get: () => ({ fetch: async () => { throw new Error("Durable Object reset"); } }),
		};

		await expect(deliver(namespace)).resolves.toBeUndefined();

		const lines = failureLines(errors);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ mailboxId: MAILBOX_ID, error: "Durable Object reset" });
	});
});
