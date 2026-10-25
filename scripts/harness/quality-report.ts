/**
 * Q-07: paired, task-level solution-quality report. Unit = the matched pair
 * (task, repeat). Per metric: pair difference (oriented so > 0 = variant
 * better) -> per-task mean over repeats -> across tasks: sign test, Wilcoxon
 * signed-rank, cluster bootstrap CI over tasks and leave-one-task-out.
 * Pairs are never pooled. Read-only on every input; writes only under --out.
 *
 *   deno run --allow-all scripts/harness/quality-report.ts
 *     --campaign <analyze-campaign out dir> --out <dir>
 *     [--pair base:variant] [--judge [base:variant=]<dir>]
 *     [--test-rerun <dir>] [--extra <csv>]... [--metric name:higher|lower]...
 *     [--strata <csv>] [--boot 10000] [--seed 1]
 *
 * Outputs: report.md, headline.csv, tasks.csv. Design: H:\cg-coord\analysis\Q-07\design.md.
 */
import { Command } from "@cliffy/command";
import { join } from "@std/path";
import * as colors from "@std/fmt/colors";
import { mulberry32 } from "../../src/harness/stats.ts";

// ------------------------------------------------------------------ types

export type Dir = "higher" | "lower";
export interface PairRef {
  base: string;
  variant: string;
  task: string;
  repeat: number;
  baseId?: string | undefined;
  variantId?: string | undefined;
}
export interface PairD {
  task: string;
  repeat: number;
  d: number;
}
export interface TaskMean {
  task: string;
  /** Inferential score: mean over the task's pairs of sign(d). */
  score: number;
  /** Descriptive: mean over the task's pairs of the raw oriented difference d. */
  rawMean: number;
  nPairs: number;
}
/**
 * `arm|task|repeat` -> metric -> value. A row present without a metric = that
 * metric is empty. `excluded` rows are not in the map; `na` marks structurally
 * not-applicable (row key -> metrics).
 */
export type ValueTable =
  & Map<string, Record<string, number>>
  & { excluded?: Set<string>; na?: Map<string, Set<string>> };
export interface JudgeMetric {
  signs: PairD[];
  /** task\u0000repeat of pairs whose verdict is "missing". */
  missingKeys: Set<string>;
  lowAgreement: boolean;
  kappaNa: boolean;
}
export interface Agg {
  nTasks: number;
  k: number;
  m: number;
  t: number;
  /** median / mean of the task scores (inferential). */
  median: number;
  mean: number;
  /** median / mean of the task raw means (descriptive, metric units). */
  medianRaw: number | null;
  meanRaw: number | null;
  ci: [number, number] | null;
  signP: number;
  wilcoxon: { wPlus: number; n: number; p: number };
  loto: ReturnType<typeof loto>;
}

const key = (arm: string, task: string, repeat: number | string) =>
  `${arm}|${task}|${repeat}`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => sum(xs) / xs.length;

// ------------------------------------------------------------------ stats

/** Exact two-sided binomial sign test on k vs m (ties already dropped). */
export function signTest(k: number, m: number): number {
  const n = k + m;
  if (n === 0) return 1;
  const lf = (x: number) => {
    let s = 0;
    for (let i = 2; i <= x; i++) s += Math.log(i);
    return s;
  };
  const lnN = lf(n);
  let cdf = 0;
  for (let i = 0; i <= Math.min(k, m); i++) {
    cdf += Math.exp(lnN - lf(i) - lf(n - i) - n * Math.LN2);
  }
  return Math.min(1, 2 * cdf);
}

// Numerical Recipes erfc (fractional error < 1.2e-7).
// ponytail: only the n > 30 Wilcoxon path uses it; swap for a Cody erfc if more digits matter.
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const c = [
    -1.26551223,
    1.00002368,
    0.37409196,
    0.09678418,
    -0.18628806,
    0.27886807,
    -1.13520398,
    1.48851587,
    -0.82215223,
    0.17087277,
  ];
  const poly = c.reduceRight((acc, ci) => ci + t * acc, 0);
  const r = t * Math.exp(-z * z + poly);
  return x >= 0 ? r : 2 - r;
}

/** Wilcoxon signed-rank on `xs` (zeros dropped, average ranks). Exact for n <= 30. */
export function wilcoxon(
  xs: number[],
): { wPlus: number; n: number; p: number } {
  const v = xs.filter((x) => x !== 0);
  const n = v.length;
  if (n === 0) return { wPlus: 0, n: 0, p: 1 };
  const order = v.map((x, i) => ({ a: Math.abs(x), i })).sort((p, q) =>
    p.a - q.a
  );
  const rank = new Array<number>(n);
  const ties: number[] = [];
  for (let s = 0; s < n;) {
    let e = s;
    while (e + 1 < n && order[e + 1]!.a === order[s]!.a) e++;
    for (let j = s; j <= e; j++) rank[order[j]!.i] = (s + e) / 2 + 1;
    ties.push(e - s + 1);
    s = e + 1;
  }
  const wPlus = sum(v.map((x, i) => x > 0 ? rank[i]! : 0));
  if (n <= 30) {
    const r2 = rank.map((r) => Math.round(2 * r));
    const total = sum(r2);
    let dp: number[] = new Array<number>(total + 1).fill(0);
    dp[0] = 1;
    for (const r of r2) {
      const nx: number[] = new Array<number>(total + 1).fill(0);
      for (let s = 0; s <= total; s++) {
        if (dp[s]) {
          nx[s] = nx[s]! + dp[s]!;
          nx[s + r] = nx[s + r]! + dp[s]!;
        }
      }
      dp = nx;
    }
    const w2 = Math.round(2 * wPlus);
    let lo = 0;
    let hi = 0;
    for (let s = 0; s <= total; s++) {
      if (s <= w2) lo += dp[s]!;
      if (s >= w2) hi += dp[s]!;
    }
    return { wPlus, n, p: Math.min(1, 2 * Math.min(lo, hi) / 2 ** n) };
  }
  const mu = n * (n + 1) / 4;
  const varW = n * (n + 1) * (2 * n + 1) / 24 -
    sum(ties.map((t) => t ** 3 - t)) / 48;
  const z = Math.max(0, Math.abs(wPlus - mu) - 0.5) / Math.sqrt(varW);
  return { wPlus, n, p: Math.min(1, erfc(z / Math.SQRT2)) };
}

