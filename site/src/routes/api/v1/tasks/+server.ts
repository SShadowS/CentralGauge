import type { RequestHandler } from "./$types";
import { cachedJson, decodeCursor, encodeCursor } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";

interface TaskCursor {
  id: string;
}

const VALID_DIFFICULTIES = new Set(["easy", "medium", "hard"]);

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const set = url.searchParams.get("set") ?? "current";
    if (set !== "current" && set !== "all" && !/^[0-9a-f]{64}$/.test(set)) {
      throw new ApiError(
        400,
        "invalid_set",
        "set must be current, all, or a 64-char hex task_set hash",
      );
    }
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      throw new ApiError(
        400,
        "invalid_limit",
        "limit must be between 1 and 100",
      );
    }
    const difficulty = url.searchParams.get("difficulty");
    if (difficulty && !VALID_DIFFICULTIES.has(difficulty)) {
      return new Response(
        JSON.stringify({ error: "invalid_difficulty" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    const category = url.searchParams.get("category")?.trim() || null;
    const tags = url.searchParams.getAll("tag").map((s) => s.trim()).filter(Boolean);
    const cursor = decodeCursor<TaskCursor>(url.searchParams.get("cursor"));

    const params: (string | number)[] = [];
    const wheres: string[] = [];
    if (set === "current") {
      wheres.push(
        `t.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`,
      );
    } else if (set !== "all" && /^[0-9a-f]{64}$/.test(set)) {
      wheres.push(`t.task_set_hash = ?`);
      params.push(set);
    }
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
    if (tags.length > 0) {
      // AND semantics: task must have ALL listed tag slugs.
      // Bind order: one ? per slug, then the integer count — matches textual ? order.
      // Bound params = tags.length + 1 (safely small, well under D1's ~100 cap).
      wheres.push(
        `t.task_id IN (
          SELECT tt.task_id FROM task_tags tt
          JOIN tags g ON g.id = tt.tag_id
          WHERE tt.task_set_hash = t.task_set_hash
            AND g.slug IN (${tags.map(() => "?").join(",")})
          GROUP BY tt.task_id
          HAVING COUNT(DISTINCT g.slug) = ?
        )`,
      );
      for (const slug of tags) params.push(slug);
      params.push(tags.length);
    }

    const sql = `
      SELECT t.task_id AS id, t.difficulty, t.content_hash, t.task_set_hash,
             tc.slug AS category_slug, tc.name AS category_name
      FROM tasks t LEFT JOIN task_categories tc ON tc.id = t.category_id
      ${wheres.length ? `WHERE ${wheres.join(" AND ")}` : ""}
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

    // Fetch tags for the resolved set in one query scoped by task_set_hash
    // (avoids binding one variable per task — D1 caps bound params at ~100).
    const tagMap = new Map<string, string[]>();
    if (page.length > 0) {
      // All page rows share the same task_set_hash (or come from is_current=1 set).
      // Use the hash from the first page row; for set=current all rows share one hash.
      // For set=all, group by task_set_hash individually.
      const distinctHashes = [...new Set(page.map((r) => r.task_set_hash))];
      for (const hash of distinctHashes) {
        const tagRows = await getAll<{ task_id: string; slug: string }>(
          env.DB,
          `SELECT tt.task_id AS task_id, tg.slug AS slug
           FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id
           WHERE tt.task_set_hash = ?`,
          [hash],
        );
        for (const tr of tagRows) {
          const key = `${hash}\0${tr.task_id}`;
          const list = tagMap.get(key);
          if (list) {
            list.push(tr.slug);
          } else {
            tagMap.set(key, [tr.slug]);
          }
        }
      }
      // Sort each list once
      for (const list of tagMap.values()) {
        list.sort();
      }
    }

    const data = page.map((r) => ({
      id: r.id,
      difficulty: r.difficulty,
      content_hash: r.content_hash,
      task_set_hash: r.task_set_hash,
      category: r.category_slug
        ? { slug: r.category_slug, name: r.category_name! }
        : null,
      tags: tagMap.get(`${r.task_set_hash}\0${r.id}`) ?? [],
    }));
    const next_cursor = hasMore
      ? encodeCursor({ id: page[page.length - 1].id } satisfies TaskCursor)
      : null;

    return cachedJson(request, { data, next_cursor });
  } catch (err) {
    return errorResponse(err);
  }
};
