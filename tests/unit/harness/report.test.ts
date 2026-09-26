import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { stripAnsiCode } from "@std/fmt/colors";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import { ExperimentSchema } from "../../../src/harness/config.ts";
import type { CampaignRecords } from "../../../src/harness/integrity.ts";
import { manifestHash } from "../../../src/harness/manifest.ts";
import {
  type CampaignRecord,
  experimentHash,
  planBlocks,
  scorerFingerprint,
} from "../../../src/harness/records.ts";
import {
  buildReport,
  partialText,
  renderReport,
} from "../../../src/harness/report.ts";
import { loadTraces } from "../../../src/harness/trace-metrics.ts";
import { type TraceEvent, writeTrace } from "../../../src/harness/trace.ts";
import {
  campaign,
  execution,
  H,
  judgment,
  manifest,
  SCORERS_V1_FP,
  telemetry,
} from "./fixtures.ts";

/**
 * plain passes HX-001 only at $2 per cell; skills passes both at $1 per cell
 * and is infra-exposed on HX-002.
 */
/** Undefined share of the seed 3, 400-resample primary comparison. */
const UNDEFINED_SEED3 = 101 / 400;

async function records(): Promise<CampaignRecords> {
  const c = await campaign();
  const rows: Array<[string, string, boolean, number]> = [
    ["plain", "HX-001", true, 2],
    ["plain", "HX-002", false, 2],
    ["skills", "HX-001", true, 1],
    ["skills", "HX-002", true, 1],
  ];
  const executions = [];
  const judgments = [];
  for (const [arm, task, pass, cost] of rows) {
    const e = execution(c, { arm, task }, {
      telemetry: telemetry(cost),
      validity: {
        incomplete_telemetry: arm === "plain" ? ["turns"] : [],
        incomplete_observed: [],
        infra_exposed: arm === "skills" && task === "HX-002",
      },
    });
    executions.push(e);
    judgments.push(judgment(c, e, pass));
  }
  return { campaign: c, executions, artifacts: [], judgments };
}

Deno.test("buildReport: header, coverage, primary and outcome numbers", async () => {
  const r = await buildReport(await records(), { resamples: 200, seed: 1 });
  assertEquals(r.experiment.primary_metric, "cost_per_solved_task");
  assertEquals(r.diffs, [{ variant: "skills", differing: ["skills"] }]);
  assertEquals(r.provisional, false);
  assertEquals(
    r.coverage.map((c) => [c.arm, c.infra_exposed, c.incomplete_telemetry]),
    [["plain", 0, { turns: 2 }], ["skills", 1, {}]],
  );
  // plain: (2 + 2) / (1 + 0) = 4; skills: (1 + 1) / 2 = 1
  assertEquals(r.arms.map((a) => a.cost_per_solved_task), [4, 1]);
  assertEquals(r.arms.map((a) => a.total_spend_usd), [4, 2]);
  const [primary, secondary] = r.comparisons;
  assertEquals(
    [primary!.metric, primary!.primary, primary!.delta, primary!.pairs],
    ["cost_per_solved_task", true, -3, 2],
  );
  assertEquals([secondary!.metric, secondary!.primary], ["pass_rate", false]);
  assertEquals(r.flips, [{
    task: "HX-002",
    kind: "bugfix",
    coupling: ["events"],
    pass_rate: { plain: 0, skills: 1 },
  }]);
  assertEquals(r.judging.source, "campaign");
  assertEquals(r.judging.identity, r.campaign.task_set_identity);
  assert(
    r.cells.every((c) => c.judgment_id !== null && c.used_execution !== null),
  );
});

Deno.test("buildReport: pending cells make it provisional and are reported as exclusions", async () => {
  const base = await records();
  const pendingId = base.executions[1]!.id; // plain HX-002
  const r = await buildReport(
    {
      ...base,
      judgments: base.judgments.filter((j) => j.execution_id !== pendingId),
    },
    { resamples: 50 },
  );
  assertEquals(r.provisional, true);
  assertEquals(r.arms[0]!.pending_cells, 1);
  assertEquals(r.arms[0]!.pending_spend_usd, 2);
  assertEquals(r.comparisons[0]!.excluded.baseline, { pending: 1 });
  assertEquals(r.comparisons[0]!.pairs, 1);
});

