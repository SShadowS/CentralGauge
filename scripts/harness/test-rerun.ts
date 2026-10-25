/**
 * Q-04 phase A: two extra test runs per execution on the oracle publish+test path.
 *
 * 1. agent-tests-vs-start (bugfix tasks): the START production apps and the
 *    agent's final Test app; only the agent's new or changed [Test] procedures
 *    are scored. At least one failing procedure means the tests pin the bug.
 * 2. shipped-tests-vs-final: the FINAL production apps and the ORIGINAL start
 *    Test app; every test is scored.
 *
 * The container work is behind the injected `TestRerunRunner` (phase B builds
 * the production adapter over buildVerdictWorkspace / prepareApps /
 * lane.exclusive(deployAndTest)); this module is pure logic, validation, the
 * per-execution cache and the aggregation. Fail closed: an infra row, a
 * not_run row, a missing selected procedure or any unknown shape throws, the
 * execution is listed under `failed` and no row is written (a retry recomputes).
 */
import { join } from "@std/path";
import {
  alsemExclusion,
  csv,
  type DoneStamp,
  pool,
  readDone,
  type Row,
  sha256Hex,
  type StartTree,
  writeAtomic,
  writeDone,
} from "./analyze-campaign.ts";
import { isTaskBuildArtifact } from "../../src/harness/hash.ts";
import {
  normalizeAlBody,
  stripAlNoise,
  TEST_APP,
  testCodeunits,
} from "../../src/harness/verdict-workspace.ts";

/**
 * Bump when a row is computed differently from the same runner output, or validation tightens.
 * 1: phase A. 2: a test body ends at its own closing end; (a global var section after a
 * procedure was part of its body, so cached selections differ).
 * 3: selection per enclosing codeunit on comment-stripped source; runner rows fail closed on
 * any infra / not_run / duplicate row; cached rows must be justified by their procedures.
 * 4: codeunits are attributed by brace-depth-0 declarations on stripped text (same-line
 * headers, split headers, Codeunit.Run(...) calls); cached rows are reused only when their
 * procedure keys and outcome class match the current expectation.
 */
export const TEST_RERUN_DERIVATION = 4;

/** Runner contract (aligned with bc-lane TestSpec / TestRow / DeployTestResult). */
export interface TestSpec {
  codeunit: number;
  /** null = every test of the codeunit. */
  procedures: string[] | null;
}

export interface RunnerRow {
  codeunit: number;
  procedure: string;
  outcome: "pass" | "fail" | "not_run";
  failure: "assertion" | "runtime_error" | "compile" | "infra" | null;
  message: string | null;
}

export interface RunnerIdentity {
  /** App name -> sha256 of the published production app. */
  production_apps: Record<string, string>;
  test_app: string;
  container: string;
  bc_version: string;
}

export interface RunnerResult {
  compile: { ok: boolean; diagnostics: string[] };
  identity: RunnerIdentity;
  rows: RunnerRow[];
}

export interface TestRerunRequest {
  executionId: string;
  /** The task's start tree: the app graph baseline of both runs. */
  start: string;
  /** Tree directory (`<dir>/<app>/...`) that supplies the production apps. */
  production: string;
  /** Tree directory whose `Test` app is published. */
  test: string;
  specs: TestSpec[];
}

export interface TestRerunRunner {
  /** Runner identity: names the cache folder (harness commit + oracle runner). */
  id: string;
  run(req: TestRerunRequest): Promise<RunnerResult>;
  /** Releases the environment the runner opened (bench lock, leases). */
  close?(): Promise<void>;
}

// ---------------------------------------------------------------- row types

export interface ProcResult {
  codeunit: number;
  procedure: string;
  outcome: "pass" | "fail";
  failure: "assertion" | "runtime_error" | null;
  message: string | null;
}

export interface Selected {
  codeunit: number;
  procedure: string;
}

export type AgentOutcome = "catches" | "misses" | "not_applicable" | "no_tests";
export type ShippedStatus = "pass" | "fail" | "compile_fail";

export interface AgentVsStart {
  outcome: AgentOutcome;
  /** not_applicable only: "compile", "feature" or the task kind. */
  reason?: string;
  selected: Selected[];
  procedures: ProcResult[];
  diagnostics?: string[];
}

