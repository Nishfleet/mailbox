// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

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

export interface Email {
	id: string;
	thread_id?: string | null;
	folder_id?: string | null;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string;
	bcc?: string;
	date: string;
	read: boolean;
	starred: boolean;
	body?: string | null;
	in_reply_to?: string | null;
	email_references?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	attachments?: Attachment[];
	snippet?: string | null;
	// Thread aggregate fields (only present in threaded list view)
	thread_count?: number;
	thread_unread_count?: number;
	participants?: string;
	needs_reply?: boolean;
	has_draft?: boolean;
}

export interface Attachment {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string;
	disposition?: string;
}

export interface Folder {
	id: string;
	name: string;
	unreadCount: number;
}
