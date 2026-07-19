import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as ed from "@noble/ed25519";
import { canonicalJSON } from "../../src/lib/shared/canonical";
import { bytesToB64 } from "../../src/lib/shared/base64";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";
import type { Keypair } from "../../src/lib/shared/ed25519";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

/**
 * V7 — lifecycle nonce with real replay prevention. When the client sends
 * `X-CG-Nonce`, the nonce is folded into the signed bytes AND recorded in
 * `lifecycle_nonces`; a second request carrying the same nonce is rejected
 * with 409 nonce_replayed even inside the signed_at skew window. Nonce-less
 * requests stay accepted (staged rollout — old CLIs don't send one).
 */
async function signLifecycleWithNonce(
  keypair: Keypair,
  keyId: number,
  args: {
    method: "GET" | "PUT" | "POST";
    path: string;
    query?: Record<string, string>;
    nonce?: string;
    signedAt?: string;
  },
): Promise<Record<string, string>> {
  const signedAt = args.signedAt ?? new Date().toISOString();
  const fields: Record<string, unknown> = {
    method: args.method,
    path: args.path,
    query: args.query ?? {},
    body_sha256: "",
    signed_at: signedAt,
  };
  if (args.nonce) fields.nonce = args.nonce;
  const canonical = canonicalJSON(fields);
  const sig = await ed.signAsync(
    new TextEncoder().encode(canonical),
    keypair.privateKey,
  );
  const headers: Record<string, string> = {
    "X-CG-Signature": bytesToB64(sig),
    "X-CG-Key-Id": String(keyId),
    "X-CG-Signed-At": signedAt,
  };
  if (args.nonce) headers["X-CG-Nonce"] = args.nonce;
  return headers;
}

const PATH = "/api/v1/admin/lifecycle/events";

describe("lifecycle nonce replay prevention (V7)", () => {
  it("accepts a nonce-bearing signed request and records the nonce", async () => {
    const { keyId, keypair } = await registerMachineKey("nonce-cli-a", "admin");
    const nonce = crypto.randomUUID();
    const headers = await signLifecycleWithNonce(keypair, keyId, {
      method: "GET",
      path: PATH,
      query: { model: "m/nonce-a" },
      nonce,
    });
    const res = await SELF.fetch(`https://x${PATH}?model=m/nonce-a`, {
      headers,
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT nonce FROM lifecycle_nonces WHERE nonce = ?`,
    ).bind(nonce).first<{ nonce: string }>();
    expect(row?.nonce).toBe(nonce);
  });

  it("rejects a replayed nonce with 409", async () => {
    const { keyId, keypair } = await registerMachineKey("nonce-cli-b", "admin");
    const nonce = crypto.randomUUID();
    const headers = await signLifecycleWithNonce(keypair, keyId, {
      method: "GET",
      path: PATH,
      query: { model: "m/nonce-b" },
      nonce,
    });
    const first = await SELF.fetch(`https://x${PATH}?model=m/nonce-b`, {
      headers,
    });
    expect(first.status).toBe(200);
    await first.arrayBuffer();

    const replay = await SELF.fetch(`https://x${PATH}?model=m/nonce-b`, {
      headers,
    });
    expect(replay.status).toBe(409);
    const body = await replay.json<{ code: string }>();
    expect(body.code).toBe("nonce_replayed");
  });

  it("rejects a request whose nonce header was swapped after signing (401)", async () => {
    const { keyId, keypair } = await registerMachineKey("nonce-cli-c", "admin");
    const headers = await signLifecycleWithNonce(keypair, keyId, {
      method: "GET",
      path: PATH,
      query: { model: "m/nonce-c" },
      nonce: crypto.randomUUID(),
    });
    // Attacker swaps the nonce header to dodge the replay table — the nonce
    // is folded into the signed bytes, so verification must fail.
    headers["X-CG-Nonce"] = crypto.randomUUID();
    const res = await SELF.fetch(`https://x${PATH}?model=m/nonce-c`, {
      headers,
    });
    expect(res.status).toBe(401);
  });

  it("still accepts nonce-less signed requests (tolerant stage)", async () => {
    const { keyId, keypair } = await registerMachineKey("nonce-cli-d", "admin");
    const headers = await signLifecycleWithNonce(keypair, keyId, {
      method: "GET",
      path: PATH,
      query: { model: "m/nonce-d" },
    });
    const res = await SELF.fetch(`https://x${PATH}?model=m/nonce-d`, {
      headers,
    });
    expect(res.status).toBe(200);
  });

  it("cleans up nonces older than 2x the skew window on insert", async () => {
    const { keyId, keypair } = await registerMachineKey("nonce-cli-e", "admin");
    const staleNonce = "stale-nonce-1";
    // 2x skew = 20 min; seed a 30-min-old row.
    await env.DB.prepare(
      `INSERT INTO lifecycle_nonces(nonce, seen_at) VALUES (?, ?)`,
    ).bind(staleNonce, Date.now() - 30 * 60 * 1000).run();

    const headers = await signLifecycleWithNonce(keypair, keyId, {
      method: "GET",
      path: PATH,
      query: { model: "m/nonce-e" },
      nonce: crypto.randomUUID(),
    });
    const res = await SELF.fetch(`https://x${PATH}?model=m/nonce-e`, {
      headers,
    });
    expect(res.status).toBe(200);
    await res.arrayBuffer();

    const stale = await env.DB.prepare(
      `SELECT nonce FROM lifecycle_nonces WHERE nonce = ?`,
    ).bind(staleNonce).first();
    expect(stale).toBeNull();
  });
});
