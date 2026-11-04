// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * MCP clients must not be able to send mail or permanently delete it:
 * send_reply / send_email save a draft for a person to send from the app,
 * and delete_email moves the email to Trash.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Folders } from "../shared/folders";
import type { Env } from "./types";

type Handler = (args: Record<string, unknown>) => Promise<{
	content: { type: string; text: string }[];
	isError?: boolean;
}>;

const registered = new Map<string, { description: string; handler: Handler }>();

// The real McpAgent / McpServer need the Workers runtime; these stand-ins
// only record the registered tools so the handlers can be called directly.
vi.mock("agents/mcp", () => ({
	McpAgent: class {
		env: unknown;
		constructor(_ctx: unknown, env: unknown) {
			this.env = env;
		}
	},
}));
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
	McpServer: class {
		tool(name: string, description: string, _schema: unknown, handler: Handler) {
			registered.set(name, { description, handler });
		}
	},
}));

const sendEmail = vi.fn(async () => {});
vi.mock("./email-sender", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...(args as [])) }));

const { EmailMCP } = await import("./mcp/index");

const MAILBOX_ID = "support@0509.io";
const ORIGINAL_ID = "orig-1";

function makeEnv() {
	const emails = new Map<string, Record<string, unknown>>([
		[
			ORIGINAL_ID,
			{
				id: ORIGINAL_ID,
				folder_id: Folders.INBOX,
				subject: "Help",
				sender: "customer@example.com",
				recipient: MAILBOX_ID,
				date: "2026-10-01T00:00:00.000Z",
				body: "<p>Can you help?</p>",
				thread_id: "thread-1",
				message_id: "abc@example.com",
				email_references: null,
			},
		],
	]);
	const stub = {
		getEmail: vi.fn(async (id: string) => emails.get(id) ?? null),
		createEmail: vi.fn(async (folder: string, email: Record<string, unknown>) => {
			emails.set(email.id as string, { ...email, folder_id: folder });
		}),
		moveEmail: vi.fn(async (id: string, folder: string) => {
			const email = emails.get(id);
			if (email) email.folder_id = folder;
			return true;
		}),
		deleteEmail: vi.fn(async (id: string) => {
			emails.delete(id);
			return [];
		}),
		checkSendRateLimit: vi.fn(async () => null),
	};
	const env = {
		BUCKET: { head: vi.fn(async () => ({})) },
		MAILBOX: { idFromName: (name: string) => name, get: () => stub },
		AI: { run: vi.fn(async () => ({ response: "NONE" })) },
		EMAIL: { send: vi.fn(async () => {}) },
		DOMAINS: "0509.io",
	} as unknown as Env;
	return { env, stub, emails };
}

async function initTools(env: Env) {
	registered.clear();
	const mcp = new EmailMCP({} as never, env);
	await mcp.init();
	return (name: string) => {
		const tool = registered.get(name);
		if (!tool) throw new Error(`tool ${name} not registered`);
		return tool;
	};
}

function parse(result: Awaited<ReturnType<Handler>>) {
	return JSON.parse(result.content[0].text);
}

describe("MCP tools cannot send or permanently delete mail", () => {
	beforeEach(() => {
		sendEmail.mockClear();
	});

	it("send_reply saves a draft instead of sending", async () => {
		const { env, stub, emails } = makeEnv();
		const tool = await initTools(env);

		const result = await tool("send_reply").handler({
			mailboxId: MAILBOX_ID,
			originalEmailId: ORIGINAL_ID,
			to: "customer@example.com",
			subject: "Re: Help",
			bodyHtml: "<p>Sure, here is how.</p>",
		});

		expect(result.isError).toBeUndefined();
		const body = parse(result);
		expect(body.status).toBe("draft_saved");
		expect(body.sent).toBe(false);
		expect(sendEmail).not.toHaveBeenCalled();
		expect((env as unknown as { EMAIL: { send: ReturnType<typeof vi.fn> } }).EMAIL.send).not.toHaveBeenCalled();
		expect(stub.createEmail).toHaveBeenCalledTimes(1);
		expect(stub.createEmail.mock.calls[0][0]).toBe(Folders.DRAFT);
		expect(emails.get(body.draftId)?.folder_id).toBe(Folders.DRAFT);
		expect(emails.get(body.draftId)?.in_reply_to).toBe(ORIGINAL_ID);
		expect(tool("send_reply").description).toMatch(/does NOT send/);
	});

	it("send_email saves a draft instead of sending", async () => {
		const { env, stub, emails } = makeEnv();
		const tool = await initTools(env);

		const result = await tool("send_email").handler({
			mailboxId: MAILBOX_ID,
			to: "someone@example.com",
			subject: "Hello",
			bodyHtml: "<p>Hi there.</p>",
		});

		expect(result.isError).toBeUndefined();
		const body = parse(result);
		expect(body.status).toBe("draft_saved");
		expect(body.sent).toBe(false);
		expect(sendEmail).not.toHaveBeenCalled();
		expect(stub.createEmail).toHaveBeenCalledTimes(1);
		expect(stub.createEmail.mock.calls[0][0]).toBe(Folders.DRAFT);
		expect(emails.get(body.draftId)?.folder_id).toBe(Folders.DRAFT);
		expect(tool("send_email").description).toMatch(/does NOT send/);
	});

	it("delete_email moves the email to Trash and never deletes it", async () => {
		const { env, stub, emails } = makeEnv();
		const tool = await initTools(env);

		const result = await tool("delete_email").handler({ mailboxId: MAILBOX_ID, emailId: ORIGINAL_ID });

		expect(result.isError).toBeUndefined();
		expect(parse(result).status).toBe("moved_to_trash");
		expect(stub.deleteEmail).not.toHaveBeenCalled();
		expect(stub.moveEmail).toHaveBeenCalledWith(ORIGINAL_ID, Folders.TRASH);
		expect(emails.get(ORIGINAL_ID)?.folder_id).toBe(Folders.TRASH);
	});

	it("delete_email reports a missing email without touching anything", async () => {
		const { env, stub } = makeEnv();
		const tool = await initTools(env);

		const result = await tool("delete_email").handler({ mailboxId: MAILBOX_ID, emailId: "missing" });

		expect(result.isError).toBe(true);
		expect(parse(result).error).toBe("Email not found");
		expect(stub.moveEmail).not.toHaveBeenCalled();
		expect(stub.deleteEmail).not.toHaveBeenCalled();
	});
});
