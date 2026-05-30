// site/src/lib/components/domain/RecommendationTiles.test.ts
import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import RecommendationTiles from './RecommendationTiles.svelte';
import type { LeaderboardRow } from '$lib/shared/api-types';

function row(p: Partial<LeaderboardRow>): LeaderboardRow {
  return {
    rank: 1, model: { slug: 's', display_name: 'S', api_model_id: 's', settings_suffix: '' },
    family_slug: 'f', run_count: 1, tasks_attempted: 1, tasks_passed: 1,
    tasks_attempted_distinct: 1, tasks_passed_attempt_1: 1, tasks_passed_attempt_2_only: 0,
    pass_at_n: 0.8, pass_at_1: 0.8, auc_2: 0.8, repair_rate: 0, tier: 1, denominator: 1,
    cost_per_pass_usd: 0.1, avg_score: 80, avg_cost_usd: 0.1, verified_runs: 1,
    pass_rate_ci: { lower: 0.7, upper: 0.9 }, latency_p95_ms: 3000,
    pass_hat_at_n: 0.8,
    last_run_at: '2026-05-30T00:00:00Z',
    open_weight: null,
    ...p,
  } as LeaderboardRow;
}

describe('RecommendationTiles', () => {
  it('renders all tile headings', () => {
    const { container } = render(RecommendationTiles, {
      props: { rows: [row({ model: { slug: 'a', display_name: 'A', api_model_id: 'a', settings_suffix: '' } })] },
    });
    const text = container.textContent ?? '';
    expect(text).toMatch(/best overall/i);
    expect(text).toMatch(/best value/i);
    expect(text).toMatch(/fastest/i);
    expect(text).toMatch(/best open-weight/i);
  });

  it('shows the tie note when overall leader is tied in its tier', () => {
    const rows = [
      row({ model: { slug: 'opus', display_name: 'Opus', api_model_id: 'o', settings_suffix: '' }, auc_2: 0.85, tier: 1 }),
      row({ model: { slug: 'gpt', display_name: 'GPT', api_model_id: 'g', settings_suffix: '' }, auc_2: 0.84, tier: 1 }),
    ];
    const { container } = render(RecommendationTiles, { props: { rows } });
    expect(container.textContent).toMatch(/tied with GPT/i);
    expect(container.textContent).toMatch(/Tier 1/i);
  });

  it('renders the Best open-weight tile with the top open model', () => {
    const rows = [
      row({ model: { slug: 'opus', display_name: 'Opus', api_model_id: 'o', settings_suffix: '' }, auc_2: 0.85, open_weight: false }),
      row({ model: { slug: 'ds', display_name: 'DeepSeek', api_model_id: 'd', settings_suffix: '' }, auc_2: 0.71, open_weight: true }),
    ];
    const { container } = render(RecommendationTiles, { props: { rows } });
    expect(container.textContent).toMatch(/best open-weight/i);
    expect(container.textContent).toMatch(/DeepSeek/);
  });
});
