// Usage:
//   Stage A: deno run --allow-read --allow-write scripts/harness/power-sim.ts
//     --cells <report.json>... --arm-prefix cc- --rules harness-tasks/v2/screening.yml
//     --out <file> [--sims 1000] [--resamples 1000] [--confirm-sims 500]
//     [--confirm-resamples 10000] [--seed 20261003] [--pool-factor 2.0]
//     [--rule-b-share 0.99] [--interaction exploratory|confirmatory] [--resume]
//   Stage B: the same with --prereg harness/preregistration/<exp>.yml, which takes
//     rule, family, alpha and every argument from the frozen stage A and refuses
//     any flag that differs.
// Simulates the frozen v2 pipeline: M8 screening and selection, the campaign,
// and the pre-registered inference (compareArms, compareInteraction, holm).

import { parseArgs } from "@std/cli/parse-args";
import * as colors from "@std/fmt/colors";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";
import {
  type Cell,
  checkCells,
  compareArms,
  compareInteraction,
  type ContrastSpec,
  holm,
  ineligible,
  type InteractionArms,
  mulberry32,
  testContrasts,
  type ZeroSolveRule,
} from "../../src/harness/stats.ts";
import { hashJson, sha256Hex } from "../../src/harness/hash.ts";
import { type Prereg, PreregSchema } from "../../src/harness/prereg.ts";
import {
  type Eligible,
  type Rules,
  RulesSchema,
  select,
  stratumOf,
} from "./screening.ts";

export interface Fit {
  log_mean: number;
  task_sd: number;
  cell_sd: number;
  arm_sd: number;
  solved_ratio: number;
  unknown_share: number;
  /** Confirmation-only sensitivity (round 2 finding 2): skewed costs, arm-dependent missingness, wider solve heterogeneity. */
  sens?: "skew" | "arm_missing" | "hetero" | undefined;
}
export const SENSITIVITY = ["skew", "arm_missing", "hetero"] as const;
export const SIM_ARMS = ["plain", "lsp", "real", "real_lsp"] as const;
export type SimArm = (typeof SIM_ARMS)[number];
export const CONTRASTS = [
  { id: "C1", baseline: "plain", variant: "lsp" },
  { id: "C2", baseline: "real", variant: "real_lsp" },
  { id: "C3", baseline: "plain", variant: "real" },
] as const;
const INTERACTION = {
  plain: "plain",
  lsp: "lsp",
  realistic: "real",
  realistic_lsp: "real_lsp",
};
export type ScenarioName = "null" | "C1" | "C2" | "C3";
/** Affected arms and, analytically, the non-null family members with their expected sign. */
export const SCENARIOS: Record<
  ScenarioName,
  {
    arms: SimArm[];
    signs: Record<string, -1 | 1>;
    target: { baseline: SimArm; variant: SimArm } | null;
  }
> = {
  null: { arms: [], signs: {}, target: null },
  C1: {
    arms: ["lsp"],
    signs: { C1: -1, interaction: 1 },
    target: { baseline: "plain", variant: "lsp" },
  },
  C2: {
    arms: ["real_lsp"],
    signs: { C2: -1, interaction: -1 },
    target: { baseline: "real", variant: "real_lsp" },
  },
  C3: {
    arms: ["real", "real_lsp"],
    signs: { C3: -1 },
    target: { baseline: "plain", variant: "real" },
  },
};
export type FamilyId = "C1" | "C2" | "C3" | "interaction";
export type Truth = Record<FamilyId, number>;
/** Defined values of a partial per-contrast record. */
const props = (r: Partial<Record<FamilyId, Prop>>): Prop[] =>
  Object.values(r).filter((p): p is Prop => p !== undefined);
export interface Design {
  tasks: number;
  repeats: number;
}
export interface RunSpec {
  scenario: ScenarioName;
  mechanism: "spend" | "solve";
  fit: Fit;
  multiplier: number;
  poolFactor: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
function normal(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) *
    Math.cos(2 * Math.PI * rand());
}

/**
 * Concatenates cell files keeping task and arm (the statistical identity) and
 * makes (task, arm, repeat) unique by shifting a later file's repeats for a
 * task above the largest repeat the earlier files used for that task in any
 * arm, so a file's (task, repeat) blocks stay aligned across arms.
 */
export function poolCells(files: Cell[][]): Cell[] {
  const top = new Map<string, number>();
  const out: Cell[] = [];
  for (const file of files) {
    const before = new Map(top);
    for (const c of file) {
      // Per task, not per (task, arm): every arm of a file's block shifts
      // alike, so (task, repeat) blocks stay aligned across arms.
      const k = c.task;
      const r = c.repeat + (before.get(k) ?? 0);
      top.set(k, Math.max(top.get(k) ?? 0, r));
      out.push({ ...c, repeat: r });
    }
  }
  return out;
}

export function fitCells(cells: Cell[]): Fit {
  checkCells(cells);
  const term = cells.filter((c) =>
    c.status === "scored" || c.status === "unscored"
  );
  const known = term.filter((c) => c.spend_usd !== null && c.spend_usd > 0);
  const group = (k: (c: Cell) => string) => {
    const m = new Map<string, Cell[]>();
    for (const c of known) m.set(k(c), [...(m.get(k(c)) ?? []), c]);
    return m;
  };
  const logs = (cs: Cell[]) => cs.map((c) => Math.log(c.spend_usd!));
  const byTask = group((c) => c.task);
  const byTaskArm = group((c) => `${c.task}\u0000${c.arm}`);
  const taskMean = new Map([...byTask].map(([t, cs]) => [t, mean(logs(cs))]));
  const within = [...byTaskArm.values()].flatMap((cs) => {
    const m = mean(logs(cs));
    return logs(cs).map((x) => x - m);
  });
  const armDev = [...byTaskArm.values()].map((cs) =>
    mean(logs(cs)) - taskMean.get(cs[0]!.task)!
  );
  const solvedDiff = [...byTask.values()].flatMap((cs) => {
    const s = cs.filter((c) => c.pass === true);
    const u = cs.filter((c) => c.pass !== true);
    return s.length > 0 && u.length > 0 ? [mean(logs(s)) - mean(logs(u))] : [];
  });
  return {
    log_mean: mean([...taskMean.values()]),
    task_sd: sd([...taskMean.values()]),
    cell_sd: within.length < 2
      ? 0
      : Math.sqrt(within.reduce((a, x) => a + x * x, 0) / (within.length - 1)),
    arm_sd: sd(armDev),
    solved_ratio: solvedDiff.length === 0 ? 1 : Math.exp(mean(solvedDiff)),
    unknown_share: term.filter((c) => c.spend_usd === null).length /
      term.length,
  };
}

