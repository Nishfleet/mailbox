# 0509-support-inbox Product Scout Candidates — 2026-08-20

Scout timestamp: 2026-08-20T02:32:45.323Z
Product: 0509-support-inbox — Agentic Inbox (self-hosted email client with AI agent on Cloudflare Workers, forked from cloudflare/agentic-inbox and extended with a cross-mailbox Attention Desk, push notifications, and spam routing)
Repo: /home/nish/workspaces/products/0509-support-inbox @ 033992e (origin/refactor/behaviour-preserving-sweep)
Revenue model: support/operations tool for Nish's product portfolio (0509.io, inish.in, tinystudio.io, aiconverter.app, siterep.net, seofixkit.com). Revenue impact = how much the item speeds revenue-bearing work (money/lead triage, faster replies, fewer missed signals) or removes operator overhead that costs time. The product is not sold externally; its value is internal revenue acceleration across the portfolio.

> **Input note (audit blocker).** The candidates file referenced by this scout run
> (`var/scout/CANDIDATES-2026-08-20-0509-support-inbox.md`) did not exist anywhere on the
> filesystem when the audit started — no `var/scout/` directory was present and no
> prior scout produced candidates for `0509-support-inbox`. The candidate set below was
> reconstructed **directly from the product workspace**, with every item carrying a
> cited evidence source (file path + line number, commit, or PR). It is the input the
> audit (`AUDIT-2026-08-20-0509-support-inbox.md`) ranked.

---

## Candidate 1 — mailbox-delete-orphans-do-and-r2

**Title:** Deleting a mailbox only removes the R2 metadata key — Durable Object SQLite data and R2 attachment blobs are orphaned

**Revenue impact:** MEDIUM-HIGH — orphaned DO data and R2 attachment blobs accumulate silently, inflating storage costs and slowing mailbox directory scans (`listMailboxes` in `workers/lib/email-helpers.ts` iterates R2 keys). More importantly, a stale mailbox that still has DO state can surface phantom attention signals in the Attention Desk (`buildAttentionSummary` in `workers/lib/attention.ts` calls `getMailboxAttention` which calls `stub.getAttentionSummary()`), producing false money/lead/aging counts that waste operator time on mailboxes the operator believed deleted. Wasted operator attention on ghost mailboxes is direct revenue-time loss.

**Evidence:**
- `workers/index.ts:204` — `await c.env.BUCKET.delete(key); // TODO: also delete DO data and R2 attachment blobs` (the TODO is the explicit acknowledged gap)
- `workers/index.ts:200-206` — the `DELETE /api/v1/mailboxes/:mailboxId` handler deletes only `mailboxes/${mailboxId}.json` from R2, then returns 204 with no DO or attachment cleanup
- `workers/durableObject/index.ts:616` — `deleteEmail(id)` exists per-email but there is no `deleteAllMailboxData` or equivalent bulk purge method on the DO
- `workers/lib/attention.ts:148-167` — `getConfiguredMailboxIds` merges `EMAIL_ADDRESSES` with stored mailbox IDs; a deleted mailbox whose R2 metadata is gone but DO state remains can still be queried if it appears in `EMAIL_ADDRESSES`, producing phantom attention signals

**Proposed work:** Add a DO method (e.g. `purgeMailboxData`) that deletes all emails, attachments metadata, and folders from the DO's SQLite, and extend the `DELETE /api/v1/mailboxes/:mailboxId` handler to also delete all R2 attachment blobs under `attachments/` for that mailbox and call the DO purge. This closes the explicit TODO at `workers/index.ts:204`.

---

## Candidate 2 — attention-keyword-match-is-substring-only

**Title:** Money/lead attention classification uses SQL LIKE substring matching, causing false positives and missed signals

**Revenue impact:** MEDIUM-HIGH — the Attention Desk's money and lead buckets are the primary revenue-triage surface. The classification (`workers/durableObject/index.ts:698-699`) uses `categoryCondition(MONEY_TERMS)` / `categoryCondition(LEAD_TERMS)` which builds SQL `LIKE` clauses matching substrings in the concatenated subject+sender+recipient text. Substring matching produces false positives (e.g. "charge" in "discharge", "plan" in "plane") that pollute the money/lead buckets with non-revenue mail, and misses signals that use synonyms not in the hardcoded term lists. False positives waste operator time; false negatives miss revenue. The term lists are also static and not tunable per mailbox.

