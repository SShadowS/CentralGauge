import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { makeRunPayload, registerIngestKey } from "../fixtures/ingest-helpers";
import { HASH, seedSet, smallCatalog } from "../fixtures/taxonomy-v2";
import { applyRevision } from "../../src/lib/server/taxonomy-v2";
import { normalizeCatalog } from "../../src/lib/shared/taxonomy-schema";
import { resetDb } from "../utils/reset-db";

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

describe("ingest stores run-time capture fields; v2 runs endpoints serve them", () => {
  it("stores a full-capture run and reads it back through /api/v2/runs/:id", async () => {
    const { keyId, keypair } = await registerIngestKey();
    const payload = makeRunPayload({
      task_set_hash: HASH,
      harness_fingerprint: "f".repeat(64),
      retry_path_version: "v3",
      environment_sha256: "e".repeat(64),
      bc_artifact: "bc-28.0",
      container_image_digest: "sha256:deadbeef",
      bcch_version: "6.1.14",
      test_runner: "soap",
      prompt_template_digest: "p".repeat(64),
      invocation: { provider: "anthropic" },
      results: [
        {
          task_id: "t1",
          attempt: 1,
          passed: true,
          score: 100,
          compile_success: true,
          compile_errors: [],
          tests_total: 1,
          tests_passed: 1,
          tokens_in: 1000,
          tokens_out: 500,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
          durations_ms: { llm: 5000, compile: 1000, test: 500 },
          failure_reasons: [],
          test_vector: [{ id: "x", name: "T1", passed: true }],
          termination_kind: "response",
          provider_finish_reason: "stop",
          cap_reached: false,
          infra_retries: 1,
          infra_exhaustion_reason: null,
          fallback_chain: ["anthropic/claude-a", "anthropic/claude-b"],
          prompt_sha256: "a".repeat(64),
          candidate_sha256: "b".repeat(64),
        },
      ],
    });
    const { signedRequest } = await createSignedPayload(
      payload as unknown as Record<string, unknown>,
      keyId,
      undefined,
      keypair,
    );
    signedRequest.signature.key_id = keyId;
    const runId = "run-full-capture-1";
    signedRequest.run_id = runId;

    const ingestRes = await SELF.fetch("https://x/api/v1/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(ingestRes.status).toBe(202);
    const ingestBody = await ingestRes.json<{ missing_blobs: string[] }>();
    // environment_sha256 must be wired into payloadBlobHashes (never uploaded here).
    expect(ingestBody.missing_blobs).toContain("e".repeat(64));

    const row = await env.DB.prepare(
      `SELECT harness_fingerprint, test_runner, invocation_json FROM runs WHERE id = ?`,
    )
      .bind(runId)
      .first<{
        harness_fingerprint: string;
        test_runner: string;
        invocation_json: string;
      }>();
    expect(row?.harness_fingerprint).toBe("f".repeat(64));
    expect(row?.test_runner).toBe("soap");
    expect(JSON.parse(row!.invocation_json).provider).toBe("anthropic");

    const r = await env.DB.prepare(
      `SELECT test_vector_json, termination_kind, cap_reached, prompt_digest FROM results WHERE run_id = ?`,
    )
      .bind(runId)
      .first<{
        test_vector_json: string;
        termination_kind: string;
        cap_reached: number;
        prompt_digest: string;
      }>();
    expect(JSON.parse(r!.test_vector_json)).toEqual([
      { id: "x", name: "T1", passed: true },
    ]);
    expect(r?.termination_kind).toBe("response");
    expect(r?.cap_reached).toBe(0);
    expect(r?.prompt_digest).toBe("a".repeat(64));

    const detailRes = await SELF.fetch(`https://x/api/v2/runs/${runId}?_cb=1`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json<{
      capture: string;
      test_runner: string;
      harness_fingerprint: string;
      environment_digest: string;
      settings_hash: string;
      invocation: { provider: string } | null;
      environment: {
        bc_artifact: string | null;
        container_image_digest: string | null;
        bcch_version: string | null;
        prompt_template_digest: string | null;
      };
      results: {
        task_id: string;
        attempt: number;
        passed: boolean;
        termination_kind: string | null;
        cap_reached: boolean | null;
        infra_retries: number | null;
        fallback_chain: string[] | null;
        prompt_digest: string | null;
        candidate_digest: string | null;
        test_vector: { id: string; name: string; passed: boolean }[] | null;
      }[];
    }>();
    expect(detail.capture).toBe("full");
    expect(detail.test_runner).toBe("soap");
    expect(detail.harness_fingerprint).toBe("f".repeat(64));
    expect(detail.environment_digest).toBe("e".repeat(64));
    expect(detail.settings_hash).toBeTruthy();
    expect(detail.invocation).toEqual({ provider: "anthropic" });
    expect(detail.environment).toEqual({
      bc_artifact: "bc-28.0",
      container_image_digest: "sha256:deadbeef",
      bcch_version: "6.1.14",
      prompt_template_digest: "p".repeat(64),
    });
    expect(detail.results).toHaveLength(1);
    expect(detail.results[0].test_vector).toHaveLength(1);
    expect(detail.results[0].test_vector).toEqual([
      { id: "x", name: "T1", passed: true },
    ]);
    expect(detail.results[0].termination_kind).toBe("response");
    expect(detail.results[0].cap_reached).toBe(false);
    expect(detail.results[0].infra_retries).toBe(1);
    expect(detail.results[0].fallback_chain).toEqual([
      "anthropic/claude-a",
      "anthropic/claude-b",
    ]);
    expect(detail.results[0].prompt_digest).toBe("a".repeat(64));
    expect(detail.results[0].candidate_digest).toBe("b".repeat(64));

    // And the list endpoint reflects the same run + capture flag.
    const listRes = await SELF.fetch(`https://x/api/v2/runs?_cb=1`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json<{
      data: {
        id: string;
        capture: string;
        model: { slug: string; family: string };
      }[];
    }>();
    const row2 = list.data.find((r2) => r2.id === runId);
    expect(row2?.capture).toBe("full");
    expect(row2?.model.slug).toBe("sonnet-4.7");
    expect(row2?.model.family).toBe("claude");
  });

  it("ingests a legacy payload (no capture fields) and reads it back as pre_capture", async () => {
    const { keyId, keypair } = await registerIngestKey();
    const payload = makeRunPayload({ task_set_hash: HASH });
    payload.results[0].task_id = "t1";
    const { signedRequest } = await createSignedPayload(
      payload as unknown as Record<string, unknown>,
      keyId,
      undefined,
      keypair,
    );
    signedRequest.signature.key_id = keyId;
    const runId = "run-legacy-1";
    signedRequest.run_id = runId;

    const ingestRes = await SELF.fetch("https://x/api/v1/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(ingestRes.status).toBe(202);

    const row = await env.DB.prepare(
      `SELECT harness_fingerprint, test_runner FROM runs WHERE id = ?`,
    )
      .bind(runId)
      .first<{
        harness_fingerprint: string | null;
        test_runner: string | null;
      }>();
    expect(row?.harness_fingerprint).toBeNull();
    expect(row?.test_runner).toBeNull();

    const detailRes = await SELF.fetch(`https://x/api/v2/runs/${runId}?_cb=1`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json<{
      capture: string;
      results: { test_vector: unknown[] | null }[];
    }>();
    expect(detail.capture).toBe("pre_capture");
    expect(detail.results[0].test_vector).toBeNull();
  });

  it("rejects an invalid test_runner", async () => {
    const { keyId, keypair } = await registerIngestKey();
    const payload = makeRunPayload({
      task_set_hash: HASH,
      // deliberately invalid — real values are 'soap' | 'legacy'
      test_runner: "bogus" as unknown as "soap",
    });
    const { signedRequest } = await createSignedPayload(
      payload as unknown as Record<string, unknown>,
      keyId,
      undefined,
      keypair,
    );
    signedRequest.signature.key_id = keyId;
    signedRequest.run_id = "run-bad-test-runner";

    const res = await SELF.fetch("https://x/api/v1/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe("invalid_test_runner");
  });

  it("rejects an invalid termination_kind", async () => {
    const { keyId, keypair } = await registerIngestKey();
    const payload = makeRunPayload({ task_set_hash: HASH });
    payload.results[0].task_id = "t1";
    (
      payload.results[0] as unknown as { termination_kind: string }
    ).termination_kind = "bogus";
    const { signedRequest } = await createSignedPayload(
      payload as unknown as Record<string, unknown>,
      keyId,
      undefined,
      keypair,
    );
    signedRequest.signature.key_id = keyId;
    signedRequest.run_id = "run-bad-termination-kind";

    const res = await SELF.fetch("https://x/api/v1/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe("invalid_termination_kind");
  });

  it("GET /api/v2/task-sets mirrors v1 plus scoring_policy_digest and active_revision_digest", async () => {
    const res = await SELF.fetch("https://x/api/v2/task-sets?_cb=1");
    expect(res.status).toBe(200);
    const body = await res.json<{
      data: {
        hash: string;
        scoring_policy_digest: string | null;
        active_revision_digest: string | null;
      }[];
    }>();
    const row = body.data.find((r) => r.hash === HASH);
    expect(row).toBeTruthy();
    expect(row?.active_revision_digest).toBeTruthy();
    expect(row?.scoring_policy_digest).toBeNull();
  });

  it("GET /api/v2/models mirrors v1", async () => {
    const v1Res = await SELF.fetch("https://x/api/v1/models");
    const v1Body = await v1Res.json<{ data: { slug: string }[] }>();

    const v2Res = await SELF.fetch("https://x/api/v2/models?_cb=1");
    expect(v2Res.status).toBe(200);
    const v2Body = await v2Res.json<{ data: { slug: string }[] }>();
    expect(v2Body.data.map((m) => m.slug).sort()).toEqual(
      v1Body.data.map((m) => m.slug).sort(),
    );
  });
});
