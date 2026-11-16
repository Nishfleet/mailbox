// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache-2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
//
// Project configuration for cf (https://developers.cloudflare.com/cf/).
// Secrets (POLICY_AUD, TEAM_DOMAIN, ...) are not listed here; production
// deploys must define them, and the worker fails closed without them.
import { bindings, defineConfig, exports, triggers } from "cf/config";

export default defineConfig({
	worker: {
		name: "0509-support-inbox",
		compatibilityDate: "2025-11-28",
		compatibilityFlags: [
			"nodejs_compat",
		],
		entrypoint: "./workers/app.ts",
		previewUrls: false,
		observability: {
			enabled: true,
		},
		// These "exports" entries replace wrangler's ordered DO migration
		// history (new_sqlite_classes for MailboxDO, EmailAgent, EmailMCP).
		exports: {
			MailboxDO: exports.durableObject({ storage: "sqlite" }),
			EmailAgent: exports.durableObject({ storage: "sqlite" }),
			EmailMCP: exports.durableObject({ storage: "sqlite" }),
		},
		triggers: [
			triggers.scheduled({
				schedule: "*/15 * * * *",
			}),
		],
		env: {
			DOMAINS: bindings.text("0509.io,0509.in,inish.in,aiconverter.app,siterep.net,tinystudio.io,tinystudio.in,seofixkit.com"),
			EMAIL_ADDRESSES: bindings.json([]),
			ATTENTION_NOTIFY_BASE_URL: bindings.text("https://0509-support-inbox.nishant345.workers.dev"),
			ATTENTION_NOTIFY_MIN_SIGNALS: bindings.text("1"),
			ATTENTION_NOTIFY_COOLDOWN_MINUTES: bindings.text("60"),
			ATTENTION_NOTIFY_MAX_ACTIONS: bindings.text("3"),
			AUTO_DRAFT_DAILY_LIMIT: bindings.text("200"),
			BUCKET: bindings.r2({
				name: "0509-support-inbox",
			}),
			EMAIL: bindings.sendEmail({}),
			MAILBOX: bindings.durableObject({
				worker: "0509-support-inbox",
				exportName: "MailboxDO",
			}),
			EMAIL_AGENT: bindings.durableObject({
				worker: "0509-support-inbox",
				exportName: "EmailAgent",
			}),
			EMAIL_MCP: bindings.durableObject({
				worker: "0509-support-inbox",
				exportName: "EmailMCP",
			}),
			AI: bindings.ai({}),
			CF_VERSION_METADATA: bindings.versionMetadata(),
		},
	},
});
