import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import type { HarnessTask } from "../../../src/harness/task.ts";
import type { JudgmentRecord } from "../../../src/harness/records.ts";
import {
  loadTaskMeasures,
  locateProcedure,
  maskAl,
  measureFingerprint,
  type MeasureRecord,
  partialCredit,
  qualifyMeasures,
  readMeasureRecord,
  stubProcedure,
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

const record = async (): Promise<MeasureRecord> => ({
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
  partial_credit: { status: "not_applicable", reason: "no frozen weights" },
});

Deno.test("TaskMeasuresSchema: a weight total that overflows is refused (M11-04 run 002)", () => {
  const huge = TaskMeasuresSchema.safeParse({
    v: 1,
    partial_credit: { weights: { "85400/A": 1e308, "85400/B": 1e308 } },
  });
  assertEquals(huge.success, false);
  assertStringIncludes(huge.error!.message, "finite");
  // One very large weight alone is fine and stays proportional.
  const big = TaskMeasuresSchema.parse({
    v: 1,
    partial_credit: {
      weights: { "85400/A": 1e308, "85400/B": 1e308 / 2, "85400/C": 1e307 },
      hidden_regressions: ["85400/H"],
    },
  });
  const j = full(
    [
      row(85400, "A", true),
      row(85400, "B", false),
      row(85400, "C", false),
      row(85400, "H", true),
    ],
    [row(80010, "P1", true), row(80010, "P2", true)],
  );
  const r = partialCredit(task(), big, j);
  assertEquals(r.status, "ok");
  assertEquals(
    r.status === "ok" && Math.abs(r.value.new_requirements - 1 / 1.6) < 1e-12,
    true,
  );
});

Deno.test("loadTaskMeasures: duplicate hidden regressions are refused (M11-04 run 002)", async () => {
  assertEquals(
    TaskMeasuresSchema.safeParse({
      v: 1,
      partial_credit: {
        weights: { "85400/A": 1 },
        hidden_regressions: ["85400/H1", "85400/H1", "85400/H2"],
      },
    }).success,
    false,
  );
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(join(dir, "measures"));
  await Deno.writeTextFile(
    join(dir, "measures", "measures.yml"),
    `v: 1\npartial_credit:\n  weights: { "85400/A": 1, "85400/B": 1, "85400/C": 1 }\n  hidden_regressions: ["85400/H", "85400/H"]\n`,
  );
  await assertRejects(
    () => loadTaskMeasures({ task: task(), dir }),
    ValidationError,
    "duplicate",
  );
});

Deno.test("readMeasureRecord: a record whose judgment or fingerprint disagrees with its location is refused (M11-04 run 002)", async () => {
  const root = await Deno.makeTempDir();
  const r = await record();
  await writeMeasureRecord(root, r);
  const src = join(
    root,
    "measures",
    r.judgment_id,
    `${r.measure_fingerprint}.json`,
  );
  const otherFp = "c".repeat(64);
  await Deno.copyFile(
    src,
    join(root, "measures", r.judgment_id, `${otherFp}.json`),
  );
  await assertRejects(
    () => readMeasureRecord(root, r.judgment_id, otherFp),
    ValidationError,
    "measure_fingerprint: does not match its location",
  );
  const otherJ = "00000000-0000-4000-8000-0000000000a2";
  await Deno.mkdir(join(root, "measures", otherJ));
  await Deno.copyFile(
    src,
    join(root, "measures", otherJ, `${r.measure_fingerprint}.json`),
  );
  await assertRejects(
    () => readMeasureRecord(root, otherJ, r.measure_fingerprint),
    ValidationError,
    "judgment_id: does not match its location",
  );
});

Deno.test("writeMeasureRecord: published through a synced temp file; a stale temp never takes the key (M11-04 run 002)", async () => {
  const root = await Deno.makeTempDir();
  const r = await record();
  const dir = join(root, "measures", r.judgment_id);
  const final = join(dir, `${r.measure_fingerprint}.json`);
  // A crash mid-write leaves only a temp name: the immutable key stays free.
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${final}.tmp-crashed`, '{"v": 1, "judg');
  await writeMeasureRecord(root, r);
  assertEquals(
    await readMeasureRecord(root, r.judgment_id, r.measure_fingerprint),
    r,
  );
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) names.push(e.name);
  assertEquals(names.sort(), [
    `${r.measure_fingerprint}.json`,
    `${r.measure_fingerprint}.json.tmp-crashed`,
  ]);
  await assertRejects(
    () => writeMeasureRecord(root, r),
    ValidationError,
    "immutable",
  );
});

const T = {
  codeunit: 70010,
  procedure: "CalcSurcharge",
  signature: "(Amount: Decimal): Decimal",
};
const CU = `codeunit 70010 "Rental Price Mgt"
{
    // old: procedure CalcSurcharge(Amount: Decimal): Decimal begin end;
    procedure CalcSurcharge(Amount: Decimal): Decimal
    var
        Rate: Decimal;
    begin
        Rate := 0.1; // begin end case
        Message('end; begin');
        case Amount > 100 of
            true:
                begin
                    exit(Amount * Rate);
                end;
        end;
        exit(0);
    end;

    procedure Other()
    begin
    end;
}
`;
const OTHER = `codeunit 70011 "Copy"
{
    procedure CalcSurcharge(Amount: Decimal): Decimal
    begin
        exit(1);
    end;
}
`;

Deno.test("stubProcedure: replaces only the target body (nested begin/case, comments, strings)", () => {
  const out = stubProcedure(CU, T, "Error('CG-REUSE-PROBE');")!;
  assertEquals(out.includes("Error('CG-REUSE-PROBE')"), true);
  assertEquals(out.includes("exit(Amount * Rate)"), false);
  assertEquals(out.includes("procedure Other()\n    begin\n    end;"), true);
  assertEquals(out.includes("Rate: Decimal;"), true);
  assertEquals(out.includes("// old: procedure CalcSurcharge"), true);
});

Deno.test("locateProcedure: object scoping, signature, renames and duplicates", () => {
  assertEquals(
    stubProcedure(OTHER + CU, T, "exit(-1);")!.includes("exit(1);"),
    true,
  );
  assertEquals(locateProcedure(CU, { ...T, codeunit: 70011 }), null);
  assertEquals(
    locateProcedure(CU, { ...T, procedure: "CalcSurcharge2" }),
    null,
  );
  assertEquals(
    locateProcedure(CU, {
      ...T,
      signature: "(Amount: Decimal; Weekend: Boolean): Decimal",
    }),
    null,
  );
  assertEquals(locateProcedure(CU + CU, T), null);
  assertEquals(
    locateProcedure(
      CU.replace(
        "procedure CalcSurcharge(Amount: Decimal)",
        "procedure  calcsurcharge( amount : decimal )",
      ),
      T,
    ) !== null,
    true,
  );
});

const OWNER = (real: boolean) =>
  `codeunit 70010 "Rental Price Mgt"
{
    var
        "Owner's": Integer;
    /* ' procedure CalcSurcharge(Amount: Decimal): Decimal begin end; */
${
    real
      ? `
    procedure CalcSurcharge(Amount: Decimal): Decimal
    begin
        exit(Amount);
    end;
`
      : ""
  }}
`;

Deno.test("locateProcedure: a quoted identifier with an apostrophe never unmasks a comment (M11-06 run 002)", () => {
  assertEquals(locateProcedure(OWNER(false), T), null);
  const out = stubProcedure(OWNER(true), T, "exit(-1);")!;
  assertEquals(
    out.includes(
      "/* ' procedure CalcSurcharge(Amount: Decimal): Decimal begin end; */",
    ),
    true,
  );
  assertEquals(out.includes("exit(-1);"), true);
  assertEquals(out.includes("exit(Amount);"), false);
});

const OVERLOADS = `codeunit 70010 "Rental Price Mgt"
{
    procedure CalcSurcharge(Amount: Decimal; Weekend: Boolean): Decimal
    begin
        exit(2);
    end;

    procedure CalcSurcharge(Amount: Decimal): Decimal
    begin
        exit(1);
    end;
}
`;

Deno.test("locateProcedure: overloads are told apart by full signature, then exactly one must match (M11-06 run 002)", () => {
  const out = stubProcedure(OVERLOADS, T, "exit(-1);")!;
  assertEquals(out.includes("exit(2);"), true);
  assertEquals(out.includes("exit(1);"), false);
  const two = stubProcedure(
    OVERLOADS,
    { ...T, signature: "(Amount: Decimal; Weekend: Boolean): Decimal" },
    "exit(-1);",
  )!;
  assertEquals([two.includes("exit(2);"), two.includes("exit(1);")], [
    false,
    true,
  ]);
  // The same signature twice is ambiguous.
  assertEquals(
    locateProcedure(OVERLOADS.replace("; Weekend: Boolean", ""), T),
    null,
  );
});

Deno.test("locateProcedure: a var (by-reference) parameter is part of the signature, not the locals (M11-06 run 002)", () => {
  const src = `codeunit 70010 "Rental Price Mgt"
{
    procedure CalcSurcharge(var Amount: Decimal): Decimal
    var
        Rate: Decimal;
    begin
        exit(Amount * Rate);
    end;
}
`;
  const t = { ...T, signature: "(var Amount: Decimal): Decimal" };
  const out = stubProcedure(src, t, "exit(-1);")!;
  assertEquals(out.includes("Rate: Decimal;"), true);
  assertEquals(out.includes("exit(Amount * Rate);"), false);
  assertEquals(locateProcedure(src, T), null);
});

Deno.test("maskAl: an unterminated or multi-line quoted identifier fails closed; locate and stub return null (M11-07)", () => {
  const unterminated = `codeunit 70010 "Rental Price Mgt"
{
    var
        "Owner's: Integer;

    procedure CalcSurcharge(Amount: Decimal): Decimal
    begin
        exit(Amount);
    end;
}
`;
  const multiLine = unterminated.replace(
    `"Owner's: Integer;`,
    `"Owner's\n        Name": Integer;`,
  );
  for (const src of [unterminated, multiLine]) {
    assertEquals(maskAl(src), null);
    assertEquals(locateProcedure(src, T), null);
    assertEquals(stubProcedure(src, T, "exit(-1);"), null);
  }
  // A well-formed quoted identifier still lexes.
  assertEquals(
    typeof maskAl(
      unterminated.replace(`"Owner's: Integer;`, `"Owner's": Integer;`),
    ),
    "string",
  );
});

