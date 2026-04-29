import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import SummaryBand from './SummaryBand.svelte';
import type { SummaryStats } from '$shared/api-types';

const baseStats: SummaryStats = {
  runs: 42,
  models: 4,
  tasks: 17,
  total_cost_usd: 1.23,
  total_tokens: 1500,
  last_run_at: '2026-04-26T00:00:00Z',
  latest_changelog: null,
  generated_at: '2026-04-27T00:00:00Z',
};

describe('SummaryBand', () => {
  it('renders 5 stat tiles with correct values', () => {
    const { container } = render(SummaryBand, { stats: baseStats });
    const labels = Array.from(container.querySelectorAll('.label')).map(
      (el) => el.textContent?.trim(),
    );
    expect(labels).toEqual(['Runs', 'Models', 'Tasks', 'Total cost', 'Total tokens']);

    const values = Array.from(container.querySelectorAll('.value')).map(
      (el) => el.textContent?.trim(),
    );
    expect(values).toEqual(['42', '4', '17', '$1.23', '1.5K']);
  });

  it('formats large numbers with K and M suffixes', () => {
    const { container } = render(SummaryBand, {
      stats: { ...baseStats, runs: 1234, total_tokens: 1_500_000 },
    });
    const values = Array.from(container.querySelectorAll('.value')).map(
      (el) => el.textContent?.trim(),
    );
    expect(values[0]).toBe('1.2K'); // runs 1234 -> 1.2K
    expect(values[4]).toBe('1.5M'); // tokens 1.5M
  });

  it('formats large costs with K suffix', () => {
    const { container } = render(SummaryBand, {
      stats: { ...baseStats, total_cost_usd: 1500 },
    });
    const values = Array.from(container.querySelectorAll('.value')).map(
      (el) => el.textContent?.trim(),
    );
    expect(values[3]).toBe('$1.5K');
  });

  it('does not render callout when latest_changelog is null', () => {
    const { container } = render(SummaryBand, { stats: baseStats });
    expect(container.querySelector('.callout')).toBeNull();
  });

  it('renders callout with link to /changelog#<slug> when latest_changelog is present', () => {
    const { container } = render(SummaryBand, {
      stats: {
        ...baseStats,
        latest_changelog: {
          date: '2026-04-20',
          title: 'Phase F shipped',
          slug: 'phase-f-shipped',
          body: '# changes',
        },
      },
    });
    const callout = container.querySelector('a.callout') as HTMLAnchorElement | null;
    expect(callout).not.toBeNull();
    expect(callout!.getAttribute('href')).toBe('/changelog#phase-f-shipped');
    expect(callout!.textContent).toContain('Phase F shipped');
    expect(callout!.textContent).toContain('2026-04-20');
  });

  it('renders zeros cleanly in empty production state', () => {
    const { container } = render(SummaryBand, {
      stats: {
        runs: 0,
        models: 0,
        tasks: 0,
        total_cost_usd: 0,
        total_tokens: 0,
        last_run_at: null,
        latest_changelog: null,
        generated_at: '2026-04-27T00:00:00Z',
      },
    });
    const values = Array.from(container.querySelectorAll('.value')).map(
      (el) => el.textContent?.trim(),
    );
    expect(values).toEqual(['0', '0', '0', '$0.00', '0']);
  });
});
