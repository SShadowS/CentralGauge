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
import { incompleteObserved, type JudgmentRecord } from "./records.ts";
import {
  type ArmSummary,
  armSummary,
  type BootstrapOptions,
  checkBootstrapOptions,
  compareArms,
  type Comparison,
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
   * Label of every metric the report shows, from the experiment's declared
   * primary metric; pass^k is never primary. Applies to `arms`, `flips`
   * (per-task pass rate) and, per row, `comparisons[].label`.
   */
  metric_labels: Record<ReportedMetric, MetricLabel>;
  coverage: ArmCoverage[];
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
  /** Per arm, over the executions the cells use (descriptive). */
  efficiency: ArmEfficiency[];
  /** Pass rate per arm by task kind, then by coupling tag (descriptive). */
  slices: Slice[];
  /** Per variant: matched scored pairs against the baseline (descriptive, no winner). */
  both_pass: BothPass[];
  cells: CellRecord[];
}

export interface ArmEfficiency {
  arm: string;
  /** Used executions whose host log was found. */
  host_logs: number;
  backend_requests: number;
  /** Compile requests the backend accepted (not rejected). */
  logical_builds: number;
  per_app_compiles: number;
  /** Test requests the backend accepted. */
  test_runs: number;
  diagnostics_per_build: number | null;
  verdict_ms_median: number | null;
  verdict_queue_ms_median: number | null;
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
}

export interface ReportOptions extends BootstrapOptions {
  judging?: JudgingContext;
  logs?: ReportLogs;
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
): ArmEfficiency {
  const mine = cells.filter((c) => c.arm === arm);
  const lines = mine.flatMap((c) =>
    c.used_execution ? [logs.host.get(c.used_execution)] : []
  ).filter((x): x is readonly HostLogLine[] => x !== undefined);
  const flat = lines.flat();
  const accepted = (op: string) =>
    flat.filter((l) => l.op === op && l.outcome !== "rejected");
  const builds = accepted("compile");
  const verdicts = mine.flatMap((c) =>
    c.judgment_id ? [logs.verdict.get(c.judgment_id)] : []
  ).filter((v): v is VerdictLog => v !== undefined);
  return {
    arm,
    host_logs: lines.length,
    backend_requests: flat.length,
    logical_builds: builds.length,
    per_app_compiles: flat.reduce((n, l) => n + l.per_app_compiles, 0),
    test_runs: accepted("test").length,
    diagnostics_per_build: builds.length === 0
      ? null
      : builds.reduce((n, l) => n + l.diagnostics, 0) / builds.length,
    verdict_ms_median: median(verdicts.map((v) => v.spans.total_ms)),
    verdict_queue_ms_median: median(verdicts.map((v) => v.spans.queue_ms)),
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

export async function buildReport(
  records: CampaignRecords,
  opts: ReportOptions = {},
): Promise<HarnessReport> {
  await validateCampaignRecords(records);
  const { campaign, executions } = records;
  const exp = campaign.experiment;
  const arms = [exp.baseline, ...exp.variants];
  const judging = opts.judging ?? campaignJudging(campaign);
  checkJudging(campaign, judging);
  const byExecution = new Map<string, JudgmentRecord[]>();
  for (const j of records.judgments) {
    byExecution.set(j.execution_id, [
      ...(byExecution.get(j.execution_id) ?? []),
      j,
    ]);
  }
  const cells = cellsFromRecords(campaign, executions, byExecution, judging);
  // Refuse before any number: bad bootstrap options, mixed scorers.
  checkBootstrapOptions(opts);
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
  const labelOf = (m: ReportedMetric): MetricLabel =>
    m === exp.primary_metric ? "primary" : "exploratory";
  const metrics: PrimaryMetric[] = exp.primary_metric === "pass_rate"
    ? ["pass_rate", "cost_per_solved_task"]
    : ["cost_per_solved_task", "pass_rate"];
  const bootstrap = {
    ...(opts.resamples !== undefined ? { resamples: opts.resamples } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    ...(opts.level !== undefined ? { level: opts.level } : {}),
  };
  const comparisons = exp.variants.flatMap((variant) => {
    return metrics.map((metric) => ({
      ...compareArms(cells, exp.baseline, variant, metric, bootstrap),
      primary: metric === exp.primary_metric,
      label: labelOf(metric),
      scorer_fingerprint: fingerprint,
    }));
  });
  const summaries = arms.map((arm) => armSummary(cells, arm, exp.repeats));
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
  const sliceRate = (tasks: string[], arm: string) => {
    const ps = tasks.flatMap((t) => scored(t, arm));
    return ps.length === 0 ? null : ps.filter((c) => c.pass).length / ps.length;
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
    provisional: summaries.some((s) => s.provisional),
    metric_labels: {
      cost_per_solved_task: labelOf("cost_per_solved_task"),
      pass_rate: labelOf("pass_rate"),
      pass_k: labelOf("pass_k"),
    },
    coverage: arms.map((arm) => {
      const es = executions.filter((e) => e.arm === arm);
      const fields: Record<string, number> = {};
      for (const e of es) {
        for (const f of e.validity.incomplete_telemetry) {
          fields[f] = (fields[f] ?? 0) + 1;
        }
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
      };
    }),
    diffs,
    arms: summaries,
    comparisons,
    flips,
    efficiency: arms.map((a) => efficiencyOf(cells, a, logs)),
    slices,
    both_pass,
    cells,
  };
}

const usd = (x: number | null) => (x === null ? "n/a" : `$${x.toFixed(3)}`);
const pct = (x: number | null) =>
  x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;
const reasons = (r: Record<string, number | undefined>) =>
  Object.entries(r).map(([k, v]) => `${k} ${v}`).join(", ") || "none";

function fmtDelta(c: Comparison): string {
  const f = c.metric === "pass_rate"
    ? (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} pp`
    : (x: number) => `${x >= 0 ? "+" : "-"}$${Math.abs(x).toFixed(3)}`;
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
  const verdict = c.distinguishable
    ? colors.green("distinguishable")
    : colors.yellow("not distinguishable");
  return `${f(c.delta)} [${f(c.ci[0])}, ${f(c.ci[1])}] ${verdict} (${cohort})`;
}

export function renderReport(r: HarnessReport): string {
  const out: string[] = [];
  const tag = (m: ReportedMetric) =>
    r.metric_labels[m] === "primary" ? "" : colors.dim(" [exploratory]");
  const h = (s: string) => out.push("", colors.bold(s));
  out.push(colors.bold(`Harness report: ${r.experiment.id}`));
  if (r.provisional) {
    out.push(colors.yellow("PROVISIONAL: cells are still pending or unrun"));
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
      }`,
    );
    if (c.unverified_components.length > 0) {
      out.push(
        `    unverified components: ${c.unverified_components.join(", ")}`,
      );
    }
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
      `  ${c.variant} vs ${c.baseline}, ${c.metric}: ${fmtDelta(c)}${label}`,
    );
    out.push(
      `    scorer ${c.scorer_fingerprint?.slice(0, 12) ?? "n/a"}`,
    );
    out.push(
      `    excluded: ${c.baseline} ${
        reasons(c.excluded.baseline)
      }; ${c.variant} ${reasons(c.excluded.variant)}`,
    );
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
      } (queue ${ms(e.verdict_queue_ms_median)}); host logs ${e.host_logs}`,
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
