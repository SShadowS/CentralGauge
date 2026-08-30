/**
 * Results writing utilities for benchmark commands
 * @module cli/commands/bench/results-writer
 */

import * as colors from "@std/fmt/colors";
import type {
  InfraRetryExhaustionReason,
  TaskExecutionResult,
  TaskManifest,
} from "../../../src/tasks/interfaces.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import {
  computeOmissionStats,
  renderOmissionBlock,
} from "../../../src/stats/omission.ts";
import { loadResultFilesGrouped } from "../report/file-loader.ts";
import { groupResultsByModelAndTask } from "../report/run-detector.ts";
import { calculateMultiRunStats } from "../report/stats-calculator.ts";
import type {
  AggregateStats,
  TaskComparison,
} from "../../../src/parallel/mod.ts";
import {
  formatBenchmarkStats,
  formatModelSummaryTable,
  formatTaskMatrix,
  type FormatterInput,
  getFormatter,
  type OutputFormat,
  shouldCopyToClipboard,
  type TaskMatrixInput,
} from "../../../src/utils/formatters.ts";
import { formatSingleTaskMatrix } from "./single-task-matrix.ts";
import { copyToClipboard } from "../../../src/utils/clipboard.ts";
import { formatDurationMs, log } from "../../helpers/mod.ts";

/**
 * Fallback event recorded when an LLM attempt encounters a refusal or uses a fallback model
 */
export interface FallbackEvent {
  model: string;
  taskId: string;
  attempt: number;
  /** Bare API id of the model that served, null when the whole chain refused. */
  served: string | null;
  category: string | null;
  recovered: boolean;
}

/**
 * Hash information for run comparability
 */
export interface HashResult {
  hash: string;
  testAppManifestHash?: string;
  totalFilesHashed: number;
  computedAt: Date;
  tasks: Array<{
    taskId: string;
    combinedHash: string;
    testFiles: string[];
  }>;
}

/**
 * Collect fallback events from per-model results.
 * Records attempts where an LLM encountered a refusal or used a fallback model.
 */
export function collectFallbackEvents(
  perModel: ReadonlyArray<{
    model: string;
    results: ReadonlyArray<{
      taskId: string;
      attempts: ReadonlyArray<{
        attemptNumber: number;
        llmResponse?: {
          servedModel?: string;
          refusal?: { category: string | null; recovered: boolean };
        };
      }>;
    }>;
  }>,
): FallbackEvent[] {
  const events: FallbackEvent[] = [];
  for (const m of perModel) {
    for (const r of m.results) {
      for (const a of r.attempts) {
        const fb = a.llmResponse;
        if (fb?.refusal === undefined && fb?.servedModel === undefined) {
          continue;
        }
        events.push({
          model: m.model,
          taskId: r.taskId,
          attempt: a.attemptNumber,
          served: fb?.servedModel ?? null,
          category: fb?.refusal?.category ?? null,
          recovered: fb?.refusal?.recovered ?? true,
        });
      }
    }
  }
  return events;
}

/**
 * Render the `# Fallbacks` scores-file block for a set of fallback events.
 * Returns `[]` when there are none, so callers can conditional-emit with the
 * same `length > 0` gate used by `# Drain Events` / `# Recovery Events`.
 */
export function renderFallbackBlock(events: FallbackEvent[]): string[] {
  if (events.length === 0) return [];
  const recovered = events.filter((e) => e.recovered);
  const lines: string[] = [];
  lines.push(`# Fallbacks`);
  lines.push(`total_refusal_events: ${events.length}`);
  lines.push(`recovered_via_fallback: ${recovered.length}`);
  lines.push(`chain_refusals: ${events.length - recovered.length}`);
  lines.push(`by_event:`);
  for (const e of events) {
    const detail = e.recovered
      ? `served=${e.served}`
      : `REFUSED category=${e.category ?? "unknown"}`;
    lines.push(`  ${e.model} ${e.taskId} a${e.attempt}: ${detail}`);
  }
  return lines;
}

