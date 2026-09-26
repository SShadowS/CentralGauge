import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import type { HarnessReport } from "../../../src/harness/report.ts";
import { main, renderCharts } from "../../../scripts/harness/report-charts.ts";

const base = async (): Promise<HarnessReport> =>
  JSON.parse(
    await Deno.readTextFile("tests/fixtures/harness/report-mock-contract.json"),
  );
const get = (fs: { name: string; content: string }[], suffix: string) =>
  fs.find((f) => f.name.endsWith(suffix))!.content;
// Schema ruling 3: every experiment has its totals in the ledger.
const experiments = [{
  id: "mock-contract",
  attempted_cells: 4,
  executions: 4,
  paid_usd: null,
}];

Deno.test("charts: campaign and current reports of one experiment get distinct names; an exact duplicate is refused", async () => {
  const a = await base();
  const b = { ...a, judging: { ...a.judging, source: "current" as const } };
  const names = renderCharts([a, b]).map((f) => f.name);
  assertEquals(new Set(names).size, names.length);
  assertThrows(() => renderCharts([a, a]), Error, "duplicate report");
});

Deno.test("charts: exact arm values and the null reason, no NaN anywhere", async () => {
  const fs = renderCharts([await base()]);
  const row = get(fs, "arms.csv").split("\n").find((l) =>
    l.includes(",mock-naive-lock-table,")
  )!;
  assert(row.includes(",n/a,no solves,0,0,"), row); // cost, reason, pass_rate, pass_k
  for (const f of fs) assert(!f.content.includes("NaN"), f.name);
});

Deno.test("charts: every CI branch keeps delta and interval next to the verdict text", async () => {
  const r = await base();
  const primary = r.comparisons.find((c) => c.primary)!;
  const variants = [
    {
      ...primary,
      delta: -0.5,
      ci: [-0.9, -0.1] as [number, number],
      distinguishable: true,
    },
    {
      ...primary,
      delta: -0.2,
      ci: [-0.6, 0.3] as [number, number],
      distinguishable: false,
    },
    {
      ...primary,
      delta: -0.2,
      ci: null,
      distinguishable: null,
      undefined_share: 0.12,
    },
  ];
  const texts = [
    "distinguishable",
    "not distinguishable",
    "CI suppressed (12% undefined)",
  ];
  variants.forEach((c, i) => {
    const svg = get(renderCharts([{ ...r, comparisons: [c] }]), "-primary.svg");
    assert(svg.includes(texts[i]!), texts[i]);
    if (i === 0) assert(!svg.includes("not distinguishable"));
    if (c.ci) {
      assert(
        svg.includes(`[${c.ci[0].toFixed(2)}, ${c.ci[1].toFixed(2)}]`) &&
          svg.includes(c.delta!.toFixed(2)),
      );
    }
    assert(svg.includes(`${c.pairs} matched pairs`));
  });
});

Deno.test("charts: cost-primary report leads with cost; outcome and task charts are labelled exploratory", async () => {
  const r = await base();
  // A coherent cost-primary report: declaration, labels and comparison flags all switched.
  const cost = {
    ...r,
    experiment: {
      ...r.experiment,
      primary_metric: "cost_per_solved_task" as const,
    },
    metric_labels: {
      ...r.metric_labels,
      cost_per_solved_task: "primary" as const,
      pass_rate: "exploratory" as const,
    },
    comparisons: r.comparisons.map((c) => ({
      ...c,
      primary: c.metric === "cost_per_solved_task",
      label: c.metric === "cost_per_solved_task"
        ? "primary" as const
        : "exploratory" as const,
    })),
  };
  const fs = renderCharts([cost]);
  assert(get(fs, "-primary.svg").includes("Cost per solved task"));
  assert(get(fs, "-outcome.svg").includes("exploratory"));
  assert(get(fs, "-tasks.svg").includes("exploratory"));
});

Deno.test("charts: provisional marks every chart and the provisional column of arms.csv and provenance.csv", async () => {
  const fs = renderCharts([{ ...(await base()), provisional: true }]);
  for (const f of fs.filter((x) => x.name.endsWith(".svg"))) {
    assert(f.content.includes("PROVISIONAL"), f.name);
  }
  for (const name of ["arms.csv", "provenance.csv"]) {
    const [head, ...rows] = get(fs, name).trim().split("\n").map((l) =>
      l.split(",")
    );
    const col = head!.indexOf("provisional");
    assert(col >= 0, name);
    for (const row of rows) assertEquals(row[col], "true", name);
  }
});

