import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload, createSignedPayloadV2 } from "../fixtures/keys";
import {
  makeRunPayload,
  registerIngestKey,
  seedMinimalRefData,
} from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";

/**
 * S5 — v2 envelope: the Ed25519 signature covers run_id + signed_at.
 * T13 — machine_id binding: payload.machine_id must match the verified key.
 *
 * Staged rollout: v1 envelopes stay accepted (and logged) while
 * FLAG_REQUIRE_ENVELOPE_V2 !== "on". We mutate the env flag per test and
 * restore in afterEach (same pattern as __test_only__-blocked-in-prod).
 */

type MutableEnv = { FLAG_REQUIRE_ENVELOPE_V2?: string };

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
  await seedMinimalRefData();
});

afterEach(() => {
  delete (env as unknown as MutableEnv).FLAG_REQUIRE_ENVELOPE_V2;
});

function postRuns(body: unknown) {
  return SELF.fetch("http://x/api/v1/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postPrecheck(body: unknown) {
  return SELF.fetch("http://x/api/v1/runs/precheck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/runs — envelope v2 (S5)", () => {
  it("accepts a valid v2 envelope", async () => {
    const { keyId, keypair } = await registerIngestKey();
    const { signedRequest } = await createSignedPayloadV2(
      makeRunPayload() as unknown as Record<string, unknown>,
      "run-v2-ok",
      keyId,
      undefined,
      keypair,
    );
    const res = await postRuns(signedRequest);
    expect(res.status).toBe(202);
    const body = await res.json<{ run_id: string }>();
    expect(body.run_id).toBe("run-v2-ok");
  });

  it("rejects a v2 envelope with tampered run_id (401)", async () => {
    const { keyId, keypair } = await registerIngestKey();
    const { signedRequest } = await createSignedPayloadV2(
      makeRunPayload() as unknown as Record<string, unknown>,
      "run-v2-original",
      keyId,
      undefined,
      keypair,
    );
    signedRequest.run_id = "run-v2-tampered";
    const res = await postRuns(signedRequest);
    expect(res.status).toBe(401);
  });

  it("rejects a v2 envelope with tampered signed_at (401)", async () => {
    const { keyId, keypair } = await registerIngestKey();
    const { signedRequest } = await createSignedPayloadV2(
      makeRunPayload() as unknown as Record<string, unknown>,
      "run-v2-signedat",
      keyId,
      undefined,
      keypair,
    );
    // Fresh-but-different signed_at (still inside skew) — must break the sig.
    signedRequest.signature.signed_at = new Date(Date.now() + 1000)
      .toISOString();
    const res = await postRuns(signedRequest);
    expect(res.status).toBe(401);
  });

  it("rejects a replayed v2 body with a fresh run_id (401)", async () => {
    const { keyId, keypair } = await registerIngestKey();
    const { signedRequest } = await createSignedPayloadV2(
      makeRunPayload() as unknown as Record<string, unknown>,
      "run-v2-replay-1",
      keyId,
      undefined,
      keypair,
    );
    const first = await postRuns(signedRequest);
    expect(first.status).toBe(202);
    await first.arrayBuffer();

    // Attacker replays the captured body, swapping in a fresh run_id to
    // dodge server-side idempotency. v2 binds run_id → 401.
    const replay = { ...signedRequest, run_id: "run-v2-replay-2" };
    const res = await postRuns(replay);
    expect(res.status).toBe(401);
  });

  it("accepts v1 while FLAG_REQUIRE_ENVELOPE_V2 is off", async () => {
    const { keyId, keypair } = await registerIngestKey();
    const { signedRequest } = await createSignedPayload(
      makeRunPayload() as unknown as Record<string, unknown>,
      keyId,
      undefined,
      keypair,
    );
    signedRequest.run_id = "run-v1-tolerated";
    const res = await postRuns(signedRequest);
    expect(res.status).toBe(202);
  });

  it("rejects v1 when FLAG_REQUIRE_ENVELOPE_V2 is on", async () => {
    (env as unknown as MutableEnv).FLAG_REQUIRE_ENVELOPE_V2 = "on";
    const { keyId, keypair } = await registerIngestKey();
    const { signedRequest } = await createSignedPayload(
      makeRunPayload() as unknown as Record<string, unknown>,
      keyId,
      undefined,
      keypair,
    );
    signedRequest.run_id = "run-v1-rejected";
    const res = await postRuns(signedRequest);
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe("bad_version");
  });

  it("rejects unknown envelope versions (400)", async () => {
    const { keyId, keypair } = await registerIngestKey();
    const { signedRequest } = await createSignedPayload(
      makeRunPayload() as unknown as Record<string, unknown>,
      keyId,
      undefined,
      keypair,
    );
    const res = await postRuns({ ...signedRequest, version: 3 });
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe("bad_version");
  });
});

describe("POST /api/v1/runs/precheck — envelope v2 (S5)", () => {
  it("accepts a valid v2 envelope", async () => {
    const { keyId, keypair } = await registerIngestKey();
    const { signedRequest } = await createSignedPayloadV2(
      makeRunPayload() as unknown as Record<string, unknown>,
      "pre-v2-ok",
      keyId,
      undefined,
      keypair,
    );
    const res = await postPrecheck(signedRequest);
    expect(res.status).toBe(200);
    const body = await res.json<{ missing_blobs: string[] }>();
    expect(Array.isArray(body.missing_blobs)).toBe(true);
  });

  it("rejects a v2 envelope with tampered run_id (401)", async () => {
    const { keyId, keypair } = await registerIngestKey();
    const { signedRequest } = await createSignedPayloadV2(
      makeRunPayload() as unknown as Record<string, unknown>,
      "pre-v2-original",
      keyId,
      undefined,
      keypair,
    );
    signedRequest.run_id = "pre-v2-tampered";
    const res = await postPrecheck(signedRequest);
    expect(res.status).toBe(401);
  });

  it("accepts v1 while flag off, rejects v1 when flag on", async () => {
    const { keyId, keypair } = await registerIngestKey();
    const { signedRequest } = await createSignedPayload(
      makeRunPayload() as unknown as Record<string, unknown>,
      keyId,
      undefined,
      keypair,
    );
    signedRequest.run_id = "pre-v1";
    const ok = await postPrecheck(signedRequest);
    expect(ok.status).toBe(200);
    await ok.arrayBuffer();

    (env as unknown as MutableEnv).FLAG_REQUIRE_ENVELOPE_V2 = "on";
    const rejected = await postPrecheck(signedRequest);
    expect(rejected.status).toBe(400);
    const body = await rejected.json<{ code: string }>();
    expect(body.code).toBe("bad_version");
  });
});

describe("POST /api/v1/runs — machine_id binding (T13)", () => {
  it("rejects a payload whose machine_id differs from the verified key's", async () => {
    const { keyId, keypair } = await registerIngestKey("real-machine");
    const payload = makeRunPayload({ machine_id: "spoofed-machine" });
    const { signedRequest } = await createSignedPayloadV2(
      payload as unknown as Record<string, unknown>,
      "run-t13-mismatch",
      keyId,
      undefined,
      keypair,
    );
    const res = await postRuns(signedRequest);
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe("machine_id_mismatch");
    expect(body.error).toContain("spoofed-machine");
    expect(body.error).toContain("real-machine");
  });

  it("accepts a payload whose machine_id matches the verified key's", async () => {
    const { keyId, keypair } = await registerIngestKey("match-machine");
    const payload = makeRunPayload({ machine_id: "match-machine" });
    const { signedRequest } = await createSignedPayloadV2(
      payload as unknown as Record<string, unknown>,
      "run-t13-match",
      keyId,
      undefined,
      keypair,
    );
    const res = await postRuns(signedRequest);
    expect(res.status).toBe(202);
  });
});
