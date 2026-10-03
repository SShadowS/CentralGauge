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
  type HarnessReport,
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

Deno.test("renderReport (C-03 run 003): a repeat cut says forced rejudges above it are not listed", async () => {
  const r: HarnessReport = JSON.parse(
    await Deno.readTextFile("tests/fixtures/harness/report-mock-contract.json"),
  );
  const cut = stripAnsiCode(
    renderReport({ ...r, repeats: { planned: 3, reported: 2 } }),
  );
  assertStringIncludes(
    cut,
    "Forced rejudges in repeats above 2, if any, are not listed.",
  );
  assert(
    !stripAnsiCode(renderReport(r)).includes("Forced rejudges in repeats"),
  );
});

// --- M6-02d: exploratory interval over the defined resamples only ---

Deno.test("renderReport (M6-02d): a suppressed CI keeps its line; the exploratory interval is a separate labelled line", async () => {
  const r = await buildReport(await records(), { resamples: 400, seed: 3 });
  const primary = r.comparisons[0]!;
  assertEquals([primary.ci, primary.distinguishable], [null, null]);
  const e = primary.exploratory_ci_defined_only!;
  assertEquals([e.resamples_used, e.undefined_share, e.level], [
    299,
    UNDEFINED_SEED3,
    0.95,
  ]);
  assert(e.lo <= e.hi);
  const lines = stripAnsiCode(renderReport(r)).split("\n");
  const at = lines.findIndex((l) =>
    l.includes("CI suppressed: 101 of 400 resamples had no solve")
  );
  assert(at >= 0);
  assert(!lines[at]!.includes("exploratory"), lines[at]);
  const next = lines[at + 1]!;
  assertStringIncludes(
    next,
    "exploratory (not pre-registered): conditional 95% percentile interval over the 74.8% of resamples with a solve in both arms (299 of 400), not a confidence interval: [",
  );
  assert(!next.includes("distinguishable"), next);
  assertEquals(
    lines.filter((l) => l.includes("exploratory (not pre-registered)")).length,
    1,
  );
});

Deno.test("renderReport (M6-02d): no exploratory line when the pre-registered CI is shown or the report predates it", async () => {
  const r = await buildReport(await records(), { resamples: 400, seed: 3 });
  const shown = r.comparisons.filter((c) => c.ci !== null);
  assert(shown.length > 0);
  for (const c of shown) {
    assertEquals(c.exploratory_ci_defined_only, {
      lo: c.ci![0],
      hi: c.ci![1],
      level: c.level,
      resamples_used: c.resamples,
      undefined_share: 0,
    });
  }
  const text = stripAnsiCode(renderReport({ ...r, comparisons: shown }));
  assert(!text.includes("exploratory (not pre-registered)"));
  const old: HarnessReport = JSON.parse(
    await Deno.readTextFile("tests/fixtures/harness/report-mock-contract.json"),
  );
  assert(!("exploratory_ci_defined_only" in old.comparisons[0]!));
  assert(
    !stripAnsiCode(renderReport(old)).includes(
      "exploratory (not pre-registered)",
    ),
  );
});

// --- M6-02d review: too few defined resamples ---

Deno.test("renderReport (M6-02d review): too few defined resamples omit the exploratory interval and say why", async () => {
  const r = await buildReport(await records(), { resamples: 30, seed: 3 });
  const primary = r.comparisons[0]!;
  assertEquals([primary.ci, primary.exploratory_ci_defined_only], [null, null]);
  const used = 30 - Math.round(primary.undefined_share * 30);
  assert(used > 0 && used < 40);
  const text = stripAnsiCode(renderReport(r));
  assertStringIncludes(
    text,
    `exploratory interval omitted: only ${used} of 30 resamples defined (< 40)`,
  );
  assert(!text.includes("exploratory (not pre-registered)"));
});

// --- M6-02e: the label warns about conditioning bias ---

Deno.test("renderReport (M6-02e): the exploratory line carries the conditioning-bias warning", async () => {
  const r = await buildReport(await records(), { resamples: 400, seed: 3 });
  const line = stripAnsiCode(renderReport(r)).split("\n").find((l) =>
    l.includes("exploratory (not pre-registered)")
  )!;
  assert(
    line.endsWith(
      "; conditioning on solves can bias this interval, including its direction; it is not evidence of a difference",
    ),
    line,
  );
});