/**
 * Group a flat `TaskExecutionResult[]` by model into the shape
 * `collectFallbackEvents` expects. Shared by `saveResultsJson` (JSON
 * persistence) and `buildScoreLines` (`# Fallbacks` block) so there is one
 * grouping implementation, not two independently-derived ones.
 */
function groupResultsForFallback(
  results: TaskExecutionResult[],
): Array<{
  model: string;
  results: Array<{
    taskId: string;
    attempts: Array<{
      attemptNumber: number;
      llmResponse?: {
        servedModel?: string;
        refusal?: { category: string | null; recovered: boolean };
      };
    }>;
  }>;
}> {
  const perModelResults = new Map<
    string,
    Array<{
      taskId: string;
      attempts: Array<{
        attemptNumber: number;
        llmResponse?: {
          servedModel?: string;
          refusal?: { category: string | null; recovered: boolean };
        };
      }>;
    }>
  >();

  for (const r of results) {
    const model = r.context.variantId;
    if (!perModelResults.has(model)) {
      perModelResults.set(model, []);
    }
    perModelResults.get(model)!.push({
      taskId: r.taskId,
      attempts: r.attempts.map((a) => {
        const attempt: {
          attemptNumber: number;
          llmResponse?: {
            servedModel?: string;
            refusal?: { category: string | null; recovered: boolean };
          };
        } = {
          attemptNumber: a.attemptNumber,
        };
        if (
          a.llmResponse?.servedModel !== undefined ||
          a.llmResponse?.refusal !== undefined
        ) {
          attempt.llmResponse = {};
          if (a.llmResponse?.servedModel !== undefined) {
            attempt.llmResponse.servedModel = a.llmResponse.servedModel;
          }
          if (a.llmResponse?.refusal !== undefined) {
            attempt.llmResponse.refusal = a.llmResponse.refusal;
          }
        }
        return attempt;
      }),
    });
  }

  return Array.from(perModelResults).map(([model, results]) => ({
    model,
    results,
  }));
}

/**
 * Save benchmark results to JSON file
 */
export async function saveResultsJson(
  resultsFile: string,
  results: TaskExecutionResult[],
  stats: AggregateStats,
  comparisons: TaskComparison[],
  hashResult: HashResult,
  drainEvents?:
    import("../../../src/parallel/compile-queue-pool.ts").RebalanceOutcome[],
  recoveryEvents?:
    import("../../../src/health/recovery-prober.ts").RecoveryEvent[],
  ingestMeta?: import("./ingest-meta.ts").IngestMeta,
): Promise<void> {
  const fallbackEvents = collectFallbackEvents(
    groupResultsForFallback(results),
  );

  await Deno.writeTextFile(
    resultsFile,
    JSON.stringify(
      {
        results,
        // Persisted run identity (T3): one run UUID per variant, minted at
        // save time. Immediate ingest AND `centralgauge ingest <path>`
        // replay both read this key so replays reuse the same run_id
        // (server idempotency) and the original pricing_version.
        ...(ingestMeta !== undefined ? { ingest: ingestMeta } : {}),
        stats: {
          totalTokens: stats.totalTokens,
          totalCost: stats.totalCost,
          totalDuration: stats.totalDuration,
          overallPassRate: stats.overallPassRate,
          averageScore: stats.averageScore,
          perModel: Object.fromEntries(stats.perModel),
          perTask: Object.fromEntries(stats.perTask),
        },
        comparisons,
        // Comprehensive hash info for run comparability
        hashInfo: {
          taskSetHash: hashResult.hash,
          testAppManifestHash: hashResult.testAppManifestHash,
          totalFilesHashed: hashResult.totalFilesHashed,
          computedAt: hashResult.computedAt.toISOString(),
          taskHashes: hashResult.tasks.map((t) => ({
            id: t.taskId,
            combined: t.combinedHash,
            fileCount: t.testFiles.length + 1,
          })),
        },
        // Alert-driven drain events (task #8). Top-level so analyzers can
        // detect runs affected by container alerts without walking attempts.
        // Optional field — omitted from runs with zero drain activity.
        ...(drainEvents !== undefined && drainEvents.length > 0
          ? { drainEvents }
          : {}),
        // Recovery prober events (re-probe / restart / re-admit). Top-level,
        // optional — omitted when recovery is disabled or never fired.
        ...(recoveryEvents !== undefined && recoveryEvents.length > 0
          ? { recoveryEvents }
          : {}),
        // Fallback events (task #2). Top-level so analyzers can detect runs
        // with refusals or fallback model usage without walking attempts.
        // Optional field — omitted from runs with zero fallback activity.
        ...(fallbackEvents.length > 0 ? { fallbackEvents } : {}),
      },
      null,
      2,
    ),
  );
}

