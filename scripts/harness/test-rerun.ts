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
  type AlsemEvidence,
  alsemExclusion,
  csv,
  type DoneStamp,
  inTestApp,
  newOrChangedTestProcs,
  pool,
  readDone,
  type Row,
  sha256Hex,
  type StartTree,
  testProcKey,
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
 * 5: [Test] declarations are matched with quoted-identifier contents masked, so a quoted
 * name cannot pose as a declaration.
 * 6: the cache is bound to the environment (containers + BC build + symbol lock) and the
 * recorded identity is checked on reuse; a test's attributes are part of its change
 * fingerprint; preprocessor directive lines are blanked for structure and left out of the
 * comparison.
 * 7: attribute whitespace is dropped only outside '...' strings; whole directive lines
 * (quoted labels included) are blanked in the comparison text.
 * 8: only lines the lexer reads as directives are blanked (a `#` line inside a block
 * comment is comment text).
 * 9: the agent's tests are chosen from the al-sem evidence of the same build (ach
 * test_quality of both trees + the digest's changed roots, as the A-03b selection), not
 * from AL text; the attribute fingerprint is a narrow check on the tool-listed set; the
 * stamp binds the al-sem build and the evidence used.
 * 10: the narrow attribute check locates attributes from the tool's own path and
 * `procedure` line (inline text plus the attribute / blank / comment / directive lines
 * directly above), not via the codeunit scanner, and lexes them with comments dropped and
 * strings kept; a missing file or line fails the execution.
 * 11: the attribute block is collected lexically: the `procedure` keyword is found in the
 * masked text (comments, strings, directive lines blank) on the tool's line, then complete
 * `[...]` groups before it are bracket-matched across lines and comments, each fingerprinted
 * from its raw span. The shipped expectations and the codeunit requests come from the tools'
 * start-tree Test procedures for every task kind (evidence required for every execution; the
 * text codeunit scanner no longer decides the shipped suite). al-sem's own DERIVATION is part
 * of the evidence binding.
 */
export const TEST_RERUN_DERIVATION = 11;

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

