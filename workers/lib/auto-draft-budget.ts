// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Daily cap on automatic AI reply drafts.
 *
 * Every inbound email triggers a large-model draft, so a burst of mail (for
 * example spam on a catch-all address) would otherwise run up Workers AI cost
 * with no limit. The count lives in the mailbox's EmailAgent Durable Object
 * storage, so the cap applies per mailbox per UTC day. Once it is reached,
 * auto-drafting stops until the next UTC day; mail is still stored as usual.
 *
 * Configure with the AUTO_DRAFT_DAILY_LIMIT var. "0" turns auto-drafting off.
 */

export const DEFAULT_AUTO_DRAFT_DAILY_LIMIT = 200;
export const AUTO_DRAFT_BUDGET_KEY = "autoDraftBudget";

/** The subset of DurableObjectStorage this module needs. */
export type BudgetStorage = {
	get(key: string): Promise<unknown>;
	put(key: string, value: unknown): Promise<void>;
};

type StoredBudget = { day: string; count: number };

export type AutoDraftSlot = {
	allowed: boolean;
	/** Drafts started today, including this one when allowed. */
	used: number;
	limit: number;
	day: string;
};

/** Parse the configured limit; unset or invalid values fall back to the default. */
export function parseAutoDraftDailyLimit(raw: unknown): number {
	if (raw === undefined || raw === null || String(raw).trim() === "") {
		return DEFAULT_AUTO_DRAFT_DAILY_LIMIT;
	}
	const n = Number(String(raw).trim());
	if (!Number.isInteger(n) || n < 0) return DEFAULT_AUTO_DRAFT_DAILY_LIMIT;
	return n;
}

function utcDay(now: Date): string {
	return now.toISOString().slice(0, 10);
}

/**
 * Reserve one auto-draft for today. Returns allowed=false (and changes
 * nothing) once today's count has reached the limit.
 */
export async function takeAutoDraftSlot(
	storage: BudgetStorage,
	limit: number,
	now: Date = new Date(),
): Promise<AutoDraftSlot> {
	const day = utcDay(now);
	const stored = (await storage.get(AUTO_DRAFT_BUDGET_KEY)) as StoredBudget | undefined;
	const used = stored && stored.day === day && Number.isFinite(stored.count) ? stored.count : 0;
	if (used >= limit) {
		return { allowed: false, used, limit, day };
	}
	const next: StoredBudget = { day, count: used + 1 };
	await storage.put(AUTO_DRAFT_BUDGET_KEY, next);
	return { allowed: true, used: next.count, limit, day };
}