/**
 * 95% CI endpoints from the sorted bootstrap means. Convention (pinned by a
 * test): 0-based order statistics floor(0.025*B) and ceil(0.975*B)-1, in
 * integer arithmetic. For B = 10000 these are indices 250 and 9749 (the 251st
 * and 9750th ordered means); no interpolation.
 */
export function percentileCi(sorted: number[]): [number, number] {
  const b = sorted.length;
  return [
    sorted[Math.floor(b * 25 / 1000)]!,
    sorted[Math.ceil(b * 975 / 1000) - 1]!,
  ];
}

/** Percentile 95% CI of the mean of `xs` resampled with replacement. */
export function bootstrapCi(
  xs: number[],
  boot: number,
  seed: number,
): [number, number] | null {
  if (!Number.isInteger(boot) || boot < 1) {
    throw new Error(`boot must be a positive finite integer, got ${boot}`);
  }
  if (xs.length === 0) return null;
  const rnd = mulberry32(seed);
  const n = xs.length;
  const ms: number[] = [];
  for (let b = 0; b < boot; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += xs[Math.floor(rnd() * n)]!;
    ms.push(s / n);
  }
  ms.sort((a, b) => a - b);
  return percentileCi(ms);
}

/** Leave-one-task-out means of the task means; flips = sign of mean or of k-m changes. */
export function loto(xs: number[]) {
  const km = (v: number[]) =>
    Math.sign(v.filter((x) => x > 0).length - v.filter((x) => x < 0).length);
  const full = mean(xs);
  const means = xs.length < 2
    ? []
    : xs.map((_, i) => mean(xs.filter((_, j) => j !== i)));
  let flips = false;
  xs.forEach((_, i) => {
    if (xs.length < 2) return;
    const rest = xs.filter((_, j) => j !== i);
    const a = km(xs);
    const b = km(rest);
    if (Math.sign(means[i]!) !== Math.sign(full)) flips = true;
    if (a !== 0 && b !== 0 && a !== b) flips = true;
  });
  return {
    means,
    min: means.length ? Math.min(...means) : null,
    max: means.length ? Math.max(...means) : null,
    flips,
  };
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  const h = Math.floor(v.length / 2);
  return v.length % 2 ? v[h]! : (v[h - 1]! + v[h]!) / 2;
};

/**
 * Across-task statistics on a list of task scores. `opts.raw` = the matching
 * task raw means (descriptive only; no inference uses them).
 */
export function aggregate(
  xs: number[],
  opts: { boot?: number; seed?: number; raw?: number[] } = {},
): Agg {
  const k = xs.filter((x) => x > 0).length;
  const m = xs.filter((x) => x < 0).length;
  return {
    nTasks: xs.length,
    k,
    m,
    t: xs.length - k - m,
    median: median(xs),
    mean: mean(xs),
    medianRaw: opts.raw && opts.raw.length ? median(opts.raw) : null,
    meanRaw: opts.raw && opts.raw.length ? mean(opts.raw) : null,
    ci: bootstrapCi(xs, opts.boot ?? 10000, opts.seed ?? 1),
    signP: signTest(k, m),
    wilcoxon: wilcoxon(xs),
    loto: loto(xs),
  };
}

const f = (x: number | null, d = 4) => x === null ? "" : String(+x.toFixed(d));

export interface CohortSize {
  observedTasks: number;
  expectedTasks: number;
  /** Applicable pairs (not_applicable removed); a task counts as observed after one repeat. */
  observedPairs?: number;
  expectedPairs?: number;
}

/**
 * The generated sentence. "consistent" only when the effect holds across the
 * observed tasks (>= 3 non-tied, one direction, no LOTO flip) AND the cohort is
 * complete: every expected task AND every expected applicable pair observed (a
 * task counts as observed after one repeat, so task counts alone are not
 * enough). Otherwise "task-dependent", with each incompleteness flagged. The
 * median difference is the raw, descriptive one.
 */
export function wording(
  a: Agg,
  stratum: string,
  cohort?: CohortSize,
): string {
  const base =
    `variant better on ${a.k} tasks, worse on ${a.m}, tied on ${a.t} ` +
    `(median within-task difference ${
      f(a.medianRaw ?? a.median)
    } [descriptive], LOTO range [${f(a.loto.min)}, ${
      f(a.loto.max)
    }] of the task score)`;
  const holds = a.k + a.m >= 3 && (a.k === 0 || a.m === 0) && !a.loto.flips;
  const incomplete = cohort !== undefined &&
    cohort.observedTasks !== cohort.expectedTasks;
  const repeatsMissing = cohort?.expectedPairs !== undefined &&
    cohort.observedPairs !== cohort.expectedPairs;
  const tail =
    (incomplete
      ? `; incomplete cohort (${cohort.observedTasks} of ${cohort.expectedTasks} tasks observed)`
      : "") +
    (repeatsMissing
      ? `; incomplete repeat coverage (${cohort.observedPairs} of ${cohort.expectedPairs} pairs observed)`
      : "");
  if (holds && !incomplete && !repeatsMissing) {
    return `${base}; consistent in stratum ${stratum}`;
  }
  return `${base}; task-dependent${tail}`;
}

// ------------------------------------------------------------------ pairs

export function pairDiffs(
  pairs: PairRef[],
  table: ValueTable,
  metric: string,
  higherBetter: boolean,
): PairD[] {
  const out: PairD[] = [];
  for (const p of pairs) {
    const b = table.get(key(p.base, p.task, p.repeat))?.[metric];
    const v = table.get(key(p.variant, p.task, p.repeat))?.[metric];
    if (b === undefined || v === undefined) continue;
    out.push({
      task: p.task,
      repeat: p.repeat,
      d: (v - b) * (higherBetter ? 1 : -1) + 0,
    });
  }
  return out;
}

/** Per task: score = mean of sign(d) over its pairs; rawMean = mean of d (descriptive). */
export function taskMeans(pds: PairD[]): TaskMean[] {
  const by = new Map<string, number[]>();
  for (const p of pds) by.set(p.task, [...(by.get(p.task) ?? []), p.d]);
  return [...by].map(([task, ds]) => ({
    task,
    score: mean(ds.map((d) => Math.sign(d) + 0)),
    rawMean: mean(ds),
    nPairs: ds.length,
  }));
}

