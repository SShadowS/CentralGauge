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
 * SINGLE resubmission round exactly when it is still errored/expired AND
 * still at round 0. A round-1 error is terminal and must be evaluated
 * into a failed attempt instead, never resubmitted again.
 */
function isResubmitEligible(item: ItemSummary): boolean {
  return (item.state === "errored" || item.state === "expired") &&
    item.round === 0;
}

/** `*-submitted`: refresh while anything is processing, else collect, else evaluate. */
function stepForSubmitted(state: BatchRunState): Step {
  if (state.batches.some((b) => b.state === "processing")) {
    return { kind: "poll" };
  }
  if (state.batches.some((b) => b.state === "ended" && !b.collected)) {
    return { kind: "collect" };
  }
  return { kind: "evaluate", wave: state.wave };
}

/**
 * `*-collected`: resubmit round-0 unresolved items first (they must clear
 * before anything else in the wave can finalize); otherwise evaluate
 * whatever hasn't reached `"evaluated"` yet (a never-tried `"responded"`
 * item, or a round-1 error/expiry that still needs to become a terminal
 * failed attempt); otherwise the wave is fully resolved, so decide between
 * a wave-2 submission and finalizing.
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
  const eligible = taskIds.filter((id) => {
    const a = attempts.get(id);
    return a !== undefined && !a.success && !a.infraSynthesized;
  });
  if (eligible.length === 0) {
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

  switch (state.phase) {
    case "finalized":
    case "abandoned":
      return { kind: "done" };

    case "attempt-1-submitted":
    case "attempt-2-submitted":
      return stepForSubmitted(state);

    case "attempt-1-collected":
    case "attempt-2-collected":
      return stepForCollected(state, attempts, attemptLimit);

    // `prepared`/`submitting` are `submit`'s territory, not `advance`'s;
    // `submit-unknown` without a live intent is an inconsistent state (it
    // only ever arises FROM a live intent); `finalizing` mid-flight with no
    // more automatic action to take. None of these has a step for `advance`
    // to take on its own; an operator command (`submit`, `retry`,
    // `abandon`) is required.
    case "prepared":
    case "submitting":
    case "submit-unknown":
    case "finalizing":
    default:
      return {
        kind: "blocked",
        reason: `advance has no automatic action for phase "${state.phase}"`,
      };
  }
}
