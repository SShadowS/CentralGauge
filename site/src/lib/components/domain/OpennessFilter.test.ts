import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import OpennessFilter from './OpennessFilter.svelte';

describe('OpennessFilter', () => {
  it('marks All active when value is null and emits a choice on click', async () => {
    const onselect = vi.fn();
    const { getByRole } = render(OpennessFilter, { props: { value: null, onselect } });
    expect(getByRole('radio', { name: /^all$/i }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(getByRole('radio', { name: /open/i }));
    expect(onselect).toHaveBeenCalledWith('open');
  });
  it('marks the active value and emits null when All is clicked', async () => {
    const onselect = vi.fn();
    const { getByRole } = render(OpennessFilter, { props: { value: 'open', onselect } });
    expect(getByRole('radio', { name: /open/i }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(getByRole('radio', { name: /^all$/i }));
    expect(onselect).toHaveBeenCalledWith(null);
  });
  it('emits proprietary on click', async () => {
    const onselect = vi.fn();
    const { getByRole } = render(OpennessFilter, { props: { value: null, onselect } });
    await fireEvent.click(getByRole('radio', { name: /proprietary/i }));
    expect(onselect).toHaveBeenCalledWith('proprietary');
  });
});
