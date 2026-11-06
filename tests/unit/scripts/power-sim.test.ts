import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { type Cell, mulberry32 } from "../../../src/harness/stats.ts";
import {
  additiveFit,
  argsHashInput,
  calibrate,
  checkResumeHeader,
  chooseDesign,
  chooseRule,
  confirmDesign,
  type DesignResult,
  EFFECT_DEFAULT,
  evaluate,
  expectedSpend,
  fitCells,
  FWER_TOL,
  fwerTol,
  noiseMean,
  parseEffect,
  parseGrid,
  poolCells,
  restrictToTasks,
  resumeHeader,
  scriptSha256,
  selectTasks,
  simulateCells,
  stageBContract,
  stageBEffect,
  stageBFlagProblem,
  undefinedProb,
} from "../../../scripts/harness/power-sim.ts";
import { hashJson } from "../../../src/harness/hash.ts";
import { type Prereg, PreregSchema } from "../../../src/harness/prereg.ts";
import { RulesSchema } from "../../../scripts/harness/screening.ts";

const RULES = RulesSchema.parse({
  arms: ["cc-v2-plain", "cc-v2-realistic-lsp"],
  repeats: 3,
  easy_share: 0.2,
  hard_share: 0.2,
  kind_min: 2,
  kind_max_share: 0.4,
  required_coupling: ["single-instance", "temporary-table", "commit-behavior"],
  coupling_min: 1,
  large_min_share: 0.5,
  borrow: {
    easy: ["intermediate"],
    intermediate: ["hard", "easy"],
    hard: ["intermediate"],
  },
});
const FIT = {
  log_mean: Math.log(0.5),
  task_sd: 0.5,
  cell_sd: 0.4,
  arm_sd: 0.1,
  solved_ratio: 1.2,
  unknown_share: 0.05,
};
const cell = (
  task: string,
  arm: string,
  repeat: number,
  pass: boolean,
  spend: number | null = 1,
): Cell => ({
  task,
  arm,
  repeat,
  status: "scored",
  pass,
  spend_usd: spend,
  known_spend_usd: spend ?? 0,
  attempts: 1,
});

Deno.test("fitCells: log mean and unknown share from terminal cells", () => {
  // H-65 r2: a second arm, since one arm leaves no task x arm df (that layout
  // is now refused; see the zero-df test). Same cells per arm as before.
  const cs = [1, 2, 3, 4].flatMap((r) =>
    ["t1", "t2"].flatMap((t) =>
      ["a", "b"].map((a) =>
        cell(
          t,
          a,
          r,
          r % 2 === 0,
          r === 4 && t === "t2" && a === "a" ? null : 1,
        )
      )
    )
  );
  const f = fitCells(cs);
  assertAlmostEquals(f.log_mean, 0, 1e-12);
  assertEquals(f.unknown_share, 1 / 16);
});

// H-65 (decision 2026-11-06-m11-sim-model-fix-and-mining.md): synthetic cell
// sets with known parameters. log cost = mu_t + offset_a + dev_ta + noise.
function synth(o: {
  tasks: number;
  repeats: number;
  offsets: Record<string, number>;
  tau: number;
  sigma: number;
  seed: number;
}): Cell[] {
  const rand = mulberry32(o.seed);
  const z = () =>
    Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) *
    Math.cos(2 * Math.PI * rand());
  const out: Cell[] = [];
  for (let t = 0; t < o.tasks; t++) {
    const mu = -0.5 + 0.5 * z();
    for (const [arm, off] of Object.entries(o.offsets)) {
      const dev = o.tau * z();
      for (let r = 1; r <= o.repeats; r++) {
        out.push(
          cell(`t${t}`, arm, r, true, Math.exp(mu + off + dev + o.sigma * z())),
        );
      }
    }
  }
  return out;
}

Deno.test("fitCells (H-65): recovers a known arm offset, task x arm SD and cell SD", () => {
  const f = fitCells(synth({
    tasks: 600,
    repeats: 3,
    offsets: { "cc-a": -0.45, "cc-b": 0.45 },
    tau: 0.2,
    sigma: 0.44,
    seed: 65,
  }));
  assertAlmostEquals(f.arm_offsets!["cc-a"]!, -0.45, 0.03);
  assertAlmostEquals(f.arm_offsets!["cc-b"]!, 0.45, 0.03);
  assertAlmostEquals(f.cell_sd, 0.44, 0.015);
  assertAlmostEquals(f.arm_sd, 0.2, 0.04);
});

Deno.test("fitCells (H-65): a pure arm offset is no task x arm noise", () => {
  // Noise-free: exactly additive, so every variance component is 0.
  const exact = fitCells(synth({
    tasks: 20,
    repeats: 3,
    offsets: { "cc-a": -0.5, "cc-b": 0.5 },
    tau: 0,
    sigma: 0,
    seed: 1,
  }));
  assertAlmostEquals(exact.arm_sd, 0, 1e-9);
  assertAlmostEquals(exact.cell_sd, 0, 1e-9);
  assertAlmostEquals(exact.arm_offsets!["cc-b"]!, 0.5, 1e-9);
  // With within-cell noise the deconvolved arm_sd stays near 0 (tau^2 clamped).
  const noisy = fitCells(synth({
    tasks: 600,
    repeats: 3,
    offsets: { "cc-a": -0.5, "cc-b": 0.5 },
    tau: 0,
    sigma: 0.44,
    seed: 2,
  }));
  assert(noisy.arm_sd < 0.1, `arm_sd ${noisy.arm_sd}`);
  assertAlmostEquals(noisy.cell_sd, 0.44, 0.015);
});

