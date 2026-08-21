# AUDIT / REVIEW — 2026-08-21 — 0509-support-inbox

## Headline

The referenced input (`var/scout/CANDIDATES-2026-08-21-0509-support-inbox.md`) exists on the
fleet scout store, but as generated it carries only **one genuine candidate** — the
`OPEN TODO / FIXME` grep-surfaced `mailbox-delete-orphans-do-and-r2` item at
`workers/index.ts:204`. The remainder of the file is ~20 corrupted lines from a recursive grep
that descended into `node_modules` (890KB of `.map` source dumps plus two irrelevant Babel
`regenerator` TODOs) — not usable candidate content. The candidate set was therefore reconstructed
from the product workspace, with the single genuine input candidate carried forward as the top
survivor. Every survivor below carries a cited evidence source (file path + line number, commit,
or PR) that was re-verified against the current checkout.

**Revenue reality:** 0509-support-inbox is a self-hosted AI support inbox on Cloudflare Workers,
forked from `cloudflare/agentic-inbox` and extended with a cross-mailbox Attention Desk, Pushover
push notifications, spam routing, and MCP integration. It is not sold externally today; its value
is internal revenue acceleration across Nish's 8-domain portfolio (0509.io, 0509.in, inish.in,
tinystudio.io, tinystudio.in, aiconverter.app, siterep.net, seofixkit.com). Revenue impact is
scored as how much the item speeds revenue-bearing work (money/lead triage, faster replies, fewer
missed signals) or removes operator overhead that costs time. The single most important revenue
fact is unchanged since the last audit: **money and lead classification uses SQL substring
matching with no word boundaries** (`workers/durableObject/index.ts:698-699,173-176`), producing
false positives that pollute the revenue-triage buckets and false negatives that miss revenue
signals.

## Ranked survivors (max 5, priority=revenue)

1. **`mailbox-delete-orphans-do-and-r2`** (MEDIUM-HIGH revenue impact; code change, buildable now).
   This is the single genuine item surfaced by the input candidates file (TODO at
   `workers/index.ts:204`). `DELETE /api/v1/mailboxes/:mailboxId` removes only the R2 metadata key
   (`mailboxes/${mailboxId}.json`) and leaves an explicit TODO to "also delete DO data and R2
   attachment blobs". Orphaned DO SQLite state can surface phantom attention signals
   (`workers/lib/attention.ts:148-167` `getConfiguredMailboxIds` merges `EMAIL_ADDRESSES` with
   stored mailbox IDs; a stale mailbox can still be queried), and orphaned R2 attachment blobs
   inflate storage costs and slow `listMailboxes` directory scans. Wasted operator time on ghost
   mailboxes is direct revenue-time loss.
   Evidence: `workers/index.ts:200-206` (DELETE handler, TODO at 204),
   `workers/durableObject/index.ts:616` (per-email `deleteEmail`, no bulk purge),
   `workers/lib/attention.ts:148-167` (getConfiguredMailboxIds).

2. **`attention-keyword-match-is-substring-only`** (MEDIUM-HIGH revenue impact; code change,
   buildable now). The Attention Desk's money and lead buckets are the primary revenue-triage
   surface. `workers/durableObject/index.ts:698-699` uses `categoryCondition(MONEY_TERMS)` /
   `categoryCondition(LEAD_TERMS)`, and `categoryCondition`/`categoryParams`
   (`workers/durableObject/index.ts:173-176`) build unanchored `LIKE '%term%'` clauses over the
   concatenated subject+sender+recipient text (`ATTENTION_SEARCH_TEXT_SQL`,
   `workers/durableObject/index.ts:58-59`). Substring matching produces false positives ("charge"
   in "discharge", "plan" in "plane") that pollute money/lead buckets, and misses synonyms not in
   the hardcoded term lists. The JS-side `AGENT_DESK_RULES` (`workers/lib/attention-workflow.js`)
   uses `\b` word boundaries — an inconsistency between the two classification layers.
   Evidence: `workers/durableObject/index.ts:698-699,44-56,58-59,173-176`,
   `workers/lib/attention-workflow.js:22-35`, commits `1db7b7c`, `3914a07`.