// --- M11-11: confirmatory contrasts, held-out exclusion, measure binding ---

import { taskSetHash } from "../../../src/harness/identity.ts";
import type { MeasureRecord } from "../../../src/harness/measures.ts";
import {
  type Prereg,
  PreregSchema,
  protocolSha,
} from "../../../src/harness/prereg.ts";
import type { ReportLogs } from "../../../src/harness/report.ts";

const F_ARMS = ["cc-p", "cc-l", "cc-r", "cc-rl"];
const F_CONTRASTS = [
  {
    id: "C1",
    name: "LSP without the realistic setup",
    baseline: "cc-p",
    variant: "cc-l",
  },
  {
    id: "C2",
    name: "LSP with the realistic setup",
    baseline: "cc-r",
    variant: "cc-rl",
  },
  {
    id: "C3",
    name: "realistic setup without LSP",
    baseline: "cc-p",
    variant: "cc-r",
  },
];
const F_INTERACTION = {
  name: "interaction",
  status: "exploratory" as const,
  plain: "cc-p",
  lsp: "cc-l",
  realistic: "cc-r",
  realistic_lsp: "cc-rl",
};
const F_TASKS = Array.from({ length: 8 }, (_, i) => `HX-00${i + 1}`);
const F_HELD = ["HX-007", "HX-008"];
const F_REL = "preregistration/cc-v2-factorial.yml";
const F_COST: Record<string, number> = {
  "cc-p": 2,
  "cc-l": 1,
  "cc-r": 2,
  "cc-rl": 1,
};

/**
 * Four arms (P, L, R, RL) over 8 tasks x 2 repeats, every cell passing. L is
 * cheaper than P and RL than R; R costs the same as P. The two held-out
 * tasks cost `heldOutLCost` per cell in L, so counting them would move C1.
 */
async function factorialRecords(
  heldOutLCost = 100,
  primary: "cost_per_solved_task" | "pass_rate" = "cost_per_solved_task",
  // M11-09b: bootstrap-t is undefined at zero variance (SE = 0); `varied`
  // gives the LSP arms a task-dependent cost so the studentized test can run.
  varied = false,
): Promise<CampaignRecords> {
  const experiment = ExperimentSchema.parse({
    id: "cc-v2-factorial",
    hypothesis: "LSP and the realistic setup cut cost per solved task.",
    primary_metric: primary,
    baseline: "cc-p",
    variants: ["cc-l", "cc-r", "cc-rl"],
    vary: ["skills"],
    tasks: "harness-tasks/tasks/*",
    repeats: 2,
    contrasts: F_CONTRASTS,
    interaction: F_INTERACTION,
    preregistration: F_REL,
  });
  const tasks = F_TASKS.map((id, i) => ({
    id,
    refapp_commit: "c".repeat(40),
    visible: (i + 1).toString(16).padStart(64, "0"),
    oracle: (i + 1).toString(16).padStart(64, "f"),
  }));
  const arms = await Promise.all(F_ARMS.map(async (id, i) => {
    const m = manifest(
      id,
      i === 0
        ? {}
        : { skills: { path: "bundles/s", hash: H(String(i + 4)), files: [] } },
    );
    return { config_id: id, manifest_hash: await manifestHash(m), manifest: m };
  }));
  const base = await campaign();
  const c: CampaignRecord = {
    ...base,
    experiment,
    experiment_hash: await experimentHash(experiment),
    task_set: { identity: await taskSetHash(tasks), provisional: false, tasks },
    tasks_meta: tasks.map((t) => ({
      id: t.id,
      kind: "bugfix" as const,
      coupling: ["events"],
      limits: {},
    })),
    arms,
    blocks: planBlocks(F_TASKS, 2, F_ARMS, base.seed),
    preregistration: {
      path: F_REL,
      sha256: H("9"),
      protocol_sha256: H("8"),
      decision_sha256: H("7"),
      stage_b_decision_sha256: H("6"),
    },
  };
  const executions = [];
  const judgments = [];
  for (const arm of F_ARMS) {
    for (const task of F_TASKS) {
      for (const repeat of [1, 2]) {
        const cost = arm === "cc-l" && F_HELD.includes(task)
          ? heldOutLCost
          : F_COST[arm]! *
            (varied && (arm === "cc-l" || arm === "cc-rl")
              ? 1 + 0.05 * F_TASKS.indexOf(task)
              : 1);
        const e = execution(c, { arm, task, repeat }, {
          telemetry: telemetry(cost),
        });
        executions.push(e);
        judgments.push(judgment(c, e, true));
      }
    }
  }
  return { campaign: c, executions, artifacts: [], judgments };
}

