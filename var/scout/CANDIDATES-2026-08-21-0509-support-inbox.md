# 0509-support-inbox Product Scout Candidates — 2026-08-21

Scout timestamp: 2026-08-21T02:32:22.659Z
Product: 0509-support-inbox — Agentic Inbox (self-hosted email client with AI agent on Cloudflare Workers, forked from cloudflare/agentic-inbox and extended with a cross-mailbox Attention Desk, Pushover push notifications, and spam routing)
Repo: /home/nish/workspaces/products/0509-support-inbox @ 033992e (refactor/behaviour-preserving-sweep)
Revenue model: support/operations tool for Nish's product portfolio (0509.io, 0509.in, inish.in, aiconverter.app, siterep.net, tinystudio.io, tinystudio.in, seofixkit.com). Revenue impact = how much the item speeds revenue-bearing work (money/lead triage, faster replies, fewer missed signals) or removes operator overhead that costs time. The product is not sold externally; its value is internal revenue acceleration across the portfolio.

> **Input note.** The candidates file referenced by this scout run
> (`var/scout/CANDIDATES-2026-08-21-0509-support-inbox.md`) exists on the fleet scout store
> but, as generated, it contains only **one genuine candidate**: the `OPEN TODO / FIXME`
> grep-surfaced `mailbox-delete-orphans-do-and-r2` item (`workers/index.ts:204`). The rest of
> the file is ~20 corrupted lines from a recursive grep that descended into `node_modules`
> (890KB of `.map` source dumps and two Babel `regenerator` TODOs) — not usable candidate
> content. The single genuine candidate is carried over as Candidate 1; regardless of REAL
> code changes since 2026-08-20 (HEAD is unchanged at `033992e`), the audit ranked the full
> candidate set reconstructed from the product workspace, with every item carrying a cited
> evidence source (file path + line number, commit, or PR).

---

## Candidate 1 — mailbox-delete-orphans-do-and-r2 ★ (from input file)

**Title:** Deleting a mailbox only removes the R2 metadata key — Durable Object SQLite data and R2 attachment blobs are orphaned

**Revenue impact:** MEDIUM-HIGH — orphaned DO data and R2 attachment blobs accumulate silently, inflating storage costs and slowing mailbox directory scans (`listMailboxes` in `workers/lib/email-helpers.ts` iterates R2 keys). More importantly, a stale mailbox that still has DO state can surface phantom attention signals in the Attention Desk (`buildAttentionSummary` in `workers/lib/attention.ts` calls `getMailboxAttention`, which calls `stub.getAttentionSummary()`), producing false money/lead/aging counts that waste operator time on mailboxes the operator believed deleted. Wasted operator attention on ghost mailboxes is direct revenue-time loss.

**Evidence:**
- `workers/index.ts:204` — `await c.env.BUCKET.delete(key); // TODO: also delete DO data and R2 attachment blobs` (the TODO is the explicitly acknowledged gap)
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
- `workers/durableObject/index.ts:44-56` — `MONEY_TERMS` and `LEAD_TERMS` are hardcoded arrays; `LEAD_TERMS` includes `"pricing"` and `"plan"`, which are broad substrings
- `workers/durableObject/index.ts:58-59` — `ATTENTION_SEARCH_TEXT_SQL` concatenates `subject`, `sender`, `recipient` into one `LOWER()` string for LIKE matching (no word-boundary enforcement)
- `workers/durableObject/index.ts:173-176` — `categoryCondition(terms)` maps each term to `${ATTENTION_SEARCH_TEXT_SQL} LIKE ?` and `categoryParams` wraps each in `%term%` — pure substring match, no boundaries
- `workers/lib/attention-workflow.js:22-35` — `AGENT_DESK_RULES` patterns use `\b` word boundaries in JS regex, but the SQL-side classification that feeds the buckets does not — inconsistency between the two layers
- Commit `1db7b7c` (feat: add cross-mailbox attention desk) introduced the heuristic triage; commit `3914a07` (feat: add attention desk next actions) layered next-actions on top — both rely on the same SQL keyword match

