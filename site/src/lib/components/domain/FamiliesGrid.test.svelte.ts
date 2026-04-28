import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import FamiliesGrid from './FamiliesGrid.svelte';
import type { FamiliesIndexItem } from '$shared/api-types';

const items: FamiliesIndexItem[] = [
  { slug: 'claude', display_name: 'Anthropic Claude', vendor: 'Anthropic', model_count: 4, latest_avg_score: 0.82, latest_model_slug: 'sonnet-4-7' },
  { slug: 'gpt',    display_name: 'OpenAI GPT',       vendor: 'OpenAI',    model_count: 3, latest_avg_score: 0.71, latest_model_slug: 'gpt-5' },
];

describe('FamiliesGrid', () => {
  it('renders one card per family', () => {
    const { container } = render(FamiliesGrid, { items });
    expect(container.querySelectorAll('article').length).toBe(2);
  });

  it('shows display name and member count', () => {
    render(FamiliesGrid, { items });
    expect(screen.getByText('Anthropic Claude')).toBeDefined();
    expect(screen.getByText(/4 models/)).toBeDefined();
  });

  it('links to the family detail page', () => {
    const { container } = render(FamiliesGrid, { items });
    const a = container.querySelector('a[href="/families/claude"]');
    expect(a).not.toBeNull();
  });
});
