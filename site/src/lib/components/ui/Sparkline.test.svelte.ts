import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Sparkline from './Sparkline.svelte';

describe('Sparkline', () => {
  it('renders an SVG path with d3-shape line generator output', () => {
    const { container } = render(Sparkline, { values: [0.5, 0.6, 0.7, 0.8] });
    const path = container.querySelector('svg path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('d')).toMatch(/^M/);
  });
  it('exposes aria-label with summary stats', () => {
    const { container } = render(Sparkline, { values: [0.5, 0.7, 0.6], label: 'Score history' });
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-label')).toContain('Score history');
  });
  it('renders nothing readable when too few values', () => {
    const { container } = render(Sparkline, { values: [0.5] });
    expect(container.querySelector('.sparkline-empty')).not.toBeNull();
  });
});