Deno.test("charts: the ledger becomes ledger.csv and must agree with the reports", async () => {
  const r = await base();
  const ledger = {
    v: 1 as const,
    paid_total_usd: 12.5,
    openrouter_actual_usd: 12.5,
    claude_code_cash_usd: 0 as const,
    openrouter_balance_readings: [{
      at: "2026-10-15T10:00:00.000Z",
      balance_usd: 47.5,
    }],
    experiments,
    manual_reruns: [],
    rejudges: [],
    pi_stop: {
      fired: false,
      experiment: null,
      at: null,
      last_complete_repeat: null,
      decision: null,
    },
  };
  const csv = get(renderCharts([r], ledger), "ledger.csv");
  assert(csv.includes("scalar,,,paid_total_usd,12.5,all,"));
  assert(csv.includes("scalar,,,claude_code_cash_usd,0,all,"));
  const wrongRerun = {
    ...ledger,
    manual_reruns: [{
      experiment: r.experiment.id,
      campaign: r.campaign.id,
      task: "HX-001",
      repeat: 1,
      arm: r.arms[0]!.arm,
      execution: "x",
      decision: "d",
    }],
  };
  assertThrows(() => renderCharts([r], wrongRerun), Error, "manual reruns");
  assertThrows(
    () => renderCharts([r], { ...ledger, openrouter_actual_usd: 10 }),
    Error,
    "balance",
  );
});

Deno.test("charts: a manual rerun in a cut repeat is kept in the ledger, disclosed as excluded, and not compared", async () => {
  const r = await base();
  const cut = { ...r, repeats: { planned: 3, reported: 2 } }; // scoped coverage: manual_reruns 0 in the fixture
  const arm = r.arms[0]!.arm;
  const rerun = (repeat: number) => ({
    experiment: r.experiment.id,
    campaign: r.campaign.id,
    task: "HX-001",
    repeat,
    arm,
    execution: `x${repeat}`,
    decision: "d",
  });
  const ledger = {
    v: 1 as const,
    paid_total_usd: 0,
    openrouter_actual_usd: 0,
    claude_code_cash_usd: 0 as const,
    openrouter_balance_readings: [{
      at: "2026-10-15T10:00:00.000Z",
      balance_usd: 60,
    }],
    experiments,
    manual_reruns: [rerun(3)],
    rejudges: [],
    pi_stop: {
      fired: false,
      experiment: null,
      at: null,
      last_complete_repeat: null,
      decision: null,
    },
  };
  const fs = renderCharts([cut], ledger);
  assert(
    get(fs, "ledger.csv").includes(
      `manual_rerun,${r.experiment.id},${r.campaign.id},HX-001#3:${arm},x3,excluded_repeat,`,
    ),
  );
  assert(get(fs, "-primary.svg").includes("1 excluded action"));
  // The same rerun inside the reported repeats must match scoped coverage, which is 0 here.
  assertThrows(
    () => renderCharts([cut], { ...ledger, manual_reruns: [rerun(1)] }),
    Error,
    "manual reruns",
  );
});

Deno.test("charts: a fired pi stop needs its report at the last complete repeat", async () => {
  const r = await base();
  const stop = (n: number | null) => ({
    v: 1 as const,
    paid_total_usd: 3,
    openrouter_actual_usd: 3,
    claude_code_cash_usd: 0 as const,
    openrouter_balance_readings: [{
      at: "2026-10-12T10:00:00.000Z",
      balance_usd: 57,
    }],
    experiments,
    manual_reruns: [],
    rejudges: [],
    pi_stop: {
      fired: true,
      experiment: r.experiment.id,
      at: "2026-10-12T09:00:00.000Z",
      last_complete_repeat: n,
      decision: "od-1",
    },
  });
  renderCharts([{ ...r, repeats: { planned: 3, reported: 2 } }], stop(2));
  assertThrows(
    () =>
      renderCharts([{ ...r, repeats: { planned: 3, reported: 3 } }], stop(2)),
    Error,
    "last complete repeat",
  );
});

Deno.test("charts: the task chart lists every campaign task, from cells, not only flips", async () => {
  const r = await base();
  const svg = get(renderCharts([{ ...r, flips: [] }]), "-tasks.svg");
  for (const t of new Set(r.cells.map((c) => c.task))) {
    assert(svg.includes(t), t);
  }
});

