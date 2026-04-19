import type { RequestHandler } from './$types';
import { cachedJson } from '$lib/server/cache';
import { getAll } from '$lib/server/db';
import { ApiError, errorResponse } from '$lib/server/errors';

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const parsed = (url.searchParams.get('models') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    // Dedup explicitly: request-order matters for response stability, so keep first occurrence.
    const seen = new Set<string>();
    const raw: string[] = [];
    for (const s of parsed) {
      if (!seen.has(s)) { seen.add(s); raw.push(s); }
    }
    if (raw.length < 2) throw new ApiError(400, 'too_few_models', 'At least 2 distinct models required');
    if (raw.length > 4) throw new ApiError(400, 'too_many_models', 'At most 4 models allowed');

    const placeholders = raw.map(() => '?').join(',');
    const models = await getAll<{ id: number; slug: string; display_name: string }>(
      env.DB,
      `SELECT id, slug, display_name FROM models WHERE slug IN (${placeholders})`,
      raw,
    );
    if (models.length !== raw.length) {
      throw new ApiError(404, 'model_not_found', `Unknown model(s): ${raw.filter(s => !models.some(m => m.slug === s)).join(',')}`);
    }

    const rows = await getAll<{
      task_id: string; model_slug: string; avg_score: number | string | null; runs: number;
    }>(
      env.DB,
      `SELECT r.task_id, m.slug AS model_slug, AVG(r.score) AS avg_score, COUNT(DISTINCT runs.id) AS runs
       FROM results r
       JOIN runs ON runs.id = r.run_id
       JOIN models m ON m.id = runs.model_id
       WHERE m.slug IN (${placeholders})
       GROUP BY r.task_id, m.id
       ORDER BY r.task_id, m.id`,
      raw,
    );

    const byTask = new Map<string, Record<string, number | null>>();
    for (const r of rows) {
      if (!byTask.has(r.task_id)) byTask.set(r.task_id, {});
      byTask.get(r.task_id)![r.model_slug] = r.avg_score == null
        ? null
        : Number((+r.avg_score).toFixed(6));
    }

    const tasks = Array.from(byTask.entries()).map(([task_id, scores]) => {
      const values = Object.values(scores).filter((v): v is number => v != null);
      const divergent = values.length > 1 && Math.max(...values) - Math.min(...values) > 0.01;
      return { task_id, scores, divergent };
    });

    return cachedJson(request, { models, tasks });
  } catch (err) {
    return errorResponse(err);
  }
};
