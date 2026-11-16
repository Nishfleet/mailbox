// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export const AGENT_TOOL_NAMES = [
	"draft_reply",
	"draft_email",
	"get_email",
	"get_thread",
	"list_emails",
	"search_emails",
	"mark_email_read",
	"move_email",
	"discard_draft",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];
