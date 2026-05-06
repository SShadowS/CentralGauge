import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import HeroChart from './HeroChart.svelte';
import type { LeaderboardRow } from '$lib/shared/api-types';

function makeRow(overrides: Partial<LeaderboardRow> & { slug: string; display_name: string }): LeaderboardRow {
  return {
    rank: 1,
    model: {
      slug: overrides.slug,
      display_name: overrides.display_name,
      api_model_id: overrides.slug,
      settings_suffix: '',
    },
    family_slug: 'test-family',
    run_count: 1,
    tasks_attempted: overrides.denominator ?? 10,
    tasks_passed: (overrides.tasks_passed_attempt_1 ?? 0) + (overrides.tasks_passed_attempt_2_only ?? 0),
    tasks_attempted_distinct: overrides.tasks_attempted_distinct ?? overrides.denominator ?? 10,
    tasks_passed_attempt_1: overrides.tasks_passed_attempt_1 ?? 0,
    tasks_passed_attempt_2_only: overrides.tasks_passed_attempt_2_only ?? 0,
    pass_at_n: overrides.pass_at_n ?? 0,
    pass_at_1: overrides.pass_at_1,
    denominator: overrides.denominator,
    latency_p95_ms: 5000,
    pass_rate_ci: { lower: 0, upper: 1 },
    pass_hat_at_n: 0,
    cost_per_pass_usd: null,
    avg_score: 0.5,
    avg_cost_usd: 0.1,
    verified_runs: 1,
    last_run_at: '2026-05-06T00:00:00Z',
  };
}