Deno.test("charts: CSV quoting and SVG escaping", async () => {
  const r = await base();
  const odd = {
    ...r,
    experiment: { ...r.experiment, hypothesis: 'a, "b" <c> & d' },
  };
  const fs = renderCharts([odd]);
  assert(get(fs, "-primary.svg").includes("&lt;c&gt; &amp; d"));
});

// --- Beyond the plan's list: exact values, amendments, Step 4, CLI ---

const ledgerOf = (
  _r: HarnessReport,
  over: Record<string, unknown> = {},
  // deno-lint-ignore no-explicit-any
): any => ({
  v: 1 as const,
  paid_total_usd: 0,
  openrouter_actual_usd: 0,
  claude_code_cash_usd: 0 as const,
  openrouter_balance_readings: [{
    at: "2026-10-15T10:00:00.000Z",
    balance_usd: 60,
  }],
  experiments,
  manual_reruns: [],
  rejudges: [] as unknown[],
  pi_stop: {
    fired: false,
    experiment: null,
    at: null,
    last_complete_repeat: null,
    decision: null,
  },
  ...over,
});

const csvRows = (csv: string) => {
  const [head, ...rows] = csv.trim().split("\n");
  const cols = head!.split(",");
  return rows.map((l) =>
    Object.fromEntries(l.split(",").map((v, i) => [cols[i], v]))
  );
};

Deno.test("charts: exact arms.csv header and the full row of each arm", async () => {
  const r = await base();
  const csv = get(renderCharts([r]), "arms.csv");
  const [head, naive, positive] = csv.trim().split("\n");
  assertEquals(
    head,
    "experiment,campaign,judging,arm,planned_cells,attempted_cells,scored_cells,unscored_cells,pending_cells,unrun_cells,unknown_spend_cells,unknown_spend_terminal_cells,total_spend_usd,pending_spend_usd,unscored_spend_usd,campaign_raw_spend_usd,excluded_cells,excluded_known_spend_usd,cost_per_solved_task,cost_null_reason,pass_rate,pass_k,pass_k_tasks,infra_exposed,manual_reruns,rejudges,provisional",
  );
  const id = `mock-contract,${r.campaign.id},campaign`;
  assertEquals(
    naive,
    `${id},mock-naive-lock-table,2,2,2,0,0,0,0,0,0,0,0,0,0,0,n/a,no solves,0,0,1,0,0,n/a,false`,
  );
  assertEquals(
    positive,
    `${id},mock-positive,2,2,2,0,0,0,0,0,0,0,0,0,0,0,0,,1,1,1,0,0,n/a,false`,
  );
});

Deno.test("charts: cost_null_reason covers no scored cells and no eligible cost cohort", async () => {
  const r = await base();
  const arms = [
    { ...r.arms[0]!, scored_cells: 0, pass_rate: null },
    { ...r.arms[1]!, cost_per_solved_task: null },
  ];
  const rows = csvRows(get(renderCharts([{ ...r, arms }]), "arms.csv"));
  assertEquals(rows.map((x) => x.cost_null_reason), [
    "no scored cells",
    "no eligible cost cohort",
  ]);
  assertEquals(rows[0]!.pass_rate, "n/a");
});

Deno.test("charts: exact comparisons.csv rows for a distinguishable and a suppressed comparison", async () => {
  const r = await base();
  const csv = get(renderCharts([r]), "comparisons.csv");
  const [head, pass, cost] = csv.trim().split("\n");
  assertEquals(
    head,
    "experiment,campaign,judging,metric,label,baseline,variant,pairs,tasks,tasks_dropped,excluded_baseline,excluded_variant,delta,ci_lo,ci_hi,level,undefined_share,distinguishable,verdict_text",
  );
  const id = `mock-contract,${r.campaign.id},campaign`;
  assertEquals(
    pass,
    `${id},pass_rate,primary,mock-naive-lock-table,mock-positive,2,1,0,none,none,1,1,1,0.95,0,true,distinguishable`,
  );
  // No solves in the baseline: delta and CI null, printed n/a, verdict CI suppressed.
  assert(cost!.endsWith(",n/a,n/a,n/a,0.95,1,n/a,CI suppressed"), cost);
  const excl = {
    ...r.comparisons[0]!,
    excluded: { baseline: { pending: 1, unknown_spend: 2 }, variant: {} },
    distinguishable: false,
  };
  const row = get(
    renderCharts([{ ...r, comparisons: [excl] }]),
    "comparisons.csv",
  )
    .trim().split("\n")[1]!;
  assert(row.includes(",pending=1;unknown_spend=2,none,"), row);
  assert(row.endsWith(",false,not distinguishable"), row);
});

