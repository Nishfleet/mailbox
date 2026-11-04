// https://typescript-eslint.io/getting-started/
import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import noComments from "eslint-plugin-no-comments";
import tseslint from "typescript-eslint";

const WORKAROUND_TERMS = [
	"todo",
	"fixme",
	"xxx",
	"hack",
	"workaround",
	"work around",
	"for now",
	"temporary",
	"temporarily",
	"not ideal",
	"should be",
	"ideally",
	"revisit",
	"later",
];

export default defineConfig(
	globalIgnores(["build/", ".react-router/", ".wrangler/", "worker-configuration.d.ts"]),
	eslint.configs.recommended,
	tseslint.configs.recommended,
	{
		// https://eslint.org/docs/latest/rules/no-control-regex#when-not-to-use-it
		files: ["workers/lib/attachments.ts"],
		rules: { "no-control-regex": "off" },
	},
	{
		files: ["app/**/*.{ts,tsx}", "shared/**/*.ts", "workers/**/*.ts"],
		ignores: ["**/*.config.ts"],
		plugins: { "no-comments": noComments },
		rules: {
			"no-comments/disallowComments": [
				"error",
				{
					allow: [
						"eslint",
						"global",
						"@ts-",
						"\\* @",
						"/\\s*<reference",
						"upstream: https://",
						"Copyright \\(c\\) \\d{4} Cloudflare, Inc\\.$",
						"Licensed under the Apache 2\\.0 license found in the LICENSE file or at:$",
						"\\s*https://opensource\\.org/licenses/Apache-2\\.0$",
					],
				},
			],
			"no-inline-comments": ["error", { ignorePattern: "@type" }],
			"no-warning-comments": ["error", { terms: WORKAROUND_TERMS, location: "anywhere" }],
		},
	},
);
