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

Deno.test("defaultDispatchStep throws on unhandled CycleStep (I5)", async () => {
  // Defensive default branch. The switch over `CycleStep` is exhaustive
  // at compile time, but a future expansion that doesn't update the
  // dispatcher would silently fall through to `undefined` (returning a
  // rejected Promise resolves to `undefined.then` → TypeError) instead of
  // a clear "unhandled step" error. Pin the default-branch behavior here.
  const { defaultDispatchStep } = await import(
    "../../../src/lifecycle/orchestrator.ts"
  );
  const fakeCtx = {
    modelSlug: "x",
    taskSetHash: "h",
    lockToken: "t",
    envelope: {},
    toolVersions: {},
    analyzerModel: "m",
    dryRun: false,
    cwd: ".",
  };
  let caught: Error | null = null;
  try {
    // Cast to bypass the strict union — simulates "the union grew but
    // the dispatcher didn't".
    await defaultDispatchStep(
      "wat" as unknown as CycleStep,
      fakeCtx,
    );
  } catch (e) {
    caught = e as Error;
  }
  assert(caught, "expected default branch to throw");
  assert(
    /unhandled step/i.test(caught.message),
    `expected 'unhandled step' in error, got: ${caught.message}`,
  );
});

Deno.test("stepEventName: debug 'completed' aliases to 'debug.captured'", () => {
  // Sanity-pin the aliasing rule. If this changes, the worker's reduction
  // logic for the debug step state needs to update too.
  const debugStep: CycleStep = "debug-capture";
  const ev = stepEventName(debugStep, "completed");
  assert(ev === "debug.captured", `expected debug.captured, got ${ev}`);
});