/**
 * Input for building score lines
 */
export interface ScoreLineInput {
  stats: AggregateStats;
  taskCount: number;
  modelNames: string[];
  attempts: number;
  resultCount: number;
  timestamp?: Date;
  /**
   * Optional container-health snapshot from the dashboard state. When present,
   * appends a `# Container Health` block to the scores file. Lets reviewers
   * spot infra-flaked containers without opening the dashboard.
   */
  containerHealth?: import("../../../src/health/types.ts").ContainerHealthState;
  /**
   * Optional full result set. When provided AND at least one attempt carries
   * inline infra-retry metadata (trail or exhaustion flag), appends a
   * `# Infra Retries` block — recovered vs exhausted counts, exhaustion-reason
   * sub-totals, and per-route trail. Omitted entirely when nothing is flagged
   * to keep the score file clean for normal runs.
   */
  results?: TaskExecutionResult[];
  /**
   * Optional list of alert-driven drain events emitted by the orchestrator
   * during this run (see `CompileQueuePool.getRebalanceLog()`). When at
   * least one event is supplied, appends a `# Drain Events` block to the
   * scores file. Omitted entirely on runs where no container alert ever
   * tripped the drain path.
   */
  drainEvents?:
    import("../../../src/parallel/compile-queue-pool.ts").RebalanceOutcome[];
  /**
   * Optional recovery-prober events emitted this run (see
   * `ParallelBenchmarkOrchestrator.getRecoveryEvents()`). When at least one is
   * supplied, appends a `# Recovery Events` block. Omitted entirely when
   * recovery is disabled or never fired.
   */
  recoveryEvents?:
    import("../../../src/health/recovery-prober.ts").RecoveryEvent[];
}

/**
 * Aggregated infra-retry counters built from a result set. Returned by
 * {@link buildRetryRow} so we can keep the walk-attempts loop separate from
 * the formatting logic in `buildScoreLines`.
 */
interface RetryRow {
  flagged: number;
  recovered: number;
  exhausted: number;
  /** Sub-totals keyed by exhaustion reason. */
  reasons: Partial<Record<InfraRetryExhaustionReason, number>>;
  /** Pre-formatted `by_route:` lines, one per flagged attempt. */
  routes: string[];
}

/**
 * Walk every attempt in `results` and aggregate inline infra-retry metadata
 * into a {@link RetryRow}. Returns `null` when no attempt carries either a
 * retry trail or an exhaustion flag — the caller uses this to skip emitting
 * the `# Infra Retries` block entirely on clean runs.
 *
 * An attempt is "flagged" when EITHER:
 * - `infraRetries` has 1+ entries (a retry actually executed), OR
 * - `infraRetryExhausted === true` (zero-retry exhaustion path: no eligible
 *   containers, global outage, or unknown failed container).
 *
 * The trailing record is mined for the `by_route:` row. When the attempt is
 * exhausted-with-trail, the target is rendered as `(no eligible container)`
 * per the operator-facing summary spec, because the retry that did run still
 * infra-failed — naming a specific target would be misleading. Zero-retry
 * exhaustions emit a dedicated `(zero-retry exhaustion: <reason>)` line
 * since they have no trail to mine.
 */
