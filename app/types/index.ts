// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { EmailAttachment, EmailDetail, EmailSummary, ThreadSummary } from "../../shared/email";

export interface SignatureSettings {
	enabled: boolean;
	text: string;
	html?: string;
}

export interface MailboxSettings {
	fromName?: string;
	forwarding?: { enabled: boolean; email: string; spam?: boolean; internal?: boolean };
	signature?: SignatureSettings;
	autoReply?: { enabled: boolean; subject: string; message: string };
	agentSystemPrompt?: string;
}

export interface Mailbox {
	id: string;
	email: string;
	name: string;
	unreadInboxCount?: number | null;
	settings?: MailboxSettings;
}

export type AttentionBucketId =
	| "act_now"
	| "money"
	| "leads"
	| "aging"
	| "drafts_ready";

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

export interface AttentionBucket {
	id: AttentionBucketId;
	label: string;
	description: string;
	count: number;
	mailboxCount: number;
	topItems: AttentionItem[];
	topItemsLimit: number;
	topItemsSampled: boolean;
	hasMoreTopItems: boolean;
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

export interface AttentionSummary {
	generatedAt: string;
	triageVersion: string;
	mailboxCount: number;
	mailboxDirectoryStatus: "ok" | "unavailable";
	unavailableMailboxCount: number;
	attentionSignalCount: number;
	buckets: AttentionBucket[];
	mailboxes: MailboxAttentionSummary[];
	topItems: AttentionItem[];
	nextActions: AttentionNextAction[];
	agentDesks: AgentDeskSummary[];
	topItemsLimit: number;
	topItemsSampled: boolean;
	hasMoreTopItems: boolean;
	warnings: string[];
}

export type Attachment = EmailAttachment;

export type Email = Pick<EmailSummary, "id" | "subject" | "sender" | "recipient" | "date" | "read" | "starred">
	& Partial<Omit<EmailDetail, "attachments"> & Omit<ThreadSummary, "read" | "starred">>
	& { attachments?: EmailAttachment[] };

export interface Folder {
	id: string;
	name: string;
	unreadCount: number;
}
