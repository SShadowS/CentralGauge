import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /sitemap.xml", () => {
  it("returns 200 with application/xml content-type", async () => {
    const res = await SELF.fetch("http://x/sitemap.xml");
    expect(res.status).toBe(200);
    // Cloudflare may serve as `application/xml`, `text/xml`, or
    // `application/xml; charset=utf-8`. Accept any of the three.
    const ct = res.headers.get("content-type") ?? "";
    expect(/xml/i.test(ct)).toBe(true);
  });

  it("contains the canonical homepage <loc>", async () => {
    const res = await SELF.fetch("http://x/sitemap.xml");
    const body = await res.text();
    expect(body).toContain(
      "<loc>https://centralgauge.sshadows.workers.dev/</loc>",
    );
  });

  it("lists the 8 known cross-cut routes", async () => {
    const res = await SELF.fetch("http://x/sitemap.xml");
    const body = await res.text();
    for (
      const route of [
        "/about",
        "/compare",
        "/families",
        "/limitations",
        "/models",
        "/runs",
        "/search",
        "/tasks",
      ]
    ) {
      expect(body).toContain(
        `<loc>https://centralgauge.sshadows.workers.dev${route}</loc>`,
      );
    }
  });

  it("does NOT list /leaderboard", async () => {
    const res = await SELF.fetch("http://x/sitemap.xml");
    const body = await res.text();
    expect(body).not.toContain("/leaderboard");
  });

  it("declares sitemaps.org 0.9 schema", async () => {
    const res = await SELF.fetch("http://x/sitemap.xml");
    const body = await res.text();
    expect(body).toContain(
      'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    );
  });
});
