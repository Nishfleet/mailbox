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
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["workers/**/*.test.ts"],
		globals: false,
	},
});
