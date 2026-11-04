# Attention desk

The attention desk shows, across all mailboxes, what needs a person: urgent mail, money, leads, mail unread for more than 24 hours, and drafts ready to send. A cron job sends a notification when the signals change.

## Sub-features

- `attention-buckets` counts each bucket across mailboxes.
- `attention-aging` counts inbox mail unread for more than 24 hours (the AGENTS.md success metric).
- `attention-notify` runs the 15-minute cron and decides whether to notify.

## How to get to it (user POV)

- `/?attention=1` (the "Attention Desk" link in a notification).
- The MCP tool `get_attention_summary` (needs AI and a remote preview).

## Driving it with curl

Preconditions:

- `support@0509.io` exists and has received `Refund please` (`inbound-store`).

- **Buckets.** Run `curl -s $B/api/v1/attention`. `unavailableMailboxCount` is 0. The `act_now` and `money` buckets each have count 1, and `aging` is 0.
- **Empty.** On a baseline instance with no mailboxes, every bucket count is 0.
- **Cron.** Run `curl -s -X POST "$B/cdn-cgi/local/explorer/api/local/scheduled?worker=0509-support-inbox" -H 'content-type: application/json' -d '{"cron":"*/15 * * * *"}'`. The response has `"outcome":"ok"`, and `dev.log` shows `Attention notification check finished { status: 'disabled', reason: 'missing-pushover-destination' }` when no Pushover keys are set.

## Gotchas

- `aging` needs mail older than 24 hours. A fresh run cannot reach it without old data, so report it as not reachable and say why.
- Read `aging` only when `unavailableMailboxCount` is 0.
