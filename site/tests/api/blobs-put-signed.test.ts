import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import * as ed from "@noble/ed25519";
import { canonicalJSON } from "../../src/lib/shared/canonical";

describe("PUT /api/v1/blobs/:sha256 — signed auth", () => {
  let privKey: Uint8Array;
  let pubKey: Uint8Array;
  let keyId: number;

  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    privKey = ed.utils.randomSecretKey();
    pubKey = await ed.getPublicKeyAsync(privKey);
    const insertKey = await env.DB.prepare(
      `INSERT INTO machine_keys(machine_id, public_key, scope, created_at)
       VALUES (?, ?, 'ingest', ?) RETURNING id`,
    )
      .bind("test-ingest", pubKey, new Date().toISOString())
      .first<{ id: number }>();
    keyId = insertKey!.id;
  });

  it("rejects unsigned PUT with 401", async () => {
    const body = new TextEncoder().encode("hello");
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const resp = await SELF.fetch(`https://x/api/v1/blobs/${hash}`, {
      method: "PUT",
      body,
    });
    expect(resp.status).toBe(401);
  });

  it("accepts signed PUT and stores blob", async () => {
    const body = new TextEncoder().encode("hello signed");
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const signedAt = new Date().toISOString();
    const canonical = canonicalJSON({
      method: "PUT",
      path: `/api/v1/blobs/${hash}`,
      body_sha256: hash,
      signed_at: signedAt,
    });
    const sig = await ed.signAsync(
      new TextEncoder().encode(canonical),
      privKey,
    );
    const sigB64 = btoa(String.fromCharCode(...sig));
    const resp = await SELF.fetch(`https://x/api/v1/blobs/${hash}`, {
      method: "PUT",
      headers: {
        "X-CG-Signature": sigB64,
        "X-CG-Key-Id": String(keyId),
        "X-CG-Signed-At": signedAt,
      },
      body,
    });
    expect(resp.status).toBe(201);
  });
});
