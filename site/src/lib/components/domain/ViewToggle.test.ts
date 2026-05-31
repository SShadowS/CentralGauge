// site/src/lib/components/domain/ViewToggle.test.ts
import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import ViewToggle from './ViewToggle.svelte';

describe('ViewToggle', () => {
  it('marks the active view and emits the other on click', async () => {
    const onselect = vi.fn();
    const { getByRole } = render(ViewToggle, { props: { value: 'table', onselect } });
    expect(getByRole('radio', { name: /table/i }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(getByRole('radio', { name: /value map/i }));
    expect(onselect).toHaveBeenCalledWith('value-map');
  });
});
