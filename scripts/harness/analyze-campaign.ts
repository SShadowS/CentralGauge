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
    string: ["results", "rev", "out", "repo", "pair"],
    collect: ["pair"],
    default: { repo: "." },
  });
  const campaignId = String(args._[0] ?? "");
  if (!campaignId || !args.results || !args.rev || !args.out) {
    console.error(
      "usage: analyze-campaign.ts <campaign-id> --results <dir> --rev <task rev> --out <dir> [--pair base:variant ...] [--repo .]",
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
}

if (import.meta.main) await main();
