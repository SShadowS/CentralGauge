import type { RequestHandler } from './$types';
import { cachedJson } from '$lib/server/cache';
import { getAll } from '$lib/server/db';
import { errorResponse } from '$lib/server/errors';

const STALE_SECONDS = 24 * 3600;

export const GET: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    const now = Date.now();
    const since24h = new Date(now - 24 * 3600 * 1000).toISOString();

    const rows = await getAll<{
      machine_id: string;
      last_used_at: string | null;
      revoked_at: string | null;
      verified_24h: number | string;
      rejected_24h: number | string;
    }>(
      env.DB,
      `SELECT k.machine_id,
              MAX(k.last_used_at) AS last_used_at,
              MAX(k.revoked_at) AS revoked_at,
              (SELECT COUNT(*) FROM ingest_events e
                 WHERE e.machine_id = k.machine_id
                   AND e.event = 'signature_verified'
                   AND e.ts >= ?) AS verified_24h,
              (SELECT COUNT(*) FROM ingest_events e
                 WHERE e.machine_id = k.machine_id
                   AND e.event = 'rejected'
                   AND e.ts >= ?) AS rejected_24h
       FROM machine_keys k
       GROUP BY k.machine_id`,
      [since24h, since24h],
    );

    const machines = rows.map((r) => {
      const lagMs = r.last_used_at ? now - Date.parse(r.last_used_at) : Number.POSITIVE_INFINITY;
      const lagSeconds = Number.isFinite(lagMs) ? Math.floor(lagMs / 1000) : null;
      const status = r.revoked_at
        ? 'revoked'
        : !r.last_used_at
          ? 'never_used'
          : lagSeconds! > STALE_SECONDS
            ? 'stale'
            : 'healthy';
      return {
        machine_id: r.machine_id,
        last_used_at: r.last_used_at,
        lag_seconds: lagSeconds,
        status,
        verified_24h: +r.verified_24h,
        rejected_24h: +r.rejected_24h,
      };
    });

    const overall = {
      total_machines: machines.length,
      healthy: machines.filter((m) => m.status === 'healthy').length,
      stale: machines.filter((m) => m.status === 'stale').length,
      revoked: machines.filter((m) => m.status === 'revoked').length,
      never_used: machines.filter((m) => m.status === 'never_used').length,
      generated_at: new Date(now).toISOString(),
    };

    return cachedJson(request, { machines, overall }, { cacheControl: 'no-store' });
  } catch (err) {
    return errorResponse(err);
  }
};
