import { expect, test } from "@playwright/test";

const PAGES = [
  { name: "home", url: "/" },
  { name: "run-detail", url: "/runs/run-0000" },
  { name: "model-detail", url: "/models/sonnet-4-7" },
  { name: "family-detail", url: "/families/claude" },
  { name: "limitations", url: "/limitations" },
];

// Lifecycle Wave 7 / Plan J6 — placeholders for the admin lifecycle
// pages and the family-diff section anchor. Pending two prerequisites
// before being un-skipped + baselined on Ubuntu CI per the
// baseline-capture runbook in `docs/site/operations.md` →
// "Visual-regression baseline capture (one-time, Ubuntu CI)":
//
//   1. CF Access fixture for admin pages — `/admin/lifecycle/*` is
//      gated by Cloudflare Access (Plan F5). The test rig needs a
//      cookie-injection or test-only auth-bypass to render these
//      pages without a real GitHub OAuth round-trip. See operations
//      runbook → "Admin lifecycle UI access (Cloudflare Access)".
//   2. Seeded lifecycle data — pending-review rows, lifecycle_events
//      entries, family_diffs rows. The seed:e2e harness covers the
//      public-facing tables; admin lifecycle data needs an extension.
//
// When both land, swap `test.skip` to `test` per page below and run
// `npx playwright test --update-snapshots` from the Ubuntu CI
// workflow (NOT a Windows dev machine — Windows captures drift per
// the P5.4 baseline-platform invariant).
const ADMIN_LIFECYCLE_PAGES = [
  { name: "admin-lifecycle-status", url: "/admin/lifecycle/status" },
  { name: "admin-lifecycle-review", url: "/admin/lifecycle/review" },
  { name: "admin-lifecycle-events", url: "/admin/lifecycle/events" },
];

// Family-diff section is part of /families/<slug>; it renders only
// when both gen-N and gen-N-1 have analysis.completed events under
// the same analyzer_model. seed:e2e currently doesn't materialise
// this state.
const FAMILY_DIFF_PAGES = [
  { name: "family-diff", url: "/families/claude#diff" },
];

const THEMES = ["light", "dark"] as const;
const DENSITIES = ["comfortable", "compact"] as const;

// Placeholder skipped suite for the lifecycle pages. Bodies are stubbed
// so the test runner discovers the names but never executes — keeps
// the to-do enumerated in the test report instead of buried in a
// comment.
for (const p of [...ADMIN_LIFECYCLE_PAGES, ...FAMILY_DIFF_PAGES]) {
  test.describe(`visual:${p.name}`, () => {
    test.skip(
      true,
      "Pending CF Access fixture + seed:e2e lifecycle data — see comment block at top of file (Wave 7 / Plan J6)",
    );
    test("light · comfortable", async ({ page }) => {
      await page.goto(p.url);
    });
  });
}

for (const p of PAGES) {
  test.describe(`visual:${p.name}`, () => {
    // Linux baselines have not been captured yet; only -win32.png and
    // -darwin.png exist under __screenshots__/. Per the per-platform
    // policy in playwright.config.ts:45, Linux CI cannot diff against
    // win32 baselines (font hinting / DPR drift). Skip until baselines
    // are captured via `npx playwright test --update-snapshots` on
    // Ubuntu (see CONTRIBUTING.md J6 / docs/site/operations.md).
    test.skip(
      process.platform === "linux",
      "Linux baselines not captured — see snapshotPathTemplate / CONTRIBUTING.md J6",
    );
    for (const theme of THEMES) {
      for (const density of DENSITIES) {
        test(`${theme} · ${density}`, async ({ page }) => {
          // Set theme + density via localStorage before first paint
          await page.addInitScript(([t, d]) => {
            try {
              localStorage.setItem("cg-theme", t);
              localStorage.setItem("cg-density", d);
            } catch { /* ignore */ }
          }, [theme, density]);

          await page.goto(p.url);
          await page.waitForLoadState("networkidle");

          // Mask anything time-dependent (relative timestamps, build sha,
          // run IDs that change between seeds).
          const masks = [
            page.locator('[data-testid="timestamp"]'),
            page.locator("time"),
            page.locator("text=/Updated\\s/"),
            page.locator("text=/build:\\s+\\w+/"),
          ];

          await expect(page).toHaveScreenshot(
            `${p.name}-${theme}-${density}.png`,
            {
              fullPage: true,
              mask: masks,
              // Use the global threshold from playwright.config.ts.
            },
          );
        });
      }
    }
  });
}
