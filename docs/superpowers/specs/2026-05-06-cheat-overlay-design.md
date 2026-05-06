# CHEAT Overlay

**Date:** 2026-05-06
**Status:** Design. Awaiting user spec review.

## Problem

Visitors arriving at the leaderboard see columns labeled `Score`, `Pass`,
`CI`, `Cost`, `$/Pass`, `p95`, plus a hero stacked-bar chart. The
existing `MetricInfo` ⓘ tooltips give one-column-at-a-time definitions,
and `/about` carries the long-form glossary. Neither shows how the
metrics relate to the actual numbers on screen, and neither answers the
"what is this whole page" question for first-time visitors.

A guided overlay layered on top of the live page, with arrows pointing
at columns and an example row, would teach the leaderboard at a glance.

## Goals

- New visitor (90% of traffic) understands the leaderboard layout in
  one click.
- Plain-language explanations tied to the actual numbers on screen
  ("Opus 4.6 passed 51 of 64 tasks").
- Page stays visually live while the overlay is on (no dim, no scroll
  lock). Mouse interaction with underlying page elements continues to
  work (sort columns, click links). Keyboard interaction is consciously
  scoped to the overlay's controls (X button, callouts) for the
  duration; pressing Esc returns full keyboard control to the page.
  This is a non-modal-but-keyboard-scoped interaction model;
  consequences for the desktop focus model appear in Accessibility.
- Mobile audience reaches the same teaching content via a degraded
  presentation that does not depend on the visual conceit.
- Accessible: keyboard, screen reader, reduced-motion all first-class.

## Non-Goals

- Step-by-step guided tour. The overlay shows everything at once.
- Auto-show on first visit. Pure opt-in via the CHEAT button.
- Site-wide coverage. Only the landing page and `/models/[...slug]` get
  registries in v1.
- Internationalization. Copy lives in a registry as plain English; i18n
  is a future wrap.
- Analytics integration in v1. Telemetry hook stubbed for future.

## Audience

Same audience split as the score-display unification PR1 spec:

- **90% landing-page visitors.** Want to know "who is best" and what
  the headline numbers mean. Primary CHEAT consumer.
- **10% practitioners.** Use the existing per-column tooltips and
  `/about` glossary. CHEAT remains available but is not aimed at them.

## Architecture Overview

```
+-----------------------------------------------------------+
| Per-page mount points                                     |
|   site/src/routes/+page.svelte adds                       |
|     <CheatButton page="landing">                          |
|   site/src/routes/models/[...slug]/+page.svelte adds      |
|     <CheatButton page="model-detail">                     |
|   NOT mounted in +layout.svelte (would scope to all       |
|   routes, breaking the v1 "landing + model-detail" goal). |
+-----------------------------------------------------------+
                  |
                  v (button click toggles open state)
+-----------------------------------------------------------+
| <CheatButton>                                             |
|   Red FAB, bottom-right, fixed.                           |
|   On click >=1025px: dynamic-imports CheatOverlay.        |
|   On click  <=1024px: opens CheatMobileSheet.             |
+-----------------------------------------------------------+
                  |
                  v (lazy-loaded)
+-----------------------------------------------------------+
| <CheatOverlay page={page}>  client-only                   |
|   Reads annotations registry for `page`.                  |
|   Mounts portal under <body> to escape any                |
|   overflow:hidden ancestor.                               |
|   ResizeObserver + scroll listener -> recompute layouts.  |
|   Esc + X dismiss.                                        |
+-----------------------------------------------------------+
                  |
                  v (data, not import)
+-----------------------------------------------------------+
| Annotations registry                                      |
|   site/src/lib/cheat/annotations/landing.ts               |
|   site/src/lib/cheat/annotations/model-detail.ts          |
|   Each exports Annotation[].                              |
+-----------------------------------------------------------+
                  |
                  v (pure helper)
+-----------------------------------------------------------+
| computeCalloutLayout(targets, viewport, sizes)            |
|   Pure function. Returns Layout[] with positioned         |
|   callouts and arrow paths.                               |
|   Handles collision, side-flip at edges, off-viewport     |
|   opacity. Exhaustively unit-testable.                    |
+-----------------------------------------------------------+
```

Four components (`CheatButton`, `CheatOverlay`, `CheatCallout`,
`CheatMobileSheet`), one data registry (per-page annotation modules),
one pure helper (`computeCalloutLayout`). No new dependencies.

## Annotation Registry Shape

