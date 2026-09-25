// Pure decision contract of the M4 authoring gate (spec 1b section 8,
// spec 1a section 7). No I/O. Owner: lane-ops.
import { join } from "@std/path";
import type { HarnessTask } from "../../src/harness/task.ts";

export const BUILD_ORDER = [
  "Core",
  "Fleet",
  "Rental",
  "Leasing",
  "Integration",
  "Reporting",
  "Test",
];
/** Spec 1b section 4. Oracle = the hidden test app of a task. */
export const RANGES: Record<string, readonly [number, number]> = {
  Core: [70000, 70099],
  Fleet: [70100, 70199],
  Rental: [70200, 70299],
  Leasing: [70300, 70399],
  Integration: [70400, 70499],
  Reporting: [70500, 70599],
  Test: [80000, 84999],
  Oracle: [85000, 89999],
};
export const CORRECT_RUNS = 3;
/** f2p naive variants only; test-authoring naive suites run once per target. */
export const NAIVE_RUNS = 2;
/**
 * Compiler diagnostics a baseline oracle may fail with: an object or member
 * the task asks for does not exist yet. Verified against real output in M4-07
 * and M4-11; a change needs orchestrator approval.
 */
export const MISSING_FEATURE_CODES = new Set(["AL0118", "AL0132", "AL0185"]);

export type Variant =
  | { kind: "baseline" }
  | { kind: "correct" }
  | { kind: "naive"; name: string }
  /** Test-authoring suite on correct code (null), the staged state ("m0") or a named mutant. */
  | { kind: "tests"; suite: string; mutant: string | null }
  /** An agent workspace (pilot judge). For test-authoring, mutant as above. */
  | { kind: "candidate"; dir: string; mutant: string | null };

export function variantName(v: Variant): string {
  switch (v.kind) {
    case "baseline":
    case "correct":
      return v.kind;
    case "naive":
      return `naive/${v.name}`;
    case "tests":
      return `${v.suite}@${v.mutant ?? "correct"}`;
    case "candidate":
      return `candidate@${v.mutant ?? "correct"}`;
  }
}

export function parseVariant(s: string): Variant {
  if (s === "baseline" || s === "correct") return { kind: s };
  if (s.startsWith("naive/")) return { kind: "naive", name: s.slice(6) };
  const m = s.match(/^tests:(.+)@(.+)$/);
  if (m) {
    return {
      kind: "tests",
      suite: m[1]!,
      mutant: m[2] === "correct" ? null : m[2]!,
    };
  }
  throw new Error(`unknown variant ${s}`);
}

export interface Layer {
  path: string;
  mode: "task" | "candidate" | "candidate-tests";
  optional?: boolean;
}

/** Layers over the refapp snapshot, in order (spec 1a section 7: mutant 0 = staged state). */
export function layers(
  taskDir: string,
  v: Variant,
  testAuthoring: boolean,
): Layer[] {
  const t = (rel: string): Layer => ({
    path: join(taskDir, rel),
    mode: "task",
  });
  const overlay: Layer = { ...t("overlay"), optional: true };
  const production = (mutant: string | null): Layer[] =>
    mutant === "m0"
      ? [overlay]
      : mutant === null
      ? [overlay, t("correct")]
      : [overlay, t("correct"), t(`mutants/${mutant}`)];
  switch (v.kind) {
    case "baseline":
      return [overlay];
    case "correct":
      return [overlay, t("correct")];
    case "naive":
      return [overlay, t(`naive/${v.name}`)];
    case "tests":
      return [...production(v.mutant), t(v.suite)];
    case "candidate":
      return testAuthoring
        ? [...production(v.mutant), { path: v.dir, mode: "candidate-tests" }]
        : [overlay, { path: v.dir, mode: "candidate" }];
  }
}

const OBJECT_RE =
  /^\s*(table|tableextension|page|pageextension|codeunit|report|reportextension|query|xmlport|enum|enumextension|permissionset|permissionsetextension)\s+(\d+)\s/gim;
export function objectIds(al: string): number[] {
  return [...al.matchAll(OBJECT_RE)].map((m) => Number(m[2]));
}
export const isTestCodeunit = (al: string) =>
  /Subtype\s*=\s*Test\s*;/i.test(al);

export interface TestRef {
  codeunit: number;
  procedures: string[];
}

/** The [Test] procedures of a test codeunit file, or null for any other file. */
export function parseTestManifest(al: string): TestRef | null {
  if (!isTestCodeunit(al)) return null;
  const codeunit = objectIds(al)[0];
  if (codeunit === undefined) return null;
  const procedures = [
    ...al.matchAll(
      /\[Test\][^\n]*\r?\n(?:\s*\[[^\]]*\][^\n]*\r?\n)*\s*(?:local\s+)?procedure\s+([A-Za-z0-9_]+)\s*\(/gi,
    ),
  ].map((m) => m[1]!);
  return { codeunit, procedures };
}

