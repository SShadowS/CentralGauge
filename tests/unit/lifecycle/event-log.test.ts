import { describe, it } from "@std/testing/bdd";
import {
  assert,
  assertEquals,
  assertExists,
  assertFalse,
  assertRejects,
} from "@std/assert";
import {
  CANONICAL_ACTORS,
  CANONICAL_EVENT_TYPES,
  isCanonicalActor,
  isCanonicalEventType,
  type LifecycleEvent,
} from "../../../src/lifecycle/types.ts";
import {
  buildAppendBody,
  computePayloadHash,
  reduceCurrentState,
} from "../../../src/lifecycle/event-log.ts";

describe("event-log", () => {
  it("computePayloadHash is stable for canonically equivalent payloads", async () => {
    const h1 = await computePayloadHash({ a: 1, b: 2 });
    const h2 = await computePayloadHash({ b: 2, a: 1 });
    assertEquals(h1, h2);
  });

  it("buildAppendBody assembles a versioned envelope with payload", async () => {
    const body = await buildAppendBody({
      ts: 1000,
      model_slug: "anthropic/claude-opus-4-6",
      task_set_hash: "h",
      event_type: "bench.completed",
      payload: { runs_count: 1, tasks_count: 50, results_count: 50 },
      tool_versions: {
        deno: "1.46.3",
        wrangler: "3.114.0",
        claude_code: "0.4.0",
        bc_compiler: "27.0",
      },
      envelope: {
        git_sha: "abc1234",
        machine_id: "test-mach",
        settings_hash: "s",
      },
      actor: "operator",
      actor_id: "key-1",
    });
    assertEquals(body.version, 1);
    assertEquals(body.payload["event_type"], "bench.completed");
    assertExists(body.payload["payload_hash"]);
  });

  it("reduceCurrentState picks the most recent terminal event per step", () => {
    const events: LifecycleEvent[] = [
      {
        id: 1,
        ts: 100,
        model_slug: "m",
        task_set_hash: "h",
        event_type: "bench.started",
        actor: "operator",
      },
      {
        id: 2,
        ts: 200,
        model_slug: "m",
        task_set_hash: "h",
        event_type: "bench.completed",
        actor: "operator",
      },
      {
        id: 3,
        ts: 300,
        model_slug: "m",
        task_set_hash: "h",
        event_type: "analysis.started",
        actor: "operator",
      },
    ];
    const state = reduceCurrentState(events);
    assertEquals(state.bench?.event_type, "bench.completed");
    assertEquals(state.analyze?.event_type, "analysis.started");
    assertEquals(state.publish, undefined);
  });

  it("reduceCurrentState breaks ts ties by id (highest wins)", () => {
    const events: LifecycleEvent[] = [
      {
        id: 1,
        ts: 100,
        model_slug: "m",
        task_set_hash: "h",
        event_type: "bench.completed",
        actor: "operator",
      },
      {
        id: 2,
        ts: 100,
        model_slug: "m",
        task_set_hash: "h",
        event_type: "bench.failed",
        actor: "operator",
      },
    ];
    const state = reduceCurrentState(events);
    assertEquals(state.bench?.event_type, "bench.failed");
  });

  it("isCanonicalEventType accepts every entry in CANONICAL_EVENT_TYPES", () => {
    for (const t of CANONICAL_EVENT_TYPES) {
      assert(isCanonicalEventType(t), `${t} should be canonical`);
    }
  });

  it("isCanonicalEventType rejects bogus strings", () => {
    assertFalse(isCanonicalEventType(""));
    assertFalse(isCanonicalEventType("bench.invalid_phase"));
    assertFalse(isCanonicalEventType("BENCH.COMPLETED")); // case-sensitive
    assertFalse(isCanonicalEventType("nonexistent.action"));
  });

  it("isCanonicalActor accepts every entry in CANONICAL_ACTORS", () => {
    for (const a of CANONICAL_ACTORS) {
      assert(isCanonicalActor(a), `${a} should be canonical`);
    }
  });

  it("isCanonicalActor rejects bogus strings", () => {
    assertFalse(isCanonicalActor(""));
    assertFalse(isCanonicalActor("rogue"));
    assertFalse(isCanonicalActor("OPERATOR"));
  });

  it("CANONICAL_EVENT_TYPES has the expected 25 strategic-plan entries", () => {
    assertEquals(CANONICAL_EVENT_TYPES.length, 25);
  });

  it("CANONICAL_ACTORS has the expected 4 strategic-plan entries", () => {
    assertEquals(CANONICAL_ACTORS.length, 4);
  });

  it("buildAppendBody throws on empty model_slug", async () => {
    await assertRejects(
      () =>
        buildAppendBody({
          ts: 1,
          model_slug: "",
          task_set_hash: "h",
          event_type: "bench.completed",
          payload: {},
          tool_versions: {},
          envelope: {},
          actor: "operator",
        }),
      Error,
      "model_slug",
    );
  });
});
