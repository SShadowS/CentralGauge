import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const TOOLS = ["claude-code", "codex", "pi", "opencode", "cursor", "antigravity"];

test.describe("/submit", () => {
  test("renders the form with all six agent tools", async ({ page }) => {
    await page.goto("/submit");
    await expect(page.getByRole("heading", { name: "Submit a setup" })).toBeVisible();
    const options = await page.getByLabel("Agent tool").locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(options).toEqual(TOOLS);
    // The Turnstile widget needs challenges.cloudflare.com; offline CI cannot load it,
    // so only the form is asserted here.
  });

  test("nav has a Submit link", async ({ page }) => {
    await page.goto("/submit");
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Submit" })).toBeVisible();
  });

  test("has no serious or critical axe issues", async ({ page }) => {
    await page.goto("/submit");
    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad, JSON.stringify(bad.map((v) => v.id))).toEqual([]);
  });
});