**Proposed work:** Enforce word boundaries in the SQL keyword match (e.g. `LIKE '% plan %'` with surrounding spaces, or pre-tokenize subject/sender/recipient). Expand the term lists with revenue-relevant synonyms (e.g. "checkout", "subscription", "upgrade", "cancel", "refund request"). Consider making term lists configurable per mailbox via settings, matching the existing per-mailbox `agentSystemPrompt` override pattern.

---

## Candidate 3 — no-send-rate-limit-config-visible-to-operator

**Title:** Send rate limit exists but is not surfaced or configurable; operator cannot see or tune it

**Revenue impact:** MEDIUM — `checkSendRateLimit()` (`workers/durableObject/index.ts:1157`) gates outbound email sending, returning a 429 when exceeded. The rate-limit threshold and window are hardcoded in the DO with no env var, no settings UI, and no visibility in the Attention Desk or MCP. If too aggressive, legitimate revenue-bearing replies (money/lead responses) are silently blocked with a 429 the operator only sees in the compose flow. If too loose, the worker risks Cloudflare Email Service quota issues. The operator has no way to know the limit exists, what it is, or whether a send was blocked by it vs. a real error.

**Evidence:**
- `workers/durableObject/index.ts:1155-1170` — `checkSendRateLimit(): Promise<string | null>` returns `"Rate limit exceeded: max 20 emails per hour per mailbox"`; the threshold/window are internal to the DO
- `workers/index.ts:251-252` — `const rateLimitError = await (stub as any).checkSendRateLimit(); if (rateLimitError) return c.json({ error: rateLimitError }, 429);` — the 429 is returned to the compose UI but the operator sees only the error string, no context about the limit
- `workers/lib/tools.ts:62-72` — `getSendStub` also calls `checkSendRateLimit` for agent-initiated sends (send_reply, send_email); the agent gets `{ error: rateLimitError }` with no guidance
- `wrangler.jsonc` — no rate-limit-related env vars in the `vars` block; the limit is purely DO-internal
- `app/routes/settings.tsx` — the settings UI exposes only `fromName` and `agentSystemPrompt`; no rate-limit or operational settings

**Proposed work:** Surface the rate-limit configuration as env vars (e.g. `SEND_RATE_LIMIT_MAX`, `SEND_RATE_LIMIT_WINDOW_MINUTES`) with sensible defaults, expose the current limit and last-blocked timestamp in the Attention Desk or settings, and include the limit value in the 429 error response so the operator/agent can understand the constraint.

---

## Candidate 4 — attention-notification-no-test-coverage-for-pushover-api-path

**Title:** Pushover API notification delivery path has no eval or test coverage; only the email fallback and decision logic are tested

**Revenue impact:** MEDIUM — the Pushover push notification (`workers/lib/attention-notifications.ts:sendPushoverNotification`) is the primary delivery method for real-time money/lead/act-now alerts to Nish's phone. If the Pushover API path breaks (auth, rate limit, API change), the operator silently stops receiving revenue-critical alerts and misses time-sensitive money/lead messages. The eval script (`scripts/eval-attention-notifications.mjs`) tests `buildAttentionNotification`, `shouldSendAttentionNotification`, `buildAttentionNotificationEmail`, and `isHighConfidenceSpam` — but never exercises `sendPushoverNotification` or `runAttentionNotificationCheck` with a real or mocked Pushover API call. The email fallback path is also untested end-to-end.

