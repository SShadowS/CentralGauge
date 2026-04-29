import { describe, it, expect, beforeEach } from 'vitest';
import { getTheme, getEffectiveTheme, setTheme, cycleTheme } from './theme';

describe('theme controller', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('getTheme returns "system" when nothing stored', () => {
    expect(getTheme()).toBe('system');
  });

  it('getTheme returns the stored value', () => {
    localStorage.setItem('theme', 'dark');
    expect(getTheme()).toBe('dark');
  });

  it('setTheme writes to DOM + storage', () => {
    setTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('setTheme("system") removes the attribute and clears storage', () => {
    setTheme('dark');
    setTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('theme')).toBe(null);
  });

  it('getEffectiveTheme resolves "system" via prefers-color-scheme (jsdom default: light)', () => {
    expect(getEffectiveTheme()).toBe('light');
  });

  it('getEffectiveTheme returns the stored explicit value', () => {
    setTheme('dark');
    expect(getEffectiveTheme()).toBe('dark');
  });

  it('cycleTheme flips light → dark', () => {
    setTheme('light');
    cycleTheme();
    expect(getTheme()).toBe('dark');
  });

  it('cycleTheme flips dark → light', () => {
    setTheme('dark');
    cycleTheme();
    expect(getTheme()).toBe('light');
  });

  it('cycleTheme from "system" picks the OPPOSITE of the resolved theme', () => {
    // jsdom default: prefers-color-scheme returns light → effective is light
    // → cycle should produce 'dark'.
    setTheme('system');
    cycleTheme();
    expect(getTheme()).toBe('dark');
  });
});
