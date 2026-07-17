/**
 * TEST5 (guards P2/P7/P11): parked entries must settle in BOUNDED time on
 * every path WITHOUT any manual `cancelParked()` cleanup call. Pre-fix,
 * parked entries had no timer and no flusher besides enqueue()/recovery, so
 * a fully-alerted pool hung the bench forever.
 *
 * The only step that calls `cancelParked` is the one that TESTS
 * `cancelParked` itself (timers cleared before rejecting).
 */

import { assert, assertEquals, assertExists } from "@std/assert";

import { CompileQueuePool } from "../../../src/parallel/compile-queue-pool.ts";
import type {
  CompileQueue,
  QueueEntry,
} from "../../../src/parallel/compile-queue.ts";
import { ContainerHealthMonitor } from "../../../src/health/monitor.ts";
import { ContainerError, QueueTimeoutError } from "../../../src/errors.ts";
import { createMockContainerProvider } from "../../utils/mock-container-provider.ts";
import { createMockCompileWorkItem } from "../../utils/test-helpers.ts";

/** Trip a catastrophic SUSPECT alert on one container; returns the alert. */
function tripSuspect(
  mon: ContainerHealthMonitor,
  name: string,
  fp = `test:sql-${name}`,
) {
  const rec = mon.record({
    containerName: name,
    result: "infra_error",
    fingerprint: fp,
    signatureId: "sql_service_down",
    timestamp: Date.now(),
  });
  if (!rec.alert) throw new Error(`expected alert for ${name}`);
  return rec.alert;
}

