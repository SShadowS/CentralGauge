/**
 * Harness Bench statistics (spec 1a section 9, owner rules
 * H:\cg-coord\decisions\2026-09-25-m1-metric-rules.md).
 *
 * - Cost per solved task = sum over tasks of per-task mean spend / sum over
 *   tasks of per-task solve rate, both over the SAME terminal cells with
 *   complete spend (addendum rule 5). A cell's spend is every attempt's. A
 *   terminally unscored cell adds its spend and no solve; it is never called
 *   a model failure. Equal task weight.
 * - Pass rate is separate: scored cells only.
 * - The headline uses terminal cells only; pending cells' known spend and
 *   count are shown next to it and the headline is provisional (rule 6).
 * - A baseline-variant comparison uses matched (task, repeat) pairs eligible
 *   in both arms; exclusions are counted per arm and reason.
 * - Paired task-level bootstrap. The zero-solve rule decides when resamples
 *   without a solve suppress the CI, the distinguishable verdict and the
 *   p-value: `suppress_any_undefined` (v1, the default) suppresses them when
 *   any resample is undefined; `min_defined_share` computes them over the
 *   defined resamples when their share is at least the frozen threshold.
 * - Contrasts (M11): two-sided bootstrap p with the +1 correction, Holm over
 *   exactly the pre-registered family (Holm alone decides), a descriptive
 *   Bonferroni interval beside it, and the (RL - R) - (L - P) interaction.
 * - Beside it (owner decision 2026-09-29, M6-02d), never replacing it: an
 *   EXPLORATORY (not pre-registered) percentile interval over the defined
 *   resamples only, from the same draws. It never sets `distinguishable`.
 */

import { percentile } from "../../cli/commands/report/stats-calculator.ts";
import { ValidationError } from "../errors.ts";
import type { PrimaryMetric } from "./config.ts";

/**
 * unrun: no execution yet. pending: attempts exist but the cell is not
 * final (retry due, usage-limit pause, verdict missing or infra-unscored).
 * scored: final verdict pass or fail. unscored: terminally unscored
 * (automatic retry exhausted).
 */
export type CellStatus = "unrun" | "pending" | "scored" | "unscored";

/** One planned (task, repeat, arm) cell. */
export interface Cell {
  task: string;
  arm: string;
  repeat: number;
  status: CellStatus;
  /** Non-null exactly when status is "scored". */
  pass: boolean | null;
  /** Sum over every attempt; null when any attempt's cost is unknown. */
  spend_usd: number | null;
  /** Sum over the attempts whose cost is known (raw disclosure). */
  known_spend_usd: number;
  attempts: number;
}

export type ExclusionReason = CellStatus | "unknown_spend" | "missing";

/** Deterministic PRNG so a report's CI is reproducible from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (task: string, repeat: number) => `${task}\u0000${repeat}`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Reject duplicate cells and pass/status mismatches. */
export function checkCells(cells: Cell[]): void {
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const c of cells) {
    const k = `${c.arm}/${c.task}/${c.repeat}`;
    if (seen.has(k)) errors.push(`duplicate cell ${k}`);
    seen.add(k);
    if ((c.pass !== null) !== (c.status === "scored")) {
      errors.push(`cell ${k}: pass must be set exactly when scored`);
    }
    const money = (x: number) => Number.isFinite(x) && x >= 0;
    if (c.spend_usd !== null && !money(c.spend_usd)) {
      errors.push(`cell ${k}: spend_usd must be finite and >= 0`);
    }
    if (!money(c.known_spend_usd)) {
      errors.push(`cell ${k}: known_spend_usd must be finite and >= 0`);
    }
    if (!Number.isInteger(c.attempts) || c.attempts < 0) {
      errors.push(`cell ${k}: attempts must be a non-negative integer`);
    }
    if (!Number.isInteger(c.repeat) || c.repeat < 1) {
      errors.push(`cell ${k}: repeat must be a positive integer`);
    }
  }
  if (errors.length > 0) {
    throw new ValidationError(
      `Invalid cells:\n  ${errors.join("\n  ")}`,
      errors,
    );
  }
}

/** Why a cell cannot enter a metric; null = eligible. */
/** Why a cell is outside a metric's cohort, or null when it is in. */
export function ineligible(
  c: Cell,
  metric: PrimaryMetric,
): ExclusionReason | null {
  if (c.status === "unrun" || c.status === "pending") return c.status;
  if (metric === "pass_rate") return c.status === "scored" ? null : "unscored";
  return c.spend_usd === null ? "unknown_spend" : null;
}

