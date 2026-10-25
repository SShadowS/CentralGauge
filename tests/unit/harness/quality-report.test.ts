import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "../../utils/temp-dir.ts";
import {
  aggregate,
  ALSEM_METRICS,
  alsemTable,
  bootstrapCi,
  cohortStats,
  collectPairs,
  CONTEXT_METRICS,
  extraTable,
  judgeMetrics,
  loto,
  pairDiffs,
  parseCsv,
  percentileCi,
  runReport,
  signTest,
  taskMeans,
  TESTRERUN_METRICS,
  testRerunTable,
  wilcoxon,
  wording,
} from "../../../scripts/harness/quality-report.ts";

const A = [0.5, 1.2, -0.25, 2.0, 0.0, 0.75, 1.5, -1.1, 3.0, 0.1];
const B = [1, 1, -1, 2, -2, 0, 3];
const TOL = 1e-12;

Deno.test("signTest known answers", () => {
  assertAlmostEquals(signTest(7, 2), 0.1796875, TOL);
  assertAlmostEquals(signTest(17, 5), 0.01690053939819336, TOL);
  assertAlmostEquals(signTest(9, 0), 0.00390625, TOL);
  assertEquals(signTest(0, 0), 1);
  assertAlmostEquals(signTest(4, 2), 0.6875, TOL);
});

Deno.test("wilcoxon exact: A and B (rank ties)", () => {
  const a = wilcoxon(A);
  assertEquals([a.wPlus, a.n], [38, 9]);
  assertAlmostEquals(a.p, 0.07421875, TOL);
  const b = wilcoxon(B);
  assertEquals([b.wPlus, b.n], [14.5, 6]);
  assertAlmostEquals(b.p, 0.53125, TOL);
});

Deno.test("wilcoxon n > 30 uses the normal approximation", () => {
  const xs = Array.from(
    { length: 35 },
    (_, i) => (i + 1) * (i % 3 === 0 ? -1 : 1),
  );
  const w = wilcoxon(xs);
  assertEquals(w.n, 35);
  assert(w.p > 0 && w.p <= 1);
});

Deno.test("aggregate A: k/m/t, median, mean, tie at exact zero", () => {
  const g = aggregate(A);
  assertEquals([g.k, g.m, g.t, g.nTasks], [7, 2, 1, 10]);
  assertAlmostEquals(g.median, 0.625, TOL);
  assertAlmostEquals(g.mean, 0.77, TOL);
  assertAlmostEquals(g.signP, 0.1796875, TOL);
  // a task whose repeats cancel exactly is tied
  const tm = taskMeans([
    { task: "T", repeat: 1, d: 1 },
    { task: "T", repeat: 2, d: -1 },
  ]);
  assertEquals(aggregate(tm.map((x) => x.score)).t, 1);
});

Deno.test("loto A: ten means, range, no flip", () => {
  const l = loto(A);
  const want = [
    0.8,
    0.722222,
    0.883333,
    0.633333,
    0.855556,
    0.772222,
    0.688889,
    0.977778,
    0.522222,
    0.844444,
  ];
  l.means.forEach((x, i) => assertAlmostEquals(x, want[i]!, 1e-6));
  assertAlmostEquals(l.min!, 0.522222, 1e-6);
  assertAlmostEquals(l.max!, 0.977778, 1e-6);
  assertEquals(l.flips, false);
});

Deno.test("loto flips when one task carries the sign", () => {
  const l = loto([10, -1, -1, -1]);
  assertEquals(l.flips, true);
  assertEquals(aggregate([10, -1, -1, -1]).loto.flips, true);
});

Deno.test("bootstrap: seed reproducible, seed sensitive, contains mean", () => {
  const a = bootstrapCi(A, 10000, 1)!;
  assertEquals(bootstrapCi(A, 10000, 1), a);
  assertNotEquals(bootstrapCi(A, 10000, 2), a);
  const mean = A.reduce((x, y) => x + y, 0) / A.length;
  assert(a[0] <= mean && mean <= a[1]);
});

Deno.test("orientation: lower-is-better variant lower gives d > 0", () => {
  const table = new Map([
    ["base|T|1", { cost_usd: 2 }],
    ["var|T|1", { cost_usd: 1 }],
  ]);
  const pairs = [{ base: "base", variant: "var", task: "T", repeat: 1 }];
  assertEquals(pairDiffs(pairs, table, "cost_usd", false)[0]!.d, 1);
  assertEquals(pairDiffs(pairs, table, "cost_usd", true)[0]!.d, -1);
});

Deno.test("pairDiffs: pair missing one side is absent", () => {
  const table = new Map([
    ["base|T|1", { x: 2 }],
    ["var|T|1", { x: 1 }],
    ["base|T|2", { x: 2 }],
  ]);
  const pairs = [1, 2].map((repeat) => ({
    base: "base",
    variant: "var",
    task: "T",
    repeat,
  }));
  assertEquals(pairDiffs(pairs, table, "x", true).length, 1);
});

Deno.test("adapters fail closed", () => {
  assertThrows(
    () =>
      judgeMetrics([{
        task: "T",
        repeat: 1,
        packet_id: "p",
        dimensions: { conventions: { across: "maybe" } },
      }]),
    Error,
    "maybe",
  );
  const row = (outcome: string, status: string, extra = {}) => ({
    arm: "a",
    task: "T",
    repeat: 1,
    excluded: null,
    agent_vs_start: { outcome },
    shipped_vs_final: { status },
    ...extra,
  });
  assertThrows(() => testRerunTable([row("weird", "pass")]), Error, "weird");
  assertThrows(() => testRerunTable([row("catches", "odd")]), Error, "odd");
  assertThrows(
    () => extraTable("arm,task,repeat,sql\na,T,1,5\n", {}),
    Error,
    "sql",
  );
});

