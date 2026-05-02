import type { RequestHandler } from "./$types";
import { getAll } from "$lib/server/db";
import { errorResponse } from "$lib/server/errors";
import { computeSeverity } from "$lib/server/severity";

interface RawRow {
  al_concept: string;
  models_affected: number | string | null;
  occurrence_count: number | string | null;
  distinct_tasks: number | string | null;
  first_seen: string | null;
  last_seen: string | null;
  example_run_id: string | null;
  example_task_id: string | null;
  affected_json: string;
}

const CACHE_NAME = "cg-shortcomings";
const CACHE_TTL_S = 60;

export const GET: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    // Named cache lookup. Avoid `caches.default` because adapter-cloudflare
    // also reads/writes it keyed by URL — entries put there are served
    // back to the next request without invoking this handler, silently
    // bypassing any future ETag/304 negotiation.
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    const rows = await getAll<RawRow>(
      env.DB,
      `
      SELECT s.al_concept,
             COUNT(DISTINCT s.model_id)                                          AS models_affected,
             (SELECT COUNT(*) FROM shortcoming_occurrences so2
              JOIN shortcomings s2 ON s2.id = so2.shortcoming_id
              WHERE s2.al_concept = s.al_concept)                                AS occurrence_count,
             (SELECT COUNT(DISTINCT so2b.task_id) FROM shortcoming_occurrences so2b
              JOIN shortcomings s2b ON s2b.id = so2b.shortcoming_id
              WHERE s2b.al_concept = s.al_concept)                               AS distinct_tasks,
             MIN(s.first_seen)                                                   AS first_seen,
             MAX(s.last_seen)                                                    AS last_seen,
             (SELECT runs.id FROM shortcoming_occurrences so3
              JOIN shortcomings s3 ON s3.id = so3.shortcoming_id
              JOIN results r ON r.id = so3.result_id
              JOIN runs ON runs.id = r.run_id
              WHERE s3.al_concept = s.al_concept
              ORDER BY runs.started_at DESC LIMIT 1)                             AS example_run_id,
             (SELECT so4.task_id FROM shortcoming_occurrences so4
              JOIN shortcomings s4 ON s4.id = so4.shortcoming_id
              WHERE s4.al_concept = s.al_concept LIMIT 1)                        AS example_task_id,
             (SELECT json_group_array(json_object(
                'slug', m.slug,
                'display_name', m.display_name,
                'occurrences', (SELECT COUNT(*) FROM shortcoming_occurrences so5
                                JOIN shortcomings s5 ON s5.id = so5.shortcoming_id
                                WHERE s5.al_concept = s.al_concept AND s5.model_id = m.id)
              ))
              FROM models m
              WHERE m.id IN (SELECT s6.model_id FROM shortcomings s6
                             WHERE s6.al_concept = s.al_concept))                AS affected_json
      FROM shortcomings s
      GROUP BY s.al_concept
      ORDER BY models_affected DESC, occurrence_count DESC, s.al_concept ASC
      `,
      [],
    );

    const data = rows.map((r) => {
      let affected: Array<
        { slug: string; display_name: string; occurrences: number }
      > = [];
      try {
        affected = JSON.parse(r.affected_json) as typeof affected;
      } catch {
        affected = [];
      }
      const occ = Number(r.occurrence_count ?? 0);
      const distinctTasks = Number(r.distinct_tasks ?? 0);
      // Identical bucket logic to /api/v1/models/[slug]/limitations (Task A0.5)
      const severity = computeSeverity(occ, distinctTasks);
      return {
        al_concept: r.al_concept,
        models_affected: Number(r.models_affected ?? 0),
        occurrence_count: occ,
        severity,
        first_seen: r.first_seen ?? "",
        last_seen: r.last_seen ?? "",
        example_run_id: r.example_run_id,
        example_task_id: r.example_task_id,
        affected_models: affected,
      };
    });

    const body = JSON.stringify({
      data,
      generated_at: new Date().toISOString(),
    });
    const response = new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control":
          `public, s-maxage=${CACHE_TTL_S}, stale-while-revalidate=300`,
      },
    });
    // Inline put — NOT ctx.waitUntil — so the next request (and tests)
    // observe the entry deterministically. See CLAUDE.md "Workers KV" note.
    await cache.put(request, response.clone());
    return response;
  } catch (err) {
    return errorResponse(err);
  }
};