Deno.test("fitCells (H-65): cell_sd divides the within sum of squares by N - groups", () => {
  // Four (task, arm) groups of logs {0, 2}: SS 8 over 8 - 4 = 4 df. (H-65 r2:
  // two tasks, since one task leaves no task x arm df.)
  const cs = ["t1", "t2"].flatMap((t) => [
    cell(t, "cc-a", 1, true, 1),
    cell(t, "cc-a", 2, true, Math.exp(2)),
    cell(t, "cc-b", 1, true, 1),
    cell(t, "cc-b", 2, true, Math.exp(2)),
  ]);
  assertAlmostEquals(fitCells(cs).cell_sd, Math.sqrt(2), 1e-12);
});

// H-65 r2 (Sol r1, selfcheck-sol-r1.md): the exact leverage-weighted noise
// term and the rank-aware residual df.
const grp = (task: string, arm: string, n: number, m = 0) => ({
  task,
  arm,
  n,
  m,
});

Deno.test("additiveFit (H-65 r2): Sol's counterexample subtracts sigma^2/3, not 7 sigma^2/15", () => {
  const f = additiveFit([
    grp("t1", "a", 3),
    grp("t1", "b", 3),
    grp("t2", "a", 3),
    grp("t2", "b", 3),
    grp("t3", "a", 1),
  ]);
  assertEquals([f.rank, f.df], [4, 1]);
  assertAlmostEquals(f.leverage[4]!, 1, 1e-12);
  assertAlmostEquals(f.noise, 1 / 3, 1e-12);
});

Deno.test("additiveFit (H-65 r2): a complete layout reduces to df * mean(1/n), even with unequal repeats", () => {
  const gs = ["t1", "t2", "t3", "t4"].flatMap((t, i) =>
    ["a", "b", "c"].map((a, j) => grp(t, a, 1 + ((i + 2 * j) % 4), i - j))
  );
  const f = additiveFit(gs);
  assertEquals(f.df, (4 - 1) * (3 - 1));
  const meanInv = gs.reduce((s, g) => s + 1 / g.n, 0) / gs.length;
  assertAlmostEquals(f.noise, f.df * meanInv, 1e-12);
  for (const h of f.leverage) {
    assertAlmostEquals(h, 1 / 4 + 1 / 3 - 1 / 12, 1e-12);
  }
});

Deno.test("additiveFit (H-65 r2): a disconnected task-arm incidence has df G - T - K + C", () => {
  // Tasks t1, t2 run arms a, b; tasks t3, t4 run arms c, d: C = 2 components.
  const gs = [
    ...["t1", "t2"].flatMap((t) => ["a", "b"].map((a) => grp(t, a, 3))),
    ...["t3", "t4"].flatMap((t) => ["c", "d"].map((a) => grp(t, a, 3))),
  ];
  const f = additiveFit(gs);
  assertEquals(f.rank, 4 + 4 - 2);
  assertEquals(f.df, 8 - 4 - 4 + 2);
});

Deno.test("additiveFit (H-65 r2): residuals are the least-squares residuals of the additive model on a noisy layout with missing groups", () => {
  const rand = mulberry32(7);
  const gs = Array.from({ length: 30 }, (_, i) => `t${i}`).flatMap((t, i) =>
    ["a", "b", "c"].filter((_, j) => (i + j) % 5 !== 0).map((a) =>
      grp(t, a, 1 + (i % 3), rand())
    )
  );
  const f = additiveFit(gs);
  assert(f.residuals.reduce((a, r) => a + r * r, 0) > 0.1);
  // The fitted values are additive: residuals are orthogonal to every task
  // and arm indicator.
  for (const key of ["task", "arm"] as const) {
    for (const v of new Set(gs.map((g) => g[key]))) {
      const s = gs.reduce(
        (a, g, i) => a + (g[key] === v ? f.residuals[i]! : 0),
        0,
      );
      assertAlmostEquals(s, 0, 1e-10);
    }
  }
  // ... and the fitted values m - r are additive: every complete 2 x 2
  // rectangle of (task, arm) groups has a zero interaction contrast.
  const fit = new Map(
    gs.map((g, i) => [`${g.task}|${g.arm}`, g.m - f.residuals[i]!]),
  );
  let rects = 0;
  for (let i = 0; i < 29; i++) {
    const [t, u] = [`t${i}`, `t${i + 1}`];
    const v = ["a", "b", "c"].map((
      a,
    ) => [fit.get(`${t}|${a}`), fit.get(`${u}|${a}`)]);
    for (let j = 0; j < 2; j++) {
      const [p, q] = [v[j]!, v[j + 1]!];
      if ([...p, ...q].some((x) => x === undefined)) continue;
      rects++;
      assertAlmostEquals(p[0]! - p[1]! - q[0]! + q[1]!, 0, 1e-10);
    }
  }
  assert(rects > 10);
});

/** Groups with missing arms and uneven repeats: half the tasks run one arm once. */
function synthMissing(seed: number, tau: number, sigma: number): Cell[] {
  const rand = mulberry32(seed);
  const z = () =>
    Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) *
    Math.cos(2 * Math.PI * rand());
  const off: Record<string, number> = { "cc-a": -0.45, "cc-b": 0.45 };
  const out: Cell[] = [];
  for (let t = 0; t < 1600; t++) {
    const mu = -0.5 + 0.5 * z();
    const arms = t % 2 === 0
      ? ["cc-a", "cc-b"]
      : [t % 4 === 1 ? "cc-a" : "cc-b"];
    for (const arm of arms) {
      const dev = tau * z();
      const n = arms.length === 1 ? 1 : 3;
      for (let r = 1; r <= n; r++) {
        out.push(
          cell(
            `t${t}`,
            arm,
            r,
            true,
            Math.exp(mu + off[arm]! + dev + sigma * z()),
          ),
        );
      }
    }
  }
  return out;
}

Deno.test("fitCells (H-65 r2): a noisy layout with missing groups recovers tau", () => {
  const f = fitCells(synthMissing(651, 0.2, 0.5));
  assertAlmostEquals(f.cell_sd, 0.5, 0.02);
  assertAlmostEquals(f.arm_sd, 0.2, 0.05);
});

