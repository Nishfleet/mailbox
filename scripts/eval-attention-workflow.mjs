// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	buildAgentDeskSummaries,
	buildAttentionNextActions,
} from "../workers/lib/attention-workflow.js";

const trace = JSON.parse(
	readFileSync(new URL("../docs/evals/attention-workflow-trace.json", import.meta.url), "utf8"),
);

const actions = buildAttentionNextActions(trace.input);
const comparable = actions.map((action) => ({
	id: action.id,
	bucket: action.bucket,
	label: action.label,
	mailboxId: action.mailboxId,
	emailId: action.emailId,
	threadId: action.threadId,
}));

assert.deepEqual(comparable, trace.expectedNextActions);
assert.equal(
	new Set(actions.map((action) => `${action.mailboxId}:${action.threadId || action.emailId}`)).size,
	actions.length,
);
assert.equal(actions.some((action) => action.bucket === "act_now" && action.threadId === "thread-money"), false);

const desks = buildAgentDeskSummaries(trace.input);
const comparableDesks = desks.map((desk) => ({
	id: desk.id,
	label: desk.label,
	signalCount: desk.signalCount,
	mailboxIds: desk.mailboxIds,
	nextActionIds: desk.nextActions.map((action) => action.id),
}));

assert.deepEqual(comparableDesks, trace.expectedAgentDesks);
assert.equal(desks.every((desk) => desk.nextActions.length > 0), true);

console.log(
	JSON.stringify({
		ok: true,
		checked: trace.name,
		nextActions: comparable,
		agentDesks: comparableDesks,
	}),
);