interface TaskStat {
  spend: number;
  solved: number;
}

/**
 * Per-task means over eligible cells. For the cost metric, spend and solve
 * rate use the same cells (unscored cells solve nothing). For pass rate,
 * only scored cells are eligible.
 */
function taskStats(
  cells: Cell[],
  metric: PrimaryMetric,
): Map<string, TaskStat> {
  const byTask = new Map<string, Cell[]>();
  for (const c of cells) {
    if (ineligible(c, metric) !== null) continue;
    byTask.set(c.task, [...(byTask.get(c.task) ?? []), c]);
  }
  const out = new Map<string, TaskStat>();
  for (const [task, cs] of byTask) {
    out.set(task, {
      spend: metric === "pass_rate" ? 0 : mean(cs.map((c) => c.spend_usd!)),
      solved: cs.filter((c) => c.pass === true).length / cs.length,
    });
  }
  return out;
}

function statistic(metric: PrimaryMetric, stats: TaskStat[]): number | null {
  if (stats.length === 0) return null;
  if (metric === "pass_rate") return mean(stats.map((s) => s.solved));
  const solved = sum(stats.map((s) => s.solved));
  return solved === 0 ? null : sum(stats.map((s) => s.spend)) / solved;
}

export interface ArmSummary {
  arm: string;
  planned_cells: number;
  attempted_cells: number;
  scored_cells: number;
  unscored_cells: number;
  pending_cells: number;
  unrun_cells: number;
  /** Attempted cells (any status) with at least one attempt of unknown cost. */
  unknown_spend_cells: number;
  /** Of those, the terminal ones: left out of the cost metric. */
  unknown_spend_terminal_cells: number;
  /** Known spend of every attempt in every cell, raw. */
  total_spend_usd: number;
  /** Known spend of pending cells (shown next to the headline, not in it). */
  pending_spend_usd: number;
  cost_per_solved_task: number | null;
  pass_rate: number | null;
  /** Share of tasks passing all k distinct repeats, over tasks with all k scored. */
  pass_k: number | null;
  pass_k_tasks: number;
  /** True while any cell is pending or unrun. */
  provisional: boolean;
}

/**
 * k is the planned repeat count. A cell (any status) with repeat > k is
 * outside the plan and refused. Repeats within 1..k that are missing or not
 * scored only keep the task out of pass^k.
 */
export function armSummary(cells: Cell[], arm: string, k: number): ArmSummary {
  checkCells(cells);
  if (!Number.isInteger(k) || k < 1) {
    throw new ValidationError(`k must be a positive integer, got ${k}`, [
      `k must be a positive integer, got ${k}`,
    ]);
  }
  const mine = cells.filter((c) => c.arm === arm);
  const beyond = mine.filter((c) => c.repeat > k)
    .map((c) => `task ${c.task}: repeat ${c.repeat} exceeds planned k=${k}`);
  if (beyond.length > 0) {
    throw new ValidationError(
      `Repeats outside the plan:\n  ${beyond.join("\n  ")}`,
      beyond,
    );
  }
  const count = (s: CellStatus) => mine.filter((c) => c.status === s).length;
  const known = (cs: Cell[]) => sum(cs.map((c) => c.known_spend_usd));
  const unknown = mine.filter((c) => c.attempts > 0 && c.spend_usd === null);
  const repeatsByTask = new Map<string, Map<number, boolean>>();
  for (const c of mine) {
    if (c.status !== "scored") continue;
    const m = repeatsByTask.get(c.task) ?? new Map<number, boolean>();
    m.set(c.repeat, c.pass!);
    repeatsByTask.set(c.task, m);
  }
  const full = [...repeatsByTask.values()].filter((m) =>
    Array.from({ length: k }, (_, i) => i + 1).every((r) => m.has(r))
  );
  return {
    arm,
    planned_cells: mine.length,
    attempted_cells: mine.filter((c) => c.attempts > 0).length,
    scored_cells: count("scored"),
    unscored_cells: count("unscored"),
    pending_cells: count("pending"),
    unrun_cells: count("unrun"),
    unknown_spend_cells: unknown.length,
    unknown_spend_terminal_cells:
      unknown.filter((c) => c.status === "scored" || c.status === "unscored")
        .length,
    total_spend_usd: known(mine),
    pending_spend_usd: known(mine.filter((c) => c.status === "pending")),
    cost_per_solved_task: statistic("cost_per_solved_task", [
      ...taskStats(mine, "cost_per_solved_task").values(),
    ]),
    pass_rate: statistic("pass_rate", [
      ...taskStats(mine, "pass_rate").values(),
    ]),
    pass_k: full.length === 0
      ? null
      : full.filter((m) => [...m.values()].every(Boolean)).length /
        full.length,
    pass_k_tasks: full.length,
    provisional: count("pending") + count("unrun") > 0,
  };
}

