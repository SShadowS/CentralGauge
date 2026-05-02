/**
 * Plan F / F6.3 — overview page server loader.
 *
 * Reads four scalar metrics directly from D1 (no admin endpoint hop —
 * Cloudflare Access already gates the route at the edge, and SvelteKit's
 * server loader runs in the same isolate as the worker so a direct DB
 * query is faster + simpler than fetching `/api/v1/admin/lifecycle/state`).
 */
import type { PageServerLoad } from './$types';
import { getFirst } from '$lib/server/db';

export const load: PageServerLoad = async ({ platform }) => {
  if (!platform) throw new Error('no platform env');
  const env = platform.env;

  const pending = await getFirst<{ n: number }>(
    env.DB,
    `SELECT COUNT(*) AS n FROM pending_review WHERE status = 'pending'`,
    [],
  );
  const total = await getFirst<{ n: number }>(
    env.DB,
    `SELECT COUNT(*) AS n FROM models`,
    [],
  );
  const withPending = await getFirst<{ n: number }>(
    env.DB,
    `SELECT COUNT(DISTINCT model_slug) AS n FROM pending_review WHERE status = 'pending'`,
    [],
  );
  const latest = await getFirst<{ ts: number }>(
    env.DB,
    `SELECT MAX(ts) AS ts FROM lifecycle_events`,
    [],
  );

  return {
    pending_count: pending?.n ?? 0,
    models_total: total?.n ?? 0,
    models_with_pending: withPending?.n ?? 0,
    latest_event_ts: latest?.ts ?? null,
  };
};
