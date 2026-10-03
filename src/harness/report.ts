/**
 * Harness report (spec 1a section 9): header, primary, outcome, and the
 * descriptive extras (M1-25): efficiency from host and verdict logs, slices
 * by task kind and coupling, and a both-pass table (never a winner).
 *
 * The report runs only on records that pass validateCampaignRecords, states
 * the judging context (which oracle per task), shows planned / attempted /
 * scored counts, raw and pending spend, the matched-pair cohort with
 * exclusion reasons, and which execution and judgment every cell used.
 */

import * as colors from "@std/fmt/colors";
import { join } from "@std/path";
import type { HostLogLine } from "./backend.ts";
import type { VerdictLog } from "./verdict.ts";
import { ValidationError } from "../errors.ts";
import type { PrimaryMetric } from "./config.ts";
import { taskSetHash } from "./identity.ts";
import { type CampaignRecords, validateCampaignRecords } from "./integrity.ts";
import { diffManifests, type ManifestKey } from "./manifest.ts";
import {
  campaignJudging,
  type CellRecord,
  cellsFromRecords,
  checkJudging,
  type JudgingContext,
} from "./outcome.ts";
import {
  type ExecutionRecord,
  incompleteObserved,
  type JudgmentRecord,
} from "./records.ts";
import { RULES_VERSION } from "./classify.ts";
import type { MeasureRecord } from "./measures.ts";
import { familyProblems, type Prereg } from "./prereg.ts";
import { type LoadedTrace, traceMetrics } from "./trace-metrics.ts";
import {
  type ArmSummary,
  armSummary,
  type BootstrapOptions,
  checkBootstrapOptions,
  compareArms,
  type Comparison,
  type ContrastResult,
  exploratoryNote,
  ineligible,
  testContrasts,
  type ZeroSolveRule,
} from "./stats.ts";

export interface ArmCoverage {
  arm: string;
  executions: number;
  manual_reruns: number;
  infra_exposed: number;
  /** Executions per missing declared telemetry field. */
  incomplete_telemetry: Record<string, number>;
  /** Ids of executions with unverified observed components (execution v2), sorted. */
  unverified_components: string[];
  /** Executions priced under each cost assumption (raw_usage.assumptions keys), sorted keys. */
  cost_assumptions: Record<string, number>;
  /**
   * Trace classification coverage (M2-06); null without the traces option.
   * Call counts come from complete traces only; partial and invalid traces
   * are counted, never mixed in. Category totals never rank harnesses.
   */
  trace: TraceCoverage | null;
  /** Cells of repeats above the reported N (M5-05); 0 without a cut. */
  excluded_cells: number;
  /** Known spend of every attempt in those cells. */
  excluded_known_spend_usd: number;
  /** Invalid traces of executions in those cells (disclosed, never warned). */
  excluded_trace_invalid: number;
  /** Known spend of every attempt in every cell, all repeats. */
  campaign_raw_spend_usd: number;
}

export interface TraceCoverage {
  executions: number;
  /** Executions whose trace was read (complete or partial). */
  with_trace: number;
  complete: number;
  invalid: number;
  tool_calls: number;
  rule_classified: number;
  unclassified: number;
  unreplayable: number;
  rules: string;
}

/** Every reported metric is the declared primary one or exploratory. */
export type MetricLabel = "primary" | "exploratory";
export type ReportedMetric = PrimaryMetric | "pass_k";

export interface HarnessReport {
  v: 1;
  experiment: {
    id: string;
    hypothesis: string;
    primary_metric: PrimaryMetric;
    baseline: string;
    variants: string[];
  };
  campaign: {
    id: string;
    created_at: string;
    task_set_identity: string;
    tasks: number;
  };
  judging: {
    source: JudgingContext["source"];
    /** Task-set identity with the judging oracles substituted. */
    identity: string;
    tasks_with_other_oracle: string[];
  };
  provisional: boolean;
  /**
   * Planned repeats and the N reported (M5-05). Every metric and the rest
   * of `coverage` use repeats 1..N only.
   */
  repeats: { planned: number; reported: number };
  /**
   * Explicit partial marker (M6-02a): null when every planned repeat is
   * reported and no cell is pending or unrun. Otherwise the reasons, in this
   * order: "provisional" (`provisional` is true: cells pending or unrun,
   * e.g. a pi stop before any complete repeat), "repeat_cut"
   * (`repeats.reported` < `repeats.planned`: a capacity cut, or a pi stop
   * reported at its last complete repeat). Derived from those two fields only.
   */
  partial: ReportPartial | null;
  /**
   * Label of every metric the report shows, from the experiment's declared
   * primary metric; pass^k is never primary. Applies to `arms`, `flips`
   * (per-task pass rate) and, per row, `comparisons[].label`.
   */
  metric_labels: Record<ReportedMetric, MetricLabel>;
  coverage: ArmCoverage[];
  /** Traces that could not be read; a warning, never a failure of the report. */
  trace_invalid: { execution: string; error: string }[];
  diffs: Array<{ variant: string; differing: ManifestKey[] }>;
  arms: ArmSummary[];
  /**
   * The declared primary metric first, the other one exploratory. Each
   * comparison names the one scorer fingerprint all its scored cells share.
   */
  comparisons: Array<
    Comparison & {
      primary: boolean;
      label: MetricLabel;
      scorer_fingerprint: string | null;
    }
  >;
  flips: Array<{
    task: string;
    kind: string;
    coupling: string[];
    pass_rate: Record<string, number | null>;
  }>;
  /** Per arm, over the primary metric's cohort: every attempt of each counted cell (descriptive). */
  efficiency: ArmEfficiency[];
  /** Pass rate per arm by task kind, then by coupling tag (descriptive). */
  slices: Slice[];
  /** Per variant: matched scored pairs against the baseline (descriptive, no winner). */
  both_pass: BothPass[];
  /**
   * M11-11: the pre-registered contrasts (C1..C3 and the interaction), over
   * the selected tasks only. Holm over `family` is the only decision rule;
   * the intervals are descriptive. Held-out tasks are summarised apart.
   * Everything else in the report is exploratory. Withheld (with the reason,
   * never partial decisions) unless the data are exactly the pre-registered
   * design: nothing partial, pending or unrun, campaign oracles.
   */
  confirmatory?: { withheld: string } | ContrastsAnalysis;
  /**
   * The same analysis when an approved amendment downgraded the
   * pre-registration to exploratory: no family, no decisions, never under
   * `confirmatory`.
   */
  exploratory_contrasts?: ContrastsAnalysis;
  /** Pre-registration identity and amendments, disclosed even when `confirmatory` is withheld. */
  preregistration?: {
    path: string;
    sha256: string;
    protocol_sha256: string;
    amendments: Prereg["amendments"];
  };
  cells: CellRecord[];
}