export interface Comparison {
  metric: PrimaryMetric;
  baseline: string;
  variant: string;
  /** Matched (task, repeat) pairs eligible in both arms. */
  pairs: number;
  /** Tasks with at least one matched pair; the bootstrap unit. */
  tasks: number;
  /** Tasks planned but without any matched pair. */
  tasks_dropped: number;
  /** Unmatched pairs by the reason each arm's cell was ineligible. */
  excluded: {
    baseline: Partial<Record<ExclusionReason, number>>;
    variant: Partial<Record<ExclusionReason, number>>;
  };
  /** variant minus baseline over matched pairs; null when undefined. */
  delta: number | null;
  /**
   * Null when suppressed by the zero-solve rule: any undefined resample
   * (suppress_any_undefined) or a defined share below the threshold
   * (min_defined_share, then over the defined resamples only).
   */
  ci: [number, number] | null;
  level: number;
  undefined_share: number;
  /** false = "not distinguishable" (CI includes zero). null = suppressed. */
  distinguishable: boolean | null;
  resamples: number;
  seed: number;
  provisional: boolean;
  /**
   * EXPLORATORY, not pre-registered (M6-02d): the same percentile interval
   * over the defined resamples only, from the same draws. It is CONDITIONAL
   * on at least one solve per arm and has no nominal coverage: not a
   * confidence interval: `lo`/`hi` are conditional, non-inferential bounds
   * over the defined resamples only, and conditioning on solves can bias
   * them, including their direction (M6-02e); they are not evidence of a
   * difference. Never replaces `ci`, never feeds `distinguishable`.
   * Equals `ci` whenever `ci` is shown and at least
   * `minDefinedResamples(level)` resamples are defined; null when fewer are
   * defined. Absent (undefined) in pre-M6-02d reports.
   */
  exploratory_ci_defined_only?: ExploratoryInterval | null;
  /** Bootstrap p of delta = 0; null when suppressed; absent in pre-M11 reports. */
  p_value?: number | null;
  values?: { baseline: number | null; variant: number | null };
  zero_solve?: ZeroSolveRule;
  /**
   * Present only for the studentized bootstrap (M11-09b). `p_value` is then the
   * bootstrap-t p, and the legacy `delta`, percentile `ci`, `distinguishable`
   * and `undefined_share` stay as the percentile path computes them.
   */
  method?: "bootstrap-t";
  /** Log ratio of aggregate cost per solved (variant over baseline); null when undefined. */
  theta?: number | null;
  se?: number | null;
  t?: number | null;
  /** Bootstrap-t interval for theta at `level`; null when suppressed. */
  ci_log?: [number, number] | null;
  ci_ratio?: [number, number] | null;
  /** Share of resamples with an undefined (theta*, SE*). */
  bt_undefined_share?: number;
}

export interface ExploratoryInterval {
  lo: number;
  hi: number;
  level: number;
  resamples_used: number;
  undefined_share: number;
}

/** The labelled exploratory line; never a headline (M6-02d). */
export function exploratoryText(
  e: ExploratoryInterval,
  resamples: number,
  f: (x: number) => string,
): string {
  // A share just under 100% (or just over 0%) never prints as 100% (0%).
  const share = Math.round((e.resamples_used / resamples) * 1000) / 10;
  const used = e.resamples_used === resamples
    ? 100
    : Math.min(Math.max(share, 0.1), 99.9);
  return `exploratory (not pre-registered): conditional ${+(e.level * 100)
    .toFixed(
      2,
    )}% percentile interval over the ${used}% of resamples with a solve in both arms (${e.resamples_used} of ${resamples}), not a confidence interval: [${
    f(e.lo)
  }, ${
    f(e.hi)
  }]; conditioning on solves can bias this interval, including its direction; it is not evidence of a difference`;
}

