import { describe, it, expect, beforeEach } from 'vitest';
import { getTheme, setTheme, cycleTheme, type Theme } from './theme';

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

  it('cycleTheme cycles light -> dark -> system -> light', () => {
    setTheme('light');
    cycleTheme();
    expect(getTheme()).toBe('dark');
    cycleTheme();
    expect(getTheme()).toBe('system');
    cycleTheme();
    expect(getTheme()).toBe('light');
  });
});