Deno.test("charts: a null delta reads n/a with its reason on the primary chart, never 0", async () => {
  const r = await base();
  const c = {
    ...r.comparisons[0]!,
    delta: null,
    ci: null,
    distinguishable: null,
    undefined_share: 1,
  };
  const svg = get(renderCharts([{ ...r, comparisons: [c] }]), "-primary.svg");
  assert(svg.includes("delta n/a (no solved task in the matched pairs)"), svg);
  const none = { ...c, pairs: 0, tasks: 0, tasks_dropped: 1 };
  const svg0 = get(
    renderCharts([{ ...r, comparisons: [none] }]),
    "-primary.svg",
  );
  assert(svg0.includes("delta n/a (no matched pairs)"));
});

Deno.test("charts: exact provenance.csv header and row", async () => {
  const r = await base();
  const [head, row] = get(renderCharts([r]), "provenance.csv").trim().split(
    "\n",
  );
  assertEquals(
    head,
    "experiment,campaign,judging,judging_identity,task_set_identity,tasks,repeats_planned,repeats_reported,resamples,seed,provisional,unscored_spend_null_reason",
  );
  assertEquals(
    row,
    `mock-contract,${r.campaign.id},campaign,${r.judging.identity},${r.campaign.task_set_identity},1,2,2,2000,1,false,`,
  );
});

Deno.test("charts (Step 4): a repeat cut is shown on all three charts and in arms.csv and provenance.csv", async () => {
  const r = await base();
  const cut = {
    ...r,
    repeats: { planned: 3, reported: 2 },
    coverage: r.coverage.map((c) => ({
      ...c,
      excluded_cells: 1,
      excluded_known_spend_usd: 0.25,
      campaign_raw_spend_usd: 0.75,
    })),
  };
  const fs = renderCharts([cut]);
  for (const s of ["-primary.svg", "-outcome.svg", "-tasks.svg"]) {
    assert(
      get(fs, s).includes("Repeats reported 2 of 3; excluded 2 cells, $0.50"),
      s,
    );
  }
  for (const row of csvRows(get(fs, "arms.csv"))) {
    assertEquals(
      [
        row.excluded_cells,
        row.excluded_known_spend_usd,
        row.campaign_raw_spend_usd,
      ],
      ["1", "0.25", "0.75"],
    );
  }
  const p = csvRows(get(fs, "provenance.csv"))[0]!;
  assertEquals([p.repeats_planned, p.repeats_reported], ["3", "2"]);
  // Without a cut the line is absent.
  assert(!get(renderCharts([r]), "-primary.svg").includes("Repeats reported"));
});

Deno.test("charts (ruling 1): every ledger scalar row has kind scalar and scope all", async () => {
  const r = await base();
  const csv = get(renderCharts([r], ledgerOf(r)), "ledger.csv");
  const [head, ...rows] = csv.trim().split("\n");
  assertEquals(head, "kind,experiment,campaign,key,value,scope,decision");
  const keys = rows.map((l) => l.split(","));
  assert(keys.length > 0);
  for (const k of keys) {
    assertEquals(k[0], "scalar", k.join(","));
    assertEquals(k[5], "all", k.join(","));
  }
  assert(!csv.includes("\nscalar,,,pi_stop,"), "pi_stop is not one row");
});

