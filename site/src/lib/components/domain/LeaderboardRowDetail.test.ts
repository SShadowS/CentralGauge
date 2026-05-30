import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import LeaderboardRowDetail from './LeaderboardRowDetail.svelte';
import type { LeaderboardRow } from '$lib/shared/api-types';

function row(p: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    rank: 1, model: { slug: 'opus', display_name: 'Opus', api_model_id: 'o', settings_suffix: '' },
    family_slug: 'f', run_count: 3, tasks_attempted: 100, tasks_passed: 79,
    tasks_attempted_distinct: 100, tasks_passed_attempt_1: 55, tasks_passed_attempt_2_only: 24,
    pass_at_n: 0.79, pass_at_1: 0.55, auc_2: 0.67, repair_rate: 0.53, tier: 1, denominator: 100,
    cost_per_pass_usd: 0.27, avg_score: 70, avg_cost_usd: 0.21, verified_runs: 2,
    pass_rate_ci: { lower: 0.64, upper: 0.70 }, latency_p95_ms: 8400,
    last_run_at: '2026-05-30T00:00:00Z', open_weight: false, pass_hat_at_n: 0.79,
    ...p,
  } as LeaderboardRow;
}

describe('LeaderboardRowDetail', () => {
  it('shows reliability, cost, latency and a full-report link', () => {
    const { container, getByRole } = render(LeaderboardRowDetail, { props: { row: row() } });
    const text = container.textContent ?? '';
    expect(text).toMatch(/repair/i);
    expect(text).toMatch(/55/);
    expect(text).toMatch(/79/);
    expect(text).toMatch(/8\.4s/);
    const link = getByRole('link', { name: /full report/i });
    expect(link.getAttribute('href')).toBe('/models/opus');
  });

  it('renders an em dash for null cost/pass', () => {
    const { container } = render(LeaderboardRowDetail, { props: { row: row({ cost_per_pass_usd: null }) } });
    expect(container.textContent).toContain('—');
  });
});
