// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Env } from "../types";
import { mapWithConcurrency } from "./async";
import {
	buildAgentDeskSummaries,
	buildAttentionNextActions,
} from "./attention-workflow.js";
import { listMailboxes } from "./email-helpers";

const MAILBOX_ATTENTION_TIMEOUT_MS = 5000;
const ATTENTION_SUMMARY_BUDGET_MS = 12000;
const ATTENTION_START_BUFFER_MS = 500;
const BUCKET_TOP_ITEMS_LIMIT = 5;
const SUMMARY_TOP_ITEMS_LIMIT = 12;
const MAILBOX_ATTENTION_CONCURRENCY = 6;

const BUCKETS = [
	{
		id: "act_now",
		label: "Act now",
		description: "Unread or waiting on a reply.",
	},
	{
		id: "money",
		label: "Money",
		description: "Billing, refund, invoice, payment, or pricing messages.",
	},
	{
		id: "leads",
		label: "Leads",
		description: "Sales, demo, quote, trial, or partnership messages.",
	},
	{
		id: "aging",
		label: "Aging",
		description: "Unread inbox mail older than 24 hours.",
	},
	{
		id: "drafts_ready",
		label: "Drafts ready",
		description: "Drafts waiting for operator review.",
	},
] as const;

type AttentionBucketId = (typeof BUCKETS)[number]["id"];

const ATTENTION_BUCKET_PRIORITY: Record<AttentionBucketId, number> = {
	money: 0,
	leads: 1,
	act_now: 2,
	aging: 3,
	drafts_ready: 4,
};

export interface AttentionItem {
	id: string;
	mailboxId: string;
	emailId: string;
	threadId?: string | null;
	folderId: string;
	bucket: AttentionBucketId;
	subject: string;
	sender: string;
	recipient: string;
	date: string;
	reason: string;
	confidence: "high" | "medium";
}

export interface AttentionNextAction {
	id: string;
	bucket: AttentionBucketId;
	label: string;
	description: string;
	mailboxId: string;
	folderId: string;
	emailId: string;
	threadId?: string | null;
	subject: string;
	reason: string;
}

export interface AgentDeskSummary {
	id: string;
	label: string;
	description: string;
	signalCount: number;
	mailboxIds: string[];
	nextActions: AttentionNextAction[];
}

export interface MailboxAttentionSummary {
	mailboxId: string;
	email: string;
	status: "ok" | "unavailable";
	unreadInboxCount: number | null;
	needsReplyCount: number | null;
	draftCount: number | null;
	moneyCount: number | null;
	leadCount: number | null;
	agingCount: number | null;
	oldestPendingAt?: string | null;
	lastInboundAt?: string | null;
	newestDraftAt?: string | null;
	topItems: AttentionItem[];
	topItemsLimit: number;
	topItemsSampled: boolean;
	hasMoreTopItems: boolean;
}

interface MailboxAttentionOk {
	unreadInboxCount: number;
	needsReplyCount: number;
	draftCount: number;
	moneyCount: number;
	leadCount: number;
	agingCount: number;
	oldestPendingAt?: string | null;
	lastInboundAt?: string | null;
	newestDraftAt?: string | null;
	topItems: Array<Omit<AttentionItem, "mailboxId">>;
	topItemsLimit?: number;
	topItemsSampled?: boolean;
	hasMoreTopItems?: boolean;
}

type MailboxAttentionStub = {
	getAttentionSummary: () => Promise<MailboxAttentionOk>;
};

function mailboxBucketCount(
	mailbox: MailboxAttentionSummary,
	bucketId: AttentionBucketId,
) {
	if (mailbox.status !== "ok") return 0;
	switch (bucketId) {
		case "act_now":
			return (mailbox.unreadInboxCount ?? 0) + (mailbox.needsReplyCount ?? 0);
		case "money":
			return mailbox.moneyCount ?? 0;
		case "leads":
			return mailbox.leadCount ?? 0;
		case "aging":
			return mailbox.agingCount ?? 0;
		case "drafts_ready":
			return mailbox.draftCount ?? 0;
	}
}