Deno.test("charts (ruling 2): pi_stop is one scalar row per field", async () => {
  const r = await base();
  const fired = ledgerOf(r, {
    paid_total_usd: 3,
    openrouter_actual_usd: 3,
    openrouter_balance_readings: [{
      at: "2026-10-12T10:00:00.000Z",
      balance_usd: 57,
    }],
    pi_stop: {
      fired: true,
      experiment: r.experiment.id,
      at: "2026-10-12T09:00:00.000Z",
      last_complete_repeat: 2,
      decision: "decisions/od-1.md",
    },
  });
  const csv = get(renderCharts([r], fired), "ledger.csv");
  for (
    const line of [
      "scalar,,,pi_stop.fired,true,all,",
      "scalar,,,pi_stop.experiment,mock-contract,all,",
      "scalar,,,pi_stop.at,2026-10-12T09:00:00.000Z,all,",
      "scalar,,,pi_stop.last_complete_repeat,2,all,",
      "scalar,,,pi_stop.decision,decisions/od-1.md,all,",
    ]
  ) assert(csv.includes(line), line);
  const idle = get(renderCharts([r], ledgerOf(r)), "ledger.csv");
  for (
    const line of [
      "scalar,,,pi_stop.fired,false,all,",
      "scalar,,,pi_stop.experiment,n/a,all,",
      "scalar,,,pi_stop.at,n/a,all,",
      "scalar,,,pi_stop.last_complete_repeat,n/a,all,",
      "scalar,,,pi_stop.decision,n/a,all,",
    ]
  ) assert(idle.includes(line), line);
  // A fired stop must name its experiment; a stop that did not fire carries no fields.
  const bad = ledgerOf(r, { pi_stop: { ...fired.pi_stop, experiment: null } });
  assertThrows(
    () =>
      renderCharts([r], {
        ...bad,
        paid_total_usd: 3,
        openrouter_actual_usd: 3,
        openrouter_balance_readings: fired.openrouter_balance_readings,
      }),
    Error,
    "pi_stop",
  );
  const stray = ledgerOf(r, {
    pi_stop: { ...ledgerOf(r).pi_stop, at: "2026-10-12T09:00:00.000Z" },
  });
  assertThrows(() => renderCharts([r], stray), Error, "pi_stop");
});

Deno.test("charts (ruling 3): every ledger experiment gets attempted_cells, executions and paid_usd rows, headline or not", async () => {
  const r = await base();
  const ledger = ledgerOf(r, {
    experiments: [
      ...experiments,
      { id: "cc-vs-pi", attempted_cells: 7, executions: 9, paid_usd: 2.5 },
    ],
  });
  const csv = get(renderCharts([r], ledger), "ledger.csv");
  for (
    const line of [
      "scalar,mock-contract,,mock-contract.attempted_cells,4,all,",
      "scalar,mock-contract,,mock-contract.executions,4,all,",
      "scalar,mock-contract,,mock-contract.paid_usd,n/a,all,",
      // No report given for cc-vs-pi (no headline): its totals are still rows.
      "scalar,cc-vs-pi,,cc-vs-pi.attempted_cells,7,all,",
      "scalar,cc-vs-pi,,cc-vs-pi.executions,9,all,",
      "scalar,cc-vs-pi,,cc-vs-pi.paid_usd,2.5,all,",
    ]
  ) assert(csv.includes(line), line);
  assertThrows(
    () => renderCharts([r], ledgerOf(r, { experiments: [] })),
    Error,
    "no totals for experiment mock-contract",
  );
  assertThrows(
    () =>
      renderCharts(
        [r],
        ledgerOf(r, { experiments: [...experiments, ...experiments] }),
      ),
    Error,
    "duplicate experiment",
  );
});

Deno.test("charts (ruling 4): arms.csv unscored_spend_usd; empty when unknown, the reason in provenance.csv", async () => {
  const r = await base();
  const cell = (arm: string, spend: number | null) => ({
    ...r.cells[0]!,
    arm,
    repeat: 9,
    status: "unscored" as const,
    pass: null,
    spend_usd: spend,
    known_spend_usd: spend ?? 0.1,
  });
  const known = {
    ...r,
    cells: [
      ...r.cells,
      cell("mock-naive-lock-table", 0.25),
      cell("mock-naive-lock-table", 0.5),
    ],
  };
  const fs = renderCharts([known]);
  assertEquals(
    csvRows(get(fs, "arms.csv")).map((x) => x.unscored_spend_usd),
    ["0.75", "0"],
  );
  assertEquals(
    csvRows(get(fs, "provenance.csv"))[0]!.unscored_spend_null_reason,
    "",
  );
  const unknown = {
    ...r,
    cells: [
      ...r.cells,
      cell("mock-positive", null),
      cell("mock-positive", 0.2),
    ],
  };
  const fu = renderCharts([unknown]);
  assertEquals(
    csvRows(get(fu, "arms.csv")).map((x) => x.unscored_spend_usd),
    ["0", ""],
  );
  assertEquals(
    csvRows(get(fu, "provenance.csv"))[0]!.unscored_spend_null_reason,
    "mock-positive: 1 of 2 unscored cells with unknown cost",
  );
});

