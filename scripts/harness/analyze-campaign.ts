/**
 * Post-campaign analysis (A-01): per-execution extraction, matched-pair
 * dossiers and a failure-class table for every variant loss. Read-only on the
 * results: the starting trees are rebuilt from git into the output folder.
 *
 *   deno run --allow-all scripts/harness/analyze-campaign.ts <campaign-id>
 *     --results <harness results root> --rev <task rev> --out <dir>
 *     [--pair baseArm:variantArm ...] [--repo .] [--only <id prefix>,...]
 *
 * Without --pair every variant is paired with the experiment baseline.
 * --only keeps the executions whose id starts with a listed prefix (a smoke).
 * Outputs: executions.json/.csv, pairs.json, losses.csv, summary.json,
 * diffs/<execution>.patch and dossiers/<base>__<variant>/<task>-r<n>.md.
 *
 * A-03: with `--alsem <alsem> --ach <al-call-hierarchy> --symbols <store>
 * [--alsem-jobs 3]` it also runs al-sem (v2.0.1 output contract) on each
 * starting tree and final workspace (no containers) into alsem/: introduced
 * findings, routine metric deltas, new unused procedures, blast radius (alsem
 * diff) and digest touches, per execution, per arm and per matched pair.
 */

import { parseArgs } from "@std/cli/parse-args";
import { basename, join, resolve } from "@std/path";
import type { TraceEvent } from "../../src/harness/trace.ts";
import { applyOverlay, TAR_BINARY } from "../../src/harness/staging.ts";
import { loadTaskAt } from "../../src/harness/task-rev.ts";
import { readTrace } from "../../src/harness/trace.ts";
import { REFAPP_PATH } from "../../src/harness/identity.ts";
import { isTaskBuildArtifact } from "../../src/harness/hash.ts";
import { isSourceFile, TEST_APP } from "../../src/harness/verdict-workspace.ts";

// ---------------------------------------------------------------- profile

export interface SubagentCall {
  call_id: string;
  /** The `agent` of the events it ran (e.g. al-reviewer, Explore); "unknown" when it ran none. */
  type: string;
  start_ms: number;
  duration_ms: number | null;
  tool_calls: number;
}

export interface TraceProfile {
  tool_calls: number;
  tool_errors: number;
  by_category: Record<string, number>;
  by_tool: Record<string, number>;
  by_agent: Record<string, number>;
  subagents: SubagentCall[];
  /** Union of the top-level sub-agent call intervals (parallel calls counted once). */
  subagent_wall_ms: number;
  /** The same union over sub-agents whose type names a review. */
  review_wall_ms: number;
  skills: Record<string, number>;
  compile_calls: number;
  test_calls: number;
  /** compile/test calls with at least one edit since the previous compile/test call. */
  edit_build_cycles: number;
  first_edit_ms: number | null;
  first_compile_ms: number | null;
  first_test_ms: number | null;
  last_event_ms: number | null;
}

const bump = (
  m: Record<string, number>,
  k: string,
) => (m[k] = (Object.hasOwn(m, k) ? m[k]! : 0) + 1);

function unionMs(spans: [number, number][]): number {
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total;
}

export function traceProfile(events: TraceEvent[]): TraceProfile {
  const p: TraceProfile = {
    tool_calls: 0,
    tool_errors: 0,
    by_category: {},
    by_tool: {},
    by_agent: {},
    subagents: [],
    subagent_wall_ms: 0,
    review_wall_ms: 0,
    skills: {},
    compile_calls: 0,
    test_calls: 0,
    edit_build_cycles: 0,
    first_edit_ms: null,
    first_compile_ms: null,
    first_test_ms: null,
    last_event_ms: null,
  };
  const ordered = [...events].sort((a, b) =>
    (a.t_ms ?? 0) - (b.t_ms ?? 0) || a.seq - b.seq
  );
  const subs = new Map<string, SubagentCall>();
  let editedSinceBuild = false;
  for (const e of ordered) {
    if (e.t_ms !== null) {
      p.last_event_ms = Math.max(p.last_event_ms ?? 0, e.t_ms);
    }
    if (e.type === "skill_invoke") bump(p.skills, e.skill ?? "(unnamed)");
    if (e.type !== "tool_call") continue;
    p.tool_calls++;
    if (e.outcome !== null && e.outcome !== "ok") p.tool_errors++;
    const cat = e.category ?? "unclassified";
    bump(p.by_category, cat);
    bump(p.by_tool, e.tool ?? "(none)");
    bump(p.by_agent, e.agent);
    const t = e.t_ms;
    if (e.tool === "Agent" || e.tool === "Task") {
      if (e.call_id !== null) {
        subs.set(e.call_id, {
          call_id: e.call_id,
          type: "unknown",
          start_ms: t ?? 0,
          duration_ms: e.duration_ms,
          tool_calls: 0,
        });
      }
    }
    if (e.parent !== null) {
      const s = subs.get(e.parent);
      if (s) {
        s.tool_calls++;
        if (s.type === "unknown") s.type = e.agent;
      }
    }
    if (cat === "edit") {
      editedSinceBuild = true;
      p.first_edit_ms ??= t;
    } else if (cat === "compile" || cat === "test") {
      if (cat === "compile") {
        p.compile_calls++;
        p.first_compile_ms ??= t;
      } else {
        p.test_calls++;
        p.first_test_ms ??= t;
      }
      if (editedSinceBuild) p.edit_build_cycles++;
      editedSinceBuild = false;
    }
  }
  p.subagents = [...subs.values()];
  // Top level only: a nested call's time is inside its parent's.
  const top = new Set(
    ordered.filter((e) =>
      e.type === "tool_call" && e.parent === null && e.call_id !== null
    ).map((e) => e.call_id!),
  );
  const span = (s: SubagentCall): [number, number] => [
    s.start_ms,
    s.start_ms + (s.duration_ms ?? 0),
  ];
  const topSubs = p.subagents.filter((s) => top.has(s.call_id));
  p.subagent_wall_ms = unionMs(topSubs.map(span));
  p.review_wall_ms = unionMs(
    topSubs.filter((s) => /review/i.test(s.type)).map(span),
  );
  return p;
}

// ---------------------------------------------------------- loss classes

export interface ScorerSummary {
  name: string;
  passed: boolean | null;
  /** `<codeunit>.<procedure>` of every test that did not pass. */
  failed: string[];
}

export interface LossInput {
  termination: string;
  wall_ms: number | null;
  subagent_wall_ms: number;
  review_wall_ms: number;
  compile_calls: number;
  files_changed: number;
  files_outside_touches: number;
  shipped_tests_edited: number;
  /** Apps with build diagnostics in the verdict log, e.g. "candidate/Test". */
  build_diag_apps: string[];
  /** Missing names the agent had added to shipped test files (see missingFromShipped). */
  missing_symbols_added_to_shipped_tests?: string[];
  scorers: ScorerSummary[];
}

export const LOSS_CLASSES = [
  "timeout_in_delegation",
  "timeout_main_loop",
  "other_termination",
  "no_change",
  "never_compiled",
  "own_tests_break_build",
  "build_broken",
  "regression",
  "wrong_behaviour",
  "other",
] as const;
export type LossClass = (typeof LOSS_CLASSES)[number];

/** First matching class wins; tags add what else is true. */
export function classifyLoss(x: LossInput): { cls: LossClass; tags: string[] } {
  const tags: string[] = [];
  if (x.files_outside_touches > 0) tags.push("scope_creep");
  if (x.shipped_tests_edited > 0) tags.push("edited_shipped_tests");
  if (x.missing_symbols_added_to_shipped_tests?.length) {
    tags.push("uses_restored_shipped_edit");
  }
  const wall = x.wall_ms ?? 0;
  if (wall > 0 && x.review_wall_ms / wall >= 0.25) tags.push("review_heavy");
  const failed = (n: string) =>
    x.scorers.find((s) => s.name === n)?.passed === false;
  let cls: LossClass;
  if (x.termination === "timeout") {
    cls = wall > 0 && x.subagent_wall_ms / wall >= 0.5
      ? "timeout_in_delegation"
      : "timeout_main_loop";
  } else if (x.termination !== "completed") cls = "other_termination";
  else if (x.files_changed === 0) cls = "no_change";
  else if (failed("build")) {
    if (x.compile_calls === 0) cls = "never_compiled";
    else if (
      x.build_diag_apps.length > 0 &&
      x.build_diag_apps.every((a) => a.endsWith(`/${TEST_APP}`))
    ) cls = "own_tests_break_build";
    else cls = "build_broken";
  } else if (failed("pass_to_pass")) cls = "regression";
  else if (failed("fail_to_pass")) cls = "wrong_behaviour";
  else cls = "other";
  return { cls, tags };
}

// -------------------------------------------------------------- extraction

interface FileChange {
  path: string;
  app: string;
  status: "added" | "deleted" | "modified";
  added_lines: number;
  removed_lines: number;
  outside_touches: boolean;
  shipped_test: boolean;
}

export interface Row {
  id: string;
  arm: string;
  task: string;
  kind: string;
  repeat: number;
  attempt: number;
  termination: string;
  verdict: string | null;
  judgment_id: string | null;
  wall_ms: number | null;
  cost_usd: number | null;
  tokens_out: number | null;
  tokens_in_total: number | null;
  turns: number | null;
  scorers: ScorerSummary[];
  failure_text: Record<string, string>;
  verdict_notes: string[];
  build_diagnostics: { app: string; code: string; message: string }[];
  profile: TraceProfile | null;
  files: FileChange[];
  patch: string | null;
}

// ---------------------------------------------------------------- al-sem (A-03)

/** The al-sem output contract: schemaVersion per envelope kind. 2.0.3 and 2.1.0-rc.4 emit the same versions as 2.0.2 (their additions are payload fields), so a new version stays unknown and fails. */
const ALSEM_SCHEMAS: Record<string, string[]> = {
  "analyze-report": ["1.0.0"],
  "diff-report": ["1.0.0"],
  digest: ["1.6.0"],
  "capability-snapshot": ["1.1.0"],
};

/** Error-level diagnostics of an al-sem envelope: the analysis is incomplete, so the tree / execution fails (never a zero-findings row). */
export function errorDiagnostics(
  ds: { severity?: string }[],
): { severity?: string }[] {
  return ds.filter((d) => String(d.severity).toLowerCase() === "error");
}

export interface AlsemDiagnostic {
  code: string;
  message: string;
  severity: string;
}

export interface AlsemEnvelope {
  alsemVersion: string;
  schemaVersion: string;
  kind: string;
  diagnostics: AlsemDiagnostic[];
  payload: J;
}

const SEVERITIES = ["critical", "high", "medium", "low", "info"];

const isObj = (x: unknown): x is J =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const isNum = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);

/**
 * `digest --diff --tests` payload.testCoverage (2.0.3). `covered` and
 * `uncovered` are left out of the JSON when empty. Null when valid, else the
 * name of the first bad field. The ratio is covered / changed (null with no
 * changed routine) and `covered` lists exactly the covered routines.
 */
function checkTestCoverage(tc: unknown): string | null {
  if (!isObj(tc)) return "payload.testCoverage";
  if (!isNum(tc["changedRoutines"])) {
    return "payload.testCoverage.changedRoutines";
  }
  if (!isNum(tc["coveredChangedRoutines"])) {
    return "payload.testCoverage.coveredChangedRoutines";
  }
  if (!isObj(tc["coverage"]) || typeof tc["coverage"]["status"] !== "string") {
    return "payload.testCoverage.coverage.status";
  }
  for (const k of ["covered", "uncovered"]) {
    if (tc[k] !== undefined && !(Array.isArray(tc[k]) && tc[k].every(isObj))) {
      return `payload.testCoverage.${k}`;
    }
    const s = (x: unknown) => typeof x === "string" && x !== "";
    for (const it of (tc[k] ?? []) as J[]) {
      const a = it["anchor"];
      if (
        !s(it["stableId"]) || (k === "uncovered" && !s(it["reason"])) ||
        (a !== undefined && !(isObj(a) && typeof a["file"] === "string"))
      ) return `payload.testCoverage.${k}[]`;
    }
  }
  const ids = (k: string) =>
    ((tc[k] ?? []) as J[]).map((it) => it["stableId"] as string);
  const cov = ids("covered");
  const unc = ids("uncovered");
  if (new Set(cov).size !== cov.length || unc.some((id) => cov.includes(id))) {
    return "payload.testCoverage.covered[]";
  }
  if (new Set(unc).size !== unc.length) {
    return "payload.testCoverage.uncovered[]";
  }
  const changed = tc["changedRoutines"];
  const covered = tc["coveredChangedRoutines"];
  const ratio = tc["ratio"];
  if (
    ratio !== null &&
    !(isNum(ratio) && changed > 0 && Math.abs(ratio - covered / changed) < 1e-9)
  ) return "payload.testCoverage.ratio";
  if (ratio === null && changed !== 0) return "payload.testCoverage.ratio";
  if (
    covered > changed ||
    ((tc["covered"] as unknown[] | undefined)?.length ?? 0) !== covered
  ) {
    return "payload.testCoverage.covered";
  }
  const n = (k: string) => (tc[k] as unknown[] | undefined)?.length ?? 0;
  if (n("covered") + n("uncovered") !== changed) {
    return "payload.testCoverage.uncovered";
  }
  return null;
}

/** Payload fields the runner reads, per envelope kind. `tests`: the digest was run with --tests. */
function checkPayload(kind: string, p: J, tests: boolean): string | null {
  const arr = (k: string) => Array.isArray(p[k]) ? null : `payload.${k}`;
  const obj = (k: string) => isObj(p[k]) ? null : `payload.${k}`;
  const str = (x: unknown) => typeof x === "string" && x !== "";
  const first = <T>(xs: T[], bad: (x: T) => string | null) => {
    for (const x of xs) {
      const b = bad(x);
      if (b) return b;
    }
    return null;
  };
  switch (kind) {
    case "analyze-report":
      return arr("findings") ?? first(p["findings"] as unknown[], (f) => {
        if (!isObj(f)) return "payload.findings[]";
        const loc = f["primaryLocation"];
        const conf = f["confidence"];
        return !str(f["detector"])
          ? "payload.findings[].detector"
          : !SEVERITIES.includes(f["severity"] as string)
          ? "payload.findings[].severity"
          : !isObj(conf) ||
              !["likely", "possible"].includes(conf["level"] as string)
          ? "payload.findings[].confidence.level"
          : !isObj(loc) || !str(loc["file"])
          ? "payload.findings[].primaryLocation.file"
          : !str(f["fingerprint"])
          ? "payload.findings[].fingerprint"
          : !str(f["looseFingerprint"])
          ? "payload.findings[].looseFingerprint"
          : null;
      });
    case "digest":
      return arr("entries") ?? obj("summary") ??
        arr("changedRootsDiagnostics") ??
        first(
          ["rootsRequested", "rootsResolved", "totalUnresolved"],
          (k) =>
            (p["summary"] as J)[k] === undefined ||
              (Number.isInteger((p["summary"] as J)[k]) &&
                ((p["summary"] as J)[k] as number) >= 0)
              ? null
              : `payload.summary.${k}`,
        ) ??
        first(
          p["changedRootsDiagnostics"] as unknown[],
          (d) =>
            isObj(d) && str(d["kind"])
              ? null
              : "payload.changedRootsDiagnostics[].kind",
        ) ??
        first(p["entries"] as unknown[], (e) => {
          if (!isObj(e) || !isObj(e["routine"])) {
            return "payload.entries[].routine";
          }
          const r = e["routine"];
          const anchor = r["anchor"];
          const fx = e["effects"];
          return e["unresolved"] !== undefined &&
              !Array.isArray(e["unresolved"])
            ? "payload.entries[].unresolved"
            : !str(r["stableId"])
            ? "payload.entries[].routine.stableId"
            : !isObj(anchor)
            ? "payload.entries[].routine.anchor"
            : !str(anchor["file"])
            ? "payload.entries[].routine.anchor.file"
            : fx !== undefined && !Array.isArray(fx)
            ? "payload.entries[].effects"
            : first(
              (fx ?? []) as unknown[],
              (x) => {
                if (
                  !isObj(x) || !str(x["type"]) ||
                  !(x["detail"] === undefined || isObj(x["detail"]))
                ) return "payload.entries[].effects[]";
                const d = x["detail"];
                const t = x["type"] as string;
                const needsName =
                  (t.startsWith("DB_") || t === "EVENT_PUBLISH") &&
                  !(isObj(d) && d["boundary"] !== undefined);
                return (isObj(d) &&
                    ["boundary", "resourceDisplay"].some((k) =>
                      d[k] !== undefined && typeof d[k] !== "string"
                    )) ||
                    (needsName && !(isObj(d) && str(d["resourceDisplay"])))
                  ? "payload.entries[].effects[].detail"
                  : null;
              },
            );
        }) ??
        (tests ? checkTestCoverage(p["testCoverage"]) : null);
    case "diff-report": {
      const cats = isObj(p["summary"])
        ? (p["summary"] as J)["findingsByCategory"]
        : undefined;
      return arr("findings") ?? obj("summary") ??
        (!isObj(cats) ||
            !Object.values(cats).every((n) =>
              typeof n === "number" && Number.isInteger(n) && n >= 0
            )
          ? "payload.summary.findingsByCategory"
          : null) ??
        first(p["findings"] as unknown[], (f) => {
          if (!isObj(f)) return "payload.findings[]";
          const s = f["subject"];
          return !str(f["kind"])
            ? "payload.findings[].kind"
            : !str(f["category"])
            ? "payload.findings[].category"
            : !SEVERITIES.includes(f["severity"] as string)
            ? "payload.findings[].severity"
            // A-03 self-check r3: the id blastRadius reads, same precedence.
            : !isObj(s) ||
                !str(
                  s["newStableId"] ?? s["oldStableId"] ??
                    s["normalizedStableId"],
                )
            ? "payload.findings[].subject"
            : null;
        });
    }
    default:
      return null; // capability-snapshot: only handed to `alsem diff` as a file
  }
}