describe('HeroChart', () => {
  it('sorts by pass_at_n strict, tiebreaks by pass_at_1 then slug', () => {
    // A: 7/10 pass, all at attempt 1 => score=70, p1=70
    // B: 7/10 pass, 5 at attempt 1, 2 at attempt 2 => score=70, p1=50
    // C: 9/10 pass, 6 at attempt 1, 3 at attempt 2 => score=90, p1=60
    // Expected order: C (90%), A (70%, p1=70%), B (70%, p1=50%)
    const rows: LeaderboardRow[] = [
      makeRow({ slug: 'A', display_name: 'A', pass_at_n: 0.7, pass_at_1: 0.7, denominator: 10, tasks_passed_attempt_1: 7, tasks_passed_attempt_2_only: 0, tasks_attempted_distinct: 10 }),
      makeRow({ slug: 'B', display_name: 'B', pass_at_n: 0.7, pass_at_1: 0.5, denominator: 10, tasks_passed_attempt_1: 5, tasks_passed_attempt_2_only: 2, tasks_attempted_distinct: 10 }),
      makeRow({ slug: 'C', display_name: 'C', pass_at_n: 0.9, pass_at_1: 0.6, denominator: 10, tasks_passed_attempt_1: 6, tasks_passed_attempt_2_only: 3, tasks_attempted_distinct: 10 }),
    ];
    const { container } = render(HeroChart, { rows, generatedAt: '2026-05-06T00:00:00Z' });
    const rankedTexts = Array.from(
      container.querySelectorAll('.bar-row .bar-model'),
    ).map((el) => el.textContent?.trim());
    expect(rankedTexts).toEqual(['C', 'A', 'B']);
  });

  it('tiebreaks by slug when score and pass_at_1 are equal', () => {
    // Both rows: 7/10, p1=7 => score=70, pass_at_1=0.7
    // Alpha < Beta => Alpha first
    const rows: LeaderboardRow[] = [
      makeRow({ slug: 'Beta', display_name: 'Beta', pass_at_n: 0.7, pass_at_1: 0.7, denominator: 10, tasks_passed_attempt_1: 7, tasks_passed_attempt_2_only: 0, tasks_attempted_distinct: 10 }),
      makeRow({ slug: 'Alpha', display_name: 'Alpha', pass_at_n: 0.7, pass_at_1: 0.7, denominator: 10, tasks_passed_attempt_1: 7, tasks_passed_attempt_2_only: 0, tasks_attempted_distinct: 10 }),
    ];
    const { container } = render(HeroChart, { rows, generatedAt: '2026-05-06T00:00:00Z' });
    const rankedTexts = Array.from(
      container.querySelectorAll('.bar-row .bar-model'),
    ).map((el) => el.textContent?.trim());
    expect(rankedTexts).toEqual(['Alpha', 'Beta']);
  });

  it('renders coverage subtitle when tasks_attempted_distinct < denominator', () => {
    const rows: LeaderboardRow[] = [
      makeRow({ slug: 'A', display_name: 'A', pass_at_n: 0.4, pass_at_1: 0.3, denominator: 10, tasks_passed_attempt_1: 3, tasks_passed_attempt_2_only: 1, tasks_attempted_distinct: 6 }),
    ];
    const { container } = render(HeroChart, { rows, generatedAt: '2026-05-06T00:00:00Z' });
    expect(container.textContent).toContain('6/10 attempted');
    expect(container.querySelector('.bar-coverage')).not.toBeNull();
  });

  it('omits coverage subtitle when tasks_attempted_distinct equals denominator', () => {
    const rows: LeaderboardRow[] = [
      makeRow({ slug: 'A', display_name: 'A', pass_at_n: 0.7, pass_at_1: 0.7, denominator: 10, tasks_passed_attempt_1: 7, tasks_passed_attempt_2_only: 0, tasks_attempted_distinct: 10 }),
    ];
    const { container } = render(HeroChart, { rows, generatedAt: '2026-05-06T00:00:00Z' });
    expect(container.textContent).not.toContain('attempted');
    expect(container.querySelector('.bar-coverage')).toBeNull();
  });

  it('omits coverage subtitle when denominator is undefined', () => {
    const rows: LeaderboardRow[] = [
      makeRow({ slug: 'A', display_name: 'A', pass_at_n: 0.7, pass_at_1: 0.7, denominator: undefined, tasks_passed_attempt_1: 7, tasks_passed_attempt_2_only: 0, tasks_attempted_distinct: 10 }),
    ];
    // Row is filtered out (denominator=0) so no bars at all - just verify no coverage text
    const { container } = render(HeroChart, { rows, generatedAt: '2026-05-06T00:00:00Z' });
    expect(container.querySelector('.bar-coverage')).toBeNull();
  });

  it('filters out rows with zero denominator', () => {
    const rows: LeaderboardRow[] = [
      makeRow({ slug: 'A', display_name: 'A', pass_at_n: 0, pass_at_1: 0, denominator: 0, tasks_passed_attempt_1: 0, tasks_passed_attempt_2_only: 0, tasks_attempted_distinct: 0 }),
      makeRow({ slug: 'B', display_name: 'B', pass_at_n: 0.5, pass_at_1: 0.5, denominator: 10, tasks_passed_attempt_1: 5, tasks_passed_attempt_2_only: 0, tasks_attempted_distinct: 10 }),
    ];
    const { container } = render(HeroChart, { rows, generatedAt: '2026-05-06T00:00:00Z' });
    const barModels = container.querySelectorAll('.bar-row .bar-model');
    expect(barModels.length).toBe(1);
    expect(barModels[0].textContent?.trim()).toBe('B');
  });

  it('uses denominator (not tasks_attempted_distinct) for bar segment widths', () => {
    // denominator=10, tasks_attempted_distinct=6, passed_a1=5 => p1 = 5/10*100 = 50%
    // If it used tasks_attempted_distinct (6), p1 would be ~83.3%
    const rows: LeaderboardRow[] = [
      makeRow({ slug: 'A', display_name: 'A', pass_at_n: 0.5, pass_at_1: 0.5, denominator: 10, tasks_passed_attempt_1: 5, tasks_passed_attempt_2_only: 0, tasks_attempted_distinct: 6 }),
    ];
    const { container } = render(HeroChart, { rows, generatedAt: '2026-05-06T00:00:00Z' });
    const seg = container.querySelector('.bar-seg.seg-a1') as HTMLElement | null;
    expect(seg).not.toBeNull();
    // p1 = 5/10 * 100 = 50%
    expect(parseFloat(seg!.style.width)).toBeCloseTo(50, 1);
  });
});