Deno.test("fitCells (H-65 r2): zero residual or within df is refused, never read as zero variance", () => {
  const oneArm = [1, 2, 3].flatMap((r) =>
    ["t1", "t2"].map((t) => cell(t, "cc-a", r, true, Math.exp(r)))
  );
  assertThrows(() => fitCells(oneArm), Error, "task x arm residual df is 0");
  const singles = ["t1", "t2", "t3"].flatMap((t, i) =>
    ["cc-a", "cc-b"].map((a, j) => cell(t, a, 1, true, Math.exp(i * j)))
  );
  assertThrows(() => fitCells(singles), Error, "within-cell df N - G is 0");
  assertThrows(() => fitCells([]), Error, "df");
});

Deno.test("fitCells (H-65): unbalanced repeats and a missing (task, arm) group keep an exact additive fit", () => {
  const mu: Record<string, number> = { t1: 0, t2: 1, t3: -1, t4: 0.4 };
  const off: Record<string, number> = { "cc-a": -0.3, "cc-b": 0.3 };
  const cs: Cell[] = [];
  for (const t of Object.keys(mu)) {
    for (const a of Object.keys(off)) {
      if (t === "t4" && a === "cc-b") continue; // missing group
      const n = t === "t1" ? (a === "cc-a" ? 2 : 5) : 3;
      for (let r = 1; r <= n; r++) {
        cs.push(cell(t, a, r, true, Math.exp(mu[t]! + off[a]!)));
      }
    }
  }
  const f = fitCells(cs);
  assertAlmostEquals(f.arm_offsets!["cc-a"]!, -0.3, 1e-9);
  assertAlmostEquals(f.arm_offsets!["cc-b"]!, 0.3, 1e-9);
  assertAlmostEquals(f.arm_sd, 0, 1e-9);
  assertAlmostEquals(f.log_mean, 0.1, 1e-9);
});

Deno.test("fitCells (H-65): solved_ratio is read after the arm offsets are removed", () => {
  // The cheap arm always solves, the dear arm never: cost does not depend on
  // the outcome within an arm, so the solved/unsolved ratio is 1.
  const cs = ["t1", "t2", "t3"].flatMap((t) =>
    [1, 2, 3].flatMap((r) => [
      cell(t, "cc-a", r, true, Math.exp(-0.5)),
      cell(t, "cc-b", r, false, Math.exp(0.5)),
    ])
  );
  assertAlmostEquals(fitCells(cs).solved_ratio, 1, 1e-9);
});

Deno.test("restrictToTasks (H-65): keeps only the fit tasks; unknown, duplicate or empty lists refuse", () => {
  const cs = [cell("HX-001", "cc-a", 1, true), cell("HX-002", "cc-a", 1, true)];
  assertEquals(restrictToTasks(cs, ["HX-002"]).map((c) => c.task), ["HX-002"]);
  for (const bad of [[], ["HX-003"], ["HX-001", "HX-001"], "HX-001", [1]]) {
    assertThrows(
      () => restrictToTasks(cs, bad),
      Error,
      undefined,
      JSON.stringify(bad),
    );
  }
});

Deno.test("undefinedProb: exact for two tasks, one never solved by the baseline", () => {
  const cs = [
    cell("t1", "b", 1, false),
    cell("t1", "v", 1, true),
    cell("t2", "b", 1, true),
    cell("t2", "v", 1, true),
  ];
  assertAlmostEquals(undefinedProb(cs, ["b", "v"], 1), 0.25, 1e-12);
  assertAlmostEquals(undefinedProb(cs, ["b", "v"], 2), 1 - 0.75 ** 2, 1e-12);
});

Deno.test("selectTasks: M8 selection yields n tasks or a failure, deterministic per seed", () => {
  const run = {
    scenario: "null" as const,
    mechanism: "spend" as const,
    fit: FIT,
    multiplier: 1,
    poolFactor: 2,
  };
  const a = selectTasks({ tasks: 24, repeats: 3 }, run, RULES, mulberry32(4));
  const b = selectTasks({ tasks: 24, repeats: 3 }, run, RULES, mulberry32(4));
  assertEquals(a?.map((t) => t.id), b?.map((t) => t.id));
  assert(a === null || a.length === 24);
});

Deno.test("calibrate: spend is exactly 0.8 and leaves nulls at 0; solve reaches a 20% reduction", () => {
  const s = calibrate(
    { scenario: "C3", mechanism: "spend", fit: FIT, poolFactor: 2 },
    { tasks: 24, repeats: 3 },
    RULES,
    9,
    50,
    // M11-09b (decision 2026-10-03-m11-inference-amendment.md): the default
    // effect is 0.3 now; these 0.8 assertions are about the 20% effect.
    0.2,
  );
  assertEquals([s.multiplier, s.truth.C1, s.truth.C2], [0.8, 0, 0]);
  assertAlmostEquals(s.ratio, 0.8, 1e-9);
  const v = calibrate(
    { scenario: "C1", mechanism: "solve", fit: FIT, poolFactor: 2 },
    { tasks: 24, repeats: 3 },
    RULES,
    9,
    50,
    0.2,
  );
  assertAlmostEquals(v.ratio, 0.8, 0.005);
});

Deno.test("calibrate (M11-09b): no effect argument gives the 30% default: spend multiplier 0.7", () => {
  const s = calibrate(
    { scenario: "C1", mechanism: "spend", fit: FIT, poolFactor: 2 },
    { tasks: 24, repeats: 3 },
    RULES,
    9,
    50,
  );
  assertAlmostEquals(s.multiplier, 0.7, 1e-12);
});

