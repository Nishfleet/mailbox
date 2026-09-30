// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Env } from "../types";
import { getMailboxStub, listMailboxes } from "./email-helpers";

export const RETENTION_DAYS = 90;
export const RETENTION_BATCH_SIZE = 50;
export const RETENTION_MAX_EMAILS_PER_RUN = 200;
const R2_DELETE_KEY_LIMIT = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface SqlRows {
	[Symbol.iterator](): Iterator<Record<string, unknown>>;
}

export interface RetentionSql {
	exec(query: string, ...bindings: unknown[]): SqlRows;
}

export interface ExpiredEmail {
	id: string;
	attachmentKeys: string[];
}

export function retentionCutoff(now: Date): string {
	return new Date(now.getTime() - RETENTION_DAYS * DAY_MS).toISOString();
}

export function selectExpiredEmails(
	sql: RetentionSql,
	cutoff: string,
	limit: number,
): ExpiredEmail[] {
	const rows = [
		...sql.exec(
			`SELECT id FROM emails
			 WHERE julianday(date) < julianday(?1)
			 ORDER BY date ASC, id ASC
			 LIMIT ?2`,
			cutoff,
			Math.min(Math.max(Math.floor(limit), 0), RETENTION_BATCH_SIZE),
		),
	] as { id: string }[];
	if (rows.length === 0) return [];

	const placeholders = rows.map((_, i) => `?${i + 1}`).join(", ");
	const attachments = [
		...sql.exec(
			`SELECT id, email_id, filename FROM attachments WHERE email_id IN (${placeholders})`,
			...rows.map((row) => row.id),
		),
	] as { id: string; email_id: string; filename: string }[];

	return rows.map((row) => ({
		id: row.id,
		attachmentKeys: attachments
			.filter((att) => att.email_id === row.id)
			.map((att) => `attachments/${row.id}/${att.id}/${att.filename}`),
	}));
}

export function deleteExpiredEmails(
	sql: RetentionSql,
	ids: string[],
	cutoff: string,
): number {
	if (ids.length === 0) return 0;
	const placeholders = ids.map((_, i) => `?${i + 2}`).join(", ");
	const deleted = [
		...sql.exec(
			`DELETE FROM emails
			 WHERE id IN (${placeholders}) AND julianday(date) < julianday(?1)
			 RETURNING id`,
			cutoff,
			...ids,
		),
	];
	sql.exec(
		`DELETE FROM attachments
		 WHERE email_id IN (${ids.map((_, i) => `?${i + 1}`).join(", ")})
		   AND email_id NOT IN (SELECT id FROM emails)`,
		...ids,
	);
	return deleted.length;
}

export interface RetentionResult {
	cutoff: string;
	mailboxes: number;
	deletedEmails: number;
	deletedAttachments: number;
	failedMailboxes: number;
	capReached: boolean;
}

export async function runRetentionPurge(
	env: Env,
	options: { now?: Date } = {},
): Promise<RetentionResult> {
	const cutoff = retentionCutoff(options.now ?? new Date());
	const mailboxes = await listMailboxes(env.BUCKET);
	const result: RetentionResult = {
		cutoff,
		mailboxes: mailboxes.length,
		deletedEmails: 0,
		deletedAttachments: 0,
		failedMailboxes: 0,
		capReached: false,
	};

	for (const mailbox of mailboxes) {
		if (result.deletedEmails >= RETENTION_MAX_EMAILS_PER_RUN) {
			result.capReached = true;
			break;
		}
		const stub = getMailboxStub(env, mailbox.id);
		try {
			while (result.deletedEmails < RETENTION_MAX_EMAILS_PER_RUN) {
				const budget = RETENTION_MAX_EMAILS_PER_RUN - result.deletedEmails;
				const batch = await stub.listExpiredEmails(
					cutoff,
					Math.min(budget, RETENTION_BATCH_SIZE),
				);
				if (batch.length === 0) break;

				const keys = batch.flatMap((email) => email.attachmentKeys);
				for (let i = 0; i < keys.length; i += R2_DELETE_KEY_LIMIT) {
					await env.BUCKET.delete(keys.slice(i, i + R2_DELETE_KEY_LIMIT));
				}
				const deleted = await stub.deleteExpiredEmails(
					batch.map((email) => email.id),
					cutoff,
				);
				result.deletedEmails += deleted;
				result.deletedAttachments += keys.length;
				if (deleted === 0) break;
			}
		} catch (error) {
			result.failedMailboxes += 1;
			console.error("Retention purge failed for a mailbox", error);
		}
	}
	if (result.deletedEmails >= RETENTION_MAX_EMAILS_PER_RUN) result.capReached = true;
	return result;
}
