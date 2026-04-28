/**
 * CLIENT-ONLY rune store for cmd-K palette open/close state.
 *
 * **Server must NOT import this module.** Importing a `.svelte.ts` rune
 * module from `hooks.server.ts` (or any server entry that ends up in
 * the worker bundle) causes the SvelteKit build to emit
 * `import "../chunks/dev.js"` into `hooks.server.js`. That chunk is
 * the entire Svelte 5 server runtime (~4000 lines, exports `$state`,
 * `$effect`, `render`, etc.) — it isn't a dev-only helper. Pulling it
 * in breaks the vitest pool-workers script-string loader, which
 * forbids cross-chunk imports.
 *
 * Per-request reset is unnecessary: the palette is mounted in client-only
 * components (CommandPalette under +layout.svelte) so SSR never
 * instantiates this module. If a future server-rendered consumer is
 * added, do NOT call a `resetPaletteBus()` re-export from
 * `hooks.server.ts` — instead, ensure the consumer renders client-side
 * only (the architectural invariant is "module-scope rune state must
 * not be reachable from SSR," not "must be reset per request").
 *
 * The palette is mounted in +layout.svelte; the Nav button calls
 * `paletteBus.openPalette()`. A global keydown listener in +layout.svelte
 * hooks `paletteBus.toggle()` for ⌘K / Ctrl-K.
 *
 * Why a module-scope rune instead of context: the Nav and the CommandPalette
 * are siblings under +layout.svelte; passing context through every child
 * is overkill for a single boolean.
 */
class PaletteBus {
  open = $state(false);

  openPalette(): void {
    this.open = true;
  }

  close(): void {
    this.open = false;
  }

  toggle(): void {
    this.open = !this.open;
  }
}

export const paletteBus = new PaletteBus();
