/**
 * The batch compile phase: turn collected `responses/<itemId>.json` files
 * into `attempts/<taskId>-a<N>.json` records over Plan A's shared execution
 * units (spec sections 6, 7, 9). This is the ONLY place scoring/gating/
 * pricing/finalization-adjacent logic runs for batch mode; everything else
 * is delegated to `src/parallel/shared/` exactly as the sync orchestrator
 * uses it (spec D6).
 *
 * `evaluateCollected` is idempotent per task: a task whose attempt file
 * already exists on disk is skipped before touching the queue or the
 * provider's response file at all, so a resumed `advance` after a crash
 * never re-compiles a candidate it already scored.
 *
 * @module src/batch/evaluate
 */
import { ensureDir, exists } from "@std/fs";
import { dirname } from "@std/path";
import type { ContainerRuntime } from "../parallel/container-runtime.ts";
import { Semaphore } from "../parallel/semaphore.ts";
import { InfraRetriesExhaustedError } from "../parallel/errors.ts";
import {
  buildCompileWorkItem,
  createFailedAttempt,
  evaluateAttempt,
  priceUsage,
  runCompileWorkItem,
  synthesizeInfraAttempt,
} from "../parallel/shared/mod.ts";
import type { FrozenRouting } from "../parallel/shared/prompt-inputs.ts";
import type { LLMWorkResult } from "../parallel/types.ts";
import { isUpstreamCompromised } from "../llm/upstream-verification.ts";
import { classifyInfraError } from "../health/classify.ts";
import { isInfraError } from "../health/is-infra-error.ts";
import { resolveCandidate } from "../llm/candidate-resolution.ts";
import type { LLMRequest, LLMResponse } from "../llm/types.ts";
import type { BatchItemResult } from "../llm/batch/types.ts";
import type {
  ExecutionAttempt,
  TaskExecutionContext,
  TaskManifest,
} from "../tasks/interfaces.ts";
import type { BatchRunState, ItemSummary } from "./state.ts";
import { writeJsonAtomic, writeState } from "./state.ts";
import { attemptPath, requestPath, responsePath } from "./paths.ts";

export interface EvaluateDeps {
  runtime: ContainerRuntime;
  taskConcurrency: number;
  infraRetriesPerAttempt: number;
  manifests: Map<string, TaskManifest>;
  contexts: Map<string, TaskExecutionContext>;
  provider: string;
  requestedModel: string;
  /**
   * The run's frozen OpenRouter routing (`prompt-inputs.json`'s `routing`),
   * absent on an unpinned run. Every work result built here carries its pin
   * so the attempt records what was asked for even when the provider
   * errored and no identity came back (spec 2026-09-11 D1).
   */
  routing?: FrozenRouting;
}

/**
 * The requested-pin fields every batch `LLMWorkResult` carries, taken from
 * the run's frozen routing. Empty on an unpinned run, which then classifies
 * as `unpinned` rather than as a broken pin.
 */
function requestedUpstreamFields(
  routing: FrozenRouting | undefined,
): { requestedUpstream?: string; upstreamProviderName?: string } {
  return routing
    ? {
      requestedUpstream: routing.upstreamPin,
      upstreamProviderName: routing.providerName,
    }
    : {};
}

/**
 * A pinned attempt that cannot be shown to have been served by its pin is
 * terminal: it is excluded at ingest (spec D3), so the task must not get a
 * wave-2 attempt that would be paid for and never counted.
 */
function markTerminalIfCompromised(attempt: ExecutionAttempt): void {
  if (
    attempt.upstreamVerification !== undefined &&
    isUpstreamCompromised(attempt.upstreamVerification)
  ) {
    attempt.terminal = "upstream_compromised";
  }
}

/** On-disk shape of `responses/<itemId>.json` (written by `src/batch/collect.ts`). */
interface StoredResponse {
  result: BatchItemResult;
  response?: LLMResponse;
}

