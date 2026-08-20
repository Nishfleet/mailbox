# NEEDS-NISH — 2026-08-20 — 0509-support-inbox

Items that need a Nish decision before the revenue-impact candidate can proceed.
Categorized as pricing / brand / legal / delete per the scout rule.

## 1. Decide whether to externalize the product (product-direction / brand)

- The product is a capable self-hosted AI support inbox with Attention Desk, push notifications,
  spam routing, and MCP integration — feature parity with (and exceeds) the upstream
  `cloudflare/agentic-inbox`. But there is no public landing page, no product positioning, and
  no signup/onboarding flow. Cloudflare Access blocks all unauthenticated traffic.
- **Decision needed:** should this remain an internal tool for Nish's portfolio, or be
  positioned and offered externally (self-hostable SaaS, Cloudflare Workers template, open-source
  with paid hosting)? This is the root decision — Candidates 6, 7, and 8 below are all
  contingent on it.
- Cited evidence: `README.md:1-98` (developer setup only, no product positioning),
  `app/routes/home.tsx:502-508` (root route is Mailboxes list, no landing page),
  `workers/app.ts:38-56` (Access JWT blocks all unauthenticated requests),
  `wrangler.jsonc:18` (8 owned domains, no external-facing surface on any),
  `app/routes/not-found.tsx` (404 route, no public/marketing route).
- Revenue impact: HIGH — the product is a sellable asset with zero external visibility today.

## 2. Decide multi-tenant authorization model (pricing / brand)

- The product enforces a single trust boundary (Cloudflare Access). Any Access-authenticated
  user can read and operate on every mailbox across all 8 domains. The MCP server at `/mcp`
  has the same single-boundary model. If externalized, each customer must only see their own
  mailboxes.
- **Decision needed:** should the product support per-mailbox or per-tenant authorization?
  If yes, what auth model (per-mailbox RBAC, tenant-scoped Access policies, separate deploys
  per tenant)? This is contingent on the externalization decision above.
- Cited evidence: `workers/app.ts:54-56` (comment: any Access user can access all mailboxes),
  `workers/index.ts:115` (requireMailbox checks existence, not authorization),
  `workers/lib/mailbox.ts` (requireMailbox resolves DO stub, no per-user auth),
  `README.md:79` (MCP server has same single-boundary model),
  `app/routes/home.tsx:416-440` (auto-creates mailboxes from EMAIL_ADDRESSES, no user-scoping).
- Revenue impact: HIGH — multi-tenant isolation is a prerequisite for any external revenue.

## 3. Choose analytics and response-time measurement (brand / privacy)

- The Attention Desk counts signals (money, leads, aging) but does not track response times,
  resolution rates, or revenue-attributed outcomes. Without measurement, the product's
  revenue-acceleration value is unmeasurable and bottlenecks cannot be identified.
- **Decision needed:** which analytics/measurement approach (self-hosted vs SaaS, privacy
  posture, what metrics define "revenue impact" — response time, resolution rate, conversion
  attribution)? This is a brand and privacy decision.
- Cited evidence: `workers/lib/attention.ts:24-40` (BUCKETS defines counts, no time-to-response
  or resolution metrics), `workers/durableObject/index.ts:682-801` (getAttentionSummary counts
  items, no response-time computation), `workers/app.ts:67-76` (cron handler runs notifications,
  no analytics events), no analytics/tracking/telemetry code in `workers/` or `app/`.
- Revenue impact: MEDIUM — cannot prove or optimize revenue acceleration without measurement.

## 4. Choose billing and payment integration (pricing)

- If the product is externalized, it needs a billing surface. There is no Stripe, no
  subscription management, no usage-based billing, and no payment integration. The product
  uses Workers AI (`@cf/moonshotai/kimi-k2.5`) which has per-request costs — billing would be
  needed to meter and charge for AI usage.
- **Decision needed:** which billing model (subscription, usage-based, freemium), which pricing
  tiers, and which payment provider (Stripe, Lemon Squeezy, etc.)? Contingent on the
  externalization decision.
- Cited evidence: `wrangler.jsonc:24-26` (AI binding, no usage metering),
  `workers/agent/index.ts:1-20` (agent uses Workers AI, no usage accounting),
  `package.json:23` (no Stripe/billing/payment SDK in dependencies),
  `workers/lib/ai.ts:38-50` (AI calls with no usage tracking),
  `app/routes/settings.tsx` (settings UI has no billing/plan/usage section).
- Revenue impact: HIGH — no billing surface means no external revenue is possible.

## Not applicable

- **legal / delete:** no legal or delete items exist in the current repo evidence. The
  `workers/index.ts:204` TODO for mailbox deletion data cleanup is a code defect (survivor #2
  in the audit), not a Nish-reserved decision — the fix is to delete orphaned data, which is
  the obvious correct action. The spam routing (`workers/lib/spam.js`) and owned-domain
  delivery guard (`workers/lib/email-helpers.ts`) are existing safety decisions already
  implemented and not candidates for change.
