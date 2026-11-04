export interface EmailAttachment {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id: string | null;
	disposition: string | null;
}

export interface EmailSummary {
	id: string;
	subject: string;
	sender: string;
	recipient: string;
	cc: string | null;
	bcc: string | null;
	date: string;
	read: boolean;
	starred: boolean;
	in_reply_to: string | null;
	email_references: string | null;
	thread_id: string | null;
	folder_id: string;
	snippet: string | null;
}

export interface ThreadSummary extends Omit<EmailSummary, "cc" | "bcc"> {
	thread_count: number;
	thread_unread_count: number;
	participants: string | null;
	needs_reply?: boolean;
	has_draft?: boolean;
}

export interface SearchResult extends EmailSummary {
	folder_name: string | null;
}

export interface EmailDetail extends Omit<EmailSummary, "snippet"> {
	body: string | null;
	message_id: string | null;
	raw_headers: string | null;
	internal_owned: number | null;
	attachments: EmailAttachment[];
}
