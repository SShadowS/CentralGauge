import type { RequestHandler } from "./$types";
import { ApiError, errorResponse } from "$lib/server/errors";
import { loadFlags } from "$lib/server/flags";
import { renderOgPng } from "$lib/server/og-render";
import { isCanary } from "$lib/server/canary";

export const prerender = false;

export const GET: RequestHandler = async ({ params, url, platform }) => {
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

  const id = params.id;
  const row = await env.DB.prepare(
    `SELECT
       r.tier, r.task_set_hash, r.started_at,
       m.display_name AS model_display,
       (SELECT COUNT(DISTINCT task_id) FROM results WHERE run_id = r.id AND passed = 1) AS tasks_passed,
       (SELECT COUNT(DISTINCT task_id) FROM results WHERE run_id = r.id) AS tasks_total
     FROM runs r JOIN models m ON m.id = r.model_id
     WHERE r.id = ?`,
  ).bind(id).first<
    {
      tier: string;
      task_set_hash: string;
      started_at: string;
      model_display: string;
      tasks_passed: number;
      tasks_total: number;
    }
  >();
  if (!row) return new Response(`Unknown run: ${id}`, { status: 404 });

  const out = await renderOgPng({
    kind: "run",
    slug: id,
    blobs: env.BLOBS,
    taskSetHash: row.task_set_hash,
    payload: {
      kind: "run",
      modelDisplay: row.model_display,
      tasksPassed: row.tasks_passed,
      tasksTotal: row.tasks_total,
      tier: row.tier,
      ts: row.started_at,
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
