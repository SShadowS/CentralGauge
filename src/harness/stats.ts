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
 * - Paired task-level bootstrap. If any resample is undefined (no solve), the
 *   CI and the distinguishable verdict are suppressed.
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
function ineligible(c: Cell, metric: PrimaryMetric): ExclusionReason | null {
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
  /** Suppressed (null) when any resample is undefined. */
  ci: [number, number] | null;
  level: number;
  undefined_share: number;
  /** false = "not distinguishable" (CI includes zero). null = suppressed. */
  distinguishable: boolean | null;
  resamples: number;
  seed: number;
  provisional: boolean;
}

export interface BootstrapOptions {
  resamples?: number;
  seed?: number;
  level?: number;
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
  };
  if (tasks.length === 0) {
    return {
      ...base,
      delta: null,
      ci: null,
      undefined_share: 1,
      distinguishable: null,
    };
  }
  const rand = mulberry32(seed);
  const deltas: number[] = [];
  for (let i = 0; i < resamples; i++) {
    const d = delta(tasks.map(() => tasks[Math.floor(rand() * tasks.length)]!));
    if (d !== null) deltas.push(d);
  }
  const undefinedShare = (resamples - deltas.length) / resamples;
  const alpha = (1 - level) / 2;
  const ci: [number, number] | null = undefinedShare > 0
    ? null
    : [percentile(deltas, alpha), percentile(deltas, 1 - alpha)];
  return {
    ...base,
    delta: delta(tasks),
    ci,
    undefined_share: undefinedShare,
    distinguishable: ci === null ? null : !(ci[0] <= 0 && 0 <= ci[1]),
  };
}
