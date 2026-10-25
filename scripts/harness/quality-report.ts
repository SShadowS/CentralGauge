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
}
export interface PairD {
  task: string;
  repeat: number;
  d: number;
}
export interface TaskMean {
  task: string;
  mean: number;
  nPairs: number;
}
/** `arm|task|repeat` -> metric -> value (missing metric = missing value). */
export type ValueTable = Map<string, Record<string, number>>;
export interface JudgeMetric {
  signs: PairD[];
  lowAgreement: boolean;
  kappaNa: boolean;
}
export interface Agg {
  nTasks: number;
  k: number;
  m: number;
  t: number;
  median: number;
  mean: number;
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

/** Percentile 95% CI of the mean of `xs` resampled with replacement. */
export function bootstrapCi(
  xs: number[],
  boot: number,
  seed: number,
): [number, number] | null {
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
  return [
    ms[Math.floor(0.025 * boot)]!,
    ms[Math.min(boot - 1, Math.ceil(0.975 * boot) - 1)]!,
  ];
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

/** Across-task statistics on a list of task means. */
export function aggregate(
  xs: number[],
  opts: { boot?: number; seed?: number } = {},
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
    ci: bootstrapCi(xs, opts.boot ?? 10000, opts.seed ?? 1),
    signP: signTest(k, m),
    wilcoxon: wilcoxon(xs),
    loto: loto(xs),
  };
}

const f = (x: number | null, d = 4) => x === null ? "" : String(+x.toFixed(d));

/** The generated sentence; "consistent" only when the effect holds across tasks. */
export function wording(a: Agg, stratum: string): string {
  const base =
    `variant better on ${a.k} tasks, worse on ${a.m}, tied on ${a.t} ` +
    `(median within-task difference ${f(a.median)}, LOTO range [${
      f(a.loto.min)
    }, ${f(a.loto.max)}])`;
  const holds = a.k + a.m >= 3 && (a.k === 0 || a.m === 0) && !a.loto.flips;
  return holds
    ? `${base}; consistent in stratum ${stratum}`
    : `${base}; task-dependent`;
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
      d: (v - b) * (higherBetter ? 1 : -1),
    });
  }
  return out;
}

export function taskMeans(pds: PairD[]): TaskMean[] {
  const by = new Map<string, number[]>();
  for (const p of pds) by.set(p.task, [...(by.get(p.task) ?? []), p.d]);
  return [...by].map(([task, ds]) => ({
    task,
    mean: mean(ds),
    nPairs: ds.length,
  }));
}

// ------------------------------------------------------------------ csv

export function parseCsv(text: string): Record<string, string>[] {
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
  const head = rows.shift() ?? [];
  return rows.filter((r) => r.some((x) => x !== "")).map((r) =>
    Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""]))
  );
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

