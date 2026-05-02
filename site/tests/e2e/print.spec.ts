import { expect, test } from "@playwright/test";
import { FIXTURE } from "../utils/seed-fixtures";

test("/runs/:id hides nav + footer in print media", async ({ page }) => {
  await page.goto(`/runs/${FIXTURE.run.run0}`);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("nav").first()).toBeHidden();
  await expect(page.locator("footer")).toBeHidden();
});