export interface SimTask {
  id: string;
  p: number;
  mu: number;
  dev: Record<SimArm, number>;
  kind: Eligible["kind"];
  coupling: string[];
  large: boolean;
}

const PRIOR = [
  "easy",
  "easy",
  ...Array(8).fill("intermediate"),
  "hard",
  "hard",
] as const;
const KIND_CYCLE: Eligible["kind"][] = [
  "feature",
  "feature",
  "feature",
  "feature",
  "bugfix",
  "bugfix",
  "bugfix",
  "refactor",
  "refactor",
  "refactor",
  "test-authoring",
  "test-authoring",
];

export function drawPool(
  n: number,
  run: RunSpec,
  rules: Rules,
  rand: () => number,
): SimTask[] {
  const size = Math.ceil(run.poolFactor * n);
  return Array.from({ length: size }, (_, i) => {
    const prior = PRIOR[i % 12]!;
    const wide = run.fit.sens === "hetero";
    const p = prior === "easy"
      ? (wide ? 0.7 + 0.29 * rand() : 0.8 + 0.17 * rand())
      : prior === "hard"
      ? (wide ? 0.01 + 0.29 * rand() : 0.03 + 0.17 * rand())
      : (wide ? 0.1 + 0.8 * rand() : 0.2 + 0.6 * rand());
    return {
      id: `S${String(i).padStart(3, "0")}`,
      p,
      mu: run.fit.log_mean + run.fit.task_sd * normal(rand),
      dev: Object.fromEntries(
        SIM_ARMS.map((a) => [a, run.fit.arm_sd * normal(rand)]),
      ) as Record<SimArm, number>,
      kind: KIND_CYCLE[i % 12]!,
      coupling: i % 4 === 0
        ? [rules.required_coupling[(i / 4) % rules.required_coupling.length]!]
        : [],
      large: i % 12 < 8,
    };
  });
}

const affected = (run: RunSpec, a: SimArm) =>
  SCENARIOS[run.scenario].arms.includes(a);
export const pArm = (t: SimTask, a: SimArm, run: RunSpec) =>
  run.mechanism === "solve" && affected(run, a)
    ? Math.min(0.98, t.p * run.multiplier)
    : t.p;
const spendMult = (a: SimArm, run: RunSpec) =>
  run.mechanism === "spend" && affected(run, a) ? run.multiplier : 1;

/** M8's screening and selection on a simulated pool; null on a shortfall. */
export function selectTasks(
  design: Design,
  run: RunSpec,
  rules: Rules,
  rand: () => number,
): SimTask[] | null {
  const pool = drawPool(design.tasks, run, rules, rand);
  const eligible: Eligible[] = [];
  for (const t of pool) {
    let solved = 0;
    for (const a of ["plain", "real_lsp"] as const) {
      for (let i = 0; i < rules.repeats; i++) {
        if (rand() < pArm(t, a, run)) solved++;
      }
    }
    const s = stratumOf(solved, 2 * rules.repeats);
    if (s !== "dead" && s !== "saturated") {
      eligible.push({
        id: t.id,
        stratum: s,
        kind: t.kind,
        coupling: t.coupling,
        large: t.large,
      });
    }
  }
  const rank = new Map(pool.map((t) => [t.id, rand().toFixed(12)]));
  const sel = select(eligible, design.tasks, rules, rank);
  if (sel.shortfalls.length > 0) return null;
  const byId = new Map(pool.map((t) => [t.id, t]));
  return sel.selected.map((id) => byId.get(id)!);
}

/**
 * Skew sensitivity (round 3 finding 2): a log-normal scale mixture with finite
 * moments. With probability SKEW_W the log-noise standard deviation is
 * SKEW_K x cell_sd, else cell_sd; the cost is right-skewed with a heavier tail
 * than the Gaussian fit, and E[exp(noise)] is exact (noiseMean).
 */
export const SKEW_W = 0.1;
export const SKEW_K = 3;
/** Exact E[exp(log-noise)] of a cell under the fit (Gaussian, or the skew mixture). */
export function noiseMean(fit: Fit): number {
  const s2 = fit.cell_sd ** 2;
  return fit.sens === "skew"
    ? (1 - SKEW_W) * Math.exp(s2 / 2) +
      SKEW_W * Math.exp((SKEW_K ** 2 * s2) / 2)
    : Math.exp(s2 / 2);
}
function logNoise(fit: Fit, rand: () => number): number {
  const scale = fit.sens === "skew" && rand() < SKEW_W
    ? SKEW_K * fit.cell_sd
    : fit.cell_sd;
  return scale * normal(rand);
}
/** Exact expected spend of task t in arm a with its drawn arm deviation (the coverage and calibration truth uses the same terms). */
export function expectedSpend(t: SimTask, a: SimArm, run: RunSpec): number {
  const half = Math.log(run.fit.solved_ratio) / 2;
  const p = pArm(t, a, run);
  return Math.exp(t.mu + t.dev[a]) * noiseMean(run.fit) * spendMult(a, run) *
    (p * Math.exp(half) + (1 - p) * Math.exp(-half));
}

export function simulateCells(
  tasks: SimTask[],
  repeats: number,
  run: RunSpec,
  rand: () => number,
): Cell[] {
  const half = Math.log(run.fit.solved_ratio) / 2;
  const out: Cell[] = [];
  for (const t of tasks) {
    for (let r = 1; r <= repeats; r++) {
      for (const a of SIM_ARMS) {
        const pass = rand() < pArm(t, a, run);
        const spend = Math.exp(
          t.mu + t.dev[a] + logNoise(run.fit, rand) + (pass ? half : -half),
        ) * spendMult(a, run);
        // arm_missing: the treated arms lose cost twice as often as plain.
        const share = run.fit.sens === "arm_missing" && a !== "plain"
          ? Math.min(1, 2 * run.fit.unknown_share)
          : run.fit.unknown_share;
        const unknown = rand() < share;
        out.push({
          task: t.id,
          arm: a,
          repeat: r,
          status: "scored",
          pass,
          spend_usd: unknown ? null : spend,
          known_spend_usd: spend,
          attempts: 1,
        });
      }
    }
  }
  return out;
}