**Evidence:**
- `workers/durableObject/index.ts:698-699` — `moneyWhere` and `leadWhere` use `categoryCondition(MONEY_TERMS)` and `categoryCondition(LEAD_TERMS)` in SQL WHERE clauses
- `workers/durableObject/index.ts:44-56` — `MONEY_TERMS` and `LEAD_TERMS` are hardcoded arrays; `LEAD_TERMS` includes `"pricing"` and `"plan"` which are broad substrings
- `workers/durableObject/index.ts:58-59` — `ATTENTION_SEARCH_TEXT_SQL` concatenates `subject`, `sender`, `recipient` into one LOWER() string for LIKE matching (no word-boundary enforcement)
- `workers/lib/attention-workflow.js:22-35` — `AGENT_DESK_RULES` patterns use `\b` word boundaries in JS regex, but the SQL-side classification that feeds the buckets does not — inconsistency between the two layers
- Commit `1db7b7c` (feat: add cross-mailbox attention desk) introduced the heuristic triage; commit `3914a07` (feat: add attention desk next actions) layered next-actions on top — both rely on the same SQL keyword match

**Proposed work:** Enforce word boundaries in the SQL keyword match (e.g. `LIKE '% plan %'` with surrounding spaces, or use SQLite's `REGEXP` if available, or pre-tokenize). Expand the term lists with revenue-relevant synonyms (e.g. "checkout", "subscription", "upgrade", "cancel", "refund request"). Consider making term lists configurable per mailbox via settings, matching the existing `agentSystemPrompt` per-mailbox override pattern.

---

## Candidate 3 — no-send-rate-limit-config-visible-to-operator

**Title:** Send rate limit exists but is not surfaced or configurable; operator cannot see or tune it

**Revenue impact:** MEDIUM — `checkSendRateLimit()` (`workers/durableObject/index.ts:1157`) gates outbound email sending, returning a 429 when exceeded. The rate limit threshold and window are hardcoded in the DO with no env var, no settings UI, and no visibility in the Attention Desk or MCP. If the rate limit is too aggressive, legitimate revenue-bearing replies (money/lead responses) are silently blocked with a 429 the operator only sees in the compose flow. If too loose, the worker risks Cloudflare Email Service quota issues. The operator has no way to know the limit exists, what it is, or whether a send was blocked by it vs. a real error.

**Evidence:**
- `workers/durableObject/index.ts:1157` — `checkSendRateLimit(): Promise<string | null>` exists but the threshold/window are internal to the DO
- `workers/index.ts:251-252` — `const rateLimitError = await (stub as any).checkSendRateLimit(); if (rateLimitError) return c.json({ error: rateLimitError }, 429);` — the 429 is returned to the compose UI but the operator sees only the error string, no context about the limit
- `workers/lib/tools.ts:62-72` — `getSendStub` also calls `checkSendRateLimit` for agent-initiated sends (send_reply, send_email); the agent gets `{ error: rateLimitError }` with no guidance
- `wrangler.jsonc` — no rate-limit-related env vars in the `vars` block; the limit is purely DO-internal
- `app/routes/settings.tsx` — the settings UI exposes only `fromName` and `agentSystemPrompt`; no rate-limit or operational settings

**Proposed work:** Surface the rate limit configuration as env vars (e.g. `SEND_RATE_LIMIT_MAX`, `SEND_RATE_LIMIT_WINDOW_MINUTES`) with sensible defaults, expose the current limit and last-blocked timestamp in the Attention Desk or settings, and include the limit value in the 429 error response so the operator/agent can understand the constraint.

---

## Candidate 4 — attention-notification-no-test-coverage-for-pushover-api-path

**Title:** Pushover API notification delivery path has no eval or test coverage; only the email fallback and decision logic are tested

**Revenue impact:** MEDIUM — the Pushover push notification (`workers/lib/attention-notifications.ts:sendPushoverNotification`) is the primary delivery method for real-time money/lead/act-now alerts to Nish's phone. If the Pushover API path breaks (auth, rate limit, API change), the operator silently stops receiving revenue-critical alerts and misses time-sensitive money/lead messages. The eval script (`scripts/eval-attention-notifications.mjs`) tests `buildAttentionNotification`, `shouldSendAttentionNotification`, `buildAttentionNotificationEmail`, and `isHighConfidenceSpam` — but never exercises `sendPushoverNotification` or `runAttentionNotificationCheck` with a real or mocked Pushover API call. The email fallback path is also untested end-to-end.

**Evidence:**
- `scripts/eval-attention-notifications.mjs:1-10` — imports only `buildAttentionNotificationEmail`, `buildAttentionNotification`, `shouldSendAttentionNotification` from `attention-notification-core.js` and `buildAttentionNextActions` from `attention-workflow.js`; no import of `attention-notifications.ts` (the delivery module)
- `workers/lib/attention-notifications.ts:55-80` — `sendPushoverNotification` makes a real `fetch(PUSHOVER_MESSAGES_URL)` call with zero test coverage; a failure throws but the caller (`runAttentionNotificationCheck`) does not retry or alert
- `workers/lib/attention-notifications.ts:82-99` — `sendPushoverEmailNotification` calls `sendEmail(env.EMAIL, ...)` with no test coverage
- `workers/lib/attention-notifications.ts:101-106` — `getDeliveryMethod` returns `null` when no Pushover env vars are set, causing `runAttentionNotificationCheck` to return `{ status: "disabled" }` — this is a silent no-op with no operator visibility
- `workers/app.ts:67-76` — the `scheduled()` handler calls `runAttentionNotificationCheck` and logs the result, but a `disabled` status is only visible in Worker logs, not the UI
- Commit `4c5aaad` (Add attention push notifications) and commit `ec0ad76` (Add Pushover email fallback) added the delivery code but the eval script was not extended to cover delivery

**Proposed work:** Add a test case to `scripts/eval-attention-notifications.mjs` (or a new eval file) that mocks the Pushover API `fetch` call and verifies `sendPushoverNotification` constructs the correct request body, handles non-2xx responses, and that `runAttentionNotificationCheck` correctly routes to API vs email delivery based on env vars. Add a test for the `disabled` path to ensure it is intentional, not a misconfiguration.

---

## Candidate 5 — no-public-landing-page-or-product-positioning

**Title:** No public landing page, product positioning, or signup surface — the app is an internal tool with no external visibility

**Revenue impact:** HIGH (but blocked on Nish) — the product is a capable support inbox with AI triage, push notifications, and MCP integration, but there is no public landing page, no product description for external users, and no signup/onboarding flow. The README is developer-facing (deploy instructions). If the product were positioned and offered as a self-hostable support inbox SaaS or a Cloudflare Workers template, it could generate direct revenue. Today it only accelerates Nish's internal portfolio revenue. The product has feature parity with (and exceeds, via Attention Desk) the upstream `cloudflare/agentic-inbox` — it is a sellable asset with zero external visibility.

**Evidence:**
- `README.md:1-98` — the README is entirely developer setup instructions ("How to setup", deploy button, troubleshooting); no product positioning, target customer, or value proposition for external users
- `app/routes/home.tsx:502-508` — the app's root route renders `<h1>Mailboxes</h1>` with a mailbox list; there is no public landing page, marketing surface, or unauthenticated view (Cloudflare Access blocks all non-authenticated traffic per `workers/app.ts:38-56`)
- `workers/app.ts:38-56` — the Access JWT middleware blocks all unauthenticated requests in production with 403/500; no public route exemption exists
- `wrangler.jsonc:18` — `DOMAINS` lists 8 owned domains (0509.io, 0509.in, inish.in, aiconverter.app, siterep.net, tinystudio.io, tinystudio.in, seofixkit.com) — the product spans Nish's entire portfolio but has no external-facing surface on any of them
- `app/routes/not-found.tsx` — a 404 route exists but there is no public landing or marketing route

**Why NEEDS-NISH:** Whether to position and sell this product externally (SaaS, template, open-source with paid hosting) is a product-direction, pricing, and brand decision. Nish must decide if this remains an internal tool or becomes a revenue-generating product.

---

## Candidate 6 — no-multi-user-or-per-mailbox-auth [NEEDS-NISH: pricing/brand]

**Title:** No per-mailbox authorization — any Access-authenticated user sees all mailboxes

**Revenue impact:** HIGH (but blocked on Nish) — the product enforces a single trust boundary (Cloudflare Access). Once a user passes the Access policy, they can read and operate on every mailbox across all 8 domains (`workers/app.ts:54-56` explicitly documents this). If the product were offered to external customers, this model is a non-starter — each customer must only see their own mailboxes. The MCP server at `/mcp` has the same single-boundary model (`README.md:79`). Multi-tenant isolation is a prerequisite for any external revenue.

**Evidence:**
- `workers/app.ts:54-56` — comment: "Authorization model note: once a teammate passes the shared Cloudflare Access policy, they can access all mailboxes in this app by design."
- `workers/index.ts:115` — `app.use("/api/v1/mailboxes/:mailboxId/*", requireMailbox)` — `requireMailbox` only checks that the mailbox exists, not that the user is authorized for it
- `workers/lib/mailbox.ts` — `requireMailbox` middleware resolves the DO stub but performs no per-user authorization
- `README.md:79` — "Any user who passes the shared Cloudflare Access policy can access all mailboxes in this app by design. This includes the MCP server at `/mcp`"
- `app/routes/home.tsx:416-440` — the home route auto-creates mailboxes from `EMAIL_ADDRESSES` config; there is no user-scoping

**Why NEEDS-NISH:** Multi-tenant authorization is a product-direction and pricing decision (single-tenant internal tool vs multi-tenant SaaS). The auth model, tenant isolation approach, and whether to invest in per-mailbox RBAC depend on whether Nish decides to externalize the product (Candidate 5).

---

## Candidate 7 — no-analytics-or-response-time-measurement [NEEDS-NISH: brand/privacy]

**Title:** No analytics, response-time tracking, or SLA measurement — cannot quantify the product's revenue impact

**Revenue impact:** MEDIUM (but blocked on Nish) — the Attention Desk counts signals (money, leads, aging) but does not track response times, resolution rates, or revenue-attributed outcomes. Without measurement, there is no way to prove the product is accelerating revenue (faster money/lead replies = more conversions) or to identify bottlenecks (which mailboxes have the slowest response). The product's value proposition is unmeasurable.

**Evidence:**
- `workers/lib/attention.ts:24-40` — `BUCKETS` defines counts (moneyCount, leadCount, etc.) but no time-to-response or resolution metrics
- `workers/durableObject/index.ts:682-801` — `getAttentionSummary` counts items but does not compute or store first-response time, resolution time, or conversion attribution
- `workers/app.ts:67-76` — the cron handler runs notification checks but does not emit analytics events
- No analytics script, tracking pixel, or event emission exists anywhere in `workers/` or `app/` (grep for "analytics", "track", "metric", "telemetry" returns zero matches in source files)

**Why NEEDS-NISH:** Choosing an analytics/measurement approach (self-hosted vs SaaS, privacy posture, what metrics define "revenue impact") is a brand and privacy decision. Nish must decide what to measure and how before implementation.

---

## Candidate 8 — no-billing-or-subscription-surface [NEEDS-NISH: pricing]

**Title:** No billing, subscription, or payment integration — the product cannot charge users

**Revenue impact:** HIGH (but blocked on Nish) — if the product is externalized (Candidate 5), it needs a billing surface. There is no Stripe, no subscription management, no usage-based billing, and no payment integration anywhere in the codebase. The product uses Cloudflare Workers AI (`@cf/moonshotai/kimi-k2.5`) which has per-request costs — a billing surface would be needed to meter and charge for AI usage.

**Evidence:**
- `wrangler.jsonc:24-26` — `ai: { binding: "AI" }` — Workers AI is bound but there is no usage metering or cost tracking
- `workers/agent/index.ts:1-20` — the agent uses `createWorkersAI` via `workers-ai-provider` for AI calls; no usage accounting
- `package.json:23` — no Stripe, no billing library, no payment SDK in dependencies
- `workers/lib/ai.ts:38-50` — `isPromptInjection` and `verifyDraft` make AI calls (`ai.run(...)`) with no usage tracking
- `app/routes/settings.tsx` — settings UI has no billing, plan, or usage section

**Why NEEDS-NISH:** Billing model (subscription, usage-based, freemium), pricing tiers, and payment provider are pricing decisions. Nish must decide whether and how to charge before implementation. This is contingent on the externalization decision (Candidate 5).

---

## Market-signal notes (competitor moves / pricing shifts)

The referenced candidates file (which would have carried any market-signal content) was absent. No external competitor data is available from a candidates file. The following product-internal and upstream signals are noted for the market-signal role:

1. **Upstream (cloudflare/agentic-inbox) is a free open-source template** — the product is forked from `cloudflare/agentic-inbox` (remote `cloudflare-upstream` at `https://github.com/cloudflare/agentic-inbox.git`). The upstream is a free Apache-2.0 template with no pricing. This means any externalized version of 0509-support-inbox competes against a free, Cloudflare-backed template. Differentiation (Attention Desk, push notifications, spam routing, MCP) is the only defensible position. No upstream pricing shift is visible — the upstream remains free.

2. **Workers AI model is `@cf/moonshotai/kimi-k2.5`** — `workers/agent/index.ts` uses this model via `workers-ai-provider`. Cloudflare Workers AI pricing is per-token; a model change or price shift would directly affect the product's AI cost structure. No recent price shift is visible in the repo, but the model choice is a cost lever.

3. **Pushover is the notification provider** — `workers/lib/attention-notifications.ts` uses Pushover API (`https://api.pushover.net/1/messages.json`) with an email fallback. Pushover pricing is a one-time $5 per platform (iOS/Android) — no recurring cost. No pricing shift is visible. If Pushover changes its model or API, the notification path breaks silently (Candidate 4).

4. **No competitor support-inbox products are visible in the candidates file or workspace** — the product occupies a niche (self-hosted AI support inbox on Cloudflare Workers) with no direct competitor visible in the available evidence. Adjacent competitors (Help Scout, Front, Missive) are SaaS with per-seat pricing; none are self-hostable on Workers.

No new competitor moves or pricing shifts are visible in the candidates file or product workspace as of 2026-08-20.
