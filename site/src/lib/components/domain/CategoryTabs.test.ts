import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import CategoryTabs from './CategoryTabs.svelte';
import type { CategoriesIndexItem } from '$lib/shared/api-types';

const cats: CategoriesIndexItem[] = [
  { slug: 'tables', name: 'Tables', task_count: 64, avg_pass_rate: 0.5 },
  { slug: 'pages', name: 'Pages', task_count: 40, avg_pass_rate: 0.4 },
];

describe('CategoryTabs', () => {
  it('renders an All tab with the total and one tab per category with its count', () => {
    const { getByRole } = render(CategoryTabs, { props: { categories: cats, active: null, total: 512, onselect: () => {} } });
    expect(getByRole('radio', { name: /all tasks/i }).getAttribute('aria-checked')).toBe('true');
    expect(getByRole('radio', { name: /tables/i }).textContent).toMatch(/64/);
    expect(getByRole('radio', { name: /pages/i }).textContent).toMatch(/40/);
  });

  it('marks the active category and emits its slug on click', async () => {
    const onselect = vi.fn();
    const { getByRole } = render(CategoryTabs, { props: { categories: cats, active: 'tables', total: 512, onselect } });
    expect(getByRole('radio', { name: /tables/i }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(getByRole('radio', { name: /pages/i }));
    expect(onselect).toHaveBeenCalledWith('pages');
  });

  it('emits null when the All tab is clicked', async () => {
    const onselect = vi.fn();
    const { getByRole } = render(CategoryTabs, { props: { categories: cats, active: 'tables', total: 512, onselect } });
    await fireEvent.click(getByRole('radio', { name: /all tasks/i }));
    expect(onselect).toHaveBeenCalledWith(null);
  });
});
