// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Stand-ins for the `cloudflare:workers` and `cloudflare:email` runtime
 * modules, so Node-based unit tests can import the `agents` SDK (and so run
 * its real getAgentByName). Only the names the SDK imports at load time.
 */
export class DurableObject {
	constructor(public ctx?: unknown, public env?: unknown) {}
}
export class WorkflowEntrypoint {}
export class EmailMessage {
	constructor(public from: string, public to: string, public raw: unknown) {}
}
export const env = {};
