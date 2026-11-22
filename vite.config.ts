// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import fs from "node:fs";
import path from "node:path";

// React Router 7 reads and writes the browser build through
// `<buildDirectory>/client` (`.vite/manifest.json`, asset moves and the
// generated `manifest-<hash>.js`) while the Cloudflare plugin points the
// client environment output at `.cloudflare/output/v0/workers/<name>/assets`.
// After the client build finishes, expose the plugin's assets directory at
// React Router's expected path via a symlink so its build steps keep working;
// everything React Router writes through the link lands in the real assets
// directory and is picked up by `cf deploy`.
function reactRouter7ClientDirCompat(): Plugin {
	return {
		name: "react-router-7-client-dir-compat",
		apply: "build",
		writeBundle() {
			if (this.environment?.name !== "client") return;
			const clientDir = path.resolve("build/client");
			const assetsDir = path.resolve(this.environment.config.build.outDir);
			fs.rmSync(clientDir, { force: true, recursive: true });
			fs.mkdirSync(path.dirname(clientDir), { recursive: true });
			fs.symlinkSync(
				path.relative(path.dirname(clientDir), assetsDir),
				clientDir,
				"dir",
			);
		},
	};
}

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: false }),
    reactRouter7ClientDirCompat(),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
});
