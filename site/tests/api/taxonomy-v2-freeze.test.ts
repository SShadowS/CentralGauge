import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

describe("v1 taxonomy writes after the first v2 activation", () => {
  it("are refused with 409 taxonomy_v1_frozen", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES (?, '2026-01-01T00:00:00Z', 0, 1)`,
      ).bind("a".repeat(64)),
      env.DB.prepare(
        `INSERT INTO taxonomy_revisions(id,task_set_hash,schema_version,digest,created_at,verified_at,applied_by,apply_signature) VALUES (1, ?, 2, 'd', 't', 't', 'm', 's')`,
      ).bind("a".repeat(64)),
      env.DB.prepare(
        `INSERT INTO taxonomy_active(task_set_hash,revision_id,activated_at) VALUES (?, 1, 't')`,
      ).bind("a".repeat(64)),
    ]);
    const { signedRequest } = await createSignedPayload(
      { groups: [], tags: [], tasks: {} },
      keyId,
      undefined,
      keypair,
    );
    const res = await SELF.fetch(
      "https://x/api/v1/admin/catalog/task-taxonomy",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // signedRequest.version is already 1 (createSignedPayload's
        // default); spread first so an explicit trailing `version: 1`
        // doesn't trip TS2783 ("specified more than once").
        body: JSON.stringify({ ...signedRequest, version: 1 }),
      },
    );
    expect(res.status).toBe(409);
    // errorResponse's real body shape is flat ({ error, code, details? }),
    // not { error: { code } } — see errors.ts / every other admin test in
    // this suite (e.g. admin-task-taxonomy.test.ts, admin-keys.test.ts).
    // Brief's test asserted `body.error.code`; adapted to match the actual
    // contract rather than changing errorResponse to fit the test.
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("taxonomy_v1_frozen");
  });

  it("still applies a version-1 taxonomy normally when no v2 revision is active", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES (?, '2026-01-01T00:00:00Z', 0, 1)`,
      ).bind("b".repeat(64)),
    ]);
    const { signedRequest } = await createSignedPayload(
      { groups: [], tags: [], tasks: {} },
      keyId,
      undefined,
      keypair,
    );
    const res = await SELF.fetch(
      "https://x/api/v1/admin/catalog/task-taxonomy",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...signedRequest, version: 1 }),
      },
    );
    expect(res.status).toBe(200);
  });

  it("returns 501 not_implemented for version 2 (Task 5 fills this in)", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    const { signedRequest } = await createSignedPayload(
      { groups: [], tags: [], tasks: {} },
      keyId,
      undefined,
      keypair,
    );
    const res = await SELF.fetch(
      "https://x/api/v1/admin/catalog/task-taxonomy",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...signedRequest, version: 2 }),
      },
    );
    expect(res.status).toBe(501);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_implemented");
  });

  it("rejects an unknown version with 400 bad_version", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    const { signedRequest } = await createSignedPayload(
      { groups: [], tags: [], tasks: {} },
      keyId,
      undefined,
      keypair,
    );
    const res = await SELF.fetch(
      "https://x/api/v1/admin/catalog/task-taxonomy",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...signedRequest, version: 3 }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("bad_version");
  });
});