export interface ProcResult {
  codeunit: number;
  procedure: string;
  passed: boolean;
  failure: "assertion" | "runtime_error" | null;
  message?: string;
}

/**
 * M1-17 `classifyTestFailure` rule, plus BC's lost-asserterror text (the
 * test's own expectation losing). Parity with M1-17 is an open question.
 */
export function classifyTestFailure(
  error: string,
): "assertion" | "runtime_error" {
  return /\bAssert\.\w+ failed\b/i.test(error) ||
      /An error was expected inside an ASSERTERROR statement/i.test(error)
    ? "assertion"
    : "runtime_error";
}

export interface Tally {
  expected: number;
  passed: number;
  assertion: number;
  runtime: number;
  missing: number;
}

export function tally(tests: ProcResult[], refs: TestRef[]): Tally {
  const t: Tally = {
    expected: 0,
    passed: 0,
    assertion: 0,
    runtime: 0,
    missing: 0,
  };
  for (const r of refs) {
    for (const p of r.procedures) {
      t.expected++;
      const hit = tests.find((x) =>
        x.codeunit === r.codeunit && x.procedure === p
      );
      if (!hit) t.missing++;
      else if (hit.passed) t.passed++;
      else if (hit.failure === "assertion") t.assertion++;
      else t.runtime++;
    }
  }
  return t;
}
export const complete = (t: Tally) => t.expected > 0 && t.missing === 0;
export const allPass = (t: Tally) => complete(t) && t.passed === t.expected;
/** Killed: every expected procedure ran and at least one lost an assertion. */
export const assertionKill = (t: Tally) => complete(t) && t.assertion > 0;

export interface BuildStep {
  app: string;
  stage: "compile" | "publish";
  ok: boolean;
  codes: string[];
  detail?: string;
}
export interface RunResult {
  variant: string;
  repeat: number;
  usesOracle: boolean;
  /** Expected procedures of the suite under test (test-authoring, pilot). */
  own: TestRef[];
  builds: BuildStep[];
  tests: ProcResult[];
  staged_hash: string;
  ms: number;
  infra?: string;
}
export type AppState = "ok" | "compile_fail" | "publish_fail" | "not_run";
export interface RunSummary {
  refapp: AppState;
  oracle: AppState | null;
  oracleCodes: string[];
  p2p: Tally;
  f2p: Tally | null;
  own: Tally | null;
  infra: boolean;
}

function appState(run: RunResult, app: string): AppState {
  const b = run.builds.find((x) => x.app === app);
  if (!b) return "not_run";
  if (b.ok) return "ok";
  return b.stage === "compile" ? "compile_fail" : "publish_fail";
}

export function summarize(task: HarnessTask, run: RunResult): RunSummary {
  const states = BUILD_ORDER.map((a) => appState(run, a));
  const oracle = run.usesOracle ? appState(run, "Oracle") : null;
  const testBuilt = appState(run, "Test") === "ok";
  const p2p = tally(run.tests, task.pass_to_pass);
  const f2p = task.fail_to_pass && oracle === "ok"
    ? tally(run.tests, task.fail_to_pass.tests)
    : null;
  const own = run.own.length > 0 ? tally(run.tests, run.own) : null;
  return {
    refapp: states.find((s) => s !== "ok") ?? "ok",
    oracle,
    oracleCodes: run.builds.find((b) => b.app === "Oracle")?.codes ?? [],
    p2p,
    f2p,
    own,
    // Missing results from an app that built are infra, never evidence (GH #13 rule).
    infra: run.infra !== undefined || states.includes("publish_fail") ||
      oracle === "publish_fail" || (testBuilt && p2p.missing > 0) ||
      (f2p !== null && f2p.missing > 0) ||
      (testBuilt && own !== null && own.missing > 0),
  };
}

export interface PlanEntry {
  variant: Variant;
  repeat: number;
}
export interface GateRun extends PlanEntry {
  summary: RunSummary;
  staged_hash: string;
}
export const runKey = (v: Variant, repeat: number) =>
  `${variantName(v)}#${repeat}`;

export function gatePlan(task: HarnessTask, naive: string[]): PlanEntry[] {
  const plan: PlanEntry[] = [];
  const add = (variant: Variant, n: number) => {
    for (let i = 1; i <= n; i++) plan.push({ variant, repeat: i });
  };
  add({ kind: "baseline" }, 1);
  if (task.kind !== "test-authoring") {
    add({ kind: "correct" }, CORRECT_RUNS);
    for (const name of naive) add({ kind: "naive", name }, NAIVE_RUNS);
    return plan;
  }
  const targets = ["m0", ...task.mutants];
  add({ kind: "tests", suite: "reference-tests", mutant: null }, CORRECT_RUNS);
  for (const m of targets) {
    add({ kind: "tests", suite: "reference-tests", mutant: m }, 1);
  }
  for (const name of naive) {
    add({ kind: "tests", suite: `naive/${name}`, mutant: null }, 1);
    for (const m of targets) {
      add({ kind: "tests", suite: `naive/${name}`, mutant: m }, 1);
    }
  }
  return plan;
}

