import { expect, test } from "@playwright/test";

test.describe("/", () => {
  test("renders header + table + filter rail", async ({ page }) => {
    // Hero chart (c19efe5) replaced the "Leaderboard" h1 with the
    // CentralGauge brand mark. The leaderboard table itself remains the
    // primary page content.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /centralgauge/i }))
      .toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("navigation", { name: /primary/i }))
      .toBeVisible();
  });

  test("sort by Score reverses order on second click", async ({ page }) => {
    // networkidle: sort handlers are wired during Svelte hydration, which
    // races the click under parallel load (3/5 flake observed without it).
    await page.goto("/", { waitUntil: "networkidle" });
    // Anchor to exactly "Score" — the demoted "Avg score" column also
    // contains "score", so a bare /score/i now matches two buttons.
    const scoreHeader = page.getByRole("button", { name: /^score$/i });
    await scoreHeader.click();
    await expect(page).toHaveURL(/sort=pass_at_n%3Aasc/);
    await scoreHeader.click();
    await expect(page).toHaveURL(/sort=pass_at_n%3Adesc/);
  });

  test("filter chip removal updates URL", async ({ page }) => {
    // `tier` is a tab-style toggle (not in FILTER_KEYS), so it doesn't
    // render as a removable chip. Use a real filter (`family`) instead.
    await page.goto("/?family=claude", { waitUntil: "networkidle" });
    const chip = page.getByText(/family: claude/i);
    await expect(chip).toBeVisible();
    await page.getByRole("button", { name: /remove filter family/i }).click();
    await expect(page).not.toHaveURL(/family=/);
  });
});