/** P(a campaign bootstrap of B task resamples hits a resample with no solve in some arm), over blocks eligible in every arm. */
export function undefinedProb(
  cells: Cell[],
  arms: readonly string[],
  B: number,
): number {
  const byKey = new Map<string, Map<string, Cell>>();
  for (const c of cells.filter((x) => arms.includes(x.arm))) {
    const k = `${c.task}\u0000${c.repeat}`;
    byKey.set(k, (byKey.get(k) ?? new Map()).set(c.arm, c));
  }
  const solved = new Map<string, Set<string>>();
  const tasks = new Set<string>();
  for (const m of byKey.values()) {
    if (
      !arms.every((a) =>
        m.has(a) && ineligible(m.get(a)!, "cost_per_solved_task") === null
      )
    ) continue;
    const task = m.get(arms[0]!)!.task;
    tasks.add(task);
    for (const a of arms) {
      if (m.get(a)!.pass) {
        solved.set(task, (solved.get(task) ?? new Set()).add(a));
      }
    }
  }
  const T = tasks.size;
  if (T === 0) return 1;
  let q = 0;
  for (let mask = 1; mask < 1 << arms.length; mask++) {
    const S = arms.filter((_, i) => mask & (1 << i));
    const z = [...tasks].filter((t) =>
      S.every((a) => !solved.get(t)?.has(a))
    ).length;
    q += (S.length % 2 === 1 ? 1 : -1) * (z / T) ** T;
  }
  return 1 - (1 - q) ** B;
}

/** Population cost per solved per arm over the selected-task population (K selections, analytic within task). */
function populationCps(
  design: Design,
  run: RunSpec,
  rules: Rules,
  seed: number,
  K: number,
): Record<SimArm, number> {
  const rand = mulberry32(seed >>> 0);
  const half = Math.log(run.fit.solved_ratio) / 2;
  const spend = Object.fromEntries(SIM_ARMS.map((a) => [a, 0])) as Record<
    SimArm,
    number
  >;
  const solve = { ...spend };
  for (let k = 0; k < K; k++) {
    for (const t of selectTasks(design, run, rules, rand) ?? []) {
      for (const a of SIM_ARMS) {
        const p = pArm(t, a, run);
        // Arm deviations are integrated out analytically (same distribution in every arm), so unaffected arms are exactly equal.
        // Same noise term as simulateCells (noiseMean: Gaussian or the skew mixture, exact).
        spend[a] += Math.exp(t.mu + run.fit.arm_sd ** 2 / 2) *
          noiseMean(run.fit) * spendMult(a, run) *
          (p * Math.exp(half) + (1 - p) * Math.exp(-half));
        solve[a] += p;
      }
    }
  }
  return Object.fromEntries(
    SIM_ARMS.map((a) => [a, spend[a] / solve[a]]),
  ) as Record<SimArm, number>;
}

/** The pre-registered effect: a 30% lower population cost per solved on the target contrast (owner decision 2026-10-03-m11-inference-amendment.md). */
export const EFFECT_DEFAULT = 0.3;

/** Effect multiplier giving an `effect` (default 30%) lower population cost per solved on the scenario's target contrast; nulls are exactly 0. */
export function calibrate(
  spec: Omit<RunSpec, "multiplier">,
  design: Design,
  rules: Rules,
  seed: number,
  K = 200,
  effect = EFFECT_DEFAULT,
): { multiplier: number; ratio: number; truth: Truth; truth_log: Truth } {
  const sc = SCENARIOS[spec.scenario];
  const target = 1 - effect;
  const at = (m: number) =>
    populationCps(design, { ...spec, multiplier: m }, rules, seed, K);
  let multiplier = 1;
  if (sc.target) {
    if (spec.mechanism === "spend") multiplier = target;
    else {
      const ratio = (m: number) => {
        const c = at(m);
        return c[sc.target!.variant] / c[sc.target!.baseline];
      };
      let lo = 1;
      let hi = 3;
      if (ratio(hi) > target) {
        throw new Error(
          `${spec.scenario} solve: a ${
            Math.round(effect * 1000) / 10
          }% reduction is not reachable (solve rate cap)`,
        );
      }
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (ratio(mid) > target) lo = mid;
        else hi = mid;
      }
      multiplier = hi;
    }
  }
  const c = at(multiplier);
  const delta = (b: SimArm, v: SimArm) => c[v] - c[b];
  const truth: Truth = {
    C1: 0,
    C2: 0,
    C3: 0,
    interaction: sc.signs["interaction"]
      ? delta("real", "real_lsp") - delta("plain", "lsp")
      : 0,
  };
  for (const x of CONTRASTS) {
    truth[x.id] = sc.signs[x.id] ? delta(x.baseline, x.variant) : 0;
  }
  // Log-scale truth (bootstrap-t interval coverage): log cps ratio, exactly 0 for null members.
  const lg = (b: SimArm, v: SimArm) => Math.log(c[v]) - Math.log(c[b]);
  const truth_log: Truth = {
    C1: 0,
    C2: 0,
    C3: 0,
    interaction: sc.signs["interaction"]
      ? lg("real", "real_lsp") - lg("plain", "lsp")
      : 0,
  };
  for (const x of CONTRASTS) {
    truth_log[x.id] = sc.signs[x.id] ? lg(x.baseline, x.variant) : 0;
  }
  return {
    multiplier,
    ratio: sc.target ? c[sc.target.variant] / c[sc.target.baseline] : 1,
    truth,
    truth_log,
  };
}

export interface Prop {
  p: number;
  n: number;
  mcse: number;
}
const prop = (x: number, n: number): Prop => {
  const p = n === 0 ? 0 : x / n;
  return { p, n, mcse: n === 0 ? 0 : Math.sqrt((p * (1 - p)) / n) };
};
export interface RuleStats {
  power: Partial<Record<FamilyId, Prop>>;
  type1: Partial<Record<FamilyId, Prop>>;
  fwer: Prop | null;
  suppressed: Prop;
  coverage: Partial<Record<FamilyId, Prop>>;
}
export type FitName = "fitted" | "stress" | (typeof SENSITIVITY)[number];
export interface DesignResult {
  design: Design;
  scenario: string;
  mechanism: RunSpec["mechanism"];
  fit: FitName;
  /** true when suppression was read from the actual shared bootstrap draws (confirmation pass). */
  exact: boolean;
  multiplier: number;
  selection_failures: Prop;
  byRule: { A: RuleStats; B: RuleStats };
}

