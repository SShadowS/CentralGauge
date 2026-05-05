import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /robots.txt", () => {
  it("returns 200 with text/plain content-type", async () => {
    const res = await SELF.fetch("http://x/robots.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/plain");
  });

  it("contains User-agent: * directive", async () => {
    const res = await SELF.fetch("http://x/robots.txt");
    const body = await res.text();
    expect(body).toContain("User-agent: *");
  });

  it("contains Allow: / directive (no global Disallow)", async () => {
    const res = await SELF.fetch("http://x/robots.txt");
    const body = await res.text();
    expect(body).toContain("Allow: /");
  });

  it("contains Sitemap: pointer to absolute URL", async () => {
    const res = await SELF.fetch("http://x/robots.txt");
    const body = await res.text();
    expect(body).toMatch(
      /Sitemap:\s+https:\/\/ai\.sshadows\.dk\/sitemap\.xml/,
    );
  });

  it("does NOT contain a wildcard Disallow (would block all crawlers)", async () => {
    const res = await SELF.fetch("http://x/robots.txt");
    const body = await res.text();
    expect(body).not.toMatch(/^Disallow:\s+\/$/m);
  });
});