export interface RunnerEnv {
  containers: { name: string; bc_version: string }[];
  /** sha256 of the symbol lock (the locked package list and hashes compiled against). */
  symbols: string;
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
  /**
   * The environment a run would execute in, asked BEFORE any run: the admitted
   * containers with their BC build (`bc_version`) and a sha256 of the symbol lock.
   */
  env(): Promise<RunnerEnv>;
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

// Matched on text whose quoted-identifier contents are masked (quotes kept), so a
// quoted name cannot pose as a declaration; a quoted procedure name is read from
// the raw text at the group's offsets (the `d` flag).
// Group 1 is the run of attributes right before `procedure` (before and after [Test]).
const PROC_ATTRS =
  /((?:\[[^\]]*\]\s*)+)(?:local\s+|internal\s+)?procedure\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*\(/dgi;
const IS_TEST_ATTR = /\[\s*Test\s*\]/i;
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
/** An attribute with whitespace dropped outside '...' strings (kept inside: 'H  One' is not 'H One') and its name lowercased. */
function normAttr(a: string): string {
  let out = "";
  let inStr = false;
  for (const ch of a) {
    if (ch === "'") inStr = !inStr; // a doubled '' toggles twice
    if (!inStr && /\s/.test(ch)) continue;
    out += ch;
  }
  return out.replace(/^[^(\]]*/, (n) => n.toLowerCase());
}

async function testBodies(
  dir: string,
): Promise<Map<string, { name: string; attrs: string; body: string }>> {
  const out = new Map<
    string,
    { name: string; attrs: string; body: string }
  >();
  for (const c of await testCodeunits(dir)) {
    const raw = await Deno.readTextFile(join(dir, c.file));
    // Directive lines (`#region Case checks`) are blanked for structure, so a label
    // cannot open a `case`, and left out of the comparison text.
    const masked = stripAlNoise(raw, { directives: true });
    const src = withoutDirectiveLines(raw);
    // Quoted identifiers blanked too: "End Date" must not close a block.
    const blanked = masked.replace(/"[^"\n]*"/g, (q) => " ".repeat(q.length));
    const span = codeunitSpans(blanked).get(c.codeunit);
    if (!span) continue;
    const [start, end] = span;
    // Quoted identifiers keep their quotes but not their contents.
    const qSlice = masked.slice(start, end).replace(
      /"[^"\n]*"/g,
      (q) => `"${"x".repeat(q.length - 2)}"`,
    );
    const bSlice = blanked.slice(start, end);
    const rSlice = src.slice(start, end);
    for (const m of qSlice.matchAll(PROC_ATTRS)) {
      if (!IS_TEST_ATTR.test(m[1]!)) continue;
      const [from1, to1] = m.indices![2] ?? [0, 0];
      const name = m[2] !== undefined ? rSlice.slice(from1, to1) : m[3]!;
      const from = m.index! + m[0].length;
      // Each attribute from the raw text at its structural offsets (string arguments
      // kept): name case-insensitive, order-insensitive, see normAttr for whitespace.
      const [a0] = m.indices![1]!;
      const attrs = [...m[1]!.matchAll(/\[[^\]]*\]/g)].map((a) =>
        normAttr(rSlice.slice(a0 + a.index!, a0 + a.index! + a[0].length))
      ).sort();
      out.set(`${c.codeunit}|${name.toLowerCase()}`, {
        name,
        attrs: attrs.join(""),
        body: normalizeAlBody(
          rSlice.slice(from, procedureEnd(bSlice, from)),
        ),
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
  const fp = (v: { attrs: string; body: string } | undefined) =>
    v && v.attrs + "\0" + v.body;
  return [...f].filter(([k, v]) => fp(s.get(k)) !== fp(v)).map(([k, v]) => ({
    codeunit: Number(k.split("|")[0]),
    procedure: v.name,
  })).sort((a, b) =>
    a.codeunit - b.codeunit || a.procedure.localeCompare(b.procedure)
  );
}

/**
 * The top-level `[...]` attribute groups of `text`, normalized and sorted: `'...'` strings
 * kept verbatim (`''` is an escaped quote), `//` and `/* *\/` comments and whitespace
 * outside strings dropped, the group name lowercased. A comment is recognised only outside
 * a string, so an apostrophe in a comment opens nothing. Directive lines are the caller's.
 */
export function attrFingerprint(text: string): string {
  const groups: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "'") {
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] !== "'") continue;
        if (text[j + 1] === "'") j++;
        else break;
      }
      if (depth > 0) cur += text.slice(i, j + 1);
      i = j;
    } else if (text.startsWith("//", i)) {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (/\s/.test(ch)) continue;
    else if (ch === "[") {
      if (depth++ > 0) cur += ch;
    } else if (ch === "]" && depth > 0) {
      if (--depth > 0) cur += ch;
      else {
        groups.push(
          `[${cur.replace(/^[^(]*/, (n) => n.toLowerCase())}]`,
        );
        cur = "";
      }
    } else if (depth > 0) cur += ch;
  }
  return groups.sort().join("");
}

/** `raw` with every line the lexer reads as a directive blanked whole (comments and strings kept); offsets kept. */
function withoutDirectiveLines(raw: string): string {
  const masked = stripAlNoise(raw, { directives: true });
  // Without directives: true a directive line survives, so a line differing between the two
  // is one; a `#` line inside a block comment is comment text and stays, so its `*/` survives.
  const plain = stripAlNoise(raw);
  let at = 0;
  return raw.split("\n").map((line) => {
    const from = at;
    at += line.length + 1;
    return plain.slice(from, at - 1) !== masked.slice(from, at - 1)
      ? " ".repeat(line.length)
      : line;
  }).join("\n");
}

/** One Test file lexed once: the raw text, the masked copy (same offsets) and the raw text without directive lines. */
interface Lexed {
  raw: string;
  /** Comments, string contents, quoted identifiers and directive lines blanked; `[ ] ( )` kept. */
  masked: string;
  clean: string;
}

const lexAl = (raw: string): Lexed => ({
  raw,
  masked: stripAlNoise(raw, { directives: true }).replace(
    /"[^"\n]*"/g,
    (q) => " ".repeat(q.length),
  ),
  clean: withoutDirectiveLines(raw),
});

/**
 * The attribute fingerprint of the procedure whose `procedure` keyword is on the tool's
 * `line`: the keyword is found in the masked text within that line (a comment or string
 * holding the word is blank there), then the complete `[...]` groups before it, past an
 * optional `local`/`internal`/`protected` modifier, are collected by bracket matching in the
 * masked text (nesting and any number of lines; comments and directive lines are blank), up
 * to the first non-blank character that does not end a group. Each group is fingerprinted
 * from its raw span. Throws when the line or keyword is missing or a group is unbalanced
 * (never "unchanged").
 */