Deno.test({
  name: "parked entries settle without manual cancelParked",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    await t.step(
      "park rejects with QueueTimeoutError after remaining budget",
      async () => {
        const provider = createMockContainerProvider();
        const mon = new ContainerHealthMonitor({ windowSize: 10 });
        provider.setCompilationConfig({ delay: 1200, success: true });
        const pool = new CompileQueuePool(provider, ["c1"], {
          compileConcurrency: 1,
          timeout: 1000,
          healthMonitor: mon,
          canRecover: () => true, // prober "on" — parking allowed
        });

        const t0 = Date.now();
        const p1 = pool.enqueue(createMockCompileWorkItem({ id: "wi-a" }))
          .catch(() => {});
        const p2 = pool.enqueue(createMockCompileWorkItem({ id: "wi-b" }));
        await new Promise((r) => setTimeout(r, 100));

        const alert = tripSuspect(mon, "c1");
        const outcome = await pool.rebalanceFromContainer("c1", alert);
        assertEquals(outcome.parked, 1);

        // The park timer must be armed with EXACTLY the remaining budget
        // (≈900ms), so the rejection lands ≈1000ms after the enqueue.
        let err: unknown;
        try {
          await p2;
        } catch (e) {
          err = e;
        }
        const elapsed = Date.now() - t0;
        assert(
          err instanceof QueueTimeoutError,
          `expected QueueTimeoutError, got ${String(err)}`,
        );
        assert(
          elapsed >= 800 && elapsed <= 1500,
          `rejection at ${elapsed}ms — must respect the ORIGINAL budget`,
        );
        assertEquals(pool.parkedDepth, 0);
        await p1;
      },
    );

    await t.step(
      "park with already-exhausted budget rejects immediately",
      async () => {
        const provider = createMockContainerProvider();
        const mon = new ContainerHealthMonitor({ windowSize: 10 });
        provider.setCompilationConfig({ delay: 500, success: true });
        const pool = new CompileQueuePool(provider, ["c1"], {
          compileConcurrency: 1,
          timeout: 1000,
          healthMonitor: mon,
          canRecover: () => true,
        });

        const p1 = pool.enqueue(createMockCompileWorkItem({ id: "wi-a" }))
          .catch(() => {});
        const p2 = pool.enqueue(createMockCompileWorkItem({ id: "wi-b" }));
        await new Promise((r) => setTimeout(r, 30));

        // Manufacture an exhausted budget by backdating the pending entry.
        // Organically unreachable today (the pending timer fires first), but
        // the park path must be robust to it — defense in depth.
        const queues = (pool as unknown as { queues: CompileQueue[] }).queues;
        const pending = (queues[0] as unknown as { queue: QueueEntry[] }).queue;
        assertEquals(pending.length, 1);
        pending[0]!.enqueuedAt = Date.now() - 5000;

        const alert = tripSuspect(mon, "c1");
        const tPark = Date.now();
        await pool.rebalanceFromContainer("c1", alert);

        let err: unknown;
        try {
          await p2;
        } catch (e) {
          err = e;
        }
        assert(
          err instanceof QueueTimeoutError,
          `expected QueueTimeoutError, got ${String(err)}`,
        );
        assert(
          Date.now() - tPark < 100,
          "exhausted budget must reject immediately, not park",
        );
        assertEquals(pool.parkedDepth, 0);
        await p1;
      },
    );

    await t.step(
      "all-alerted + canRecover false rejects immediately",
      async () => {
        const provider = createMockContainerProvider();
        const mon = new ContainerHealthMonitor({ windowSize: 10 });
        provider.setCompilationConfig({ delay: 500, success: true });
        const pool = new CompileQueuePool(provider, ["c1"], {
          compileConcurrency: 1,
          timeout: 5000,
          healthMonitor: mon,
          canRecover: () => false, // prober off / global outage
        });

        const p1 = pool.enqueue(createMockCompileWorkItem({ id: "wi-a" }))
          .catch(() => {});
        const p2 = pool.enqueue(createMockCompileWorkItem({ id: "wi-b" }));
        await new Promise((r) => setTimeout(r, 30));

        const alert = tripSuspect(mon, "c1");
        const tDrain = Date.now();
        const outcome = await pool.rebalanceFromContainer("c1", alert);
        assertEquals(outcome.parked, 0, "must not park when unrecoverable");

        let err: unknown;
        try {
          await p2;
        } catch (e) {
          err = e;
        }
        assert(
          err instanceof ContainerError,
          `expected ContainerError, got ${String(err)}`,
        );
        assert(
          (err as Error).message.includes("recovery unavailable"),
          "message must name the condition",
        );
        assert(Date.now() - tDrain < 100, "must reject immediately");
        assertEquals(pool.parkedDepth, 0);
        await p1;
      },
    );

    await t.step(
      "flush on recovery clears the park timer (no late rejection)",
      async () => {
        const provider = createMockContainerProvider();
        const mon = new ContainerHealthMonitor({ windowSize: 10 });
        provider.setCompilationConfig({ delay: 200, success: true });
        const pool = new CompileQueuePool(provider, ["c1"], {
          compileConcurrency: 1,
          timeout: 600,
          healthMonitor: mon,
          canRecover: () => true,
        });

        const p1 = pool.enqueue(createMockCompileWorkItem({ id: "wi-a" }))
          .catch(() => {});
        const p2 = pool.enqueue(createMockCompileWorkItem({ id: "wi-b" }));
        await new Promise((r) => setTimeout(r, 30));

        const alert = tripSuspect(mon, "c1");
        const outcome = await pool.rebalanceFromContainer("c1", alert);
        assertEquals(outcome.parked, 1);

        // Recovery: clear alert, re-admit — flush must clear the park timer
        // and re-admit through the queue.
        assertExists(mon.clearAlert("c1", alert.alertId, "test-recovery"));
        pool.onContainerRecovered("c1", alert.alertId);
        assertEquals(pool.parkedDepth, 0);

        const result = await p2; // resolves via the queue — NOT rejected
        assertEquals(result.workItemId, "wi-b");

        // Advance past the original park-timer window; a leaked timer would
        // fire here (remove-before-act makes it a no-op by design).
        await new Promise((r) => setTimeout(r, 400));
        await p1;
      },
    );

    await t.step(
      "cancelParked clears timers before rejecting (no double-settle)",
      async () => {
        const provider = createMockContainerProvider();
        const mon = new ContainerHealthMonitor({ windowSize: 10 });
        provider.setCompilationConfig({ delay: 400, success: true });
        const pool = new CompileQueuePool(provider, ["c1"], {
          compileConcurrency: 1,
          timeout: 300,
          healthMonitor: mon,
          canRecover: () => true,
        });

        const p1 = pool.enqueue(createMockCompileWorkItem({ id: "wi-a" }))
          .catch(() => {});
        const p2 = pool.enqueue(createMockCompileWorkItem({ id: "wi-b" }));
        await new Promise((r) => setTimeout(r, 30));

        const alert = tripSuspect(mon, "c1");
        const outcome = await pool.rebalanceFromContainer("c1", alert);
        assertEquals(outcome.parked, 1);

        const cancelled = pool.cancelParked("shutdown-test");
        assertEquals(cancelled, 1);

        let err: unknown;
        try {
          await p2;
        } catch (e) {
          err = e;
        }
        assert(err instanceof Error);
        assertEquals((err as Error).message, "shutdown-test");
        assert(
          !(err instanceof QueueTimeoutError),
          "cancel reason must win over the park timer",
        );

        // Let the original park-timer window elapse — no late double-settle.
        await new Promise((r) => setTimeout(r, 400));
        await p1;
      },
    );
  },
});

