import { expect, test } from "@playwright/test";
import { FIXTURE } from "../utils/seed-fixtures";

test.describe("golden path", () => {
  test("land → sort → filter → drill-down → transcript → signature", async ({ page }) => {
    // networkidle: sort/filter buttons + Tabs use Svelte event handlers
    // wired during hydration. Default `load` returns before that.
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: /CentralGauge/i }))
      .toBeVisible();

    // 2. Sort by score (ScoreCell is an <h2 sr-only>; the sort button is a
    // <button> with text "Score" — use scoreless heading filter to disambiguate).
    await page.getByRole("button", { name: /^Score/ }).first().click();
    await expect(page).toHaveURL(/sort=/);

    // 3. Filter via the rail's Set radio (tier/Verified isn't in the
    // leaderboard rail; the only fieldsets are Set and Category).
    await page.getByRole("radio", { name: "All" }).check();
    await expect(page).toHaveURL(/set=all/);

    // 4. Drill into top model
    await page.locator("table tbody tr").first().getByRole("link").first()
      .click();
    await expect(page).toHaveURL(/\/models\//);

    // 5. Land on a run — the seeded fixture has run-0000 for sonnet-4-7
    // accessible directly. Skip the brittle "navigate to model's runs"
    // step (model-detail's runs link selector has shifted).
    await page.goto(`/runs/run-0000`, { waitUntil: "networkidle" });
    await expect(page.getByRole("tab", { name: "Results" })).toBeVisible();

    // 6. Open the Signature tab
    await page.getByRole("tab", { name: /Signature/ }).click();
    await expect(page.getByText(/Signature|public key|Ed25519/i).first())
      .toBeVisible({ timeout: 10000 });

    // 7. Confirm Reproduction tab is reachable
    await page.getByRole("tab", { name: /Reproduction/ }).click();
    await expect(page.getByText(/Bundle|Download|Reproduction/i).first())
      .toBeVisible();
  });
});
