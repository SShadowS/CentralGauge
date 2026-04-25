/**
 * Unit tests for CompileQueuePool
 *
 * Tests the multi-container pool that routes work to least-loaded queues.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";

import { CompileQueuePool } from "../../../src/parallel/compile-queue-pool.ts";
import { CompileQueue } from "../../../src/parallel/compile-queue.ts";
import {
  createMockContainerProvider,
  MockContainerProvider,
} from "../../utils/mock-container-provider.ts";
import { createMockCompileWorkItem } from "../../utils/test-helpers.ts";

// CompileQueue creates setTimeout handlers for timeouts that aren't cleared.
// Disable sanitizeOps to avoid timer leak errors.
describe({
  name: "CompileQueuePool",
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
    it("should create pool with multiple containers", () => {
      const pool = new CompileQueuePool(mockProvider, ["c1", "c2", "c3"]);

      assertEquals(pool.poolSize, 3);
      assertEquals(pool.length, 0);
      assertEquals(pool.isProcessing, false);
    });

    it("should create pool with single container", () => {
      const pool = new CompileQueuePool(mockProvider, ["c1"]);

      assertEquals(pool.poolSize, 1);
      assertEquals(pool.length, 0);
    });

    it("should throw if no container names provided", () => {
      assertThrows(
        () => new CompileQueuePool(mockProvider, []),
        Error,
        "at least one container name",
      );
    });

    it("should accept custom options", () => {
      const pool = new CompileQueuePool(mockProvider, ["c1", "c2"], {
        maxQueueSize: 5,
        timeout: 1000,
        compileConcurrency: 2,
      });

      assertEquals(pool.poolSize, 2);
    });
  });

  describe("enqueue", () => {
    it("should enqueue a work item and return a promise", () => {
      const pool = new CompileQueuePool(mockProvider, ["c1", "c2"]);
      const workItem = createMockCompileWorkItem();

      const promise = pool.enqueue(workItem);

      assertEquals(typeof promise.then, "function");
    });

    it("should complete a work item successfully", async () => {
      const pool = new CompileQueuePool(mockProvider, ["c1"]);
      const workItem = createMockCompileWorkItem();

      const result = await pool.enqueue(workItem);

      assert(result.compilationResult);
      assertEquals(result.workItemId, workItem.id);
    });
  });

  describe("length", () => {
    it("should report 0 when empty", () => {
      const pool = new CompileQueuePool(mockProvider, ["c1", "c2"]);

      assertEquals(pool.length, 0);
    });
  });

  describe("isProcessing", () => {
    it("should report false when idle", () => {
      const pool = new CompileQueuePool(mockProvider, ["c1", "c2"]);

      assertEquals(pool.isProcessing, false);
    });
  });

  describe("getStats", () => {
    it("should return aggregated stats", () => {
      const pool = new CompileQueuePool(mockProvider, ["c1", "c2", "c3"]);
      const stats = pool.getStats();

      assertEquals(stats.pending, 0);
      assertEquals(stats.processing, false);
      assertEquals(stats.activeCompilations, 0);
      assertEquals(stats.testRunning, false);
      assertEquals(stats.activeItems, 0);
      assertEquals(stats.processed, 0);
      assertEquals(stats.avgWaitTime, 0);
      assertEquals(stats.avgProcessTime, 0);
    });
  });

  describe("drain", () => {
    it("should resolve immediately when all queues are empty", async () => {
      const pool = new CompileQueuePool(mockProvider, ["c1", "c2"]);

      await pool.drain();
      // Should not hang
      assertEquals(pool.length, 0);
    });
  });

  describe("CompileWorkQueue interface", () => {
    it("CompileQueue should implement CompileWorkQueue", () => {
      const queue = new CompileQueue(mockProvider, "test-container");

      // Verify all interface methods exist
      assertEquals(typeof queue.enqueue, "function");
      assertEquals(typeof queue.drain, "function");
      assertEquals(typeof queue.length, "number");
      assertEquals(typeof queue.isProcessing, "boolean");
      assertEquals(typeof queue.getStats, "function");
    });

    it("CompileQueuePool should implement CompileWorkQueue", () => {
      const pool = new CompileQueuePool(mockProvider, ["c1"]);

      // Verify all interface methods exist
      assertEquals(typeof pool.enqueue, "function");
      assertEquals(typeof pool.drain, "function");
      assertEquals(typeof pool.length, "number");
      assertEquals(typeof pool.isProcessing, "boolean");
      assertEquals(typeof pool.getStats, "function");
    });
  });

  describe("getSnapshot", () => {
    it("returns one queue snapshot per container with totals", () => {
      const pool = new CompileQueuePool(mockProvider, [
        "Cronus28",
        "Cronus281",
        "Cronus282",
        "Cronus283",
      ]);

      const snap = pool.getPoolSnapshot();

      assertEquals(snap.schemaVersion, 1);
      assertEquals(snap.queues.length, 4);
      assertEquals(
        snap.queues.map((q: { containerName: string }) => q.containerName),
        ["Cronus28", "Cronus281", "Cronus282", "Cronus283"],
      );
      assertEquals(snap.totals.pending, 0);
      assertEquals(snap.totals.activeCompilations, 0);
      assertEquals(snap.totals.activeTests, 0);
      assertEquals(snap.imbalanceScore, 0);
      assertEquals(snap.recentRouting, []);
      assert(snap.generatedAt > 0);
    });

    it("logs routing decisions on enqueue and drains them in newest-first order", async () => {
      const pool = new CompileQueuePool(mockProvider, ["c1", "c2"]);

      await pool.enqueue(createMockCompileWorkItem({ id: "wi-1" }));
      await pool.enqueue(createMockCompileWorkItem({ id: "wi-2" }));
      await pool.enqueue(createMockCompileWorkItem({ id: "wi-3" }));
      await pool.drain();

      const snap = pool.getPoolSnapshot();
      assertEquals(snap.recentRouting.length, 3);
      // Newest-first
      assertEquals(snap.recentRouting[0]!.workItemId, "wi-3");
      assertEquals(snap.recentRouting[2]!.workItemId, "wi-1");

      // Each entry captures the full pool depth at decision time
      for (const r of snap.recentRouting) {
        assertEquals(Object.keys(r.poolDepthsAtRouting).sort(), ["c1", "c2"]);
        assert(r.routedAt > 0);
        assert(r.routedTo === "c1" || r.routedTo === "c2");
      }
    });

    it("imbalanceScore stays 0 when all queues empty", () => {
      const pool = new CompileQueuePool(mockProvider, ["c1", "c2", "c3"]);
      const snap = pool.getPoolSnapshot();
      assertEquals(snap.imbalanceScore, 0);
    });

    it("totals.activeTests tracks individual queue testActive flags", () => {
      const pool = new CompileQueuePool(mockProvider, ["c1", "c2"]);
      const snap = pool.getPoolSnapshot();
      // No work in flight → 0 active tests
      assertEquals(snap.totals.activeTests, 0);
      assertEquals(
        snap.queues.every((q: { testActive: boolean }) =>
          q.testActive === false
        ),
        true,
      );
    });
  });
});
