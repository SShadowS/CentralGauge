import { expect, test } from "@playwright/test";

/**
 * Verifies that the HeroChart bar order and LeaderboardTable row order are
 * consistent (both sorted by pass_at_n descending, the strict pass rate), and
 * that the avg_score deep-link sort still works.
 *
 * DOM anchor selectors:
 *   - Hero bars:  ol.bars li a.bar-model  (HeroChart.svelte)
 *   - Table rows: table tbody tr th[scope="row"] a.name  (ModelLink.svelte)
 *     (using a.name to skip the FamilyBadge <a> rendered inside the same <th>)
 */
test.describe("landing page rank order parity", () => {
  test("hero bar order matches leaderboard table row order", async ({
    page,
  }) => {
    // networkidle: HeroChart and LeaderboardTable wire up during hydration.
    await page.goto("/", { waitUntil: "networkidle" });

    // Collect hero bar names in DOM order (ol.bars li a.bar-model).
    const heroNames = await page
      .locator("ol.bars li a.bar-model")
      .allTextContents();

    // Collect table row model names in DOM order.
    // ModelLink renders an <a class="name"> inside th[scope="row"].
    // Using a.name to skip the FamilyBadge <a> in the same cell.
    const tableNames = await page
      .locator("table tbody tr th[scope='row'] a.name")
      .allTextContents();

    // Guard: if the fixture has no rows the comparison is vacuously true —
    // make the expectation explicit so the test fails on an empty page.
    expect(heroNames.length).toBeGreaterThan(0);
    expect(tableNames.length).toBeGreaterThan(0);

    const trim = (arr: string[]) => arr.map((s) => s.trim());
    expect(trim(heroNames)).toEqual(trim(tableNames));
  });

  test("default sort is pass_at_n descending (Score column shows descending indicator)", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // The Score column header cell carries data-test="pass-at-n-header" and
    // aria-sort reflecting the active sort direction. Default sort is
    // pass_at_n:desc (both API and page server agree on this default).
    const scoreHeader = page.locator("[data-test='pass-at-n-header']");
    await expect(scoreHeader).toHaveAttribute("aria-sort", "descending");
  });

  test("deep link ?sort=avg_score:desc activates avg-attempt column sort descending", async ({
    page,
  }) => {
    await page.goto("/?sort=avg_score:desc", { waitUntil: "networkidle" });

    // The "Avg attempt" <th> acquires aria-sort="descending" when active.
    const avgHeader = page.locator(
      "thead th[aria-sort='descending'] button",
    );
    await expect(avgHeader).toContainText(/avg attempt/i);
  });

  test("deep link ?sort=avg_score:asc reverses avg-attempt sort to ascending", async ({
    page,
  }) => {
    await page.goto("/?sort=avg_score:asc", { waitUntil: "networkidle" });

    const avgHeader = page.locator(
      "thead th[aria-sort='ascending'] button",
    );
    await expect(avgHeader).toContainText(/avg attempt/i);
  });
});
