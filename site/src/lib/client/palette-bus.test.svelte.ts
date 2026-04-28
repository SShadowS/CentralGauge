import { describe, it, expect, beforeEach } from 'vitest';
import { paletteBus } from './palette-bus.svelte';

describe('paletteBus', () => {
  beforeEach(() => { paletteBus.close(); });

  it('starts closed', () => {
    expect(paletteBus.open).toBe(false);
  });

  it('open() sets state true', () => {
    paletteBus.openPalette();
    expect(paletteBus.open).toBe(true);
  });

  it('close() resets to false', () => {
    paletteBus.openPalette();
    paletteBus.close();
    expect(paletteBus.open).toBe(false);
  });

  it('toggle() flips state', () => {
    paletteBus.toggle();
    expect(paletteBus.open).toBe(true);
    paletteBus.toggle();
    expect(paletteBus.open).toBe(false);
  });
});