Deno.test("buildReport: inconsistent records are refused before any number is computed", async () => {
  const base = await records();
  await assertRejects(
    () =>
      buildReport({
        ...base,
        executions: [
          { ...base.executions[0]!, task_visible_hash: H("9") },
          ...base.executions.slice(1),
        ],
      }),
    ValidationError,
    "visible-input hash",
  );
});

Deno.test("buildReport: JSON round-trips", async () => {
  const r = await buildReport(await records(), { resamples: 50 });
  assertEquals(JSON.parse(JSON.stringify(r)), r);
});

Deno.test("renderReport: hypothesis first, never says equal, exploratory and exclusions shown", async () => {
  const text = stripAnsiCode(
    renderReport(await buildReport(await records(), { resamples: 200 })),
  );
  assert(text.indexOf("Hypothesis:") < text.indexOf("Primary\n"));
  assertStringIncludes(text, "Diff plain -> skills: skills");
  assertStringIncludes(text, "[exploratory]");
  assertStringIncludes(text, "infra exposed 1");
  assertStringIncludes(text, "incomplete telemetry: turns 2");
  assertStringIncludes(text, "Judged with campaign oracles");
  assertStringIncludes(text, "excluded: plain none; skills none");
  assert(!/\bequal\b/i.test(text), "report must never claim arms are equal");
});

Deno.test("renderReport: sparse solves suppress the CI and say why", async () => {
  const r = await buildReport(await records(), { resamples: 400, seed: 3 });
  const text = stripAnsiCode(
    renderReport(r),
  );
  // plain solves only HX-001, so resamples drawing HX-002 twice have no solve.
  assertStringIncludes(text, "CI suppressed");
  const primary = r.comparisons[0]!;
  assertEquals(primary.ci, null);
  assertEquals(primary.distinguishable, null);
  assertEquals(primary.undefined_share, UNDEFINED_SEED3);
  assertStringIncludes(
    text,
    "CI suppressed: 101 of 400 resamples had no solve",
  );
});

Deno.test("renderReport: a tiny undefined share is printed as counts, never 0.0%", async () => {
  // A share this small printed as a percentage reads "0.0%".
  const base = await records();
  const r = await buildReport(base, { resamples: 20000, seed: 3 });
  const c = {
    ...r.comparisons[0]!,
    ci: null,
    distinguishable: null,
    undefined_share: 1 / 20000,
  };
  const text = stripAnsiCode(renderReport({ ...r, comparisons: [c] }));
  assertStringIncludes(
    text,
    "CI suppressed: 1 of 20000 resamples had no solve",
  );
  assert(!text.includes("0.0% of resamples"));
});

Deno.test("renderReport: no solved task shows n/a", async () => {
  const c = await campaign();
  const e = execution(c);
  const text = stripAnsiCode(renderReport(
    await buildReport({
      campaign: c,
      executions: [e],
      artifacts: [],
      judgments: [judgment(c, e, false)],
    }, { resamples: 20 }),
  ));
  assertStringIncludes(text, "cost per solved task n/a");
  assertStringIncludes(text, "PROVISIONAL");
});

Deno.test("buildReport: mixed scorer versions in one comparison fail closed", async () => {
  const base = await records();
  const v2 = { build: "2" };
  const fp2 = await scorerFingerprint(v2);
  const [j0, ...rest] = base.judgments;
  await assertRejects(
    () =>
      buildReport({
        ...base,
        judgments: [
          { ...j0!, scorer_versions: v2, scorer_fingerprint: fp2 },
          ...rest,
        ],
      }),
    ValidationError,
    "mixes scorer versions",
  );
  const r = await buildReport(base, { resamples: 20 });
  assertEquals(r.comparisons[0]!.scorer_fingerprint, SCORERS_V1_FP);
});