export function evaluate(
  design: Design,
  spec: RunSpec & { fitName: FitName; truth: Truth; truth_log: Truth },
  o: {
    sims: number;
    resamples: number;
    campaignResamples: number;
    seed: number;
    alpha: number;
    ruleBShare: number;
    family: string[];
    rules: Rules;
    exact?: boolean;
  },
): DesignResult {
  const rand = mulberry32(o.seed >>> 0);
  const signs = SCENARIOS[spec.scenario].signs;
  const fam = o.family;
  const counts = () => ({
    hit: Object.fromEntries(fam.filter((id) => signs[id]).map((id) => [id, 0])),
    t1: Object.fromEntries(fam.filter((id) => !signs[id]).map((id) => [id, 0])),
    fw: 0,
    sup: 0,
    cov: Object.fromEntries(fam.map((id) => [id, [0, 0]])) as Record<
      string,
      number[]
    >,
  });
  const by = { A: counts(), B: counts() };
  let fails = 0;
  let ran = 0;
  const loose: ZeroSolveRule = {
    rule: "min_defined_share",
    share: Number.EPSILON,
  };
  const ruleOf = {
    A: { rule: "suppress_any_undefined" } as ZeroSolveRule,
    B: { rule: "min_defined_share", share: o.ruleBShare } as ZeroSolveRule,
  };
  const specs: ContrastSpec[] = CONTRASTS.map((c) => ({ ...c, name: c.id }));
  const interArms = fam.includes("interaction")
    ? { ...INTERACTION, name: "interaction" }
    : null;
  for (let s = 0; s < o.sims; s++) {
    const tasks = selectTasks(design, spec, o.rules, rand);
    if (tasks === null) {
      fails++;
      continue;
    }
    ran++;
    const cells = simulateCells(tasks, design.repeats, spec, rand);
    const seed = (o.seed + s) >>> 0;
    // Grid: one uniform per replicate for all contrasts (comonotone, approximate).
    const u = rand();
    interface Out {
      id: string;
      sup: boolean;
      /** Type I event for a null member; the grid keeps the raw Holm rejection. */
      rejected: boolean;
      /** The expected-sign decision was reached. */
      hit: (sign: -1 | 1) => boolean;
      /** Bootstrap-t interval on the log scale (covers truth_log). */
      ci: [number, number] | null;
    }
    const outs: Record<"A" | "B", Out[]> = { A: [], B: [] };
    if (o.exact) {
      // Confirmation: both rules read from the shared entry point the analysis uses.
      for (const key of ["A", "B"] as const) {
        const rows = testContrasts(
          cells,
          specs,
          interArms,
          "cost_per_solved_task",
          {
            resamples: o.resamples,
            seed,
            level: 0.95,
            alpha: o.alpha,
            zeroSolve: ruleOf[key],
            family: fam,
          },
        );
        outs[key] = fam.map((id) => {
          const r = rows.find((x) => x.id === id)!;
          const sup = r.p_value === null || r.ci_log == null;
          return {
            id,
            sup,
            rejected: r.decision !== "no_decision",
            hit: (sign) =>
              r.decision === (sign < 0 ? "variant_lower" : "variant_higher"),
            ci: sup ? null : r.ci_log!,
          };
        });
      }
    } else {
      const boot = {
        resamples: o.resamples,
        seed,
        level: 0.95,
        zeroSolve: loose,
        method: "bootstrap-t" as const,
      };
      const comps = fam.map((id) => {
        if (id === "interaction") {
          return {
            id,
            c: compareInteraction(
              cells,
              INTERACTION,
              "cost_per_solved_task",
              boot,
            ),
            arms: [...SIM_ARMS] as string[],
          };
        }
        const x = CONTRASTS.find((k) => k.id === id)!;
        return {
          id,
          c: compareArms(
            cells,
            x.baseline,
            x.variant,
            "cost_per_solved_task",
            boot,
          ),
          arms: [x.baseline, x.variant] as string[],
        };
      });
      // Rule A stays the analytic undefinedProb (zero-solve resamples only):
      // an approximation, it ignores resamples with SE* = 0 that bootstrap-t
      // also counts undefined. Rule B reads the bootstrap-t undefined share.
      const supA = comps.map((x) =>
        u < undefinedProb(cells, x.arms, o.campaignResamples)
      );
      const supB = comps.map((x) =>
        1 - (x.c.bt_undefined_share ?? 1) < o.ruleBShare ||
        x.c.ci_log == null
      );
      for (const [key, sup] of [["A", supA], ["B", supB]] as const) {
        const ps = comps.map((x, i) => (sup[i] ? null : x.c.p_value ?? null));
        const h = holm(ps, o.alpha);
        outs[key] = comps.map((x, i) => ({
          id: x.id,
          sup: sup[i]!,
          rejected: h.reject[i]!,
          hit: (sign) => h.reject[i]! && Math.sign(x.c.delta ?? 0) === sign,
          ci: sup[i] ? null : x.c.ci_log ?? null,
        }));
      }
    }
    for (const key of ["A", "B"] as const) {
      const k = by[key];
      let anyNull = false;
      for (const x of outs[key]) {
        const sign = signs[x.id];
        if (sign) {
          if (x.hit(sign)) k.hit[x.id]!++;
        } else if (x.rejected) {
          k.t1[x.id]!++;
          anyNull = true;
        }
        if (x.ci) {
          k.cov[x.id]![1]!++;
          const tv = spec.truth_log[x.id as FamilyId];
          if (x.ci[0] <= tv && tv <= x.ci[1]) k.cov[x.id]![0]!++;
        }
      }
      if (anyNull) k.fw++;
      if (outs[key].some((x) => x.sup)) k.sup++;
    }
  }
  const stats = (k: ReturnType<typeof counts>): RuleStats => ({
    power: Object.fromEntries(
      Object.entries(k.hit).map(([id, x]) => [id, prop(x, ran)]),
    ),
    type1: Object.fromEntries(
      Object.entries(k.t1).map(([id, x]) => [id, prop(x, ran)]),
    ),
    fwer: Object.keys(k.t1).length > 0 ? prop(k.fw, ran) : null,
    suppressed: prop(k.sup, ran),
    coverage: Object.fromEntries(
      Object.entries(k.cov).map(([id, [c, n]]) => [id, prop(c!, n!)]),
    ),
  });
  return {
    design,
    scenario: spec.scenario,
    mechanism: spec.mechanism,
    fit: spec.fitName,
    exact: o.exact === true,
    multiplier: spec.multiplier,
    selection_failures: prop(fails, o.sims),
    byRule: { A: stats(by.A), B: stats(by.B) },
  };
}