Deno.test("calibrate (M11-09b): truth_log is the log-scale truth, exactly 0 for nulls", () => {
  const c1 = calibrate(
    { scenario: "C1", mechanism: "spend", fit: FIT, poolFactor: 2 },
    { tasks: 24, repeats: 3 },
    RULES,
    9,
    50,
    0.2,
  );
  assertAlmostEquals(c1.truth_log.C1, Math.log(0.8), 1e-9);
  assertEquals([c1.truth_log.C2, c1.truth_log.C3], [0, 0]);
  // (log RL - log R) - (log L - log P) with only L cheaper: -log(0.8).
  assertAlmostEquals(c1.truth_log.interaction, -Math.log(0.8), 1e-9);
  const nul = calibrate(
    { scenario: "null", mechanism: "spend", fit: FIT, poolFactor: 2 },
    { tasks: 24, repeats: 3 },
    RULES,
    9,
    50,
  );
  assertEquals(nul.truth_log, { C1: 0, C2: 0, C3: 0, interaction: 0 });
});

Deno.test("parseGrid (M11-13c): tasks outer, repeats inner; every malformed grid is refused", () => {
  assertEquals(parseGrid("40,50x8,12"), [
    { tasks: 40, repeats: 8 },
    { tasks: 40, repeats: 12 },
    { tasks: 50, repeats: 8 },
    { tasks: 50, repeats: 12 },
  ]);
  assertEquals(parseGrid("24x3"), [{ tasks: 24, repeats: 3 }]);
  for (
    const s of [
      "",
      "40",
      "40,50",
      "x8",
      "40x",
      "40x8x3",
      "40,,50x8",
      "0x8",
      "-4x8",
      "40x2.5",
      "4ax8",
      "40,40x8",
      "40x8,8",
      "1,2,3,4,5,6x3",
      "40x1,2,3,4,5,6",
    ]
  ) {
    assertThrows(() => parseGrid(s), Error, undefined, `should refuse ${s}`);
  }
  assertEquals(parseGrid("1,2,3,4,5x1,2,3,4,5").length, 25);
});

Deno.test("parseEffect (M11-13c): open interval (0, 0.9), finite", () => {
  assertEquals(parseEffect("0.3"), 0.3);
  assertEquals(parseEffect(0.2), 0.2);
  for (const v of [0, 0.9, 0.95, -0.1, NaN, Infinity, "abc", ""]) {
    assertThrows(() => parseEffect(v), Error, undefined, `should refuse ${v}`);
  }
});

Deno.test("calibrate (M11-13c): effect 0.3 sets the spend multiplier and the solve target ratio to 0.7", () => {
  const spend = calibrate(
    { scenario: "C3", mechanism: "spend", fit: FIT, poolFactor: 2 },
    { tasks: 24, repeats: 3 },
    RULES,
    9,
    50,
    0.3,
  );
  assertAlmostEquals(spend.multiplier, 0.7, 1e-9);
  assertAlmostEquals(spend.ratio, 0.7, 1e-9);
  const solve = calibrate(
    { scenario: "C1", mechanism: "solve", fit: FIT, poolFactor: 2 },
    { tasks: 24, repeats: 3 },
    RULES,
    9,
    50,
    0.3,
  );
  assertAlmostEquals(solve.ratio, 0.7, 0.005);
});

Deno.test("calibrate (M11-13c): no effect argument equals the explicit default exactly", () => {
  // M11-09b (decision 2026-10-03-m11-inference-amendment.md): default is now 0.3.
  assertEquals(EFFECT_DEFAULT, 0.3);
  for (const mechanism of ["spend", "solve"] as const) {
    const spec = {
      scenario: "C1" as const,
      mechanism,
      fit: FIT,
      poolFactor: 2,
    };
    const d = { tasks: 24, repeats: 3 };
    assertEquals(
      calibrate(spec, d, RULES, 9, 50),
      calibrate(spec, d, RULES, 9, 50, EFFECT_DEFAULT),
    );
  }
});

Deno.test("argsHashInput (M11-13c): no flags keeps today's exact shape; either flag records both and changes the hash", async () => {
  const numeric = {
    sims: 1000,
    resamples: 1000,
    confirm_sims: 500,
    confirm_resamples: 10000,
    seed: 20261003,
    pool_factor: 2,
    rule_b_share: 0.99,
  };
  const parts = {
    stage: "A" as const,
    args: numeric,
    alpha: 0.05,
    family: ["C1", "C2", "C3"],
    rules: RULES,
    rule: null,
    inputs: [{ path: "x.json", sha256: "ab" }],
    arm_prefix: "cc-",
  };
  // M11-09b (decision 2026-10-03-m11-inference-amendment.md): the args record
  // now ALWAYS carries the effective effect (default 0.3) and power_gate.
  const today: unknown = {
    stage: "A",
    args: { ...numeric, effect: 0.3, power_gate: "fitted" },
    alpha: 0.05,
    family: ["C1", "C2", "C3"],
    rules: RULES,
    rule: null,
    inputs: [{ path: "x.json", sha256: "ab" }],
    arm_prefix: "cc-",
  };
  const none = argsHashInput(parts, { effect: EFFECT_DEFAULT });
  assertEquals(none, today);
  assertEquals(none.args["grid"], undefined);
  assert(!("grid" in none.args));
  assertEquals(await hashJson(none), await hashJson(today));
  const eff = argsHashInput(parts, { effect: 0.2, grid: null });
  assertEquals(eff.args, { ...numeric, effect: 0.2, power_gate: "fitted" });
  assert((await hashJson(eff)) !== (await hashJson(today)));
  const grid = argsHashInput(parts, {
    effect: 0.2,
    grid: { tasks: [40], repeats: [8] },
  });
  assertEquals(grid.args["grid"], {
    tasks: [40],
    repeats: [8],
  });
  assert((await hashJson(grid)) !== (await hashJson(eff)));
  // H-65: the fit-task list binds into the hash only when given.
  const fit = { path: "fit.json", sha256: "cd", tasks: ["HX-016"] };
  const withFit = argsHashInput({ ...parts, fit_tasks: fit }, {
    effect: EFFECT_DEFAULT,
  });
  assertEquals(withFit as unknown, { ...today as object, fit_tasks: fit });
  assert((await hashJson(withFit)) !== (await hashJson(today)));
});