Deno.test("buildReport: mixed valid scorer fingerprints are refused and named", async () => {
  const base = await records();
  const v2 = { build: "2", test: "7" };
  const fp2 = await scorerFingerprint(v2);
  const last = base.judgments.length - 1;
  const err = await assertRejects(
    () =>
      buildReport({
        ...base,
        judgments: base.judgments.map((j, i) =>
          i === last
            ? { ...j, scorer_versions: v2, scorer_fingerprint: fp2 }
            : j
        ),
      }),
    ValidationError,
  );
  assertStringIncludes(err.message, SCORERS_V1_FP);
  assertStringIncludes(err.message, fp2);
});

Deno.test("buildReport: a superseded judgment of another scorer is not selected", async () => {
  const base = await records();
  const v2 = { build: "2" };
  const older = judgment(base.campaign, base.executions[0]!, false, {
    scorer_versions: v2,
    scorer_fingerprint: await scorerFingerprint(v2),
    ended_at: "2026-10-01T10:13:00.000Z",
  });
  const r = await buildReport(
    { ...base, judgments: [older, ...base.judgments] },
    { resamples: 20 },
  );
  assertEquals(r.comparisons[0]!.scorer_fingerprint, SCORERS_V1_FP);
});

Deno.test("buildReport: JSON is identical whatever order the records arrive in", async () => {
  const base = await records();
  const e0 = base.executions[0]!;
  const e1 = base.executions[1]!;
  // A multi-attempt cell whose float sum depends on the summation order.
  const reruns = [2, 3].map((attempt) =>
    execution(base.campaign, { attempt, run_kind: "manual_rerun" }, {
      telemetry: telemetry(attempt / 10),
    })
  );
  const shaped = {
    ...base,
    judgments: [
      ...base.judgments,
      ...reruns.map((e) => judgment(base.campaign, e, true)),
    ],
    executions: [
      ...reruns,
      {
        ...e0,
        telemetry: telemetry(0.1),
        validity: { ...e0.validity, incomplete_telemetry: ["turns"] },
      },
      {
        ...e1,
        validity: {
          ...e1.validity,
          incomplete_telemetry: ["wall_ms", "turns"],
        },
      },
      ...base.executions.slice(2),
    ],
  } as CampaignRecords;
  const a = await buildReport(shaped, { resamples: 50 });
  const b = await buildReport({
    ...shaped,
    executions: [...shaped.executions].reverse(),
    judgments: [...shaped.judgments].reverse(),
  }, { resamples: 50 });
  assertEquals(JSON.stringify(a), JSON.stringify(b));
  assertEquals(Object.keys(a.coverage[0]!.incomplete_telemetry), [
    "turns",
    "wall_ms",
  ]);
});

Deno.test("renderReport: states which execution a cell with manual reruns used", async () => {
  const c = await campaign();
  // HX-001: planned pass, manual rerun fails; the planned result stays.
  const p1 = execution(c, { task: "HX-001" });
  const m1 = execution(c, {
    task: "HX-001",
    attempt: 2,
    run_kind: "manual_rerun",
  });
  // HX-002: planned has no verdict yet; the scored manual rerun is used.
  const p2 = execution(c, { task: "HX-002" });
  const m2 = execution(c, {
    task: "HX-002",
    attempt: 2,
    run_kind: "manual_rerun",
  });
  const r = await buildReport({
    campaign: c,
    executions: [p1, m1, p2, m2],
    artifacts: [],
    judgments: [
      judgment(c, p1, true),
      judgment(c, m1, false),
      judgment(c, m2, true),
    ],
  }, { resamples: 20 });
  const text = stripAnsiCode(renderReport(r));
  assertStringIncludes(
    text,
    `HX-001 r1 plain: 1 manual rerun, used planned execution ${p1.id}`,
  );
  assertStringIncludes(
    text,
    `HX-002 r1 plain: 1 manual rerun, used manual_rerun execution ${m2.id}`,
  );
  assertStringIncludes(text, "no matched pairs");
});

Deno.test("renderReport: pending cells mark the headline provisional and show their spend", async () => {
  const base = await records();
  const pendingId = base.executions[1]!.id;
  const text = stripAnsiCode(renderReport(
    await buildReport({
      ...base,
      judgments: base.judgments.filter((j) => j.execution_id !== pendingId),
    }, { resamples: 20 }),
  ));
  assertStringIncludes(text, "PROVISIONAL");
  assertStringIncludes(text, "1 pending cells with $2.000 known spend");
});