export interface ShippedVsFinal {
  status: ShippedStatus;
  procedures: ProcResult[];
  shipped_pass: boolean;
  edited_shipped_tests: boolean;
  shipped_fail_after_edit: boolean;
}

export interface TestRerunRow {
  id: string;
  arm: string;
  task: string;
  repeat: number;
  kind: string;
  agent_vs_start: AgentVsStart;
  shipped_vs_final: ShippedVsFinal;
  identity: {
    agent_vs_start: RunnerIdentity | null;
    shipped_vs_final: RunnerIdentity;
  };
}

/** A loaded row plus the fields the aggregates read. */
export type TestRerunDone = TestRerunRow & {
  verdict: string | null;
  excluded: string | null;
};

// ---------------------------------------------------------------- validation

type J = Record<string, unknown>;

function obj(x: unknown, what: string): J {
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    throw new Error(`${what}: not an object`);
  }
  return x as J;
}
const str = (x: unknown, what: string): string => {
  if (typeof x !== "string") throw new Error(`${what}: not a string`);
  return x;
};
const int = (x: unknown, what: string): number => {
  if (!Number.isInteger(x)) throw new Error(`${what}: not an integer`);
  return x as number;
};
const bool = (x: unknown, what: string): boolean => {
  if (typeof x !== "boolean") throw new Error(`${what}: not a boolean`);
  return x;
};
const arr = (x: unknown, what: string): unknown[] => {
  if (!Array.isArray(x)) throw new Error(`${what}: not an array`);
  return x;
};
const oneOf = <T extends string>(
  x: unknown,
  set: readonly T[],
  what: string,
) => {
  if (!set.includes(x as T)) {
    throw new Error(`${what}: unknown value ${JSON.stringify(x)}`);
  }
  return x as T;
};
const strOrNull = (x: unknown, what: string) =>
  x === null ? null : str(x, what);

function identityOf(x: unknown, what: string): RunnerIdentity {
  const o = obj(x, what);
  const apps = obj(o["production_apps"], `${what}.production_apps`);
  for (const [k, v] of Object.entries(apps)) {
    str(v, `${what}.production_apps.${k}`);
  }
  return {
    production_apps: apps as Record<string, string>,
    test_app: str(o["test_app"], `${what}.test_app`),
    container: str(o["container"], `${what}.container`),
    bc_version: str(o["bc_version"], `${what}.bc_version`),
  };
}

/** Strict check of what a runner returned; unknown outcome / failure / field type throws. */
export function validateRunnerResult(x: unknown): RunnerResult {
  const o = obj(x, "runner result");
  const c = obj(o["compile"], "compile");
  const diagnostics = arr(c["diagnostics"], "compile.diagnostics").map((d, i) =>
    str(d, `compile.diagnostics[${i}]`)
  );
  const rows = arr(o["rows"], "rows").map((r, i): RunnerRow => {
    const w = `rows[${i}]`;
    const ro = obj(r, w);
    return {
      codeunit: int(ro["codeunit"], `${w}.codeunit`),
      procedure: str(ro["procedure"], `${w}.procedure`),
      outcome: oneOf(
        ro["outcome"],
        ["pass", "fail", "not_run"],
        `${w}.outcome`,
      ),
      failure: ro["failure"] === null ? null : oneOf(
        ro["failure"],
        ["assertion", "runtime_error", "compile", "infra"] as const,
        `${w}.failure`,
      ),
      message: strOrNull(ro["message"], `${w}.message`),
    };
  });
  return {
    compile: { ok: bool(c["ok"], "compile.ok"), diagnostics },
    identity: identityOf(o["identity"], "identity"),
    rows,
  };
}

function procResult(x: unknown, w: string): ProcResult {
  const o = obj(x, w);
  const outcome = oneOf(o["outcome"], ["pass", "fail"], `${w}.outcome`);
  const failure = o["failure"] === null
    ? null
    : oneOf(o["failure"], ["assertion", "runtime_error"], `${w}.failure`);
  if ((outcome === "pass") !== (failure === null)) {
    throw new Error(`${w}: outcome ${outcome} with failure ${failure}`);
  }
  return {
    codeunit: int(o["codeunit"], `${w}.codeunit`),
    procedure: str(o["procedure"], `${w}.procedure`),
    outcome,
    failure,
    message: strOrNull(o["message"], `${w}.message`),
  };
}