/**
 * Fewest defined resamples for an exploratory interval: ceil(1 / alpha),
 * alpha = (1 - level) / 2, so each tail holds at least one resample
 * (40 at 95%). The epsilon absorbs float error in 1 / alpha.
 */
export function minDefinedResamples(level: number): number {
  return Math.ceil(2 / (1 - level) - 1e-9);
}

/**
 * The exploratory line beside a suppressed CI, or null: nothing beside a
 * shown CI (it would equal it), for a pre-M6-02d report (field absent) or
 * when the delta itself is undefined (then no resample is defined either).
 */
export function exploratoryNote(
  c: Comparison,
  f: (x: number) => string,
): string | null {
  const e = c.exploratory_ci_defined_only;
  if (c.ci !== null || e === undefined || c.delta === null) return null;
  if (e !== null) return exploratoryText(e, c.resamples, f);
  const used = c.resamples - Math.round(c.undefined_share * c.resamples);
  return `exploratory interval omitted: only ${used} of ${c.resamples} resamples defined (< ${
    minDefinedResamples(c.level)
  })`;
}

export type ZeroSolveRule =
  | { rule: "suppress_any_undefined" }
  | { rule: "min_defined_share"; share: number };

export interface BootstrapOptions {
  resamples?: number;
  seed?: number;
  level?: number;
  /** Default suppress_any_undefined (v1 rule 4). */
  zeroSolve?: ZeroSolveRule;
  /**
   * Inference method. Default "percentile" (the legacy path, byte-identical
   * output). "bootstrap-t" (M11-09b) adds the studentized log-ratio inference
   * and applies to cost_per_solved_task only.
   */
  method?: "percentile" | "bootstrap-t";
}

function checkMethod(opts: BootstrapOptions, metric: PrimaryMetric): void {
  if (opts.method === "bootstrap-t" && metric !== "cost_per_solved_task") {
    const msg = "bootstrap-t is defined for cost_per_solved_task";
    throw new ValidationError(msg, [msg]);
  }
}

/** One arm's signed contribution to a log-ratio contrast. */
interface Term {
  sign: 1 | -1;
  stats: Map<string, TaskStat>;
}

/**
 * Delta-method statistic of a log cost-per-solved contrast over a task sample
 * (duplicates allowed), equal task weight. Per arm X with per-task mean spend
 * c_X_i and solve rate s_X_i: C_X = mean_i c_X_i, S_X = mean_i s_X_i, and
 * L_X = log(C_X / S_X).
 *   theta = sum_X sign_X * L_X
 *   influence_i = sum_X sign_X * [(c_X_i - C_X)/C_X - (s_X_i - S_X)/S_X]
 *   SE = sd(influence) / sqrt(n), sd with the (n - 1) denominator.
 * Pairwise: variant +1, baseline -1. Interaction: RL +1, R -1, L -1, P +1.
 * Null (undefined) when n < 2, any C_X or S_X is 0 or non-finite, or SE is 0
 * or non-finite.
 */
function logRatioStat(
  terms: Term[],
  sample: string[],
): { theta: number; se: number } | null {
  const n = sample.length;
  if (n < 2) return null;
  const infl = new Array<number>(n).fill(0);
  let theta = 0;
  for (const { sign, stats } of terms) {
    const rows = sample.map((t) => stats.get(t)!);
    const C = mean(rows.map((r) => r.spend));
    const S = mean(rows.map((r) => r.solved));
    if (!(C > 0 && S > 0 && Number.isFinite(C) && Number.isFinite(S))) {
      return null;
    }
    theta += sign * (Math.log(C) - Math.log(S));
    rows.forEach((r, i) => {
      infl[i]! += sign * ((r.spend - C) / C - (r.solved - S) / S);
    });
  }
  const mi = mean(infl);
  const sdv = Math.sqrt(sum(infl.map((x) => (x - mi) ** 2)) / (n - 1));
  const se = sdv / Math.sqrt(n);
  if (!(se > 0) || !Number.isFinite(se) || !Number.isFinite(theta)) return null;
  return { theta, se };
}

/**
 * Adds the bootstrap-t fields (and its p_value) to a legacy comparison.
 * Symmetric studentized bootstrap (orchestrator implementation ruling under
 * decisions\2026-10-03-m11-inference-amendment.md). With t*_b = (theta*_b -
 * theta_hat) / SE*_b over the n defined resamples and t_hat = theta_hat /
 * SE_hat:
 *   p = (#{|t*_b| >= |t_hat|} + 1) / (n + 1)
 *   q = percentile(|t*|, level)
 *   ci_log = [theta_hat - q * SE_hat, theta_hat + q * SE_hat]; ci_ratio = exp.
 * The Bonferroni interval is the same at level 1 - alpha/m.
 */