const STAGE_A_F = {
  v: 1,
  experiment: "cc-v2-factorial",
  protocol: {
    arms: F_ARMS,
    contrasts: F_CONTRASTS,
    interaction: F_INTERACTION,
  },
  approval: "OWNER-APPROVED: stage A (2026-10-21T12:00:00Z)",
  population: "Frozen v2 task set.",
  primary_metric: "cost_per_solved_task",
  confirmatory: true,
  family: ["C1", "C2", "C3"],
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
  bootstrap: { unit: "task", resamples: 10000, seed: 20261021, level: 0.95 },
  zero_solve: { rule: "suppress_any_undefined" },
  missing_pairs: "per_contrast_matched",
  held_out: {
    count: 4,
    rule: "pickHeldOut at harness-v2-screen-start",
    seal: "harness-v2-screen-start",
    tasks: ["HX-050", "HX-051", "HX-052", "HX-053"],
    in_family: false,
  },
  measures: {
    fingerprint: H("f"),
    unknown_symbol_codes: ["AL0118"],
    ruleset_sha256: H("d"),
    canary_codes: ["AA0137"],
    workflow_execution: "used_execution",
    effort_execution: "every_attempt",
  },
  exploratory_metrics: ["pass_rate"],
  simulation: { script_sha256: H("1"), args: { sims: 1000 } },
  design_rule: "the frozen design rule",
  stage_a: null,
  experiment_hash: null,
  selection: null,
  design: null,
  power_simulation: null,
  compiler_identity: null,
  stage_b_approval: null,
  amendments: [],
};

async function stageBFor(
  c: CampaignRecord,
  over: object = {},
): Promise<Prereg> {
  return PreregSchema.parse({
    ...STAGE_A_F,
    stage_a: { sha256: await protocolSha(PreregSchema.parse(STAGE_A_F)) },
    experiment_hash: c.experiment_hash,
    selection: {
      path: "harness-tasks/v2/selection.json",
      sha256: H("5"),
      selected: F_TASKS.filter((t) => !F_HELD.includes(t)),
      held_out: F_HELD,
    },
    design: { tasks: 6, repeats: 2 },
    power_simulation: {
      inputs: [{ path: "x.json", sha256: H("2") }],
      output: { path: "harness/preregistration/sim-b.json", sha256: H("3") },
    },
    compiler_identity: "artifact|bccontainerhelper 6.1.14",
    stage_b_approval: "OWNER-APPROVED: stage B (2026-10-29T12:00:00Z)",
    bootstrap: { unit: "task", resamples: 1000, seed: 20261021, level: 0.95 },
    held_out: { ...STAGE_A_F.held_out, count: 2, tasks: F_HELD },
    ...over,
  });
}

const preregOf = (recs: CampaignRecords, doc: Prereg) => ({
  doc,
  sha256: recs.campaign.preregistration!.sha256,
  problems: [] as string[],
});

/** One measure record for the first judgment, as the cell's own provenance, with `over` applied. */
function logsWithMeasure(
  recs: CampaignRecords,
  doc: Prereg | null,
  over: Partial<MeasureRecord> = {},
): ReportLogs {
  const j = recs.judgments[0]!;
  const e = recs.executions.find((x) => x.id === j.execution_id)!;
  const na = { status: "not_applicable" as const, reason: "test" };
  const rec: MeasureRecord = {
    v: 1,
    judgment_id: j.id,
    execution_id: e.id,
    task_id: e.task_id,
    workspace_hash: e.workspace_hash!,
    oracle_hash: j.task_oracle_hash,
    measure_fingerprint: doc ? doc.measures.fingerprint : H("f"),
    analyzers: doc
      ? {
        compiler: doc.compiler_identity!,
        ruleset_sha256: doc.measures.ruleset_sha256,
        canary_codes: [...doc.measures.canary_codes],
      }
      : null,
    final_code: na,
    reuse: na,
    partial_credit: na,
    ...over,
  };
  return {
    host: new Map(),
    verdict: new Map(),
    measures: new Map([[j.id, rec]]),
  };
}