Deno.test("adapters: test-rerun mapping, excluded, not_applicable", () => {
  const t = testRerunTable([
    {
      arm: "a",
      task: "T",
      repeat: 1,
      excluded: null,
      agent_vs_start: { outcome: "catches" },
      shipped_vs_final: { status: "compile_fail" },
    },
    {
      arm: "a",
      task: "U",
      repeat: 1,
      excluded: null,
      agent_vs_start: { outcome: "not_applicable" },
      shipped_vs_final: { status: "pass" },
    },
    {
      arm: "a",
      task: "V",
      repeat: 1,
      excluded: "infra",
      agent_vs_start: { outcome: "catches" },
      shipped_vs_final: { status: "pass" },
    },
  ]);
  assertEquals(t.get("a|T|1"), { agent_catches_bug: 1, shipped_suite_pass: 0 });
  assertEquals(t.get("a|U|1"), { shipped_suite_pass: 1 });
  assertEquals(t.has("a|V|1"), false);
});

Deno.test("adapters: alsem skips excluded and empty cells", () => {
  const t = alsemTable(
    "id,arm,task,repeat,verdict,excluded,curated_weighted_fp,test_coverage_ratio,other\n" +
      "1,a,T,1,pass,,3,,9\n2,a,U,1,pass,infra,4,0.5,9\n",
  );
  assertEquals(t.get("a|T|1"), { curated_weighted_fp: 3 });
  assertEquals(t.has("a|U|1"), false);
});

Deno.test("adapters: judge signs and kappa flags", () => {
  const item = (across: string) => ({
    task: "T",
    repeat: 1,
    packet_id: "p",
    redactions: {},
    dimensions: { conventions: { across } },
  });
  const low = judgeMetrics([item("variant")], {
    dimensions: { conventions: { kappa: { "a|b": 0.3 } } },
  });
  const m = low.get("judge_conventions")!;
  assertEquals(m.signs, [{ task: "T", repeat: 1, d: 1 }]);
  assertEquals([m.lowAgreement, m.kappaNa], [true, false]);
  const na = judgeMetrics([item("tie")], {
    dimensions: { conventions: { kappa: { "a|b": null } } },
  }).get("judge_conventions")!;
  assertEquals([na.lowAgreement, na.kappaNa], [false, true]);
  assertEquals(na.signs[0]!.d, 0);
  const missing = judgeMetrics([item("missing")]).get("judge_conventions")!;
  assertEquals(missing.signs.length, 0);
  assertEquals(
    judgeMetrics([item("baseline")]).get("judge_conventions")!.signs[0]!.d,
    -1,
  );
});

Deno.test("parseCsv handles quotes and embedded newlines", () => {
  assertEquals(parseCsv('a,b\n"x,1","y\n""z"""\n'), [{
    a: "x,1",
    b: 'y\n"z"',
  }]);
});

Deno.test("wording guard", () => {
  const consistent = aggregate([1, 2, 3, 0]);
  assertStringIncludes(wording(consistent, "S"), "consistent in stratum S");
  assertStringIncludes(
    wording(consistent, "S"),
    "variant better on 3 tasks, worse on 0, tied on 1",
  );
  assertStringIncludes(wording(aggregate([1, 2]), "S"), "task-dependent");
  assertStringIncludes(
    wording(aggregate([1, 2, 3, -1]), "S"),
    "task-dependent",
  );
  assertStringIncludes(
    wording(aggregate([10, -1, -1, -1]), "S"),
    "task-dependent",
  );
});

// ------------------------------------------------------------ end to end

async function writeFixture(root: string, withAxes: boolean) {
  const camp = join(root, "camp");
  await Deno.mkdir(join(camp, "alsem"), { recursive: true });
  const tasks = ["T1", "T2", "T3", "T4"];
  const prs: string[] = [
    "base,variant,task,kind,repeat,base_id,variant_id,outcome",
  ];
  const ex: string[] = ["id,arm,task,repeat,cost_usd,wall_min"];
  const als: string[] = [
    "id,arm,task,repeat,verdict,excluded,curated_weighted_fp,test_coverage_ratio",
  ];
  const rr: unknown[] = [];
  for (const t of tasks) {
    const reps = t === "T1" ? [1, 2, 3] : [1];
    for (const r of reps) {
      prs.push(`plain,skill,${t},fix,${r},b-${t}-${r},v-${t}-${r},both_pass`);
      ex.push(`b-${t}-${r},plain,${t},${r},2,10`);
      ex.push(`v-${t}-${r},skill,${t},${r},1,${t === "T4" ? 12 : 8}`);
      als.push(`1,plain,${t},${r},pass,,5,0.5`);
      als.push(`2,skill,${t},${r},pass,,${t === "T4" ? 6 : 3},0.6`);
      for (const arm of ["plain", "skill"]) {
        rr.push({
          arm,
          task: t,
          repeat: r,
          excluded: null,
          agent_vs_start: { outcome: arm === "skill" ? "catches" : "misses" },
          shipped_vs_final: { status: "pass" },
        });
      }
    }
  }
  await Deno.writeTextFile(join(camp, "pairs.csv"), prs.join("\n") + "\n");
  await Deno.writeTextFile(join(camp, "executions.csv"), ex.join("\n") + "\n");
  if (!withAxes) return { camp };
  await Deno.writeTextFile(
    join(camp, "alsem", "executions.csv"),
    als.join("\n") + "\n",
  );
  await Deno.mkdir(join(camp, "test-rerun"));
  await Deno.writeTextFile(
    join(camp, "test-rerun", "executions.json"),
    JSON.stringify(rr),
  );
  const judge = join(root, "judge");
  await Deno.mkdir(join(judge, "key"), { recursive: true });
  await Deno.writeTextFile(
    join(judge, "key", "key.json"),
    JSON.stringify(
      Object.fromEntries(
        tasks.map((
          t,
        ) => ["p" + t, { A: "plain", B: "skill", a_role: "baseline" }]),
      ),
    ),
  );
  await Deno.writeTextFile(
    join(judge, "pairs.json"),
    JSON.stringify(
      tasks.map((t) => ({
        task: t,
        repeat: 1,
        packet_id: "p" + t,
        dimensions: { conventions: { across: "variant" } },
      })),
    ),
  );
  await Deno.writeTextFile(
    join(judge, "summary.json"),
    JSON.stringify({ dimensions: { conventions: { kappa: { "a|b": 0.3 } } } }),
  );
  const extra = join(root, "extra.csv");
  await Deno.writeTextFile(
    extra,
    "arm,task,repeat,sql_cost\n" +
      tasks.map((t) => `plain,${t},1,10\nskill,${t},1,4`).join("\n") + "\n",
  );
  const strata = join(root, "strata.csv");
  await Deno.writeTextFile(
    strata,
    "task,stratum\nT1,events\nT2,events\nT3,events\nT4,caching\n",
  );
  return { camp, judge, extra, strata };
}

