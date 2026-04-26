import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Badge from './Badge.svelte';

describe('Badge', () => {
  it('renders text', () => {
    render(Badge, { children: 'verified', variant: 'tier-verified' });
    expect(screen.getByText('verified')).toBeDefined();
  });
  it('applies variant', () => {
    const { container } = render(Badge, { variant: 'success', children: 'ok' });
    expect(container.querySelector('.badge.variant-success')).toBeDefined();
  });
});
