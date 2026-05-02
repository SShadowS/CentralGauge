import {
  computeGenerationDiff,
  type DiffDb,
  type DiffResult,
} from '../../../../src/lifecycle/diff';

/**
 * Worker-side ctx.waitUntil trigger fired by the lifecycle events POST
 * handler after every successful INSERT. When the new event is an
 * `analysis.completed`, the trigger:
 *
 *   1. Resolves the model's family_slug via models.family_id → model_families.slug.
 *   2. Finds the prior `analysis.completed` event for any sibling model in
 *      the same family + task_set, strictly earlier than the new event.
 *   3. Calls computeGenerationDiff() to produce the comparable / mismatch /
 *      baseline-missing result.
 *   4. Upserts a row in family_diffs (read-then-update-or-insert; see the
 *      0007_family_diffs.sql migration for why we don't use UNIQUE here).
 *   5. Invalidates the family-diff Cache API entries so the next read
 *      observes the fresh diff.
 *
 * The ctx.waitUntil wrapper keeps the POST response fast — the diff
 * materialises in the background while the writer's response returns
 * immediately. Failures inside the trigger are logged but never throw to
 * the caller; the family-diff endpoint recomputes on demand on cache miss.
 */

/**
 * Minimal ctx.waitUntil-shaped context. The full ExecutionContext type
 * comes from @cloudflare/workers-types via SvelteKit's platform binding;
 * we accept the narrower shape so tests can pass a noop-shim.
 */
export interface DiffTriggerContext {
  waitUntil(promise: Promise<unknown>): void;
}

export async function maybeTriggerFamilyDiff(
  ctx: DiffTriggerContext,
  db: D1Database,
  cache: Cache,
  event: {
    id: number;
    model_slug: string;
    task_set_hash: string;
    event_type: string;
  },
): Promise<void> {
  if (event.event_type !== 'analysis.completed') return;

  // Resolve family_slug (JOIN models.family_id → model_families.slug).
  // If the model isn't in the catalog yet, the diff is a no-op — the trigger
  // simply returns. Operators can re-run the cycle command after the catalog
  // catches up to materialize the diff retroactively.
  const fam = await db.prepare(
    `SELECT mf.slug AS family_slug
       FROM models m
       JOIN model_families mf ON mf.id = m.family_id
      WHERE m.slug = ?`,
  ).bind(event.model_slug).first<{ family_slug: string }>();
  if (!fam) return;

  // Find the prior analysis.completed event for any model in the same
  // family + task_set, strictly earlier than `event.id`.
  //
  // Inline SQL preferred over queryEvents() here because we need a JOIN
  // through models → model_families and the trigger runs on the worker
  // side where direct D1 access is faster than re-routing through
  // queryEvents (which is intended for the CLI side).
  const prior = await db.prepare(
    `SELECT le.id
       FROM lifecycle_events le
       JOIN models m ON m.slug = le.model_slug
       JOIN model_families mf ON mf.id = m.family_id
      WHERE mf.slug = ?
        AND le.task_set_hash = ?
        AND le.event_type = 'analysis.completed'
        AND le.id < ?
      ORDER BY le.id DESC
      LIMIT 1`,
  ).bind(fam.family_slug, event.task_set_hash, event.id)
    .first<{ id: number }>();

  // Schedule async diff computation. The ctx.waitUntil wrapper keeps the
  // POST response fast; the diff materialises in the background and the
  // family-diff endpoint becomes consistent on next read.
  //
  // We ALSO race the inline promise (await it directly via the returned
  // value) for test determinism — concept-cache-invalidation.test.ts's
  // pattern: do the actual work inline AND let waitUntil keep the worker
  // alive for any extra background tasks. In practice the inline await is
  // fast (one D1 SELECT + one INSERT/UPDATE + two cache.delete calls)
  // and the response-time hit is negligible compared to the round-trip
  // signature verification we already paid.
  const job = runDiffJob({
    db,
    cache,
    family_slug: fam.family_slug,
    task_set_hash: event.task_set_hash,
    from_gen_event_id: prior?.id ?? null,
    to_gen_event_id: event.id,
  });
  ctx.waitUntil(job);
  await job;
}

interface DiffJobArgs {
  db: D1Database;
  cache: Cache;
  family_slug: string;
  task_set_hash: string;
  from_gen_event_id: number | null;
  to_gen_event_id: number;
}

