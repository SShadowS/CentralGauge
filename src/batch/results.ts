/**
 * Finalize: turn a batch run's collected `attempts/*.json` files into the
 * same results/scores artifacts a sync bench run produces, and (optionally)
 * ingest them into the scoreboard, idempotently, so a resumed `advance`
 * after a crash never rewrites the results file or double-ingests (spec
 * section 10, and the idempotency paragraph closing spec section 4.5).
 *
 * `finalizeRun` builds one `TaskExecutionResult` per task from its
 * `attempts/<taskId>-a<N>.json` files via Plan A's `finalizeTaskResult`,
 * aggregates them with the SAME `ResultAggregator` + `buildTaskComparison`
 * the sync executor uses, then writes `benchmark-results-<runId>.json` and
 * `benchmark-scores-<runId>.txt` (the sync path names its scores file
 * `scores-<timestamp>.txt`; batch mode pairs it with the results file's
 * `benchmark-` prefix instead so the two files sort and glob together). The
 * invocation record's settings extras (mode, retry policies, prompt-profile
 * digest, and so on) are read back from the run's own frozen
 * `prompt-inputs.json`, never recomputed or hardcoded here, since that is
 * exactly what waves 1/2 actually ran under.
 *
 * @module src/batch/results
 */
import { join } from "@std/path";
import { exists } from "@std/fs";
import type { ParallelTaskResult } from "../parallel/types.ts";
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
import type { IngestOptions } from "../ingest/mod.ts";
import type { AssembleOptions } from "../../cli/commands/bench/ingest-assembly.ts";
import type { HashResult } from "../../cli/commands/bench/results-writer.ts";
import type {
  CanonicalSettingsExtras,
  LegacyCanonicalSettingsExtras,
} from "../../shared/settings-hash.ts";
import type { FrozenPromptInputs } from "../parallel/shared/prompt-inputs.ts";
import type { BatchRecord, BatchRunState, TaskSummary } from "./state.ts";
import {
  buildTaskComparison,
  ResultAggregator,
} from "../parallel/result-aggregator.ts";
import { finalizeTaskResult } from "../parallel/shared/mod.ts";
import { invocationSnapshot } from "../ingest/capture.ts";
import { ingestRun } from "../ingest/mod.ts";
import { assembleBenchResultsForVariant } from "../../cli/commands/bench/ingest-assembly.ts";
import {
  buildIngestMeta,
  parseIngestMeta,
} from "../../cli/commands/bench/ingest-meta.ts";
import {
  saveResultsJson,
  saveScoresFile,
} from "../../cli/commands/bench/results-writer.ts";
import { writeJsonAtomic, writeState } from "./state.ts";
import { attemptPath, RUN_FILES } from "./paths.ts";
import { isLegacyExtras, sha256Hex } from "../../shared/settings-hash.ts";

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
 * failure, no resubmission) still yields exactly that one attempt here.
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
 * does (`cli/commands/bench/parallel-executor.ts`). Reimplemented here
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
 * from. `endedAt` is `null` unless EVERY batch of the wave has ended; per
 * record it prefers `endedAt` (the first observed end, stamped once by
 * `pollActive`) and falls back to `lastPolledAt` only for a record written
 * before that field existed. Across records in the wave it is still the
 * latest of those per-record values - a wave with multiple chunks only
 * "ends" once its last chunk does. `providerReportedCostUsd` is the sum of
 * whichever records reported one, or `null` when none did.
 */
