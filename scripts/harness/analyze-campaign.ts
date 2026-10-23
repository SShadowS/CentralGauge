/**
 * Post-campaign analysis (A-01): per-execution extraction, matched-pair
 * dossiers and a failure-class table for every variant loss. Read-only on the
 * results: the starting trees are rebuilt from git into the output folder.
 *
 *   deno run --allow-all scripts/harness/analyze-campaign.ts <campaign-id>
 *     --results <harness results root> --rev <task rev> --out <dir>
 *     [--pair baseArm:variantArm ...] [--repo .]
 *
 * Without --pair every variant is paired with the experiment baseline.
 * Outputs: executions.json/.csv, pairs.json, losses.csv, summary.json,
 * diffs/<execution>.patch and dossiers/<base>__<variant>/<task>-r<n>.md.
 *
 * A-03: with `--alsem <alsem> --ach <al-call-hierarchy> --symbols <store>
 * [--alsem-jobs 3]` it also runs al-sem on each starting tree and final
 * workspace (no containers) into alsem/: introduced findings, routine
 * metric deltas, blast radius (alsem diff) and digest touches, per execution,
 * per arm and per matched pair.
 */

import { parseArgs } from "@std/cli/parse-args";
import { basename, join } from "@std/path";
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

interface Row {
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

export interface AlsemFinding {
  detector: string;
  severity: string;
  object: string;
  routine: string;
  file: string;
  line: number;
  app: string;
}

/** `alsem analyze --format json` findings, located by workspace-relative file. */
export function alsemFindings(report: unknown): AlsemFinding[] {
  const fs = (report as { payload: { findings: J[] } }).payload.findings;
  return fs.map((f) => {
    const loc = (f["primaryLocation"] ?? {}) as J;
    const file = String(loc["file"] ?? "").replace(/^ws:/, "");
    return {
      detector: f["detector"] as string,
      severity: f["severity"] as string,
      object: (loc["objectName"] as string | undefined) ?? "",
      routine: (loc["routineName"] as string | undefined) ?? "",
      file,
      line: (loc["line"] as number | undefined) ?? 0,
      app: file.split("/")[0]!,
    };
  });
}

/**
 * Findings the agent introduced: final minus start, keyed by detector +
 * object + routine (a line shift is the same finding), as a multiset. One row
 * per key: its first surplus final instance and how many surplus there are.
 */
export function introducedFindings(
  start: AlsemFinding[],
  final: AlsemFinding[],
): (AlsemFinding & { count: number })[] {
  const key = (f: AlsemFinding) => `${f.detector}|${f.object}|${f.routine}`;
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

const OBJECT_HEADER =
  /^﻿?\s*(?:tableextension|table|pageextension|page|codeunit|reportextension|report|query|xmlport|enumextension|enum|interface|permissionsetextension|permissionset|controladdin|profile|entitlement)\s+(?:\d+\s+)?(?:"([^"]+)"|(\S+))/im;

/** Object name -> app folder, from each source file's object header. */
export function objectApps(
  files: { path: string; text: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) {
    const m = OBJECT_HEADER.exec(f.text);
    if (m) out[m[1] ?? m[2]!] = f.path.split("/")[0]!;
  }
  return out;
}

export interface RoutineMetric {
  object_type: string;
  object_name: string;
  procedure_name: string;
  complexity: number;
  line_count: number;
  parameter_count: number;
}

export interface RoutineDelta {
  app: string;
  object: string;
  routine: string;
  status: "added" | "changed" | "removed";
  /** Final complexity (0 when removed). */
  complexity: number;
  d_complexity: number;
  d_lines: number;
  d_params: number;
}

/**
 * Per routine (`al-call-hierarchy --analyze` metrics, keyed by object type,
 * object and procedure name, so overloads share a key): the routines added,
 * removed or with any metric changed, sorted by app, object, routine.
 */
export function routineDeltas(
  start: RoutineMetric[],
  final: RoutineMetric[],
  apps: Record<string, string>,
): RoutineDelta[] {
  const key = (m: RoutineMetric) =>
    `${m.object_type}|${m.object_name}|${m.procedure_name}`;
  const a = new Map(start.map((m) => [key(m), m]));
  const b = new Map(final.map((m) => [key(m), m]));
  const out: RoutineDelta[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const s = a.get(k);
    const f = b.get(k);
    const m = (f ?? s)!;
    const dc = (f?.complexity ?? 0) - (s?.complexity ?? 0);
    const dl = (f?.line_count ?? 0) - (s?.line_count ?? 0);
    const dp = (f?.parameter_count ?? 0) - (s?.parameter_count ?? 0);
    if (s && f && dc === 0 && dl === 0 && dp === 0) continue;
    out.push({
      app: apps[m.object_name] ?? "?",
      object: m.object_name,
      routine: m.procedure_name,
      status: !s ? "added" : !f ? "removed" : "changed",
      complexity: f?.complexity ?? 0,
      d_complexity: dc,
      d_lines: dl,
      d_params: dp,
    });
  }
  const cmp = (x: RoutineDelta) => `${x.app}\0${x.object}\0${x.routine}`;
  return out.sort((x, y) => cmp(x).localeCompare(cmp(y)));
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

/** `alsem diff --format json` findings, production vs Test app by object id. */
export function blastRadius(
  report: unknown,
  testRanges: [number, number][],
): { production: BlastSide; test: BlastSide } {
  const side = (): BlastSide => ({
    abi: 0,
    schema: 0,
    events: 0,
    permissions: 0,
    capabilities: 0,
    by_kind: {},
    critical_or_high: 0,
  });
  const r = { production: side(), test: side() };
  for (
    const f of (report as { payload: { findings: J[] } }).payload.findings
  ) {
    const subj = (f["subject"] ?? {}) as J;
    const id = String(
      subj["normalizedStableId"] ?? subj["newStableId"] ??
        subj["oldStableId"] ?? "",
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
  return r;
}

export interface DigestTouches {
  roots: number;
  production_roots: number;
  tables_written: string[];
  tables_read: string[];
  events_published: string[];
  commits: number;
  unresolved: number;
  /** Diff hunks al-sem could not map to a routine. */
  unmapped_hunks: number;
  unmatched_files: number;
}

const WRITES = new Set(["DB_INSERT", "DB_MODIFY", "DB_DELETE", "DB_RENAME"]);

/** `alsem digest --diff`: what the changed production routines touch. */
export function digestTouches(report: unknown): DigestTouches {
  const p = (report as { payload: J }).payload;
  const entries = p["entries"] as J[];
  const diags = (p["changedRootsDiagnostics"] ?? []) as J[];
  const written = new Set<string>();
  const read = new Set<string>();
  const events = new Set<string>();
  let commits = 0;
  let prod = 0;
  let unresolved = 0;
  for (const e of entries) {
    unresolved += ((e["unresolved"] ?? []) as unknown[]).length;
    const anchor = ((e["routine"] as J)["anchor"] ?? {}) as J;
    if (String(anchor["file"] ?? "").startsWith(`ws:${TEST_APP}/`)) continue;
    prod++;
    for (const x of (e["effects"] ?? []) as J[]) {
      const t = x["type"] as string;
      const what = String(
        (x["detail"] as J | undefined)?.["resourceDisplay"] ?? "",
      );
      if (WRITES.has(t)) written.add(what);
      else if (t.startsWith("DB_")) read.add(what);
      else if (t === "EVENT_PUBLISH") events.add(what);
      else if (t === "COMMIT") commits++;
    }
  }
  const sorted = (s: Set<string>) => [...s].sort();
  return {
    roots: entries.length,
    production_roots: prod,
    tables_written: sorted(written),
    tables_read: sorted(read).filter((t) => !written.has(t)),
    events_published: sorted(events),
    commits,
    unresolved,
    unmapped_hunks: diags.filter((d) => d["kind"] === "hunk-outside-routines")
      .length,
    unmatched_files: diags.filter((d) => d["kind"] === "diff-file-unmatched")
      .length,
  };
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
  alsem_new_findings: number;
  alsem_new_high_findings: number;
  alsem_new_test_findings: number;
  complexity_delta: number;
  lines_delta: number;
  max_routine_complexity: number;
  routines_added: number;
  routines_changed: number;
  abi_changes: number;
  schema_changes: number;
  event_changes: number;
  permission_changes: number;
  tables_written: number;
  events_published: number;
  unmapped_hunks: number;
}

/** One execution's al-sem metrics; production code (not the Test app) only. */
export function alsemSummary(x: {
  introduced: (AlsemFinding & { count: number })[];
  deltas: RoutineDelta[];
  blast: { production: BlastSide; test: BlastSide };
  touches: DigestTouches;
}): AlsemMetrics {
  const prod = x.introduced.filter((f) => f.app !== TEST_APP);
  const sum = (fs: { count: number }[]) => fs.reduce((s, f) => s + f.count, 0);
  const d = x.deltas.filter((r) => r.app !== TEST_APP);
  const live = d.filter((r) => r.status !== "removed");
  return {
    alsem_new_findings: sum(prod),
    alsem_new_high_findings: sum(
      prod.filter((f) => f.severity === "critical" || f.severity === "high"),
    ),
    alsem_new_test_findings: sum(
      x.introduced.filter((f) => f.app === TEST_APP),
    ),
    complexity_delta: d.reduce((s, r) => s + r.d_complexity, 0),
    lines_delta: d.reduce((s, r) => s + r.d_lines, 0),
    max_routine_complexity: Math.max(0, ...live.map((r) => r.complexity)),
    routines_added: d.filter((r) => r.status === "added").length,
    routines_changed: d.filter((r) => r.status === "changed").length,
    abi_changes: x.blast.production.abi,
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
    throw new Error(
      `${cmd} ${args.join(" ")}: ${new TextDecoder().decode(o.stderr)}`,
    );
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

/** refapp at the task's pinned commit plus the task overlay at `rev`, built once per task. */
async function startingTree(
  repo: string,
  rev: string,
  taskId: string,
  refappCommit: string,
  cache: string,
): Promise<string> {
  const dir = join(cache, taskId);
  const done = join(cache, `${taskId}.done`);
  if (await Deno.stat(done).then(() => true, () => false)) return dir;
  await Deno.remove(dir, { recursive: true }).catch(() => {});
  await Deno.mkdir(dir, { recursive: true });
  const at = await loadTaskAt(repo, taskId, rev, join(cache, "tasks"));
  const tar = join(cache, `${taskId}-refapp.tar`);
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
  await Deno.writeTextFile(done, "");
  return dir;
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
}

/** Temp file in the same folder, then rename: a killed run leaves a `.tmp-` file, never a half-written target. */
export async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp-${Deno.pid}-${crypto.randomUUID().slice(0, 8)}`;
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
      s.hash === stamp.hash
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

interface AlsemTools {
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
}

interface AlsemTree {
  findings: AlsemFinding[];
  metrics: RoutineMetric[];
  apps: Record<string, string>;
  testRanges: [number, number][];
  fingerprint: string;
  touches: DigestTouches | null;
  diagnostics: unknown[];
}

/**
 * The tree as one al-sem workspace (mergedAppJson) with the locked symbol
 * packages hard-linked into .alpackages; sources keep their relative paths,
 * so the campaign's patches apply as they are.
 */
async function mergedWorkspace(src: string, dst: string, t: AlsemTools) {
  await Deno.remove(dst, { recursive: true }).catch(() => {});
  const apps: J[] = [];
  const texts: { path: string; text: string }[] = [];
  for (const rel of [...await sourceFiles(src)].sort()) {
    const text = await Deno.readTextFile(join(src, ...rel.split("/")));
    if (rel.split("/").length === 2 && basename(rel) === "app.json") {
      apps.push(JSON.parse(text.replace(/^﻿/, "")) as J);
      continue;
    }
    const to = join(dst, ...rel.split("/"));
    await Deno.mkdir(join(to, ".."), { recursive: true });
    await Deno.writeTextFile(to, text);
    texts.push({ path: rel, text });
  }
  await Deno.writeTextFile(
    join(dst, "app.json"),
    JSON.stringify(mergedAppJson(apps), null, 2),
  );
  const pk = join(dst, ".alpackages");
  await Deno.mkdir(pk);
  for (const p of t.lock) {
    await Deno.link(join(t.store, `${p.sha256}.app`), join(pk, p.file));
  }
  const test = apps.find((a) => a["name"] === "CGR Test");
  return {
    apps: objectApps(texts),
    testRanges: ((test?.["idRanges"] ?? []) as { from: number; to: number }[])
      .map((r) => [r.from, r.to] as [number, number]),
  };
}

/** Analyze, metrics and fingerprint for one tree (and digest when a patch is given), cached by key. */
async function alsemTree(
  t: AlsemTools,
  src: string,
  key: string,
  patch: string | null,
): Promise<AlsemTree> {
  const cache = join(t.cache, key);
  const done = join(cache, "tree.json");
  const hit = await readJsonOr(done);
  if (hit) return hit as unknown as AlsemTree;
  await Deno.mkdir(cache, { recursive: true });
  const ws = join(t.dir, "ws", key);
  const { apps, testRanges } = await mergedWorkspace(src, ws, t);
  try {
    const analyze = JSON.parse(
      await run(t.alsem, [
        "analyze",
        ws,
        "--format",
        "json",
        "--deterministic",
        "--require-dependencies",
      ]),
    ) as J;
    const ach = JSON.parse(
      await run(t.ach, [
        "--project",
        ws,
        "--analyze",
        "--format",
        "json",
        "--no-telemetry",
      ]),
    ) as { metrics: RoutineMetric[] };
    const fingerprint = join(cache, "fingerprint.json");
    await run(t.alsem, [
      "fingerprint",
      ws,
      "--format",
      "json",
      "--deterministic",
      "--out",
      fingerprint,
    ]);
    let touches: DigestTouches | null = null;
    if (patch) {
      const diff = join(ws, "change.diff");
      await Deno.writeTextFile(
        diff,
        patch.replace(/^--- start\//gm, "--- a/").replace(
          /^\+\+\+ final\//gm,
          "+++ b/",
        ),
      );
      const digest = await run(t.alsem, [
        "digest",
        ws,
        "--diff",
        diff,
        "--format",
        "json",
        "--deterministic",
      ]);
      await writeAtomic(join(cache, "digest.json"), digest);
      touches = digestTouches(JSON.parse(digest));
    }
    await writeAtomic(join(cache, "analyze.json"), JSON.stringify(analyze));
    const tree: AlsemTree = {
      findings: alsemFindings(analyze),
      metrics: ach.metrics,
      apps,
      testRanges,
      fingerprint,
      touches,
      diagnostics: (analyze["diagnostics"] ?? []) as unknown[],
    };
    await writeAtomic(done, JSON.stringify(tree));
    return tree;
  } finally {
    await Deno.remove(ws, { recursive: true }).catch(() => {});
  }
}

interface AlsemRow {
  id: string;
  arm: string;
  task: string;
  repeat: number;
  verdict: string | null;
  metrics: AlsemMetrics;
  introduced: (AlsemFinding & { count: number })[];
  deltas: RoutineDelta[];
  blast: { production: BlastSide; test: BlastSide };
  touches: DigestTouches;
  diagnostics: unknown[];
}

const METRIC_KEYS: (keyof AlsemMetrics)[] = [
  "alsem_new_findings",
  "alsem_new_high_findings",
  "alsem_new_test_findings",
  "complexity_delta",
  "lines_delta",
  "max_routine_complexity",
  "routines_added",
  "routines_changed",
  "abi_changes",
  "schema_changes",
  "event_changes",
  "permission_changes",
  "tables_written",
  "events_published",
  "unmapped_hunks",
];

async function sha256File(p: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", await Deno.readFile(p));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function pool<T>(n: number, items: T[], f: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await f(items[i++]!);
    }),
  );
}

async function alsemStep(
  t: AlsemTools,
  rows: Row[],
  results: string,
  hashOf: Map<string, string>,
  startOf: (task: string) => Promise<string>,
  pairs: [string, string][],
  jobs: number,
) {
  const starts = new Map<string, Promise<AlsemTree>>();
  const startTree = (task: string) => {
    if (!starts.has(task)) {
      starts.set(
        task,
        startOf(task).then((dir) => alsemTree(t, dir, `start-${task}`, null)),
      );
    }
    return starts.get(task)!;
  };
  const todo = rows.filter((r) => hashOf.has(r.id));
  const execDir = join(t.cache, "exec");
  await Deno.mkdir(execDir, { recursive: true });
  const stampOf = (id: string): DoneStamp => ({
    build: t.build,
    rev: t.rev,
    hash: hashOf.get(id)!,
  });
  let n = 0;
  let skipped = 0;
  await pool(jobs, todo, async (r) => {
    const hash = hashOf.get(r.id)!;
    if (await readDone(execDir, r.id, stampOf(r.id))) {
      skipped++;
      return;
    }
    try {
      const s = await startTree(r.task);
      const f = await alsemTree(
        t,
        join(results, "workspaces", hash),
        hash,
        r.patch ?? "",
      );
      const diffOut = join(t.cache, hash, `diff-${r.task}.json`);
      if (!await Deno.stat(diffOut).then(() => true, () => false)) {
        const tmp = `${diffOut}.tmp-${Deno.pid}`;
        await run(t.alsem, [
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
      }
      const introduced = introducedFindings(s.findings, f.findings);
      const deltas = routineDeltas(s.metrics, f.metrics, {
        ...s.apps,
        ...f.apps,
      });
      const blast = blastRadius(await readJson(diffOut), f.testRanges);
      const touches = f.touches!;
      const row: AlsemRow = {
        id: r.id,
        arm: r.arm,
        task: r.task,
        repeat: r.repeat,
        verdict: r.verdict,
        metrics: alsemSummary({ introduced, deltas, blast, touches }),
        introduced,
        deltas,
        blast,
        touches,
        diagnostics: [...s.diagnostics, ...f.diagnostics],
      };
      // Written last and atomically: only a complete row marks the execution done.
      await writeDone(execDir, r.id, stampOf(r.id), row);
    } catch (err) {
      console.error(`[WARN] alsem ${r.id}: ${(err as Error).message}`);
    }
    if (++n % 10 === 0) console.error(`[alsem] ${n}/${todo.length}`);
  });
  // Everything done for this build, this run's and earlier runs'; failures are absent.
  const byId = new Map(todo.map((r) => [r.id, r]));
  const out = (await loadDone<AlsemRow>(
    execDir,
    new Map(todo.map((r) => [r.id, stampOf(r.id)])),
  )).map((x) => ({ ...x, verdict: byId.get(x.id)!.verdict }));
  console.error(
    `[alsem] ${out.length}/${todo.length} done (${skipped} were done already, ${
      todo.length - out.length
    } failed)`,
  );
  await Deno.writeTextFile(
    join(t.dir, "executions.json"),
    JSON.stringify(out, null, 1),
  );
  await Deno.writeTextFile(
    join(t.dir, "executions.csv"),
    csv(out.map((r) => ({
      id: r.id,
      arm: r.arm,
      task: r.task,
      repeat: r.repeat,
      verdict: r.verdict,
      ...r.metrics,
    }))),
  );
  await Deno.writeTextFile(
    join(t.dir, "introduced.csv"),
    csv(
      out.flatMap((r) =>
        r.introduced.map((f) => ({
          execution: r.id,
          arm: r.arm,
          task: r.task,
          ...f,
        }))
      ),
    ),
  );
  const agg = (rs: AlsemRow[]) => ({
    executions: rs.length,
    median: Object.fromEntries(
      METRIC_KEYS.map((k) => [k, median(rs.map((r) => r.metrics[k]))]),
    ),
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
      median_diff: Object.fromEntries(
        METRIC_KEYS.map((k) => [
          k,
          median(ps.map(([a, x]) => x.metrics[k] - a.metrics[k])),
        ]),
      ),
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

function csv(rows: Record<string, unknown>[]): string {
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
    ],
    collect: ["pair"],
    default: { repo: ".", "alsem-jobs": "3" },
  });
  const campaignId = String(args._[0] ?? "");
  if (
    !campaignId || !args.results || !args.rev || !args.out ||
    (args.alsem && (!args.ach || !args.symbols))
  ) {
    console.error(
      "usage: analyze-campaign.ts <campaign-id> --results <dir> --rev <task rev> --out <dir> [--pair base:variant ...] [--repo .]\n" +
        "  [--alsem <alsem binary> --ach <al-call-hierarchy binary> --symbols <symbol store> [--alsem-jobs 3]]",
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

  // Latest attempt per cell.
  const execDir = join(results, "executions", campaignId);
  const cells = new Map<string, J>();
  for await (const f of Deno.readDir(execDir)) {
    if (!f.name.endsWith(".json")) continue;
    const e = await readJson(join(execDir, f.name));
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
      const start = await startingTree(
        repo,
        args.rev,
        task,
        refappOf.get(task)!,
        cache,
      );
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
    await Deno.writeTextFile(
      join(dir, "tools.json"),
      JSON.stringify(
        {
          alsem: {
            path: t.alsem,
            version: (await run(t.alsem, ["--version"])).trim(),
            sha256: alsemSha,
          },
          al_call_hierarchy: { path: t.ach, sha256: achSha },
          cache: t.cache,
          symbols: { store: t.store, packages: t.lock.length, rev: args.rev },
          workspace:
            "one synthetic app per tree (mergedAppJson); analyze --require-dependencies",
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
      (task) => startingTree(repo, args.rev!, task, refappOf.get(task)!, cache),
      pairs,
      Number(args["alsem-jobs"]),
    );
  }
}

if (import.meta.main) await main();
