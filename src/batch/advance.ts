/**
 * `advance`: the single-step driver over the pure transition table (spec
 * sections 4.5, 4.6, 7, 9). One call to {@link advanceRun} does EXACTLY one
 * of {@link nextStep}'s steps, under the run's `mutate.lock`, and returns.
 *
 * @module src/batch/advance
 */
import { dirname, join } from "@std/path";
import type { BatchItem, BatchProvider } from "../llm/batch/types.ts";
import type { LLMRequest, LLMResponse } from "../llm/types.ts";
import type {
  ExecutionAttempt,
  TaskExecutionContext,
  TaskManifest,
} from "../tasks/interfaces.ts";
import type { ContainerRuntime } from "../parallel/container-runtime.ts";
import { tryAcquireBenchLock } from "../utils/bench-lock.ts";
import { checkDrift } from "./drift.ts";
import { chunkItems, envelopeBytes, halveChunk } from "./chunking.ts";
import type { Chunk } from "./chunking.ts";
import { collectEnded, pollActive } from "./collect.ts";
import { evaluateCollected } from "./evaluate.ts";
import { itemIdFor } from "./items.ts";
import { appendEvent, loadJsonl } from "./journal.ts";
import type { ItemLine } from "./journal.ts";
import { readIntent } from "./intent.ts";
import { withMutateLock } from "./mutate-lock.ts";
import { attemptPath, requestPath, RUN_FILES } from "./paths.ts";
import type { RenderedItem } from "./render.ts";
import { renderWave } from "./render.ts";
import { nextStep } from "./transitions.ts";
import type { Step } from "./transitions.ts";
import type { BatchRunState } from "./state.ts";
import { isTerminal, loadState, writeState } from "./state.ts";
import { submitChunks } from "./submit-wave.ts";
import type { FrozenPromptInputs } from "../parallel/shared/prompt-inputs.ts";

export interface AdvanceDeps {
  provider: BatchProvider;
  buildBody: (r: LLMRequest) => unknown;
  wrap: (items: BatchItem[]) => unknown;
  mapRaw: (raw: unknown, itemId: string) => LLMResponse;
  /** Started lazily, only for the `evaluate` step. */
  runtimeFactory: () => Promise<ContainerRuntime>;
  cwd: string;
  taskConcurrency: number;
  infraRetriesPerAttempt: number;
  attemptLimit: 1 | 2;
  /** Task 10. */
  finalize: (dir: string, state: BatchRunState) => Promise<BatchRunState>;
  log: (line: string) => void;
  /**
   * Not in the spec's `AdvanceDeps` sketch, but required by
   * `evaluateCollected`'s `EvaluateDeps` and `renderWave`'s
   * `WaveRenderDeps`: task manifests and their execution contexts, loaded
   * once by the CLI command layer (`submit`, Task 11) rather than
   * re-derived here, since building a `TaskExecutionContext` needs
   * `buildAttemptContext` over the run's variant config and settings.
   */
  manifests: Map<string, TaskManifest>;
  contexts: Map<string, TaskExecutionContext>;
}

export type AdvanceExit = 0 | 3 | 4;
export type AdvanceResult = {
  exit: AdvanceExit;
  step: Step;
  state: BatchRunState;
};

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

function driftReason(changed: Array<{ input: string }>): string {
  return "drift: " + changed.map((c) => c.input).join(", ");
}

/**
 * Every `ExecutionAttempt` already on disk for `wave`, keyed by task id.
 * Only loaded for tasks whose current-wave `ItemSummary.state` is already
 * `"evaluated"` (matching {@link nextStep}'s own contract: `attempts` is
 * used ONLY to decide wave-2 eligibility, never to decide resolution).
 */
