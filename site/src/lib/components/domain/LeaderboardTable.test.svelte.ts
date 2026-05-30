import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import LeaderboardTable from './LeaderboardTable.svelte';
import type { LeaderboardRow } from '$shared/api-types';

function makeRow(overrides: Partial<LeaderboardRow> & { slug: string }): LeaderboardRow {
  return {
    rank: 1,
    family_slug: 'test',
    run_count: 1,
    tasks_attempted: 1,
    tasks_passed: 1,
    tasks_attempted_distinct: 1,
    tasks_passed_attempt_1: 0,
    tasks_passed_attempt_2_only: 0,
    pass_at_n: 0,
    avg_score: 0,
    avg_cost_usd: 0,
    verified_runs: 1,
    last_run_at: '2026-01-01T00:00:00Z',
    latency_p95_ms: 1000,
    pass_rate_ci: { lower: 0, upper: 0 },
    pass_hat_at_n: 0,
    cost_per_pass_usd: null,
    denominator: 1,
    ...overrides,
    model: {
      slug: overrides.slug,
      display_name: overrides.slug,
      api_model_id: overrides.slug,
      settings_suffix: '',
    },
  };
}

const sampleRows: LeaderboardRow[] = [
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
    latency_p95_ms: 12500,
    pass_rate_ci: { lower: 0.88, upper: 0.95 },
    pass_hat_at_n: 0.99,
    cost_per_pass_usd: 0.005,
    auc_2: 0.85,
    repair_rate: 0.2,
    denominator: 24,
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
    latency_p95_ms: 18200,
    pass_rate_ci: { lower: 0.48, upper: 0.84 },
    pass_hat_at_n: 0.91,
    cost_per_pass_usd: null,
    auc_2: 0.6,
    repair_rate: 0.0667,
    denominator: 24,
  },
];

// Alias for backwards compat within this file
const rows = sampleRows;

