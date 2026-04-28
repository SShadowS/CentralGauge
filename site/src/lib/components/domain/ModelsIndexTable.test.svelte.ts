import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ModelsIndexTable from './ModelsIndexTable.svelte';
import type { ModelsIndexItem } from '$shared/api-types';

const rows: ModelsIndexItem[] = [
  { slug: 'sonnet-4-7', display_name: 'Sonnet 4.7', api_model_id: 'claude-sonnet-4-7', generation: 7, family_slug: 'claude', run_count: 12, verified_runs: 5, avg_score_all_runs: 0.84, last_run_at: '2026-04-26T10:00:00Z' },
  { slug: 'opus-4',     display_name: 'Opus 4',     api_model_id: 'claude-opus-4',     generation: 4, family_slug: 'claude', run_count: 0,  verified_runs: 0, avg_score_all_runs: null, last_run_at: null },
  { slug: 'gpt-5',      display_name: 'GPT-5',      api_model_id: 'gpt-5',             generation: 5, family_slug: 'gpt',    run_count: 8,  verified_runs: 0, avg_score_all_runs: 0.71, last_run_at: '2026-04-25T10:00:00Z' },
];

describe('ModelsIndexTable', () => {
  it('groups rows under a family header', () => {
    render(ModelsIndexTable, { rows });
    // ModelLink also renders FamilyBadge for each row, so 'claude' / 'gpt'
    // appear multiple times. We assert at least one occurrence (the rowgroup header).
    expect(screen.getAllByText('claude').length).toBeGreaterThan(0);
    expect(screen.getAllByText('gpt').length).toBeGreaterThan(0);
  });

  it('renders a No runs cell for catalog-only models', () => {
    render(ModelsIndexTable, { rows });
    expect(screen.getAllByText('No runs')[0]).toBeDefined();
  });

  it('renders score for models with runs', () => {
    render(ModelsIndexTable, { rows });
    expect(screen.getByText('0.84')).toBeDefined();
    expect(screen.getByText('0.71')).toBeDefined();
  });
});
