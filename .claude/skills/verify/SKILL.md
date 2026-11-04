---
name: verify
description: Launch the mailbox app (Agentic Inbox, a Cloudflare Worker with a React Router UI) locally with no Cloudflare login, drive it through its REST API and a simulated inbound email, and collect evidence from the Local Explorer API. Use to prove a change to mailboxes, inbound mail, the inbox list, folders, search or the attention desk works end to end before you open or merge a PR.
---

# Verify the mailbox app

One instance runs per checkout. Workers state (R2, Durable Objects) lives in `<checkout>/.wrangler/state`, so a fresh `git worktree` is a fresh, empty data dir. Never drive a dev server you did not start. Never use `--remote`, because the AI binding then bills a real account.

The feature map is in [features/README.md](features/README.md). Read it, then use the matching feature file as the recipe.

## Launch

From a fresh worktree of the branch under test:

```sh
RUN=${TMPDIR:-/tmp}/mailbox-verify/$(date +%Y%m%d-%H%M%S); mkdir -p "$RUN"
npm ci
set -m                                     # own process group, so cleanup kills only this server
npx react-router dev --port 5199 --strictPort > "$RUN/dev.log" 2>&1 &
echo $! > "$RUN/dev.pid"
set +m
B=http://127.0.0.1:5199
until curl -sf -o /dev/null $B/api/v1/config; do sleep 1; done
```

Ready means `GET /api/v1/config` answers 200 with the `domains` list. It takes 1 to 3 s. The log prints `The Local Explorer API is available at http://localhost:5199/cdn-cgi/local/explorer/api`.

If the log says `Failed to start the remote proxy session ... CLOUDFLARE_API_TOKEN`, the branch lacks `remoteBindings: false` in `vite.config.ts`. Stop and report it. Do not add a token.

## Doctor

Run this first, and again whenever a result looks wrong. Every line must pass.

```sh
ss -ltnp | grep ':5199 '                                   # the listener exists
ps -o pgid= -p "$(ss -ltnp | grep ':5199 ' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)"   # equals $(cat "$RUN/dev.pid")
curl -s $B/api/v1/config                                   # 200, "domains":["0509.io",...]
curl -s $B/cdn-cgi/local/explorer/api/r2/buckets           # "0509-support-inbox"
```

If the process group differs from `dev.pid`, someone else owns port 5199. Do not drive it.

## Drive

Stock tools only: `curl` for the REST API, and the Workers email handler for inbound mail.

- REST API: `$B/api/v1/...`. Mailbox ids are email addresses. URL-encode `@` as `%40` in paths.
- Inbound mail: `curl -X POST --data-binary @mail.eml "$B/cdn-cgi/handler/email?from=<sender>&to=<mailbox>"`. A 200 with `Worker successfully processed email` means the Worker's `email()` handler ran (https://developers.cloudflare.com/email-routing/email-workers/local-development/).
- The cron handler: `curl -X POST "$B/cdn-cgi/local/explorer/api/local/scheduled?worker=0509-support-inbox" -H 'content-type: application/json' -d '{"cron":"*/15 * * * *"}'`.
- UI: open `$B/` in a browser (Chrome DevTools MCP or Playwright, https://playwright.dev/docs/screenshots). Local dev skips Cloudflare Access.

## Evidence

Write every artifact to `$RUN/`. Name each file `<nn>-<feature-id>.<ext>`, so the order of actions is clear.

- The action: the exact request (`.eml` file or JSON body) and the response with its status code (`curl -w "\n%{http_code}\n"`).
- The resulting state, from a second read-only view: the REST list or detail route, plus the stored data from the Local Explorer API:
  - R2 objects: `curl -s $B/cdn-cgi/local/explorer/api/r2/buckets/0509-support-inbox/objects`
  - Durable Object namespaces: `curl -s $B/cdn-cgi/local/explorer/api/workers/durable_objects/namespaces`
  - Traces and logs, SQL over the `spans` and `logs` tables:
    `curl -s -X POST $B/cdn-cgi/local/explorer/api/local/observability/query -H 'content-type: application/json' -d '{"sql":"SELECT name, outcome, duration_ms FROM spans WHERE parent_id IS NULL ORDER BY start_ms DESC LIMIT 10"}'`
- `dev.log` for console output (inbound handling, auto-draft skips).

Proof standards: drive the real user path (the REST route the UI calls, or the email handler), never a DO method directly. Capture the action and the resulting state. Check side effects (R2 object written, attention count changed). A screenshot alone proves nothing.

## Cleanup

```sh
kill -- -"$(cat "$RUN/dev.pid")"         # the process group you started, never by name
git worktree remove --force <worktree>   # --force because node_modules and .wrangler/state are untracked
ls "$RUN"                                # the evidence is still here
```

## Not reachable locally

- AI flows (auto-draft, prompt-injection scan, agent chat, MCP tools that call AI). The AI binding always runs remotely. Locally `dev.log` shows `Prompt injection scanner failed, skipping auto-draft: Binding AI needs to be run remotely`. Verify these on a preview deploy, and say so in the report.
- Real outbound mail. `send_email` is simulated locally, so a sent email is stored in Sent but goes nowhere.
- Cloudflare Access. Local dev skips it. Production fails closed without `POLICY_AUD` and `TEAM_DOMAIN`.