3. **`attention-notification-no-test-coverage-for-pushover-api-path`** (MEDIUM revenue impact;
   test/eval addition, buildable now). The Pushover push notification
   (`workers/lib/attention-notifications.ts:sendPushoverNotification`) is the primary delivery
   method for real-time money/lead/act-now alerts to Nish's phone. If the Pushover API path
   breaks, the operator silently stops receiving revenue-critical alerts. The eval script
   (`scripts/eval-attention-notifications.mjs:1-14`) tests the decision logic and email-fallback
   builders but never exercises `sendPushoverNotification` or `runAttentionNotificationCheck` with
   a real or mocked Pushover API call.
   Evidence: `scripts/eval-attention-notifications.mjs:1-14` (no delivery-module import),
   `workers/lib/attention-notifications.ts:55-80,98-125,127-141`,
   `workers/app.ts:114-125` (scheduled handler logs result only to console), commits `4c5aaad`,
   `ec0ad76`.

4. **`no-send-rate-limit-config-visible-to-operator`** (MEDIUM revenue impact; code change,
   buildable now). `checkSendRateLimit()` (`workers/durableObject/index.ts:1155-1170`) gates
   outbound email with a 429 when exceeded ("max 20 emails per hour per mailbox"), but the
   threshold/window are DO-internal with no env var, no settings UI, and no Attention Desk
   visibility. If too aggressive, legitimate money/lead replies are silently blocked. The
   agent-initiated send path (`workers/lib/tools.ts:62-72` `getSendStub`) has the same blind 429.
   Evidence: `workers/durableObject/index.ts:1155-1170`, `workers/index.ts:251-252`,
   `workers/lib/tools.ts:62-72`, `wrangler.jsonc`, `app/routes/settings.tsx`.

5. **`attention-notification-disabled-path-silent`** (MEDIUM revenue impact; code change,
   buildable now). When no Pushover destination env vars are set, `getDeliveryMethod` returns
   `null` and `runAttentionNotificationCheck` returns `{ status: "disabled",
   reason: "missing-pushover-destination" }` (`workers/lib/attention-notifications.ts:127-141`) —
   a silent no-op. The cron handler (`workers/app.ts:114-125`) logs it to Worker logs only; the
   operator has no UI visibility into whether notifications are active, disabled, or failing. If
   Pushover env vars are accidentally unset during a redeploy or secret rotation, revenue-critical
   alerts silently stop with no surface-level signal.
   Evidence: `workers/lib/attention-notifications.ts:127-141`, `workers/app.ts:114-125`,
   `app/routes/home.tsx` (Attention Desk renders buckets but no notification status).

## INBOX lines to append (each its own line, priority=revenue, original slug tag)

```
[0509-support-inbox] priority=revenue mailbox-delete-orphans-do-and-r2: DELETE /api/v1/mailboxes (workers/index.ts:204) only removes the R2 metadata key — TODO acknowledges DO SQLite data and R2 attachment blobs are orphaned. Phantom attention signals from orphaned DO state waste operator time on ghost mailboxes. Add a DO purge method and R2 attachment cleanup. Evidence: workers/index.ts:200-206, workers/durableObject/index.ts:616, workers/lib/attention.ts:148-167.
[0509-support-inbox] priority=revenue attention-keyword-match-is-substring-only: Money/lead attention classification (workers/durableObject/index.ts:698-699) uses unanchored SQL LIKE substring matching (categoryCondition/categoryParams at 173-176) with no word boundaries — false positives (charge in discharge, plan in plane) pollute revenue-triage buckets; LEAD_TERMS (44-56) includes broad substrings. Enforce word boundaries and expand term lists. Evidence: workers/durableObject/index.ts:698-699,44-56,58-59,173-176, workers/lib/attention-workflow.js:22-35, commits 1db7b7c,3914a07.
[0509-support-inbox] priority=revenue attention-notification-no-test-coverage-for-pushover-api-path: Pushover API delivery (workers/lib/attention-notifications.ts:55-80) has zero test coverage — eval script (scripts/eval-attention-notifications.mjs:1-14) tests only decision logic, not delivery. If the Pushover path breaks, revenue-critical alerts silently stop. Add a mocked Pushover API test. Evidence: scripts/eval-attention-notifications.mjs:1-14, workers/lib/attention-notifications.ts:55-80,98-125,127-141, workers/app.ts:114-125, commits 4c5aaad,ec0ad76.
[0509-support-inbox] priority=revenue no-send-rate-limit-config-visible-to-operator: checkSendRateLimit (workers/durableObject/index.ts:1155-1170) gates sends with 429 but threshold is DO-internal with no env var, no settings UI, no Attention Desk visibility. Legitimate money/lead replies can be silently blocked. Surface as env vars and include limit in the 429 response. Evidence: workers/durableObject/index.ts:1155-1170, workers/index.ts:251-252, workers/lib/tools.ts:62-72, wrangler.jsonc, app/routes/settings.tsx.
[0509-support-inbox] priority=revenue attention-notification-disabled-path-silent: When no Pushover destination env vars are set, getDeliveryMethod returns null and runAttentionNotificationCheck returns disabled (workers/lib/attention-notifications.ts:127-141) silently — cron logs to Worker logs only, no UI surface. If env vars are accidentally unset during redeploy, revenue-critical alerts stop with no operator-visible signal. Add notification status to the Attention Desk. Evidence: workers/lib/attention-notifications.ts:127-141, workers/app.ts:114-125, app/routes/home.tsx.
```

