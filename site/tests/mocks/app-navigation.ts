/**
 * Stub for `$app/navigation` in jsdom unit tests.
 *
 * SvelteKit injects `$app/navigation` at build time; vitest can't resolve it.
 * Components that import `goto` (e.g. CommandPalette) only need a callable
 * stub during DOM tests — actual navigation is never observed in jsdom.
 */
export async function goto(_url: string | URL, _opts?: unknown): Promise<void> {
  // no-op
}

export async function invalidate(_dependency: string | URL | ((url: URL) => boolean)): Promise<void> {
  // no-op
}

export async function invalidateAll(): Promise<void> {
  // no-op
}

export async function preloadCode(..._urls: string[]): Promise<void> {
  // no-op
}

export async function preloadData(_url: string): Promise<unknown> {
  return undefined;
}

export function pushState(_url: string | URL, _state: unknown): void {
  // no-op
}

export function replaceState(_url: string | URL, _state: unknown): void {
  // no-op
}

export function afterNavigate(_callback: unknown): void {
  // no-op
}

export function beforeNavigate(_callback: unknown): void {
  // no-op
}

export function onNavigate(_callback: unknown): void {
  // no-op
}

export async function disableScrollHandling(): Promise<void> {
  // no-op
}

export async function goBack(): Promise<void> {
  // no-op
}