const ALPHA = 0.05;
/** Fixed-count tolerance (round 2 finding 5, round 4 finding 3): reference 1000 replicates, never widens with fewer, derived from the frozen alpha. */
export const fwerTol = (alpha: number): number =>
  alpha + 2 * Math.sqrt((alpha * (1 - alpha)) / 1000);
export const FWER_TOL = fwerTol(ALPHA);
export const MIN_GATING_SIMS = 500;
const fwerOk = (s: RuleStats, alpha: number) =>
  s.fwer === null || s.fwer.p <= fwerTol(alpha);
const coverageOk = (s: RuleStats) =>
  props(s.coverage).every((c) => c.n >= 100 && c.p >= 0.93);
function enoughSims(results: DesignResult[]): void {
  const low = results.filter((r) =>
    [r.byRule.A, r.byRule.B].some((s) => s.suppressed.n < MIN_GATING_SIMS)
  );
  if (low.length > 0) {
    throw new Error(
      `too few simulations for a gating decision: ${low.length} results under ${MIN_GATING_SIMS} replicates`,
    );
  }
}

export function chooseRule(
  results: DesignResult[],
  ruleBShare: number,
  alpha = ALPHA,
): ZeroSolveRule {
  enoughSims(results);
  const meanSup = (k: "A" | "B") =>
    mean(results.map((r) => r.byRule[k].suppressed.p));
  const bOk =
    results.every((r) => fwerOk(r.byRule.B, alpha) && coverageOk(r.byRule.B)) &&
    meanSup("B") < meanSup("A");
  return bOk
    ? { rule: "min_defined_share", share: ruleBShare }
    : { rule: "suppress_any_undefined" };
}

/** Confirmation gate: the exact grid passes chooseDesign and every sensitivity result keeps FWER and coverage; all need MIN_GATING_SIMS. */
export function confirmDesign(
  exact: DesignResult[],
  sens: DesignResult[],
  key: "A" | "B",
  alpha: number,
  powerScenario: PowerScenario = "fitted",
): boolean {
  enoughSims([...exact, ...sens]);
  return chooseDesign(exact, key, alpha, powerScenario) !== null &&
    sens.every((r) =>
      fwerOk(r.byRule[key], alpha) && coverageOk(r.byRule[key])
    );
}

const EXPECTED = [
  "null|spend",
  "C1|spend",
  "C1|solve",
  "C2|spend",
  "C2|solve",
  "C3|spend",
  "C3|solve",
]
  .flatMap((s) => ["fitted", "stress"].map((f) => `${s}|${f}`));

/** Which results the power >= 0.8 gate applies to (owner amendment: fitted only). Stress power is always computed and reported. */
export type PowerScenario = "fitted" | "all";

export function chooseDesign(
  results: DesignResult[],
  key: "A" | "B",
  alpha = ALPHA,
  powerScenario: PowerScenario = "fitted",
): Design | null {
  enoughSims(results);
  const designs = [
    ...new Map(
      results.map((r) => [`${r.design.tasks}x${r.design.repeats}`, r.design]),
    ).values(),
  ]
    .sort((a, b) =>
      a.tasks * a.repeats - b.tasks * b.repeats || a.repeats - b.repeats
    );
  for (const d of designs) {
    const mine = results.filter((r) =>
      r.design.tasks === d.tasks && r.design.repeats === d.repeats &&
      (r.fit === "fitted" || r.fit === "stress")
    );
    const have = new Set(
      mine.map((r) => `${r.scenario}|${r.mechanism}|${r.fit}`),
    );
    const lack = EXPECTED.filter((e) => !have.has(e));
    if (lack.length > 0) {
      throw new Error(
        `simulation grid incomplete for ${d.tasks}x${d.repeats}: ${
          lack.join(", ")
        }`,
      );
    }
    const pass = mine.every((r) => {
      const s = r.byRule[key];
      const powerOk = powerScenario === "all" || r.fit === "fitted"
        ? props(s.power).every((p) => p.p >= 0.8)
        : true;
      return powerOk && fwerOk(s, alpha) &&
        s.suppressed.p < 0.05 &&
        r.selection_failures.p < 0.05 && coverageOk(s);
    });
    if (pass) return d;
  }
  return null;
}

// ---------------------------------------------------------------- CLI

const GRID_DESIGNS: Design[] = [24, 30, 40].flatMap((tasks) =>
  [3, 5, 8].map((repeats) => ({ tasks, repeats }))
);

export interface GridSpec {
  tasks: number[];
  repeats: number[];
}

/** `--grid 40,50,60x8,12,16`: tasks x repeats, tasks outer (M11-13c). */
export function parseGrid(s: string): Design[] {
  const g = parseGridSpec(s);
  return g.tasks.flatMap((tasks) =>
    g.repeats.map((repeats) => ({ tasks, repeats }))
  );
}

function parseGridSpec(s: string): GridSpec {
  const sides = s.split("x");
  if (sides.length !== 2) {
    throw new Error(`--grid ${s}: expected <tasks list>x<repeats list>`);
  }
  const [tasks, repeats] = sides.map((side) => {
    const vals = side.split(",").map((v) => {
      if (!/^[1-9]\d*$/.test(v)) {
        throw new Error(
          `--grid ${s}: "${v}" is not a positive integer`,
        );
      }
      return Number(v);
    });
    if (new Set(vals).size !== vals.length) {
      throw new Error(`--grid ${s}: duplicate value in ${side}`);
    }
    if (vals.length > 5) {
      throw new Error(`--grid ${s}: at most 5 values per list`);
    }
    return vals;
  }) as [number[], number[]];
  return { tasks, repeats };
}

/** `--effect`: relative cost-per-solved reduction, in the open interval (0, 0.9). */
export function parseEffect(v: unknown): number {
  const n = typeof v === "number" ? v : v === "" ? NaN : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n >= 0.9) {
    throw new Error(`--effect must be in (0, 0.9), got ${String(v)}`);
  }
  return n;
}

/**
 * Stage B never takes --grid or --effect: a non-default grid cannot be
 * pre-registered (PreregSchema simulation.args holds numbers only), and the
 * effect is the frozen one.
 */
export function stageBFlagProblem(
  flags: { grid?: unknown; effect?: unknown },
): string | null {
  const bad = ["grid", "effect"].filter((f) =>
    (flags as Record<string, unknown>)[f] !== undefined
  );
  return bad.length === 0
    ? null
    : `--${
      bad.join(" and --")
    } are refused in stage B (--prereg): the frozen pipeline uses the default grid and the pre-registered effect`;
}

