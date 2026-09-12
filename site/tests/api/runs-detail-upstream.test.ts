import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerIngestKey } from "../fixtures/ingest-helpers";
import { HASH, seedSet, smallCatalog } from "../fixtures/taxonomy-v2";
import { applyRevision } from "../../src/lib/server/taxonomy-v2";
import { normalizeCatalog } from "../../src/lib/shared/taxonomy-schema";
import { resetDb } from "../utils/reset-db";
import type { RunDetail, RunV2Detail } from "../../src/lib/shared/api-types";

const actor = {
  key_id: 1,
  machine_id: "test-machine",
  scope: "admin" as const,
};

async function seedRunRefData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47)`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',1,3.0,15.0,'2026-04-01T00:00:00Z')`,
    ),
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
  await seedRunRefData();
  await seedSet();
  await applyRevision(env.DB, {
    hash: HASH,
    normalized: normalizeCatalog(smallCatalog(), HASH),
    provenance: {},
    actor,
    signature: "s",
  });
});

describe("run detail upstream fields", () => {
  beforeEach(async () => {
    const { keyId } = await registerIngestKey();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES ('s',0.0,2,8192,'v3','Cronus28')`,
      ),
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode,invocation_json,excluded_at,excluded_code,excluded_reason)
         VALUES ('r-up',?,1,'s','rig','2026-09-10T00:00:00Z','completed','verified','v2026-04','sig','2026-09-10T00:00:00Z',?,'{}','batch','{"upstream_pin":"novita/fp8"}','2026-09-10T01:00:00Z','upstream_mismatch','upstream mismatch on 1 attempt')`,
      ).bind(HASH, keyId),
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,compile_errors_json,tests_total,tests_passed,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write,requested_upstream,served_upstream,served_upstream_model,upstream_identity_source,upstream_verification)
         VALUES ('r-up','easy/t1',1,1,100,1,'[]',1,1,10,10,0,0,'novita/fp8','Novita','v1','both','verified')`,
      ),
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,compile_errors_json,tests_total,tests_passed,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write,requested_upstream,served_upstream,served_upstream_model,upstream_identity_source,upstream_verification)
         VALUES ('r-up','easy/t2',1,0,0,1,'[]',1,0,10,10,0,0,'novita/fp8','Together','v2','provider_field','mismatch')`,
      ),
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,compile_errors_json,tests_total,tests_passed,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write)
         VALUES ('r-up','easy/t3',1,0,0,1,'[]',1,0,10,10,0,0)`,
      ),
    ]);
  });

  it("v1 carries per-attempt upstream and a run summary with excluded_code", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs/r-up");
    expect(res.status).toBe(200);
    const body = await res.json<RunDetail>();
    expect(body.excluded_code).toBe("upstream_mismatch");
    expect(body.upstream).toEqual({
      pin: "novita/fp8",
      served: ["Novita", "Together"],
      served_model: ["v1", "v2"],
      verification: { verified: 1, mismatch: 1, unrecorded: 1 },
      excluded_code: "upstream_mismatch",
    });
    const t1 = body.results.find((r) => r.task_id === "easy/t1")!;
    expect(t1.attempts[0]!.upstream).toEqual({
      requested: "novita/fp8",
      served: "Novita",
      served_model: "v1",
      identity_source: "both",
      verification: "verified",
    });
    const t3 = body.results.find((r) => r.task_id === "easy/t3")!;
    expect(t3.attempts[0]!.upstream).toEqual({
      requested: null,
      served: null,
      served_model: null,
      identity_source: null,
      verification: null,
    });
  });

  it("v2 carries the same fields", async () => {
    const res = await SELF.fetch("https://x/api/v2/runs/r-up");
    expect(res.status).toBe(200);
    const body = await res.json<RunV2Detail>();
    expect(body.upstream.pin).toBe("novita/fp8");
    expect(body.upstream.verification).toEqual({
      verified: 1,
      mismatch: 1,
      unrecorded: 1,
    });
    expect(body.results.find((r) => r.task_id === "easy/t2")!.upstream
      .verification).toBe("mismatch");
  });
});
