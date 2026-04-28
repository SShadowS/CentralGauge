/**
 * Global keyboard chord registry. Single keydown listener attached to
 * `document` (lazily on first registerChord); each registered chord
 * fires its handler when the chord matches.
 *
 * Why a registry vs hand-rolled handlers: cmd-K and cmd-shift-d want the
 * same prevention semantics (preventDefault, capture phase, fires once)
 * and the same input-field exclusion rule. Centralizing keeps that
 * consistent and testable. Plus future chords (e.g. `?` for help) drop in
 * trivially.
 *
 * Browser-shortcut conflicts (documented for visibility):
 *   - ⌘-Shift-D / Ctrl-Shift-D collides with Safari's "Bookmark Tabs",
 *     Chrome's "Bookmark All Tabs", and Firefox's "Bookmark All Tabs".
 *     `e.preventDefault()` here runs AFTER the browser's shortcut
 *     dispatch on some browsers; the bookmark dialog may still open.
 *     Mitigation: the DensityToggle Nav button is the canonical UI
 *     surface — the chord is a power-user accelerator, not the only
 *     path. Accept partial reliability for the spec'd binding rather
 *     than rebind to a non-spec'd combination.
 */

export interface ChordSpec {
  /** Lowercased non-modifier key */
  key: string;
  /** ⌘ on macOS, Ctrl on Windows/Linux (we treat them equivalently) */
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

interface Entry {
  spec: ChordSpec;
  handler: (ev: KeyboardEvent) => void;
}

const entries = new Set<Entry>();
let listenerAttached = false;

export function chordMatches(spec: ChordSpec, ev: KeyboardEvent): boolean {
  if (ev.key.toLowerCase() !== spec.key.toLowerCase()) return false;
  // meta/ctrl equivalence: spec.meta=true matches either modifier.
  if (spec.meta && !(ev.metaKey || ev.ctrlKey)) return false;
  if (!spec.meta && (ev.metaKey || ev.ctrlKey)) return false;
  if (Boolean(spec.shift) !== ev.shiftKey) return false;
  if (Boolean(spec.alt) !== ev.altKey) return false;
  return true;
}

export function registerChord(
  spec: ChordSpec,
  handler: (ev: KeyboardEvent) => void,
): () => void {
  const entry: Entry = { spec, handler };
  entries.add(entry);
  ensureListener();
  return () => {
    entries.delete(entry);
  };
}

function ensureListener(): void {
  if (listenerAttached) return;
  if (typeof document === 'undefined') return;
  document.addEventListener('keydown', onKeyDown);
  listenerAttached = true;
}

function onKeyDown(ev: KeyboardEvent): void {
  for (const entry of entries) {
    if (chordMatches(entry.spec, ev)) {
      ev.preventDefault();
      entry.handler(ev);
      return;
    }
  }
}
