import { expect, test } from "@playwright/test";
import { FIXTURE } from "../utils/seed-fixtures";

test.describe("/models/:slug", () => {
  test("renders header + stat tiles + history chart", async ({ page }) => {
    await page.goto(`/models/${FIXTURE.model.sonnet}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // `Score` appears 7+ times on the page (StatTile label, MetricInfo
    // popover content, table header, descriptive prose). Target the
    // StatTile label specifically; "History" is a tab so use the role.
    // Label includes a MetricInfo helper after the text, so anchor only
    // at the start (textContent is "Score" + popover's <details> content).
    await expect(page.locator(".tile .label", { hasText: /^Score/ }))
      .toBeVisible();
    // History is an <h2> on this page (not a tab — the page doesn't use Tabs).
    await expect(page.getByRole("heading", { name: /^History$/ }))
      .toBeVisible();
  });

  test("navigates to runs feed", async ({ page }) => {
    await page.goto(`/models/${FIXTURE.model.sonnet}`);
    await page.getByText("See all").click();
    await expect(page).toHaveURL(
      new RegExp(`/models/${FIXTURE.model.sonnet}/runs`),
    );
  });
});