/** The fixture campaign with a second variant, skills2. */
async function twoVariants(): Promise<CampaignRecord> {
  const c = await campaign();
  const experiment = ExperimentSchema.parse({
    ...c.experiment,
    variants: ["skills", "skills2"],
  });
  const m = manifest("skills2", {
    skills: { path: "bundles/s2", hash: H("6"), files: [] },
  });
  return {
    ...c,
    experiment,
    experiment_hash: await experimentHash(experiment),
    arms: [...c.arms, {
      config_id: "skills2",
      manifest_hash: await manifestHash(m),
      manifest: m,
    }],
    blocks: planBlocks(
      c.task_set.tasks.map((t) => t.id),
      1,
      ["plain", "skills", "skills2"],
      c.seed,
    ),
  };
}

Deno.test("buildReport: scorer fingerprints are checked across all arms, not per pair", async () => {
  const c = await twoVariants();
  const v2 = { build: "2" };
  const fp2 = await scorerFingerprint(v2);
  // The baseline has no selected judgment; each variant is on its own scorer.
  const executions = ["plain", "skills", "skills2"].map((arm) =>
    execution(c, { arm })
  );
  const records: CampaignRecords = {
    campaign: c,
    executions,
    artifacts: [],
    judgments: [
      judgment(c, executions[1]!, true),
      judgment(c, executions[2]!, true, {
        scorer_versions: v2,
        scorer_fingerprint: fp2,
      }),
    ],
  };
  const err = await assertRejects(
    () => buildReport(records, { resamples: 20 }),
    ValidationError,
    "mixes scorer versions",
  );
  assertStringIncludes(err.message, SCORERS_V1_FP);
  assertStringIncludes(err.message, fp2);
  // Same scorer everywhere is accepted.
  const ok = await buildReport({
    ...records,
    judgments: [
      judgment(c, executions[1]!, true),
      judgment(c, executions[2]!, true),
    ],
  }, { resamples: 20 });
  assertEquals(
    ok.comparisons.map((x) => x.scorer_fingerprint),
    [SCORERS_V1_FP, SCORERS_V1_FP, SCORERS_V1_FP, SCORERS_V1_FP],
  );
});

/** The fixture records with the experiment's primary metric replaced. */
async function withPrimary(
  metric: "cost_per_solved_task" | "pass_rate",
): Promise<CampaignRecords> {
  const base = await records();
  const experiment = ExperimentSchema.parse({
    ...base.campaign.experiment,
    primary_metric: metric,
  });
  return {
    ...base,
    campaign: {
      ...base.campaign,
      experiment,
      experiment_hash: await experimentHash(experiment),
    },
  };
}

const rowOf = (text: string, section: string, arm: string) =>
  text.split(`\n${section}\n`)[1]!.split("\n").find((l) =>
    l.startsWith(`  ${arm}: `)
  )!;

Deno.test("report: cost-primary labels pass rate and pass^k exploratory everywhere", async () => {
  const r = await buildReport(await withPrimary("cost_per_solved_task"), {
    resamples: 50,
  });
  assertEquals(r.metric_labels, {
    cost_per_solved_task: "primary",
    pass_rate: "exploratory",
    pass_k: "exploratory",
  });
  assertEquals(
    r.comparisons.map((c) => [c.metric, c.label]),
    [["cost_per_solved_task", "primary"], ["pass_rate", "exploratory"]],
  );
  const text = stripAnsiCode(renderReport(r));
  const primaryRow = rowOf(text, "Primary", "plain");
  assert(primaryRow.startsWith("  plain: cost per solved task $4.000,"));
  assertStringIncludes(primaryRow, "pass rate 50.0% [exploratory]");
  assert(!/cost per solved task \$4\.000 \[exploratory\]/.test(primaryRow));
  const outcomeRow = rowOf(text, "Outcome", "plain");
  assertStringIncludes(outcomeRow, "pass rate 50.0% [exploratory]");
  assertStringIncludes(outcomeRow, "pass^k 50.0% [exploratory]");
  assertStringIncludes(text, "Flips (per-task pass rate) [exploratory]");
});