```ts
// site/src/lib/cheat/types.ts

export interface Annotation {
  /** Unique within a page. Used as anchor id and arrow path key. */
  id: string;

  /** CSS selector resolved on each redraw. Never holds element refs. */
  targetSelector: string;

  /** What the callout says. Plain text only; rendered via Svelte's
   *  default text interpolation (auto-escaped). Use `bodyPrefix` for
   *  bold emphasis. No inline HTML; no `{@html}` sink. */
  body: string;

  /** Where to anchor the callout relative to target. */
  side: 'top' | 'right' | 'bottom' | 'left';

  /** Sticky-note rotation in degrees. Range -3 to +3. Default 0. */
  rotation?: number;

  /** Mobile-sheet fallback text. Defaults to body. Useful when desktop
   *  text says "this column" but the mobile list needs explicit naming. */
  mobileText?: string;

  /** Mobile-sheet card title. Falls back to a derivation of `id`
   *  (dashes replaced with spaces, first letter capitalized).
   *  Set explicitly when the derived title reads poorly. */
  mobileTitle?: string;

  /** Optional bold prefix appended ahead of body. Plain text only;
   *  rendered as `<strong>{bodyPrefix}</strong>` followed by the
   *  escaped body text. Use instead of inline HTML inside `body`. */
  bodyPrefix?: string;

  /** When true, the overlay substitutes runtime values from the
   *  resolved target. Pulls values from data-cheat-* attributes on
   *  the target element. */
  template?: boolean;
}
```

**File layout:**

```
site/src/lib/cheat/
  types.ts
  annotations/
    landing.ts
    model-detail.ts
    index.ts
  compute-layout.ts        (pure helper)
  resolve-targets.ts       (impure resolver; standalone module for testability)
  CheatButton.svelte
  CheatOverlay.svelte
  CheatCallout.svelte
  CheatMobileSheet.svelte
```

**Worked-example annotation (template substitution):**

```ts
{
  id: 'row-1-pass',
  targetSelector: '[data-cheat="worked-example-pass"]',
  body: '{passed}/{total} solved. Green = first try ({p1}). Amber = retry win ({p2only}).',
  side: 'right',
  rotation: -1.5,
  template: true,
}
```

The corresponding row in `LeaderboardTable.svelte` gains a
production-owned `data-cheat="worked-example-pass"` anchor plus the
template's `data-cheat-passed`, `data-cheat-total`, `data-cheat-p1`,
`data-cheat-p2only` attributes. **Selector binding uses dedicated
`data-cheat="..."` anchors, never `data-test` (which is for test
harnesses and may be churned by test refactors) or styling classes
(`.attempts-cell`, which carry layout intent and may be renamed).**

**Template substitution scope.** Values come ONLY from the resolved
`targetSelector` element's own `data-cheat-*` attributes. The resolver
walks no ancestors and reads no other elements. Missing attributes
substitute as the literal string `?` and log a dev-mode warning.
Missing target (`querySelector` returns null) → annotation is omitted
from the output entirely (see "Per-annotation steps").

**Body markup.** `body` is plain text. The renderer escapes it via
Svelte's default text interpolation. Rich emphasis (e.g. bold for the
metric name) uses the optional `bodyPrefix` field declared in the
`Annotation` interface above. The CheatCallout component renders
`<strong>{bodyPrefix}</strong> {body}` where both halves are auto-
escaped. v1 ships without `bodyPrefix` if no annotation needs it.
No `{@html ...}` sink anywhere in the cheat module.

## `computeCalloutLayout` Algorithm

The work is split into two layers to keep the math truly pure and
unit-testable:

1. **`resolveTargets()` (impure, standalone module).** Lives in
   `site/src/lib/cheat/resolve-targets.ts` (NOT inside
   `CheatOverlay.svelte`). Stateless function exported for direct
   unit testing. Calls `document.querySelector` per annotation,
   captures `getBoundingClientRect()`, reads any `data-cheat-*`
   attributes on the resolved target for template substitution,
   computes document order via DOM traversal. Returns
   `ResolvedTarget[]`. Holds no element refs across calls; resolved
   fresh on each layout pass. `CheatOverlay.svelte` imports and
   invokes it from its effect lifecycle.

   **Selector error handling.** `document.querySelector()` throws
   `SyntaxError` for malformed selector strings (it does NOT return
   null). The resolver wraps each call in `try/catch`, logs a
   dev-mode warning naming the annotation `id` and the offending
   selector, and continues. Both "selector throws" and "selector
   returns null" paths skip the annotation entirely:
   ```ts
   let el: Element | null;
   try {
     el = document.querySelector(annotation.targetSelector);
   } catch (err) {
     if (dev) console.warn(`[cheat] Invalid selector for "${annotation.id}": ${annotation.targetSelector}`, err);
     continue;
   }
   if (!el) {
     if (dev) console.warn(`[cheat] Missing target for "${annotation.id}": ${annotation.targetSelector}`);
     continue;
   }
   ```

2. **`computeCalloutLayout()` (pure, fully testable).** No `document`,
   `window`, `Element`, or `ResizeObserver` access. Inputs are plain
   data; output is plain data. Lives in `compute-layout.ts`.

