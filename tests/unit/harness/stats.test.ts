import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { ValidationError } from "../../../src/errors.ts";
import { percentile } from "../../../cli/commands/report/stats-calculator.ts";
import {
  armSummary,
  bootstrapP,
  type Cell,
  type CellStatus,
  compareArms,
  compareInteraction,
  decide,
  exploratoryNote,
  exploratoryText,
  holm,
  minDefinedResamples,
  mulberry32,
  testContrasts,
} from "../../../src/harness/stats.ts";

type Row = [CellStatus | boolean, number | null];

/** true/false = scored pass/fail; a status string = that status. */
function cells(arm: string, task: string, rows: Row[]): Cell[] {
  return rows.map(([s, spend], i) => ({
    task,
    arm,
    repeat: i + 1,
    status: typeof s === "boolean" ? "scored" : s,
    pass: typeof s === "boolean" ? s : null,
    spend_usd: s === "unrun" ? 0 : spend,
    known_spend_usd: spend ?? 0,
    attempts: s === "unrun" ? 0 : 1,
  }));
}

Deno.test("mulberry32: deterministic per seed", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const xs = [a(), a(), a()];
  assertEquals(xs, [b(), b(), b()]);
  assert(xs.every((x) => x >= 0 && x < 1));
  assert(mulberry32(43)() !== xs[0]);
});

Deno.test("armSummary: cost per solved task, pass rate, pass^k", () => {
  const cs = [
    ...cells("A", "t1", [[true, 1], [false, 1], [true, 1]]),
    ...cells("A", "t2", [[true, 2], [true, 2], [true, 2]]),
  ];
  const s = armSummary(cs, "A", 3);
  // (1 + 2) / (2/3 + 1) = 1.8
  assertAlmostEquals(s.cost_per_solved_task!, 1.8, 1e-12);
  assertAlmostEquals(s.pass_rate!, (2 / 3 + 1) / 2, 1e-12);
  assertEquals([s.pass_k, s.pass_k_tasks], [0.5, 2]);
  assertEquals(s.provisional, false);
});

Deno.test("armSummary: every task has equal weight", () => {
  const cs = [
    ...cells("A", "t1", [[true, 10]]),
    ...cells("A", "t2", [[true, 1], [true, 1], [true, 1]]),
  ];
  // per-task means 10 and 1 -> 11 / 2, not the pooled 13 / 4
  assertEquals(armSummary(cs, "A", 3).cost_per_solved_task, 5.5);
});

Deno.test("armSummary: an unscored cell adds spend and no solve over the same cells (addendum rule 5)", () => {
  // $1 solved cell plus a $9 cell whose setup retries were exhausted:
  // mean spend (1 + 9) / 2 = 5, solve rate 1 / 2 -> $10 per solved task.
  const s = armSummary(cells("A", "t1", [[true, 1], ["unscored", 9]]), "A", 2);
  assertEquals(s.cost_per_solved_task, 10);
  assertEquals(s.total_spend_usd, 10);
  // Scored-only pass rate: the unscored cell is not a model failure.
  assertEquals(s.pass_rate, 1);
  assertEquals(s.unscored_cells, 1);
});

Deno.test("armSummary: a free unscored cell cannot halve the cost (dilution case)", () => {
  // $10 solved cell plus a $0 unscored cell: still $10 per solved task.
  const s = armSummary(cells("A", "t1", [[true, 10], ["unscored", 0]]), "A", 2);
  assertEquals(s.cost_per_solved_task, 10);
});

Deno.test("armSummary: known spend survives an unknown attempt, in any status", () => {
  const partial = (status: "scored" | "pending", known: number): Cell => ({
    task: "t1",
    arm: "A",
    repeat: status === "scored" ? 1 : 2,
    status,
    pass: status === "scored" ? true : null,
    spend_usd: null,
    known_spend_usd: known,
    attempts: 2,
  });
  const s = armSummary([partial("scored", 2), partial("pending", 3)], "A", 2);
  assertEquals(s.total_spend_usd, 5);
  assertEquals(s.pending_spend_usd, 3);
  assertEquals([s.unknown_spend_cells, s.unknown_spend_terminal_cells], [2, 1]);
  assertEquals(s.cost_per_solved_task, null);
});

Deno.test("armSummary: pending spend is disclosed, not in the headline, and marks it provisional", () => {
  const cs = cells("A", "t1", [[true, 2], ["pending", 7], ["unrun", null]]);
  const s = armSummary(cs, "A", 3);
  assertEquals(s.cost_per_solved_task, 2);
  assertEquals(s.pending_spend_usd, 7);
  assertEquals(s.total_spend_usd, 9);
  assertEquals([s.pending_cells, s.unrun_cells, s.attempted_cells], [1, 1, 2]);
  assertEquals(s.provisional, true);
});

Deno.test("armSummary: unknown spend leaves the cost metric but not the pass rate", () => {
  const cs = cells("A", "t1", [[true, 3], [false, 3], [true, null]]);
  const s = armSummary(cs, "A", 3);
  assertEquals(s.cost_per_solved_task, 6);
  assertAlmostEquals(s.pass_rate!, 2 / 3, 1e-12);
  assertEquals(s.unknown_spend_terminal_cells, 1);
});