Deno.test("buildReport (M11): confirmatory C1-C3 from the pre-registration over selected tasks only", async () => {
  const recs = await factorialRecords(100, "cost_per_solved_task", true);
  // With 6 tasks one resample is a single repeated task (SE* = 0, undefined)
  // under this seed; suppress_any_undefined would withhold every row, so this
  // fixture uses the min_defined_share rule.
  const prereg = preregOf(
    recs,
    await stageBFor(recs.campaign, {
      zero_solve: { rule: "min_defined_share", share: 0.99 },
    }),
  );
  const r = await buildReport(recs, { prereg, resamples: 50, seed: 99 });
  const k = confirmed(r);
  assertEquals(k.bootstrap.resamples, 1000);
  assertEquals(k.bootstrap.seed, 20261021);
  assertEquals(k.tasks, prereg.doc.selection!.selected);
  assertEquals(k.family, ["C1", "C2", "C3"]);
  assertEquals(
    k.results.map((x) => [x.id, x.confirmatory]),
    [["C1", true], ["C2", true], ["C3", true], ["interaction", false]],
  );
  assertEquals(k.results[0]!.tasks, prereg.doc.selection!.selected.length);
  assertEquals(k.results[0]!.resamples, 1000);
  assertEquals(
    k.results.map((x) => x.decision),
    ["variant_lower", "variant_lower", "no_decision", "no_decision"],
  );
  assertEquals(k.held_out.tasks, prereg.doc.selection!.held_out);
  assert(r.comparisons.every((c) => c.label === "exploratory"));
  assert(r.comparisons.every((c) => !c.primary));
  assertStringIncludes(
    renderReport(r),
    "Confirmatory contrasts (pre-registered",
  );
});

Deno.test("buildReport (M11): held-out tasks never enter C1-C3 and get their own descriptive summary", async () => {
  const wild = await factorialRecords(100);
  const calm = await factorialRecords(1);
  const a = confirmed(
    await buildReport(wild, {
      prereg: preregOf(wild, await stageBFor(wild.campaign)),
    }),
  );
  const b = confirmed(
    await buildReport(calm, {
      prereg: preregOf(calm, await stageBFor(calm.campaign)),
    }),
  );
  assertEquals(a.results[0]!.delta, -1);
  assertEquals(
    a.results.map((x) => [x.delta, x.p_value, x.ci]),
    b.results.map((
      x,
    ) => [x.delta, x.p_value, x.ci]),
  );
  assertEquals(a.held_out.arms.map((x) => x.arm), F_ARMS);
  assertEquals(a.held_out.arms.map((x) => x.cost_per_solved_task), [
    2,
    100,
    2,
    1,
  ]);
  assertEquals(b.held_out.arms[1]!.cost_per_solved_task, 1);
});

Deno.test("buildReport (M11): missing, changed or inconsistent pre-registration is refused", async () => {
  const recs = await factorialRecords();
  const doc = await stageBFor(recs.campaign);
  await assertRejects(
    () => buildReport(recs, {}),
    ValidationError,
    "preregistration",
  );
  await assertRejects(
    () =>
      buildReport(recs, {
        prereg: { doc, sha256: "0".repeat(64), problems: [] },
      }),
    ValidationError,
    "does not match the campaign",
  );
  await assertRejects(
    () =>
      buildReport(recs, {
        prereg: preregOf(recs, { ...doc, family: ["C2", "C1", "C3"] }),
      }),
    ValidationError,
    "family",
  );
  await assertRejects(
    () =>
      buildReport(recs, {
        prereg: { ...preregOf(recs, doc), problems: ["stage-B file edited"] },
      }),
    ValidationError,
    "stage-B file edited",
  );
});

Deno.test("buildReport (M11): a measure record from another fingerprint, ruleset, compiler or canary is refused", async () => {
  const recs = await factorialRecords();
  const doc = await stageBFor(recs.campaign);
  const prereg = preregOf(recs, doc);
  const analyzers = {
    compiler: doc.compiler_identity!,
    ruleset_sha256: doc.measures.ruleset_sha256,
    canary_codes: ["AA0137"],
  };
  const cases: Array<[string, Partial<MeasureRecord>]> = [
    ["fingerprint", { measure_fingerprint: H("a") }],
    ["ruleset", { analyzers: { ...analyzers, ruleset_sha256: H("a") } }],
    ["compiler", { analyzers: { ...analyzers, compiler: "other" } }],
    ["canary", { analyzers: { ...analyzers, canary_codes: ["AL0001"] } }],
  ];
  for (const [field, over] of cases) {
    await assertRejects(
      () =>
        buildReport(recs, { prereg, logs: logsWithMeasure(recs, doc, over) }),
      ValidationError,
      field,
    );
  }
  // The cell's own record passes.
  await buildReport(recs, { prereg, logs: logsWithMeasure(recs, doc) });
});

