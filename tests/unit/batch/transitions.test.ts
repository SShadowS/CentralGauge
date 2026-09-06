// tests/unit/batch/transitions.test.ts
//
// The pure decision table for `advance` (spec 4.5). `nextStep` performs no
// I/O, so this test drives it directly as a function of its four
// arguments, building states with `minimalState`/`record`/`task`/`attempt`
// from `tests/utils/batch-fixtures.ts`.
import { assertEquals } from "@std/assert";
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
});