Deno.test("report: pass-rate-primary leads with pass rate and labels cost and pass^k exploratory", async () => {
  const r = await buildReport(await withPrimary("pass_rate"), {
    resamples: 50,
  });
  assertEquals(r.metric_labels, {
    cost_per_solved_task: "exploratory",
    pass_rate: "primary",
    pass_k: "exploratory",
  });
  assertEquals(
    r.comparisons.map((c) => [c.metric, c.label, c.primary]),
    [
      ["pass_rate", "primary", true],
      ["cost_per_solved_task", "exploratory", false],
    ],
  );
  const text = stripAnsiCode(renderReport(r));
  const primaryRow = rowOf(text, "Primary", "plain");
  assert(primaryRow.startsWith("  plain: pass rate 50.0%,"));
  assertStringIncludes(
    primaryRow,
    "cost per solved task $4.000 [exploratory]",
  );
  assert(!primaryRow.includes("pass rate 50.0% [exploratory]"));
  const outcomeRow = rowOf(text, "Outcome", "plain");
  assert(!outcomeRow.includes("pass rate 50.0% [exploratory]"));
  assertStringIncludes(outcomeRow, "pass^k 50.0% [exploratory]");
  assert(!text.includes("Flips (per-task pass rate) [exploratory]"));
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.includes("skills vs plain, "));
  assertStringIncludes(lines[first]!, "skills vs plain, pass_rate: ");
  assert(!lines[first]!.includes("[exploratory]"));
  assertStringIncludes(
    lines.find((l) => l.includes("skills vs plain, cost_per_solved_task"))!,
    "[exploratory]",
  );
});

Deno.test("coverage lists executions with unverified components", async () => {
  const base = await records();
  const e = base.executions[0]!;
  const unverified = {
    ...e,
    validity: { ...e.validity, incomplete_observed: ["loaded_components"] },
  } as typeof e;
  const r = await buildReport(
    { ...base, executions: [unverified, ...base.executions.slice(1)] },
    { resamples: 50 },
  );
  assertEquals(
    r.coverage.map((c) => [c.arm, c.unverified_components]),
    [["plain", [e.id]], ["skills", []]],
  );
  const text = stripAnsiCode(renderReport(r));
  assertStringIncludes(text, `unverified components: ${e.id}`);
  assertEquals(text.split("unverified components:").length, 2);
});

/** The standard two-arm report with each execution passed through `map` first. */
async function reportWith(
  map: (
    e: CampaignRecords["executions"][number],
    i: number,
  ) => CampaignRecords["executions"][number],
) {
  const base = await records();
  return await buildReport(
    { ...base, executions: base.executions.map(map) },
    { resamples: 50 },
  );
}

Deno.test("buildReport: coverage counts executions priced under a cost assumption, per arm", async () => {
  const withAssumption = {
    assumptions: [{
      key: "pi_openrouter_cache_write_5m",
      tokens: 50,
      decision: "2026-09-25-pi-cache-ttl",
    }],
  };
  const r = await reportWith((e, i) =>
    i === 0
      ? { ...e, telemetry: { ...e.telemetry, raw_usage: withAssumption } }
      : e
  );
  const c = r.coverage.find((x) => x.arm === r.coverage[0]!.arm)!;
  assertEquals(c.cost_assumptions, { pi_openrouter_cache_write_5m: 1 });
  assertStringIncludes(
    renderReport(r),
    "cost assumptions: pi_openrouter_cache_write_5m 1",
  );
});

