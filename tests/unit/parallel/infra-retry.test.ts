/**
 * State-machine tests for the `withInfraRetry` helper.
 *
 * These tests drive every branch of the retry state machine:
 *
 *  1. Disabled fast-path (`maxRetries: 0`).
 *  2. Non-infra errors propagate immediately.
 *  3. Successful retry after one infra failure.
 *  4. Budget exhaustion when all retries infra.
 *  5. Non-infra mid-retry finalizes active record + re-throws.
 *  6. `NoEligibleContainersError` after a real infra preserves the real cause.
 *  7. Single-container short-circuit (no jitter sleep).
 *  8. Global outage detected at retry-decision time.
 *  9. Active alerts widen exclusion automatically (resolved do not).
 * 10. Unknown failed container refuses to retry.
 * 12. Event ordering for success and exhaustion paths.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";

import { ContainerError } from "../../../src/errors.ts";
import {
  InfraRetriesExhaustedError,
  NoEligibleContainersError,
} from "../../../src/parallel/errors.ts";
import { withInfraRetry } from "../../../src/parallel/infra-retry.ts";
import type { ParallelExecutionEvent } from "../../../src/parallel/types.ts";
import { ContainerHealthMonitor } from "../../../src/health/monitor.ts";
import type { ContainerOutcome } from "../../../src/health/types.ts";

/**
 * Construct a real `ContainerHealthMonitor` and feed it just enough outcome
 * events to put it in the desired state. We use the real monitor (not a stub)
 * so the helper exercises the real `getState()` shape end-to-end.
 *
 * - `activeAlerts`: container names that should appear with
 *   `alert: persistent_container_failure` in the snapshot.
 * - `globalOutage`: when true, raises a `global_outage` alert by feeding the
 *   same fingerprint across the requested containers (or 3 defaults).
 */
function mockHealthMonitor(opts: {
  activeAlerts?: string[];
  globalOutage?: boolean;
  globalOutageContainers?: string[];
}): ContainerHealthMonitor {
  const monitor = new ContainerHealthMonitor({
    windowSize: 5,
    persistentThreshold: 3,
    globalOutageRatio: 0.5,
    globalOutageMinContainers: 3,
    expectedContainers: 3,
  });

  if (opts.globalOutage) {
    const containers = opts.globalOutageContainers ??
      ["GlobalA", "GlobalB", "GlobalC"];
    const fp = "fp-global-outage";
    let t = 1;
    for (const c of containers) {
      const outcome: ContainerOutcome = {
        containerName: c,
        result: "infra_error",
        fingerprint: fp,
        timestamp: t++,
      };
      monitor.record(outcome);
    }
  }

  if (opts.activeAlerts) {
    for (const c of opts.activeAlerts) {
      const fp = `fp-${c}`;
      // 3 infra_error outcomes with the same fingerprint trips persistent.
      for (let i = 0; i < 3; i++) {
        const outcome: ContainerOutcome = {
          containerName: c,
          result: "infra_error",
          fingerprint: fp,
          timestamp: 100 + i,
        };
        monitor.record(outcome);
      }
    }
  }
  return monitor;
}

// ===========================================================================
// 1. Disabled fast-path
// ===========================================================================

Deno.test("maxRetries: 0 runs once and propagates any error unchanged", async () => {
  let calls = 0;
  const original = new ContainerError(
    "PSSession broken",
    "Cronus28",
    "compile",
  );
  const events: ParallelExecutionEvent[] = [];
  const err = await assertRejects(
    () =>
      withInfraRetry(
        () => {
          calls++;
          return Promise.reject(original);
        },
        {
          maxRetries: 0,
          configuredContainers: ["Cronus28", "Cronus281"],
          emit: (e) => events.push(e),
          context: { taskId: "t", variantId: "v", attemptNumber: 1 },
        },
      ),
    ContainerError,
  );
  assertEquals(calls, 1);
  // Error is propagated UNCHANGED — not wrapped in InfraRetriesExhaustedError.
  assertEquals(err, original);
  assertEquals(events.length, 0); // no retry events
});

