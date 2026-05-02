/**
 * CLIENT-ONLY rune store for density mode (comfortable / compact).
 *
 * Mirrors palette-bus.svelte.ts. Server must NOT import this module —
 * importing a `.svelte.ts` from `hooks.server.ts` pulls the Svelte 5
 * server runtime chunk into the worker bundle and breaks vitest pool-
 * workers' script-string loader.
 *
 * The toggle UI button is mounted in Nav under +layout.svelte (client-
 * only by construction). The cmd-shift-d keybind is registered via
 * `keyboard.ts` from +layout.svelte. The applied attribute lives on
 * `<html data-density="...">` and is set:
 *   1. before paint via the inline boot script in app.html <head>
 *      (mirrors theme controller pattern; avoids density flash)
 *   2. reactively via DensityToggle.svelte / setDensity()
 *
 * Multi-tab sync: init() attaches a `storage` event listener that
 * mirrors writes from other tabs into our rune + DOM (without re-
 * writing localStorage — that would loop).
 */

export type Density = "comfortable" | "compact";

const STORAGE_KEY = "cg-density";

/**
 * Initial density read from `<html data-density>`. The inline no-flash
 * boot script in app.html's <head> writes the attribute BEFORE the rune
 * store evaluates, so reading the attribute here is the single source
 * of truth — preventing the brief inconsistency between
 * (attribute = 'compact', rune = 'comfortable') that would otherwise
 * occur if the rune defaulted to 'comfortable' and onMount-via-init()
 * wrote later.
 *
 * SSR safety: `document` is undefined; default to 'comfortable'. Client
 * hydration re-evaluates this expression on the rune-store first read.
 */
function readInitialDensity(): Density {
  if (typeof document === "undefined") return "comfortable";
  const attr = document.documentElement.dataset.density;
  return attr === "compact" ? "compact" : "comfortable";
}

class DensityBus {
  density = $state<Density>(readInitialDensity());
  private storageListenerAttached = false;

  /**
   * Reread from `<html data-density>` (set by the pre-paint script,
   * single source of truth — architect I7 fix), then fall back to
   * localStorage if the attribute isn't present. Attaches a `storage`
   * event listener for multi-tab sync. Idempotent — calling more than
   * once won't double-register the listener.
   */
  init(): void {
    if (typeof document !== "undefined") {
      const attr = document.documentElement.dataset.density;
      if (attr === "compact" || attr === "comfortable") {
        this.density = attr;
      } else if (typeof localStorage !== "undefined") {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === "compact" || v === "comfortable") this.density = v;
      }
    } else if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "compact" || v === "comfortable") this.density = v;
    }

    if (this.storageListenerAttached || typeof window === "undefined") return;
    window.addEventListener("storage", (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = e.newValue;
      if (next === "compact" || next === "comfortable") {
        // Avoid re-writing localStorage from this tab — we got HERE because
        // ANOTHER tab wrote it. Just reflect into our rune + DOM.
        this.density = next;
        if (typeof document !== "undefined") {
          document.documentElement.setAttribute("data-density", next);
        }
      }
    });
    this.storageListenerAttached = true;
  }

  setDensity(d: Density): void {
    this.density = d;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, d);
    }
    if (typeof document !== "undefined") {
      // Apply attribute immediately so consumers without an effect see it.
      document.documentElement.setAttribute("data-density", d);
    }
  }

  toggle(): void {
    this.setDensity(this.density === "comfortable" ? "compact" : "comfortable");
  }
}

export const densityBus = new DensityBus();
