import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Tag from './Tag.svelte';

describe('Tag', () => {
  it('renders children with neutral variant by default', () => {
    const { container } = render(Tag, { children: 'beta' });
    expect(screen.getByText('beta')).toBeDefined();
    expect(container.querySelector('.tag.variant-neutral')).toBeDefined();
  });
  it('applies variant class', () => {
    const { container } = render(Tag, { variant: 'success', children: 'ok' });
    expect(container.querySelector('.tag.variant-success')).toBeDefined();
  });
});