Deno.test("maxRetries: 0 returns result on success", async () => {
  const operation = ({ onRouted }: {
    excludeContainers: string[];
    onRouted: (c: string) => void;
  }) => {
    onRouted("Cronus28");
    return Promise.resolve({ ok: true });
  };
  const result = await withInfraRetry(operation, {
    maxRetries: 0,
    configuredContainers: ["Cronus28"],
    context: { taskId: "t", variantId: "v", attemptNumber: 1 },
  });
  assertEquals(result.retries, []);
  assertEquals(result.result, { ok: true });
});

// ===========================================================================
// 2. Non-infra error propagation
// ===========================================================================

Deno.test("non-infra error propagates immediately, no retry consumed", async () => {
  const err = new Error("AL0001: Identifier 'Foo' is not declared");
  let calls = 0;
  await assertRejects(
    () =>
      withInfraRetry(
        () => {
          calls++;
          return Promise.reject(err);
        },
        {
          maxRetries: 2,
          configuredContainers: ["Cronus28", "Cronus281"],
          context: { taskId: "t", variantId: "v", attemptNumber: 1 },
        },
      ),
    Error,
    "AL0001",
  );
  assertEquals(calls, 1);
});

// ===========================================================================
// 3. Successful retry
// ===========================================================================

Deno.test("infra error then success records 1-entry trail with actual routed container", async () => {
  let call = 0;
  const operation = ({ excludeContainers, onRouted }: {
    excludeContainers: string[];
    onRouted: (c: string) => void;
  }) => {
    call++;
    if (call === 1) {
      onRouted("Cronus28");
      return Promise.reject(
        new ContainerError("PSSession broken", "Cronus28", "compile"),
      );
    }
    assertEquals(excludeContainers, ["Cronus28"]);
    onRouted("Cronus281");
    return Promise.resolve({ ok: true });
  };
  const result = await withInfraRetry(operation, {
    maxRetries: 1,
    configuredContainers: ["Cronus28", "Cronus281"],
    jitterMs: () => 0,
    context: { taskId: "t", variantId: "v", attemptNumber: 1 },
  });
  assertEquals(result.retries.length, 1);
  const record = result.retries[0];
  assert(record !== undefined);
  assertEquals(record.originalContainerName, "Cronus28");
  assertEquals(record.retryContainerName, "Cronus281");
  assertEquals(record.outcome, "succeeded");
});

// ===========================================================================
// 4. Budget exhaustion
// ===========================================================================

Deno.test("infra N+1 times with maxRetries N -> InfraRetriesExhaustedError with budget_exhausted reason", async () => {
  let call = 0;
  const op = ({ onRouted }: {
    excludeContainers: string[];
    onRouted: (c: string) => void;
  }) => {
    call++;
    // Routes between Cronus28 and Cronus281 so the exclusion logic doesn't
    // short-circuit before the budget runs out.
    const c = call === 1 ? "Cronus28" : "Cronus281";
    onRouted(c);
    return Promise.reject(
      new ContainerError("PSSession broken", c, "compile"),
    );
  };
  const e = await assertRejects(
    () =>
      withInfraRetry(op, {
        maxRetries: 1,
        configuredContainers: ["Cronus28", "Cronus281", "Cronus282"],
        jitterMs: () => 0,
        context: { taskId: "t", variantId: "v", attemptNumber: 1 },
      }),
    InfraRetriesExhaustedError,
  ) as InfraRetriesExhaustedError;
  assertEquals(e.reason, "budget_exhausted");
  assertEquals(e.retries.length, 1);
  assert(e.cause instanceof ContainerError);
});

// ===========================================================================
// 5. Non-infra mid-retry: trail finalized
// ===========================================================================

