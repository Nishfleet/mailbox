// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Env extends Cloudflare.Env {
	POLICY_AUD: string;
	TEAM_DOMAIN: string;
	INTERNAL_EMAIL_TOKEN?: string;
	PUSHOVER_APP_TOKEN?: string;
	PUSHOVER_USER_KEY?: string;
	PUSHOVER_EMAIL_ALIAS?: string;
	ATTENTION_NOTIFY_FROM_EMAIL?: string;
}
