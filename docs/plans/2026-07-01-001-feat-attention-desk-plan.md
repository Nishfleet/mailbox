---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
date: 2026-07-01
title: "feat: Add Attention Desk"
---

# feat: Add Attention Desk

## Goal Capsule

Build a top-level Attention Desk for the support inbox so Nish can open the app and immediately see what needs action across every configured domain. The first release must stay human-in-the-loop: classify and route attention, expose drafts, and give agents the same summary, but do not auto-send or mutate emails.

## Problem Frame

The mailbox list now shows pending counts, but it still makes the operator scan every domain to understand urgency, money, leads, aging support, and draft readiness. The product needs an operator layer above raw mailboxes.

## Requirements

- R1: Show a cross-mailbox action summary above the mailbox list.
- R2: Classify attention into Act now, Money, Leads, Aging, and Drafts ready using server-side data.
- R3: Show status when a mailbox cannot be checked, instead of silently hiding uncertainty.
- R4: Preserve safe human review; new work may link to inboxes and drafts but must not auto-send.
- R5: Expose the same summary through the app API and MCP so agents can decide what to inspect first.
- R6: Keep configured-domain behavior intact for all existing mailboxes.

## Key Technical Decisions

- KTD1: Add one aggregate `/api/v1/attention` endpoint instead of expanding the mailbox list response again. This keeps the existing mailbox contract simple and gives agents a focused operating surface.
- KTD2: Compute first-pass triage inside each mailbox Durable Object with bounded SQL and per-mailbox timeouts. The feature should degrade per mailbox rather than failing the whole dashboard.
- KTD3: Use deterministic heuristics for the first release. AI classification can be added later, but the operator needs fast, explainable buckets now.
- KTD4: Render the Attention Desk as a compact app surface above Mailboxes, reusing existing Kumo and Phosphor conventions.

## Implementation Units

### U1. Server Attention Summary

**Goal:** Add typed attention summary data across every mailbox.

**Requirements:** R1, R2, R3, R6

**Dependencies:** none

**Files:** `workers/durableObject/index.ts`, `workers/index.ts`, `app/types/index.ts`

**Approach:** Add a Durable Object method that returns counts, freshness dates, and a small set of top items for one mailbox. Add an aggregate API route that lists configured mailboxes, calls each Durable Object with a timeout, combines bucket counts, and marks unavailable mailboxes explicitly.

**Patterns to follow:** `getInboxUnreadCount`, `/api/v1/mailboxes`, threaded inbox query fields.

**Test scenarios:** API returns all bucket totals when mailbox summaries resolve; unavailable Durable Objects produce `status: "unavailable"` and do not block other mailboxes; configured mailboxes with no R2 mailbox row still return zeroed attention.

**Verification:** Typecheck and live API call show a summary object with total counts, bucket rows, mailbox statuses, and top items.

### U2. Frontend Attention Desk

**Goal:** Render the attention summary above the mailbox list.

**Requirements:** R1, R2, R3, R4

**Dependencies:** U1

**Files:** `app/services/api.ts`, `app/queries/keys.ts`, `app/queries/mailboxes.ts`, `app/queries/emails.ts`, `app/routes/home.tsx`, `app/types/index.ts`

**Approach:** Add a React Query hook for the attention endpoint, invalidate it after email mutations, and render a compact status panel with bucket totals, key mailbox/item hints, and folder links.

**Patterns to follow:** `useMailboxes`, mailbox pending badge, email mutation invalidation.

**Test scenarios:** Loading state does not jump the mailbox layout; zero-attention state reads as clear; nonzero buckets show counts and links; unavailable checks are visible; mutation invalidation refreshes both mailbox counts and attention.

**Verification:** Build/typecheck pass and browser/API verification confirms rendered data comes from the new endpoint.

### U3. Agent-Readable Attention Tool

**Goal:** Give MCP clients the same Attention Desk summary.

**Requirements:** R5

**Dependencies:** U1

**Files:** `workers/lib/tools.ts`, `workers/mcp/index.ts`

**Approach:** Add a shared `toolGetAttentionSummary` function and MCP `get_attention_summary` tool that returns the same aggregate shape used by the UI.

**Patterns to follow:** `toolListMailboxes`, MCP `list_mailboxes`.

**Test scenarios:** MCP tool can be typechecked; output includes buckets, mailboxes, and top items without requiring a mailboxId.

**Verification:** Typecheck passes and endpoint data shape matches the UI type.

## Verification Contract

- `npm run typecheck`
- `npm run build`
- Run review gates on the final diff.
- Deploy with the safe-deploy wrapper.
- Verify live `/api/v1/attention` and the app page after deploy.

## Definition of Done

The app opens to an Attention Desk that answers whether anything needs action across all domains, the API and MCP expose the same summary, review gates are clean, production is deployed, and live data verifies the feature.
