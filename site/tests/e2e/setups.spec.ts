import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("/setups", () => {
  test("lists public setups and hides private ones by default", async ({ page }) => {
    await page.goto("/setups");
    await expect(page.getByRole("link", { name: "cc-plain description" })).toBeVisible();
    await expect(page.getByRole("link", { name: "pi-default description" })).toBeVisible();
    await expect(page.getByText("cc-secret")).toHaveCount(0);
  });

  test("private toggle shows cc-secret marked private", async ({ page }) => {
    await page.goto("/setups?private=1");
    const row = page.getByRole("row").filter({ hasText: "cc-secret description" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell", { name: "private", exact: true })).toBeVisible();
  });

  test("ticking two rows and following Compare lands on the compare page", async ({ page }) => {
    await page.goto("/setups");
    await page.getByLabel("Select cc-plain description").check();
    await page.getByLabel("Select pi-default description").check();
    await page.getByRole("link", { name: "Compare", exact: true }).click();
    await expect(page).toHaveURL(/\/setups\/compare\?ids=/);
  });

  test("detail page shows the cost issue section and two history rows", async ({ page }) => {
    await page.goto("/setups/cc-plain");
    await expect(page.getByRole("heading", { name: /Known cost issue/ })).toBeVisible();
    const history = page.locator("section", {
      has: page.getByRole("heading", { name: "History" }),
    });
    await expect(history.locator("tbody tr")).toHaveCount(2);
  });

  test("HX task page has no summary and no prompt text", async ({ page }) => {
    await page.goto("/hx-tasks/HX-001");
    await expect(page.getByText("No summary yet.")).toBeVisible();
    await expect(page.getByText("The full task is public in the CentralGauge GitHub repository."))
      .toBeVisible();
  });

  test("archive lists both task sets", async ({ page }) => {
    await page.goto("/setups/archive");
    await expect(page.getByRole("link", { name: "HX current" })).toBeVisible();
    await expect(page.getByRole("link", { name: "HX old" })).toBeVisible();
  });
});

for (const url of ["/setups", "/setups/cc-plain"]) {
  test(`a11y ${url}`, async ({ page }) => {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    const serious = results.violations.filter((v) =>
      v.impact === "serious" || v.impact === "critical"
    );
    for (const v of serious) console.log("  -", v.id, v.help);
    expect(serious).toHaveLength(0);
  });
}