/** Stage B effect: the frozen simulation.args.effect when present, else the default. */
export function stageBEffect(frozen: Record<string, number>): number {
  return frozen["effect"] === undefined
    ? EFFECT_DEFAULT
    : parseEffect(frozen["effect"]);
}

/**
 * The args record: the numeric keys, the effective effect and power_gate
 * ALWAYS (M11-09b, decision 2026-10-03-m11-inference-amendment.md; this
 * intentionally changes args_sha256 versus earlier runs), plus grid only when
 * --grid was given.
 */
export function simArgsRecord(
  args: SimArgs,
  sweep: { effect: number; grid?: GridSpec | null },
): Record<string, unknown> {
  return {
    ...args,
    effect: sweep.effect,
    power_gate: "fitted",
    ...(sweep.grid ? { grid: sweep.grid } : {}),
  };
}

/** What binds into args_sha256 (and the resume check). */
export function argsHashInput(
  p: {
    stage: "A" | "B";
    args: SimArgs;
    alpha: number;
    family: string[];
    rules: Rules;
    rule: ZeroSolveRule | null;
    inputs: { path: string; sha256: string }[];
    arm_prefix: string;
  },
  sweep: { effect: number; grid?: GridSpec | null },
) {
  return { ...p, args: simArgsRecord(p.args, sweep) };
}
const PAIRS: { scenario: ScenarioName; mechanism: "spend" | "solve" }[] = [
  { scenario: "null", mechanism: "spend" },
  ...(["C1", "C2", "C3"] as const).flatMap((scenario) =>
    (["spend", "solve"] as const).map((mechanism) => ({ scenario, mechanism }))
  ),
];
const NUMERIC = [
  ["sims", "sims", 1000],
  ["resamples", "resamples", 1000],
  ["confirm-sims", "confirm_sims", 500],
  ["confirm-resamples", "confirm_resamples", 10000],
  ["seed", "seed", 20261003],
  ["pool-factor", "pool_factor", 2.0],
  ["rule-b-share", "rule_b_share", 0.99],
] as const;

interface SimArgs {
  sims: number;
  resamples: number;
  confirm_sims: number;
  confirm_resamples: number;
  seed: number;
  pool_factor: number;
  rule_b_share: number;
}

const resultKey = (r: DesignResult) =>
  `${r.design.tasks}x${r.design.repeats}|${r.scenario}|${r.mechanism}|${r.fit}|${r.exact}`;
const fmt = (p: Prop | undefined) =>
  p ? `${p.p.toFixed(2)} (se ${p.mcse.toFixed(3)})` : "n/a";
const minOf = (xs: Prop[]): Prop | undefined =>
  xs.length === 0 ? undefined : xs.reduce((a, b) => (b.p < a.p ? b : a));

function describe(r: DesignResult): string {
  const [a, b] = [r.byRule.A, r.byRule.B];
  return `[sim] ${r.design.tasks}x${r.design.repeats} ${r.scenario} ${r.mechanism} ${r.fit}${
    r.exact ? " exact" : ""
  }: power A ${fmt(minOf(props(a.power)))} B ${
    fmt(minOf(props(b.power)))
  }, fwer A ${a.fwer?.p.toFixed(3) ?? "n/a"}, sup A ${
    a.suppressed.p.toFixed(3)
  }, cov A ${minOf(props(a.coverage))?.p.toFixed(3) ?? "n/a"}`;
}

/**
 * The inference a stage-B run must simulate, in simulation arm names: the
 * frozen family, contrasts and interaction mapped through the protocol. Throws
 * when the frozen bootstrap or contrasts are not what this simulation models.
 */
export function stageBContract(doc: Prereg, args: SimArgs): {
  family: string[];
  contrasts: ContrastSpec[];
  interaction: (InteractionArms & { name: string }) | null;
} {
  const fail = (m: string): never => {
    throw new Error(`pre-registration contract: ${m}`);
  };
  if (doc.bootstrap.level !== 0.95) {
    fail(`bootstrap level ${doc.bootstrap.level} is not the simulated 0.95`);
  }
  if (doc.bootstrap.resamples !== args.confirm_resamples) {
    fail(
      `bootstrap resamples ${doc.bootstrap.resamples} differ from confirm_resamples ${args.confirm_resamples}`,
    );
  }
  // M11-13b: the simulation certifies confirmatory decisions only; an
  // exploratory-only pre-registration makes none (never substitute C1-C3).
  if (!doc.confirmatory || doc.family.length === 0) {
    fail(
      "an exploratory-only pre-registration (not confirmatory, or an empty family) has no decisions to simulate",
    );
  }
  const modeled = ["C1", "C2", "C3", "interaction"];
  if (new Set(doc.family).size !== doc.family.length) {
    fail(`family ${doc.family.join(",")} has duplicates`);
  }
  const unknown = doc.family.filter((id) => !modeled.includes(id));
  if (unknown.length > 0) {
    fail(`family ids ${unknown.join(",")} are not modeled by this simulation`);
  }
  // M11-13b: unique before the map (a Map keeps the last duplicate), as testContrasts refuses.
  const ids = doc.protocol.contrasts.map((c) => c.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup !== undefined) fail(`duplicate protocol contrast id ${dup}`);
  const byId = new Map(doc.protocol.contrasts.map((c) => [c.id, c]));
  const [c1, c2, c3] = ["C1", "C2", "C3"].map((id) =>
    byId.get(id) ?? fail(`protocol has no contrast ${id}`)
  ) as [
    Prereg["protocol"]["contrasts"][number],
    Prereg["protocol"]["contrasts"][number],
    Prereg["protocol"]["contrasts"][number],
  ];
  const real: Record<SimArm, string> = {
    plain: c1.baseline,
    lsp: c1.variant,
    real: c2.baseline,
    real_lsp: c2.variant,
  };
  if (new Set(Object.values(real)).size !== 4) {
    fail("C1 and C2 must name four distinct arms");
  }
  if (c3.baseline !== real.plain || c3.variant !== real.real) {
    fail("C3 must be (C1 baseline, C2 baseline)");
  }
  let interaction: (InteractionArms & { name: string }) | null = null;
  if (doc.family.includes("interaction")) {
    const i = doc.protocol.interaction ??
      fail("family has the interaction but the protocol does not");
    if (
      i.plain !== real.plain || i.lsp !== real.lsp ||
      i.realistic !== real.real || i.realistic_lsp !== real.real_lsp
    ) fail("the interaction arms differ from the C1 and C2 arms");
    interaction = { ...INTERACTION, name: i.name };
  }
  return {
    family: doc.family,
    contrasts: [c1, c2, c3].map((c) => ({
      id: c.id,
      name: c.name,
      baseline: Object.entries(real).find(([, v]) => v === c.baseline)![0],
      variant: Object.entries(real).find(([, v]) => v === c.variant)![0],
    })),
    interaction,
  };
}

