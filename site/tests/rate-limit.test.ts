import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// Choose a target endpoint that:
//   1. Is a write method (so the rate-limit middleware actually fires).
//   2. Errors fast WITHOUT touching D1, R2, or signature verification.
// `PUT /api/v1/blobs/<bad-key>` matches: the route handler validates the
// path parameter against /^[a-f0-9]{64}$/ and returns 400 immediately, so
// each request is essentially "rate-limit middleware + a regex check".
// The test only asserts on `res.status`, so a 400 is fine as long as it
// is NOT 429.
//
// NOTE on content-type: requests MUST use a non-form content-type
// (here: application/octet-stream). SvelteKit's built-in CSRF check
// short-circuits cross-origin writes with form-like content types
// (text/plain, multipart/form-data, application/x-www-form-urlencoded)
// by returning 403 *before* hooks run. An empty string body defaults
// to text/plain, which would never reach our rate limiter.
const FAST_PATH = "/api/v1/blobs/not-a-real-sha";

// Each `it()` uses a unique IP so the platform RL binding's per-key counter
// starts fresh — no inter-test cleanup required (and indeed not possible:
// the binding has no inspect/reset surface). Tests within one IP also do not
// need isolation because limits are designed to be cumulative.

describe("rate limiting", () => {
  it("allows bursts under the limit (50 PUTs in one window)", {
    timeout: 15_000,
  }, async () => {
    const ip = "10.0.0.1";
    for (let i = 0; i < 50; i++) {
      const res = await SELF.fetch(`http://x${FAST_PATH}`, {
        method: "PUT",
        headers: {
          "cf-connecting-ip": ip,
          "content-type": "application/octet-stream",
        },
        body: new Uint8Array([0]),
      });
      await res.arrayBuffer();
      expect(res.status).not.toBe(429);
    }
  });

  it("blocks the same IP after exceeding the rate-limit window", {
    timeout: 120_000,
  }, async () => {
    // Binding is `simple = { limit = 600, period = 60 }` (wrangler.toml).
    // Fire ABOVE_LIMIT requests in fully-concurrent Promise.all so the
    // test finishes in seconds even with a high cap. Concurrency does
    // not change the outcome — the binding counts requests, not load.
    // 750 keeps a 25% margin above the limit; the high timeout absorbs
    // the slow workerd test runtime on shared CI hosts.
    const ABOVE_LIMIT = 750;
    const ip = "10.0.0.2";
    const responses = await Promise.all(
      Array.from({ length: ABOVE_LIMIT }, () =>
        SELF.fetch(`http://x${FAST_PATH}`, {
          method: "PUT",
          headers: {
            "cf-connecting-ip": ip,
            "content-type": "application/octet-stream",
          },
          body: new Uint8Array([0]),
        })
      ),
    );
    let saw429 = false;
    let firstRetryAfter: string | null = null;
    let firstRemaining: string | null = null;
    for (const res of responses) {
      await res.arrayBuffer();
      if (res.status === 429 && !saw429) {
        firstRetryAfter = res.headers.get("retry-after");
        firstRemaining = res.headers.get("x-ratelimit-remaining");
        saw429 = true;
      }
    }
    expect(saw429).toBe(true);
    expect(firstRetryAfter).toBeTruthy();
    expect(firstRemaining).toBe("0");
  });

  it(
    "never throttles GETs from the same IP (100 GETs)",
    { timeout: 30_000 },
    async () => {
      // GETs are unmetered (writes-only policy). Use a known 400/404 GET
      // path so we don't pay DB cost: the same blobs route returns 400
      // for a malformed sha256 on GET as well.
      const ip = "10.0.0.3";
      const responses = await Promise.all(
        Array.from({ length: 100 }, () =>
          SELF.fetch(`http://x${FAST_PATH}`, {
            method: "GET",
            headers: { "cf-connecting-ip": ip },
          })
        ),
      );
      for (const res of responses) {
        await res.arrayBuffer();
        expect(res.status).not.toBe(429);
      }
    },
  );
});
