import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { HASH, seedSet } from "../fixtures/taxonomy-v2";
import { policyDigest } from "../../src/lib/server/scoring-policy";

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
beforeEach(async () => {
  await resetDb();
  await seedSet();
});

describe("scoring policies", () => {
  it("creates by digest, is idempotent, and can be assigned to a task set", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
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

    const a = (await (
      await post("/api/v1/admin/catalog/scoring-policies", { policy })
    ).json()) as { digest: string; created: boolean };
    expect(a.created).toBe(true);
    expect(a.digest).toBe(await policyDigest(policy as never));

    const b = (await (
      await post("/api/v1/admin/catalog/scoring-policies", { policy })
    ).json()) as { created: boolean };
    expect(b.created).toBe(false);

    const res = await post("/api/v1/admin/catalog/task-sets", {
      hash: HASH,
      created_at: "2026-01-01T00:00:00Z",
      task_count: 5,
      scoring_policy_digest: a.digest,
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT p.digest FROM task_sets t JOIN scoring_policies p ON p.id = t.scoring_policy_id WHERE t.hash = ?`,
    )
      .bind(HASH)
      .first<{ digest: string }>();
    expect(row?.digest).toBe(a.digest);

    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM admin_audit WHERE event = 'scoring_policy_assigned'`,
      ).first<{ n: number }>(),
    ).toEqual({ n: 1 });
  });

  it("audits scoring_policy_created once on first create, not again on repeat", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
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

    await post("/api/v1/admin/catalog/scoring-policies", { policy });
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM admin_audit WHERE event = 'scoring_policy_created'`,
      ).first<{ n: number }>(),
    ).toEqual({ n: 1 });

    await post("/api/v1/admin/catalog/scoring-policies", { policy });
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM admin_audit WHERE event = 'scoring_policy_created'`,
      ).first<{ n: number }>(),
    ).toEqual({ n: 1 });
  });

  it("is idempotent across key order — same digest, created: false", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
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

    const a = (await (
      await post("/api/v1/admin/catalog/scoring-policies", { policy })
    ).json()) as { digest: string; created: boolean };
    expect(a.created).toBe(true);

    // Same policy, top-level keys reordered — canonicalJson sorts keys at
    // every depth, so the digest and created:false must be unaffected.
    const reordered = {
      gate: policy.gate,
      draws: policy.draws,
      estimator_version: policy.estimator_version,
      metrics: policy.metrics,
      macro_weights: policy.macro_weights,
      cells: policy.cells,
      reduction: policy.reduction,
      cohort: policy.cohort,
      eligible: policy.eligible,
      schema_version: policy.schema_version,
    };
    const b = (await (
      await post("/api/v1/admin/catalog/scoring-policies", {
        policy: reordered,
      })
    ).json()) as { digest: string; created: boolean };
    expect(b.created).toBe(false);
    expect(b.digest).toBe(a.digest);
  });

  it("rejects a malformed policy", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    const { signedRequest } = await createSignedPayload(
      { policy: { schema_version: 1 } },
      keyId,
      undefined,
      keypair,
    );
    const res = await SELF.fetch(
      "https://x/api/v1/admin/catalog/scoring-policies",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...signedRequest, version: 1 }),
      },
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("invalid_policy");
  });

  it("rejects macro_weights whose values are not finite numbers", async () => {
    // String weights used to pass: `0 + "0.25"` is a string, subtracting 1
    // gives NaN, and `Math.abs(NaN) > 1e-9` is false, so the sum check never
    // fired. Every other field here is valid, so only the weights can fail it.
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    const stringWeights = {
      ...policy,
      macro_weights: {
        "build-from-spec": "0.25",
        "runtime-trap": "0.25",
        "diagnose-single": "0.25",
        "diagnose-composite": "0.25",
      },
    };
    const { signedRequest } = await createSignedPayload(
      { policy: stringWeights },
      keyId,
      undefined,
      keypair,
    );
    const res = await SELF.fetch(
      "https://x/api/v1/admin/catalog/scoring-policies",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...signedRequest, version: 1 }),
      },
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("invalid_policy");
  });
});