function procAttrFingerprint(file: string, lx: Lexed, line: number) {
  let from = 0;
  for (let i = 1; i < line && from >= 0; i++) {
    const nl = lx.raw.indexOf("\n", from);
    from = nl < 0 ? -1 : nl + 1;
  }
  const to = from < 0 ? -1 : lx.raw.indexOf("\n", from);
  const m = from < 0 || line < 1
    ? null
    : /\bprocedure\b/i.exec(lx.masked.slice(from, to < 0 ? undefined : to));
  if (!m) throw new Error(`no procedure keyword at ${file}:${line}`);
  let p = from + m.index;
  const blank = () => {
    while (p > 0 && /\s/.test(lx.masked[p - 1]!)) p--;
  };
  blank();
  const mod = /(?<![A-Za-z0-9_])(?:local|internal|protected)$/i.exec(
    lx.masked.slice(Math.max(0, p - 20), p),
  );
  if (mod) {
    p -= mod[0].length;
    blank();
  }
  const groups: string[] = [];
  while (p > 0 && lx.masked[p - 1] === "]") {
    let depth = 0;
    let q = p - 1;
    for (; q >= 0; q--) {
      const c = lx.masked[q];
      if (c === "]") depth++;
      else if (c === "[" && --depth === 0) break;
    }
    if (q < 0) throw new Error(`unbalanced attribute before ${file}:${line}`);
    groups.push(attrFingerprint(lx.clean.slice(q, p)));
    p = q;
    blank();
  }
  return groups.sort().join("");
}

/**
 * Attribute fingerprints of the Test-app procedures the tools list in BOTH trees, keyed by
 * the tool key (routine_id ?? path:line) so start and final pair as newOrChangedTestProcs
 * pairs them. Located from the tool's own `path` (tree-relative) and `line`.
 */
export async function evidenceAttrs(
  ev: AlsemEvidence,
  startRoot: string,
  finalRoot: string,
): Promise<{ start: Map<string, string>; final: Map<string, string> }> {
  const both = new Set(
    ev.start.filter(inTestApp).map(testProcKey),
  );
  const read = async (root: string, ps: AlsemEvidence["start"]) => {
    const files = new Map<string, Lexed>();
    const out = new Map<string, string>();
    for (const p of ps.filter(inTestApp)) {
      const k = testProcKey(p);
      if (!both.has(k)) continue;
      const file = join(root, ...p.path.split("/"));
      if (!files.has(file)) {
        files.set(file, lexAl(await Deno.readTextFile(file)));
      }
      out.set(k, procAttrFingerprint(file, files.get(file)!, p.line));
    }
    return out;
  };
  const finalKeys = new Set(ev.final.filter(inTestApp).map(testProcKey));
  for (const k of both) if (!finalKeys.has(k)) both.delete(k);
  return {
    start: await read(startRoot, ev.start),
    final: await read(finalRoot, ev.final),
  };
}

/** The codeunit number of a tool-listed procedure's object (`<app>/Codeunit/<id>`), else null. */
function codeunitOf(p: AlsemEvidence["start"][number]): number | null {
  const m = /^[^/]+\/Codeunit\/(\d+)$/.exec(p.object_stable_id);
  return m ? Number(m[1]) : null;
}

/**
 * Every Test-app procedure the tools list in a tree as (codeunit, procedure), deduplicated,
 * sorted. The shipped suite is exactly the start tree's list: expectations and codeunit
 * requests alike, so no text scanner can drop a codeunit. A procedure outside a Codeunit fails.
 */
export function evidenceProcs(ps: AlsemEvidence["start"]): Selected[] {
  const out = new Map<string, Selected>();
  for (const p of ps.filter(inTestApp)) {
    const cu = codeunitOf(p);
    if (cu === null) {
      throw new Error(
        `test procedure ${p.procedure_name} is not in a Codeunit: ${p.object_stable_id}`,
      );
    }
    out.set(keyOf(cu, p.procedure_name), {
      codeunit: cu,
      procedure: p.procedure_name,
    });
  }
  return [...out.values()].sort((a, b) =>
    a.codeunit - b.codeunit || a.procedure.localeCompare(b.procedure)
  );
}

/**
 * Q-04b: the agent's tests chosen by the tools. Every procedure ach lists in the
 * final Test app that is new or changed (newOrChangedTestProcs: routine_id, the
 * digest's changed roots) is selected as (codeunit number, procedure name). The tools
 * expose no attributes, so a narrow text check is added: a procedure the tools list in
 * both trees (same tool key) whose attribute fingerprint (`attrs`, by tool key, from
 * evidenceAttrs) differs. The text never discovers procedures and never decides body changes.
 */
