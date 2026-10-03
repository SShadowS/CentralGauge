import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { type Cell, mulberry32 } from "../../../src/harness/stats.ts";
import {
  calibrate,
  checkResumeHeader,
  chooseDesign,
  chooseRule,
  confirmDesign,
  type DesignResult,
  evaluate,
  expectedSpend,
  fitCells,
  FWER_TOL,
  fwerTol,
  noiseMean,
  poolCells,
  resumeHeader,
  selectTasks,
  simulateCells,
  stageBContract,
  undefinedProb,
} from "../../../scripts/harness/power-sim.ts";
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
      p_value: "percentile_bootstrap_plus_one",
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
