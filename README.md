# 0509 mailbox

The team mailbox for 0509. It is a copy of Cloudflare's open source [Agentic Inbox](https://github.com/cloudflare/agentic-inbox) (Apache 2.0, see [LICENSE](LICENSE)) running as the Worker `0509-support-inbox` (the repo is `0509-mailbox`; the Worker keeps its old name so Email Routing keeps pointing at it). Email Routing on `0509.io` hands it the alerts, fleet-signup and catch-all addresses, and the team reads them in the web app behind Cloudflare Access.

Not to be confused with the support-report Worker in [Nishfleet/0509](https://github.com/Nishfleet/0509) (`workers/support-inbox.ts`, Worker `0509-support-inbox-v2`), which stores `support@0509.io` reports and opens issues. That one is part of the product repo; this repo is only the mailbox app.

## Deploying

Every push to `main` deploys through CI (`.github/workflows/deploy-production.yml`) after the checks pass. Do not run `npm run deploy` by hand except to recover.

## Local development

```bash
npm install
npm run dev
```

The Worker fails closed outside local development unless `POLICY_AUD` and `TEAM_DOMAIN` (Cloudflare Access) are set as Worker secrets.

## Features

- **Full email client** — Send and receive emails via Cloudflare Email Routing with a rich text composer, reply/forward threading, folder organization, search, and attachments
- **Per-mailbox isolation** — Each mailbox runs in its own Durable Object with SQLite storage and R2 for attachments
- **Built-in AI agent** — Side panel with 10 email tools for attention summaries, reading, searching, drafting, and sending
- **Auto-draft on new email** — Agent automatically reads inbound emails and generates draft replies, always requiring explicit confirmation before sending. Spam is skipped, and drafts are capped per mailbox per UTC day by `AUTO_DRAFT_DAILY_LIMIT` (default 200, `0` turns auto-drafting off)
- **Configurable and persistent** — Custom system prompts per mailbox, persistent chat history, streaming markdown responses, and tool call visibility

## Attention notifier (15-minute cron)

`wrangler.jsonc` runs the Worker on the stock Cloudflare cron trigger `*/15 * * * *`. Each tick, the scheduled handler in `workers/app.ts` calls `runAttentionNotificationCheck` (`workers/lib/attention-notifications.ts`), which builds the same attention summary the Attention Desk shows and sends at most one Pushover message when the priority set changes.

- **What sends** — an action in the `money`, `leads` or `act_now` bucket, up to `ATTENTION_NOTIFY_MAX_ACTIONS` of them. The checked set is fingerprinted, so the same set never sends twice no matter how many ticks pass, and a new or changed action sends on the next tick.
- **State** — `ops/attention-notification-state.json` in the `BUCKET` R2 bucket holds the last sent time, fingerprint, signal and action counts, cron string, delivery method, and the Pushover request id or email message id. Delete the object to forget the last message and let the next tick send again.
- **Delivery** — the Pushover API when `PUSHOVER_APP_TOKEN` and `PUSHOVER_USER_KEY` are set, otherwise an email through the `EMAIL` binding to `PUSHOVER_EMAIL_ALIAS`. With neither configured the check logs `disabled` and sends nothing.

Settings in `wrangler.jsonc` under `vars`:

| Variable | Default | Effect |
| --- | --- | --- |
| `ATTENTION_NOTIFY_BASE_URL` | `https://0509-support-inbox.nishant345.workers.dev` | Base URL of the "Open Attention Desk" link in the message. |
| `ATTENTION_NOTIFY_MIN_SIGNALS` | `1` | Minimum total attention signal count before a message can be sent. |
| `ATTENTION_NOTIFY_COOLDOWN_MINUTES` | `60` | Window used to label the log result `unchanged-cooldown` or `unchanged` when the set did not change. It does not delay a changed set. |
| `ATTENTION_NOTIFY_MAX_ACTIONS` | `3` | Actions listed in one message. |

Secrets, set with `npx wrangler secret put <NAME>` rather than in `wrangler.jsonc`:

| Secret | Effect |
| --- | --- |
| `PUSHOVER_APP_TOKEN` | Pushover application token. With `PUSHOVER_USER_KEY`, selects API delivery. |
| `PUSHOVER_USER_KEY` | Pushover user key. With `PUSHOVER_APP_TOKEN`, selects API delivery. |
| `PUSHOVER_EMAIL_ALIAS` | Pushover email alias. Selects email delivery when the API pair is not set. |
| `ATTENTION_NOTIFY_FROM_EMAIL` | From address for email delivery; defaults to `alerts@0509.io`. |

### Switching it off

1. Remove the `triggers.crons` block from `wrangler.jsonc` and deploy. No scheduled run then happens.
2. Unset the Pushover settings (`npx wrangler secret delete PUSHOVER_APP_TOKEN`, and the same for `PUSHOVER_USER_KEY` and `PUSHOVER_EMAIL_ALIAS`). Each tick then logs `disabled` and sends nothing.

`workers/attention-notifications.test.ts` covers the send decision and the message format, and CI runs it with `npm test`.

## Stack

- **Frontend:** React 19, React Router v7, Tailwind CSS, Zustand, TipTap, `@cloudflare/kumo`
- **Backend:** Hono, Cloudflare Workers, Durable Objects (SQLite), R2, Email Routing
- **AI Agent:** Cloudflare Agents SDK (`AIChatAgent`), AI SDK v6, Workers AI (`@cf/moonshotai/kimi-k2.5`), `react-markdown` + `remark-gfm`
- **Auth:** Cloudflare Access JWT validation (required outside local development)

## Prerequisites

- Cloudflare account with a domain
- [Email Routing](https://developers.cloudflare.com/email-routing/) enabled for receiving
- [Email Service](https://developers.cloudflare.com/email-service/) enabled for sending
- [Workers AI](https://developers.cloudflare.com/workers-ai/) enabled (for the agent)
- [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) configured for deployed/shared environments (required in production)

Any user who passes the shared Cloudflare Access policy can access all mailboxes in this app by design. This includes the MCP server at `/mcp` -- external AI tools (Claude Code, Cursor, etc.) connected via MCP can operate on any mailbox by passing a `mailboxId` parameter. There is no per-mailbox authorization; the Cloudflare Access policy is the single trust boundary.

MCP clients cannot send or permanently delete mail. `send_reply` and `send_email` save a draft that a person sends from the app, and `delete_email` moves the email to Trash.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────>│  Hono Worker     │────>│  MailboxDO      │
│  React SPA   │     │  (API + SSR)     │     │  (SQLite + R2)  │
│  Agent Panel │     │                  │     └─────────────────┘
└──────┬───────┘     │  /agents/* ──────┼────>┌─────────────────┐
       │             │                  │     │  EmailAgent DO  │
       │ WebSocket   │                  │     │  (AIChatAgent)  │
       └─────────────┤                  │     │ 10 email tools  │
                     │                  │────>│  Workers AI     │
                     └──────────────────┘     └─────────────────┘
```

## License

Apache 2.0 -- see [LICENSE](LICENSE).
