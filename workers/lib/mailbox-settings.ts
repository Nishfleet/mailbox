// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { parseMailboxSettings, type MailboxSettings } from "../../shared/mailbox-settings";
import type { Env } from "../types";

export const MAILBOX_SETTINGS_PREFIX = "mailboxes/";

export function mailboxSettingsKey(mailboxId: string) {
	return `${MAILBOX_SETTINGS_PREFIX}${mailboxId}.json`;
}

export async function readMailboxSettings(
	env: Env,
	mailboxId: string,
): Promise<MailboxSettings | null> {
	try {
		const obj = await env.BUCKET.get(mailboxSettingsKey(mailboxId));
		if (!obj) return null;
		return parseMailboxSettings(await obj.json());
	} catch (error) {
		console.error(`Failed to read mailbox settings for ${mailboxId}`, error);
		return null;
	}
}

export function mailboxDisplayName(
	mailboxId: string,
	settings: MailboxSettings | null | undefined,
) {
	return settings?.fromName ? settings.fromName : mailboxId;
}