Deno.test("qualifyMeasures: exact per-code increases; missing is a failure", async () => {
  const r = {
    v: 1,
    judgment_id: "00000000-0000-4000-8000-0000000000a1",
    execution_id: "00000000-0000-4000-8000-0000000000b1",
    task_id: "HX-101",
    workspace_hash: "a".repeat(64),
    oracle_hash: "b".repeat(64),
    measure_fingerprint: await measureFingerprint(),
    analyzers: {
      compiler: "c",
      ruleset_sha256: "e".repeat(64),
      canary_codes: ["AA0137"],
    },
    final_code: {
      status: "ok",
      value: {
        errors: 0,
        warnings: 3,
        start_errors: 0,
        start_warnings: 2,
        new_warnings: 1,
        new_warning_codes: { AA0137: 1 },
        complete: true,
        incomplete_apps: [],
      },
    },
    reuse: {
      status: "missing",
      reason: "no reuse target located in the final workspace",
    },
    partial_credit: {
      status: "ok",
      value: {
        new_requirements: 0.5,
        hidden_regressions: null,
        pass_to_pass: 1,
      },
    },
  } as const satisfies MeasureRecord;
  assertEquals(
    qualifyMeasures(r, {
      partial_credit: 0.5,
      final_errors: 0,
      new_warning_codes: ["AA0137"],
    }),
    [],
  );
  assertEquals(qualifyMeasures(r, { new_warning_codes: ["AW0006"] }), [
    "new_warning_codes: expected AW0006 to increase, increased: AA0137",
  ]);
  assertEquals(qualifyMeasures(r, { reuse: false, partial_credit: 1 }), [
    "reuse: expected false, got missing (no reuse target located in the final workspace)",
    "partial_credit: expected 1, got 0.5",
  ]);
});
