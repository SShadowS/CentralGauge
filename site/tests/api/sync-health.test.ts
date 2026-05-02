import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ingest_events`),
    env.DB.prepare(`DELETE FROM machine_keys`),
  ]);
  const now = new Date();
  const hr = (h: number) =>
    new Date(now.getTime() - h * 3_600_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at,last_used_at) VALUES (1,'rig-a',X'00','ingest','2026-01-01T00:00:00Z',?),(2,'rig-b',X'00','ingest','2026-01-01T00:00:00Z',?)`,
    ).bind(hr(1), hr(48)),
    env.DB.prepare(
      `INSERT INTO ingest_events(event,machine_id,ts,details_json) VALUES ('signature_verified','rig-a',?, '{}')`,
    ).bind(hr(1)),
    env.DB.prepare(
      `INSERT INTO ingest_events(event,machine_id,ts,details_json) VALUES ('rejected','rig-a',?, '{}')`,
    ).bind(hr(2)),
    env.DB.prepare(
      `INSERT INTO ingest_events(event,machine_id,ts,details_json) VALUES ('signature_verified','rig-b',?, '{}')`,
    ).bind(hr(48)),
  ]);
});

describe("GET /api/v1/sync/health", () => {
  it("returns per-machine lag + 24h counters", async () => {
    const res = await SELF.fetch("https://x/api/v1/sync/health");
    expect(res.status).toBe(200);
    const body = await res.json() as { machines: Array<any>; overall: any };
    expect(body.machines).toHaveLength(2);
    const a = body.machines.find((m: any) => m.machine_id === "rig-a");
    const b = body.machines.find((m: any) => m.machine_id === "rig-b");
    expect(a.lag_seconds).toBeLessThan(7200); // last used 1h ago
    expect(b.lag_seconds).toBeGreaterThan(86400); // 48h ago
    expect(a.status).toBe("healthy");
    expect(b.status).toBe("stale");
    expect(a.verified_24h).toBe(1);
    expect(a.rejected_24h).toBe(1);
    expect(b.verified_24h).toBe(0);

    expect(body.overall.total_machines).toBe(2);
    expect(body.overall.healthy).toBe(1);
    expect(body.overall.stale).toBe(1);
  });

  it("uses no-cache headers (operator-facing)", async () => {
    const res = await SELF.fetch("https://x/api/v1/sync/health");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("does not emit ETag when cache-control is no-store", async () => {
    // A 304 from an operator dashboard is a footgun: the operator wanted live data.
    // No ETag means no conditional-request matching, which means no accidental 304s.
    const res = await SELF.fetch("https://x/api/v1/sync/health");
    expect(res.headers.get("etag")).toBeNull();
    // And a conditional request must still return 200 + fresh body.
    const res2 = await SELF.fetch("https://x/api/v1/sync/health", {
      headers: { "if-none-match": "*" },
    });
    expect(res2.status).toBe(200);
  });

  it("marks a machine as revoked when all its keys are revoked", async () => {
    const now = new Date();
    const hr = (h: number) =>
      new Date(now.getTime() - h * 3_600_000).toISOString();
    // Replace rig-a with two rows: both revoked. Machine should flip to `revoked`.
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM machine_keys WHERE machine_id = 'rig-a'`),
      env.DB.prepare(
        `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at,last_used_at,revoked_at) VALUES (10,'rig-a',X'01','ingest','2026-01-01T00:00:00Z',?,?),(11,'rig-a',X'02','ingest','2026-01-01T00:00:00Z',?,?)`,
      ).bind(hr(1), hr(2), hr(5), hr(3)),
    ]);
    const res = await SELF.fetch("https://x/api/v1/sync/health");
    const body = (await res.json()) as {
      machines: Array<{ machine_id: string; status: string }>;
      overall: { revoked: number };
    };
    const a = body.machines.find((m) => m.machine_id === "rig-a")!;
    expect(a.status).toBe("revoked");
    expect(body.overall.revoked).toBe(1);
  });

  it("treats a machine as healthy when any active key remains (mixed-key scenario)", async () => {
    const now = new Date();
    const hr = (h: number) =>
      new Date(now.getTime() - h * 3_600_000).toISOString();
    // rig-a: add a SECOND key that is revoked (older), keep the first key active.
    await env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at,last_used_at,revoked_at) VALUES (20,'rig-a',X'AA','ingest','2026-01-01T00:00:00Z',?,?)`,
    ).bind(hr(72), hr(24)).run();
    const res = await SELF.fetch("https://x/api/v1/sync/health");
    const body = (await res.json()) as {
      machines: Array<
        { machine_id: string; status: string; last_used_at: string | null }
      >;
    };
    const a = body.machines.find((m) => m.machine_id === "rig-a")!;
    expect(a.status).toBe("healthy");
    // last_used_at should be from the ACTIVE key (1h ago), not the revoked key (72h ago).
    const lagHours = (Date.now() - Date.parse(a.last_used_at!)) / 3_600_000;
    expect(lagHours).toBeLessThan(2);
  });

  it("marks a never-used key as never_used", async () => {
    await env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at,last_used_at) VALUES (30,'rig-c',X'BB','ingest','2026-01-01T00:00:00Z',NULL)`,
    ).run();
    const res = await SELF.fetch("https://x/api/v1/sync/health");
    const body = (await res.json()) as {
      machines: Array<
        { machine_id: string; status: string; lag_seconds: number | null }
      >;
      overall: { never_used: number };
    };
    const c = body.machines.find((m) => m.machine_id === "rig-c")!;
    expect(c.status).toBe("never_used");
    expect(c.lag_seconds).toBeNull();
    expect(body.overall.never_used).toBe(1);
  });
});
