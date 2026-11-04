// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { AttentionNextAction } from "./attention";

type NotificationAction = Pick<
	AttentionNextAction,
	"id" | "bucket" | "label" | "mailboxId" | "emailId" | "threadId" | "latestAt" | "subject"
>;

interface NotificationSummary {
	triageVersion?: string;
	attentionSignalCount?: number;
	nextActions?: NotificationAction[];
	notificationActions?: NotificationAction[];
}

interface NotificationOptions {
	maxActions?: number;
	baseUrl?: string;
	notifyBuckets?: Set<string>;
	minSignals?: number;
	cooldownMinutes?: number;
	now?: Date;
}

interface NotificationState {
	lastSentAt?: string;
	lastFingerprint?: string;
}

interface AttentionNotification {
	title: string;
	message: string;
	url: string;
	urlTitle: string;
}

const DEFAULT_MAX_ACTIONS = 3;
const DEFAULT_MIN_SIGNALS = 1;
const DEFAULT_COOLDOWN_MINUTES = 60;
const DEFAULT_BASE_URL = "https://0509-support-inbox.nishant345.workers.dev";
const DEFAULT_NOTIFY_BUCKETS = new Set(["money", "leads", "act_now"]);
const MAX_MESSAGE_LENGTH = 900;

function positiveInteger(value: unknown, fallback: number) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 1) return fallback;
	return Math.floor(parsed);
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
	return `${count} ${count === 1 ? singular : plural}`;
}

function normalizeText(value: unknown) {
	return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value: unknown, maxLength: number) {
	const text = normalizeText(value);
	if (text.length <= maxLength) return text;
	return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function normalizeBaseUrl(value: unknown) {
	const raw = normalizeText(value) || DEFAULT_BASE_URL;
	try {
		const url = new URL(raw);
		url.pathname = url.pathname.replace(/\/+$/, "");
		url.search = "";
		url.hash = "";
		return url.toString().replace(/\/$/, "");
	} catch {
		return DEFAULT_BASE_URL;
	}
}

function hashString(value: string) {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i += 1) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function actionFingerprint(action: NotificationAction) {
	return [
		action.id,
		action.bucket,
		action.mailboxId,
		action.threadId || action.emailId,
		action.latestAt,
		action.subject,
	]
		.map(normalizeText)
		.join(":");
}

function notificationFingerprint(summary: NotificationSummary, actions: NotificationAction[]) {
	return hashString(
		[
			summary.triageVersion,
			...actions.map(actionFingerprint),
		].join("|"),
	);
}

function actionLine(action: NotificationAction) {
	const label = normalizeText(action.label) || "Review";
	const mailbox = normalizeText(action.mailboxId);
	const subject = truncate(action.subject || "(no subject)", 88);
	return mailbox ? `${label}: ${mailbox} - ${subject}` : `${label}: ${subject}`;
}

function notificationActions(
	summary: NotificationSummary,
	maxActions: number,
	options: NotificationOptions,
) {
	const buckets = options.notifyBuckets instanceof Set
		? options.notifyBuckets
		: DEFAULT_NOTIFY_BUCKETS;
	const candidates = Array.isArray(summary?.notificationActions)
		? summary.notificationActions
		: Array.isArray(summary?.nextActions)
			? summary.nextActions
			: [];
	return candidates.length
		? candidates
			.filter((action) => buckets.has(String(action.bucket || "")))
			.slice(0, maxActions)
		: [];
}

export function buildAttentionNotification(
	summary: NotificationSummary,
	options: NotificationOptions = {},
) {
	const maxActions = positiveInteger(options.maxActions, DEFAULT_MAX_ACTIONS);
	const baseUrl = normalizeBaseUrl(options.baseUrl);
	const actions = notificationActions(summary, maxActions, options);
	if (actions.length === 0) return null;
	const signalCount = actions.length;
	const title = `Attention Desk: ${pluralize(signalCount, "priority signal")}`;
	const lines = actions.map(actionLine);
	const message = truncate(lines.join("\n"), MAX_MESSAGE_LENGTH);

	return {
		title,
		message,
		url: `${baseUrl}/?attention=1`,
		urlTitle: "Open Attention Desk",
		priority: 0,
		fingerprint: notificationFingerprint(summary, actions),
		signalCount,
		actionCount: actions.length,
	};
}

export function buildAttentionNotificationEmail(notification: AttentionNotification) {
	return {
		subject: notification.title,
		text: [
			notification.message,
			"",
			`${notification.urlTitle}: ${notification.url}`,
		].join("\n"),
	};
}

export function shouldSendAttentionNotification(
	summary: NotificationSummary,
	state: NotificationState = {},
	options: NotificationOptions = {},
) {
	const minSignals = positiveInteger(options.minSignals, DEFAULT_MIN_SIGNALS);
	const cooldownMinutes = positiveInteger(
		options.cooldownMinutes,
		DEFAULT_COOLDOWN_MINUTES,
	);
	const now =
		options.now instanceof Date
			? options.now
			: new Date(options.now || Date.now());
	const signalCount = positiveInteger(summary?.attentionSignalCount, 0);

	if (signalCount < minSignals) {
		return { shouldSend: false, reason: "below-threshold", signalCount };
	}

	const notification = buildAttentionNotification(summary, options);
	if (!notification) {
		return { shouldSend: false, reason: "empty", signalCount };
	}

	const lastSentAt = Date.parse(state?.lastSentAt || "");
	const isSameFingerprint = state?.lastFingerprint === notification.fingerprint;
	const cooldownMs = cooldownMinutes * 60 * 1000;
	const isInsideCooldown =
		Number.isFinite(lastSentAt) && now.getTime() - lastSentAt < cooldownMs;

	if (isSameFingerprint) {
		return {
			shouldSend: false,
			reason: isInsideCooldown ? "unchanged-cooldown" : "unchanged",
			notification,
			signalCount,
		};
	}

	return {
		shouldSend: true,
		reason: "changed",
		notification,
		signalCount,
	};
}
