import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import type { HarnessTask } from "../../../src/harness/task.ts";
import type { JudgmentRecord } from "../../../src/harness/records.ts";
import {
  loadTaskMeasures,
  measureFingerprint,
  type MeasureRecord,
  partialCredit,
  readMeasureRecord,
  TaskMeasuresSchema,
  writeMeasureRecord,
} from "../../../src/harness/measures.ts";

const task = (kind: HarnessTask["kind"] = "feature"): HarnessTask => ({
  id: "HX-101",
  refapp_version: "refapp-v2",
  kind,
  prompt: "prompt.md",
  touches: [],
  coupling: [],
  source: "refapp",
  attachments: [],
  scorers: ["build", "pass_to_pass", "fail_to_pass"],
  pass_to_pass: [{ codeunit: 80010, procedures: ["P1", "P2"] }],
  fail_to_pass: {
    depends_on: ["Core"],
    tests: [{ codeunit: 85400, procedures: ["A", "B", "C", "H"] }],
  },
  mutants: [],
  contamination: null,
  limits: {},
});
const M = TaskMeasuresSchema.parse({
  v: 1,
  partial_credit: {
    weights: { "85400/A": 2, "85400/B": 1, "85400/C": 1 },
    hidden_regressions: ["85400/H"],
  },
});
const row = (
  codeunit: number,
  procedure: string,
  pass: boolean,
  target = "candidate",
) => ({
  codeunit,
  procedure,
  target,
  outcome: pass ? "pass" as const : "fail" as const,
  failure: pass ? null : "assertion" as const,
});
const judgment = (scorers: JudgmentRecord["scorers"]): JudgmentRecord =>
  ({ scorers }) as unknown as JudgmentRecord;
const full = (f2p: ReturnType<typeof row>[], p2p: ReturnType<typeof row>[]) =>
  judgment([
    { name: "build", passed: true, tests: [] },
    { name: "pass_to_pass", passed: false, tests: p2p },
    { name: "fail_to_pass", passed: false, tests: f2p },
  ]);

Deno.test("partialCredit: weighted new requirements; hidden regressions and pass_to_pass apart", () => {
  const j = full(
    [
      row(85400, "A", true),
      row(85400, "B", false),
      row(85400, "C", true),
      row(85400, "H", false),
    ],
    [
      row(80010, "P1", true),
      row(80010, "P2", false),
      row(80011, "AgentTest", true),
    ],
  );
  assertEquals(partialCredit(task(), M, j), {
    status: "ok",
    value: { new_requirements: 0.75, hidden_regressions: 0, pass_to_pass: 0.5 },
  });
});

Deno.test("partialCredit: incomplete rows, absent scorer or infra are missing; failed build is 0; test-authoring n/a", () => {
  const short = full([row(85400, "A", true)], [
    row(80010, "P1", true),
    row(80010, "P2", true),
  ]);
  assertEquals(partialCredit(task(), M, short).status, "missing");
  const noP2p = judgment([
    { name: "build", passed: true, tests: [] },
    { name: "fail_to_pass", passed: true, tests: [] },
  ]);
  assertEquals(partialCredit(task(), M, noP2p), {
    status: "missing",
    reason: "required scorer absent",
  });
  const infra = judgment([
    { name: "build", passed: true, tests: [] },
    { name: "pass_to_pass", passed: null, tests: [] },
    { name: "fail_to_pass", passed: null, tests: [] },
  ]);
  assertEquals(partialCredit(task(), M, infra).status, "missing");
  const failed = judgment([
    { name: "build", passed: false, tests: [] },
    { name: "pass_to_pass", passed: false, tests: [] },
    { name: "fail_to_pass", passed: false, tests: [] },
  ]);
  assertEquals(partialCredit(task(), M, failed), {
    status: "ok",
    value: { new_requirements: 0, hidden_regressions: 0, pass_to_pass: 0 },
  });
  assertEquals(
    partialCredit(task("test-authoring"), M, failed).status,
    "not_applicable",
  );
  assertEquals(partialCredit(task(), null, failed).status, "not_applicable");
});

Deno.test("loadTaskMeasures: weights + hidden regressions cover exactly the fail_to_pass procedures; never empty; never test-authoring", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(join(dir, "measures"));
  const write = (y: string) =>
    Deno.writeTextFile(join(dir, "measures", "measures.yml"), y);
  assertEquals(
    await loadTaskMeasures({ task: task(), dir: await Deno.makeTempDir() }),
    null,
  );
  await write(
    `v: 1\npartial_credit:\n  weights: { "85400/A": 1, "85400/B": 1, "85400/C": 1 }\n`,
  );
  await assertRejects(
    () => loadTaskMeasures({ task: task(), dir }),
    ValidationError,
    "85400/H",
  );
  await write(
    `v: 1\npartial_credit:\n  weights: { "85400/A": 1, "85400/B": 1, "85400/C": 1, "85400/H": 1 }\n  hidden_regressions: ["85400/H"]\n`,
  );
  await assertRejects(
    () => loadTaskMeasures({ task: task(), dir }),
    ValidationError,
    "both",
  );
  await write(`v: 1\npartial_credit:\n  weights: {}\n`);
  await assertRejects(() => loadTaskMeasures({ task: task(), dir }));
  await write(
    `v: 1\npartial_credit:\n  weights: { "85400/A": 1, "85400/B": 1, "85400/C": 1 }\n  hidden_regressions: ["85400/H"]\n`,
  );
  await assertRejects(
    () => loadTaskMeasures({ task: task("test-authoring"), dir }),
    ValidationError,
    "test-authoring",
  );
  assertEquals(
    (await loadTaskMeasures({ task: task(), dir }))!.partial_credit!
      .hidden_regressions,
    ["85400/H"],
  );
});

Deno.test("measure records: versioned by fingerprint, write once, bound to artifact and oracle", async () => {
  const root = await Deno.makeTempDir();
  const r: MeasureRecord = {
    v: 1,
    judgment_id: "00000000-0000-4000-8000-0000000000a1",
    execution_id: "00000000-0000-4000-8000-0000000000b1",
    task_id: "HX-101",
    workspace_hash: "a".repeat(64),
    oracle_hash: "b".repeat(64),
    measure_fingerprint: await measureFingerprint(),
    analyzers: null,
    final_code: { status: "missing", reason: "not run" },
    reuse: { status: "not_applicable", reason: "no reuse target" },
    partial_credit: {
      status: "ok",
      value: { new_requirements: 1, hidden_regressions: null, pass_to_pass: 1 },
    },
  };
  await writeMeasureRecord(root, r);
  assertEquals(
    await readMeasureRecord(root, r.judgment_id, r.measure_fingerprint),
    r,
  );
  await assertRejects(() => writeMeasureRecord(root, r));
  const other = { ...r, measure_fingerprint: "c".repeat(64) };
  await writeMeasureRecord(root, other);
  assertEquals(
    await readMeasureRecord(root, r.judgment_id, "c".repeat(64)),
    other,
  );
  assertEquals(
    await readMeasureRecord(root, r.judgment_id, "d".repeat(64)),
    null,
  );
});