Deno.test("armSummary: no solved task gives null, not Infinity or 0", () => {
  const s = armSummary(cells("A", "t1", [[false, 2], [false, 2]]), "A", 2);
  assertEquals(s.cost_per_solved_task, null);
  assertEquals(s.pass_rate, 0);
});

Deno.test("cells: duplicate repeats and pass/status mismatch are refused", () => {
  const dup = [
    ...cells("A", "t1", [[true, 1]]),
    ...cells("A", "t1", [[true, 1]]),
  ];
  assertThrows(
    () => armSummary(dup, "A", 1),
    ValidationError,
    "duplicate cell",
  );
  const bad: Cell[] = [{
    task: "t1",
    arm: "A",
    repeat: 1,
    status: "pending",
    pass: true,
    spend_usd: 1,
    known_spend_usd: 1,
    attempts: 1,
  }];
  assertThrows(
    () => armSummary(bad, "A", 1),
    ValidationError,
    "pass must be set",
  );
});

Deno.test("armSummary: pass^k needs every distinct repeat 1..k scored", () => {
  const cs = [
    ...cells("A", "t1", [[true, 1], [true, 1], ["pending", 1]]),
    ...cells("A", "t2", [[true, 1], [true, 1], [true, 1]]),
  ];
  assertEquals(armSummary(cs, "A", 3).pass_k_tasks, 1);
});

function twoArms(variantCost: number): Cell[] {
  const out: Cell[] = [];
  for (let t = 1; t <= 8; t++) {
    const rows: Row[] = [[true, 2], [t % 2 === 0, 2], [true, 2]];
    out.push(...cells("base", `t${t}`, rows));
    out.push(
      ...cells("var", `t${t}`, rows.map(([p]) => [p, variantCost] as Row)),
    );
  }
  return out;
}

Deno.test("compareArms: cheaper on every task is distinguishable and reproducible", () => {
  const cs = twoArms(1);
  const opts = { seed: 7, resamples: 500 };
  const r1 = compareArms(cs, "base", "var", "cost_per_solved_task", opts);
  assertEquals(
    r1,
    compareArms(cs, "base", "var", "cost_per_solved_task", opts),
  );
  assert(r1.delta! < 0);
  assert(r1.ci![1] < 0);
  assertEquals([r1.distinguishable, r1.tasks, r1.pairs], [true, 8, 24]);
});

Deno.test("compareArms: identical arms are not distinguishable", () => {
  const r = compareArms(twoArms(2), "base", "var", "cost_per_solved_task", {
    resamples: 200,
  });
  assertEquals([r.delta, r.ci, r.distinguishable], [0, [0, 0], false]);
});

Deno.test("compareArms: matched pairs only, exclusions counted per arm and reason (owner rule 2)", () => {
  const cs = [
    ...cells("base", "t1", [[true, 1], [false, 1], [true, null]]),
    ...cells("var", "t1", [[true, 1], ["pending", 4], [true, 1]]),
    ...cells("var", "t2", [[true, 1]]),
  ];
  const r = compareArms(cs, "base", "var", "cost_per_solved_task", {
    resamples: 50,
  });
  assertEquals(r.pairs, 1);
  assertEquals(r.excluded, {
    baseline: { unknown_spend: 1, missing: 1 },
    variant: { pending: 1 },
  });
  assertEquals([r.tasks, r.tasks_dropped], [1, 1]);
  assertEquals(r.provisional, true);
});

Deno.test("compareArms: pass_rate metric", () => {
  const cs = [
    ...cells("base", "t1", [[true, 1], [false, 1]]),
    ...cells("var", "t1", [[true, 1], [true, 1]]),
  ];
  const r = compareArms(cs, "base", "var", "pass_rate", { resamples: 100 });
  assertEquals(r.delta, 0.5);
});

Deno.test("compareArms: any undefined resample suppresses CI and verdict (owner rule 4)", () => {
  const cs = [
    ...cells("base", "t1", [[true, 1]]),
    ...cells("var", "t1", [[true, 1]]),
    ...cells("base", "t2", [[true, 1]]),
    ...cells("var", "t2", [[false, 1]]),
  ];
  const r = compareArms(cs, "base", "var", "cost_per_solved_task", {
    resamples: 400,
    seed: 3,
  });
  assert(r.undefined_share > 0 && r.undefined_share < 1);
  assertEquals([r.ci, r.distinguishable], [null, null]);
  assertEquals(r.delta, 1);
});

Deno.test("compareArms: invalid bootstrap options are refused", () => {
  const cs = twoArms(1);
  for (
    const opts of [{ resamples: 0 }, { resamples: 2.5 }, { level: 1 }, {
      level: 0,
    }, { seed: -1 }]
  ) {
    assertThrows(
      () => compareArms(cs, "base", "var", "pass_rate", opts),
      ValidationError,
    );
  }
});

Deno.test("cells: non-finite or negative numbers are refused, never leak into a metric", () => {
  const base = cells("A", "t1", [[true, 1]])[0]!;
  for (
    const patch of [
      { spend_usd: Number.NaN },
      { spend_usd: Infinity },
      { spend_usd: -1 },
      { known_spend_usd: Number.NaN },
      { known_spend_usd: -1 },
      { attempts: 1.5 },
      { attempts: -1 },
      { repeat: 0 },
      { repeat: 1.5 },
    ]
  ) {
    assertThrows(
      () => armSummary([{ ...base, ...patch }], "A", 1),
      ValidationError,
      "cell A/t1/",
    );
  }
});