Deno.test("charts (ruling 5): arms.csv rejudges counts scoped rejudges per arm; n/a without a ledger", async () => {
  const r = await base();
  const cut = { ...r, repeats: { planned: 3, reported: 2 } };
  const rj = (arm: string, repeat: number, campaign = r.campaign.id) => ({
    experiment: r.experiment.id,
    campaign,
    task: "HX-001",
    repeat,
    arm,
    execution: `e${repeat}`,
    judgment: `j${repeat}`,
    decision: "d",
  });
  const ledger = ledgerOf(r, {
    rejudges: [
      rj("mock-positive", 1),
      rj("mock-positive", 2),
      rj("mock-positive", 3), // above the cut: excluded_repeat, not counted
      rj("mock-naive-lock-table", 1, "other-campaign"), // not_reported, not counted
    ],
  });
  const fs = renderCharts([cut], ledger);
  assertEquals(csvRows(get(fs, "arms.csv")).map((x) => x.rejudges), ["0", "2"]);
  const csv = get(fs, "ledger.csv");
  assert(
    csv.includes(
      `rejudge,mock-contract,${r.campaign.id},HX-001#1:mock-positive,e1/j1,reported,d`,
    ),
  );
  assert(
    csv.includes(
      `rejudge,mock-contract,${r.campaign.id},HX-001#3:mock-positive,e3/j3,excluded_repeat,d`,
    ),
  );
  assert(
    csv.includes(
      "rejudge,mock-contract,other-campaign,HX-001#1:mock-naive-lock-table,e1/j1,not_reported,d",
    ),
  );
  assert(get(fs, "-primary.svg").includes("2 excluded action(s) (ledger.csv)"));
  assertEquals(
    csvRows(get(renderCharts([r]), "arms.csv")).map((x) => x.rejudges),
    ["n/a", "n/a"],
  );
});

Deno.test("charts: ledger.csv quotes fields with commas and quotes", async () => {
  const r = await base();
  const ledger = ledgerOf(r, {
    rejudges: [{
      experiment: r.experiment.id,
      campaign: "other",
      task: "HX-001",
      repeat: 1,
      arm: "mock-positive",
      execution: "e",
      judgment: "j",
      decision: 'owner said "ok", twice',
    }],
  });
  const csv = get(renderCharts([r], ledger), "ledger.csv");
  assert(csv.includes(`,not_reported,"owner said ""ok"", twice"`), csv);
});

Deno.test("charts: a ledger that fails its schema is refused", async () => {
  const r = await base();
  assertThrows(
    () => renderCharts([r], ledgerOf(r, { extra: 1 })),
    Error,
    "ledger",
  );
  assertThrows(
    () => renderCharts([r], ledgerOf(r, { claude_code_cash_usd: 1 })),
    Error,
    "ledger",
  );
});

Deno.test("charts CLI: writes 3 SVGs and 3 CSVs, 4 with a ledger; refuses a non-empty --out", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const report = "tests/fixtures/harness/report-mock-contract.json";
    const out = join(dir, "charts");
    assertEquals(await main(["--out", out, "--report", report]), 0);
    const names = [];
    for await (const e of Deno.readDir(out)) names.push(e.name);
    assertEquals(names.filter((n) => n.endsWith(".svg")).length, 3);
    assertEquals(names.filter((n) => n.endsWith(".csv")).sort(), [
      "arms.csv",
      "comparisons.csv",
      "provenance.csv",
    ]);
    await assertRejects(
      () => main(["--out", out, "--report", report]),
      Error,
      "not empty",
    );
    const r = await base();
    const ledgerPath = join(dir, "ledger.json");
    await Deno.writeTextFile(ledgerPath, JSON.stringify(ledgerOf(r)));
    const out2 = join(dir, "charts2");
    assertEquals(
      await main(["--out", out2, "--report", report, "--ledger", ledgerPath]),
      0,
    );
    const csvs = [];
    for await (const e of Deno.readDir(out2)) {
      if (e.name.endsWith(".csv")) csvs.push(e.name);
    }
    assertEquals(csvs.length, 4);
    await assertRejects(
      () => main(["--out", join(dir, "c3")]),
      Error,
      "--report",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