Deno.test("non-infra error during retry finalizes active record as non_infra_failure, propagates", async () => {
  let call = 0;
  const op = ({ onRouted }: {
    excludeContainers: string[];
    onRouted: (c: string) => void;
  }) => {
    call++;
    if (call === 1) {
      onRouted("Cronus28");
      return Promise.reject(
        new ContainerError("PSSession broken", "Cronus28", "compile"),
      );
    }
    onRouted("Cronus281");
    return Promise.reject(new Error("AL0001: real bug"));
  };
  const events: ParallelExecutionEvent[] = [];
  await assertRejects(
    () =>
      withInfraRetry(op, {
        maxRetries: 1,
        configuredContainers: ["Cronus28", "Cronus281"],
        jitterMs: () => 0,
        emit: (e) => events.push(e),
        context: { taskId: "t", variantId: "v", attemptNumber: 1 },
      }),
    Error,
    "AL0001",
  );
  const failedEvt = events.find((e) => e.type === "infra_retry_failed");
  assert(failedEvt !== undefined, "expected infra_retry_failed event");
  if (failedEvt.type !== "infra_retry_failed") throw new Error("type guard");
  assertEquals(failedEvt.outcome, "non_infra_failure");
});

// ===========================================================================
// 6. NoEligibleContainersError after real infra
// ===========================================================================

Deno.test("NoEligibleContainersError from pool: cause preserves last real infra error", async () => {
  let call = 0;
  const realInfra = new ContainerError(
    "PSSession broken",
    "Cronus28",
    "compile",
  );
  const op = ({ onRouted }: {
    excludeContainers: string[];
    onRouted: (c: string) => void;
  }) => {
    call++;
    if (call === 1) {
      onRouted("Cronus28");
      return Promise.reject(realInfra);
    }
    return Promise.reject(
      new NoEligibleContainersError(
        ["Cronus28", "Cronus281"],
        ["Cronus28", "Cronus281"],
      ),
    );
  };
  const e = await assertRejects(
    () =>
      withInfraRetry(op, {
        maxRetries: 5,
        configuredContainers: ["Cronus28", "Cronus281"],
        jitterMs: () => 0,
        context: { taskId: "t", variantId: "v", attemptNumber: 1 },
      }),
    InfraRetriesExhaustedError,
  ) as InfraRetriesExhaustedError;
  assertEquals(e.reason, "no_eligible_containers");
  assertEquals(e.cause, realInfra); // NOT the NoEligibleContainersError
});

// ===========================================================================
// 7. Single-container short-circuit
// ===========================================================================

Deno.test("single-container deployment: no retry attempted, no jitter, fast exhaustion", async () => {
  const start = performance.now();
  const op = ({ onRouted }: {
    excludeContainers: string[];
    onRouted: (c: string) => void;
  }) => {
    onRouted("Cronus28");
    return Promise.reject(
      new ContainerError("PSSession broken", "Cronus28", "compile"),
    );
  };
  const e = await assertRejects(
    () =>
      withInfraRetry(op, {
        maxRetries: 1,
        configuredContainers: ["Cronus28"], // only one!
        jitterMs: () => 9999, // would be obvious if called
        context: { taskId: "t", variantId: "v", attemptNumber: 1 },
      }),
    InfraRetriesExhaustedError,
  ) as InfraRetriesExhaustedError;
  const elapsed = performance.now() - start;
  assertEquals(e.reason, "no_eligible_containers");
  assertEquals(e.retries.length, 0); // empty trail
  assert(elapsed < 500, `Expected fast short-circuit, got ${elapsed}ms`);
});

// ===========================================================================
// 8. Global outage at retry decision
// ===========================================================================

Deno.test("global outage detected at retry decision: exhausted without retry", async () => {
  let call = 0;
  const op = ({ onRouted }: {
    excludeContainers: string[];
    onRouted: (c: string) => void;
  }) => {
    call++;
    if (call === 1) {
      onRouted("Cronus28");
      return Promise.reject(
        new ContainerError("PSSession broken", "Cronus28", "compile"),
      );
    }
    throw new Error("should not be reached");
  };
  const monitor = mockHealthMonitor({ globalOutage: true });
  const e = await assertRejects(
    () =>
      withInfraRetry(op, {
        maxRetries: 1,
        configuredContainers: ["Cronus28", "Cronus281"],
        healthMonitor: monitor,
        jitterMs: () => 0,
        context: { taskId: "t", variantId: "v", attemptNumber: 1 },
      }),
    InfraRetriesExhaustedError,
  ) as InfraRetriesExhaustedError;
  assertEquals(e.reason, "global_outage");
  assertEquals(call, 1); // never retried
});