export interface ContrastsAnalysis {
  preregistration: { path: string; sha256: string; protocol_sha256: string };
  amendments: Prereg["amendments"];
  alpha: number;
  family: string[];
  zero_solve: ZeroSolveRule;
  bootstrap: { resamples: number; seed: number; level: number };
  tasks: string[];
  results: ContrastResult[];
  held_out: { tasks: string[]; arms: ArmSummary[] };
}

export type PartialReason = "provisional" | "repeat_cut";
export interface ReportPartial {
  reasons: PartialReason[];
}

/** The partial marker of a report, from `provisional` and `repeats`. */
export function partialOf(
  r: Pick<HarnessReport, "provisional" | "repeats">,
): ReportPartial | null {
  const reasons: PartialReason[] = [
    ...(r.provisional ? ["provisional" as const] : []),
    ...(r.repeats.reported < r.repeats.planned ? ["repeat_cut" as const] : []),
  ];
  return reasons.length === 0 ? null : { reasons };
}

/** One line for the text report and every chart. */
export function partialText(
  r: Pick<HarnessReport, "provisional" | "repeats">,
): string {
  const p = partialOf(r);
  const { reported, planned } = r.repeats;
  if (p === null) {
    return `Partial: no (repeats ${reported} of ${planned} reported, no cell pending or unrun)`;
  }
  const why = p.reasons.map((x) =>
    x === "provisional"
      ? "provisional: cells pending or unrun"
      : `repeat cut: ${reported} of ${planned} repeats reported`
  );
  return `PARTIAL (${why.join("; ")})`;
}

export interface ArmEfficiency {
  arm: string;
  /** Cohort executions whose host log was found. */
  host_logs: number;
  backend_requests: number;
  /** Compile requests the backend accepted (not rejected). */
  logical_builds: number;
  per_app_compiles: number;
  /** Tests the backend ran (host log tests_run). */
  test_runs: number;
  diagnostics_per_build: number | null;
  verdict_ms_median: number | null;
  verdict_queue_ms_median: number | null;
  /** Median wait of a backend request for a container (host log spans.queue_ms). */
  backend_queue_ms_median: number | null;
}

export interface Slice {
  by: "kind" | "coupling";
  value: string;
  tasks: number;
  pass_rate: Record<string, number | null>;
}

export interface BothPass {
  baseline: string;
  variant: string;
  pairs: number;
  both_pass: number;
  baseline_only: number;
  variant_only: number;
  neither: number;
}

/** Published side files the extras read; absent entries count as missing. */
export interface ReportLogs {
  /** Execution id -> host log lines. */
  host: ReadonlyMap<string, readonly HostLogLine[]>;
  /** Judgment id -> verdict log. */
  verdict: ReadonlyMap<string, VerdictLog>;
  /** Judgment id -> measure record; each is checked against its cell (see measureProblems). */
  measures?: ReadonlyMap<string, MeasureRecord>;
}

export interface ReportOptions extends BootstrapOptions {
  judging?: JudgingContext;
  logs?: ReportLogs;
  /** `verifyPrereg` output; required for a campaign with a preregistration. */
  prereg?: { doc: Prereg; sha256: string; problems: string[] };
  /** Published traces (loadTraces); without it coverage[].trace is null. */
  traces?: {
    traces: Map<string, LoadedTrace | null>;
    invalid: { execution: string; error: string }[];
  };
  /** Report repeats 1..N only (1 <= N <= planned); default all planned. */
  repeats?: number;
}

function traceCoverage(
  es: CampaignRecords["executions"],
  t: NonNullable<ReportOptions["traces"]>,
): TraceCoverage {
  const bad = new Set(t.invalid.map((x) => x.execution));
  const c: TraceCoverage = {
    executions: es.length,
    with_trace: 0,
    complete: 0,
    invalid: es.filter((e) => bad.has(e.id)).length,
    tool_calls: 0,
    rule_classified: 0,
    unclassified: 0,
    unreplayable: 0,
    rules: `rules@${RULES_VERSION}`,
  };
  for (const e of es) {
    const lt = t.traces.get(e.id);
    if (!lt) continue;
    c.with_trace++;
    if (!lt.complete) continue;
    c.complete++;
    const m = traceMetrics(lt.events, lt);
    c.tool_calls += m.tool_calls;
    c.rule_classified += m.rule_classified;
    c.unclassified += m.unclassified;
    c.unreplayable += m.unreplayable;
  }
  return c;
}

/**
 * Host logs (runs/<execution>/host-log.jsonl; a line cut by a crash is
 * skipped) and verdict logs (verdicts/<judgment>.json) of a campaign's
 * records under the results root. A missing file is absent from the map.
 */
