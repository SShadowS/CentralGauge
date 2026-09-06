import { assert, assertEquals, assertRejects } from "@std/assert";
import type {
  CompileWorkItem,
  CompileWorkResult,
  ParallelExecutionEvent,
} from "../../../../src/parallel/types.ts";
import { runCompileWorkItem } from "../../../../src/parallel/shared/run-compile.ts";
import { InfraRetriesExhaustedError } from "../../../../src/parallel/errors.ts";
import { ContainerError } from "../../../../src/errors.ts";
import { MultiContainerMockCompileQueue } from "../../../utils/multi-container-mock-compile-queue.ts";
import { createMockCompileWorkItem } from "../../../utils/test-helpers.ts";

const CONTAINER = "Cronus28";

Deno.test("runCompileWorkItem returns the queue result and emits the compile events", async () => {
  const queue = new MultiContainerMockCompileQueue([CONTAINER]);
  const events: ParallelExecutionEvent["type"][] = [];
  const item: CompileWorkItem = createMockCompileWorkItem({ attemptNumber: 1 });
  const { compileResult, infraRetries } = await runCompileWorkItem(item, {
    queue,
    configuredContainers: [CONTAINER],
    maxRetries: 1,
    emit: (e) => events.push(e.type),
    taskId: item.context.manifest.id,
    variantId: item.context.variantId,
  });
  assertEquals(compileResult.containerName, CONTAINER);
  assertEquals(infraRetries, []);
  assertEquals(events, [
    "compile_queued",
    "compile_started",
    "compile_completed",
  ]);
});

Deno.test("runCompileWorkItem rethrows infra exhaustion from a quarantined result", async () => {
  // Every routed container comes back quarantined under the SAME alertId.
  // With 2 configured containers the first quarantine is a free waiver (a
  // retry record is pushed and the work reroutes to the second container);
  // the second quarantine hit debits budget and covers every configured
  // container, so `withInfraRetry` exhausts with a non-empty retry trail —
  // matching the single-container immediate-exhaustion case (asserted
  // separately below) is a DIFFERENT, empty-trail outcome, so this test
  // uses 2 containers to exercise the trail-carrying exhaustion path.
  const CONTAINER_B = "Cronus281";
  class Quarantines extends MultiContainerMockCompileQueue {
    override async enqueue(
      item: CompileWorkItem,
      options?: Parameters<MultiContainerMockCompileQueue["enqueue"]>[1],
    ): Promise<CompileWorkResult> {
      const r = await super.enqueue(item, options);
      r.quarantined = {
        quarantined: true,
        forcedByAlertId: "alert-1",
        originContainer: r.containerName,
        classificationReason: "container_quarantined",
      };
      return r;
    }
  }
  const item = createMockCompileWorkItem({ attemptNumber: 1 });
  const err = await assertRejects(
    () =>
      runCompileWorkItem(item, {
        queue: new Quarantines([CONTAINER, CONTAINER_B]),
        configuredContainers: [CONTAINER, CONTAINER_B],
        maxRetries: 1,
        emit: () => {},
        taskId: item.context.manifest.id,
        variantId: item.context.variantId,
      }),
    InfraRetriesExhaustedError,
  );
  assert(err.retries.length >= 1);
});

Deno.test("runCompileWorkItem rethrows a bare ContainerError when infra retry is disabled (maxRetries 0)", async () => {
  // `withInfraRetry`'s fast path (`maxRetries <= 0`) runs the operation
  // once and, for a quarantined result, throws a bare `ContainerError`
  // rather than `InfraRetriesExhaustedError` — there is nothing to reroute
  // to with retries disabled (see the fast-path doc comment in
  // `src/parallel/infra-retry.ts`). `runCompileWorkItem` must propagate
  // that unchanged.
  class Quarantines extends MultiContainerMockCompileQueue {
    override async enqueue(
      item: CompileWorkItem,
      options?: Parameters<MultiContainerMockCompileQueue["enqueue"]>[1],
    ): Promise<CompileWorkResult> {
      const r = await super.enqueue(item, options);
      r.quarantined = {
        quarantined: true,
        forcedByAlertId: "alert-1",
        originContainer: r.containerName,
        classificationReason: "container_quarantined",
      };
      return r;
    }
  }
  const item = createMockCompileWorkItem({ attemptNumber: 1 });
  await assertRejects(
    () =>
      runCompileWorkItem(item, {
        queue: new Quarantines([CONTAINER]),
        configuredContainers: [CONTAINER],
        maxRetries: 0,
        emit: () => {},
        taskId: item.context.manifest.id,
        variantId: item.context.variantId,
      }),
    ContainerError,
  );
});
