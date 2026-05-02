/**
 * R2-availability lookup for the debug bundle preceding a given
 * `analysis.completed` event. Single source of truth for the family
 * page loader (`families/[slug]/+page.server.ts`) and the
 * `/api/v1/admin/lifecycle/debug-bundle-exists` admin endpoint —
 * keeping the two byte-equivalent in their availability semantics.
 *
 * The lookup is:
 *   1. Resolve `lifecycle_events(event_id)` → (model_slug, task_set_hash).
 *   2. Find the most-recent `debug.captured` event for the same model
 *      + task_set with id ≤ event_id (Plan C's verify step writes
 *      `debug.captured` with `payload_json.r2_key`).
 *   3. Parse `r2_key` from the payload.
 *   4. R2 HEAD against `LIFECYCLE_BLOBS` (Plan A's dedicated bucket;
 *      do NOT use the legacy `BLOBS` binding).
 *
 * Returns a discriminated result so callers can distinguish "missing
 * because no debug.captured" from "missing because R2 HEAD returned
 * null" — the admin endpoint surfaces the reason via the JSON body
 * (`reason: 'no_debug_captured' | 'malformed_payload_json' |
 * 'no_r2_key'`); the page loader collapses everything except success
 * to `r2BundleAvailable: false`.
 */

import { getFirst } from './db';

export type DebugBundleStatus =
  | { exists: true; r2_key: string }
  /**
   * `r2_key` is included on the `r2_head_null` variant so callers can
   * surface it (the legacy admin-endpoint contract returned it on
   * existence-false responses too — UI surfaces use it for forensic
   * "the key we expected" display). Other failure variants don't have a
   * key to surface (event missing, payload malformed, etc.).
   */
  | { exists: false; reason: 'r2_head_null'; r2_key: string }
  | { exists: false; reason: Exclude<DebugBundleMissingReason, 'r2_head_null'> };

export type DebugBundleMissingReason =
  | 'event_not_found'
  | 'no_debug_captured'
  | 'malformed_payload_json'
  | 'no_r2_key'
  | 'r2_head_null';

/**
 * Check whether a retained debug bundle exists in R2 for the given
 * `analysis.completed` event. Tolerates all the realistic missing-cases
 * (no event, no debug.captured, garbled payload, missing r2_key, R2
 * miss) and converts thrown D1 errors to `event_not_found` so callers
 * never crash on transient lookup failures.
 *
 * Production callers MUST pass the `LIFECYCLE_BLOBS` R2 binding (Plan A)
 * — the legacy `BLOBS` binding is for public ingest blobs and intentional
 * retention semantics differ.
 */
export async function checkDebugBundleAvailable(
  db: D1Database,
  bucket: R2Bucket,
  eventId: number,
): Promise<DebugBundleStatus> {
  try {
    const ev = await getFirst<{ model_slug: string; task_set_hash: string }>(
      db,
      `SELECT model_slug, task_set_hash FROM lifecycle_events WHERE id = ?`,
      [eventId],
    );
    if (!ev) return { exists: false, reason: 'event_not_found' };

    const dbg = await getFirst<{ payload_json: string }>(
      db,
      `SELECT payload_json
         FROM lifecycle_events
        WHERE model_slug = ?
          AND task_set_hash = ?
          AND event_type = 'debug.captured'
          AND id <= ?
        ORDER BY id DESC
        LIMIT 1`,
      [ev.model_slug, ev.task_set_hash, eventId],
    );
    if (!dbg) return { exists: false, reason: 'no_debug_captured' };

    let payload: { r2_key?: unknown };
    try {
      payload = JSON.parse(dbg.payload_json) as { r2_key?: unknown };
    } catch {
      return { exists: false, reason: 'malformed_payload_json' };
    }

    if (typeof payload.r2_key !== 'string' || payload.r2_key.length === 0) {
      return { exists: false, reason: 'no_r2_key' };
    }

    const obj = await bucket.head(payload.r2_key);
    if (obj === null) {
      return { exists: false, reason: 'r2_head_null', r2_key: payload.r2_key };
    }

    return { exists: true, r2_key: payload.r2_key };
  } catch (err) {
    // Defensive: treat unexpected D1/R2 failures as event_not_found so
    // the family page loader degrades to "bundle unavailable" UI rather
    // than throwing into SvelteKit's `error()`. The admin endpoint logs
    // its own context and propagates a 500 via errorResponse — so this
    // helper's swallow only matters for the loader path.
    console.error('[checkDebugBundleAvailable] unexpected failure', {
      eventId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { exists: false, reason: 'event_not_found' };
  }
}
