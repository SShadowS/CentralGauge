import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Card from './Card.svelte';

describe('Card', () => {
  it('renders children', () => {
    render(Card, { children: 'hello' });
    expect(screen.getByText('hello')).toBeDefined();
  });
  it('applies elevated variant', () => {
    const { container } = render(Card, { variant: 'elevated', children: 'x' });
    expect(container.querySelector('.card.variant-elevated')).toBeDefined();
  });
});