async function runDiffJob(args: DiffJobArgs): Promise<void> {
  try {
    const result = await computeGenerationDiff(args.db as unknown as DiffDb, {
      family_slug: args.family_slug,
      task_set_hash: args.task_set_hash,
      from_gen_event_id: args.from_gen_event_id,
      to_gen_event_id: args.to_gen_event_id,
    });

    await upsertFamilyDiff(args.db, result);
    await invalidateFamilyDiffCache(args.cache, result);
  } catch (err) {
    // Failure is non-fatal — the API endpoint will recompute on demand
    // when the cache miss happens (the diff endpoint has a fallback path
    // that calls computeGenerationDiff() inline if the materialised row is
    // absent). Log for observability but do not re-throw.
    console.error('[lifecycle-diff-trigger] failed', {
      family_slug: args.family_slug,
      to_gen_event_id: args.to_gen_event_id,
      from_gen_event_id: args.from_gen_event_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * App-level idempotent upsert into family_diffs.
 *
 * Why read-then-update-or-insert and not UNIQUE + INSERT OR REPLACE:
 * D1/SQLite UNIQUE constraints treat NULL as distinct, so a UNIQUE on
 * (family_slug, task_set_hash, from_gen_event_id, to_gen_event_id) would
 * permit duplicate baseline_missing rows (where from_gen_event_id IS NULL).
 * The 0007 migration deliberately omits UNIQUE; this writer enforces
 * dedup via IS NULL-aware lookup.
 */
async function upsertFamilyDiff(db: D1Database, result: DiffResult): Promise<void> {
  const existing = await db.prepare(
    `SELECT id FROM family_diffs
      WHERE family_slug = ? AND task_set_hash = ?
        AND to_gen_event_id = ?
        AND ((from_gen_event_id IS NULL AND ? IS NULL)
             OR from_gen_event_id = ?)
      LIMIT 1`,
  ).bind(
    result.family_slug,
    result.task_set_hash,
    result.to_gen_event_id,
    result.from_gen_event_id,
    result.from_gen_event_id,
  ).first<{ id: number }>();

  const now = Date.now();
  if (existing) {
    await db.prepare(
      `UPDATE family_diffs
          SET status = ?, payload_json = ?, computed_at = ?,
              from_model_slug = ?, to_model_slug = ?,
              analyzer_model_a = ?, analyzer_model_b = ?
        WHERE id = ?`,
    ).bind(
      result.status,
      JSON.stringify(result),
      now,
      result.from_model_slug,           // NULL allowed for baseline_missing
      result.to_model_slug,
      result.analyzer_model_a,
      result.analyzer_model_b,
      existing.id,
    ).run();
  } else {
    await db.prepare(
      `INSERT INTO family_diffs(family_slug, task_set_hash,
         from_gen_event_id, to_gen_event_id,
         from_model_slug, to_model_slug,
         status, analyzer_model_a, analyzer_model_b,
         payload_json, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      result.family_slug,
      result.task_set_hash,
      result.from_gen_event_id,         // NULL when baseline_missing — NO sentinel
      result.to_gen_event_id,
      result.from_model_slug,            // NULL when baseline_missing
      result.to_model_slug,
      result.status,
      result.analyzer_model_a,
      result.analyzer_model_b,
      JSON.stringify(result),
      now,
    ).run();
  }
}

/**
 * Cache invalidation. Two surfaces to evict:
 *   - the family-diff endpoint's cached response keyed by URL.
 *   - the parent family page's data endpoint (already cached for 60s).
 *
 * Cache API has no purge-by-tag; we delete by exact URL. CLAUDE.md's
 * KV-quota note applies: use caches.open('lifecycle'), NOT caches.default
 * (the adapter-cloudflare wrapper already touches caches.default keyed by
 * URL on its own, so app-level invalidation there is unreliable).
 */
async function invalidateFamilyDiffCache(cache: Cache, result: DiffResult): Promise<void> {
  const baseUrl = 'https://cache.lifecycle/family-diff';
  await cache.delete(`${baseUrl}/${result.family_slug}/latest`);
  await cache.delete(
    `${baseUrl}/${result.family_slug}/${result.from_gen_event_id ?? 'baseline'}/${result.to_gen_event_id}`,
  );
}
