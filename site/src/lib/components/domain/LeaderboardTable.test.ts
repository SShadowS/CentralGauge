import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import LeaderboardTable from './LeaderboardTable.svelte';
import type { LeaderboardRow } from '$lib/shared/api-types';

function row(p: Partial<LeaderboardRow>): LeaderboardRow {
  return {
    rank: 1, model: { slug: 'opus', display_name: 'Opus', api_model_id: 'o', settings_suffix: '' },
    family_slug: 'f', run_count: 1, tasks_attempted: 100, tasks_passed: 79,
    tasks_attempted_distinct: 100, tasks_passed_attempt_1: 55, tasks_passed_attempt_2_only: 24,
    pass_at_n: 0.79, pass_at_1: 0.55, auc_2: 0.67, repair_rate: 0.53, tier: 1, denominator: 100,
    cost_per_pass_usd: 0.27, avg_score: 70, avg_cost_usd: 0.21, verified_runs: 1,
    pass_hat_at_n: 0.79,
    pass_rate_ci: { lower: 0.64, upper: 0.70 }, latency_p95_ms: 8400,
    last_run_at: '2026-05-30T00:00:00Z', ...p,
  } as LeaderboardRow;
}

describe('LeaderboardTable headline', () => {
  it('shows the AUC@2 value (67.0), never the solved fraction (79.0)', () => {
    const { container } = render(LeaderboardTable, { props: { rows: [row({})], sort: 'auc_2:desc' } });
    const scoreCell = container.querySelector('[data-test="auc-cell"]');
    expect(scoreCell?.textContent).toContain('67.0');
    expect(scoreCell?.textContent).not.toContain('79.0');
  });

  it('renders inline CI as a half-width ± value', () => {
    const { container } = render(LeaderboardTable, { props: { rows: [row({})], sort: 'auc_2:desc' } });
    expect(container.textContent).toContain('±3.0');
  });
});
