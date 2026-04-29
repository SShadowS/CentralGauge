import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import PerformanceVsCostChart from './PerformanceVsCostChart.svelte';
import type { LeaderboardRow } from '$shared/api-types';

function row(slug: string, score: number, cost: number, rank = 1): LeaderboardRow {
  return {
    rank,
    model: {
      slug,
      display_name: slug,
      api_model_id: slug,
      settings_suffix: '',
    },
    family_slug: 'fam',
    run_count: 1,
    tasks_attempted: 0,
    tasks_passed: 0,
    tasks_attempted_distinct: 0,
    tasks_passed_attempt_1: 0,
    tasks_passed_attempt_2_only: 0,
    pass_at_n: 0,
    avg_score: score,
    avg_cost_usd: cost,
    verified_runs: 0,
    last_run_at: '2026-04-01T00:00:00Z',
  };
}

describe('PerformanceVsCostChart', () => {
  it('renders empty state when rows is empty', () => {
    const { container } = render(PerformanceVsCostChart, { rows: [] });
    expect(container.querySelector('svg')).toBeNull();
    const empty = container.querySelector('.empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('No data');
  });

  it('renders one bar and one dot per row (3 rows -> 3 of each)', () => {
    const rows = [
      row('a', 90, 0.01),
      row('b', 70, 0.05),
      row('c', 50, 0.02),
    ];
    const { container } = render(PerformanceVsCostChart, { rows });
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelectorAll('rect').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('circle')).toHaveLength(3 + 1); // bars + 1 legend dot
  });

  it('exposes hover tooltips via <title> elements on bars and dots', () => {
    const rows = [row('claude-sonnet', 80, 0.0123)];
    const { container } = render(PerformanceVsCostChart, { rows });

    const titles = Array.from(container.querySelectorAll('title')).map(
      (t) => t.textContent ?? '',
    );
    expect(titles.some((t) => t.includes('claude-sonnet') && t.includes('score 80.000'))).toBe(true);
    expect(titles.some((t) => t.includes('claude-sonnet') && t.includes('cost $0.0123'))).toBe(true);
  });

  it('caps display at top N=12 even when 20 rows are provided', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row(`m${i}`, 50 + (i % 5) * 5, 0.01 + i * 0.001, i + 1),
    );
    const { container } = render(PerformanceVsCostChart, { rows });
    // 12 bars + score legend rect = 13 rects
    expect(container.querySelectorAll('rect')).toHaveLength(13);
    // 12 cost dots + 1 legend dot = 13 circles
    expect(container.querySelectorAll('circle')).toHaveLength(13);
  });

  it('keeps a sane minimum bar width with sparse data (4 rows)', () => {
    const rows = [
      row('a', 90, 0.01),
      row('b', 70, 0.02),
      row('c', 50, 0.03),
      row('d', 30, 0.04),
    ];
    const { container } = render(PerformanceVsCostChart, { rows });
    // Bars are <rect> elements that have an inline <title> child; the
    // legend rect has no <title>. Filter on that.
    const bars = Array.from(container.querySelectorAll('rect')).filter(
      (r) => r.querySelector('title') !== null,
    );
    expect(bars.length).toBe(4);
    for (const bar of bars) {
      const w = parseFloat(bar.getAttribute('width') ?? '0');
      expect(w).toBeGreaterThanOrEqual(8);
    }
  });
});