function withBootstrapT(
  res: Comparison,
  terms: Term[],
  tasks: string[],
  resamples: number,
  seed: number,
  level: number,
  rule: ZeroSolveRule,
): Comparison {
  const hat = logRatioStat(terms, tasks);
  if (hat === null) {
    return {
      ...res,
      method: "bootstrap-t",
      theta: null,
      se: null,
      t: null,
      ci_log: null,
      ci_ratio: null,
      bt_undefined_share: 1,
      p_value: null,
    };
  }
  const draws = drawTasks(tasks, resamples, seed, (sample) => {
    const r = logRatioStat(terms, sample);
    return r === null ? null : (r.theta - hat.theta) / r.se;
  });
  const ts = draws.values;
  const tHat = hat.theta / hat.se;
  const shown = allowed(rule, draws.undefined_share) && ts.length > 0;
  const abs = ts.map(Math.abs);
  const q = shown ? percentile(abs, level) : 0;
  const ci_log: [number, number] | null = shown
    ? [hat.theta - q * hat.se, hat.theta + q * hat.se]
    : null;
  const ge = abs.filter((x) => x >= Math.abs(tHat)).length;
  return {
    ...res,
    method: "bootstrap-t",
    theta: hat.theta,
    se: hat.se,
    t: tHat,
    ci_log,
    ci_ratio: ci_log === null
      ? null
      : [Math.exp(ci_log[0]), Math.exp(ci_log[1])],
    bt_undefined_share: draws.undefined_share,
    p_value: shown ? (ge + 1) / (ts.length + 1) : null,
  };
}

/** The resample loop (one mulberry32 stream per seed): the same draws as v1 compareArms. */
export function drawTasks(
  tasks: string[],
  resamples: number,
  seed: number,
  f: (sample: string[]) => number | null,
): { values: number[]; undefined_share: number } {
  const rand = mulberry32(seed);
  const values: number[] = [];
  for (let i = 0; i < resamples; i++) {
    const d = f(tasks.map(() => tasks[Math.floor(rand() * tasks.length)]!));
    if (d !== null) values.push(d);
  }
  return { values, undefined_share: (resamples - values.length) / resamples };
}

/** Two-sided percentile bootstrap p of delta = 0 with the +1 correction. */
export function bootstrapP(deltas: readonly number[]): number {
  const n = deltas.length;
  if (n === 0) return 1;
  const le = deltas.filter((d) => d <= 0).length;
  const ge = deltas.filter((d) => d >= 0).length;
  return Math.min(1, (2 * Math.min(le + 1, ge + 1)) / (n + 1));
}

function checkAlpha(alpha: number): void {
  if (!(Number.isFinite(alpha) && alpha > 0 && alpha < 1)) {
    const msg = `alpha must be finite and between 0 and 1, got ${alpha}`;
    throw new ValidationError(msg, [msg]);
  }
}

/** Holm step-down; a null p ranks as 1 and never rejects; ties keep order. */
export function holm(
  ps: readonly (number | null)[],
  alpha: number,
): { adjusted: number[]; reject: boolean[] } {
  checkAlpha(alpha);
  const m = ps.length;
  const order = ps.map((p, i) => ({ p: p ?? 1, i })).sort((a, b) =>
    a.p - b.p || a.i - b.i
  );
  const adjusted = new Array<number>(m);
  let run = 0;
  order.forEach(({ p, i }, k) => {
    run = Math.max(run, Math.min(1, (m - k) * p));
    adjusted[i] = run;
  });
  return {
    adjusted,
    reject: adjusted.map((a, i) => ps[i] !== null && a <= alpha),
  };
}

export type Decision = "variant_lower" | "variant_higher" | "no_decision";
export function decide(delta: number | null, rejected: boolean): Decision {
  if (!rejected || delta === null || delta === 0) return "no_decision";
  return delta < 0 ? "variant_lower" : "variant_higher";
}

function allowed(rule: ZeroSolveRule, undefinedShare: number): boolean {
  return rule.rule === "suppress_any_undefined"
    ? undefinedShare === 0
    : 1 - undefinedShare >= rule.share;
}

