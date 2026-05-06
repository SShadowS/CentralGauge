import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { errorResponse } from "$lib/server/errors";
import type {
  CategoriesIndexItem,
  CategoriesIndexResponse,
} from "$lib/shared/api-types";
import { CACHE_VERSION } from "$lib/server/cache-version";

const CACHE_TTL_SECONDS = 60;

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    // Named cache (cg-categories) — same pattern as /api/v1/leaderboard.
    // 60s TTL is sufficient for a low-frequency aggregate endpoint.
    const cache = await platform!.caches.open("cg-categories");
    const cacheUrl = new URL(url.toString());
    cacheUrl.searchParams.set('_cv', CACHE_VERSION);
    const cacheKey = new Request(cacheUrl.toString(), {
      method: "GET",
    });

    let payload: CategoriesIndexResponse | null = null;
    const cached = await cache.match(cacheKey);
    if (cached) {
      payload = (await cached.json()) as CategoriesIndexResponse;
    }

    if (!payload) {
      // Aggregate per task_category. LEFT JOINs on tasks/results so
      // categories with zero tasks or zero results still appear with
      // task_count=0 / avg_pass_rate=null. Restricted to is_current=1
      // task set so the leaderboard's "current" view aligns.
      //
      // avg_pass_rate uses the strict per-set formula (same denominator as
      // pass_at_n on the leaderboard) so index and detail show the same value.
      // Formula: for each model with current-set runs, compute
      //   (tasks_passed_in_category) / (tasks_in_category)
      // then average across models. Equivalent to:
      //   SUM(per-model passes in category) / (model_count * category_task_count)
      //
      // Production-shape note: when `tasks_in_catalog = 0` (CC-1; current
      // production), the LEFT JOIN yields `task_count = 0` for every
      // category (or 0 rows if the categories table is also empty).
      // Consumers render an empty-state in either case.
      const rows = await getAll<{
        slug: string;
        name: string;
        task_count: number;
        avg_pass_rate: number | null;
      }>(
        env.DB,
        `
        WITH cur AS (SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1),
        cat_tasks AS (
          SELECT t.task_id, t.category_id
          FROM tasks t
          WHERE t.task_set_hash = (SELECT hash FROM cur)
        ),
        models_with_runs AS (
          SELECT DISTINCT model_id
          FROM runs
          WHERE task_set_hash = (SELECT hash FROM cur)
        ),
        -- p1: best-across-runs per (model, task): attempt=1 passed
        p1 AS (
          SELECT ru.model_id, r.task_id
          FROM results r
          JOIN runs ru ON ru.id = r.run_id
          WHERE ru.task_set_hash = (SELECT hash FROM cur)
            AND r.attempt = 1 AND r.passed = 1
          GROUP BY ru.model_id, r.task_id
        ),
        -- p2_only: attempt=2 passed and attempt=1 did NOT pass (for this model+task)
        p2_only AS (
          SELECT ru.model_id, r.task_id
          FROM results r
          JOIN runs ru ON ru.id = r.run_id
          WHERE ru.task_set_hash = (SELECT hash FROM cur)
            AND r.attempt = 2 AND r.passed = 1
            AND NOT EXISTS (
              SELECT 1 FROM results r1b
              JOIN runs ru1b ON ru1b.id = r1b.run_id
              WHERE ru1b.model_id = ru.model_id
                AND r1b.task_id = r.task_id
                AND r1b.attempt = 1 AND r1b.passed = 1
                AND ru1b.task_set_hash = (SELECT hash FROM cur)
            )
          GROUP BY ru.model_id, r.task_id
        ),
        -- All passes per (model, task) with category annotation
        passes_in_cat AS (
          SELECT ct.category_id, p.model_id
          FROM (
            SELECT model_id, task_id FROM p1
            UNION
            SELECT model_id, task_id FROM p2_only
          ) p
          JOIN cat_tasks ct ON ct.task_id = p.task_id
        ),
        -- Per (category, model): count of passed tasks
        model_cat_passes AS (
          SELECT category_id, model_id, COUNT(*) AS passes
          FROM passes_in_cat
          GROUP BY category_id, model_id
        ),
        -- Task count per category
        cat_task_count AS (
          SELECT category_id, COUNT(*) AS n
          FROM cat_tasks
          GROUP BY category_id
        ),
        -- Strict avg_pass_rate per category:
        -- SUM(model passes) / (model_count * category_task_count)
        cat_avg AS (
          SELECT
            ctc.category_id,
            CAST(SUM(COALESCE(mcp.passes, 0)) AS REAL)
              / NULLIF(CAST(COUNT(DISTINCT mwr.model_id) AS REAL) * ctc.n, 0)
              AS avg_pass_rate
          FROM cat_task_count ctc
          CROSS JOIN models_with_runs mwr
          LEFT JOIN model_cat_passes mcp
            ON mcp.category_id = ctc.category_id AND mcp.model_id = mwr.model_id
          GROUP BY ctc.category_id, ctc.n
        )
        SELECT
          tc.slug AS slug,
          tc.name AS name,
          COUNT(DISTINCT ct.task_id) AS task_count,
          ca.avg_pass_rate AS avg_pass_rate
        FROM task_categories tc
        LEFT JOIN cat_tasks ct ON ct.category_id = tc.id
        LEFT JOIN cat_avg ca ON ca.category_id = tc.id
        GROUP BY tc.id
        ORDER BY task_count DESC, tc.slug ASC
        `,
        [],
      );

      const data: CategoriesIndexItem[] = rows.map((r) => ({
        slug: r.slug,
        name: r.name,
        task_count: +(r.task_count ?? 0),
        avg_pass_rate: r.avg_pass_rate === null || r.avg_pass_rate === undefined
          ? null
          : Math.round(+(r.avg_pass_rate) * 1e6) / 1e6,
      }));

      payload = {
        data,
        generated_at: new Date().toISOString(),
      };

      // Inline put (not ctx.waitUntil) so subsequent requests and tests
      // observe the entry deterministically.
      const storeRes = new Response(JSON.stringify(payload), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `public, s-maxage=${CACHE_TTL_SECONDS}`,
        },
      });
      await cache.put(cacheKey, storeRes);
    }

    return cachedJson(request, payload);
  } catch (err) {
    return errorResponse(err);
  }
};
