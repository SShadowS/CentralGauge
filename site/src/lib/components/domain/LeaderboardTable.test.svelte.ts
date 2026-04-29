import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import LeaderboardTable from './LeaderboardTable.svelte';
import type { LeaderboardRow } from '$shared/api-types';

const rows: LeaderboardRow[] = [
  {
    rank: 1,
    model: {
      slug: 'sonnet-4-7',
      display_name: 'Sonnet 4.7',
      api_model_id: 'claude-sonnet-4-7',
      settings_suffix: ' (50K, t0)',
    },
    family_slug: 'claude',
    run_count: 142,
    tasks_attempted: 24,
    tasks_passed: 24,
    tasks_attempted_distinct: 24,
    tasks_passed_attempt_1: 20,
    tasks_passed_attempt_2_only: 2,
    pass_at_n: 0.916667,
    avg_score: 0.84,
    avg_cost_usd: 0.12,
    verified_runs: 100,
    last_run_at: '2026-04-27T10:00:00Z',
  },
  {
    rank: 2,
    model: {
      slug: 'opus-4-7',
      display_name: 'Opus 4.7',
      api_model_id: 'claude-opus-4-7',
      settings_suffix: '',
    },
    family_slug: 'claude',
    run_count: 60,
    tasks_attempted: 24,
    tasks_passed: 18,
    tasks_attempted_distinct: 24,
    tasks_passed_attempt_1: 15,
    tasks_passed_attempt_2_only: 1,
    pass_at_n: 0.666667,
    avg_score: 0.72,
    avg_cost_usd: 0.30,
    verified_runs: 60,
    last_run_at: '2026-04-26T10:00:00Z',
  },
];

describe('LeaderboardTable', () => {
  it('renders one row per model', () => {
    render(LeaderboardTable, { rows, sort: 'avg_score:desc' });
    expect(screen.getByText('Sonnet 4.7')).toBeDefined();
    expect(screen.getByText('Opus 4.7')).toBeDefined();
  });

  it('emits sort change when a sortable header is clicked', async () => {
    let sort = 'avg_score:desc';
    render(LeaderboardTable, {
      rows,
      sort,
      onsort: (next: string) => { sort = next; },
    });
    const scoreBtn = screen.getByRole('button', { name: /score/i });
    await fireEvent.click(scoreBtn);
    expect(sort).toBe('avg_score:asc');
  });

  it('uses tabular-nums on score cell', () => {
    const { container } = render(LeaderboardTable, { rows, sort: 'avg_score:desc' });
    const score = container.querySelector('td.score');
    expect(score?.textContent).toContain('0.84');
  });

  it('renders AttemptStackedBar in each row', () => {
    const { container } = render(LeaderboardTable, { rows, sort: 'avg_score:desc' });
    const bars = container.querySelectorAll('.attempts-cell .bar');
    expect(bars.length).toBe(2);
  });

  it('renders pass ratio next to bar (a1 + a2only / distinct)', () => {
    const { container } = render(LeaderboardTable, { rows, sort: 'avg_score:desc' });
    const ratios = container.querySelectorAll('.attempts-cell .ratio');
    expect(ratios[0]?.textContent?.trim()).toBe('22/24');
    expect(ratios[1]?.textContent?.trim()).toBe('16/24');
  });

  it('renders SettingsBadge only when suffix is non-empty', () => {
    const { container } = render(LeaderboardTable, { rows, sort: 'avg_score:desc' });
    const badges = container.querySelectorAll('.settings-badge');
    // Sonnet (suffix ' (50K, t0)') → 1 badge; Opus ('') → 0
    expect(badges.length).toBe(1);
    expect(badges[0]?.textContent).toBe(' (50K, t0)');
  });

  it('Pass header click emits pass_at_n sort', async () => {
    let sort = 'avg_score:desc';
    render(LeaderboardTable, {
      rows,
      sort,
      onsort: (next: string) => { sort = next; },
    });
    const passBtn = screen.getByRole('button', { name: /^Pass/i });
    await fireEvent.click(passBtn);
    expect(sort).toBe('pass_at_n:desc');
  });
});
