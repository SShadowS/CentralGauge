// tests/unit/health/outcome-recorder.test.ts
import { assertEquals } from "@std/assert";
import { attachOutcomeRecorder } from "../../../src/health/outcome-recorder.ts";
import { ContainerHealthMonitor } from "../../../src/health/monitor.ts";
import type { ParallelExecutionEvent } from "../../../src/parallel/types.ts";
import type { TaskExecutionResult } from "../../../src/tasks/interfaces.ts";

/**
 * Minimal orchestrator-like emitter — covers just the `on()` contract so the
 * recorder can subscribe and we can fire synthetic events at it.
 */
function makeEmitter() {
  const listeners = new Set<(e: ParallelExecutionEvent) => void>();
  return {
    on(l: (e: ParallelExecutionEvent) => void): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    emit(e: ParallelExecutionEvent): void {
      for (const l of listeners) l(e);
    },
  };
}

Deno.test("recorder records pass outcome from result event", () => {
  const monitor = new ContainerHealthMonitor({ windowSize: 5 });
  const emitter = makeEmitter();
  attachOutcomeRecorder(emitter.on.bind(emitter), monitor);

  // Fake result with a single passing attempt that touched a container.
  const result = {
    taskId: "T1",
    executionId: "e1",
    attempts: [
      {
        attemptNumber: 1,
        containerName: "Cronus28",
        compilationResult: { success: true },
        testResult: { success: true, passedTests: 1, totalTests: 1 },
      },
    ],
    success: true,
  } as unknown as TaskExecutionResult;
  emitter.emit({ type: "result", result });

  const c = monitor.getState().containers.find((x) =>
    x.containerName === "Cronus28"
  );
  assertEquals(c?.passCount, 1);
});

Deno.test("recorder records infra_error from error event with fingerprint", () => {
  const monitor = new ContainerHealthMonitor({ windowSize: 5 });
  const emitter = makeEmitter();
  attachOutcomeRecorder(emitter.on.bind(emitter), monitor);

  // 3 infra errors on the same container/fp must trip persistent alert.
  for (let i = 0; i < 3; i++) {
    emitter.emit({
      type: "error",
      error: new Error("boom"),
      containerName: "Cronus281",
      fingerprint: "test:fp",
      signatureId: "syslib0014",
    });
  }
  const state = monitor.getState();
  assertEquals(state.alerts.length, 1);
  assertEquals(state.alerts[0]!.kind, "persistent_container_failure");
});

Deno.test("recorder records infra_retry_started as infra_error on the failing container", () => {
  const monitor = new ContainerHealthMonitor({ windowSize: 5 });
  const emitter = makeEmitter();
  attachOutcomeRecorder(emitter.on.bind(emitter), monitor);

  emitter.emit({
    type: "infra_retry_started",
    taskId: "T",
    variantId: "V",
    attemptNumber: 1,
    retryNumber: 1,
    originalContainerName: "Cronus28",
    fingerprint: "test:fp",
  });
  const c = monitor.getState().containers.find((x) =>
    x.containerName === "Cronus28"
  );
  assertEquals(c?.errorCount, 1);
});

Deno.test("recorder ignores error events without containerName", () => {
  const monitor = new ContainerHealthMonitor({ windowSize: 5 });
  const emitter = makeEmitter();
  attachOutcomeRecorder(emitter.on.bind(emitter), monitor);

  emitter.emit({ type: "error", error: new Error("untyped") });
  // No container known → no record made → no containers tracked.
  assertEquals(monitor.getState().containers.length, 0);
});

Deno.test("recorder SKIPS quarantined attempts (no failCount inflation)", () => {
  const monitor = new ContainerHealthMonitor({ windowSize: 5 });
  const emitter = makeEmitter();
  attachOutcomeRecorder(emitter.on.bind(emitter), monitor);

  // Quarantined attempt: compilation failed BUT was tagged for reroute.
  // The recorder must not record this as a fail outcome on Cronus28 —
  // that container is already in alert state and the failure isn't a
  // fresh model verdict. The marker lives at the attempt level (lifted
  // from CompileWorkResult by orchestrator.createAttempt).
  const result = {
    taskId: "T1",
    executionId: "e1",
    attempts: [
      {
        attemptNumber: 1,
        containerName: "Cronus28",
        compilationResult: {
          success: false,
        },
        quarantined: {
          quarantined: true,
          forcedByAlertId: "alert-1",
          originContainer: "Cronus28",
          classificationReason: "container_quarantined",
        },
      },
    ],
    success: false,
  } as unknown as TaskExecutionResult;
  emitter.emit({ type: "result", result });

  const c = monitor.getState().containers.find((x) =>
    x.containerName === "Cronus28"
  );
  // Skipped entirely → no container row added.
  assertEquals(c, undefined);
});

Deno.test("recorder unsubscribe stops further recording", () => {
  const monitor = new ContainerHealthMonitor({ windowSize: 5 });
  const emitter = makeEmitter();
  const detach = attachOutcomeRecorder(emitter.on.bind(emitter), monitor);
  detach();
  emitter.emit({
    type: "error",
    error: new Error("after detach"),
    containerName: "Cronus28",
    fingerprint: "test:fp",
  });
  assertEquals(monitor.getState().containers.length, 0);
});
