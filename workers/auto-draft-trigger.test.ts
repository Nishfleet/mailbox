// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { receiveEmail, type IncomingEmailEvent } from "./index";
import { AUTO_DRAFT_TRIGGER_FAILED } from "./lib/auto-draft-trigger";
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

/**
 * An EmailAgent namespace that behaves like the agents SDK (partyserver):
 * a Durable Object that has not been told its name answers every request with
 * HTTP 500 "Missing namespace or room headers", and it learns its name only
 * from the x-partykit-room header that getAgentByName sends.
 */
function makeAgentNamespace(onNewEmail: (body: unknown) => Response | Promise<Response>) {
	const names = new Map<string, string>();
	const received: unknown[] = [];
	const namespace = {
		idFromName: (name: string) => `id:${name}`,
		get: (id: string) => ({
			fetch: async (request: Request) => {
				if (!names.has(id)) {
					const room = request.headers.get("x-partykit-room");
					if (!room) {
						return new Response("Missing namespace or room headers when connecting to EmailAgent.", { status: 500 });
					}
					names.set(id, room);
				}
				const url = new URL(request.url);
				if (url.pathname === "/cdn-cgi/partyserver/set-name/") return Response.json({ ok: true });
				if (url.pathname === "/onNewEmail") {
					const body = await request.json();
					received.push(body);
					return onNewEmail(body);
				}
				return new Response("not found", { status: 404 });
			},
		}),
	};
	return { namespace, names, received };
}

async function deliver(agentNamespace: unknown) {
	const waits: Promise<unknown>[] = [];
	const mailboxKey = `mailboxes/${MAILBOX_ID}.json`;
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

function failureLines(spy: ReturnType<typeof vi.spyOn>) {
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
	it("names the agent before calling onNewEmail, so the draft request reaches it", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const agent = makeAgentNamespace(() => Response.json({ drafted: true }));

		await deliver(agent.namespace);

		expect(agent.names.get(`id:${MAILBOX_ID}`)).toBe(MAILBOX_ID);
		expect(agent.received).toHaveLength(1);
		expect(agent.received[0]).toMatchObject({
			mailboxId: MAILBOX_ID,
			subject: "Question about pricing",
		});
		expect(failureLines(errors)).toEqual([]);
	});

	it("writes a structured error line when the agent answers non-2xx", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const agent = makeAgentNamespace(() =>
			Response.json({ error: "model unavailable" }, { status: 500 }),
		);

		await deliver(agent.namespace);

		const lines = failureLines(errors);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ mailboxId: MAILBOX_ID, status: 500 });
		expect(lines[0].error).toContain("model unavailable");
		// Customer data stays out of the log line.
		expect(JSON.stringify(lines[0])).not.toContain("sender@example.com");
		expect(JSON.stringify(lines[0])).not.toContain("pricing");
	});

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
