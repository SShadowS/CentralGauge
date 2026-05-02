/**
 * Plan F / Wave 5 quality review — IMPORTANT 5 regression coverage.
 *
 * PUT /api/v1/admin/lifecycle/r2/<key> previously read up to
 * MAX_BODY_BYTES (50 MB) from the request body BEFORE running the auth
 * check. The Ed25519 path needs the body bytes (signature is hash-bound
 * to the body), but the CF Access path doesn't — JWT validation is
 * body-independent.
 *
 * Pre-fix DoS: an attacker who could fabricate a CF Access JWT header
 * (even a malformed one) could still get the worker to materialize
 * ~50 MB per request before the auth gate fired.
 *
 * Fix: when the cf-access-jwt-assertion header is present, authenticate
 * FIRST, then read the body. When it's absent, fall through to the
 * Ed25519 path (body-first — required for the hash-binding).
 *
 * Test strategy: send a PUT with a malformed CF Access JWT and a body
 * stream whose `pull` callback records read attempts. Post-fix the
 * worker rejects on the JWT before invoking pull at all (or at most
 * once if the runtime opportunistically pre-fetches one chunk).
 * Pre-fix the worker pulled the body fully (50 MB cap) BEFORE the auth
 * gate, so `pull` would have been invoked many times.
 */
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

describe("IMPORTANT 5 — PUT /r2 defers body buffering past CF Access auth check", () => {
  it("CF Access path with malformed JWT auth-rejects WITHOUT pulling the body", async () => {
    // Counter that records how many times the worker tried to pull a
    // chunk from the body stream. Post-fix this is 0 because the auth
    // gate fires before readBodyWithCap. Pre-fix this would be ~N where
    // N = chunks needed to fill 50 MB or until the stream completes.
    let pullCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        // Make the stream LOOK like it has lots of data: enqueue a chunk
        // each pull. Cap at 1024 chunks just to bound the test if the
        // bug were still present (don't actually want to OOM the runtime).
        if (pullCount > 1024) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(64 * 1024)); // 64 KiB
      },
    });
    const r = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/r2/lifecycle/m/h/x.bin",
      {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          "cf-access-jwt-assertion": "eyJhbGciOiJSUzI1NiJ9.bogus.bogus",
        },
        body: stream,
        // @ts-ignore — required by undici when sending a stream body.
        duplex: "half",
      } as RequestInit,
    );
    // Auth verdict: 401 cf_access_* (verifier rejected) or 500
    // cf_access_misconfigured (CF_ACCESS_AUD unset under vitest). Both
    // mean the auth gate fired.
    expect([401, 500]).toContain(r.status);
    const body = (await r.json()) as { code: string };
    expect(body.code).toMatch(/^cf_access_/);
    // The key invariant: body was NOT pulled before auth. Allow a small
    // grace (some runtimes opportunistically pre-fetch one chunk on
    // request construction); the pre-fix bug would have pulled until
    // the cap or stream end (~800 chunks at 64 KiB each = 50 MB).
    expect(pullCount).toBeLessThanOrEqual(2);
  });

  it("Ed25519 path STILL reads body first (sig is hash-bound to body)", async () => {
    // Sanity check: the no-auth-headers path goes through
    // verifyLifecycleAdminRequest, which hashes the body into the
    // signed envelope. We pass a small body and assert 401 unauthenticated
    // — proving the path still works after the I5 refactor.
    const r = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/r2/lifecycle/m/h/x.bin",
      {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array(8),
      },
    );
    expect(r.status).toBe(401);
    const body = (await r.json()) as { code: string };
    expect(body.code).toBe("unauthenticated");
  });
});