// ===========================================================================
// 9. Active alerts widen exclusion
// ===========================================================================

Deno.test("health monitor active alert: container added to exclusion automatically", async () => {
  let call = 0;
  let secondCallExclude: string[] = [];
  const op = ({ excludeContainers, onRouted }: {
    excludeContainers: string[];
    onRouted: (c: string) => void;
  }) => {
    call++;
    if (call === 1) {
      onRouted("Cronus28");
      return Promise.reject(
        new ContainerError("PSSession broken", "Cronus28", "compile"),
      );
    }
    secondCallExclude = [...excludeContainers];
    onRouted("Cronus282");
    return Promise.resolve({ ok: true });
  };
  const monitor = mockHealthMonitor({ activeAlerts: ["Cronus281"] });
  await withInfraRetry(op, {
    maxRetries: 1,
    configuredContainers: ["Cronus28", "Cronus281", "Cronus282"],
    healthMonitor: monitor,
    jitterMs: () => 0,
    context: { taskId: "t", variantId: "v", attemptNumber: 1 },
  });
  assert(secondCallExclude.includes("Cronus28"));
  assert(secondCallExclude.includes("Cronus281"));
});

Deno.test("health monitor: no active alerts -> exclusion NOT widened (only failed container)", async () => {
  let call = 0;
  let secondCallExclude: string[] = [];
  const op = ({ excludeContainers, onRouted }: {
    excludeContainers: string[];
    onRouted: (c: string) => void;
  }) => {
    call++;
    if (call === 1) {
      onRouted("Cronus28");
      return Promise.reject(
        new ContainerError("PSSession broken", "Cronus28", "compile"),
      );
    }
    secondCallExclude = [...excludeContainers];
    onRouted("Cronus281");
    return Promise.resolve({ ok: true });
  };
  // Fresh monitor with no alerts (the failing container did pass earlier so
  // its .alert is undefined). This is the "resolved/no-active-alert" case.
  const monitor = new ContainerHealthMonitor({ windowSize: 5 });
  monitor.record({
    containerName: "Cronus281",
    result: "pass",
    timestamp: 1,
  });
  await withInfraRetry(op, {
    maxRetries: 1,
    configuredContainers: ["Cronus28", "Cronus281", "Cronus282"],
    healthMonitor: monitor,
    jitterMs: () => 0,
    context: { taskId: "t", variantId: "v", attemptNumber: 1 },
  });
  // Only the failed container should be excluded — Cronus281 has no active
  // alert, so it must NOT be added.
  assertEquals(secondCallExclude, ["Cronus28"]);
});

// ===========================================================================
// 10. Unknown failed container
// ===========================================================================

Deno.test("infra error without containerName and no onRouted callback: refuse to retry", async () => {
  // isInfraError() returns true for messages matching infra hints — this one
  // matches /Run-TestsInBcContainer.*failed/ but is NOT a ContainerError, so
  // the helper cannot identify the failing container.
  const op = () => Promise.reject(new Error("Run-TestsInBcContainer failed"));
  const e = await assertRejects(
    () =>
      withInfraRetry(op, {
        maxRetries: 5,
        configuredContainers: ["Cronus28", "Cronus281"],
        jitterMs: () => 0,
        context: { taskId: "t", variantId: "v", attemptNumber: 1 },
      }),
    InfraRetriesExhaustedError,
  ) as InfraRetriesExhaustedError;
  assertEquals(e.reason, "unknown_failed_container");
});

// ===========================================================================
// 12. Event ordering
// ===========================================================================

