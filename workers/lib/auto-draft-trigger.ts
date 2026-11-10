// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { getAgentByName } from "agents";
import type { Env } from "../types";
import type { EmailAgent } from "../agent/index";

export interface AutoDraftTriggerPayload {
	mailboxId: string;
	emailId: string;
	sender: string;
	subject: string;
	threadId: string;
}

/**
 * Event name of the structured log line written when the auto-draft trigger
 * fails. Workers Logs indexes JSON log fields, so a query or alert on
 * `event = "auto_draft_trigger_failed"` counts these failures.
 */
export const AUTO_DRAFT_TRIGGER_FAILED = "auto_draft_trigger_failed";

function logTriggerFailure(
	payload: AutoDraftTriggerPayload,
	detail: { status?: number; error: string },
): void {
	// Only ids, never sender or subject: those are customer data.
	console.error(JSON.stringify({
		event: AUTO_DRAFT_TRIGGER_FAILED,
		mailboxId: payload.mailboxId,
		emailId: payload.emailId,
		...detail,
	}));
}

/**
 * Ask the mailbox's EmailAgent to draft a reply to a newly stored email.
 *
 * Never throws. A rejected call or a non-2xx response is written as one
 * structured error log line, so a failure is visible without breaking intake.
 *
 * The DO namespace binding is typed untyped (`DurableObjectNamespace<undefined>`) by
 * cf's config-level type generator, because the worker references itself by name.
 * Narrow it here, where `getAgentByName` wants the Agent-typed namespace.
 */
export async function triggerAutoDraft(env: Env, payload: AutoDraftTriggerPayload): Promise<void> {
	try {
		const agent = await getAgentByName(
			env.EMAIL_AGENT as unknown as DurableObjectNamespace<EmailAgent>,
			payload.mailboxId,
		);
		const response = await agent.fetch(new Request("https://agents/onNewEmail", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		}));
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			logTriggerFailure(payload, { status: response.status, error: body.slice(0, 500) });
		}
	} catch (e) {
		logTriggerFailure(payload, { error: e instanceof Error ? e.message : String(e) });
	}
}
