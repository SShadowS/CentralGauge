/**
 * Finalize: turn a batch run's collected `attempts/*.json` files into the
 * same results/scores artifacts a sync bench run produces, and (optionally)
 * ingest them into the scoreboard — idempotently, so a resumed `advance`
 * after a crash never rewrites the results file or double-ingests (spec
 * section 10, and the idempotency paragraph closing spec section 4.5).
 *
 * `finalizeRun` builds one `TaskExecutionResult` per task from its
 * `attempts/<taskId>-a<N>.json` files via Plan A's `finalizeTaskResult`,
 * aggregates them with the SAME `ResultAggregator` + `buildTaskComparison`
 * the sync executor uses, then writes `benchmark-results-<runId>.json` and
 * `benchmark-scores-<runId>.txt` (the sync path names its scores file
 * `scores-<timestamp>.txt`; batch mode pairs it with the results file's
 * `benchmark-` prefix instead so the two files sort and glob together).
 *
 * @module src/batch/results
 */
import { join } from "@std/path";
import { exists } from "@std/fs";
import {
  buildTaskComparison,
  ResultAggregator,
} from "../parallel/result-aggregator.ts";
import type { ParallelTaskResult } from "../parallel/types.ts";
import { finalizeTaskResult } from "../parallel/shared/mod.ts";
import type {
  ExecutionAttempt,
  TaskExecutionContext,
  TaskExecutionResult,
  TaskManifest,
} from "../tasks/interfaces.ts";
import type { ModelVariant } from "../llm/variant-types.ts";
import type {
  BatchInvocationSummary,
  EnvironmentManifest,
  InvocationRecord,
} from "../ingest/capture.ts";
import { invocationSnapshot } from "../ingest/capture.ts";
import { ingestRun } from "../ingest/mod.ts";
import type { IngestOptions } from "../ingest/mod.ts";
import type { AssembleOptions } from "../../cli/commands/bench/ingest-assembly.ts";
import { assembleBenchResultsForVariant } from "../../cli/commands/bench/ingest-assembly.ts";
import {
  buildIngestMeta,
  parseIngestMeta,
} from "../../cli/commands/bench/ingest-meta.ts";
import type { HashResult } from "../../cli/commands/bench/results-writer.ts";
import {
  saveResultsJson,
  saveScoresFile,
} from "../../cli/commands/bench/results-writer.ts";
import type { BatchRecord, BatchRunState, TaskSummary } from "./state.ts";
import { writeState } from "./state.ts";
import { attemptPath } from "./paths.ts";

/** Dependencies `finalizeRun` needs beyond the run directory and its state. */
export interface FinalizeDeps {
  manifests: Map<string, TaskManifest>;
  contexts: Map<string, TaskExecutionContext>;
  variant: ModelVariant;
  environment: EnvironmentManifest;
  taskSetHash: string;
  ingest: boolean;
  cwd: string;
  ingestFlags: IngestOptions["flags"];
  /**
   * Injectable for tests. Defaults to the real `ingestRun` from
   * `src/ingest/mod.ts`. Kept as a distinct field from `ingest` (the
   * boolean gate above) since a function and a toggle cannot share one
   * property name.
   */
  ingestRun?: typeof ingestRun;
}

