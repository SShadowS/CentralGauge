/**
 * Exploratory measures (spec v2 sections 6 and 8.6): final-code check,
 * reuse, partial credit. NOT scorers: never in SCORER_SUITE or the verdict.
 * Immutable side files results/harness/measures/<judgment>/<fingerprint>.json,
 * bound to the artifact, judgment, oracle and analyzer identities. Each
 * measure is ok, not_applicable or missing (missing is never a zero).
 */

import { basename, dirname, join, resolve } from "@std/path";
import { z } from "zod";
import type { AnalysisSettings } from "../container/types.ts";
import { ValidationError } from "../errors.ts";
import { type BcLane, buildApps, type LockedSymbols } from "./bc-lane.ts";
import { type JudgmentRecord, publishOnce, readRecord } from "./records.ts";
import { readAppJson, type StagedApp } from "./staging.ts";
import type { HarnessTask, LoadedTask } from "./task.ts";
import { judge, type JudgeInput } from "./verdict.ts";
import { safeCopyTree } from "./fsutil.ts";
import { hashJson } from "./hash.ts";
import { Sha256Hex } from "./identity.ts";
import { readYaml } from "./yaml.ts";

export const MEASURE_SUITE: Record<string, string> = {
  final_code: "1",
  reuse: "1",
  partial_credit: "1",
};
export function measureFingerprint(): Promise<string> {
  return hashJson({ measure_versions: MEASURE_SUITE });
}

const ProcKey = z.string().regex(/^8\d{4}\/[A-Za-z_][A-Za-z0-9_]*$/);
/** Appendix section 7: measurement-only fixtures are `fixture/<name>` (folder `fixture/<name>/`). */
export const VARIANT =
  /^(correct|reference-tests|naive\/[A-Za-z0-9_-]+|fixture\/[A-Za-z0-9_-]+)$/;

export const ReuseTargetSchema = z.strictObject({
  codeunit: z.number().int().positive(),
  procedure: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  /** As declared, e.g. "(Amount: Decimal): Decimal"; compared without whitespace, case-insensitive. */
  signature: z.string().min(2),
  /** Workspace-relative file holding the codeunit in the pristine workspace. */
  file: z.string().min(1),
  /** AL statements for a non-throwing wrong result (the effectiveness probe). */
  perturb: z.string().min(1),
});
export type ReuseTarget = z.output<typeof ReuseTargetSchema>;

export const TaskMeasuresSchema = z.strictObject({
  v: z.literal(1),
  partial_credit: z.strictObject({
    weights: z.record(ProcKey, z.number().positive())
      .refine((w) => Object.keys(w).length > 0, "at least one weight")
      // partialCredit divides by the total: it must not overflow.
      .refine(
        (w) => Number.isFinite(Object.values(w).reduce((a, b) => a + b, 0)),
        "weight total must be finite",
      ),
    // A duplicate would count twice in the preservation share.
    hidden_regressions: z.array(ProcKey).default([])
      .refine((h) => new Set(h).size === h.length, "duplicate entry"),
  }).nullable().default(null),
  reuse: z.strictObject({
    /** The spec-named procedure first, then accepted alternatives. */
    targets: z.array(ReuseTargetSchema).min(1),
    tests: z.array(z.strictObject({
      codeunit: z.number().int().min(85000).max(89999),
      procedures: z.array(z.string().min(1)).min(1),
    })).min(1),
  }).nullable().default(null),
  expect: z.record(
    z.string().regex(VARIANT),
    z.strictObject({
      reuse_executed: z.boolean().optional(),
      reuse: z.boolean().optional(),
      partial_credit: z.number().min(0).max(1).optional(),
      final_errors: z.number().int().min(0).optional(),
      /** Codes whose count must increase over the starting workspace. */
      new_warning_codes: z.array(z.string()).optional(),
    }),
  ).default({}),
});
export type TaskMeasures = z.output<typeof TaskMeasuresSchema>;

