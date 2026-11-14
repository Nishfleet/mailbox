// https://typescript-eslint.io/getting-started/typed-linting
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

const rawStub = {
	selector: "CallExpression[callee.property.name='idFromName']",
	message: "Use getMailboxStub() from workers/lib/email-helpers.ts for MAILBOX, or getAgentByName() from agents for EMAIL_AGENT (#17).",
};
const rawAttachmentKey = {
	selector: "TemplateLiteral[quasis.0.value.raw=/^attachments\\//]",
	message: "Use attachmentKey() from workers/lib/attachments.ts.",
};
const rawMailboxSettingsKey = {
	selector: "TemplateLiteral[quasis.0.value.raw=/^mailboxes\\//]",
	message: "Use mailboxSettingsKey() from workers/lib/mailbox-settings.ts.",
};
const uncheckedBody = {
	selector: "CallExpression[callee.object.property.name='req'][callee.property.name='json']",
	message: "Add zValidator(\"json\", Schema) to the route and read c.req.valid(\"json\").",
};

export default defineConfig(
	globalIgnores(["build/", ".react-router/", ".wrangler/", "worker-configuration.d.ts"]),
	eslint.configs.recommended,
	tseslint.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
		},
	},
	{
		files: ["**/*.js"],
		extends: [tseslint.configs.disableTypeChecked],
	},
	{
		files: ["workers/**/*.ts"],
		rules: { "no-restricted-syntax": ["error", rawStub, rawAttachmentKey, uncheckedBody, rawMailboxSettingsKey] },
	},
	{
		files: ["workers/lib/email-helpers.ts"],
		rules: { "no-restricted-syntax": ["error", rawAttachmentKey, uncheckedBody, rawMailboxSettingsKey] },
	},
	{
		files: ["workers/lib/attachments.ts"],
		rules: {
			"no-restricted-syntax": ["error", rawStub, uncheckedBody, rawMailboxSettingsKey],
			// https://eslint.org/docs/latest/rules/no-control-regex#when-not-to-use-it
			"no-control-regex": "off",
		},
	},
	{
		files: ["workers/lib/mailbox-settings.ts"],
		rules: { "no-restricted-syntax": ["error", rawStub, rawAttachmentKey, uncheckedBody] },
	},
	{
		files: ["workers/**/*.test.ts"],
		rules: { "no-restricted-syntax": ["error", rawStub, rawAttachmentKey, uncheckedBody] },
	},
	{
		files: ["app/**/*.{ts,tsx}"],
		rules: {
			"no-restricted-imports": ["error", {
				patterns: [{ group: ["**/workers", "**/workers/**"], message: "The app imports shared types from shared/, never from workers/." }],
			}],
		},
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
