// site/src/lib/components/domain/ValueMap.test.ts
import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import ValueMap from './ValueMap.svelte';
import { leaderboardValueInputs } from '$lib/shared/value-map';
import type { LeaderboardRow } from '$lib/shared/api-types';

function row(slug: string, auc_2: number, avg_cost_usd: number): LeaderboardRow {
  return {
    rank: 1, model: { slug, display_name: slug.toUpperCase(), api_model_id: slug, settings_suffix: '' },
    family_slug: 'f', run_count: 1, tasks_attempted: 1, tasks_passed: 1,
    tasks_attempted_distinct: 1, tasks_passed_attempt_1: 1, tasks_passed_attempt_2_only: 0,
    pass_at_n: auc_2, pass_at_1: auc_2, auc_2, repair_rate: 0, tier: 1, denominator: 1,
    cost_per_pass_usd: avg_cost_usd, avg_score: 70, avg_cost_usd, verified_runs: 1,
    pass_rate_ci: { lower: 0, upper: 1 }, latency_p95_ms: 1000,
    last_run_at: '2026-05-30T00:00:00Z', open_weight: null, pass_hat_at_n: auc_2,
  } as LeaderboardRow;
}

describe('ValueMap', () => {
  it('renders a dot per priced model, each linking to its model page', () => {
    const { container } = render(ValueMap, { props: { points: leaderboardValueInputs([row('a', 0.8, 0.1), row('b', 0.6, 0.05)]) } });
    const links = container.querySelectorAll('a[href^="/models/"]');
    expect(links.length).toBe(2);
    expect(container.querySelector('a[href="/models/a"]')).not.toBeNull();
  });

  it('shows an omitted-count note when a model has no cost', () => {
    const { container } = render(ValueMap, { props: { points: leaderboardValueInputs([row('a', 0.8, 0.1), row('free', 0.5, 0)]) } });
    expect(container.textContent).toMatch(/1 model.*omitted/i);
  });

  it('honours noun, yLabel, hrefBase and xLabel props', () => {
    const { container } = render(ValueMap, {
      props: {
        points: [
          { slug: 's1', display_name: 'S1', cost: 0.1, y: 70, provisional: false },
          { slug: 'nocost', display_name: 'No cost', cost: null, y: 50, provisional: false },
        ],
        noun: 'setup',
        yLabel: 'Score',
        hrefBase: '/setups',
        xLabel: 'Price / solved task (log)',
      },
    });
    expect(container.querySelector('a[href="/setups/s1"]')).not.toBeNull();
    expect(container.textContent).toContain('1 setup with no cost data omitted');
    expect(container.textContent).toContain('Price / solved task (log)');
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('Cost vs Score scatter, 1 setup');
  });

  it('renders an empty state when no models are priced', () => {
    const { container } = render(ValueMap, { props: { points: leaderboardValueInputs([row('free', 0.5, 0)]) } });
    expect(container.textContent).toMatch(/no cost data/i);
  });
});