export function checkBootstrapOptions(opts: BootstrapOptions): void {
  const errors: string[] = [];
  const { resamples = 2000, seed = 1, level = 0.95 } = opts;
  if (!Number.isInteger(resamples) || resamples < 1) {
    errors.push(`resamples must be a positive integer, got ${resamples}`);
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    errors.push(`seed must be an integer in 0..0xffffffff, got ${seed}`);
  }
  if (!(level > 0 && level < 1)) {
    errors.push(`level must be between 0 and 1, got ${level}`);
  }
  if (
    opts.zeroSolve?.rule === "min_defined_share" &&
    !(opts.zeroSolve.share > 0 && opts.zeroSolve.share <= 1)
  ) {
    errors.push(
      `zeroSolve.share must be in (0, 1], got ${opts.zeroSolve.share}`,
    );
  }
  if (errors.length > 0) {
    throw new ValidationError(errors.join("; "), errors);
  }
}

/** Paired task-level bootstrap of variant minus baseline over matched pairs. */
export function compareArms(
  cells: Cell[],
  baseline: string,
  variant: string,
  metric: PrimaryMetric,
  opts: BootstrapOptions = {},
): Comparison {
  checkCells(cells);
  checkBootstrapOptions(opts);
  checkMethod(opts, metric);
  const resamples = opts.resamples ?? 2000;
  const seed = opts.seed ?? 1;
  const level = opts.level ?? 0.95;
  const arm = (name: string) =>
    new Map(
      cells.filter((c) => c.arm === name).map((
        c,
      ) => [key(c.task, c.repeat), c]),
    );
  const b = arm(baseline);
  const v = arm(variant);
  const excluded: Comparison["excluded"] = { baseline: {}, variant: {} };
  const matchedB: Cell[] = [];
  const matchedV: Cell[] = [];
  const allTasks = new Set<string>();
  for (const k of new Set([...b.keys(), ...v.keys()])) {
    const cb = b.get(k);
    const cv = v.get(k);
    allTasks.add((cb ?? cv)!.task);
    const rb = cb ? ineligible(cb, metric) : "missing";
    const rv = cv ? ineligible(cv, metric) : "missing";
    if (rb === null && rv === null) {
      matchedB.push(cb!);
      matchedV.push(cv!);
      continue;
    }
    if (rb) excluded.baseline[rb] = (excluded.baseline[rb] ?? 0) + 1;
    if (rv) excluded.variant[rv] = (excluded.variant[rv] ?? 0) + 1;
  }
  const sb = taskStats(matchedB, metric);
  const sv = taskStats(matchedV, metric);
  const tasks = [...sb.keys()].sort();
  const delta = (sample: string[]): number | null => {
    const xb = statistic(metric, sample.map((t) => sb.get(t)!));
    const xv = statistic(metric, sample.map((t) => sv.get(t)!));
    return xb === null || xv === null ? null : xv - xb;
  };
  const provisional = cells.some((c) =>
    (c.arm === baseline || c.arm === variant) &&
    (c.status === "pending" || c.status === "unrun")
  );
  const base = {
    metric,
    baseline,
    variant,
    pairs: matchedB.length,
    tasks: tasks.length,
    tasks_dropped: allTasks.size - tasks.length,
    excluded,
    level,
    resamples,
    seed,
    provisional,
    values: {
      baseline: statistic(metric, tasks.map((t) => sb.get(t)!)),
      variant: statistic(metric, tasks.map((t) => sv.get(t)!)),
    },
  };
  const rule = opts.zeroSolve ?? { rule: "suppress_any_undefined" as const };
  const legacy: Comparison = tasks.length === 0
    ? {
      ...base,
      delta: null,
      ci: null,
      undefined_share: 1,
      distinguishable: null,
      p_value: null,
      zero_solve: rule,
      exploratory_ci_defined_only: null,
    }
    : finish(
      base,
      delta(tasks),
      drawTasks(tasks, resamples, seed, delta),
      level,
      rule,
    );
  return opts.method === "bootstrap-t"
    ? withBootstrapT(
      legacy,
      [{ sign: 1, stats: sv }, { sign: -1, stats: sb }],
      tasks,
      resamples,
      seed,
      level,
      rule,
    )
    : legacy;
}

