# AUDIT / REVIEW — 2026-08-20 — 0509-support-inbox

## Headline

The referenced input (`var/scout/CANDIDATES-2026-08-20-0509-support-inbox.md`) did **not exist**
when this run started (verified by filesystem-wide search; no `var/scout/` directory
was present and no prior scout produced candidates for `0509-support-inbox`). The candidate set
was therefore reconstructed directly from the product repo
(see `CANDIDATES-2026-08-20-0509-support-inbox.md`). Every survivor below carries a cited
evidence source (file path + line number, commit, or PR).

**Revenue reality:** 0509-support-inbox is a self-hosted AI support inbox on Cloudflare Workers,
forked from `cloudflare/agentic-inbox` and extended with a cross-mailbox Attention Desk,
Pushover push notifications, spam routing, and MCP integration. It is not sold externally today;
its value is internal revenue acceleration across Nish's 8-domain portfolio (0509.io, inish.in,
tinystudio.io, aiconverter.app, siterep.net, etc.). Revenue impact is scored as how much the
item speeds revenue-bearing work (money/lead triage, faster replies, fewer missed signals) or
removes operator overhead that costs time. The single most important revenue fact is that
**money and lead classification uses SQL substring matching with no word boundaries**
(`workers/durableObject/index.ts:698-699`), producing false positives that pollute the
revenue-triage buckets and false negatives that miss revenue signals.

## Ranked survivors (max 5, priority=revenue)

1. **`attention-keyword-match-is-substring-only`** (MEDIUM-HIGH revenue impact; code change,
   buildable now).
   The Attention Desk's money and lead buckets are the primary revenue-triage surface.
   `workers/durableObject/index.ts:698-699` uses `categoryCondition(MONEY_TERMS)` /
   `categoryCondition(LEAD_TERMS)` which build SQL `LIKE` clauses matching substrings in
   concatenated subject+sender+recipient text. Substring matching produces false positives
   (e.g. "charge" in "discharge", "plan" in "plane") that pollute money/lead buckets with
   non-revenue mail, and misses signals using synonyms not in the hardcoded term lists. The
   JS-side `AGENT_DESK_RULES` (`workers/lib/attention-workflow.js:22-35`) uses `\b` word
   boundaries but the SQL-side classification that feeds the buckets does not — an
   inconsistency between the two layers.
   Evidence: `workers/durableObject/index.ts:698-699` (moneyWhere/leadWhere use
   categoryCondition), `workers/durableObject/index.ts:44-56` (MONEY_TERMS/LEAD_TERMS
   hardcoded, LEAD_TERMS includes broad "pricing" and "plan"), `workers/durableObject/index.ts:58-59`
   (ATTENTION_SEARCH_TEXT_SQL concatenates fields, no word-boundary enforcement),
   `workers/lib/attention-workflow.js:22-35` (AGENT_DESK_RULES uses \b word boundaries),
   commit `1db7b7c` (feat: add cross-mailbox attention desk).

2. **`mailbox-delete-orphans-do-and-r2`** (MEDIUM-HIGH revenue impact; code change, buildable now).
   `workers/index.ts:204` — the `DELETE /api/v1/mailboxes/:mailboxId` handler deletes only the
   R2 metadata key (`mailboxes/${mailboxId}.json`) and explicitly leaves a TODO: "also delete
   DO data and R2 attachment blobs". Orphaned DO state can surface phantom attention signals
   (`workers/lib/attention.ts:148-167` `getConfiguredMailboxIds` merges EMAIL_ADDRESSES with
   stored mailbox IDs; a deleted mailbox with DO state still gets queried). Phantom money/lead
   counts waste operator time on ghost mailboxes — direct revenue-time loss. Orphaned R2
   attachment blobs inflate storage costs and slow `listMailboxes` directory scans.
   Evidence: `workers/index.ts:200-206` (DELETE handler, TODO at line 204),
   `workers/durableObject/index.ts:616` (deleteEmail exists per-email but no bulk purge),
   `workers/lib/attention.ts:148-167` (getConfiguredMailboxIds merges configured + stored IDs).

