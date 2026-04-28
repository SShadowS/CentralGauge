import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PAGES = [
  '/', '/models', '/runs', '/families', '/tasks',
  '/compare?models=sonnet-4-7,gpt-5', '/search?q=AL0132', '/limitations', '/about',
];

const THEMES = ['light', 'dark'] as const;
const DENSITIES = ['comfortable', 'compact'] as const;

for (const url of PAGES) {
  for (const theme of THEMES) {
    for (const density of DENSITIES) {
      test(`a11y ${url} · ${theme} · ${density}`, async ({ page }) => {
        await page.addInitScript(([t, d]) => {
          try {
            localStorage.setItem('cg-theme', t);
            localStorage.setItem('cg-density', d);
          } catch { /* ignore */ }
        }, [theme, density]);
        await page.goto(url);
        await page.waitForLoadState('networkidle');

        const results = await new AxeBuilder({ page })
          .disableRules([
            // Excluded by spec §9.5: contrast pairs are tested separately by
            // scripts/check-contrast.ts; some spec-mandated colors trip
            // axe's overly-broad heuristic on accent-soft backgrounds.
            'color-contrast',
          ])
          .analyze();

        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        if (serious.length > 0) {
          console.log(`[a11y serious] ${url} ${theme} ${density}`);
          for (const v of serious) console.log('  -', v.id, v.help);
        }
        expect(serious).toHaveLength(0);
      });
    }
  }
}