/** Strict check of a stored row; a malformed row is never read as a zero. */
export function validateTestRerunRow(x: unknown): TestRerunRow {
  const o = obj(x, "row");
  const a = obj(o["agent_vs_start"], "agent_vs_start");
  const outcome = oneOf(
    a["outcome"],
    ["catches", "misses", "not_applicable", "no_tests"],
    "agent_vs_start.outcome",
  );
  const procedures = arr(a["procedures"], "agent_vs_start.procedures").map((
    p,
    i,
  ) => procResult(p, `agent_vs_start.procedures[${i}]`));
  const selected = arr(a["selected"], "agent_vs_start.selected").map((s, i) => {
    const so = obj(s, `agent_vs_start.selected[${i}]`);
    return {
      codeunit: int(so["codeunit"], "selected.codeunit"),
      procedure: str(so["procedure"], "selected.procedure"),
    };
  });
  const agent: AgentVsStart = { outcome, selected, procedures };
  if (a["reason"] !== undefined) agent.reason = str(a["reason"], "reason");
  if (outcome === "not_applicable" && agent.reason === undefined) {
    throw new Error("agent_vs_start: not_applicable without a reason");
  }
  if (a["diagnostics"] !== undefined) {
    agent.diagnostics = arr(a["diagnostics"], "diagnostics").map((d) =>
      str(d, "diagnostics[]")
    );
  }
  const failed = procedures.some((p) => p.outcome === "fail");
  const keys = (xs: Selected[]) =>
    xs.map((x) => keyOf(x.codeunit, x.procedure)).sort();
  const same = (a: Selected[], b: Selected[]) =>
    JSON.stringify(keys(a)) === JSON.stringify(keys(b));
  if (outcome === "catches" || outcome === "misses") {
    if (procedures.length === 0 || !same(selected, procedures)) {
      throw new Error(
        `agent_vs_start: ${outcome} procedures differ from selected`,
      );
    }
    if (outcome === "catches" && !failed) {
      throw new Error("agent_vs_start: catches without a failing procedure");
    }
    if (outcome === "misses" && failed) {
      throw new Error("agent_vs_start: misses needs passing procedures only");
    }
  } else if (procedures.length > 0) {
    throw new Error(`agent_vs_start: ${outcome} with procedure results`);
  } else if (
    (outcome === "no_tests" ||
      (outcome === "not_applicable" && agent.reason !== "compile")) &&
    selected.length > 0
  ) {
    throw new Error(`agent_vs_start: ${outcome} with selected procedures`);
  }
  const s = obj(o["shipped_vs_final"], "shipped_vs_final");
  const status = oneOf(
    s["status"],
    ["pass", "fail", "compile_fail"],
    "shipped_vs_final.status",
  );
  const sprocs = arr(s["procedures"], "shipped_vs_final.procedures").map((
    p,
    i,
  ) => procResult(p, `shipped_vs_final.procedures[${i}]`));
  const shipped: ShippedVsFinal = {
    status,
    procedures: sprocs,
    shipped_pass: bool(s["shipped_pass"], "shipped_pass"),
    edited_shipped_tests: bool(
      s["edited_shipped_tests"],
      "edited_shipped_tests",
    ),
    shipped_fail_after_edit: bool(
      s["shipped_fail_after_edit"],
      "shipped_fail_after_edit",
    ),
  };
  if (new Set(keys(sprocs)).size !== sprocs.length) {
    throw new Error("shipped_vs_final: duplicate procedure results");
  }
  const sfail = sprocs.some((p) => p.outcome === "fail");
  if (
    (status === "pass" && (sprocs.length === 0 || sfail)) ||
    (status === "fail" && !sfail) ||
    (status === "compile_fail" && sprocs.length > 0)
  ) {
    throw new Error(`shipped_vs_final: procedures do not justify ${status}`);
  }
  if (shipped.shipped_pass !== (status === "pass")) {
    throw new Error("shipped_vs_final: shipped_pass disagrees with status");
  }
  if (
    shipped.shipped_fail_after_edit !==
      (shipped.edited_shipped_tests && !shipped.shipped_pass)
  ) {
    throw new Error("shipped_vs_final: shipped_fail_after_edit inconsistent");
  }
  const id = obj(o["identity"], "identity");
  return {
    id: str(o["id"], "id"),
    arm: str(o["arm"], "arm"),
    task: str(o["task"], "task"),
    repeat: int(o["repeat"], "repeat"),
    kind: str(o["kind"], "kind"),
    agent_vs_start: agent,
    shipped_vs_final: shipped,
    identity: {
      agent_vs_start: id["agent_vs_start"] === null
        ? null
        : identityOf(id["agent_vs_start"], "identity.agent_vs_start"),
      shipped_vs_final: identityOf(
        id["shipped_vs_final"],
        "identity.shipped_vs_final",
      ),
    },
  };
}

