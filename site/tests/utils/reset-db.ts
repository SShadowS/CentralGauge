import { env } from 'cloudflare:test';

// Required after @cloudflare/vitest-pool-workers v0.14 removed isolatedStorage
// & singleWorker — D1, R2, and KV state now persists across `it` blocks within
// a file. beforeEach must purge all stores.
export async function resetDb(): Promise<void> {
  // D1: delete in strict FK-respecting order (leaves first).
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM shortcoming_occurrences`),
    env.DB.prepare(`DELETE FROM shortcomings`),
    env.DB.prepare(`DELETE FROM run_verifications`),
    env.DB.prepare(`DELETE FROM results`),
    env.DB.prepare(`DELETE FROM ingest_events`),
    env.DB.prepare(`DELETE FROM runs`),
    env.DB.prepare(`DELETE FROM tasks`),
    env.DB.prepare(`DELETE FROM task_categories`),
    env.DB.prepare(`DELETE FROM cost_snapshots`),
    env.DB.prepare(`DELETE FROM models`),
    env.DB.prepare(`DELETE FROM task_sets`),
    env.DB.prepare(`DELETE FROM model_families`),
    env.DB.prepare(`DELETE FROM settings_profiles`),
    env.DB.prepare(`DELETE FROM machine_keys`),
  ]);

  const blobs = await env.BLOBS.list();
  if (blobs.objects.length > 0) {
    await env.BLOBS.delete(blobs.objects.map((o: R2Object) => o.key));
  }

  const cache = await env.CACHE.list();
  await Promise.all(
    cache.keys.map((k: KVNamespaceListKey<unknown, string>) => env.CACHE.delete(k.name)),
  );
}
