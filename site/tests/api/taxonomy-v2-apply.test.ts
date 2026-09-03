import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { HASH, seedSet, smallCatalog } from "../fixtures/taxonomy-v2";
import {
  catalogDigest,
  normalizeCatalog,
} from "../../src/lib/shared/taxonomy-schema";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
  await seedSet();
});

async function post(
  body: object,
  keyId: number,
  kp: Awaited<ReturnType<typeof registerMachineKey>>["keypair"],
) {
  // createSignedPayload's signedRequest carries `version: 1` by default —
  // spread it first so the trailing `version: 2` wins (ruling #2).
  const { signedRequest } = await createSignedPayload(
    body as Record<string, unknown>,
    keyId,
    undefined,
    kp,
  );
  return SELF.fetch("https://x/api/v1/admin/catalog/task-taxonomy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...signedRequest, version: 2 }),
  });
}

describe("POST task-taxonomy version 2", () => {
  it("requires a hash, validates, and activates with the CLI's digest", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    const cat = smallCatalog();
    const noHash = await post({ ...cat, version: 2 }, keyId, keypair);
    expect(noHash.status).toBe(400);
    // errorResponse's body is flat { error, code } — not { error: { code } }.
    expect(((await noHash.json()) as { code: string }).code).toBe(
      "hash_required",
    );
    const res = await post({ ...cat, version: 2, hash: HASH }, keyId, keypair);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      digest: string;
      status: string;
      tasks: number;
    };
    expect(body.status).toBe("activated");
    expect(body.tasks).toBe(5);
    expect(body.digest).toBe(await catalogDigest(normalizeCatalog(cat, HASH)));
  });

  it("refuses partial coverage and unresolved donors", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    const cat = smallCatalog();
    delete (cat.tasks as Record<string, unknown>)["t4"];
    const res = await post({ ...cat, version: 2, hash: HASH }, keyId, keypair);
    expect(res.status).toBe(400);
    const err = (await res.json()) as { code: string; error: string };
    expect(err.code).toBe("catalog_invalid");
    expect(err.error).toContain("coverage");
  });

  it("refuses a hash that is not current unless allow_non_current is set", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    await env.DB.prepare(`UPDATE task_sets SET is_current = 0`).run();
    const res = await post(
      { ...smallCatalog(), version: 2, hash: HASH },
      keyId,
      keypair,
    );
    expect(res.status).toBe(409);
    const ok = await post(
      { ...smallCatalog(), version: 2, hash: HASH, allow_non_current: true },
      keyId,
      keypair,
    );
    expect(ok.status).toBe(200);
  });

  it("refuses a well-formed hash with no matching task_sets row", async () => {
    const { keyId, keypair } = await registerMachineKey("root", "admin");
    const unknownHash = "b".repeat(64);
    const res = await post(
      { ...smallCatalog(), version: 2, hash: unknownHash },
      keyId,
      keypair,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unknown_task_set");
  });
});
