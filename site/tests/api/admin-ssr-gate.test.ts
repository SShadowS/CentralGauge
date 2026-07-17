import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * S1 — end-to-end (built worker) check that hooks.server.ts gates /admin*
 * SSR pages. The vitest bindings intentionally do NOT set CF_ACCESS_AUD
 * (it is a wrangler secret in production), so the reachable assertions here
 * are the fail-closed paths:
 *   - no JWT → 403 before the page loader runs (no D1 leak)
 *   - JWT present but AUD unconfigured → 500 cf_access_misconfigured
 *     (missing secret is never a bypass)
 * The allow path is unit-tested in tests/server/admin-gate.test.ts where the
 * JWKs cache can be injected (module state is not shared with the built
 * bundle, so a valid-JWT SELF.fetch test is not possible here).
 */
describe("/admin SSR gate (S1)", () => {
  it("returns 403 for /admin/lifecycle without a CF Access JWT", async () => {
    const res = await SELF.fetch("http://x/admin/lifecycle");
    expect(res.status).toBe(403);
  });

  it("returns 403 for /admin/lifecycle/status without a JWT", async () => {
    const res = await SELF.fetch("http://x/admin/lifecycle/status");
    expect(res.status).toBe(403);
  });

  it("fails closed (500 misconfigured) when a JWT is present but CF_ACCESS_AUD is unset", async () => {
    const res = await SELF.fetch("http://x/admin/lifecycle", {
      headers: { "cf-access-jwt-assertion": "a.b.c" },
    });
    expect(res.status).toBe(500);
  });

  it("does not gate non-admin pages", async () => {
    const res = await SELF.fetch("http://x/api/v1/health");
    expect(res.status).not.toBe(403);
  });
});