/** One selected campaign pair seen through one metric. */
export interface PairOutcome {
  task: string;
  repeat: number;
  /** Oriented raw difference (variant better > 0); unoriented for descriptive metrics. */
  d?: number;
  /** Structurally not applicable: removed from the expected pairs. */
  na?: boolean;
  /** Reasons, `<side>_<reason>`: no_row | excluded | empty | judge_missing. */
  miss: string[];
}

/** dir = null: descriptive metric, d = variant - base without orientation. */
export function collectPairs(
  pairs: PairRef[],
  table: ValueTable,
  metric: string,
  dir: Dir | null,
): PairOutcome[] {
  return pairs.map((p) => {
    const bk = key(p.base, p.task, p.repeat);
    const vk = key(p.variant, p.task, p.repeat);
    const o: PairOutcome = { task: p.task, repeat: p.repeat, miss: [] };
    if (table.na?.get(bk)?.has(metric) || table.na?.get(vk)?.has(metric)) {
      o.na = true;
      return o;
    }
    const side = (name: string, k: string): number | undefined => {
      const row = table.get(k);
      if (row === undefined) {
        o.miss.push(
          `${name}_${table.excluded?.has(k) ? "excluded" : "no_row"}`,
        );
        return undefined;
      }
      const v = row[metric];
      if (v === undefined) o.miss.push(`${name}_empty`);
      return v;
    };
    const b = side("base", bk);
    const v = side("variant", vk);
    if (b !== undefined && v !== undefined) {
      o.d = (v - b) * (dir === "lower" ? -1 : 1) + 0;
    }
    return o;
  });
}

/** Judge verdicts are pair-level: an absent item or a "missing" verdict hits both sides. */
export function collectJudge(
  pairs: PairRef[],
  jm: JudgeMetric,
): PairOutcome[] {
  const signs = new Map(
    jm.signs.map((s) => [`${s.task}\u0000${s.repeat}`, s.d]),
  );
  return pairs.map((p) => {
    const id = `${p.task}\u0000${p.repeat}`;
    const o: PairOutcome = { task: p.task, repeat: p.repeat, miss: [] };
    const d = signs.get(id);
    if (d !== undefined) o.d = d;
    else {
      const why = jm.missingKeys.has(id) ? "judge_missing" : "no_row";
      o.miss.push(`base_${why}`, `variant_${why}`);
    }
    return o;
  });
}

export const MISSING_KEYS = [
  "base_no_row",
  "base_excluded",
  "base_empty",
  "base_judge_missing",
  "variant_no_row",
  "variant_excluded",
  "variant_empty",
  "variant_judge_missing",
];

export function cohortStats(outcomes: PairOutcome[]) {
  const missing: Record<string, number> = {};
  for (const k of MISSING_KEYS) missing[k] = 0;
  const expectedTasks = new Set<string>();
  const observedTasks = new Set<string>();
  let na = 0;
  let observed = 0;
  for (const o of outcomes) {
    if (o.na) {
      na++;
      continue;
    }
    expectedTasks.add(o.task);
    if (o.d !== undefined) {
      observed++;
      observedTasks.add(o.task);
    }
    for (const m of o.miss) missing[m] = (missing[m] ?? 0) + 1;
  }
  return {
    expectedPairs: outcomes.length - na,
    observedPairs: observed,
    naPairs: na,
    expectedTasks: expectedTasks.size,
    observedTasks: observedTasks.size,
    missing,
  };
}

// ------------------------------------------------------------------ csv

export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const t = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Strict CSV: every `required` header must exist, header names are unique, and
 * every data row has exactly as many columns as the header (a blank line is skipped).
 */
export function parseCsv(
  text: string,
  required: string[] = [],
  what = "csv",
): Record<string, string>[] {
  const rows = csvRows(text);
  const head = rows.shift() ?? [];
  for (const r of required) {
    if (!head.includes(r)) {
      throw new Error(`${what}: missing required column "${r}"`);
    }
  }
  if (new Set(head).size !== head.length) {
    throw new Error(`${what}: duplicate column names in the header`);
  }
  const out: Record<string, string>[] = [];
  rows.forEach((r, i) => {
    if (r.length === 1 && r[0] === "") return;
    if (r.length !== head.length) {
      throw new Error(
        `${what}: row ${
          i + 2
        } has ${r.length} columns, the header has ${head.length}`,
      );
    }
    out.push(Object.fromEntries(head.map((h, j) => [h, r[j]!])));
  });
  return out;
}

/** A repeat index: a finite integer written as such. */
export function repeatOf(s: string | number, what: string): number {
  const n = typeof s === "number" ? s : s.trim() === "" ? NaN : Number(s);
  if (!Number.isInteger(n)) {
    throw new Error(
      `${what}: repeat must be a finite integer, got ${JSON.stringify(s)}`,
    );
  }
  return n;
}

