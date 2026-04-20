import type { RequestHandler } from './$types';
import { cachedJson } from '$lib/server/cache';
import { getAll } from '$lib/server/db';
import { errorResponse } from '$lib/server/errors';

export const GET: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    const rows = await getAll<{
      slug: string;
      display_name: string;
      api_model_id: string;
      generation: number | null;
      family_slug: string;
    }>(
      env.DB,
      `SELECT m.slug, m.display_name, m.api_model_id, m.generation, mf.slug AS family_slug
       FROM models m JOIN model_families mf ON mf.id = m.family_id
       ORDER BY mf.slug, m.slug`,
      [],
    );
    return cachedJson(request, { data: rows });
  } catch (err) {
    return errorResponse(err);
  }
};
