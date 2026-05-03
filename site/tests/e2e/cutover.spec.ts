import { expect, test } from "@playwright/test";

test.describe("P5.5 cutover", () => {
  test("/ shows leaderboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Leaderboard/i }))
      .toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("/leaderboard 302 redirects to /", async ({ page }) => {
    const response = await page.goto("/leaderboard");
    // Playwright follows redirects by default; final URL is `/`. Use a
    // separate request to assert the initial response status is 302
    // (not the post-redirect 200 that page.goto returns).
    const initial = await page.context().request.fetch("/leaderboard", {
      maxRedirects: 0,
    });
    expect(initial.status()).toBe(302);
    await expect(page).toHaveURL("/");
  });

  test("/leaderboard?tier=verified preserves query through 302", async ({ page }) => {
    await page.goto("/leaderboard?tier=verified");
    // toHaveURL matches against the full URL (incl. http://host:port).
    // Match the path-and-query suffix without anchoring to a leading slash.
    await expect(page).toHaveURL(/\/\?tier=verified$/);
  });

  test("robots noindex meta is absent", async ({ page }) => {
    await page.goto("/");
    const robotsMeta = await page.locator(
      'meta[name="robots"][content="noindex"]',
    ).count();
    expect(robotsMeta).toBe(0);
  });

  test("canonical link is emitted", async ({ page }) => {
    await page.goto("/");
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute(
      "href",
      /https:\/\/centralgauge\.sshadows\.workers\.dev\/?$/,
    );
  });

  test("JSON-LD WebSite + Organization scripts present", async ({ page }) => {
    await page.goto("/");
    const scripts = page.locator('script[type="application/ld+json"]');
    await expect(scripts).toHaveCount(2);
  });

  test("sitemap.xml is reachable + lists / not /leaderboard", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain(
      "<loc>https://centralgauge.sshadows.workers.dev/</loc>",
    );
    expect(body).not.toContain("/leaderboard");
  });

  test("robots.txt is reachable + allows all", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    expect(body).toMatch(/Sitemap:.+sitemap\.xml/);
  });

  test('Nav "Leaderboard" link points at /', async ({ page }) => {
    await page.goto("/");
    const navLink = page.locator("nav a", { hasText: /^Leaderboard$/ });
    await expect(navLink).toHaveAttribute("href", "/");
  });
});