Deno.test("armSummary: k must be a positive integer", () => {
  const cs = cells("A", "t1", [[true, 1]]);
  for (const k of [0, 1.5, -1, Number.NaN]) {
    assertThrows(() => armSummary(cs, "A", k), ValidationError, "k must be");
  }
});

Deno.test("armSummary: a repeat beyond the planned k is refused, naming the task", () => {
  const cs = cells("A", "t1", [[true, 1], [true, 1], [true, 1]]);
  assertThrows(() => armSummary(cs, "A", 2), ValidationError, "t1");
  // Also when the extra repeat is not scored: it is still outside the plan.
  const un = cells("A", "t2", [[true, 1], [true, 1], ["unscored", 1]]);
  assertThrows(() => armSummary(un, "A", 2), ValidationError, "t2");
});

Deno.test("compareArms: a seed outside 0..0xffffffff is refused, never aliased", () => {
  const cs = twoArms(1);
  for (const seed of [2 ** 32, 1.5]) {
    assertThrows(
      () => compareArms(cs, "base", "var", "pass_rate", { seed }),
      ValidationError,
      "seed",
    );
  }
  compareArms(cs, "base", "var", "pass_rate", { seed: 0xffffffff });
});

// M6-02d: an exploratory interval over the defined resamples only, beside
// the pre-registered result, which it never replaces.

Deno.test("compareArms: exploratory interval over defined resamples when the CI is suppressed", () => {
  // Resamples: {t1,t1} delta 0, {t1,t2} delta 1, {t2,t2} undefined (no var solve).
  const cs = [
    ...cells("base", "t1", [[true, 1]]),
    ...cells("var", "t1", [[true, 1]]),
    ...cells("base", "t2", [[true, 1]]),
    ...cells("var", "t2", [[false, 1]]),
  ];
  const r = compareArms(cs, "base", "var", "cost_per_solved_task", {
    resamples: 400,
    seed: 3,
  });
  assertEquals([r.ci, r.distinguishable], [null, null]);
  const used = 400 - Math.round(r.undefined_share * 400);
  assert(used > 0 && used < 400);
  assertEquals(r.exploratory_ci_defined_only, {
    lo: 0,
    hi: 1,
    level: 0.95,
    resamples_used: used,
    undefined_share: r.undefined_share,
  });
});

Deno.test("compareArms: with no undefined resample the exploratory interval equals the CI exactly", () => {
  const r = compareArms(twoArms(1), "base", "var", "cost_per_solved_task", {
    seed: 7,
    resamples: 500,
  });
  assertEquals(r.undefined_share, 0);
  assertEquals(r.exploratory_ci_defined_only, {
    lo: r.ci![0],
    hi: r.ci![1],
    level: r.level,
    resamples_used: 500,
    undefined_share: 0,
  });
});

Deno.test("compareArms: exploratory interval is null when every resample is undefined", () => {
  const none = [
    ...cells("base", "t1", [[false, 1]]),
    ...cells("var", "t1", [[true, 1]]),
  ];
  const r = compareArms(none, "base", "var", "cost_per_solved_task", {
    resamples: 50,
  });
  assertEquals([r.undefined_share, r.exploratory_ci_defined_only], [1, null]);
  const empty = compareArms(
    cells("base", "t1", [[true, 1]]),
    "base",
    "var",
    "cost_per_solved_task",
    { resamples: 50 },
  );
  assertEquals([empty.tasks, empty.exploratory_ci_defined_only], [0, null]);
});

Deno.test("compareArms: pre-registered fields are byte-identical to the pre-M6-02d output", () => {
  const cs = [
    ...cells("base", "t1", [[true, 1]]),
    ...cells("var", "t1", [[true, 1]]),
    ...cells("base", "t2", [[true, 1]]),
    ...cells("var", "t2", [[false, 1]]),
    ...cells("base", "t3", [[true, 2]]),
    ...cells("var", "t3", [[true, 1.5]]),
  ];
  // Captured from master 9e40cedd before the exploratory field existed.
  const gold = {
    cost_per_solved_task:
      '{"metric":"cost_per_solved_task","baseline":"base","variant":"var","pairs":3,"tasks":3,"tasks_dropped":0,"excluded":{"baseline":{},"variant":{}},"level":0.95,"resamples":400,"seed":3,"provisional":false,"delta":0.41666666666666674,"ci":null,"undefined_share":0.0275,"distinguishable":null}',
    pass_rate:
      '{"metric":"pass_rate","baseline":"base","variant":"var","pairs":3,"tasks":3,"tasks_dropped":0,"excluded":{"baseline":{},"variant":{}},"level":0.95,"resamples":400,"seed":3,"provisional":false,"delta":-0.33333333333333337,"ci":[-1,0],"undefined_share":0,"distinguishable":false}',
  } as const;
  for (const metric of ["cost_per_solved_task", "pass_rate"] as const) {
    const r = compareArms(cs, "base", "var", metric, {
      resamples: 400,
      seed: 3,
    });
    assert(r.exploratory_ci_defined_only != null);
    assert(r.values !== undefined);
    assert(r.p_value !== undefined);
    assert(r.zero_solve !== undefined);
    const {
      exploratory_ci_defined_only: _,
      values: _values,
      p_value: _p,
      zero_solve: _zs,
      ...pre
    } = r;
    assertEquals(JSON.stringify(pre), gold[metric]);
  }
});

