import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { errorResponse } from "$lib/server/errors";
import type {
  CategoriesIndexItem,
  CategoriesIndexResponse,
} from "$lib/shared/api-types";

import {
  buildCacheKey,
  readDataEpoch,
  isFallbackEpoch,
  EPOCH_KEYED_TTL_SECONDS,
  DEGRADED_TTL_SECONDS,
} from "$lib/server/data-epoch";
import { sharedCacheGet, sharedCacheSet } from "$lib/server/shared-cache";

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    // Named cache (cg-categories) — same pattern as /api/v1/leaderboard.
    // 60s TTL is sufficient for a low-frequency aggregate endpoint.
    const cache = await platform!.caches.open("cg-categories");
    // Ordering contract (see data-epoch.ts): epoch read BEFORE any
    // query feeding the payload, and never re-read in the request.
    const epoch = await readDataEpoch(env.DB);
    const ttl = isFallbackEpoch(epoch)
      ? DEGRADED_TTL_SECONDS
      : EPOCH_KEYED_TTL_SECONDS;
    // Key off parsed params only — never the raw URL. See buildCacheKey.
    const cacheKey = buildCacheKey("categories", {}, epoch);

    let payload: CategoriesIndexResponse | null = null;
    const cached = await cache.match(cacheKey);
    if (cached) {
      payload = (await cached.json()) as CategoriesIndexResponse;
    }

    // L2: globally shared. This route had L1 only, so every colo recomputed it.
    // Its payload is under a kilobyte, which is exactly why it was skipped —
    // and wrong: payload size is not query cost. Measured, this endpoint's
    // query reads tens of thousands of rows to produce that kilobyte.
    if (!payload) {
      const shared = await sharedCacheGet(env.DB, cacheKey.url, epoch);
      if (shared) {
        payload = JSON.parse(shared) as CategoriesIndexResponse;
        await cache
          .put(
            cacheKey,
            new Response(shared, {
              headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": `public, s-maxage=${ttl}`,
              },
            }),
          )
          .catch((err) =>
            console.error("[categories] L1 backfill failed:", err),
          );
      }
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
      //   (mean tasks passed per run in category) / (tasks_in_category)
      // then average across models. Equivalent to:
      //   SUM(per-model mean passes in category) / (model_count * category_task_count)
      //
      // The per-model term is a MEAN across that model's runs, matching the
      // leaderboard (cohort metrics, 2026-09). It used to be the union of
      // tasks any run passed, which rose with the number of runs a model had.
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
          SELECT model_id, COUNT(DISTINCT id) AS run_count
          FROM runs
          WHERE task_set_hash = (SELECT hash FROM cur)
          GROUP BY model_id
        ),
        -- p1: (model, run, task) cells passed at attempt 1
        p1 AS (
          SELECT ru.model_id, r.run_id, r.task_id
          FROM results r
          JOIN runs ru ON ru.id = r.run_id
          WHERE ru.task_set_hash = (SELECT hash FROM cur)
            AND r.attempt = 1 AND r.passed = 1
          GROUP BY r.run_id, r.task_id
        ),
        -- p2_only: attempt=2 passed and attempt=1 did NOT pass IN THE SAME RUN.
        -- Correlating on run_id also pins the task set, so the NOT EXISTS needs
        -- no scope clause of its own (cohort metrics, 2026-09).
        p2_only AS (
          SELECT ru.model_id, r.run_id, r.task_id
          FROM results r
          JOIN runs ru ON ru.id = r.run_id
          WHERE ru.task_set_hash = (SELECT hash FROM cur)
            AND r.attempt = 2 AND r.passed = 1
            AND NOT EXISTS (
              SELECT 1 FROM results r1b
              WHERE r1b.run_id = r.run_id
                AND r1b.task_id = r.task_id
                AND r1b.attempt = 1 AND r1b.passed = 1
            )
          GROUP BY r.run_id, r.task_id
        ),
        -- All passed cells with category annotation
        passes_in_cat AS (
          SELECT ct.category_id, p.model_id
          FROM (
            SELECT model_id, run_id, task_id FROM p1
            UNION
            SELECT model_id, run_id, task_id FROM p2_only
          ) p
          JOIN cat_tasks ct ON ct.task_id = p.task_id
        ),
        -- Per (category, model): passed (run, task) cells, divided by the
        -- model's run count below to give the mean tasks passed per run.
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
        -- SUM(model's MEAN passes per run) / (model_count * category_task_count)
        cat_avg AS (
          SELECT
            ctc.category_id,
            SUM(CAST(COALESCE(mcp.passes, 0) AS REAL) / mwr.run_count)
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
        HAVING task_count > 0
        ORDER BY task_count DESC, tc.slug ASC
        `,
        [],
      );

      const data: CategoriesIndexItem[] = rows.map((r) => ({
        slug: r.slug,
        name: r.name,
        task_count: +(r.task_count ?? 0),
        avg_pass_rate:
          r.avg_pass_rate === null || r.avg_pass_rate === undefined
            ? null
            : Math.round(+r.avg_pass_rate * 1e6) / 1e6,
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
          "cache-control": `public, s-maxage=${ttl}`,
        },
      });
      await sharedCacheSet(
        env.DB,
        cacheKey.url,
        epoch,
        JSON.stringify(payload),
      );
      await cache.put(cacheKey, storeRes);
    }

    return cachedJson(request, payload);
  } catch (err) {
    return errorResponse(err);
  }
};