/** The first line of a partial file: the arguments and the code fingerprint its results belong to. */
export const resumeHeader = (argsSha: string, scriptSha: string): string =>
  JSON.stringify({ args_sha256: argsSha, script_sha256: scriptSha }) + "\n";

/** Refuses a partial file written with other arguments or by other code (the fingerprint is bound before any result is reused). */
export function checkResumeHeader(
  line: string,
  argsSha: string,
  scriptSha: string,
): void {
  const head = JSON.parse(line || "{}") as {
    args_sha256?: string;
    script_sha256?: string;
  };
  if (head.args_sha256 !== argsSha) {
    throw new Error("partial file was written with other arguments");
  }
  if (head.script_sha256 !== scriptSha) {
    throw new Error("partial file was written by other code");
  }
}

function bad(msg: string): never {
  console.error(colors.red(`[FAIL] ${msg}`));
  Deno.exit(2);
}

async function main(): Promise<void> {
  const here = (rel: string) => fromFileUrl(new URL(rel, import.meta.url));
  const script_sha256 = await hashJson(
    await Promise.all(
      [
        here("./power-sim.ts"),
        here("./screening.ts"),
        here("../../src/harness/stats.ts"),
      ]
        .map(async (p) => await sha256Hex(await Deno.readFile(p))),
    ),
  );
  const a = parseArgs(Deno.args, {
    string: [
      "out",
      "arm-prefix",
      "rules",
      "prereg",
      "interaction",
      "sims",
      "resamples",
      "confirm-sims",
      "confirm-resamples",
      "seed",
      "pool-factor",
      "rule-b-share",
      "grid",
      "effect",
    ],
    boolean: ["resume"],
    collect: ["cells"],
  });
  const flagged = (f: string) => a[f] !== undefined;
  const cellFiles = (a.cells ?? []) as string[];
  if (!a.out || !a["arm-prefix"] || !a.rules || cellFiles.length === 0) {
    bad("need --cells, --arm-prefix, --rules and --out");
  }
  const num = (flag: string): number | undefined => {
    if (!flagged(flag)) return undefined;
    const v = Number(a[flag]);
    if (!Number.isFinite(v) || v <= 0) {
      bad(`--${flag} must be a positive number, got ${a[flag]}`);
    }
    return v;
  };
  const cli = Object.fromEntries(NUMERIC.map(([f, k]) => [k, num(f)]));
  if (
    a.interaction !== undefined &&
    !["exploratory", "confirmatory"].includes(a.interaction)
  ) {
    bad("--interaction must be exploratory or confirmatory");
  }

  // Stage B: every argument from the frozen stage A; any differing flag is refused.
  let stage: "A" | "B" = "A";
  let alpha = ALPHA;
  let family: string[];
  let frozenRule: ZeroSolveRule | null = null;
  const args = {} as SimArgs;
  // M11-13c sweep flags (stage A); the effective effect is always recorded (M11-09b).
  let effect = EFFECT_DEFAULT;
  let gridSpec: GridSpec | null = null;
  let gridDesigns = GRID_DESIGNS;
  if (a.prereg !== undefined) {
    stage = "B";
    const problem = stageBFlagProblem({ grid: a.grid, effect: a.effect });
    if (problem) bad(problem);
    const doc = PreregSchema.parse(parse(await Deno.readTextFile(a.prereg)));
    frozenRule = doc.zero_solve;
    alpha = doc.alpha;
    for (const [flag, k] of NUMERIC) {
      const v = doc.simulation.args[k];
      if (v === undefined) bad(`pre-registration simulation.args lacks ${k}`);
      if (cli[k] !== undefined && cli[k] !== v) {
        bad(`--${flag} ${cli[k]} differs from the frozen stage A value ${v}`);
      }
      args[k] = v;
    }
    // The frozen effect when present, else EFFECT_DEFAULT; always recorded.
    try {
      effect = stageBEffect(doc.simulation.args);
    } catch (e) {
      bad((e as Error).message);
    }
    // The evaluated rule B share must be the frozen one, not just a flag value.
    if (
      frozenRule.rule === "min_defined_share" &&
      args.rule_b_share !== frozenRule.share
    ) {
      bad(
        `rule_b_share ${args.rule_b_share} differs from the frozen rule share ${frozenRule.share}`,
      );
    }
    // The family is the contract's (M11-13b): never discarded or substituted.
    try {
      family = stageBContract(doc, args).family;
    } catch (e) {
      bad((e as Error).message);
    }
    if (
      a.interaction !== undefined &&
      (a.interaction === "confirmatory") !== family.includes("interaction")
    ) {
      bad("--interaction differs from the frozen family");
    }
  } else {
    for (const [, k, def] of NUMERIC) args[k] = cli[k] ?? def;
    if (flagged("grid") || flagged("effect")) {
      try {
        if (flagged("effect")) effect = parseEffect(a.effect);
        if (flagged("grid")) {
          gridSpec = parseGridSpec(a.grid!);
          gridDesigns = parseGrid(a.grid!);
        }
      } catch (e) {
        bad((e as Error).message);
      }
      if (gridSpec !== null || effect !== EFFECT_DEFAULT) {
        console.log(
          colors.yellow(
            "[WARN] --grid/--effect given: this is a diagnostic sweep, not the frozen pipeline",
          ),
        );
      }
    }
    family = [
      "C1",
      "C2",
      "C3",
      ...(a.interaction === "confirmatory" ? ["interaction"] : []),
    ];
  }
  if (
    !Number.isInteger(args.sims) || !Number.isInteger(args.resamples) ||
    !Number.isInteger(args.confirm_sims) ||
    !Number.isInteger(args.confirm_resamples) || !Number.isInteger(args.seed)
  ) {
    bad(
      "sims, resamples, confirm-sims, confirm-resamples and seed must be integers",
    );
  }

  const sweep = { effect, grid: gridSpec };
  const diagnostic = stage === "A" &&
    (gridSpec !== null || effect !== EFFECT_DEFAULT);

  const out = a.out;
  const partial = `${out}.partial.jsonl`;
  const exists = async (p: string) =>
    await Deno.stat(p).then(() => true, () => false);
  if (await exists(out)) bad(`${out} already exists`);
  if (!a.resume && await exists(partial)) {
    bad(`${partial} exists: pass --resume to continue it`);
  }

  const rules = RulesSchema.parse(
    (parse(await Deno.readTextFile(a.rules)) as { rules?: unknown }).rules,
  );
  const prefix = a["arm-prefix"];
  const inputs: { path: string; sha256: string }[] = [];
  const files: Cell[][] = [];
  for (const path of cellFiles) {
    const bytes = await Deno.readFile(path);
    inputs.push({ path, sha256: await sha256Hex(bytes) });
    const doc = JSON.parse(new TextDecoder().decode(bytes)) as {
      cells?: Cell[];
    };
    if (!Array.isArray(doc.cells)) bad(`${path} has no cells array`);
    files.push(doc.cells.filter((c) => c.arm.startsWith(prefix)));
  }
  const cells = poolCells(files);
  if (cells.length === 0) bad(`no cells with an arm starting ${prefix}`);
  const fitted = fitCells(cells);
  const stress = {
    ...fitted,
    task_sd: fitted.task_sd * 1.5,
    arm_sd: fitted.arm_sd * 2,
  };
  const fits: Record<"fitted" | "stress", Fit> = { fitted, stress };

  const argsSha = await hashJson(argsHashInput({
    stage,
    args,
    alpha,
    family,
    rules,
    rule: frozenRule,
    inputs,
    arm_prefix: prefix,
  }, sweep));
  const done = new Map<string, DesignResult>();
  if (a.resume && await exists(partial)) {
    const lines = (await Deno.readTextFile(partial)).split("\n").filter((l) =>
      l.trim() !== ""
    );
    try {
      checkResumeHeader(lines[0] ?? "{}", argsSha, script_sha256);
    } catch (e) {
      bad(`${partial}: ${(e as Error).message}`);
    }
    for (const l of lines.slice(1)) {
      const r = JSON.parse(l) as DesignResult;
      done.set(resultKey(r), r);
    }
    console.log(
      colors.cyan(`[sim] resuming with ${done.size} finished results`),
    );
  } else {
    Deno.writeTextFileSync(
      partial,
      resumeHeader(argsSha, script_sha256),
    );
  }

  const base = {
    alpha,
    ruleBShare: args.rule_b_share!,
    family,
    rules,
    seed: args.seed!,
  };
  const runOne = (
    design: Design,
    pair: (typeof PAIRS)[number],
    fitName: FitName,
    exact: boolean,
  ): DesignResult => {
    const probe = {
      design,
      scenario: pair.scenario,
      mechanism: pair.mechanism,
      fit: fitName,
      exact,
    };
    const cached = done.get(
      resultKey(probe as unknown as DesignResult),
    );
    if (cached) return cached;
    const fit = fitName === "fitted" || fitName === "stress"
      ? fits[fitName]
      : { ...fits.fitted, sens: fitName };
    const spec = {
      scenario: pair.scenario,
      mechanism: pair.mechanism,
      fit,
      poolFactor: args.pool_factor!,
    };
    const cal = calibrate(spec, design, rules, args.seed!, 200, effect);
    const result = evaluate(design, {
      ...spec,
      fitName,
      multiplier: cal.multiplier,
      truth: cal.truth,
      truth_log: cal.truth_log,
    }, {
      ...base,
      sims: exact ? args.confirm_sims! : args.sims!,
      resamples: exact ? args.confirm_resamples! : args.resamples!,
      // The campaign's resample count (the grid's rule A uses it analytically).
      campaignResamples: args.confirm_resamples!,
      exact,
    });
    done.set(resultKey(result), result);
    Deno.writeTextFileSync(partial, JSON.stringify(result) + "\n", {
      append: true,
    });
    console.log(describe(result));
    return result;
  };
  // Resumed results print nothing; the cached branch above returns them silently.

  const grid: DesignResult[] = [];
  for (const d of gridDesigns) {
    for (const p of PAIRS) {
      for (const f of ["fitted", "stress"] as const) {
        grid.push(runOne(d, p, f, false));
      }
    }
  }
  let zeroSolve: ZeroSolveRule;
  let design: Design | null;
  let confirmed = false;
  try {
    zeroSolve = frozenRule ?? chooseRule(grid, args.rule_b_share!, alpha);
    const key = zeroSolve.rule === "suppress_any_undefined" ? "A" : "B";
    let rest = grid;
    design = null;
    for (;;) {
      design = chooseDesign(rest, key, alpha);
      if (design === null) break;
      const d = design;
      const exact = PAIRS.flatMap((p) =>
        (["fitted", "stress"] as const).map((f) => runOne(d, p, f, true))
      );
      const sens = PAIRS.flatMap((p) =>
        SENSITIVITY.map((f) => runOne(d, p, f, true))
      );
      if (confirmDesign(exact, sens, key, alpha)) {
        confirmed = true;
        break;
      }
      console.log(
        colors.yellow(
          `[sim] ${d.tasks}x${d.repeats} fails confirmation, next design`,
        ),
      );
      rest = rest.filter((r) =>
        r.design.tasks !== d.tasks || r.design.repeats !== d.repeats
      );
    }
  } catch (e) {
    console.error(colors.red(`[FAIL] ${(e as Error).message}`));
    Deno.exit(1);
  }

  await Deno.writeTextFile(
    out,
    JSON.stringify(
      {
        v: 1,
        stage,
        script_sha256,
        args: simArgsRecord(args, sweep),
        alpha,
        family,
        inputs,
        fit: fitted,
        stress_fit: stress,
        results: [...done.values()],
        zero_solve: zeroSolve,
        decision: { design, confirmed },
        ...(diagnostic ? { diagnostic: true } : {}),
      },
      null,
      2,
    ) + "\n",
  );
  if (design === null) {
    console.log(
      colors.yellow(
        "[WARN] no design meets the frozen rule: owner amendment needed",
      ),
    );
  } else {
    console.log(
      colors.green(
        `[OK] zero-solve ${
          JSON.stringify(zeroSolve)
        }, design ${design.tasks}x${design.repeats}`,
      ),
    );
  }
}

if (import.meta.main) await main();