Deno.test("stage B (M11-13c, H-65): --effect is refused, --grid is taken; the effect comes from the frozen args or the default", () => {
  assertEquals(stageBFlagProblem({}), null);
  // H-65 (decision 2026-11-06-m11-sim-model-fix-and-mining.md): a stage-B run
  // may take a downward-extended grid; it is recorded in args.grid.
  assertEquals(stageBFlagProblem({ grid: "8,12,16,20,24x3,5,8" }), null);
  for (const f of [{ effect: "0.3" }, { grid: "16x8", effect: "0.3" }]) {
    const p = stageBFlagProblem(f);
    assert(p !== null && p.includes("stage B"), String(p));
    assert(!p.includes("--grid"), p);
  }
  assertEquals(stageBEffect({ sims: 1000 }), EFFECT_DEFAULT);
  assertEquals(stageBEffect({ sims: 1000, effect: 0.3 }), 0.3);
  assertThrows(() => stageBEffect({ effect: 0.95 }));
});

Deno.test("evaluate: deterministic; a big C1 effect is found; null scenario reports FWER", () => {
  const o = {
    sims: 20,
    resamples: 200,
    campaignResamples: 10000,
    seed: 5,
    alpha: 0.05,
    ruleBShare: 0.99,
    family: ["C1", "C2", "C3"],
    rules: RULES,
  };
  const spec = {
    scenario: "C1" as const,
    mechanism: "spend" as const,
    fitName: "fitted" as const,
    fit: FIT,
    multiplier: 0.4,
    poolFactor: 2,
    truth: { C1: -0.4, C2: 0, C3: 0, interaction: 0.4 },
    truth_log: { C1: Math.log(0.4), C2: 0, C3: 0, interaction: -Math.log(0.4) },
  };
  const r1 = evaluate({ tasks: 30, repeats: 5 }, spec, o);
  assertEquals(r1, evaluate({ tasks: 30, repeats: 5 }, spec, o));
  assert(r1.byRule.A.power.C1!.p > 0.5);
  const nul = evaluate({ tasks: 24, repeats: 3 }, {
    ...spec,
    scenario: "null",
    multiplier: 1,
    truth: { C1: 0, C2: 0, C3: 0, interaction: 0 },
    truth_log: { C1: 0, C2: 0, C3: 0, interaction: 0 },
  }, o);
  assertEquals(Object.keys(nul.byRule.A.power), []);
  assert(nul.byRule.A.fwer !== null);
});

const P = (p: number, n = 1000) => ({
  p,
  n,
  mcse: Math.sqrt((p * (1 - p)) / n),
});
const res = (
  tasks: number,
  repeats: number,
  o: {
    power?: number;
    fwer?: number;
    sup?: number;
    cov?: number;
    covB?: number;
    scenario?: string;
  } = {},
): DesignResult => {
  const stats = (cov: number) => ({
    power: o.scenario === "null" ? {} : { C1: P(o.power ?? 0.9) },
    type1: { C2: P(0.01), C3: P(0.01) },
    fwer: P(o.fwer ?? 0.03),
    suppressed: P(o.sup ?? 0.01),
    coverage: { C1: P(cov, 900), C2: P(cov, 900), C3: P(cov, 900) },
  });
  return {
    design: { tasks, repeats },
    scenario: o.scenario ?? "C1",
    mechanism: "spend",
    fit: "fitted",
    exact: false,
    multiplier: 0.8,
    selection_failures: P(0.01),
    byRule: { A: stats(o.cov ?? 0.95), B: stats(o.covB ?? 0.9) },
  };
};
const grid = (
  tasks: number,
  repeats: number,
  o: Parameters<typeof res>[2] = {},
) =>
  ["null", "C1", "C2", "C3"].flatMap((scenario) =>
    (scenario === "null" ? ["spend"] : ["spend", "solve"]).flatMap((
      mechanism,
    ) =>
      ["fitted", "stress"].map((fit) =>
        ({
          ...res(tasks, repeats, { ...o, scenario }),
          mechanism,
          fit,
        }) as DesignResult
      )
    )
  );

Deno.test("chooseRule: B only when its coverage and error control hold everywhere and it suppresses less", () => {
  assertEquals(chooseRule(grid(30, 5), 0.99), {
    rule: "suppress_any_undefined",
  });
  assertEquals(
    chooseRule(
      grid(30, 5, { covB: 0.95 }).map((r) => ({
        ...r,
        byRule: { A: r.byRule.A, B: { ...r.byRule.B, suppressed: P(0) } },
      })),
      0.99,
    ),
    { rule: "min_defined_share", share: 0.99 },
  );
});

Deno.test("chooseRule: the chosen B rule carries the share that evaluate used", () => {
  const g = grid(30, 5, { covB: 0.95 }).map((r) => ({
    ...r,
    byRule: { A: r.byRule.A, B: { ...r.byRule.B, suppressed: P(0) } },
  }));
  assertEquals(chooseRule(g, 0.95), { rule: "min_defined_share", share: 0.95 });
});

Deno.test("chooseDesign: gates on power, FWER, suppression and coverage; an incomplete grid throws", () => {
  const all = [...grid(40, 5), ...grid(30, 5), ...grid(24, 8, { power: 0.7 })];
  assertEquals(chooseDesign(all, "A"), { tasks: 30, repeats: 5 });
  assertEquals(chooseDesign([...grid(30, 5, { fwer: 0.09 })], "A"), null);
  assertEquals(chooseDesign([...grid(30, 5, { cov: 0.9 })], "A"), null);
  assertThrows(
    () => chooseDesign(grid(30, 5).slice(1), "A"),
    Error,
    "incomplete",
  );
});

