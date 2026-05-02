/**
 * Stub for `$app/server` in jsdom unit tests.
 *
 * SvelteKit injects `$app/server` at build time; vitest can't resolve it.
 * Server modules that call `read(asset)` need a callable stub during unit
 * tests — the og-render unit test additionally `vi.mock`s this module to
 * return a fixed ArrayBuffer so the renderer can be exercised without
 * the SvelteKit asset pipeline.
 */
export function read(_asset: string): Response {
  return new Response(new ArrayBuffer(0));
}

export function getRequestEvent(): never {
  throw new Error("getRequestEvent stub: not available in unit tests");
}
