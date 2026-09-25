import { assertEquals } from "@std/assert";
import { planImport } from "../../../scripts/coord/import-gh.ts";

const issue = (number: number, title: string, body = "") => ({
  number,
  title,
  body,
  url: `https://github.com/o/r/issues/${number}`,
});

Deno.test("import-gh: epic becomes a milestone, children get ids and deps", () => {
  const plan = planImport([
    issue(10, "[epic] c02: Mutation-guided test hardening loop"),
    issue(
      11,
      "c02.1: Per-survivor packet projection",
      "Child 1. Depends on: nothing. Prerequisite.",
    ),
    issue(
      14,
      "c02.4: Extract primitive",
      "Baseline. Depends on: 2. Prerequisite (engine).",
    ),
    issue(16, "c02.6: lethal verify", "Depends on: 1, 2, 4, 5"),
  ], "code");
  assertEquals(plan.milestones, {
    C02: { title: "Mutation-guided test hardening loop", issue: 10 },
  });
  assertEquals(
    plan.tasks.map((t) => [t.header.id, t.header.deps, t.header.issue]),
    [
      ["C02-01", [], 11],
      ["C02-04", ["C02-02"], 14],
      ["C02-06", ["C02-01", "C02-02", "C02-04", "C02-05"], 16],
    ],
  );
  assertEquals(plan.skipped, []);
});

Deno.test("import-gh: standalone issues become GH-<n>; unparseable children are skipped, not guessed", () => {
  const plan = planImport([
    issue(4, "Operator candidate: DeleteAll(true)"),
    issue(25, "--changed-since ignores uncommitted files"),
    issue(30, "c03.1: something", "no dependency line here"),
    issue(31, "c03.2: other", "Depends on: step one and two"),
  ], "code");
  assertEquals(plan.tasks.map((t) => t.header.id), ["GH-04", "GH-25"]);
  assertEquals(plan.skipped.map((s) => s.issue), [30, 31]);
  assertEquals(
    plan.tasks[0]!.body.includes("https://github.com/o/r/issues/4"),
    true,
  );
});
