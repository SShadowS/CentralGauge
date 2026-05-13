/**
 * Unit tests for per-call `excludeContainers` + `onRouted` routing options
 * on `CompileQueue` (single) and `CompileQueuePool` (multi).
 *
 * These options activate the inline infra-retry helper (Task 3): callers can
 * exclude specific containers at routing time and observe which container the
 * pool picked via a callback fired BEFORE work begins.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";

import { CompileQueue } from "../../../src/parallel/compile-queue.ts";
import { CompileQueuePool } from "../../../src/parallel/compile-queue-pool.ts";
import { NoEligibleContainersError } from "../../../src/parallel/errors.ts";
import {
  createMockContainerProvider,
  MockContainerProvider,
} from "../../utils/mock-container-provider.ts";
import { createMockCompileWorkItem } from "../../utils/test-helpers.ts";

// CompileQueue creates setTimeout handlers for timeouts that aren't cleared.
// Disable sanitizeOps to avoid timer leak errors.
describe({
  name: "CompileQueue exclusion + onRouted",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  let mockProvider: MockContainerProvider;

  beforeEach(() => {
    mockProvider = createMockContainerProvider();
  });

  afterEach(() => {
    mockProvider.reset();
  });

  it("throws NoEligibleContainersError when its container is excluded", async () => {
    const queue = new CompileQueue(mockProvider, "Cronus28");
    await assertRejects(
      () =>
        queue.enqueue(createMockCompileWorkItem(), {
          excludeContainers: ["Cronus28"],
        }),
      NoEligibleContainersError,
    );
  });

  it("preserves NoEligibleContainersError context (configured/excluded)", async () => {
    const queue = new CompileQueue(mockProvider, "Cronus28");
    const err = await assertRejects(
      () =>
        queue.enqueue(createMockCompileWorkItem(), {
          excludeContainers: ["Cronus28", "Cronus281"],
        }),
      NoEligibleContainersError,
    ) as NoEligibleContainersError;
    assertEquals(err.configuredContainers, ["Cronus28"]);
    assertEquals(err.excludedContainers, ["Cronus28", "Cronus281"]);
  });

  it("calls onRouted with its containerName BEFORE doing work", async () => {
    const queue = new CompileQueue(mockProvider, "Cronus28");
    let routed: string | undefined;
    // Capture the order: onRouted must fire before compileProject runs.
    const order: string[] = [];
    const origCompile = mockProvider.compileProject.bind(mockProvider);
    mockProvider.compileProject = (...args) => {
      order.push("compile");
      return origCompile(...args);
    };
    await queue.enqueue(createMockCompileWorkItem(), {
      onRouted: (c) => {
        order.push("onRouted");
        routed = c;
      },
    });
    assertEquals(routed, "Cronus28");
    assertEquals(order[0], "onRouted");
  });

  it("proceeds normally when exclusion list does not include its container", async () => {
    const queue = new CompileQueue(mockProvider, "Cronus28");
    const result = await queue.enqueue(createMockCompileWorkItem(), {
      excludeContainers: ["Cronus281", "Cronus282"],
    });
    assertEquals(result.compilationResult.success, true);
  });

  it("works with no options (backward compatible)", async () => {
    const queue = new CompileQueue(mockProvider, "Cronus28");
    const result = await queue.enqueue(createMockCompileWorkItem());
    assertEquals(result.compilationResult.success, true);
  });

  // Defensive: empty exclude list must behave identically to no option.
  // Regression guard for callers that pass `excludeContainers: []` to mean
  // "no exclusions yet" (e.g. first attempt of `withInfraRetry`).
  it("excludeContainers: [] does not throw and behaves like no option", async () => {
    const queue = new CompileQueue(mockProvider, "Cronus28");
    const result = await queue.enqueue(createMockCompileWorkItem(), {
      excludeContainers: [],
    });
    assertEquals(result.compilationResult.success, true);
  });

  // Defensive: a synchronous throw inside `onRouted` must reject the
  // returned promise rather than escape `enqueue` as a sync throw.
  // Task 3's `withInfraRetry` relies on `.catch()` seeing the error.
  it("onRouted throwing rejects the promise (does not throw sync)", async () => {
    const queue = new CompileQueue(mockProvider, "Cronus28");
    const err = new Error("onRouted boom");
    await assertRejects(
      () =>
        queue.enqueue(createMockCompileWorkItem(), {
          onRouted: () => {
            throw err;
          },
        }),
      Error,
      "onRouted boom",
    );
  });
});

describe({
  name: "CompileQueuePool exclusion + onRouted",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  let mockProvider: MockContainerProvider;

  beforeEach(() => {
    mockProvider = createMockContainerProvider();
  });

  afterEach(() => {
    mockProvider.reset();
  });

  it("routes to non-excluded queues only", async () => {
    const pool = new CompileQueuePool(mockProvider, [
      "Cronus28",
      "Cronus281",
      "Cronus282",
    ]);
    let routed: string | undefined;
    await pool.enqueue(createMockCompileWorkItem(), {
      excludeContainers: ["Cronus28"],
      onRouted: (c) => (routed = c),
    });
    assertNotEquals(routed, "Cronus28");
    assert(routed === "Cronus281" || routed === "Cronus282");
  });

  it("throws NoEligibleContainersError when all queues excluded", async () => {
    const pool = new CompileQueuePool(mockProvider, [
      "Cronus28",
      "Cronus281",
    ]);
    await assertRejects(
      () =>
        pool.enqueue(createMockCompileWorkItem(), {
          excludeContainers: ["Cronus28", "Cronus281"],
        }),
      NoEligibleContainersError,
    );
  });

  it("NoEligibleContainersError records full configured pool", async () => {
    const pool = new CompileQueuePool(mockProvider, [
      "Cronus28",
      "Cronus281",
      "Cronus282",
    ]);
    const err = await assertRejects(
      () =>
        pool.enqueue(createMockCompileWorkItem(), {
          excludeContainers: ["Cronus28", "Cronus281", "Cronus282"],
        }),
      NoEligibleContainersError,
    ) as NoEligibleContainersError;
    assertEquals(err.configuredContainers, [
      "Cronus28",
      "Cronus281",
      "Cronus282",
    ]);
  });

  it("rotor fans out across eligible queues under repeated calls", async () => {
    const pool = new CompileQueuePool(mockProvider, [
      "Cronus28",
      "Cronus281",
      "Cronus282",
    ]);
    const routes: string[] = [];
    for (let i = 0; i < 6; i++) {
      await pool.enqueue(createMockCompileWorkItem({ id: `wi-${i}` }), {
        excludeContainers: ["Cronus28"],
        onRouted: (c) => routes.push(c),
      });
    }
    // Both eligible containers must appear at least once — proves rotor
    // advances over eligible subset.
    assert(routes.includes("Cronus281"), `routes: ${routes.join(",")}`);
    assert(routes.includes("Cronus282"), `routes: ${routes.join(",")}`);
    // Verify no routes hit the excluded container.
    assert(
      !routes.includes("Cronus28"),
      `Cronus28 routed to despite exclusion: ${routes.join(",")}`,
    );
  });

  it("onRouted is called exactly once per enqueue (no double-invocation across pool + sub-queue)", async () => {
    const pool = new CompileQueuePool(mockProvider, ["c1", "c2"]);
    let count = 0;
    await pool.enqueue(createMockCompileWorkItem(), {
      onRouted: () => count++,
    });
    assertEquals(count, 1);
  });

  it("onRouted fires before the sub-queue starts compiling", async () => {
    const pool = new CompileQueuePool(mockProvider, ["c1", "c2"]);
    const order: string[] = [];
    const origCompile = mockProvider.compileProject.bind(mockProvider);
    mockProvider.compileProject = (...args) => {
      order.push("compile");
      return origCompile(...args);
    };
    await pool.enqueue(createMockCompileWorkItem(), {
      onRouted: () => order.push("onRouted"),
    });
    assertEquals(order[0], "onRouted");
  });

  it("routing-log integrity: routedTo is eligible, but poolDepthsAtRouting covers ALL queues", async () => {
    const pool = new CompileQueuePool(mockProvider, [
      "Cronus28",
      "Cronus281",
      "Cronus282",
    ]);

    await pool.enqueue(createMockCompileWorkItem({ id: "wi-exc" }), {
      excludeContainers: ["Cronus28"],
    });
    await pool.drain();

    const snap = pool.getPoolSnapshot();
    const entry = snap.recentRouting.find((r) => r.workItemId === "wi-exc");
    assert(entry, "routing entry should be recorded");
    // routedTo must be an eligible container.
    assertNotEquals(entry!.routedTo, "Cronus28");
    assert(
      entry!.routedTo === "Cronus281" || entry!.routedTo === "Cronus282",
    );
    // poolDepthsAtRouting must cover ALL configured queues (not just eligible).
    assertEquals(
      Object.keys(entry!.poolDepthsAtRouting).sort(),
      ["Cronus28", "Cronus281", "Cronus282"],
    );
    assertEquals(
      Object.keys(entry!.poolLoadsAtRouting).sort(),
      ["Cronus28", "Cronus281", "Cronus282"],
    );
  });

  it("works with no options (backward compatible)", async () => {
    const pool = new CompileQueuePool(mockProvider, ["c1", "c2"]);
    const result = await pool.enqueue(createMockCompileWorkItem());
    assert(result.compilationResult);
  });

  // Defensive: empty exclude list must behave identically to no option.
  // `withInfraRetry` passes `excludeContainers: []` on its first attempt
  // before any infra failures have been observed.
  it("excludeContainers: [] behaves identically to no option", async () => {
    const pool = new CompileQueuePool(mockProvider, ["Cronus28", "Cronus281"]);
    let routed: string | undefined;
    const result = await pool.enqueue(createMockCompileWorkItem(), {
      excludeContainers: [],
      onRouted: (c) => (routed = c),
    });
    assert(result.compilationResult);
    assert(
      routed === "Cronus28" || routed === "Cronus281",
      `routed should be a pool member, got ${routed}`,
    );
  });

  // Defensive: a name not in the pool must be silently ignored, not error.
  // Avoids the failure mode where the helper accidentally stamps a typo'd
  // or stale container name and disables the entire pool.
  it("excludeContainers with unknown name is silently ignored", async () => {
    const pool = new CompileQueuePool(mockProvider, ["Cronus28", "Cronus281"]);
    let routed: string | undefined;
    await pool.enqueue(createMockCompileWorkItem(), {
      excludeContainers: ["Cronus99"],
      onRouted: (c) => (routed = c),
    });
    assert(
      routed === "Cronus28" || routed === "Cronus281",
      `routed should be a pool member, got ${routed}`,
    );
  });

  // Defensive: a synchronous throw inside `onRouted` must reject the
  // returned promise rather than escape `enqueue` as a sync throw.
  // `enqueue` is `async`, so throws are auto-converted to rejections.
  it("onRouted throwing rejects the promise (does not throw sync)", async () => {
    const pool = new CompileQueuePool(mockProvider, ["Cronus28"]);
    const err = new Error("onRouted boom");
    await assertRejects(
      () =>
        pool.enqueue(createMockCompileWorkItem(), {
          onRouted: () => {
            throw err;
          },
        }),
      Error,
      "onRouted boom",
    );
  });
});