/**
 * An `alsem ... --format json` envelope. Strict: every required field must be
 * present with its type (never coerced or defaulted), the kind and schemaVersion
 * must be the expected ones, and the payload must have the fields the runner reads.
 */
export function alsemEnvelope(
  doc: unknown,
  kind: string,
  opts: { tests?: boolean } = {},
): AlsemEnvelope {
  if (!isObj(doc)) throw new Error(`al-sem ${kind}: output is not an object`);
  const d = doc;
  if (d["kind"] !== kind) {
    throw new Error(`al-sem: expected kind "${kind}", got kind "${d["kind"]}"`);
  }
  const v = d["schemaVersion"];
  if (typeof v !== "string" || !ALSEM_SCHEMAS[kind]!.includes(v)) {
    throw new Error(
      `al-sem ${kind}: unknown schemaVersion "${v}" (known: ${
        ALSEM_SCHEMAS[kind]!.join(", ")
      })`,
    );
  }
  const bad = typeof d["alsemVersion"] !== "string"
    ? "alsemVersion"
    : !Array.isArray(d["diagnostics"]) ||
        !d["diagnostics"].every((x) =>
          isObj(x) && typeof x["severity"] === "string"
        )
    ? "diagnostics"
    : !isObj(d["payload"])
    ? "payload"
    : checkPayload(kind, d["payload"], opts.tests === true);
  if (bad) throw new Error(`al-sem ${kind}: missing or malformed ${bad}`);
  return {
    alsemVersion: d["alsemVersion"] as string,
    schemaVersion: v,
    kind,
    diagnostics: d["diagnostics"] as AlsemDiagnostic[],
    payload: d["payload"] as J,
  };
}

/** al-call-hierarchy output (no envelope): the metrics / findings fields the runner reads. */
export function checkedAch(text: string): AchReport {
  let ach: unknown;
  try {
    ach = JSON.parse(text);
  } catch {
    throw new Error("al-call-hierarchy: output is not JSON");
  }
  if (
    !isObj(ach) || !Array.isArray(ach["metrics"]) ||
    !Array.isArray(ach["findings"])
  ) {
    throw new Error("al-call-hierarchy: output has no metrics / findings");
  }
  const num = (x: unknown) => typeof x === "number";
  const str = (x: unknown) => typeof x === "string";
  // Nullable by design: routine_id (some members have none) and fan_in (no call graph).
  const strOrNull = (x: unknown) => x === null || str(x);
  const numOrNull = (x: unknown) => x === null || num(x);
  const badMetric = (m: unknown): string | null => {
    if (!isObj(m)) return "row";
    const checks: [string, boolean][] = [
      ["path", str(m["path"])],
      ["object_type", str(m["object_type"])],
      ["object_name", str(m["object_name"])],
      ["procedure_name", str(m["procedure_name"])],
      ["access", str(m["access"])],
      ["line", num(m["line"])],
      ["complexity", num(m["complexity"])],
      ["line_count", num(m["line_count"])],
      ["parameter_count", num(m["parameter_count"])],
      ["routine_id", strOrNull(m["routine_id"] ?? null)],
      ["fan_in", numOrNull(m["fan_in"])],
    ];
    return checks.find(([, ok]) => !ok)?.[0] ?? null;
  };
  for (const m of ach["metrics"]) {
    const b = badMetric(m);
    if (b) {
      throw new Error(`al-call-hierarchy: a metrics row is malformed: ${b}`);
    }
  }
  for (const f of ach["findings"]) {
    if (!isObj(f)) throw new Error("al-call-hierarchy: a finding is malformed");
    if (f["category"] !== "unused_procedure") continue;
    // Read by unusedProcedures: "path:line" location, path, procedure.
    const b = !str(f["path"])
      ? "path"
      : !str(f["procedure"])
      ? "procedure"
      : !/:\d+$/.test(String(f["location"])) || !str(f["location"])
      ? "location"
      : null;
    if (b) {
      throw new Error(
        `al-call-hierarchy: an unused_procedure finding is malformed: ${b}`,
      );
    }
  }
  const bad = badTestQuality(ach["test_quality"]);
  if (bad) throw new Error(`al-call-hierarchy: test_quality: ${bad}`);
  return ach as unknown as AchReport;
}

/** `test_quality` of `al-call-hierarchy --analyze` (2.0.3): null when valid, else what is wrong. */
function badTestQuality(tq: unknown): string | null {
  if (!isObj(tq)) return "missing (an output older than 2.0.3?)";
  if (!Array.isArray(tq["procedures"])) return "procedures is not an array";
  const eq = (x: unknown) =>
    isObj(x) && isNum(x["total"]) && isNum(x["literal_expected"]) &&
    isNum(x["expression_expected"]);
  for (const p of tq["procedures"]) {
    const ok = isObj(p) && typeof p["path"] === "string" && isNum(p["line"]) &&
      typeof p["object_stable_id"] === "string" &&
      typeof p["procedure_name"] === "string" &&
      (p["routine_id"] === null || p["routine_id"] === undefined ||
        typeof p["routine_id"] === "string") &&
      isNum(p["assert_count"]) && isNum(p["assert_count_reachable"]) &&
      typeof p["zero_assert"] === "boolean" &&
      typeof p["has_asserterror"] === "boolean" && eq(p["are_equal"]);
    if (!ok) return "a procedure row is malformed";
    const ae = p["are_equal"] as J;
    const counts: [string, unknown][] = [
      ["assert_count", p["assert_count"]],
      ["assert_count_reachable", p["assert_count_reachable"]],
      ["are_equal.total", ae["total"]],
      ["are_equal.literal_expected", ae["literal_expected"]],
      ["are_equal.expression_expected", ae["expression_expected"]],
    ];
    const badCount = counts.find(([, v]) =>
      !Number.isInteger(v) || (v as number) < 0
    );
    if (badCount) return `${badCount[0]} is not a nonnegative integer`;
    if (
      (ae["literal_expected"] as number) +
          (ae["expression_expected"] as number) !== ae["total"]
    ) return "are_equal.literal_expected + expression_expected != total";
    if (
      (p["assert_count_reachable"] as number) < (p["assert_count"] as number)
    ) return "assert_count_reachable < assert_count";
    if (p["zero_assert"] !== (p["assert_count_reachable"] === 0)) {
      return "zero_assert disagrees with assert_count_reachable";
    }
  }
  const ws = tq["workspace"];
  const procs = tq["procedures"] as TestProc[];
  if (
    !isObj(ws) || ws["test_procedures"] !== procs.length ||
    ws["assert_count_reachable"] !==
      procs.reduce((s, p) => s + p.assert_count_reachable, 0)
  ) return "workspace totals disagree with the procedures";
  return null;
}

/** A failed spawn; exit 4 is `--require-dependencies` refusing an incomplete dependency closure. */
export function exitError(
  cmd: string,
  args: string[],
  code: number,
  stderr: string,
): Error {
  const what = `${basename(cmd)} ${args.join(" ")}`;
  return new Error(
    code === 4
      ? `missing dependencies (exit 4): ${what}: ${stderr}`
      : `${what}: exit ${code}: ${stderr}`,
  );
}

export interface AlsemFinding {
  detector: string;
  severity: string;
  /** analyze `confidence.level`: "likely" or "possible"; "" when the finding has none. */
  confidence: string;
  object: string;
  routine: string;
  file: string;
  line: number;
  app: string;
  fingerprint: string;
  /** 2.0.3: stable when the finding moves to another routine; not unique. */
  looseFingerprint: string;
}

/** `alsem analyze` payload findings, located by workspace-relative file. */
export function alsemFindings(payload: J): AlsemFinding[] {
  return (payload["findings"] as J[]).map((f) => {
    const loc = (f["primaryLocation"] ?? {}) as J;
    const file = String(loc["file"] ?? "").replace(/^ws:/, "");
    return {
      detector: f["detector"] as string,
      severity: f["severity"] as string,
      confidence: String((f["confidence"] as J | undefined)?.["level"] ?? ""),
      object: (loc["objectName"] as string | undefined) ?? "",
      routine: (loc["routineName"] as string | undefined) ?? "",
      file,
      line: (loc["line"] as number | undefined) ?? 0,
      app: file.split("/")[0]!,
      fingerprint: f["fingerprint"] as string,
      looseFingerprint: f["looseFingerprint"] as string,
    };
  });
}

/**
 * Findings the agent introduced under the 2.0.3 looseFingerprint rule: per
 * looseFingerprint k, new = max(0, after(k) - before(k)), summed (the key is
 * not unique and a finding that moved to another routine keeps it). The new
 * ones are named by pairing start with final on both keys first, then on
 * looseFingerprint; the unpaired finals are the new findings. One row per
 * fingerprint: its first unpaired final instance and how many there are.
 * Valid only for runs of the same scope, filters and dependencies.
 */
export function introducedFindings(
  start: AlsemFinding[],
  final: AlsemFinding[],
): (AlsemFinding & { count: number })[] {
  const both = (f: AlsemFinding) => `${f.fingerprint}\0${f.looseFingerprint}`;
  const left = new Map<string, number>();
  const bothBudget = new Map<string, number>();
  for (const f of start) {
    bothBudget.set(both(f), (bothBudget.get(both(f)) ?? 0) + 1);
  }
  const unpaired: AlsemFinding[] = [];
  for (const f of final) {
    const n = bothBudget.get(both(f)) ?? 0;
    if (n > 0) bothBudget.set(both(f), n - 1);
    else unpaired.push(f);
  }
  // Start findings not paired on both keys are the budget of the second phase.
  for (const f of start) {
    const n = bothBudget.get(both(f)) ?? 0;
    if (n > 0) {
      bothBudget.set(both(f), n - 1);
      left.set(f.looseFingerprint, (left.get(f.looseFingerprint) ?? 0) + 1);
    }
  }
  const out = new Map<string, AlsemFinding & { count: number }>();
  for (const f of unpaired) {
    const n = left.get(f.looseFingerprint) ?? 0;
    if (n > 0) {
      left.set(f.looseFingerprint, n - 1);
      continue;
    }
    const row = out.get(f.fingerprint);
    if (row) row.count++;
    else out.set(f.fingerprint, { ...f, count: 1 });
  }
  return [...out.values()];
}

/**
 * A-03's count, kept as the secondary `_fp` columns: final minus start matched
 * by al-sem's fingerprint (stable across line shifts, but not across a move to
 * another routine, which therefore counts as introduced), as a multiset. One
 * row per fingerprint: its first surplus final instance and how many surplus there are.
 */
export function introducedFindingsFp(
  start: AlsemFinding[],
  final: AlsemFinding[],
): (AlsemFinding & { count: number })[] {
  const key = (f: AlsemFinding) => f.fingerprint;
  const budget = new Map<string, number>();
  for (const f of start) budget.set(key(f), (budget.get(key(f)) ?? 0) + 1);
  const out = new Map<string, AlsemFinding & { count: number }>();
  for (const f of final) {
    const k = key(f);
    const left = budget.get(k) ?? 0;
    if (left > 0) {
      budget.set(k, left - 1);
      continue;
    }
    const row = out.get(k);
    if (row) row.count++;
    else out.set(k, { ...f, count: 1 });
  }
  return [...out.values()];
}

/** One `al-call-hierarchy --analyze --format json` metrics row (2.0.1). */
export interface RoutineMetric {
  object_type: string;
  object_name: string;
  procedure_name: string;
  line: number;
  complexity: number;
  line_count: number;
  parameter_count: number;
  /** Workspace-relative POSIX path. */
  path: string;
  access: string;
  /** = alsem digest routine.stableId and diff subject.*StableId (not analyze's routineId); null for some members. */
  routine_id: string | null;
  fan_in: number | null;
  fan_out: number | null;
}

/** One [Test] procedure of `al-call-hierarchy --analyze` `test_quality.procedures` (2.0.3), the fields the runner reads. */
export interface TestProc {
  /** Workspace-relative POSIX path. */
  path: string;
  line: number;
  /** `<appId>/Codeunit/N`. */
  object_stable_id: string;
  procedure_name: string;
  /** = digest routine.stableId; null when al-sem has none. */
  routine_id: string | null;
  /** Asserts in the procedure and in the same-app helpers it calls. */
  assert_count_reachable: number;
  /** No reachable assert. */
  zero_assert: boolean;
  has_asserterror: boolean;
  are_equal: {
    total: number;
    literal_expected: number;
    expression_expected: number;
  };
}

export interface AchReport {
  metrics: RoutineMetric[];
  findings: J[];
  test_quality: { procedures: TestProc[] };
}

/** The runner's slice of every `test_quality` procedure (the whole block is validated by checkedAch). */
export function testProcedures(ach: AchReport): TestProc[] {
  return ach.test_quality.procedures.map((p) => ({
    path: p.path,
    line: p.line,
    object_stable_id: p.object_stable_id,
    procedure_name: p.procedure_name,
    routine_id: p.routine_id ?? null,
    assert_count_reachable: p.assert_count_reachable,
    zero_assert: p.zero_assert,
    has_asserterror: p.has_asserterror,
    are_equal: {
      total: p.are_equal.total,
      literal_expected: p.are_equal.literal_expected,
      expression_expected: p.are_equal.expression_expected,
    },
  }));
}

/** Counts over the Test app's [Test] procedures introduced or changed by an execution. */
export interface TestQualityCounts {
  /** Procedures in final and not in start. */
  new_test_procs: number;
  /** Introduced or changed (the digest named them a changed root). */
  scored: number;
  assert_reachable: number;
  zero_assert: number;
  asserterror: number;
  areequal_total: number;
  areequal_literal: number;
}