**Evidence:**
- `scripts/eval-attention-notifications.mjs:1-14` — imports only `buildAttentionNotificationEmail`, `buildAttentionNotification`, `shouldSendAttentionNotification` from `attention-notification-core.js` and `buildAttentionNextActions` from `attention-workflow.js`; no import of `attention-notifications.ts` (the delivery module)
- `workers/lib/attention-notifications.ts:55-80` — `sendPushoverNotification` makes a real `fetch(PUSHOVER_MESSAGES_URL)` call with zero test coverage; a failure throws but the caller (`runAttentionNotificationCheck`) does not retry or alert
- `workers/lib/attention-notifications.ts:98-125` — `sendPushoverEmailNotification` calls `sendEmail(env.EMAIL, ...)` and `sendPushoverEmailNotification` are untested end-to-end
- `workers/lib/attention-notifications.ts:127-141` — `getDeliveryMethod` returns `null` when no Pushover env vars are set, causing `runAttentionNotificationCheck` to return `{ status: "disabled", reason: "missing-pushover-destination" }` — a silent no-op with no operator visibility
- `workers/app.ts:114-125` — the `scheduled()` handler calls `runAttentionNotificationCheck` and logs the result, but a `disabled` status is only visible in Worker logs, not the UI
- Commit `4c5aaad` (Add attention push notifications) and commit `ec0ad76` (Add Pushover email fallback) added the delivery code but the eval script was not extended to cover delivery

**Proposed work:** Add a test case to `scripts/eval-attention-notifications.mjs` (or a new eval file) that mocks the Pushover API `fetch` call and verifies `sendPushoverNotification` constructs the correct request body and handles non-2xx responses, and that `runAttentionNotificationCheck` correctly routes to API vs email delivery based on env vars. Add a test for the `disabled` path to ensure it is intentional, not a misconfiguration.

---

## Candidate 5 — attention-notification-disabled-path-silent

**Title:** When no Pushover destination is configured, notifications are disabled silently with no operator-surface visibility

**Revenue impact:** MEDIUM — `runAttentionNotificationCheck` returns `{ status: "disabled", reason: "missing-pushover-destination" }` when no Pushover env vars are set (`workers/lib/attention-notifications.ts:133-141`). Before commit `ec0ad76` (Add Pushover email fallback) the fallback was not reachable; today if `PUSHOVER_EMAIL_ALIAS` is also unset the notification path is a silent no-op. The cron handler logs the status to Worker logs only (`workers/app.ts:114-125`); there is no UI surface. If Pushover env vars are accidentally unset during a redeploy or secret rotation, revenue-critical alerts silently stop with no surface-level signal. This is distinct from Candidate 4 (test coverage of the delivery path) — this covers the operator's inability to detect the disabled state.

**Evidence:**
- `workers/lib/attention-notifications.ts:127-141` — `getDeliveryMethod(env)` returns `null` when no Pushover env vars; `runAttentionNotificationCheck` returns `disabled` status
- `workers/app.ts:114-125` — `scheduled()` handler logs "Attention notification check finished" (or "failed") only to console; no UI surface for disabled/active/failing status
- `app/routes/home.tsx` — Attention Desk renders money/leads/aging/act_now buckets but no notification-status indicator

**Proposed work:** Surface notification status (active / disabled / last failure) in the Attention Desk header (e.g. a small status pill), so an unset Pushover configuration is operator-visible instead of silent.

---

## Candidates routed to NEEDS-NISH (Nish decision required before work)

### Candidate 6 — no-public-landing-page-or-product-positioning [NEEDS-NISH]

**Title:** No public landing page, product positioning, or signup surface — the app is an internal tool with no external visibility

**Revenue impact:** HIGH (but blocked on Nish) — the product is a capable support inbox with AI triage, push notifications, and MCP integration, but there is no public landing page, product description, or signup/onboarding flow. It has feature parity with (and exceeds, via Attention Desk) upstream `cloudflare/agentic-inbox`. If positioned and offered externally (self-hostable SaaS, Cloudflare Workers template, open source with paid hosting), it could generate direct revenue. Today it only accelerates Nish's internal portfolio revenue. It is a sellable asset with zero external visibility.
**Evidence:** `README.md:1-98` (developer setup only), `app/routes/home.tsx` root `<h1>Mailboxes</h1>` list (no landing page), `workers/app.ts:38-56` (Access JWT blocks all unauthenticated traffic), `wrangler.jsonc:21` (`DOMAINS` lists 8 owned domains, no external surface on any), `app/routes/not-found.tsx` (404 route, no marketing route).

### Candidate 7 — no-multi-user-or-per-mailbox-auth [NEEDS-NISH]

**Title:** No per-mailbox authorization — any Access-authenticated user sees all mailboxes

