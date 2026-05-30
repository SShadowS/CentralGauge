/**
 * Stub for `$app/state` in jsdom unit tests.
 *
 * SvelteKit injects `$app/state` at build time; vitest can't resolve it.
 * Route components read `page.url` (e.g. for filter chips and `pushFilter`).
 * A minimal frozen object with a real `URL` is enough for DOM tests — the
 * runes-backed reactive page store from SvelteKit is never observed here.
 */
export const page = {
  url: new URL("http://localhost/"),
  params: {} as Record<string, string>,
  route: { id: "/" as string | null },
  status: 200,
  error: null,
  data: {} as Record<string, unknown>,
  form: null,
  state: {} as Record<string, unknown>,
};

export const navigating = { from: null, to: null, type: null, willUnload: false };

export const updated = { current: false };
