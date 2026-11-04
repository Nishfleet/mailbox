// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Env } from "../types";
import { sendEmail } from "../email-sender";
import { buildAttentionSummary } from "./attention";
import {
	buildAttentionNotificationEmail,
	shouldSendAttentionNotification,
} from "./attention-notification-core.js";

const STATE_KEY = "ops/attention-notification-state.json";
const DEFAULT_FROM_EMAIL = "alerts@0509.io";
const PUSHOVER_MESSAGES_URL = "https://api.pushover.net/1/messages.json";

interface AttentionNotificationState {
	lastSentAt?: string;
	lastFingerprint?: string;
	lastSignalCount?: number;
	lastActionCount?: number;
	lastCron?: string;
	lastDeliveryMethod?: "api" | "email";
	lastPushoverRequest?: string;
	lastEmailMessageId?: string;
}

interface AttentionNotificationOptions {
	now?: Date;
	cron?: string;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 1) return fallback;
	return Math.floor(parsed);
}

async function readNotificationState(env: Env): Promise<AttentionNotificationState> {
	try {
		const object = await env.BUCKET.get(STATE_KEY);
		if (!object) return {};
		return await object.json<AttentionNotificationState>();
	} catch (error) {
		console.warn("Failed to read attention notification state", error);
		return {};
	}
}

async function writeNotificationState(
	env: Env,
	state: AttentionNotificationState,
) {
	await env.BUCKET.put(STATE_KEY, JSON.stringify(state), {
		httpMetadata: { contentType: "application/json" },
	});
}

async function sendPushoverNotification(
	env: Env,
	notification: {
		title: string;
		message: string;
		url: string;
		urlTitle: string;
		priority: number;
	},
) {
	const body = new URLSearchParams({
		token: env.PUSHOVER_APP_TOKEN || "",
		user: env.PUSHOVER_USER_KEY || "",
		title: notification.title,
		message: notification.message,
		url: notification.url,
		url_title: notification.urlTitle,
		priority: String(notification.priority),
	});

	const response = await fetch(PUSHOVER_MESSAGES_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body,
	});
	const responseBody = await response.text();

	if (!response.ok) {
		throw new Error(
			`Pushover rejected attention notification (${response.status}): ${responseBody}`,
		);
	}

	try {
		return JSON.parse(responseBody) as { request?: string };
	} catch {
		return {};
	}
}

async function sendPushoverEmailNotification(
	env: Env,
	notification: {
		title: string;
		message: string;
		url: string;
		urlTitle: string;
	},
) {
	if (!env.PUSHOVER_EMAIL_ALIAS) {
		throw new Error("PUSHOVER_EMAIL_ALIAS is not configured");
	}

	const email = buildAttentionNotificationEmail(notification);
	return sendEmail(env.EMAIL, {
		to: env.PUSHOVER_EMAIL_ALIAS,
		from: {
			email: env.ATTENTION_NOTIFY_FROM_EMAIL || DEFAULT_FROM_EMAIL,
			name: "0509 Attention Desk",
		},
		subject: email.subject,
		text: email.text,
	});
}

function getDeliveryMethod(env: Env): "api" | "email" | null {
	if (env.PUSHOVER_APP_TOKEN && env.PUSHOVER_USER_KEY) return "api";
	if (env.PUSHOVER_EMAIL_ALIAS) return "email";
	return null;
}

export async function runAttentionNotificationCheck(
	env: Env,
	options: AttentionNotificationOptions = {},
) {
	const deliveryMethod = getDeliveryMethod(env);
	if (!deliveryMethod) {
		return {
			status: "disabled" as const,
			reason: "missing-pushover-destination",
		};
	}

	const now = options.now ?? new Date();
	const [summary, state] = await Promise.all([
		buildAttentionSummary(env),
		readNotificationState(env),
	]);
	const decision = shouldSendAttentionNotification(summary, state, {
		now,
		baseUrl: env.ATTENTION_NOTIFY_BASE_URL,
		minSignals: parsePositiveInteger(env.ATTENTION_NOTIFY_MIN_SIGNALS, 1),
		cooldownMinutes: parsePositiveInteger(
			env.ATTENTION_NOTIFY_COOLDOWN_MINUTES,
			60,
		),
		maxActions: parsePositiveInteger(env.ATTENTION_NOTIFY_MAX_ACTIONS, 3),
	});

	if (!decision.shouldSend || !decision.notification) {
		return {
			status: "skipped" as const,
			reason: decision.reason,
			signalCount: decision.signalCount,
		};
	}

	const delivery =
		deliveryMethod === "api"
			? await sendPushoverNotification(env, decision.notification)
			: await sendPushoverEmailNotification(env, decision.notification);
	await writeNotificationState(env, {
		lastSentAt: now.toISOString(),
		lastFingerprint: decision.notification.fingerprint,
		lastSignalCount: decision.notification.signalCount,
		lastActionCount: decision.notification.actionCount,
		lastCron: options.cron,
		lastDeliveryMethod: deliveryMethod,
		lastPushoverRequest: "request" in delivery ? delivery.request : undefined,
		lastEmailMessageId: "messageId" in delivery ? delivery.messageId : undefined,
	});

	return {
		status: "sent" as const,
		reason: decision.reason,
		deliveryMethod,
		signalCount: decision.notification.signalCount,
		actionCount: decision.notification.actionCount,
	};
}
