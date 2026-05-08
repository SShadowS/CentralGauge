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

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

async function seedTaskSet(hash: string, isCurrent = 0) {
  await env.DB.prepare(
    `INSERT INTO task_sets(hash, created_at, task_count, is_current)
     VALUES (?, ?, ?, ?)`,
  ).bind(hash, "2026-05-01T00:00:00Z", 1, isCurrent).run();
}

async function seedRunWithResult(opts: {
  runId: string;
  taskSetHash: string;
  modelId: number;
  settingsHash: string;
  keyId: number;
  transcriptKey?: string | null;
  codeKey?: string | null;
  reproductionKey?: string | null;
}) {
  await env.DB.prepare(
    `INSERT INTO settings_profiles(hash) VALUES (?)
     ON CONFLICT(hash) DO NOTHING`,
  ).bind(opts.settingsHash).run();

  await env.DB.prepare(
    `INSERT INTO runs(id, task_set_hash, model_id, settings_hash, machine_id,
                      started_at, status, pricing_version, ingest_signature,
                      ingest_signed_at, ingest_public_key_id, ingest_signed_payload,
                      reproduction_bundle_r2_key)
     VALUES (?, ?, ?, ?, 'm', '2026-05-01T00:00:00Z', 'completed', 'v', 'sig',
             '2026-05-01T00:00:00Z', ?, X'00', ?)`,
  ).bind(
    opts.runId,
    opts.taskSetHash,
    opts.modelId,
    opts.settingsHash,
    opts.keyId,
    opts.reproductionKey ?? null,
  ).run();

  await env.DB.prepare(
    `INSERT INTO results(run_id, task_id, attempt, passed, score,
                         compile_success, transcript_r2_key, code_r2_key)
     VALUES (?, 'easy/t', 1, 1, 100, 1, ?, ?)`,
  ).bind(
    opts.runId,
    opts.transcriptKey ?? null,
    opts.codeKey ?? null,
  ).run();
}

async function seedSupporting() {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO model_families(id, slug, vendor, display_name)
     VALUES (1, 'fam', 'v', 'Fam')`,
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO models(id, family_id, slug, api_model_id, display_name, generation)
     VALUES (1, 1, 'm1', 'm1', 'M1', 1),
            (2, 1, 'm2', 'm2', 'M2', 1)`,
  ).run();
}