function csvText(rows: Record<string, unknown>[], header: string[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [
    header.join(","),
    ...rows.map((r) => header.map((h) => cell(r[h])).join(",")),
  ].join("\n") + "\n";
}

// --------------------------------------------------------------- adapters

/** null = descriptive (no quality direction is claimed). */
export const ALSEM_METRICS: Record<string, Dir | null> = {
  curated_weighted_fp: "lower",
  alsem_new_findings_fp: "lower",
  alsem_new_high_findings: "lower",
  new_unused: "lower",
  test_coverage_ratio: "higher",
  test_assert_reachable_mean: "higher",
  test_zero_assert_share: "lower",
  // literal expected args / AreEqual calls: not a defect rate, no justified direction
  test_areequal_literal_share: null,
};
export const TESTRERUN_METRICS: Record<string, Dir> = {
  agent_catches_bug: "higher",
  shipped_suite_pass: "higher",
};
export const CONTEXT_METRICS: Record<string, Dir> = {
  cost_usd: "lower",
  wall_min: "lower",
};

function num(s: string, what: string): number {
  const x = Number(s);
  if (!Number.isFinite(x)) throw new Error(`${what}: not a number: "${s}"`);
  return x;
}

function mkTable(): ValueTable {
  return Object.assign(new Map<string, Record<string, number>>(), {
    excluded: new Set<string>(),
    na: new Map<string, Set<string>>(),
  });
}

function csvTable(
  text: string,
  metrics: Record<string, Dir | null>,
  skipExcluded: boolean,
  required: string[],
  what: string,
): ValueTable {
  const t = mkTable();
  const seen = new Set<string>();
  for (
    const r of parseCsv(text, ["arm", "task", "repeat", ...required], what)
  ) {
    for (const c of ["arm", "task"]) {
      if ((r[c] ?? "") === "") throw new Error(`${what}: empty ${c}`);
    }
    const id = key(
      r["arm"]!,
      r["task"]!,
      repeatOf(r["repeat"]!, `${what} ${r["arm"]}|${r["task"]}`),
    );
    if (seen.has(id)) throw new Error(`${what}: duplicate cell ${id}`);
    seen.add(id);
    if (skipExcluded && (r["excluded"] ?? "") !== "") {
      t.excluded!.add(id);
      continue;
    }
    const rec: Record<string, number> = {};
    for (const m of Object.keys(metrics)) {
      if (r[m] !== undefined && r[m] !== "") rec[m] = num(r[m], m);
    }
    t.set(id, rec);
  }
  return t;
}

export const alsemTable = (text: string) =>
  csvTable(text, ALSEM_METRICS, true, [], "alsem/executions.csv");
export const contextTable = (text: string) =>
  csvTable(text, CONTEXT_METRICS, false, ["id"], "executions.csv");

export function extraTable(
  text: string,
  declared: Record<string, Dir>,
): ValueTable {
  const cols = (csvRows(text)[0] ?? []).filter((c) =>
    !["arm", "task", "repeat"].includes(c)
  );
  const bad = cols.filter((c) => !Object.hasOwn(declared, c));
  if (bad.length) {
    throw new Error(
      `--extra columns without a --metric <name>:<higher|lower> declaration: ${
        bad.map((c) => JSON.stringify(c)).join(", ")
      }`,
    );
  }
  return csvTable(text, declared, false, [], "--extra csv");
}

export interface TestRerunInput {
  arm: string;
  task: string;
  repeat: number;
  excluded?: string | null;
  agent_vs_start?: { outcome: string };
  shipped_vs_final?: { status: string };
}

export function testRerunTable(rows: TestRerunInput[]): ValueTable {
  if (!Array.isArray(rows)) {
    throw new Error("test-rerun: expected an array of rows");
  }
  const t = mkTable();
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const w = `test-rerun row ${i}`;
    if (r === null || typeof r !== "object") {
      throw new Error(`${w}: not an object`);
    }
    for (const c of ["arm", "task"] as const) {
      if (typeof r[c] !== "string" || r[c] === "") {
        throw new Error(`${w}: ${c} must be a non-empty string`);
      }
    }
    if (typeof r.repeat !== "number") {
      throw new Error(
        `${w}: repeat must be a finite integer, got ${
          JSON.stringify(r.repeat)
        }`,
      );
    }
    const id = key(r.arm, r.task, repeatOf(r.repeat, w));
    if (seen.has(id)) throw new Error(`test-rerun: duplicate cell ${id}`);
    seen.add(id);
    if (r.excluded) {
      t.excluded!.add(id);
      return;
    }
    const rec: Record<string, number> = {};
    const na = new Set<string>();
    // an absent/null result object drops only its metric; any other non-object or unknown value throws
    const avs: unknown = r.agent_vs_start;
    const svf: unknown = r.shipped_vs_final;
    for (const [n, v] of [["agent_vs_start", avs], ["shipped_vs_final", svf]]) {
      if (
        v !== undefined && v !== null &&
        (typeof v !== "object" || Array.isArray(v))
      ) {
        throw new Error(
          `test-rerun ${id}: ${n} must be an object or absent, got ${
            JSON.stringify(v)
          }`,
        );
      }
    }
    if (r.agent_vs_start) {
      const o = r.agent_vs_start.outcome;
      if (o === "catches") rec["agent_catches_bug"] = 1;
      else if (o === "misses" || o === "no_tests") rec["agent_catches_bug"] = 0;
      else if (o === "not_applicable") na.add("agent_catches_bug");
      else {
        throw new Error(
          `test-rerun ${id}: unknown agent_vs_start.outcome "${o}"`,
        );
      }
    }
    if (r.shipped_vs_final) {
      const s = r.shipped_vs_final.status;
      if (s === "pass") rec["shipped_suite_pass"] = 1;
      else if (s === "fail" || s === "compile_fail") {
        rec["shipped_suite_pass"] = 0;
      } else throw new Error(`test-rerun ${id}: unknown shipped status "${s}"`);
    }
    t.set(id, rec);
    if (na.size) t.na!.set(id, na);
  });
  return t;
}

export interface JudgePairItem {
  baseline_id?: string;
  variant_id?: string;
  packet_id?: string;
  task: string;
  repeat: number;
  dimensions: Record<string, { across: string }>;
}

const JUDGE_SIGN = new Map<string, number | null>([
  ["variant", 1],
  ["baseline", -1],
  ["tie", 0],
  ["missing", null],
]);

/** kappa: null, a finite number, or an object of those (one per judge pair). */
function kappaLeaves(kap: unknown, where: string): (number | null)[] {
  const leaf = (x: unknown): number | null => {
    if (x === null) return null;
    if (typeof x === "number" && Number.isFinite(x)) return x;
    throw new Error(`${where}: kappa leaf must be a finite number or null`);
  };
  if (kap !== null && typeof kap === "object") {
    if (Array.isArray(kap)) {
      throw new Error(`${where}: kappa must not be an array`);
    }
    return Object.values(kap).map(leaf);
  }
  return [leaf(kap)];
}

