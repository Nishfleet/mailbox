// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Unit-test config for the Worker code (`workers/**`).
 *
 * Deliberately separate from the root `vite.config.ts`: the Cloudflare Vite
 * plugin there needs Cloudflare credentials to start a dev/remote session, so
 * pulling it in would make `npm test` an authenticated command. These tests
 * exercise `receiveEmail()` against in-memory bindings instead.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["workers/**/*.test.ts"],
		globals: false,
		// The agents SDK imports Workers runtime modules that Node cannot load.
		// Inline it so these aliases apply, letting tests run its real code.
		alias: {
			"cloudflare:workers": fileURLToPath(new URL("./test-stubs/cloudflare-runtime.ts", import.meta.url)),
			"cloudflare:email": fileURLToPath(new URL("./test-stubs/cloudflare-runtime.ts", import.meta.url)),
		},
		server: { deps: { inline: ["agents", "partyserver"] } },
	},
});