Deno.test("exploratoryText: labelled, share never rounds to 100% or 0%, counts beside it", () => {
  const e = (used: number) => ({
    lo: -0.25,
    hi: 0.5,
    level: 0.95,
    resamples_used: used,
    undefined_share: (2000 - used) / 2000,
  });
  const f = (x: number) => x.toFixed(2);
  assertEquals(
    exploratoryText(e(1996), 2000, f),
    "exploratory (not pre-registered): conditional 95% percentile interval over the 99.8% of resamples with a solve in both arms (1996 of 2000), not a confidence interval: [-0.25, 0.50]; conditioning on solves can bias this interval, including its direction; it is not evidence of a difference",
  );
  assertStringIncludes(exploratoryText(e(1999), 2000, f), "over the 99.9% ");
  assertStringIncludes(exploratoryText(e(1), 2000, f), "over the 0.1% ");
  assertStringIncludes(exploratoryText(e(2000), 2000, f), "over the 100% ");
});

// --- M6-02d review: conditional wording, minimum defined resamples ---

Deno.test("exploratoryText (M6-02d review): conditional wording, never called a confidence interval; level 0.9 reads 90%", () => {
  const e = {
    lo: -0.25,
    hi: 0.5,
    level: 0.95,
    resamples_used: 1996,
    undefined_share: 0.002,
  };
  const f = (x: number) => x.toFixed(2);
  assertEquals(
    exploratoryText(e, 2000, f),
    "exploratory (not pre-registered): conditional 95% percentile interval over the 99.8% of resamples with a solve in both arms (1996 of 2000), not a confidence interval: [-0.25, 0.50]; conditioning on solves can bias this interval, including its direction; it is not evidence of a difference",
  );
  assertStringIncludes(
    exploratoryText({ ...e, level: 0.9 }, 2000, f),
    "conditional 90% percentile interval",
  );
});

Deno.test("minDefinedResamples (M6-02d review): ceil(1/alpha), alpha = (1 - level) / 2", () => {
  assertEquals(minDefinedResamples(0.95), 40);
  assertEquals(minDefinedResamples(0.9), 20);
  assertEquals(minDefinedResamples(0.99), 200);
});

Deno.test("compareArms (M6-02d review): fewer defined resamples than the minimum gives a null interval; the pre-registered result is untouched", () => {
  const cs = twoArms(1);
  const few = compareArms(cs, "base", "var", "cost_per_solved_task", {
    seed: 7,
    resamples: 39,
  });
  assertEquals(few.undefined_share, 0);
  assert(few.ci !== null && few.distinguishable !== null);
  assertEquals(few.exploratory_ci_defined_only, null);
  const enough = compareArms(cs, "base", "var", "cost_per_solved_task", {
    seed: 7,
    resamples: 40,
  });
  assertEquals(enough.exploratory_ci_defined_only?.resamples_used, 40);
});

Deno.test("exploratoryNote (M6-02d review): omitted line names the count and the minimum; nothing beside a shown CI or for an old report", () => {
  const f = (x: number) => x.toFixed(2);
  const base = compareArms(twoArms(1), "base", "var", "cost_per_solved_task", {
    seed: 7,
    resamples: 400,
  });
  const suppressed = {
    ...base,
    ci: null,
    distinguishable: null,
    undefined_share: 0.95,
    exploratory_ci_defined_only: null,
  };
  assertEquals(
    exploratoryNote(suppressed, f),
    "exploratory interval omitted: only 20 of 400 resamples defined (< 40)",
  );
  assertEquals(exploratoryNote(base, f), null);
  const { exploratory_ci_defined_only: _, ...old } = suppressed;
  assertEquals(exploratoryNote(old, f), null);
  assertEquals(exploratoryNote({ ...suppressed, delta: null }, f), null);
  assertStringIncludes(
    exploratoryNote({
      ...suppressed,
      exploratory_ci_defined_only: {
        lo: 0,
        hi: 1,
        level: 0.95,
        resamples_used: 380,
        undefined_share: 0.05,
      },
    }, f)!,
    "exploratory (not pre-registered): conditional 95% percentile interval",
  );
});

// --- M6-02e: the label warns about conditioning bias ---

Deno.test("exploratoryText (M6-02e): ends with the conditioning-bias warning", () => {
  const f = (x: number) => x.toFixed(2);
  assertEquals(
    exploratoryText(
      {
        lo: -0.25,
        hi: 0.5,
        level: 0.95,
        resamples_used: 1996,
        undefined_share: 0.002,
      },
      2000,
      f,
    ),
    "exploratory (not pre-registered): conditional 95% percentile interval over the 99.8% of resamples with a solve in both arms (1996 of 2000), not a confidence interval: [-0.25, 0.50]; conditioning on solves can bias this interval, including its direction; it is not evidence of a difference",
  );
});