3. **`attention-notification-no-test-coverage-for-pushover-api-path`** (MEDIUM revenue impact;
   test/eval addition, buildable now).
   The Pushover push notification (`workers/lib/attention-notifications.ts:sendPushoverNotification`)
   is the primary delivery method for real-time money/lead/act-now alerts to Nish's phone. If
   the Pushover API path breaks, the operator silently stops receiving revenue-critical alerts.
   The eval script (`scripts/eval-attention-notifications.mjs`) tests
   `buildAttentionNotification`, `shouldSendAttentionNotification`,
   `buildAttentionNotificationEmail`, and `isHighConfidenceSpam` — but never exercises
   `sendPushoverNotification` or `runAttentionNotificationCheck` with a real or mocked Pushover
   API call. The `disabled` path (no Pushover env vars) is also untested — a silent no-op with
   no operator visibility.
   Evidence: `scripts/eval-attention-notifications.mjs:1-10` (imports only core decision logic,
   no delivery module), `workers/lib/attention-notifications.ts:55-80` (sendPushoverNotification
   makes real fetch with zero coverage), `workers/lib/attention-notifications.ts:101-106`
   (getDeliveryMethod returns null silently), `workers/app.ts:67-76` (scheduled handler logs
   result but disabled status is only in Worker logs), commit `4c5aaad` + `ec0ad76` (added
   delivery code, eval not extended).

4. **`no-send-rate-limit-config-visible-to-operator`** (MEDIUM revenue impact; code change,
   buildable now).
   `checkSendRateLimit()` (`workers/durableObject/index.ts:1157`) gates outbound email with a
   429 when exceeded, but the threshold/window are DO-internal with no env var, no settings UI,
   and no Attention Desk visibility. If too aggressive, legitimate money/lead replies are
   silently blocked. The operator sees only the error string in the compose flow with no context
   about the limit. The agent-initiated send path (`workers/lib/tools.ts:62-72` `getSendStub`)
   has the same blind 429.
   Evidence: `workers/durableObject/index.ts:1157` (checkSendRateLimit, threshold internal),
   `workers/index.ts:251-252` (429 returned, no limit context), `workers/lib/tools.ts:62-72`
   (getSendStub also hits rate limit, agent gets bare error), `wrangler.jsonc` (no rate-limit
   env vars), `app/routes/settings.tsx` (settings UI has only fromName + agentSystemPrompt).

