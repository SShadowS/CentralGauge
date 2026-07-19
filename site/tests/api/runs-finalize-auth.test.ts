import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayloadV2 } from "../fixtures/keys";
import {
  makeRunPayload,
  registerIngestKey,
  seedMinimalRefData,
  signedRequestHeaders,
} from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";

/**
 * S3 — finalize auth with ownership. When X-CG-* signature headers are
 * present, finalize verifies them blob-auth-style (method + path +
 * body_sha256 + signed_at) AND requires the authenticated key to equal
 * runs.ingest_public_key_id. Unsigned finalize stays tolerated (and logged)
 * while FLAG_REQUIRE_SIGNED_FINALIZE !== "on".
 */

type MutableEnv = { FLAG_REQUIRE_SIGNED_FINALIZE?: string };

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
  await seedMinimalRefData();
  const reset = await SELF.fetch("http://x/api/v1/__test__/events/reset", {
    method: "POST",
    headers: { "x-test-only": "1" },
  });
  await reset.arrayBuffer();
});

afterEach(() => {
  delete (env as unknown as MutableEnv).FLAG_REQUIRE_SIGNED_FINALIZE;
});

/**
 * Ingest a blob-free run (no transcript/code/bundle hashes) so finalize can
 * flip it to completed without any R2 uploads.
 */
async function ingestBlobFreeRun(runId: string) {
  const { keyId, keypair } = await registerIngestKey();
  const base = makeRunPayload();
  const result = { ...base.results[0] } as Record<string, unknown>;
  delete result.transcript_sha256;
  delete result.code_sha256;
  const payload = {
    ...base,
    results: [result],
  } as unknown as Record<string, unknown>;
  delete payload.reproduction_bundle_sha256;

  const { signedRequest } = await createSignedPayloadV2(
    payload,
    runId,
    keyId,
    undefined,
    keypair,
  );
  const res = await SELF.fetch("http://x/api/v1/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signedRequest),
  });
  if (res.status !== 202) {
    throw new Error(`seed ingest failed: ${res.status} ${await res.text()}`);
  }
  await res.arrayBuffer();
  return { keyId, keypair, runId };
}

describe("POST /api/v1/runs/:id/finalize — signed path (S3)", () => {
  it("accepts a finalize signed by the run's own ingest key", async () => {
    const { keyId, keypair, runId } = await ingestBlobFreeRun("fin-own-key");
    const headers = await signedRequestHeaders(
      "POST",
      `/api/v1/runs/${runId}/finalize`,
      null,
      keyId,
      keypair,
    );
    const res = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, {
      method: "POST",
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string }>();
    expect(body.status).toBe("completed");
  });

  it("rejects a finalize signed by a different key (403 ownership)", async () => {
    const { runId } = await ingestBlobFreeRun("fin-wrong-key");
    const { keyId: otherKeyId, keypair: otherKeypair } =
      await registerIngestKey("other-machine");
    const headers = await signedRequestHeaders(
      "POST",
      `/api/v1/runs/${runId}/finalize`,
      null,
      otherKeyId,
      otherKeypair,
    );
    const res = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, {
      method: "POST",
      headers,
    });
    expect(res.status).toBe(403);

    const run = await env.DB.prepare(`SELECT status FROM runs WHERE id = ?`)
      .bind(runId).first<{ status: string }>();
    expect(run?.status).toBe("running");
  });

  it("rejects a signed finalize replayed outside the skew window", async () => {
    const { keyId, keypair, runId } = await ingestBlobFreeRun("fin-stale");
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const headers = await signedRequestHeaders(
      "POST",
      `/api/v1/runs/${runId}/finalize`,
      null,
      keyId,
      keypair,
      stale,
    );
    const res = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, {
      method: "POST",
      headers,
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe("clock_skew");
  });

  it("rejects a signature captured for a different run's finalize path", async () => {
    const { keyId, keypair } = await ingestBlobFreeRun("fin-path-a");
    await ingestBlobFreeRun("fin-path-b");
    // Signature for run A's path, replayed against run B — path is bound
    // into the signed bytes, so verification must fail.
    const headers = await signedRequestHeaders(
      "POST",
      `/api/v1/runs/fin-path-a/finalize`,
      null,
      keyId,
      keypair,
    );
    const res = await SELF.fetch(`http://x/api/v1/runs/fin-path-b/finalize`, {
      method: "POST",
      headers,
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/runs/:id/finalize — unsigned path (staged)", () => {
  it("tolerates unsigned finalize while FLAG_REQUIRE_SIGNED_FINALIZE is off", async () => {
    const { runId } = await ingestBlobFreeRun("fin-unsigned-ok");
    const res = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
  });

  it("rejects unsigned finalize when FLAG_REQUIRE_SIGNED_FINALIZE is on (401)", async () => {
    const { runId } = await ingestBlobFreeRun("fin-unsigned-rejected");
    (env as unknown as MutableEnv).FLAG_REQUIRE_SIGNED_FINALIZE = "on";
    const res = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, {
      method: "POST",
    });
    expect(res.status).toBe(401);

    const run = await env.DB.prepare(`SELECT status FROM runs WHERE id = ?`)
      .bind(runId).first<{ status: string }>();
    expect(run?.status).toBe("running");
  });

  it("still accepts a SIGNED finalize when the flag is on", async () => {
    const { keyId, keypair, runId } = await ingestBlobFreeRun(
      "fin-signed-flag-on",
    );
    (env as unknown as MutableEnv).FLAG_REQUIRE_SIGNED_FINALIZE = "on";
    const headers = await signedRequestHeaders(
      "POST",
      `/api/v1/runs/${runId}/finalize`,
      null,
      keyId,
      keypair,
    );
    const res = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, {
      method: "POST",
      headers,
    });
    expect(res.status).toBe(200);
  });
});
