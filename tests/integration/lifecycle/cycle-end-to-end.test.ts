/**
 * Integration tests for runCycle. The orchestrator is wired against an
 * in-memory event store via `setEventStore`; step modules are stubbed at
 * the module-namespace level. Tests assert the EVENT SEQUENCE — the
 * canonical output of cycle — not step internals (covered in tests/unit/
 * lifecycle/steps/).
 *
 * @module tests/integration/lifecycle/cycle-end-to-end
 */

import { assert, assertEquals } from "@std/assert";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";
import { setEventStore } from "../../../src/lifecycle/event-log.ts";
import { setStepDispatcher } from "../../../src/lifecycle/orchestrator.ts";
import type {
  AppendEventInput,
  LifecycleEvent,
} from "../../../src/lifecycle/types.ts";

interface FakeEvent extends AppendEventInput {
  id: number;
}

/** Stand up the minimum config for runCycle to satisfy the admin-scope check. */
async function writeCgConfig(tmp: string): Promise<void> {
  const fakeKeyAbs = `${tmp}/fake.key`;
  await Deno.writeTextFile(
    `${tmp}/.centralgauge.yml`,
    [
      "ingest:",
      "  url: https://example.test",
      `  key_path: ${fakeKeyAbs}`,
      "  key_id: 1",
      `  admin_key_path: ${fakeKeyAbs}`,
      "  admin_key_id: 1",
      "  machine_id: testmachine",
    ].join("\n"),
  );
  await Deno.writeFile(fakeKeyAbs, new Uint8Array(32));
}

/** Build a minimal in-memory event store backed by the events array. */
function inMemoryStore(events: FakeEvent[]) {
  return {
    appendEvent: (e: AppendEventInput, _opts: unknown) => {
      const id = events.length + 1;
      events.push({ ...e, id, ts: e.ts ?? Date.now() });
      return Promise.resolve({ id });
    },
    queryEvents: (
      filter: { model_slug: string; task_set_hash?: string | undefined },
      _opts: unknown,
    ): Promise<LifecycleEvent[]> => {
      // Mirror the worker's ORDER BY ts ASC, id ASC.
      const matching = events
        .filter((e) =>
          e.model_slug === filter.model_slug &&
          (!filter.task_set_hash || e.task_set_hash === filter.task_set_hash)
        )
        .sort((a, b) => a.id - b.id)
        .map((e) =>
          ({
            id: e.id,
            ts: e.ts ?? 0,
            model_slug: e.model_slug,
            task_set_hash: e.task_set_hash,
            event_type: e.event_type,
            actor: e.actor,
            actor_id: e.actor_id ?? null,
            payload_hash: e.payload_hash ?? null,
            payload: e.payload,
            envelope: e.envelope ?? null,
            tool_versions: e.tool_versions ?? null,
            payload_json: JSON.stringify(e.payload ?? {}),
            envelope_json: e.envelope ? JSON.stringify(e.envelope) : null,
            tool_versions_json: e.tool_versions
              ? JSON.stringify(e.tool_versions)
              : null,
          }) as LifecycleEvent
        );
      return Promise.resolve(matching);
    },
  };
}

Deno.test("runCycle dry-run emits no writes and prints plan", async () => {
  const tmp = await createTempDir("cycle-e2e-dry");
  const events: FakeEvent[] = [];
  setEventStore(inMemoryStore(events));
  try {
    await writeCgConfig(tmp);
    const { runCycle } = await import("../../../src/lifecycle/orchestrator.ts");
    const oldCwd = Deno.cwd();
    Deno.chdir(tmp);
    try {
      await runCycle({
        llms: ["anthropic/claude-opus-4-7"],
        taskSet: "current",
        fromStep: "bench",
        toStep: "publish",
        forceRerun: [],
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: true,
        forceUnlock: false,
        yes: false,
      });
      assertEquals(events.length, 0);
    } finally {
      Deno.chdir(oldCwd);
    }
  } finally {
    setEventStore(null);
    await cleanupTempDir(tmp);
  }
});

