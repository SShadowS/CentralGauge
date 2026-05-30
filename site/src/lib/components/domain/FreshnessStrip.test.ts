import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import FreshnessStrip from './FreshnessStrip.svelte';

describe('FreshnessStrip', () => {
  it('shows task count, attempts, and the AUC@2 formula', () => {
    const { container } = render(FreshnessStrip, {
      props: { generatedAt: '2026-05-30T10:00:00Z', taskCount: 512 },
    });
    const text = container.textContent ?? '';
    expect(text).toContain('512 tasks');
    expect(text).toContain('2 attempts');
    expect(text).toMatch(/AUC@2\s*=\s*\(pass@1 \+ solve@2\) \/ 2/);
  });
});