export async function loadTaskMeasures(
  t: LoadedTask,
): Promise<TaskMeasures | null> {
  const path = join(t.dir, "measures", "measures.yml");
  try {
    await Deno.stat(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  const m = await readYaml(path, TaskMeasuresSchema);
  const errors: string[] = [];
  const f2p = new Set(
    (t.task.fail_to_pass?.tests ?? []).flatMap((x) =>
      x.procedures.map((p) => `${x.codeunit}/${p}`)
    ),
  );
  if (m.partial_credit) {
    if (t.task.kind === "test-authoring") {
      errors.push("partial_credit is not defined for test-authoring");
    }
    const w = new Set(Object.keys(m.partial_credit.weights));
    const h = new Set(m.partial_credit.hidden_regressions);
    for (const k of w) {
      if (h.has(k)) {
        errors.push(`${k} is both weighted and a hidden regression`);
      }
    }
    for (const k of f2p) {
      if (!w.has(k) && !h.has(k)) {
        errors.push(`no weight or hidden-regression entry for ${k}`);
      }
    }
    for (const k of [...w, ...h]) {
      if (!f2p.has(k)) errors.push(`${k} is not a fail_to_pass procedure`);
    }
  }
  for (const x of m.reuse?.tests ?? []) {
    for (const p of x.procedures) {
      if (!f2p.has(`${x.codeunit}/${p}`)) {
        errors.push(
          `reuse test ${x.codeunit}/${p} is not a fail_to_pass procedure`,
        );
      }
    }
  }
  if (errors.length > 0) {
    throw new ValidationError(`${path}:\n  ${errors.join("\n  ")}`, errors);
  }
  return m;
}

export type Measure<T> =
  | { status: "ok"; value: T }
  | { status: "not_applicable"; reason: string }
  | { status: "missing"; reason: string };
export const ok = <T>(value: T): Measure<T> => ({ status: "ok", value });
export const na = <T>(reason: string): Measure<T> => ({
  status: "not_applicable",
  reason,
});
export const missing = <T>(reason: string): Measure<T> => ({
  status: "missing",
  reason,
});

export interface PartialCredit {
  new_requirements: number;
  /** Share of hidden-regression rows passed; null when the task has none. */
  hidden_regressions: number | null;
  /** Share of declared pass_to_pass procedures passed; null when none declared. */
  pass_to_pass: number | null;
}

type Scorer = JudgmentRecord["scorers"][number];

/** Passed keys when every key has exactly one candidate row, else null (incomplete). */
function passedRows(s: Scorer, keys: string[]): Set<string> | null {
  const by = new Map<string, Scorer["tests"]>();
  for (const t of s.tests.filter((x) => x.target === "candidate")) {
    const k = `${t.codeunit}/${t.procedure}`;
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  if (!keys.every((k) => by.get(k)?.length === 1)) return null;
  return new Set(keys.filter((k) => by.get(k)![0]!.outcome === "pass"));
}

export function partialCredit(
  task: HarnessTask,
  m: TaskMeasures | null,
  j: JudgmentRecord,
): Measure<PartialCredit> {
  if (task.kind === "test-authoring") return na("kind test-authoring");
  if (!m?.partial_credit) return na("no frozen weights");
  const s = (n: string) => j.scorers.find((x) => x.name === n);
  const build = s("build");
  const f2p = s("fail_to_pass");
  const p2p = s("pass_to_pass");
  const declared = task.pass_to_pass.flatMap((r) =>
    r.procedures.map((p) => `${r.codeunit}/${p}`)
  );
  if (!build || !f2p || (declared.length > 0 && !p2p)) {
    return missing("required scorer absent");
  }
  if (j.scorers.some((x) => x.passed === null)) {
    return missing("unscored judgment (infra)");
  }
  const hidden = m.partial_credit.hidden_regressions;
  const share = (keys: string[], pass: Set<string>) =>
    keys.length === 0
      ? null
      : keys.filter((k) => pass.has(k)).length / keys.length;
  if (build.passed === false) {
    return ok({
      new_requirements: 0,
      hidden_regressions: share(hidden, new Set()),
      pass_to_pass: share(declared, new Set()),
    });
  }
  const weights = Object.entries(m.partial_credit.weights);
  const passF = passedRows(f2p, [...weights.map(([k]) => k), ...hidden]);
  const passP = declared.length === 0
    ? new Set<string>()
    : passedRows(p2p!, declared);
  if (passF === null || passP === null) {
    return missing("incomplete oracle rows");
  }
  const total = weights.reduce((n, [, w]) => n + w, 0);
  return ok({
    new_requirements: weights.reduce((n, [k, w]) =>
      n + (passF.has(k) ? w : 0), 0) / total,
    hidden_regressions: share(hidden, passF),
    pass_to_pass: share(declared, passP),
  });
}

const measure = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("ok"), value }),
    z.strictObject({
      status: z.literal("not_applicable"),
      reason: z.string().min(1),
    }),
    z.strictObject({ status: z.literal("missing"), reason: z.string().min(1) }),
  ]);

