import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

/**
 * P6 A7 — canary scope leak fix integration tests.
 *
 * The exhaustive transform behavior (quote styles, regex meta-chars, edge
 * cases, etc.) is covered by `src/lib/server/canary-scope.test.ts`
 * (16 unit tests). This file verifies the wiring: proxy invokes the
 * transforms without crashing, canary chrome remains intact, X-Canary
 * header propagates.
 *
 * Note: /health is a JSON endpoint (no <head> to inject <base> into), so
 * the transforms become a no-op on that body — but the canary chrome
 * around the iframe must still render correctly.
 */
describe("canary scope: proxy applies transforms without breaking chrome", () => {
  it("emits the X-Canary header", async () => {
    const res = await SELF.fetch("http://x/_canary/sha-test/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-canary")).toBe("1");
  });

  it("the canary chrome banner remains rendered", async () => {
    const res = await SELF.fetch("http://x/_canary/sha-test/health");
    const body = await res.text();
    expect(body).toContain("Canary build");
    expect(body).toContain("sha-test");
  });

  it("canary HTML contains an iframe (proxy contract preserved)", async () => {
    const res = await SELF.fetch("http://x/_canary/sha-test/health");
    const body = await res.text();
    expect(body).toContain("iframe");
  });

  it("non-canary route does not invoke the proxy or emit X-Canary", async () => {
    const res = await SELF.fetch("http://x/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-canary")).toBeNull();
  });
});
