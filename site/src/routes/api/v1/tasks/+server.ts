import type { RequestHandler } from './$types';
import { cachedJson, encodeCursor, decodeCursor } from '$lib/server/cache';
import { getAll } from '$lib/server/db';
import { ApiError, errorResponse } from '$lib/server/errors';

interface TaskCursor {
  id: string;
}

const VALID_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const set = url.searchParams.get('set') ?? 'current';
    if (set !== 'current' && set !== 'all') {
      throw new ApiError(400, 'invalid_set', 'set must be current or all');
    }
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      throw new ApiError(400, 'invalid_limit', 'limit must be between 1 and 100');
    }
    const difficulty = url.searchParams.get('difficulty');
    if (difficulty && !VALID_DIFFICULTIES.has(difficulty)) {
      return new Response(
        JSON.stringify({ error: 'invalid_difficulty' }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }
    const category = url.searchParams.get('category')?.trim() || null;
    const cursor = decodeCursor<TaskCursor>(url.searchParams.get('cursor'));

    const params: (string | number)[] = [];
    const wheres: string[] = [];
    if (set === 'current')
      wheres.push(`t.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`);
    if (cursor) {
      wheres.push(`t.task_id > ?`);
      params.push(cursor.id);
    }
    if (difficulty) {
      wheres.push(`t.difficulty = ?`);
      params.push(difficulty);
    }
    if (category) {
      wheres.push(`tc.slug = ?`);
      params.push(category);
    }

    const sql = `
      SELECT t.task_id AS id, t.difficulty, t.content_hash, t.task_set_hash,
             tc.slug AS category_slug, tc.name AS category_name
      FROM tasks t LEFT JOIN task_categories tc ON tc.id = t.category_id
      ${wheres.length ? `WHERE ${wheres.join(' AND ')}` : ''}
      ORDER BY t.task_id ASC
      LIMIT ?
    `;
    const rows = await getAll<{
      id: string;
      difficulty: string;
      content_hash: string;
      task_set_hash: string;
      category_slug: string | null;
      category_name: string | null;
    }>(env.DB, sql, [...params, limit + 1]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const data = page.map((r) => ({
      id: r.id,
      difficulty: r.difficulty,
      content_hash: r.content_hash,
      task_set_hash: r.task_set_hash,
      category: r.category_slug ? { slug: r.category_slug, name: r.category_name! } : null,
    }));
    const next_cursor = hasMore
      ? encodeCursor({ id: page[page.length - 1].id } satisfies TaskCursor)
      : null;

    return cachedJson(request, { data, next_cursor });
  } catch (err) {
    return errorResponse(err);
  }
};