**Revenue impact:** HIGH (but blocked on Nish) — a single trust boundary (Cloudflare Access) lets any authorized user read and operate on every mailbox across all 8 domains. The MCP server at `/mcp` has the same single-boundary model. Multi-tenant isolation is a prerequisite for any external revenue.
**Evidence:** `workers/app.ts:54-56` (auth model comment), `workers/index.ts:115` (`requireMailbox` checks existence, not authorization), `workers/lib/mailbox.ts` (`requireMailbox` resolves DO stub, no per-user auth), `README.md:79` (MCP server same single-boundary model), `app/routes/home.tsx:416-440` (auto-creates mailboxes from `EMAIL_ADDRESSES`, no user-scoping).

### Candidate 8 — no-analytics-or-response-time-measurement [NEEDS-NISH]

**Title:** No analytics, response-time tracking, or SLA measurement — cannot quantify the product's revenue impact

**Revenue impact:** MEDIUM (blocked on Nish) — the Attention Desk counts signals but does not track response times, resolution rates, or revenue-attributed outcomes. Without measurement the product's revenue-acceleration value is unmeasurable and bottlenecks cannot be identified.
**Evidence:** `workers/lib/attention.ts:24-40` (`BUCKETS` defines counts, no time-to-response/resolution metrics), `workers/durableObject/index.ts:682-801` (`getAttentionSummary` counts items, no response-time computation), `workers/app.ts:114-125` (cron handler runs notification checks, no analytics events), no analytics/telemetry code in `workers/` or `app/`.

### Candidate 9 — no-billing-or-subscription-surface [NEEDS-NISH]

**Title:** No billing, subscription, or payment integration — the product cannot charge users

**Revenue impact:** HIGH (blocked on Nish) — if externalized, it needs a billing surface. There is no Stripe, subscription management, usage-based billing, or payment integration. The product uses Workers AI (`@cf/moonshotai/kimi-k2.5`) with per-request costs — billing would be needed to meter and charge for AI usage.
**Evidence:** `wrangler.jsonc:24-26` (`ai: { binding: "AI" }`, no usage metering), `workers/agent/index.ts:1-20` (agent uses Workers AI via `workers-ai-provider`, no usage accounting), `package.json` (no billing/payment SDK), `workers/lib/ai.ts` (AI calls with no usage tracking), `app/routes/settings.tsx` (no billing/plan/usage section).

---

## Market-signal notes (competitor moves / pricing shifts)

The referenced candidates file generated no market-signal content beyond the single TODO grep (no competitor or pricing data was captured). The following product-internal and upstream signals are noted for the market-signal role:

1. **Upstream (`cloudflare/agentic-inbox`) is a free Apache-2.0 template.** The product is forked from it (remote `cloudflare-upstream` → `https://github.com/cloudflare/agentic-inbox.git`). Upstream remains free with no pricing, so any externalized version competes against a free, Cloudflare-backed template. Differentiation (Attention Desk, push notifications, spam routing, MCP) is the only defensible position. No upstream pricing shift is visible.

2. **Workers AI model is `@cf/moonshotai/kimi-k2.5`.** `workers/agent/index.ts` uses this model via `workers-ai-provider`. Cloudflare Workers AI pricing is per-token; a model change or price shift would directly affect the product's AI cost structure. No recent price shift is visible in the repo, but the model choice is a cost lever.

3. **Pushover is the notification provider.** `workers/lib/attention-notifications.ts` uses Pushover API (`https://api.pushover.net/1/messages.json`) with an email fallback. Pushover pricing is one-time US$5 per platform — no recurring cost. No pricing shift is visible. If Pushover changes its model or API, the notification path breaks silently (Candidate 4) — and the disabled path (Candidate 5) has no operator surface.

4. **No direct competitor is visible.** The product occupies a niche (self-hosted AI support inbox on Cloudflare Workers) with no direct competitor in the available evidence. Adjacent competitors (Help Scout, Front, Missive) are SaaS with per-seat pricing; none are self-hostable on Workers.

No new competitor moves or pricing shifts are visible in the candidates file or product workspace as of 2026-08-21.