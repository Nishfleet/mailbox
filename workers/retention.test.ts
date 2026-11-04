// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, mailboxMigrations } from "./durableObject/migrations";
import {
	deleteExpiredEmails,
	RETENTION_DAYS,
	RETENTION_MAX_EMAILS_PER_RUN,
	retentionCutoff,
	runRetentionPurge,
	selectExpiredEmails,
	type RetentionSql,
} from "./lib/retention";
import type { Env } from "./types";

interface TestDb {
	exec(query: string): void;
	prepare(query: string): {
		all(...bindings: unknown[]): unknown[];
		get(...bindings: unknown[]): unknown;
		run(...bindings: unknown[]): unknown;
	};
}

const sqliteModule = "node:sqlite";
const { DatabaseSync } = (await import(sqliteModule)) as {
	DatabaseSync: new (path: string) => TestDb;
};

const NOW = new Date("2026-09-30T04:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number, extraMs = 0): string {
	return new Date(NOW.getTime() - days * DAY_MS + extraMs).toISOString();
}

function openMailbox() {
	const db = new DatabaseSync(":memory:");
	db.exec("PRAGMA foreign_keys = ON");
	const sql = {
		exec(query: string, ...bindings: unknown[]) {
			if (bindings.length === 0) {
				db.exec(query);
				return [];
			}
			return db.prepare(query).all(...bindings) as Record<string, unknown>[];
		},
	} as RetentionSql;
	applyMigrations(sql as unknown as SqlStorage, mailboxMigrations);
	return { db, sql };
}

type Mailbox = ReturnType<typeof openMailbox>;

function addEmail(
	mailbox: Mailbox,
	id: string,
	date: string | null,
	options: { folder?: string; attachments?: string[]; thread?: string } = {},
) {
	mailbox.db
		.prepare(
			`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, body, thread_id)
			 VALUES (?, ?, 's', 'a@example.com', 'b@example.com', ?, 'body', ?)`,
		)
		.run(id, options.folder ?? "inbox", date, options.thread ?? id);
	const keys: string[] = [];
	for (const [index, filename] of (options.attachments ?? []).entries()) {
		const attachmentId = `${id}-att${index}`;
		mailbox.db
			.prepare(
				`INSERT INTO attachments (id, email_id, filename, mimetype, size) VALUES (?, ?, ?, 'text/plain', 1)`,
			)
			.run(attachmentId, id, filename);
		keys.push(`attachments/${id}/${attachmentId}/${filename}`);
	}
	return keys;
}

function ids(mailbox: Mailbox, table: "emails" | "attachments") {
	return (mailbox.db.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as { id: string }[]).map(
		(row) => row.id,
	);
}

function makeEnv(mailboxes: Record<string, Mailbox>, bucketKeys: Set<string>) {
	const stubs = Object.fromEntries(
		Object.entries(mailboxes).map(([name, mailbox]) => [
			name,
			{
				listExpiredEmails: async (cutoff: string, limit: number) =>
					selectExpiredEmails(mailbox.sql, cutoff, limit),
				deleteExpiredEmails: async (emailIds: string[], cutoff: string) =>
					deleteExpiredEmails(mailbox.sql, emailIds, cutoff),
			},
		]),
	);
	const bucket = {
		list: async () => ({
			objects: Object.keys(mailboxes).map((name) => ({ key: `mailboxes/${name}.json` })),
			truncated: false,
		}),
		delete: async (keys: string | string[]) => {
			for (const key of Array.isArray(keys) ? keys : [keys]) bucketKeys.delete(key);
		},
	};
	return {
		BUCKET: bucket,
		MAILBOX: {
			idFromName: (name: string) => name,
			get: (name: string) => stubs[name],
		},
	} as unknown as Env;
}

