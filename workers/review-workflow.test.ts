import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

it("the review caller passes the approver token by name, so the bot never posts with an empty token", () => {
  const caller = readFileSync(new URL("../.github/workflows/review.yml", import.meta.url), "utf8");
  expect(caller).toMatch(/^ {4}secrets:\n {6}APPROVER_TOKEN: \$\{\{ secrets\.APPROVER_TOKEN \}\}$/m);
});
