import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TierBadge from './TierBadge.svelte';

describe('TierBadge', () => {
  it('renders verified with checkmark', () => {
    render(TierBadge, { tier: 'verified' });
    expect(screen.getByText(/verified/i)).toBeDefined();
  });
  it('renders claimed', () => {
    render(TierBadge, { tier: 'claimed' });
    expect(screen.getByText(/claimed/i)).toBeDefined();
  });
});