export function summarizeWaves(
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
        ? [
          ...records.map((r) => r.endedAt ?? r.lastPolledAt ?? r.submittedAt),
        ].sort()
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

/**
 * Read the run's frozen `prompt-inputs.json` and parse its settings extras
 * (the same extras the executor builds via `buildCanonicalSettings`, spec
 * section 10 / D4, or the nine-key schema-1 shape for a run submitted before
 * the upstream lock). `finalizeRun` sources the whole invocation record from
 * these frozen values instead of recomputing or hardcoding them: they are
 * what waves 1 and 2 actually ran under, not whatever is configured in the
 * process that happens to call `finalizeRun` (which may run hours or days
 * later).
 */
async function readFrozenExtras(
  dir: string,
): Promise<{
  inputs: FrozenPromptInputs;
  extras: CanonicalSettingsExtras | LegacyCanonicalSettingsExtras;
}> {
  const inputs = await readJson<FrozenPromptInputs>(
    join(dir, RUN_FILES.promptInputs),
  );
  if (!inputs.settings.extra_json) {
    throw new Error(
      `finalizeRun: frozen prompt-inputs.json carries no extra_json settings; the run directory may be corrupted`,
    );
  }
  // A run frozen before the upstream lock has no `settings_extras_schema`;
  // the caller branches on `isLegacyExtras` so it is never rebuilt or
  // persisted as if it were schema 2.
  const extras = JSON.parse(
    inputs.settings.extra_json,
  ) as CanonicalSettingsExtras | LegacyCanonicalSettingsExtras;
  return { inputs, extras };
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
 * Finalize a batch run: write the sync-shaped results/scores files and,
 * when `deps.ingest`, send the run to the scoreboard exactly once.
 *
 * Re-entrant by design, because `finalizing` is a phase `advance` resumes
 * from (a crash mid-write, or an ingest that threw): the results/scores
 * files are rebuilt whenever the deterministic path is not on disk, and
 * the ingest is skipped whenever the run's `ingested.json` marker exists.
 * The marker is written the moment the server accepts the payload, before
 * the state write that could still be interrupted, so a crash in that
 * window cannot produce a second server-side run.
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

  // Rebuild whenever the file this run is supposed to have is not on disk:
  // `state.resultsFile` alone is not proof (a crash between the two writes,
  // or a file deleted since). The path is deterministic, so rewriting it is
  // always safe.
  if (next.resultsFile === undefined || !(await exists(resultsFile))) {
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
    const variantId = deps.variant.variantId;

    // Everything settings-shaped comes back from the run's own frozen
    // `prompt-inputs.json`, never recomputed or hardcoded: it is what waves
    // 1/2 actually ran under, not whatever a later `finalizeRun` caller
    // happens to be configured with.
    const { inputs: promptInputs, extras } = await readFrozenExtras(dir);
    const maxAttempts = promptInputs.settings.max_attempts ??
      (anyContext?.attemptLimit ?? 2);

    const pin = isLegacyExtras(extras)
      ? undefined
      : (extras.upstream_pin ?? undefined);
    const invocationRecord: InvocationRecord = {
      ...invocationSnapshot({
        ...(pin !== undefined ? { upstreamPin: pin } : {}),
        ...(promptInputs.routing
          ? {
            upstreamResolved: {
              provider_name: promptInputs.routing.providerName,
              quantization: promptInputs.routing.quantization,
              preflight: promptInputs.routing.preflight,
            },
          }
          : {}),
        provider: deps.variant.provider,
        model: deps.variant.baseModel,
        apiModelId: deps.variant.model,
        ...(promptInputs.settings.max_tokens !== null
          ? { maxTokens: promptInputs.settings.max_tokens }
          : {}),
        ...(promptInputs.settings.temperature !== null
          ? { temperature: promptInputs.settings.temperature }
          : {}),
        ...(extras.thinking_budget !== null
          ? { reasoning: extras.thinking_budget }
          : {}),
        mode: extras.invocation_mode,
        fallbackPolicy: extras.fallback_policy,
        continuation: {
          enabled: extras.continuation.enabled,
          maxContinuations: extras.continuation.max,
        },
        emptyRetry: {
          enabled: extras.empty_retry.enabled,
          maxRetries: extras.empty_retry.max,
          baseDelayMs: 0,
          jitterMs: 0,
        },
        infraRetriesPerAttempt: extras.infra_retries_per_attempt,
        maxAttempts,
        promptProfileDigest: extras.prompt_profile_digest,
      }),
      batch: buildBatchInvocationSummary(next),
    };

    // A run frozen before the upstream lock is schema 1: strip the three
    // schema-2 keys so the persisted record does not claim a pin decision
    // that this run never made.
    if (isLegacyExtras(extras)) {
      const r = invocationRecord as unknown as Record<string, unknown>;
      delete r["invocation_schema"];
      delete r["upstream_pin"];
      delete r["upstream_resolved"];
    }

    // `endpoint`/`provider_route` are pure functions of `(provider,
    // apiModelId)` inside `invocationSnapshot`, so they are re-derived
    // rather than copied from the frozen extras. A disagreement here means
    // the run directory does not describe the model this call thinks it is
    // finalizing, which is a corruption, not a recoverable state.
    if (
      invocationRecord.endpoint !== extras.endpoint ||
      invocationRecord.provider_route !== extras.provider_route
    ) {
      throw new Error(
        `finalizeRun: frozen settings extras disagree with the derived transport for run ${next.runId}. ` +
          `endpoint: frozen=${extras.endpoint} derived=${invocationRecord.endpoint}. ` +
          `provider_route: frozen=${extras.provider_route} derived=${invocationRecord.provider_route}. ` +
          `The run directory may be corrupted.`,
      );
    }

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
    // Replay idempotency (spec 4.5): the run's OWN id, never a fresh mint.
    // `buildIngestMeta` mints one fresh UUID per call, which would make a
    // resumed/replayed ingest create a NEW server-side run every time.
    ingestMeta.run_ids[variantId] = next.runId;
    // The attempts were priced at the version `submit` froze, which is not
    // today: a 24-hour batch window routinely finalizes on a later day, and
    // stamping that day would make ingest fetch a fresh snapshot with no
    // batch rates and price the whole run NULL on the site.
    if (next.pricingVersion !== undefined) {
      ingestMeta.pricing_version = next.pricingVersion;
    }

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

  if (deps.ingest && !(await exists(join(dir, RUN_FILES.ingested)))) {
    const variantId = deps.variant.variantId;
    const resultsText = await Deno.readTextFile(resultsFile);
    const parsed = JSON.parse(resultsText);
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
        // The marker, not `state.ingestedRunId`, is what blocks a replay:
        // it is written the moment the server accepted the payload, before
        // the state write that could still be interrupted.
        await writeJsonAtomic(join(dir, RUN_FILES.ingested), {
          runId: next.runId,
          ingestedRunId: outcome.runId,
          at: new Date().toISOString(),
          payloadDigest: await sha256Hex(resultsText),
        });
        next = { ...next, ingestedRunId: outcome.runId };
        await writeState(dir, next);
      } else if (outcome.kind === "fatal-failure") {
        throw new Error(
          `batch finalize: ingest rejected for ${variantId}: ${outcome.code} ${outcome.message}`,
        );
      } else {
        console.warn(
          `[WARN] batch finalize: ingest failed transiently for ${variantId}: ${outcome.lastError.message}. Replay: centralgauge ingest ${resultsFile}`,
        );
      }
    } else if (assembled.kind === "all_infra") {
      console.warn(
        `[WARN] batch finalize: every attempt for ${variantId} was infra-invalidated; not ingested (${assembled.infraExcludedAttempts} excluded)`,
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