Deno.test("chooseDesign (M11-09b): the power gate applies to fitted results only; stress power is reported, FWER still gates everywhere", () => {
  const withStress = (
    g: DesignResult[],
    f: (r: DesignResult) => DesignResult,
  ) => g.map((r) => (r.fit === "stress" ? f(r) : r));
  const lowPower = (r: DesignResult): DesignResult => {
    const low = (s: DesignResult["byRule"]["A"]) => ({
      ...s,
      power: Object.fromEntries(Object.keys(s.power).map((k) => [k, P(0.7)])),
    });
    return { ...r, byRule: { A: low(r.byRule.A), B: low(r.byRule.B) } };
  };
  // Stress power 0.7 with fitted power 0.9: accepted.
  assertEquals(chooseDesign(withStress(grid(30, 5), lowPower), "A"), {
    tasks: 30,
    repeats: 5,
  });
  // Fitted power 0.7: refused (stress at 0.9 does not rescue it).
  const fittedLow = grid(30, 5).map((r) =>
    r.fit === "fitted" ? lowPower(r) : r
  );
  assertEquals(chooseDesign(fittedLow, "A"), null);
  // FWER above tolerance on a stress result still refuses.
  const stressFwer = withStress(grid(30, 5), (r) => ({
    ...r,
    byRule: { A: { ...r.byRule.A, fwer: P(0.09) }, B: r.byRule.B },
  }));
  assertEquals(chooseDesign(stressFwer, "A"), null);
  // The explicit "all" scenario restores the old stress power gate.
  assertEquals(
    chooseDesign(withStress(grid(30, 5), lowPower), "A", 0.05, "all"),
    null,
  );
  // confirmDesign likewise: sensitivity results are power-reported only.
  assertEquals(
    confirmDesign(grid(30, 5), withStress(grid(30, 5), lowPower), "A", 0.05),
    true,
  );
});

Deno.test("gates: the FWER tolerance is fixed and too few simulations refuse a gating decision", () => {
  // 0.06 passes the fixed 0.0638 tolerance; with 100 replicates alpha + 2 SE would have been 0.094.
  assertEquals(chooseDesign(grid(30, 5, { fwer: 0.06 }), "A"), {
    tasks: 30,
    repeats: 5,
  });
  assertEquals(chooseDesign(grid(30, 5, { fwer: 0.07 }), "A"), null);
  const few = grid(30, 5).map((r) => ({
    ...r,
    byRule: { A: { ...r.byRule.A, suppressed: P(0.01, 100) }, B: r.byRule.B },
  }));
  assertThrows(() => chooseDesign(few, "A"), Error, "too few simulations");
  assertThrows(() => chooseRule(few, 0.99), Error, "too few simulations");
});

Deno.test("skew sensitivity: finite-moment noise whose simulated mean matches the analytic truth within Monte Carlo error", () => {
  for (const sens of [undefined, "skew"] as const) {
    const fit = { ...FIT, sens };
    const run = {
      scenario: "null" as const,
      mechanism: "spend" as const,
      fit,
      multiplier: 1,
      poolFactor: 2,
    };
    const t = {
      id: "S000",
      p: 0.5,
      mu: Math.log(0.5),
      kind: "feature" as const,
      coupling: [],
      large: true,
      dev: { plain: 0, lsp: 0, real: 0, real_lsp: 0 },
    };
    const cells = simulateCells([t], 50_000, run, mulberry32(11)).filter((c) =>
      c.arm === "plain"
    );
    const xs = cells.map((c) => c.known_spend_usd);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const se = Math.sqrt(
      xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1) /
        xs.length,
    );
    const truth = expectedSpend(t, "plain", run);
    assert(
      Math.abs(mean - truth) < 4 * se,
      `${
        sens ?? "gaussian"
      }: simulated ${mean} vs analytic ${truth} (se ${se})`,
    );
    assert(Number.isFinite(noiseMean(fit)));
  }
  // The mixture really is heavier-tailed than the Gaussian fit.
  assert(noiseMean({ ...FIT, sens: "skew" }) > noiseMean(FIT));
});

Deno.test("evaluate: exact mode reads rule-A suppression from the shared bootstrap draws", () => {
  const o = {
    sims: 20,
    resamples: 200,
    campaignResamples: 200,
    seed: 5,
    alpha: 0.05,
    ruleBShare: 0.99,
    family: ["C1", "C2", "C3"],
    rules: RULES,
  };
  const spec = {
    scenario: "null" as const,
    mechanism: "spend" as const,
    fitName: "fitted" as const,
    fit: FIT,
    multiplier: 1,
    poolFactor: 2,
    truth: { C1: 0, C2: 0, C3: 0, interaction: 0 },
    truth_log: { C1: 0, C2: 0, C3: 0, interaction: 0 },
  };
  const r = evaluate({ tasks: 24, repeats: 3 }, spec, { ...o, exact: true });
  assertEquals(r.exact, true);
  assertEquals(
    r,
    evaluate({ tasks: 24, repeats: 3 }, spec, { ...o, exact: true }),
  );
});

Deno.test("fwerTol: derived from the frozen alpha, chooseDesign gates with it", () => {
  assertAlmostEquals(fwerTol(0.05), FWER_TOL, 1e-15);
  assertAlmostEquals(fwerTol(0.01), 0.01 + 2 * Math.sqrt(0.0099 / 1000), 1e-15);
  const g = grid(30, 5, { fwer: 0.03 });
  assertEquals(chooseDesign(g, "A"), { tasks: 30, repeats: 5 });
  assertEquals(chooseDesign(g, "A", 0.01), null);
});

