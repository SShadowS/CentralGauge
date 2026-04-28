import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import AttemptCell from './AttemptCell.svelte';

describe('AttemptCell', () => {
  it('renders ✓ when passed=1', () => {
    const { container } = render(AttemptCell, { passed: 1 });
    expect(container.textContent).toContain('✓');
    expect(container.querySelector('.pass')).not.toBeNull();
  });

  it('renders ✗ when passed=0', () => {
    const { container } = render(AttemptCell, { passed: 0 });
    expect(container.textContent).toContain('✗');
    expect(container.querySelector('.fail')).not.toBeNull();
  });

  it('renders — when passed=null', () => {
    const { container } = render(AttemptCell, { passed: null });
    expect(container.textContent).toContain('—');
  });

  it('exposes a screen-reader-friendly aria-label', () => {
    const { container } = render(AttemptCell, { passed: 1 });
    const cell = container.querySelector('[aria-label]');
    expect(cell?.getAttribute('aria-label')).toMatch(/passed/i);
  });
});
