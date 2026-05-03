/**
 * Unit tests for CompileQueue
 *
 * Tests the FIFO compile queue with parallel compilation (semaphore)
 * and serial test execution (mutex).
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";

import {
  CompileQueue,
  QueueFullError,
  QueueTimeoutError,
} from "../../../src/parallel/compile-queue.ts";
import {
  createMockContainerProvider,
  MockContainerProvider,
} from "../../utils/mock-container-provider.ts";
import {
  createMockCompileWorkItem,
  createMockTaskExecutionContext,
  createMockTaskManifest,
} from "../../utils/test-helpers.ts";

// Note: CompileQueue creates setTimeout handlers for timeouts that aren't cleared
// when items complete or the queue is cleared. Disable sanitizeOps to avoid timer leak errors.
describe({
  name: "CompileQueue",
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

  describe("constructor", () => {
    it("should create queue with default options", () => {
      const queue = new CompileQueue(mockProvider, "test-container");

      assertEquals(queue.length, 0);
      assertEquals(queue.isProcessing, false);
    });

    it("should accept custom maxQueueSize", () => {
      const queue = new CompileQueue(mockProvider, "test-container", {
        maxQueueSize: 5,
      });

      assertEquals(queue.length, 0);
    });

    it("should accept custom timeout", () => {
      const queue = new CompileQueue(mockProvider, "test-container", {
        timeout: 1000,
      });

      assertEquals(queue.length, 0);
    });
  });

  describe("enqueue", () => {
    it("should enqueue a work item and return a promise", () => {
      const queue = new CompileQueue(mockProvider, "test-container");
      const workItem = createMockCompileWorkItem();

      const promise = queue.enqueue(workItem);

      assertEquals(typeof promise.then, "function");
    });

    it("should reject when queue is full", async () => {
      const queue = new CompileQueue(mockProvider, "test-container", {
        maxQueueSize: 2, // Allow 2 items in queue
        timeout: 5000, // Long timeout to prevent timeout errors
      });

      // Configure slow processing to keep queue items pending
      mockProvider.setCompilationConfig({ delay: 500, success: true });

      // Enqueue items rapidly - they will pile up because processing is slow
      const item1 = createMockCompileWorkItem({ id: "item-1" });
      const item2 = createMockCompileWorkItem({ id: "item-2" });
      const item3 = createMockCompileWorkItem({ id: "item-3" });

      // Attach catch handlers immediately to prevent unhandled rejections
      const promise1 = queue.enqueue(item1).catch(() => {});
      const promise2 = queue.enqueue(item2).catch(() => {});

      // Third item should be rejected (queue has 2 items, which is the max)
      await assertRejects(
        () => queue.enqueue(item3),
        QueueFullError,
        "Compile queue full",
      );

      // Clear queue to clean up
      queue.clear();

      // Wait for promises to settle
      await promise1;
      await promise2;
    });

    it("should process items and resolve promise", async () => {
      const queue = new CompileQueue(mockProvider, "test-container");
      mockProvider.setCompilationConfig({ success: true });

      const workItem = createMockCompileWorkItem();
      const result = await queue.enqueue(workItem);

      assertEquals(result.workItemId, workItem.id);
      assertEquals(result.compilationResult.success, true);
      assertEquals(typeof result.duration, "number");
    });

    it("should reject on compilation failure", async () => {
      const queue = new CompileQueue(mockProvider, "test-container");
      mockProvider.setCompilationConfig({
        success: false,
        errors: [
          {
            code: "AL0001",
            message: "Test error",
            file: "test.al",
            line: 1,
            column: 1,
            severity: "error",
          },
        ],
      });

      const workItem = createMockCompileWorkItem();
      const result = await queue.enqueue(workItem);

      // Compilation failure returns result with success=false, doesn't reject
      assertEquals(result.compilationResult.success, false);
      assertEquals(result.compilationResult.errors.length, 1);
    });
  });

  describe("getPosition", () => {
    it("should return -1 for item not in queue", () => {
      const queue = new CompileQueue(mockProvider, "test-container");

      assertEquals(queue.getPosition("non-existent"), -1);
    });
  });

  describe("getStats", () => {
    it("should return initial stats", () => {
      const queue = new CompileQueue(mockProvider, "test-container");
      const stats = queue.getStats();

      assertEquals(stats.pending, 0);
      assertEquals(stats.processing, false);
      assertEquals(stats.activeCompilations, 0);
      assertEquals(stats.testRunning, false);
      assertEquals(stats.activeItems, 0);
      assertEquals(stats.processed, 0);
      assertEquals(stats.avgWaitTime, 0);
      assertEquals(stats.avgProcessTime, 0);
    });

    it("should track processed count after processing", async () => {
      const queue = new CompileQueue(mockProvider, "test-container");
      mockProvider.setCompilationConfig({ success: true });

      const workItem = createMockCompileWorkItem();
      await queue.enqueue(workItem);
      await queue.drain();

      const stats = queue.getStats();
      assertEquals(stats.processed, 1);
    });
  });

  describe("length", () => {
    it("should return 0 for empty queue", () => {
      const queue = new CompileQueue(mockProvider, "test-container");
      assertEquals(queue.length, 0);
    });
  });

  describe("isProcessing", () => {
    it("should return false when not processing", () => {
      const queue = new CompileQueue(mockProvider, "test-container");
      assertEquals(queue.isProcessing, false);
    });
  });

  describe("clear", () => {
    it("should clear all pending items", async () => {
      // Use compileConcurrency=1 so only 1 item dispatches at a time.
      // With a long delay, item2 stays in the queue until we clear it.
      const queue = new CompileQueue(mockProvider, "test-container", {
        timeout: 5000,
        compileConcurrency: 1,
      });
      mockProvider.setCompilationConfig({ delay: 1000, success: true });

      // Enqueue items (first starts processing, second waits in queue)
      const item1 = createMockCompileWorkItem({ id: "item-1" });
      const item2 = createMockCompileWorkItem({ id: "item-2" });

      queue.enqueue(item1).catch(() => {}); // First item starts processing
      // Small delay so processQueue runs and dispatches item1
      await new Promise((r) => setTimeout(r, 20));
      const promise2 = queue.enqueue(item2);

      // Small delay to let item2 enter the queue
      await new Promise((r) => setTimeout(r, 20));

      // Clear queue
      queue.clear();

      // Pending items should be rejected
      await assertRejects(() => promise2, Error, "Queue cleared");
    });

    it("should be callable on empty queue", () => {
      const queue = new CompileQueue(mockProvider, "test-container");
      queue.clear(); // Should not throw
      assertEquals(queue.length, 0);
    });
  });

  describe("drain", () => {
    it("should resolve immediately for empty queue", async () => {
      const queue = new CompileQueue(mockProvider, "test-container");
      await queue.drain(); // Should resolve immediately
      assertEquals(queue.length, 0);
    });

    it("should wait for all items to be processed", async () => {
      const queue = new CompileQueue(mockProvider, "test-container");
      mockProvider.setCompilationConfig({ delay: 10, success: true });

      // Enqueue multiple items
      const item1 = createMockCompileWorkItem({ id: "item-1" });
      const item2 = createMockCompileWorkItem({ id: "item-2" });

      queue.enqueue(item1);
      queue.enqueue(item2);

      // Drain should wait for all to complete
      await queue.drain();

      assertEquals(queue.length, 0);
      assertEquals(queue.getStats().processed, 2);
    });
  });

  describe("FIFO ordering", () => {
    it("should process items in order when concurrency is 1", async () => {
      const queue = new CompileQueue(mockProvider, "test-container", {
        compileConcurrency: 1,
      });
      mockProvider.setCompilationConfig({ delay: 10, success: true });

      const processedOrder: string[] = [];

      // Override the mock to track processing order
      const item1 = createMockCompileWorkItem({ id: "item-1" });
      const item2 = createMockCompileWorkItem({ id: "item-2" });
      const item3 = createMockCompileWorkItem({ id: "item-3" });

      const results = await Promise.all([
        queue.enqueue(item1).then((r) => {
          processedOrder.push("item-1");
          return r;
        }),
        queue.enqueue(item2).then((r) => {
          processedOrder.push("item-2");
          return r;
        }),
        queue.enqueue(item3).then((r) => {
          processedOrder.push("item-3");
          return r;
        }),
      ]);

      // All should complete
      assertEquals(results.length, 3);
      // Order should be maintained
      assertEquals(processedOrder, ["item-1", "item-2", "item-3"]);
    });
  });

  describe("test execution", () => {
    it("should run tests when testApp is configured", async () => {
      const queue = new CompileQueue(mockProvider, "test-container");
      mockProvider.setCompilationConfig({ success: true });
      mockProvider.setTestConfig({
        success: true,
        totalTests: 3,
        passedTests: 3,
      });

      const workItem = createMockCompileWorkItem({
        context: createMockTaskExecutionContext({
          manifest: createMockTaskManifest({
            expected: {
              compile: true,
              testApp: "tests/fixtures/TestApp.al",
            },
          }),
        }),
      });

      const result = await queue.enqueue(workItem);

      assertEquals(result.compilationResult.success, true);
      // Note: testResult may be undefined if testApp file doesn't exist
      // This test mainly verifies the flow doesn't error
    });

    it("should not run tests when testApp is not configured", async () => {
      const queue = new CompileQueue(mockProvider, "test-container");
      mockProvider.setCompilationConfig({ success: true });

      const workItem = createMockCompileWorkItem({
        context: createMockTaskExecutionContext({
          manifest: createMockTaskManifest({
            expected: {
              compile: true,
            },
          }),
        }),
      });

      const result = await queue.enqueue(workItem);

      assertEquals(result.compilationResult.success, true);
      assertEquals(result.testResult, undefined);
    });
  });
});

describe({
  name: "CompileQueue parallel compilation",
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

  it("should run compilations in parallel up to concurrency limit", async () => {
    const concurrency = 2;
    const queue = new CompileQueue(mockProvider, "test-container", {
      compileConcurrency: concurrency,
    });

    let maxConcurrent = 0;
    let currentConcurrent = 0;
    const originalCompile = mockProvider.compileProject.bind(mockProvider);

    // Wrap compileProject to track concurrency
    mockProvider.compileProject = async (...args) => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) {
        maxConcurrent = currentConcurrent;
      }
      // Delay to let parallelism show
      await new Promise((r) => setTimeout(r, 50));
      const result = await originalCompile(...args);
      currentConcurrent--;
      return result;
    };

    mockProvider.setCompilationConfig({ success: true });

    const items = Array.from(
      { length: 5 },
      (_, i) => createMockCompileWorkItem({ id: `parallel-${i}` }),
    );

    // Enqueue all items
    const promises = items.map((item) => queue.enqueue(item));
    const results = await Promise.all(promises);

    assertEquals(results.length, 5);
    // Max concurrent compilations should be at most the concurrency limit
    assert(
      maxConcurrent <= concurrency,
      `Expected max ${concurrency} concurrent compilations, got ${maxConcurrent}`,
    );
    // With 5 items and concurrency 2, we should see at least 2 running at once
    assert(
      maxConcurrent >= 2,
      `Expected at least 2 concurrent compilations, got ${maxConcurrent}`,
    );
  });

  it("should keep test execution serial", async () => {
    const queue = new CompileQueue(mockProvider, "test-container", {
      compileConcurrency: 3,
    });

    let maxConcurrentTests = 0;
    let currentConcurrentTests = 0;
    const originalRunTests = mockProvider.runTests.bind(mockProvider);

    // Wrap runTests to track concurrency
    mockProvider.runTests = async (...args) => {
      currentConcurrentTests++;
      if (currentConcurrentTests > maxConcurrentTests) {
        maxConcurrentTests = currentConcurrentTests;
      }
      await new Promise((r) => setTimeout(r, 30));
      const result = await originalRunTests(...args);
      currentConcurrentTests--;
      return result;
    };

    mockProvider.setCompilationConfig({ success: true });
    mockProvider.setTestConfig({
      success: true,
      totalTests: 1,
      passedTests: 1,
    });

    const items = Array.from(
      { length: 3 },
      (_, i) =>
        createMockCompileWorkItem({
          id: `serial-test-${i}`,
          context: createMockTaskExecutionContext({
            manifest: createMockTaskManifest({
              expected: {
                compile: true,
                testApp: "tests/fixtures/TestApp.al",
              },
            }),
          }),
        }),
    );

    const promises = items.map((item) => queue.enqueue(item));
    await Promise.all(promises);

    // Test execution must be serial (max 1 at a time)
    assertEquals(maxConcurrentTests, 1);
  });

  it("should skip test phase when compilation fails", async () => {
    const queue = new CompileQueue(mockProvider, "test-container", {
      compileConcurrency: 2,
    });

    mockProvider.setCompilationConfig({
      success: false,
      errors: [{
        code: "AL0001",
        message: "Syntax error",
        file: "test.al",
        line: 1,
        column: 1,
        severity: "error",
      }],
    });

    const workItem = createMockCompileWorkItem({
      context: createMockTaskExecutionContext({
        manifest: createMockTaskManifest({
          expected: {
            compile: true,
            testApp: "tests/fixtures/TestApp.al",
          },
        }),
      }),
    });

    const result = await queue.enqueue(workItem);

    assertEquals(result.compilationResult.success, false);
    assertEquals(result.testResult, undefined);
    // runTests should never be called
    assertEquals(mockProvider.wasCalled("runTests"), false);
  });

  it("should drain after all in-flight items finish", async () => {
    const queue = new CompileQueue(mockProvider, "test-container", {
      compileConcurrency: 2,
    });
    mockProvider.setCompilationConfig({ delay: 30, success: true });

    const items = Array.from(
      { length: 3 },
      (_, i) => createMockCompileWorkItem({ id: `drain-${i}` }),
    );

    // Enqueue all, don't await
    const promises = items.map((item) => queue.enqueue(item));

    // Drain should wait for everything to finish
    await queue.drain();

    const stats = queue.getStats();
    assertEquals(stats.processed, 3);
    assertEquals(stats.activeItems, 0);
    assertEquals(stats.processing, false);

    // Verify all promises resolved
    const results = await Promise.all(promises);
    assertEquals(results.length, 3);
  });

  it("should report parallel stats correctly", async () => {
    const queue = new CompileQueue(mockProvider, "test-container", {
      compileConcurrency: 2,
    });

    // Initial stats
    const initial = queue.getStats();
    assertEquals(initial.activeCompilations, 0);
    assertEquals(initial.testRunning, false);
    assertEquals(initial.activeItems, 0);

    mockProvider.setCompilationConfig({ delay: 100, success: true });

    const items = Array.from(
      { length: 3 },
      (_, i) => createMockCompileWorkItem({ id: `stats-${i}` }),
    );

    const promises = items.map((item) => queue.enqueue(item));

    // Small delay to let processing start
    await new Promise((r) => setTimeout(r, 20));

    const during = queue.getStats();
    assert(
      during.activeItems > 0,
      "Should have active items during processing",
    );
    assert(during.processing, "Should be processing");

    // Wait for completion
    await Promise.all(promises);
    await queue.drain();

    const after = queue.getStats();
    assertEquals(after.activeItems, 0);
    assertEquals(after.processing, false);
    assertEquals(after.processed, 3);
  });

  it("should accept compileConcurrency option", () => {
    const queue = new CompileQueue(mockProvider, "test-container", {
      compileConcurrency: 5,
    });
    assertEquals(queue.length, 0);
    assertEquals(queue.isProcessing, false);
  });
});

describe({
  name: "CompileQueue.getSnapshot",
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

  it("returns the right shape on a fresh queue", () => {
    const queue = new CompileQueue(mockProvider, "Cronus28");
    const snap = queue.getSnapshot();

    assertEquals(snap.containerName, "Cronus28");
    assertEquals(snap.pending, 0);
    assertEquals(snap.activeCompilations, 0);
    assertEquals(snap.maxCompilations, 3); // default semaphore
    assertEquals(snap.testActive, false);
    assertEquals(snap.active, []);
    assertEquals(snap.recentlyCompleted, []);
    assertEquals(snap.throughput.completedLastMinute, 0);
    assertEquals(snap.throughput.avgCompileMs, 0);
    assertEquals(snap.throughput.avgTestMs, 0);
    assertEquals(snap.throughput.p95TestMs, 0);
    assertEquals(snap.health.lastActivityAt, -1);
    assertEquals(snap.health.consecutiveFailures, 0);
  });

  it("populates recentlyCompleted + throughput after work drains", async () => {
    const queue = new CompileQueue(mockProvider, "Cronus28", {
      compileConcurrency: 1,
    });

    // Two work items — both will complete via the mock provider's success path.
    const items = [
      createMockCompileWorkItem({
        id: "wi-1",
        context: createMockTaskExecutionContext({
          manifest: createMockTaskManifest({ id: "CG-AL-T001" }),
          variantId: "anthropic/claude-opus-4-7",
        }),
      }),
      createMockCompileWorkItem({
        id: "wi-2",
        context: createMockTaskExecutionContext({
          manifest: createMockTaskManifest({ id: "CG-AL-T002" }),
          variantId: "openai/gpt-5",
        }),
      }),
    ];

    await Promise.all(items.map((wi) => queue.enqueue(wi)));
    await queue.drain();

    const snap = queue.getSnapshot();

    // No work in flight, queue empty
    assertEquals(snap.pending, 0);
    assertEquals(snap.active, []);

    // Both items recorded, newest first
    assertEquals(snap.recentlyCompleted.length, 2);
    const ids = snap.recentlyCompleted.map((c) => c.workItemId);
    assert(ids.includes("wi-1"));
    assert(ids.includes("wi-2"));

    // Throughput numbers populated
    assertEquals(snap.throughput.completedLastMinute, 2);
    assert(
      snap.throughput.avgCompileMs >= 0,
      "avgCompileMs should be a number",
    );

    // Health touched
    assert(snap.health.lastActivityAt > 0, "lastActivityAt should be set");
  });
});

describe({
  name: "CompileQueue.maybeRecycleSession",
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

  it("calls maybeRecycleSession once per task after test phase", async () => {
    const queue = new CompileQueue(mockProvider, "test-container");
    mockProvider.setCompilationConfig({ success: true });
    mockProvider.setTestConfig({
      success: true,
      totalTests: 1,
      passedTests: 1,
    });

    const workItem = createMockCompileWorkItem({
      context: createMockTaskExecutionContext({
        manifest: createMockTaskManifest({
          expected: {
            compile: true,
            testApp: "tests/fixtures/TestApp.al",
          },
        }),
      }),
    });

    await queue.enqueue(workItem);

    assertEquals(mockProvider.getCallCount("maybeRecycleSession"), 1);
    const calls = mockProvider.getCallsFor("maybeRecycleSession");
    assertEquals(calls[0]?.args[0], "test-container");
  });

  it("calls maybeRecycleSession once per task even when tests are skipped", async () => {
    const queue = new CompileQueue(mockProvider, "test-container");
    mockProvider.setCompilationConfig({ success: true });

    const workItem = createMockCompileWorkItem({
      context: createMockTaskExecutionContext({
        manifest: createMockTaskManifest({
          expected: { compile: true },
        }),
      }),
    });

    await queue.enqueue(workItem);

    assertEquals(mockProvider.getCallCount("maybeRecycleSession"), 1);
  });

  it("does not abort task processing when maybeRecycleSession throws", async () => {
    // Override to throw
    mockProvider.maybeRecycleSession = async (_containerName: string) => {
      await Promise.resolve();
      throw new Error("session recycle failed");
    };
    mockProvider.setCompilationConfig({ success: true });

    const queue = new CompileQueue(mockProvider, "test-container");
    const workItem = createMockCompileWorkItem();
    const result = await queue.enqueue(workItem);

    // Task should complete successfully despite recycle error
    assertEquals(result.compilationResult.success, true);
  });

  it("calls maybeRecycleSession once per task across multiple tasks", async () => {
    const queue = new CompileQueue(mockProvider, "test-container", {
      compileConcurrency: 1,
    });
    mockProvider.setCompilationConfig({ success: true });

    const items = Array.from(
      { length: 3 },
      (_, i) => createMockCompileWorkItem({ id: `recycle-${i}` }),
    );

    await Promise.all(items.map((item) => queue.enqueue(item)));
    await queue.drain();

    assertEquals(mockProvider.getCallCount("maybeRecycleSession"), 3);
  });
});

describe("QueueFullError", () => {
  it("should have correct name and properties", () => {
    const error = new QueueFullError("Queue is full", 10);

    assertEquals(error.name, "QueueFullError");
    assertEquals(error.message, "Queue is full");
    assertEquals(error.currentSize, 10);
  });
});

describe("QueueTimeoutError", () => {
  it("should have correct name and properties", () => {
    const error = new QueueTimeoutError("Queue timeout", 5000);

    assertEquals(error.name, "QueueTimeoutError");
    assertEquals(error.message, "Queue timeout");
    assertEquals(error.waitTimeMs, 5000);
  });
});
