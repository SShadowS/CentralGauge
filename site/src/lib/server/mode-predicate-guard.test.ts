import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every ranking query must build its mode predicate through
// modePredicate(alias, mode). A hand-written `invocation_mode = ?` would bind
// the literal 'combined' in combined mode and silently match nothing.
const RANKING_FILES = [
  "src/lib/server/leaderboard.ts",
  "src/lib/server/model-aggregates.ts",
  "src/lib/server/matrix.ts",
  "src/lib/server/tier-data.ts",
  "src/lib/server/models.ts",
  "src/routes/api/v1/compare/+server.ts",
  "src/routes/api/v1/families/[slug]/+server.ts",
];

describe("mode predicate guard", () => {
  it.each(RANKING_FILES)("%s has no hand-written invocation_mode predicate", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/invocation_mode\s*=\s*\?/);
  });

  it.each(RANKING_FILES)("%s passes a mode to every modePredicate call", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/modePredicate\(\s*["'`][A-Za-z_0-9]+["'`]\s*\)/);
  });
});