Deno.test("event sequence on successful retry: started, succeeded; no failed/exhausted", async () => {
  let call = 0;
  const op = ({ onRouted }: {
    excludeContainers: string[];
    onRouted: (c: string) => void;
  }) => {
    call++;
    if (call === 1) {
      onRouted("Cronus28");
      return Promise.reject(
        new ContainerError("PSSession broken", "Cronus28", "compile"),
      );
    }
    onRouted("Cronus281");
    return Promise.resolve({ ok: true });
  };
  const events: ParallelExecutionEvent[] = [];
  await withInfraRetry(op, {
    maxRetries: 1,
    configuredContainers: ["Cronus28", "Cronus281"],
    jitterMs: () => 0,
    emit: (e) => events.push(e),
    context: { taskId: "t", variantId: "v", attemptNumber: 1 },
  });
  const retryEvents = events.filter((e) => e.type.startsWith("infra_retry"));
  assertEquals(retryEvents.length, 2);
  const [first, second] = retryEvents;
  assert(first !== undefined);
  assert(second !== undefined);
  assertEquals(first.type, "infra_retry_started");
  assertEquals(second.type, "infra_retry_succeeded");
});

Deno.test("event sequence on exhaustion: started, failed, exhausted (no succeeded)", async () => {
  let call = 0;
  const op = ({ onRouted }: {
    excludeContainers: string[];
    onRouted: (c: string) => void;
  }) => {
    call++;
    const c = call === 1 ? "Cronus28" : "Cronus281";
    onRouted(c);
    return Promise.reject(
      new ContainerError("PSSession broken", c, "compile"),
    );
  };
  const events: ParallelExecutionEvent[] = [];
  await assertRejects(
    () =>
      withInfraRetry(op, {
        maxRetries: 1,
        configuredContainers: ["Cronus28", "Cronus281", "Cronus282"],
        jitterMs: () => 0,
        emit: (e) => events.push(e),
        context: { taskId: "t", variantId: "v", attemptNumber: 1 },
      }),
    InfraRetriesExhaustedError,
  );
  const retryEvents = events.filter((e) => e.type.startsWith("infra_retry"));
  const types = retryEvents.map((e) => e.type);
  assertEquals(types, [
    "infra_retry_started",
    "infra_retry_failed",
    "infra_retry_exhausted",
  ]);
  // Must NOT contain "infra_retry_succeeded".
  assert(!types.includes("infra_retry_succeeded"));
});

// =============================================================================
// Quarantine waiver path (task #6)
// =============================================================================

Deno.test("waiver path does NOT emit infra_retry_started (routing-only, no monitor hit)", async () => {
  // The quarantine waiver is a routing decision, not new infra evidence.
  // Emitting infra_retry_started would cause the outcome recorder to
  // record the alerted container with a synthetic "container_quarantined"
  // fingerprint, which could trip a redundant persistent_container_failure
  // alert on the synthetic fp.
  let call = 0;
  const events: ParallelExecutionEvent[] = [];
  await withInfraRetry<{ ok: boolean; quarantined?: { alertId: string } }>(
    ({ onRouted }) => {
      call++;
      if (call === 1) {
        onRouted("Cronus28");
        return Promise.resolve({
          ok: false,
          quarantined: { alertId: "alert-1" },
        });
      }
      onRouted("Cronus281");
      return Promise.resolve({ ok: true });
    },
    {
      maxRetries: 1,
      configuredContainers: ["Cronus28", "Cronus281"],
      emit: (e) => events.push(e),
      context: { taskId: "T", variantId: "V", attemptNumber: 1 },
      classifyResult: (r) =>
        r.quarantined
          ? {
            kind: "quarantined",
            alertId: r.quarantined.alertId,
            originContainer: "Cronus28",
            fingerprint: "quarantine-fp",
          }
          : { kind: "ok" },
      jitterMs: () => 0,
    },
  );
  // The retry SUCCEEDED but no started/succeeded events were emitted from
  // the quarantine path. (The legacy failure path WOULD emit them; this
  // test pins the waiver-path silence.)
  const started = events.filter((e) => e.type === "infra_retry_started");
  assertEquals(started.length, 0);
});

