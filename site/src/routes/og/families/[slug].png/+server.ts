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
  const fam = await env.DB.prepare(
    `SELECT id, display_name, vendor FROM model_families WHERE slug = ?`,
  ).bind(slug).first<{ id: number; display_name: string; vendor: string }>();
  if (!fam) return new Response(`Unknown family: ${slug}`, { status: 404 });

  const [memberRows, taskSet] = await Promise.all([
    env.DB.prepare(
      `SELECT id, display_name FROM models WHERE family_id = ?`,
    ).bind(fam.id).all<{ id: number; display_name: string }>(),
    env.DB.prepare(
      `SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`,
    ).first<{ hash: string }>(),
  ]);

  const members = memberRows.results ?? [];
  const modelIds = members.map((m) => m.id);

  // Compute Solve AUC@2 for all family members scoped to current task set.
  const aggMap = modelIds.length > 0
    ? await computeModelAggregates(env.DB, {
      modelIds,
      taskSetHash: taskSet?.hash ?? null,
    })
    : new Map<number, { pass_at_n: number; tasks_passed_attempt_1: number; tasks_passed_attempt_2_only: number }>();

  // Pick the member with the highest auc_2; derive its display name.
  // auc_2 = (2*p1 + p2) * pass_at_n / (2 * (p1 + p2)) (D back-derived from pass_at_n)
  let topModelDisplay = "—";
  let topAuc2 = 0;
  for (const m of members) {
    const agg = aggMap.get(m.id);
    const p1 = agg?.tasks_passed_attempt_1 ?? 0;
    const p2 = agg?.tasks_passed_attempt_2_only ?? 0;
    const total = p1 + p2;
    const passAtN = agg?.pass_at_n ?? 0;
    const auc2 = total > 0 && passAtN > 0
      ? (2 * p1 + p2) * passAtN / (2 * total)
      : 0;
    if (auc2 > topAuc2) {
      topAuc2 = auc2;
      topModelDisplay = m.display_name;
    }
  }

  const out = await renderOgPng({
    kind: "family",
    slug,
    blobs: env.BLOBS,
    taskSetHash: taskSet?.hash,
    payload: {
      kind: "family",
      displayName: fam.display_name,
      vendor: fam.vendor,
      modelCount: members.length,
      topModelDisplay,
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