/** On-disk shape of `attempts/<taskId>-a<N>.json` (written by `src/batch/evaluate.ts`). */
interface StoredAttempt {
  schemaVersion: 1;
  attempt: ExecutionAttempt;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

/**
 * `writeJsonAtomic`/`collect.ts` round-trip `ExecutionAttempt` through JSON,
 * which turns `startTime`/`endTime` into ISO strings. `finalizeTaskResult`
 * (and everything downstream) expects real `Date`s.
 */
function rehydrateAttempt(raw: ExecutionAttempt): ExecutionAttempt {
  return {
    ...raw,
    startTime: new Date(raw.startTime),
    endTime: new Date(raw.endTime),
  };
}

/**
 * Load a task's evaluated attempts in order (1, then 2 when present). A
 * task with only an infra attempt (attempt 1 synthesized as an infra
 * failure, no resubmission) still yields exactly that one attempt here —
 * `buildTaskResult` below scores it `success: false` and it stays in the
 * results, matching the sync executor's own treatment of an exhausted
 * infra retry.
 */
async function loadTaskAttempts(
  dir: string,
  taskId: string,
  summary: TaskSummary,
): Promise<ExecutionAttempt[]> {
  const attempts: ExecutionAttempt[] = [];
  const slots: Array<1 | 2> = summary.attempt2 ? [1, 2] : [1];
  for (const n of slots) {
    const filePath = attemptPath(dir, taskId, n);
    if (!(await exists(filePath))) continue;
    const stored = await readJson<StoredAttempt>(filePath);
    attempts.push(rehydrateAttempt(stored.attempt));
  }
  return attempts;
}

/**
 * Build one task's final `TaskExecutionResult` from its evaluated attempts.
 * Mirrors the sync orchestrator's own attempt loop (`orchestrator.ts`):
 * `passedAttemptNumber` stays `0` and `finalCode` stays `undefined` when the
 * task never passed, and `totalDuration` is the sum of the (batch) attempt
 * durations rather than a wall-clock span, since batch attempts are not
 * executed back-to-back in one process.
 */
async function buildTaskResult(
  dir: string,
  taskId: string,
  summary: TaskSummary,
  deps: FinalizeDeps,
  runId: string,
): Promise<TaskExecutionResult> {
  const attempts = await loadTaskAttempts(dir, taskId, summary);
  const context = deps.contexts.get(taskId);
  if (!context) {
    throw new Error(`finalizeRun: no context for task ${taskId}`);
  }

  let success = false;
  let passedAttemptNumber = 0;
  let finalCode: string | undefined;
  for (const attempt of attempts) {
    if (attempt.success) {
      success = true;
      passedAttemptNumber = attempt.attemptNumber;
      finalCode = attempt.candidateCode;
      break;
    }
  }
  const totalDuration = attempts.reduce((sum, a) => sum + a.duration, 0);

  return finalizeTaskResult({
    taskId,
    executionId: `${taskId}_${deps.variant.variantId}_${runId}`,
    context,
    attempts,
    success,
    passedAttemptNumber,
    finalCode,
    totalDuration,
    executedBy: "batch-runner",
  });
}

/**
 * Aggregate stats + comparisons over the full result set via
 * `ResultAggregator`, exactly as the sync executor's `computeFinalSummary`
 * does (`cli/commands/bench/parallel-executor.ts`) — reimplemented here
 * rather than imported, since that module pulls in the CLI/TUI/dashboard
 * graph that a batch-mode pure module has no business depending on.
 */
function aggregateResults(results: TaskExecutionResult[]): ReturnType<
  ResultAggregator["finalize"]
> {
  const aggregator = new ResultAggregator();
  const byTask = new Map<string, Map<string, TaskExecutionResult>>();
  for (const result of results) {
    const variantKey = result.context.variantId || result.context.llmModel;
    let modelResults = byTask.get(result.taskId);
    if (!modelResults) {
      modelResults = new Map();
      byTask.set(result.taskId, modelResults);
    }
    modelResults.set(variantKey, result);
  }
  for (const [taskId, modelResults] of byTask) {
    const comparison = buildTaskComparison(taskId, modelResults);
    const taskResult: ParallelTaskResult = {
      taskId,
      modelResults,
      failures: new Map(),
      partialSuccess: comparison.passingModels.length > 0,
      comparison,
      duration: 0,
    };
    aggregator.addParallelTaskResult(taskResult);
  }
  return aggregator.finalize();
}

/** A `HashResult` carrying only the bench-time task-set hash the run was frozen against. */
function minimalHashResult(hash: string): HashResult {
  return {
    hash,
    totalFilesHashed: 0,
    computedAt: new Date(),
    tasks: [],
  };
}

/**
 * Group `state.batches` by wave into the per-wave summary both the
 * `InvocationRecord.batch` block and the `# Batch` scores block are built
 * from. `endedAt` is `null` unless EVERY batch of the wave has ended;
 * `providerReportedCostUsd` is the sum of whichever records reported one,
 * or `null` when none did.
 */
function summarizeWaves(
  batches: BatchRecord[],
): BatchInvocationSummary["waves"] {
  const byWave = new Map<1 | 2, BatchRecord[]>();
  for (const record of batches) {
    const list = byWave.get(record.wave) ?? [];
    list.push(record);
    byWave.set(record.wave, list);
  }
  return Array.from(byWave.keys())
    .sort((a, b) => a - b)
    .map((wave) => {
      const records = byWave.get(wave)!;
      const batchIds = records.map((r) => r.handle.batchId);
      const submittedAt = [...records.map((r) => r.submittedAt)].sort()[0]!;
      const allEnded = records.every((r) => r.state === "ended");
      const endedAt = allEnded
        ? [...records.map((r) => r.lastPolledAt ?? r.submittedAt)].sort()
          .at(-1)!
        : null;
      const costs = records
        .map((r) => r.providerReportedCostUsd)
        .filter((c): c is number => c !== undefined);
      const providerReportedCostUsd = costs.length > 0
        ? costs.reduce((sum, c) => sum + c, 0)
        : null;
      return { wave, batchIds, submittedAt, endedAt, providerReportedCostUsd };
    });
}

/** Count of items resubmitted in round 1 (spec section 4.4's `ownerRound`). */
function countResubmittedItems(tasks: BatchRunState["tasks"]): number {
  let count = 0;
  for (const summary of Object.values(tasks)) {
    if (summary.attempt1.ownerRound === 1) count++;
    if (summary.attempt2 && summary.attempt2.ownerRound === 1) count++;
  }
  return count;
}

/** Build the `batch` block shared by `InvocationRecord.batch` and the `# Batch` scores block. */
function buildBatchInvocationSummary(
  state: BatchRunState,
): BatchInvocationSummary {
  return {
    provider: state.model.provider,
    waves: summarizeWaves(state.batches),
    resubmittedItems: countResubmittedItems(state.tasks),
    environmentByWave: {
      "1": state.frozen.environment,
      "2": state.frozen.environment,
    },
  };
}

/**
 * Finalize a batch run: write the sync-shaped results/scores files (once)
 * and, when `deps.ingest`, send the run to the scoreboard (once). Both
 * halves are idempotent against the persisted `state.resultsFile` /
 * `state.ingestedRunId` markers, so a resumed `advance` after a crash never
 * rewrites the results file or double-ingests, and a run finalized with
 * `--no-ingest` can still be ingested later via a separate replay without
 * this function re-deriving anything.
 */
export async function finalizeRun(
  dir: string,
  state: BatchRunState,
  deps: FinalizeDeps,
): Promise<BatchRunState> {
  let next = state;

  if (next.phase !== "finalizing" && next.phase !== "finalized") {
    next = { ...next, phase: "finalizing" };
    await writeState(dir, next);
  }

  const resultsFile = next.resultsFile ??
    join(dir, "..", "..", `benchmark-results-${next.runId}.json`);

  if (next.resultsFile === undefined) {
    const taskIds = Object.keys(next.tasks).sort();
    const results: TaskExecutionResult[] = [];
    for (const taskId of taskIds) {
      results.push(
        await buildTaskResult(
          dir,
          taskId,
          next.tasks[taskId]!,
          deps,
          next.runId,
        ),
      );
    }

    const { stats, comparisons } = aggregateResults(results);

    const anyContext = deps.contexts.values().next().value as
      | TaskExecutionContext
      | undefined;
    const maxAttempts = anyContext?.attemptLimit ?? 2;
    const variantId = deps.variant.variantId;

    const invocationRecord: InvocationRecord = {
      ...invocationSnapshot({
        provider: deps.variant.provider,
        model: deps.variant.baseModel,
        apiModelId: deps.variant.model,
        ...(deps.variant.config.maxTokens !== undefined
          ? { maxTokens: deps.variant.config.maxTokens }
          : {}),
        ...(deps.variant.config.temperature !== undefined
          ? { temperature: deps.variant.config.temperature }
          : {}),
        ...(deps.variant.config.thinkingBudget !== undefined
          ? { reasoning: deps.variant.config.thinkingBudget }
          : {}),
        mode: "batch",
        fallbackPolicy: "unavailable",
        continuation: { enabled: false, maxContinuations: 0 },
        emptyRetry: {
          enabled: false,
          maxRetries: 0,
          baseDelayMs: 0,
          jitterMs: 0,
        },
        // Not threaded through `FinalizeDeps` (unlike `AdvanceDeps`, which
        // resolves it per `advance` call) — batch mode's compile-phase
        // infra-retry budget is a per-invocation operator setting, not a
        // fact recorded in `state.json`. Recorded here as 0 pending a
        // future thread-through; informational only (settings-hash extras
        // and analytics), never re-scored.
        infraRetriesPerAttempt: 0,
        maxAttempts,
        promptProfileDigest: next.frozen.promptInputsDigest,
      }),
      batch: buildBatchInvocationSummary(next),
    };

    const ingestMeta = buildIngestMeta(
      [deps.variant],
      deps.taskSetHash,
      {
        environment: deps.environment,
        invocations: {
          [variantId]: invocationRecord as unknown as Record<string, unknown>,
        },
      },
    );
    // Replay idempotency (spec 4.5): the run's OWN id, never a fresh mint —
    // `buildIngestMeta` mints one fresh UUID per call, which would make a
    // resumed/replayed ingest create a NEW server-side run every time.
    ingestMeta.run_ids[variantId] = next.runId;

    await saveResultsJson(
      resultsFile,
      results,
      stats,
      comparisons,
      minimalHashResult(deps.taskSetHash),
      [],
      [],
      ingestMeta,
    );

    const scoreFile = join(
      dir,
      "..",
      "..",
      `benchmark-scores-${next.runId}.txt`,
    );
    const taskManifests = Array.from(deps.manifests.values());
    const batchScoreBlock = {
      ...buildBatchInvocationSummary(next),
      runId: next.runId,
    };
    await saveScoresFile(
      scoreFile,
      stats,
      taskManifests,
      [deps.variant],
      maxAttempts,
      results.length,
      undefined,
      results,
      undefined,
      undefined,
      batchScoreBlock,
    );

    next = { ...next, resultsFile };
    await writeState(dir, next);
  }

  if (deps.ingest && next.ingestedRunId === undefined) {
    const variantId = deps.variant.variantId;
    const parsed = JSON.parse(await Deno.readTextFile(resultsFile));
    const ingestMeta = parseIngestMeta(parsed);
    const pricingVersion = ingestMeta?.pricing_version ??
      new Date().toISOString().slice(0, 10);

    const assembleOpts: AssembleOptions = { pricingVersion };
    const persistedInvocation = ingestMeta?.invocations?.[variantId];
    if (persistedInvocation) assembleOpts.invocation = persistedInvocation;
    assembleOpts.environment = deps.environment;
    if (deps.environment.centralgauge_sha) {
      assembleOpts.centralgaugeSha = deps.environment.centralgauge_sha;
    }
    assembleOpts.runId = ingestMeta?.run_ids[variantId] ?? next.runId;
    assembleOpts.taskSetHash = ingestMeta?.task_set_hash ?? deps.taskSetHash;

    const assembled = await assembleBenchResultsForVariant(
      resultsFile,
      deps.variant,
      assembleOpts,
    );

    if (assembled.kind === "assembled") {
      const ingestFn = deps.ingestRun ?? ingestRun;
      const outcome = await ingestFn(assembled.benchResults, {
        cwd: deps.cwd,
        catalogDir: `${deps.cwd}/site/catalog`,
        tasksDir: `${deps.cwd}/tasks`,
        interactive: false,
        flags: deps.ingestFlags,
      });
      if (outcome.kind === "success") {
        next = { ...next, ingestedRunId: outcome.runId };
        await writeState(dir, next);
      } else if (outcome.kind === "fatal-failure") {
        throw new Error(
          `batch finalize: ingest rejected for ${variantId}: ${outcome.code} ${outcome.message}`,
        );
      } else {
        console.warn(
          `[WARN] batch finalize: ingest failed transiently for ${variantId}: ${outcome.lastError.message} — replay: centralgauge ingest ${resultsFile}`,
        );
      }
    } else if (assembled.kind === "all_infra") {
      console.warn(
        `[WARN] batch finalize: every attempt for ${variantId} was infra-invalidated — not ingested (${assembled.infraExcludedAttempts} excluded)`,
      );
    }
  }

  if (next.phase !== "finalized") {
    next = {
      ...next,
      phase: "finalized",
      finalizedAt: new Date().toISOString(),
    };
    await writeState(dir, next);
  }

  return next;
}