Deno.test("bootstrapP: +1 corrected two-sided percentile p", () => {
  assertAlmostEquals(bootstrapP([-1, -2, -3, -4]), 2 / 5, 1e-12);
  assertEquals(bootstrapP([-1, 1]), 1);
  assertEquals(bootstrapP([]), 1);
});

Deno.test("holm: step-down adjusted p; null never rejects and ranks as 1; ties keep order", () => {
  const h = holm([0.01, 0.04, 0.03], 0.05);
  assertEquals(h.adjusted.map((x) => +x.toFixed(4)), [0.03, 0.06, 0.06]);
  assertEquals(h.reject, [true, false, false]);
  const n = holm([null, 0.001, 0.001], 0.05);
  assertEquals([n.reject, n.adjusted[0]], [[false, true, true], 1]);
});

Deno.test("decide: direction only on a rejection", () => {
  assertEquals(decide(-0.2, true), "variant_lower");
  assertEquals(decide(0.2, true), "variant_higher");
  assertEquals(decide(-0.2, false), "no_decision");
  assertEquals(decide(null, true), "no_decision");
});

Deno.test("compareArms: p_value and values; v1 suppression keeps p null; min_defined_share allows it", () => {
  const cs = [
    ...cells("A", "t1", [[true, 2], [true, 2]]),
    ...cells("A", "t2", [[true, 3], [false, 3]]),
    ...cells("B", "t1", [[true, 1], [true, 1]]),
    ...cells("B", "t2", [[true, 1], [true, 1]]),
  ];
  const c = compareArms(cs, "A", "B", "cost_per_solved_task", {
    resamples: 400,
    seed: 3,
  });
  assert(c.p_value! > 0 && c.p_value! <= 1);
  assertEquals(c.values!.variant, 1);
  const z = [
    ...cells("A", "t1", [[false, 2]]),
    ...cells("A", "t2", [[true, 2]]),
    ...cells("B", "t1", [[true, 1]]),
    ...cells("B", "t2", [[true, 1]]),
  ];
  const s = compareArms(z, "A", "B", "cost_per_solved_task", {
    resamples: 400,
    seed: 3,
  });
  assertEquals([s.ci, s.p_value], [null, null]);
  const share = compareArms(z, "A", "B", "cost_per_solved_task", {
    resamples: 400,
    seed: 3,
    zeroSolve: { rule: "min_defined_share", share: 0.5 },
  });
  assert(share.undefined_share > 0 && share.undefined_share < 0.5);
  assert(share.ci !== null && share.p_value !== null);
});

Deno.test("compareInteraction: (RL - R) - (L - P) over blocks eligible in all four arms", () => {
  const cs = [
    ...cells("P", "t1", [[true, 4], [true, 4]]),
    ...cells("L", "t1", [[true, 2], [true, 2]]),
    ...cells("R", "t1", [[true, 4], [true, 4]]),
    ...cells("RL", "t1", [[true, 4], ["pending", null]]),
  ];
  const c = compareInteraction(
    cs,
    { plain: "P", lsp: "L", realistic: "R", realistic_lsp: "RL" },
    "cost_per_solved_task",
    { resamples: 50 },
  );
  assertEquals([c.pairs, c.delta], [1, 2]);
});

const factorial = () => {
  const arm = (a: string, spend: number) =>
    ["t1", "t2", "t3", "t4", "t5", "t6"].flatMap((t, i) =>
      cells(a, t, [[true, spend + i / 10], [true, spend + i / 10]])
    );
  return [...arm("P", 2), ...arm("L", 1), ...arm("R", 2), ...arm("RL", 2)];
};
const SPECS = [
  { id: "C1", name: "c1", baseline: "P", variant: "L" },
  { id: "C2", name: "c2", baseline: "R", variant: "RL" },
  { id: "C3", name: "c3", baseline: "P", variant: "R" },
];
const INTER = {
  name: "i",
  plain: "P",
  lsp: "L",
  realistic: "R",
  realistic_lsp: "RL",
};
const O = {
  resamples: 999,
  seed: 7,
  level: 0.95,
  alpha: 0.05,
  zeroSolve: { rule: "suppress_any_undefined" as const },
  // M11-09b: testContrasts now defaults to bootstrap-t; these pre-existing
  // assertions are about the percentile path, so they pin it explicitly.
  method: "percentile" as const,
};

Deno.test("testContrasts: Holm over the given family only; interaction outside it is exploratory", () => {
  const r = testContrasts(factorial(), SPECS, INTER, "cost_per_solved_task", {
    ...O,
    family: ["C1", "C2", "C3"],
  });
  assertEquals(r.map((x) => [x.id, x.confirmatory, x.decision]), [
    ["C1", true, "variant_lower"],
    ["C2", true, "no_decision"],
    ["C3", true, "no_decision"],
    ["interaction", false, "no_decision"],
  ]);
  assertEquals(r[3]!.p_holm, null);
  assert(r[0]!.bonferroni_ci![1] < 0);
  assertAlmostEquals(
    r[0]!.ratio!,
    r[0]!.values!.variant! / r[0]!.values!.baseline!,
    1e-12,
  );
});

