import type { RequestHandler } from './$types';
import { ApiError, errorResponse } from '$lib/server/errors';
import { loadFlags } from '$lib/server/flags';
import { renderOgPng } from '$lib/server/og-render';
import { isCanary } from '$lib/server/canary';

export const prerender = false;

export const GET: RequestHandler = async ({ params, url, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'Cloudflare platform not available'));
  const env = platform.env;
  const flags = loadFlags(env as unknown as Record<string, string | undefined>, isCanary(url));
  if (!flags.og_dynamic) return new Response('og_dynamic flag is off', { status: 404 });

  const slug = params.slug;
  const fam = await env.DB.prepare(
    `SELECT id, display_name, vendor FROM model_families WHERE slug = ?`
  ).bind(slug).first<{ id: number; display_name: string; vendor: string }>();
  if (!fam) return new Response(`Unknown family: ${slug}`, { status: 404 });

  const top = await env.DB.prepare(
    `SELECT m.display_name AS top
     FROM models m
     LEFT JOIN runs r ON r.model_id = m.id
     LEFT JOIN results rs ON rs.run_id = r.id
     WHERE m.family_id = ?
     GROUP BY m.id
     ORDER BY AVG(rs.score) DESC NULLS LAST
     LIMIT 1`
  ).bind(fam.id).first<{ top: string }>();

  const memberCount = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM models WHERE family_id = ?`
  ).bind(fam.id).first<{ c: number }>();

  const taskSet = await env.DB.prepare(`SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`).first<{ hash: string }>();

  const out = await renderOgPng({
    kind: 'family',
    slug,
    blobs: env.BLOBS,
    taskSetHash: taskSet?.hash,
    payload: {
      kind: 'family',
      displayName: fam.display_name,
      vendor: fam.vendor,
      modelCount: memberCount?.c ?? 0,
      topModelDisplay: top?.top ?? '—',
    },
  });

  return new Response(out.body, {
    headers: {
      'content-type': out.contentType,
      'cache-control': out.cacheControl,
      'x-og-cache': out.cacheHit ? 'hit' : 'miss',
    },
  });
};
