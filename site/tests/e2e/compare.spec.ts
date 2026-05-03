import { expect, test } from "@playwright/test";
import { FIXTURE } from "../utils/seed-fixtures";

test.describe("/compare", () => {
  test("empty state when no models selected", async ({ page }) => {
    await page.goto("/compare");
    await expect(page.getByText("Pick at least two models to compare"))
      .toBeVisible();
  });

  test("two models render the at-a-glance + grid", async ({ page }) => {
    await page.goto(
      `/compare?models=${FIXTURE.model.sonnet},${FIXTURE.model.gpt5}`,
    );
    // "Per-task scores" appears in both an <h2> heading and a <p> body
    // ("...Per-task scores below."). Use heading role to disambiguate.
    await expect(page.getByRole("heading", { name: /^At a glance$/ }))
      .toBeVisible();
    await expect(page.getByRole("heading", { name: /^Per-task scores$/ }))
      .toBeVisible();
    await expect(page.locator("table thead th")).toHaveCount(3); // Task + 2 models
  });

  test("removing a chip drops it from the URL", async ({ page }) => {
    await page.goto(
      `/compare?models=${FIXTURE.model.sonnet},${FIXTURE.model.gpt5}`,
    );
    await page.getByRole("button", {
      name: new RegExp(`Remove filter ${FIXTURE.model.sonnet}`),
    }).click();
    await expect(page).toHaveURL(new RegExp(`models=${FIXTURE.model.gpt5}`));
  });
});
