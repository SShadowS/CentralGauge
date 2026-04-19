import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ingest_events`),
    env.DB.prepare(`DELETE FROM machine_keys`),
  ]);
  const now = new Date();
  const hr = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at,last_used_at) VALUES (1,'rig-a',X'00','ingest','2026-01-01T00:00:00Z',?),(2,'rig-b',X'00','ingest','2026-01-01T00:00:00Z',?)`).bind(hr(1), hr(48)),
    env.DB.prepare(`INSERT INTO ingest_events(event,machine_id,ts,details_json) VALUES ('signature_verified','rig-a',?, '{}')`).bind(hr(1)),
    env.DB.prepare(`INSERT INTO ingest_events(event,machine_id,ts,details_json) VALUES ('rejected','rig-a',?, '{}')`).bind(hr(2)),
    env.DB.prepare(`INSERT INTO ingest_events(event,machine_id,ts,details_json) VALUES ('signature_verified','rig-b',?, '{}')`).bind(hr(48)),
  ]);
});

describe('GET /api/v1/sync/health', () => {
  it('returns per-machine lag + 24h counters', async () => {
    const res = await SELF.fetch('https://x/api/v1/sync/health');
    expect(res.status).toBe(200);
    const body = await res.json() as { machines: Array<any>; overall: any };
    expect(body.machines).toHaveLength(2);
    const a = body.machines.find((m: any) => m.machine_id === 'rig-a');
    const b = body.machines.find((m: any) => m.machine_id === 'rig-b');
    expect(a.lag_seconds).toBeLessThan(7200);  // last used 1h ago
    expect(b.lag_seconds).toBeGreaterThan(86400); // 48h ago
    expect(a.status).toBe('healthy');
    expect(b.status).toBe('stale');
    expect(a.verified_24h).toBe(1);
    expect(a.rejected_24h).toBe(1);
    expect(b.verified_24h).toBe(0);

    expect(body.overall.total_machines).toBe(2);
    expect(body.overall.healthy).toBe(1);
    expect(body.overall.stale).toBe(1);
  });

  it('uses no-cache headers (operator-facing)', async () => {
    const res = await SELF.fetch('https://x/api/v1/sync/health');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});