// P7: re-admission must honor the entry's ORIGINAL per-call
// excludeContainers — a drained entry must never be round-robined onto a
// container its caller excluded.
Deno.test({
  name: "re-admission honors the entry's original excludeContainers",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const provider = createMockContainerProvider();
    const mon = new ContainerHealthMonitor({ windowSize: 10 });
    provider.setCompilationConfig({ delay: 300, success: true });
    const pool = new CompileQueuePool(provider, ["A", "B", "C"], {
      compileConcurrency: 1,
      timeout: 10_000,
      healthMonitor: mon,
    });

    // Load A and C (2 items each) and B (1 item) so the least-loaded routing
    // decision deterministically sends the probe entry to B, where it stays
    // PENDING behind B's in-flight filler.
    const fillers: Promise<unknown>[] = [
      pool.enqueue(createMockCompileWorkItem({ id: "fA1" }), {
        excludeContainers: ["B", "C"],
      }).catch(() => {}),
      pool.enqueue(createMockCompileWorkItem({ id: "fA2" }), {
        excludeContainers: ["B", "C"],
      }).catch(() => {}),
      pool.enqueue(createMockCompileWorkItem({ id: "fC1" }), {
        excludeContainers: ["A", "B"],
      }).catch(() => {}),
      pool.enqueue(createMockCompileWorkItem({ id: "fC2" }), {
        excludeContainers: ["A", "B"],
      }).catch(() => {}),
      pool.enqueue(createMockCompileWorkItem({ id: "fB1" }), {
        excludeContainers: ["A", "C"],
      }).catch(() => {}),
    ];
    await new Promise((r) => setTimeout(r, 30));

    // Probe excludes A. Loads: A=2, B=1, C=2 → routed to B (pending).
    const probe = pool.enqueue(createMockCompileWorkItem({ id: "probe" }), {
      excludeContainers: ["A"],
    });
    await new Promise((r) => setTimeout(r, 30));

    const alert = tripSuspect(mon, "B");
    const outcome = await pool.rebalanceFromContainer("B", alert);
    assertEquals(outcome.requeued, 1);
    assertEquals(
      outcome.targetDistribution["A"],
      undefined,
      "A was excluded by the entry's original enqueue — must not receive it",
    );
    assertEquals(outcome.targetDistribution["C"], 1);

    const result = await probe;
    assertEquals(result.containerName, "C");
    await Promise.all(fillers);
  },
});
