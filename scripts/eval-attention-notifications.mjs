// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	buildAttentionNotificationEmail,
	buildAttentionNotification,
	shouldSendAttentionNotification,
} from "../workers/lib/attention-notification-core.js";
import { buildAttentionNextActions } from "../workers/lib/attention-workflow.js";

const trace = JSON.parse(
	readFileSync(new URL("../docs/evals/attention-workflow-trace.json", import.meta.url), "utf8"),
);
const now = new Date("2026-07-02T04:00:00.000Z");
const summary = {
	generatedAt: now.toISOString(),
	triageVersion: trace.triageVersion,
	mailboxCount: 3,
	unavailableMailboxCount: 0,
	attentionSignalCount: trace.input.length,
	nextActions: buildAttentionNextActions(trace.input),
};

const notification = buildAttentionNotification(summary, {
	baseUrl: "https://inbox.example.com/mail/",
	maxActions: 3,
});

assert.equal(notification.title, "Attention Desk: 5 signals");
assert.equal(notification.url, "https://inbox.example.com/mail/?attention=1");
assert.equal(notification.urlTitle, "Open Attention Desk");
assert.equal(notification.actionCount, 3);
assert.match(notification.message, /Review draft: billing@0509\.io - Re: Upgrade request/);
assert.match(notification.message, /Handle money: billing@0509\.io - Invoice failed/);
assert.match(notification.message, /Work lead: hello@siterep\.net - Demo request/);
assert.equal(notification.message.includes("Old support follow-up"), false);

const email = buildAttentionNotificationEmail(notification);
assert.equal(email.subject, "Attention Desk: 5 signals");
assert.match(email.text, /Open Attention Desk: https:\/\/inbox\.example\.com\/mail\/\?attention=1/);

const firstDecision = shouldSendAttentionNotification(summary, {}, {
	now,
	minSignals: 1,
	cooldownMinutes: 60,
	maxActions: 3,
});
assert.equal(firstDecision.shouldSend, true);
assert.equal(firstDecision.reason, "changed");

const repeatedDecision = shouldSendAttentionNotification(summary, {
	lastSentAt: now.toISOString(),
	lastFingerprint: notification.fingerprint,
}, {
	now: new Date("2026-07-02T04:30:00.000Z"),
	minSignals: 1,
	cooldownMinutes: 60,
	maxActions: 3,
});
assert.equal(repeatedDecision.shouldSend, false);
assert.equal(repeatedDecision.reason, "unchanged-cooldown");

const expiredDecision = shouldSendAttentionNotification(summary, {
	lastSentAt: now.toISOString(),
	lastFingerprint: notification.fingerprint,
}, {
	now: new Date("2026-07-02T05:05:00.000Z"),
	minSignals: 1,
	cooldownMinutes: 60,
	maxActions: 3,
});
assert.equal(expiredDecision.shouldSend, false);
assert.equal(expiredDecision.reason, "unchanged");

const changedDecision = shouldSendAttentionNotification({
	...summary,
	attentionSignalCount: summary.attentionSignalCount + 1,
}, {
	lastSentAt: now.toISOString(),
	lastFingerprint: notification.fingerprint,
}, {
	now: new Date("2026-07-02T05:05:00.000Z"),
	minSignals: 1,
	cooldownMinutes: 60,
	maxActions: 3,
});
assert.equal(changedDecision.shouldSend, true);
assert.equal(changedDecision.reason, "changed");

const fresherDecision = shouldSendAttentionNotification({
	...summary,
	nextActions: summary.nextActions.map((action, index) =>
		index === 0 ? { ...action, latestAt: "2026-07-02T05:04:00.000Z" } : action,
	),
}, {
	lastSentAt: now.toISOString(),
	lastFingerprint: notification.fingerprint,
}, {
	now: new Date("2026-07-02T05:05:00.000Z"),
	minSignals: 1,
	cooldownMinutes: 60,
	maxActions: 3,
});
assert.equal(fresherDecision.shouldSend, true);
assert.equal(fresherDecision.reason, "changed");

const quietDecision = shouldSendAttentionNotification({
	...summary,
	attentionSignalCount: 0,
	nextActions: [],
}, {}, {
	now,
	minSignals: 1,
	cooldownMinutes: 60,
	maxActions: 3,
});
assert.equal(quietDecision.shouldSend, false);
assert.equal(quietDecision.reason, "below-threshold");

console.log(
	JSON.stringify({
		ok: true,
		checked: "attention-notifications-v1",
		title: notification.title,
		fingerprint: notification.fingerprint,
		firstDecision: firstDecision.reason,
		repeatedDecision: repeatedDecision.reason,
		expiredDecision: expiredDecision.reason,
		changedDecision: changedDecision.reason,
		fresherDecision: fresherDecision.reason,
	}),
);
