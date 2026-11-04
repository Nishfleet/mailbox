# Compose, draft, reply, forward

A user writes a new email, saves a draft, replies to a customer in the same thread, or forwards an email. Each sent email is stored in Sent.

## Sub-features

- `send` stores a new email in Sent and hands it to the send binding.
- `send-rules` refuses a wrong From address, an owned-domain recipient, or a bad body with 400.
- `draft` saves or replaces a draft.
- `reply` sends a reply in the original thread.
- `forward` forwards an email with its threading headers.

## How to get to it (user POV)

- The "Compose" button, then "Send" or close to save a draft.
- "Reply" and "Forward" on an open email.

## Driving it with curl

Preconditions:

- `support@0509.io` exists and has received `Refund please`. `$ID` holds its id (see [inbox-list.md](./inbox-list.md)).

- **Send.** Run `curl -s -w "\n%{http_code}\n" -X POST -H 'content-type: application/json' -d '{"to":"riya@example.com","from":"support@0509.io","subject":"Hello","text":"Hi Riya"}' $B/api/v1/mailboxes/support%400509.io/emails`. Status 202, `status: "sent"`. `?folder=sent` then lists `Hello`.
- **Wrong From.** Send with `"from":"other@0509.io"`. Status 400, `From address must match the mailbox email address`.
- **Owned-domain recipient.** Send with `"to":"sales@0509.io"`. Status 400.
- **Bad body.** Send `{"to":"riya@example.com"}`. Status 400.
- **Draft.** Run `curl -s -X POST -H 'content-type: application/json' -d '{"to":"riya@example.com","subject":"Later","body":"<p>draft</p>"}' $B/api/v1/mailboxes/support%400509.io/drafts`. Status 201. `?folder=draft` lists `Later`.
- **Reply.** POST the send body with `"subject":"Re: Refund please"` to `$B/api/v1/mailboxes/support%400509.io/emails/$ID/reply`. Status 202. `threads/$ID` now has 2 emails.
- **Forward.** POST the send body to `.../emails/$ID/forward`. Status 202.

## Gotchas

- Locally the send binding is simulated, so nothing leaves the machine. The proof is the Sent row and `dev.log`.
- The rate limit is 20 sends per hour and 100 per day per mailbox. A long run can hit 429.
- Either `text` or `html` is required.
