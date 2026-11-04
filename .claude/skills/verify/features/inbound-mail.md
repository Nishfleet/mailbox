# Inbound mail

A customer emails a brand address. The mailbox stores the email in the Inbox (or Spam), saves its attachments, forwards it when forwarding is on, and asks the agent for a draft reply.

## Sub-features

- `inbound-store` stores a new email in the Inbox, unread.
- `inbound-attachment` stores each attachment in R2 and lists it on the email.
- `inbound-unknown-mailbox` ignores mail for an address with no mailbox.
- `inbound-forward` forwards a copy when the mailbox's forwarding is on.
- `inbound-auto-draft` asks the agent for a draft (AI, remote only).

## How to get to it (user POV)

- Someone sends an email to the mailbox address. Cloudflare Email Routing calls the Worker's `email()` handler.

## Driving it with curl

Preconditions:

- The mailbox `support@0509.io` exists (`mailbox-create`).
- A file `$RUN/inbound.eml` with CRLF line ends:
  `printf 'From: Riya Customer <riya@example.com>\r\nTo: support@0509.io\r\nSubject: Refund please\r\nMessage-ID: <verify-1@example.com>\r\nDate: Wed, 04 Nov 2026 07:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nMy payment failed twice, please refund the charge.\r\n' > "$RUN/inbound.eml"`

- **Deliver.** Run `curl -s -w "\n%{http_code}\n" -X POST --data-binary @"$RUN/inbound.eml" "$B/cdn-cgi/handler/email?from=riya@example.com&to=support@0509.io"`. Status 200, body `Worker successfully processed email`.
- **Stored.** Run `curl -s "$B/api/v1/mailboxes/support%400509.io/emails?folder=inbox"`. `totalCount` is 1, and the email has subject `Refund please`, sender `riya@example.com` and `read: false`.
- **Unknown mailbox.** Run `sed 's/To: support@0509.io/To: nobody@0509.io/' "$RUN/inbound.eml" > "$RUN/inbound-nobody.eml"`, then deliver that file with `to=nobody@0509.io`. Status 200, `dev.log` shows `Ignoring email for nobody@0509.io: mailbox does not exist`, and the support Inbox count does not change.
- **Auto-draft (skip locally).** `dev.log` shows `Prompt injection scanner failed, skipping auto-draft: Binding AI needs to be run remotely`. Report `inbound-auto-draft` as not reachable locally.
- **Trace.** Query `spans` (see [../SKILL.md](../SKILL.md), Evidence). The newest root spans have outcome `ok`.

## Gotchas

- Bare `\n` line ends make the parser miss headers. Use CRLF.
- The Worker picks the mailbox from the `To:` header, not the `to=` envelope address. Delivering a file whose header says `support@0509.io` with `to=nobody@0509.io` stores it in support's Inbox (the dev log warns `"To" header: support@0509.io`). Keep the header and the envelope the same.
- With AI unreachable, a later email can log `Skipping auto-draft due to detected prompt injection` instead of the scanner failure. Neither proves auto-draft.
- The stored `date` is the receive time, not the `Date` header.
- Forwarding calls `message.forward()`, and the local handler does not show a real delivery. Prove `inbound-forward` with the `Forwarded email for ...` line in `dev.log`.
- A message from an owned domain with the internal header is stored as read and skips auto-draft.