export function selectFromEvidence(
  ev: AlsemEvidence,
  attrs: { start: Map<string, string>; final: Map<string, string> },
): Selected[] {
  const picked = new Set(newOrChangedTestProcs(
    ev.start,
    ev.final,
    new Set(ev.changed),
  ));
  const inStart = new Set(ev.start.filter(inTestApp).map(testProcKey));
  const out = new Map<string, Selected>();
  for (const p of ev.final.filter(inTestApp)) {
    const cu = codeunitOf(p);
    const k = cu === null ? "" : keyOf(cu, p.procedure_name);
    const tk = testProcKey(p);
    if (
      !picked.has(p) &&
      !(inStart.has(tk) && cu !== null &&
        attrs.start.has(tk) && attrs.final.has(tk) &&
        attrs.start.get(tk) !== attrs.final.get(tk))
    ) continue;
    if (cu === null) {
      throw new Error(
        `selected test procedure ${p.procedure_name} is not in a Codeunit: ${p.object_stable_id}`,
      );
    }
    out.set(k, { codeunit: cu, procedure: p.procedure_name });
  }
  return [...out.values()].sort((a, b) =>
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
  /** Per execution id: the al-sem evidence of `alsemBuild` (only executions with a done, valid al-sem row). */
  alsemEvidence: Map<string, AlsemEvidence>;
  /** Identity of the al-sem build of this invocation (both tool sha256). */
  alsemBuild: string;
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
  /**
   * The environment a run would execute in, asked once before any lookup. App package
   * identity is not compiled before the lookup: the packages are a function of the
   * sources (start id, workspace hash: bound below), the compiler (the BC build) and
   * the symbol lock, and the last two are bound here.
   */
  const env = await o.runner.env();
  const containers = [...env.containers].sort((a, b) =>
    a.name.localeCompare(b.name) || a.bc_version.localeCompare(b.bc_version)
  );
  const envHash = await sha256Hex(
    JSON.stringify({ symbols: env.symbols, containers }),
  );
  const inEnv = (i: RunnerIdentity) =>
    containers.some((c) =>
      c.name === i.container && c.bc_version === i.bc_version
    );
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
    // Every kind needs the al-sem evidence of this very build: the agent's tests (bugfix) and
    // the shipped suite (all kinds) come from it, never from text.
    const ev = o.alsemEvidence.get(r.id);
    if (!ev || ev.build !== o.alsemBuild) {
      throw new Error("no al-sem evidence of the same build");
    }
    const selected = r.kind === "bugfix"
      ? selectFromEvidence(ev, await evidenceAttrs(ev, start.dir, finalDir))
      : [];
    // The evidence fields the selection reads (not the assert counts), bound with the build.
    const proj = (ps: AlsemEvidence["start"]) =>
      ps.map((p) => [
        p.path,
        p.line,
        p.object_stable_id,
        p.procedure_name,
        p.routine_id,
      ]);
    const evidenceBind = await sha256Hex(JSON.stringify([
      ev.build,
      ev.derivation,
      proj(ev.start),
      proj(ev.final),
      [...ev.changed].sort(),
    ]));
    const shipped = evidenceProcs(ev.start);
    const edited = await editedShippedTests(sTest, fTest);
    const stamp: DoneStamp = {
      build: o.runner.id,
      rev: o.rev,
      hash,
      derive,
      bind: {
        inputs: await sha256Hex(
          JSON.stringify([
            start.id,
            hash,
            r.kind,
            selected,
            shipped,
            edited,
            envHash,
            evidenceBind,
          ]),
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
      // the recorded container and BC build must still be a current one
      const recorded = [
        row.identity.agent_vs_start,
        row.identity.shipped_vs_final,
      ];
      if (recorded.some((i) => i !== null && !inEnv(i))) return null;
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
      for (const i of [agentRun?.identity, shippedRun.identity]) {
        if (i && !inEnv(i)) {
          throw new Error(
            `runner identity ${i.container} (${i.bc_version}) is not in its own env()`,
          );
        }
      }
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
    if (!row) {
      // fail closed: a row that cannot be read back is listed, never silently dropped
      if (!failed.some((f) => f.id === id)) {
        failed.push({ id, error: "row not readable after the run" });
      }
      continue;
    }
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