describe("DELETE /api/v1/admin/catalog/task-sets/[hash]", () => {
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
    ({ keyId, keypair } = await registerMachineKey("admin-del", "admin"));
    await seedSupporting();
  });

  it("deletes a task_set with cascade and orphan blob cleanup", async () => {
    await seedTaskSet(HASH_A);
    await env.BLOBS.put("blobs/transcript-a", "t-a");
    await env.BLOBS.put("blobs/code-a", "c-a");
    await env.BLOBS.put("blobs/repro-a", "r-a");

    await seedRunWithResult({
      runId: "run-a-1",
      taskSetHash: HASH_A,
      modelId: 1,
      settingsHash: "set-a",
      keyId,
      transcriptKey: "blobs/transcript-a",
      codeKey: "blobs/code-a",
      reproductionKey: "blobs/repro-a",
    });

    const { signedRequest } = await signAsAdmin({ hash: HASH_A });

    const resp = await SELF.fetch(
      `https://x/api/v1/admin/catalog/task-sets/${HASH_A}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(200);
    const body = await resp.json() as {
      hash: string;
      deleted: Record<string, number>;
      blobs: { deleted: number; failed: number; candidates: number };
    };
    expect(body.hash).toBe(HASH_A);
    expect(body.deleted.task_sets).toBe(1);
    expect(body.deleted.runs).toBe(1);
    expect(body.deleted.results).toBe(1);
    expect(body.blobs.deleted).toBe(3);
    expect(body.blobs.failed).toBe(0);
    expect(body.blobs.candidates).toBe(3);

    const ts = await env.DB.prepare(
      `SELECT hash FROM task_sets WHERE hash = ?`,
    ).bind(HASH_A).first();
    expect(ts).toBeNull();

    const runs = await env.DB.prepare(
      `SELECT id FROM runs WHERE task_set_hash = ?`,
    ).bind(HASH_A).all();
    expect(runs.results).toHaveLength(0);

    const results = await env.DB.prepare(
      `SELECT id FROM results WHERE run_id = ?`,
    ).bind("run-a-1").all();
    expect(results.results).toHaveLength(0);

    expect(await env.BLOBS.get("blobs/transcript-a")).toBeNull();
    expect(await env.BLOBS.get("blobs/code-a")).toBeNull();
    expect(await env.BLOBS.get("blobs/repro-a")).toBeNull();
  });

  it("keeps blobs that are still referenced by other runs", async () => {
    await seedTaskSet(HASH_A);
    await seedTaskSet(HASH_B);
    await env.BLOBS.put("blobs/shared", "shared");
    await env.BLOBS.put("blobs/only-a", "only-a");

    await seedRunWithResult({
      runId: "run-a-1",
      taskSetHash: HASH_A,
      modelId: 1,
      settingsHash: "set-a",
      keyId,
      transcriptKey: "blobs/shared",
      codeKey: "blobs/only-a",
    });
    await seedRunWithResult({
      runId: "run-b-1",
      taskSetHash: HASH_B,
      modelId: 2,
      settingsHash: "set-b",
      keyId,
      transcriptKey: "blobs/shared",
      codeKey: null,
    });

    const { signedRequest } = await signAsAdmin({ hash: HASH_A });
    const resp = await SELF.fetch(
      `https://x/api/v1/admin/catalog/task-sets/${HASH_A}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(200);
    const body = await resp.json() as {
      blobs: { deleted: number; candidates: number };
    };
    expect(body.blobs.candidates).toBe(1);
    expect(body.blobs.deleted).toBe(1);

    expect(await env.BLOBS.get("blobs/shared")).not.toBeNull();
    expect(await env.BLOBS.get("blobs/only-a")).toBeNull();
  });

  it("returns 409 when deleting the current task_set", async () => {
    await seedTaskSet(HASH_A, 1);
    const { signedRequest } = await signAsAdmin({ hash: HASH_A });
    const resp = await SELF.fetch(
      `https://x/api/v1/admin/catalog/task-sets/${HASH_A}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(409);
    const body = await resp.json() as { code: string };
    expect(body.code).toBe("task_set_is_current");
  });

  it("returns 404 for unknown hash", async () => {
    const { signedRequest } = await signAsAdmin({ hash: HASH_A });
    const resp = await SELF.fetch(
      `https://x/api/v1/admin/catalog/task-sets/${HASH_A}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(404);
    const body = await resp.json() as { code: string };
    expect(body.code).toBe("task_set_not_found");
  });

  it("rejects URL/payload hash mismatch", async () => {
    await seedTaskSet(HASH_A);
    const { signedRequest } = await signAsAdmin({ hash: HASH_B });
    const resp = await SELF.fetch(
      `https://x/api/v1/admin/catalog/task-sets/${HASH_A}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(400);
    const body = await resp.json() as { code: string };
    expect(body.code).toBe("hash_mismatch");
  });

  it("rejects malformed hash in URL", async () => {
    const { signedRequest } = await signAsAdmin({ hash: "deadbeef" });
    const resp = await SELF.fetch(
      `https://x/api/v1/admin/catalog/task-sets/deadbeef`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(400);
    const body = await resp.json() as { code: string };
    expect(body.code).toBe("invalid_hash");
  });

  it("rejects ingest-scope key", async () => {
    await seedTaskSet(HASH_A);
    const { keyId: ingestKeyId, keypair: ingestKp } = await registerMachineKey(
      "ingest-attacker",
      "ingest",
    );
    const { signedRequest } = await createSignedPayload(
      { hash: HASH_A } as Record<string, unknown>,
      ingestKeyId,
      undefined,
      ingestKp,
    );
    const resp = await SELF.fetch(
      `https://x/api/v1/admin/catalog/task-sets/${HASH_A}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(403);
    const body = await resp.json() as { code: string };
    expect(body.code).toBe("insufficient_scope");
  });
});
