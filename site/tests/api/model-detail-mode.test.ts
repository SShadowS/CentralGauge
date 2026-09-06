import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { ModelDetail } from "../../src/lib/shared/api-types";
import { resetDb } from "../utils/reset-db";

/**
 * D4 fix round 1, finding 2: /api/v1/models/:slug used to build its cache
 * key from the slug alone and resolve the mode only on a cache MISS (after
 * task_set_hash was looked up). That meant a cached sync-only response could
 * outlive the set's first batch run — the cache key had no way to reflect
 * that the set's mode had become ambiguous.
 *
 * Own file (own vitest-pool-workers isolate, own Cache API namespace) so the
 * cache assertions below cannot collide with any other test file's cached
 * /api/v1/models/:slug responses.
 */
describe("GET /api/v1/models/:slug — mode-scoped cache key (D4)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await resetDb();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
      ),
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47)`,
      ),
      env.DB.prepare(
        `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',2,1)`,
      ),
      env.DB.prepare(
        `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
      ),
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`,
      ),
      env.DB.prepare(
        `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
      ).bind(new Uint8Array([0])),
    ]);
    // Sync-only current set: one run, one mode.
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode)
       VALUES ('r-sync','ts',1,'s','rig','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','sig','2026-04-01T00:00:00Z',1,'{}','sync')`,
    ).run();
  });

  it("caches the sync-only response, then refuses (not stale-serves) once the set turns mixed-mode", async () => {
    const first = await SELF.fetch("https://x/api/v1/models/sonnet-4.7");
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as ModelDetail;
    expect(firstBody.aggregates.run_count).toBe(1);

    // Second fetch: same key, must be served from cache (same value; the
    // route has no observable "was this cached" header, so this asserts
    // stability rather than cache mechanics directly).
    const second = await SELF.fetch("https://x/api/v1/models/sonnet-4.7");
    expect(second.status).toBe(200);
    expect(((await second.json()) as ModelDetail).aggregates.run_count).toBe(1);

    // The set now carries a batch run too — the current task set has two
    // invocation modes. Raw INSERT does not bump the data epoch, so if the
    // route still keyed its cache on slug alone, this would keep serving the
    // pre-existing sync-only cached body forever within the epoch's TTL.
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode)
       VALUES ('r-batch','ts',1,'s','rig','2026-04-02T00:00:00Z','2026-04-02T01:00:00Z','completed','claimed','v1','sig','2026-04-02T00:00:00Z',1,'{}','batch')`,
    ).run();

    // Default request (no ?mode=): must refuse with a visible 400, never the
    // stale cached sync-only body.
    const third = await SELF.fetch("https://x/api/v1/models/sonnet-4.7");
    expect(third.status).toBe(400);
    const thirdBody = await third.json<{ code: string }>();
    expect(thirdBody.code).toBe("mode_required");

    // Explicit mode still works and computes fresh (a distinct cache key
    // from the default request, and correctly scoped to just that mode).
    const syncScoped = await SELF.fetch(
      "https://x/api/v1/models/sonnet-4.7?mode=sync",
    );
    expect(syncScoped.status).toBe(200);
    expect(
      ((await syncScoped.json()) as ModelDetail).aggregates.run_count,
    ).toBe(1);

    const batchScoped = await SELF.fetch(
      "https://x/api/v1/models/sonnet-4.7?mode=batch",
    );
    expect(batchScoped.status).toBe(200);
    expect(
      ((await batchScoped.json()) as ModelDetail).aggregates.run_count,
    ).toBe(1);
  });
});
