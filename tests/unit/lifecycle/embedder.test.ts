/**
 * D1.2 — Embedder + cosineSimilarity unit tests.
 */
// Pre-load @db/sqlite — see note in tests/unit/stats/sqlite-storage.test.ts
import "@db/sqlite";
import { assertAlmostEquals, assertEquals } from "@std/assert";
import { cosineSimilarity, Embedder } from "../../../src/lifecycle/embedder.ts";

class MockOpenAIEmbeddings {
  public calls = 0;
  // Deterministic fake: derive an 8-dim vector from char codes.
  // deno-lint-ignore require-await
  async create(opts: { input: string[]; model: string }) {
    this.calls += opts.input.length;
    return {
      data: opts.input.map((s, i) => ({
        index: i,
        embedding: Array.from(
          { length: 8 },
          (_, k) => ((s.charCodeAt(k % s.length) % 17) - 8) / 8,
        ),
      })),
    };
  }
}

Deno.test("cosineSimilarity: identical vectors → 1.0", () => {
  const v = new Float32Array([1, 2, 3]);
  assertAlmostEquals(cosineSimilarity(v, v), 1.0, 1e-6);
});

Deno.test("cosineSimilarity: orthogonal → 0.0", () => {
  const a = new Float32Array([1, 0, 0]);
  const b = new Float32Array([0, 1, 0]);
  assertAlmostEquals(cosineSimilarity(a, b), 0.0, 1e-6);
});

Deno.test("cosineSimilarity: opposite vectors → -1.0", () => {
  const a = new Float32Array([1, 2, 3]);
  const b = new Float32Array([-1, -2, -3]);
  assertAlmostEquals(cosineSimilarity(a, b), -1.0, 1e-6);
});

Deno.test("cosineSimilarity: zero vector returns 0 (no NaN)", () => {
  const a = new Float32Array([0, 0, 0]);
  const b = new Float32Array([1, 2, 3]);
  assertEquals(cosineSimilarity(a, b), 0);
});

Deno.test("Embedder: cache hit avoids API call (single .embed)", async () => {
  const mock = new MockOpenAIEmbeddings();
  const emb = new Embedder(
    { embeddings: mock as never } as never,
    { tableName: ":memory:" },
  );
  await emb.init();

  await emb.embed("flowfield");
  assertEquals(mock.calls, 1);

  await emb.embed("flowfield"); // should hit cache
  assertEquals(mock.calls, 1);

  await emb.embed("calcfields"); // new term
  assertEquals(mock.calls, 2);
  emb.close();
});

Deno.test("Embedder: embedMany returns map of vectors and respects cache per-key", async () => {
  const mock = new MockOpenAIEmbeddings();
  const emb = new Embedder(
    { embeddings: mock as never } as never,
    { tableName: ":memory:" },
  );
  await emb.init();

  await emb.embed("flowfield");
  assertEquals(mock.calls, 1);

  const out = await emb.embedMany(["flowfield", "calc", "field"]);
  // 'flowfield' is cached; only 'calc' + 'field' hit API.
  assertEquals(mock.calls, 3);
  assertEquals(out.size, 3);
  assertEquals(out.has("flowfield"), true);
  assertEquals(out.has("calc"), true);
  assertEquals(out.has("field"), true);
  emb.close();
});