function sortItemsByDateDesc(a: AttentionItem, b: AttentionItem) {
	return new Date(b.date).getTime() - new Date(a.date).getTime();
}

function sortItemsByAttentionPriority(a: AttentionItem, b: AttentionItem) {
	const priorityDelta =
		ATTENTION_BUCKET_PRIORITY[a.bucket] - ATTENTION_BUCKET_PRIORITY[b.bucket];
	return priorityDelta || sortItemsByDateDesc(a, b);
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	onTimeout: () => void,
): Promise<T | null> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<null>((resolve) => {
		timeoutId = setTimeout(() => {
			onTimeout();
			resolve(null);
		}, timeoutMs);
	});

	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timeoutId !== undefined) clearTimeout(timeoutId);
	}
}

async function getMailboxAttention(
	env: Env,
	mailboxId: string,
	timeoutMs: number = MAILBOX_ATTENTION_TIMEOUT_MS,
): Promise<MailboxAttentionSummary> {
	try {
		const stub = env.MAILBOX.get(
			env.MAILBOX.idFromName(mailboxId),
		) as unknown as MailboxAttentionStub;
		const summary = await withTimeout(
			stub.getAttentionSummary(),
			timeoutMs,
			() => console.warn(`Timed out loading attention summary for ${mailboxId}`),
		);

		if (!summary) {
			return unavailableMailbox(mailboxId);
		}

		return {
			...summary,
			mailboxId,
			email: mailboxId,
			status: "ok",
			topItems: summary.topItems.map((item) => ({ ...item, mailboxId })),
			topItemsLimit: summary.topItemsLimit ?? summary.topItems.length,
			topItemsSampled: summary.topItemsSampled ?? true,
			hasMoreTopItems: summary.hasMoreTopItems ?? false,
		};
	} catch (error) {
		console.error(`Failed to load attention summary for ${mailboxId}`, error);
		return unavailableMailbox(mailboxId);
	}
}

function unavailableMailbox(mailboxId: string): MailboxAttentionSummary {
	return {
		mailboxId,
		email: mailboxId,
		status: "unavailable",
		unreadInboxCount: null,
		needsReplyCount: null,
		draftCount: null,
		moneyCount: null,
		leadCount: null,
		agingCount: null,
		topItems: [],
		topItemsLimit: 0,
		topItemsSampled: true,
		hasMoreTopItems: false,
	};
}

function emptyMailbox(mailboxId: string): MailboxAttentionSummary {
	return {
		mailboxId,
		email: mailboxId,
		status: "ok",
		unreadInboxCount: 0,
		needsReplyCount: 0,
		draftCount: 0,
		moneyCount: 0,
		leadCount: 0,
		agingCount: 0,
		oldestPendingAt: null,
		lastInboundAt: null,
		newestDraftAt: null,
		topItems: [],
		topItemsLimit: 0,
		topItemsSampled: true,
		hasMoreTopItems: false,
	};
}

function getConfiguredMailboxIds(env: Env, storedMailboxIds: string[]) {
	const configured = Array.isArray(env.EMAIL_ADDRESSES)
		? env.EMAIL_ADDRESSES
		: [];
	return [
		...new Set(
			[...configured, ...storedMailboxIds]
				.map((email) => email.toLowerCase().trim())
				.filter(Boolean),
		),
	].sort((a, b) => a.localeCompare(b));
}

