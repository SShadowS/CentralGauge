/**
 * The pure decision table `advance` runs on every call (spec sections 4.5,
 * 9). `nextStep` performs no I/O: everything it needs is either already in
 * `state`, or handed in as `hasIntent` (`intent.json` presence) and
 * `attempts` (every `ExecutionAttempt` already on disk for the run's
 * CURRENT wave, keyed by task id). That is what keeps the whole transition
 * table testable as a plain function over four arguments (spec 4.5's
 * table, `tests/unit/batch/transitions.test.ts`).
 *
 * `attempts` is used ONLY to decide wave-2 eligibility (D10: a task with a
 * real, non-infra-synthesized failure gets a fix attempt), never to decide
 * whether a task's current-wave item is resolved. That is
 * `ItemSummary.state === "evaluated"` alone, set by `evaluateCollected`
 * (`src/batch/evaluate.ts`) the moment it writes the attempt file; a task
 * can therefore be "resolved" here even when the caller's `attempts` map
 * happens not to carry it (a stale/partial map, or simply not needed for
 * this call), which is exactly what lets `nextStep` be a function of
 * `state` first and `attempts` only for the one decision that needs it.
 *
 * @module src/batch/transitions
 */
import type { ExecutionAttempt } from "../tasks/interfaces.ts";
import type { BatchRunState, ItemSummary, TaskSummary } from "./state.ts";

/** One step `advance` executes this call (spec 4.5's transition table). */
export type Step =
  | { kind: "reconcile" } // intent.json present without its handle
  | { kind: "poll" } // any active batch processing
  | { kind: "collect" } // all active batches ended, some uncollected
  | { kind: "evaluate"; wave: 1 | 2 } // collected, attempts missing
  | { kind: "submit-pending"; wave: 1 | 2 } // journaled items never submitted
  | {
    kind: "resubmit";
    wave: 1 | 2;
    itemIds: string[];
  } // attempt-N-collected, unresolved retryable items, round 0 complete
  | { kind: "submit-wave-2"; taskIds: string[] }
  | { kind: "finalize" }
  | { kind: "done" } // finalized | abandoned
  | { kind: "blocked"; reason: string }; // lastError non-retryable, size-blocked item, operator action

function itemFor(summary: TaskSummary, wave: 1 | 2): ItemSummary | undefined {
  return wave === 1 ? summary.attempt1 : summary.attempt2;
}

/**
 * D10 (and the "never a third round" rule): an item is eligible for the
 * SINGLE resubmission round exactly when it is still errored/expired, is
 * still at round 0, and the provider did not call the error terminal. A
 * round-1 error is terminal and must be evaluated into a failed attempt
 * instead, never resubmitted again, and so is a non-retryable round-0 one
 * (an `invalid_request` would be refused identically the second time).
 */
function isResubmitEligible(item: ItemSummary): boolean {
  return (item.state === "errored" || item.state === "expired") &&
    item.round === 0 && item.retryable !== false;
}

/**
 * Every item id named by a `BatchRecord` the run still counts as evidence
 * that the item reached the provider. A `"pending"` item named here is
 * legitimately in flight; a `"pending"` item NOT named here was journaled
 * but never submitted (a rejected chunk, or a crash between the state
 * write and the provider call) and is what `submit-pending` recovers.
 */
export function liveBatchItemIds(state: BatchRunState): Set<string> {
  const ids = new Set<string>();
  for (const record of state.batches) {
    if (record.superseded) continue;
    for (const id of record.itemIds) ids.add(id);
  }
  return ids;
}

/**
 * The item ids of `wave` that are still `"pending"` and not named by any
 * live batch record, sorted by task id. Non-empty exactly when a
 * submission for this wave was journaled but never completed, which is
 * what {@link nextStep} routes to `submit-pending` and what
 * `runEvaluate` reads to know it must not flip the phase yet.
 */
export function pendingUnsubmittedItemIds(
  state: BatchRunState,
  wave: 1 | 2,
): string[] {
  const named = liveBatchItemIds(state);
  const out: string[] = [];
  for (const taskId of Object.keys(state.tasks).sort()) {
    const item = itemFor(state.tasks[taskId]!, wave);
    if (!item) continue;
    if (item.state === "pending" && !named.has(item.itemId)) {
      out.push(item.itemId);
    }
  }
  return out;
}

/**
 * `*-submitted`: refresh while anything is processing, else collect, else
 * finish an interrupted submission (a chunk the provider refused, so its
 * items are journaled but in no live record), else evaluate.
 */
function stepForSubmitted(state: BatchRunState): Step {
  if (state.batches.some((b) => !b.superseded && b.state === "processing")) {
    return { kind: "poll" };
  }
  if (
    state.batches.some((b) =>
      !b.superseded && b.state === "ended" && !b.collected
    )
  ) {
    return { kind: "collect" };
  }
  if (pendingUnsubmittedItemIds(state, state.wave).length > 0) {
    return { kind: "submit-pending", wave: state.wave };
  }
  return { kind: "evaluate", wave: state.wave };
}

/**
 * `*-collected`: finish an interrupted submission first (any journaled
 * item of this wave that never reached the provider, spec 4.3's crash
 * case and a partially rejected chunk set), then resubmit round-0
 * unresolved items (they must clear before anything else in the wave can
 * finalize); otherwise evaluate whatever hasn't reached `"evaluated"` yet
 * (a never-tried `"responded"` item, or a round-1 error/expiry that still
 * needs to become a terminal failed attempt); otherwise the wave is fully
 * resolved, so decide between a wave-2 submission and finalizing.
 *
 * `submit-pending` deliberately outranks `resubmit`: round 1 is only
 * eligible once every item of round 0 is accounted for (spec 4.4), and an
 * item that was never submitted is not accounted for.
 */