/**
 * Introduced or changed [Test] procedures, final vs start, Test app only.
 * Joined by routine_id, else (path, line); `changed` holds the digest's changed
 * root stableIds (a procedure the patch touched keeps its routine_id, its
 * body is not part of it).
 */
export function testQualityCounts(
  start: TestProc[],
  final: TestProc[],
  changed: Set<string>,
): TestQualityCounts {
  const inTest = (p: TestProc) => p.path.split("/")[0] === TEST_APP;
  const key = (p: TestProc) => p.routine_id ?? `${p.path}:${p.line}`;
  const before = new Set(start.filter(inTest).map(key));
  const c: TestQualityCounts = {
    new_test_procs: 0,
    scored: 0,
    assert_reachable: 0,
    zero_assert: 0,
    asserterror: 0,
    areequal_total: 0,
    areequal_literal: 0,
  };
  for (const p of final.filter(inTest)) {
    const isNew = !before.has(key(p));
    if (isNew) c.new_test_procs++;
    if (!isNew && !(p.routine_id !== null && changed.has(p.routine_id))) {
      continue;
    }
    c.scored++;
    c.assert_reachable += p.assert_count_reachable;
    if (p.zero_assert) c.zero_assert++;
    if (p.has_asserterror) c.asserterror++;
    c.areequal_total += p.are_equal.total;
    c.areequal_literal += p.are_equal.literal_expected;
  }
  return c;
}

const share = (n: number, d: number) => d === 0 ? null : n / d;

/** Test quality pooled over executions: shares from the summed counts, null when the denominator is 0. */
export function pooledTestQuality(
  ms: Pick<
    AlsemMetrics,
    | "new_test_procs"
    | "test_procs_scored"
    | "test_assert_reachable_sum"
    | "test_zero_assert_procs"
    | "test_asserterror_procs"
    | "test_areequal_total"
    | "test_areequal_literal"
  >[],
) {
  const s = (k: keyof typeof ms[number]) => ms.reduce((a, m) => a + m[k], 0);
  const scored = s("test_procs_scored");
  return {
    new_test_procs: s("new_test_procs"),
    procs_scored: scored,
    assert_reachable_mean: share(s("test_assert_reachable_sum"), scored),
    zero_assert_share: share(s("test_zero_assert_procs"), scored),
    asserterror_share: share(s("test_asserterror_procs"), scored),
    areequal_literal_share: share(
      s("test_areequal_literal"),
      s("test_areequal_total"),
    ),
  };
}

/** Test coverage of the changed production routines pooled over executions. */
export function pooledCoverage(
  ms: Pick<
    AlsemMetrics,
    | "test_changed_routines"
    | "test_covered_routines"
    | "test_uncovered_routines"
  >[],
) {
  const s = (k: keyof typeof ms[number]) => ms.reduce((a, m) => a + m[k], 0);
  return {
    changed_routines: s("test_changed_routines"),
    covered_routines: s("test_covered_routines"),
    uncovered_routines: s("test_uncovered_routines"),
    ratio: share(s("test_covered_routines"), s("test_changed_routines")),
  };
}

/**
 * What `pooledCoverage` leaves out: declaration-only routines, al-sem's raw
 * (unfiltered) counts, and the share of executions with a coverage status whose
 * status is "partial" (tests call dependency code, so the ratio is a floor).
 */
export function coverageExtras(
  rs: {
    metrics: Pick<
      AlsemMetrics,
      | "test_declaration_only"
      | "test_changed_routines_raw"
      | "test_covered_routines_raw"
    >;
    touches: Pick<DigestTouches, "test_coverage_status">;
  }[],
) {
  const s = (k: keyof typeof rs[number]["metrics"]) =>
    rs.reduce((a, r) => a + r.metrics[k], 0);
  const withStatus = rs.filter((r) => r.touches.test_coverage_status !== null);
  return {
    declaration_only: s("test_declaration_only"),
    partial_status_share: share(
      withStatus.filter((r) => r.touches.test_coverage_status === "partial")
        .length,
      withStatus.length,
    ),
    raw: {
      changed_routines: s("test_changed_routines_raw"),
      covered_routines: s("test_covered_routines_raw"),
      ratio: share(
        s("test_covered_routines_raw"),
        s("test_changed_routines_raw"),
      ),
    },
  };
}

const routineKey = (m: RoutineMetric) =>
  m.routine_id ?? `${m.object_type}|${m.object_name}|${m.procedure_name}`;

export interface RoutineDelta {
  app: string;
  object: string;
  routine: string;
  routine_id: string | null;
  status: "added" | "changed" | "removed";
  /** Final complexity (0 when removed). */
  complexity: number;
  d_complexity: number;
  d_lines: number;
  d_params: number;
  /** null when either side has no call graph. */
  d_fan_in: number | null;
  /** A changed root of the patch (alsem digest stableId). */
  in_patch: boolean;
}

/**
 * Per routine (al-call-hierarchy metrics joined by routine_id, so overloads
 * stay apart): the routines added, removed, with complexity / length /
 * parameters changed, or touched by the patch (`changed`: digest stableIds),
 * sorted by app, object, routine. App = first segment of the path.
 */
export function routineDeltas(
  start: RoutineMetric[],
  final: RoutineMetric[],
  changed: Set<string>,
): RoutineDelta[] {
  const a = new Map(start.map((m) => [routineKey(m), m]));
  const b = new Map(final.map((m) => [routineKey(m), m]));
  const out: RoutineDelta[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const s = a.get(k);
    const f = b.get(k);
    const m = (f ?? s)!;
    const dc = (f?.complexity ?? 0) - (s?.complexity ?? 0);
    const dl = (f?.line_count ?? 0) - (s?.line_count ?? 0);
    const dp = (f?.parameter_count ?? 0) - (s?.parameter_count ?? 0);
    const inPatch = m.routine_id !== null && changed.has(m.routine_id);
    if (s && f && dc === 0 && dl === 0 && dp === 0 && !inPatch) continue;
    const fi = (x: RoutineMetric | undefined) => x ? x.fan_in : 0;
    out.push({
      app: m.path.split("/")[0]!,
      object: m.object_name,
      routine: m.procedure_name,
      routine_id: m.routine_id,
      status: !s ? "added" : !f ? "removed" : "changed",
      complexity: f?.complexity ?? 0,
      d_complexity: dc,
      d_lines: dl,
      d_params: dp,
      d_fan_in: fi(f) === null || fi(s) === null ? null : fi(f)! - fi(s)!,
      in_patch: inPatch,
    });
  }
  const cmp = (x: RoutineDelta) =>
    `${x.app}\0${x.object}\0${x.routine}\0${x.routine_id}`;
  return out.sort((x, y) => cmp(x).localeCompare(cmp(y)));
}

export interface UnusedProc {
  app: string;
  procedure: string;
  path: string;
  line: number;
  /** From the metrics row at the same path + line; "unknown" when none. */
  access: string;
  routine_id: string | null;
}

/** al-call-hierarchy `unused_procedure` findings, joined to their metrics row by path + line. */
export function unusedProcedures(
  ach: Pick<AchReport, "metrics" | "findings">,
): UnusedProc[] {
  const at = new Map(ach.metrics.map((m) => [`${m.path}:${m.line}`, m]));
  return ach.findings.filter((f) => f["category"] === "unused_procedure").map(
    (f) => {
      const path = f["path"] as string;
      const line = Number(String(f["location"]).split(":").pop());
      const m = at.get(`${path}:${line}`);
      return {
        app: path.split("/")[0]!,
        procedure: f["procedure"] as string,
        path,
        line,
        access: m?.access ?? "unknown",
        routine_id: m?.routine_id ?? null,
      };
    },
  );
}

/** Unused in final, not unused in start (by routine_id, else path + procedure). */
export function newUnused(
  start: UnusedProc[],
  final: UnusedProc[],
): UnusedProc[] {
  const key = (u: UnusedProc) => u.routine_id ?? `${u.path}|${u.procedure}`;
  const before = new Set(start.map(key));
  return final.filter((u) => !before.has(key(u)));
}

export interface BlastSide {
  abi: number;
  schema: number;
  events: number;
  permissions: number;
  capabilities: number;
  by_kind: Record<string, number>;
  critical_or_high: number;
}

export interface Blast {
  /** summary.findingsByCategory, both apps. */
  total: Record<string, number>;
  production: BlastSide;
  test: BlastSide;
}

/**
 * `alsem diff` payload findings, production vs Test app by object id; the
 * per-side categories must add up to summary.findingsByCategory. A changed
 * public signature is one `procedure-signature-changed` finding (by_kind).
 */
export function blastRadius(
  payload: J,
  testRanges: [number, number][],
): Blast {
  const side = (): BlastSide => ({
    abi: 0,
    schema: 0,
    events: 0,
    permissions: 0,
    capabilities: 0,
    by_kind: {},
    critical_or_high: 0,
  });
  const total =
    ((payload["summary"] as J | undefined)?.["findingsByCategory"] ??
      {}) as Record<string, number>;
  const r = { total, production: side(), test: side() };
  for (const f of payload["findings"] as J[]) {
    const subj = (f["subject"] ?? {}) as J;
    const id = String(
      subj["newStableId"] ?? subj["oldStableId"] ??
        subj["normalizedStableId"] ?? "",
    );
    const n = Number(/:[A-Za-z]+:(\d+)/.exec(id)?.[1] ?? NaN);
    const s = testRanges.some(([lo, hi]) => n >= lo && n <= hi)
      ? r.test
      : r.production;
    const cat = f["category"] as string;
    if (cat in s && cat !== "by_kind" && cat !== "critical_or_high") {
      (s as unknown as Record<string, number>)[cat]!++;
    }
    bump(s.by_kind, f["kind"] as string);
    if (f["severity"] === "critical" || f["severity"] === "high") {
      s.critical_or_high++;
    }
  }
  for (const [cat, n] of Object.entries(total)) {
    const got = (r.production as unknown as Record<string, number>)[cat]! +
      (r.test as unknown as Record<string, number>)[cat]!;
    if (got !== n) {
      throw new Error(
        `alsem diff: summary.findingsByCategory.${cat} = ${n}, findings give ${got}`,
      );
    }
  }
  return r;
}

export interface DigestTouches {
  roots: number;
  production_roots: number;
  roots_requested: number;
  roots_resolved: number;
  /** routine.stableId of every changed root (joins al-call-hierarchy routine_id). */
  changed_routines: string[];
  tables_written: string[];
  tables_read: string[];
  events_published: string[];
  commits: number;
  /** Sum of entries[].unresolved lengths over production entries (rc.4 puts dependency routines' unresolved calls on the Test app's entries). */
  unresolved: number;
  /** summary.totalUnresolved as al-sem reports it. */
  unresolved_raw: number;
  /** Dependency boundary-group effects (detail.boundary) on production entries; not in tables / events / commits. */
  dependency_effect_groups: number;
  /** Diff hunks al-sem could not map to a routine. */
  unmapped_hunks: number;
  /** Changed files with no routine to map (e.g. an enum or a fields-only table extension). */
  unmatched_files: number;
  /**
   * digest --tests testCoverage restricted to production routines (file not under
   * ws:Test/), declaration-only ones out of the denominator; 0 without a digest.
   * al-sem excludes only [Test] procedures, so its own counts (the *_raw fields)
   * also hold test-app helper codeunits and non-[Test] procedures of test codeunits.
   */
  test_changed_routines: number;
  test_covered_routines: number;
  test_uncovered_routines: number;
  /** covered / changed; null when no routine changed or there is no digest. */
  test_coverage_ratio: number | null;
  /** Production uncovered routines with reason "declaration-only" (interface methods, no body): not in the denominator. */
  test_declaration_only: number;
  /** al-sem's own testCoverage values, unfiltered. */
  test_changed_routines_raw: number;
  test_covered_routines_raw: number;
  test_uncovered_routines_raw: number;
  test_coverage_ratio_raw: number | null;
  /** testCoverage.coverage.status ("partial" when tests call dependency code); null without a digest. */
  test_coverage_status: string | null;
}

const WRITES = new Set(["DB_INSERT", "DB_MODIFY", "DB_DELETE", "DB_RENAME"]);

/** `alsem digest --diff` payload: what the changed production routines touch. */
export function digestTouches(p: J): DigestTouches {
  const entries = p["entries"] as J[];
  const sum = (p["summary"] ?? {}) as J;
  const diags = (p["changedRootsDiagnostics"] ?? []) as J[];
  const written = new Set<string>();
  const read = new Set<string>();
  const events = new Set<string>();
  let commits = 0;
  let prod = 0;
  let unresolved = 0;
  let depGroups = 0;
  for (const e of entries) {
    const anchor = ((e["routine"] as J)["anchor"] ?? {}) as J;
    if (String(anchor["file"] ?? "").startsWith(`ws:${TEST_APP}/`)) continue;
    prod++;
    unresolved += ((e["unresolved"] ?? []) as unknown[]).length;
    for (const x of (e["effects"] ?? []) as J[]) {
      const t = x["type"] as string;
      const detail = x["detail"] as J | undefined;
      if (typeof detail?.["boundary"] === "string") {
        depGroups++;
        continue;
      }
      const what = String(detail?.["resourceDisplay"] ?? "");
      if (WRITES.has(t)) written.add(what);
      else if (t.startsWith("DB_")) read.add(what);
      else if (t === "EVENT_PUBLISH") events.add(what);
      else if (t === "COMMIT") commits++;
    }
  }
  const sorted = (s: Set<string>) => [...s].sort();
  // Validated by alsemEnvelope(..., { tests: true }); absent only for "no digest".
  const tc = p["testCoverage"] as J | undefined;
  const fileOf = new Map(
    entries.map((e) => {
      const r = e["routine"] as J;
      return [
        r["stableId"],
        String((r["anchor"] as J | undefined)?.["file"] ?? ""),
      ];
    }),
  );
  // Fail closed: a routine whose file is unknown cannot be split into production / test.
  const isProd = (c: J): boolean => {
    const file = (c["anchor"] as J | undefined)?.["file"] ??
      fileOf.get(c["stableId"]);
    if (typeof file !== "string" || file === "") {
      throw new Error(
        `payload.testCoverage: cannot map stableId ${
          String(c["stableId"])
        } to a file`,
      );
    }
    return !file.startsWith(`ws:${TEST_APP}/`);
  };
  const rawCovered = (tc?.["covered"] ?? []) as J[];
  const rawUncovered = (tc?.["uncovered"] ?? []) as J[];
  const coveredProd = rawCovered.filter(isProd).length;
  const uncoveredProd = rawUncovered.filter(isProd);
  const declOnly =
    uncoveredProd.filter((u) => u["reason"] === "declaration-only")
      .length;
  const uncovered = uncoveredProd.length - declOnly;
  const changed = coveredProd + uncovered;
  return {
    test_changed_routines: changed,
    test_covered_routines: coveredProd,
    test_uncovered_routines: uncovered,
    test_coverage_ratio: changed === 0 ? null : coveredProd / changed,
    test_declaration_only: declOnly,
    test_changed_routines_raw: Number(tc?.["changedRoutines"] ?? 0),
    test_covered_routines_raw: Number(tc?.["coveredChangedRoutines"] ?? 0),
    test_uncovered_routines_raw: rawUncovered.length,
    test_coverage_ratio_raw: (tc?.["ratio"] as number | null | undefined) ??
      null,
    test_coverage_status: ((tc?.["coverage"] as J | undefined)?.["status"] as
      | string
      | undefined) ?? null,
    roots: entries.length,
    production_roots: prod,
    roots_requested: Number(sum["rootsRequested"] ?? 0),
    roots_resolved: Number(sum["rootsResolved"] ?? 0),
    changed_routines: entries.map((e) => (e["routine"] as J)["stableId"])
      .filter((x): x is string => typeof x === "string"),
    tables_written: sorted(written),
    tables_read: sorted(read).filter((t) => !written.has(t)),
    events_published: sorted(events),
    commits,
    unresolved,
    unresolved_raw: Number(sum["totalUnresolved"] ?? 0),
    dependency_effect_groups: depGroups,
    unmapped_hunks: diags.filter((d) => d["kind"] === "hunk-outside-routines")
      .length,
    unmatched_files: diags.filter((d) => d["kind"] === "diff-file-unmatched")
      .length,
  };
}

