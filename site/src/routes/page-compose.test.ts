import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';

// $app/navigation and $app/state are resolved via aliases in
// vitest.unit.config.ts (tests/mocks/app-navigation.ts + app-state.ts).
// No inline vi.mock needed — the aliased stubs are complete.

import Page from './+page.svelte';
import type { PageData } from './$types';

const data = {
  leaderboard: {
    data: [{
      rank: 1, model: { slug: 'opus', display_name: 'Opus', api_model_id: 'o', settings_suffix: '' },
      family_slug: 'f', run_count: 1, tasks_attempted: 100, tasks_passed: 79,
      tasks_attempted_distinct: 100, tasks_passed_attempt_1: 55, tasks_passed_attempt_2_only: 24,
      pass_at_n: 0.79, pass_at_1: 0.55, auc_2: 0.67, repair_rate: 0.53, tier: 1, denominator: 100,
      cost_per_pass_usd: 0.27, avg_score: 70, avg_cost_usd: 0.21, verified_runs: 1,
      pass_rate_ci: { lower: 0.64, upper: 0.70 }, latency_p95_ms: 8400, last_run_at: '2026-05-30T00:00:00Z',
    }],
    next_cursor: null, generated_at: '2026-05-30T10:00:00Z',
    filters: { set: 'current', tier: 'all', difficulty: null, family: null, since: null, category: null, sort: 'auc_2', direction: 'desc', limit: 50, cursor: null },
  },
  sort: 'auc_2:desc',
  filters: { set: 'current', category: null },
  categories: [{ slug: 'tables', name: 'Tables', task_count: 64, avg_pass_rate: 0.5 }],
  summary: { runs: 1, models: 1, tasks: 512, total_cost_usd: 0, total_tokens: 0, last_run_at: null, latest_changelog: null, generated_at: '2026-05-30T10:00:00Z' },
  taskSets: [],
  serverTime: '2026-05-30T10:00:00Z',
  flags: { sse_live_updates: false },
  buildSha: 'test-sha',
  buildAt: '2026-05-30T10:00:00Z',
  cfWebAnalyticsToken: null,
};

describe('Leaderboard page composition', () => {
  it('renders freshness strip, tiles, presets, and the AUC table headline', () => {
    // buildSha/buildAt are merged from the layout's data, not page-level PageData — cast is expected.
    const { container } = render(Page, { props: { data: data as unknown as PageData } });
    const text = container.textContent ?? '';
    expect(text).toContain('512 tasks');       // FreshnessStrip
    expect(text).toMatch(/best overall/i);      // RecommendationTiles
    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull(); // SortPresets
    expect(container.querySelector('[data-test="auc-cell"]')?.textContent).toContain('67.0');
  });

  it('renders category tabs (All + per category) and no sidebar Category fieldset', () => {
    const { container, getAllByRole } = render(Page, { props: { data: data as unknown as PageData } });
    const radiogroups = getAllByRole('radiogroup');
    expect(radiogroups.length).toBe(4); // SortPresets + CategoryTabs + OpennessFilter + ViewToggle
    expect(container.textContent).toMatch(/all tasks/i);
    expect(container.textContent).toMatch(/Tables/);
    expect(container.textContent).toMatch(/proprietary/i); // OpennessFilter rendered
    // old sidebar Category legend gone:
    const legends = Array.from(container.querySelectorAll('legend')).map((l) => l.textContent?.trim());
    expect(legends).not.toContain('Category');
  });

  it('defaults to the table view and offers a value-map toggle', () => {
    const { container, getByRole } = render(Page, { props: { data: data as unknown as PageData } });
    expect(getByRole('radio', { name: /value map/i })).not.toBeNull();
    // table headline present by default
    expect(container.querySelector('[data-test="auc-cell"]')).not.toBeNull();
  });
});