Deno.test("end to end: only --campaign reports Missing axes", async () => {
  await withTempDir(async (root) => {
    const f = await writeFixture(root, false);
    const out = join(root, "out");
    await runReport({ campaign: f.camp, out });
    const md = await Deno.readTextFile(join(out, "report.md"));
    assertStringIncludes(md, "Missing axes");
    assertStringIncludes(md, "alsem");
    assertStringIncludes(md, "cost_usd");
    const head = parseCsv(await Deno.readTextFile(join(out, "headline.csv")));
    assert(head.every((r) => r["group"] === "context"));
    assertEquals(head.length, 2);
  });
});

Deno.test("end to end: full fixture, no pooling, header columns", async () => {
  await withTempDir(async (root) => {
    const f = await writeFixture(root, true);
    const out = join(root, "out");
    await runReport({
      campaign: f.camp,
      out,
      judge: [f.judge!],
      extra: [f.extra!],
      metric: ["sql_cost:lower"],
      strata: f.strata,
      boot: 500,
      seed: 3,
    });
    const hText = await Deno.readTextFile(join(out, "headline.csv"));
    assertEquals(
      hText.split("\n")[0],
      "base,variant,stratum,metric,group,status,expected_pairs,observed_pairs,na_pairs,expected_tasks,observed_tasks,missing_base_no_row,missing_base_excluded,missing_base_empty,missing_base_judge_missing,missing_variant_no_row,missing_variant_excluded,missing_variant_empty,missing_variant_judge_missing,n_tasks,k,m,t,median,mean,median_raw,mean_raw,ci_lo,ci_hi,sign_p,wilcoxon_w_plus,wilcoxon_n,wilcoxon_p,loto_min,loto_max,loto_flips,low_agreement,kappa_na,wording,unverified,ids_unverified",
    );
    const tText = await Deno.readTextFile(join(out, "tasks.csv"));
    assertEquals(
      tText.split("\n")[0],
      "base,variant,metric,task,stratum,n_pairs,task_score,task_raw_mean,task_sign",
    );
    assert((await Deno.readTextFile(join(out, "report.md"))).length > 0);
    const tasks = parseCsv(tText);
    const t1 = tasks.filter((r) =>
      r["metric"] === "cost_usd" && r["task"] === "T1"
    );
    assertEquals(t1.length, 1);
    assertEquals(t1[0]!["n_pairs"], "3");
    assertEquals(t1[0]!["stratum"], "events");
    const head = parseCsv(hText);
    const get = (stratum: string, metric: string) =>
      head.find((r) => r["stratum"] === stratum && r["metric"] === metric)!;
    const cost = get("all", "cost_usd");
    assertEquals(cost["n_tasks"], "4");
    assertEquals(cost["group"], "context");
    assertEquals(get("all", "judge_conventions")["low_agreement"], "true");
    assertEquals(get("all", "sql_cost")["k"], "4");
    assertStringIncludes(
      get("events", "sql_cost")["wording"]!,
      "consistent in stratum events",
    );
    assertStringIncludes(
      get("caching", "sql_cost")["wording"]!,
      "task-dependent",
    );
    assertEquals(get("all", "agent_catches_bug")["group"], "quality");
    // wall_min is worse for the variant on T4 only
    const wall = get("all", "wall_min");
    assertEquals([wall["k"], wall["m"]], ["3", "1"]);
  });
});

// ------------------------------------------------- self-check r1 regressions

const C = [
  -1.5,
  -0.5,
  -0.5,
  1.5,
  3.0,
  -3.5,
  -2.5,
  -1.5,
  0.5,
  1.0,
  1.5,
  -2.5,
  3.5,
  -2.5,
  2.0,
  -0.5,
  0.5,
  -1.5,
  2.5,
  4.0,
  2.5,
  -1.5,
  -0.5,
  -0.5,
  2.0,
  2.5,
  -3.5,
  -2.5,
  -1.5,
  1.0,
  0.5,
];
const D = [
  -0.83,
  0.54,
  1.91,
  -1.72,
  -0.35,
  1.02,
  2.39,
  -1.24,
  0.13,
  1.5,
  -2.13,
  -0.76,
  0.61,
  1.98,
  -1.65,
  -0.28,
  1.09,
  2.46,
  -1.17,
  0.2,
  1.57,
  -2.06,
  -0.69,
  0.68,
  2.05,
  -1.58,
  -0.21,
  1.16,
  2.53,
  -1.1,
];

Deno.test("wilcoxon n = 31 normal path with ties (scipy known answer)", () => {
  const w = wilcoxon(C);
  assertEquals([w.wPlus, w.n], [253.5, 31]);
  assertAlmostEquals(w.p, 0.921566033427682, 1e-6);
});

