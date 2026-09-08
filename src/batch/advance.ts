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
import { reconcileSubmitUnknown } from "./reconcile.ts";
import { attemptPath, requestPath, RUN_FILES } from "./paths.ts";
import type { RenderedItem } from "./render.ts";
import { renderWave } from "./render.ts";
import { resubmitPending } from "./resubmit.ts";
import { nextStep, pendingUnsubmittedItemIds } from "./transitions.ts";
import type { Step } from "./transitions.ts";
import type { BatchRunState } from "./state.ts";
import { isTerminal, loadState, writeState } from "./state.ts";
import { journalItems, submitChunks } from "./submit-wave.ts";
import type { FrozenPromptInputs } from "../parallel/shared/prompt-inputs.ts";

export interface AdvanceDeps {
  provider: BatchProvider;
  buildBody: (r: LLMRequest) => unknown;
  wrap: (items: BatchItem[]) => unknown;
  mapRaw: (raw: unknown, itemId: string) => LLMResponse;
  /** Started lazily, only for the `evaluate` step. */
  runtimeFactory: () => Promise<ContainerRuntime>;
  cwd: string;
  /**
   * `benchmark.templateDir` (default `templates`), resolved exactly as
   * `renderLLMRequest` resolves it. The D13 template digests must be taken
   * over the directory a wave-2 render actually reads.
   */
  templateDir: string;
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
 * chunk number for the new half. The dead record is marked `superseded`,
 * so its items count as un-submitted again and a refusal is recoverable.
 * Returns a blocking reason when a single-item chunk cannot be split
 * further (operator-blocked) or when the halves themselves were refused;
 * `null` otherwise.
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
    // The items move to the halves below: this record stops being evidence
    // that they are in flight, so a rejected resubmission leaves them
    // recoverable by `submit-pending`/`retry` instead of stranded.
    record.superseded = true;

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

