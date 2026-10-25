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
  alsemTable,
  bootstrapCi,
  extraTable,
  judgeMetrics,
  loto,
  pairDiffs,
  parseCsv,
  runReport,
  signTest,
  taskMeans,
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
  assertEquals(aggregate(tm.map((x) => x.mean)).t, 1);
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
  await Deno.mkdir(judge);
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
      "base,variant,stratum,metric,group,n_tasks,k,m,t,median,mean,ci_lo,ci_hi,sign_p,wilcoxon_w_plus,wilcoxon_n,wilcoxon_p,loto_min,loto_max,loto_flips,low_agreement,kappa_na,wording",
    );
    const tText = await Deno.readTextFile(join(out, "tasks.csv"));
    assertEquals(
      tText.split("\n")[0],
      "base,variant,metric,task,stratum,n_pairs,task_mean,task_sign",
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
