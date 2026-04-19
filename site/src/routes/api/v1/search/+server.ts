import type { RequestHandler } from './$types';
import { cachedJson } from '$lib/server/cache';
import { getAll } from '$lib/server/db';
import { ApiError, errorResponse } from '$lib/server/errors';

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const q = (url.searchParams.get('q') ?? '').trim();
    if (!q) throw new ApiError(400, 'missing_query', 'q is required');
    if (q.length > 200) throw new ApiError(400, 'query_too_long', 'q must be \u2264 200 chars');

    // FTS5 MATCH is sensitive to quotes; we wrap the query as a phrase when multi-word
    // to treat spaces as AND without the user needing MATCH syntax.
    const matchExpr = q.includes(' ') ? q.split(/\s+/).map(t => `"${t.replace(/"/g, '')}"`).join(' ') : q;

    const rows = await getAll<{
      result_id: number; run_id: string; task_id: string;
      model_slug: string; compile_errors_text: string; failure_reasons_text: string;
      started_at: string; snippet: string;
    }>(
      env.DB,
      `SELECT r.id AS result_id, r.run_id, r.task_id,
              m.slug AS model_slug,
              fts.compile_errors_text, fts.failure_reasons_text,
              runs.started_at,
              snippet(results_fts, -1, '<mark>', '</mark>', '\u2026', 12) AS snippet
       FROM results_fts fts
       JOIN results r ON r.id = fts.rowid
       JOIN runs ON runs.id = r.run_id
       JOIN models m ON m.id = runs.model_id
       WHERE results_fts MATCH ?
       ORDER BY runs.started_at DESC
       LIMIT 100`,
      [matchExpr],
    );

    return cachedJson(request, {
      query: q,
      data: rows,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