function buildRetryRow(results: TaskExecutionResult[]): RetryRow | null {
  const row: RetryRow = {
    flagged: 0,
    recovered: 0,
    exhausted: 0,
    reasons: {},
    routes: [],
  };
  for (const r of results) {
    for (const a of r.attempts) {
      const hasTrail = (a.infraRetries?.length ?? 0) > 0;
      const isExhausted = a.infraRetryExhausted === true;
      if (!hasTrail && !isExhausted) continue;

      row.flagged++;
      if (isExhausted) {
        row.exhausted++;
        const reason: InfraRetryExhaustionReason =
          a.infraRetryExhaustionReason ?? "budget_exhausted";
        row.reasons[reason] = (row.reasons[reason] ?? 0) + 1;
      } else {
        row.recovered++;
      }

      const trail = a.infraRetries;
      const last = trail && trail.length > 0
        ? trail[trail.length - 1]
        : undefined;
      if (last) {
        const target = isExhausted
          ? "(no eligible container)"
          : last.retryContainerName;
        row.routes.push(
          `${last.originalContainerName} → ${target}: ${
            isExhausted ? "exhausted" : "recovered"
          } (${last.durationMs}ms)`,
        );
      } else if (isExhausted) {
        const reason: InfraRetryExhaustionReason =
          a.infraRetryExhaustionReason ?? "budget_exhausted";
        row.routes.push(`(zero-retry exhaustion: ${reason})`);
      }
    }
  }
  return row.flagged === 0 ? null : row;
}

/**
 * Build score file content as an array of lines (pure function).
 * Separated from file I/O for testability.
 */