Deno.test("runCycle force-unlock writes cycle.aborted{manual_unlock}", async () => {
  const tmp = await createTempDir("cycle-e2e-unlock");
  const events: FakeEvent[] = [];
  setEventStore(inMemoryStore(events));
  try {
    await writeCgConfig(tmp);
    const { runCycle } = await import("../../../src/lifecycle/orchestrator.ts");
    const oldCwd = Deno.cwd();
    Deno.chdir(tmp);
    try {
      await runCycle({
        llms: ["anthropic/claude-opus-4-7"],
        taskSet: "current",
        fromStep: "bench",
        toStep: "publish",
        forceRerun: [],
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        forceUnlock: true,
        yes: true,
      });
      assertEquals(events.length, 1);
      const ev = events[0]!;
      assertEquals(ev.event_type, "cycle.aborted");
      const payload = ev.payload as Record<string, unknown>;
      assertEquals(payload["reason"], "manual_unlock");
      // actor_id is the machine_id from .centralgauge.yml.
      assertEquals(payload["actor_id"], "testmachine");
    } finally {
      Deno.chdir(oldCwd);
    }
  } finally {
    setEventStore(null);
    await cleanupTempDir(tmp);
  }
});

Deno.test("runCycle skip-on-success: prior bench.completed + matching envelope → bench.skipped", async () => {
  const tmp = await createTempDir("cycle-e2e-skip");
  const events: FakeEvent[] = [];
  setEventStore(inMemoryStore(events));
  try {
    await writeCgConfig(tmp);
    // Tasks dir is absent → orchestrator falls back to taskSet='current'
    // sentinel string. Pre-seed a bench.completed event with the SAME
    // envelope the orchestrator will collect (deno+wrangler+claude_code+
    // bc_compiler are absent in the test env, settings_hash is absent;
    // the envelope helper only emits git_sha when git is reachable, which
    // is true in this worktree). To make this deterministic, we pre-seed
    // an event whose envelope object is empty and rely on envelopeMatches
    // comparing JSON.stringify against the live envelope. The live
    // envelope contains git_sha → mismatch → run instead of skip.
    //
    // Instead, we capture the envelope on the cycle.started event the
    // orchestrator writes, then clone it onto the prior bench.completed
    // before the second invocation. But the orchestrator runs once here
    // with no prior — so the test boundary is "the SECOND identical run
    // of cycle should skip bench". We invoke twice.
    const { runCycle } = await import("../../../src/lifecycle/orchestrator.ts");
    const oldCwd = Deno.cwd();
    Deno.chdir(tmp);
    try {
      // First run: no prior events → bench runs. Stub the dispatcher so we
      // don't spawn the real bench subprocess.
      setStepDispatcher((_step, _ctx) =>
        Promise.resolve({
          success: true,
          eventType: "bench.completed",
          payload: { runs_count: 1, tasks_count: 1, results_count: 1 },
        })
      );
      try {
        await runCycle({
          llms: ["anthropic/claude-opus-4-7"],
          taskSet: "current",
          fromStep: "bench",
          toStep: "bench",
          forceRerun: [],
          analyzerModel: "anthropic/claude-opus-4-6",
          dryRun: false,
          forceUnlock: false,
          yes: true,
        });
        const firstRunBenchCompleted = events.find((e) =>
          e.event_type === "bench.completed"
        );
        assert(
          firstRunBenchCompleted,
          "first run should emit bench.completed",
        );

        // Second run: should skip bench because envelope is unchanged.
        await runCycle({
          llms: ["anthropic/claude-opus-4-7"],
          taskSet: "current",
          fromStep: "bench",
          toStep: "bench",
          forceRerun: [],
          analyzerModel: "anthropic/claude-opus-4-6",
          dryRun: false,
          forceUnlock: false,
          yes: true,
        });
        const benchSkipped = events.find((e) =>
          e.event_type === "bench.skipped"
        );
        assert(
          benchSkipped,
          "second run with matching envelope should emit bench.skipped",
        );
        const cycleCompleted = events.filter((e) =>
          e.event_type === "cycle.completed"
        );
        assertEquals(cycleCompleted.length, 2);
      } finally {
        setStepDispatcher(null);
      }
    } finally {
      Deno.chdir(oldCwd);
    }
  } finally {
    setEventStore(null);
    await cleanupTempDir(tmp);
  }
});