// ---------------------------------------------------------------- selection

const TEST_PROC =
  /\[\s*Test\s*\]\s*(?:\[[^\]]*\]\s*)*(?:local\s+|internal\s+)?procedure\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*\(/gi;
const BLOCK_WORD = /\b(begin|case|end)\b/gi;

/**
 * Offset just after the `end` that closes the procedure whose parameter list
 * starts at `from` (begin/case open a block, end closes one), in comment- and
 * string-stripped text. A procedure without a closing end runs to the end.
 */
function procedureEnd(stripped: string, from: number): number {
  let depth = 0;
  BLOCK_WORD.lastIndex = from;
  for (let m; (m = BLOCK_WORD.exec(stripped));) {
    if (m[1]!.toLowerCase() === "end") {
      if (--depth === 0) return m.index + m[0].length;
    } else depth++;
  }
  return stripped.length;
}

const CODEUNIT_DECL = /\bcodeunit\s+(\d+)/gi;

/**
 * Codeunit declarations at brace depth 0 of stripped text (quoted identifiers
 * blanked), each with the offset span of its braced body. Anywhere deeper, `codeunit`
 * is a variable type or `Codeunit.Run(...)`, never an object.
 */
function codeunitSpans(blanked: string): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  let depth = 0;
  let at = 0;
  for (const m of blanked.matchAll(CODEUNIT_DECL)) {
    for (; at < m.index!; at++) {
      if (blanked[at] === "{") depth++;
      else if (blanked[at] === "}") depth = Math.max(0, depth - 1);
    }
    if (depth !== 0) continue;
    let end = blanked.indexOf("{", m.index!);
    if (end < 0) end = blanked.length;
    else {
      for (let d = 0; end < blanked.length; end++) {
        if (blanked[end] === "{") d++;
        else if (blanked[end] === "}" && --d === 0) {
          end++;
          break;
        }
      }
    }
    if (!out.has(Number(m[1]))) out.set(Number(m[1]), [m.index!, end]);
  }
  return out;
}

/**
 * `codeunit|procedure` (lowercase) -> display name + normalized body, for every
 * [Test] procedure of the Test app. A body runs from the parameter list to the
 * procedure's own closing `end;`, so a global var section or anything else
 * between procedures is not part of it. Declarations are found on comment- and
 * string-stripped text (same offsets as the raw text, so the body is the raw span,
 * which normalizeAlBody strips of comments), and each procedure belongs to the
 * codeunit declaration that encloses it.
 */
async function testBodies(
  dir: string,
): Promise<Map<string, { name: string; body: string }>> {
  const out = new Map<string, { name: string; body: string }>();
  for (const c of await testCodeunits(dir)) {
    const src = await Deno.readTextFile(join(dir, c.file));
    const masked = stripAlNoise(src);
    // Quoted identifiers blanked too: "End Date" must not close a block.
    const blanked = masked.replace(/"[^"\n]*"/g, (q) => " ".repeat(q.length));
    const span = codeunitSpans(blanked).get(c.codeunit);
    if (!span) continue;
    const [start, end] = span;
    const mSlice = masked.slice(start, end);
    const bSlice = blanked.slice(start, end);
    const rSlice = src.slice(start, end);
    for (const m of mSlice.matchAll(TEST_PROC)) {
      const name = m[1] ?? m[2]!;
      const from = m.index! + m[0].length;
      out.set(`${c.codeunit}|${name.toLowerCase()}`, {
        name,
        body: normalizeAlBody(rSlice.slice(from, procedureEnd(bSlice, from))),
      });
    }
  }
  return out;
}