export function buildScoreLines(input: ScoreLineInput): string[] {
  const { stats, taskCount, modelNames, attempts, resultCount } = input;
  const timestamp = input.timestamp ?? new Date();

  const lines: string[] = [
    `# CentralGauge Benchmark Scores`,
    `# ${timestamp.toISOString()}`,
    ``,
    `tasks: ${taskCount}`,
    `models: ${modelNames.join(", ")}`,
    `attempts: ${attempts}`,
    ``,
    `# Aggregate Stats`,
    `pass_rate_1: ${(stats.passRate1 * 100).toFixed(1)}%`,
    `pass_rate_2: ${(stats.passRate2 * 100).toFixed(1)}%`,
    `pass_num_1: ${stats.passNum1}/${resultCount}`,
    `pass_num_2: ${stats.passNum2}/${resultCount}`,
    `compile_errors: ${stats.totalCompileErrors}`,
    `test_failures: ${stats.totalTestFailures}`,
    `malformed: ${stats.totalMalformed}`,
    `avg_score: ${stats.averageScore.toFixed(1)}`,
    `avg_attempts: ${
      stats.perModel.size > 0
        ? (Array.from(stats.perModel.values()).reduce(
          (sum, m) => sum + m.avgAttempts,
          0,
        ) / stats.perModel.size).toFixed(2)
        : "0.00"
    }`,
    `seconds_per_task: ${stats.secondsPerTask.toFixed(1)}`,
    `prompt_tokens: ${stats.promptTokens}`,
    `completion_tokens: ${stats.completionTokens}`,
    `total_cost: $${stats.totalCost.toFixed(4)}`,
    ``,
    `# Timing Breakdown`,
    `llm_time_ms: ${stats.totalLLMDuration}`,
    `compile_time_ms: ${stats.totalCompileDuration}`,
    `test_time_ms: ${stats.totalTestDuration}`,
    `total_time_ms: ${stats.totalDuration}`,
    ``,
    `# Per-Model Scores`,
  ];

  for (const [model, modelStats] of stats.perModel) {
    const total = modelStats.tasksPassed + modelStats.tasksFailed;
    const pr1 = total > 0
      ? (modelStats.passedOnAttempt1 / total * 100).toFixed(1)
      : "0.0";
    const pr2 = total > 0
      ? (modelStats.passedOnAttempt2 / total * 100).toFixed(1)
      : "0.0";
    lines.push(
      `${model}: pr1=${pr1}% pr2=${pr2}% score=${
        modelStats.avgScore.toFixed(1)
      } cost=$${modelStats.cost.toFixed(4)}`,
    );
  }

  if (input.containerHealth && input.containerHealth.containers.length > 0) {
    lines.push(``);
    lines.push(`# Container Health`);
    for (const c of input.containerHealth.containers) {
      const flag = c.alert
        ? `   [!] ${
          c.alert.signatureLabel ?? c.alert.fingerprint
        } (${c.alert.kind})`
        : "";
      lines.push(
        `${c.containerName}: pass=${c.passCount} fail=${c.failCount} err=${c.errorCount}${flag}`,
      );
    }
  }
  // CLI3: infra_invalidated must be visible regardless of whether a
  // container-health snapshot was available (e.g. --no-dashboard runs
  // before the monitor-state fallback was wired up, or a snapshot with zero
  // tracked containers). It was previously nested inside the
  // containerHealth-present branch above and vanished along with it.
  if (stats.infraInvalidated > 0) {
    lines.push(``);
    lines.push(
      `infra_invalidated: ${stats.infraInvalidated}/${input.resultCount}` +
        ` (valid_attempts=${stats.validAttempts})`,
    );
  }

  // # Infra Retries block — operator-facing summary of inline infra-retry
  // activity. Placed adjacent to # Container Health so reviewers can compare
  // pool-level signal (sticky alerts) against per-attempt retry routing in
  // one scan. Emitted only when buildRetryRow finds at least one flagged
  // attempt, so normal runs stay clean.
  if (input.results && input.results.length > 0) {
    const row = buildRetryRow(input.results);
    if (row) {
      lines.push(``);
      lines.push(`# Infra Retries`);
      lines.push(`flagged: ${row.flagged}`);
      lines.push(`recovered: ${row.recovered}`);
      lines.push(`exhausted: ${row.exhausted}`);
      // Sub-counts indented under `exhausted:` per spec. Iterate in declared
      // enum order so the block is stable across runs with the same shape.
      const reasonOrder: InfraRetryExhaustionReason[] = [
        "budget_exhausted",
        "no_eligible_containers",
        "global_outage",
        "unknown_failed_container",
      ];
      for (const reason of reasonOrder) {
        const count = row.reasons[reason];
        if (count !== undefined && count > 0) {
          lines.push(`  ${reason}: ${count}`);
        }
      }
      lines.push(`by_route:`);
      for (const route of row.routes) {
        lines.push(`  ${route}`);
      }
    }
  }

  // # Publish Defects block — model-attributable candidate publish/install
  // defects. Detection: any attempt whose testResult.output starts with
  // "PUBLISH_DEFECT_CLASS:model" (canonical marker set by
  // makePublishFailureTestResult in bc-container-provider.ts). Infra-caused
  // publish failures use a different code path and are NOT marked with that
  // prefix, so this count is strictly model-attributed. Emitted only when
  // count > 0 so normal runs stay clean.
  if (input.results && input.results.length > 0) {
    let publishDefectCount = 0;
    for (const r of input.results) {
      for (const a of r.attempts) {
        if (
          a.testResult?.output?.startsWith("PUBLISH_DEFECT_CLASS:model")
        ) {
          publishDefectCount++;
        }
      }
    }
    if (publishDefectCount > 0) {
      lines.push(``);
      lines.push(`# Publish Defects`);
      lines.push(`candidate_publish_model_defects: ${publishDefectCount}`);
    }
  }

  // # Drain Events block — alert-driven drain + rebalance activity (task #8).
  // Emitted only when at least one drain fired during this run, so normal
  // runs stay clean. Each event records: alertId, container, fingerprint,
  // pending drained, requeued, parked, and target distribution.
  if (input.drainEvents && input.drainEvents.length > 0) {
    lines.push(``);
    lines.push(`# Drain Events`);
    lines.push(`total_drains: ${input.drainEvents.length}`);
    const totalDrained = input.drainEvents.reduce((s, e) => s + e.drained, 0);
    const totalRequeued = input.drainEvents.reduce((s, e) => s + e.requeued, 0);
    const totalParked = input.drainEvents.reduce((s, e) => s + e.parked, 0);
    lines.push(`total_pending_drained: ${totalDrained}`);
    lines.push(`total_requeued: ${totalRequeued}`);
    lines.push(`total_parked: ${totalParked}`);
    lines.push(`by_event:`);
    for (const ev of input.drainEvents) {
      const targets = Object.entries(ev.targetDistribution)
        .map(([c, n]) => `${c}=${n}`)
        .join(",") || "(none)";
      const fp = ev.fingerprint ?? "(none)";
      lines.push(
        `  ${ev.alertId} ${ev.containerName} fp=${fp}: ` +
          `drained=${ev.drained} requeued=${ev.requeued} parked=${ev.parked} ` +
          `targets=[${targets}]`,
      );
    }
  }

  // # Fallbacks block — server-side refusal / fallback-model activity
  // (refusal-fallback recording plan, task #3). Derived from `input.results`
  // via the same `collectFallbackEvents` used by `saveResultsJson`'s JSON
  // `fallbackEvents` field, so the two never drift. Emitted only when at
  // least one refusal or fallback-served attempt occurred this run.
  if (input.results && input.results.length > 0) {
    const fallbackEvents = collectFallbackEvents(
      groupResultsForFallback(input.results),
    );
    const fallbackLines = renderFallbackBlock(fallbackEvents);
    if (fallbackLines.length > 0) {
      lines.push(``);
      lines.push(...fallbackLines);
    }
  }

  // # Omission block — attempts that dropped an AL object or field while
  // re-emitting the whole application under `diagnose.md` rule 2. Reported
  // rather than forgiven: on the seven-model panel of 2026-08-30 this was 37%
  // of all failures, so a pass rate quoted without it conflates transcription
  // fidelity with diagnostic ability. Precedents for publishing both numbers
  // are IFEval (strict AND loose accuracy) and Aider
  // (`percent_cases_well_formed` beside the pass rate).
  if (input.results && input.results.length > 0) {
    const omissionLines = renderOmissionBlock(
      computeOmissionStats(input.results.map((r) => ({
        success: r.success,
        providerFailure: (r.attempts ?? []).length === 0 ||
          (r.attempts ?? []).every((a) =>
            ((a.llmResponse?.usage?.completionTokens ?? 0) === 0) &&
            !a.llmResponse?.content
          ),
        attempts: (r.attempts ?? []).map((a) => ({
          compilationResult: a.compilationResult,
          failedAssertions: a.compilationResult?.success === true &&
            a.testResult !== undefined && !a.testResult.success,
        })),
      }))),
    );
    if (omissionLines.length > 0) {
      lines.push(``);
      lines.push(...omissionLines);
    }
  }

  // # Recovery Events block — recovery-prober activity. Emitted only when the
  // prober produced at least one event this run. Surfaces both successes
  // (recovered) and the operationally-important failure/skip paths.
  if (input.recoveryEvents && input.recoveryEvents.length > 0) {
    const evs = input.recoveryEvents;
    const count = (t: string) => evs.filter((e) => e.type === t).length;
    lines.push(``);
    lines.push(`# Recovery Events`);
    lines.push(`total_events: ${evs.length}`);
    lines.push(`recovered: ${count("recovered")}`);
    lines.push(`restarts_succeeded: ${count("restart_succeeded")}`);
    lines.push(`restarts_failed: ${count("restart_failed")}`);
    lines.push(`flap_caps_reached: ${count("flap_cap_reached")}`);
    lines.push(
      `restart_required_but_disabled: ${
        count("restart_required_but_disabled")
      }`,
    );
    lines.push(`probe_timeouts: ${count("probe_timeout")}`);
    // Per-container terminal disposition: recovered vs still-excluded.
    const recoveredBy = new Set(
      evs.filter((e) => e.type === "recovered").map((e) => e.containerName),
    );
    const flapped = new Set(
      evs.filter((e) => e.type === "flap_cap_reached").map((e) =>
        e.containerName
      ),
    );
    lines.push(
      `recovered_containers: [${[...recoveredBy].join(",") || "none"}]`,
    );
    lines.push(`flap_capped_containers: [${[...flapped].join(",") || "none"}]`);
  }

  return lines;
}

