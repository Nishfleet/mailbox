// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const runtimeTests = "workers/**/*.runtime.test.ts";

export default defineConfig({
	test: {
		projects: [
			{
				plugins: [
					cloudflareTest({
						wrangler: { configPath: "./wrangler.jsonc" },
						remoteBindings: false,
						// "0" is the app's own auto-draft off switch: onNewEmail runs and returns
						// before any Workers AI call, which has no local version.
						miniflare: { bindings: { AUTO_DRAFT_DAILY_LIMIT: "0" } },
					}),
				],
				test: { name: "workers-runtime", include: [runtimeTests] },
			},
			{
				test: {
					name: "node",
					environment: "node",
					include: ["workers/**/*.test.ts"],
					exclude: [runtimeTests],
					globals: false,
					// The agents SDK imports Workers runtime modules that Node cannot load.
					// Inline it so these aliases apply, letting tests run its real code.
					alias: {
						"cloudflare:workers": fileURLToPath(new URL("./test-stubs/cloudflare-runtime.ts", import.meta.url)),
						"cloudflare:email": fileURLToPath(new URL("./test-stubs/cloudflare-runtime.ts", import.meta.url)),
					},
					server: { deps: { inline: ["agents", "partyserver"] } },
				},
			},
		],
	},
});
