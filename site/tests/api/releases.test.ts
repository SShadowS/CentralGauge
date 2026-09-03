import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { makeRunPayload, registerMachineKey } from "../fixtures/ingest-helpers";
import { HASH, seedSet, smallCatalog } from "../fixtures/taxonomy-v2";
import { applyRevision } from "../../src/lib/server/taxonomy-v2";
import { normalizeCatalog } from "../../src/lib/shared/taxonomy-schema";
import { createPolicy } from "../../src/lib/server/scoring-policy";
import { resetDb } from "../utils/reset-db";
import type { Keypair } from "../../src/lib/shared/ed25519";

const actor = {
  key_id: 1,
  machine_id: "test-machine",
  scope: "admin" as const,
};

const policy = {
  schema_version: 1,
  eligible: {
    statuses: ["completed"],
    sources: ["bench"],
    settings_hash: "f".repeat(64),
  },
  cohort: { size: 3, order: "started_at_desc", tie_break: "run_id" },
  reduction: "best_of_cohort",
  cells: {
    infra: "exclude",
    provider_error: "exclude",
    refusal: "count_for_requested_model",
    fallback: "count_for_requested_model",
  },
  macro_weights: {
    "build-from-spec": 0.25,
    "runtime-trap": 0.25,
    "diagnose-single": 0.25,
    "diagnose-composite": 0.25,
  },
  metrics: ["auc_2", "pass_at_1", "pass_at_n"],
  estimator_version: "ev0",
  draws: 4000,
  gate: { min_effective_components: 20, max_largest_share: 0.25 },
};

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

async function seedModel(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'m1','m1-api','Model One',1)`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',1,3.0,15.0,'2026-04-01T00:00:00Z')`,
    ),
  ]);
}

beforeEach(async () => {
  await resetDb();
  await seedModel();
  await seedSet();
});

/**
 * Ingest a single-result completed run for task `taskId` via the real
 * `/api/v1/runs` route, then flip it straight to `completed` in D1 (skipping
 * `/finalize`, which would require uploading transcript/code/bundle blobs
 * that this test has no need for).
 */
async function ingestCompletedRun(
  runId: string,
  taskId: string,
  keyId: number,
  keypair: Keypair,
): Promise<void> {
  const payload = makeRunPayload({
    task_set_hash: HASH,
    model: { slug: "m1", api_model_id: "m1-api", family_slug: "claude" },
    results: [
      {
        task_id: taskId,
        attempt: 1,
        passed: true,
        score: 100,
        compile_success: true,
        compile_errors: [],
        tests_total: 1,
        tests_passed: 1,
        tokens_in: 100,
        tokens_out: 50,
        tokens_cache_read: 0,
        tokens_cache_write: 0,
        durations_ms: { llm: 100, compile: 10, test: 5 },
        failure_reasons: [],
      },
    ],
  });
  delete payload.reproduction_bundle_sha256;
  const { signedRequest } = await createSignedPayload(
    payload as unknown as Record<string, unknown>,
    keyId,
    undefined,
    keypair,
  );
  signedRequest.signature.key_id = keyId;
  signedRequest.run_id = runId;
  const res = await SELF.fetch("https://x/api/v1/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signedRequest),
  });
  expect(res.status).toBe(202);
  await env.DB.prepare(
    `UPDATE runs SET status = 'completed', completed_at = ? WHERE id = ?`,
  )
    .bind(new Date().toISOString(), runId)
    .run();
}

