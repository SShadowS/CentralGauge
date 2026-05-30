import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import OutcomeMixBar from './OutcomeMixBar.svelte';

describe('OutcomeMixBar', () => {
  it('renders an aria-label describing all three segments in words', () => {
    const { getByRole } = render(OutcomeMixBar, {
      props: { firstTryPct: 55, retryPct: 24, failedPct: 21 },
    });
    const img = getByRole('img');
    expect(img.getAttribute('aria-label')).toMatch(/55.*first try/i);
    expect(img.getAttribute('aria-label')).toMatch(/24.*retry/i);
    expect(img.getAttribute('aria-label')).toMatch(/21.*fail/i);
  });

  it('renders an empty dash state when all segments are zero', () => {
    const { container } = render(OutcomeMixBar, {
      props: { firstTryPct: 0, retryPct: 0, failedPct: 0 },
    });
    expect(container.textContent).toContain('—');
  });

  it('omits segments whose percentage is zero', () => {
    const { container } = render(OutcomeMixBar, {
      props: { firstTryPct: 0, retryPct: 50, failedPct: 50 },
    });
    expect(container.querySelector('.seg-a1')).toBeNull();
    expect(container.querySelector('.seg-a2')).not.toBeNull();
    expect(container.querySelector('.seg-fail')).not.toBeNull();
  });
});