describe("retention purge", () => {
	let mailbox: Mailbox;
	let bucketKeys: Set<string>;

	beforeEach(() => {
		mailbox = openMailbox();
		bucketKeys = new Set();
	});

	function seedAttachments(keys: string[]) {
		for (const key of keys) bucketKeys.add(key);
	}

	it("uses a 1095 day (36 month) cutoff", () => {
		expect(RETENTION_DAYS).toBe(1095);
		expect(retentionCutoff(NOW)).toBe(daysAgo(1095));
	});

	it("deletes an old message and its R2 attachment, keeps a 1094 day old one", async () => {
		seedAttachments(addEmail(mailbox, "old", daysAgo(1096), { attachments: ["invoice.pdf"] }));
		seedAttachments(addEmail(mailbox, "young", daysAgo(1094), { attachments: ["keep.pdf"] }));
		seedAttachments(addEmail(mailbox, "edge", daysAgo(1095, 1000), { attachments: ["edge.pdf"] }));

		const result = await runRetentionPurge(makeEnv({ "a@0509.io": mailbox }, bucketKeys), {
			now: NOW,
		});

		expect(result.deletedEmails).toBe(1);
		expect(result.deletedAttachments).toBe(1);
		expect(ids(mailbox, "emails")).toEqual(["edge", "young"]);
		expect(ids(mailbox, "attachments")).toEqual(["edge-att0", "young-att0"]);
		expect([...bucketKeys].sort()).toEqual([
			"attachments/edge/edge-att0/edge.pdf",
			"attachments/young/young-att0/keep.pdf",
		]);
	});

	it("leaves no orphans across drafts, threads, folders and multiple attachments", async () => {
		seedAttachments(
			addEmail(mailbox, "old-inbox", daysAgo(1125), {
				attachments: ["a.pdf", "b.png"],
				thread: "t1",
			}),
		);
		addEmail(mailbox, "old-draft", daysAgo(1105), { folder: "draft", thread: "t1" });
		addEmail(mailbox, "old-sent", daysAgo(1100), { folder: "sent", thread: "t1" });
		addEmail(mailbox, "old-trash", daysAgo(1200), { folder: "trash" });
		addEmail(mailbox, "no-date", null);
		addEmail(mailbox, "new-in-thread", daysAgo(1), { thread: "t1" });

		await runRetentionPurge(makeEnv({ "a@0509.io": mailbox }, bucketKeys), { now: NOW });

		expect(ids(mailbox, "emails")).toEqual(["new-in-thread", "no-date"]);
		expect(ids(mailbox, "attachments")).toEqual([]);
		expect(bucketKeys.size).toBe(0);
		const dangling = mailbox.db
			.prepare(`SELECT COUNT(*) AS n FROM attachments WHERE email_id NOT IN (SELECT id FROM emails)`)
			.get() as { n: number };
		expect(dangling.n).toBe(0);
		const liveThread = mailbox.db
			.prepare(`SELECT COUNT(*) AS n FROM emails WHERE thread_id = 't1'`)
			.get() as { n: number };
		expect(liveThread.n).toBe(1);
	});

	it("does not delete when the batch guard sees a row younger than the cutoff", () => {
		addEmail(mailbox, "young", daysAgo(10));
		expect(deleteExpiredEmails(mailbox.sql, ["young"], retentionCutoff(NOW))).toBe(0);
		expect(ids(mailbox, "emails")).toEqual(["young"]);
	});

	it("caps work per run and continues on the next run", async () => {
		const total = RETENTION_MAX_EMAILS_PER_RUN + 30;
		for (let i = 0; i < total; i++) {
			seedAttachments(
				addEmail(mailbox, `old-${String(i).padStart(4, "0")}`, daysAgo(1105, i), {
					attachments: ["f.txt"],
				}),
			);
		}
		addEmail(mailbox, "young", daysAgo(5));
		const env = makeEnv({ "a@0509.io": mailbox }, bucketKeys);

		const first = await runRetentionPurge(env, { now: NOW });
		expect(first.deletedEmails).toBe(RETENTION_MAX_EMAILS_PER_RUN);
		expect(first.capReached).toBe(true);
		expect(ids(mailbox, "emails")).toHaveLength(total - RETENTION_MAX_EMAILS_PER_RUN + 1);
		expect(bucketKeys.size).toBe(total - RETENTION_MAX_EMAILS_PER_RUN);
		expect(ids(mailbox, "attachments")).toHaveLength(bucketKeys.size);

		const second = await runRetentionPurge(env, { now: new Date(NOW.getTime() + 15 * 60 * 1000) });
		expect(second.deletedEmails).toBe(30);
		expect(second.capReached).toBe(false);
		expect(ids(mailbox, "emails")).toEqual(["young"]);
		expect(bucketKeys.size).toBe(0);
		expect(ids(mailbox, "attachments")).toEqual([]);
	});

	it("shares the per-run cap across mailboxes", async () => {
		const other = openMailbox();
		for (let i = 0; i < RETENTION_MAX_EMAILS_PER_RUN; i++) addEmail(mailbox, `a${i}`, daysAgo(1105));
		addEmail(other, "b0", daysAgo(1105));
		const env = makeEnv({ "a@0509.io": mailbox, "b@0509.io": other }, bucketKeys);

		const first = await runRetentionPurge(env, { now: NOW });
		expect(first.deletedEmails).toBe(RETENTION_MAX_EMAILS_PER_RUN);
		expect(ids(other, "emails")).toEqual(["b0"]);

		await runRetentionPurge(env, { now: NOW });
		expect(ids(other, "emails")).toEqual([]);
	});

	it("keeps rows when the R2 delete fails so the next run retries", async () => {
		seedAttachments(addEmail(mailbox, "old", daysAgo(1105), { attachments: ["x.pdf"] }));
		const env = makeEnv({ "a@0509.io": mailbox }, bucketKeys);
		const realDelete = env.BUCKET.delete.bind(env.BUCKET);
		let fail = true;
		(env.BUCKET as unknown as { delete: unknown }).delete = async (keys: string[]) => {
			if (fail) throw new Error("r2 down");
			return realDelete(keys);
		};

		const failed = await runRetentionPurge(env, { now: NOW });
		expect(failed.failedMailboxes).toBe(1);
		expect(ids(mailbox, "emails")).toEqual(["old"]);
		expect(bucketKeys.size).toBe(1);

		fail = false;
		await runRetentionPurge(env, { now: NOW });
		expect(ids(mailbox, "emails")).toEqual([]);
		expect(bucketKeys.size).toBe(0);
	});
});