export function judgeMetrics(
  items: JudgePairItem[],
  summary?: {
    dimensions?: Record<string, { kappa?: unknown }>;
  },
): Map<string, JudgeMetric> {
  const out = new Map<string, JudgeMetric>();
  for (const it of items) {
    if (typeof it.task !== "string" || it.task === "") {
      throw new Error("judge item: task must be a non-empty string");
    }
    repeatOf(it.repeat, `judge item ${it.task}`);
    for (const [dim, v] of Object.entries(it.dimensions)) {
      const s = JUDGE_SIGN.get(v.across);
      if (s === undefined) {
        throw new Error(
          `judge ${it.task}#${it.repeat} ${dim}: unknown across value "${v.across}"`,
        );
      }
      const name = `judge_${dim}`;
      const m = out.get(name) ??
        {
          signs: [],
          missingKeys: new Set<string>(),
          lowAgreement: false,
          kappaNa: false,
        };
      out.set(name, m);
      if (s !== null) m.signs.push({ task: it.task, repeat: it.repeat, d: s });
      else m.missingKeys.add(`${it.task}\u0000${it.repeat}`);
    }
  }
  const dims = summary?.dimensions;
  for (const [name, m] of out) {
    const dim = name.slice(6);
    if (!dims || !Object.hasOwn(dims, dim)) continue;
    const kap = dims[dim]!.kappa;
    if (kap === undefined) continue;
    for (const x of kappaLeaves(kap, `judge summary ${dim}`)) {
      if (x === null) m.kappaNa = true;
      else if (x < 0.4) m.lowAgreement = true;
    }
  }
  return out;
}

export interface JudgeKey {
  baseline_id?: string;
  variant_id?: string;
  A: string;
  B: string;
  a_role: string;
}

/** Execution-id provenance (Q-01 run 002): verify baseline_id/variant_id where present; true = some item carries none. */ function checkIds(
  items: JudgePairItem[],
  pairs: PairRef[],
  keys: Record<string, JudgeKey> | null,
): boolean {
  let unverified = false;
  for (const it of items) {
    const pr = pairs.find((p) => p.task === it.task && p.repeat === it.repeat)!;
    const k =
      keys && it.packet_id !== undefined && Object.hasOwn(keys, it.packet_id)
        ? keys[it.packet_id]
        : undefined;
    for (
      const [field, want] of [["baseline_id", pr.baseId], [
        "variant_id",
        pr.variantId,
      ]] as const
    ) {
      // Q-01 writes `null` for an unknown id: treat it as absent, like a missing field
      const iv = it[field] ?? undefined;
      const kv = k?.[field] ?? undefined;
      const where = `judge ${it.task}#${it.repeat} ${field}`;
      if (iv !== undefined && kv !== undefined && iv !== kv) {
        throw new Error(
          `${where}: pairs.json item (${iv}) and key.json (${kv}) disagree`,
        );
      }
      for (const v of [iv, kv]) {
        if (v !== undefined && v !== want) {
          throw new Error(
            `${where}: ${v} does not match campaign pairs.csv (${want})`,
          );
        }
      }
      if (iv === undefined && kv === undefined) unverified = true;
    }
  }
  return unverified;
}
/**
 * Join judge items to the selected campaign pairs on (task, repeat) and check
 * provenance against `<judge>/key/key.json` (packet id -> {A, B, a_role}; A/B
 * are the arm names the judge run was given). Throws on an unmatched item, a
 * duplicate (task, repeat), a missing/mismatched key. Without a key it throws
 * unless `allowUnverified`; returns whether the result is unverified.
 */
export function verifyJudge(
  items: JudgePairItem[],
  pairs: PairRef[],
  keys: Record<string, JudgeKey> | null,
  allowUnverified: boolean,
): { unverified: boolean; idsUnverified: boolean } {
  for (const it of items) {
    if (typeof it.packet_id !== "string" || it.packet_id === "") {
      throw new Error(
        `judge item ${it.task}#${it.repeat}: packet_id is required`,
      );
    }
  }
  const known = new Set(pairs.map((p) => `${p.task}\u0000${p.repeat}`));
  const seen = new Set<string>();
  const base = pairs[0]?.base;
  const variant = pairs[0]?.variant;
  for (const it of items) {
    const id = `${it.task}\u0000${it.repeat}`;
    if (!known.has(id)) {
      throw new Error(
        `judge item ${it.task}#${it.repeat} matches no campaign pair of ${base}:${variant}`,
      );
    }
    if (seen.has(id)) {
      throw new Error(`judge: duplicate pair ${it.task}#${it.repeat}`);
    }
    seen.add(id);
  }
  if (keys === null) {
    if (!allowUnverified) {
      throw new Error(
        "judge: key/key.json is missing, so the arms cannot be verified; pass --judge-unverified to accept",
      );
    }
    return { unverified: true, idsUnverified: checkIds(items, pairs, null) };
  }
  for (const it of items) {
    const k = it.packet_id !== undefined && Object.hasOwn(keys, it.packet_id)
      ? keys[it.packet_id]
      : undefined;
    const where =
      `judge key for ${it.task}#${it.repeat} (packet ${it.packet_id})`;
    if (!k) throw new Error(`${where}: no entry in key.json`);
    const ok = k.a_role === "baseline"
      ? k.A === base && k.B === variant
      : k.a_role === "variant"
      ? k.A === variant && k.B === base
      : false;
    if (!ok) {
      throw new Error(
        `${where}: key {A:${k.A}, B:${k.B}, a_role:${k.a_role}} does not match pair ${base}:${variant}`,
      );
    }
  }
  return { unverified: false, idsUnverified: checkIds(items, pairs, keys) };
}

// ----------------------------------------------------------------- report

export interface RunOptions {
  campaign: string;
  out: string;
  pair?: string[] | undefined;
  judge?: string[] | undefined;
  testRerun?: string | undefined;
  extra?: string[] | undefined;
  metric?: string[] | undefined;
  strata?: string | undefined;
  judgeUnverified?: boolean | undefined;
  boot?: number;
  seed?: number;
}

const HEADLINE = [
  "base",
  "variant",
  "stratum",
  "metric",
  "group",
  "status",
  "expected_pairs",
  "observed_pairs",
  "na_pairs",
  "expected_tasks",
  "observed_tasks",
  ...MISSING_KEYS.map((k) => `missing_${k}`),
  "n_tasks",
  "k",
  "m",
  "t",
  "median",
  "mean",
  "median_raw",
  "mean_raw",
  "ci_lo",
  "ci_hi",
  "sign_p",
  "wilcoxon_w_plus",
  "wilcoxon_n",
  "wilcoxon_p",
  "loto_min",
  "loto_max",
  "loto_flips",
  "low_agreement",
  "kappa_na",
  "wording",
  "unverified",
  "ids_unverified",
];
const TASKS = [
  "base",
  "variant",
  "metric",
  "task",
  "stratum",
  "n_pairs",
  "task_score",
  "task_raw_mean",
  "task_sign",
];

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

