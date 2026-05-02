import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";
import { applyMarkHighlighting } from "$lib/server/search-highlight";

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) throw new ApiError(400, "missing_query", "q is required");
    if (q.length > 200) {
      throw new ApiError(400, "query_too_long", "q must be ≤ 200 chars");
    }

    // FTS5 operators (NEAR, *, ^, column filters) are injectable via raw user input.
    // Wrap every token in double-quotes unconditionally — even single-word queries —
    // so the value is interpreted as a literal phrase, never as MATCH syntax.
    const tokens = q.split(/\s+/).filter(Boolean);
    const matchExpr = tokens
      .map((t) => `"${t.replace(/"/g, "")}"`)
      .join(" ");

    // Note: FTS columns (compile_errors_text, failure_reasons_text) are NULL
    // under contentless mode and are NOT rendered by SearchResultRow.svelte —
    // dropped from the projection (P6 IM-7). Snippet text is derived from
    // results.snippet_text (populated by the 0004 backfill) with a fallback
    // computation from compile_errors_json + failure_reasons_json for rows
    // ingested after the migration that haven't been backfilled. Application
    // code wraps matched tokens with <mark> via applyMarkHighlighting (P6 A2).
    const rows = await getAll<{
      result_id: number;
      run_id: string;
      task_id: string;
      model_slug: string;
      started_at: string;
      snippet_text: string | null;
    }>(
      env.DB,
      `SELECT r.id AS result_id, r.run_id, r.task_id,
              m.slug AS model_slug,
              runs.started_at,
              COALESCE(
                NULLIF(r.snippet_text, ''),
                TRIM(
                  COALESCE((
                    SELECT group_concat(
                      COALESCE(json_extract(value,'$.code'), '') || ' ' ||
                      COALESCE(json_extract(value,'$.message'), ''),
                      ' ')
                    FROM json_each(r.compile_errors_json)
                    WHERE json_valid(r.compile_errors_json)
                  ), '')
                  || ' ' ||
                  COALESCE((
                    SELECT group_concat(value, ' ')
                    FROM json_each(r.failure_reasons_json)
                    WHERE json_valid(r.failure_reasons_json)
                  ), '')
                )
              ) AS snippet_text
       FROM results_fts fts
       JOIN results r ON r.id = fts.rowid
       JOIN runs ON runs.id = r.run_id
       JOIN models m ON m.id = runs.model_id
       WHERE results_fts MATCH ?
       ORDER BY runs.started_at DESC
       LIMIT 100`,
      [matchExpr],
    );

    const data = rows.map((r) => ({
      result_id: r.result_id,
      run_id: r.run_id,
      task_id: r.task_id,
      model_slug: r.model_slug,
      started_at: r.started_at,
      snippet: r.snippet_text === null || r.snippet_text === ""
        ? null
        : applyMarkHighlighting(r.snippet_text, tokens, 200),
    }));

    return cachedJson(request, {
      query: q,
      data,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
