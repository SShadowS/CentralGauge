import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import CategoryCardHarness from './CategoryCard.test.harness.svelte';
import type { CategoriesIndexItem } from '$shared/api-types';

function makeItem(overrides: Partial<CategoriesIndexItem> = {}): CategoriesIndexItem {
  return {
    slug: 'tables',
    name: 'Tables',
    task_count: 5,
    avg_pass_rate: 0.62,
    ...overrides,
  };
}

describe('CategoryCard', () => {
  it('renders the category name as a heading', () => {
    const { container } = render(CategoryCardHarness, { item: makeItem() });
    const h = container.querySelector('h3');
    expect(h).not.toBeNull();
    expect(h!.textContent).toBe('Tables');
  });

  it('links to /categories/{slug}', () => {
    const { container } = render(CategoryCardHarness, { item: makeItem({ slug: 'permissions' }) });
    const link = container.querySelector('a.card');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/categories/permissions');
  });

  it('shows pluralized task count', () => {
    const { container } = render(CategoryCardHarness, { item: makeItem({ task_count: 5 }) });
    expect(container.textContent).toContain('5 tasks');
  });

  it('uses singular "task" when task_count === 1', () => {
    const { container } = render(CategoryCardHarness, { item: makeItem({ task_count: 1 }) });
    expect(container.textContent).toContain('1 task');
    expect(container.textContent).not.toContain('1 tasks');
  });

  it('renders pass rate as integer percentage when present', () => {
    const { container } = render(CategoryCardHarness, { item: makeItem({ avg_pass_rate: 0.625 }) });
    expect(container.textContent).toContain('63%');
  });

  it('renders empty-state copy when avg_pass_rate is null', () => {
    const { container } = render(CategoryCardHarness, {
      item: makeItem({ avg_pass_rate: null, task_count: 0 }),
    });
    expect(container.textContent).toContain('No runs yet');
  });
});
