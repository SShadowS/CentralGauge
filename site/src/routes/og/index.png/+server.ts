import type { RequestHandler } from "./$types";
import { ApiError, errorResponse } from "$lib/server/errors";
import { loadFlags } from "$lib/server/flags";
import { renderOgPng } from "$lib/server/og-render";
import { isCanary } from "$lib/server/canary";

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

  // 1. Aggregate inputs from D1.
  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM models)                                         AS model_count,
       (SELECT COUNT(*) FROM runs)                                           AS run_count,
       (SELECT MAX(started_at) FROM runs)                                    AS last_run_at`,
  ).first<
    { model_count: number; run_count: number; last_run_at: string | null }
  >();

  // 2. Cache key needs current task-set hash so a promotion invalidates fresh.
  const taskSet = await env.DB.prepare(
    `SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`,
  ).first<{ hash: string }>();

  const out = await renderOgPng({
    kind: "index",
    blobs: env.BLOBS,
    taskSetHash: taskSet?.hash,
    payload: {
      kind: "index",
      modelCount: counts?.model_count ?? 0,
      runCount: counts?.run_count ?? 0,
      lastRunAt: counts?.last_run_at ?? "1970-01-01T00:00:00Z",
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
