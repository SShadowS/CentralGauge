/**
 * D1.2 — Embedder + cosineSimilarity unit tests.
 */
// Pre-load @db/sqlite — see note in tests/unit/stats/sqlite-storage.test.ts
import "@db/sqlite";
import { assertAlmostEquals, assertEquals, assertRejects } from "@std/assert";
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

// V8: an all-zero or empty embedding is a symptom of API failure, not a
// legitimate embedding. Letting it through would make cosineSimilarity
// silently return 0 against every real concept (its own doc comment: "zero
// vector -> 0, avoids NaN"), which decideCluster reads as "not similar to
// anything" and routes to auto-create — an orphan concept minted from a
// degenerate embedding instead of a real API/analysis failure surfacing.

class ZeroVectorOpenAIEmbeddings {
  // deno-lint-ignore require-await
  async create(opts: { input: string[]; model: string }) {
    return {
      data: opts.input.map((_s, i) => ({
        index: i,
        embedding: Array.from({ length: 8 }, () => 0),
      })),
    };
  }
}

class EmptyVectorOpenAIEmbeddings {
  // deno-lint-ignore require-await
  async create(opts: { input: string[]; model: string }) {
    return {
      data: opts.input.map((_s, i) => ({ index: i, embedding: [] })),
    };
  }
}

Deno.test("Embedder: embed() throws on an all-zero embedding vector (V8)", async () => {
  const emb = new Embedder(
    { embeddings: new ZeroVectorOpenAIEmbeddings() as never } as never,
    { tableName: ":memory:" },
  );
  await emb.init();
  await assertRejects(
    () => emb.embed("degenerate-response"),
    Error,
    "all-zero embedding vector",
  );
  emb.close();
});

Deno.test("Embedder: embed() throws on an empty embedding vector (V8)", async () => {
  const emb = new Embedder(
    { embeddings: new EmptyVectorOpenAIEmbeddings() as never } as never,
    { tableName: ":memory:" },
  );
  await emb.init();
  await assertRejects(
    () => emb.embed("degenerate-response"),
    Error,
    "empty embedding vector",
  );
  emb.close();
});

Deno.test("Embedder: embedMany() throws when any item in the batch is all-zero (V8)", async () => {
  const emb = new Embedder(
    { embeddings: new ZeroVectorOpenAIEmbeddings() as never } as never,
    { tableName: ":memory:" },
  );
  await emb.init();
  await assertRejects(
    () => emb.embedMany(["a", "b", "c"]),
    Error,
    "all-zero embedding vector",
  );
  emb.close();
});

Deno.test("Embedder: a zero-vector failure does NOT get cached (V8)", async () => {
  const mock = new MockOpenAIEmbeddings();
  const zeroMock = new ZeroVectorOpenAIEmbeddings();
  let useZero = true;
  const emb = new Embedder(
    {
      embeddings: {
        create: (opts: { input: string[]; model: string }) =>
          useZero ? zeroMock.create(opts) : mock.create(opts),
      },
    } as never,
    { tableName: ":memory:" },
  );
  await emb.init();

  await assertRejects(() => emb.embed("flowfield"));

  // A subsequent successful call for the SAME text must hit the API again
  // (not return a cached degenerate vector) and succeed.
  useZero = false;
  const arr = await emb.embed("flowfield");
  assertEquals(arr.length, 8);
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
