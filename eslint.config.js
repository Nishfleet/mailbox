// https://typescript-eslint.io/getting-started/
import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
	globalIgnores(["build/", ".react-router/", ".wrangler/", "worker-configuration.d.ts"]),
	eslint.configs.recommended,
	tseslint.configs.recommended,
);