Deno.test("buildReport (M11): a measure record counts only for its cell's judgment, execution, workspace and oracle", async () => {
  const recs = await factorialRecords();
  const doc = await stageBFor(recs.campaign);
  const prereg = preregOf(recs, doc);
  const cases: Array<[string, Partial<MeasureRecord>]> = [
    ["judgment", { judgment_id: "00000000-0000-4000-a000-0000000000ff" }],
    ["execution", { execution_id: recs.executions[1]!.id }],
    ["workspace", { workspace_hash: "f".repeat(64) }],
    ["oracle", { oracle_hash: "e".repeat(64) }],
  ];
  for (const [field, over] of cases) {
    await assertRejects(
      () =>
        buildReport(recs, { prereg, logs: logsWithMeasure(recs, doc, over) }),
      ValidationError,
      field,
    );
  }
  // The same check applies without a pre-registration.
  const plain = await records();
  await buildReport(plain, { logs: logsWithMeasure(plain, null) });
  await assertRejects(
    () =>
      buildReport(plain, {
        logs: logsWithMeasure(plain, null, { workspace_hash: "f".repeat(64) }),
      }),
    ValidationError,
    "workspace",
  );
});

Deno.test("renderReport (M11): amendments print first, Holm is named the sole rule, both intervals and held-out shown", async () => {
  const recs = await factorialRecords();
  const doc = await stageBFor(recs.campaign, {
    amendments: [{
      key: "design",
      from: { tasks: 8, repeats: 2 },
      to: { tasks: 6, repeats: 2 },
      reason: "two tasks held out",
      approval: "OWNER-APPROVED: design (2026-10-29T12:00:00Z)",
    }],
  });
  const text = stripAnsiCode(
    renderReport(await buildReport(recs, { prereg: preregOf(recs, doc) })),
  );
  const lines = text.split("\n");
  assertEquals(lines[0], "Harness report: cc-v2-factorial");
  assertStringIncludes(
    lines[1]!,
    "pre-registration amended after screening: design",
  );
  assertStringIncludes(text, "Holm is the only decision rule");
  assertStringIncludes(text, "Bonferroni interval [");
  assertStringIncludes(text, "(unadjusted)");
  assertStringIncludes(text, "[exploratory] outside the Holm family");
  assertStringIncludes(
    text,
    "Held-out tasks (descriptive robustness check, not in C1-C3): HX-007, HX-008",
  );
});

Deno.test("buildReport (M11 review): with contrasts the headline is exploratory and no decision is read off an interval", async () => {
  const recs = await factorialRecords();
  const r = await buildReport(recs, {
    prereg: preregOf(recs, await stageBFor(recs.campaign)),
  });
  assertEquals(r.metric_labels.cost_per_solved_task, "exploratory");
  const text = stripAnsiCode(renderReport(r));
  const primary = text.split("\n").filter((l) =>
    /^ {2}cc-\w+: cost per solved task.*; spend /.test(l)
  );
  assertEquals(primary.length, 4);
  assert(primary.every((l) => l.includes("[exploratory]")), primary.join("\n"));
  assert(!text.includes("distinguishable"));
  assert(confirmed(r).results.every((x) => x.distinguishable === null));
  const json = JSON.stringify(r.confirmatory);
  assert(!json.includes('"distinguishable":true'));
  assert(!json.includes('"distinguishable":false'));
});

Deno.test("buildReport (M11 review): every contrast uses all selected tasks; the Bonferroni level is shown", async () => {
  const recs = await factorialRecords();
  const r = await buildReport(recs, {
    prereg: preregOf(recs, await stageBFor(recs.campaign)),
  });
  assertEquals(confirmed(r).results.map((x) => x.tasks), [6, 6, 6, 6]);
  const text = stripAnsiCode(renderReport(r));
  assertStringIncludes(text, "6 selected tasks)");
  assertStringIncludes(text, "over 6 of 6 selected tasks");
  assertStringIncludes(text, "at level 98.3%");
});

