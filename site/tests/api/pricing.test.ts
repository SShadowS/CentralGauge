import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import type { Keypair } from "../../src/lib/shared/ed25519";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM cost_snapshots`).run();
  await env.DB.prepare(`DELETE FROM models`).run();
  await env.DB.prepare(`DELETE FROM model_families`).run();
  await env.DB.prepare(`DELETE FROM machine_keys`).run();
  // Seed two models
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.6','claude-sonnet-4-6','Sonnet 4.6',46),(2,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47)`,
    ),
    // Existing v2026-03 snapshots for both models, effective_until = NULL
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-03',1,3,15,'2026-03-01T00:00:00Z'),('v2026-03',2,3,15,'2026-03-01T00:00:00Z')`,
    ),
  ]);
});

async function buildPricingPost(
  payload: Record<string, unknown>,
  keyId: number,
  keypair: Keypair,
) {
  const { signedRequest } = await createSignedPayload(
    payload,
    keyId,
    undefined,
    keypair,
  );
  return SELF.fetch("http://x/api/v1/pricing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signedRequest),
  });
}

describe("POST /api/v1/pricing", () => {
  it("registers new pricing version and closes prior one", async () => {
    const { keyId, keypair } = await registerMachineKey(
      "admin-machine",
      "admin",
    );

    const res = await buildPricingPost(
      {
        pricing_version: "v2026-04",
        effective_from: "2026-04-01T00:00:00Z",
        close_previous: true,
        rates: [
          {
            model_slug: "sonnet-4.6",
            input_per_mtoken: 3,
            output_per_mtoken: 15,
          },
          {
            model_slug: "sonnet-4.7",
            input_per_mtoken: 3,
            output_per_mtoken: 15,
            cache_read_per_mtoken: 0.3,
          },
        ],
      },
      keyId,
      keypair,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = await res.json<
      { pricing_version: string; effective_from: string; inserted: number }
    >();
    expect(body.pricing_version).toBe("v2026-04");
    expect(body.effective_from).toBe("2026-04-01T00:00:00Z");
    expect(body.inserted).toBe(2);

    // v2026-03 rows should now be closed
    const oldRows = await env.DB.prepare(
      `SELECT effective_until FROM cost_snapshots WHERE pricing_version = 'v2026-03'`,
    ).all<{ effective_until: string | null }>();
    expect(
      oldRows.results.every((r) =>
        r.effective_until === "2026-04-01T00:00:00Z"
      ),
    ).toBe(true);

    // New v2026-04 rows should be open
    const newRows = await env.DB.prepare(
      `SELECT effective_until FROM cost_snapshots WHERE pricing_version = 'v2026-04'`,
    ).all<{ effective_until: string | null }>();
    expect(newRows.results).toHaveLength(2);
    expect(newRows.results.every((r) => r.effective_until === null)).toBe(true);
  });

  it("close_previous: false does NOT close prior version", async () => {
    const { keyId, keypair } = await registerMachineKey(
      "admin-machine",
      "admin",
    );

    const res = await buildPricingPost(
      {
        pricing_version: "v2026-04",
        effective_from: "2026-04-01T00:00:00Z",
        close_previous: false,
        rates: [
          {
            model_slug: "sonnet-4.6",
            input_per_mtoken: 3,
            output_per_mtoken: 15,
          },
          {
            model_slug: "sonnet-4.7",
            input_per_mtoken: 3,
            output_per_mtoken: 15,
          },
        ],
      },
      keyId,
      keypair,
    );

    expect(res.status).toBe(200);
    const body = await res.json<
      { pricing_version: string; effective_from: string; inserted: number }
    >();
    expect(body.inserted).toBe(2);

    // v2026-03 rows should still be open
    const oldRows = await env.DB.prepare(
      `SELECT effective_until FROM cost_snapshots WHERE pricing_version = 'v2026-03'`,
    ).all<{ effective_until: string | null }>();
    expect(oldRows.results.every((r) => r.effective_until === null)).toBe(true);
  });

  it("duplicate pricing_version for same model returns 409", async () => {
    const { keyId, keypair } = await registerMachineKey(
      "admin-machine",
      "admin",
    );

    const res = await buildPricingPost(
      {
        pricing_version: "v2026-03",
        effective_from: "2026-03-01T00:00:00Z",
        rates: [{
          model_slug: "sonnet-4.6",
          input_per_mtoken: 3,
          output_per_mtoken: 15,
        }],
      },
      keyId,
      keypair,
    );

    expect(res.status).toBe(409);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe("duplicate");
  });

  it("non-admin scope returns 403", async () => {
    const { keyId, keypair } = await registerMachineKey(
      "verifier-machine",
      "verifier",
    );

    const res = await buildPricingPost(
      {
        pricing_version: "v2026-04",
        effective_from: "2026-04-01T00:00:00Z",
        rates: [{
          model_slug: "sonnet-4.6",
          input_per_mtoken: 3,
          output_per_mtoken: 15,
        }],
      },
      keyId,
      keypair,
    );

    expect(res.status).toBe(403);
  });

  it("unknown model_slug returns 404 model_not_found", async () => {
    const { keyId, keypair } = await registerMachineKey(
      "admin-machine",
      "admin",
    );

    const res = await buildPricingPost(
      {
        pricing_version: "v2026-04",
        effective_from: "2026-04-01T00:00:00Z",
        rates: [{
          model_slug: "does-not-exist",
          input_per_mtoken: 3,
          output_per_mtoken: 15,
        }],
      },
      keyId,
      keypair,
    );

    expect(res.status).toBe(404);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe("model_not_found");
    expect(body.error).toContain("does-not-exist");
  });

  it("empty rates returns 400 no_rates", async () => {
    const { keyId, keypair } = await registerMachineKey(
      "admin-machine",
      "admin",
    );

    const res = await buildPricingPost(
      {
        pricing_version: "v2026-04",
        effective_from: "2026-04-01T00:00:00Z",
        rates: [],
      },
      keyId,
      keypair,
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe("no_rates");
  });

  it("malformed JSON body returns 400 bad_request", async () => {
    const res = await SELF.fetch("http://x/api/v1/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe("bad_request");
  });

  it("close_previous scopes only to upserted models, leaves others open", async () => {
    const { keyId, keypair } = await registerMachineKey(
      "admin-machine",
      "admin",
    );

    // POST v2026-04 with close_previous: true but ONLY rates for sonnet-4.7
    const res = await buildPricingPost(
      {
        pricing_version: "v2026-04",
        effective_from: "2026-04-01T00:00:00Z",
        close_previous: true,
        rates: [
          {
            model_slug: "sonnet-4.7",
            input_per_mtoken: 3,
            output_per_mtoken: 15,
          },
        ],
      },
      keyId,
      keypair,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ inserted: number }>();
    expect(body.inserted).toBe(1);

    // sonnet-4.7's v2026-03 row should be closed
    const closedRow = await env.DB.prepare(
      `SELECT effective_until FROM cost_snapshots WHERE pricing_version = 'v2026-03' AND model_id = 2`,
    ).first<{ effective_until: string | null }>();
    expect(closedRow?.effective_until).toBe("2026-04-01T00:00:00Z");

    // sonnet-4.6's v2026-03 row should still be open (not in the rates array)
    const openRow = await env.DB.prepare(
      `SELECT effective_until FROM cost_snapshots WHERE pricing_version = 'v2026-03' AND model_id = 1`,
    ).first<{ effective_until: string | null }>();
    expect(openRow?.effective_until).toBeNull();
  });

  it("missing signature block returns 400 missing_signature", async () => {
    const res = await SELF.fetch("http://x/api/v1/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payload: {
          pricing_version: "v2026-04",
          effective_from: "2026-04-01T00:00:00Z",
          rates: [{
            model_slug: "sonnet-4.6",
            input_per_mtoken: 3,
            output_per_mtoken: 15,
          }],
        },
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe("missing_signature");
  });

  it("non-object payload returns 400 bad_payload", async () => {
    const res = await SELF.fetch("http://x/api/v1/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signature: {
          alg: "Ed25519",
          key_id: 1,
          signed_at: "2026-04-01T00:00:00Z",
          value: "stub",
        },
        payload: "not an object",
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe("bad_payload");
  });
});
