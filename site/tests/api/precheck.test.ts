import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";
import type {
  PrecheckRequest,
  PrecheckResponse,
} from "../../src/lib/shared/types";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
});

async function buildSignedPrecheck(
  payload: PrecheckRequest["payload"],
  keyId: number,
  keypair: Parameters<typeof createSignedPayload>[3],
): Promise<PrecheckRequest> {
  const { signedRequest } = await createSignedPayload(
    payload as unknown as Record<string, unknown>,
    keyId,
    undefined,
    keypair,
  );
  return {
    version: 1,
    signature: signedRequest.signature,
    payload,
  };
}

describe("POST /api/v1/precheck (auth-only)", () => {
  it("returns 200 with auth.ok=true for a valid signed probe", async () => {
    const { keyId, keypair } = await registerMachineKey("machine-A", "ingest");

    const body = await buildSignedPrecheck(
      { machine_id: "machine-A" },
      keyId,
      keypair,
    );

    const resp = await SELF.fetch("https://x/api/v1/precheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(resp.status).toBe(200);
    const json = await resp.json<PrecheckResponse>();
    expect(json.schema_version).toBe(1);
    expect(json.auth.ok).toBe(true);
    expect(json.auth.key_id).toBe(keyId);
    expect(json.auth.key_role).toBe("ingest");
    expect(json.auth.key_active).toBe(true);
    expect(json.auth.machine_id_match).toBe(true);
    expect(typeof json.server_time).toBe("string");
    // No catalog field in auth-only mode.
    expect(json.catalog).toBeUndefined();
  });

  it("returns 401 on bad signature", async () => {
    const { keyId, keypair } = await registerMachineKey("machine-A", "ingest");

    const body = await buildSignedPrecheck(
      { machine_id: "machine-A" },
      keyId,
      keypair,
    );
    // Corrupt the signature value (still valid base64 length, just wrong bytes).
    body.signature.value = "A".repeat(body.signature.value.length);

    const resp = await SELF.fetch("https://x/api/v1/precheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(resp.status).toBe(401);
  });

  it("returns auth.machine_id_match=false when payload.machine_id differs from the key machine_id", async () => {
    const { keyId, keypair } = await registerMachineKey("machine-A", "ingest");

    // Sign a payload claiming machine_id='machine-B' even though the key is bound to 'machine-A'.
    const body = await buildSignedPrecheck(
      { machine_id: "machine-B" },
      keyId,
      keypair,
    );

    const resp = await SELF.fetch("https://x/api/v1/precheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(resp.status).toBe(200);
    const json = await resp.json<PrecheckResponse>();
    expect(json.auth.ok).toBe(true);
    expect(json.auth.machine_id_match).toBe(false);
    expect(json.auth.key_id).toBe(keyId);
  });

  it("does not write to D1 (read-only) — no INSERT/UPDATE/DELETE on user-visible tables", async () => {
    const { keyId, keypair } = await registerMachineKey("machine-A", "ingest");

    // Snapshot row counts before the call for the tables the endpoint could plausibly touch.
    // (verifySignedRequest does best-effort UPDATE last_used_at — tolerated by the contract;
    // we assert no rows are inserted/deleted from runs, results, etc.)
    const tablesToSnapshot = ["runs", "results", "machine_keys"];
    const before: Record<string, number> = {};
    for (const t of tablesToSnapshot) {
      const row = await env.DB.prepare(`SELECT COUNT(*) as c FROM ${t}`).first<
        { c: number }
      >();
      before[t] = row?.c ?? 0;
    }

    const body = await buildSignedPrecheck(
      { machine_id: "machine-A" },
      keyId,
      keypair,
    );
    const resp = await SELF.fetch("https://x/api/v1/precheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(resp.status).toBe(200);

    for (const t of tablesToSnapshot) {
      const row = await env.DB.prepare(`SELECT COUNT(*) as c FROM ${t}`).first<
        { c: number }
      >();
      expect(row?.c ?? 0).toBe(before[t]);
    }
  });
});

describe("POST /api/v1/precheck — catalog probe", () => {
  async function seedFamilyAndModel(
    familyId: number,
    familySlug: string,
    vendor: string,
    modelId: number,
    modelSlug: string,
    apiModelId: string,
  ) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (?,?,?,?)`,
      ).bind(familyId, familySlug, vendor, familySlug),
      env.DB.prepare(
        `INSERT OR IGNORE INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (?,?,?,?,?,?)`,
      ).bind(modelId, familyId, modelSlug, apiModelId, modelSlug, 47),
    ]);
  }

  it("returns missing_models for slugs not in the models table", async () => {
    const { keyId, keypair } = await registerMachineKey("machine-A", "ingest");
    // Seed only one of the two requested variants.
    await seedFamilyAndModel(
      1,
      "claude",
      "anthropic",
      1,
      "anthropic/claude-opus-4-7",
      "claude-opus-4-7",
    );

    const body = await buildSignedPrecheck(
      {
        machine_id: "machine-A",
        variants: [
          {
            slug: "anthropic/claude-opus-4-7",
            api_model_id: "claude-opus-4-7",
            family_slug: "claude",
          },
          {
            slug: "openai/gpt-5",
            api_model_id: "gpt-5",
            family_slug: "openai",
          },
        ],
      },
      keyId,
      keypair,
    );

    const resp = await SELF.fetch("https://x/api/v1/precheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(resp.status).toBe(200);
    const json = await resp.json<PrecheckResponse>();
    expect(json.catalog).toBeDefined();
    expect(json.catalog!.missing_models).toHaveLength(1);
    expect(json.catalog!.missing_models[0].slug).toBe("openai/gpt-5");
  });

  it("returns missing_pricing for variants without cost_snapshots at pricing_version", async () => {
    const { keyId, keypair } = await registerMachineKey("machine-A", "ingest");
    // Seed model row but NO cost_snapshots at the requested pricing_version.
    await seedFamilyAndModel(
      1,
      "claude",
      "anthropic",
      1,
      "anthropic/claude-opus-4-7",
      "claude-opus-4-7",
    );

    const body = await buildSignedPrecheck(
      {
        machine_id: "machine-A",
        variants: [
          {
            slug: "anthropic/claude-opus-4-7",
            api_model_id: "claude-opus-4-7",
            family_slug: "claude",
          },
        ],
        pricing_version: "2026-04-26",
      },
      keyId,
      keypair,
    );

    const resp = await SELF.fetch("https://x/api/v1/precheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(resp.status).toBe(200);
    const json = await resp.json<PrecheckResponse>();
    expect(json.catalog).toBeDefined();
    expect(json.catalog!.missing_models).toHaveLength(0);
    expect(json.catalog!.missing_pricing).toHaveLength(1);
    expect(json.catalog!.missing_pricing[0].slug).toBe(
      "anthropic/claude-opus-4-7",
    );
    expect(json.catalog!.missing_pricing[0].pricing_version).toBe("2026-04-26");
  });

  it("returns task_set_current=true when is_current=1", async () => {
    const { keyId, keypair } = await registerMachineKey("machine-A", "ingest");
    await env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES (?,?,?,?)`,
    ).bind("abc", "2026-04-01T00:00:00Z", 1, 1).run();

    const body = await buildSignedPrecheck(
      {
        machine_id: "machine-A",
        variants: [
          {
            slug: "anthropic/claude-opus-4-7",
            api_model_id: "claude-opus-4-7",
            family_slug: "claude",
          },
        ],
        task_set_hash: "abc",
      },
      keyId,
      keypair,
    );

    const resp = await SELF.fetch("https://x/api/v1/precheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(resp.status).toBe(200);
    const json = await resp.json<PrecheckResponse>();
    expect(json.catalog).toBeDefined();
    expect(json.catalog!.task_set_known).toBe(true);
    expect(json.catalog!.task_set_current).toBe(true);
  });

  it("returns task_set_known=false for unknown hash", async () => {
    const { keyId, keypair } = await registerMachineKey("machine-A", "ingest");

    const body = await buildSignedPrecheck(
      {
        machine_id: "machine-A",
        variants: [
          {
            slug: "anthropic/claude-opus-4-7",
            api_model_id: "claude-opus-4-7",
            family_slug: "claude",
          },
        ],
        task_set_hash: "zzz",
      },
      keyId,
      keypair,
    );

    const resp = await SELF.fetch("https://x/api/v1/precheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(resp.status).toBe(200);
    const json = await resp.json<PrecheckResponse>();
    expect(json.catalog).toBeDefined();
    expect(json.catalog!.task_set_known).toBe(false);
    expect(json.catalog!.task_set_current).toBe(false);
  });

  it("does not include catalog field when no variants supplied", async () => {
    const { keyId, keypair } = await registerMachineKey("machine-A", "ingest");

    // Auth-only request: no variants[].
    const body = await buildSignedPrecheck(
      { machine_id: "machine-A" },
      keyId,
      keypair,
    );

    const resp = await SELF.fetch("https://x/api/v1/precheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(resp.status).toBe(200);
    const json = await resp.json<PrecheckResponse>();
    expect(json.catalog).toBeUndefined();
  });
});