```ts
// Pure function signature (compute-layout.ts)

/** Plain rect type. The pure helper has zero DOM knowledge; the
 *  resolver converts DOMRectReadOnly to this shape. */
interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface ResolvedTarget {
  id: string;                  // annotation id
  /** Document order index, assigned by resolver. Used as the primary
   *  sort key for collision avoidance. Resolver computes via DOM
   *  traversal; pure helper just consumes. */
  order: number;
  rect: Rect;                  // viewport-relative CSS pixels
  values: Record<string, string>;  // template substitution data
  side: 'top' | 'right' | 'bottom' | 'left';
  rotation: number;
  body: string;                // substituted plain text; NOT pre-escaped.
                               // Svelte text interpolation escapes at
                               // the render sink. Resolver does
                               // substitution only, never escaping.
  bodyPrefix?: string;         // plain text; NOT pre-escaped.
}

interface Viewport {
  width: number;
  height: number;
  // No scrollX/scrollY: the layer is `position: fixed; inset: 0`,
  // so all coordinates are viewport-relative CSS pixels. Adding
  // scroll offsets here would invite document-coordinate confusion
  // and arrow drift.
}

interface Size { width: number; height: number; }

export function computeCalloutLayout(
  targets: ResolvedTarget[],
  viewport: Viewport,
  sizes: Record<string, Size>,
): Layout[];
```

