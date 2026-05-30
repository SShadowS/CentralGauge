import { expect, test } from "@playwright/test";

/**
 * Verifies the landing-page table sort behaviour after the leaderboard
 * redesign (Task 9 trimmed the table, Task 10 removed the HeroChart in favour
 * of FreshnessStrip + RecommendationTiles + SortPresets).
 *
 * The old hero-bar / table row-order parity check is gone — there is no
 * HeroChart on the page anymore. Sort-deep-link coverage moves to the columns
 * that survive the trim: Solve AUC@2, Cost / task (avg_cost_usd), p95 latency.
 */
test.describe("landing page sort behaviour", () => {
  test("default sort is auc_2 descending (Solve AUC@2 column shows descending indicator)", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // The Solve AUC@2 column header cell carries data-test="auc-2-header" and
    // aria-sort reflecting the active sort direction. Default sort is
    // auc_2:desc (both API and page server agree on this default after Task 5+6).
    const auc2Header = page.locator("[data-test='auc-2-header']");
    await expect(auc2Header).toHaveAttribute("aria-sort", "descending");
  });

  test("deep link ?sort=avg_cost_usd:desc activates cost column sort descending", async ({
    page,
  }) => {
    await page.goto("/?sort=avg_cost_usd:desc", { waitUntil: "networkidle" });

    // The "Cost / task" <th> acquires aria-sort="descending" when active.
    const costHeader = page.locator(
      "thead th[aria-sort='descending'] button",
    );
    await expect(costHeader).toContainText(/cost \/ task/i);
  });

  test("deep link ?sort=avg_cost_usd:asc reverses cost sort to ascending", async ({
    page,
  }) => {
    await page.goto("/?sort=avg_cost_usd:asc", { waitUntil: "networkidle" });

    const costHeader = page.locator(
      "thead th[aria-sort='ascending'] button",
    );
    await expect(costHeader).toContainText(/cost \/ task/i);
  });
});
