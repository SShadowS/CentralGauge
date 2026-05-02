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
    // 0006_lifecycle.sql + 0007_family_diffs.sql tables — clear in FK order
    // (family_diffs → pending_review → concept_aliases → concepts → lifecycle_events).
    env.DB.prepare(`DELETE FROM family_diffs`),
    env.DB.prepare(`DELETE FROM pending_review`),
    env.DB.prepare(`DELETE FROM concept_aliases`),
    env.DB.prepare(`DELETE FROM concepts`),
    env.DB.prepare(`DELETE FROM lifecycle_events`),
  ]);

  const blobs = await env.BLOBS.list();
  if (blobs.objects.length > 0) {
    await env.BLOBS.delete(blobs.objects.map((o: R2Object) => o.key));
  }

  const cache = await env.CACHE.list();
  await Promise.all(
    cache.keys.map((k: KVNamespaceListKey<unknown, string>) => env.CACHE.delete(k.name)),
  );

  // Note: named Cache API entries (caches.open('cg-...')) are not cleared
  // here because miniflare's caches.open() in test setup operates on a
  // different cache than the one inside the worker isolate. Tests that
  // exercise cached endpoints should vary the request URL (e.g. `?_cb=N`)
  // per assertion to bypass cache poisoning between tests.
}
