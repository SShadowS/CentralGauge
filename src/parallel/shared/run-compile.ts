// src/parallel/shared/run-compile.ts

import type { CompileEnqueueOptions } from "../compile-queue-pool.ts";
import type {
  CompileWorkItem,
  CompileWorkResult,
  ParallelExecutionEvent,
} from "../types.ts";
import type { InfraRetryRecord } from "../../tasks/interfaces.ts";
import { withInfraRetry } from "../infra-retry.ts";
import type { ContainerHealthMonitor } from "../../health/monitor.ts";

/**
 * Dependencies `runCompileWorkItem` needs to route a compile work item
 * through the compile queue with inline infra-retry, emitting the same
 * `compile_queued` / `compile_started` / `compile_completed` events the
 * sync orchestrator's `executeCompilation` emits today (spec D6). `queue`
 * is typed structurally (`enqueue` + `length`) so callers can pass either
 * the real `CompileWorkQueue` or a narrower test double.
 */
export interface RunCompileDeps {
  queue: {
    enqueue(
      item: CompileWorkItem,
      options?: CompileEnqueueOptions,
    ): Promise<CompileWorkResult>;
    readonly length: number;
  };
  configuredContainers: string[];
  /** `options.infraRetriesPerAttempt ?? 1` */
  maxRetries: number;
  emit: (event: ParallelExecutionEvent) => void;
  healthMonitor?: ContainerHealthMonitor;
  taskId: string;
  variantId: string;
}

/**
 * Route a compile work item through the compile queue with inline
 * infra-retry. Emits `compile_queued` once, `compile_started` per routed
 * try, and `compile_completed` once on final resolution. Throws whatever
 * `withInfraRetry` throws (`InfraRetriesExhaustedError` on exhaustion).
 */
export async function runCompileWorkItem(
  item: CompileWorkItem,
  deps: RunCompileDeps,
): Promise<
  { compileResult: CompileWorkResult; infraRetries: InfraRetryRecord[] }
> {
  // Build the work item ONCE; emit `compile_queued` ONCE per attempt. The
  // retry helper invokes the operation 1..(1+maxRetries) times, but the
  // "queued" event represents the orchestrator's intent to compile — not
  // the dispatcher's per-attempt routing. `compile_started` lives INSIDE
  // the callback so it fires per attempt.
  deps.emit({
    type: "compile_queued",
    taskId: deps.taskId,
    model: deps.variantId,
    queuePosition: deps.queue.length,
  });

  const { result: compileResult, retries } = await withInfraRetry<
    CompileWorkResult
  >(
    ({ excludeContainers, onRouted }) => {
      deps.emit({
        type: "compile_started",
        taskId: deps.taskId,
        model: deps.variantId,
      });
      return deps.queue.enqueue(item, {
        excludeContainers,
        onRouted,
      });
    },
    {
      maxRetries: deps.maxRetries,
      configuredContainers: deps.configuredContainers,
      emit: deps.emit,
      context: {
        taskId: deps.taskId,
        variantId: deps.variantId,
        attemptNumber: item.attemptNumber,
      },
      ...(deps.healthMonitor ? { healthMonitor: deps.healthMonitor } : {}),
      // Detect the quarantine sidecar attached by `runPipeline` (task #5).
      // When present, the retry path treats the resolved-but-quarantined
      // result as an infra error AND grants a budget waiver.
      classifyResult: (r: CompileWorkResult) =>
        r.quarantined
          ? {
            kind: "quarantined" as const,
            alertId: r.quarantined.forcedByAlertId,
            originContainer: r.quarantined.originContainer,
            fingerprint: "container_quarantined",
          }
          : { kind: "ok" as const },
    },
  );

  deps.emit({
    type: "compile_completed",
    taskId: deps.taskId,
    model: deps.variantId,
    success: compileResult.compilationResult.success,
  });

  return { compileResult, infraRetries: retries };
}
