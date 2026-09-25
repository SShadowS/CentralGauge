import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { ValidationError } from "../../../src/errors.ts";
import {
  armSummary,
  type Cell,
  type CellStatus,
  compareArms,
  mulberry32,
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