export async function loadReportLogs(
  resultsRoot: string,
  records: CampaignRecords,
): Promise<ReportLogs> {
  const read = async (path: string): Promise<string | null> => {
    try {
      return await Deno.readTextFile(path);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  };
  const host = new Map<string, HostLogLine[]>();
  for (const e of records.executions) {
    const text = await read(join(resultsRoot, "runs", e.id, "host-log.jsonl"));
    if (text === null) continue;
    const lines: HostLogLine[] = [];
    for (const l of text.split(/\r?\n/)) {
      if (l.trim() === "") continue;
      try {
        lines.push(JSON.parse(l) as HostLogLine);
      } catch { /* cut by a crash: not counted */ }
    }
    host.set(e.id, lines);
  }
  const verdict = new Map<string, VerdictLog>();
  for (const j of records.judgments) {
    const text = await read(join(resultsRoot, "verdicts", `${j.id}.json`));
    if (text !== null) verdict.set(j.id, JSON.parse(text) as VerdictLog);
  }
  return { host, verdict };
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function efficiencyOf(
  cells: CellRecord[],
  arm: string,
  logs: ReportLogs,
  attemptsOf: (c: CellRecord) => readonly ExecutionRecord[],
  primary: PrimaryMetric,
): ArmEfficiency {
  // The primary metric's cohort: counted cells only (no pending or unrun),
  // with every attempt whose spend the primary counts.
  const mine = cells.filter((c) =>
    c.arm === arm && ineligible(c, primary) === null
  );
  const lines = mine.flatMap((c) =>
    attemptsOf(c).map((e) => logs.host.get(e.id))
  ).filter((x): x is readonly HostLogLine[] => x !== undefined);
  const flat = lines.flat();
  const builds = flat.filter((l) =>
    l.op === "compile" && l.outcome !== "rejected"
  );
  const verdicts = mine.flatMap((c) =>
    c.judgment_id ? [logs.verdict.get(c.judgment_id)] : []
  ).filter((v): v is VerdictLog => v !== undefined);
  return {
    arm,
    host_logs: lines.length,
    backend_requests: flat.length,
    logical_builds: builds.length,
    per_app_compiles: flat.reduce((n, l) => n + l.per_app_compiles, 0),
    test_runs: flat.reduce((n, l) => n + l.tests_run, 0),
    diagnostics_per_build: builds.length === 0
      ? null
      : builds.reduce((n, l) => n + l.diagnostics, 0) / builds.length,
    verdict_ms_median: median(verdicts.map((v) => v.spans.total_ms)),
    verdict_queue_ms_median: median(verdicts.map((v) => v.spans.queue_ms)),
    backend_queue_ms_median: median(
      flat.map((l) => l.spans["queue_ms"]).filter((x): x is number =>
        typeof x === "number"
      ),
    ),
  };
}

/**
 * Fail closed on mixed scorer versions: every judgment selected for any
 * cell of the report, across all arms, must carry the same scorer
 * fingerprint, so no two comparisons use different scorers either. Which
 * version supersedes which is a Part 2 policy.
 */
function oneScorerFingerprint(cells: CellRecord[]): string | null {
  const fps = [
    ...new Set(
      cells.map((c) => c.scorer_fingerprint)
        .filter((fp): fp is string => fp !== null),
    ),
  ].sort();
  if (fps.length > 1) {
    throw new ValidationError(
      `campaign mixes scorer versions (fingerprints ${
        fps.join(", ")
      }); rejudge with one scorer version`,
      fps,
    );
  }
  return fps[0] ?? null;
}

/**
 * A measure record counts for a cell only when it is the cell's own: its
 * counted judgment, used execution, that execution's stored workspace and the
 * judgment's oracle. With a pre-registration it must also carry the frozen
 * measure fingerprint, analyzer ruleset, compiler and canary codes. The first
 * mismatch refuses the report and names the field.
 */
function checkMeasures(
  records: CampaignRecords,
  cells: CellRecord[],
  measures: ReadonlyMap<string, MeasureRecord>,
  doc: Prereg | undefined,
): void {
  const refuse = (id: string, field: string, detail: string) => {
    const msg = `measure record for judgment ${id}: ${field} ${detail}`;
    return new ValidationError(msg, [msg]);
  };
  for (const [id, r] of measures) {
    if (r.judgment_id !== id) {
      throw refuse(
        id,
        "judgment",
        `${r.judgment_id} differs from the key it is filed under`,
      );
    }
    const cell = cells.find((c) => c.judgment_id === r.judgment_id);
    if (!cell) {
      throw refuse(
        id,
        "judgment",
        `${r.judgment_id} is not the counted judgment of any cell`,
      );
    }
    if (r.execution_id !== cell.used_execution) {
      throw refuse(
        id,
        "execution",
        `${r.execution_id} is not the cell's used execution ${cell.used_execution}`,
      );
    }
    const stored = records.artifacts.find((a) =>
      a.execution_id === cell.used_execution
    )?.workspace_hash ??
      records.executions.find((e) => e.id === cell.used_execution)
        ?.workspace_hash;
    if (r.workspace_hash !== stored) {
      throw refuse(
        id,
        "workspace",
        `hash ${r.workspace_hash} is not the used execution's stored workspace ${stored}`,
      );
    }
    if (r.oracle_hash !== cell.oracle_hash) {
      throw refuse(
        id,
        "oracle",
        `hash ${r.oracle_hash} is not the counted judgment's oracle ${cell.oracle_hash}`,
      );
    }
    if (!doc) continue;
    const m = doc.measures;
    if (r.measure_fingerprint !== m.fingerprint) {
      throw refuse(
        id,
        "fingerprint",
        `${r.measure_fingerprint} is not the pre-registered ${m.fingerprint}`,
      );
    }
    const a = r.analyzers;
    if (a === null) continue;
    if (a.ruleset_sha256 !== m.ruleset_sha256) {
      throw refuse(
        id,
        "ruleset",
        `${a.ruleset_sha256} is not the pre-registered ${m.ruleset_sha256}`,
      );
    }
    if (a.compiler !== doc.compiler_identity) {
      throw refuse(
        id,
        "compiler",
        `${a.compiler} is not the pre-registered ${doc.compiler_identity}`,
      );
    }
    const lacking = m.canary_codes.filter((x) => !a.canary_codes.includes(x));
    if (lacking.length > 0) {
      throw refuse(id, "canary", `codes lack ${lacking.join(", ")}`);
    }
  }
}

export async function buildReport(
  records: CampaignRecords,
  opts: ReportOptions = {},
): Promise<HarnessReport> {
  await validateCampaignRecords(records);
  const { campaign } = records;
  const exp = campaign.experiment;
  const arms = [exp.baseline, ...exp.variants];
  const reported = opts.repeats ?? exp.repeats;
  if (!Number.isInteger(reported) || reported < 1 || reported > exp.repeats) {
    const msg =
      `repeats must be an integer from 1 to the planned ${exp.repeats}, got ${reported}`;
    throw new ValidationError(msg, [msg]);
  }
  const judging = opts.judging ?? campaignJudging(campaign);
  checkJudging(campaign, judging);
  const byExecution = new Map<string, JudgmentRecord[]>();
  for (const j of records.judgments) {
    byExecution.set(j.execution_id, [
      ...(byExecution.get(j.execution_id) ?? []),
      j,
    ]);
  }
  const allCells = cellsFromRecords(
    campaign,
    records.executions,
    byExecution,
    judging,
  );
  // Metrics and coverage over repeats 1..N; the rest is disclosed as excluded.
  const cells = allCells.filter((c) => c.repeat <= reported);
  const executions = records.executions.filter((e) => e.repeat <= reported);
  // Excluded execution id -> arm: their invalid traces are disclosed, not warned.
  const excludedArm = new Map(
    records.executions.filter((e) => e.repeat > reported)
      .map((e) => [e.id, e.arm]),
  );
  const invalidTraces = opts.traces?.invalid ?? [];
  const knownSpend = (cs: CellRecord[]) =>
    cs.reduce((s, c) => s + c.known_spend_usd, 0);
  // Refuse before any number: bad bootstrap options, mixed scorers.
  checkBootstrapOptions(opts);
  const pre = campaign.preregistration;
  if (pre) {
    const p = opts.prereg;
    if (!p || p.sha256 !== pre.sha256) {
      const msg = `preregistration ${pre.path} (${
        p?.sha256 ?? "not loaded"
      }) does not match the campaign (${pre.sha256})`;
      throw new ValidationError(msg, [msg]);
    }
    const why = [
      ...p.problems,
      ...familyProblems(p.doc, exp),
      ...(p.doc.selection ? [] : ["stage B selection is missing"]),
    ];
    if (why.length > 0) {
      throw new ValidationError(
        `preregistration ${pre.path}: ${why.join("; ")}`,
        why,
      );
    }
  }
  if (opts.logs?.measures) {
    checkMeasures(
      records,
      allCells,
      opts.logs.measures,
      pre ? opts.prereg?.doc : undefined,
    );
  }
  const fingerprint = oneScorerFingerprint(cells);
  // The same complete map drives selection and the reported identity.
  const judgedTasks = campaign.task_set.tasks.map((t) => ({
    ...t,
    oracle: judging.oracle.get(t.id)!,
  }));
  const manifestOf = (id: string) =>
    campaign.arms.find((a) => a.config_id === id)!.manifest;
  const diffs = [];
  for (const variant of exp.variants) {
    diffs.push({
      variant,
      differing: await diffManifests(
        manifestOf(exp.baseline),
        manifestOf(variant),
      ),
    });
  }
  // With contrasts nothing but the pre-registered family is primary: the
  // headline figures include held-out tasks.
  const labelOf = (m: ReportedMetric): MetricLabel =>
    !exp.contrasts && m === exp.primary_metric ? "primary" : "exploratory";
  const metrics: PrimaryMetric[] = exp.primary_metric === "pass_rate"
    ? ["pass_rate", "cost_per_solved_task"]
    : ["cost_per_solved_task", "pass_rate"];
  const bootstrap = {
    ...(opts.resamples !== undefined ? { resamples: opts.resamples } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    ...(opts.level !== undefined ? { level: opts.level } : {}),
  };
  // With contrasts the pre-registered family is the only confirmatory result.
  const comparisons = exp.variants.flatMap((variant) => {
    return metrics.map((metric) => ({
      ...compareArms(cells, exp.baseline, variant, metric, bootstrap),
      // No interval-derived verdict anywhere in a report with contrasts.
      ...(exp.contrasts ? { distinguishable: null } : {}),
      primary: exp.contrasts ? false : metric === exp.primary_metric,
      label: labelOf(metric),
      scorer_fingerprint: fingerprint,
    }));
  });
  const d = pre && opts.prereg && exp.contrasts ? opts.prereg.doc : undefined;
  const selection = d?.selection;
  // Fail closed (cg-orchestrator ruling 2026-10-03): decisions only on the
  // complete pre-registered design with the campaign's own oracles.
  const open = cells.filter((c) =>
    c.status === "pending" || c.status === "unrun"
  );
  const withheld = judging.source !== "campaign"
    ? `judging with ${judging.source} oracles, not the campaign's`
    : reported < exp.repeats
    ? `repeats reported ${reported} of ${exp.repeats}`
    : open.length > 0
    ? `${open.filter((c) => c.status === "pending").length} pending and ${
      open.filter((c) => c.status === "unrun").length
    } unrun cells`
    : null;
  // Holm must never run on fewer than the frozen observations: a terminal
  // cell of a selected task without the tested metric's data loses its pairs.
  const metric = d?.primary_metric ?? "cost_per_solved_task";
  const noData = selection
    ? cells.filter((c) =>
      selection.selected.includes(c.task) && ineligible(c, metric) !== null
    ).length
    : 0;
  const reason = withheld ??
    (noData > 0
      ? `${noData} cells without ${
        metric === "cost_per_solved_task" ? "cost" : metric
      } data`
      : null);
  const analysis = (): ContrastsAnalysis => {
    const selected = new Set(selection!.selected);
    const held = new Set(selection!.held_out);
    const family = d!.confirmatory ? d!.family : [];
    const { resamples, seed, level } = d!.bootstrap;
    return {
      preregistration: {
        path: pre!.path,
        sha256: pre!.sha256,
        protocol_sha256: pre!.protocol_sha256,
      },
      amendments: d!.amendments,
      alpha: d!.alpha,
      family,
      zero_solve: d!.zero_solve,
      bootstrap: { resamples, seed, level },
      tasks: selection!.selected,
      // The interval-derived flag is dropped: Holm alone decides.
      results: testContrasts(
        cells.filter((c) => selected.has(c.task)),
        exp.contrasts!,
        exp.interaction ? { ...exp.interaction } : null,
        metric,
        {
          resamples,
          seed,
          level,
          alpha: d!.alpha,
          zeroSolve: d!.zero_solve,
          family,
        },
      ).map((x) => ({ ...x, distinguishable: null })),
      held_out: {
        tasks: selection!.held_out,
        arms: arms.map((a) =>
          armSummary(cells.filter((c) => held.has(c.task)), a, reported)
        ),
      },
    };
  };
  const ready = d && pre && selection && exp.contrasts;
  // An approved downgrade is descriptive only: no decisions, so no gate.
  const downgraded = ready && !d.confirmatory;
  const confirmatory = ready && !downgraded
    ? reason !== null ? { withheld: reason } : analysis()
    : undefined;
  const exploratory_contrasts = downgraded ? analysis() : undefined;
  const summaries = arms.map((arm) => armSummary(cells, arm, reported));
  const rate = (task: string, arm: string) => {
    const ps = cells.filter((c) =>
      c.task === task && c.arm === arm && c.status === "scored"
    );
    return ps.length === 0 ? null : ps.filter((c) => c.pass).length / ps.length;
  };
  const meta = new Map(campaign.tasks_meta.map((t) => [t.id, t]));
  const flips = campaign.task_set.tasks
    .map((t) => ({
      task: t.id,
      kind: meta.get(t.id)!.kind,
      coupling: meta.get(t.id)!.coupling,
      pass_rate: Object.fromEntries(arms.map((a) => [a, rate(t.id, a)])),
    }))
    .filter((f) => new Set(Object.values(f.pass_rate)).size > 1);
  const scored = (task: string, arm: string) =>
    cells.filter((c) =>
      c.task === task && c.arm === arm && c.status === "scored"
    );
  // Each task weighs the same, as in the primary pass rate (never pooled cells).
  const sliceRate = (tasks: string[], arm: string) => {
    const rates = tasks.map((t) => scored(t, arm)).filter((ps) => ps.length > 0)
      .map((ps) => ps.filter((c) => c.pass).length / ps.length);
    return rates.length === 0
      ? null
      : rates.reduce((a, b) => a + b, 0) / rates.length;
  };
  const slices: Slice[] = [];
  for (const by of ["kind", "coupling"] as const) {
    const groups = new Map<string, string[]>();
    for (const t of campaign.tasks_meta) {
      for (const value of by === "kind" ? [t.kind] : t.coupling) {
        groups.set(value, [...(groups.get(value) ?? []), t.id]);
      }
    }
    const sorted = [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    for (const [value, tasks] of sorted) {
      slices.push({
        by,
        value,
        tasks: tasks.length,
        pass_rate: Object.fromEntries(
          arms.map((a) => [a, sliceRate(tasks, a)]),
        ),
      });
    }
  }
  const scoredCell = (task: string, repeat: number, arm: string) =>
    cells.find((c) =>
      c.task === task && c.repeat === repeat && c.arm === arm &&
      c.status === "scored"
    );
  const both_pass: BothPass[] = exp.variants.map((variant) => {
    const t: BothPass = {
      baseline: exp.baseline,
      variant,
      pairs: 0,
      both_pass: 0,
      baseline_only: 0,
      variant_only: 0,
      neither: 0,
    };
    for (const b of cells.filter((c) => c.arm === exp.baseline)) {
      const x = scoredCell(b.task, b.repeat, exp.baseline);
      const y = scoredCell(b.task, b.repeat, variant);
      if (!x || !y) continue;
      t.pairs++;
      if (x.pass && y.pass) t.both_pass++;
      else if (x.pass) t.baseline_only++;
      else if (y.pass) t.variant_only++;
      else t.neither++;
    }
    return t;
  });
  const logs = opts.logs ?? { host: new Map(), verdict: new Map() };
  const attemptsOf = (c: CellRecord) =>
    executions.filter((e) =>
      e.task_id === c.task && e.repeat === c.repeat && e.arm === c.arm
    );
  const provisional = summaries.some((s) => s.provisional);
  const repeats = { planned: exp.repeats, reported };
  return {
    v: 1,
    experiment: {
      id: exp.id,
      hypothesis: exp.hypothesis,
      primary_metric: exp.primary_metric,
      baseline: exp.baseline,
      variants: exp.variants,
    },
    campaign: {
      id: campaign.id,
      created_at: campaign.created_at,
      task_set_identity: campaign.task_set.identity,
      tasks: campaign.task_set.tasks.length,
    },
    judging: {
      source: judging.source,
      identity: await taskSetHash(judgedTasks),
      tasks_with_other_oracle: judgedTasks
        .filter((t, i) => t.oracle !== campaign.task_set.tasks[i]!.oracle)
        .map((t) => t.id),
    },
    provisional,
    repeats,
    partial: partialOf({ provisional, repeats }),
    metric_labels: {
      cost_per_solved_task: labelOf("cost_per_solved_task"),
      pass_rate: labelOf("pass_rate"),
      pass_k: labelOf("pass_k"),
    },
    coverage: arms.map((arm) => {
      const es = executions.filter((e) => e.arm === arm);
      const excluded = allCells.filter((c) =>
        c.arm === arm && c.repeat > reported
      );
      const fields: Record<string, number> = {};
      for (const e of es) {
        for (const f of e.validity.incomplete_telemetry) {
          fields[f] = (fields[f] ?? 0) + 1;
        }
      }
      const assumed: Record<string, number> = {};
      for (const e of es) {
        const raw = e.telemetry.raw_usage;
        const list =
          raw !== null && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as { assumptions?: unknown }).assumptions
            : undefined;
        const keys = new Set(
          (Array.isArray(list) ? list : []).map((a) =>
            (a as { key?: unknown })?.key
          )
            .filter((k): k is string => typeof k === "string"),
        );
        for (const k of keys) assumed[k] = (assumed[k] ?? 0) + 1;
      }
      return {
        arm,
        executions: es.length,
        manual_reruns: es.filter((e) => e.run_kind === "manual_rerun").length,
        infra_exposed: es.filter((e) => e.validity.infra_exposed).length,
        // Sorted keys: JSON must not depend on execution order.
        incomplete_telemetry: Object.fromEntries(
          Object.entries(fields).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
        ),
        unverified_components: es
          .filter((e) => incompleteObserved(e).includes("loaded_components"))
          .map((e) => e.id).sort(),
        cost_assumptions: Object.fromEntries(
          Object.entries(assumed).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          ),
        ),
        trace: opts.traces ? traceCoverage(es, opts.traces) : null,
        excluded_cells: excluded.length,
        excluded_known_spend_usd: knownSpend(excluded),
        excluded_trace_invalid: invalidTraces.filter((w) =>
          excludedArm.get(w.execution) === arm
        ).length,
        campaign_raw_spend_usd: knownSpend(
          allCells.filter((c) => c.arm === arm),
        ),
      };
    }),
    trace_invalid: invalidTraces.filter((w) => !excludedArm.has(w.execution)),
    diffs,
    arms: summaries,
    comparisons,
    flips,
    efficiency: arms.map((a) =>
      efficiencyOf(cells, a, logs, attemptsOf, exp.primary_metric)
    ),
    slices,
    both_pass,
    ...(confirmatory ? { confirmatory } : {}),
    ...(exploratory_contrasts ? { exploratory_contrasts } : {}),
    ...(ready
      ? {
        preregistration: {
          path: pre.path,
          sha256: pre.sha256,
          protocol_sha256: pre.protocol_sha256,
          amendments: d.amendments,
        },
      }
      : {}),
    cells,
  };
}

const usd = (x: number | null) => (x === null ? "n/a" : `$${x.toFixed(3)}`);
const pct = (x: number | null) =>
  x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;
const reasons = (r: Record<string, number | undefined>) =>
  Object.entries(r).map(([k, v]) => `${k} ${v}`).join(", ") || "none";

const fmtOf = (c: Comparison) =>
  c.metric === "pass_rate"
    ? (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} pp`
    : (x: number) => `${x >= 0 ? "+" : "-"}$${Math.abs(x).toFixed(3)}`;

function fmtDelta(c: Comparison, verdicts = true): string {
  const f = fmtOf(c);
  if (c.pairs === 0) return "n/a (no matched pairs)";
  if (c.delta === null) return "n/a (no solved task in the matched pairs)";
  const cohort = `${c.pairs} matched pairs over ${c.tasks} tasks`;
  if (c.ci === null) {
    // Counts, not a rounded share: a tiny share must never read "0.0%".
    const none = Math.round(c.undefined_share * c.resamples);
    return `${
      f(c.delta)
    }, CI suppressed: ${none} of ${c.resamples} resamples had no solve (${cohort})`;
  }
  const interval = `${f(c.delta)} [${f(c.ci[0])}, ${f(c.ci[1])}]`;
  if (!verdicts) return `${interval} (${cohort})`;
  const verdict = c.distinguishable
    ? colors.green("distinguishable")
    : colors.yellow("not distinguishable");
  return `${interval} ${verdict} (${cohort})`;
}

export function renderReport(r: HarnessReport): string {
  const out: string[] = [];
  const tag = (m: ReportedMetric) =>
    r.metric_labels[m] === "primary" ? "" : colors.dim(" [exploratory]");
  const h = (s: string) => out.push("", colors.bold(s));
  out.push(colors.bold(`Harness report: ${r.experiment.id}`));
  const conf = r.confirmatory && !("withheld" in r.confirmatory)
    ? r.confirmatory
    : undefined;
  for (const a of r.preregistration?.amendments ?? []) {
    out.push(
      colors.yellow(
        `pre-registration amended after screening: ${a.key} ${
          JSON.stringify(a.from)
        } -> ${JSON.stringify(a.to)} (${a.reason}; ${a.approval})`,
      ),
    );
  }
  const part = partialText(r);
  out.push(r.partial === null ? part : colors.yellow(part));
  if (r.provisional) {
    out.push(colors.yellow("PROVISIONAL: cells are still pending or unrun"));
  }
  if (r.repeats.reported < r.repeats.planned) {
    const cells = r.coverage.reduce((s, c) => s + c.excluded_cells, 0);
    const spend = r.coverage.reduce(
      (s, c) => s + c.excluded_known_spend_usd,
      0,
    );
    const invalid = r.coverage.reduce(
      (s, c) => s + c.excluded_trace_invalid,
      0,
    );
    out.push(
      colors.yellow(
        `Repeats reported: ${r.repeats.reported} of ${r.repeats.planned}; excluded ${cells} cells, ${
          usd(spend)
        } spend${
          invalid > 0
            ? `, ${invalid} invalid trace${invalid === 1 ? "" : "s"}`
            : ""
        }`,
      ),
    );
  }
  out.push(`Hypothesis: ${r.experiment.hypothesis}`);
  out.push(`Primary metric: ${r.experiment.primary_metric}`);
  out.push(
    `Campaign ${r.campaign.id} (${r.campaign.created_at}), task set ${
      r.campaign.task_set_identity.slice(0, 12)
    }, ${r.campaign.tasks} tasks`,
  );
  out.push(
    `Judged with ${r.judging.source} oracles (${
      r.judging.identity.slice(0, 12)
    })${
      r.judging.tasks_with_other_oracle.length > 0
        ? `, changed for ${r.judging.tasks_with_other_oracle.join(", ")}`
        : ""
    }`,
  );
  for (const d of r.diffs) {
    out.push(
      `Diff ${r.experiment.baseline} -> ${d.variant}: ${
        d.differing.join(", ") || "none"
      }`,
    );
  }
  h("Coverage");
  for (const a of r.arms) {
    const c = r.coverage.find((x) => x.arm === a.arm)!;
    out.push(
      `  ${a.arm}: planned ${a.planned_cells}, attempted ${a.attempted_cells}, scored ${a.scored_cells}, unscored ${a.unscored_cells}, pending ${a.pending_cells}, unrun ${a.unrun_cells}; ${c.executions} executions (${c.manual_reruns} manual reruns), infra exposed ${c.infra_exposed}, incomplete telemetry: ${
        reasons(c.incomplete_telemetry)
      }, cost assumptions: ${reasons(c.cost_assumptions)}`,
    );
    if (c.trace !== null) {
      const t = c.trace;
      const extra = [
        ...(t.invalid > 0 ? [`${t.invalid} invalid`] : []),
        ...(t.executions - t.with_trace - t.invalid > 0
          ? [`${t.executions - t.with_trace - t.invalid} without a trace`]
          : []),
      ];
      out.push(
        `    calls rule-classified ${t.rule_classified}/${t.tool_calls}, unclassified ${t.unclassified}${
          t.unreplayable > 0 ? ` (${t.unreplayable} unreplayable)` : ""
        } (${t.rules}); traces complete ${t.complete}/${t.executions}${
          extra.length > 0 ? `, ${extra.join(", ")}` : ""
        }`,
      );
    }
    if (c.unverified_components.length > 0) {
      out.push(
        `    unverified components: ${c.unverified_components.join(", ")}`,
      );
    }
  }
  for (const w of r.trace_invalid) {
    out.push(
      colors.yellow(`  [WARN] invalid trace for ${w.execution}: ${w.error}`),
    );
  }
  h("Primary");
  for (const a of r.arms) {
    const cost = `cost per solved task ${usd(a.cost_per_solved_task)}${
      tag("cost_per_solved_task")
    }`;
    const rate = `pass rate ${pct(a.pass_rate)}${tag("pass_rate")}`;
    // The declared primary metric leads.
    const lead = r.experiment.primary_metric === "pass_rate"
      ? `${rate}, ${cost}`
      : `${cost}, ${rate}`;
    out.push(
      `  ${a.arm}: ${lead}; spend ${
        usd(a.total_spend_usd)
      } raw; headline over terminal cells, next to it: ${a.pending_cells} pending cells with ${
        usd(a.pending_spend_usd)
      } known spend; ${a.unknown_spend_cells} cells with an attempt of unknown cost`,
    );
  }
  for (const c of r.comparisons) {
    const label = c.label === "primary" ? "" : colors.dim(" [exploratory]");
    out.push(
      `  ${c.variant} vs ${c.baseline}, ${c.metric}: ${
        fmtDelta(c, r.preregistration === undefined)
      }${label}`,
    );
    // M6-02d: only beside a suppressed CI (otherwise it equals the CI).
    const note = exploratoryNote(c, fmtOf(c));
    if (note !== null) out.push(colors.dim(`    ${note}`));
    out.push(
      `    scorer ${c.scorer_fingerprint?.slice(0, 12) ?? "n/a"}`,
    );
    out.push(
      `    excluded: ${c.baseline} ${
        reasons(c.excluded.baseline)
      }; ${c.variant} ${reasons(c.excluded.variant)}`,
    );
  }
  if (r.confirmatory && "withheld" in r.confirmatory) {
    h(`Confirmatory analysis withheld: ${r.confirmatory.withheld}`);
  }
  const k = conf ?? r.exploratory_contrasts;
  if (k) {
    const ids = `pre-registered ${
      k.preregistration.sha256.slice(0, 12)
    }, protocol ${k.preregistration.protocol_sha256.slice(0, 12)}`;
    const sample =
      `${k.bootstrap.resamples} resamples, seed ${k.bootstrap.seed}, ${k.tasks.length} selected tasks`;
    const bonferroni = +((1 - k.alpha / k.family.length) * 100).toFixed(1);
    if (conf) {
      h(`Confirmatory contrasts (${ids}, Holm at ${k.alpha}, ${sample})`);
      out.push(
        `  Holm is the only decision rule (family ${
          k.family.join(", ")
        }); the intervals are descriptive and can disagree with it at the boundary.`,
      );
    } else {
      h(
        `Exploratory contrasts (${ids}, amended to exploratory: no decision rule applied, ${sample})`,
      );
      out.push("  The intervals are descriptive; no decision is made.");
    }
    for (const c of k.results) {
      const f = fmtOf(c);
      const ci = c.ci === null
        ? `CI suppressed (${
          Math.round(c.undefined_share * c.resamples)
        } of ${c.resamples} resamples undefined)`
        : `${+(c.level * 100).toFixed(1)}% CI [${f(c.ci[0])}, ${
          f(c.ci[1])
        }] (unadjusted)`;
      const tail = c.confirmatory
        ? `p ${c.p_value?.toFixed(4) ?? "n/a"}, Holm p ${
          c.p_holm?.toFixed(4) ?? "n/a"
        } -> ${c.decision.replace("_", " ")}; Bonferroni interval ${
          c.bonferroni_ci
            ? `[${f(c.bonferroni_ci[0])}, ${
              f(c.bonferroni_ci[1])
            }] at level ${bonferroni}%`
            : "n/a"
        }`
        : colors.dim(
          conf
            ? "[exploratory] outside the Holm family"
            : "[exploratory] no decision rule applied",
        );
      out.push(
        `  ${c.id} ${c.name}: ${c.variant} vs ${c.baseline} over ${c.tasks} of ${k.tasks.length} selected tasks: ${
          c.delta === null ? "n/a" : f(c.delta)
        }, ${ci}; ${tail}`,
      );
    }
    h(
      `Held-out tasks (descriptive robustness check, not in C1-C3): ${
        k.held_out.tasks.join(", ")
      }`,
    );
    for (const a of k.held_out.arms) {
      out.push(
        `  ${a.arm}: cost per solved task ${
          usd(a.cost_per_solved_task)
        }, pass rate ${pct(a.pass_rate)} over ${a.scored_cells} scored cells`,
      );
    }
  }
  h("Outcome");
  for (const a of r.arms) {
    out.push(
      `  ${a.arm}: pass rate ${pct(a.pass_rate)}${tag("pass_rate")}, pass^k ${
        pct(a.pass_k)
      }${tag("pass_k")} over ${a.pass_k_tasks} tasks`,
    );
  }
  if (r.flips.length > 0) {
    out.push(`  Flips (per-task pass rate)${tag("pass_rate")}:`);
    for (const f of r.flips) {
      out.push(
        `    ${f.task} (${f.kind}): ${
          Object.entries(f.pass_rate).map(([a, v]) => `${a} ${pct(v)}`).join(
            ", ",
          )
        }`,
      );
    }
  }
  // Rule 3: for every cell with a manual rerun, say which execution counted.
  const manual = r.cells.filter((c) => c.manual_reruns > 0);
  if (manual.length > 0) {
    out.push("  Cells with manual reruns:");
    for (const c of manual) {
      out.push(
        `    ${c.task} r${c.repeat} ${c.arm}: ${c.manual_reruns} manual rerun${
          c.manual_reruns === 1 ? "" : "s"
        }, used ${c.used_kind ?? "no"} execution ${c.used_execution ?? "n/a"}`,
      );
    }
  }
  // C-03 run 002: every forced judgment of a cell, counted or not.
  const forced = r.cells.flatMap((c) =>
    (c.forced_rejudges ?? []).map((f) => ({ c, f }))
  );
  if (forced.length > 0) {
    out.push("  Forced rejudges (every one, counted or not):");
    for (const { c, f } of forced) {
      const basis =
        `decision ${f.basis.path} (sha256 ${f.basis.sha256}; ${f.basis.approval})`;
      out.push(
        `    ${c.task} r${c.repeat} ${c.arm}: judgment ${f.judgment_id} (${
          f.judgment_id === c.judgment_id ? "counted" : "not counted"
        }) replaces ${f.replaces}, basis ${basis}: ${f.reason}`,
      );
    }
  }
  // Run 003: cells above the cut are not in r.cells, nor their forced judgments.
  if (r.repeats.reported < r.repeats.planned) {
    out.push(
      `  Forced rejudges in repeats above ${r.repeats.reported}, if any, are not listed.`,
    );
  }
  const ms = (x: number | null) => (x === null ? "n/a" : `${Math.round(x)} ms`);
  h("Efficiency (descriptive)");
  for (const e of r.efficiency) {
    out.push(
      `  ${e.arm}: ${e.backend_requests} backend requests, ${e.logical_builds} builds (${e.per_app_compiles} per-app compiles, ${
        e.diagnostics_per_build === null
          ? "n/a"
          : e.diagnostics_per_build.toFixed(1)
      } diagnostics/build), ${e.test_runs} test runs; verdict median ${
        ms(e.verdict_ms_median)
      } (queue ${ms(e.verdict_queue_ms_median)}); backend queue median ${
        ms(e.backend_queue_ms_median)
      }; host logs ${e.host_logs}`,
    );
  }
  h("Slices (descriptive)");
  for (const s of r.slices) {
    out.push(
      `  ${s.by} ${s.value} (${s.tasks} tasks): ${
        Object.entries(s.pass_rate).map(([a, v]) => `${a} ${pct(v)}`).join(", ")
      }`,
    );
  }
  for (const b of r.both_pass) {
    out.push(
      `  ${b.baseline} vs ${b.variant} over ${b.pairs} matched scored pairs: both pass ${b.both_pass}, ${b.baseline} only ${b.baseline_only}, ${b.variant} only ${b.variant_only}, neither ${b.neither}`,
    );
  }
  return out.join("\n");
}
