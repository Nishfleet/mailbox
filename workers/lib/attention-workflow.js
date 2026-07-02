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
			subject: item.subject,
			reason: item.reason,
		});
		if (actions.length >= limit) break;
	}

	return actions;
}
