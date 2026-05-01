import { describe, it } from "@std/testing/bdd";
import {
  assert,
  assertEquals,
  assertExists,
  assertStrictEquals,
} from "@std/assert";
import {
  __resetToolVersionsCacheForTesting,
  collectEnvelope,
  collectToolVersions,
  computeSettingsHash,
} from "../../../src/lifecycle/envelope.ts";

describe("envelope", () => {
  it("collectToolVersions returns at least deno", async () => {
    const v = await collectToolVersions();
    assertExists(v.deno);
    assert(/^\d+\.\d+\.\d+$/.test(v.deno!));
  });

  it("collectEnvelope contains machine_id and settings_hash", async () => {
    const e = await collectEnvelope({
      machineId: "test-mach",
      settings: { temperature: 0 },
    });
    assertEquals(e.machine_id, "test-mach");
    assertExists(e.settings_hash);
  });

  it("computeSettingsHash is deterministic", async () => {
    const h1 = await computeSettingsHash({ a: 1, b: 2 });
    const h2 = await computeSettingsHash({ b: 2, a: 1 });
    assertEquals(h1, h2);
  });

  it("collectToolVersions caches the result (I7)", async () => {
    // First call may spawn subprocesses; reset the cache to a known state.
    __resetToolVersionsCacheForTesting();
    const t0 = performance.now();
    const v1 = await collectToolVersions();
    const t1 = performance.now();
    const v2 = await collectToolVersions();
    const t2 = performance.now();

    // Same data — cache hit returns the same shape.
    assertEquals(v1, v2);

    // Cache hit is at least an order of magnitude faster than the first
    // (cold) call. Subprocess spawn costs ~50-200 ms apiece on Windows,
    // so the cold path runs ~200-800 ms, the warm path is sub-millisecond.
    const cold = t1 - t0;
    const warm = t2 - t1;
    // 10x ratio handles flaky CI without making the test useless.
    assert(
      warm < cold / 10 || warm < 5,
      `expected warm call (${
        warm.toFixed(2)
      }ms) to be ≥10x faster than cold call (${
        cold.toFixed(2)
      }ms) or under 5ms`,
    );
  });

  it("concurrent collectToolVersions calls share the same in-flight Promise (I7)", async () => {
    __resetToolVersionsCacheForTesting();
    // Two simultaneous calls before either resolves — both must observe the
    // same underlying Promise so we don't fan out to 2x4 subprocess spawns.
    const p1 = collectToolVersions();
    const p2 = collectToolVersions();
    // Strict equality on the awaited references means same object identity.
    const [v1, v2] = await Promise.all([p1, p2]);
    assertStrictEquals(v1, v2);
  });
});
