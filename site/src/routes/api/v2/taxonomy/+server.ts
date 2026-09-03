import type { RequestHandler } from "./$types";
import { errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";
import { groupsFor } from "$lib/server/taxonomy-v2";
import type { TaxonomyV2Response } from "$lib/shared/api-types";

/**
 * `GET /api/v2/taxonomy` — the full vocabulary of the resolved revision:
 * format groups (with a live task count each), facet families, and tags
 * (with family + task count each). See `TaxonomyV2Response`.
 */
export const GET: RequestHandler = async ({ request, url, platform }) => {
  try {
    const db = platform!.env.DB;
    const ctx = await resolveV2Context(db, url);
    const rid = ctx.revision.id;

    const groups = await groupsFor(db, rid);

    const families = (
      await db
        .prepare(
          `SELECT slug, name, description FROM taxonomy_families WHERE revision_id = ? ORDER BY slug`,
        )
        .bind(rid)
        .all<{ slug: string; name: string; description: string }>()
    ).results;

    const tagRows = (
      await db
        .prepare(
          `SELECT t.slug, t.family, t.name, t.description, t.hidden_by_default AS hidden_by_default,
                  (SELECT COUNT(*) FROM taxonomy_task_tags x WHERE x.revision_id = t.revision_id AND x.tag_slug = t.slug) AS task_count
             FROM taxonomy_tags t WHERE t.revision_id = ? ORDER BY t.slug`,
        )
        .bind(rid)
        .all<{
          slug: string;
          family: string;
          name: string;
          description: string;
          hidden_by_default: number;
          task_count: number;
        }>()
    ).results;
    // SQLite has no boolean type; hidden_by_default comes back 0/1.
    const tags = tagRows.map((t) => ({
      ...t,
      hidden_by_default: t.hidden_by_default === 1,
    }));

    return v2Json(request, ctx, {
      groups,
      families,
      tags,
    } satisfies TaxonomyV2Response);
  } catch (err) {
    return errorResponse(err);
  }
};