Deno.test("wilcoxon n = 30 boundary stays exact (scipy known answer)", () => {
  const w = wilcoxon(D);
  assertEquals([w.wPlus, w.n], [260, 30]);
  assertAlmostEquals(w.p, 0.583757072687149, 1e-9);
});

Deno.test("percentileCi pins the order statistics", () => {
  const s = Array.from({ length: 10000 }, (_, i) => i);
  assertEquals(percentileCi(s), [250, 9749]);
  const h = Array.from({ length: 100 }, (_, i) => i);
  assertEquals(percentileCi(h), [2, 97]);
});

Deno.test("bootstrapCi rejects invalid boot counts", () => {
  for (const b of [0, -5, 1.5, NaN, Infinity]) {
    assertThrows(() => bootstrapCi([1, 2], b, 1), Error, "boot");
    assertThrows(() => bootstrapCi([], b, 1), Error, "boot");
  }
});

Deno.test("semantic direction: the better arm gives sign +1 for every directional metric", () => {
  // [metric, base value, variant value] where the variant is the better arm
  const better: [string, number, number][] = [
    ["curated_weighted_fp", 5, 2],
    ["alsem_new_findings_fp", 3, 1],
    ["alsem_new_high_findings", 2, 0],
    ["new_unused", 4, 1],
    ["test_coverage_ratio", 0.4, 0.8],
    ["test_assert_reachable_mean", 1, 3],
    ["test_zero_assert_share", 0.5, 0.1],
    ["agent_catches_bug", 0, 1],
    ["shipped_suite_pass", 0, 1],
    ["cost_usd", 3, 1],
    ["wall_min", 20, 10],
  ];
  const pairs = [{ base: "b", variant: "v", task: "T", repeat: 1 }];
  for (const [metric, b, v] of better) {
    const dir = metric in ALSEM_METRICS
      ? ALSEM_METRICS[metric]!
      : metric in TESTRERUN_METRICS
      ? TESTRERUN_METRICS[metric]!
      : CONTEXT_METRICS[metric]!;
    const table = new Map([
      ["b|T|1", { [metric]: b }],
      ["v|T|1", { [metric]: v }],
    ]);
    const o = collectPairs(pairs, table, metric, dir);
    assertEquals(
      taskMeans(
        o.flatMap((x) =>
          x.d === undefined ? [] : [{ task: x.task, repeat: x.repeat, d: x.d }]
        ),
      )[0]!.score,
      1,
      metric,
    );
    // and the reverse is -1
    const rev = new Map([
      ["b|T|1", { [metric]: v }],
      ["v|T|1", { [metric]: b }],
    ]);
    const r = collectPairs(pairs, rev, metric, dir);
    assertEquals(Math.sign(r[0]!.d!), -1, metric);
  }
  // the literal-expected share has no direction
  assertEquals(ALSEM_METRICS["test_areequal_literal_share"], null);
});

Deno.test("fail closed: inherited names are not enum values or declarations", () => {
  const item = (across: string) => ({
    task: "T",
    repeat: 1,
    dimensions: { d: { across } },
  });
  for (const v of ["constructor", "toString", "__proto__"]) {
    assertThrows(() => judgeMetrics([item(v)]), Error, v);
  }
  assertThrows(
    () => extraTable("arm,task,repeat,constructor\na,T,1,5\n", {}),
    Error,
    "constructor",
  );
  assertThrows(
    () => extraTable("arm,task,repeat,toString\n", {}),
    Error,
    "toString",
  );
});

Deno.test("fail closed: kappa leaves are finite numbers or null", () => {
  const it = [{ task: "T", repeat: 1, dimensions: { d: { across: "tie" } } }];
  const bads: unknown[] = [
    { "a|b": "0.3" },
    "0.3",
    [0.3],
    { "a|b": [1] },
    { "a|b": NaN },
  ];
  for (const bad of bads) {
    assertThrows(
      () => judgeMetrics(it, { dimensions: { d: { kappa: bad } } }),
      Error,
      "kappa",
    );
  }
  assertEquals(
    judgeMetrics(it, { dimensions: { d: { kappa: 0.9 } } }).get("judge_d")!
      .lowAgreement,
    false,
  );
});

Deno.test("test-rerun partial rows: absent result only drops that metric", () => {
  const t = testRerunTable([
    { arm: "a", task: "T", repeat: 1, shipped_vs_final: { status: "pass" } },
    { arm: "a", task: "U", repeat: 1, agent_vs_start: { outcome: "catches" } },
  ]);
  assertEquals(t.get("a|T|1"), { shipped_suite_pass: 1 });
  assertEquals(t.get("a|U|1"), { agent_catches_bug: 1 });
  assertThrows(
    () =>
      testRerunTable([{
        arm: "a",
        task: "T",
        repeat: 1,
        agent_vs_start: { outcome: "weird" },
      }]),
    Error,
    "weird",
  );
  assertThrows(
    () =>
      testRerunTable([{
        arm: "a",
        task: "T",
        repeat: 1,
        shipped_vs_final: { status: "odd" },
      }]),
    Error,
    "odd",
  );
});

async function judgeRun(
  mutate: (judge: string) => Promise<void>,
  extraOpts: { judgeUnverified?: boolean } = {},
): Promise<Error | null> {
  let err: Error | null = null;
  await withTempDir(async (root) => {
    const f = await writeFixture(root, true);
    await mutate(f.judge!);
    try {
      await runReport({
        campaign: f.camp,
        out: join(root, "out"),
        judge: [f.judge!],
        boot: 50,
        ...extraOpts,
      });
    } catch (e) {
      err = e as Error;
    }
  });
  return err;
}

const writeJson = (p: string, v: unknown) =>
  Deno.writeTextFile(p, JSON.stringify(v));
const jItem = (task: string, repeat = 1) => ({
  task,
  repeat,
  packet_id: "p" + task,
  dimensions: { conventions: { across: "variant" } },
});