function stepForCollected(
  state: BatchRunState,
  attempts: Map<string, ExecutionAttempt>,
  attemptLimit: 1 | 2,
): Step {
  const wave = state.wave;
  const taskIds = Object.keys(state.tasks).sort();

  const resubmitIds: string[] = [];
  let anyPendingEvaluate = false;

  for (const taskId of taskIds) {
    const summary = state.tasks[taskId]!;
    const item = itemFor(summary, wave);
    if (!item) continue;
    if (item.state === "evaluated") continue;
    if (isResubmitEligible(item)) {
      resubmitIds.push(item.itemId);
    } else {
      anyPendingEvaluate = true;
    }
  }

  if (pendingUnsubmittedItemIds(state, wave).length > 0) {
    return { kind: "submit-pending", wave };
  }
  if (resubmitIds.length > 0) {
    return { kind: "resubmit", wave, itemIds: resubmitIds };
  }
  if (anyPendingEvaluate) {
    return { kind: "evaluate", wave };
  }

  // Every task has a terminal outcome for this wave.
  if (wave === 2) {
    return { kind: "finalize" };
  }
  if (attemptLimit === 1) {
    return { kind: "finalize" };
  }
  // A task whose `attempt2` summary already exists was minted by an
  // earlier `submit-wave-2` (which journals and persists the summaries
  // BEFORE the provider call), so re-rendering it would submit and bill it
  // twice. `submit-pending` above owns whatever of that wave never
  // reached the provider.
  const minted = taskIds.filter((id) =>
    state.tasks[id]!.attempt2 !== undefined
  );
  const eligible = taskIds.filter((id) => {
    if (state.tasks[id]!.attempt2 !== undefined) return false;
    const a = attempts.get(id);
    return a !== undefined && !a.success && !a.infraSynthesized;
  });
  if (eligible.length === 0) {
    if (minted.length > 0) {
      // Wave-2 items exist while `state.wave` still says 1: the two are
      // written together, so this is a corrupted or hand-edited state.
      // Finalizing here would score the run with attempt 1 only.
      return {
        kind: "blocked",
        reason:
          `wave is 1 but attempt-2 items exist for ${minted.join(", ")}; ` +
          `run status and repair state.json before advancing`,
      };
    }
    return { kind: "finalize" };
  }
  return { kind: "submit-wave-2", taskIds: eligible };
}

/**
 * The pure transition table (spec 4.5): decides the ONE step `advance`
 * should execute next.
 *
 * Priority order: an `intent.json` leftover from a crash between submit
 * and the handle being persisted always wins (reconcile, spec 4.3):
 * whatever `state.phase` says, a live intent is stronger evidence than a
 * possibly-stale phase. Next, a non-retryable `lastError` blocks: nothing
 * in `advance` acts on it automatically, only the `retry` command does.
 * Everything else is decided per `state.phase`.
 */
export function nextStep(
  state: BatchRunState,
  hasIntent: boolean,
  attempts: Map<string, ExecutionAttempt>,
  attemptLimit: 1 | 2,
): Step {
  if (hasIntent) return { kind: "reconcile" };
  if (state.lastError && !state.lastError.retryable) {
    return { kind: "blocked", reason: state.lastError.message };
  }

  if (state.phase === "finalized" || state.phase === "abandoned") {
    return { kind: "done" };
  }

  // An ended-but-uncollected batch always wins over whatever the phase
  // itself would otherwise decide (poll still wins over collect: a
  // processing batch means more work is still in flight). This is what
  // makes an operator's `collected: false` repair (or a collect step that
  // ended a batch without yet running) actually take effect from ANY
  // non-terminal phase, not only `*-submitted` -- previously `*-collected`
  // never looked at `state.batches` at all, so a batch left uncollected
  // there fell through to `stepForCollected`, which can return `evaluate`
  // on items that are still `"pending"` and therefore un-evaluable
  // (`evaluateCollected` only picks up `responded`/`errored`/`expired`),
  // silently spinning `advance` at exit 0 forever.
  if (state.batches.some((b) => !b.superseded && b.state === "processing")) {
    return { kind: "poll" };
  }
  if (
    state.batches.some((b) =>
      !b.superseded && b.state === "ended" && !b.collected
    )
  ) {
    return { kind: "collect" };
  }

  switch (state.phase) {
    case "attempt-1-submitted":
    case "attempt-2-submitted":
      return stepForSubmitted(state);

    case "attempt-1-collected":
    case "attempt-2-collected":
      return stepForCollected(state, attempts, attemptLimit);

    // A run that reached `finalizing` and stopped there (a crash mid-write,
    // or an ingest that threw) resumes by finalizing again: `finalizeRun`
    // re-uses the deterministic results path and skips an ingest that
    // already succeeded, so re-entry is safe and is the only way out of
    // this phase.
    case "finalizing":
      return { kind: "finalize" };

    // `prepared`/`submitting` are `submit`'s territory, not `advance`'s;
    // `submit-unknown` without a live intent is an inconsistent state (it
    // only ever arises FROM a live intent). Neither has a step for
    // `advance` to take on its own; an operator command (`submit`,
    // `retry`, `abandon`) is required.
    case "prepared":
    case "submitting":
    case "submit-unknown":
    default:
      return {
        kind: "blocked",
        reason: `advance has no automatic action for phase "${state.phase}"`,
      };
  }
}
