// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { applyMailboxForwarding, receiveEmail, type IncomingEmailEvent } from "./index";
import { Folders } from "../shared/folders";
import type { Env } from "./types";

const MAILBOX_ID = "billing@0509.io";
const FORWARD_TO = "nish@gmail.com";

const RAW_MIME = [
	"From: Sender <sender@example.com>",
	`To: ${MAILBOX_ID}`,
	"Subject: Invoice for September",
	"Message-ID: <abc123@example.com>",
	"Content-Type: text/plain; charset=utf-8",
	"",
	"Please find the September invoice attached.",
	"",
].join("\r\n");

const RAW_BYTES = new TextEncoder().encode(RAW_MIME);

function makeEvent(onForward?: (rcptTo: string) => Promise<unknown>): IncomingEmailEvent {
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
		...(onForward ? { forward: (rcptTo: string) => onForward(rcptTo) } : {}),
	};
}

type CreateEmailSpy = ReturnType<typeof vi.fn>;

function makeHarness(settings: unknown, forward?: (rcptTo: string) => Promise<unknown>) {
	const order: string[] = [];
	const storedFolders: unknown[] = [];
	const mailboxKey = `mailboxes/${MAILBOX_ID}.json`;

	const createEmail: CreateEmailSpy = vi.fn((folder: unknown) => {
		order.push("createEmail");
		storedFolders.push(folder);
		return Promise.resolve();
	});

	const stub = {
		createEmail,
		findThreadBySubject: vi.fn(() => Promise.resolve(null)),
		getFolders: vi.fn(() => Promise.resolve({})),
	};

	const bucket = {
		head: vi.fn((key: string) => Promise.resolve(key === mailboxKey ? {} : null)),
		get: vi.fn((key: string) =>
			Promise.resolve(key === mailboxKey ? { json: () => Promise.resolve(settings) } : null),
		),
		put: vi.fn(() => Promise.resolve()),
	};

	const agentFetch = vi.fn(() => Promise.resolve(new Response("ok")));

	const env = {
		BUCKET: bucket,
		MAILBOX: { idFromName: (name: string) => name, get: () => stub },
		EMAIL_AGENT: { idFromName: (name: string) => name, get: () => ({ fetch: agentFetch }) },
		EMAIL_ADDRESSES: [],
	} as unknown as Env;

	const waitUntil = vi.fn();
	const ctx = {
		waitUntil,
		passThroughOnException: vi.fn(),
	} as unknown as ExecutionContext;

	const event = makeEvent(
		forward
			? async (rcptTo: string) => {
					order.push("forward");
					return forward(rcptTo);
				}
			: undefined,
	);

	return { env, ctx, event, createEmail, bucket, order, storedFolders, waitUntil };
}

