import { expect, test } from "@playwright/test";

test.describe("P5.5 cutover", () => {
  test("/ shows leaderboard", async ({ page }) => {
    // c19efe5 replaced the leaderboard h1 with the brand mark. The
    // leaderboard table is the load-bearing assertion now.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /centralgauge/i }))
      .toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
  });

  // The /leaderboard 302 redirect was retired in the cutover sunset
  // (2026-05-30); /leaderboard now 404s. The sitemap + nav assertions below
  // still guard that nothing points back at the old path.

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
      /https:\/\/ai\.sshadows\.dk\/?$/,
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
      "<loc>https://ai.sshadows.dk/</loc>",
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
