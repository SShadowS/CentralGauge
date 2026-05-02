import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
});

describe("admin catalog endpoints", () => {
  let keyId: number;
  let keypair: Awaited<ReturnType<typeof registerMachineKey>>["keypair"];

  const signAsAdmin = (p: object) =>
    createSignedPayload(
      p as Record<string, unknown>,
      keyId,
      undefined,
      keypair,
    );

  beforeEach(async () => {
    ({ keyId, keypair } = await registerMachineKey("admin-test", "admin"));

    // ensure model family exists for model upsert test
    await env.DB.prepare(
      `INSERT OR IGNORE INTO model_families(slug, vendor, display_name) VALUES (?, ?, ?)`,
    ).bind("claude", "Anthropic", "Claude").run();
  });

  it("upserts a model", async () => {
    const { signedRequest } = await signAsAdmin({
      slug: "anthropic/claude-opus-test",
      api_model_id: "claude-opus-test-2026",
      family: "claude",
      display_name: "Claude Opus (Test)",
      generation: 99,
    });

    const resp = await SELF.fetch("https://x/api/v1/admin/catalog/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT display_name FROM models WHERE slug = ?`,
    ).bind("anthropic/claude-opus-test").first<{ display_name: string }>();
    expect(row?.display_name).toBe("Claude Opus (Test)");
  });

  it("upserts a task_set", async () => {
    const { signedRequest } = await signAsAdmin({
      hash: "h".repeat(64),
      created_at: new Date().toISOString(),
      task_count: 42,
    });

    const resp = await SELF.fetch("https://x/api/v1/admin/catalog/task-sets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT task_count FROM task_sets WHERE hash = ?`,
    ).bind("h".repeat(64)).first<{ task_count: number }>();
    expect(row?.task_count).toBe(42);
  });

  it("upserts a pricing row", async () => {
    // First insert the model that pricing references
    const { signedRequest: modelReq } = await signAsAdmin({
      slug: "anthropic/claude-opus-test",
      api_model_id: "claude-opus-test-2026",
      family: "claude",
      display_name: "Claude Opus (Test)",
      generation: 99,
    });
    await SELF.fetch("https://x/api/v1/admin/catalog/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(modelReq),
    });

    const { signedRequest } = await signAsAdmin({
      pricing_version: "test-2026-04-20",
      model_slug: "anthropic/claude-opus-test",
      input_per_mtoken: 15,
      output_per_mtoken: 75,
      cache_read_per_mtoken: 1.5,
      cache_write_per_mtoken: 18.75,
      effective_from: "2026-04-20T00:00:00Z",
      source: "anthropic-api",
      fetched_at: "2026-04-20T10:00:00Z",
    });

    const resp = await SELF.fetch("https://x/api/v1/admin/catalog/pricing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT input_per_mtoken, source FROM cost_snapshots WHERE pricing_version = ?`,
    ).bind("test-2026-04-20").first<
      { input_per_mtoken: number; source: string }
    >();
    expect(row?.input_per_mtoken).toBe(15);
    expect(row?.source).toBe("anthropic-api");
  });

  it("rejects ingest-scope key on admin endpoint (insufficient_scope)", async () => {
    const { keyId: ingestKeyId, keypair: ingestKeypair } =
      await registerMachineKey("ingest-attacker", "ingest");
    const { signedRequest } = await createSignedPayload(
      {
        slug: "x/y",
        api_model_id: "y",
        family: "claude",
        display_name: "Y",
      } as Record<string, unknown>,
      ingestKeyId,
      undefined,
      ingestKeypair,
    );
    const resp = await SELF.fetch("https://x/api/v1/admin/catalog/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(403);
    const json = await resp.json() as { code: string };
    expect(json.code).toBe("insufficient_scope");
  });

  it("returns 400 unknown_family for a model upsert with unknown family", async () => {
    const { signedRequest } = await signAsAdmin({
      slug: "x/unknown-fam-model",
      api_model_id: "unknown-fam-model-2026",
      family: "nonexistent-family-xyz",
      display_name: "Test Model",
    });
    const resp = await SELF.fetch("https://x/api/v1/admin/catalog/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(400);
    const json = await resp.json() as { code: string };
    expect(json.code).toBe("unknown_family");
  });

  it("returns 400 unknown_model for a pricing upsert with unknown model_slug", async () => {
    const { signedRequest } = await signAsAdmin({
      pricing_version: "v-unknown-model",
      model_slug: "nonexistent-model-xyz",
      input_per_mtoken: 1,
      output_per_mtoken: 2,
      effective_from: "2026-04-20T00:00:00Z",
      source: "manual",
    });
    const resp = await SELF.fetch("https://x/api/v1/admin/catalog/pricing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(400);
    const json = await resp.json() as { code: string };
    expect(json.code).toBe("unknown_model");
  });
});

describe("admin catalog — family_mismatch", () => {
  let keyId: number;
  let keypair: Awaited<ReturnType<typeof registerMachineKey>>["keypair"];

  const signAsAdmin = (p: object) =>
    createSignedPayload(
      p as Record<string, unknown>,
      keyId,
      undefined,
      keypair,
    );

  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  beforeEach(async () => {
    await resetDb();
    ({ keyId, keypair } = await registerMachineKey("admin-fam-test", "admin"));

    // Seed two families via DB (shared between test code and worker in this env)
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO model_families(slug, vendor, display_name) VALUES ('claude', 'Anthropic', 'Claude')`,
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO model_families(slug, vendor, display_name) VALUES ('openai', 'OpenAI', 'OpenAI')`,
      ),
    ]);
    // Seed the model via the API so the worker runtime state is consistent
    const { signedRequest: seedReq } = await signAsAdmin({
      slug: "anthropic/claude-x",
      api_model_id: "claude-x-2026",
      family: "claude",
      display_name: "Claude X",
    });
    const seedResp = await SELF.fetch("https://x/api/v1/admin/catalog/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(seedReq),
    });
    if (!seedResp.ok) {
      throw new Error(
        `Seed model failed: ${seedResp.status} ${await seedResp.text()}`,
      );
    }
  });

  it("returns 409 family_mismatch when re-posting a model under a different family", async () => {
    const { signedRequest } = await signAsAdmin({
      slug: "anthropic/claude-x",
      api_model_id: "claude-x-2026",
      family: "openai",
      display_name: "Claude X (wrong family)",
    });
    const resp = await SELF.fetch("https://x/api/v1/admin/catalog/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(409);
    const json = await resp.json() as { code: string };
    expect(json.code).toBe("family_mismatch");

    // Confirm DB still shows the original family
    const row = await env.DB.prepare(
      `SELECT f.slug AS family_slug FROM models m JOIN model_families f ON f.id = m.family_id WHERE m.slug = ?`,
    ).bind("anthropic/claude-x").first<{ family_slug: string }>();
    expect(row?.family_slug).toBe("claude");
  });
});