Deno.test("buildReport (M11 review): a measure record filed under another judgment's key is refused", async () => {
  const recs = await factorialRecords();
  const doc = await stageBFor(recs.campaign);
  const logs = logsWithMeasure(recs, doc);
  const rec = [...logs.measures!.values()][0]!;
  await assertRejects(
    () =>
      buildReport(recs, {
        prereg: preregOf(recs, doc),
        logs: { ...logs, measures: new Map([[recs.judgments[1]!.id, rec]]) },
      }),
    ValidationError,
    "judgment",
  );
});

/** The confirmatory section of a report that has one (not withheld). */
function confirmed(r: HarnessReport) {
  const k = r.confirmatory;
  if (!k || "withheld" in k) throw new Error("confirmatory section withheld");
  return k;
}

Deno.test("buildReport (M11 ruling): the confirmatory analysis is withheld unless the data are exactly the pre-registered design", async () => {
  const recs = await factorialRecords();
  const prereg = preregOf(recs, await stageBFor(recs.campaign));
  const campaignOracles = new Map(
    recs.campaign.task_set.tasks.map((t) => [t.id, t.oracle]),
  );
  const noRepeat2 = (e: { task_id: string; repeat: number }) =>
    !(e.task_id === "HX-001" && e.repeat === 2);
  const executions = recs.executions.filter(noRepeat2);
  const kept = new Set(executions.map((e) => e.id));
  const cases: Array<[string, CampaignRecords, object, string]> = [
    ["repeats cut", recs, { repeats: 1 }, "repeats"],
    [
      "pending cell in a selected task",
      { ...recs, judgments: recs.judgments.slice(1) },
      {},
      "1 pending and 0 unrun",
    ],
    [
      "judging current",
      recs,
      { judging: { source: "current", oracle: campaignOracles } },
      "judging",
    ],
    [
      "a selected task missing a repeat",
      {
        ...recs,
        executions,
        judgments: recs.judgments.filter((j) => kept.has(j.execution_id)),
      },
      {},
      "0 pending and 4 unrun",
    ],
  ];
  for (const [name, data, over, reason] of cases) {
    const r = await buildReport(data, { prereg, ...over });
    const k = r.confirmatory;
    assert(k && "withheld" in k, name);
    assertEquals(Object.keys(k), ["withheld"], name);
    assertStringIncludes(k.withheld, reason);
    const text = stripAnsiCode(renderReport(r));
    assertStringIncludes(
      text,
      `Confirmatory analysis withheld: ${k.withheld}`,
    );
    assert(!text.includes("Confirmatory contrasts ("), name);
    assert(r.comparisons.every((c) => c.label === "exploratory"), name);
  }
  // The full design is still analysed.
  assertEquals(confirmed(await buildReport(recs, { prereg })).tasks.length, 6);
});

Deno.test("buildReport (M11 review): exploratory comparison rows carry no interval verdict when the experiment has contrasts", async () => {
  const recs = await factorialRecords();
  const prereg = preregOf(recs, await stageBFor(recs.campaign));
  for (const opts of [{ prereg }, { prereg, repeats: 1 }]) {
    const r = await buildReport(recs, opts);
    assert(r.comparisons.length > 0);
    assert(r.comparisons.every((c) => c.distinguishable === null));
    assert(!JSON.stringify(r).includes('"distinguishable":true'));
    assert(!JSON.stringify(r).includes('"distinguishable":false'));
  }
  // Without contrasts the v1 verdict is unchanged.
  const v1 = await buildReport(await records(), { resamples: 200, seed: 1 });
  assert(v1.comparisons.some((c) => c.distinguishable !== null));
});

Deno.test("buildReport (M11 run 002): a terminal cell without cost data in a selected task withholds the confirmatory analysis", async () => {
  const recs = await factorialRecords();
  const prereg = preregOf(recs, await stageBFor(recs.campaign));
  const unknownCost = (task: string) => ({
    ...recs,
    executions: recs.executions.map((e) =>
      e.task_id === task && e.repeat === 1 && e.arm === "cc-p"
        ? {
          ...e,
          telemetry: telemetry(null),
          validity: {
            ...e.validity,
            incomplete_telemetry: ["cost_usd" as const],
          },
        }
        : e
    ),
  });
  const r = await buildReport(unknownCost("HX-001"), { prereg });
  assertEquals(r.confirmatory, { withheld: "1 cells without cost data" });
  assert(
    stripAnsiCode(renderReport(r)).includes(
      "Confirmatory analysis withheld: 1 cells without cost data",
    ),
  );
  // The same loss in a held-out task is not part of C1-C3.
  assertEquals(
    confirmed(await buildReport(unknownCost("HX-007"), { prereg })).tasks
      .length,
    6,
  );
});

