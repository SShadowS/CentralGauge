import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

/**
 * S4 — security regression, mirrors __test_only__-blocked-in-prod.test.ts:
 * the `/api/v1/__test__/events/reset` and `/recent` proxy routes MUST be
 * double-gated like their sibling `__test_only__/broadcast`:
 *   1. `env.ALLOW_TEST_BROADCAST === 'on'` (CI / test bindings only —
 *      NEVER in production wrangler.toml [vars]).
 *   2. Request header `x-test-only: 1`.
 * Either missing → 403. Pre-fix, only the header gated these routes, so a
 * production caller could wipe the live SSE buffer / read it at will.
 *
 * The vitest bindings set ALLOW_TEST_BROADCAST=on (the SSE-drain hooks in
 * runs-finalize / full-ingest / task-sets-promote need the routes working);
 * each test here manages the var explicitly and restores in afterEach.
 */

type MutableEnv = { ALLOW_TEST_BROADCAST?: string };

describe("__test__/events routes are env-gated (S4)", () => {
  afterEach(() => {
    (env as unknown as MutableEnv).ALLOW_TEST_BROADCAST = "on";
  });

  it("reset returns 403 when ALLOW_TEST_BROADCAST env is absent (prod path)", async () => {
    delete (env as unknown as MutableEnv).ALLOW_TEST_BROADCAST;
    const res = await SELF.fetch("http://x/api/v1/__test__/events/reset", {
      method: "POST",
      headers: { "x-test-only": "1" },
    });
    expect(res.status).toBe(403);
  });

  it("recent returns 403 when ALLOW_TEST_BROADCAST env is absent (prod path)", async () => {
    delete (env as unknown as MutableEnv).ALLOW_TEST_BROADCAST;
    const res = await SELF.fetch(
      "http://x/api/v1/__test__/events/recent?limit=5",
      { headers: { "x-test-only": "1" } },
    );
    expect(res.status).toBe(403);
  });

  it("reset returns 403 when x-test-only header is absent (env on)", async () => {
    (env as unknown as MutableEnv).ALLOW_TEST_BROADCAST = "on";
    const res = await SELF.fetch("http://x/api/v1/__test__/events/reset", {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  it("recent returns 403 when x-test-only header is absent (env on)", async () => {
    (env as unknown as MutableEnv).ALLOW_TEST_BROADCAST = "on";
    const res = await SELF.fetch(
      "http://x/api/v1/__test__/events/recent?limit=5",
    );
    expect(res.status).toBe(403);
  });

  it("both routes work when both gates pass", async () => {
    (env as unknown as MutableEnv).ALLOW_TEST_BROADCAST = "on";
    const reset = await SELF.fetch("http://x/api/v1/__test__/events/reset", {
      method: "POST",
      headers: { "x-test-only": "1" },
    });
    expect(reset.status).toBe(200);
    await reset.arrayBuffer();

    const recent = await SELF.fetch(
      "http://x/api/v1/__test__/events/recent?limit=5",
      { headers: { "x-test-only": "1" } },
    );
    expect(recent.status).toBe(200);
    const body = await recent.json<{ events: unknown[] }>();
    expect(Array.isArray(body.events)).toBe(true);
  });
});