/** A v2 tool_call; `unclassified` marks a call no rule classified. */
const traceCall = (seq: number, unclassified = false): TraceEvent => ({
  v: 2,
  seq,
  t_ms: null,
  type: "tool_call",
  session: null,
  agent: "main",
  parent: null,
  call_id: `c${seq}`,
  request_id: null,
  tool: unclassified ? "Bash" : "Read",
  transport: unclassified ? "shell" : "builtin",
  skill: null,
  backend_request: null,
  outcome: "ok",
  error_class: null,
  result_bytes: 1,
  truncated: null,
  duration_ms: null,
  model: null,
  command: unclassified ? "python x.py" : null,
  command_cut: unclassified ? false : null,
  target: null,
  category: unclassified ? "unclassified" : "read",
  classifier: unclassified ? "none@1" : "builtin.Read@1",
});
const CAPS = {
  capabilities: {
    trace_types: [
      "tool_call",
      "model_request",
      "subagent_spawn",
      "skill_invoke",
    ],
  },
};

/**
 * plain: two complete traces (3 calls, one unclassified; 2 calls).
 * skills: complete (2 calls), partial (9 calls), invalid, no trace.
 * `invalidRepeat` 2 swaps the repeats of skills' invalid and no-trace rows.
 */
async function tracedRecords(invalidRepeat = 1) {
  const root = await Deno.realPath(await Deno.makeTempDir());
  const c = await campaign({ repeats: 2 });
  type Kind = "complete" | "partial" | "invalid" | "none";
  const rows: Array<[string, string, number, Kind, TraceEvent[]]> = [
    ["plain", "HX-001", 1, "complete", [
      traceCall(1),
      traceCall(2),
      traceCall(3, true),
    ]],
    ["plain", "HX-002", 1, "complete", [traceCall(1), traceCall(2)]],
    ["skills", "HX-001", 1, "complete", [traceCall(1), traceCall(2)]],
    [
      "skills",
      "HX-001",
      2,
      "partial",
      [...Array(9).keys()].map((i) => traceCall(i + 1)),
    ],
    ["skills", "HX-002", invalidRepeat, "invalid", []],
    ["skills", "HX-002", 3 - invalidRepeat, "none", []],
  ];
  const executions = [];
  const judgments = [];
  for (const [arm, task, repeat, kind, events] of rows) {
    const path = kind === "none"
      ? null
      : `runs/${arm}-${task}-${repeat}/trace.jsonl`;
    if (path !== null) {
      await Deno.mkdir(join(root, path, ".."), { recursive: true });
      if (kind === "invalid") {
        await Deno.writeTextFile(join(root, path), '{"v":7}\n');
      } else await writeTrace(join(root, path), events);
    }
    const e = execution(c, { arm, task, repeat }, {
      telemetry: {
        ...telemetry(1),
        raw_usage: { ...CAPS, trace_complete: kind === "complete" },
      },
      trace_path: path,
    });
    executions.push(e);
    judgments.push(judgment(c, e, true));
  }
  const records = { campaign: c, executions, artifacts: [], judgments };
  return { records, traces: await loadTraces(root, executions) };
}

Deno.test("report coverage: trace lines per arm; partial and invalid traces counted, not mixed", async () => {
  const { records, traces } = await tracedRecords();
  const r = await buildReport(records, { resamples: 50, traces });
  const by = Object.fromEntries(r.coverage.map((c) => [c.arm, c.trace]));
  assertEquals(by["plain"], {
    executions: 2,
    with_trace: 2,
    complete: 2,
    invalid: 0,
    tool_calls: 5,
    rule_classified: 4,
    unclassified: 1,
    unreplayable: 0,
    rules: "rules@1",
  });
  assertEquals(by["skills"], {
    executions: 4,
    with_trace: 2,
    complete: 1,
    invalid: 1,
    tool_calls: 2,
    rule_classified: 2,
    unclassified: 0,
    unreplayable: 0,
    rules: "rules@1",
  });
  const text = stripAnsiCode(renderReport(r));
  assertStringIncludes(
    text,
    "calls rule-classified 4/5, unclassified 1 (rules@1); traces complete 2/2",
  );
  assertStringIncludes(
    text,
    "traces complete 1/4, 1 invalid, 1 without a trace",
  );
  assertStringIncludes(text, "[WARN] invalid trace for");
});

