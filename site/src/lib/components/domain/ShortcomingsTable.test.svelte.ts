import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ShortcomingsTable from './ShortcomingsTable.svelte';
import type { ShortcomingsIndexItem } from '$shared/api-types';

const items: ShortcomingsIndexItem[] = [
  {
    al_concept: 'AL0132',
    models_affected: 3,
    occurrence_count: 12,
    avg_severity: 'medium',
    first_seen: '2026-01-01T00:00:00Z',
    last_seen: '2026-04-20T00:00:00Z',
    example_run_id: 'r1',
    example_task_id: 'CG-AL-E001',
    affected_models: [
      { slug: 'sonnet-4-7', display_name: 'Sonnet 4.7', occurrences: 5 },
      { slug: 'gpt-5',      display_name: 'GPT-5',      occurrences: 7 },
    ],
  },
  {
    al_concept: 'AL0118',
    models_affected: 1,
    occurrence_count: 2,
    avg_severity: 'low',
    first_seen: '2026-03-01T00:00:00Z',
    last_seen: '2026-04-01T00:00:00Z',
    example_run_id: null,
    example_task_id: null,
    affected_models: [{ slug: 'gpt-5', display_name: 'GPT-5', occurrences: 2 }],
  },
];

describe('ShortcomingsTable', () => {
  it('renders one row per shortcoming', () => {
    const { container } = render(ShortcomingsTable, { items });
    expect(container.querySelectorAll('tbody tr.row').length).toBe(2);
  });

  it('expands the affected-models list when chevron clicked', async () => {
    render(ShortcomingsTable, { items });
    const btn = screen.getAllByRole('button', { name: /toggle/i })[0];
    await fireEvent.click(btn);
    expect(screen.getByText('Sonnet 4.7')).toBeDefined();
  });

  it('sorts by occurrence_count when its header is clicked', async () => {
    const { container } = render(ShortcomingsTable, { items });
    const occHeader = screen.getByRole('button', { name: /occurrences/i });
    await fireEvent.click(occHeader);
    const firstRowConcept = container.querySelector('tbody tr.row th[scope="row"]')?.textContent?.trim();
    expect(firstRowConcept).toBe('AL0132');
  });
});