/** On-disk shape of `attempts/<taskId>-a<N>.json`. */
interface StoredAttempt {
  schemaVersion: 1;
  attempt: ExecutionAttempt;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

/** `error.code` when present, else the error kind itself (spec section 9). */
function providerErrorCodeFor(
  error: Extract<BatchItemResult, { ok: false }>["error"],
): string {
  return error.code ?? error.kind;
}

/** `"batch_expired"` for an expired item, else the provider's error kind (spec section 9). */
function providerFinishReasonFor(
  error: Extract<BatchItemResult, { ok: false }>["error"],
): string {
  return error.kind === "expired" ? "batch_expired" : error.kind;
}

/**
 * Attempt-1's `candidateCode`, for wave 2's `overlayBase` (spec D6's
 * `buildCompileWorkItem`, mirroring the sync orchestrator's own
 * `attempts[attempts.length - 1]?.candidateCode` overlay rule).
 */
async function priorCandidateCode(
  dir: string,
  taskId: string,
): Promise<string | undefined> {
  const stored = await readJson<StoredAttempt>(attemptPath(dir, taskId, 1));
  return stored.attempt.candidateCode;
}

/** One task's outcome for this call: a finished attempt, or still unresolved. */
type ItemOutcome =
  | { kind: "attempt"; attempt: ExecutionAttempt }
  | { kind: "unresolved" };

/** `responded`: price, resolve the candidate, compile if ready. */
async function evaluateResponded(
  dir: string,
  taskId: string,
  attemptNumber: 1 | 2,
  itemId: string,
  stored: StoredResponse,
  deps: EvaluateDeps,
): Promise<ItemOutcome> {
  const response = stored.response;
  if (!response) {
    // Defensive: collect.ts never writes `responded` without a mapped
    // response, but a hand-edited/corrupted file must not crash the run
    // silently mis-scored: surface it loudly instead.
    throw new Error(
      `evaluateResponded: ${itemId} (${taskId}) is "responded" but its response file carries no response`,
    );
  }

  const pricedUsage = priceUsage({
    usage: response.usage,
    provider: deps.provider,
    requestedModel: deps.requestedModel,
    servedModel: response.servedModel,
    mode: "batch",
  });
  const pricedResponse: LLMResponse = { ...response, usage: pricedUsage };

  const request = await readJson<LLMRequest>(requestPath(dir, itemId));
  const resolution = resolveCandidate(
    pricedResponse.content,
    pricedResponse.finishReason,
  );

  if (!resolution.isReadyForCompile) {
    const llmResult: LLMWorkResult = {
      workItemId: itemId,
      success: false,
      error: resolution.failure!.error,
      failureKind: resolution.failure!.failureKind,
      llmResponse: pricedResponse,
      request,
      duration: 0,
      readyForCompile: false,
      ...requestedUpstreamFields(deps.routing),
    };
    const failed = createFailedAttempt(
      attemptNumber,
      llmResult,
      undefined,
      deps.provider,
    );
    markTerminalIfCompromised(failed);
    return { kind: "attempt", attempt: failed };
  }

  const context = deps.contexts.get(taskId);
  if (!context) {
    throw new Error(`evaluateResponded: no context for ${taskId}`);
  }
  const overlayBase = attemptNumber === 2
    ? await priorCandidateCode(dir, taskId)
    : undefined;

  const code = resolution.cleanedCode;
  const compileItem = buildCompileWorkItem({
    executionId: `${taskId}_batch`,
    attemptNumber,
    workItemId: itemId,
    context,
    code,
    llmResponse: pricedResponse,
    ...(overlayBase !== undefined ? { overlayBase } : {}),
  });

  // Same slug form the sync bench uses for `variant.variantId`
  // (`generateVariantId` in `src/llm/variant-types.ts`): vendor-prefixed,
  // so compile-queue/health-monitor telemetry attributes batch work to the
  // same identity a sync run of the same model would use.
  const variantId = `${deps.provider}/${deps.requestedModel}`;
  const attemptStart = new Date(Date.now() - pricedResponse.duration);

  try {
    const { compileResult, infraRetries } = await runCompileWorkItem(
      compileItem,
      {
        queue: deps.runtime.queue,
        configuredContainers: deps.runtime.containerNames,
        maxRetries: deps.infraRetriesPerAttempt,
        emit: deps.runtime.emit.bind(deps.runtime),
        healthMonitor: deps.runtime.monitor,
        taskId,
        variantId,
      },
    );

    const llmResult: LLMWorkResult = {
      workItemId: itemId,
      success: true,
      code,
      llmResponse: pricedResponse,
      request,
      duration: pricedResponse.duration,
      readyForCompile: true,
      ...requestedUpstreamFields(deps.routing),
    };
    const attempt = evaluateAttempt({
      attemptNumber,
      llmResult,
      compileResult,
      context,
    });
    if (infraRetries.length > 0) {
      attempt.infraRetries = infraRetries;
    }
    markTerminalIfCompromised(attempt);
    return { kind: "attempt", attempt };
  } catch (err) {
    let cause = err instanceof Error ? err : new Error(String(err));
    let infraRetries: import("../tasks/interfaces.ts").InfraRetryRecord[] = [];
    let exhaustionReason:
      | import("../tasks/interfaces.ts").InfraRetryExhaustionReason
      | undefined;
    if (err instanceof InfraRetriesExhaustedError) {
      infraRetries = err.retries;
      exhaustionReason = err.reason;
      cause = err.cause;
    } else if (!isInfraError(err)) {
      // Not an infra failure at all: a genuine bug must surface, not be
      // silently scored as a task outcome (matches the sync orchestrator's
      // own `wasInfraExhaustion || isInfraError(err)` gate).
      throw err;
    }

    const classification = classifyInfraError(cause);
    const attempt = synthesizeInfraAttempt({
      attemptNumber,
      startTime: attemptStart,
      error: cause,
      classification,
      ...(infraRetries.length > 0 ? { infraRetries } : {}),
      ...(exhaustionReason !== undefined
        ? {
          infraRetryExhausted: true,
          infraRetryExhaustionReason: exhaustionReason,
        }
        : {}),
      request,
      llmResponse: pricedResponse,
      provider: deps.provider,
      ...requestedUpstreamFields(deps.routing),
    });
    return { kind: "attempt", attempt };
  }
}

/** `errored` / `expired`: one resubmission round, then a terminal failed attempt. */
async function evaluateErrored(
  itemId: string,
  taskId: string,
  attemptNumber: 1 | 2,
  round: 0 | 1,
  stored: StoredResponse,
  requestPathForItem: string,
  provider: string,
  routing: FrozenRouting | undefined,
): Promise<ItemOutcome> {
  if (stored.result.ok) {
    throw new Error(
      `evaluateErrored: ${itemId} (${taskId}) has an ok result`,
    );
  }
  const error = stored.result.error;

  if (round === 0 && error.retryable) {
    return { kind: "unresolved" };
  }

  const request = (await exists(requestPathForItem))
    ? await readJson<LLMRequest>(requestPathForItem)
    : undefined;
  const llmResult: LLMWorkResult = {
    workItemId: itemId,
    success: false,
    error: error.message,
    providerErrorCode: providerErrorCodeFor(error),
    duration: 0,
    readyForCompile: false,
    ...(request ? { request } : {}),
    ...requestedUpstreamFields(routing),
  };
  const attempt = createFailedAttempt(
    attemptNumber,
    llmResult,
    undefined,
    provider,
  );
  attempt.providerFinishReason = providerFinishReasonFor(error);
  return { kind: "attempt", attempt };
}

/**
 * Evaluate every task whose `wave` item is `responded` / `errored` /
 * `expired` and has no attempt file yet, bounded to `deps.taskConcurrency`
 * concurrent tasks against the compile queue. Mutates `state.tasks[*]`'s
 * `ItemSummary` in place for anything resolved this call and persists
 * `state.json` once at the end.
 */
export async function evaluateCollected(
  dir: string,
  state: BatchRunState,
  wave: 1 | 2,
  deps: EvaluateDeps,
): Promise<{ evaluated: string[]; unresolved: string[] }> {
  const evaluated: string[] = [];
  const unresolved: string[] = [];
  const semaphore = new Semaphore(Math.max(1, deps.taskConcurrency));

  // `attemptPath` lives under `<dir>/attempts/`, which nothing else in the
  // run directory is guaranteed to have created yet (unlike `responses/`
  // and `requests/`, which `collect.ts`/`submit-wave.ts` ensure themselves).
  await ensureDir(dirname(attemptPath(dir, "_", 1)));

  const taskIds = Object.keys(state.tasks).sort();

  await Promise.all(taskIds.map(async (taskId) => {
    const summary = state.tasks[taskId]!;
    const itemSummary: ItemSummary | undefined = wave === 1
      ? summary.attempt1
      : summary.attempt2;
    if (!itemSummary) return;

    const attemptNumber = wave;
    const filePath = attemptPath(dir, taskId, attemptNumber);
    if (await exists(filePath)) {
      // Crash resume: a prior process wrote this attempt file but was
      // killed before this item's `ItemSummary` (and `state.json`) were
      // updated to match. Repair in place rather than merely returning, or
      // a resumed run keeps rediscovering this file forever without ever
      // persisting the fix (mirrors `collect.ts`'s `repairFromExistingFile`).
      itemSummary.state = "evaluated";
      itemSummary.attemptFile = filePath;
      evaluated.push(taskId);
      return;
    }

    if (
      itemSummary.state !== "responded" &&
      itemSummary.state !== "errored" &&
      itemSummary.state !== "expired"
    ) {
      return;
    }

    const release = await semaphore.acquire();
    try {
      const stored = await readJson<StoredResponse>(
        responsePath(dir, itemSummary.itemId),
      );

      const outcome = stored.result.ok
        ? await evaluateResponded(
          dir,
          taskId,
          attemptNumber,
          itemSummary.itemId,
          stored,
          deps,
        )
        : await evaluateErrored(
          itemSummary.itemId,
          taskId,
          attemptNumber,
          itemSummary.round,
          stored,
          requestPath(dir, itemSummary.itemId),
          deps.provider,
          deps.routing,
        );

      if (outcome.kind === "unresolved") {
        unresolved.push(taskId);
        return;
      }

      await writeJsonAtomic(filePath, {
        schemaVersion: 1,
        attempt: outcome.attempt,
      });
      itemSummary.state = "evaluated";
      itemSummary.attemptFile = filePath;
      evaluated.push(taskId);
    } finally {
      release();
    }
  }));

  await writeState(dir, state);
  return { evaluated, unresolved };
}
