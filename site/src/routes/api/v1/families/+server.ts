import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    const rows = await getAll<{
      slug: string;
      display_name: string;
      vendor: string;
      model_count: number;
      latest_avg_score: number | null;
      latest_model_slug: string | null;
    }>(
      env.DB,
      `
      WITH latest AS (
        SELECT m.family_id, m.id AS model_id, m.slug, m.generation,
               ROW_NUMBER() OVER (PARTITION BY m.family_id ORDER BY m.generation DESC, m.id DESC) AS rn
        FROM models m
      ),
      avg_by_model AS (
        SELECT runs.model_id, AVG(r.score) AS avg_score
        FROM runs
        JOIN results r ON r.run_id = runs.id
        GROUP BY runs.model_id
      )
      SELECT mf.slug, mf.display_name, mf.vendor,
             (SELECT COUNT(*) FROM models m WHERE m.family_id = mf.id) AS model_count,
             abm.avg_score AS latest_avg_score,
             l.slug AS latest_model_slug
      FROM model_families mf
      LEFT JOIN latest l ON l.family_id = mf.id AND l.rn = 1
      LEFT JOIN avg_by_model abm ON abm.model_id = l.model_id
      ORDER BY mf.slug ASC
      `,
      [],
    );

    return cachedJson(request, {
      data: rows.map((r) => ({
        slug: r.slug,
        display_name: r.display_name,
        vendor: r.vendor,
        model_count: +(r.model_count ?? 0),
        latest_avg_score: r.latest_avg_score === null
          ? null
          : +(r.latest_avg_score),
        latest_model_slug: r.latest_model_slug,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
};
