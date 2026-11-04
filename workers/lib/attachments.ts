// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared attachment storage logic.
 * Eliminates the triplicated atob → Uint8Array → R2.put pattern.
 */
import type { Env } from "../types";

export interface StoredAttachment {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id: string | null;
	disposition: string;
}

const UNSAFE_KEY_CHARS = /[/\\:*?"<>|\x00-\x1f]/g;

export function safeFilename(filename: string | null | undefined): string {
	return (filename || "untitled").replace(UNSAFE_KEY_CHARS, "_");
}

export function attachmentKey(attachment: Pick<StoredAttachment, "email_id" | "id" | "filename">): string {
	return `attachments/${attachment.email_id}/${attachment.id}/${attachment.filename}`;
}

export function contentDisposition(filename: string): string {
	const quoted = filename.replace(/[\x00-\x1f"\\]/g, "_");
	return `attachment; filename="${quoted}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function storeAttachments(
	bucket: Env["BUCKET"],
	emailId: string,
	attachments?: {
		content: string;
		filename: string;
		type: string;
		disposition: string;
		contentId?: string;
	}[],
): Promise<StoredAttachment[]> {
	if (!attachments?.length) return [];

	const results: StoredAttachment[] = [];
	for (const att of attachments) {
		const attachmentId = crypto.randomUUID();
		const filename = safeFilename(att.filename);
		const key = attachmentKey({ email_id: emailId, id: attachmentId, filename });
		const binaryStr = atob(att.content);
		const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
		await bucket.put(key, bytes);
		results.push({
			id: attachmentId,
			email_id: emailId,
			filename,
			mimetype: att.type,
			size: bytes.byteLength,
			content_id: att.contentId || null,
			disposition: att.disposition,
		});
	}
	return results;
}
