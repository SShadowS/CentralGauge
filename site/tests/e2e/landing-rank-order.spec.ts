import { expect, test } from "@playwright/test";

/**
 * Verifies landing-page table sort behaviour.
 *
 * Covers two scenarios:
 *   1. Default sort: the page loads with auc_2:desc active (aria-sort on the
 *      Solve AUC@2 header reflects "descending").
 *   2. Deep-link sort: ?sort=<field>:<dir> activates the named column and
 *      direction — tested for avg_cost_usd descending and ascending.
 *
 * Columns under test: Solve AUC@2, Cost / task (avg_cost_usd), p95 latency.
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