describe('LeaderboardTable', () => {
  it('renders one row per model', () => {
    render(LeaderboardTable, { rows, sort: 'auc_2:desc' });
    expect(screen.getByText('Sonnet 4.7')).toBeDefined();
    expect(screen.getByText('Opus 4.7')).toBeDefined();
  });

  it('emits sort change when the Cost / task header is clicked', async () => {
    let sort = 'auc_2:desc';
    render(LeaderboardTable, {
      rows,
      sort,
      onsort: (next: string) => {
        sort = next;
      },
    });
    const costBtn = screen.getByRole('button', { name: /cost \/ task/i });
    await fireEvent.click(costBtn);
    expect(sort).toBe('avg_cost_usd:desc');
  });

  it('AUC@2 header click emits auc_2 sort and toggles direction', async () => {
    let sort = 'auc_2:desc';
    render(LeaderboardTable, {
      rows,
      sort,
      onsort: (next: string) => {
        sort = next;
      },
    });
    const aucBtn = screen.getByRole('button', { name: /solve auc@2/i });
    await fireEvent.click(aucBtn);
    // already auc_2:desc → flips to asc
    expect(sort).toBe('auc_2:asc');
  });

  it('headline cell shows auc_2 * 100 with 1 decimal', () => {
    const { container } = render(LeaderboardTable, { rows, sort: 'auc_2:desc' });
    const scoreCells = container.querySelectorAll('td.score [data-test], td.score .auc');
    // Sonnet: auc_2=0.85 * 100 → "85.0"
    expect(container.querySelectorAll('td.score .auc')[0]?.textContent?.trim()).toBe('85.0');
    // Opus: auc_2=0.6 * 100 → "60.0"
    expect(container.querySelectorAll('td.score .auc')[1]?.textContent?.trim()).toBe('60.0');
    expect(scoreCells.length).toBeGreaterThan(0);
  });

  it('renders an OutcomeMixBar in each headline cell', () => {
    const { container } = render(LeaderboardTable, { rows, sort: 'auc_2:desc' });
    const bars = container.querySelectorAll('td.score .bar');
    expect(bars.length).toBe(2);
  });

  it('renders inline CI as a half-width ± value', () => {
    const { container } = render(LeaderboardTable, { rows, sort: 'auc_2:desc' });
    const ciCells = container.querySelectorAll('td.ci');
    // Sonnet: (0.95-0.88)/2*100 = 3.5
    expect(ciCells[0]?.textContent?.trim()).toBe('±3.5');
    // Opus: (0.84-0.48)/2*100 = 18.0
    expect(ciCells[1]?.textContent?.trim()).toBe('±18.0');
  });

  it('renders p95 latency in seconds', () => {
    const { container } = render(LeaderboardTable, { rows, sort: 'auc_2:desc' });
    expect(container.textContent).toContain('12.5s');
    expect(container.textContent).toContain('18.2s');
  });

  it('renders SettingsBadge only when suffix is non-empty', () => {
    const { container } = render(LeaderboardTable, { rows, sort: 'auc_2:desc' });
    const badges = container.querySelectorAll('.settings-badge');
    // Sonnet (suffix ' (50K, t0)') → 1 badge; Opus ('') → 0
    expect(badges.length).toBe(1);
    expect(badges[0]?.textContent).toBe(' (50K, t0)');
  });

  it('defaults to auc_2:desc: auc-2-header has aria-sort descending', () => {
    const { container } = render(LeaderboardTable, {
      rows: sampleRows,
      sort: 'auc_2:desc',
    });
    const aucHeader = container.querySelector('[data-test="auc-2-header"]');
    expect(aucHeader?.getAttribute('aria-sort')).toBe('descending');
  });

  it('Model header is non-sortable (no click button)', () => {
    const { container } = render(LeaderboardTable, {
      rows: sampleRows,
      sort: 'auc_2:desc',
    });
    const modelHeader = Array.from(container.querySelectorAll('th')).find((th) =>
      th.textContent?.trim() === 'Model',
    );
    expect(modelHeader).toBeDefined();
    expect(modelHeader?.querySelector('button')).toBeNull();
  });

  it('renders only the trimmed column set (no removed columns)', () => {
    const { container } = render(LeaderboardTable, { rows: sampleRows, sort: 'auc_2:desc' });
    const headerText = Array.from(container.querySelectorAll('thead th'))
      .map((th) => th.textContent?.trim() ?? '')
      .join(' ');
    expect(headerText).not.toContain('Avg score');
    expect(headerText).not.toContain('Best-of-2');
    expect(headerText).not.toContain('Repair');
    expect(headerText).not.toContain('Cost / pass');
    expect(headerText).not.toContain('Last seen');
    expect(container.querySelector('.metric-toggle')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Tier divider rows
  // ---------------------------------------------------------------------------

  it('renders a tier divider row between tier 1 and tier 2', () => {
    const tierRows = [
      makeRow({ slug: 'a', auc_2: 0.9, tier: 1 }),
      makeRow({ slug: 'b', auc_2: 0.88, tier: 1 }),
      makeRow({ slug: 'c', auc_2: 0.7, tier: 2 }),
    ];
    const { container } = render(LeaderboardTable, { props: { rows: tierRows, sort: 'auc_2:desc' } });
    expect(container.querySelectorAll('[data-test="tier-divider"]').length).toBe(1);
  });

  it('renders no tier dividers when rows have no tier field', () => {
    const noTier = sampleRows.map((r) => ({ ...r, tier: undefined }));
    const { container } = render(LeaderboardTable, { props: { rows: noTier, sort: 'auc_2:desc' } });
    expect(container.querySelectorAll('[data-test="tier-divider"]').length).toBe(0);
  });

  it('renders two tier dividers for three distinct tiers', () => {
    const tierRows = [
      makeRow({ slug: 'a', auc_2: 0.9, tier: 1 }),
      makeRow({ slug: 'b', auc_2: 0.7, tier: 2 }),
      makeRow({ slug: 'c', auc_2: 0.5, tier: 3 }),
    ];
    const { container } = render(LeaderboardTable, { props: { rows: tierRows, sort: 'auc_2:desc' } });
    expect(container.querySelectorAll('[data-test="tier-divider"]').length).toBe(2);
  });

  it('non-monotonic tier sequence [tier1, tier2, tier1] renders exactly one divider', () => {
    const tierRows = [
      makeRow({ slug: 'a', auc_2: 0.9, tier: 1 }),
      makeRow({ slug: 'b', auc_2: 0.7, tier: 2 }),
      makeRow({ slug: 'c', auc_2: 0.65, tier: 1 }), // tier goes "backwards"
    ];
    const { container } = render(LeaderboardTable, { props: { rows: tierRows, sort: 'auc_2:desc' } });
    expect(container.querySelectorAll('[data-test="tier-divider"]').length).toBe(1);
  });
});
