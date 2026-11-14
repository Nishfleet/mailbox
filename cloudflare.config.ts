import { bindings, defineConfig, exports, triggers } from "cf/config";

// Single source for the Worker's deploy configuration: the Cloudflare Vite
// plugin v2 reads this file instead of a Wrangler configuration file.
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
			// Production deploys must also define POLICY_AUD and TEAM_DOMAIN
			// (deploy-time secrets; see .dev.vars.example for local development).
			// TEAM_DOMAIN may be the base Access URL or the full /cdn-cgi/access/certs URL.
			// The worker now fails closed outside local development if Access is not configured.
			DOMAINS: bindings.text("0509.io,0509.in,inish.in,aiconverter.app,siterep.net,tinystudio.io,tinystudio.in,seofixkit.com"),
			EMAIL_ADDRESSES: bindings.json([]),
			// Deploy-time secret: the base URL of this Worker used as the
			// "Open Attention Desk" link in notifications (see README).
			ATTENTION_NOTIFY_BASE_URL: bindings.secret(),
			ATTENTION_NOTIFY_MIN_SIGNALS: bindings.text("1"),
			ATTENTION_NOTIFY_COOLDOWN_MINUTES: bindings.text("60"),
			ATTENTION_NOTIFY_MAX_ACTIONS: bindings.text("3"),
			// Automatic AI reply drafts per mailbox per UTC day; "0" turns auto-drafting off.
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