/**
 * Save score file in human-readable format.
 *
 * `results` is optional for backward compatibility, but production callers
 * should pass it so the `# Infra Retries` block can be emitted when inline
 * retries fired. Omitting it just suppresses that block.
 */
export async function saveScoresFile(
  scoreFile: string,
  stats: AggregateStats,
  taskManifests: TaskManifest[],
  variants: ModelVariant[],
  attempts: number,
  resultCount: number,
  containerHealth?: import("../../../src/health/types.ts").ContainerHealthState,
  results?: TaskExecutionResult[],
  drainEvents?:
    import("../../../src/parallel/compile-queue-pool.ts").RebalanceOutcome[],
  recoveryEvents?:
    import("../../../src/health/recovery-prober.ts").RecoveryEvent[],
): Promise<void> {
  const scoreLines = buildScoreLines({
    stats,
    taskCount: taskManifests.length,
    modelNames: variants.map((v) => v.model),
    attempts,
    resultCount,
    ...(containerHealth !== undefined ? { containerHealth } : {}),
    ...(results !== undefined ? { results } : {}),
    ...(drainEvents !== undefined && drainEvents.length > 0
      ? { drainEvents }
      : {}),
    ...(recoveryEvents !== undefined && recoveryEvents.length > 0
      ? { recoveryEvents }
      : {}),
  });
  await Deno.writeTextFile(scoreFile, scoreLines.join("\n"));
}

