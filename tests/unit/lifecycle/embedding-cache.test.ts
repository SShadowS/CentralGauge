/**
 * D1.1 — EmbeddingCache: SQLite-backed local cache for OpenAI embeddings.
 * Avoids repeated paid API calls during the D1 backfill iteration.
 */
// Pre-load @db/sqlite — see note in tests/unit/stats/sqlite-storage.test.ts
import "@db/sqlite";
import { assertEquals, assertExists } from "@std/assert";
import { EmbeddingCache } from "../../../src/lifecycle/embedding-cache.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

Deno.test("EmbeddingCache: returns null on miss, stores on put, returns vector on hit", async () => {
  const tmp = await createTempDir("emb-cache");
  try {
    const cache = new EmbeddingCache(`${tmp}/cache.sqlite`);
    await cache.init();

    assertEquals(await cache.get("flowfield-calcfields-requirement"), null);

    const vec = new Float32Array([0.1, 0.2, 0.3]);
    await cache.put("flowfield-calcfields-requirement", vec);

    const hit = await cache.get("flowfield-calcfields-requirement");
    assertExists(hit);
    assertEquals(hit.length, 3);
    // Allow tiny float drift through serialization.
    assertEquals(Math.abs(hit[0]! - 0.1) < 1e-6, true);
    cache.close();
  } finally {
    await cleanupTempDir(tmp);
  }
});

Deno.test("EmbeddingCache: hits survive close + reopen", async () => {
  const tmp = await createTempDir("emb-cache-reopen");
  try {
    const path = `${tmp}/cache.sqlite`;
    {
      const c = new EmbeddingCache(path);
      await c.init();
      await c.put("x", new Float32Array([0.5, 0.5]));
      c.close();
    }
    {
      const c = new EmbeddingCache(path);
      await c.init();
      const v = await c.get("x");
      assertExists(v);
      assertEquals(Math.abs(v[0]! - 0.5) < 1e-6, true);
      c.close();
    }
  } finally {
    await cleanupTempDir(tmp);
  }
});
