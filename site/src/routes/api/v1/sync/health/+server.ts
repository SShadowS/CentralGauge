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

    // `machine_keys.UNIQUE(machine_id, public_key)` allows multiple keys per machine
    // (e.g., one active, one revoked). Status should reflect the ACTIVE-key state:
    // last_used_at is the MAX over non-revoked keys; a machine counts as "revoked"
    // only when every key it has is revoked (no active keys remain).
    const rows = await getAll<{
      machine_id: string;
      active_last_used_at: string | null;
      active_keys: number | string;
      revoked_keys: number | string;
      verified_24h: number | string;
      rejected_24h: number | string;
    }>(
      env.DB,
      `SELECT k.machine_id,
              MAX(CASE WHEN k.revoked_at IS NULL THEN k.last_used_at END) AS active_last_used_at,
              SUM(CASE WHEN k.revoked_at IS NULL THEN 1 ELSE 0 END) AS active_keys,
              SUM(CASE WHEN k.revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked_keys,
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
      const activeKeys = +r.active_keys;
      const revokedKeys = +r.revoked_keys;
      const lagMs = r.active_last_used_at
        ? now - Date.parse(r.active_last_used_at)
        : Number.POSITIVE_INFINITY;
      // Clamp negative lag (clock skew / future timestamps) to 0 so operators don't
      // see nonsensical "-42 seconds ago" rows.
      const lagSeconds = Number.isFinite(lagMs) ? Math.max(0, Math.floor(lagMs / 1000)) : null;
      const status = activeKeys === 0 && revokedKeys > 0
        ? 'revoked'
        : !r.active_last_used_at
          ? 'never_used'
          : lagSeconds! > STALE_SECONDS
            ? 'stale'
            : 'healthy';
      return {
        machine_id: r.machine_id,
        last_used_at: r.active_last_used_at,
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