export async function buildAttentionSummary(env: Env) {
	const warnings: string[] = [];
	const deadlineMs = Date.now() + ATTENTION_SUMMARY_BUDGET_MS;
	let skippedMailboxCount = 0;
	let mailboxDirectoryStatus: "ok" | "unavailable" = "ok";
	let storedMailboxes: Awaited<ReturnType<typeof listMailboxes>> = [];

	try {
		const remainingMs = deadlineMs - Date.now() - ATTENTION_START_BUFFER_MS;
		if (remainingMs <= 0) {
			throw new Error("Mailbox directory check skipped because the attention summary reached its time budget");
		}
		const listedMailboxes = await withTimeout(
			listMailboxes(env.BUCKET),
			remainingMs,
			() => console.warn("Timed out loading mailbox directory for attention summary"),
		);
		if (!listedMailboxes) {
			throw new Error("Timed out loading mailbox directory for attention summary");
		}
		storedMailboxes = listedMailboxes;
	} catch (error) {
		mailboxDirectoryStatus = "unavailable";
		warnings.push("Mailbox directory unavailable; configured mailboxes were checked where possible.");
		console.error("Failed to load mailbox directory for attention summary", error);
	}

	const storedMailboxIds = new Set(
		storedMailboxes.map((mailbox) => mailbox.email.toLowerCase()),
	);
	const mailboxIds = getConfiguredMailboxIds(
		env,
		storedMailboxes.map((mailbox) => mailbox.email),
	);
	const mailboxes = await mapWithConcurrency(
		mailboxIds,
		MAILBOX_ATTENTION_CONCURRENCY,
		async (mailboxId) => {
			if (mailboxDirectoryStatus === "ok" && !storedMailboxIds.has(mailboxId)) {
				return emptyMailbox(mailboxId);
			}

			const remainingMs = deadlineMs - Date.now() - ATTENTION_START_BUFFER_MS;
			if (remainingMs <= 0) {
				skippedMailboxCount += 1;
				return unavailableMailbox(mailboxId);
			}

			return getMailboxAttention(
				env,
				mailboxId,
				Math.min(MAILBOX_ATTENTION_TIMEOUT_MS, remainingMs),
			);
		},
		);

	if (skippedMailboxCount > 0) {
		warnings.push(`${skippedMailboxCount} mailbox checks skipped because the attention summary reached its time budget.`);
	}

	const buckets = BUCKETS.map((bucket) => {
		const mailboxCounts = mailboxes.map((mailbox) =>
			mailboxBucketCount(mailbox, bucket.id),
		);
		const count = mailboxCounts.reduce((sum, count) => sum + count, 0);
		const allTopItems = mailboxes
			.flatMap((mailbox) =>
				mailbox.topItems.filter((item) => item.bucket === bucket.id),
			)
			.sort(sortItemsByDateDesc);
		const topItems = allTopItems.slice(0, BUCKET_TOP_ITEMS_LIMIT);

		return {
			...bucket,
			count,
			mailboxCount: mailboxCounts.filter((count) => count > 0).length,
			topItems,
			topItemsLimit: BUCKET_TOP_ITEMS_LIMIT,
			topItemsSampled: true,
			hasMoreTopItems: count > topItems.length,
		};
	});

	const allTopItems = mailboxes
		.flatMap((mailbox) => mailbox.topItems)
		.sort(sortItemsByAttentionPriority);
	const topItems = allTopItems.slice(0, SUMMARY_TOP_ITEMS_LIMIT);
	const nextActions = buildAttentionNextActions(
		allTopItems,
	) as AttentionNextAction[];
	const agentDesks = buildAgentDeskSummaries(
		allTopItems,
	) as AgentDeskSummary[];
	const hasMoreTopItems =
		allTopItems.length > topItems.length ||
		mailboxes.some((mailbox) => mailbox.hasMoreTopItems);

	return {
		generatedAt: new Date().toISOString(),
		triageVersion: "heuristic-v2",
		mailboxCount: mailboxes.length,
		mailboxDirectoryStatus,
		unavailableMailboxCount: mailboxes.filter(
			(mailbox) => mailbox.status === "unavailable",
		).length,
		attentionSignalCount: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
		buckets,
		mailboxes,
		topItems,
		nextActions,
		agentDesks,
		topItemsLimit: SUMMARY_TOP_ITEMS_LIMIT,
		topItemsSampled: true,
		hasMoreTopItems,
		warnings,
	};
}
