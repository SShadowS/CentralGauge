import { assertEquals } from "@std/assert";
import { deriveFormat } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/format-rules.ts";

const f = (over: Partial<Parameters<typeof deriveFormat>[0]>) =>
  deriveFormat({
    id: "T",
    prompt_template: "code-gen.md",
    donors: [],
    hasStarter: false,
    ...over,
  });

Deno.test("the four formats derive from manifest fields", () => {
  assertEquals(f({}).group, "build-from-spec");
  assertEquals(f({ cohort: "ado-trap-2026" }).group, "runtime-trap");
  assertEquals(
    f({
      prompt_template: "diagnose.md",
      cohort: "reasoning-100",
      hasStarter: true,
    }).group,
    "diagnose-single",
  );
  assertEquals(
    f({
      prompt_template: "diagnose-objects.md",
      cohort: "reasoning-100",
      hasStarter: true,
      donors: ["A", "B", "C", "D"],
    }).group,
    "diagnose-composite",
  );
});

Deno.test("rule order: donors win over template, template wins over cohort", () => {
  assertEquals(
    f({
      prompt_template: "diagnose.md",
      cohort: "ado-trap-2026",
      hasStarter: true,
    }).group,
    "diagnose-single",
  );
});

Deno.test("matrix violations are reported, never degraded", () => {
  assertEquals(f({ prompt_template: "weird.md" }).violations, [
    "unknown_template",
  ]);
  assertEquals(f({ cohort: "typo-2026" }).violations, ["unknown_cohort"]);
  assertEquals(
    f({
      prompt_template: "diagnose.md",
      cohort: "reasoning-100",
      hasStarter: false,
    }).violations,
    ["starter_required"],
  );
  assertEquals(f({ cohort: "ado-trap-2026", hasStarter: true }).violations, [
    "starter_forbidden",
  ]);
  assertEquals(
    f({
      prompt_template: "diagnose.md",
      cohort: "reasoning-100",
      hasStarter: true,
      donors: ["A", "B", "C", "D"],
    }).violations,
    ["composite_template"],
  );
  assertEquals(
    f({ prompt_template: "code-gen.md", cohort: "reasoning-100" }).violations,
    ["cohort_mismatch"],
  );
});

Deno.test("matrix violations exhaustive coverage", () => {
  // donor_count: composite with too few donors (< 4)
  assertEquals(
    f({
      prompt_template: "diagnose-objects.md",
      cohort: "reasoning-100",
      hasStarter: true,
      donors: ["A", "B", "C"],
    }).violations,
    ["donor_count"],
  );
  // donor_count: composite with too many donors (> 8)
  assertEquals(
    f({
      prompt_template: "diagnose-objects.md",
      cohort: "reasoning-100",
      hasStarter: true,
      donors: ["A", "B", "C", "D", "E", "F", "G", "H", "I"],
    }).violations,
    ["donor_count"],
  );
  // starter_forbidden: build-from-spec with starter (code-gen.md at top level)
  assertEquals(
    f({ prompt_template: "code-gen.md", hasStarter: true }).violations,
    [
      "starter_forbidden",
    ],
  );
  // cohort_mismatch: build-from-spec carrying cohort
  assertEquals(
    f({ prompt_template: "code-gen.md", cohort: "reasoning-100" }).violations,
    ["cohort_mismatch"],
  );
  // Multiple violations: composite with wrong template AND wrong cohort
  assertEquals(
    f({
      prompt_template: "diagnose.md",
      cohort: "ado-trap-2026",
      hasStarter: true,
      donors: ["A", "B", "C", "D"],
    }).violations,
    ["composite_template", "cohort_mismatch"],
  );
});