/** The campaign patch (start/, final/) with paths relative to the merged app folder, which is the workspace root. */
export function digestPatch(patch: string): string {
  return patch.replace(/^--- start\//gm, "--- a/").replace(
    /^\+\+\+ final\//gm,
    "+++ b/",
  );
}

/**
 * The refapp's apps as one synthetic app: al-sem analyzes one app.json and
 * reads dependencies only as packages in .alpackages, while the CGR apps
 * depend on each other as source. Object ids are disjoint across the apps.
 */
export function mergedAppJson(apps: J[]): J {
  const ids = new Set(apps.map((a) => a["id"]));
  const core = apps.find((a) => a["name"] === "CGR Core") ?? apps[0]!;
  const deps = new Map<unknown, J>();
  for (const a of apps) {
    for (const d of (a["dependencies"] ?? []) as J[]) {
      if (!ids.has(d["id"])) deps.set(d["id"], d);
    }
  }
  return {
    id: "c6a1e000-0000-4000-8000-0000000000ff",
    name: "CGR Merged",
    publisher: "CentralGauge",
    version: "1.0.0.0",
    platform: core["platform"],
    application: core["application"],
    runtime: core["runtime"],
    target: core["target"],
    features: core["features"] ?? [],
    idRanges: apps.flatMap((a) => a["idRanges"] as J[]),
    dependencies: [...deps.values()],
  };
}

export interface AlsemMetrics {
  /** looseFingerprint rule (2.0.3): sum over keys of max(0, after - before). */
  alsem_new_findings: number;
  /** A-03's fingerprint rule, kept for comparison: a finding moved to another routine counts as new. */
  alsem_new_findings_fp: number;
  /** curated_weighted / curated_density under the fingerprint rule. */
  curated_weighted_fp: number;
  curated_density_fp: number | null;
  /** [Test] procedures (Test app) in final and not in start. */
  new_test_procs: number;
  /** Introduced or changed [Test] procedures: the denominator of the test-quality columns. */
  test_procs_scored: number;
  test_assert_reachable_sum: number;
  test_assert_reachable_mean: number | null;
  test_zero_assert_procs: number;
  test_zero_assert_share: number | null;
  test_asserterror_procs: number;
  test_asserterror_share: number | null;
  test_areequal_total: number;
  test_areequal_literal: number;
  /** AreEqual calls with a literal expected value / all AreEqual calls in the scored procedures. */
  test_areequal_literal_share: number | null;
  /** digest --tests, changed production routines (declaration-only out of the denominator, see DigestTouches). */
  test_changed_routines: number;
  test_covered_routines: number;
  test_uncovered_routines: number;
  test_coverage_ratio: number | null;
  test_declaration_only: number;
  /** al-sem's unfiltered testCoverage values (test-app helpers included). */
  test_changed_routines_raw: number;
  test_covered_routines_raw: number;
  test_coverage_ratio_raw: number | null;
  alsem_new_high_findings: number;
  alsem_new_test_findings: number;
  /** Curated: likely only, critical 5 / high 3 / medium 1, d3 and d9 out (see curatedCounts). */
  curated_weighted: number;
  changed_prod_lines: number;
  /** curated_weighted per 100 changed_prod_lines; null when no production line changed. */
  curated_density: number | null;
  /** Raw introduced counts of the detectors left out of the curated sum. */
  alsem_d3_introduced: number;
  alsem_d9_introduced: number;
  complexity_delta: number;
  lines_delta: number;
  fan_in_delta: number;
  max_routine_complexity: number;
  routines_added: number;
  routines_changed: number;
  /** New unused local / internal / protected procedures. */
  new_unused: number;
  /** New unused public procedures (callable from other apps, so reported apart). */
  new_unused_public: number;
  abi_changes: number;
  abi_signature_changes: number;
  schema_changes: number;
  event_changes: number;
  permission_changes: number;
  tables_written: number;
  events_published: number;
  unmapped_hunks: number;
}

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 5,
  high: 3,
  medium: 1,
};
const D3 = "d3-missing-setloadfields";

/**
 * Curated finding count (owner definition 2026-10-23), production code only:
 * weighted sum over `likely` findings (critical 5, high 3, medium 1, low and
 * info 0), with d3-missing-setloadfields and every d9* detector left out of it
 * and counted raw (any confidence, any severity) as `d3` and `d9`.
 */
export function curatedCounts(
  introduced: (AlsemFinding & { count: number })[],
): { weighted: number; d3: number; d9: number } {
  const out = { weighted: 0, d3: 0, d9: 0 };
  for (const f of introduced) {
    if (f.app === TEST_APP) continue;
    if (f.detector === D3) out.d3 += f.count;
    else if (f.detector.startsWith("d9")) out.d9 += f.count;
    else if (f.confidence === "likely") {
      out.weighted += (SEVERITY_WEIGHT[f.severity] ?? 0) * f.count;
    }
  }
  return out;
}

/** Added + removed lines of the campaign patch in files outside the Test app. */
export function changedProdLines(patch: string): number {
  const lines = patch.split("\n");
  let n = 0;
  let prod = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
      const path = (p: string) =>
        p.replace(/^[-+]{3} (start\/|final\/|a\/|b\/)?/, "");
      const to = path(lines[i + 1]!);
      const file = lines[i + 1]!.startsWith("+++ /dev/null") ? path(l) : to;
      prod = file.split("/")[0] !== TEST_APP;
      i++;
      continue;
    }
    if (prod && (l.startsWith("+") || l.startsWith("-"))) n++;
  }
  return n;
}

/** Weighted count per 100 changed production lines; null when none changed. */
export function curatedDensity(weighted: number, lines: number): number | null {
  return lines === 0 ? null : (weighted * 100) / lines;
}

/** Median, mean and share of zeros over the non-null densities; the nulls are counted apart. */
export function densityStats(xs: (number | null)[]) {
  const v = xs.filter((x): x is number => x !== null);
  return {
    n: v.length,
    null_count: xs.length - v.length,
    median: median(v),
    mean: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null,
    zero_share: v.length ? v.filter((x) => x === 0).length / v.length : null,
  };
}

/** Rank of each execution among all executions of its task, ascending density; ties share the average rank, null density is unranked. */
export function withinTaskRanks(
  rows: { id: string; task: string; density: number | null }[],
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const byTask = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.density === null) out.set(r.id, null);
    else byTask.set(r.task, [...(byTask.get(r.task) ?? []), r]);
  }
  for (const rs of byTask.values()) {
    const s = [...rs].sort((a, b) => a.density! - b.density!);
    for (let i = 0; i < s.length;) {
      let j = i;
      while (j < s.length && s[j]!.density === s[i]!.density) j++;
      for (let k = i; k < j; k++) out.set(s[k]!.id, (i + 1 + j) / 2);
      i = j;
    }
  }
  return out;
}

/** One execution's al-sem metrics; production code (not the Test app) only. */
export function alsemSummary(x: {
  introduced: (AlsemFinding & { count: number })[];
  /** The fingerprint rule's introduced findings (introducedFindingsFp). */
  introduced_fp: (AlsemFinding & { count: number })[];
  testQuality: TestQualityCounts;
  deltas: RoutineDelta[];
  unused: UnusedProc[];
  blast: Blast;
  touches: DigestTouches;
  /** changedProdLines of the execution's patch. */
  changed_prod_lines?: number;
}): AlsemMetrics {
  const prod = x.introduced.filter((f) => f.app !== TEST_APP);
  const cur = curatedCounts(x.introduced);
  const curFp = curatedCounts(x.introduced_fp);
  const q = x.testQuality;
  const lines = x.changed_prod_lines ?? 0;
  const sum = (fs: { count: number }[]) => fs.reduce((s, f) => s + f.count, 0);
  const d = x.deltas.filter((r) => r.app !== TEST_APP);
  const live = d.filter((r) => r.status !== "removed");
  const unused = x.unused.filter((u) => u.app !== TEST_APP);
  return {
    alsem_new_findings: sum(prod),
    alsem_new_findings_fp: sum(
      x.introduced_fp.filter((f) => f.app !== TEST_APP),
    ),
    curated_weighted_fp: curFp.weighted,
    curated_density_fp: curatedDensity(curFp.weighted, lines),
    new_test_procs: q.new_test_procs,
    test_procs_scored: q.scored,
    test_assert_reachable_sum: q.assert_reachable,
    test_assert_reachable_mean: share(q.assert_reachable, q.scored),
    test_zero_assert_procs: q.zero_assert,
    test_zero_assert_share: share(q.zero_assert, q.scored),
    test_asserterror_procs: q.asserterror,
    test_asserterror_share: share(q.asserterror, q.scored),
    test_areequal_total: q.areequal_total,
    test_areequal_literal: q.areequal_literal,
    test_areequal_literal_share: share(q.areequal_literal, q.areequal_total),
    test_changed_routines: x.touches.test_changed_routines,
    test_covered_routines: x.touches.test_covered_routines,
    test_uncovered_routines: x.touches.test_uncovered_routines,
    test_coverage_ratio: x.touches.test_coverage_ratio,
    test_declaration_only: x.touches.test_declaration_only,
    test_changed_routines_raw: x.touches.test_changed_routines_raw,
    test_covered_routines_raw: x.touches.test_covered_routines_raw,
    test_coverage_ratio_raw: x.touches.test_coverage_ratio_raw,
    alsem_new_high_findings: sum(
      prod.filter((f) => f.severity === "critical" || f.severity === "high"),
    ),
    alsem_new_test_findings: sum(
      x.introduced.filter((f) => f.app === TEST_APP),
    ),
    curated_weighted: cur.weighted,
    changed_prod_lines: lines,
    curated_density: curatedDensity(cur.weighted, lines),
    alsem_d3_introduced: cur.d3,
    alsem_d9_introduced: cur.d9,
    complexity_delta: d.reduce((s, r) => s + r.d_complexity, 0),
    lines_delta: d.reduce((s, r) => s + r.d_lines, 0),
    fan_in_delta: d.reduce((s, r) => s + (r.d_fan_in ?? 0), 0),
    max_routine_complexity: Math.max(0, ...live.map((r) => r.complexity)),
    routines_added: d.filter((r) => r.status === "added").length,
    routines_changed: d.filter((r) => r.status === "changed").length,
    new_unused:
      unused.filter((u) =>
        ["local", "internal", "protected"].includes(u.access)
      ).length,
    new_unused_public: unused.filter((u) => u.access === "public").length,
    abi_changes: x.blast.production.abi,
    abi_signature_changes:
      x.blast.production.by_kind["procedure-signature-changed"] ?? 0,
    schema_changes: x.blast.production.schema,
    event_changes: x.blast.production.events,
    permission_changes: x.blast.production.permissions,
    tables_written: x.touches.tables_written.length,
    events_published: x.touches.events_published.length,
    unmapped_hunks: x.touches.unmapped_hunks,
  };
}

type J = Record<string, unknown>;
const readJson = async (p: string): Promise<J> =>
  JSON.parse(await Deno.readTextFile(p)) as J;
const readJsonOr = (p: string): Promise<J | null> =>
  readJson(p).catch(() => null);

async function run(
  cmd: string,
  args: string[],
  cwd?: string,
  okCodes = [0],
): Promise<string> {
  const o = await new Deno.Command(cmd, {
    args,
    ...(cwd ? { cwd } : {}),
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!okCodes.includes(o.code)) {
    throw exitError(cmd, args, o.code, new TextDecoder().decode(o.stderr));
  }
  return new TextDecoder().decode(o.stdout);
}

/** Source files (relative, forward slashes) the verdict would read. */
async function sourceFiles(root: string): Promise<Set<string>> {
  const out = new Set<string>();
  const walk = async (dir: string, rel: string) => {
    for await (const e of Deno.readDir(dir)) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (isTaskBuildArtifact(r)) continue;
      if (e.isDirectory) await walk(join(dir, e.name), r);
      else if (e.isFile && rel !== "" && isSourceFile(e.name)) out.add(r);
    }
  };
  await walk(root, "");
  return out;
}

async function sameText(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([Deno.readFile(a), Deno.readFile(b)]);
  const norm = (u: Uint8Array) =>
    new TextDecoder().decode(u).replaceAll("\r\n", "\n");
  return norm(x) === norm(y);
}

/** Fills an empty `dir` with refapp at the task's pinned commit plus the task overlay at `rev`. */
async function buildStartingTree(
  repo: string,
  rev: string,
  taskId: string,
  refappCommit: string,
  cache: string,
  dir: string,
): Promise<void> {
  const at = await loadTaskAt(repo, taskId, rev, join(cache, "tasks"));
  const tar = join(
    cache,
    `${taskId}-refapp-${crypto.randomUUID()}.tar`,
  );
  await run("git", [
    "-c",
    "core.autocrlf=false",
    "archive",
    "--format=tar",
    "-o",
    tar,
    refappCommit,
    REFAPP_PATH,
  ], repo);
  await run(TAR_BINARY, [
    "-xf",
    `../${basename(tar)}`,
    "--strip-components=2",
  ], dir);
  await Deno.remove(tar);
  await applyOverlay(join(at.task.dir, "overlay"), dir);
}

