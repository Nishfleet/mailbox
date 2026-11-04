// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export const CLOUDFLARE_SPAM_SCORE_HEADER = "x-cf-spamh-score";
export const HIGH_CONFIDENCE_SPAM_SCORE = 5;

type HeaderEntry = { key?: string; value?: string } | null | undefined;
type HeaderSource = Pick<Headers, "get"> | Iterable<HeaderEntry> | null | undefined;

function headerValue(headers: HeaderSource, name: string): string | null {
	if (!headers) return null;
	if ("get" in headers) return headers.get(name);

	const target = name.toLowerCase();
	for (const header of headers) {
		const key = String(header?.key || "").trim().toLowerCase();
		if (key === target) return String(header?.value || "").trim();
	}
	return null;
}

export function parseCloudflareSpamScore(headers: HeaderSource): number | null {
	const raw = headerValue(headers, CLOUDFLARE_SPAM_SCORE_HEADER);
	if (raw === null || raw === "") return null;
	const score = Number.parseFloat(String(raw).trim());
	return Number.isFinite(score) ? score : null;
}

export function isHighConfidenceSpam(
	headers: HeaderSource,
	threshold = HIGH_CONFIDENCE_SPAM_SCORE,
) {
	const score = parseCloudflareSpamScore(headers);
	return score !== null && score >= threshold;
}
