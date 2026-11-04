# Inbox list, threads and search

A user opens a folder, sees its emails grouped by conversation, opens one email or a whole thread, marks it read or starred, and searches across the mailbox.

## Sub-features

- `list-folder` lists a folder with a total count.
- `list-threaded` lists a folder grouped by conversation.
- `email-open` returns one email with its attachments.
- `email-update` marks an email read or starred, and refuses a bad body with 400.
- `thread-open` returns every email in a thread, oldest first.
- `search` finds emails by text, sender or folder.

## How to get to it (user POV)

- `/mailbox/<id>/emails/inbox` (the folder list), then select an email.
- The search box in the header, which opens `/mailbox/<id>/search?query=...`.

## Driving it with curl

Preconditions:

- `support@0509.io` exists and has received `Refund please` (`inbound-store`). Save its id: `ID=$(curl -s "$B/api/v1/mailboxes/support%400509.io/emails?folder=inbox" | python3 -c 'import json,sys; print(json.load(sys.stdin)["emails"][0]["id"])')`.

- **Folder list.** Run `curl -s "$B/api/v1/mailboxes/support%400509.io/emails?folder=inbox"`. `totalCount` 1.
- **Threaded.** Add `&threaded=true`. The row has `thread_count: 1`.
- **Open.** Run `curl -s $B/api/v1/mailboxes/support%400509.io/emails/$ID`. The body text is the email body, and `attachments` is `[]`.
- **Mark read.** Run `curl -s -X PUT -H 'content-type: application/json' -d '{"read":true}' $B/api/v1/mailboxes/support%400509.io/emails/$ID`. The response has `read: true`, and the folder list shows it too.
- **Bad update.** Send `{"read":"yes"}`. Status 400.
- **Thread.** Run `curl -s $B/api/v1/mailboxes/support%400509.io/threads/$ID`. One email.
- **Search.** Run `curl -s "$B/api/v1/mailboxes/support%400509.io/search?query=refund"`. `totalCount` 1. With `query=volcano`, `totalCount` 0.

## Gotchas

- `folder` takes a folder id (`inbox`, `sent`, `draft`, `archive`, `trash`, `spam`) or a folder name.
- `limit` is capped at 100.
- A new email's `thread_id` is its own id when it has no `In-Reply-To` or `References`.
