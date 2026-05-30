import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import TaxonomyFilter from './TaxonomyFilter.svelte';

describe('TaxonomyFilter', () => {
  it('toggling a tag chip emits the updated tag set', async () => {
    const onchange = vi.fn();
    const { getByRole } = render(TaxonomyFilter, {
      props: {
        groups: [{ slug: 'pages-ui', name: 'Pages, Reports & UI', task_count: 14 }],
        tags: [
          { slug: 'v16', name: 'v16', task_count: 7 },
          { slug: 'page', name: 'page', task_count: 9 },
        ],
        activeGroup: '',
        activeTags: [],
        onchange,
      },
    });
    await fireEvent.click(getByRole('button', { name: /v16/i }));
    expect(onchange).toHaveBeenCalledWith({ category: '', tags: ['v16'] });
  });

  it('clicking an already-active tag removes it', async () => {
    const onchange = vi.fn();
    const { getByRole } = render(TaxonomyFilter, {
      props: {
        groups: [],
        tags: [{ slug: 'v16', name: 'v16', task_count: 7 }],
        activeGroup: '',
        activeTags: ['v16'],
        onchange,
      },
    });
    await fireEvent.click(getByRole('button', { name: /v16/i }));
    expect(onchange).toHaveBeenCalledWith({ category: '', tags: [] });
  });

  it('renders group buttons with All option', () => {
    const { getByRole, getAllByRole } = render(TaxonomyFilter, {
      props: {
        groups: [{ slug: 'pages-ui', name: 'Pages, Reports & UI', task_count: 14 }],
        tags: [],
        activeGroup: '',
        activeTags: [],
      },
    });
    expect(getByRole('button', { name: /All/i })).toBeDefined();
    expect(getByRole('button', { name: /Pages, Reports & UI/i })).toBeDefined();
  });

  it('active group button has aria-pressed true', () => {
    const { getByRole } = render(TaxonomyFilter, {
      props: {
        groups: [{ slug: 'pages-ui', name: 'Pages, Reports & UI', task_count: 14 }],
        tags: [],
        activeGroup: 'pages-ui',
        activeTags: [],
      },
    });
    const btn = getByRole('button', { name: /Pages, Reports & UI/i });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('selecting a group emits category change', async () => {
    const onchange = vi.fn();
    const { getByRole } = render(TaxonomyFilter, {
      props: {
        groups: [{ slug: 'pages-ui', name: 'Pages, Reports & UI', task_count: 14 }],
        tags: [],
        activeGroup: '',
        activeTags: [],
        onchange,
      },
    });
    await fireEvent.click(getByRole('button', { name: /Pages, Reports & UI/i }));
    expect(onchange).toHaveBeenCalledWith({ category: 'pages-ui', tags: [] });
  });
});
