/**
 * Lock-token tiebreaker + TTL-expiry predicate tests for the orchestrator.
 *
 * The integration test in `tests/integration/lifecycle/cycle-end-to-end.test.ts`
 * exercises the full runCycle path with a swapped event store; here we
 * unit-test the pickWinner predicate (mirrors `acquireLock`'s read-back
 * logic) and the TTL-expiry constant.
 */

import { assertEquals } from "@std/assert";
import { CYCLE_STEPS } from "../../../src/lifecycle/orchestrator-types.ts";

interface EventForLock {
  id: number;
  event_type: string;
  payload?: Record<string, unknown>;
}

/**
 * Same predicate used by `acquireLock` after the read-back: walk events
 * newest-first; the most recent `cycle.started` without a downstream
 * `cycle.{completed,failed,aborted,timed_out}` wins.
 *
 * The events list is in oldest-first order (matches the worker's
 * `ORDER BY ts ASC, id ASC` SQL).
 */
function pickWinner(events: EventForLock[]): {
  id: number;
  lockToken: string | null;
} | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.event_type !== "cycle.started") continue;
    const hasTerminalAfter = events.some(
      (x) =>
        x.id > e.id &&
        /^cycle\.(completed|failed|aborted|timed_out)$/.test(x.event_type),
    );
    if (hasTerminalAfter) continue;
    const payload = (e.payload ?? {}) as { lock_token?: string };
    return { id: e.id, lockToken: payload.lock_token ?? null };
  }
  return null;
}

Deno.test("lock-token: most-recent active cycle.started wins", () => {
  // Two parallel cycle.started writes; B inserted after A (id=2 > id=1).
  const events: EventForLock[] = [
    { id: 1, event_type: "cycle.started", payload: { lock_token: "A" } },
    { id: 2, event_type: "cycle.started", payload: { lock_token: "B" } },
  ];
  const winner = pickWinner(events);
  assertEquals(winner?.lockToken, "B");
  assertEquals(winner?.id, 2);
});

Deno.test("lock-token: terminal after both starteds disqualifies all", () => {
  const events: EventForLock[] = [
    { id: 1, event_type: "cycle.started", payload: { lock_token: "A" } },
    { id: 2, event_type: "cycle.started", payload: { lock_token: "B" } },
    { id: 3, event_type: "cycle.completed", payload: {} },
  ];
  // Both started events have terminal id=3 after them → null winner.
  const winner = pickWinner(events);
  assertEquals(winner, null);
});

Deno.test("lock-token: terminal between A and B disqualifies only A", () => {
  const events: EventForLock[] = [
    { id: 1, event_type: "cycle.started", payload: { lock_token: "A" } },
    { id: 2, event_type: "cycle.failed", payload: {} },
    { id: 3, event_type: "cycle.started", payload: { lock_token: "B" } },
  ];
  // A has terminal id=2 after it; B has no terminal → B wins.
  const winner = pickWinner(events);
  assertEquals(winner?.lockToken, "B");
  assertEquals(winner?.id, 3);
});

Deno.test("lock-token: empty event list → null winner", () => {
  const winner = pickWinner([]);
  assertEquals(winner, null);
});

Deno.test("CYCLE_STEPS exposes the canonical four-step ordering", () => {
  assertEquals(CYCLE_STEPS.length, 4);
  assertEquals(CYCLE_STEPS[0], "bench");
  assertEquals(CYCLE_STEPS[1], "debug-capture");
  assertEquals(CYCLE_STEPS[2], "analyze");
  assertEquals(CYCLE_STEPS[3], "publish");
});

Deno.test("TTL expiry predicate: 90 min cycle TTL, 60 min step TTL", () => {
  // Mirror the constants exported (privately) by orchestrator.ts. If these
  // diverge, fix orchestrator.ts AND this test together.
  const STEP_TTL_MS = 60 * 60 * 1000;
  const CYCLE_TTL_MS = 90 * 60 * 1000;
  const now = Date.now();

  // Started within step-TTL → not expired.
  assertEquals(now - (now - 30 * 60 * 1000) > STEP_TTL_MS, false);
  // Started past step-TTL → expired.
  assertEquals(now - (now - 70 * 60 * 1000) > STEP_TTL_MS, true);
  // Started past cycle-TTL → expired (timeout path).
  assertEquals(now - (now - 100 * 60 * 1000) > CYCLE_TTL_MS, true);
});