/** The agent's new (absent from the start Test app) or changed (normalized body differs) [Test] procedures. */
export async function selectAgentTests(
  startTestDir: string,
  finalTestDir: string,
): Promise<Selected[]> {
  const [s, f] = await Promise.all([
    testBodies(startTestDir),
    testBodies(finalTestDir),
  ]);
  return [...f].filter(([k, v]) => s.get(k)?.body !== v.body).map(([k, v]) => ({
    codeunit: Number(k.split("|")[0]),
    procedure: v.name,
  })).sort((a, b) =>
    a.codeunit - b.codeunit || a.procedure.localeCompare(b.procedure)
  );
}

async function filesOf(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, rel: string) => {
    for await (const e of Deno.readDir(dir)) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (isTaskBuildArtifact(r)) continue;
      if (e.isDirectory) await walk(join(dir, e.name), r);
      else if (e.isFile) out.push(r);
    }
  };
  await walk(root, "");
  return out.sort();
}

const textOf = async (p: string) =>
  new TextDecoder().decode(await Deno.readFile(p)).replaceAll("\r\n", "\n");

/** A start Test file changed (line endings ignored) or deleted in the final tree. Added files do not count. */
export async function editedShippedTests(
  startTestDir: string,
  finalTestDir: string,
): Promise<boolean> {
  for (const rel of await filesOf(startTestDir)) {
    const f = join(finalTestDir, ...rel.split("/"));
    const there = await Deno.stat(f).then((s) => s.isFile, () => false);
    if (!there) return true;
    if (
      await textOf(join(startTestDir, ...rel.split("/"))) !== await textOf(f)
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- classification

const MESSAGE_MAX = 2000;
const keyOf = (codeunit: number, procedure: string) =>
  `${codeunit}|${procedure.toLowerCase()}`;

/**
 * The result row of every wanted procedure; anything but a clean pass / fail throws.
 * Every row of the result is checked, wanted or not: a not_run / infra / compile row
 * or a duplicate key fails the run. `exact`: a row outside `wanted` fails too (the
 * shipped run); otherwise extra pass / fail rows are ignored (the agent run).
 */
function scored(
  wanted: Selected[],
  res: RunnerResult,
  what: string,
  exact: boolean,
): ProcResult[] {
  const byKey = new Map<string, RunnerRow>();
  for (const r of res.rows) {
    const k = keyOf(r.codeunit, r.procedure);
    const name = `${what} ${r.codeunit}.${r.procedure}`;
    if (byKey.has(k)) throw new Error(`${name}: duplicate row`);
    byKey.set(k, r);
    if (r.outcome === "not_run") throw new Error(`${name}: not_run`);
    if (r.failure === "infra" || r.failure === "compile") {
      throw new Error(`${name}: ${r.failure} failure (${r.message ?? ""})`);
    }
    if ((r.outcome === "pass") !== (r.failure === null)) {
      throw new Error(
        `${name}: outcome ${r.outcome} with failure ${r.failure}`,
      );
    }
  }
  if (exact) {
    const want = new Set(wanted.map((w) => keyOf(w.codeunit, w.procedure)));
    for (const [k, r] of byKey) {
      if (!want.has(k)) {
        throw new Error(
          `${what} ${r.codeunit}.${r.procedure}: not an expected procedure`,
        );
      }
    }
  }
  return wanted.map((w) => {
    const r = byKey.get(keyOf(w.codeunit, w.procedure));
    const name = `${what} ${w.codeunit}.${w.procedure}`;
    if (!r) throw new Error(`${name}: missing from the runner result`);
    return {
      codeunit: r.codeunit,
      procedure: r.procedure,
      outcome: r.outcome as ProcResult["outcome"],
      failure: r.failure as ProcResult["failure"],
      message: r.message === null ? null : r.message.slice(0, MESSAGE_MAX),
    };
  });
}

export function classifyAgentVsStart(
  x: { kind: string; selected: Selected[]; result: RunnerResult | null },
): AgentVsStart {
  if (x.kind !== "bugfix") {
    return {
      outcome: "not_applicable",
      reason: x.kind,
      selected: [],
      procedures: [],
    };
  }
  if (x.selected.length === 0) {
    return { outcome: "no_tests", selected: [], procedures: [] };
  }
  if (!x.result) throw new Error("agent run: no runner result");
  if (!x.result.compile.ok) {
    return {
      outcome: "not_applicable",
      reason: "compile",
      selected: x.selected,
      procedures: [],
      diagnostics: x.result.compile.diagnostics,
    };
  }
  const procedures = scored(x.selected, x.result, "agent run", false);
  return {
    outcome: procedures.some((p) => p.outcome === "fail")
      ? "catches"
      : "misses",
    selected: x.selected,
    procedures,
  };
}

export function classifyShippedVsFinal(
  x: { result: RunnerResult; expected: Selected[]; edited: boolean },
): ShippedVsFinal {
  const done = (status: ShippedStatus, procedures: ProcResult[]) => ({
    status,
    procedures,
    shipped_pass: status === "pass",
    edited_shipped_tests: x.edited,
    shipped_fail_after_edit: x.edited && status !== "pass",
  });
  if (!x.result.compile.ok) return done("compile_fail", []);
  if (x.expected.length === 0) {
    throw new Error("shipped run: no test procedures");
  }
  const procedures = scored(x.expected, x.result, "shipped run", true);
  return done(
    procedures.every((p) => p.outcome === "pass") ? "pass" : "fail",
    procedures,
  );
}

// ---------------------------------------------------------------- aggregation

const share = (n: number, d: number) => d === 0 ? null : n / d;

/** Shares and counts over executions. not_applicable stays its own count (na_compile / na_kind), never a 0. */
export function testRerunAgg(rs: TestRerunRow[]) {
  const n = (f: (r: TestRerunRow) => boolean) => rs.filter(f).length;
  const o = (r: TestRerunRow) => r.agent_vs_start;
  const catches = n((r) => o(r).outcome === "catches");
  const misses = n((r) => o(r).outcome === "misses");
  const no_tests = n((r) => o(r).outcome === "no_tests");
  const na_compile = n((r) =>
    o(r).outcome === "not_applicable" && o(r).reason === "compile"
  );
  const na_kind = n((r) =>
    o(r).outcome === "not_applicable" && o(r).reason !== "compile"
  );
  const bugfix_executions = catches + misses + no_tests + na_compile;
  const shipped_pass = n((r) => r.shipped_vs_final.status === "pass");
  return {
    executions: rs.length,
    bugfix_executions,
    catches,
    misses,
    no_tests,
    na_compile,
    na_kind,
    tests_catch_bug_share: share(catches, catches + misses),
    tests_catch_bug_share_all: share(catches, bugfix_executions),
    shipped_executions: rs.length,
    shipped_pass,
    shipped_pass_share: share(shipped_pass, rs.length),
    shipped_compile_fail: n((r) =>
      r.shipped_vs_final.status === "compile_fail"
    ),
    edited_shipped_tests: n((r) => r.shipped_vs_final.edited_shipped_tests),
    shipped_fail_after_edit: n((r) =>
      r.shipped_vs_final.shipped_fail_after_edit
    ),
  };
}

/** Matched pairs (`base[i]` pairs with `variant[i]`). */
export function testRerunPair(base: TestRerunRow[], variant: TestRerunRow[]) {
  const catches = (r: TestRerunRow) => r.agent_vs_start.outcome === "catches";
  return {
    pairs: base.length,
    base: testRerunAgg(base),
    variant: testRerunAgg(variant),
    variant_catches_base_not:
      base.filter((b, i) => catches(variant[i]!) && !catches(b)).length,
    base_catches_variant_not:
      base.filter((b, i) => catches(b) && !catches(variant[i]!)).length,
  };
}

// ---------------------------------------------------------------- step

export async function testRerunStep(o: {
  runner: TestRerunRunner;
  rows: Row[];
  /** Results folder: final workspaces are `<results>/workspaces/<hash>`. */
  results: string;
  hashOf: Map<string, string>;
  startOf: (task: string) => Promise<StartTree>;
  pairs: [string, string][];
  jobs: number;
  /** Output folder (`<out>/test-rerun`). */
  dir: string;
  rev: string;
  derivation?: number | undefined;
}): Promise<{
  failed: { id: string; error: string }[];
  done: TestRerunDone[];
  skipped: number;
}> {
  const derive = o.derivation ?? TEST_RERUN_DERIVATION;
  const execDir = join(
    o.dir,
    "cache",
    o.runner.id.replace(/[^A-Za-z0-9._-]/g, "_"),
    "exec",
  );
  await Deno.mkdir(execDir, { recursive: true });
  const todo = o.rows.filter((r) => o.hashOf.has(r.id));
  const starts = new Map<string, Promise<StartTree>>();
  const startOnce = (task: string) => {
    if (!starts.has(task)) starts.set(task, o.startOf(task));
    return starts.get(task)!;
  };
  /** Everything the row is computed from; the stamp binds to its sha256. */
  const inputs = async (r: Row) => {
    const hash = o.hashOf.get(r.id)!;
    const start = await startOnce(r.task);
    const finalDir = join(o.results, "workspaces", hash);
    const sTest = join(start.dir, TEST_APP);
    const fTest = join(finalDir, TEST_APP);
    const selected = r.kind === "bugfix"
      ? await selectAgentTests(sTest, fTest)
      : [];
    const shipped = (await testCodeunits(sTest)).flatMap((c) =>
      c.procedures.map((procedure) => ({ codeunit: c.codeunit, procedure }))
    );
    const edited = await editedShippedTests(sTest, fTest);
    const stamp: DoneStamp = {
      build: o.runner.id,
      rev: o.rev,
      hash,
      derive,
      bind: {
        inputs: await sha256Hex(
          JSON.stringify([start.id, hash, r.kind, selected, shipped, edited]),
        ),
      },
    };
    return { start, finalDir, selected, shipped, edited, stamp };
  };
  type Expect = {
    stamp: DoneStamp;
    kind: string;
    selected: Selected[];
    shipped: Selected[];
  };
  const readPrior = async (id: string, x: Expect) => {
    const prior = await readDone<unknown>(execDir, id, x.stamp);
    if (prior === null) return null;
    try {
      const row = validateTestRerunRow(prior);
      // self-consistent is not enough: it must be the current expectation
      const a = row.agent_vs_start;
      const s = row.shipped_vs_final;
      const sameKeys = (p: Selected[], q: Selected[]) =>
        JSON.stringify(p.map((e) => keyOf(e.codeunit, e.procedure)).sort()) ===
          JSON.stringify(q.map((e) => keyOf(e.codeunit, e.procedure)).sort());
      const agentOk = x.kind !== "bugfix"
        ? a.outcome === "not_applicable" && a.reason === x.kind &&
          a.selected.length === 0
        : x.selected.length === 0
        ? a.outcome === "no_tests"
        : a.outcome !== "no_tests" &&
          (a.outcome !== "not_applicable" || a.reason === "compile") &&
          sameKeys(a.selected, x.selected);
      if (
        row.kind !== x.kind || !agentOk ||
        (s.status !== "compile_fail" && !sameKeys(s.procedures, x.shipped))
      ) return null;
      return row;
    } catch {
      return null; // a malformed stored row is recomputed, never read
    }
  };
  let skipped = 0;
  const failed: { id: string; error: string }[] = [];
  const stamps = new Map<string, Expect>();
  await pool(o.jobs, todo, async (r) => {
    try {
      const x = await inputs(r);
      stamps.set(r.id, { ...x, kind: r.kind });
      if (await readPrior(r.id, stamps.get(r.id)!)) {
        skipped++;
        return;
      }
      const specs: TestSpec[] = [];
      for (const s of x.selected) {
        const sp = specs.find((q) => q.codeunit === s.codeunit);
        if (sp) sp.procedures!.push(s.procedure);
        else specs.push({ codeunit: s.codeunit, procedures: [s.procedure] });
      }
      const agentRun = r.kind === "bugfix" && x.selected.length > 0
        ? validateRunnerResult(
          await o.runner.run({
            executionId: r.id,
            start: x.start.dir,
            production: x.start.dir,
            test: x.finalDir,
            specs,
          }),
        )
        : null;
      const shippedRun = validateRunnerResult(
        await o.runner.run({
          executionId: r.id,
          start: x.start.dir,
          production: x.finalDir,
          test: x.start.dir,
          specs: [...new Set(x.shipped.map((p) => p.codeunit))].map((
            codeunit,
          ) => ({ codeunit, procedures: null })),
        }),
      );
      const row: TestRerunRow = {
        id: r.id,
        arm: r.arm,
        task: r.task,
        repeat: r.repeat,
        kind: r.kind,
        agent_vs_start: classifyAgentVsStart({
          kind: r.kind,
          selected: x.selected,
          result: agentRun,
        }),
        shipped_vs_final: classifyShippedVsFinal({
          result: shippedRun,
          expected: x.shipped,
          edited: x.edited,
        }),
        identity: {
          agent_vs_start: agentRun?.identity ?? null,
          shipped_vs_final: shippedRun.identity,
        },
      };
      validateTestRerunRow(row);
      // Written last and atomically: only a complete, valid row marks the execution done.
      await writeDone(execDir, r.id, x.stamp, row);
    } catch (err) {
      const error = (err as Error).message;
      failed.push({ id: r.id, error });
      console.error(`[WARN] test-rerun ${r.id}: ${error}`);
    }
  });
  const byId = new Map(todo.map((r) => [r.id, r]));
  const all: TestRerunDone[] = [];
  for (const id of [...stamps.keys()].sort()) {
    const row = await readPrior(id, stamps.get(id)!);
    if (!row) continue;
    const src = byId.get(id)!;
    all.push({
      ...row,
      verdict: src.verdict,
      excluded: alsemExclusion(src.termination),
    });
  }
  const excluded = all.filter((r) => r.excluded);
  const out = all.filter((r) => !r.excluded); // aggregates read this
  const flat = (r: TestRerunDone) => ({
    id: r.id,
    arm: r.arm,
    task: r.task,
    repeat: r.repeat,
    kind: r.kind,
    verdict: r.verdict,
    excluded: r.excluded ?? "",
    agent_outcome: r.agent_vs_start.outcome,
    agent_reason: r.agent_vs_start.reason ?? "",
    agent_selected: r.agent_vs_start.selected.length,
    agent_failed:
      r.agent_vs_start.procedures.filter((p) => p.outcome === "fail").length,
    shipped_status: r.shipped_vs_final.status,
    shipped_pass: r.shipped_vs_final.shipped_pass,
    edited_shipped_tests: r.shipped_vs_final.edited_shipped_tests,
    shipped_fail_after_edit: r.shipped_vs_final.shipped_fail_after_edit,
  });
  const arms = [...new Set(out.map((r) => r.arm))].sort();
  const byCell = new Map(out.map((r) => [`${r.arm}|${r.task}|${r.repeat}`, r]));
  const perPair = o.pairs.map(([b, v]) => {
    const matched = out.filter((r) => r.arm === b).flatMap((a) => {
      const x = byCell.get(`${v}|${a.task}|${a.repeat}`);
      return x ? [[a, x] as const] : [];
    });
    const cmp = (ps: (readonly [TestRerunDone, TestRerunDone])[]) =>
      testRerunPair(ps.map(([a]) => a), ps.map(([, x]) => x));
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
  await Deno.mkdir(o.dir, { recursive: true });
  await writeAtomic(
    join(o.dir, "executions.json"),
    JSON.stringify(all, null, 1),
  );
  await writeAtomic(join(o.dir, "executions.csv"), csv(all.map(flat)));
  await writeAtomic(
    join(o.dir, "summary.json"),
    JSON.stringify(
      {
        failed,
        excluded: excluded.map((r) => ({
          id: r.id,
          arm: r.arm,
          task: r.task,
          repeat: r.repeat,
          reason: r.excluded,
        })),
        per_arm: Object.fromEntries(
          arms.map((a) => [a, testRerunAgg(out.filter((r) => r.arm === a))]),
        ),
        per_arm_passing: Object.fromEntries(
          arms.map((a) => [
            a,
            testRerunAgg(
              out.filter((r) => r.arm === a && r.verdict === "pass"),
            ),
          ]),
        ),
        per_pair: perPair,
      },
      null,
      1,
    ),
  );
  console.error(
    `[OK] test-rerun: ${out.length} of ${todo.length} executions (${skipped} were done already, ${failed.length} failed, ${excluded.length} excluded) -> ${o.dir}`,
  );
  return { failed, done: all, skipped };
}