Deno.test("judge join: unmatched task and duplicate pair throw", async () => {
  const e1 = await judgeRun((j) =>
    writeJson(join(j, "pairs.json"), [jItem("T1"), jItem("ZZ")])
  );
  assert(e1 && /ZZ/.test(e1.message), String(e1));
  const e2 = await judgeRun((j) =>
    writeJson(join(j, "pairs.json"), [jItem("T1"), jItem("T1")])
  );
  assert(e2 && /duplicate/i.test(e2.message), String(e2));
});

Deno.test("judge provenance: wrong campaign key and swapped arms throw", async () => {
  const keyed = (k: unknown) => (j: string) =>
    writeJson(join(j, "key", "key.json"), k);
  const all = (A: string, B: string, a_role: string) =>
    Object.fromEntries(
      ["T1", "T2", "T3", "T4"].map((t) => ["p" + t, { A, B, a_role }]),
    );
  const e1 = await judgeRun(keyed(all("other", "skill", "baseline")));
  assert(e1 && /key/i.test(e1.message), String(e1));
  const e2 = await judgeRun(keyed(all("skill", "plain", "baseline")));
  assert(e2 && /key/i.test(e2.message), String(e2));
  const e3 = await judgeRun(keyed({}));
  assert(e3 && /key/i.test(e3.message), String(e3));
  // a consistent swapped layout (A = variant, a_role variant) is valid
  assertEquals(await judgeRun(keyed(all("skill", "plain", "variant"))), null);
});

Deno.test("judge provenance: missing key.json needs --judge-unverified", async () => {
  const rm = (j: string) => Deno.remove(join(j, "key"), { recursive: true });
  const e = await judgeRun(rm);
  assert(e && /judge-unverified/.test(e.message), String(e));
  await withTempDir(async (root) => {
    const f = await writeFixture(root, true);
    await rm(f.judge!);
    const out = join(root, "out");
    await runReport({
      campaign: f.camp,
      out,
      judge: [f.judge!],
      judgeUnverified: true,
      boot: 50,
    });
    const h = parseCsv(await Deno.readTextFile(join(out, "headline.csv")));
    const j = h.find((r) => r["metric"] === "judge_conventions")!;
    assertEquals(j["unverified"], "true");
    assertEquals(
      h.find((r) => r["metric"] === "cost_usd")!["unverified"],
      "false",
    );
  });
});

Deno.test("strata map may not use the reserved name all", async () => {
  await withTempDir(async (root) => {
    const f = await writeFixture(root, false);
    const s = join(f.camp, "s.csv");
    await Deno.writeTextFile(s, "task,stratum\nT1,all\nT2,x\n");
    let err: Error | null = null;
    try {
      await runReport({ campaign: f.camp, out: join(root, "out"), strata: s });
    } catch (e) {
      err = e as Error;
    }
    assert(err && /reserved/i.test(err.message), String(err));
  });
});

Deno.test("Missing axes uses effective matched availability", async () => {
  const missingLine = async (mutate: (j: string) => Promise<void>) => {
    let line = "";
    await withTempDir(async (root) => {
      const f = await writeFixture(root, true);
      await mutate(f.judge!);
      const out = join(root, "out");
      await runReport({ campaign: f.camp, out, judge: [f.judge!], boot: 50 });
      line = (await Deno.readTextFile(join(out, "report.md")))
        .split("\n").find((l) => l.startsWith("Missing axes"))!;
    });
    return line;
  };
  assertStringIncludes(
    await missingLine((j) => writeJson(join(j, "pairs.json"), [])),
    "judge",
  );
  assertStringIncludes(
    await missingLine((j) =>
      writeJson(join(j, "pairs.json"), [{
        ...jItem("T1"),
        dimensions: { conventions: { across: "missing" } },
      }])
    ),
    "judge",
  );
  assertStringIncludes(
    await missingLine(() => Promise.resolve()),
    "Missing axes: extra",
  );
});

Deno.test("end to end: unequal repeats use task-weighted statistics", async () => {
  await withTempDir(async (root) => {
    const f = await writeFixture(root, true);
    const out = join(root, "out");
    await runReport({ campaign: f.camp, out, boot: 200, seed: 1 });
    const h = parseCsv(await Deno.readTextFile(join(out, "headline.csv")));
    const w = h.find((r) => r["metric"] === "wall_min")!;
    // task raw means 2, 2, 2, -2 -> mean_raw 1 (pooled would be 4/3); the
    // inferential score is the mean of pair signs: 1, 1, 1, -1
    assertAlmostEquals(Number(w["mean_raw"]), 1, 1e-9);
    assertAlmostEquals(Number(w["median_raw"]), 2, 1e-9);
    assertAlmostEquals(Number(w["mean"]), 0.5, 1e-9);
    assertAlmostEquals(Number(w["median"]), 1, 1e-9);
    assertAlmostEquals(Number(w["loto_min"]), 1 / 3, 1e-9);
    assertAlmostEquals(Number(w["loto_max"]), 1, 1e-9);
  });
});

// ------------------------------------------------------- self-check r2

Deno.test("test-rerun: only absent/null is missing; other non-objects throw", () => {
  const row = (extra: Record<string, unknown>) =>
    [{ arm: "a", task: "T", repeat: 1, ...extra }] as never;
  assertEquals(
    testRerunTable(row({ agent_vs_start: null })).get("a|T|1"),
    {},
  );
  for (const bad of [false, 0, "", [], "x", 5]) {
    assertThrows(
      () => testRerunTable(row({ agent_vs_start: bad })),
      Error,
      "agent_vs_start",
    );
    assertThrows(
      () => testRerunTable(row({ shipped_vs_final: bad })),
      Error,
      "shipped_vs_final",
    );
  }
});

