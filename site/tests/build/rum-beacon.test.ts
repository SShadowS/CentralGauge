import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('RUM beacon HTML output', () => {
  // The about page is prerendered. The beacon should NOT appear in its
  // bundled HTML because cfWebAnalyticsToken is null during prerender
  // (the layout-server's `building` guard returns null).
  it('about/index.html does not contain the cf-beacon script', () => {
    const aboutHtml = resolve('./.svelte-kit/output/prerendered/pages/about.html');
    if (!existsSync(aboutHtml)) {
      // Build hasn't run yet; skip.
      return;
    }
    const html = readFileSync(aboutHtml, 'utf8');
    expect(html).not.toContain('cloudflareinsights.com/beacon.min.js');
  });
});
