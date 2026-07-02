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
import {
	isHighConfidenceSpam,
	parseCloudflareSpamScore,
} from "../workers/lib/spam.js";

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
	notificationActions: buildAttentionNextActions(
		trace.input.filter((item) => ["money", "leads", "act_now"].includes(item.bucket)),
		12,
	),
};

const notification = buildAttentionNotification(summary, {
	baseUrl: "https://inbox.example.com/mail/",
	maxActions: 3,
});

assert.equal(notification.title, "Attention Desk: 2 priority signals");
assert.equal(notification.url, "https://inbox.example.com/mail/?attention=1");
assert.equal(notification.urlTitle, "Open Attention Desk");
assert.equal(notification.actionCount, 2);
assert.equal(notification.message.includes("Review draft"), false);
assert.match(notification.message, /Handle money: billing@0509\.io - Invoice failed/);
assert.match(notification.message, /Work lead: hello@siterep\.net - Demo request/);
assert.equal(notification.message.includes("Old support follow-up"), false);

const email = buildAttentionNotificationEmail(notification);
assert.equal(email.subject, "Attention Desk: 2 priority signals");
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
assert.equal(changedDecision.shouldSend, false);
assert.equal(changedDecision.reason, "unchanged");

const fresherDecision = shouldSendAttentionNotification({
	...summary,
	notificationActions: summary.notificationActions.map((action) =>
		action.bucket === "money" ? { ...action, latestAt: "2026-07-02T05:04:00.000Z" } : action,
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
	notificationActions: [],
}, {}, {
	now,
	minSignals: 1,
	cooldownMinutes: 60,
	maxActions: 3,
});
assert.equal(quietDecision.shouldSend, false);
assert.equal(quietDecision.reason, "below-threshold");

const draftOnlyDecision = shouldSendAttentionNotification({
	...summary,
	attentionSignalCount: 3,
	nextActions: summary.nextActions.filter((action) => action.bucket === "drafts_ready"),
	notificationActions: [],
}, {}, {
	now,
	minSignals: 1,
	cooldownMinutes: 60,
	maxActions: 3,
});
assert.equal(draftOnlyDecision.shouldSend, false);
assert.equal(draftOnlyDecision.reason, "empty");

const draftCrowdedSummary = {
	...summary,
	attentionSignalCount: 4,
	nextActions: [
		{
			id: "billing@0509.io:thread-draft-1",
			bucket: "drafts_ready",
			label: "Review draft",
			mailboxId: "billing@0509.io",
			emailId: "draft-1",
			threadId: "thread-draft-1",
			latestAt: "2026-07-02T05:01:00.000Z",
			subject: "Re: internal draft 1",
		},
		{
			id: "billing@0509.io:thread-draft-2",
			bucket: "drafts_ready",
			label: "Review draft",
			mailboxId: "billing@0509.io",
			emailId: "draft-2",
			threadId: "thread-draft-2",
			latestAt: "2026-07-02T05:02:00.000Z",
			subject: "Re: internal draft 2",
		},
		{
			id: "billing@0509.io:thread-draft-3",
			bucket: "drafts_ready",
			label: "Review draft",
			mailboxId: "billing@0509.io",
			emailId: "draft-3",
			threadId: "thread-draft-3",
			latestAt: "2026-07-02T05:03:00.000Z",
			subject: "Re: internal draft 3",
		},
	],
	notificationActions: [{
		id: "billing@0509.io:thread-money-real",
		bucket: "money",
		label: "Handle money",
		mailboxId: "billing@0509.io",
		emailId: "email-money-real",
		threadId: "thread-money-real",
		latestAt: "2026-07-02T05:04:00.000Z",
		subject: "Card failed",
	}],
};
const draftCrowdedDecision = shouldSendAttentionNotification(draftCrowdedSummary, {}, {
	now,
	minSignals: 1,
	cooldownMinutes: 60,
	maxActions: 3,
});
assert.equal(draftCrowdedDecision.shouldSend, true);
assert.equal(draftCrowdedDecision.reason, "changed");
assert.match(draftCrowdedDecision.notification.message, /Card failed/);
assert.equal(draftCrowdedDecision.notification.message.includes("internal draft"), false);

const actNowDecision = shouldSendAttentionNotification({
	...summary,
	attentionSignalCount: 1,
	nextActions: [],
	notificationActions: [{
		id: "hello@0509.io:thread-real",
		bucket: "act_now",
		label: "Reply next",
		mailboxId: "hello@0509.io",
		emailId: "email-real",
		threadId: "thread-real",
		latestAt: "2026-07-02T05:04:00.000Z",
		subject: "Customer question",
	}],
}, {}, {
	now,
	minSignals: 1,
	cooldownMinutes: 60,
	maxActions: 3,
});
assert.equal(actNowDecision.shouldSend, true);
assert.equal(actNowDecision.reason, "changed");

const companyBillingDecision = shouldSendAttentionNotification({
	...summary,
	attentionSignalCount: 1,
	nextActions: [],
	notificationActions: [{
		id: "billing@0509.io:thread-company-billing",
		bucket: "money",
		label: "Handle money",
		mailboxId: "billing@0509.io",
		emailId: "email-company-billing",
		threadId: "thread-company-billing",
		latestAt: "2026-07-02T05:04:00.000Z",
		subject: "Stripe invoice requires action",
	}],
}, {}, {
	now,
	minSignals: 1,
	cooldownMinutes: 60,
	maxActions: 3,
});
assert.equal(companyBillingDecision.shouldSend, true);
assert.equal(companyBillingDecision.reason, "changed");

const spamHeaders = [{ key: "X-Cf-Spamh-Score", value: "5" }];
const runtimeSpamHeaders = new Headers({ "X-Cf-Spamh-Score": "5" });
const normalHeaders = [{ key: "X-Cf-Spamh-Score", value: "4.9" }];
assert.equal(parseCloudflareSpamScore(spamHeaders), 5);
assert.equal(isHighConfidenceSpam(spamHeaders), true);
assert.equal(isHighConfidenceSpam(runtimeSpamHeaders), true);
assert.equal(isHighConfidenceSpam(normalHeaders), false);
assert.equal(isHighConfidenceSpam([{ key: "Subject", value: "Invoice attached" }]), false);

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
		draftOnlyDecision: draftOnlyDecision.reason,
		draftCrowdedDecision: draftCrowdedDecision.reason,
		actNowDecision: actNowDecision.reason,
		companyBillingDecision: companyBillingDecision.reason,
	}),
);
