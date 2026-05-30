import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";

const ENDPOINT = "https://x/api/v1/admin/catalog/task-taxonomy";
const TASK_SET_HASH = "a".repeat(64);

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
});

describe("admin task-taxonomy endpoint", () => {
  let keyId: number;
  let keypair: Awaited<ReturnType<typeof registerMachineKey>>["keypair"];

  const signAsAdmin = (p: object) =>
    createSignedPayload(p as Record<string, unknown>, keyId, undefined, keypair);

  beforeEach(async () => {
    ({ keyId, keypair } = await registerMachineKey("tax-admin-test", "admin"));

    // Seed a current task_set with 2 tasks
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES (?, ?, ?, 1)`,
      ).bind(TASK_SET_HASH, "2026-05-01T00:00:00Z", 2),
      env.DB.prepare(
        `INSERT INTO tasks(task_set_hash, task_id, content_hash, difficulty, manifest_json) VALUES (?, ?, ?, ?, ?)`,
      ).bind(TASK_SET_HASH, "t1", "ch1", "easy", "{}"),
      env.DB.prepare(
        `INSERT INTO tasks(task_set_hash, task_id, content_hash, difficulty, manifest_json) VALUES (?, ?, ?, ?, ?)`,
      ).bind(TASK_SET_HASH, "t2", "ch2", "medium", "{}"),
    ]);
  });

  it("applies a taxonomy to the current set and returns counts", async () => {
    const { signedRequest } = await signAsAdmin({
      groups: [{ slug: "data-modeling", name: "Data Modeling", description: "d" }],
      tags: [{ slug: "table" }, { slug: "keys" }],
      tasks: {
        t1: { group: "data-modeling", tags: ["table", "keys"] },
        t2: { group: "data-modeling", tags: ["table"] },
      },
    });

    const res = await SELF.fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      hash: string;
      groups: number;
      tags: number;
      tasks: number;
    };
    expect(body.hash).toBe(TASK_SET_HASH);
    expect(body.groups).toBe(1);
    expect(body.tags).toBe(2);
    expect(body.tasks).toBe(2);

    // Verify the group was written: task t1 should now have a category_id
    const catRow = await env.DB.prepare(
      `SELECT tc.slug FROM tasks t
         JOIN task_categories tc ON tc.id = t.category_id
        WHERE t.task_set_hash = ? AND t.task_id = ?`,
    ).bind(TASK_SET_HASH, "t1").first<{ slug: string }>();
    expect(catRow?.slug).toBe("data-modeling");

    // Verify task_tags: t1 should have 2 tags, t2 should have 1
    const t1Tags = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM task_tags WHERE task_set_hash = ? AND task_id = ?`,
    ).bind(TASK_SET_HASH, "t1").first<{ n: number }>();
    expect(t1Tags?.n).toBe(2);

    const t2Tags = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM task_tags WHERE task_set_hash = ? AND task_id = ?`,
    ).bind(TASK_SET_HASH, "t2").first<{ n: number }>();
    expect(t2Tags?.n).toBe(1);
  });

  it("accepts an explicit hash in the body (bypasses is_current lookup)", async () => {
    const explicitHash = "b".repeat(64);
    // Seed an extra task_set (not current) with one task
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES (?, ?, ?, 0)`,
      ).bind(explicitHash, "2026-05-02T00:00:00Z", 1),
      env.DB.prepare(
        `INSERT INTO tasks(task_set_hash, task_id, content_hash, difficulty, manifest_json) VALUES (?, ?, ?, ?, ?)`,
      ).bind(explicitHash, "tx", "chx", "hard", "{}"),
    ]);

    const { signedRequest } = await signAsAdmin({
      hash: explicitHash,
      groups: [{ slug: "logic", name: "Logic" }],
      tags: [],
      tasks: { tx: { group: "logic", tags: [] } },
    });

    const res = await SELF.fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(res.status).toBe(200);

    const body = await res.json() as { hash: string };
    expect(body.hash).toBe(explicitHash);
  });

  it("is idempotent: posting the same taxonomy twice succeeds both times", async () => {
    const taxonomy = {
      groups: [{ slug: "g1", name: "G1" }],
      tags: [{ slug: "tag1" }],
      tasks: { t1: { group: "g1", tags: ["tag1"] } },
    };

    for (let i = 0; i < 2; i++) {
      const { signedRequest } = await signAsAdmin(taxonomy);
      const res = await SELF.fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      });
      expect(res.status).toBe(200);
    }

    // Only one task_tags row should exist after the second idempotent apply
    const tagCount = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM task_tags WHERE task_set_hash = ? AND task_id = ?`,
    ).bind(TASK_SET_HASH, "t1").first<{ n: number }>();
    expect(tagCount?.n).toBe(1);
  });

  it("returns 400 when groups is missing", async () => {
    const { signedRequest } = await signAsAdmin({
      tags: [],
      tasks: {},
    });
    const res = await SELF.fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("missing_field");
  });

  it("returns 400 when no current task_set exists and no hash provided", async () => {
    // Remove the current flag from all task_sets
    await env.DB.prepare(`UPDATE task_sets SET is_current = 0`).run();

    const { signedRequest } = await signAsAdmin({
      groups: [],
      tags: [],
      tasks: {},
    });
    const res = await SELF.fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("no_current_task_set");
  });

  it("rejects an ingest-scope key (insufficient_scope)", async () => {
    const { keyId: ingestKeyId, keypair: ingestKeypair } =
      await registerMachineKey("tax-ingest-attacker", "ingest");
    const { signedRequest } = await createSignedPayload(
      { groups: [], tags: [], tasks: {} } as Record<string, unknown>,
      ingestKeyId,
      undefined,
      ingestKeypair,
    );
    const res = await SELF.fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("insufficient_scope");
  });

  it("rejects a request with no signature at all (missing version/bad json)", async () => {
    const res = await SELF.fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: { groups: [], tags: [], tasks: {} } }),
    });
    // version check fires first → 400, or key lookup fails → 401
    expect([400, 401]).toContain(res.status);
  });
});
