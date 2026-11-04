# Folders

Each mailbox has six system folders. A user adds custom folders, renames or deletes them, and moves emails between folders.

## Sub-features

- `folders-list` lists the folders with unread counts.
- `folder-create` creates a custom folder from a name.
- `folder-rename` renames a custom folder.
- `folder-delete` deletes a custom folder, and refuses a system folder.
- `email-move` moves an email to another folder.

## How to get to it (user POV)

- The sidebar folder list, and its "New folder" control.
- "Move to" on an open email.

## Driving it with curl

Preconditions:

- `support@0509.io` exists. `$ID` holds an Inbox email id (see [inbox-list.md](./inbox-list.md)).

- **List.** Run `curl -s $B/api/v1/mailboxes/support%400509.io/folders`. Six folders: `inbox`, `sent`, `draft`, `archive`, `trash`, `spam`.
- **Create.** POST `{"name":"Billing"}` to `.../folders`. Status 201, id `billing`.
- **Bad name.** POST `{"name":"!!!"}`. Status 400. POST `{"name":42}`. Status 400.
- **Rename.** PUT `{"name":"Billing team"}` to `.../folders/billing`. Status 200.
- **Move.** POST `{"folderId":"billing"}` to `.../emails/$ID/move`. Status 200, `status: "moved"`. `?folder=billing` lists the email.
- **Delete system folder.** DELETE `.../folders/inbox`. Status 400.
- **Delete custom.** Move the email back to `inbox`, then DELETE `.../folders/billing`. Status 204.

## Gotchas

- Deleting a folder also deletes the emails in it (cascade). Move them out first.
- Folder ids are slugs of the name. A second folder with the same name gets 409.
