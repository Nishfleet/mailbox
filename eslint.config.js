import tseslint from "typescript-eslint";

// Lean code is a lint, not a review note (Nish 2026-09-28, "all work anywhere
// by any agent should be done as a pro dev team would. lean and mean", and
// "make this non negotiable as lints and hard blocks"; Nishfleet/0509#5783,
// same limits as Nishfleet/0509#5921). Code already over a limit is listed in
// eslint-suppressions.json (ESLint bulk suppressions): the list only shrinks,
// and a fixed entry fails lint until `npx eslint --prune-suppressions` drops it.
export default tseslint.config(
  { ignores: ["build/**", ".react-router/**", "worker-configuration.d.ts", "node_modules/**"] },
  {
    files: ["app/**/*.{ts,tsx}", "workers/**/*.ts", "shared/**/*.ts"],
    ignores: ["**/*.test.ts"],
    languageOptions: { parser: tseslint.parser },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
    rules: {
      complexity: ["error", 10],
      "max-depth": ["error", 3],
      "max-params": ["error", 3],
      "max-lines-per-function": ["error", { max: 50, skipBlankLines: true, skipComments: true }],
    },
  },
);