describe("benchmark releases + export bundle", () => {
  it("publishes a signed release with a retained set, cohort digest, and R2 export bundle", async () => {
    const { keyId, keypair } = await registerMachineKey(
      "test-machine",
      "admin",
    );
    const pol = await createPolicy(env.DB, policy as never);
    const rev = await applyRevision(env.DB, {
      hash: HASH,
      normalized: normalizeCatalog(smallCatalog(), HASH),
      provenance: {},
      actor,
      signature: "s",
    });
    await ingestCompletedRun("run-a", "t1", keyId, keypair);
    await ingestCompletedRun("run-b", "c1", keyId, keypair);
    const runA = "run-a";
    const runB = "run-b";

    const sign = (p: object) =>
      createSignedPayload(
        p as Record<string, unknown>,
        keyId,
        undefined,
        keypair,
      );
    const post = async (path: string, p: object) =>
      SELF.fetch(`https://x${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(await sign(p)).signedRequest, version: 1 }),
      });

    const res = await post("/api/v1/admin/releases", {
      slug: "2026-09-launch",
      hash: HASH,
      revision_digest: rev.digest,
      scoring_policy_digest: pol.digest,
      estimator_version: "ev0",
      panel_manifest: {
        models: ["m1"],
        run_ids: { m1: [runA, runB] },
        metric: "pass_at_1",
        rule: "solved_by_at_most",
        threshold: 2,
        donor_cap: 4,
      },
      retained_task_ids: ["t1", "c1"],
      selection_reasons: { t1: "failed by 2 of 3", c1: "composite, resistant" },
      changelog: "first release",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cohort_digest: string;
      export_manifest_sha256: string;
    };
    expect(body.cohort_digest).toHaveLength(64);

    const rel = (await (
      await SELF.fetch("https://x/api/v2/releases/2026-09-launch?_cb=1")
    ).json()) as {
      retained_count: number;
      full_count: number;
      panel_manifest: { models: string[] };
      revision_digest: string;
    };
    expect(rel.retained_count).toBe(2);
    expect(rel.full_count).toBe(5);
    expect(rel.panel_manifest.models).toEqual(["m1"]);
    // The detail route pins the release's OWN revision (not whatever is
    // live for the set), so the envelope's revision_digest must match what
    // was actually published against.
    expect(rel.revision_digest).toBe(rev.digest);

    const manifest = await env.BLOBS.get(
      "exports/2026-09-launch/manifest.json",
    );
    expect(manifest).not.toBeNull();
    const m = JSON.parse(await manifest!.text()) as {
      files: { key: string; sha256: string }[];
    };
    expect(m.files.map((f) => f.key)).toContain(
      "exports/2026-09-launch/results.jsonl",
    );

    const results = await (await env.BLOBS.get(
      "exports/2026-09-launch/results.jsonl",
    ))!.text();
    expect(results.split("\n").filter(Boolean).length).toBeGreaterThan(0);

    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM admin_audit WHERE event = 'release_published'`,
      ).first<{ n: number }>(),
    ).toEqual({ n: 1 });

    // /api/v2/exports lists the same file set for the release's set.
    const exportsRes = await SELF.fetch(
      `https://x/api/v2/exports?set=${HASH}&_cb=1`,
    );
    expect(exportsRes.status).toBe(200);
    const exportsBody = (await exportsRes.json()) as {
      data: {
        release_slug: string;
        files: { key: string }[];
        manifest_sha256: string;
      }[];
    };
    const exportRow = exportsBody.data.find(
      (r) => r.release_slug === "2026-09-launch",
    );
    expect(exportRow).toBeTruthy();
    expect(exportRow?.manifest_sha256).toBe(body.export_manifest_sha256);
    expect(exportRow?.files.map((f) => f.key)).toContain(
      "exports/2026-09-launch/results.jsonl",
    );

    // /api/v2/releases lists it too.
    const listRes = await SELF.fetch(
      `https://x/api/v2/releases?set=${HASH}&_cb=1`,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { data: { slug: string }[] };
    expect(listBody.data.map((r) => r.slug)).toContain("2026-09-launch");
  });

  it("rejects publishing against a revision_digest that is not a verified revision of that hash", async () => {
    const { keyId, keypair } = await registerMachineKey(
      "test-machine",
      "admin",
    );
    const pol = await createPolicy(env.DB, policy as never);
    await applyRevision(env.DB, {
      hash: HASH,
      normalized: normalizeCatalog(smallCatalog(), HASH),
      provenance: {},
      actor,
      signature: "s",
    });

    const { signedRequest } = await createSignedPayload(
      {
        slug: "2026-09-bad-revision",
        hash: HASH,
        revision_digest: "not-a-real-digest",
        scoring_policy_digest: pol.digest,
        estimator_version: "ev0",
        panel_manifest: { models: ["m1"], run_ids: { m1: [] } },
        retained_task_ids: [],
        selection_reasons: {},
        changelog: "x",
      },
      keyId,
      undefined,
      keypair,
    );
    const res = await SELF.fetch("https://x/api/v1/admin/releases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...signedRequest, version: 1 }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("unknown_revision");
  });

  it("rejects publishing a duplicate slug", async () => {
    const { keyId, keypair } = await registerMachineKey(
      "test-machine",
      "admin",
    );
    const pol = await createPolicy(env.DB, policy as never);
    const rev = await applyRevision(env.DB, {
      hash: HASH,
      normalized: normalizeCatalog(smallCatalog(), HASH),
      provenance: {},
      actor,
      signature: "s",
    });

    const sign = (p: object) =>
      createSignedPayload(
        p as Record<string, unknown>,
        keyId,
        undefined,
        keypair,
      );
    const post = async (path: string, p: object) =>
      SELF.fetch(`https://x${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(await sign(p)).signedRequest, version: 1 }),
      });

    const payload = {
      slug: "2026-09-dup",
      hash: HASH,
      revision_digest: rev.digest,
      scoring_policy_digest: pol.digest,
      estimator_version: "ev0",
      panel_manifest: { models: ["m1"], run_ids: { m1: [] } },
      retained_task_ids: [],
      selection_reasons: {},
      changelog: "first",
    };

    const first = await post("/api/v1/admin/releases", payload);
    expect(first.status).toBe(200);

    const second = await post("/api/v1/admin/releases", {
      ...payload,
      changelog: "second attempt",
    });
    expect(second.status).toBe(409);
    const json = (await second.json()) as { code: string };
    expect(json.code).toBe("release_exists");
  });
});