    const outcome = await submitChunks(
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

    if (outcome.kind !== "submitted") {
      // The halves were refused (an OpenRouter creation-rate 429 is the
      // likely case). Record why, exactly as a rejected wave submission
      // does: the items are journaled, pending and named by no live
      // record, so `submit-pending`/`retry` picks up exactly them.
      const reason = outcome.kind === "rejected"
        ? outcome.lastError?.message ?? "size re-chunk resubmission rejected"
        : outcome.reason;
      state.lastError = outcome.kind === "rejected" && outcome.lastError
        ? outcome.lastError
        : {
          at: new Date().toISOString(),
          step: "size_rechunk",
          message: reason,
          retryable: false,
        };
      await writeState(dir, state);
      return reason;
    }
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
 * listing for `runEvaluate`'s no-progress guard. An item that is merely
 * awaiting (re)submission is NOT stuck: `submit-pending` is its next step,
 * so it is excluded rather than reported as a reason to refuse.
 */
function unevaluatedItemsFor(state: BatchRunState, wave: 1 | 2): string[] {
  const awaiting = new Set(pendingUnsubmittedItemIds(state, wave));
  const taskIds = Object.keys(state.tasks).sort();
  const lines: string[] = [];
  for (const taskId of taskIds) {
    const summary = state.tasks[taskId]!;
    const item = wave === 1 ? summary.attempt1 : summary.attempt2;
    if (!item || item.state === "evaluated") continue;
    if (awaiting.has(item.itemId)) continue;
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
    const drift = await checkDrift(dir, state, {
      cwd: deps.cwd,
      templateDir: deps.templateDir,
      environment,
    });
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

  // An item of this wave was journaled but never reached the provider (a
  // rejected chunk, or a crash between the state write and the submission).
  // Flipping the phase here would advance the run past a wave that is not
  // fully submitted; `submit-pending` takes precedence on the next call.
  if (pendingUnsubmittedItemIds(state, wave).length > 0) {
    return { exit: 0, step: { kind: "evaluate", wave }, state };
  }

  state.phase = wave === 1 ? "attempt-1-collected" : "attempt-2-collected";
  await writeState(dir, state);
  return { exit: 0, step: { kind: "evaluate", wave }, state };
}

/**
 * Submits every journaled item of the run that no `BatchRecord` names yet
 * (spec 4.3's crash case and a partially rejected chunk set), through the
 * one shared submission path in `src/batch/resubmit.ts`. `submit-wave-2`
 * and `resubmit` both finish through here too, so an item that already
 * reached the provider is never submitted a second time.
 */
async function runSubmitPending(
  dir: string,
  state: BatchRunState,
  deps: AdvanceDeps,
  step: Step,
): Promise<AdvanceResult> {
  const outcome = await resubmitPending(dir, state, deps);
  if (outcome.exit !== 0) {
    return {
      exit: 4,
      step: { kind: "blocked", reason: outcome.message },
      state,
    };
  }
  return { exit: 0, step, state };
}

/**
 * The single resubmission round (spec 4.4): mints a FRESH round-1 item id
 * per unresolved item (never reuses the round-0 id, so a late round-0
 * result can never be mistaken for this one), copies the identical
 * request/body forward, and resubmits.
 *
 * The new items are journaled and their `ItemSummary`s persisted as
 * `"pending"` BEFORE the provider is called, so a rejection or a crash
 * leaves exactly the un-submitted ones recoverable (`submit-pending`,
 * `retry`) instead of re-minting the whole round.
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

  await journalItems(dir, chunks, renderedItems, step.wave, 1);

  for (const item of renderedItems) {
    const summary = state.tasks[item.taskId]!;
    const key = item.attempt === 1 ? "attempt1" as const : "attempt2" as const;
    summary[key] = {
      itemId: item.itemId,
      round: 1,
      ownerRound: 1,
      state: "pending",
    };
  }
  await writeState(dir, state);

  return await runSubmitPending(dir, state, deps, step);
}

/**
 * D10's fix-prompt wave: renders wave 2 for exactly `step.taskIds` (already
 * filtered to real, non-infra failures by {@link nextStep}) and submits.
 *
 * The rendered items are journaled and `state.json` is rewritten with the
 * new `attempt2` summaries (`"pending"`) and `wave: 2` BEFORE the provider
 * is called. `nextStep` therefore never chooses `submit-wave-2` twice for
 * the same task: once a summary exists, `submit-pending` owns whatever of
 * the wave did not reach the provider, so a partial rejection or a crash
 * can never re-render and re-bill an item that was already submitted.
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

  const chunks = chunkItems(
    rendered.map((r) => ({ itemId: r.itemId, body: r.body })),
    deps.provider.limits,
    deps.wrap,
  );

  await journalItems(dir, chunks, rendered, 2, 0);

  for (const item of rendered) {
    const summary = state.tasks[item.taskId]!;
    summary.attempt2 = {
      itemId: item.itemId,
      round: 0,
      ownerRound: 0,
      state: "pending",
    };
  }
  state.wave = 2;
  await writeState(dir, state);

  return await runSubmitPending(dir, state, deps, step);
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

    const drift = await checkDrift(dir, state, {
      cwd: deps.cwd,
      templateDir: deps.templateDir,
    });
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
      case "reconcile": {
        // Spec 4.5: "advance: reconcile per 4.3, exit 4 unless adopted".
        // Identification is exact or nothing (`reconcileSubmitUnknown`
        // adopts only on OpenAI's nonce or an exact item-id set match), so
        // running it unattended is safe: nothing is ever resubmitted here.
        const report = await reconcileSubmitUnknown(
          dir,
          state,
          deps.provider,
          intent!,
        );
        if (report.adopted) {
          deps.log(
            `[batch] adopted candidate ${report.adopted.handle.batchId}`,
          );
          // The run is `attempt-<wave>-submitted` again; carry on with the
          // step that phase deserves rather than costing a whole tick.
          return await runPoll(dir, state, deps, { kind: "poll" });
        }
        const ids = report.candidates.map((c) => c.batchId).join(", ") ||
          "(none)";
        return {
          exit: 4,
          step: {
            kind: "blocked",
            reason: `${report.reason}; candidates: ${ids}`,
          },
          state,
        };
      }

      case "blocked":
        // An operator-action `blocked`: `advance` has nothing more to do.
        return { exit: 4, step, state };

      case "poll":
        return await runPoll(dir, state, deps, step);

      case "collect":
        return await runCollectThenEvaluate(dir, state, deps);

      case "evaluate":
        return await runEvaluate(dir, state, deps, step.wave);

      case "submit-pending":
        return await runSubmitPending(dir, state, deps, step);

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
