import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll, getFirst } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";
import { computeSeverity } from "$lib/server/severity";

export const GET: RequestHandler = async ({ request, params, platform }) => {
  const env = platform!.env;
  try {
    const model = await getFirst<{ id: number; display_name: string }>(
      env.DB,
      `SELECT id, display_name FROM models WHERE slug = ?`,
      [params.slug!],
    );
    if (!model)
      throw new ApiError(404, "model_not_found", `No model '${params.slug}'`);

    // D-data §D5: JOIN through concept_id to read canonical c.slug /
    // c.description / c.al_concept / c.canonical_correct_pattern instead of
    // stale per-shortcoming free-text fields. Filter out merged-out concepts
    // (superseded_by IS NULL). INNER JOIN intentionally drops rows where
    // s.concept_id IS NULL — those should not exist post-backfill, and a
    // LEFT JOIN would silently mask backfill bugs.
    //
    // correct_pattern falls back to s.correct_pattern when the registry
    // has no curated canonical_correct_pattern (the per-occurrence value
    // is still the operator's most-recent observed example).
    //
    // Output shape unchanged from the legacy query — `concept` is now
    // c.slug (was s.concept); both are the same string post-backfill.
    const rows = await getAll<{
      al_concept: string;
      concept: string;
      description: string;
      correct_pattern: string;
      error_codes_json: string;
      first_seen: string;
      last_seen: string;
      occurrence_count: number | string;
      distinct_tasks: number | string;
    }>(
      env.DB,
      `SELECT
          c.al_concept                                              AS al_concept,
          c.slug                                                    AS concept,
          c.description                                             AS description,
          COALESCE(c.canonical_correct_pattern, s.correct_pattern)  AS correct_pattern,
          s.error_codes_json                                        AS error_codes_json,
          s.first_seen                                              AS first_seen,
          s.last_seen                                               AS last_seen,
          (SELECT COUNT(*)             FROM shortcoming_occurrences so  WHERE so.shortcoming_id  = s.id) AS occurrence_count,
          (SELECT COUNT(DISTINCT so2.task_id) FROM shortcoming_occurrences so2 WHERE so2.shortcoming_id = s.id) AS distinct_tasks
       FROM shortcomings s
       INNER JOIN concepts c ON c.id = s.concept_id
       WHERE s.model_id = ?
         AND c.superseded_by IS NULL
       ORDER BY c.al_concept`,
      [model.id],
    );

    const accept = request.headers.get("accept") ?? "";
    // Content-negotiated endpoint: the @sveltejs/adapter-cloudflare wrapper
    // caches responses in `caches.default` keyed by URL only and does not
    // honor `Vary: Accept`, so public cacheability here would let a JSON
    // response served first poison a later `Accept: text/markdown` request.
    // Scope the cache to the browser (private) to keep content negotiation
    // correct at the CDN boundary.
    const cacheControl = "private, max-age=60";
    if (accept.toLowerCase().includes("text/markdown")) {
      const md = renderMarkdown(model.display_name, rows);
      return new Response(md, {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "cache-control": cacheControl,
          vary: "Accept",
          "x-api-version": "v1",
        },
      });
    }

    return cachedJson(
      request,
      {
        data: rows.map((r) => {
          const occ = +(r.occurrence_count ?? 0);
          const distinct = +(r.distinct_tasks ?? 0);
          return {
            al_concept: r.al_concept,
            concept: r.concept,
            description: r.description,
            correct_pattern: r.correct_pattern,
            error_codes: JSON.parse(r.error_codes_json) as string[],
            first_seen: r.first_seen,
            last_seen: r.last_seen,
            occurrence_count: occ,
            severity: computeSeverity(occ, distinct),
          };
        }),
      },
      { cacheControl, extraHeaders: { vary: "Accept" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
};

function renderMarkdown(
  modelName: string,
  rows: Array<{
    al_concept: string;
    concept: string;
    description: string;
    correct_pattern: string;
    error_codes_json: string;
    occurrence_count: number | string;
  }>,
): string {
  const sections = rows.map((r) => {
    const codes =
      (JSON.parse(r.error_codes_json) as string[]).join(", ") || "(none)";
    return [
      `## ${r.al_concept}`,
      "",
      `**Concept:** ${r.concept}`,
      "",
      r.description,
      "",
      `**Correct pattern:** ${r.correct_pattern}`,
      "",
      `**Error codes:** ${codes}`,
      "",
      `**Occurrences:** ${+(r.occurrence_count ?? 0)}`,
      "",
    ].join("\n");
  });
  return [`# ${modelName} limitations`, "", ...sections].join("\n");
}
