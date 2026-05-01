/**
 * Local SQLite-backed cache for OpenAI embeddings. Avoids repeat API
 * calls during the D1 backfill — typical session re-runs the same
 * 50–200 concept strings; without cache that's 50–200 paid API calls
 * per re-run.
 *
 * Key = the raw concept string; value = Float32 vector serialized as
 * Uint8Array (4 bytes per dimension, little-endian).
 *
 * Plan: docs/superpowers/plans/2026-04-29-lifecycle-D-data-impl.md Task D1.1.
 */
import { Database } from "@db/sqlite";
import { dirname } from "@std/path";
import { ensureDir } from "@std/fs";

export class EmbeddingCache {
  private db: Database | null = null;
  constructor(private readonly path: string) {}

  async init(): Promise<void> {
    if (this.path !== ":memory:") {
      await ensureDir(dirname(this.path));
    }
    this.db = new Database(this.path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        key TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        dim INTEGER NOT NULL,
        vec BLOB NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  }

  // deno-lint-ignore require-await
  async get(key: string): Promise<Float32Array | null> {
    if (!this.db) throw new Error("EmbeddingCache not initialized");
    const row = this.db
      .prepare("SELECT dim, vec FROM embeddings WHERE key = ?")
      .get<{ dim: number; vec: Uint8Array }>(key);
    if (!row) return null;
    const u8 = row.vec;
    // Copy into a fresh aligned buffer so SQLite's lifetime doesn't matter.
    const buf = new ArrayBuffer(u8.byteLength);
    new Uint8Array(buf).set(u8);
    return new Float32Array(buf, 0, row.dim);
  }

  // deno-lint-ignore require-await
  async put(
    key: string,
    vec: Float32Array,
    model = "text-embedding-3-small",
  ): Promise<void> {
    if (!this.db) throw new Error("EmbeddingCache not initialized");
    const u8 = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
    this.db
      .prepare(
        "INSERT OR REPLACE INTO embeddings (key, model, dim, vec, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(key, model, vec.length, u8, Date.now());
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