Deno.test("buildReport (M11-10c): a pass_rate experiment with a cost pre-registration is refused; on a cost experiment missing cost withholds the family", async () => {
  const mismatched = await factorialRecords(100, "pass_rate");
  const err = await assertRejects(
    async () =>
      await buildReport(mismatched, {
        prereg: preregOf(
          mismatched,
          await stageBFor(mismatched.campaign),
        ),
      }),
    ValidationError,
  );
  assertStringIncludes(err.message, "pass_rate");
  assertStringIncludes(err.message, "cost_per_solved_task");
  const base = await factorialRecords(100);
  const recs = {
    ...base,
    executions: base.executions.map((e) =>
      e.task_id === "HX-001" && e.repeat === 1 && e.arm === "cc-p"
        ? {
          ...e,
          telemetry: telemetry(null),
          validity: {
            ...e.validity,
            incomplete_telemetry: ["cost_usd" as const],
          },
        }
        : e
    ),
  };
  const prereg = preregOf(recs, await stageBFor(recs.campaign));
  const r = await buildReport(recs, { prereg });
  assertEquals(r.confirmatory, { withheld: "1 cells without cost data" });
  const full = confirmed(
    await buildReport(base, { prereg: preregOf(base, prereg.doc) }),
  );
  assertEquals(
    full.results.map((x) => x.metric),
    Array(4).fill("cost_per_solved_task"),
  );
});

const AM_EXPLORATORY = {
  key: "confirmatory",
  from: true,
  to: false,
  reason: "family unpowered",
  approval: "OWNER-APPROVED: downgrade (2026-10-29T12:00:00Z)",
};

Deno.test("buildReport (M11 run 002): an approved downgrade to exploratory is emitted and rendered as exploratory, never confirmatory", async () => {
  const recs = await factorialRecords();
  const doc = await stageBFor(recs.campaign, {
    confirmatory: false,
    family: [],
    amendments: [AM_EXPLORATORY],
  });
  const r = await buildReport(recs, { prereg: preregOf(recs, doc) });
  assertEquals(r.confirmatory, undefined);
  const x = r.exploratory_contrasts!;
  assertEquals(x.family, []);
  assertEquals(
    x.results.map((c) => [c.id, c.confirmatory, c.decision, c.distinguishable]),
    ["C1", "C2", "C3", "interaction"].map((id) => [
      id,
      false,
      "no_decision",
      null,
    ]),
  );
  const text = stripAnsiCode(renderReport(r));
  assertStringIncludes(
    text.split("\n")[1]!,
    "amended after screening: confirmatory",
  );
  assertStringIncludes(text, "Exploratory contrasts (pre-registered");
  assert(!text.includes("Confirmatory"), text);
  assert(!text.includes("Holm"), text);
  assertStringIncludes(text, "Held-out tasks (descriptive");
});

Deno.test("buildReport (M11 run 002): amendments stay disclosed in the header when the confirmatory section is withheld", async () => {
  const recs = await factorialRecords();
  const doc = await stageBFor(recs.campaign, {
    amendments: [{
      key: "design",
      from: { tasks: 8, repeats: 2 },
      to: { tasks: 6, repeats: 2 },
      reason: "two tasks held out",
      approval: "OWNER-APPROVED: design (2026-10-29T12:00:00Z)",
    }],
  });
  const r = await buildReport(recs, {
    prereg: preregOf(recs, doc),
    repeats: 1,
  });
  assertEquals(Object.keys(r.confirmatory!), ["withheld"]);
  assertEquals(r.preregistration!.amendments.map((a) => a.key), ["design"]);
  const text = stripAnsiCode(renderReport(r));
  assertStringIncludes(
    text.split("\n")[1]!,
    "pre-registration amended after screening: design",
  );
  assertStringIncludes(text, "Confirmatory analysis withheld");
});