function finish(
  base: Omit<
    Comparison,
    | "delta"
    | "ci"
    | "undefined_share"
    | "distinguishable"
    | "exploratory_ci_defined_only"
  >,
  point: number | null,
  draws: { values: number[]; undefined_share: number },
  level: number,
  rule: ZeroSolveRule,
): Comparison {
  const deltas = draws.values;
  const alpha = (1 - level) / 2;
  // One interval over the draws already made; no second draw.
  const defined: [number, number] | null = deltas.length === 0
    ? null
    : [percentile(deltas, alpha), percentile(deltas, 1 - alpha)];
  const ci = allowed(rule, draws.undefined_share) ? defined : null;
  return {
    ...base,
    delta: point,
    ci,
    undefined_share: draws.undefined_share,
    distinguishable: ci === null ? null : !(ci[0] <= 0 && 0 <= ci[1]),
    p_value: ci === null ? null : bootstrapP(deltas),
    zero_solve: rule,
    exploratory_ci_defined_only: defined === null ||
        deltas.length < minDefinedResamples(level)
      ? null
      : {
        lo: defined[0],
        hi: defined[1],
        level,
        resamples_used: deltas.length,
        undefined_share: draws.undefined_share,
      },
  };
}

export interface InteractionArms {
  plain: string;
  lsp: string;
  realistic: string;
  realistic_lsp: string;
}

/** (RL - R) - (L - P) over (task, repeat) blocks eligible in all four arms; incomplete blocks under excluded.baseline.missing. */
export function compareInteraction(
  cells: Cell[],
  a: InteractionArms,
  metric: PrimaryMetric,
  opts: BootstrapOptions = {},
): Comparison {
  checkCells(cells);
  checkBootstrapOptions(opts);
  checkMethod(opts, metric);
  const resamples = opts.resamples ?? 2000;
  const seed = opts.seed ?? 1;
  const level = opts.level ?? 0.95;
  const names = [a.plain, a.lsp, a.realistic, a.realistic_lsp];
  const byArm = names.map((n) =>
    new Map(
      cells.filter((c) => c.arm === n).map((c) => [key(c.task, c.repeat), c]),
    )
  );
  const keys = new Set(byArm.flatMap((m) => [...m.keys()]));
  const kept: Cell[][] = names.map(() => []);
  let pairs = 0;
  for (const k of keys) {
    const cs = byArm.map((m) => m.get(k));
    if (cs.every((c) => c !== undefined && ineligible(c, metric) === null)) {
      cs.forEach((c, i) => kept[i]!.push(c!));
      pairs++;
    }
  }
  const stats = kept.map((cs) => taskStats(cs, metric));
  const tasks = [...stats[0]!.keys()].sort();
  const f = (sample: string[]): number | null => {
    const s = stats.map((m) => statistic(metric, sample.map((t) => m.get(t)!)));
    if (s.some((x) => x === null)) return null;
    const [p, l, r, rl] = s as number[];
    return (rl! - r!) - (l! - p!);
  };
  const allTasks = new Set(
    cells.filter((c) => names.includes(c.arm)).map((c) => c.task),
  );
  const base = {
    metric,
    baseline: a.plain,
    variant: a.realistic_lsp,
    pairs,
    tasks: tasks.length,
    tasks_dropped: allTasks.size - tasks.length,
    excluded: { baseline: { missing: keys.size - pairs }, variant: {} },
    level,
    resamples,
    seed,
    provisional: cells.some((c) =>
      names.includes(c.arm) && (c.status === "pending" || c.status === "unrun")
    ),
    values: { baseline: null, variant: null },
  };
  const rule = opts.zeroSolve ?? { rule: "suppress_any_undefined" as const };
  const legacy: Comparison = tasks.length === 0
    ? {
      ...base,
      delta: null,
      ci: null,
      undefined_share: 1,
      distinguishable: null,
      p_value: null,
      zero_solve: rule,
      exploratory_ci_defined_only: null,
    }
    : finish(
      base,
      f(tasks),
      drawTasks(tasks, resamples, seed, f),
      level,
      rule,
    );
  const signs = [1, -1, -1, 1] as const;
  return opts.method === "bootstrap-t"
    ? withBootstrapT(
      legacy,
      stats.map((m, i) => ({ sign: signs[i]!, stats: m })),
      tasks,
      resamples,
      seed,
      level,
      rule,
    )
    : legacy;
}

