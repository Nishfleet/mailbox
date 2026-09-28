import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// eslint-suppressions.json lists main's pre-existing lean-code violations. ESLint
// prunes an entry when its code is fixed, but a PR could still raise a count or
// commit `eslint --suppress-all`. This pin is the ceiling: it only ever goes
// down, in the PR that fixes a listed violation.
const SUPPRESSION_CEILING = 81;

type Suppressions = Record<string, Record<string, { count: number }>>;

const file = path.resolve(import.meta.dirname, "..", "eslint-suppressions.json");
const suppressions = JSON.parse(readFileSync(file, "utf8")) as Suppressions;
const total = Object.values(suppressions)
  .flatMap((rules) => Object.values(rules))
  .reduce((sum, entry) => sum + entry.count, 0);

describe("eslint-suppressions.json", () => {
  it("never holds more violations than the pinned ceiling", () => {
    expect(total).toBeLessThanOrEqual(SUPPRESSION_CEILING);
  });
});