function mdTable(head: string[], rows: unknown[][]): string {
  const line = (c: unknown[]) => `| ${c.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join(
    "\n",
  );
}

/** One metric of one comparison, before the per-stratum split. */
interface Spec {
  name: string;
  group: "quality" | "context" | "descriptive";
  axis?: string;
  outcomes: PairOutcome[];
  low?: boolean;
  na?: boolean;
  unv?: boolean;
  ids?: boolean;
}
/** One report row: a Spec restricted to one stratum. */
interface Row {
  s: string;
  spec: Spec;
  cs: ReturnType<typeof cohortStats>;
  tms: TaskMean[];
  agg: Agg | null;
  status: "ok" | "unavailable" | "descriptive";
  wording: string;
}

export async function runReport(o: RunOptions): Promise<void> {
  const boot = o.boot ?? 10000;
  const seed = o.seed ?? 1;
  const pairRows = parseCsv(
    await Deno.readTextFile(join(o.campaign, "pairs.csv")),
    ["base", "variant", "task", "repeat", "base_id", "variant_id"],
    "pairs.csv",
  );
  const seenPair = new Set<string>();
  const all: PairRef[] = pairRows.map((r) => {
    for (const c of ["base", "variant", "task"]) {
      if ((r[c] ?? "") === "") throw new Error(`pairs.csv: empty ${c}`);
    }
    const repeat = repeatOf(
      r["repeat"]!,
      `pairs.csv ${r["base"]}:${r["variant"]} ${r["task"]}`,
    );
    const id = `${r["base"]}|${r["variant"]}|${r["task"]}|${repeat}`;
    if (seenPair.has(id)) throw new Error(`pairs.csv: duplicate pair ${id}`);
    seenPair.add(id);
    return {
      base: r["base"]!,
      variant: r["variant"]!,
      task: r["task"]!,
      repeat,
      baseId: r["base_id"] || undefined,
      variantId: r["variant_id"] || undefined,
    };
  });
  const wanted = o.pair?.map((p) => p.split(":") as [string, string]) ??
    [...new Set(all.map((p) => `${p.base}:${p.variant}`))].map((p) =>
      p.split(":") as [string, string]
    );
  for (const [b, v] of wanted) {
    if (!all.some((p) => p.base === b && p.variant === v)) {
      throw new Error(`--pair ${b}:${v}: no such pair in pairs.csv`);
    }
  }

  const context = contextTable(
    await Deno.readTextFile(join(o.campaign, "executions.csv")),
  );
  // axes with at least one observed pair in some comparison; "Missing axes" is the rest
  const present = new Set<string>();
  const alsemPath = join(o.campaign, "alsem", "executions.csv");
  const alsem = (await exists(alsemPath))
    ? alsemTable(await Deno.readTextFile(alsemPath))
    : null;
  const trDir = o.testRerun ?? join(o.campaign, "test-rerun");
  const trPath = join(trDir, "executions.json");
  const rerun = (await exists(trPath))
    ? testRerunTable(JSON.parse(await Deno.readTextFile(trPath)))
    : null;
  const declared: Record<string, Dir> = Object.create(null);
  for (const d of o.metric ?? []) {
    const [n, dir] = d.split(":");
    if (!n || (dir !== "higher" && dir !== "lower")) {
      throw new Error(`--metric "${d}": expected name:higher|lower`);
    }
    declared[n] = dir;
  }
  const extra: ValueTable | null = o.extra?.length ? new Map() : null;
  for (const p of o.extra ?? []) {
    for (const [k, v] of extraTable(await Deno.readTextFile(p), declared)) {
      extra!.set(k, { ...extra!.get(k), ...v });
    }
  }

  // judge dirs: "base:variant=dir" or a bare dir (needs exactly one pair)
  const judges = new Map<
    string,
    {
      unverified: boolean;
      idsUnverified: boolean;
      campaignId?: string | undefined;
      metrics: Map<string, JudgeMetric>;
    }
  >();
  for (const j of o.judge ?? []) {
    const eq = j.indexOf("=");
    let pk: string;
    let dir: string;
    if (eq > 0 && /^[^:=]+:[^:=]+$/.test(j.slice(0, eq))) {
      pk = j.slice(0, eq);
      dir = j.slice(eq + 1);
    } else {
      if (wanted.length !== 1) {
        throw new Error(
          `--judge "${j}": with several pairs use base:variant=<dir>`,
        );
      }
      pk = wanted[0]!.join(":");
      dir = j;
    }
    const sp = join(dir, "summary.json");
    const kp = join(dir, "key", "key.json");
    const items = JSON.parse(await Deno.readTextFile(join(dir, "pairs.json")));
    const sj = (await exists(sp))
      ? JSON.parse(await Deno.readTextFile(sp))
      : undefined;
    const [jb, jv] = pk.split(":") as [string, string];
    const { unverified, idsUnverified } = verifyJudge(
      items,
      all.filter((p) => p.base === jb && p.variant === jv),
      (await exists(kp)) ? JSON.parse(await Deno.readTextFile(kp)) : null,
      o.judgeUnverified ?? false,
    );
    judges.set(pk, {
      unverified,
      idsUnverified,
      campaignId: sj?.campaign_id,
      metrics: judgeMetrics(items, sj),
    });
  }

  const strataMap = new Map<string, string>();
  if (o.strata) {
    for (
      const r of parseCsv(
        await Deno.readTextFile(o.strata),
        ["task", "stratum"],
        "--strata csv",
      )
    ) {
      if (r["stratum"] === "all") {
        throw new Error(
          `--strata: the stratum name "all" is reserved for the overall scope (task ${
            r["task"]
          })`,
        );
      }
      strataMap.set(r["task"]!, r["stratum"]!);
    }
  }
  const stratumOf = (t: string) =>
    o.strata ? strataMap.get(t) ?? "unmapped" : "all";

  const head: Record<string, unknown>[] = [];
  const taskRows: Record<string, unknown>[] = [];
  const md: string[] = [];

  for (const [base, variant] of wanted) {
    const pairs = all.filter((p) => p.base === base && p.variant === variant);
    const specs: Spec[] = [];
    const fromTable = (
      t: ValueTable | null,
      metrics: Record<string, Dir | null>,
      group: "quality" | "context",
      axis?: string,
    ) => {
      if (!t) return;
      for (const [name, dir] of Object.entries(metrics)) {
        specs.push({
          name,
          group: dir === null ? "descriptive" : group,
          ...(axis ? { axis } : {}),
          outcomes: collectPairs(pairs, t, name, dir),
        });
      }
    };
    fromTable(alsem, ALSEM_METRICS, "quality", "alsem");
    fromTable(rerun, TESTRERUN_METRICS, "quality", "test-rerun");
    fromTable(extra, declared, "quality", "extra");
    const jg = judges.get(`${base}:${variant}`);
    for (const [name, jm] of jg?.metrics ?? []) {
      specs.push({
        name,
        group: "quality",
        axis: "judge",
        outcomes: collectJudge(pairs, jm),
        low: jm.lowAgreement,
        na: jm.kappaNa,
        unv: jg!.unverified,
        ids: jg!.idsUnverified,
      });
    }
    fromTable(context, CONTEXT_METRICS, "context");

    const strata = [
      "all",
      ...(o.strata
        ? [...new Set(pairs.map((p) => stratumOf(p.task)))].sort()
        : []),
    ];
    const rows: Row[] = [];
    for (const sp of specs) {
      for (const s of strata) {
        const sub = s === "all"
          ? sp.outcomes
          : sp.outcomes.filter((x) => stratumOf(x.task) === s);
        if (!sub.length) continue;
        const cs = cohortStats(sub);
        if (cs.observedPairs > 0 && sp.axis) present.add(sp.axis);
        const tms = taskMeans(
          sub.flatMap((x) =>
            x.d === undefined
              ? []
              : [{ task: x.task, repeat: x.repeat, d: x.d }]
          ),
        );
        if (cs.observedPairs === 0) {
          rows.push({
            s,
            spec: sp,
            cs,
            tms,
            agg: null,
            status: "unavailable",
            wording:
              `unavailable (0 of ${cs.expectedPairs} expected pairs observed)`,
          });
        } else if (sp.group === "descriptive") {
          const rawMed = median(tms.map((x) => x.rawMean));
          rows.push({
            s,
            spec: sp,
            cs,
            tms,
            agg: null,
            status: "descriptive",
            wording:
              `descriptive context, no direction assigned (median raw difference ${
                f(rawMed)
              } over ${tms.length} tasks)`,
          });
        } else {
          const agg = aggregate(tms.map((x) => x.score), {
            boot,
            seed,
            raw: tms.map((x) => x.rawMean),
          });
          rows.push({
            s,
            spec: sp,
            cs,
            tms,
            agg,
            status: "ok",
            wording: wording(agg, s, {
              observedTasks: cs.observedTasks,
              expectedTasks: cs.expectedTasks,
              observedPairs: cs.observedPairs,
              expectedPairs: cs.expectedPairs,
            }),
          });
        }
      }
      for (
        const x of taskMeans(
          sp.outcomes.flatMap((y) =>
            y.d === undefined
              ? []
              : [{ task: y.task, repeat: y.repeat, d: y.d }]
          ),
        )
      ) {
        const desc = sp.group === "descriptive";
        taskRows.push({
          base,
          variant,
          metric: sp.name,
          task: x.task,
          stratum: stratumOf(x.task),
          n_pairs: x.nPairs,
          task_score: desc ? "" : x.score,
          task_raw_mean: x.rawMean,
          task_sign: desc ? "" : Math.sign(x.score),
        });
      }
    }
    for (const r of rows) {
      const a = r.agg;
      const rawOnly = r.status === "descriptive"
        ? { r: r.tms.map((x) => x.rawMean) }
        : null;
      head.push({
        base,
        variant,
        stratum: r.s,
        metric: r.spec.name,
        group: r.spec.group,
        status: r.status,
        expected_pairs: r.cs.expectedPairs,
        observed_pairs: r.cs.observedPairs,
        na_pairs: r.cs.naPairs,
        expected_tasks: r.cs.expectedTasks,
        observed_tasks: r.cs.observedTasks,
        ...Object.fromEntries(
          MISSING_KEYS.map((k) => [`missing_${k}`, r.cs.missing[k]]),
        ),
        n_tasks: r.status === "unavailable" ? 0 : r.cs.observedTasks,
        k: a?.k,
        m: a?.m,
        t: a?.t,
        median: a?.median,
        mean: a?.mean,
        median_raw: a ? a.medianRaw : rawOnly ? median(rawOnly.r) : undefined,
        mean_raw: a ? a.meanRaw : rawOnly ? mean(rawOnly.r) : undefined,
        ci_lo: a?.ci?.[0],
        ci_hi: a?.ci?.[1],
        sign_p: a?.signP,
        wilcoxon_w_plus: a?.wilcoxon.wPlus,
        wilcoxon_n: a?.wilcoxon.n,
        wilcoxon_p: a?.wilcoxon.p,
        loto_min: a?.loto.min,
        loto_max: a?.loto.max,
        loto_flips: a?.loto.flips,
        low_agreement: r.spec.low ?? false,
        kappa_na: r.spec.na ?? false,
        wording: r.wording,
        unverified: r.spec.unv ?? false,
        ids_unverified: r.spec.ids ?? false,
      });
    }

    md.push(`## ${base} vs ${variant}`, "");
    const missStr = (r: Row) =>
      MISSING_KEYS.filter((k) => r.cs.missing[k]).map((k) =>
        `${k}=${r.cs.missing[k]}`
      ).join(" ");
    const cohortCols = (r: Row) => [
      `${r.cs.observedTasks}/${r.cs.expectedTasks}`,
      `${r.cs.observedPairs}/${r.cs.expectedPairs}${
        r.cs.naPairs ? ` (+${r.cs.naPairs} n/a)` : ""
      }`,
      missStr(r),
    ];
    const cols = [
      "metric",
      "status",
      "tasks obs/exp",
      "pairs obs/exp",
      "missing",
      "k/m/t",
      "median score",
      "mean score",
      "median raw",
      "mean raw",
      "CI95",
      "sign p",
      "Wilcoxon W+ (n)",
      "Wilcoxon p",
      "LOTO range",
      "flips",
      "flags",
      "wording",
    ];
    const line = (r: Row) => {
      const a = r.agg;
      const [tk, pr, ms] = cohortCols(r);
      return [
        r.spec.name,
        r.status,
        tk,
        pr,
        ms,
        a ? `${a.k}/${a.m}/${a.t}` : "",
        a ? f(a.median) : "",
        a ? f(a.mean) : "",
        a ? f(a.medianRaw) : "",
        a ? f(a.meanRaw) : "",
        a ? `[${f(a.ci?.[0] ?? null)}, ${f(a.ci?.[1] ?? null)}]` : "",
        a ? f(a.signP) : "",
        a ? `${a.wilcoxon.wPlus} (${a.wilcoxon.n})` : "",
        a ? f(a.wilcoxon.p) : "",
        a ? `[${f(a.loto.min)}, ${f(a.loto.max)}]` : "",
        a ? a.loto.flips : "",
        [
          r.spec.low ? "low_agreement" : "",
          r.spec.na ? "kappa_na" : "",
          r.spec.unv ? "unverified" : "",
          r.spec.ids ? "ids_unverified" : "",
        ].filter(Boolean).join(" "),
        r.wording,
      ];
    };
    const dcols = [
      "metric",
      "status",
      "tasks obs/exp",
      "pairs obs/exp",
      "missing",
      "median raw",
      "mean raw",
      "note",
    ];
    const dline = (r: Row) => {
      const [tk, pr, ms] = cohortCols(r);
      const raw = r.tms.map((x) => x.rawMean);
      return [
        r.spec.name,
        r.status,
        tk,
        pr,
        ms,
        raw.length ? f(median(raw)) : "",
        raw.length ? f(mean(raw)) : "",
        r.wording,
      ];
    };
    for (const [title, g] of [["Quality", "quality"], ["Context", "context"]]) {
      const sel = rows.filter((x) => x.s === "all" && x.spec.group === g);
      md.push(`### ${title}`, "");
      md.push(sel.length ? mdTable(cols, sel.map(line)) : "(none)", "");
    }
    const dsel = rows.filter((x) =>
      x.s === "all" && x.spec.group === "descriptive"
    );
    md.push("### Descriptive", "");
    md.push(dsel.length ? mdTable(dcols, dsel.map(dline)) : "(none)", "");
    if (o.strata) {
      for (const s of strata.filter((x) => x !== "all")) {
        const sel = rows.filter((x) =>
          x.s === s && x.spec.group !== "descriptive"
        );
        md.push(`### Stratum ${s}`, "", mdTable(cols, sel.map(line)), "");
      }
    }
    md.push("### Per-task", "");
    for (const sp of specs) {
      const tms = taskMeans(
        sp.outcomes.flatMap((y) =>
          y.d === undefined ? [] : [{ task: y.task, repeat: y.repeat, d: y.d }]
        ),
      );
      if (!tms.length) continue;
      const desc = sp.group === "descriptive";
      md.push(
        `#### ${sp.name}`,
        "",
        mdTable(
          ["task", "stratum", "n_pairs", "task score", "task raw mean", "sign"],
          tms.map((x) => [
            x.task,
            stratumOf(x.task),
            x.nPairs,
            desc ? "" : f(x.score),
            f(x.rawMean),
            desc ? "" : Math.sign(x.score),
          ]),
        ),
        "",
      );
    }
  }

  await Deno.mkdir(o.out, { recursive: true });
  const missing = ["alsem", "test-rerun", "judge", "extra"].filter((a) =>
    !present.has(a)
  );
  const lead = [
    "# Solution quality report",
    "",
    `Missing axes: ${missing.length ? missing.join(", ") : "none"}`,
    "",
    "Inferential score per task = mean of the pair signs; k/m/t, tests, CI and LOTO use it. Raw differences are descriptive.",
    "",
    ...[...judges].filter(([, j]) => j.campaignId !== undefined).map(([p, j]) =>
      `Judge campaign_id (${p}): ${j.campaignId}`
    ),
    "",
  ];
  await Deno.writeTextFile(
    join(o.out, "report.md"),
    [...lead, ...md].join("\n") + "\n",
  );
  await Deno.writeTextFile(
    join(o.out, "headline.csv"),
    csvText(head, HEADLINE),
  );
  await Deno.writeTextFile(join(o.out, "tasks.csv"), csvText(taskRows, TASKS));
}

