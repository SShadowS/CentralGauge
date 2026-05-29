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

  // Solve AUC@2: (2*passedA1 + passedA2Only) / (2*D)
  // D is back-derived: D = (p1 + p2) / pass_at_n when pass_at_n > 0.
  // Simplified: auc_2 = (2*p1 + p2) * pass_at_n / (2 * (p1 + p2))
  const p1 = agg?.tasks_passed_attempt_1 ?? 0;
  const p2 = agg?.tasks_passed_attempt_2_only ?? 0;
  const total = p1 + p2;
  const passAtN = agg?.pass_at_n ?? 0;
  const auc2 = total > 0 && passAtN > 0
    ? (2 * p1 + p2) * passAtN / (2 * total)
    : 0;

  const out = await renderOgPng({
    kind: "model",
    slug,
    blobs: env.BLOBS,
    taskSetHash: taskSetHash ?? undefined,
    payload: {
      kind: "model",
      displayName: m.display_name,
      familySlug: m.family_slug,
      auc2,
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