/** Spec 1b section 8 on a complete matrix; see "Decisions argued from the spec". */
export function decideGate(
  task: HarnessTask,
  plan: PlanEntry[],
  runs: GateRun[],
): { promoted: boolean; matrix_complete: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const byKey = new Map(runs.map((r) => [runKey(r.variant, r.repeat), r]));
  let matrixComplete = true;
  for (const p of plan) {
    if (!byKey.has(runKey(p.variant, p.repeat))) {
      matrixComplete = false;
      reasons.push(
        `matrix incomplete: ${runKey(p.variant, p.repeat)} has no run`,
      );
    }
  }
  const hashes = new Map<string, string>();
  for (const r of runs) {
    const name = variantName(r.variant);
    if (hashes.has(name) && hashes.get(name) !== r.staged_hash) {
      reasons.push(`${name}: staged content differs between repeats`);
    }
    hashes.set(name, r.staged_hash);
    if (r.summary.infra) {
      reasons.push(
        `${runKey(r.variant, r.repeat)}: infra, rerun (never scored)`,
      );
    }
  }
  const check = (
    pred: (v: Variant) => boolean,
    test: (s: RunSummary) => boolean,
    why: string,
  ) => {
    for (const r of runs.filter((x) => pred(x.variant))) {
      if (!r.summary.infra && !test(r.summary)) {
        reasons.push(`${runKey(r.variant, r.repeat)}: ${why}`);
      }
    }
  };
  const built = (s: RunSummary) => s.refapp === "ok";
  const naiveNames = new Set(
    plan.flatMap((p) =>
      p.variant.kind === "naive"
        ? [p.variant.name]
        : p.variant.kind === "tests" && p.variant.suite.startsWith("naive/")
        ? [p.variant.suite]
        : []
    ),
  );
  if (naiveNames.size < 2) {
    reasons.push("fewer than two naive variants (spec 1b section 8)");
  }

  if (task.kind !== "test-authoring") {
    check(
      (v) => v.kind === "baseline",
      (s) =>
        built(s) && allPass(s.p2p) &&
        (s.oracle === "compile_fail"
          ? s.oracleCodes.length > 0 &&
            s.oracleCodes.every((c) => MISSING_FEATURE_CODES.has(c))
          : s.oracle === "ok" && s.f2p !== null && complete(s.f2p) &&
            !allPass(s.f2p)),
      "baseline must build, pass pass_to_pass and fail fail_to_pass",
    );
    check(
      (v) => v.kind === "correct",
      (s) =>
        built(s) && allPass(s.p2p) && s.oracle === "ok" && s.f2p !== null &&
        allPass(s.f2p),
      "correct/ must pass every scorer",
    );
    check(
      (v) => v.kind === "naive",
      (s) =>
        built(s) && s.oracle === "ok" && s.f2p !== null && assertionKill(s.f2p),
      "naive must build and lose an oracle assertion with every listed procedure run",
    );
  } else {
    const suite = (name: string, onCorrect: boolean) => (v: Variant) =>
      v.kind === "tests" && v.suite === name &&
      (v.mutant === null) === onCorrect;
    const naiveSuite = (onCorrect: boolean) => (v: Variant) =>
      v.kind === "tests" && v.suite.startsWith("naive/") &&
      (v.mutant === null) === onCorrect;
    check(
      (v) => v.kind === "baseline",
      (s) => built(s) && allPass(s.p2p),
      "baseline must build and pass pass_to_pass",
    );
    check(
      suite("reference-tests", true),
      (s) => built(s) && allPass(s.p2p) && s.own !== null && allPass(s.own),
      "reference tests must all pass on correct/",
    );
    check(
      suite("reference-tests", false),
      (s) => built(s) && s.own !== null && assertionKill(s.own),
      "reference tests must kill this target by assertion",
    );
    check(
      naiveSuite(true),
      (s) => built(s) && s.own !== null && allPass(s.own),
      "naive suite must pass on correct/, or it fails for the wrong reason",
    );
    check(
      naiveSuite(false),
      (s) => built(s) && s.own !== null && complete(s.own),
      "naive suite run is incomplete",
    );
    for (const name of naiveNames) {
      const survives = runs.some((r) =>
        r.variant.kind === "tests" && r.variant.suite === name &&
        r.variant.mutant !== null &&
        r.summary.own !== null && allPass(r.summary.own)
      );
      if (!survives) {
        reasons.push(`${name} must leave at least one mutant alive`);
      }
    }
  }
  return {
    promoted: reasons.length === 0,
    matrix_complete: matrixComplete,
    reasons,
  };
}
