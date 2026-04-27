import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Tooltip from './Tooltip.svelte';

describe('Tooltip', () => {
  it('renders trigger content + tooltip span with role=tooltip', () => {
    const { container } = render(Tooltip, { label: 'Helpful text', children: 'trigger' });
    expect(screen.getByText('trigger')).toBeDefined();
    expect(container.querySelector('[role="tooltip"]')?.textContent).toBe('Helpful text');
  });

  it('applies placement class when provided', () => {
    const { container } = render(Tooltip, { label: 'X', placement: 'top', children: 't' });
    expect(container.querySelector('.tip.placement-top')).not.toBeNull();
  });

  it('aria-describedby links trigger to tooltip', () => {
    const { container } = render(Tooltip, { label: 'X', children: 't' });
    const wrap = container.querySelector('.wrap') as HTMLElement;
    const tip = container.querySelector('[role="tooltip"]') as HTMLElement;
    expect(wrap.getAttribute('aria-describedby')).toBe(tip.id);
  });
});
