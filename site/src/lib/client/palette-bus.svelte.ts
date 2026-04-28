/**
 * Module-scope svelte-rune singleton for cmd-K palette open/close state.
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

/**
 * Force the bus back to its closed state. Called from `hooks.server.ts` per
 * SSR request so the long-lived Cloudflare Worker isolate's state cannot
 * leak between requests. See commit 51f9be9 for the analogous fix to
 * `useId`'s counter.
 */
export function resetPaletteBus(): void {
  paletteBus.close();
}