5. **`attention-notification-disabled-path-silent`** (MEDIUM revenue impact; code change,
   buildable now).
   When no Pushover env vars are configured, `runAttentionNotificationCheck` returns
   `{ status: "disabled", reason: "missing-pushover-destination" }` — a silent no-op. The cron
   handler (`workers/app.ts:67-76`) logs this to Worker logs only. The operator has no UI
   visibility into whether notifications are active, disabled, or failing. If Pushover env vars
   are accidentally unset (e.g. during a redeploy or secret rotation), revenue-critical alerts
   silently stop with no surface-level signal. This is distinct from Candidate 4 (which covers
   the delivery path's test coverage); this covers the operator's inability to detect the
   disabled state.
   Evidence: `workers/lib/attention-notifications.ts:101-106` (getDeliveryMethod returns null
   when no env vars), `workers/lib/attention-notifications.ts:113-120` (runAttentionNotificationCheck
   returns disabled status), `workers/app.ts:67-76` (scheduled handler logs result, no UI
   surface), `app/routes/home.tsx` (Attention Desk renders buckets but no notification status).

## INBOX lines to append (each its own line, priority=revenue, original slug tag)

```
[0509-support-inbox] priority=revenue attention-keyword-match-is-substring-only: Money/lead attention classification (workers/durableObject/index.ts:698-699) uses SQL LIKE substring matching with no word boundaries — false positives (charge in discharge, plan in plane) pollute revenue-triage buckets; LEAD_TERMS (line 44-56) includes broad substrings. Enforce word boundaries and expand term lists. Evidence: workers/durableObject/index.ts:698-699,44-56,58-59, workers/lib/attention-workflow.js:22-35, commit 1db7b7c.
[0509-support-inbox] priority=revenue mailbox-delete-orphans-do-and-r2: DELETE /api/v1/mailboxes (workers/index.ts:204) only removes R2 metadata key — TODO acknowledges DO data and R2 attachment blobs are orphaned. Phantom attention signals from orphaned DO state waste operator time on ghost mailboxes. Add DO purge method and R2 attachment cleanup. Evidence: workers/index.ts:200-206, workers/durableObject/index.ts:616, workers/lib/attention.ts:148-167.
[0509-support-inbox] priority=revenue attention-notification-no-test-coverage-for-pushover-api-path: Pushover API delivery (workers/lib/attention-notifications.ts:55-80) has zero test coverage — eval script tests only decision logic, not delivery. If Pushover path breaks, revenue-critical alerts silently stop. Add mocked Pushover API test to scripts/eval-attention-notifications.mjs. Evidence: scripts/eval-attention-notifications.mjs:1-10, workers/lib/attention-notifications.ts:55-80,101-106, workers/app.ts:67-76, commits 4c5aaad,ec0ad76.
[0509-support-inbox] priority=revenue no-send-rate-limit-config-visible-to-operator: checkSendRateLimit (workers/durableObject/index.ts:1157) gates sends with 429 but threshold is DO-internal with no env var, no settings UI, no Attention Desk visibility. Legitimate money/lead replies can be silently blocked. Surface as env vars and include limit in 429 response. Evidence: workers/durableObject/index.ts:1157, workers/index.ts:251-252, workers/lib/tools.ts:62-72, wrangler.jsonc, app/routes/settings.tsx.
[0509-support-inbox] priority=revenue attention-notification-disabled-path-silent: When no Pushover env vars are set, runAttentionNotificationCheck (workers/lib/attention-notifications.ts:101-120) returns disabled silently — cron logs to Worker logs only, no UI surface. If env vars are accidentally unset during redeploy, revenue-critical alerts stop with no operator-visible signal. Add notification status to Attention Desk. Evidence: workers/lib/attention-notifications.ts:101-120, workers/app.ts:67-76, app/routes/home.tsx.
```

## Market-signal role

**No new competitor moves or pricing shifts detected from a candidates file** — the
referenced input file was absent. The following signals are noted from the product workspace
and upstream:

1. **Upstream (cloudflare/agentic-inbox) is a free Apache-2.0 template** — the product is
   forked from `cloudflare/agentic-inbox` (remote `cloudflare-upstream`). The upstream is free
   with no pricing. Any externalized version competes against a free, Cloudflare-backed
   template. Differentiation (Attention Desk, push notifications, spam routing, MCP) is the
   only defensible position. No upstream pricing shift is visible.

2. **Workers AI model `@cf/moonshotai/kimi-k2.5`** — `workers/agent/index.ts` uses this model
   via `workers-ai-provider`. Cloudflare Workers AI pricing is per-token; a model change or
   price shift would directly affect the product's AI cost structure. No recent price shift is
   visible in the repo.

3. **Pushover is the notification provider** — `workers/lib/attention-notifications.ts` uses
   Pushover API with an email fallback. Pushover pricing is one-time $5 per platform — no
   recurring cost. No pricing shift is visible. If Pushover changes its model or API, the
   notification path breaks silently (survivor #3).

4. **No direct competitor is visible** — the product occupies a niche (self-hosted AI support
   inbox on Cloudflare Workers) with no direct competitor in the available evidence. Adjacent
   competitors (Help Scout, Front, Missive) are SaaS with per-seat pricing; none are
   self-hostable on Workers.

No new competitor moves or pricing shifts are visible in the candidates file or product
workspace as of 2026-08-20.

## Rejected / dedup

- Candidate 5 (`no-public-landing-page-or-product-positioning`) — routed to NEEDS-NISH
  (product-direction/brand: whether to externalize the product).
- Candidate 6 (`no-multi-user-or-per-mailbox-auth`) — routed to NEEDS-NISH
  (pricing/brand: multi-tenant authorization depends on externalization decision).
- Candidate 7 (`no-analytics-or-response-time-measurement`) — routed to NEEDS-NISH
  (brand/privacy: analytics tool and privacy posture choice).
- Candidate 8 (`no-billing-or-subscription-surface`) — routed to NEEDS-NISH
  (pricing: billing model and payment provider choice; contingent on externalization).
- All four NEEDS-NISH items have cited evidence but the core work requires a Nish decision
  before implementation can proceed.

## Files

- Input candidates: `var/scout/CANDIDATES-2026-08-20-0509-support-inbox.md`
- Needs-Nish items: `var/scout/NEEDS-NISH.md`