/**
 * Display benchmark summary to console
 */
export function displayBenchmarkSummary(
  stats: AggregateStats,
  resultCount: number,
  resultsFile: string,
  scoreFile: string,
): void {
  console.log("");
  log.summary("Benchmark Summary:");
  console.log(`   Total results: ${resultCount}`);
  console.log(
    `   Pass rate: ${(stats.overallPassRate * 100).toFixed(1)}%`,
  );
  console.log(`   Average score: ${stats.averageScore.toFixed(1)}`);
  console.log(
    `   Total tokens: ${stats.totalTokens.toLocaleString("en-US")}`,
  );
  console.log(`   Total cost: $${stats.totalCost.toFixed(4)}`);
  console.log(
    `   Runtime: ${formatDurationMs(stats.totalDuration)} (LLM: ${
      formatDurationMs(stats.totalLLMDuration)
    }, Compile: ${formatDurationMs(stats.totalCompileDuration)}, Test: ${
      formatDurationMs(stats.totalTestDuration)
    })`,
  );
  console.log(`   Results: ${colors.gray(resultsFile)}`);
  console.log(`   Scores: ${colors.gray(scoreFile)}`);
}

/**
 * Display formatted output based on format option
 */
export async function displayFormattedOutput(
  stats: AggregateStats,
  comparisons: TaskComparison[],
  results: TaskExecutionResult[],
  taskCount: number,
  outputFormat: OutputFormat,
): Promise<void> {
  // Create formatter input
  const formatterInput: FormatterInput = {
    stats,
    comparisons,
    taskCount,
  };

  // Output based on format
  if (outputFormat === "verbose") {
    console.log(formatBenchmarkStats(formatterInput));
    console.log(formatModelSummaryTable(formatterInput));

    if (taskCount > 1) {
      const matrixInput: TaskMatrixInput = {
        ...formatterInput,
        results,
      };
      console.log(formatTaskMatrix(matrixInput));
    } else if (taskCount === 1) {
      console.log(formatSingleTaskMatrix({ results }));
    }
  } else {
    const formatter = getFormatter(outputFormat);
    const formatted = formatter(formatterInput);

    console.log(`\n${"─".repeat(50)}`);
    console.log(colors.bold(`${outputFormat.toUpperCase()} Format:\n`));
    console.log(formatted);

    // F5: the compact single-task matrix must render on every output
    // format, not just verbose — printing it only under verbose would
    // reproduce half the bug this exists to fix (see single-task-matrix.ts).
    if (taskCount === 1) {
      console.log(formatSingleTaskMatrix({ results }));
    }

    if (shouldCopyToClipboard(outputFormat)) {
      const copied = await copyToClipboard(formatted);
      if (copied) {
        log.success("Copied to clipboard!");
      }
    }
  }
}

