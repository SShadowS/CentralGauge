/**
 * Canonicity smoke test for the orchestrator's `stepEventName(step, kind)`.
 *
 * The orchestrator synthesizes step-level event types via `stepEventName`.
 * Every (step, kind) pair the orchestrator could emit at runtime MUST resolve
 * to a member of `CANONICAL_EVENT_TYPES` — non-canonical strings are rejected
 * by the worker with `400 invalid_event_type`. This test pins the gap
 * permanently: extend `kindsForStep` whenever a new emit-call site is added.
 *
 * @module tests/unit/lifecycle/orchestrator
 */
import { assert } from "@std/assert";
import { stepEventName } from "../../../src/lifecycle/orchestrator.ts";
import {
  CANONICAL_EVENT_TYPES,
  isCanonicalEventType,
} from "../../../src/lifecycle/types.ts";
import {
  CYCLE_STEPS,
  type CycleStep,
} from "../../../src/lifecycle/orchestrator-types.ts";

const KINDS = ["started", "completed", "failed", "skipped"] as const;

Deno.test("stepEventName: every (step, kind) returns a canonical event type", () => {
  const canonicalSet = new Set<string>(CANONICAL_EVENT_TYPES);
  for (const step of CYCLE_STEPS) {
    for (const kind of KINDS) {
      const ev = stepEventName(step, kind);
      assert(
        canonicalSet.has(ev),
        `stepEventName(${step}, ${kind}) → '${ev}' is NOT in CANONICAL_EVENT_TYPES`,
      );
      // Also exercise the runtime guard so a future regression in the type
      // alias doesn't slip past the Set check.
      assert(
        isCanonicalEventType(ev),
        `isCanonicalEventType('${ev}') should be true`,
      );
    }
  }
});

Deno.test("stepEventName: debug 'completed' aliases to 'debug.captured'", () => {
  // Sanity-pin the aliasing rule. If this changes, the worker's reduction
  // logic for the debug step state needs to update too.
  const debugStep: CycleStep = "debug-capture";
  const ev = stepEventName(debugStep, "completed");
  assert(ev === "debug.captured", `expected debug.captured, got ${ev}`);
});