describe("mailbox forwarding on incoming mail (#14)", () => {
	it("forwards to the configured address when forwarding is enabled", async () => {
		const forward = vi.fn(() => Promise.resolve(undefined));
		const { env, ctx, event, createEmail, order, waitUntil } = makeHarness(
			{ fromName: "Billing", forwarding: { enabled: true, email: FORWARD_TO } },
			forward,
		);

		await receiveEmail(event, env, ctx);

		expect(forward).toHaveBeenCalledTimes(1);
		expect(forward).toHaveBeenCalledWith(FORWARD_TO);
		// The mail is stored as before, and the forward happens only after the store.
		expect(createEmail).toHaveBeenCalledTimes(1);
		expect(order).toEqual(["createEmail", "forward"]);
		// Normal inbox mail still triggers the auto-draft.
		expect(waitUntil).toHaveBeenCalledTimes(1);
	});

	it("forwards mail that the spam heuristic flags", async () => {
		// A false-positive spam classification is exactly the brand mail that must
		// not vanish, so forwarding runs before the SPAM early return.
		const forward = vi.fn(() => Promise.resolve(undefined));
		const { env, ctx, event, createEmail, order, storedFolders, waitUntil } = makeHarness(
			{ forwarding: { enabled: true, email: FORWARD_TO } },
			forward,
		);
		event.headers = new Headers({ "x-cf-spamh-score": "7" });

		await receiveEmail(event, env, ctx);

		expect(createEmail).toHaveBeenCalledTimes(1);
		expect(storedFolders).toEqual([Folders.SPAM]);
		expect(forward).toHaveBeenCalledWith(FORWARD_TO);
		expect(order).toEqual(["createEmail", "forward"]);
		// Spam never triggers an AI auto-draft.
		expect(waitUntil).not.toHaveBeenCalled();
	});

	it("does not forward when forwarding is disabled", async () => {
		const forward = vi.fn(() => Promise.resolve(undefined));
		const { env, ctx, event, createEmail } = makeHarness(
			{ fromName: "Billing", forwarding: { enabled: false, email: FORWARD_TO } },
			forward,
		);

		await receiveEmail(event, env, ctx);

		expect(forward).not.toHaveBeenCalled();
		expect(createEmail).toHaveBeenCalledTimes(1);
	});

	it("does not forward when enabled but the address is empty", async () => {
		const forward = vi.fn(() => Promise.resolve(undefined));
		const { env, ctx, event, createEmail } = makeHarness(
			{ fromName: "Billing", forwarding: { enabled: true, email: "" } },
			forward,
		);

		await receiveEmail(event, env, ctx);

		expect(forward).not.toHaveBeenCalled();
		expect(createEmail).toHaveBeenCalledTimes(1);
	});

	it("does not forward when the mailbox has no forwarding setting", async () => {
		const forward = vi.fn(() => Promise.resolve(undefined));
		const { env, ctx, event, createEmail } = makeHarness({ fromName: "Billing" }, forward);

		await receiveEmail(event, env, ctx);

		expect(forward).not.toHaveBeenCalled();
		expect(createEmail).toHaveBeenCalledTimes(1);
	});

	it("still stores the mail and does not rethrow when forward() fails", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const forward = vi.fn(() => Promise.reject(new Error("forward exploded")));
		const { env, ctx, event, createEmail, order } = makeHarness(
			{ forwarding: { enabled: true, email: FORWARD_TO } },
			forward,
		);

		await expect(receiveEmail(event, env, ctx)).resolves.toBeUndefined();

		expect(createEmail).toHaveBeenCalledTimes(1);
		expect(order).toEqual(["createEmail", "forward"]);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(`Failed to forward email for ${MAILBOX_ID} to ${FORWARD_TO}`),
			"forward exploded",
			expect.anything(),
		);
		errorSpy.mockRestore();
	});
});

describe("forwarding opt-outs per kind of mail (#15)", () => {
	it("does not forward spam when forwarding.spam is false, and still stores it", async () => {
		const forward = vi.fn(() => Promise.resolve(undefined));
		const { env, ctx, event, storedFolders } = makeHarness(
			{ forwarding: { enabled: true, email: FORWARD_TO, spam: false } },
			forward,
		);
		event.headers = new Headers({ "x-cf-spamh-score": "7" });

		await receiveEmail(event, env, ctx);

		expect(storedFolders).toEqual([Folders.SPAM]);
		expect(forward).not.toHaveBeenCalled();
	});

	it("still forwards normal mail when both opt-outs are set", async () => {
		const forward = vi.fn(() => Promise.resolve(undefined));
		const { env, ctx, event } = makeHarness(
			{ forwarding: { enabled: true, email: FORWARD_TO, spam: false, internal: false } },
			forward,
		);

		await receiveEmail(event, env, ctx);

		expect(forward).toHaveBeenCalledWith(FORWARD_TO);
	});

	it.each([
		[{}, true],
		[{ internal: true }, true],
		[{ internal: false }, false],
	])("internal owned-domain mail with %j forwards: %s", async (optOut, forwards) => {
		const forward = vi.fn(() => Promise.resolve(undefined));
		const { env, event } = makeHarness(
			{ forwarding: { enabled: true, email: FORWARD_TO, ...optOut } },
			forward,
		);

		await applyMailboxForwarding(env, MAILBOX_ID, event, { spam: false, internalOwned: true });

		expect(forward).toHaveBeenCalledTimes(forwards ? 1 : 0);
	});

	it("never rethrows a failed forward for an opted-in kind", async () => {
		const { env, event } = makeHarness(
			{ forwarding: { enabled: true, email: FORWARD_TO, spam: true } },
			async () => Promise.reject(new Error("forward failed")),
		);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			applyMailboxForwarding(env, MAILBOX_ID, event, { spam: true, internalOwned: false }),
		).resolves.toBeUndefined();
		vi.mocked(console.error).mockRestore();
	});
});
