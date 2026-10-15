# Agent notes for mailbox

Launch stage: 1 (first stranger's data). Next trigger: a brand starts taking health, card or children's data by email (stage 4).

Success: 0 inbox emails left unread for more than 24 hours across all brand mailboxes (the `aging` count). Baseline: none yet (the app is behind Cloudflare Access and has not been read for it; read the count below and write it and the date here). Measured by: `GET /api/v1/attention` (or the MCP tool `get_attention_summary`), the `count` of the `aging` entry in `buckets`, read only when `unavailableMailboxCount` is 0.

Stage 1 applies because the mailbox stores customers' emails and attachments for every brand.
