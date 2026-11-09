# Mailboxes

A user creates a mailbox for a brand address, reads it back, changes its display name, forwarding and agent prompt in Settings, and deletes it.

## Sub-features

- `mailbox-create` creates a mailbox with default settings.
- `mailbox-duplicate` refuses a second mailbox with the same address.
- `mailbox-read` returns the mailbox and its settings.
- `mailbox-settings` saves known settings keys and refuses a bad body with 400.
- `mailbox-delete` deletes the mailbox entry.

## How to get to it (user POV)

- The mailbox picker on `/` ("Create mailbox").
- `/mailbox/<id>/settings` (display name, agent prompt).

## Driving it with curl

Preconditions:

- Baseline state. No mailbox `support@0509.io` exists.

- **Create.** Run `curl -s -w "\n%{http_code}\n" -X POST -H 'content-type: application/json' -d '{"email":"support@0509.io","name":"Support"}' $B/api/v1/mailboxes`. Status 201, and `settings.fromName` is `Support`.
- **Stored.** Run `curl -s $B/cdn-cgi/local/explorer/api/r2/buckets/0509-support-inbox/objects`. The key `mailboxes/support@0509.io.json` exists.
- **Duplicate.** Repeat the create. Status 409.
- **Read.** Run `curl -s $B/api/v1/mailboxes/support%400509.io`. Status 200 with the same settings.
- **Settings.** Run `curl -s -w "\n%{http_code}\n" -X PUT -H 'content-type: application/json' -d '{"settings":{"fromName":"Support team","agentSystemPrompt":"Be brief."}}' $B/api/v1/mailboxes/support%400509.io`. Status 200, and the body's `name` is `Support team`. A second read shows both values.
- **Bad settings.** Send `{"settings":{"forwarding":"yes"}}` to the same route. Status 400, and a second read shows the settings did not change.
- **Delete.** Run `curl -s -w "%{http_code}\n" -X DELETE $B/api/v1/mailboxes/support%400509.io`. Status 204. A read then gives 404.

## Gotchas

- List, read and settings-update return `name` from the stored display name (`settings.fromName`), falling back to the address when the name is empty or missing.
- Delete removes only the R2 entry. The mailbox's emails stay in its Durable Object.
- Unknown settings keys are dropped on save.
- The settings PUT replaces the whole settings object. After the Settings step, a read shows only `fromName` and `agentSystemPrompt`, and the default `forwarding`, `signature` and `autoReply` are gone.
- A stored settings object that does not parse (e.g. a hand-edited R2 file) reads back as the mailbox with `settings: null` and the address as `name`, and its inbound mail is not forwarded.