export interface ContrastSpec {
  id: string;
  name: string;
  baseline: string;
  variant: string;
}
export interface ContrastResult extends Comparison {
  id: string;
  name: string;
  confirmatory: boolean;
  p_holm: number | null;
  decision: Decision;
  bonferroni_ci: [number, number] | null;
  /** Bootstrap-t interval at the Bonferroni level (bootstrap-t rows only). */
  bonferroni_ci_log?: [number, number] | null;
  bonferroni_ci_ratio?: [number, number] | null;
  ratio: number | null;
}

/** Holm over exactly `family` (ids in pre-registered order, "interaction" for the interaction). */
export function testContrasts(
  cells: Cell[],
  contrasts: ContrastSpec[],
  interaction: (InteractionArms & { name: string }) | null,
  metric: PrimaryMetric,
  o: {
    resamples: number;
    seed: number;
    level: number;
    alpha: number;
    zeroSolve: ZeroSolveRule;
    family: readonly string[];
    /** Default "bootstrap-t" for cost_per_solved_task. */
    method?: "percentile" | "bootstrap-t";
  },
): ContrastResult[] {
  checkAlpha(o.alpha);
  const ids = contrasts.map((c) => c.id);
  const bad = ids.filter((id, i) =>
    id === "interaction" || ids.indexOf(id) !== i
  );
  if (bad.length > 0) {
    const msg = `contrast ids must be unique and not "interaction", got ${
      [...new Set(bad)].join(",")
    }`;
    throw new ValidationError(msg, [msg]);
  }
  // Confirmatory inference is bootstrap-t for the cost metric. The percentile
  // fallback for other metrics keeps pass_rate callers working (bootstrap-t
  // itself refuses pass_rate).
  const method = o.method ??
    (metric === "cost_per_solved_task" ? "bootstrap-t" : "percentile");
  const boot = {
    resamples: o.resamples,
    seed: o.seed,
    zeroSolve: o.zeroSolve,
    method,
  };
  const rows: {
    id: string;
    name: string;
    run: (level: number) => Comparison;
  }[] = contrasts.map((c) => ({
    id: c.id,
    name: c.name,
    run: (level) =>
      compareArms(cells, c.baseline, c.variant, metric, { ...boot, level }),
  }));
  if (interaction) {
    rows.push({
      id: "interaction",
      name: interaction.name,
      run: (level) =>
        compareInteraction(cells, interaction, metric, { ...boot, level }),
    });
  }
  const missingIds = o.family.filter((id) => !rows.some((r) => r.id === id));
  if (missingIds.length > 0 || new Set(o.family).size !== o.family.length) {
    const msg = `family ${o.family.join(",")} does not match the contrasts (${
      rows.map((r) => r.id).join(",")
    })`;
    throw new ValidationError(msg, [msg]);
  }
  const results = new Map(rows.map((r) => [r.id, r.run(o.level)]));
  const h = holm(
    o.family.map((id) => results.get(id)!.p_value ?? null),
    o.alpha,
  );
  const bonf = 1 - o.alpha / o.family.length;
  return rows.map((r) => {
    const c = results.get(r.id)!;
    const v = c.values;
    const ratio = v && v.baseline !== null && v.variant !== null &&
        v.baseline !== 0
      ? v.variant / v.baseline
      : null;
    const j = o.family.indexOf(r.id);
    if (j < 0) {
      return {
        ...c,
        id: r.id,
        name: r.name,
        confirmatory: false,
        p_holm: null,
        decision: "no_decision" as const,
        bonferroni_ci: null,
        ...(method === "bootstrap-t"
          ? { bonferroni_ci_log: null, bonferroni_ci_ratio: null }
          : {}),
        ratio,
      };
    }
    // One Bonferroni-level run serves the percentile and the bootstrap-t interval.
    const bc = c.ci !== null || c.ci_log != null ? r.run(bonf) : null;
    return {
      ...c,
      id: r.id,
      name: r.name,
      confirmatory: true,
      p_holm: c.p_value == null ? null : h.adjusted[j]!,
      // Bootstrap-t rows decide direction from theta (log scale); the dollar
      // delta can differ in sign or vanish for the interaction.
      decision: decide(
        c.method === "bootstrap-t" ? c.theta ?? null : c.delta,
        h.reject[j]!,
      ),
      bonferroni_ci: c.ci === null ? null : bc!.ci,
      ...(method === "bootstrap-t"
        ? {
          bonferroni_ci_log: c.ci_log == null ? null : bc!.ci_log ?? null,
          bonferroni_ci_ratio: c.ci_log == null ? null : bc!.ci_ratio ?? null,
        }
        : {}),
      ratio,
    };
  });
}