export const AnalyzersSchema = z.strictObject({
  /** harnessCompilerIdentity: artifact URL plus pinned BCH version (analyzers ship with the compiler). */
  compiler: z.string().min(1),
  ruleset_sha256: Sha256Hex,
  /** Codes the canary produced in this run; must include the frozen expected codes. */
  canary_codes: z.array(z.string()),
});

export const FinalCodeSchema = z.strictObject({
  errors: z.number().int().min(0),
  /** null when any app was skipped or failed (analyzer output incomplete). */
  warnings: z.number().int().min(0).nullable(),
  start_errors: z.number().int().min(0),
  start_warnings: z.number().int().min(0),
  new_warnings: z.number().int().min(0).nullable(),
  /** Per code: final minus start, only codes that increased. */
  new_warning_codes: z.record(z.string(), z.number().int().positive()),
  complete: z.boolean(),
  incomplete_apps: z.array(z.string()),
});
export type FinalCode = z.output<typeof FinalCodeSchema>;

export const ReuseSchema = z.strictObject({
  executed: z.boolean(),
  effective: z.boolean(),
  via: z.string().nullable(),
});

export const MeasureRecordSchema = z.strictObject({
  v: z.literal(1),
  judgment_id: z.uuid(),
  execution_id: z.uuid(),
  task_id: z.string(),
  workspace_hash: Sha256Hex,
  oracle_hash: Sha256Hex,
  measure_fingerprint: Sha256Hex,
  analyzers: AnalyzersSchema.nullable(),
  final_code: measure(FinalCodeSchema),
  reuse: measure(ReuseSchema),
  partial_credit: measure(z.strictObject({
    new_requirements: z.number().min(0).max(1),
    hidden_regressions: z.number().min(0).max(1).nullable(),
    pass_to_pass: z.number().min(0).max(1).nullable(),
  })),
});
export type MeasureRecord = z.output<typeof MeasureRecordSchema>;

const recordPath = (root: string, judgmentId: string, fp: string) =>
  join(root, "measures", judgmentId, `${fp}.json`);

export async function writeMeasureRecord(
  resultsRoot: string,
  r: MeasureRecord,
): Promise<void> {
  const p = MeasureRecordSchema.parse(r);
  // Synced temp file hard-linked to the final name: never partial, never replaced.
  await publishOnce(
    recordPath(resultsRoot, p.judgment_id, p.measure_fingerprint),
    p,
  );
}

