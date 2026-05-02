import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Security regression: the `/api/v1/__test_only__/broadcast` endpoint MUST
 * remain 403 in production (no `ALLOW_TEST_BROADCAST=on`) and MUST require
 * the `x-test-only: 1` header even when the env flag is on.
 *
 * The endpoint is double-gated specifically so that a leaked env var alone
 * is insufficient — an attacker would also need to know the static header
 * value. Both checks live here in one file so future regressions surface
 * as a tight diff.
 *
 * We mutate `env.ALLOW_TEST_BROADCAST` per test and restore in afterEach.
 * The vitest bindings (vitest.config.ts) intentionally do NOT set this
 * key, mirroring production.
 */

type MutableEnv = { ALLOW_TEST_BROADCAST?: string };

describe("__test_only__ broadcast endpoint security", () => {
  afterEach(() => {
    delete (env as unknown as MutableEnv).ALLOW_TEST_BROADCAST;
  });

  it("returns 403 when ALLOW_TEST_BROADCAST env is absent (prod path)", async () => {
    delete (env as unknown as MutableEnv).ALLOW_TEST_BROADCAST;
    const res = await SELF.fetch("http://x/api/v1/__test_only__/broadcast", {
      method: "POST",
      headers: { "x-test-only": "1", "content-type": "application/json" },
      body: JSON.stringify({ type: "ping", ts: "now" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 when x-test-only header is absent (env on)", async () => {
    (env as unknown as MutableEnv).ALLOW_TEST_BROADCAST = "on";
    const res = await SELF.fetch("http://x/api/v1/__test_only__/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" }, // missing x-test-only
      body: JSON.stringify({ type: "ping", ts: "now" }),
    });
    expect(res.status).toBe(403);
  });

  it("accepts when both gates pass", async () => {
    (env as unknown as MutableEnv).ALLOW_TEST_BROADCAST = "on";
    const res = await SELF.fetch("http://x/api/v1/__test_only__/broadcast", {
      method: "POST",
      headers: { "x-test-only": "1", "content-type": "application/json" },
      body: JSON.stringify({
        type: "run_finalized",
        ts: new Date().toISOString(),
        run_id: "r-test-h85",
        model_slug: "sonnet-4-7",
        family_slug: "claude",
      }),
    });
    // Real bindings include LEADERBOARD_BROADCASTER, so the call should
    // succeed (200) when both gates pass. 500 is acceptable if the DO is
    // unavailable in the test bindings; either way it is not a 403, which
    // proves the security gate passed.
    expect([200, 500]).toContain(res.status);
  });
});