/**
 * Display a multi-run summary with pass@k statistics.
 * Loads the N result files produced during the runs loop,
 * groups them by model+task, and prints pass@k and consistency.
 */
export async function displayMultiRunSummary(
  resultFilePaths: string[],
  runCount: number,
): Promise<void> {
  const fileData = await loadResultFilesGrouped(resultFilePaths);
  const grouped = groupResultsByModelAndTask(fileData);
  const multiRunStats = calculateMultiRunStats(grouped, runCount);

  console.log("");
  console.log(colors.bold("=".repeat(60)));
  console.log(colors.bold(`MULTI-RUN SUMMARY (${runCount} runs)`));
  console.log("=".repeat(60));

  for (const [variantId, stats] of multiRunStats) {
    console.log("");
    console.log(colors.bold(`  ${variantId}`));

    // Display pass@k values
    const passAtKParts: string[] = [];
    for (let k = 1; k <= runCount; k++) {
      const val = stats.passAtK[k];
      if (val !== undefined) {
        passAtKParts.push(
          `pass@${k}: ${colors.green((val * 100).toFixed(1) + "%")}`,
        );
      }
    }
    if (passAtKParts.length > 0) {
      console.log(`    ${passAtKParts.join("  ")}`);
    }

    // Consistency
    const consistencyColor = stats.consistency >= 0.8
      ? colors.green
      : stats.consistency >= 0.5
      ? colors.yellow
      : colors.red;
    console.log(
      `    Consistency: ${
        consistencyColor((stats.consistency * 100).toFixed(1) + "%")
      }`,
    );

    // pass^k (strict — all k runs pass)
    const passHatKParts: string[] = [];
    for (let k = 1; k <= runCount; k++) {
      const val = stats.passHatK[k];
      if (val !== undefined) {
        passHatKParts.push(
          `pass^${k}: ${colors.cyan((val * 100).toFixed(1) + "%")}`,
        );
      }
    }
    if (passHatKParts.length > 0) {
      console.log(`    ${passHatKParts.join("  ")}`);
    }

    // majority@n
    console.log(
      `    Majority@${runCount}: ${
        colors.yellow((stats.majorityRate * 100).toFixed(1) + "%")
      }   Pass-count stddev: ${stats.perTaskPassStddev.toFixed(2)}`,
    );

    // Show inconsistent tasks
    const inconsistentTasks: string[] = [];
    for (const [taskId, taskRun] of stats.perTaskRuns) {
      if (!taskRun.consistent) {
        const outcomes = taskRun.outcomes
          .map((o) => (o ? colors.green("pass") : colors.red("fail")))
          .join(", ");
        inconsistentTasks.push(`      ${taskId}: [${outcomes}]`);
      }
    }
    if (inconsistentTasks.length > 0) {
      console.log(
        `    Inconsistent tasks (${inconsistentTasks.length}):`,
      );
      for (const line of inconsistentTasks) {
        console.log(line);
      }
    }
  }

  console.log("");
  console.log("=".repeat(60));
}
