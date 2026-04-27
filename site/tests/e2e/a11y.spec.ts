import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('a11y', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`/leaderboard has no serious/critical violations (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => { localStorage.setItem('theme', t); }, theme);
      await page.goto('/leaderboard');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter(v =>
        v.impact === 'serious' || v.impact === 'critical'
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toHaveLength(0);
    });
  }
});
