import type { ServerLoad } from '@sveltejs/kit';
import type { FamilyDetail, FamilyDiff } from '$lib/shared/api-types';
import { error } from '@sveltejs/kit';
import { getFirst } from '$lib/server/db';

/**
 * Family page loader. Fetches the existing FamilyDetail payload and the
 * Phase E concept diff in parallel; for analyzer_mismatch results,
 * additionally HEADs R2 server-side to determine whether the prior
 * generation's debug bundle is retained — the trajectory section's
 * "Re-analyze" CTA is disabled when the bundle is absent.
 *
 * Why direct R2 HEAD (not via /api/v1/admin/lifecycle/debug-bundle-exists):
 *   The HEAD endpoint is admin-signed and the worker doesn't own a private
 *   key for self-signing. Doing the lookup inline against
 *   platform.env.DB + platform.env.LIFECYCLE_BLOBS is the natural path —
 *   the data exposed (a boolean availability flag) is no more sensitive
 *   than what the diff endpoint already returns. The standalone admin
 *   endpoint exists for CLI consumers (e.g. operator scripting that
 *   wants to batch-check bundles).
 *
 * The diff endpoint never 500s for a missing diff (it returns a
 * baseline_missing shell when no analysis events exist), so any non-200
 * response is a real error — surface via SvelteKit's `error()`.
 */
export const load: ServerLoad = async ({ params, fetch, depends, setHeaders, platform }) => {
  const slug = params.slug!;
  depends(`app:family:${slug}`);

  const [famR, diffR] = await Promise.all([
    fetch(`/api/v1/families/${slug}`),
    fetch(`/api/v1/families/${slug}/diff`),
  ]);

  if (!famR.ok) {
    let body: { error?: string } = {};
    try { body = await famR.json() as { error?: string }; } catch { /* swallow */ }
    throw error(famR.status, body.error ?? `family fetch ${famR.status}`);
  }
  if (!diffR.ok) {
    let body: { error?: string } = {};
    try { body = await diffR.json() as { error?: string }; } catch { /* swallow */ }
    throw error(diffR.status, body.error ?? `diff fetch ${diffR.status}`);
  }

  const family = await famR.json() as FamilyDetail;
  const diff = await diffR.json() as FamilyDiff;

  // Propagate cache-control from the family endpoint so SvelteKit's response
  // TTL matches the API's (existing /api/v1/families/<slug> emits
  // private,max-age=60).
  const apiCache = famR.headers.get('cache-control');
  if (apiCache) setHeaders({ 'cache-control': apiCache });

  let r2BundleAvailable = false;
  if (
    diff.status === 'analyzer_mismatch' &&
    diff.from_gen_event_id != null &&
    platform?.env?.LIFECYCLE_BLOBS &&
    platform?.env?.DB
  ) {
    r2BundleAvailable = await checkR2Bundle(
      platform.env.DB,
      platform.env.LIFECYCLE_BLOBS,
      diff.from_gen_event_id,
    );
  }

  return { family, diff, r2BundleAvailable };
};

/**
 * Server-side R2 availability check for the debug bundle preceding a given
 * `analysis.completed` event. Returns false when:
 *   - the event id doesn't exist;
 *   - no `debug.captured` event predates it for the same model + task_set;
 *   - the debug.captured payload lacks `r2_key`;
 *   - the R2 HEAD returns null.
 *
 * Mirrors the lookup logic in
 * `/api/v1/admin/lifecycle/debug-bundle-exists/+server.ts` so the standalone
 * admin endpoint and the family page loader stay byte-equivalent in their
 * availability semantics.
 */
async function checkR2Bundle(
  db: D1Database,
  bucket: R2Bucket,
  fromEventId: number,
): Promise<boolean> {
  try {
    const ev = await getFirst<{ model_slug: string; task_set_hash: string }>(
      db,
      `SELECT model_slug, task_set_hash FROM lifecycle_events WHERE id = ?`,
      [fromEventId],
    );
    if (!ev) return false;
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
      [ev.model_slug, ev.task_set_hash, fromEventId],
    );
    if (!dbg) return false;
    let payload: { r2_key?: unknown };
    try {
      payload = JSON.parse(dbg.payload_json) as { r2_key?: unknown };
    } catch {
      return false;
    }
    if (typeof payload.r2_key !== 'string' || payload.r2_key.length === 0) return false;
    const obj = await bucket.head(payload.r2_key);
    return obj !== null;
  } catch (err) {
    console.error('[family/load] checkR2Bundle failed', err);
    return false;
  }
}