Deno.test("report --repeats: an excluded repeat's invalid trace is disclosed with the excluded work, not warned", async () => {
  const { records, traces } = await tracedRecords(2);
  const invalidId = traces.invalid[0]!.execution;
  assertEquals(
    records.executions.find((e) => e.id === invalidId)!.repeat,
    2,
  );
  const cut = await buildReport(records, { resamples: 50, traces, repeats: 1 });
  assertEquals(cut.trace_invalid, []);
  assertEquals(
    cut.coverage.map((
      c,
    ) => [c.arm, c.excluded_trace_invalid, c.trace!.invalid]),
    [["plain", 0, 0], ["skills", 1, 0]],
  );
  const text = stripAnsiCode(renderReport(cut));
  assert(!text.includes("[WARN] invalid trace"), text);
  assertStringIncludes(
    text,
    "Repeats reported: 1 of 2; excluded 4 cells, $2.000 spend, 1 invalid trace",
  );

  // Without --repeats nothing is excluded: the same trace is a warning.
  const all = await buildReport(records, { resamples: 50, traces });
  assertEquals(all.trace_invalid, traces.invalid);
  assertEquals(all.coverage.map((c) => c.excluded_trace_invalid), [0, 0]);
  assertStringIncludes(
    stripAnsiCode(renderReport(all)),
    `[WARN] invalid trace for ${invalidId}`,
  );
});

Deno.test("report: an invalid trace never breaks the primary metric", async () => {
  const { records, traces } = await tracedRecords();
  const without = await buildReport(records, { resamples: 50, seed: 1 });
  const withTraces = await buildReport(records, {
    resamples: 50,
    seed: 1,
    traces,
  });
  assertEquals(withTraces.arms, without.arms);
  assertEquals(withTraces.comparisons, without.comparisons);
});

Deno.test("report coverage: no traces option gives trace null", async () => {
  const r = await buildReport(await records(), { resamples: 50 });
  assertEquals(r.coverage.map((c) => c.trace), [null, null]);
});

Deno.test("report: per_model in incomplete_telemetry never invalidates the primary metric", async () => {
  const base = await records();
  const flagged = {
    ...base,
    executions: base.executions.map((e) => ({
      ...e,
      validity: {
        ...e.validity,
        incomplete_telemetry: [
          ...e.validity.incomplete_telemetry,
          "per_model" as const,
        ],
      },
    })),
  };
  const a = await buildReport(base, { resamples: 50, seed: 1 });
  const b = await buildReport(flagged, { resamples: 50, seed: 1 });
  assertEquals(b.arms, a.arms);
  assertEquals(b.comparisons, a.comparisons);
  assertEquals(b.coverage.map((c) => c.incomplete_telemetry["per_model"]), [
    2,
    2,
  ]);
});

/**
 * M5-05: six tasks, three planned repeats. plain has repeats 1 to 3 scored
 * (its repeat-3 attempts cost $2 in all) and fails HX-002 in repeat 3;
 * skills has repeats 1 and 2 scored, repeat 3 unrun.
 */
async function cutRecords(): Promise<CampaignRecords> {
  const c = await campaign({ repeats: 3, tasks: 6 });
  const executions = [];
  const judgments = [];
  const plan = [["plain", [1, 2, 3]], ["skills", [1, 2]]] as const;
  for (const t of c.task_set.tasks) {
    for (const [arm, repeats] of plan) {
      for (const repeat of repeats) {
        const cost = repeat < 3 ? 1 : t.id === "HX-001" ? 2 : 0;
        const e = execution(c, { arm, task: t.id, repeat }, {
          telemetry: telemetry(cost),
        });
        executions.push(e);
        judgments.push(
          judgment(c, e, !(repeat === 3 && t.id === "HX-002")),
        );
      }
    }
  }
  return { campaign: c, executions, artifacts: [], judgments };
}

