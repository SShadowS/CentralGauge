import type { RequestHandler } from './$types';
import { cachedJson } from '$lib/server/cache';
import { getFirst } from '$lib/server/db';
import { ApiError, errorResponse } from '$lib/server/errors';
import {
  computeGenerationDiff,
  type DiffDb,
  type DiffResult,
} from '../../../../../../../../src/lifecycle/diff';
import type { FamilyDiff } from '$lib/shared/api-types';

/**
 * GET /api/v1/families/<slug>/diff?from=<event_id>&to=<event_id>&task_set=<hash>
 *
 * Reads the materialised `family_diffs` row for the (slug, from, to) tuple,
 * with sensible defaults when query params are absent:
 *   - `task_set` defaults to the row in `task_sets` with `is_current = 1`.
 *   - `to` defaults to the most-recent `analysis.completed` for any model
 *     in the family under that task_set.
 *   - `from` defaults to the prior `analysis.completed` (or NULL if none).
 *
 * When the family has zero analysis events yet, returns a `baseline_missing`
 * shell with both event-id fields NULL — the consumer renders an empty state.
 *
 * If the materialised row is absent (the trigger may not have run yet on
 * an old event), the endpoint recomputes inline via computeGenerationDiff()
 * and returns the freshly-computed result; the worker trigger will catch up
 * on the next analysis.completed event.
 *
 * Public — no signature. Cache-Control: public, max-age=300 for materialised
 * results, max-age=60 for inline-recomputed fallbacks.
 */
export const GET: RequestHandler = async ({ request, params, url, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const env = platform.env;
  try {
    const slug = params.slug!;
    const fromQ = url.searchParams.get('from');
    const toQ = url.searchParams.get('to');
    const taskSetQ = url.searchParams.get('task_set');

    // Resolve task_set: explicit param > current.
    let taskSetHash: string;
    if (taskSetQ) {
      taskSetHash = taskSetQ;
    } else {
      const ts = await getFirst<{ hash: string }>(
        env.DB,
        `SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`,
        [],
      );
      if (!ts) throw new ApiError(404, 'no_current_task_set', 'no task_set is is_current');
      taskSetHash = ts.hash;
    }

    // Resolve to_gen_event_id: explicit > most-recent analysis.completed for family.
    let toEventId: number | null;
    if (toQ) {
      toEventId = +toQ;
    } else {
      const latest = await getFirst<{ id: number }>(
        env.DB,
        `SELECT le.id
           FROM lifecycle_events le
           JOIN models m ON m.slug = le.model_slug
           JOIN model_families mf ON mf.id = m.family_id
          WHERE mf.slug = ?
            AND le.task_set_hash = ?
            AND le.event_type = 'analysis.completed'
          ORDER BY le.id DESC
          LIMIT 1`,
        [slug, taskSetHash],
      );
      toEventId = latest?.id ?? null;
    }

    // No analysis events for the family yet — return baseline_missing shell.
    // The two event-id fields are NULL; consumers render an empty state.
    if (toEventId == null) {
      const shell: FamilyDiff = {
        status: 'baseline_missing',
        family_slug: slug,
        task_set_hash: taskSetHash,
        from_gen_event_id: null,
        to_gen_event_id: null,
        from_model_slug: null,
        to_model_slug: null,
        analyzer_model_a: null,
        analyzer_model_b: null,
      };
      return cachedJson(request, shell, { cacheControl: 'public, max-age=60' });
    }

    let fromEventId: number | null;
    if (fromQ) {
      fromEventId = +fromQ;
    } else {
      const prior = await getFirst<{ id: number }>(
        env.DB,
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
        [slug, taskSetHash, toEventId],
      );
      fromEventId = prior?.id ?? null;
    }

    // Read materialised diff from family_diffs. NULL-aware lookup so both
    // baseline_missing (from_gen_event_id IS NULL) and comparable rows resolve.
    const row = await getFirst<{ payload_json: string }>(
      env.DB,
      `SELECT payload_json
         FROM family_diffs
        WHERE family_slug = ?
          AND task_set_hash = ?
          AND to_gen_event_id = ?
          AND ((from_gen_event_id IS NULL AND ? IS NULL)
               OR from_gen_event_id = ?)
        ORDER BY computed_at DESC
        LIMIT 1`,
      [slug, taskSetHash, toEventId, fromEventId, fromEventId],
    );
    if (row) {
      const result = JSON.parse(row.payload_json) as FamilyDiff;
      return cachedJson(request, result, { cacheControl: 'public, max-age=300' });
    }

    // Fallback: trigger may not have run yet (slow waitUntil OR backfill of
    // an old event predating Phase E). Recompute inline. Shorter TTL so the
    // next read picks up the trigger's materialised version once it lands.
    const result = await computeGenerationDiff(env.DB as unknown as DiffDb, {
      family_slug: slug,
      task_set_hash: taskSetHash,
      from_gen_event_id: fromEventId,
      to_gen_event_id: toEventId,
    });
    return cachedJson(request, result satisfies DiffResult, {
      cacheControl: 'public, max-age=60',
    });
  } catch (err) {
    return errorResponse(err);
  }
};
