// tests/unit/batch/transitions.test.ts
//
// The pure decision table for `advance` (spec 4.5). `nextStep` performs no
// I/O, so this test drives it directly as a function of its four
// arguments, building states with `minimalState`/`record`/`task`/`attempt`
// from `tests/utils/batch-fixtures.ts`.
import { assert, assertEquals } from "@std/assert";
import { nextStep } from "../../../src/batch/transitions.ts";
import type { ExecutionAttempt } from "../../../src/tasks/interfaces.ts";
import {
  attempt,
  minimalState,
  record,
  task,
} from "../../utils/batch-fixtures.ts";

Deno.test("nextStep walks the spec 4.5 table", () => {
  // A live intent always wins, regardless of phase.
  assertEquals(
    nextStep(minimalState({ phase: "prepared" }), true, new Map(), 2).kind,
    "reconcile",
  );

  // *-submitted: processing -> poll.
  const processing = minimalState({
    phase: "attempt-1-submitted",
    batches: [record({ state: "processing" })],
    activeBatchIds: ["b1"],
  });
  assertEquals(nextStep(processing, false, new Map(), 2).kind, "poll");

  // *-submitted: ended, not collected -> collect.
  const ended = minimalState({
    phase: "attempt-1-submitted",
    batches: [record({ state: "ended", collected: false })],
    activeBatchIds: ["b1"],
  });
  assertEquals(nextStep(ended, false, new Map(), 2).kind, "collect");

  // *-submitted: ended and collected, an item still pending -> evaluate.
  const collected = minimalState({
    phase: "attempt-1-submitted",
    batches: [record({ state: "ended", collected: true })],
    tasks: { A: task("responded") },
  });
  assertEquals(nextStep(collected, false, new Map(), 2), {
    kind: "evaluate",
    wave: 1,
  });

  // *-collected: a round-0 errored item with no attempt yet -> resubmit,
  // naming its (old) item id; an already-evaluated task is skipped.
  const taskA = task("errored", 0);
  const unresolved = minimalState({
    phase: "attempt-1-collected",
    tasks: { A: taskA, B: task("evaluated") },
  });
  assertEquals(
    nextStep(
      unresolved,
      false,
      new Map<string, ExecutionAttempt>([["B", attempt(false)]]),
      2,
    ),
    { kind: "resubmit", wave: 1, itemIds: [taskA.attempt1.itemId] },
  );

  // *-collected: everything evaluated, one real failure and attemptLimit 2
  // -> submit-wave-2 naming only the failed task.
  const allEvaluated = minimalState({
    phase: "attempt-1-collected",
    tasks: { A: task("evaluated"), B: task("evaluated") },
  });
  assertEquals(
    nextStep(
      allEvaluated,
      false,
      new Map<string, ExecutionAttempt>([
        ["A", attempt(true)],
        ["B", attempt(false)],
      ]),
      2,
    ),
    { kind: "submit-wave-2", taskIds: ["B"] },
  );

  // Same state, attemptLimit 1 -> finalize outright (no wave 2 exists).
  assertEquals(
    nextStep(
      allEvaluated,
      false,
      new Map<string, ExecutionAttempt>([
        ["A", attempt(true)],
        ["B", attempt(false)],
      ]),
      1,
    ).kind,
    "finalize",
  );

  // Same state, both tasks actually succeeded -> nothing eligible -> finalize.
  assertEquals(
    nextStep(
      allEvaluated,
      false,
      new Map<string, ExecutionAttempt>([
        ["A", attempt(true)],
        ["B", attempt(true)],
      ]),
      2,
    ).kind,
    "finalize",
  );

  // attempt-2-collected, everything evaluated -> finalize (no wave 3).
  assertEquals(
    nextStep(
      minimalState({
        phase: "attempt-2-collected",
        tasks: { B: task("evaluated") },
      }),
      false,
      new Map(),
      2,
    ).kind,
    "finalize",
  );

  // `finalizing` is resumable, not a dead end: a crash mid-finalize (or an
  // ingest that threw) leaves the phase there, and the next tick finalizes
  // again -- `finalizeRun` re-uses the results file and the ingest marker.
  assertEquals(
    nextStep(minimalState({ phase: "finalizing" }), false, new Map(), 2).kind,
    "finalize",
  );

  // Terminal phases -> done.
  assertEquals(
    nextStep(minimalState({ phase: "finalized" }), false, new Map(), 2).kind,
    "done",
  );

  // A non-retryable lastError blocks, regardless of phase.
  assertEquals(
    nextStep(
      minimalState({
        phase: "prepared",
        lastError: {
          at: "t",
          step: "submit",
          message: "x",
          retryable: false,
        },
      }),
      false,
      new Map(),
      2,
    ).kind,
    "blocked",
  );

  // Round-1 errors become failed attempts on the NEXT evaluate, never a
  // third resubmission round.
  const secondRoundErrored = minimalState({
    phase: "attempt-1-collected",
    tasks: { A: task("errored", 1) },
  });
  assertEquals(nextStep(secondRoundErrored, false, new Map(), 2), {
    kind: "evaluate",
    wave: 1,
  });

  // An ended-but-uncollected batch wins from `*-collected` too, not only
  // `*-submitted` (the bug behind the silent stuck loop, task 14c): a
  // `stepForCollected` phase never looked at `state.batches` before this
  // fix, so an operator's `collected: false` repair had no effect.
  const collectedPhaseEnded = minimalState({
    phase: "attempt-1-collected",
    batches: [record({ state: "ended", collected: false })],
    activeBatchIds: ["b1"],
    tasks: { A: task("pending") },
  });
  assertEquals(
    nextStep(collectedPhaseEnded, false, new Map(), 2).kind,
    "collect",
  );

  // Poll still wins over collect in `*-collected`: a processing batch means
  // more work is in flight, regardless of any other ended-but-uncollected
  // batch.
  const collectedPhaseProcessing = minimalState({
    phase: "attempt-1-collected",
    batches: [record({ state: "processing" })],
    activeBatchIds: ["b1"],
    tasks: { A: task("pending") },
  });
  assertEquals(
    nextStep(collectedPhaseProcessing, false, new Map(), 2).kind,
    "poll",
  );

  // Same check, `attempt-2-collected`.
  const attempt2CollectedEnded = minimalState({
    phase: "attempt-2-collected",
    wave: 2,
    batches: [record({ state: "ended", collected: false, wave: 2 })],
    activeBatchIds: ["b1"],
    tasks: { A: task("pending") },
  });
  assertEquals(
    nextStep(attempt2CollectedEnded, false, new Map(), 2).kind,
    "collect",
  );
});
Deno.test("nextStep routes a journaled-but-unsubmitted item to submit-pending", () => {
  // A wave-2 chunk was rejected (or the process died before the provider
  // call): the item is `"pending"` and no batch record names it.
  const rejected = task("pending");
  const collected = minimalState({
    phase: "attempt-1-collected",
    tasks: { A: task("evaluated"), B: rejected },
  });
  assertEquals(nextStep(collected, false, new Map(), 2), {
    kind: "submit-pending",
    wave: 1,
  });

  // The same item, once a batch record names it, is in flight: it is
  // evaluate's problem, never submit-pending's.
  const inFlight = minimalState({
    phase: "attempt-1-collected",
    batches: [
      record({
        state: "ended",
        collected: true,
        itemIds: [rejected.attempt1.itemId],
      }),
    ],
    tasks: { A: task("evaluated"), B: rejected },
  });
  assertEquals(nextStep(inFlight, false, new Map(), 2), {
    kind: "evaluate",
    wave: 1,
  });

  // submit-pending outranks the single resubmission round: round 1 is only
  // eligible once every round-0 item is accounted for (spec 4.4).
  const bothConditions = minimalState({
    phase: "attempt-1-collected",
    tasks: { A: task("errored", 0), B: rejected },
  });
  assertEquals(
    nextStep(bothConditions, false, new Map(), 2).kind,
    "submit-pending",
  );

  // A wave-2 item that was already minted is never re-rendered by
  // submit-wave-2. Nothing writes this state (wave and the summaries are
  // persisted together), so reaching it means the file was corrupted:
  // refuse rather than finalize the run with attempt 1 only.
  const mintedButWaveOne = minimalState({
    phase: "attempt-1-collected",
    tasks: {
      A: {
        attempt1: {
          itemId: "item-a1",
          round: 0,
          ownerRound: 0,
          state: "evaluated",
        },
        attempt2: {
          itemId: "item-a2",
          round: 0,
          ownerRound: 0,
          state: "evaluated",
        },
      },
    },
  });
  const step = nextStep(
    mintedButWaveOne,
    false,
    new Map<string, ExecutionAttempt>([["A", attempt(false)]]),
    2,
  );
  assertEquals(step.kind, "blocked");
  if (step.kind === "blocked") {
    assert(step.reason.includes("A"), step.reason);
  }
});

Deno.test("nextStep never resubmits an item the provider called terminal", () => {
  // A retryable round-0 error is the resubmission round's whole purpose.
  const retryable = task("errored", 0);
  retryable.attempt1.retryable = true;
  assertEquals(
    nextStep(
      minimalState({
        phase: "attempt-1-collected",
        tasks: { A: retryable },
      }),
      false,
      new Map(),
      2,
    ).kind,
    "resubmit",
  );

  // A non-retryable one (an invalid_request would be refused identically
  // the second time) becomes a terminal failed attempt instead.
  const terminal = task("errored", 0);
  terminal.attempt1.retryable = false;
  assertEquals(
    nextStep(
      minimalState({
        phase: "attempt-1-collected",
        tasks: { A: terminal },
      }),
      false,
      new Map(),
      2,
    ),
    { kind: "evaluate", wave: 1 },
  );
});