Deno.test("runCycle mid-cycle event-write crash → cycle.failed{orchestrator_crash}", async () => {
  // C2 regression. If any `appendEvent` call throws partway through the
  // per-step loop (Wave 1 admin endpoint 500, network blip, the C1 bug
  // before it lands), the cycle.started lock would otherwise survive
  // without a terminal — wedging the lock-token tiebreaker for 90 min.
  // The orchestrator MUST wrap the per-step loop with a catch that emits
  // `cycle.failed{error_code:'orchestrator_crash'}` BEFORE re-throwing.
  const tmp = await createTempDir("cycle-e2e-crash");
  const events: FakeEvent[] = [];
  // Wrap the in-memory store and inject a throw on the second
  // appendEvent (the first is `cycle.started`; the second is
  // `bench.started`). After the throw, the orchestrator's catch should
  // still write `cycle.failed`.
  const baseStore = inMemoryStore(events);
  let appendCallCount = 0;
  setEventStore({
    appendEvent: (e, opts) => {
      appendCallCount++;
      if (appendCallCount === 2) {
        return Promise.reject(new Error("simulated D1 500"));
      }
      return baseStore.appendEvent(e, opts);
    },
    queryEvents: baseStore.queryEvents.bind(baseStore),
  });
  try {
    await writeCgConfig(tmp);
    setStepDispatcher((_step, _ctx) =>
      Promise.resolve({
        success: true,
        eventType: "bench.completed",
        payload: { runs_count: 1, tasks_count: 1, results_count: 1 },
      })
    );
    const { runCycle } = await import("../../../src/lifecycle/orchestrator.ts");
    const oldCwd = Deno.cwd();
    Deno.chdir(tmp);
    let thrown: Error | null = null;
    try {
      await runCycle({
        llms: ["anthropic/claude-opus-4-7"],
        taskSet: "current",
        fromStep: "bench",
        toStep: "bench",
        forceRerun: [],
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        forceUnlock: false,
        yes: true,
      });
    } catch (e) {
      thrown = e as Error;
    } finally {
      setStepDispatcher(null);
      Deno.chdir(oldCwd);
    }
    assert(thrown, "runCycle should re-throw after emitting cycle.failed");
    // The orchestrator emitted cycle.started (id=1). The bench.started
    // append THREW (id reservation aborted). The catch path must then
    // emit cycle.failed{error_code:'orchestrator_crash'} so the lock is
    // not stranded for 90 min.
    const cycleFailed = events.find((e) => e.event_type === "cycle.failed");
    assert(
      cycleFailed,
      "expected cycle.failed terminal event after mid-cycle crash",
    );
    const payload = cycleFailed.payload as Record<string, unknown>;
    assertEquals(payload["error_code"], "orchestrator_crash");
    assertEquals(payload["failed_step"], "bench");
    assert(
      typeof payload["error_message"] === "string" &&
        (payload["error_message"] as string).includes("simulated D1 500"),
      "expected error_message to carry the original throw text",
    );
  } finally {
    setEventStore(null);
    await cleanupTempDir(tmp);
  }
});

Deno.test("runCycle resume-on-failure: prior bench.failed → next run retries", async () => {
  const tmp = await createTempDir("cycle-e2e-resume");
  const events: FakeEvent[] = [];
  setEventStore(inMemoryStore(events));
  try {
    await writeCgConfig(tmp);
    // Pre-seed a bench.failed event for this model/task_set.
    events.push({
      id: 1,
      ts: Date.now() - 5000,
      model_slug: "anthropic/claude-opus-4-7",
      task_set_hash: "current",
      event_type: "bench.failed",
      actor: "operator",
      payload: { error_code: "bench_nonzero_exit" },
    } as FakeEvent);

    setStepDispatcher((_step, _ctx) =>
      Promise.resolve({
        success: true,
        eventType: "bench.completed",
        payload: { runs_count: 1, tasks_count: 1, results_count: 1 },
      })
    );
    const { runCycle } = await import("../../../src/lifecycle/orchestrator.ts");
    const oldCwd = Deno.cwd();
    Deno.chdir(tmp);
    try {
      await runCycle({
        llms: ["anthropic/claude-opus-4-7"],
        taskSet: "current",
        fromStep: "bench",
        toStep: "bench",
        forceRerun: [],
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        forceUnlock: false,
        yes: true,
      });
      // Sequence: cycle.started, bench.started, bench.completed,
      // cycle.completed (after the seeded bench.failed).
      const benchStarted = events.find((e) => e.event_type === "bench.started");
      const benchCompleted = events.find((e) =>
        e.event_type === "bench.completed"
      );
      const cycleCompleted = events.find((e) =>
        e.event_type === "cycle.completed"
      );
      assert(benchStarted, "expected bench.started after prior failure");
      assert(benchCompleted, "expected bench.completed after retry");
      assert(cycleCompleted, "expected cycle.completed at end");
    } finally {
      setStepDispatcher(null);
      Deno.chdir(oldCwd);
    }
  } finally {
    setEventStore(null);
    await cleanupTempDir(tmp);
  }
});
