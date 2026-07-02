// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

const WORKFLOW_BUCKET_PRIORITY = Object.freeze({
	drafts_ready: 0,
	money: 1,
	leads: 2,
	act_now: 3,
	aging: 4,
});

const ACTION_COPY = Object.freeze({
	drafts_ready: {
		label: "Review draft",
		description: "Open the saved draft, then send or discard it.",
	},
	money: {
		label: "Handle money",
		description: "Review the billing context and draft the customer-safe reply.",
	},
	leads: {
		label: "Work lead",
		description: "Read the thread and draft the next commercial reply.",
	},
	act_now: {
		label: "Reply next",
		description: "Read the latest thread context and prepare the response.",
	},
	aging: {
		label: "Clear aging",
		description: "Decide whether to reply, archive, or leave it waiting.",
	},
});

const AGENT_DESK_RULES = Object.freeze([
	{
		id: "money_agent",
		label: "Money agent",
		description: "Billing, refund, invoice, payment, and pricing work.",
		buckets: ["money"],
		pattern: /\b(billing|invoice|payment|refund|charge|pricing|account|dodo|stripe)\b/i,
	},
	{
		id: "lead_agent",
		label: "Lead agent",
		description: "Demo, quote, trial, sales, and partnership work.",
		buckets: ["leads"],
		pattern: /\b(hello|sales|demo|quote|trial|lead|partner|partnership)\b/i,
	},
	{
		id: "support_agent",
		label: "Support agent",
		description: "Customer replies, aging messages, and general follow-up work.",
		buckets: ["act_now", "aging"],
		pattern: /\b(support|help|issue|question|follow.?up)\b/i,
	},
	{
		id: "ops_agent",
		label: "Ops agent",
		description: "Alerts, digests, monitoring, and operational review work.",
		buckets: [],
		pattern: /\b(alert|alerts|ops|digest|monitor|monitoring|admin)\b/i,
	},
]);

function sortItemsByDateDesc(a, b) {
	return new Date(b.date).getTime() - new Date(a.date).getTime();
}

function sortItemsByWorkflowPriority(a, b) {
	const priorityDelta =
		WORKFLOW_BUCKET_PRIORITY[a.bucket] - WORKFLOW_BUCKET_PRIORITY[b.bucket];
	return priorityDelta || sortItemsByDateDesc(a, b);
}

export function buildAttentionNextActions(items, limit = 3) {
	const seen = new Set();
	const actions = [];

	for (const item of [...items].sort(sortItemsByWorkflowPriority)) {
		const conversationId = item.threadId || item.emailId;
		const key = `${item.mailboxId}:${conversationId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const copy = ACTION_COPY[item.bucket];
		actions.push({
			id: key,
			bucket: item.bucket,
			label: copy.label,
			description: copy.description,
			mailboxId: item.mailboxId,
			folderId: item.folderId,
			emailId: item.emailId,
			threadId: item.threadId,
			latestAt: item.date,
			subject: item.subject,
			reason: item.reason,
		});
		if (actions.length >= limit) break;
	}

	return actions;
}

function deskSearchText(item) {
	return [
		item.mailboxId,
		item.sender,
		item.recipient,
		item.subject,
		item.reason,
	]
		.filter(Boolean)
		.join(" ");
}

function itemMatchesDesk(item, desk) {
	return desk.buckets.includes(item.bucket) || desk.pattern.test(deskSearchText(item));
}

export function buildAgentDeskSummaries(items, actionLimit = 3) {
	return AGENT_DESK_RULES.map((desk) => {
		const deskItems = items.filter((item) => itemMatchesDesk(item, desk));
		const mailboxIds = [...new Set(deskItems.map((item) => item.mailboxId))].sort(
			(a, b) => a.localeCompare(b),
		);
		return {
			id: desk.id,
			label: desk.label,
			description: desk.description,
			signalCount: deskItems.length,
			mailboxIds,
			nextActions: buildAttentionNextActions(deskItems, actionLimit),
		};
	}).filter((desk) => desk.signalCount > 0);
}
