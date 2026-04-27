import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import LeaderboardTable from './LeaderboardTable.svelte';
import type { LeaderboardRow } from '$shared/api-types';

const rows: LeaderboardRow[] = [
  {
    rank: 1,
    model: { slug: 'sonnet-4-7', display_name: 'Sonnet 4.7', api_model_id: 'claude-sonnet-4-7' },
    family_slug: 'claude',
    run_count: 142,
    tasks_attempted: 24,
    tasks_passed: 24,
    avg_score: 0.84,
    avg_cost_usd: 0.12,
    verified_runs: 100,
    last_run_at: '2026-04-27T10:00:00Z',
  },
];

describe('LeaderboardTable', () => {
  it('renders one row per model', () => {
    render(LeaderboardTable, { rows, sort: 'avg_score:desc' });
    expect(screen.getByText('Sonnet 4.7')).toBeDefined();
  });
  it('emits sort change when a sortable header is clicked', async () => {
    let sort = 'avg_score:desc';
    render(LeaderboardTable, {
      rows,
      sort,
      onsort: (next: string) => { sort = next; },
    });
    const scoreHeader = screen.getByRole('columnheader', { name: /score/i });
    await fireEvent.click(scoreHeader);
    expect(sort).toBe('avg_score:asc');
  });
  it('uses tabular-nums on score cell', () => {
    const { container } = render(LeaderboardTable, { rows, sort: 'avg_score:desc' });
    const score = container.querySelector('td.score');
    expect(score?.textContent).toContain('0.84');
  });
});