Deno.test("testContrasts: a confirmatory interaction joins Holm (m = 4)", () => {
  const r = testContrasts(factorial(), SPECS, INTER, "cost_per_solved_task", {
    ...O,
    family: ["C1", "C2", "C3", "interaction"],
  });
  assertEquals(r[3]!.confirmatory, true);
  assertAlmostEquals(r[0]!.p_holm!, Math.min(1, 4 * r[0]!.p_value!), 1e-12);
});

Deno.test("holm: alpha must be finite and in (0, 1)", () => {
  for (const alpha of [1.5, 1, 0, -0.1, NaN, Infinity]) {
    const e = assertThrows(
      () => holm([0.01, 1, 1], alpha),
      ValidationError,
    );
    assertStringIncludes(e.message, "alpha");
  }
});

Deno.test("testContrasts: an alpha outside (0, 1) is refused before any bootstrap work", () => {
  for (const alpha of [1.5, 0, NaN]) {
    const e = assertThrows(
      () =>
        testContrasts(factorial(), SPECS, INTER, "cost_per_solved_task", {
          ...O,
          alpha,
          family: ["C1", "C2", "C3"],
        }),
      ValidationError,
    );
    assertStringIncludes(e.message, "alpha");
  }
});

Deno.test("testContrasts: duplicate contrast ids and the reserved id interaction are refused", () => {
  const dup = [...SPECS, {
    id: "C1",
    name: "again",
    baseline: "R",
    variant: "L",
  }];
  for (const inter of [INTER, null]) {
    const e = assertThrows(
      () =>
        testContrasts(factorial(), dup, inter, "cost_per_solved_task", {
          ...O,
          family: ["C1", "C2", "C3"],
        }),
      ValidationError,
    );
    assertStringIncludes(e.message, "C1");
  }
  const reserved = [
    ...SPECS,
    { id: "interaction", name: "x", baseline: "R", variant: "L" },
  ];
  for (const inter of [INTER, null]) {
    const e = assertThrows(
      () =>
        testContrasts(factorial(), reserved, inter, "cost_per_solved_task", {
          ...O,
          family: ["C1", "C2", "C3"],
        }),
      ValidationError,
    );
    assertStringIncludes(e.message, "interaction");
  }
});

// --- M11-09b: paired task-cluster studentized bootstrap (bootstrap-t) ---

interface Pt {
  c: number;
  s: number;
}
/** Plain-arithmetic theta and SE for the pairwise log cost-per-solved ratio, independent of the implementation. */
function hand(v: Pt[], b: Pt[]): { theta: number; se: number } | null {
  const n = v.length;
  if (n < 2) return null;
  const m = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const Cv = m(v.map((p) => p.c));
  const Sv = m(v.map((p) => p.s));
  const Cb = m(b.map((p) => p.c));
  const Sb = m(b.map((p) => p.s));
  if (!(Cv > 0 && Sv > 0 && Cb > 0 && Sb > 0)) return null;
  const infl = v.map((p, i) =>
    (p.c - Cv) / Cv - (p.s - Sv) / Sv - (b[i]!.c - Cb) / Cb +
    (b[i]!.s - Sb) / Sb
  );
  const mi = m(infl);
  const sd = Math.sqrt(
    infl.reduce((a, x) => a + (x - mi) ** 2, 0) / (n - 1),
  );
  const se = sd / Math.sqrt(n);
  if (!(se > 0) || !Number.isFinite(se)) return null;
  return { theta: Math.log(Cv / Sv) - Math.log(Cb / Sb), se };
}

// Per task: base rows and var rows (two repeats each).
const BT_ROWS: Record<string, [Row[], Row[]]> = {
  t1: [[[true, 2], [false, 2]], [[true, 1], [true, 1]]],
  t2: [[[true, 4], [true, 6]], [[true, 2], [false, 4]]],
  t3: [[[false, 3], [true, 3]], [[true, 2], [true, 2]]],
  t4: [[[true, 1], [true, 3]], [[false, 1], [true, 3]]],
};
const ptOf = (rows: Row[]): Pt => ({
  c: rows.reduce((a, [, x]) => a + x!, 0) / rows.length,
  s: rows.filter(([p]) => p === true).length / rows.length,
});
const btCells = (): Cell[] =>
  Object.entries(BT_ROWS).flatMap(([t, [b, v]]) => [
    ...cells("base", t, b),
    ...cells("var", t, v),
  ]);

