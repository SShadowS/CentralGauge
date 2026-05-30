// site/src/lib/components/domain/SortPresets.test.ts
import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import SortPresets from './SortPresets.svelte';

describe('SortPresets', () => {
  it('renders three buttons with formulas and marks the active one', () => {
    const { getByRole } = render(SortPresets, { props: { sort: 'auc_2:desc', onpreset: () => {} } });
    const skill = getByRole('button', { name: /skill/i });
    expect(skill.getAttribute('aria-pressed')).toBe('true');
  });

  it('emits the server sort string when a preset is clicked', async () => {
    const onpreset = vi.fn();
    const { getByRole } = render(SortPresets, { props: { sort: 'auc_2:desc', onpreset } });
    await fireEvent.click(getByRole('button', { name: /value/i }));
    expect(onpreset).toHaveBeenCalledWith('cost_per_pass_usd:asc');
  });
});
