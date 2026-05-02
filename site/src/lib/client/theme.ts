/**
 * Theme controller.
 *
 * Stored theme has three states: 'light' / 'dark' / 'system' (default
 * for first-time visitors). The toggle button, however, is a TWO-state
 * flip — it always switches between the currently visible theme and
 * its opposite, then persists the explicit choice. The 'system' state
 * is reachable only by clearing localStorage (intentional: a 3-state
 * cycle made one of the three transitions visually invisible whenever
 * 'system' matched the OS preference, so the button felt broken on
 * every other click).
 *
 * - "system" → no data-theme attribute; CSS @media (prefers-color-scheme) applies
 * - "light" / "dark" → data-theme set on <html>, persisted in localStorage
 *
 * Companion no-flash inline script lives in app.html and runs before any paint.
 */

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

export function getTheme(): Theme {
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

/**
 * Resolve a stored 'system' to the actual visible theme via the OS
 * preference. Use this whenever the UI needs to know which CSS palette
 * is currently rendered (e.g. icon selection, the toggle inversion).
 */
export function getEffectiveTheme(): "light" | "dark" {
  const stored = getTheme();
  if (stored === "light" || stored === "dark") return stored;
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function setTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem(STORAGE_KEY);
  } else {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }
}

/**
 * Flip light ↔ dark, always producing a visible change. The next theme
 * is always the OPPOSITE of what is currently rendered, regardless of
 * whether the stored value is 'light' / 'dark' / 'system'.
 */
export function cycleTheme(): Theme {
  const next: Theme = getEffectiveTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