Deno.test("compareArms bootstrap-t: theta, SE, t and p match plain arithmetic on a small fixture", () => {
  const names = Object.keys(BT_ROWS);
  const base = new Map(names.map((t) => [t, ptOf(BT_ROWS[t]![0])]));
  const vari = new Map(names.map((t) => [t, ptOf(BT_ROWS[t]![1])]));
  const full = hand(
    names.map((t) => vari.get(t)!),
    names.map((t) => base.get(t)!),
  )!;
  const r = compareArms(btCells(), "base", "var", "cost_per_solved_task", {
    method: "bootstrap-t",
    resamples: 300,
    seed: 3,
  });
  assertEquals(r.method, "bootstrap-t");
  assertAlmostEquals(r.theta!, full.theta, 1e-12);
  assertAlmostEquals(r.se!, full.se, 1e-12);
  assertAlmostEquals(r.t!, full.theta / full.se, 1e-12);
  // Replay the same draws with the hand statistic.
  const ts: number[] = [];
  let undef = 0;
  const rand = mulberry32(3);
  for (let i = 0; i < 300; i++) {
    const sample = names.map(() => names[Math.floor(rand() * names.length)]!);
    const h = hand(
      sample.map((t) => vari.get(t)!),
      sample.map((t) => base.get(t)!),
    );
    if (h === null) undef++;
    else ts.push((h.theta - full.theta) / h.se);
  }
  assertAlmostEquals(r.bt_undefined_share!, undef / 300, 1e-12);
  const tHat = Math.abs(full.theta / full.se);
  // Symmetric bootstrap-t: p = (#{|t*| >= |t_hat|} + 1) / (n + 1).
  const ge = ts.filter((x) => Math.abs(x) >= tHat).length;
  const expected = (ge + 1) / (ts.length + 1);
  // Suppressed by the default zero-solve rule when any resample is undefined.
  assert(undef > 0, "fixture should include undefined resamples");
  assertEquals([r.p_value, r.ci_log, r.ci_ratio], [null, null, null]);
  // Under min_defined_share the formulas run over the defined resamples.
  const loose = compareArms(btCells(), "base", "var", "cost_per_solved_task", {
    method: "bootstrap-t",
    resamples: 300,
    seed: 3,
    zeroSolve: { rule: "min_defined_share", share: 0.1 },
  });
  assertAlmostEquals(loose.p_value!, expected, 1e-12);
  const q = percentile(ts.map(Math.abs), 0.95);
  assertAlmostEquals(loose.ci_log![0], full.theta - q * full.se, 1e-12);
  assertAlmostEquals(loose.ci_log![1], full.theta + q * full.se, 1e-12);
  assertAlmostEquals(loose.ci_ratio![0], Math.exp(loose.ci_log![0]), 1e-12);
  assertAlmostEquals(loose.ci_ratio![1], Math.exp(loose.ci_log![1]), 1e-12);
});

Deno.test("compareArms bootstrap-t: the interval is symmetric on the log scale and asymmetric on the ratio scale", () => {
  const rows = (cost: number): Row[] => [[true, cost], [true, cost]];
  const cs: Cell[] = [];
  for (let t = 1; t <= 12; t++) {
    const bc = t === 12 ? 6 : 1 + t / 20;
    const vc = (t === 12 ? 5 : 0.8) * (1 + t / 20) * (1 + 0.15 * (t % 3));
    cs.push(...cells("base", `t${t}`, rows(bc)));
    cs.push(...cells("var", `t${t}`, rows(vc)));
  }
  const r = compareArms(cs, "base", "var", "cost_per_solved_task", {
    method: "bootstrap-t",
    resamples: 1000,
    seed: 5,
  });
  assert(r.ci_log != null && r.theta != null);
  assertAlmostEquals(r.ci_log[1] - r.theta, r.theta - r.ci_log[0], 1e-12);
  const rt = Math.exp(r.theta);
  const up = r.ci_ratio![1] - rt;
  const down = rt - r.ci_ratio![0];
  assert(
    Math.abs(up - down) > 0.05 * (r.ci_ratio![1] - r.ci_ratio![0]),
    `up ${up} down ${down}`,
  );
});

function normalDraw(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) *
    Math.cos(2 * Math.PI * rand());
}

Deno.test("compareArms bootstrap-t: null calibration smoke (30 tasks, skewed costs): type I rate closer to 0.05 than the percentile test", () => {
  const sims = 300;
  let rejPct = 0;
  let rejBt = 0;
  for (let s = 0; s < sims; s++) {
    const rand = mulberry32(1000 + s);
    const cs: Cell[] = [];
    for (let t = 0; t < 30; t++) {
      const mu = 0.5 * normalDraw(rand);
      for (const arm of ["a", "b"]) {
        const rows: Row[] = [1, 2].map(() => [
          rand() < 0.5,
          Math.exp(mu + normalDraw(rand)),
        ]);
        cs.push(...cells(arm, `t${t}`, rows));
      }
    }
    const o = {
      resamples: 200,
      seed: s + 1,
      zeroSolve: { rule: "min_defined_share" as const, share: 0.5 },
    };
    const pc = compareArms(cs, "a", "b", "cost_per_solved_task", o);
    const bt = compareArms(cs, "a", "b", "cost_per_solved_task", {
      ...o,
      method: "bootstrap-t",
    });
    if (pc.p_value != null && pc.p_value < 0.05) rejPct++;
    if (bt.p_value != null && bt.p_value < 0.05) rejBt++;
  }
  const [ratePct, rateBt] = [rejPct / sims, rejBt / sims];
  console.log(`type I @0.05: percentile ${ratePct}, bootstrap-t ${rateBt}`);
  // Orchestrator's standalone null simulation (scratchpad btp.ts, 2000 sims x
  // 500 resamples), type I at alpha 0.05. Columns: the task's mixed-tail
  // formula / equal-tailed / symmetric |t| (shipped) / percentile:
  //   n=30 sigma=1 reps=2:   0.0655 / 0.0580 / 0.0475 / 0.0645
  //   n=30 sigma=1.5 reps=1: 0.1105 / 0.1030 / 0.0660 / 0.0935
  //   n=40 sigma=1 reps=8:   0.0690 / 0.0610 / 0.0535 / 0.0710
  //   n=24 sigma=1 reps=3:   0.0600 / 0.0535 / 0.0420 / 0.0645
  assert(
    Math.abs(rateBt - 0.05) < Math.abs(ratePct - 0.05),
    `bootstrap-t ${rateBt} vs percentile ${ratePct}`,
  );
});

