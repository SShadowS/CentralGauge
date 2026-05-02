import type { RequestHandler } from "./$types";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";

/**
 * Catalog drift probe (read-only health endpoint).
 *
 * Returns the count of distinct task IDs referenced by `results`
 * (`tasks_referenced`), the count of rows in `tasks` (`tasks_in_catalog`),
 * and a boolean `drift: tasks_referenced > tasks_in_catalog`.
 *
 * Consumers:
 *   1. Operators running `curl /api/v1/health/catalog-drift` to verify post-deploy.
 *   2. The daily cron (Task A6) which calls `runDailyDriftProbe(env)` directly
 *      (no HTTP indirection — see src/cron/catalog-drift.ts).
 *
 * Path-namespace choice: `/api/v1/health/*` (NOT `/admin/`) because every
 * `/admin/*` endpoint requires verifySignedRequest. Drift-status is read-only
 * and operator-friendly, so it belongs alongside the existing health surface.
 * Rate limiter at `hooks.server.ts` only gates WRITE_METHODS so GETs to this
 * path do NOT count against the per-IP write quota.
 */
export const GET: RequestHandler = async ({ platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  try {
    const refRow = await db
      .prepare(`SELECT COUNT(DISTINCT task_id) AS n FROM results`)
      .first<{ n: number }>();
    const catRow = await db
      .prepare(`SELECT COUNT(*) AS n FROM tasks`)
      .first<{ n: number }>();

    const tasks_referenced = refRow?.n ?? 0;
    const tasks_in_catalog = catRow?.n ?? 0;
    const drift_count = Math.max(0, tasks_referenced - tasks_in_catalog);
    const drift = drift_count > 0;
    const generated_at = new Date().toISOString();

    return jsonResponse(
      {
        tasks_referenced,
        tasks_in_catalog,
        drift,
        drift_count,
        generated_at,
      },
      200,
      { "cache-control": "no-store" },
    );
  } catch (err) {
    return errorResponse(err);
  }
};
