// site/src/lib/components/domain/SortPresets.test.ts
import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import SortPresets from './SortPresets.svelte';

describe('SortPresets', () => {
  it('renders three radios and marks the active one (skill)', () => {
    const { getByRole } = render(SortPresets, { props: { sort: 'auc_2:desc', onpreset: () => {} } });
    expect(getByRole('radio', { name: /skill/i }).getAttribute('aria-checked')).toBe('true');
  });

  it('marks value active when sort is cost_per_pass_usd:asc', () => {
    const { getByRole } = render(SortPresets, { props: { sort: 'cost_per_pass_usd:asc', onpreset: () => {} } });
    expect(getByRole('radio', { name: /value/i }).getAttribute('aria-checked')).toBe('true');
  });

  it('marks speed active when sort is latency_p95_ms:asc', () => {
    const { getByRole } = render(SortPresets, { props: { sort: 'latency_p95_ms:asc', onpreset: () => {} } });
    expect(getByRole('radio', { name: /speed/i }).getAttribute('aria-checked')).toBe('true');
  });

  it('emits the server sort string when a preset is clicked', async () => {
    const onpreset = vi.fn();
    const { getByRole } = render(SortPresets, { props: { sort: 'auc_2:desc', onpreset } });
    await fireEvent.click(getByRole('radio', { name: /value/i }));
    expect(onpreset).toHaveBeenCalledWith('cost_per_pass_usd:asc');
  });
});
