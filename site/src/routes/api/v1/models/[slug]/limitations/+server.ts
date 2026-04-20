import type { RequestHandler } from './$types';
import { cachedJson } from '$lib/server/cache';
import { getAll, getFirst } from '$lib/server/db';
import { ApiError, errorResponse } from '$lib/server/errors';

export const GET: RequestHandler = async ({ request, params, platform }) => {
  const env = platform!.env;
  try {
    const model = await getFirst<{ id: number; display_name: string }>(
      env.DB,
      `SELECT id, display_name FROM models WHERE slug = ?`,
      [params.slug!],
    );
    if (!model) throw new ApiError(404, 'model_not_found', `No model '${params.slug}'`);

    const rows = await getAll<{
      al_concept: string;
      concept: string;
      description: string;
      correct_pattern: string;
      error_codes_json: string;
      first_seen: string;
      last_seen: string;
      occurrence_count: number | string;
    }>(
      env.DB,
      `SELECT s.al_concept, s.concept, s.description, s.correct_pattern,
              s.error_codes_json, s.first_seen, s.last_seen,
              (SELECT COUNT(*) FROM shortcoming_occurrences so WHERE so.shortcoming_id = s.id) AS occurrence_count
       FROM shortcomings s
       WHERE s.model_id = ?
       ORDER BY s.al_concept`,
      [model.id],
    );

    const accept = request.headers.get('accept') ?? '';
    if (accept.toLowerCase().includes('text/markdown')) {
      const md = renderMarkdown(model.display_name, rows);
      return new Response(md, {
        status: 200,
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'cache-control': 'public, s-maxage=60, stale-while-revalidate=600',
          'x-api-version': 'v1',
        },
      });
    }

    return cachedJson(request, {
      data: rows.map((r) => ({
        al_concept: r.al_concept,
        concept: r.concept,
        description: r.description,
        correct_pattern: r.correct_pattern,
        error_codes: JSON.parse(r.error_codes_json) as string[],
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        occurrence_count: +(r.occurrence_count ?? 0),
      })),
    });
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
    const codes = (JSON.parse(r.error_codes_json) as string[]).join(', ') || '(none)';
    return [
      `## ${r.al_concept}`,
      '',
      `**Concept:** ${r.concept}`,
      '',
      r.description,
      '',
      `**Correct pattern:** ${r.correct_pattern}`,
      '',
      `**Error codes:** ${codes}`,
      '',
      `**Occurrences:** ${+(r.occurrence_count ?? 0)}`,
      '',
    ].join('\n');
  });
  return [`# ${modelName} limitations`, '', ...sections].join('\n');
}
