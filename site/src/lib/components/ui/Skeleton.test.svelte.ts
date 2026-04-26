import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Skeleton from './Skeleton.svelte';

describe('Skeleton', () => {
  it('renders with given variant', () => {
    const { container } = render(Skeleton, { variant: 'table-row' });
    expect(container.querySelector('.skeleton.variant-table-row')).toBeDefined();
  });
  it('exposes aria-hidden', () => {
    const { container } = render(Skeleton, { variant: 'text' });
    expect(container.querySelector('[aria-hidden="true"]')).toBeDefined();
  });
});