Deno.test("extraTable validates a multiline quoted header", () => {
  assertThrows(
    () => extraTable('arm,task,repeat,"sql\ncost",undeclared\na,T,1,5,6\n', {}),
    Error,
    "undeclared",
  );
});

Deno.test("bootstrap CI regression pins (seeded)", async () => {
  assertEquals(bootstrapCi(A, 10000, 1), [0.08999999999999997, 1.475]);
  assertEquals(bootstrapCi(A, 10000, 2), [0.08499999999999996, 1.465]);
  await withTempDir(async (root) => {
    const f = await writeFixture(root, true);
    const out = join(root, "out");
    await runReport({ campaign: f.camp, out, boot: 200, seed: 1 });
    const h = parseCsv(await Deno.readTextFile(join(out, "headline.csv")));
    const w = h.find((r) => r["metric"] === "wall_min")!;
    assertEquals([w["ci_lo"], w["ci_hi"]], ["-0.5", "1"]);
  });
});

async function idsRun(
  tweak: (
    items: Record<string, unknown>[],
    key: Record<string, Record<string, unknown>>,
  ) => void,
): Promise<{ err: Error | null; head: Record<string, string>[]; md: string }> {
  let err: Error | null = null;
  let head: Record<string, string>[] = [];
  let md = "";
  await withTempDir(async (root) => {
    const f = await writeFixture(root, true);
    const items = ["T1", "T2", "T3", "T4"].map((t) => ({
      ...jItem(t),
    })) as Record<string, unknown>[];
    const key = JSON.parse(
      await Deno.readTextFile(join(f.judge!, "key", "key.json")),
    );
    tweak(items, key);
    await writeJson(join(f.judge!, "pairs.json"), items);
    await writeJson(join(f.judge!, "key", "key.json"), key);
    await writeJson(join(f.judge!, "summary.json"), {
      campaign_id: "camp-7",
      dimensions: {},
    });
    const out = join(root, "out");
    try {
      await runReport({ campaign: f.camp, out, judge: [f.judge!], boot: 50 });
      head = parseCsv(await Deno.readTextFile(join(out, "headline.csv")));
      md = await Deno.readTextFile(join(out, "report.md"));
    } catch (e) {
      err = e as Error;
    }
  });
  return { err, head, md };
}

const withIds = (
  items: Record<string, unknown>[],
  key: Record<string, Record<string, unknown>>,
  bad?: { item?: string; key?: string },
) => {
  for (const it of items) {
    const t = it["task"] as string;
    it["baseline_id"] = bad?.item ?? `b-${t}-1`;
    it["variant_id"] = `v-${t}-1`;
    key["p" + t]!["baseline_id"] = bad?.key ?? `b-${t}-1`;
    key["p" + t]!["variant_id"] = `v-${t}-1`;
  }
};

Deno.test("judge execution ids: absent -> ids_unverified, campaign_id recorded", async () => {
  const r = await idsRun(() => {});
  assertEquals(r.err, null);
  const j = r.head.find((x) => x["metric"] === "judge_conventions")!;
  assertEquals(j["ids_unverified"], "true");
  assertEquals(
    r.head.find((x) => x["metric"] === "cost_usd")!["ids_unverified"],
    "false",
  );
  assertStringIncludes(r.md, "camp-7");
  assertStringIncludes(r.md, "ids_unverified");
});

Deno.test("judge execution ids: null (Q-01 run 002 writes `?? null`) -> ids_unverified, no throw", async () => {
  const r = await idsRun((items) => {
    for (const it of items) {
      it["baseline_id"] = null;
      it["variant_id"] = null;
    }
  });
  assertEquals(r.err, null);
  assertEquals(
    r.head.find((x) => x["metric"] === "judge_conventions")!["ids_unverified"],
    "true",
  );
});

Deno.test("judge execution ids: matching ids verify", async () => {
  const r = await idsRun((i, k) => withIds(i, k));
  assertEquals(r.err, null);
  assertEquals(
    r.head.find((x) => x["metric"] === "judge_conventions")!["ids_unverified"],
    "false",
  );
});

Deno.test("judge execution ids: mismatches throw", async () => {
  const e1 = await idsRun((i, k) =>
    withIds(i, k, { item: "b-other-1", key: "b-other-1" })
  );
  assert(e1.err && /baseline_id/.test(e1.err.message), String(e1.err));
  const e2 = await idsRun((i, k) => withIds(i, k, { key: "b-other-1" }));
  assert(e2.err && /baseline_id/.test(e2.err.message), String(e2.err));
});

// ------------------------------------------------------------- run 002

Deno.test("sign-based task score: pair d [+1,+1,-100] is a win, not a loss", () => {
  const tm = taskMeans(
    [1, 1, -100].map((d, i) => ({ task: "T", repeat: i + 1, d })),
  );
  assertEquals(tm.length, 1);
  assertAlmostEquals(tm[0]!.score, 1 / 3, 1e-12);
  assertAlmostEquals(tm[0]!.rawMean, -98 / 3, 1e-9);
  assertEquals(aggregate([tm[0]!.score]).k, 1);
});

const pairsN = (n: number, variant = "v") =>
  Array.from({ length: n }, (_, i) => ({
    base: "b",
    variant,
    task: `T${i}`,
    repeat: 1,
  }));

