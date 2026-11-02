import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/** Same fail-closed contract as admin-ssr-gate.test.ts, for the submission review pages. */
describe("/admin/submissions SSR gate", () => {
  it("returns 403 for the list without a CF Access JWT", async () => {
    const res = await SELF.fetch("http://x/admin/submissions");
    expect(res.status).toBe(403);
  });

  it("returns 403 for a detail page without a CF Access JWT", async () => {
    const res = await SELF.fetch("http://x/admin/submissions/x");
    expect(res.status).toBe(403);
  });

  it("fails closed (500 misconfigured) when a JWT is present but CF_ACCESS_AUD is unset", async () => {
    const res = await SELF.fetch("http://x/admin/submissions", {
      headers: { "cf-access-jwt-assertion": "a.b.c" },
    });
    expect(res.status).toBe(500);
  });
});
