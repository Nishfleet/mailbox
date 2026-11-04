// https://typescript-eslint.io/getting-started/typed-linting
import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const rawStub = {
	selector: "CallExpression[callee.property.name='idFromName']",
	message: "Use getMailboxStub() from workers/lib/email-helpers.ts for MAILBOX, or getAgentByName() from agents for EMAIL_AGENT (#17).",
};
const rawAttachmentKey = {
	selector: "TemplateLiteral[quasis.0.value.raw=/^attachments\\//]",
	message: "Use attachmentKey() from workers/lib/attachments.ts.",
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
		rules: { "no-restricted-syntax": ["error", rawStub, rawAttachmentKey, uncheckedBody] },
	},
	{
		files: ["workers/lib/email-helpers.ts"],
		rules: { "no-restricted-syntax": ["error", rawAttachmentKey, uncheckedBody] },
	},
	{
		files: ["workers/lib/attachments.ts"],
		rules: {
			"no-restricted-syntax": ["error", rawStub, uncheckedBody],
			// https://eslint.org/docs/latest/rules/no-control-regex#when-not-to-use-it
			"no-control-regex": "off",
		},
	},
	{
		files: ["app/**/*.{ts,tsx}"],
		rules: {
			"no-restricted-imports": ["error", {
				patterns: [{ group: ["**/workers", "**/workers/**"], message: "The app imports shared types from shared/, never from workers/." }],
			}],
		},
	},
);
