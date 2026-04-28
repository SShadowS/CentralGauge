import { test, expect } from '@playwright/test';

const PAGES = [
  { name: 'home', url: '/' },
  { name: 'run-detail', url: '/runs/run-0000' },
  { name: 'model-detail', url: '/models/sonnet-4-7' },
  { name: 'family-detail', url: '/families/claude' },
  { name: 'limitations', url: '/limitations' },
];

const THEMES = ['light', 'dark'] as const;
const DENSITIES = ['comfortable', 'compact'] as const;

for (const p of PAGES) {
  test.describe(`visual:${p.name}`, () => {
    for (const theme of THEMES) {
      for (const density of DENSITIES) {
        test(`${theme} · ${density}`, async ({ page }) => {
          // Set theme + density via localStorage before first paint
          await page.addInitScript(([t, d]) => {
            try {
              localStorage.setItem('cg-theme', t);
              localStorage.setItem('cg-density', d);
            } catch { /* ignore */ }
          }, [theme, density]);

          await page.goto(p.url);
          await page.waitForLoadState('networkidle');

          // Mask anything time-dependent (relative timestamps, build sha,
          // run IDs that change between seeds).
          const masks = [
            page.locator('[data-testid="timestamp"]'),
            page.locator('time'),
            page.locator('text=/Updated\\s/'),
            page.locator('text=/build:\\s+\\w+/'),
          ];

          await expect(page).toHaveScreenshot(`${p.name}-${theme}-${density}.png`, {
            fullPage: true,
            mask: masks,
            // Use the global threshold from playwright.config.ts.
          });
        });
      }
    }
  });
}