if (import.meta.main) {
  const { options } = await new Command()
    .name("quality-report")
    .description("Q-07 paired task-level solution-quality report")
    .option("--campaign <dir:string>", "analyze-campaign output dir", {
      required: true,
    })
    .option("--out <dir:string>", "output dir", { required: true })
    .option("--pair <p:string>", "base:variant (repeatable)", {
      collect: true,
    })
    .option("--judge <j:string>", "judge-pairs dir, or base:variant=dir", {
      collect: true,
    })
    .option("--test-rerun <dir:string>", "test-rerun dir")
    .option("--extra <csv:string>", "extra per-execution metrics csv", {
      collect: true,
    })
    .option("--metric <m:string>", "name:higher|lower for --extra columns", {
      collect: true,
    })
    .option(
      "--judge-unverified",
      "accept a judge dir without key/key.json (metrics marked unverified)",
    )
    .option("--strata <csv:string>", "task,stratum csv")
    .option("--boot <n:number>", "bootstrap resamples", { default: 10000 })
    .option("--seed <n:number>", "bootstrap seed", { default: 1 })
    .parse(Deno.args);
  await runReport({
    campaign: options.campaign,
    out: options.out,
    pair: options.pair,
    judge: options.judge,
    testRerun: options.testRerun,
    extra: options.extra,
    metric: options.metric,
    strata: options.strata,
    judgeUnverified: options.judgeUnverified,
    boot: options.boot,
    seed: options.seed,
  });
  console.log(`${colors.green("[OK]")} wrote ${options.out}`);
}