Deno.test("buildReport --repeats: metrics over repeats 1..N, excluded work disclosed per arm", async () => {
  const r = await buildReport(await cutRecords(), {
    resamples: 50,
    repeats: 2,
  });
  assertEquals(r.provisional, false);
  assertEquals(r.repeats, { planned: 3, reported: 2 });
  assertEquals(
    r.coverage.map((c) => [
      c.arm,
      c.executions,
      c.excluded_cells,
      c.excluded_known_spend_usd,
      c.campaign_raw_spend_usd,
    ]),
    [["plain", 12, 6, 2, 14], ["skills", 12, 6, 0, 12]],
  );
  for (const a of r.arms) {
    const c = r.coverage.find((x) => x.arm === a.arm)!;
    assertEquals(
      c.campaign_raw_spend_usd,
      a.total_spend_usd + c.excluded_known_spend_usd,
    );
  }
  assertEquals(r.arms.map((a) => [a.planned_cells, a.unrun_cells]), [
    [12, 0],
    [12, 0],
  ]);
  // pass^k over k = 2: plain's repeat-3 failure does not count.
  assertEquals(r.arms.map((a) => [a.pass_k, a.pass_k_tasks]), [[1, 6], [
    1,
    6,
  ]]);
  assert(r.cells.every((c) => c.repeat <= 2));
  assertEquals(r.cells.length, 24);
  assertEquals(r.comparisons[0]!.pairs, 12);
  assertEquals(r.both_pass[0]!.pairs, 12);
  assertEquals(r.flips, []);
  assertEquals(r.efficiency.map((e) => e.arm), ["plain", "skills"]);
  const text = stripAnsiCode(renderReport(r));
  assertStringIncludes(
    text,
    "Repeats reported: 2 of 3; excluded 12 cells, $2.000 spend",
  );
  assert(!text.includes("PROVISIONAL"));
});

Deno.test("buildReport without --repeats: every planned repeat, provisional while one is unrun", async () => {
  const r = await buildReport(await cutRecords(), { resamples: 50 });
  assertEquals(r.provisional, true);
  assertEquals(r.repeats, { planned: 3, reported: 3 });
  assertEquals(
    r.coverage.map((c) => [
      c.executions,
      c.excluded_cells,
      c.excluded_known_spend_usd,
      c.campaign_raw_spend_usd,
    ]),
    [[18, 0, 0, 14], [12, 0, 0, 12]],
  );
  // plain fails HX-002 in repeat 3: 5 of 6 tasks pass all three.
  assertEquals(r.arms[0]!.pass_k, 5 / 6);
  assert(!stripAnsiCode(renderReport(r)).includes("Repeats reported"));
});

Deno.test("buildReport --repeats: 0, above the plan or fractional is refused", async () => {
  const base = await cutRecords();
  for (const repeats of [0, 4, 1.5]) {
    await assertRejects(
      () => buildReport(base, { resamples: 50, repeats }),
      ValidationError,
      "repeats",
    );
  }
});

Deno.test("buildReport partial marker (M6-02a F3): null when complete; provisional, repeat_cut or both, in JSON and text", async () => {
  const full = await buildReport(await records(), { resamples: 50 });
  assertEquals(full.partial, null);
  assertStringIncludes(
    stripAnsiCode(renderReport(full)),
    "Partial: no (repeats 1 of 1 reported, no cell pending or unrun)",
  );
  const unrun = await buildReport(await cutRecords(), { resamples: 50 });
  assertEquals(unrun.partial, { reasons: ["provisional"] });
  const cut = await buildReport(await cutRecords(), {
    resamples: 50,
    repeats: 2,
  });
  assertEquals(cut.partial, { reasons: ["repeat_cut"] });
  assertStringIncludes(
    stripAnsiCode(renderReport(unrun)),
    "PARTIAL (provisional: cells pending or unrun)",
  );
  assertStringIncludes(
    stripAnsiCode(renderReport(cut)),
    "PARTIAL (repeat cut: 2 of 3 repeats reported)",
  );
  // Both reasons at once, in a fixed order.
  const c = await cutRecords();
  const kept = c.executions.filter((e) => e.repeat !== 1 || e.arm !== "skills");
  const ids = new Set(kept.map((e) => e.id));
  const both = await buildReport({
    ...c,
    executions: kept,
    judgments: c.judgments.filter((j) => ids.has(j.execution_id)),
  }, { resamples: 50, repeats: 2 });
  assertEquals(both.partial, { reasons: ["provisional", "repeat_cut"] });
  assertEquals(
    partialText(both),
    "PARTIAL (provisional: cells pending or unrun; repeat cut: 2 of 3 repeats reported)",
  );
});