async function loadAttemptsForWave(
  dir: string,
  state: BatchRunState,
  wave: 1 | 2,
): Promise<Map<string, ExecutionAttempt>> {
  const out = new Map<string, ExecutionAttempt>();
  for (const taskId of Object.keys(state.tasks)) {
    const summary = state.tasks[taskId]!;
    const item = wave === 1 ? summary.attempt1 : summary.attempt2;
    if (!item || item.state !== "evaluated") continue;
    try {
      const stored = await readJsonFile<
        { schemaVersion: 1; attempt: ExecutionAttempt }
      >(attemptPath(dir, taskId, wave));
      out.set(taskId, stored.attempt);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  return out;
}

/**
 * `outputDir` for `tryAcquireBenchLock`: the grandparent of the run
 * directory (`<output>/batch/<runId>` -> `<output>`), matching where the
 * sync bench itself acquires the same lock.
 */
function outputDirFor(dir: string): string {
  return dirname(dirname(dir));
}

/**
 * Re-chunks any `BatchRecord` the provider asynchronously rejected for
 * size (`rawCounts.sizeRejected === 1`, set by `pollActive`) BEFORE
 * evaluation runs, per spec section 5: same round, same item ids, a fresh
 * chunk number for the new half. Returns a blocking reason when a
 * single-item chunk cannot be split further (operator-blocked); `null`
 * otherwise.
 */
async function rechunkSizeRejected(
  dir: string,
  state: BatchRunState,
  deps: AdvanceDeps,
): Promise<string | null> {
  const sizeRejected = state.batches.filter(
    (b) => !b.collected && b.rawCounts["sizeRejected"] === 1,
  );
  if (sizeRejected.length === 0) return null;

  const itemLines = await loadJsonl<ItemLine>(
    join(dir, RUN_FILES.items),
    (l) => l.itemId,
  );
  const byId = new Map(itemLines.map((l) => [l.itemId, l]));

  for (const record of sizeRejected) {
    const items: BatchItem[] = record.itemIds.map((id) => {
      const line = byId.get(id);
      if (!line) {
        throw new Error(
          `rechunkSizeRejected: no items.jsonl entry for ${id}`,
        );
      }
      return { itemId: id, body: line.body };
    });
    const nextChunkNumber = Math.max(-1, ...state.batches.map((b) => b.chunk)) +
      1;
    const chunk: Chunk = {
      chunk: record.chunk,
      items,
      bytes: envelopeBytes(items, deps.wrap),
    };
    const halved = halveChunk(chunk, nextChunkNumber, deps.wrap);

    const activeIdx = state.activeBatchIds.indexOf(record.handle.batchId);
    if (activeIdx !== -1) state.activeBatchIds.splice(activeIdx, 1);
    record.collected = true;

    if (halved === null) {
      state.lastError = {
        at: new Date().toISOString(),
        step: "size_rechunk",
        message: `item ${
          record.itemIds[0]
        } exceeds the provider's size limit and cannot be split further`,
        retryable: false,
      };
      await writeState(dir, state);
      return state.lastError.message;
    }

    const [left, right] = halved;
    const renderedItems: RenderedItem[] = await Promise.all(
      record.itemIds.map(async (id) => {
        const line = byId.get(id)!;
        const request = await readJsonFile<LLMRequest>(requestPath(dir, id));
        return {
          itemId: id,
          taskId: line.taskId,
          attempt: line.attempt,
          round: line.round,
          request,
          body: line.body,
          bodyDigest: line.bodyDigest,
        };
      }),
    );

    await appendEvent(dir, "size_rechunk_async", {
      batchId: record.handle.batchId,
      wave: record.wave,
      round: record.round,
      fromChunk: record.chunk,
      leftChunk: left.chunk,
      rightChunk: right.chunk,
      itemIds: record.itemIds,
    });
    await writeState(dir, state);

    await submitChunks(
      dir,
      state,
      [left, right],
      renderedItems,
      record.wave,
      record.round,
      {
        provider: deps.provider,
        model: state.model.apiModelId,
        wrap: deps.wrap,
      },
    );
  }

  return null;
}

/**
 * Re-chunks any pending async size rejection FIRST (ruling: "before
 * evaluation"), then collects every ended batch and evaluates. Shared by
 * BOTH entry points that can reach a size-rejected record: `poll`'s
 * fallthrough once nothing is processing, and `nextStep` choosing
 * `"collect"` directly on a LATER call (a size rejection sets a record's
 * `state` to `"ended"`, so a subsequent call may see it as an ordinary
 * ended-uncollected record and route straight to `"collect"` without ever
 * going through `poll` again).
 */
async function runCollectThenEvaluate(
  dir: string,
  state: BatchRunState,
  deps: AdvanceDeps,
): Promise<AdvanceResult> {
  const blockedReason = await rechunkSizeRejected(dir, state, deps);
  if (blockedReason) {
    return {
      exit: 4,
      step: { kind: "blocked", reason: blockedReason },
      state,
    };
  }

  // A rechunk just resubmitted new sub-chunks, which start "processing":
  // re-poll on the NEXT call rather than evaluating a wave that still has
  // work in flight (evaluate is only correct once every batch has ended).
  if (state.batches.some((b) => b.state === "processing")) {
    return { exit: 3, step: { kind: "poll" }, state };
  }

  await collectEnded(dir, state, deps.provider, deps.mapRaw);
  return await runEvaluate(dir, state, deps, state.wave);
}

async function runPoll(
  dir: string,
  state: BatchRunState,
  deps: AdvanceDeps,
  step: Step,
): Promise<AdvanceResult> {
  const poll = await pollActive(dir, state, deps.provider);
  if (poll.anyProcessing) {
    return { exit: 3, step, state };
  }

  return await runCollectThenEvaluate(dir, state, deps);
}

/**
 * Every task whose wave item exists and has not reached `"evaluated"`,
 * rendered as `<taskId> is "<state>"` (sorted by task id) -- the stuck-item
 * listing for `runEvaluate`'s no-progress guard.
 */
function unevaluatedItemsFor(state: BatchRunState, wave: 1 | 2): string[] {
  const taskIds = Object.keys(state.tasks).sort();
  const lines: string[] = [];
  for (const taskId of taskIds) {
    const summary = state.tasks[taskId]!;
    const item = wave === 1 ? summary.attempt1 : summary.attempt2;
    if (!item || item.state === "evaluated") continue;
    lines.push(`${taskId} is "${item.state}"`);
  }
  return lines;
}

async function runEvaluate(
  dir: string,
  state: BatchRunState,
  deps: AdvanceDeps,
  wave: 1 | 2,
): Promise<AdvanceResult> {
  const lockResult = tryAcquireBenchLock(outputDirFor(dir), {
    command: `bench batch advance ${state.runId}`,
  });
  if (!lockResult.acquired) {
    const holder = lockResult.holder;
    const reason = holder
      ? `bench lock is held by pid ${holder.pid} since ${holder.startedAt} (${
        holder.command || "unknown command"
      })`
      : "bench lock is held";
    return { exit: 4, step: { kind: "blocked", reason }, state };
  }

  let runtime: ContainerRuntime | undefined;
  let outcome: { evaluated: string[]; unresolved: string[] };
  try {
    runtime = await deps.runtimeFactory();
    const environment = await runtime.environmentSet();
    const drift = await checkDrift(dir, state, { cwd: deps.cwd, environment });
    if (!drift.ok) {
      const reason = driftReason(drift.changed);
      deps.log(reason);
      return { exit: 4, step: { kind: "blocked", reason }, state };
    }

    outcome = await evaluateCollected(dir, state, wave, {
      runtime,
      taskConcurrency: deps.taskConcurrency,
      infraRetriesPerAttempt: deps.infraRetriesPerAttempt,
      manifests: deps.manifests,
      contexts: deps.contexts,
      provider: state.model.provider,
      requestedModel: state.model.apiModelId,
    });
  } finally {
    try {
      if (runtime) await runtime.stop();
    } finally {
      await lockResult.release();
    }
  }

  // Nothing evaluated, nothing left unresolved, yet the wave still has an
  // item that never reached "evaluated": every item is stuck in a state
  // `evaluateCollected` does not act on (e.g. still "pending" after a
  // collect that wrote no response files). Refuse instead of flipping the
  // phase and exiting 0 -- that used to make `advance` spin forever with no
  // progress and no signal (task 14c).
  if (outcome.evaluated.length === 0 && outcome.unresolved.length === 0) {
    const stuck = unevaluatedItemsFor(state, wave);
    if (stuck.length > 0) {
      const reason = `wave ${wave} has no evaluable item; ${
        stuck.join(", ")
      } (run status, then retry)`;
      return { exit: 4, step: { kind: "blocked", reason }, state };
    }
  }

  state.phase = wave === 1 ? "attempt-1-collected" : "attempt-2-collected";
  await writeState(dir, state);
  return { exit: 0, step: { kind: "evaluate", wave }, state };
}

/**
 * The single resubmission round (spec 4.4): mints a FRESH round-1 item id
 * per unresolved item (never reuses the round-0 id, so a late round-0
 * result can never be mistaken for this one), copies the identical
 * request/body forward, and resubmits.
 */
async function runResubmit(
  dir: string,
  state: BatchRunState,
  deps: AdvanceDeps,
  step: Extract<Step, { kind: "resubmit" }>,
): Promise<AdvanceResult> {
  const itemLines = await loadJsonl<ItemLine>(
    join(dir, RUN_FILES.items),
    (l) => l.itemId,
  );
  const byId = new Map(itemLines.map((l) => [l.itemId, l]));

  const renderedItems: RenderedItem[] = [];
  for (const oldItemId of step.itemIds) {
    const line = byId.get(oldItemId);
    if (!line) {
      throw new Error(`runResubmit: no items.jsonl entry for ${oldItemId}`);
    }
    const newItemId = await itemIdFor(
      state.runId,
      line.taskId,
      line.attempt,
      1,
    );
    const request = await readJsonFile<LLMRequest>(
      requestPath(dir, oldItemId),
    );

    const summary = state.tasks[line.taskId]!;
    const key = line.attempt === 1 ? "attempt1" as const : "attempt2" as const;
    summary[key] = {
      itemId: newItemId,
      round: 1,
      ownerRound: 1,
      state: "pending",
    };

    renderedItems.push({
      itemId: newItemId,
      taskId: line.taskId,
      attempt: line.attempt,
      round: 1,
      request,
      body: line.body,
      bodyDigest: line.bodyDigest,
    });
  }

  const chunks = chunkItems(
    renderedItems.map((r) => ({ itemId: r.itemId, body: r.body })),
    deps.provider.limits,
    deps.wrap,
  );

  const outcome = await submitChunks(
    dir,
    state,
    chunks,
    renderedItems,
    step.wave,
    1,
    { provider: deps.provider, model: state.model.apiModelId, wrap: deps.wrap },
  );

  if (outcome.kind !== "submitted") {
    const reason = outcome.kind === "rejected"
      ? outcome.lastError?.message ?? "resubmission rejected"
      : outcome.reason;
    state.lastError = outcome.kind === "rejected" ? outcome.lastError : {
      at: new Date().toISOString(),
      step: "resubmit",
      message: reason,
      retryable: false,
    };
    await writeState(dir, state);
    return { exit: 4, step: { kind: "blocked", reason }, state };
  }

  state.phase = step.wave === 1 ? "attempt-1-submitted" : "attempt-2-submitted";
  await writeState(dir, state);
  return { exit: 0, step, state };
}

/**
 * D10's fix-prompt wave: renders wave 2 for exactly `step.taskIds` (already
 * filtered to real, non-infra failures by {@link nextStep}) and submits.
 */
async function runSubmitWave2(
  dir: string,
  state: BatchRunState,
  deps: AdvanceDeps,
  step: Extract<Step, { kind: "submit-wave-2" }>,
  priorAttempts: Map<string, ExecutionAttempt>,
): Promise<AdvanceResult> {
  const inputs = await readJsonFile<FrozenPromptInputs>(
    join(dir, RUN_FILES.promptInputs),
  );

  const rendered = await renderWave(state, 2, 0, step.taskIds, {
    buildBody: deps.buildBody,
    inputs,
    manifests: deps.manifests,
    contexts: deps.contexts,
    priorAttempts,
  });

  for (const item of rendered) {
    const summary = state.tasks[item.taskId]!;
    summary.attempt2 = {
      itemId: item.itemId,
      round: 0,
      ownerRound: 0,
      state: "pending",
    };
  }

  const chunks = chunkItems(
    rendered.map((r) => ({ itemId: r.itemId, body: r.body })),
    deps.provider.limits,
    deps.wrap,
  );

  const outcome = await submitChunks(dir, state, chunks, rendered, 2, 0, {
    provider: deps.provider,
    model: state.model.apiModelId,
    wrap: deps.wrap,
  });

  if (outcome.kind !== "submitted") {
    const reason = outcome.kind === "rejected"
      ? outcome.lastError?.message ?? "wave-2 submission rejected"
      : outcome.reason;
    state.lastError = outcome.kind === "rejected" ? outcome.lastError : {
      at: new Date().toISOString(),
      step: "submit",
      message: reason,
      retryable: false,
    };
    await writeState(dir, state);
    return { exit: 4, step: { kind: "blocked", reason }, state };
  }

  state.phase = "attempt-2-submitted";
  state.wave = 2;
  await writeState(dir, state);
  return { exit: 0, step, state };
}

/**
 * Runs exactly one step of `advance` (spec 4.5) for the run at `dir`, under
 * the run's `mutate.lock`. Terminal runs (`finalized`/`abandoned`) are a
 * no-op returning `done`; a D13 drift check (spec 4.6) runs BEFORE
 * `nextStep` is even consulted and refuses (exit 4, `state` unchanged) on
 * any mismatch, naming every changed input.
 */
export async function advanceRun(
  dir: string,
  deps: AdvanceDeps,
): Promise<AdvanceResult> {
  return await withMutateLock(dir, async () => {
    const state = await loadState(dir);

    if (isTerminal(state.phase)) {
      return { exit: 0, step: { kind: "done" }, state };
    }

    const drift = await checkDrift(dir, state, { cwd: deps.cwd });
    if (!drift.ok) {
      const reason = driftReason(drift.changed);
      deps.log(reason);
      return { exit: 4, step: { kind: "blocked", reason }, state };
    }

    const intent = await readIntent(dir);
    const hasIntent = intent !== null;
    const attempts = await loadAttemptsForWave(dir, state, state.wave);
    const step = nextStep(state, hasIntent, attempts, deps.attemptLimit);

    switch (step.kind) {
      case "reconcile":
      case "blocked":
        // Task 9 owns the real `submit-unknown` reconciliation; here (and
        // for an operator-action `blocked`) `advance` has nothing more to
        // do this call.
        return { exit: 4, step, state };

      case "poll":
        return await runPoll(dir, state, deps, step);

      case "collect":
        return await runCollectThenEvaluate(dir, state, deps);

      case "evaluate":
        return await runEvaluate(dir, state, deps, step.wave);

      case "resubmit":
        return await runResubmit(dir, state, deps, step);

      case "submit-wave-2":
        return await runSubmitWave2(dir, state, deps, step, attempts);

      case "finalize": {
        const next = await deps.finalize(dir, state);
        return { exit: 0, step, state: next };
      }

      case "done":
        return { exit: 0, step, state };
    }
  });
}
