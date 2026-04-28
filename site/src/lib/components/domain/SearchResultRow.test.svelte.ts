import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import SearchResultRow from './SearchResultRow.svelte';
import type { SearchResultItem } from '$shared/api-types';

const item: SearchResultItem = {
  result_id: 1,
  run_id: 'r1',
  task_id: 'CG-AL-E001',
  model_slug: 'sonnet-4-7',
  compile_errors_text: 'AL0132 missing semicolon',
  failure_reasons_text: '',
  started_at: '2026-04-27T10:00:00Z',
  snippet: 'AL0132 <mark>missing</mark> semicolon',
};

describe('SearchResultRow', () => {
  it('renders the task and model link', () => {
    render(SearchResultRow, { item });
    expect(screen.getByText('CG-AL-E001')).toBeDefined();
    expect(screen.getByText('sonnet-4-7')).toBeDefined();
  });

  it('renders the snippet with <mark> preserved', () => {
    const { container } = render(SearchResultRow, { item });
    expect(container.querySelector('mark')?.textContent).toBe('missing');
  });

  it('drops disallowed tags from snippet', () => {
    const xss: SearchResultItem = { ...item, snippet: 'safe<script>alert(1)</script>after' };
    const { container } = render(SearchResultRow, { item: xss });
    expect(container.querySelector('script')).toBeNull();
  });
});
