/**
 * Harness report skeleton (spec 1a section 9): header, primary, outcome.
 * Efficiency and slices come in Part 2 with telemetry and traces.
 *
 * The report runs only on records that pass validateCampaignRecords, states
 * the judging context (which oracle per task), shows planned / attempted /
 * scored counts, raw and pending spend, the matched-pair cohort with
 * exclusion reasons, and which execution and judgment every cell used.
 */

import * as colors from "@std/fmt/colors";
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
import type { JudgmentRecord } from "./records.ts";
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
}

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
  coverage: ArmCoverage[];
  diffs: Array<{ variant: string; differing: ManifestKey[] }>;
  arms: ArmSummary[];
  /**
   * The declared primary metric first, the other one exploratory. Each
   * comparison names the one scorer fingerprint all its scored cells share.
   */
  comparisons: Array<
    Comparison & { primary: boolean; scorer_fingerprint: string | null }
  >;
  flips: Array<{
    task: string;
    kind: string;
    coupling: string[];
    pass_rate: Record<string, number | null>;
  }>;
  cells: CellRecord[];
}

export interface ReportOptions extends BootstrapOptions {
  judging?: JudgingContext;
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
      };
    }),
    diffs,
    arms: summaries,
    comparisons,
    flips,
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
  }
  h("Primary");
  for (const a of r.arms) {
    out.push(
      `  ${a.arm}: cost per solved task ${
        usd(a.cost_per_solved_task)
      }, pass rate ${pct(a.pass_rate)}; spend ${
        usd(a.total_spend_usd)
      } raw; headline over terminal cells, next to it: ${a.pending_cells} pending cells with ${
        usd(a.pending_spend_usd)
      } known spend; ${a.unknown_spend_cells} cells with an attempt of unknown cost`,
    );
  }
  for (const c of r.comparisons) {
    const label = c.primary ? "" : colors.dim(" [exploratory]");
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
      `  ${a.arm}: pass rate ${pct(a.pass_rate)}, pass^k ${
        pct(a.pass_k)
      } over ${a.pass_k_tasks} tasks`,
    );
  }
  if (r.flips.length > 0) {
    out.push("  Flips (per-task pass rate):");
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
  return out.join("\n");
}