Deno.test("compareArms bootstrap-t: an aggregate zero denominator follows the zero-solve rule", () => {
  const z = [
    ...cells("A", "t1", [[false, 2]]),
    ...cells("A", "t2", [[true, 2]]),
    ...cells("B", "t1", [[true, 1]]),
    ...cells("B", "t2", [[true, 1]]),
  ];
  const o = { resamples: 400, seed: 3, method: "bootstrap-t" as const };
  const any = compareArms(z, "A", "B", "cost_per_solved_task", o);
  assert(any.bt_undefined_share! > 0 && any.bt_undefined_share! < 1);
  assertEquals([any.p_value, any.ci_log, any.ci_ratio], [null, null, null]);
  const low = any.bt_undefined_share!;
  const ok = compareArms(z, "A", "B", "cost_per_solved_task", {
    ...o,
    zeroSolve: { rule: "min_defined_share", share: (1 - low) / 2 },
  });
  assert(ok.p_value !== null && ok.ci_log !== null);
  const strict = compareArms(z, "A", "B", "cost_per_solved_task", {
    ...o,
    zeroSolve: { rule: "min_defined_share", share: Math.min(1, 1 - low + 0.1) },
  });
  assertEquals([strict.p_value, strict.ci_log], [null, null]);
});

Deno.test("compareArms bootstrap-t: pass_rate is refused; the default stays percentile with no new keys", () => {
  assertThrows(
    () =>
      compareArms(btCells(), "base", "var", "pass_rate", {
        method: "bootstrap-t",
      }),
    ValidationError,
    "bootstrap-t is defined for cost_per_solved_task",
  );
  const d = compareArms(btCells(), "base", "var", "cost_per_solved_task", {
    resamples: 50,
  });
  for (
    const k of ["method", "theta", "se", "t", "ci_log", "ci_ratio"]
  ) assert(!(k in d), k);
});

Deno.test("compareInteraction bootstrap-t: theta is the log-scale interaction contrast with a defined SE", () => {
  const r = compareInteraction(
    factorial(),
    { plain: "P", lsp: "L", realistic: "R", realistic_lsp: "RL" },
    "cost_per_solved_task",
    { method: "bootstrap-t", resamples: 200, seed: 2 },
  );
  assertEquals(r.method, "bootstrap-t");
  // Each arm is all-solved, so L_X = log(mean cost); costs 2.25 / 1.25 / 2.25 / 2.25.
  const mc = (x: number) => Math.log(x + 0.25);
  assertAlmostEquals(r.theta!, (mc(2) - mc(2)) - (mc(1) - mc(2)), 1e-12);
  assert(r.se! > 0);
});

Deno.test("testContrasts: bootstrap-t is the default and adds the Bonferroni interval on the log and ratio scale", () => {
  const { method: _m, ...rest } = O;
  const r = testContrasts(factorial(), SPECS, INTER, "cost_per_solved_task", {
    ...rest,
    family: ["C1", "C2", "C3"],
  });
  const c1 = r[0]!;
  assertEquals(c1.method, "bootstrap-t");
  assert(c1.bonferroni_ci_log !== null && c1.ci_log !== null);
  assert(
    c1.bonferroni_ci_log![1] - c1.bonferroni_ci_log![0] >
      c1.ci_log![1] - c1.ci_log![0],
  );
  assertAlmostEquals(
    c1.bonferroni_ci_ratio![0],
    Math.exp(c1.bonferroni_ci_log![0]),
    1e-12,
  );
  assertEquals(c1.p_value, c1.p_value ?? null);
  assertEquals(c1.decision, c1.delta! < 0 ? c1.decision : "no_decision");
});

Deno.test("compareArms/compareInteraction: zero-task returns disclose the zero-solve rule", () => {
  const cs = [
    ...cells("A", "t1", [["pending", null]]),
    ...cells("B", "t1", [[true, 1]]),
  ];
  const share = { rule: "min_defined_share" as const, share: 0.5 };
  const a = compareArms(cs, "A", "B", "cost_per_solved_task", {
    resamples: 50,
  });
  assertEquals([a.tasks, a.zero_solve], [0, {
    rule: "suppress_any_undefined",
  }]);
  const s = compareArms(cs, "A", "B", "cost_per_solved_task", {
    resamples: 50,
    zeroSolve: share,
  });
  assertEquals([s.tasks, s.zero_solve], [0, share]);
  const arms = { plain: "A", lsp: "B", realistic: "A", realistic_lsp: "B" };
  const i = compareInteraction(cs, arms, "cost_per_solved_task", {
    resamples: 50,
  });
  assertEquals([i.tasks, i.zero_solve], [0, {
    rule: "suppress_any_undefined",
  }]);
  const j = compareInteraction(cs, arms, "cost_per_solved_task", {
    resamples: 50,
    zeroSolve: share,
  });
  assertEquals([j.tasks, j.zero_solve], [0, share]);
});
