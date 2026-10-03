import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { type Cell, mulberry32 } from "../../../src/harness/stats.ts";
import {
  calibrate,
  chooseDesign,
  chooseRule,
  type DesignResult,
  evaluate,
  expectedSpend,
  fitCells,
  noiseMean,
  selectTasks,
  simulateCells,
  undefinedProb,
} from "../../../scripts/harness/power-sim.ts";
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
  const cs = [1, 2, 3, 4].flatMap((r) =>
    ["t1", "t2"].map((t) =>
      cell(t, "a", r, r % 2 === 0, r === 4 && t === "t2" ? null : 1)
    )
  );
  const f = fitCells(cs);
  assertAlmostEquals(f.log_mean, 0, 1e-12);
  assertEquals(f.unknown_share, 1 / 8);
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
  );
  assertEquals([s.multiplier, s.truth.C1, s.truth.C2], [0.8, 0, 0]);
  assertAlmostEquals(s.ratio, 0.8, 1e-9);
  const v = calibrate(
    { scenario: "C1", mechanism: "solve", fit: FIT, poolFactor: 2 },
    { tasks: 24, repeats: 3 },
    RULES,
    9,
    50,
  );
  assertAlmostEquals(v.ratio, 0.8, 0.005);
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
  };
  const r1 = evaluate({ tasks: 30, repeats: 5 }, spec, o);
  assertEquals(r1, evaluate({ tasks: 30, repeats: 5 }, spec, o));
  assert(r1.byRule.A.power.C1!.p > 0.5);
  const nul = evaluate({ tasks: 24, repeats: 3 }, {
    ...spec,
    scenario: "null",
    multiplier: 1,
    truth: { C1: 0, C2: 0, C3: 0, interaction: 0 },
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
  assertEquals(chooseRule(grid(30, 5)), { rule: "suppress_any_undefined" });
  assertEquals(
    chooseRule(
      grid(30, 5, { covB: 0.95 }).map((r) => ({
        ...r,
        byRule: { A: r.byRule.A, B: { ...r.byRule.B, suppressed: P(0) } },
      })),
    ),
    { rule: "min_defined_share", share: 0.99 },
  );
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
  assertThrows(() => chooseRule(few), Error, "too few simulations");
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
  };
  const r = evaluate({ tasks: 24, repeats: 3 }, spec, { ...o, exact: true });
  assertEquals(r.exact, true);
  assertEquals(
    r,
    evaluate({ tasks: 24, repeats: 3 }, spec, { ...o, exact: true }),
  );
});
