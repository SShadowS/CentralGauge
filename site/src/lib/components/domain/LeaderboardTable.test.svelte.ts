import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
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
  },
];

// Alias for backwards compat within this file
const rows = sampleRows;

describe('LeaderboardTable', () => {
  it('renders one row per model', () => {
    render(LeaderboardTable, { rows, sort: 'pass_at_n:desc' });
    expect(screen.getByText('Sonnet 4.7')).toBeDefined();
    expect(screen.getByText('Opus 4.7')).toBeDefined();
  });

  it('emits sort change when a sortable header is clicked', async () => {
    let sort = 'avg_score:desc';
    const { container } = render(LeaderboardTable, {
      rows,
      sort,
      onsort: (next: string) => {
        sort = next;
      },
    });
    // "Avg score" header sorts by avg_score (renamed from "Avg attempt").
    // Scope to thead to avoid collision with the same-label toggle button.
    const thead = container.querySelector('thead')!;
    const avgBtn = within(thead).getByRole('button', { name: /avg score/i });
    await fireEvent.click(avgBtn);
    expect(sort).toBe('avg_score:asc');
  });

  it('Score column (headline) shows auc_2 * 100 with 1 decimal', () => {
    const { container } = render(LeaderboardTable, { rows, sort: 'auc_2:desc' });
    const scoreCells = container.querySelectorAll('td.score');
    // Sonnet: auc_2=0.85 * 100 → "85.0"
    expect(scoreCells[0]?.textContent?.trim()).toBe('85.0');
    // Opus: auc_2=0.6 * 100 → "60.0"
    expect(scoreCells[1]?.textContent?.trim()).toBe('60.0');
  });

  it('renders AttemptStackedBar in each row', () => {
    const { container } = render(LeaderboardTable, { rows, sort: 'pass_at_n:desc' });
    const bars = container.querySelectorAll('.attempts-cell .bar');
    expect(bars.length).toBe(2);
  });

  it('renders pass ratio using denominator when present', () => {
    const rowsWithDenominator: LeaderboardRow[] = [
      {
        ...sampleRows[0],
        denominator: 30,
      },
      {
        ...sampleRows[1],
        denominator: 30,
      },
    ];
    const { container } = render(LeaderboardTable, {
      rows: rowsWithDenominator,
      sort: 'pass_at_n:desc',
    });
    const ratios = container.querySelectorAll('.attempts-cell .ratio');
    // Sonnet: (20+2)/30 = 22/30
    expect(ratios[0]?.textContent?.trim()).toBe('22/30');
    // Opus: (15+1)/30 = 16/30
    expect(ratios[1]?.textContent?.trim()).toBe('16/30');
  });

  it('renders pass ratio falling back to tasks_attempted_distinct when denominator absent', () => {
    const { container } = render(LeaderboardTable, { rows, sort: 'pass_at_n:desc' });
    const ratios = container.querySelectorAll('.attempts-cell .ratio');
    expect(ratios[0]?.textContent?.trim()).toBe('22/24');
    expect(ratios[1]?.textContent?.trim()).toBe('16/24');
  });

  it('renders SettingsBadge only when suffix is non-empty', () => {
    const { container } = render(LeaderboardTable, { rows, sort: 'pass_at_n:desc' });
    const badges = container.querySelectorAll('.settings-badge');
    // Sonnet (suffix ' (50K, t0)') → 1 badge; Opus ('') → 0
    expect(badges.length).toBe(1);
    expect(badges[0]?.textContent).toBe(' (50K, t0)');
  });

  it('Pass header click emits pass_at_1 sort', async () => {
    let sort = 'pass_at_n:desc';
    render(LeaderboardTable, {
      rows,
      sort,
      onsort: (next: string) => {
        sort = next;
      },
    });
    const passBtn = screen.getByRole('button', { name: /^Pass/i });
    await fireEvent.click(passBtn);
    expect(sort).toBe('pass_at_1:desc');
  });

  // D.2 tests — default sort + column alignment

  it('defaults to auc_2:desc: auc-2-header has aria-sort descending', async () => {
    const { container } = render(LeaderboardTable, {
      rows: sampleRows,
      sort: 'auc_2:desc',
    });
    const aucHeader = container.querySelector('[data-test="auc-2-header"]');
    expect(aucHeader?.getAttribute('aria-sort')).toBe('descending');
  });

  it('Best-of-2 column renders pass_at_n * 100 (1 decimal)', async () => {
    const rowsFixture: LeaderboardRow[] = [
      {
        ...sampleRows[0],
        pass_at_n: 0.732,
      },
    ];
    const { container } = render(LeaderboardTable, { rows: rowsFixture, sort: 'auc_2:desc' });
    expect(container.textContent).toContain('73.2');
  });

  it('demoted Avg score column header is present in DOM', async () => {
    const { container } = render(LeaderboardTable, {
      rows: sampleRows,
      sort: 'pass_at_n:desc',
    });
    const headers = Array.from(container.querySelectorAll('th'));
    const avgHeader = headers.find((th) => th.textContent?.includes('Avg score'));
    expect(avgHeader).toBeDefined();
    expect(avgHeader?.classList.contains('th-avg-attempt')).toBe(true);
  });

  it('Avg score cells render avg_score on the X.X / 100 score scale', async () => {
    const { container } = render(LeaderboardTable, {
      rows: sampleRows,
      sort: 'pass_at_n:desc',
    });
    const avgCells = container.querySelectorAll('td.th-avg-attempt');
    // Fixture uses 0-1 scale historically; the formatter still prefixes
    // "/ 100" so users cannot confuse the value with a percent.
    expect(avgCells[0]?.textContent?.trim()).toBe('0.8 / 100');
    expect(avgCells[1]?.textContent?.trim()).toBe('0.7 / 100');
  });

  it('Model header is non-sortable (no click button)', async () => {
    const { container } = render(LeaderboardTable, {
      rows: sampleRows,
      sort: 'pass_at_n:desc',
    });
    const modelHeader = Array.from(container.querySelectorAll('th')).find((th) =>
      th.textContent?.trim() === 'Model',
    );
    expect(modelHeader).toBeDefined();
    expect(modelHeader?.querySelector('button')).toBeNull();
  });

  it('Last seen header is non-sortable (no click button)', async () => {
    const { container } = render(LeaderboardTable, {
      rows: sampleRows,
      sort: 'pass_at_n:desc',
    });
    const lastSeenHeader = Array.from(container.querySelectorAll('th')).find((th) =>
      th.textContent?.trim() === 'Last seen',
    );
    expect(lastSeenHeader).toBeDefined();
    expect(lastSeenHeader?.querySelector('button')).toBeNull();
  });

  it('renders Solve AUC@2 as the headline column value', () => {
    const rows = [makeRow({ slug: 'm', auc_2: 0.8, pass_at_n: 0.9, repair_rate: 0.6667 })];
    const { getByText } = render(LeaderboardTable, { props: { rows, sort: 'auc_2:desc' } });
    expect(getByText('80.0')).toBeInTheDocument(); // headline = auc_2*100
    expect(getByText('66.7%')).toBeInTheDocument(); // repair column
  });

  it('toggling the headline metric calls onsort with the chosen field', async () => {
    const onsort = vi.fn();
    const rows = [makeRow({ slug: 'm', auc_2: 0.8, pass_at_1: 0.7, pass_at_n: 0.9, avg_score: 84 })];
    const { getByRole } = render(LeaderboardTable, { props: { rows, sort: 'auc_2:desc', onsort } });
    await fireEvent.click(getByRole('button', { name: /first-try/i }));
    expect(onsort).toHaveBeenCalledWith('pass_at_1:desc');
  });

  it('each metric-toggle button has a layman hover tooltip', () => {
    const rows = [makeRow({ slug: 'm', auc_2: 0.8, pass_at_1: 0.7, pass_at_n: 0.9, avg_score: 84 })];
    const { container } = render(LeaderboardTable, { props: { rows, sort: 'auc_2:desc' } });
    const segs = Array.from(
      container.querySelectorAll('.metric-toggle .seg'),
    ) as HTMLButtonElement[];
    expect(segs.length).toBe(4);
    // Every toggle option must carry a non-empty plain-language title (hover).
    for (const seg of segs) {
      expect(seg.getAttribute('title')?.length ?? 0).toBeGreaterThan(0);
    }
    // The jargon label "Solve AUC@2" must be explained in its tooltip.
    const auc = segs.find((s) => s.textContent?.includes('Solve AUC@2'))!;
    expect(auc.getAttribute('title')).toMatch(/first try/i);
  });

  it('headline cell reflects the active metric', () => {
    const rows = [makeRow({ slug: 'm', auc_2: 0.8, pass_at_n: 0.9, pass_at_1: 0.7, avg_score: 84 })];
    const a = render(LeaderboardTable, { props: { rows, sort: 'auc_2:desc' } });
    expect(a.container.querySelector('td.score')?.textContent?.trim()).toBe('80.0');
    a.unmount();
    const b = render(LeaderboardTable, { props: { rows, sort: 'pass_at_n:desc' } });
    expect(b.container.querySelector('td.score')?.textContent?.trim()).toBe('90.0');
  });

  // ---------------------------------------------------------------------------
  // Task 12 — tier divider rows
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
    const { container } = render(LeaderboardTable, { props: { rows: sampleRows, sort: 'auc_2:desc' } });
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
    // Simulates a tier/row-order disagreement: the tier engine may assign tier1
    // to a model that the SQL row order places after a tier2 model. The defensive
    // watermark must suppress the spurious second divider.
    const tierRows = [
      makeRow({ slug: 'a', auc_2: 0.9, tier: 1 }),
      makeRow({ slug: 'b', auc_2: 0.7, tier: 2 }),
      makeRow({ slug: 'c', auc_2: 0.65, tier: 1 }), // tier goes "backwards"
    ];
    const { container } = render(LeaderboardTable, { props: { rows: tierRows, sort: 'auc_2:desc' } });
    // Only one divider: before the first tier-2 row. The tier-1 row at the end
    // must NOT produce a second divider because maxSeen is already 2.
    expect(container.querySelectorAll('[data-test="tier-divider"]').length).toBe(1);
  });
});
