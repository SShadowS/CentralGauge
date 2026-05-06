import type { RequestHandler } from "./$types";
import { ApiError, errorResponse } from "$lib/server/errors";
import { loadFlags } from "$lib/server/flags";
import { renderOgPng } from "$lib/server/og-render";
import { isCanary } from "$lib/server/canary";
import { computeModelAggregates } from "$lib/server/model-aggregates";

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

  const slug = params.slug;
  const m = await env.DB.prepare(
    `SELECT m.id, m.display_name, mf.slug AS family_slug
     FROM models m JOIN model_families mf ON mf.id = m.family_id
     WHERE m.slug = ?`,
  ).bind(slug).first<
    { id: number; display_name: string; family_slug: string }
  >();
  if (!m) return new Response(`Unknown model: ${slug}`, { status: 404 });

  const taskSet = await env.DB.prepare(
    `SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`,
  ).first<{ hash: string }>();
  const taskSetHash = taskSet?.hash ?? null;

  const agg = (await computeModelAggregates(env.DB, { modelIds: [m.id], taskSetHash })).get(
    m.id,
  );

  const out = await renderOgPng({
    kind: "model",
    slug,
    blobs: env.BLOBS,
    taskSetHash: taskSetHash ?? undefined,
    payload: {
      kind: "model",
      displayName: m.display_name,
      familySlug: m.family_slug,
      avgScore: agg?.avg_score ?? 0,
      runCount: agg?.run_count ?? 0,
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