export async function sha256Hex(
  d: string | Uint8Array<ArrayBuffer>,
): Promise<string> {
  const h = await crypto.subtle.digest(
    "SHA-256",
    typeof d === "string" ? new TextEncoder().encode(d) : d,
  );
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Content identity of a tree: the source files al-sem will see, by path and bytes. */
async function treeHash(root: string): Promise<string> {
  const parts: string[] = [];
  for (const rel of [...await sourceFiles(root)].sort()) {
    const bytes = await Deno.readFile(join(root, ...rel.split("/")));
    parts.push(`${rel}\0${await sha256Hex(bytes)}`);
  }
  return sha256Hex(parts.join("\n"));
}

export interface StartTree {
  dir: string;
  /** Baseline identity: sha256(rev, refapp commit, tree content), 12 hex. Keys every artifact computed from this tree. */
  id: string;
}

/**
 * refapp at the task's pinned commit plus the task overlay at `rev`, built once
 * per identity. `.done` records rev, refapp commit and the tree's content hash;
 * another rev / commit, a tree edited since, or an old `.done` without an
 * identity is rebuilt (nothing is adopted from a pre-identity cache).
 */
export async function startingTree(
  repo: string,
  rev: string,
  taskId: string,
  refappCommit: string,
  cache: string,
  build: (dir: string) => Promise<void> = (dir) =>
    buildStartingTree(repo, rev, taskId, refappCommit, cache, dir),
): Promise<StartTree> {
  const dir = join(cache, taskId);
  const done = join(cache, `${taskId}.done`);
  const idOf = async (tree: string) =>
    (await sha256Hex(`${rev}\0${refappCommit}\0${tree}`)).slice(0, 12);
  const have = await Deno.stat(dir).then(() => true, () => false);
  const m = await readJsonOr(done);
  if (
    m && m["rev"] === rev && m["refapp"] === refappCommit && have &&
    await treeHash(dir) === m["tree"]
  ) {
    return { dir, id: await idOf(m["tree"] as string) };
  }
  const fresh = `${dir}.new`;
  await Deno.remove(fresh, { recursive: true }).catch(() => {});
  await Deno.mkdir(fresh, { recursive: true });
  await build(fresh);
  const tree = await treeHash(fresh);
  await Deno.remove(dir, { recursive: true }).catch(() => {});
  await Deno.rename(fresh, dir);
  await writeAtomic(done, JSON.stringify({ rev, refapp: refappCommit, tree }));
  return { dir, id: await idOf(tree) };
}

async function diffTrees(
  start: string,
  final: string,
  touches: readonly string[],
): Promise<{ files: FileChange[]; patch: string }> {
  const [a, b] = await Promise.all([sourceFiles(start), sourceFiles(final)]);
  const files: FileChange[] = [];
  const patches: string[] = [];
  for (const rel of [...new Set([...a, ...b])].sort()) {
    const inA = a.has(rel);
    const inB = b.has(rel);
    const pa = join(start, ...rel.split("/"));
    const pb = join(final, ...rel.split("/"));
    if (inA && inB && await sameText(pa, pb)) continue;
    const status = !inA ? "added" : !inB ? "deleted" : "modified";
    const args = [
      "diff",
      "--no-index",
      "--no-color",
      "--ignore-cr-at-eol",
      "--",
      inA ? pa : "/dev/null",
      inB ? pb : "/dev/null",
    ];
    const [num, patch] = await Promise.all([
      run(
        "git",
        [...args.slice(0, 2), "--numstat", ...args.slice(2)],
        undefined,
        [0, 1],
      ),
      run("git", args, undefined, [0, 1]),
    ]);
    const [add, del] = num.trim().split(/\s+/);
    const app = rel.split("/")[0]!;
    files.push({
      path: rel,
      app,
      status,
      added_lines: Number(add) || 0,
      removed_lines: Number(del) || 0,
      outside_touches: app !== TEST_APP && !touches.includes(app),
      shipped_test: app === TEST_APP && inA,
    });
    // git's header names the absolute host paths: replace it with the relative one.
    const hunks = patch.indexOf("\n@@");
    patches.push(
      `--- ${inA ? `start/${rel}` : "/dev/null"}\n+++ ${
        inB ? `final/${rel}` : "/dev/null"
      }${hunks < 0 ? "\n" : patch.slice(hunks)}`,
    );
  }
  return { files, patch: patches.join("") };
}

// ---------------------------------------------------------------- resumable outputs

/** What one execution's output was computed from: both binaries, the task rev, the final workspace. */
export interface DoneStamp {
  build: string;
  rev: string;
  hash: string;
  /** DERIVATION: bump when the row is computed differently from the same cached tool output. */
  derive?: number;
  /** sha256 of each artifact the row was computed from (start / final tree.json and raw analyze / ach / fingerprint, digest, diff); "" when absent. A changed artifact means not done. */
  bind?: Record<string, string>;
}

/**
 * v2: blastRadius attributes a subject by normalizedStableId too (al-sem 2.0.2 removal kinds).
 * DERIVATION is also the validation epoch: artifact hashes only prove unchanged
 * bytes, not validation under the current rules, so bump it whenever any
 * validation tightens (a done row of an older epoch is revalidated, never skipped).
 */
export const DERIVATION = 11;
// v11 (A-03b Sol self-check r3): validation tightened, nothing recomputed. testCoverage stableIds are unique within covered and within uncovered and the two lists are disjoint; a non-boundary DB_* or EVENT_PUBLISH digest effect needs detail.resourceDisplay as a non-empty string (no invented empty-named table or event); present digest summary rootsRequested / rootsResolved / totalUnresolved are nonnegative integers.
// v10 (A-03b Sol self-check r2): validation tightened, nothing recomputed. Every digest entry needs routine.anchor as an object with a non-empty string file (an absent location no longer counts as production); testCoverage covered + uncovered items need a non-empty stableId, uncovered items a non-empty reason, and an anchor when present must be an object with a string file. Done rows of epoch 9 are revalidated.
// v9 (A-03b Sol self-check r1): validation tightened, nothing recomputed. testCoverage covered + uncovered lists must sum to changedRoutines; digest routine.anchor.file, effect detail.boundary and detail.resourceDisplay must be strings when present; test_quality procedure counts must be nonnegative integers with are_equal.literal_expected + expression_expected == total, assert_count_reachable >= assert_count and zero_assert == (assert_count_reachable == 0). Done rows of epoch 8 are revalidated.
// v8 (A-03b, al-sem 2.1.0-rc.4): the digest is cross-app. (a) A digest effect can be a dependency boundary group (detail.boundary): digestTouches leaves it out of tables_written / tables_read / events_published / commits (those stay workspace-code effects, comparable with 2.0.3) and counts the production ones in dependency_effect_groups. (b) summary.totalUnresolved now includes dependency routines' unresolved calls, which land on the Test app's entries: unresolved is the sum of entries[].unresolved lengths over production entries, unresolved_raw keeps totalUnresolved, a non-array entries[].unresolved fails the digest. looseFingerprint values change per detector in 2.1 (#252) with no consumer change: the cache path and done rows are keyed by the binaries' sha256, so 2.0.3 artifacts are never reused.
// v7 (A-03b smoke): test coverage counts production routines only (al-sem also counts test-app helpers and non-[Test] test-codeunit procedures), declaration-only routines leave the denominator, al-sem's raw values kept as *_raw, an unmappable covered / uncovered stableId fails the row.
// v6 (A-03b, al-sem 2.0.3): introduced findings by the looseFingerprint rule (+ _fp columns), tree.json holds the [Test] procedures (test_quality), digests run with --tests (digest-tests-<patch>.json) and carry testCoverage.
// v3: curated finding density (findings carry confidence, rows carry changed_prod_lines).
// v4: tree.json holds only the fields derived from the raw analyze / ach / fingerprint JSON (touches come from the digest-<patch> file) and is re-derived from them, no tool run, whenever its derive differs; error diagnostics fail a tree.
// v6 (A-03b step 0): consumed ach fields validated; diffs bound to both fingerprint hashes.
// v5: strict envelope / payload validation; every tree.json hit re-validates its raw files; done rows carry the sha256 of the artifacts they were computed from; no legacy cache adoption.

/** Temp file in the same folder, then rename: a killed run leaves a `.tmp-` file, never a half-written target. */
export async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp-${Deno.pid}-${crypto.randomUUID()}`;
  await Deno.writeTextFile(tmp, text);
  await Deno.rename(tmp, path);
}

export function writeDone(
  dir: string,
  id: string,
  stamp: DoneStamp,
  row: unknown,
): Promise<void> {
  return writeAtomic(join(dir, `${id}.json`), JSON.stringify({ stamp, row }));
}

/** The execution's stored row, or null when absent, unparsable, or made by another build / rev / workspace. */
export async function readDone<T>(
  dir: string,
  id: string,
  stamp: DoneStamp,
): Promise<T | null> {
  const x = await readJsonOr(join(dir, `${id}.json`));
  const s = x?.["stamp"] as DoneStamp | undefined;
  return s && s.build === stamp.build && s.rev === stamp.rev &&
      s.hash === stamp.hash && s.derive === stamp.derive &&
      JSON.stringify(s.bind ?? null) === JSON.stringify(stamp.bind ?? null)
    ? (x!["row"] as T)
    : null;
}

/** Every done row among `stamps` (earlier runs included), in id order. */
export async function loadDone<T>(
  dir: string,
  stamps: Map<string, DoneStamp>,
): Promise<T[]> {
  const rows: T[] = [];
  for (const id of [...stamps.keys()].sort()) {
    const r = await readDone<T>(dir, id, stamps.get(id)!);
    if (r) rows.push(r);
  }
  return rows;
}

// ---------------------------------------------------------------- al-sem runner

export interface AlsemTools {
  alsem: string;
  ach: string;
  /** Content-addressed symbol store (`<sha256>.app`). */
  store: string;
  lock: { file: string; sha256: string }[];
  dir: string;
  /** Cache root for this build: the two binaries' hashes, so another build never reads these results. */
  cache: string;
  /** Full sha256 of both binaries; part of every done marker. */
  build: string;
  /** Task rev the starting trees come from; part of every done marker. */
  rev: string;
  /** Spawns a tool and returns its stdout (tests inject a fake). */
  exec?: typeof run;
}

type Versions = Record<string, { alsemVersion: string; schemaVersion: string }>;
type TaggedDiagnostic = AlsemDiagnostic & { command: string };

interface AlsemTree {
  findings: AlsemFinding[];
  metrics: RoutineMetric[];
  unused: UnusedProc[];
  /** Every [Test] procedure of the tree (ach test_quality). */
  testProcs: TestProc[];
  testRanges: [number, number][];
  fingerprint: string;
  touches: DigestTouches;
  /** alsemVersion + schemaVersion per alsem command on this tree. */
  versions: Versions;
  diagnostics: TaggedDiagnostic[];
}

/** `<ws>\.alpackages` as a directory junction to the symbol store (al-call-hierarchy reads only that folder). */
export async function linkAlpackages(ws: string, store: string) {
  await run("cmd", [
    "/c",
    "mklink",
    "/J",
    join(ws, ".alpackages"),
    resolve(store),
  ]);
}

/**
 * Deletes a scratch workspace. The .alpackages junction goes first with a
 * plain `rmdir`, which removes the link only: a recursive delete through it
 * could reach into the symbol store. If the junction is still there after
 * that, nothing is deleted.
 */
export async function removeWorkspace(
  ws: string,
  unlink: (p: string) => Promise<unknown> = (p) =>
    run("cmd", ["/c", "rmdir", p]),
) {
  const pk = join(ws, ".alpackages");
  if ((await Deno.lstat(pk).catch(() => null))?.isSymlink) {
    await unlink(pk);
    if (await Deno.lstat(pk).then(() => true, () => false)) {
      throw new Error(
        `junction ${pk} is still there: not deleting ${ws} recursively`,
      );
    }
  }
  await Deno.remove(ws, { recursive: true }).catch((e) => {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  });
}

/**
 * The tree as one al-sem workspace (mergedAppJson) in scratch, with
 * .alpackages a junction to the symbol store; sources keep their relative
 * paths, so the campaign's patches apply as they are.
 */
async function mergedWorkspace(src: string, dst: string, t: AlsemTools) {
  await removeWorkspace(dst);
  const apps: J[] = [];
  for (const rel of [...await sourceFiles(src)].sort()) {
    const text = await Deno.readTextFile(join(src, ...rel.split("/")));
    if (rel.split("/").length === 2 && basename(rel) === "app.json") {
      apps.push(JSON.parse(text.replace(/^﻿/, "")) as J);
      continue;
    }
    const to = join(dst, ...rel.split("/"));
    await Deno.mkdir(join(to, ".."), { recursive: true });
    await Deno.writeTextFile(to, text);
  }
  await Deno.writeTextFile(
    join(dst, "app.json"),
    JSON.stringify(mergedAppJson(apps), null, 2),
  );
  await linkAlpackages(dst, t.store);
  const test = apps.find((a) => a["name"] === "CGR Test");
  return ((test?.["idRanges"] ?? []) as { from: number; to: number }[])
    .map((r) => [r.from, r.to] as [number, number]);
}

/** A parsed al-sem envelope; throws on bad JSON, another kind / schemaVersion, or any error-level diagnostic (fail closed). */
function checkedEnvelope(
  command: string,
  text: string,
  kind: string,
  tests = false,
) {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error(`al-sem ${command}: output is not JSON`);
  }
  const e = alsemEnvelope(doc, kind, { tests });
  const diagnostics: TaggedDiagnostic[] = e.diagnostics.map((d) => ({
    ...d,
    command,
  }));
  failOnErrors(command, diagnostics);
  return {
    payload: e.payload,
    version: { alsemVersion: e.alsemVersion, schemaVersion: e.schemaVersion },
    diagnostics,
    e,
  };
}

function failOnErrors(what: string, ds: AlsemDiagnostic[]) {
  const bad = errorDiagnostics(ds) as AlsemDiagnostic[];
  if (bad.length) {
    throw new Error(
      `al-sem ${what}: ${bad.length} error diagnostic(s): ${
        bad.slice(0, 3).map((d) => `${d.code} ${d.message}`).join("; ")
      }`,
    );
  }
}

/** The tree fields derived from the raw analyze / ach / fingerprint output; no tool runs. */
type TreeBase = Omit<AlsemTree, "fingerprint" | "touches"> & { derive: number };

function deriveBase(
  analyzeText: string,
  achText: string,
  fingerprintText: string,
  testRanges: [number, number][],
): TreeBase {
  const a = checkedEnvelope("analyze", analyzeText, "analyze-report");
  const ach = checkedAch(achText); // no envelope: top level is metrics, findings, summary
  const fp = checkedEnvelope(
    "fingerprint",
    fingerprintText,
    "capability-snapshot",
  );
  return {
    derive: DERIVATION,
    findings: alsemFindings(a.payload),
    metrics: ach.metrics,
    unused: unusedProcedures(ach),
    testProcs: testProcedures(ach),
    testRanges,
    versions: { analyze: a.version, fingerprint: fp.version },
    diagnostics: [...a.diagnostics, ...fp.diagnostics],
  };
}

/** Per cache entry: one analysis at a time, so a concurrent request for the same entry finds it done. */
const chains = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, f: () => Promise<T>): Promise<T> {
  const next = (chains.get(key) ?? Promise.resolve()).then(f, f);
  // ponytail: the map only grows (one settled promise per entry), a few hundred per run.
  chains.set(key, next.catch(() => {}));
  return next;
}

/**
 * Names the digest of a patch: `digest-tests-<id>.json`. Always run with
 * --tests, which only adds payload.testCoverage; the name keeps an entry made
 * without the flag from ever being read as one made with it.
 */
const digestId = async (patch: string) =>
  (await sha256Hex(digestPatch(patch))).slice(0, 12);
const digestFile = async (patch: string) =>
  `digest-tests-${await digestId(patch)}.json`;

/**
 * Analyze, metrics and fingerprint for one tree (and the digest of `patch`),
 * cached by key. The tree entry depends on the tree only; the digest on the
 * patch too (`digest-<patch hash>.json`). tree.json is re-derived from the raw
 * JSON when its derive differs; an error-level diagnostic anywhere fails.
 */
export function alsemTree(
  t: AlsemTools,
  src: string,
  key: string,
  patch: string | null,
): Promise<AlsemTree> {
  return serialized(
    join(t.cache, key),
    () => alsemTreeOnce(t, src, key, patch),
  );
}

async function alsemTreeOnce(
  t: AlsemTools,
  src: string,
  key: string,
  patch: string | null,
): Promise<AlsemTree> {
  const sh = t.exec ?? run;
  const cache = join(t.cache, key);
  const p = (n: string) => join(cache, n);
  const done = p("tree.json");
  // A hit is never trusted as stored: the raw files are re-validated and tree.json
  // re-derived from them every time (a missing raw file is a miss, an invalid one fails).
  let base: TreeBase | null = null;
  const stored = await readJsonOr(done) as TreeBase | null;
  if (stored && Array.isArray(stored.testRanges)) {
    try {
      base = deriveBase(
        await Deno.readTextFile(p("analyze.json")),
        await Deno.readTextFile(p("ach.json")),
        await Deno.readTextFile(p("fingerprint.json")),
        stored.testRanges,
      );
      const text = JSON.stringify(base);
      if (text !== JSON.stringify(stored)) await writeAtomic(done, text);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  let dp:
    | { text: string; file: string; out: string | null }
    | null = null;
  if (patch) {
    const text = digestPatch(patch);
    const file = p(await digestFile(patch));
    dp = { text, file, out: await Deno.readTextFile(file).catch(() => null) };
  }
  if (!base || (dp && dp.out === null)) {
    await Deno.mkdir(cache, { recursive: true });
    const ws = join(t.dir, "ws", `${key}-${crypto.randomUUID()}`);
    const testRanges = await mergedWorkspace(src, ws, t);
    const tmp = p(`fingerprint.json.tmp-${crypto.randomUUID()}`);
    try {
      if (!base) {
        // Exit 4 (--require-dependencies) throws: the execution fails, never under-reports.
        const analyzeText = await sh(t.alsem, [
          "analyze",
          ws,
          "--format",
          "json",
          "--deterministic",
          "--require-dependencies",
        ]);
        const achText = await sh(t.ach, [
          "--project",
          ws,
          "--analyze",
          "--format",
          "json",
          "--no-telemetry",
        ]);
        await sh(t.alsem, [
          "fingerprint",
          ws,
          "--format",
          "json",
          "--deterministic",
          "--out",
          tmp,
        ]);
        // Validated before anything is persisted: a bad output leaves no cache entry.
        base = deriveBase(
          analyzeText,
          achText,
          await Deno.readTextFile(tmp),
          testRanges,
        );
        await Deno.rename(tmp, p("fingerprint.json"));
        await writeAtomic(p("analyze.json"), analyzeText);
        await writeAtomic(p("ach.json"), achText);
        await writeAtomic(done, JSON.stringify(base));
      }
      if (dp && dp.out === null) {
        const diff = p(`change-${await digestId(patch!)}.diff`);
        await writeAtomic(diff, dp.text);
        const digest = await sh(t.alsem, [
          "digest",
          ws,
          "--diff",
          diff,
          "--format",
          "json",
          "--deterministic",
          "--tests",
        ]);
        checkedEnvelope("digest", digest, "digest", true);
        await writeAtomic(dp.file, digest);
        dp.out = digest;
      }
    } finally {
      await Deno.remove(tmp).catch(() => {});
      await removeWorkspace(ws);
    }
  }
  const { derive: _, ...tree } = base!;
  const dg = dp ? checkedEnvelope("digest", dp.out!, "digest", true) : null;
  return {
    ...tree,
    fingerprint: p("fingerprint.json"),
    touches: digestTouches(dg ? dg.payload : { entries: [] }),
    versions: dg ? { ...tree.versions, digest: dg.version } : tree.versions,
    diagnostics: dg
      ? [...tree.diagnostics, ...dg.diagnostics]
      : tree.diagnostics,
  };
}

/** `--only`: no list keeps every execution, else those whose id starts with a listed id. */
export function keepExecution(id: string, only: string[]): boolean {
  return !only.length || only.some((p) => id.startsWith(p));
}

/** H-29 ruling (2026-10-18): a harness_crash execution stays in the per-execution rows, flagged, but out of every al-sem aggregate. */
export function alsemExclusion(termination: string): string | null {
  return termination === "harness_crash" ? "harness_crash" : null;
}

export function alsemExclusionText(
  excluded: {
    id: string;
    arm: string;
    task: string;
    repeat: number;
    excluded: string | null;
  }[],
): string {
  const head = "Executions with termination `harness_crash` are left out of " +
    "every al-sem aggregate (per arm, per pair, medians and counts) under the " +
    "2026-10-18 H-29 ruling; their per-execution rows stay, flagged `excluded`.";
  if (!excluded.length) return `${head} Excluded here: none.\n`;
  const lines = [...excluded].sort((a, b) => a.id.localeCompare(b.id)).map((
    x,
  ) => `- ${x.id} (${x.arm}, ${x.task} r${x.repeat}): ${x.excluded}`);
  return `${head} Excluded here: ${excluded.length}.\n\n${lines.join("\n")}\n`;
}

interface AlsemRow {
  excluded?: string | null;
  id: string;
  arm: string;
  task: string;
  repeat: number;
  verdict: string | null;
  metrics: AlsemMetrics;
  introduced: (AlsemFinding & { count: number })[];
  introduced_fp: (AlsemFinding & { count: number })[];
  test_quality: TestQualityCounts;
  deltas: RoutineDelta[];
  unused: UnusedProc[];
  blast: Blast;
  touches: DigestTouches;
  versions: { start: Versions; final: Versions; diff: Versions };
  diagnostics: (TaggedDiagnostic & { tree: string })[];
}

/** Metrics that are null when their denominator is 0; aggregated over the non-null values only. */
const NULLABLE_KEYS = [
  "curated_density",
  "curated_density_fp",
  "test_assert_reachable_mean",
  "test_zero_assert_share",
  "test_asserterror_share",
  "test_areequal_literal_share",
  "test_coverage_ratio",
  "test_coverage_ratio_raw",
] as const;

const METRIC_KEYS: Exclude<keyof AlsemMetrics, typeof NULLABLE_KEYS[number]>[] =
  [
    "alsem_new_findings",
    "alsem_new_findings_fp",
    "curated_weighted_fp",
    "new_test_procs",
    "test_procs_scored",
    "test_assert_reachable_sum",
    "test_zero_assert_procs",
    "test_asserterror_procs",
    "test_areequal_total",
    "test_areequal_literal",
    "test_changed_routines",
    "test_covered_routines",
    "test_uncovered_routines",
    "test_declaration_only",
    "test_changed_routines_raw",
    "test_covered_routines_raw",
    "alsem_new_high_findings",
    "alsem_new_test_findings",
    "curated_weighted",
    "changed_prod_lines",
    "alsem_d3_introduced",
    "alsem_d9_introduced",
    "complexity_delta",
    "lines_delta",
    "fan_in_delta",
    "max_routine_complexity",
    "routines_added",
    "routines_changed",
    "new_unused",
    "new_unused_public",
    "abi_changes",
    "abi_signature_changes",
    "schema_changes",
    "event_changes",
    "permission_changes",
    "tables_written",
    "events_published",
    "unmapped_hunks",
  ];

/** The version tools.json recorded for this very binary (same sha256), or null: no `alsem --version` run needed. */
export function pinnedAlsemVersion(prev: unknown, sha: string): string | null {
  const a = ((prev ?? {}) as J)["alsem"] as J | undefined;
  return a?.["sha256"] === sha && typeof a["version"] === "string"
    ? a["version"]
    : null;
}

/** The recorded version when it belongs to this very binary, else `runVersion()` (`alsem --version`). */
export async function resolveAlsemVersion(
  prev: unknown,
  sha: string,
  runVersion: () => Promise<string>,
): Promise<string> {
  return pinnedAlsemVersion(prev, sha) ?? (await runVersion()).trim();
}

const sha256File = async (p: string) => sha256Hex(await Deno.readFile(p));

export async function pool<T>(
  n: number,
  items: T[],
  f: (x: T) => Promise<void>,
) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await f(items[i++]!);
    }),
  );
}

const hasErrorDiagnostic = (ds: AlsemDiagnostic[] | undefined) =>
  errorDiagnostics(ds ?? []).length > 0;

/** Cache name of a diff: start identity + sha256 of the start and final fingerprint.json it was computed from. */
const diffName = (sid: string, startFp: string, finalFp: string) =>
  `diff-${sid}-${startFp.slice(0, 16)}-${finalFp.slice(0, 16)}.json`;

/** sha256 of a file, "" when it is absent. */
const hashOrEmpty = (p: string) => Deno.readFile(p).then(sha256Hex, () => "");

export async function alsemStep(
  t: AlsemTools,
  rows: Row[],
  results: string,
  hashOf: Map<string, string>,
  startOf: (task: string) => Promise<StartTree>,
  pairs: [string, string][],
  jobs: number,
) {
  // The start tree's al-sem entry is keyed by its baseline identity (rev, refapp commit, content).
  const startInfo = new Map<string, Promise<StartTree>>();
  const startOfOnce = (task: string) => {
    if (!startInfo.has(task)) startInfo.set(task, startOf(task));
    return startInfo.get(task)!;
  };
  const starts = new Map<string, Promise<{ id: string; tree: AlsemTree }>>();
  const startTree = (task: string) => {
    if (!starts.has(task)) {
      starts.set(
        task,
        startOfOnce(task).then(async (s) => ({
          id: s.id,
          tree: await alsemTree(t, s.dir, `start-${task}-${s.id}`, null),
        })),
      );
    }
    return starts.get(task)!;
  };
  const todo = rows.filter((r) => hashOf.has(r.id));
  const execDir = join(t.cache, "exec");
  await Deno.mkdir(execDir, { recursive: true });
  /**
   * The done stamp of an execution: build, rev, workspace, derivation, and the
   * sha256 of the artifacts its row is computed from (start and final tree.json,
   * the digest of its patch, the diff). A changed or missing artifact changes the
   * stamp, so the row is not done. A start tree that cannot be built binds to nothing.
   */
  const stampOf = async (r: Row): Promise<DoneStamp> => {
    const hash = hashOf.get(r.id)!;
    let bind: Record<string, string>;
    try {
      const sid = (await startOfOnce(r.task)).id;
      const final = join(t.cache, hash);
      const start = join(t.cache, `start-${r.task}-${sid}`);
      // The raw tool outputs behind both trees: a damaged one is never a done row.
      const raw: Record<string, string> = Object.fromEntries(
        await Promise.all(
          ["analyze", "ach", "fingerprint"].flatMap((n) =>
            [["start", start], ["final", final]].map(async (
              [side, dir],
            ) => [`${side}_${n}`, await hashOrEmpty(join(dir!, `${n}.json`))])
          ),
        ),
      );
      bind = {
        start: await hashOrEmpty(join(start, "tree.json")),
        final: await hashOrEmpty(join(final, "tree.json")),
        ...raw,
        digest: r.patch
          ? await hashOrEmpty(
            join(final, await digestFile(r.patch)),
          )
          : "",
        diff: await hashOrEmpty(join(
          final,
          diffName(sid, raw["start_fingerprint"]!, raw["final_fingerprint"]!),
        )),
      };
    } catch {
      bind = { error: "" };
    }
    return { build: t.build, rev: t.rev, hash, derive: DERIVATION, bind };
  };
  let n = 0;
  let skipped = 0;
  const failed: { id: string; error: string }[] = [];
  await pool(jobs, todo, async (r) => {
    const hash = hashOf.get(r.id)!;
    const prior = await readDone<AlsemRow>(execDir, r.id, await stampOf(r));
    if (prior && !hasErrorDiagnostic(prior.diagnostics)) {
      skipped++;
      return;
    }
    try {
      const { id: sid, tree: s } = await startTree(r.task);
      const f = await alsemTree(
        t,
        join(results, "workspaces", hash),
        hash,
        r.patch ?? "",
      );
      // The diff depends on both sides: the start identity, the final tree (this folder),
      // and the exact bytes of both fingerprint files it is computed from (named in the file).
      const diffOut = join(
        t.cache,
        hash,
        diffName(
          sid,
          await hashOrEmpty(s.fingerprint),
          await hashOrEmpty(f.fingerprint),
        ),
      );
      // One creation per diff entry at a time; a concurrent request finds it done.
      await serialized(diffOut, async () => {
        if (await Deno.stat(diffOut).then(() => true, () => false)) return;
        const tmp = `${diffOut}.tmp-${Deno.pid}-${crypto.randomUUID()}`;
        await (t.exec ?? run)(t.alsem, [
          "diff",
          s.fingerprint,
          f.fingerprint,
          "--format",
          "json",
          "--deterministic",
          "--out",
          tmp,
        ]);
        await Deno.rename(tmp, diffOut);
      });
      const diffRaw = await Deno.readTextFile(diffOut);
      const diff = { ...checkedEnvelope("diff", diffRaw, "diff-report").e };
      const introduced = introducedFindings(s.findings, f.findings);
      const introduced_fp = introducedFindingsFp(s.findings, f.findings);
      const touches = f.touches;
      const testQuality = testQualityCounts(
        s.testProcs,
        f.testProcs,
        new Set(touches.changed_routines),
      );
      const deltas = routineDeltas(
        s.metrics,
        f.metrics,
        new Set(touches.changed_routines),
      );
      const unused = newUnused(s.unused, f.unused);
      const blast = blastRadius(diff.payload, f.testRanges);
      const row: AlsemRow = {
        id: r.id,
        arm: r.arm,
        task: r.task,
        repeat: r.repeat,
        verdict: r.verdict,
        metrics: alsemSummary({
          introduced,
          introduced_fp,
          testQuality,
          deltas,
          unused,
          blast,
          touches,
          changed_prod_lines: changedProdLines(r.patch ?? ""),
        }),
        introduced,
        introduced_fp,
        test_quality: testQuality,
        deltas,
        unused,
        blast,
        touches,
        versions: {
          start: s.versions,
          final: f.versions,
          diff: {
            diff: {
              alsemVersion: diff.alsemVersion,
              schemaVersion: diff.schemaVersion,
            },
          },
        },
        diagnostics: [
          ...s.diagnostics.map((d) => ({ ...d, tree: "start" })),
          ...f.diagnostics.map((d) => ({ ...d, tree: "final" })),
          ...diff.diagnostics.map((d) => ({
            ...d,
            command: "diff",
            tree: "diff",
          })),
        ],
      };
      // Written last and atomically: only a complete row marks the execution done.
      await writeDone(execDir, r.id, await stampOf(r), row);
    } catch (err) {
      const error = (err as Error).message;
      failed.push({ id: r.id, error });
      console.error(`[WARN] alsem ${r.id}: ${error}`);
    }
    if (++n % 10 === 0) console.error(`[alsem] ${n}/${todo.length}`);
  });
  // Everything done for this build, this run's and earlier runs'; failures are absent.
  const byId = new Map(todo.map((r) => [r.id, r]));
  const all = (await loadDone<AlsemRow>(
    execDir,
    new Map(
      await Promise.all(
        todo.map(async (r) => [r.id, await stampOf(r)] as [string, DoneStamp]),
      ),
    ),
  )).filter((x) => !hasErrorDiagnostic(x.diagnostics)).map((x) => ({
    ...x,
    verdict: byId.get(x.id)!.verdict,
    excluded: alsemExclusion(byId.get(x.id)!.termination),
  }));
  const excluded = all.filter((r) => r.excluded);
  const out = all.filter((r) => !r.excluded); // aggregates read this
  // Rank among all executions of the task (every arm), lower density first; excluded rows stay unranked.
  const rank = withinTaskRanks(
    out.map((r) => ({
      id: r.id,
      task: r.task,
      density: r.metrics.curated_density,
    })),
  );
  const rankOf = (r: AlsemRow) => rank.get(r.id) ?? null;
  const rankStats = (rs: AlsemRow[]) => {
    const v = rs.map(rankOf);
    return { median: median(v), mean: densityStats(v).mean };
  };
  await writeAtomic(
    join(t.dir, "exclusions.md"),
    `## Static analysis (al-sem): exclusions\n\n${
      alsemExclusionText(excluded)
    }`,
  );
  const diagnostics = all.flatMap((r) => r.diagnostics);
  console.error(
    `[alsem] ${all.length}/${todo.length} done (${skipped} were done already, ${
      todo.length - all.length
    } failed, ${
      failed.filter((f) => f.error.startsWith("missing dependencies")).length
    } of them on missing dependencies), ${excluded.length} excluded from aggregates, ${diagnostics.length} al-sem diagnostics in ${
      all.filter((r) => r.diagnostics.length).length
    } executions`,
  );
  await Deno.writeTextFile(
    join(t.dir, "executions.json"),
    JSON.stringify(
      all.map((r) => ({ ...r, within_task_rank: rankOf(r) })),
      null,
      1,
    ),
  );
  await Deno.writeTextFile(
    join(t.dir, "executions.csv"),
    csv(all.map((r) => ({
      id: r.id,
      arm: r.arm,
      task: r.task,
      repeat: r.repeat,
      verdict: r.verdict,
      excluded: r.excluded ?? "",
      ...r.metrics,
      within_task_rank: rankOf(r),
    }))),
  );
  await Deno.writeTextFile(
    join(t.dir, "introduced.csv"),
    csv(
      all.flatMap((r) =>
        r.introduced.map((f) => ({
          execution: r.id,
          arm: r.arm,
          task: r.task,
          excluded: r.excluded ?? "",
          ...f,
        }))
      ),
    ),
  );
  const agg = (rs: AlsemRow[]) => ({
    executions: rs.length,
    curated_density: densityStats(rs.map((r) => r.metrics.curated_density)),
    curated_density_fp: densityStats(
      rs.map((r) => r.metrics.curated_density_fp),
    ),
    within_task_rank: rankStats(rs),
    median: Object.fromEntries(
      METRIC_KEYS.map((k) => [k, median(rs.map((r) => r.metrics[k]))]),
    ),
    /** Median over the executions where the metric is defined (the others are null, not 0). */
    median_nullable: Object.fromEntries(
      NULLABLE_KEYS.map((k) => [k, median(rs.map((r) => r.metrics[k]))]),
    ),
    test_quality: pooledTestQuality(rs.map((r) => r.metrics)),
    test_coverage: {
      ...pooledCoverage(rs.map((r) => r.metrics)),
      ...coverageExtras(rs),
    },
    executions_above_zero: Object.fromEntries(
      METRIC_KEYS.map((k) => [k, rs.filter((r) => r.metrics[k] > 0).length]),
    ),
    by_detector: rs.flatMap((r) => r.introduced).filter((f) =>
      f.app !== TEST_APP
    ).reduce(
      (m, f) => (m[f.detector] = (m[f.detector] ?? 0) + f.count, m),
      {} as Record<string, number>,
    ),
  });
  const arms = [...new Set(out.map((r) => r.arm))].sort();
  const byCell = new Map(out.map((r) => [`${r.arm}|${r.task}|${r.repeat}`, r]));
  const perPair = pairs.map(([b, v]) => {
    const matched = out.filter((r) => r.arm === b).flatMap((a) => {
      const x = byCell.get(`${v}|${a.task}|${a.repeat}`);
      return x ? [[a, x] as const] : [];
    });
    const cmp = (ps: (readonly [AlsemRow, AlsemRow])[]) => ({
      pairs: ps.length,
      curated_density: {
        base: densityStats(ps.map(([a]) => a.metrics.curated_density)),
        variant: densityStats(ps.map(([, x]) => x.metrics.curated_density)),
        // Variant minus base over the pairs where both have a density.
        median_diff: median(
          ps.map(([a, x]) =>
            a.metrics.curated_density === null ||
              x.metrics.curated_density === null
              ? null
              : x.metrics.curated_density - a.metrics.curated_density
          ),
        ),
      },
      within_task_rank: {
        base: rankStats(ps.map(([a]) => a)),
        variant: rankStats(ps.map(([, x]) => x)),
      },
      median_diff: Object.fromEntries(
        METRIC_KEYS.map((k) => [
          k,
          median(ps.map(([a, x]) => x.metrics[k] - a.metrics[k])),
        ]),
      ),
      /** Variant minus base over the pairs where both sides have the metric. */
      median_diff_nullable: Object.fromEntries(
        NULLABLE_KEYS.map((k) => [
          k,
          median(ps.map(([a, x]) => {
            const [p, q] = [a.metrics[k], x.metrics[k]];
            return p === null || q === null ? null : q - p;
          })),
        ]),
      ),
      test_quality: {
        base: pooledTestQuality(ps.map(([a]) => a.metrics)),
        variant: pooledTestQuality(ps.map(([, x]) => x.metrics)),
      },
      test_coverage: {
        base: {
          ...pooledCoverage(ps.map(([a]) => a.metrics)),
          ...coverageExtras(ps.map(([a]) => a)),
        },
        variant: {
          ...pooledCoverage(ps.map(([, x]) => x.metrics)),
          ...coverageExtras(ps.map(([, x]) => x)),
        },
      },
      variant_higher: Object.fromEntries(
        METRIC_KEYS.map((k) => [
          k,
          ps.filter(([a, x]) => x.metrics[k] > a.metrics[k]).length,
        ]),
      ),
      variant_lower: Object.fromEntries(
        METRIC_KEYS.map((k) => [
          k,
          ps.filter(([a, x]) => x.metrics[k] < a.metrics[k]).length,
        ]),
      ),
    });
    return {
      base: b,
      variant: v,
      all: cmp(matched),
      both_pass: cmp(
        matched.filter(([a, x]) =>
          a.verdict === "pass" && x.verdict === "pass"
        ),
      ),
    };
  });
  await Deno.writeTextFile(
    join(t.dir, "summary.json"),
    JSON.stringify(
      {
        // This run's failures (exit 4 = missing dependencies); a rerun retries them.
        failed,
        diagnostics: {
          executions_with_diagnostics:
            all.filter((r) => r.diagnostics.length).length,
          by_code: diagnostics.reduce(
            (m, d) => (bump(m, `${d.command}:${d.severity}:${d.code}`), m),
            {} as Record<string, number>,
          ),
        },
        excluded: excluded.map((r) => ({
          id: r.id,
          arm: r.arm,
          task: r.task,
          repeat: r.repeat,
          reason: r.excluded,
        })),
        per_arm: Object.fromEntries(
          arms.map((a) => [a, agg(out.filter((r) => r.arm === a))]),
        ),
        per_arm_passing: Object.fromEntries(
          arms.map((a) => [
            a,
            agg(out.filter((r) => r.arm === a && r.verdict === "pass")),
          ]),
        ),
        per_pair: perPair,
      },
      null,
      1,
    ),
  );
  console.error(
    `[OK] alsem: ${out.length} of ${todo.length} executions -> ${t.dir}`,
  );
}

const classifyRow = (b: Row) =>
  classifyLoss({
    termination: b.termination,
    wall_ms: b.wall_ms,
    subagent_wall_ms: b.profile?.subagent_wall_ms ?? 0,
    review_wall_ms: b.profile?.review_wall_ms ?? 0,
    compile_calls: b.profile?.compile_calls ?? 0,
    files_changed: b.files.length,
    files_outside_touches: b.files.filter((f) => f.outside_touches).length,
    shipped_tests_edited: b.files.filter((f) => f.shipped_test).length,
    build_diag_apps: [...new Set(b.build_diagnostics.map((d) => d.app))],
    missing_symbols_added_to_shipped_tests: missingFromShipped(b),
    scorers: b.scorers,
  });

/**
 * Names a verdict build diagnostic reports missing ("does not contain a
 * definition for 'X'") that the agent's patch adds to a shipped test file:
 * the verdict restores shipped test files, so those additions are gone.
 */
export function missingFromShipped(
  r: { patch: string | null; build_diagnostics: { message: string }[] },
): string[] {
  if (!r.patch) return [];
  const shippedAdds = r.patch.split(/^(?=--- )/m)
    .filter((s) => s.startsWith(`--- start/${TEST_APP}/`))
    .flatMap((s) => s.split("\n").filter((l) => l.startsWith("+")));
  const names = r.build_diagnostics.flatMap((d) =>
    [...d.message.matchAll(
      /(?:definition for|No overload for method) '([^']+)'/g,
    )]
      .map((m) => m[1]!)
  );
  return [...new Set(names)].filter((n) =>
    shippedAdds.some((l) => new RegExp(`\\b${n}\\b`).test(l))
  );
}

function scorerSummary(j: J | null): ScorerSummary[] {
  const scorers = (j?.["scorers"] ?? []) as {
    name: string;
    passed: boolean | null;
    tests: { codeunit: number; procedure: string; outcome: string }[];
  }[];
  return scorers.map((s) => ({
    name: s.name,
    passed: s.passed,
    failed: s.tests.filter((t) => t.outcome !== "pass").map((t) =>
      `${t.codeunit}.${t.procedure}`
    ),
  }));
}

const median = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
};

export function csv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]!);
  const cell = (v: unknown) => {
    const s = v === null || v === undefined
      ? ""
      : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [
    keys.join(","),
    ...rows.map((r) => keys.map((k) => cell(r[k])).join(",")),
  ]
    .join("\n") + "\n";
}

const min = (ms: number | null) => ms === null ? "-" : (ms / 60000).toFixed(1);
const usd = (x: number | null) => x === null ? "unknown" : `$${x.toFixed(3)}`;

function sideBySide(a: Row, b: Row): string {
  const pa = a.profile;
  const pb = b.profile;
  const lines: [string, string, string][] = [
    ["verdict", a.verdict ?? "-", b.verdict ?? "-"],
    ["termination", a.termination, b.termination],
    ["wall (min)", min(a.wall_ms), min(b.wall_ms)],
    ["cost", usd(a.cost_usd), usd(b.cost_usd)],
    ["output tokens", String(a.tokens_out ?? "-"), String(b.tokens_out ?? "-")],
    [
      "tool calls",
      String(pa?.tool_calls ?? "-"),
      String(pb?.tool_calls ?? "-"),
    ],
    [
      "calls by category",
      JSON.stringify(pa?.by_category ?? {}),
      JSON.stringify(pb?.by_category ?? {}),
    ],
    [
      "calls by agent",
      JSON.stringify(pa?.by_agent ?? {}),
      JSON.stringify(pb?.by_agent ?? {}),
    ],
    [
      "sub-agents (type min)",
      (pa?.subagents ?? []).map((s) => `${s.type} ${min(s.duration_ms)}`).join(
        ", ",
      ) || "-",
      (pb?.subagents ?? []).map((s) => `${s.type} ${min(s.duration_ms)}`).join(
        ", ",
      ) || "-",
    ],
    [
      "wall in sub-agents (min)",
      min(pa?.subagent_wall_ms ?? null),
      min(pb?.subagent_wall_ms ?? null),
    ],
    [
      "wall in review (min)",
      min(pa?.review_wall_ms ?? null),
      min(pb?.review_wall_ms ?? null),
    ],
    [
      "skills",
      JSON.stringify(pa?.skills ?? {}),
      JSON.stringify(pb?.skills ?? {}),
    ],
    [
      "compile / test calls",
      `${pa?.compile_calls ?? "-"} / ${pa?.test_calls ?? "-"}`,
      `${pb?.compile_calls ?? "-"} / ${pb?.test_calls ?? "-"}`,
    ],
    [
      "edit-build cycles",
      String(pa?.edit_build_cycles ?? "-"),
      String(pb?.edit_build_cycles ?? "-"),
    ],
    [
      "first edit (min)",
      min(pa?.first_edit_ms ?? null),
      min(pb?.first_edit_ms ?? null),
    ],
    [
      "first compile (min)",
      min(pa?.first_compile_ms ?? null),
      min(pb?.first_compile_ms ?? null),
    ],
    ["files changed", String(a.files.length), String(b.files.length)],
    [
      "outside target apps",
      a.files.filter((f) => f.outside_touches).map((f) => f.path).join(", ") ||
      "-",
      b.files.filter((f) => f.outside_touches).map((f) => f.path).join(", ") ||
      "-",
    ],
    [
      "shipped test files edited",
      a.files.filter((f) => f.shipped_test).map((f) => f.path).join(", ") ||
      "-",
      b.files.filter((f) => f.shipped_test).map((f) => f.path).join(", ") ||
      "-",
    ],
  ];
  const esc = (s: string) => s.replaceAll("|", "\\|");
  return [
    `| | ${a.arm} | ${b.arm} |`,
    "| --- | --- | --- |",
    ...lines.map(([k, x, y]) => `| ${k} | ${esc(x)} | ${esc(y)} |`),
  ].join("\n");
}

function failures(r: Row): string {
  const out: string[] = [];
  for (const s of r.scorers) {
    if (s.passed !== false) continue;
    out.push(`- **${s.name}** failed${s.failed.length ? ":" : ""}`);
    for (const t of s.failed) {
      const text = r.failure_text[t];
      out.push(
        `  - \`${t}\`${text ? `: ${text.split("\n")[0]!.slice(0, 400)}` : ""}`,
      );
    }
  }
  for (const d of r.build_diagnostics.slice(0, 10)) {
    out.push(`- build ${d.app} ${d.code}: ${d.message.slice(0, 300)}`);
  }
  for (const n of r.verdict_notes) out.push(`- verdict note: ${n}`);
  return out.join("\n") || "- none";
}