Deno.test("cohortStats: expected/observed/na/missing by side and reason", () => {
  const pairs = pairsN(6);
  const table = Object.assign(
    new Map<string, Record<string, number>>([
      ["b|T0|1", { x: 1 }],
      ["v|T0|1", { x: 2 }], // observed
      ["b|T1|1", { x: 1 }], // variant: no row
      ["b|T2|1", { x: 1 }],
      ["v|T2|1", {}], // variant: empty
      ["b|T3|1", {}],
      ["v|T3|1", { x: 1 }], // base: empty
    ]),
    {
      excluded: new Set(["b|T4|1"]), // base excluded, variant no row
      na: new Map([["v|T5|1", new Set(["x"])]]),
    },
  );
  const c = cohortStats(collectPairs(pairs, table, "x", "higher"));
  assertEquals(c.expectedPairs, 5);
  assertEquals(c.naPairs, 1);
  assertEquals(c.observedPairs, 1);
  assertEquals([c.expectedTasks, c.observedTasks], [5, 1]);
  assertEquals(c.missing["variant_no_row"], 2);
  assertEquals(c.missing["variant_empty"], 1);
  assertEquals(c.missing["base_empty"], 1);
  assertEquals(c.missing["base_excluded"], 1);
  assertEquals(c.missing["base_no_row"], 0);
});

Deno.test("wording: 3 winning tasks of 22 expected is never consistent", () => {
  const a = aggregate([1, 1, 1]);
  const s = wording(a, "all", { observedTasks: 3, expectedTasks: 22 });
  assert(!s.includes("consistent"), s);
  assertStringIncludes(s, "incomplete cohort (3 of 22 tasks observed)");
  assertStringIncludes(
    wording(a, "all", { observedTasks: 3, expectedTasks: 3 }),
    "consistent in stratum all",
  );
});

async function mini(
  root: string,
  o: {
    variants?: string[];
    tasks: string[];
    alsem?: string[];
    alsemHeader?: string;
    pairsHeader?: string;
  },
) {
  const camp = join(root, "camp");
  await Deno.mkdir(join(camp, "alsem"), { recursive: true });
  const variants = o.variants ?? ["v"];
  const prs = [
    o.pairsHeader ??
      "base,variant,task,kind,repeat,base_id,variant_id,outcome",
  ];
  const ex = ["id,arm,task,repeat,cost_usd,wall_min"];
  for (const t of o.tasks) {
    ex.push(`b-${t},b,${t},1,2,10`);
    for (const v of variants) {
      prs.push(`b,${v},${t},fix,1,b-${t},${v}-${t},both_pass`);
      ex.push(`${v}-${t},${v},${t},1,1,8`);
    }
  }
  await Deno.writeTextFile(join(camp, "pairs.csv"), prs.join("\n") + "\n");
  await Deno.writeTextFile(join(camp, "executions.csv"), ex.join("\n") + "\n");
  if (o.alsem) {
    await Deno.writeTextFile(
      join(camp, "alsem", "executions.csv"),
      [
        o.alsemHeader ??
          "id,arm,task,repeat,verdict,excluded,curated_weighted_fp,test_coverage_ratio,test_areequal_literal_share",
        ...o.alsem,
      ].join("\n") + "\n",
    );
  }
  return camp;
}

const headlineOf = async (out: string) =>
  parseCsv(await Deno.readTextFile(join(out, "headline.csv")));

Deno.test("end to end: missing only on the variant side, per reason", async () => {
  await withTempDir(async (root) => {
    const camp = await mini(root, {
      tasks: ["T1", "T2", "T3"],
      alsem: [
        "1,b,T1,1,pass,,5,0.4,0.1",
        "2,v,T1,1,pass,,2,0.8,0.3",
        "1,b,T2,1,pass,,5,0.4,0.1",
        "2,v,T2,1,pass,infra,2,0.8,0.3",
        "1,b,T3,1,pass,,5,0.4,0.1",
      ],
    });
    const out = join(root, "out");
    await runReport({ campaign: camp, out, boot: 50 });
    const r = (await headlineOf(out)).find((x) =>
      x["metric"] === "curated_weighted_fp"
    )!;
    assertEquals(
      [
        r["expected_pairs"],
        r["observed_pairs"],
        r["expected_tasks"],
        r["observed_tasks"],
      ],
      ["3", "1", "3", "1"],
    );
    assertEquals(r["missing_variant_excluded"], "1");
    assertEquals(r["missing_variant_no_row"], "1");
    assertEquals(r["missing_base_no_row"], "0");
    assert(!r["wording"]!.includes("consistent"), r["wording"]);
    assertStringIncludes(
      r["wording"]!,
      "incomplete cohort (1 of 3 tasks observed)",
    );
  });
});

Deno.test("end to end: two comparisons keep their own missingness", async () => {
  await withTempDir(async (root) => {
    const camp = await mini(root, {
      variants: ["v", "w"],
      tasks: ["T1", "T2"],
      alsem: [
        "1,b,T1,1,pass,,5,,",
        "1,b,T2,1,pass,,5,,",
        "2,v,T1,1,pass,,2,,",
        "2,v,T2,1,pass,,2,,",
        "3,w,T1,1,pass,,2,,",
      ],
    });
    const out = join(root, "out");
    await runReport({ campaign: camp, out, boot: 50 });
    const h = await headlineOf(out);
    const row = (v: string) =>
      h.find((x) =>
        x["variant"] === v && x["metric"] === "curated_weighted_fp"
      )!;
    assertEquals([row("v")["observed_pairs"], row("v")["expected_pairs"]], [
      "2",
      "2",
    ]);
    assertEquals([row("w")["observed_pairs"], row("w")["expected_pairs"]], [
      "1",
      "2",
    ]);
    assertEquals(row("w")["missing_variant_no_row"], "1");
    assertEquals(row("v")["missing_variant_no_row"], "0");
  });
});