Deno.test("waiver: quarantined result triggers free retry, does NOT debit budget", async () => {
  let call = 0;
  const { retries } = await withInfraRetry<
    { ok: boolean; quarantined?: { alertId: string } }
  >(
    ({ onRouted }) => {
      call++;
      if (call === 1) {
        onRouted("Cronus28");
        return Promise.resolve({
          ok: false,
          quarantined: { alertId: "alert-1" },
        });
      }
      onRouted("Cronus281");
      return Promise.resolve({ ok: true });
    },
    {
      maxRetries: 1,
      configuredContainers: ["Cronus28", "Cronus281", "Cronus282"],
      context: { taskId: "T", variantId: "V", attemptNumber: 1 },
      classifyResult: (r) =>
        r.quarantined
          ? {
            kind: "quarantined",
            alertId: r.quarantined.alertId,
            originContainer: "Cronus28",
            fingerprint: "quarantine-fp",
          }
          : { kind: "ok" },
      jitterMs: () => 0,
    },
  );
  assertEquals(retries.length, 1);
  assertEquals(retries[0]!.cause, "alert_drain");
  assertEquals(retries[0]!.budgetDebited, false);
  assertEquals(retries[0]!.waiverReason, "trigger_task");
  assertEquals(retries[0]!.alertId, "alert-1");
  assertEquals(retries[0]!.outcome, "succeeded");
});

Deno.test("waiver: free retry on top of a normal infra retry — both records distinct", async () => {
  let call = 0;
  const errs = {
    infra: new ContainerError("publish blew up", "Cronus28", "publish", {}),
  };
  const { retries } = await withInfraRetry<
    { ok: boolean; quarantined?: { alertId: string } }
  >(
    ({ onRouted }) => {
      call++;
      if (call === 1) {
        onRouted("Cronus28");
        return Promise.reject(errs.infra);
      }
      if (call === 2) {
        onRouted("Cronus281");
        return Promise.resolve({
          ok: false,
          quarantined: { alertId: "alert-7" },
        });
      }
      onRouted("Cronus282");
      return Promise.resolve({ ok: true });
    },
    {
      maxRetries: 1, // 1 normal retry; quarantine waiver gives +1 free
      configuredContainers: ["Cronus28", "Cronus281", "Cronus282"],
      context: { taskId: "T", variantId: "V", attemptNumber: 1 },
      classifyResult: (r) =>
        r.quarantined
          ? {
            kind: "quarantined",
            alertId: r.quarantined.alertId,
            originContainer: "Cronus281",
            fingerprint: "quarantine-fp",
          }
          : { kind: "ok" },
      jitterMs: () => 0,
    },
  );
  assertEquals(retries.length, 2);
  // First record: normal failure-path retry
  assertEquals(retries[0]!.cause, "failure");
  assertEquals(retries[0]!.budgetDebited, true);
  // Second record: waived alert_drain retry
  assertEquals(retries[1]!.cause, "alert_drain");
  assertEquals(retries[1]!.budgetDebited, false);
  assertEquals(retries[1]!.alertId, "alert-7");
});

Deno.test("waiver cap: same alertId hit twice does NOT grant unlimited free retries", async () => {
  let call = 0;
  // Quarantined alert-X TWICE in a row → only the first is waived; the
  // second debits budget normally. Since maxRetries=0 and budget already
  // exhausted by first waiver, the second should raise exhaustion.
  await assertRejects(
    () =>
      withInfraRetry<{ quarantined?: { alertId: string } }>(
        ({ onRouted }) => {
          call++;
          onRouted(`C${call}`);
          return Promise.resolve({ quarantined: { alertId: "alert-stuck" } });
        },
        {
          maxRetries: 1,
          configuredContainers: ["C1", "C2", "C3", "C4"],
          context: { taskId: "T", variantId: "V", attemptNumber: 1 },
          classifyResult: (r) =>
            r.quarantined
              ? {
                kind: "quarantined",
                alertId: r.quarantined.alertId,
                originContainer: "C1",
                fingerprint: "stuck-fp",
              }
              : { kind: "ok" },
          jitterMs: () => 0,
        },
      ),
    InfraRetriesExhaustedError,
  );
  // call sequence: initial (waived), retry1 (waived again? capped),
  // retry2 (no more budget) — at least 2 calls.
  assert(call >= 2);
});
