# Mailbox verification map

This directory is the maintained source for verifying the user-facing behavior of the mailbox app. Read this index before you drive the app, then use the matching feature file as the recipe.

## Baseline preconditions

- The app runs from a fresh worktree at `http://127.0.0.1:5199`, launched as [../SKILL.md](../SKILL.md) says, with `$RUN` set and the doctor passing.
- The data dir (`.wrangler/state`) starts empty. There are no mailboxes until a recipe creates one.
- `EMAIL_ADDRESSES` is `[]` in `wrangler.jsonc`, so any address on a configured domain can be a mailbox.
- Never drive an instance that this run did not start.
- Every JSON route validates its body with `zValidator` (PR #123). A bad body gets status 400 and a body `{"success":false,"error":{"name":"ZodError",...}}`. A 500, or a 2xx that stores the bad body, is a failure, not a skip.

## Driving conventions

- Start every recipe from the baseline state, unless its preconditions say otherwise.
- Use `support@0509.io` as the test mailbox (`support%400509.io` in paths).
- Treat every command as literal.
- Use the REST routes the UI calls (`app/services/api.ts`) and the email handler. Never call Durable Object methods directly.

## Proof and skip reporting

- Capture the request, the response and its status code, and a second read-only view of the stored state.
- Record the feature ID with every artifact (`$RUN/<nn>-<feature-id>.*`).
- Report an unreachable path with the command you tried and the precondition that was not met. AI-backed paths are unreachable locally (see [../SKILL.md](../SKILL.md), "Not reachable locally").
- Do not report a skipped entry point as verified through a different path.

## Upkeep

Run `/maintain-verification-skill` after changes to routes in `workers/index.ts`, `workers/routes/`, the email handler, or the UI routes in `app/routes/`. It reads the source for each feature, drives every feature in one live session, and opens at most one PR of proven corrections to this map. Add a feature file when a new user-facing route ships.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then has exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with curl`, `Gotchas`.

## Features

- [Mailboxes](./mailboxes.md): create, read, update settings, delete.
- [Inbound mail](./inbound-mail.md): store, spam folder, forwarding, attachments.
- [Inbox list, threads and search](./inbox-list.md): list a folder, open an email or thread, mark read, search.
- [Compose, draft, reply, forward](./compose.md): send, save a draft, reply, forward.
- [Folders](./folders.md): list, create, rename, delete, move an email.
- [Attention desk](./attention.md): buckets and counts, and the cron notification.