Deno.test("end to end: a metric missing while a sibling of the axis is present", async () => {
  await withTempDir(async (root) => {
    const camp = await mini(root, {
      tasks: ["T1", "T2"],
      alsem: [
        "1,b,T1,1,pass,,5,,",
        "2,v,T1,1,pass,,2,,",
        "1,b,T2,1,pass,,5,,",
        "2,v,T2,1,pass,,2,,",
      ],
    });
    const out = join(root, "out");
    await runReport({ campaign: camp, out, boot: 50 });
    const h = await headlineOf(out);
    assertEquals(
      h.find((x) => x["metric"] === "curated_weighted_fp")!["status"],
      "ok",
    );
    const gone = h.find((x) => x["metric"] === "test_coverage_ratio")!;
    assertEquals(gone["status"], "unavailable");
    assertEquals(gone["observed_pairs"], "0");
    assertEquals(gone["missing_base_empty"], "2");
    assertEquals(gone["missing_variant_empty"], "2");
    assertEquals(gone["k"], "");
  });
});

Deno.test("end to end: test_areequal_literal_share is descriptive, no direction", async () => {
  await withTempDir(async (root) => {
    const camp = await mini(root, {
      tasks: ["T1", "T2"],
      alsem: [
        "1,b,T1,1,pass,,5,0.4,0.2",
        "2,v,T1,1,pass,,2,0.8,0.5",
        "1,b,T2,1,pass,,5,0.4,0.2",
        "2,v,T2,1,pass,,2,0.8,0.6",
      ],
    });
    const out = join(root, "out");
    await runReport({ campaign: camp, out, boot: 50 });
    const r = (await headlineOf(out)).find((x) =>
      x["metric"] === "test_areequal_literal_share"
    )!;
    assertEquals(r["group"], "descriptive");
    assertAlmostEquals(Number(r["mean_raw"]), 0.35, 1e-9);
    assertAlmostEquals(Number(r["median_raw"]), 0.35, 1e-9);
    for (
      const c of [
        "k",
        "m",
        "t",
        "sign_p",
        "wilcoxon_p",
        "ci_lo",
        "mean",
        "median",
      ]
    ) {
      assertEquals(r[c], "", c);
    }
    assert(!/better|worse/i.test(r["wording"]!), r["wording"]);
    const md = await Deno.readTextFile(join(out, "report.md"));
    const sec = md.split("### Descriptive")[1]!.split("###")[0]!;
    assertStringIncludes(sec, "test_areequal_literal_share");
    assert(!/better|worse/i.test(sec), sec);
    const t = parseCsv(await Deno.readTextFile(join(out, "tasks.csv")))
      .filter((x) => x["metric"] === "test_areequal_literal_share");
    assertEquals(t[0]!["task_sign"], "");
    assertEquals(t[0]!["task_score"], "");
  });
});

Deno.test("fail closed: identity, repeats, duplicates, CSV structure", async () => {
  assertThrows(() => testRerunTable([{}] as never), Error, "arm");
  assertThrows(
    () => testRerunTable([{ arm: "a", task: "T", repeat: 1.5 }]),
    Error,
    "repeat",
  );
  assertThrows(
    () =>
      testRerunTable([
        { arm: "a", task: "T", repeat: 1 },
        { arm: "a", task: "T", repeat: 1, excluded: "x" },
      ]),
    Error,
    "duplicate",
  );
  const H = "id,arm,task,repeat,verdict,excluded,curated_weighted_fp";
  assertThrows(() => alsemTable(`${H}\n1,a,T,x,pass,,3\n`), Error, "repeat");
  assertThrows(
    () => alsemTable(`${H}\n1,a,T,1,pass,,3\n2,a,T,1,pass,,4\n`),
    Error,
    "duplicate",
  );
  assertThrows(() => alsemTable(`${H}\n1,a,T,1,pass\n`), Error, "columns");
  assertThrows(() => alsemTable("id,task,repeat\n1,T,1\n"), Error, "arm");
  assertThrows(() => alsemTable(""), Error, "arm");
  await withTempDir(async (root) => {
    const run = (camp: string) =>
      runReport({ campaign: camp, out: join(root, "o"), boot: 50 }).then(
        () => null,
        (e) => e as Error,
      );
    const reset = () => Deno.remove(join(root, "camp"), { recursive: true });
    const PH = "base,variant,task,kind,repeat,base_id,variant_id,outcome\n";
    let camp = await mini(root, {
      tasks: ["T1"],
      alsem: ["1,verdictless,5"],
      alsemHeader: "id,verdict,curated_weighted_fp",
    });
    const e1 = await run(camp);
    assert(e1 && /arm/.test(e1.message), String(e1));
    await reset();
    camp = await mini(root, {
      tasks: ["T1"],
      pairsHeader: "base,variant,task,kind,repeat,variant_id,outcome",
    });
    const e2 = await run(camp);
    assert(e2 && /base_id/.test(e2.message), String(e2));
    await reset();
    camp = await mini(root, { tasks: ["T1"] });
    await Deno.writeTextFile(
      join(camp, "pairs.csv"),
      PH + "b,v,T1,fix,1,b-T1,v-T1,x\nb,v,T1,fix,1,b-T1,v-T1,x\n",
    );
    const e3 = await run(camp);
    assert(e3 && /duplicate/i.test(e3.message), String(e3));
    await Deno.writeTextFile(
      join(camp, "pairs.csv"),
      PH + "b,v,T1,fix,1.5,b-T1,v-T1,x\n",
    );
    const e4 = await run(camp);
    assert(e4 && /repeat/.test(e4.message), String(e4));
    await Deno.writeTextFile(
      join(camp, "pairs.csv"),
      PH + "b,v,T1,fix,1,b-T1,v-T1,x\n",
    );
    await Deno.writeTextFile(
      join(camp, "executions.csv"),
      "id,arm,task,repeat,cost_usd\nx,b,T1,1,2\nx2,b,T1,1,3\n",
    );
    const e5 = await run(camp);
    assert(e5 && /duplicate/i.test(e5.message), String(e5));
    await Deno.writeTextFile(
      join(camp, "executions.csv"),
      "id,arm,task,repeat,cost_usd\nx,b,T1,1\n",
    );
    const e6 = await run(camp);
    assert(e6 && /columns/.test(e6.message), String(e6));
  });
});
