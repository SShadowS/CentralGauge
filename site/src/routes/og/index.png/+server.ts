import type { RequestHandler } from "./$types";
import { ApiError, errorResponse } from "$lib/server/errors";
import { loadFlags } from "$lib/server/flags";
import { renderOgPng } from "$lib/server/og-render";
import { isCanary } from "$lib/server/canary";
import { computeModelAggregates } from "$lib/server/model-aggregates";

export const prerender = false;

export const GET: RequestHandler = async ({ url, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "Cloudflare platform not available"),
    );
  }
  const env = platform.env;
  const flags = loadFlags(
    env as unknown as Record<string, string | undefined>,
    isCanary(url),
  );
  if (!flags.og_dynamic) {
    return new Response("og_dynamic flag is off", { status: 404 });
  }

  // 1. Aggregate inputs from D1 (counts + current task-set hash in parallel).
  const [counts, taskSet] = await Promise.all([
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM models)                                         AS model_count,
         (SELECT COUNT(*) FROM runs)                                           AS run_count,
         (SELECT MAX(started_at) FROM runs)                                    AS last_run_at`,
    ).first<
      { model_count: number; run_count: number; last_run_at: string | null }
    >(),
    // 2. Cache key needs current task-set hash so a promotion invalidates fresh.
    env.DB.prepare(
      `SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`,
    ).first<{ hash: string }>(),
  ]);

  // 3. Compute Solve AUC@2 for all models to find the leading value.
  //    auc_2 = (2*passedA1 + passedA2Only) / (2*D)
  //    The strict denominator D is not directly in the aggregate, but we can
  //    back-derive it: D = (passedA1 + passedA2Only) / pass_at_n (when > 0).
  //    Substituting: auc_2 = (2*p1 + p2) * pass_at_n / (2 * (p1 + p2))
  const aggMap = await computeModelAggregates(env.DB, {
    taskSetHash: taskSet?.hash ?? null,
  });
  let topAuc2 = 0;
  for (const agg of aggMap.values()) {
    const p1 = agg.tasks_passed_attempt_1;
    const p2 = agg.tasks_passed_attempt_2_only;
    const total = p1 + p2;
    const auc2 = total > 0 && agg.pass_at_n > 0
      ? (2 * p1 + p2) * agg.pass_at_n / (2 * total)
      : 0;
    if (auc2 > topAuc2) topAuc2 = auc2;
  }

  const out = await renderOgPng({
    kind: "index",
    blobs: env.BLOBS,
    taskSetHash: taskSet?.hash,
    payload: {
      kind: "index",
      modelCount: counts?.model_count ?? 0,
      runCount: counts?.run_count ?? 0,
      lastRunAt: counts?.last_run_at ?? "1970-01-01T00:00:00Z",
      topAuc2,
    },
  });

  return new Response(out.body, {
    headers: {
      "content-type": out.contentType,
      "cache-control": out.cacheControl,
      "x-og-cache": out.cacheHit ? "hit" : "miss",
    },
  });
};