All coordinates in `Rect`, `Layout.callout`, and `Layout.arrow.d` are
**viewport-relative CSS pixels** (matching `getBoundingClientRect()`'s
output and the layer's `position: fixed` placement).

Output:

```ts
interface Layout {
  id: string;
  visible: boolean;     // false when target is off-viewport
  callout: { left: number; top: number; width: number; rotation: number };
  arrow?: { d: string };  // SVG path "d" attribute. Omitted entirely
                          // when visible === false (no arrow drawn).
}
```

### Per-annotation steps (post-resolution; pure function)

1. **Missing target handling.** Targets that failed to resolve
   (`document.querySelector` returned null) are NOT included in the
   `targets` array passed to the pure function. The pure function does
   not need to handle this case. The impure resolver logs a dev-mode
   `console.warn` for unresolved selectors and omits them from the
   output entirely. Empty `targets[]` → empty `Layout[]`.

2. **Off-viewport early exit (first per-target check).** If the
   target's rect is entirely outside the viewport, return
   `{ id, visible: false, callout: { ... default placement }, arrow undefined }`
   immediately, BEFORE side-flipping or collision avoidance. This
   avoids spurious "both sides clip" warnings for targets that are
   simply scrolled off-screen and saves collision work.

3. **Choose anchor point on target.** Based on `side`: midpoint of
   target's top, right, bottom, or left edge.

4. **Choose callout position.** Place callout 12 to 20 pixels outside
   the anchor along `side`, with sticky-note rotation applied. Check
   viewport bounds: if the callout would clip, flip to the opposite
   side. Single flip only; if both sides clip, log a dev-mode warning
   and use the original side.

5. **Collision avoidance.** Greedy pass. Sort callouts by
   `ResolvedTarget.order` (assigned by resolver from DOM document
   order), with `id` as a stable secondary sort to guarantee
   deterministic ordering when two annotations target the same
   element. The pure helper does no DOM traversal; it only sorts the
   plain numeric `order` field. For each callout, if its bounding rect
   intersects any already-placed callout's rect, push perpendicular to
   `side` by 8px increments until no intersection (cap at 80px). If no
   slot found, accept overlap rather than infinite loop.

6. **Arrow path.** From anchor point on target to callout's nearest
   edge corner. Quadratic bezier with slight upward control point for
   the hand-drawn vibe; dashed stroke. Tip arrowhead is a 6px
   equilateral polygon oriented along the final tangent.

### Reactivity

- Called on overlay open.
- Called on `scroll` (passive listener on `window` and on each target's
  nearest scrollable ancestor). Scroll-parent discovery walks
  `parentElement` and inspects `getComputedStyle(el).overflowX` and
  `overflowY` for `auto` / `scroll` / `overlay` values. **Not**
  `offsetParent` (which finds positioned ancestors, not scroll
  containers; would miss `LeaderboardTable.svelte`'s `.wrap` which is
  `overflow-x: auto` but not positioned).
- Called on `window.resize` (passive listener). `ResizeObserver` on
  body is not a reliable viewport-change signal: a wide body may not
  resize even when the viewport does. The explicit window listener
  catches viewport width/height changes.
- Called on `ResizeObserver` callback (observes body, each target's
  nearest scroll parent, AND each callout element). Callout-element
  observation catches text reflow when fonts load or when bodyPrefix
  is added/removed; these change the callout's intrinsic size and
  must trigger a layout recompute.
- Called on `MutationObserver` callback. Observes the smallest stable
  container containing the page's cheat targets, identified by a
  `data-cheat-scope` wrapper attribute on the route's content/table
  region (e.g. `<div data-cheat-scope class="results">` on landing).
  NOT `#main`, which would trigger on unrelated DOM changes elsewhere
  on the page. Watch options: `childList: true, subtree: true,
  attributes: true`. Callback filters records to only react to
  `data-cheat`-prefixed attribute names plus all childList changes:
  ```ts
  const relevant = records.some((record) => {
    if (record.type === 'childList') return true;
    if (record.type !== 'attributes') return false;
    return record.attributeName?.startsWith('data-cheat') ?? false;
  });
  if (relevant) scheduleLayout();
  ```
  Filtering in the callback (not via `attributeFilter`) keeps the
  observer generic across landing + model-detail + future page
  registries without hardcoding template field names.
- Called after SvelteKit navigation completes (`afterNavigate` hook)
  to handle sort/filter URL changes that swap rows beneath the
  selectors. Note: `afterNavigate` and `MutationObserver` may both
  fire for the same change; rAF debounce coalesces them into one
  layout pass.
- `requestAnimationFrame` debouncing: at most one layout pass per frame.

### Lifecycle cleanup

`afterNavigate` is registered at component initialization (NOT inside
`$effect`); SvelteKit removes the listener automatically on component
unmount. All other listeners and observers are installed in the
overlay's mount effect and torn down in the corresponding cleanup
function:

```ts
import { afterNavigate } from '$app/navigation';

afterNavigate(() => {
  scheduleLayout();
});

$effect(() => {
  const cleanup: Array<() => void> = [];

  // window.addEventListener('scroll', scheduleLayout, { passive: true })
  // window.addEventListener('resize', scheduleLayout, { passive: true })
  // each scroll-parent: addEventListener('scroll', ...)
  // ResizeObserver (body + scroll parents + callout elements)
  // MutationObserver (data-cheat-scope container)
  // document.addEventListener('focusin', ..., true)
  // document.addEventListener('keydown', escHandler)
  // document-level Tab/Shift+Tab keydown listener (focus scope)
  // pending requestAnimationFrame handle (cancelAnimationFrame on cleanup)

  // ... each setup pushes cleanup() into the array ...

  return () => cleanup.forEach((fn) => fn());
});
```

No leaked observers across repeated open/close cycles. The
`afterNavigate` callback is harmless when the overlay is closed (it
calls `scheduleLayout`, which checks the open flag and returns early).

### Callout size measurement

The pure helper requires `sizes: Record<string, Size>` mapping
annotation `id` to measured callout dimensions. Sequence on overlay
open:

1. Mount each callout into the layer with `visibility: hidden;
   opacity: 0; pointer-events: none` so they take up layout space
   without flashing visually.
2. `await tick()` so Svelte commits the DOM.
3. Iterate the bound callout element refs (one per annotation ID),
   collect `getBoundingClientRect()` width/height into `sizes`.
4. Run `resolveTargets()` + `computeCalloutLayout(...)` with the
   measured `sizes`.
5. Apply computed positions; remove `visibility: hidden`; opacity
   transitions to 1 per the open animation.
6. The callout-element `ResizeObserver` (see Reactivity) catches
   subsequent text reflow (font load, bodyPrefix change) and
   triggers `scheduleLayout` to remeasure + recompute.

### Edge cases tested

- 0 visible targets returns empty `Layout[]`.
- All targets off-viewport returns all `visible: false`.
- Two callouts identical anchor: collision push deterministic.
- Target at extreme right of viewport: side flips to `left`.
- Annotation with malformed selector: skipped silently with
  `console.warn` in dev mode.

## Visual Style

### Sticky note

- Background: `#fff8a8` (warm yellow). Token `--cheat-note-bg`.
- Border-radius: `4px`.
- Box-shadow: `2px 2px 0 rgba(0, 0, 0, 0.15)` (paper-cut illusion).
- Padding: `8px 10px`.
- Max-width: `200px` desktop. Wraps naturally.
- Font: site default sans, size `var(--text-xs)` (11 to 12px).
- Line-height: `1.3`.
- Color: `#1a1a1a` (high-contrast on yellow; ratio 13.4:1, AAA).
- Rotation: per-annotation, default 0; range -3 to +3 degrees.
- Bold emphasis comes from the optional `bodyPrefix` field, rendered
  as `<strong>{bodyPrefix}</strong>` ahead of the escaped body text.
  No inline HTML inside `body` itself.

### Arrow

- SVG `<path>`, dashed stroke `3 3`, color `var(--cheat-arrow)` =
  `#d97706` (warm orange, sticky-note family).
- Stroke-width: `1.75`.
- Quadratic bezier with slight upward control point.
- Arrowhead: 6px filled triangle at path tip, same color, oriented to
  path tangent.

### FAB (CHEAT button)

- Color: `#dc2626` (red-600).
- Hover: `#b91c1c` (red-700).
- Padding: `11px 16px`.
- Font: `font-weight: 700; letter-spacing: 0.7px;` uppercase
  "CHEAT" plus 📖 emoji.
- Border-radius: `999px`.
- Box-shadow: `0 4px 12px rgba(220, 38, 38, 0.4)`.
- Position: `fixed; bottom: 24px; right: 24px; z-index: var(--z-fab)`.
- Active state when overlay open: filled inverted (white background,
  red text, "CHEATING" label) so users know where to click to close.

### Z-index chain

- New token `--z-cheat-layer: 950` (below toasts at 1000, above
  everything else).
- FAB at `--z-fab: 940`. Stays at this value at all times. When the
  overlay is open (layer mounted at 950), FAB sits below the layer's
  X button so the X is the closer click target. When closed (no layer
  mounted), FAB sits above all page content so it remains visible.

**Existing `MetricInfo` popovers.** `MetricInfo.svelte` uses `<details>`
with the panel at `z-index: var(--z-popover)` (which sits below
`--z-cheat-layer`). Because the page is click-through under CHEAT,
users could otherwise click the ⓘ icon underneath and re-open a
MetricInfo popover, producing two overlapping explanation systems.
Contract:

- On `CheatOverlay` mount: dispatch a custom `cheat:open` event on
  `document`. `MetricInfo.svelte` listens, sets `open = false`, AND
  sets a local `cheatActive = true` flag that suppresses any future
  open (the `<summary>` click handler checks this flag and prevents
  default).
- On `CheatOverlay` cleanup/dismiss: dispatch `cheat:close` on
  `document`. `MetricInfo.svelte` clears `cheatActive`; subsequent
  clicks open normally again.
- Both listeners registered/cleaned up in `MetricInfo.svelte`'s
  `onMount` lifecycle.

### Pointer-events strategy

The "no dim + page stays usable" decision requires a deliberate CSS
contract; without it the layer would swallow all clicks.

```css
.cheat-layer {
  position: fixed;
  inset: 0;
  z-index: var(--z-cheat-layer);
  pointer-events: none;       /* layer itself is click-through */
}

.cheat-layer svg {
  pointer-events: none;       /* arrow SVG is decorative */
}

.cheat-callout {
  pointer-events: none;       /* sticky notes are click-through */
}

.cheat-close {
  pointer-events: auto;       /* X button is the only interactive
                                 element on the layer */
}
```

This means callouts cover real estate visually but do NOT block clicks
on table cells, sort buttons, or links underneath. The X button (and
nothing else on the layer) remains clickable. Acknowledged trade-off:
users cannot click ON a callout to dismiss that one callout
individually; dismissing the whole overlay (X / Esc / FAB toggle) is
the only path. This matches the "static annotated overlay" intent
chosen earlier.

### Theme

Light theme uses the values above. Dark theme already exists on the
site, toggled by `data-theme="dark"` on `<html>`. **Cheat tokens are
defined as global CSS custom properties in `site/src/styles/tokens.css`
(or the appropriate global stylesheet), NOT inside Svelte component
`<style>` blocks.** Svelte's CSS scoping would otherwise prevent a
bare `[data-theme="dark"]` selector from matching `<html>`.

```css
/* site/src/styles/tokens.css */
:root {
  --cheat-arrow: #d97706;
  --cheat-note-bg: #fff8a8;
}

html[data-theme="dark"] {
  --cheat-arrow: #fbbf24;
  /* note background unchanged; yellow still reads on dark */
}
```

Component CSS references the variables (`background: var(--cheat-note-bg)`)
without needing to be theme-aware.

### Animation

- Open: callouts fade-in with 60ms staggered delay
  (`transition: opacity 200ms ease-out`).
- Close: 100ms fade-out, then unmount.
- Arrows draw via `stroke-dashoffset` from full length to 0, 250ms
  ease-out, **only on initial open**. Subsequent layout passes
  (scroll / resize / mutation / navigation) update the path's `d`
  attribute without replaying the dashoffset animation. The path
  retains its `stroke-dasharray` but `stroke-dashoffset` is left at 0
  after the initial draw, so updates are instant. Without this
  scoping, recomputing `d` mid-animation produces visible jitter.
- `@media (prefers-reduced-motion: reduce)`: all animations disabled.
  Instant on/off.

## Mobile Fallback

**Trigger threshold:** `window.matchMedia('(min-width: 1025px)')`.
The existing landing layout collapses to one column at
`max-width: 1024px` (`site/src/routes/+page.svelte:142-144`), so
1024px and below is "mobile-shaped"; the desktop overlay starts at
1025px. Below 1025px the FAB still renders but `onclick` opens
`<CheatMobileSheet>` instead of `<CheatOverlay>`.

**Breakpoint crossing while CHEAT is open.** If the viewport crosses
the 1024/1025px boundary while CHEAT is already open (e.g. user
rotates a tablet, or resizes a desktop window narrow), dismiss the
current presentation (close overlay or sheet) and return focus to the
FAB. The user's next click opens the correct mode for the new
viewport. v1 does NOT live-swap overlay/sheet inline; that's a future
enhancement if observed user friction warrants it.

`window.matchMedia` and `HTMLDialogElement` are accessed only after
mount (in `onMount` and click handlers), never at module init or
during SSR. SSR renders the FAB as a plain button with no dynamic
behavior; client hydration attaches the click listener.

**`<CheatMobileSheet>` shape:**

- Native `<dialog>` element opened via `dialog.showModal()`. Browser
  provides Esc (via the `cancel` event) and focus trap. Backdrop
  click dismissal is **not** automatic; implement explicitly with a
  geometric bounds check (the `e.target === dialog` shortcut also
  fires on dialog padding, so we use a bounding-rect test instead):
  ```ts
  dialog.addEventListener('click', (e) => {
    const rect = dialog.getBoundingClientRect();
    const insideContent =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    if (!insideContent) dialog.close();
  });
  ```
  Combined with `dialog { padding: 0 }` styling and an inner `.sheet`
  wrapper that fills the visible dialog box, this dismisses only on
  true backdrop clicks.
- Slides up from bottom: `transform: translateY(100%) -> 0`, 200ms
  ease-out.
- Full-width, `max-height: 90vh`, scrollable interior.
- Backdrop: `dialog::backdrop { background: rgba(0, 0, 0, 0.5); }`.
  Mobile users are not reading the page underneath simultaneously, so
  dim is fine here.

**Content:**

- Header: small "CHEAT" label, page title (e.g. "Leaderboard"), X
  button.
- Body: numbered cards, one per **resolved** `Annotation`, in registry
  order. The mobile sheet uses the same `resolveTargets()` semantics
  as desktop: `template: true` annotations whose target is missing are
  omitted entirely, NOT rendered with `{passed}` placeholders or `?`
  substitutions. Numbering is computed AFTER omission, so the visible
  list always reads `1, 2, 3, ...` without gaps. This handles the
  empty-filter case (e.g. `?category=easy` with 0 rows): the row-bound
  worked-example card disappears; column cards still render.
- Each card:
  - Number badge (`1`, `2`, ...) with sticky-note yellow background.
  - Title from optional `Annotation.mobileTitle` field (added to the
    type interface). Falls back to a default derived from `id`:
    replace dashes with spaces, capitalize first letter
    (e.g. `score-col` -> "Score col"). Annotations whose default title
    reads poorly should set `mobileTitle` explicitly.
  - Body text: `mobileText ?? body` with template substitution.
- No arrows, no positioning. Simple list view.
- Footer: "Read full glossary -> /about#metrics" link.

**Why `<dialog>` over a custom modal:** native focus trap, native Esc
handling, native ARIA semantics (implicit `role="dialog"`). Fewer bugs
to write.

**Tablet widths 768 to 1024px:** use the mobile sheet (matches the
existing layout collapse). Desktop overlay starts at 1025px.

## Accessibility

### FAB button

- Native `<button>` element, tab-focusable.
- `aria-pressed={open}` indicates toggled state.
- `aria-controls="cheat-overlay"` (or the mobile sheet's id).
- Visible label: "CHEAT" / "CHEATING" (when open). Same for screen
  readers.
- Focus ring: `2px solid var(--accent); outline-offset: 2px`.

### Desktop overlay

- Mounted via portal to `<body>`.
- Container: `role="region" aria-label="Cheat overlay: <page-title>"`.
- Each callout: `role="note"`. `tabindex="0"` ONLY when
  `layout.visible === true`. Off-viewport callouts get
  `tabindex="-1"` and `aria-hidden="true"` together; including
  `tabindex="0"` inside an `aria-hidden` subtree is an axe violation.
  When the user scrolls the target back into the viewport, both
  attributes flip back. Implementation:
  ```svelte
  <div
    role="note"
    aria-hidden={!layout.visible}
    tabindex={layout.visible ? 0 : -1}
  >...</div>
  ```
- Arrow `<path>` and `<polygon>` inside an SVG with
  `aria-hidden="true"` (decorative; the callout text is the content).
- X button: `<button aria-label="Close cheat overlay">` in fixed
  top-right of overlay layer.
- `aria-describedby` is not used in v1 (the description would just
  duplicate the visible text, adding screen-reader noise without
  value). Reserved for a future case where expanded explanations
  exist.

### Keyboard

- `Esc` closes. Listener registered on overlay open, cleaned up on
  close (effect return).
- **Desktop overlay uses a non-modal focus scope.** The page remains
  pointer-interactive via the click-through layer, but keyboard focus
  is constrained to the overlay's controls (X button + callouts).
  Initial focus on open lands on the X button. `Tab` and `Shift+Tab`
  cycle: X -> callout 1 -> callout 2 -> ... -> X (forward) and the
  reverse on `Shift+Tab`. Implement explicit Tab/Shift+Tab wrapping
  via keydown listener at the layer.
- **Mouse click-through can move focus to underlying page elements.**
  When the user clicks an underlying sort button or link via the
  click-through layer, the browser would normally move focus to the
  underlying control. A document-level `focusin` listener (capture
  phase) redirects focus back to the X button when focus lands
  outside the overlay:
  ```ts
  function onFocusIn(e: FocusEvent) {
    if (!overlayEl.contains(e.target as Node)) {
      closeButton.focus();
    }
  }
  document.addEventListener('focusin', onFocusIn, true);
  ```
  Do NOT use `inert` on the page (would block the intended pointer
  interaction). Do NOT use a modal `<dialog>`/`showModal()` pattern
  on desktop (would block click-through too).
- When closed, focus returns to FAB. Document-level `focusin`
  listener and Tab/Shift+Tab keydown listener removed.

### Mobile sheet

- Native `<dialog>` provides focus trap and Esc; backdrop click is
  handled explicitly with the bounding-rect check described in
  Mobile Fallback (NOT with the naive `e.target === dialog`
  shortcut, which also fires on dialog padding).
- Numbered cards use `<ol>` so screen readers announce ordinal
  position.

### Reduced motion

- `@media (prefers-reduced-motion: reduce)`: callout fade-in, arrow
  stroke-dashoffset draw, FAB hover transitions all disabled. Instant
  on/off.

### Color contrast

- Yellow `#fff8a8` plus black text `#1a1a1a` -> 13.4:1 (AAA).
- Red FAB `#dc2626` plus white text -> 4.7:1 (AA for normal text:
  WCAG threshold is 4.5:1). 12px bold satisfies AA; if a future
  tweak drops contrast below 4.5:1, the red must darken or text
  size increase.

### Off-viewport callouts

- Visually hidden but stay in DOM with `aria-hidden="true"` so screen
  readers do not announce them. When the user scrolls and the target
  re-enters the viewport, `aria-hidden` is removed.

### Telemetry hook (no-op v1)

- `<CheatOverlay onOpen onDismiss>` callbacks fire empty events. PR2
  or a future change wires to analytics. Listed for structure; no
  implementation cost in v1.

## Test Surface

### Unit (Vitest, pure helper)

`compute-layout.test.ts`:

- 0 visible targets returns empty.
- All targets off-viewport returns all `visible: false`.
- Two annotations with the same anchor: collision push deterministic.
- Target at right viewport edge: side flip from `right` to `left`.
- Target at top edge: side flip from `top` to `bottom`.
- Bezier path end coordinates match the callout's nearest edge corner.
- Off-viewport target produces `visible: false` and no arrow path.

### Component (Vitest plus Svelte)

- `CheatButton.test.svelte.ts`: aria-pressed toggles, click dispatches.
  FAB visible at all viewport sizes (mobile click opens the dialog
  sheet; desktop click opens the overlay; the FAB itself is rendered
  in both cases).
- `CheatOverlay.test.svelte.ts`: renders one callout per annotation,
  Esc dismisses, X dismisses, scoped focus cycles X -> callouts -> X.
- `CheatCallout.test.svelte.ts`: renders already-substituted, escaped
  body text plus optional `bodyPrefix`. Verifies rotation applied.
  Does NOT test template substitution (that lives in the resolver).
- `resolve-targets.test.ts`: template substitution from the resolved
  target element's own `data-cheat-*` attributes; missing attribute
  substitutes `?` with dev-mode warning; missing target is omitted
  entirely. Resolver does NOT escape values (the render sink does).
  Test asserts substituted values pass through verbatim AND, in a
  separate component test, that those values render as text (not
  parsed as HTML) in the final DOM.
- `CheatMobileSheet.test.svelte.ts`: opens `<dialog>` with `showModal`,
  renders numbered list, Esc closes.

### E2E (Playwright)

- `cheat-overlay-landing.spec.ts`:
  - Visit `/`, click CHEAT FAB.
  - Assert callouts visible (`role=note` count matches `landing.ts`).
  - Scroll page; assert callout positions update (use `boundingBox()`
    before/after).
  - **Click-through assertion**: with overlay open, click an
    underlying sortable column header (e.g. the Score column);
    assert the page action occurs (URL `?sort=` updates,
    `aria-sort` flips) AND the overlay remains present. This locks
    in the "page stays usable" promise.
  - Press Esc; assert overlay gone, FAB unpressed.
- `cheat-overlay-mobile.spec.ts`: three viewports `375x667` (phone),
  `900x800` (tablet), and `1024x768` (boundary). All three must open
  `<dialog>` (mobile sheet), NOT the desktop overlay. Asserts no SVG
  arrows, X closes.
- `cheat-overlay-desktop-min.spec.ts`: viewport `1025x768`; click FAB;
  assert desktop overlay (not dialog) opens. Confirms the
  >=1025 cutoff.

### Accessibility tests

- axe-core via Playwright on `/` with overlay open. Expect 0
  violations.

## Risks

| Risk | Mitigation |
|------|-----------|
| Callout rotation breaks `getBoundingClientRect` collision math | Compute collision on rotated bounding box (use rotated rect coords). Tests cover ±3 degree cases |
| Sticky table headers cause arrow drift on scroll | Targets resolved fresh per redraw; sticky elements report current rect correctly |
| User sorts column while overlay open and the row 1 changes | Acceptable and intended (annotation says "this row's model"). Re-evaluate template substitution on each sort change. Selector-based binding hands a new element on re-render |
| Off-screen targets that become visible mid-scroll need to fade IN | `transition: opacity 200ms` on each callout; `visible` flag drives opacity |
| Many annotations on small viewports cause callouts to pile up | Collision push has 80px max; v1 caps page registry at 6 callouts. Over-spec'd registry triggers a runtime warning + test |
| Empty filter (e.g. `?category=easy` returning 0 rows) means the worked-example row callout silently disappears while column callouts remain | Acceptable, but requires implementation discipline: `+page.svelte` must keep `LeaderboardTable` (or at minimum its `<thead>`) mounted inside the `data-cheat-scope` wrapper even when `data.leaderboard.data.length === 0`, so column header anchors still resolve. Current `+page.svelte:119-125` swaps out the table entirely on empty results; the implementation must change to render the empty-state message ABOVE or BESIDE a still-mounted table header. Tests cover both populated and empty-result cases. |
| `CheatButton` ships in the main bundle on every page (overlay/sheet/registry are dynamically imported) | Accepted cost. The button is small (~1KB minified+gzipped). It must NOT statically import `CheatOverlay`, `CheatMobileSheet`, `compute-layout`, or any annotation registry. Lazy-load the appropriate presentation component on first click: ```ts if (window.matchMedia('(min-width: 1025px)').matches) { const { default: CheatOverlay } = await import('./CheatOverlay.svelte'); /* mount/open overlay */ } else { const { default: CheatMobileSheet } = await import('./CheatMobileSheet.svelte'); /* mount/open sheet */ } ``` Annotation imports happen inside the lazy-loaded overlay/sheet path. |
| First-click latency on dynamic import of `CheatOverlay` | Pre-warm via `<link rel="modulepreload">` on the page that hosts `CheatButton`. Adds the import to browser cache without executing. v1 ships without preload; if user reports lag, add in a follow-up. |

## Out of Scope (v1)

- Step-by-step variant. Would require a tour state machine.
- Per-user dismissal memory. Pure opt-in chosen.
- Per-callout deep links (`/?cheat=score`). Future add for sharing
  explanations.
- Internationalization. Copy is plain English in the registry; future
  i18n loop wraps with `t(...)`.
- Analytics integration. Telemetry hook stubbed, wired in a follow-up.
- `/compare` and `/families/[slug]` coverage. Existing MetricInfo plus
  `/about` covers them. Add registries later if traffic warrants.

## Decisions Recorded

- **Scope**: `/` (landing) plus `/models/[...slug]` only.
- **Style**: static annotated overlay (no step-by-step, no
  hover-reveal).
- **Depth**: column callouts plus a worked-example row.
- **Visual**: sticky-note yellow, dashed orange arrows, ±3° rotation.
- **Position**: red FAB bottom-right, no dim.
- **Dismiss**: X, Esc, or FAB toggle. No outside-click dismissal
  since the page remains live/click-through underneath.
- **Mobile**: native `<dialog>` sheet with numbered list (no arrows).
  Threshold: desktop overlay >=1025px; mobile sheet <=1024px
  (matches existing layout breakpoint at `max-width: 1024px`). Mobile
  uses `showModal()` for true browser-managed focus trap; desktop is
  non-modal scoped focus.
- **Persistence**: pure opt-in, no localStorage flag.
- **Architecture**: hand-rolled Svelte component plus pure layout
  helper plus data registry. Pure helper holds zero DOM knowledge;
  resolution lives in component-side `resolveTargets`. No new
  dependencies.
- **Reactivity**: passive scroll listener + ResizeObserver +
  MutationObserver + `afterNavigate` hook + rAF debounce.
- **Accessibility**: portal-mounted overlay, focus scoped to overlay
  controls (not trapped to page), `aria-hidden`/`tabindex` co-managed
  for off-viewport callouts, native `<dialog>` on mobile with
  explicit backdrop click handler, axe-core in CI.
- **Click-through**: `pointer-events: none` on layer/SVG/callouts;
  `pointer-events: auto` only on the X close button.
- **Body markup**: plain text only, escaped by default. Optional
  `bodyPrefix` for emphasis. No `{@html}` sink.
- **Selectors**: `data-cheat="..."` anchors only. Never `data-test`
  or styling classes.
- **MetricInfo coexistence**: opening CHEAT closes any open
  MetricInfo `<details>` via document-level `cheat:open` event.
- **Mount points**: `+page.svelte` per route. Not `+layout.svelte`
  (would scope to all routes).