Deno.test("confirmDesign: sensitivity results also need MIN_GATING_SIMS replicates", () => {
  const exact = grid(30, 5);
  const sens = grid(30, 5);
  assertEquals(confirmDesign(exact, sens, "A", 0.05), true);
  const few = sens.map((r) => ({
    ...r,
    byRule: { A: { ...r.byRule.A, suppressed: P(0.01, 100) }, B: r.byRule.B },
  }));
  assertThrows(
    () => confirmDesign(exact, few, "A", 0.05),
    Error,
    "too few simulations",
  );
  const loose = sens.map((r) => ({
    ...r,
    byRule: { A: { ...r.byRule.A, fwer: P(0.09) }, B: r.byRule.B },
  }));
  assertEquals(confirmDesign(exact, loose, "A", 0.05), false);
});

Deno.test("poolCells: pooling split reports equals one report; arms and tasks stay, keys are unique", () => {
  const costs = [1, 9, 2, 8];
  const whole: Cell[] = [];
  for (const t of ["t1", "t2", "t3"]) {
    for (const [ai, a] of ["cc-a", "cc-b"].entries()) {
      for (let r = 1; r <= 4; r++) {
        whole.push(
          cell(
            t,
            a,
            r,
            r % 2 === 0,
            costs[(r + ai + t.length) % 4]! * (ai + 1),
          ),
        );
      }
    }
  }
  const half = (lo: number, hi: number) =>
    whole.filter((c) => c.repeat >= lo && c.repeat <= hi).map((c) => ({
      ...c,
      repeat: c.repeat - lo + 1,
    }));
  const pooled = poolCells([half(1, 2), half(3, 4)]);
  assertEquals(pooled.length, whole.length);
  assertEquals(
    new Set(pooled.map((c) => `${c.task}/${c.arm}/${c.repeat}`)).size,
    pooled.length,
  );
  assertEquals(new Set(pooled.map((c) => c.arm)), new Set(["cc-a", "cc-b"]));
  assertEquals(new Set(pooled.map((c) => c.task)), new Set(["t1", "t2", "t3"]));
  assertEquals(fitCells(pooled), fitCells(whole));
});

Deno.test("poolCells: a later file's blocks stay aligned across arms even when the earlier file had uneven repeats per arm", () => {
  // File 1: arm a has repeats 1..3, arm b only 1..2 (a missing cell).
  const f1 = [
    cell("t1", "a", 1, true),
    cell("t1", "a", 2, true),
    cell("t1", "a", 3, true),
    cell("t1", "b", 1, true),
    cell("t1", "b", 2, true),
  ];
  const f2 = [cell("t1", "a", 1, false), cell("t1", "b", 1, false)];
  const pooled = poolCells([f1, f2]);
  const later = pooled.slice(f1.length);
  // Both arms of file 2's block land on the same repeat, above every earlier one.
  assertEquals(later.map((c) => [c.arm, c.repeat]), [["a", 4], ["b", 4]]);
});