const MAX_PATCH_LINES = 400;
const fence = (p: string | null) => {
  if (!p) return "_no source change_";
  const lines = p.split("\n");
  const cut = lines.length > MAX_PATCH_LINES
    ? `\n... ${lines.length - MAX_PATCH_LINES} more lines in the diffs folder`
    : "";
  return "```diff\n" + lines.slice(0, MAX_PATCH_LINES).join("\n") + "\n```" +
    cut;
};

function dossier(
  a: Row,
  b: Row,
  loss: { cls: string; tags: string[] } | null,
): string {
  return [
    `# ${a.task} repeat ${a.repeat}: ${a.arm} vs ${b.arm}`,
    "",
    `Executions: ${a.arm} \`${a.id}\`, ${b.arm} \`${b.id}\`. Task kind ${a.kind}.`,
    loss
      ? `\n**Loss class (${b.arm}):** ${loss.cls}${
        loss.tags.length ? ` (${loss.tags.join(", ")})` : ""
      }`
      : "",
    "",
    "## Profile",
    "",
    sideBySide(a, b),
    "",
    `## Failing tests: ${a.arm}`,
    "",
    failures(a),
    "",
    `## Failing tests: ${b.arm}`,
    "",
    failures(b),
    "",
    `## Diff: ${a.arm}`,
    "",
    fence(a.patch),
    "",
    `## Diff: ${b.arm}`,
    "",
    fence(b.patch),
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(Deno.args, {
    string: [
      "results",
      "rev",
      "out",
      "repo",
      "pair",
      "alsem",
      "ach",
      "symbols",
      "alsem-jobs",
      "only",
      "containers",
      "coord-lease",
      "private-dir",
      "lineage",
    ],
    boolean: ["test-rerun"],
    collect: ["pair", "coord-lease"],
    default: { repo: ".", "alsem-jobs": "3" },
  });
  const campaignId = String(args._[0] ?? "");
  if (
    !campaignId || !args.results || !args.rev || !args.out ||
    (args.alsem && (!args.ach || !args.symbols)) ||
    (args["test-rerun"] &&
      (!args.containers || !args.symbols || !args.lineage))
  ) {
    console.error(
      "usage: analyze-campaign.ts <campaign-id> --results <dir> --rev <task rev> --out <dir> [--pair base:variant ...] [--repo .] [--only <id or id prefix>,...]\n" +
        "  [--alsem <alsem binary> --ach <al-call-hierarchy binary> --symbols <symbol store> [--alsem-jobs 3]]\n" +
        "  [--test-rerun --containers <a,b> --symbols <symbol store> --lineage <reset lineage> [--coord-lease <container>=<token> ...] [--private-dir <dir>]]\n" +
        "      Q-04: agent tests vs the start tree, shipped tests vs the final tree. Container runs through the harness lane: takes the bench lock and private-root lock, refuses coord-leased containers without a matching --coord-lease.",
    );
    Deno.exit(2);
  }
  const results = args.results;
  const out = args.out;
  const repo = args.repo;
  const campaign = await readJson(
    join(results, "campaigns", `${campaignId}.json`),
  );
  const exp = campaign["experiment"] as {
    baseline: string;
    variants: string[];
  };
  const pairs: [string, string][] = (args.pair as string[]).length
    ? (args.pair as string[]).map((p) => p.split(":") as [string, string])
    : exp.variants.map((v) => [exp.baseline, v]);
  const taskSet =
    (campaign["task_set"] as { tasks: { id: string; refapp_commit: string }[] })
      .tasks;
  const refappOf = new Map(taskSet.map((t) => [t.id, t.refapp_commit]));
  const meta = new Map(
    (campaign["tasks_meta"] as { id: string; kind: string }[]).map((
      t,
    ) => [t.id, t]),
  );
  await Deno.mkdir(join(out, "diffs"), { recursive: true });
  const cache = join(out, ".start");
  const touchesOf = new Map<string, string[]>();
  // One identity check / build per task and run.
  const starts = new Map<string, Promise<StartTree>>();
  const startOf = (task: string) => {
    if (!starts.has(task)) {
      starts.set(
        task,
        startingTree(repo, args.rev!, task, refappOf.get(task)!, cache),
      );
    }
    return starts.get(task)!;
  };

  // Latest attempt per cell.
  const execDir = join(results, "executions", campaignId);
  const cells = new Map<string, J>();
  const only = args.only ? args.only.split(",") : [];
  for await (const f of Deno.readDir(execDir)) {
    if (!f.name.endsWith(".json")) continue;
    const e = await readJson(join(execDir, f.name));
    if (!keepExecution(e["id"] as string, only)) continue;
    const key = `${e["arm"]}|${e["task_id"]}|${e["repeat"]}`;
    const prev = cells.get(key);
    if (!prev || (e["attempt"] as number) > (prev["attempt"] as number)) {
      cells.set(key, e);
    }
  }

  const rows: Row[] = [];
  const hashOf = new Map<string, string>();
  let n = 0;
  for (
    const e of [...cells.values()].sort((a, b) =>
      String(a["id"]).localeCompare(String(b["id"]))
    )
  ) {
    const id = e["id"] as string;
    const task = e["task_id"] as string;
    if (++n % 20 === 0) console.error(`[A] ${n}/${cells.size}`);
    // Judgment: the latest one filed for the execution.
    let j: J | null = null;
    const jdir = join(results, "judgments", id);
    const judged = await Array.fromAsync(Deno.readDir(jdir)).catch(() => []);
    for (const f of judged) {
      const x = await readJson(join(jdir, f.name));
      if (!j || String(x["ended_at"]) > String(j["ended_at"])) j = x;
    }
    const vlog = j
      ? await readJsonOr(join(results, "verdicts", `${j["id"]}.json`))
      : null;
    const sandbox = await readJsonOr(join(results, "runs", id, "sandbox.json"));
    const tel = e["telemetry"] as J;
    const perModel = (tel["per_model"] ?? null) as J[] | null;
    const sum = (k: string) =>
      perModel
        ? perModel.reduce((s, m) => s + ((m[k] as number) ?? 0), 0)
        : null;
    const wall = (tel["wall_ms"] as number | null) ??
      ((sandbox?.["sandbox"] as J | undefined)?.["wall_ms"] as
        | number
        | undefined) ??
      (Date.parse(e["ended_at"] as string) -
        Date.parse(e["started_at"] as string));
    let profile: TraceProfile | null = null;
    if (e["trace_path"]) {
      try {
        profile = traceProfile(
          await readTrace(join(results, e["trace_path"] as string)),
        );
      } catch (err) {
        console.error(`[WARN] trace ${id}: ${(err as Error).message}`);
      }
    }
    let files: FileChange[] = [];
    let patch: string | null = null;
    if (e["workspace_hash"]) {
      hashOf.set(id, e["workspace_hash"] as string);
      const start = (await startOf(task)).dir;
      if (!touchesOf.has(task)) {
        const at = await loadTaskAt(repo, task, args.rev, join(cache, "tasks"));
        touchesOf.set(task, at.task.task.touches);
      }
      const d = await diffTrees(
        start,
        join(results, "workspaces", e["workspace_hash"] as string),
        touchesOf.get(task)!,
      );
      files = d.files;
      patch = d.patch;
      await Deno.writeTextFile(join(out, "diffs", `${id}.patch`), patch);
    }
    const failureText: Record<string, string> = {};
    for (
      const m of (vlog?.["test_messages"] ?? []) as {
        codeunit: number;
        procedure: string;
        message: string;
      }[]
    ) {
      failureText[`${m.codeunit}.${m.procedure}`] = m.message;
    }
    rows.push({
      id,
      arm: e["arm"] as string,
      task,
      kind: meta.get(task)?.kind ?? "",
      repeat: e["repeat"] as number,
      attempt: e["attempt"] as number,
      termination: e["termination"] as string,
      verdict: (j?.["verdict"] as string | undefined) ?? null,
      judgment_id: (j?.["id"] as string | undefined) ?? null,
      wall_ms: wall,
      cost_usd: (tel["cost_usd"] as number | null) ?? null,
      tokens_out: sum("tokens_out"),
      tokens_in_total: perModel
        ? (sum("tokens_in_uncached")! + sum("tokens_cache_read")! +
          sum("tokens_cache_write")!)
        : null,
      turns: (tel["turns"] as number | null) ?? null,
      scorers: scorerSummary(j),
      failure_text: failureText,
      verdict_notes: (vlog?.["notes"] ?? []) as string[],
      build_diagnostics: (vlog?.["diagnostics"] ?? []) as {
        app: string;
        code: string;
        message: string;
      }[],
      profile,
      files,
      patch,
    });
  }

  await Deno.writeTextFile(
    join(out, "executions.json"),
    JSON.stringify(rows.map(({ patch: _, ...r }) => r), null, 1),
  );
  const flat = rows.map((r) => ({
    id: r.id,
    arm: r.arm,
    task: r.task,
    kind: r.kind,
    repeat: r.repeat,
    termination: r.termination,
    verdict: r.verdict,
    wall_min: r.wall_ms === null ? null : +(r.wall_ms / 60000).toFixed(2),
    cost_usd: r.cost_usd,
    tokens_out: r.tokens_out,
    turns: r.turns,
    tool_calls: r.profile?.tool_calls ?? null,
    tool_errors: r.profile?.tool_errors ?? null,
    subagents: r.profile?.subagents.length ?? null,
    subagent_types: r.profile?.subagents.map((s) => s.type).join(" ") ?? null,
    subagent_wall_share: r.profile && r.wall_ms
      ? +(r.profile.subagent_wall_ms / r.wall_ms).toFixed(3)
      : null,
    review_wall_share: r.profile && r.wall_ms
      ? +(r.profile.review_wall_ms / r.wall_ms).toFixed(3)
      : null,
    compile_calls: r.profile?.compile_calls ?? null,
    test_calls: r.profile?.test_calls ?? null,
    edit_build_cycles: r.profile?.edit_build_cycles ?? null,
    first_edit_min: r.profile?.first_edit_ms == null
      ? null
      : +(r.profile.first_edit_ms / 60000).toFixed(2),
    first_compile_min: r.profile?.first_compile_ms == null
      ? null
      : +(r.profile.first_compile_ms / 60000).toFixed(2),
    files_changed: r.files.length,
    lines_added: r.files.reduce((s, f) => s + f.added_lines, 0),
    lines_removed: r.files.reduce((s, f) => s + f.removed_lines, 0),
    files_outside_touches: r.files.filter((f) => f.outside_touches).length,
    test_app_files: r.files.filter((f) => f.app === TEST_APP).length,
    shipped_tests_edited: r.files.filter((f) => f.shipped_test).length,
    failed_scorers: r.scorers.filter((s) => s.passed === false).map((s) =>
      s.name
    ).join(" "),
    verdict_notes: r.verdict_notes.join("; "),
  }));
  await Deno.writeTextFile(join(out, "executions.csv"), csv(flat));

  const byCell = new Map(
    rows.map((r) => [`${r.arm}|${r.task}|${r.repeat}`, r]),
  );
  const pairRows: Record<string, unknown>[] = [];
  const lossRows: Record<string, unknown>[] = [];
  for (const [baseArm, varArm] of pairs) {
    const dir = join(out, "dossiers", `${baseArm}__${varArm}`);
    await Deno.mkdir(dir, { recursive: true });
    for (const a of rows.filter((r) => r.arm === baseArm)) {
      const b = byCell.get(`${varArm}|${a.task}|${a.repeat}`);
      if (!b) continue;
      const outcome = a.verdict === "pass" && b.verdict === "pass"
        ? "both_pass"
        : a.verdict === "pass"
        ? "variant_loss"
        : b.verdict === "pass"
        ? "variant_win"
        : "both_fail";
      let loss: { cls: LossClass; tags: string[] } | null = null;
      if (outcome === "variant_loss" || outcome === "both_fail") {
        loss = classifyRow(b);
      }
      const file = `${a.task}-r${a.repeat}.md`;
      await Deno.writeTextFile(join(dir, file), dossier(a, b, loss));
      pairRows.push({
        base: baseArm,
        variant: varArm,
        task: a.task,
        kind: a.kind,
        repeat: a.repeat,
        base_id: a.id,
        variant_id: b.id,
        outcome,
        variant_class: loss?.cls ?? null,
        variant_tags: loss?.tags.join(" ") ?? null,
        dossier: `dossiers/${baseArm}__${varArm}/${file}`,
      });
      if (outcome === "variant_loss") {
        lossRows.push({
          base: baseArm,
          variant: varArm,
          task: a.task,
          kind: a.kind,
          repeat: a.repeat,
          variant_id: b.id,
          class: loss!.cls,
          tags: loss!.tags.join(" "),
          termination: b.termination,
          wall_min: b.wall_ms === null ? null : +(b.wall_ms / 60000).toFixed(1),
          subagent_wall_share: b.profile && b.wall_ms
            ? +(b.profile.subagent_wall_ms / b.wall_ms).toFixed(2)
            : null,
          failed: b.scorers.filter((s) => s.passed === false).map((s) =>
            `${s.name}[${s.failed.join(" ")}]`
          ).join(" "),
          notes: b.verdict_notes.join("; "),
          dossier: `dossiers/${baseArm}__${varArm}/${file}`,
        });
      }
    }
  }
  await Deno.writeTextFile(
    join(out, "pairs.json"),
    JSON.stringify(pairRows, null, 1),
  );
  await Deno.writeTextFile(join(out, "pairs.csv"), csv(pairRows));
  await Deno.writeTextFile(join(out, "losses.csv"), csv(lossRows));

  const arms = [...new Set(rows.map((r) => r.arm))].sort();
  const perArm = Object.fromEntries(arms.map((arm) => {
    const rs = rows.filter((r) => r.arm === arm);
    const fl = flat.filter((r) => r.arm === arm);
    const terms: Record<string, number> = {};
    for (const r of rs) bump(terms, r.termination);
    const notes: Record<string, number> = {};
    for (const r of rs) {
      for (const x of r.verdict_notes) bump(notes, x.replace(/\d+/g, "N"));
    }
    return [arm, {
      executions: rs.length,
      pass: rs.filter((r) => r.verdict === "pass").length,
      terminations: terms,
      verdict_notes: notes,
      median: Object.fromEntries(
        [
          "wall_min",
          "cost_usd",
          "tokens_out",
          "tool_calls",
          "subagents",
          "subagent_wall_share",
          "review_wall_share",
          "compile_calls",
          "test_calls",
          "edit_build_cycles",
          "first_edit_min",
          "first_compile_min",
          "files_changed",
          "lines_added",
          "test_app_files",
        ]
          .map((
            k,
          ) => [
            k,
            median(
              fl.map((r) => (r as Record<string, unknown>)[k] as number | null),
            ),
          ]),
      ),
      executions_with_outside_files: fl.filter((r) =>
        r.files_outside_touches > 0
      ).length,
      executions_editing_shipped_tests: fl.filter((r) =>
        r.shipped_tests_edited > 0
      ).length,
      // Every failed execution of the arm, paired or not, by the same classes.
      fail_classes: rs.filter((r) => r.verdict !== "pass").reduce(
        (m, r) => (bump(m, classifyRow(r).cls), m),
        {} as Record<string, number>,
      ),
    }];
  }));
  const perPair = pairs.map(([b, v]) => {
    const ps = pairRows.filter((p) => p["base"] === b && p["variant"] === v);
    const count = (k: string) => ps.filter((p) => p["outcome"] === k).length;
    const cls: Record<string, number> = {};
    for (
      const l of lossRows.filter((l) => l["base"] === b && l["variant"] === v)
    ) {
      bump(cls, l["class"] as string);
    }
    return {
      base: b,
      variant: v,
      pairs: ps.length,
      both_pass: count("both_pass"),
      variant_loss: count("variant_loss"),
      variant_win: count("variant_win"),
      both_fail: count("both_fail"),
      loss_classes: cls,
    };
  });
  await Deno.writeTextFile(
    join(out, "summary.json"),
    JSON.stringify(
      {
        campaign: campaignId,
        rev: args.rev,
        per_arm: perArm,
        per_pair: perPair,
      },
      null,
      1,
    ),
  );
  console.error(
    `[OK] ${rows.length} executions, ${pairRows.length} pairs, ${lossRows.length} losses -> ${out}`,
  );

  if (args.alsem) {
    const dir = join(out, "alsem");
    await Deno.mkdir(dir, { recursive: true });
    const lockText = await run(
      "git",
      ["show", `${args.rev}:harness-tasks/symbols.lock.json`],
      repo,
    );
    const alsemSha = await sha256File(args.alsem);
    const achSha = await sha256File(args.ach!);
    const t: AlsemTools = {
      alsem: args.alsem,
      ach: args.ach!,
      store: args.symbols!,
      lock: (JSON.parse(lockText) as { packages: AlsemTools["lock"] })
        .packages,
      dir,
      cache: join(
        dir,
        "cache",
        `${alsemSha.slice(0, 12)}-${achSha.slice(0, 12)}`,
      ),
      build: `${alsemSha}-${achSha}`,
      rev: args.rev,
    };
    const missing = [];
    for (const p of t.lock) {
      const f = join(t.store, `${p.sha256}.app`);
      if (
        !await Deno.stat(f).then(() => true, () => false) ||
        await sha256File(f) !== p.sha256
      ) missing.push(p.file);
    }
    if (missing.length) {
      throw new Error(
        `symbol store ${t.store} lacks ${missing.length} locked packages: ${
          missing.slice(0, 3).join(", ")
        }`,
      );
    }
    // The binary is the one tools.json pinned (same sha256): reuse its version, no tool call.
    const version = await resolveAlsemVersion(
      await readJsonOr(join(dir, "tools.json")),
      alsemSha,
      () => run(t.alsem, ["--version"]),
    );
    await Deno.writeTextFile(
      join(dir, "tools.json"),
      JSON.stringify(
        {
          alsem: {
            path: t.alsem,
            version,
            sha256: alsemSha,
          },
          al_call_hierarchy: { path: t.ach, sha256: achSha },
          cache: t.cache,
          symbols: { store: t.store, packages: t.lock.length, rev: args.rev },
          workspace:
            "one synthetic app per tree (mergedAppJson), scratch copy with .alpackages a junction to the symbol store; analyze --require-dependencies; alsem commands --deterministic",
        },
        null,
        1,
      ),
    );
    await alsemStep(
      t,
      rows,
      results,
      hashOf,
      startOf,
      pairs,
      Number(args["alsem-jobs"]),
    );
  }

  if (args["test-rerun"]) {
    // Dynamic import: test-rerun.ts imports this module's helpers.
    const { testRerunStep } = await import("./test-rerun.ts");
    const { productionRunner } = await import("./test-rerun-runner.ts");
    const dir = join(out, "test-rerun");
    const local = Deno.env.get("LOCALAPPDATA");
    const privateRoot = args["private-dir"]
      ? resolve(args["private-dir"])
      : local
      ? join(local, "centralgauge", "harness")
      : null;
    if (!privateRoot) {
      throw new Error("pass --private-dir (LOCALAPPDATA is not set)");
    }
    // Opens the harness environment: bench lock, private-root lock, coord lease check.
    const runner = await productionRunner({
      repoRoot: resolve(repo),
      resultsDir: join(dir, "env"),
      containers: args.containers!.split(",").map((c) => c.trim()).filter(
        Boolean,
      ),
      coordLeases: args["coord-lease"] as string[],
      symbolStore: resolve(args.symbols!),
      privateRoot,
      lineage: args.lineage ? resolve(args.lineage) : null,
    });
    try {
      await testRerunStep({
        runner,
        rows,
        results,
        hashOf,
        startOf,
        pairs,
        jobs: 1, // container runs are serialized by the lane anyway
        dir,
        rev: args.rev,
      });
    } finally {
      await runner.close?.();
    }
  }
}

if (import.meta.main) await main();
