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

describe("POST /api/v1/admin/catalog/task-sets — set_current flag", () => {
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

    // Seed two existing task_sets rows: "old" is current, "new" is not.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES (?, ?, ?, ?)`,
      ).bind("old", "2026-01-01T00:00:00Z", 5, 1),
      env.DB.prepare(
        `INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES (?, ?, ?, ?)`,
      ).bind("new", "2026-04-01T00:00:00Z", 7, 0),
    ]);
  });

  it("set_current=true atomically flips the current marker", async () => {
    const { signedRequest } = await signAsAdmin({
      hash: "new",
      created_at: "2026-04-01T00:00:00Z",
      task_count: 7,
      set_current: true,
    });
    const resp = await SELF.fetch("https://x/api/v1/admin/catalog/task-sets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(200);

    const oldRow = await env.DB.prepare(
      `SELECT is_current FROM task_sets WHERE hash = ?`,
    ).bind("old").first<{ is_current: number }>();
    const newRow = await env.DB.prepare(
      `SELECT is_current FROM task_sets WHERE hash = ?`,
    ).bind("new").first<{ is_current: number }>();
    expect(oldRow?.is_current).toBe(0);
    expect(newRow?.is_current).toBe(1);
  });

  it("set_current omitted preserves existing is_current values", async () => {
    const { signedRequest } = await signAsAdmin({
      hash: "new",
      created_at: "2026-04-01T00:00:00Z",
      task_count: 7,
    });
    const resp = await SELF.fetch("https://x/api/v1/admin/catalog/task-sets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(200);

    const oldRow = await env.DB.prepare(
      `SELECT is_current FROM task_sets WHERE hash = ?`,
    ).bind("old").first<{ is_current: number }>();
    const newRow = await env.DB.prepare(
      `SELECT is_current FROM task_sets WHERE hash = ?`,
    ).bind("new").first<{ is_current: number }>();
    expect(oldRow?.is_current).toBe(1);
    expect(newRow?.is_current).toBe(0);
  });

  it("rejects non-admin (ingest-scope) keys with 403 insufficient_scope", async () => {
    const { keyId: ingestKeyId, keypair: ingestKeypair } =
      await registerMachineKey("ingest-attacker", "ingest");
    const { signedRequest } = await createSignedPayload(
      {
        hash: "new",
        created_at: "2026-04-01T00:00:00Z",
        task_count: 7,
        set_current: true,
      } as Record<string, unknown>,
      ingestKeyId,
      undefined,
      ingestKeypair,
    );
    const resp = await SELF.fetch("https://x/api/v1/admin/catalog/task-sets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(403);

    // Verify the seeded state was not modified
    const oldRow = await env.DB.prepare(
      `SELECT is_current FROM task_sets WHERE hash = ?`,
    ).bind("old").first<{ is_current: number }>();
    const newRow = await env.DB.prepare(
      `SELECT is_current FROM task_sets WHERE hash = ?`,
    ).bind("new").first<{ is_current: number }>();
    expect(oldRow?.is_current).toBe(1);
    expect(newRow?.is_current).toBe(0);
  });
});
