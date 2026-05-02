import { describe, expect, it } from "vitest";
import { BASE_URL, buildSitemap, SITEMAP_ROUTES } from "./build-sitemap";

describe("buildSitemap", () => {
  it("emits valid XML 1.0 declaration", () => {
    const xml = buildSitemap();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it("uses sitemaps.org schema namespace", () => {
    const xml = buildSitemap();
    expect(xml).toContain(
      'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    );
  });

  it("contains a <url><loc> entry for every SITEMAP_ROUTES path", () => {
    const xml = buildSitemap();
    for (const route of SITEMAP_ROUTES) {
      const expected = `<loc>${BASE_URL}${route === "/" ? "/" : route}</loc>`;
      expect(xml).toContain(expected);
    }
  });

  it("emits the homepage with explicit trailing slash to match canonical", () => {
    const xml = buildSitemap();
    // /  → https://centralgauge.sshadows.workers.dev/   (matches the
    // canonical `<link rel="canonical">` for `/`, see Task C3).
    expect(xml).toContain(`<loc>${BASE_URL}/</loc>`);
  });

  it("SITEMAP_ROUTES is sorted, deduplicated", () => {
    const sorted = [...SITEMAP_ROUTES].sort();
    expect(SITEMAP_ROUTES).toEqual(sorted);
    expect(new Set(SITEMAP_ROUTES).size).toBe(SITEMAP_ROUTES.length);
  });

  it("does NOT include /leaderboard (cutover sunset)", () => {
    expect(SITEMAP_ROUTES).not.toContain("/leaderboard");
  });

  it("does NOT include /api/ paths or _canary/", () => {
    for (const route of SITEMAP_ROUTES) {
      expect(route.startsWith("/api/")).toBe(false);
      expect(route.startsWith("/_canary/")).toBe(false);
    }
  });

  it("does NOT include OG image endpoints", () => {
    for (const route of SITEMAP_ROUTES) {
      expect(route.startsWith("/og/")).toBe(false);
    }
  });

  it("emits is_idempotent: build-then-build = byte-identical", () => {
    const a = buildSitemap();
    const b = buildSitemap();
    expect(a).toBe(b);
  });
});
