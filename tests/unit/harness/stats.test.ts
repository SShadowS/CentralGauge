import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { ValidationError } from "../../../src/errors.ts";
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