export const ALSEM_METRICS: Record<string, Dir> = {
  curated_weighted_fp: "lower",
  alsem_new_findings_fp: "lower",
  alsem_new_high_findings: "lower",
  new_unused: "lower",
  test_coverage_ratio: "higher",
  test_assert_reachable_mean: "higher",
  test_zero_assert_share: "lower",
  test_areequal_literal_share: "lower",
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

function csvTable(
  text: string,
  metrics: Record<string, Dir>,
  skipExcluded: boolean,
): ValueTable {
  const t: ValueTable = new Map();
  for (const r of parseCsv(text)) {
    if (skipExcluded && (r["excluded"] ?? "") !== "") continue;
    const rec: Record<string, number> = {};
    for (const m of Object.keys(metrics)) {
      if (r[m] !== undefined && r[m] !== "") rec[m] = num(r[m], m);
    }
    t.set(key(r["arm"]!, r["task"]!, r["repeat"]!), rec);
  }
  return t;
}

export const alsemTable = (text: string) => csvTable(text, ALSEM_METRICS, true);
export const contextTable = (text: string) =>
  csvTable(text, CONTEXT_METRICS, false);

export function extraTable(
  text: string,
  declared: Record<string, Dir>,
): ValueTable {
  const rows = parseCsv(text);
  const cols = Object.keys(rows[0] ?? {}).filter((c) =>
    !["arm", "task", "repeat"].includes(c)
  );
  for (const c of cols) {
    if (!(c in declared)) {
      throw new Error(
        `--extra column "${c}" has no --metric ${c}:<higher|lower> declaration`,
      );
    }
  }
  return csvTable(text, declared, false);
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
  const t: ValueTable = new Map();
  for (const r of rows) {
    if (r.excluded) continue;
    const id = key(r.arm, r.task, r.repeat);
    const o = r.agent_vs_start?.outcome;
    const s = r.shipped_vs_final?.status;
    const rec: Record<string, number> = {};
    if (o === "catches") rec["agent_catches_bug"] = 1;
    else if (o === "misses" || o === "no_tests") rec["agent_catches_bug"] = 0;
    else if (o !== "not_applicable") {
      throw new Error(
        `test-rerun ${id}: unknown agent_vs_start.outcome "${o}"`,
      );
    }
    if (s === "pass") rec["shipped_suite_pass"] = 1;
    else if (s === "fail" || s === "compile_fail") {
      rec["shipped_suite_pass"] = 0;
    } else throw new Error(`test-rerun ${id}: unknown shipped status "${s}"`);
    t.set(id, rec);
  }
  return t;
}

export interface JudgePairItem {
  packet_id?: string;
  task: string;
  repeat: number;
  dimensions: Record<string, { across: string }>;
}

export function judgeMetrics(
  items: JudgePairItem[],
  summary?: {
    dimensions?: Record<string, { kappa?: unknown }>;
  },
): Map<string, JudgeMetric> {
  const out = new Map<string, JudgeMetric>();
  const SIGN: Record<string, number | null> = {
    variant: 1,
    baseline: -1,
    tie: 0,
    missing: null,
  };
  for (const it of items) {
    for (const [dim, v] of Object.entries(it.dimensions)) {
      const s = SIGN[v.across];
      if (s === undefined) {
        throw new Error(
          `judge ${it.task}#${it.repeat} ${dim}: unknown across value "${v.across}"`,
        );
      }
      const name = `judge_${dim}`;
      const m = out.get(name) ??
        { signs: [], lowAgreement: false, kappaNa: false };
      out.set(name, m);
      if (s !== null) m.signs.push({ task: it.task, repeat: it.repeat, d: s });
    }
  }
  for (const [name, m] of out) {
    const kap = summary?.dimensions?.[name.slice(6)]?.kappa;
    const vals = kap && typeof kap === "object"
      ? Object.values(kap)
      : kap === undefined
      ? []
      : [kap];
    for (const x of vals) {
      if (x === null) m.kappaNa = true;
      else if (typeof x === "number" && x < 0.4) m.lowAgreement = true;
    }
  }
  return out;
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
  boot?: number;
  seed?: number;
}

const HEADLINE = [
  "base",
  "variant",
  "stratum",
  "metric",
  "group",
  "n_tasks",
  "k",
  "m",
  "t",
  "median",
  "mean",
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
];
const TASKS = [
  "base",
  "variant",
  "metric",
  "task",
  "stratum",
  "n_pairs",
  "task_mean",
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

export async function runReport(o: RunOptions): Promise<void> {
  const boot = o.boot ?? 10000;
  const seed = o.seed ?? 1;
  const pairRows = parseCsv(
    await Deno.readTextFile(join(o.campaign, "pairs.csv")),
  );
  const all: PairRef[] = pairRows.map((r) => ({
    base: r["base"]!,
    variant: r["variant"]!,
    task: r["task"]!,
    repeat: Number(r["repeat"]),
  }));
  const wanted = o.pair?.map((p) => p.split(":") as [string, string]) ??
    [...new Set(all.map((p) => `${p.base}:${p.variant}`))].map((p) =>
      p.split(":") as [string, string]
    );

  const context = contextTable(
    await Deno.readTextFile(join(o.campaign, "executions.csv")),
  );
  const missing: string[] = [];
  const alsemPath = join(o.campaign, "alsem", "executions.csv");
  const alsem = (await exists(alsemPath))
    ? alsemTable(await Deno.readTextFile(alsemPath))
    : null;
  if (!alsem || alsem.size === 0) missing.push("alsem");
  const trDir = o.testRerun ?? join(o.campaign, "test-rerun");
  const trPath = join(trDir, "executions.json");
  const rerun = (await exists(trPath))
    ? testRerunTable(JSON.parse(await Deno.readTextFile(trPath)))
    : null;
  if (!rerun || rerun.size === 0) missing.push("test-rerun");
  const declared: Record<string, Dir> = {};
  for (const d of o.metric ?? []) {
    const [n, dir] = d.split(":");
    if (!n || (dir !== "higher" && dir !== "lower")) {
      throw new Error(`--metric "${d}": expected name:higher|lower`);
    }
    declared[n] = dir;
  }
  const extra: ValueTable = new Map();
  for (const p of o.extra ?? []) {
    for (const [k, v] of extraTable(await Deno.readTextFile(p), declared)) {
      extra.set(k, { ...extra.get(k), ...v });
    }
  }
  if (extra.size === 0) missing.push("extra");

  // judge dirs: "base:variant=dir" or a bare dir (needs exactly one pair)
  const judges = new Map<string, Map<string, JudgeMetric>>();
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
    judges.set(
      pk,
      judgeMetrics(
        JSON.parse(await Deno.readTextFile(join(dir, "pairs.json"))),
        (await exists(sp))
          ? JSON.parse(await Deno.readTextFile(sp))
          : undefined,
      ),
    );
  }
  if (judges.size === 0) missing.push("judge");

  const strataMap = new Map<string, string>();
  if (o.strata) {
    for (const r of parseCsv(await Deno.readTextFile(o.strata))) {
      strataMap.set(r["task"]!, r["stratum"]!);
    }
  }
  const stratumOf = (t: string) =>
    o.strata ? strataMap.get(t) ?? "unmapped" : "all";

  const head: Record<string, unknown>[] = [];
  const taskRows: Record<string, unknown>[] = [];
  const md: string[] = ["# Solution quality report", ""];
  md.push(`Missing axes: ${missing.length ? missing.join(", ") : "none"}`, "");

  for (const [base, variant] of wanted) {
    const pairs = all.filter((p) => p.base === base && p.variant === variant);
    type M = {
      name: string;
      group: "quality" | "context";
      tm: TaskMean[];
      low?: boolean;
      na?: boolean;
    };
    const ms: M[] = [];
    const fromTable = (
      t: ValueTable | null,
      metrics: Record<string, Dir>,
      group: M["group"],
    ) => {
      if (!t) return;
      for (const [name, dir] of Object.entries(metrics)) {
        const tm = taskMeans(pairDiffs(pairs, t, name, dir === "higher"));
        if (tm.length) ms.push({ name, group, tm });
      }
    };
    fromTable(alsem, ALSEM_METRICS, "quality");
    fromTable(rerun, TESTRERUN_METRICS, "quality");
    fromTable(extra, declared, "quality");
    for (const [name, jm] of judges.get(`${base}:${variant}`) ?? []) {
      const tm = taskMeans(jm.signs);
      if (tm.length) {
        ms.push({
          name,
          group: "quality",
          tm,
          low: jm.lowAgreement,
          na: jm.kappaNa,
        });
      }
    }
    fromTable(context, CONTEXT_METRICS, "context");

    const strata = [
      "all",
      ...(o.strata
        ? [...new Set(ms.flatMap((m) => m.tm.map((x) => stratumOf(x.task))))]
          .sort()
        : []),
    ];
    type Row = {
      s: string;
      group: string;
      metric: string;
      a: Agg;
      low: boolean;
      na: boolean;
    };
    const rows: Row[] = [];
    for (const m of ms) {
      for (const x of m.tm) {
        taskRows.push({
          base,
          variant,
          metric: m.name,
          task: x.task,
          stratum: stratumOf(x.task),
          n_pairs: x.nPairs,
          task_mean: x.mean,
          task_sign: Math.sign(x.mean),
        });
      }
      for (const s of strata) {
        const sub = s === "all"
          ? m.tm
          : m.tm.filter((x) => stratumOf(x.task) === s);
        if (!sub.length) continue;
        const a = aggregate(sub.map((x) => x.mean), { boot, seed });
        const r = {
          base,
          variant,
          stratum: s,
          metric: m.name,
          group: m.group,
          n_tasks: a.nTasks,
          k: a.k,
          m: a.m,
          t: a.t,
          median: a.median,
          mean: a.mean,
          ci_lo: a.ci?.[0],
          ci_hi: a.ci?.[1],
          sign_p: a.signP,
          wilcoxon_w_plus: a.wilcoxon.wPlus,
          wilcoxon_n: a.wilcoxon.n,
          wilcoxon_p: a.wilcoxon.p,
          loto_min: a.loto.min,
          loto_max: a.loto.max,
          loto_flips: a.loto.flips,
          low_agreement: m.low ?? false,
          kappa_na: m.na ?? false,
          wording: wording(a, s),
        };
        head.push(r);
        rows.push({
          s,
          group: m.group,
          metric: m.name,
          a,
          low: m.low ?? false,
          na: m.na ?? false,
        });
      }
    }

    md.push(`## ${base} vs ${variant}`, "");
    const cols = [
      "metric",
      "k/m/t",
      "n_tasks",
      "median",
      "mean",
      "CI95",
      "sign p",
      "Wilcoxon W+ (n)",
      "Wilcoxon p",
      "LOTO range",
      "flips",
      "flags",
      "wording",
    ];
    const line = (x: Row) => {
      const a = x.a;
      return [
        x.metric,
        `${a.k}/${a.m}/${a.t}`,
        a.nTasks,
        f(a.median),
        f(a.mean),
        `[${f(a.ci?.[0] ?? null)}, ${f(a.ci?.[1] ?? null)}]`,
        f(a.signP),
        `${a.wilcoxon.wPlus} (${a.wilcoxon.n})`,
        f(a.wilcoxon.p),
        `[${f(a.loto.min)}, ${f(a.loto.max)}]`,
        a.loto.flips,
        [x.low ? "low_agreement" : "", x.na ? "kappa_na" : ""]
          .filter(Boolean).join(" "),
        wording(a, x.s),
      ];
    };
    for (const [title, g] of [["Quality", "quality"], ["Context", "context"]]) {
      const sel = rows.filter((x) => x.s === "all" && x.group === g);
      md.push(`### ${title}`, "");
      md.push(sel.length ? mdTable(cols, sel.map(line)) : "(none)", "");
    }
    if (o.strata) {
      for (const s of strata.filter((x) => x !== "all")) {
        const sel = rows.filter((x) => x.s === s);
        md.push(`### Stratum ${s}`, "", mdTable(cols, sel.map(line)), "");
      }
    }
    md.push("### Per-task", "");
    for (const m of ms) {
      md.push(
        `#### ${m.name}`,
        "",
        mdTable(
          ["task", "stratum", "n_pairs", "task mean", "sign"],
          m.tm.map((x) => [
            x.task,
            stratumOf(x.task),
            x.nPairs,
            f(x.mean),
            Math.sign(x.mean),
          ]),
        ),
        "",
      );
    }
  }

  await Deno.mkdir(o.out, { recursive: true });
  await Deno.writeTextFile(join(o.out, "report.md"), md.join("\n") + "\n");
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
    boot: options.boot,
    seed: options.seed,
  });
  console.log(`${colors.green("[OK]")} wrote ${options.out}`);
}