## Market-signal role

**The input candidates file produced only a single TODO grep — no competitor or pricing
intelligence was captured by the scout machinery.** The following signals are noted from the
product workspace and upstream:

1. **Upstream (`cloudflare/agentic-inbox`) is a free Apache-2.0 template.** The product is forked
   from it (remote `cloudflare-upstream` → `https://github.com/cloudflare/agentic-inbox.git`).
   Upstream is free with no pricing; any externalized version competes against a free,
   Cloudflare-backed template. Differentiation (Attention Desk, push notifications, spam routing,
   MCP) is the only defensible position. No upstream pricing shift is visible.

2. **Workers AI model `@cf/moonshotai/kimi-k2.5`** — `workers/agent/index.ts` uses this model via
   `workers-ai-provider`. Cloudflare Workers AI pricing is per-token; a model change or price shift
   would directly affect the product's AI cost structure. No recent price shift is visible.

3. **Pushover is the notification provider** — `workers/lib/attention-notifications.ts` uses
   Pushover API with an email fallback. Pushover pricing is one-time US$5 per platform — no
   recurring cost. No pricing shift is visible. If Pushover changes its model or API, the
   notification path breaks silently (survivor #3) — and the disabled path (survivor #5) has no
   operator surface.

4. **No direct competitor is visible** — the product occupies a niche (self-hosted AI support
   inbox on Cloudflare Workers) with no direct competitor in the available evidence. Adjacent
   competitors (Help Scout, Front, Missive) are SaaS with per-seat pricing; none are self-hostable
   on Workers.

No new competitor moves or any pricing shifts are visible in the candidates file or product
workspace as of 2026-08-21.

## Rejected / dedup

- Candidate 6 (`no-public-landing-page-or-product-positioning`) — routed to NEEDS-NISH
  (product-direction/brand: whether to externalize the product).
- Candidate 7 (`no-multi-user-or-per-mailbox-auth`) — routed to NEEDS-NISH
  (pricing/brand: multi-tenant authorization depends on the externalization decision).
- Candidate 8 (`no-analytics-or-response-time-measurement`) — routed to NEEDS-NISH
  (brand/privacy: analytics tool and privacy posture choice).
- Candidate 9 (`no-billing-or-subscription-surface`) — routed to NEEDS-NISH
  (pricing: billing model and payment provider choice; contingent on externalization).
- The node_modules `.map` dumps and the two Babel `regenerator` TODOs in the input file are
  corrupted-grep noise (the recursive scan descended into `node_modules`), not candidates.

## Files

- Input candidates: `var/scout/CANDIDATES-2026-08-21-0509-support-inbox.md`
- Reconstructed candidates: `var/scout/CANDIDATES-2026-08-21-0509-support-inbox.md`
- Needs-Nish items: `var/scout/NEEDS-NISH.md`