Deno.test("scriptSha256 (H-65): an LF and a CRLF checkout of the same files hash alike", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const write = async (name: string, text: string) => {
      await Deno.writeTextFile(`${dir}/${name}`, text);
      return `${dir}/${name}`;
    };
    const lf = [await write("a-lf", "x\ny\n"), await write("b-lf", "z\n")];
    const crlf = [
      await write("a-crlf", "x\r\ny\r\n"),
      await write("b-crlf", "z\r\n"),
    ];
    assertEquals(await scriptSha256(lf), await scriptSha256(crlf));
    const other = [await write("c", "x\ny\n"), await write("d", "q\n")];
    assert((await scriptSha256(lf)) !== (await scriptSha256(other)));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("checkResumeHeader: both the arguments and the code fingerprint must match", () => {
  const head = JSON.stringify({ args_sha256: "a1", script_sha256: "s1" });
  checkResumeHeader(head, "a1", "s1");
  assertThrows(
    () => checkResumeHeader(head, "a2", "s1"),
    Error,
    "was written with other arguments",
  );
  assertThrows(
    () => checkResumeHeader(head, "a1", "s2"),
    Error,
    "was written by other code",
  );
  assertThrows(
    () => checkResumeHeader(JSON.stringify({ args_sha256: "a1" }), "a1", "s1"),
    Error,
    "was written by other code",
  );
});

Deno.test("evaluate exact: decisions come from testContrasts (shared entry point)", () => {
  const o = {
    sims: 6,
    resamples: 200,
    campaignResamples: 200,
    seed: 7,
    alpha: 0.05,
    ruleBShare: 0.99,
    family: ["C1", "C2", "C3", "interaction"],
    rules: RULES,
    exact: true,
  };
  const spec = {
    scenario: "C1" as const,
    mechanism: "spend" as const,
    fitName: "fitted" as const,
    fit: FIT,
    multiplier: 0.4,
    poolFactor: 2,
    truth: { C1: -0.4, C2: 0, C3: 0, interaction: 0.4 },
    truth_log: { C1: Math.log(0.4), C2: 0, C3: 0, interaction: -Math.log(0.4) },
  };
  const r = evaluate({ tasks: 24, repeats: 3 }, spec, o);
  const done = o.sims - Math.round(r.selection_failures.p * o.sims);
  assertEquals(r.byRule.A.suppressed.n, done);
  assertEquals(r.byRule.B.suppressed.n, done);
  // testContrasts refuses a duplicated family; the exact path must go through it.
  assertThrows(
    () =>
      evaluate({ tasks: 24, repeats: 3 }, spec, {
        ...o,
        family: ["C1", "C1", "C2", "C3"],
      }),
    Error,
    "family",
  );
});

const H = "a".repeat(64);
const approval = "OWNER-APPROVED: sim contract (2026-10-03T10:00:00Z)";
function preregDoc(over: Record<string, unknown> = {}): Prereg {
  const protocol = {
    arms: ["p", "l", "r", "rl"],
    contrasts: [
      { id: "C1", name: "LSP on plain", baseline: "p", variant: "l" },
      { id: "C2", name: "LSP on realistic", baseline: "r", variant: "rl" },
      { id: "C3", name: "Realistic", baseline: "p", variant: "r" },
    ],
    interaction: {
      name: "Interaction",
      status: "confirmatory",
      plain: "p",
      lsp: "l",
      realistic: "r",
      realistic_lsp: "rl",
    },
  };
  return PreregSchema.parse({
    v: 1,
    experiment: "e",
    protocol,
    approval,
    population: "pop",
    primary_metric: "cost_per_solved_task",
    confirmatory: true,
    family: ["C1", "C2", "C3", "interaction"],
    alpha: 0.05,
    test: {
      sides: "two",
      p_value: "bootstrap-t",
      adjustment: "holm",
      direction: "sign_of_delta",
    },
    intervals: {
      reported: "per_contrast_unadjusted",
      beside: "bonferroni_same_draws",
    },
    bootstrap: { unit: "task", resamples: 10000, seed: 1, level: 0.95 },
    zero_solve: { rule: "suppress_any_undefined" },
    missing_pairs: "per_contrast_matched",
    held_out: {
      count: 0,
      rule: "r",
      seal: "harness-v2-screen-x",
      tasks: [],
      in_family: false,
    },
    measures: {
      fingerprint: H,
      unknown_symbol_codes: ["AL0118"],
      ruleset_sha256: H,
      canary_codes: ["x"],
      workflow_execution: "used_execution",
      effort_execution: "every_attempt",
    },
    exploratory_metrics: ["m"],
    simulation: { script_sha256: H, args: {} },
    design_rule: "d",
    stage_a: null,
    experiment_hash: null,
    selection: null,
    design: null,
    power_simulation: null,
    compiler_identity: null,
    stage_b_approval: null,
    amendments: [],
    ...over,
  });
}
const SIMARGS = {
  sims: 1000,
  resamples: 1000,
  confirm_sims: 500,
  confirm_resamples: 10000,
  seed: 1,
  pool_factor: 2,
  rule_b_share: 0.99,
};
const withProtocol = (f: (p: Prereg["protocol"]) => void): Prereg => {
  const d = preregDoc();
  f(d.protocol);
  return d;
};

Deno.test("stageBContract (M11-13b): an exploratory-only pre-registration is refused, never given C1-C3", () => {
  let checked = 0;
  for (const over of [{ confirmatory: false, family: [] }, { family: [] }]) {
    // confirmatory with an empty family fails the schema itself; the
    // exploratory one parses and must be refused here.
    let d: Prereg;
    try {
      d = preregDoc(over);
    } catch {
      continue;
    }
    assertThrows(
      () => stageBContract(d, SIMARGS),
      Error,
      "exploratory-only",
    );
    checked++;
  }
  assertEquals(checked, 1, "the exploratory document parsed and was refused");
});

Deno.test("stageBContract (M11-13b): a duplicated protocol contrast id is refused before the arm map is built", () => {
  const d = preregDoc();
  const dup = {
    ...d,
    protocol: {
      ...d.protocol,
      contrasts: [
        ...d.protocol.contrasts,
        { id: "C1", name: "LSP on plain again", baseline: "r", variant: "rl" },
      ],
    },
  } as Prereg;
  assertThrows(
    () => stageBContract(dup, SIMARGS),
    Error,
    "duplicate protocol contrast id C1",
  );
});

Deno.test("stageBContract: maps the frozen contrasts to simulation arms and refuses every mismatch", () => {
  const ok = stageBContract(preregDoc(), SIMARGS);
  assertEquals(ok.family, ["C1", "C2", "C3", "interaction"]);
  assertEquals(
    ok.contrasts.map((c) => [c.id, c.baseline, c.variant]),
    [
      ["C1", "plain", "lsp"],
      ["C2", "real", "real_lsp"],
      ["C3", "plain", "real"],
    ],
  );
  assertEquals(ok.contrasts[0]!.name, "LSP on plain");
  assertEquals(ok.interaction, {
    name: "Interaction",
    plain: "plain",
    lsp: "lsp",
    realistic: "real",
    realistic_lsp: "real_lsp",
  });
  const bad = (d: Prereg, a = SIMARGS) =>
    assertThrows(() => stageBContract(d, a), Error);
  bad(preregDoc({ family: ["C1", "C1", "C2", "C3", "interaction"] }));
  bad(preregDoc({ family: ["C1", "C2", "C9", "interaction"] }));
  bad(preregDoc({
    bootstrap: { unit: "task", resamples: 10000, seed: 1, level: 0.9 },
  }));
  bad(preregDoc(), { ...SIMARGS, confirm_resamples: 5000 });
  bad(withProtocol((p) => {
    p.contrasts[2] = { ...p.contrasts[2]!, baseline: "l", variant: "r" };
  }));
  bad(withProtocol((p) => {
    p.interaction = { ...p.interaction!, lsp: "rl", realistic_lsp: "l" };
  }));
  // Without the interaction in the family a null interaction is returned.
  const noInt = PreregSchema.parse({
    ...preregDoc(),
    confirmatory: true,
    family: ["C1", "C2", "C3"],
    protocol: {
      ...preregDoc().protocol,
      interaction: {
        ...preregDoc().protocol.interaction!,
        status: "exploratory",
      },
    },
  });
  assertEquals(stageBContract(noInt, SIMARGS).interaction, null);
});

Deno.test("resumeHeader: the written header round-trips through checkResumeHeader", () => {
  const line = resumeHeader("a1", "s1");
  checkResumeHeader(line.trim(), "a1", "s1");
  assertEquals(JSON.parse(line), { args_sha256: "a1", script_sha256: "s1" });
});
