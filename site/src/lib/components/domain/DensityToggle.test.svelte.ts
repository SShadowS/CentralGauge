import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import DensityToggle from './DensityToggle.svelte';
import { densityBus } from '$lib/client/density-bus.svelte';

describe('DensityToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-density');
    densityBus.setDensity('comfortable');
  });

  it('renders both density buttons', () => {
    const { getByRole } = render(DensityToggle);
    expect(getByRole('button', { name: /comfortable/i })).toBeDefined();
    expect(getByRole('button', { name: /compact/i })).toBeDefined();
  });

  it('clicking compact button updates densityBus', async () => {
    const { getByRole } = render(DensityToggle);
    await fireEvent.click(getByRole('button', { name: /compact/i }));
    expect(densityBus.density).toBe('compact');
  });

  it('aria-pressed reflects current density', () => {
    densityBus.setDensity('compact');
    const { getByRole } = render(DensityToggle);
    const compact = getByRole('button', { name: /compact/i });
    expect(compact.getAttribute('aria-pressed')).toBe('true');
  });
});
