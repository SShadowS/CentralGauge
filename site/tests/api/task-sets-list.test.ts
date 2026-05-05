import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import type { TaskSetsResponse } from "../../src/lib/shared/api-types";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

async function seed(): Promise<void> {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,display_name,is_current) VALUES
         (?,'2026-04-01T00:00:00Z',64,'Legacy',0),
         (?,'2026-05-01T00:00:00Z',64,'May 2026',1),
         (?,'2026-05-04T00:00:00Z',64,NULL,0)`,
    ).bind(HASH_A, HASH_B, HASH_C),
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES
         (1,1,'anthropic/claude-opus-4-7','claude-opus-4-7','Claude Opus 4.7',47)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES ('s',0.0,2,8192,'v1','Cronus28')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload) VALUES
         ('run-a',?,1,'s','r','2026-04-01T00:00:00Z','completed','v1','sig','2026-04-01T00:00:00Z',1,?),
         ('run-b1',?,1,'s','r','2026-05-01T00:00:00Z','completed','v1','sig','2026-05-01T00:00:00Z',1,?),
         ('run-b2',?,1,'s','r','2026-05-02T00:00:00Z','completed','v1','sig','2026-05-02T00:00:00Z',1,?)`,
    ).bind(
      HASH_A,
      new Uint8Array([0]),
      HASH_B,
      new Uint8Array([0]),
      HASH_B,
      new Uint8Array([0]),
    ),
  ]);
}

describe("GET /api/v1/task-sets", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(seed);

  it("lists task sets ordered current-first then newest", async () => {
    const res = await SELF.fetch("https://test/api/v1/task-sets");
    expect(res.status).toBe(200);
    const body = (await res.json()) as TaskSetsResponse;
    expect(body.data.length).toBe(3);
    // is_current=1 first
    expect(body.data[0].is_current).toBe(true);
    expect(body.data[0].hash).toBe(HASH_B);
    expect(body.data[0].display_name).toBe("May 2026");
    expect(body.data[0].run_count).toBe(2);
    // remaining ordered by created_at DESC
    expect(body.data[1].hash).toBe(HASH_C);
    expect(body.data[1].display_name).toBeNull();
    expect(body.data[2].hash).toBe(HASH_A);
    expect(body.data[2].display_name).toBe("Legacy");
  });

  it("includes short_hash and run_count fields", async () => {
    const res = await SELF.fetch("https://test/api/v1/task-sets");
    const body = (await res.json()) as TaskSetsResponse;
    for (const row of body.data) {
      expect(row.short_hash).toBe(row.hash.slice(0, 8));
      expect(row.run_count).toBeGreaterThanOrEqual(0);
    }
  });
});
