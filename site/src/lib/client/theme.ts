/**
 * Theme controller. Three states: light / dark / system (default).
 * - "system" → no data-theme attribute; CSS @media (prefers-color-scheme) applies
 * - "light" / "dark" → data-theme set on <html>, persisted in localStorage
 *
 * Companion no-flash inline script lives in app.html and runs before any paint.
 */

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';

export function getTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'system';
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function setTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem(STORAGE_KEY);
  } else {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }
}

export function cycleTheme(): Theme {
  const order: Theme[] = ['light', 'dark', 'system'];
  const current = getTheme();
  const next = order[(order.indexOf(current) + 1) % order.length];
  setTheme(next);
  return next;
}
