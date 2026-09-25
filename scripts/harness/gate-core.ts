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

/**
 * AL source with comments blanked (line breaks kept) and, unless keepStrings,
 * string literal contents removed, so parsers never match inside either.
 */
export function stripAl(al: string, keepStrings = false): string {
  let out = "";
  for (let i = 0; i < al.length;) {
    const c = al[i]!;
    if (c === "/" && al[i + 1] === "/") {
      // Any line terminator ends it: a lone CR must not hide the next line.
      while (i < al.length && !/[\n\r\u0085\u2028\u2029]/.test(al[i]!)) i++;
      out += " ";
    } else if (c === "/" && al[i + 1] === "*") {
      const end = al.indexOf("*/", i + 2);
      const stop = end < 0 ? al.length : end + 2;
      out += al.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === "'") {
      // AL string: '' inside is an escaped quote.
      let j = i + 1;
      while (j < al.length && !(al[j] === "'" && al[j + 1] !== "'")) {
        j += al[j] === "'" ? 2 : 1;
      }
      out += keepStrings ? al.slice(i, j + 1) : "''";
      i = j + 1;
    } else if (c === '"') {
      const end = al.indexOf('"', i + 1);
      const stop = end < 0 ? al.length : end + 1;
      out += al.slice(i, stop);
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export interface AlObject {
  kind: string;
  id: number;
  name: string;
  /** Stripped source from this header up to the next object header. */
  body: string;
}

// An object keyword at a line start or right after "}" or ";" (so a variable
// type like `C: Codeunit 70001` is not an object), not followed by "=".
const OBJECT_RE =
  /(?<=(?:^|[};])[ \t]*)(table|tableextension|page|pageextension|codeunit|report|reportextension|query|xmlport|enum|enumextension|permissionset|permissionsetextension)\s+(\d+)(?!\s*=)\s*(?:"([^"]*)"|([A-Za-z0-9_]+))?/gim;

/** Numbered objects of a file, parsed with comments and strings stripped. */
export function alObjects(al: string): AlObject[] {
  const text = stripAl(al);
  const heads = [...text.matchAll(OBJECT_RE)];
  return heads.map((m, i) => ({
    kind: m[1]!.toLowerCase(),
    id: Number(m[2]),
    name: m[3] ?? m[4] ?? "",
    body: text.slice(m.index, heads[i + 1]?.index ?? text.length),
  }));
}

export function objectIds(al: string): number[] {
  return alObjects(al).map((o) => o.id);
}
export const isTestObject = (o: AlObject) =>
  o.kind === "codeunit" && /\bSubtype\s*=\s*Test\s*;/i.test(o.body);
export const isTestCodeunit = (al: string) => alObjects(al).some(isTestObject);

export interface TestRef {
  codeunit: number;
  procedures: string[];
}

const TEST_PROC_RE =
  /\[\s*Test\s*\]\s*(?:\[[^\]]*\]\s*)*(?:(?:local|internal)\s+)?procedure\s+(?:"([^"]+)"|([A-Za-z0-9_]+))\s*\(/gi;

/** The [Test] procedures of every test codeunit in a file. */
export function testManifests(al: string): TestRef[] {
  return alObjects(al).filter(isTestObject).map((o) => ({
    codeunit: o.id,
    procedures: [...o.body.matchAll(TEST_PROC_RE)].map((m) => m[1] ?? m[2]!),
  }));
}

/** The first test codeunit of a file, or null for any other file. */
export function parseTestManifest(al: string): TestRef | null {
  return testManifests(al)[0] ?? null;
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
  // An app that never built is infra, unless an earlier app in build order
  // failed to compile: then it was skipped and the compile failure explains it.
  const ordered = oracle === null ? states : [...states, oracle];
  const firstCompileFail = ordered.indexOf("compile_fail");
  const unexplainedNotRun = ordered.some((st, i) =>
    st === "not_run" && (firstCompileFail < 0 || i < firstCompileFail)
  );
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
    infra: run.infra !== undefined || unexplainedNotRun ||
      states.includes("publish_fail") ||
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
  allRuns: GateRun[],
): { promoted: boolean; matrix_complete: boolean; reasons: string[] } {
  const reasons: string[] = [];
  // Score only a one-to-one match of the plan: an unplanned or repeated key is
  // refused and never counted as evidence.
  const planned = new Set(plan.map((p) => runKey(p.variant, p.repeat)));
  const byKey = new Map<string, GateRun>();
  for (const r of allRuns) {
    const key = runKey(r.variant, r.repeat);
    if (!planned.has(key)) reasons.push(`${key}: unplanned run`);
    else if (byKey.has(key)) reasons.push(`${key}: duplicate run`);
    else byKey.set(key, r);
  }
  const runs = [...byKey.values()];
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
    const targets = new Set(["m0", ...task.mutants]);
    for (const name of naiveNames) {
      const survives = runs.some((r) =>
        r.variant.kind === "tests" && r.variant.suite === name &&
        r.variant.mutant !== null && targets.has(r.variant.mutant) &&
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
