import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import CostBarChart from './CostBarChart.svelte';
import type { ModelHistoryPoint } from '$shared/api-types';

const points: ModelHistoryPoint[] = [
  { run_id: 'a', ts: '2026-01-01T00:00:00Z', score: 0.5, cost_usd: 0.01, tier: 'claimed' },
  { run_id: 'b', ts: '2026-01-02T00:00:00Z', score: 0.7, cost_usd: 0.05, tier: 'claimed' },
];

describe('CostBarChart', () => {
  it('renders one bar per point', () => {
    const { container } = render(CostBarChart, { points });
    expect(container.querySelectorAll('rect')).toHaveLength(2);
  });

  it('renders empty-state message when points is empty', () => {
    const { getByText } = render(CostBarChart, { points: [] });
    expect(getByText(/no cost data/i)).toBeDefined();
  });
});