export async function readMeasureRecord(
  resultsRoot: string,
  judgmentId: string,
  fingerprint: string,
): Promise<MeasureRecord | null> {
  if (
    !z.uuid().safeParse(judgmentId).success ||
    !Sha256Hex.safeParse(fingerprint).success
  ) return null;
  try {
    // Pinned to its location: a copied or moved record is refused.
    return await readRecord(
      resultsRoot,
      recordPath(resultsRoot, judgmentId, fingerprint),
      MeasureRecordSchema,
      { judgment_id: judgmentId, measure_fingerprint: fingerprint },
    );
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

export const REUSE_MARKER = "CG-REUSE-PROBE";

/**
 * Same length as src: comments and string literals blanked, so indices stay
 * valid. A lexer, not a regex: a "quoted identifier" (e.g. "Owner's") is its
 * own state, so its apostrophe never opens a string that hides a comment.
 * A quoted identifier is one line: unterminated or multi-line, the lexer
 * cannot trust what follows, so it fails closed (null).
 */
export function maskAl(src: string): string | null {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    let end: number;
    if (c === "/" && n === "/") {
      end = src.indexOf("\n", i);
      if (end < 0) end = src.length;
      out += blank(src.slice(i, end));
    } else if (c === "/" && n === "*") {
      end = src.indexOf("*/", i + 2);
      end = end < 0 ? src.length : end + 2;
      out += blank(src.slice(i, end));
    } else if (c === "'") {
      // '' inside a string is an escaped apostrophe.
      end = i + 1;
      while (end < src.length) {
        if (src[end] !== "'") end++;
        else if (src[end + 1] === "'") end += 2;
        else {
          end++;
          break;
        }
      }
      out += blank(src.slice(i, end));
    } else if (c === '"') {
      end = src.indexOf('"', i + 1);
      if (end < 0 || src.slice(i, end).includes("\n")) return null;
      end++;
      out += src.slice(i, end);
    } else {
      end = i + 1;
      out += c;
    }
    i = end;
  }
  return out;
}
/** Quoted identifiers blanked too, for keyword scanning only. */
const maskIdents = (m: string) =>
  m.replace(/"[^"\n]*"/g, (s) => `"${" ".repeat(s.length - 2)}"`);
const norm = (s: string) =>
  s.trim().replace(/;$/, "").replace(/\s+/g, "").toLowerCase();

function bodyRange(
  m: string,
  from: number,
  limit: number,
): [number, number] | null {
  const re = /\b(begin|case|end)\b/gi;
  re.lastIndex = from;
  let depth = 0;
  let start = -1;
  for (let x = re.exec(m); x !== null && x.index < limit; x = re.exec(m)) {
    const k = x[1]!.toLowerCase();
    if (k === "end") {
      depth--;
      if (depth === 0) return [start, x.index + 3];
      if (depth < 0) return null;
    } else {
      if (depth === 0) {
        if (k !== "begin") return null;
        start = x.index;
      }
      depth++;
    }
  }
  return null;
}

/**
 * The body range of the target: located by codeunit id, procedure name AND
 * declared signature inside that codeunit's object body, with comments and
 * strings masked. Absent or ambiguous: null.
 */
export function locateProcedure(
  src: string,
  t: Pick<ReuseTarget, "codeunit" | "procedure" | "signature">,
): [number, number] | null {
  const m = maskAl(src);
  if (m === null) return null;
  const k = maskIdents(m);
  const heads = [
    ...k.matchAll(new RegExp(`\\bcodeunit\\s+${t.codeunit}\\b`, "gi")),
  ];
  if (heads.length !== 1) return null;
  const open = k.indexOf("{", heads[0]!.index!);
  if (open < 0) return null;
  let depth = 0;
  let close = -1;
  for (let i = open; i < k.length && close < 0; i++) {
    if (k[i] === "{") depth++;
    else if (k[i] === "}" && --depth === 0) close = i;
  }
  if (close < 0) return null;
  const body = m.slice(open, close);
  const hits = [
    ...body.matchAll(
      new RegExp(
        `\\bprocedure\\s+(?:"${t.procedure}"|${t.procedure})\\s*\\(`,
        "gi",
      ),
    ),
  ];
  // Overloads share the name: match each full signature, then require one.
  const matches: number[] = [];
  for (const h of hits) {
    const sig = open + h.index! + h[0].length - 1;
    // The parameter list first, so a `var` parameter is not the locals.
    let d = 0;
    let rparen = -1;
    for (let i = sig; i < close && rparen < 0; i++) {
      if (k[i] === "(") d++;
      else if (k[i] === ")" && --d === 0) rparen = i;
    }
    if (rparen < 0) continue;
    const kw = /\b(var|begin)\b/gi;
    kw.lastIndex = rparen;
    const at = kw.exec(k);
    if (!at || at.index > close) continue;
    if (norm(m.slice(sig, at.index)) === norm(t.signature)) {
      matches.push(at.index);
    }
  }
  if (matches.length !== 1) return null;
  return bodyRange(k, matches[0]!, close);
}

export function stubProcedure(
  src: string,
  t: Pick<ReuseTarget, "codeunit" | "procedure" | "signature">,
  statements: string,
): string | null {
  const r = locateProcedure(src, t);
  return r === null
    ? null
    : `${src.slice(0, r[0])}begin\n        ${statements}\n    end${
      src.slice(r[1])
    }`;
}

export interface ReuseInput {
  task: LoadedTask;
  measures: TaskMeasures;
  judgment: JudgmentRecord;
  judge: Omit<JudgeInput, "task" | "artifact" | "workDir" | "executionId">;
  artifact: string;
  workDir: string;
}

/**
 * Reuse = the target executed AND its result matters, attributed per reuse
 * test (round 2 finding 5). `executed` is a lower bound: a call whose error
 * is swallowed and whose result is ignored reads as not executed.
 */
export async function reuseCheck(
  lane: BcLane,
  o: ReuseInput,
): Promise<
  Measure<{ executed: boolean; effective: boolean; via: string | null }>
> {
  const r = o.measures.reuse;
  if (!r) return na("no reuse target");
  const wanted = r.tests.flatMap((x) =>
    x.procedures.map((p) => `${x.codeunit}/${p}`)
  );
  const f2p = o.judgment.scorers.find((s) => s.name === "fail_to_pass");
  const passing = new Set(
    (f2p?.tests ?? []).filter((t) => t.outcome === "pass").map((t) =>
      `${t.codeunit}/${t.procedure}`
    ),
  );
  if (!wanted.every((k) => passing.has(k))) {
    return missing("not evaluable: reuse tests did not pass in the judgment");
  }
  const probeTask: LoadedTask = {
    dir: o.task.dir,
    task: {
      ...o.task.task,
      scorers: ["build", "fail_to_pass"],
      pass_to_pass: [],
      fail_to_pass: {
        depends_on: o.task.task.fail_to_pass!.depends_on,
        tests: r.tests,
      },
    },
  };
  /** Per reuse test: failed under this probe, and failed with the marker. */
  type Run = { failed: Set<string>; marker: Set<string> } | {
    problem: string;
  };
  const probe = async (
    i: number,
    kind: string,
    t: ReuseTarget,
    body: string,
  ): Promise<Run | null> => {
    const art = join(o.workDir, `${kind}-${i}`);
    await safeCopyTree(o.artifact, art);
    let src: string;
    try {
      src = await Deno.readTextFile(join(art, t.file));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
    const stubbed = stubProcedure(src, t, body);
    if (stubbed === null) return null;
    await Deno.writeTextFile(join(art, t.file), stubbed);
    const { judgment, log } = await judge(lane, {
      ...o.judge,
      executionId: crypto.randomUUID(),
      task: probeTask,
      artifact: art,
      workDir: join(o.workDir, `${kind}-judge-${i}`),
    });
    if (judgment.verdict === "unscored") {
      return { problem: "infra during a reuse probe" };
    }
    if (judgment.scorers.find((s) => s.name === "build")?.passed !== true) {
      return {
        problem:
          `probe did not build (${kind} probe of ${t.codeunit}/${t.procedure})`,
      };
    }
    const rows =
      judgment.scorers.find((s) => s.name === "fail_to_pass")?.tests ?? [];
    // Each reuse test must have run exactly once: an oracle compile failure
    // or not_run row says nothing about the target.
    const ran = (k: string) => {
      const r = rows.filter((x) => `${x.codeunit}/${x.procedure}` === k);
      return r.length === 1 && (r[0]!.outcome === "pass" ||
          r[0]!.outcome === "fail")
        ? r[0]!
        : null;
    };
    const unran = wanted.filter((k) => ran(k) === null);
    if (unran.length > 0) {
      return {
        problem:
          `incomplete probe (${kind} probe of ${t.codeunit}/${t.procedure}: ${
            unran.join(", ")
          } did not run)`,
      };
    }
    const failed = new Set(wanted.filter((k) => ran(k)!.outcome === "fail"));
    const marker = new Set(
      [...failed].filter((k) =>
        log.test_messages.some((m) =>
          `${m.codeunit}/${m.procedure}` === k &&
          m.message.includes(REUSE_MARKER)
        )
      ),
    );
    return { failed, marker };
  };
  let located = 0;
  // Per reuse test, the targets that cover it (alternatives may serve different tests).
  const execBy = new Map<string, string[]>();
  const effBy = new Map<string, string[]>();
  const note = (m: Map<string, string[]>, k: string, id: string) =>
    m.set(k, [...(m.get(k) ?? []), id]);
  for (const [i, t] of r.targets.entries()) {
    const ex = await probe(i, "executed", t, `Error('${REUSE_MARKER}');`);
    if (ex === null) continue;
    located++;
    if ("problem" in ex) return missing(ex.problem);
    const ef = await probe(i, "effective", t, t.perturb);
    if (ef === null) {
      return missing(
        `target ${t.codeunit}/${t.procedure} vanished between probes`,
      );
    }
    if ("problem" in ef) return missing(ef.problem);
    const id = `${t.codeunit}/${t.procedure}`;
    for (const k of ex.marker) note(execBy, k, id);
    for (const k of ef.failed) note(effBy, k, id);
  }
  if (located === 0) {
    return missing("no reuse target located in the final workspace");
  }
  const effective = wanted.every((k) => effBy.has(k));
  // A test the perturbation changes ran the target, even if a TryFunction swallowed the marker.
  const executed = wanted.every((k) => execBy.has(k) || effBy.has(k));
  const cover = effective
    ? effBy
    : executed
    ? new Map([...execBy, ...effBy])
    : null;
  const via = cover === null
    ? null
    : [...new Set(wanted.map((k) => cover.get(k)![0]!))].join("+");
  return ok({ executed, effective, via });
}

export interface FinalCounts {
  errors: number;
  warnings: number;
  warning_codes: Record<string, number>;
  /** Apps not attempted or not built ok: their analyzer output is not trusted. */
  incomplete_apps: string[];
  compiler: string;
}

/** One CodeCop + UICop compile of a workspace (no build cache), counted. */
export function finalCodeCounts(
  lane: BcLane,
  o: {
    dir: string;
    apps: StagedApp[];
    lock: LockedSymbols;
    outDir: string;
    analysis: AnalysisSettings;
  },
): Promise<FinalCounts> {
  return lane.compile(async (c) => {
    const built = await buildApps(lane.bc, c, {
      srcDir: o.dir,
      apps: o.apps,
      versions: new Map(),
      outDir: o.outDir,
      lock: o.lock,
      analysis: o.analysis,
    });
    const warning_codes: Record<string, number> = {};
    let warnings = 0;
    for (const b of built) {
      for (const x of b.warnings ?? []) {
        warnings++;
        warning_codes[x.code] = (warning_codes[x.code] ?? 0) + 1;
      }
    }
    return {
      errors: built.reduce(
        (n, b) =>
          n + b.diagnostics.filter((d) => d.severity === "error").length,
        0,
      ),
      warnings,
      warning_codes,
      incomplete_apps: built.filter((b) => !b.attempted || !b.ok).map((b) =>
        b.folder
      ),
      compiler: await lane.bc.harnessCompilerIdentity(c),
    };
  });
}

/**
 * Final against starting workspace. Warnings only when every final app
 * built (a failed compile's analyzer output is not trusted); an incomplete
 * start or a compiler change makes the measure missing.
 */
export function finalCode(
  start: FinalCounts,
  end: FinalCounts,
): Measure<FinalCode> {
  if (start.compiler !== end.compiler) {
    return missing("compiler changed between the start and final compiles");
  }
  if (start.incomplete_apps.length > 0) {
    return missing(
      `starting workspace did not build completely: ${
        start.incomplete_apps.join(", ")
      }`,
    );
  }
  const complete = end.incomplete_apps.length === 0;
  const inc: Record<string, number> = {};
  if (complete) {
    for (const k of Object.keys(end.warning_codes).sort()) {
      const d = end.warning_codes[k]! - (start.warning_codes[k] ?? 0);
      if (d > 0) inc[k] = d;
    }
  }
  return ok({
    errors: end.errors,
    warnings: complete ? end.warnings : null,
    start_errors: start.errors,
    start_warnings: start.warnings,
    new_warnings: complete
      ? Object.values(inc).reduce((a, b) => a + b, 0)
      : null,
    new_warning_codes: inc,
    complete,
    incomplete_apps: end.incomplete_apps,
  });
}

/** The canary app (no dependencies) as a one-app graph. */
async function readAppGraphOf(dir: string): Promise<StagedApp[]> {
  const a = await readAppJson(join(dir, "app.json"));
  return [{
    folder: basename(dir),
    id: a.id.toLowerCase(),
    name: a.name,
    publisher: a.publisher,
    version: a.version,
    idRanges: a.idRanges,
    depends: [],
    external: [],
  }];
}

/** Proves the analyzers ran: the canary must report every frozen expected code. */
export async function canaryCheck(
  lane: BcLane,
  o: {
    canaryDir: string;
    lock: LockedSymbols;
    outDir: string;
    analysis: AnalysisSettings;
    expected: string[];
  },
): Promise<{ codes: string[]; ok: boolean; compiler: string }> {
  // buildApps copies only from absolute source paths.
  const canary = resolve(o.canaryDir);
  const c = await finalCodeCounts(lane, {
    dir: dirname(canary),
    apps: await readAppGraphOf(canary),
    lock: o.lock,
    outDir: o.outDir,
    analysis: o.analysis,
  });
  const codes = Object.keys(c.warning_codes).sort();
  return {
    codes,
    ok: c.incomplete_apps.length === 0 &&
      o.expected.every((x) => codes.includes(x)),
    compiler: c.compiler,
  };
}

/** Expectation mismatches of one fixture's measures (spec 8.6); empty when it qualifies. */
export function qualifyMeasures(
  r: MeasureRecord,
  expect: TaskMeasures["expect"][string],
): string[] {
  const out: string[] = [];
  const got = <T>(m: Measure<T>, f: (v: T) => unknown) =>
    m.status === "ok" ? f(m.value) : `${m.status} (${m.reason})`;
  const eq = (name: string, want: unknown, g: unknown) => {
    if (want !== undefined && g !== want) {
      out.push(`${name}: expected ${want}, got ${g}`);
    }
  };
  eq("reuse_executed", expect.reuse_executed, got(r.reuse, (v) => v.executed));
  eq("reuse", expect.reuse, got(r.reuse, (v) => v.effective));
  if (expect.partial_credit !== undefined) {
    const g = got(r.partial_credit, (v) => v.new_requirements);
    if (typeof g !== "number" || Math.abs(g - expect.partial_credit) > 1e-9) {
      out.push(`partial_credit: expected ${expect.partial_credit}, got ${g}`);
    }
  }
  eq("final_errors", expect.final_errors, got(r.final_code, (v) => v.errors));
  if (expect.new_warning_codes !== undefined) {
    const fc = r.final_code;
    if (fc.status !== "ok" || !fc.value.complete) {
      out.push(
        `new_warning_codes: final-code check ${
          fc.status === "ok" ? "incomplete" : `${fc.status} (${fc.reason})`
        }`,
      );
    } else {
      const inc = Object.keys(fc.value.new_warning_codes);
      const lack = expect.new_warning_codes.filter((c) => !inc.includes(c));
      if (lack.length > 0) {
        out.push(
          `new_warning_codes: expected ${
            lack.join(",")
          } to increase, increased: ${inc.join(",") || "none"}`,
        );
      }
    }
  }
  return out;
}
