/**
 * Round-trip test: PoolSnapshot → JSON → parsed back must preserve the shape
 * required by the dashboard SSE consumer and the --json-events stream.
 * @module tests/unit/parallel/pool-snapshot-json
 */

import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";

import { CompileQueuePool } from "../../../src/parallel/compile-queue-pool.ts";
import {
  createMockContainerProvider,
  type MockContainerProvider,
} from "../../utils/mock-container-provider.ts";
import { createMockCompileWorkItem } from "../../utils/test-helpers.ts";
import type { PoolSnapshot } from "../../../src/parallel/observability.ts";

describe({
  name: "PoolSnapshot JSON round-trip",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  let mockProvider: MockContainerProvider;

  it("survives JSON.stringify/parse with all fields intact", async () => {
    mockProvider = createMockContainerProvider();
    const pool = new CompileQueuePool(mockProvider, ["c1", "c2", "c3"]);

    // Drive some work through so the snapshot has non-trivial content.
    await pool.enqueue(
      createMockCompileWorkItem({ id: "wi-1" }),
    );
    await pool.enqueue(
      createMockCompileWorkItem({ id: "wi-2" }),
    );
    await pool.drain();

    const original = pool.getPoolSnapshot();
    const wireFormat = JSON.stringify(
      { type: "pool-snapshot", snapshot: original },
    );

    // Headless / CI consumers parse back from a JSON line
    const parsed = JSON.parse(wireFormat) as {
      type: "pool-snapshot";
      snapshot: PoolSnapshot;
    };

    assertEquals(parsed.type, "pool-snapshot");
    assertEquals(parsed.snapshot.schemaVersion, 1);
    assertEquals(parsed.snapshot.queues.length, 3);
    assertEquals(parsed.snapshot.queues[0]!.containerName, "c1");
    assertEquals(typeof parsed.snapshot.totals.pending, "number");
    assertEquals(typeof parsed.snapshot.imbalanceScore, "number");
    assert(Array.isArray(parsed.snapshot.recentRouting));
    assertEquals(parsed.snapshot.recentRouting.length, 2);
    assertEquals(parsed.snapshot.recentRouting[0]!.workItemId, "wi-2");

    // Per-queue throughput numbers are finite (no NaN slipping through JSON)
    for (const q of parsed.snapshot.queues) {
      assertEquals(Number.isFinite(q.throughput.avgCompileMs), true);
      assertEquals(Number.isFinite(q.throughput.avgTestMs), true);
      assertEquals(Number.isFinite(q.throughput.p95TestMs), true);
    }
  });
});
