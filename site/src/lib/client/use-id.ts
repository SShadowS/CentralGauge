/**
 * Deterministic id generator, monotonic per call within a Svelte render pass.
 *
 * SSR safety: the counter MUST be reset per request (see resetIdCounter()).
 * In a long-lived Cloudflare Worker isolate, the module-scoped counter would
 * otherwise drift across requests, producing SSR ids like cg-id-5 while the
 * client-side hydration counter starts at 0 → hydration mismatch.
 *
 * Usage:
 * - Components: call useId() inside the script setup (or in $derived) to get
 *   a stable id for label/aria-describedby/aria-labelledby pairs.
 * - hooks.server.ts: call resetIdCounter() at the start of every handle().
 *
 * On the client, the counter resets naturally on full navigation (module
 * re-initialization). It does NOT reset on goto() — but that's fine because
 * useId() values are stable across re-renders within a session as long as
 * the component tree is stable.
 */

let counter = 0;

export function useId(): string {
  counter += 1;
  return `cg-id-${counter}`;
}

/** Reset the per-request counter. Server-side only; called by hooks.server.ts. */
export function resetIdCounter(): void {
  counter = 0;
}
