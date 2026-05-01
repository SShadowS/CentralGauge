/**
 * Embeds short concept strings via OpenAI text-embedding-3-small
 * (1536 dim by default; this code reads `data[i].embedding.length`
 * dynamically so a different model's dimension Just Works).
 *
 * All calls go through EmbeddingCache to avoid repeat API spend
 * during D1 backfill iteration.
 *
 * Plan: docs/superpowers/plans/2026-04-29-lifecycle-D-data-impl.md Task D1.2.
 */
import OpenAI from "@openai/openai";
import { EmbeddingCache } from "./embedding-cache.ts";

export interface EmbedderOptions {
  /** SQLite cache path. Use `:memory:` in tests. */
  tableName?: string;
  /** Model name. Default text-embedding-3-small. */
  model?: string;
}

/**
 * Minimal interface the Embedder consumes from the OpenAI SDK. Tests
 * inject a mock satisfying this shape; production passes the real
 * `new OpenAI({ apiKey })` instance.
 */
export interface OpenAIEmbeddingsLike {
  embeddings: {
    create(opts: { input: string[]; model: string }): Promise<{
      data: Array<{ index: number; embedding: number[] }>;
    }>;
  };
}

export class Embedder {
  private cache: EmbeddingCache;
  private model: string;
  constructor(
    private readonly client: OpenAI | OpenAIEmbeddingsLike,
    options: EmbedderOptions = {},
  ) {
    const cachePath = options.tableName ??
      `${
        Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "."
      }/.cache/centralgauge/concept-embeddings.sqlite`;
    this.cache = new EmbeddingCache(cachePath);
    this.model = options.model ?? "text-embedding-3-small";
  }

  async init(): Promise<void> {
    await this.cache.init();
  }

  async embed(text: string): Promise<Float32Array> {
    const cached = await this.cache.get(text);
    if (cached) return cached;
    const resp = await this.client.embeddings.create({
      model: this.model,
      input: [text],
    });
    const arr = Float32Array.from(resp.data[0]!.embedding);
    await this.cache.put(text, arr, this.model);
    return arr;
  }

  /** Batched embed for the backfill walk; respects cache per-key. */
  async embedMany(texts: string[]): Promise<Map<string, Float32Array>> {
    const out = new Map<string, Float32Array>();
    const misses: string[] = [];
    for (const t of texts) {
      const hit = await this.cache.get(t);
      if (hit) out.set(t, hit);
      else misses.push(t);
    }
    if (misses.length > 0) {
      // OpenAI accepts up to 2048 inputs per call. Chunk at 256 for safety.
      for (let i = 0; i < misses.length; i += 256) {
        const chunk = misses.slice(i, i + 256);
        const resp = await this.client.embeddings.create({
          model: this.model,
          input: chunk,
        });
        for (const item of resp.data) {
          const arr = Float32Array.from(item.embedding);
          await this.cache.put(chunk[item.index]!, arr, this.model);
          out.set(chunk[item.index]!, arr);
        }
      }
    }
    return out;
  }

  close(): void {
    this.cache.close();
  }
}

/**
 * Cosine similarity between two vectors of equal length. Returns 0 when
 * either vector is zero (avoids NaN); identical vectors → 1; orthogonal → 0;
 * antiparallel → -1. Throws on length mismatch.
 */
export function cosineSimilarity(
  a: Float32Array,
  b: Float32Array,
): number {
  if (a.length !== b.length) {
    throw new Error(`vector dim mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
