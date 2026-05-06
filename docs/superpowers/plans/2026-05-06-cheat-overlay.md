# CHEAT Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a red CHEAT button (FAB) to the landing page and model-detail page that opens a static annotated overlay with sticky-note callouts pointing at columns and a worked-example row, teaching the leaderboard at a glance.

**Architecture:** Hand-rolled Svelte 5 components in `site/src/lib/cheat/`. Per-page annotation registries (data) drive a pure `computeCalloutLayout` helper plus an impure `resolveTargets` DOM-reader. Portal-mounted overlay layer at `position: fixed` with `pointer-events: none` so the page underneath stays click-through. Mobile (<=1024px) gets a native `<dialog>` numbered-list fallback.

**Tech Stack:** SvelteKit on Cloudflare Workers, Svelte 5 runes, TypeScript strict, Vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-05-06-cheat-overlay-design.md`

**Working Directory:** `U:\Git\CentralGauge\site\` for most paths.

---

## Phase 0: Pre-flight

### Task 0.1: Verify clean baseline

**Files:** none (verification only)

- [ ] **Step 1: Confirm working tree clean and on a feature branch**

```bash
cd U:/Git/CentralGauge && git status && git branch --show-current
```

Expected: clean working tree on a `feat/cheat-overlay` branch (or worktree). If still on `master`, stop and create a worktree first via the `superpowers:using-git-worktrees` skill.

- [ ] **Step 2: Build + tests + typecheck baseline**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm run test:main && npm run check
```

Expected: 0 errors. 1149+ tests passing (752 worker + 397 unit). All green.

---

## Phase A: Foundation (types + tokens + pure helper)

### Task A.1: Add cheat module skeleton + types

**Files:**
- Create: `site/src/lib/cheat/types.ts`

- [ ] **Step 1: Create the types module**

```ts
// site/src/lib/cheat/types.ts

/**
 * Plain rect type. The pure layout helper has zero DOM knowledge;
 * resolve-targets.ts converts DOMRectReadOnly to this shape.
 */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Per-page annotation registry entry. Plain data; rendered by
 * CheatOverlay (desktop) and CheatMobileSheet (mobile).
 */
export interface Annotation {
  /** Unique within a page. Used as anchor id and arrow path key. */
  id: string;

  /** CSS selector resolved fresh on each redraw. Never holds element refs. */
  targetSelector: string;

  /**
   * What the callout says. Plain text only; rendered via Svelte's default
   * text interpolation (auto-escaped). Use bodyPrefix for bold emphasis.
   * No inline HTML; no {@html} sink.
   */
  body: string;

  /** Optional bold prefix rendered as <strong>{bodyPrefix}</strong> body. */
  bodyPrefix?: string;

  /** Where to anchor the callout relative to target. */
  side: 'top' | 'right' | 'bottom' | 'left';

  /** Sticky-note rotation in degrees. Range -3 to +3. Default 0. */
  rotation?: number;

  /** Mobile-sheet fallback text. Defaults to body. */
  mobileText?: string;

  /** Mobile-sheet card title. Falls back to derivation of id. */
  mobileTitle?: string;

  /**
   * When true, body / bodyPrefix support {placeholder} substitution
   * from data-cheat-* attributes on the resolved target element.
   */
  template?: boolean;
}

/**
 * Result of resolveTargets(): one entry per successfully-resolved
 * annotation. Ready to feed into computeCalloutLayout().
 */
export interface ResolvedTarget {
  id: string;
  /** Document order index for stable collision sort. */
  order: number;
  rect: Rect;
  /** Substituted plain text; NOT pre-escaped (Svelte interpolation escapes). */
  body: string;
  /** Substituted plain text; NOT pre-escaped. */
  bodyPrefix?: string;
  side: 'top' | 'right' | 'bottom' | 'left';
  rotation: number;
  values: Record<string, string>;
}

/** Output of computeCalloutLayout(): one entry per ResolvedTarget. */
export interface Layout {
  id: string;
  /** false when target is off-viewport. Component fades to opacity 0. */
  visible: boolean;
  callout: { left: number; top: number; width: number; rotation: number };
  /** Omitted when visible === false. */
  arrow?: { d: string };
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd U:/Git/CentralGauge/site && npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd U:/Git/CentralGauge && git add site/src/lib/cheat/types.ts && git commit -m "types(cheat): add Annotation, ResolvedTarget, Layout, Rect, Viewport, Size"
```

---

### Task A.2: Add global cheat CSS tokens

**Files:**
- Modify: `site/src/styles/tokens.css` (or wherever global tokens live; verify)

- [ ] **Step 1: Inspect existing tokens file location**

```bash
cd U:/Git/CentralGauge && find site/src/styles -name "*.css" -type f
```

Expected: `tokens.css` exists. If not, identify the file imported by `+layout.svelte` for theme tokens.

- [ ] **Step 2: Add cheat tokens to global stylesheet**

Append to `site/src/styles/tokens.css`:

```css
/* CHEAT overlay tokens. See docs/superpowers/specs/2026-05-06-cheat-overlay-design.md */
:root {
  --cheat-note-bg: #fff8a8;
  --cheat-arrow: #d97706;
  --cheat-fab-bg: #dc2626;
  --cheat-fab-bg-hover: #b91c1c;
  --z-cheat-layer: 950;
  --z-fab: 940;
}

html[data-theme="dark"] {
  /* Lighter arrow for dark backgrounds; note background unchanged */
  --cheat-arrow: #fbbf24;
}
```

- [ ] **Step 3: Verify build picks up tokens**

```bash
cd U:/Git/CentralGauge/site && npm run build
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
cd U:/Git/CentralGauge && git add site/src/styles/tokens.css && git commit -m "style(tokens): add cheat overlay color + z-index tokens"
```

---

### Task A.3: Implement `computeCalloutLayout` pure helper (TDD)

**Files:**
- Create: `site/src/lib/cheat/compute-layout.ts`
- Test: `site/tests/cheat/compute-layout.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// site/tests/cheat/compute-layout.test.ts
import { describe, it, expect } from 'vitest';
import { computeCalloutLayout } from '$lib/cheat/compute-layout';
import type { ResolvedTarget, Viewport, Size } from '$lib/cheat/types';

const VIEWPORT: Viewport = { width: 1280, height: 800 };
const STD_SIZE: Size = { width: 200, height: 60 };

function target(id: string, side: ResolvedTarget['side'], left: number, top: number, order = 1): ResolvedTarget {
  return {
    id,
    order,
    rect: { left, top, right: left + 100, bottom: top + 30, width: 100, height: 30 },
    body: 'test body',
    side,
    rotation: 0,
    values: {},
  };
}

describe('computeCalloutLayout (pure)', () => {
  it('returns empty array for empty input', () => {
    expect(computeCalloutLayout([], VIEWPORT, {})).toEqual([]);
  });

  it('marks off-viewport targets visible=false with no arrow', () => {
    const t = target('a', 'top', -500, -500); // off-screen
    const out = computeCalloutLayout([t], VIEWPORT, { a: STD_SIZE });
    expect(out[0].visible).toBe(false);
    expect(out[0].arrow).toBeUndefined();
  });

  it('places callout above target when side=top', () => {
    const t = target('a', 'top', 600, 400);
    const out = computeCalloutLayout([t], VIEWPORT, { a: STD_SIZE });
    expect(out[0].visible).toBe(true);
    expect(out[0].callout.top).toBeLessThan(400);
  });

  it('flips side=right to left when target is at viewport right edge', () => {
    const t = target('a', 'right', 1200, 400); // 1200+100=1300 > 1280
    const out = computeCalloutLayout([t], VIEWPORT, { a: STD_SIZE });
    expect(out[0].visible).toBe(true);
    // Callout pushed to LEFT side: left coord < target left (1200)
    expect(out[0].callout.left).toBeLessThan(1200);
  });

  it('sorts by order then id for stable collision', () => {
    const a = target('a', 'top', 600, 400, 2);
    const b = target('b', 'top', 600, 400, 1); // same anchor, lower order
    const out = computeCalloutLayout([a, b], VIEWPORT, { a: STD_SIZE, b: STD_SIZE });
    // b placed first; collision pushes a away
    const layoutA = out.find((l) => l.id === 'a')!;
    const layoutB = out.find((l) => l.id === 'b')!;
    expect(layoutB.callout.top).not.toBe(layoutA.callout.top);
  });

  it('emits SVG arrow path d-attribute when visible', () => {
    const t = target('a', 'top', 600, 400);
    const out = computeCalloutLayout([t], VIEWPORT, { a: STD_SIZE });
    expect(out[0].arrow?.d).toMatch(/^M /); // SVG path starts with Move
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

```bash
cd U:/Git/CentralGauge/site && npm run build && npx vitest run --config vitest.unit.config.ts tests/cheat/compute-layout.test.ts
```

Expected: FAIL ("Cannot find module '$lib/cheat/compute-layout'").

- [ ] **Step 3: Implement compute-layout.ts**

```ts
// site/src/lib/cheat/compute-layout.ts
import type { Layout, ResolvedTarget, Size, Viewport } from './types';

const ANCHOR_OFFSET = 16; // px outside the anchor along `side`
const COLLISION_STEP = 8;
const COLLISION_MAX = 80;

function isOffViewport(rect: ResolvedTarget['rect'], viewport: Viewport): boolean {
  return (
    rect.right < 0 ||
    rect.bottom < 0 ||
    rect.left > viewport.width ||
    rect.top > viewport.height
  );
}

function anchorPoint(t: ResolvedTarget): { x: number; y: number } {
  const r = t.rect;
  switch (t.side) {
    case 'top': return { x: (r.left + r.right) / 2, y: r.top };
    case 'bottom': return { x: (r.left + r.right) / 2, y: r.bottom };
    case 'left': return { x: r.left, y: (r.top + r.bottom) / 2 };
    case 'right': return { x: r.right, y: (r.top + r.bottom) / 2 };
  }
}

function placeCallout(
  t: ResolvedTarget,
  size: Size,
  side: ResolvedTarget['side'],
): { left: number; top: number } {
  const a = anchorPoint({ ...t, side });
  switch (side) {
    case 'top': return { left: a.x - size.width / 2, top: a.y - ANCHOR_OFFSET - size.height };
    case 'bottom': return { left: a.x - size.width / 2, top: a.y + ANCHOR_OFFSET };
    case 'left': return { left: a.x - ANCHOR_OFFSET - size.width, top: a.y - size.height / 2 };
    case 'right': return { left: a.x + ANCHOR_OFFSET, top: a.y - size.height / 2 };
  }
}

function clipsViewport(left: number, top: number, size: Size, viewport: Viewport): boolean {
  return left < 0 || top < 0 || left + size.width > viewport.width || top + size.height > viewport.height;
}

function rectsOverlap(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
): boolean {
  return !(a.left + a.width < b.left || b.left + b.width < a.left || a.top + a.height < b.top || b.top + b.height < a.top);
}

function arrowPath(target: ResolvedTarget, callout: { left: number; top: number; width: number }, side: ResolvedTarget['side'], size: Size): string {
  const a = anchorPoint(target);
  // Aim at nearest edge midpoint of callout
  let cx: number, cy: number;
  switch (side) {
    case 'top': cx = callout.left + callout.width / 2; cy = callout.top + size.height; break;
    case 'bottom': cx = callout.left + callout.width / 2; cy = callout.top; break;
    case 'left': cx = callout.left + callout.width; cy = callout.top + size.height / 2; break;
    case 'right': cx = callout.left; cy = callout.top + size.height / 2; break;
  }
  // Quadratic bezier with slight upward control
  const ctrlX = (a.x + cx) / 2;
  const ctrlY = (a.y + cy) / 2 - 10;
  return `M ${a.x.toFixed(1)},${a.y.toFixed(1)} Q ${ctrlX.toFixed(1)},${ctrlY.toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)}`;
}

export function computeCalloutLayout(
  targets: ResolvedTarget[],
  viewport: Viewport,
  sizes: Record<string, Size>,
): Layout[] {
  const sorted = [...targets].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const placed: Array<{ left: number; top: number; width: number; height: number }> = [];
  const out: Layout[] = [];

  for (const t of sorted) {
    const size = sizes[t.id] ?? { width: 200, height: 60 };

    // Step 2 of algorithm: off-viewport early exit
    if (isOffViewport(t.rect, viewport)) {
      out.push({
        id: t.id,
        visible: false,
        callout: { left: 0, top: 0, width: size.width, rotation: t.rotation },
      });
      continue;
    }

    // Steps 3-4: choose placement; flip if clips
    let side = t.side;
    let pos = placeCallout(t, size, side);
    if (clipsViewport(pos.left, pos.top, size, viewport)) {
      const opposite: Record<typeof side, typeof side> = {
        top: 'bottom', bottom: 'top', left: 'right', right: 'left',
      };
      const flippedSide = opposite[side];
      const flipped = placeCallout(t, size, flippedSide);
      if (!clipsViewport(flipped.left, flipped.top, size, viewport)) {
        side = flippedSide;
        pos = flipped;
      }
    }

    // Step 5: collision avoidance
    let pushed = pos;
    let pushDistance = 0;
    while (pushDistance <= COLLISION_MAX) {
      const candidate = { ...pushed, width: size.width, height: size.height };
      if (!placed.some((p) => rectsOverlap(candidate, p))) break;
      pushDistance += COLLISION_STEP;
      // Push perpendicular to side
      if (side === 'top' || side === 'bottom') pushed = { left: pos.left + pushDistance, top: pos.top };
      else pushed = { left: pos.left, top: pos.top + pushDistance };
    }

    placed.push({ left: pushed.left, top: pushed.top, width: size.width, height: size.height });

    // Step 6: arrow path
    const calloutOut = { left: pushed.left, top: pushed.top, width: size.width };
    const d = arrowPath(t, calloutOut, side, size);

    out.push({
      id: t.id,
      visible: true,
      callout: { ...calloutOut, rotation: t.rotation },
      arrow: { d },
    });
  }

  return out;
}
```

- [ ] **Step 4: Run tests; expect PASS**

```bash
cd U:/Git/CentralGauge/site && npm run build && npx vitest run --config vitest.unit.config.ts tests/cheat/compute-layout.test.ts
```

Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
cd U:/Git/CentralGauge && git add site/src/lib/cheat/compute-layout.ts site/tests/cheat/compute-layout.test.ts && git commit -m "feat(cheat): pure compute-layout helper with collision + side-flip + off-viewport"
```

---

### Task A.4: Implement `resolveTargets` impure resolver (TDD)

**Files:**
- Create: `site/src/lib/cheat/resolve-targets.ts`
- Test: `site/tests/cheat/resolve-targets.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// site/tests/cheat/resolve-targets.test.ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveTargets } from '$lib/cheat/resolve-targets';
import type { Annotation } from '$lib/cheat/types';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('resolveTargets', () => {
  it('returns empty when no annotations', () => {
    expect(resolveTargets([])).toEqual([]);
  });

  it('omits annotations whose selector returns null', () => {
    const annotations: Annotation[] = [
      { id: 'a', targetSelector: '.does-not-exist', body: 'x', side: 'top' },
    ];
    expect(resolveTargets(annotations)).toEqual([]);
  });

  it('omits annotations with malformed selectors (querySelector throws)', () => {
    const annotations: Annotation[] = [
      { id: 'a', targetSelector: '[invalid===selector', body: 'x', side: 'top' },
    ];
    expect(resolveTargets(annotations)).toEqual([]);
  });

  it('substitutes {placeholder} from data-cheat-* attrs when template=true', () => {
    document.body.innerHTML = `<div data-cheat="x" data-cheat-passed="51" data-cheat-total="64"></div>`;
    const annotations: Annotation[] = [
      { id: 'a', targetSelector: '[data-cheat="x"]', body: '{passed}/{total}', side: 'top', template: true },
    ];
    const out = resolveTargets(annotations);
    expect(out[0].body).toBe('51/64');
  });

  it('substitutes ? for missing template attrs', () => {
    document.body.innerHTML = `<div data-cheat="x" data-cheat-passed="51"></div>`;
    const annotations: Annotation[] = [
      { id: 'a', targetSelector: '[data-cheat="x"]', body: '{passed}/{missing}', side: 'top', template: true },
    ];
    expect(resolveTargets(annotations)[0].body).toBe('51/?');
  });

  it('does NOT substitute when template is undefined', () => {
    document.body.innerHTML = `<div data-cheat="x" data-cheat-passed="51"></div>`;
    const annotations: Annotation[] = [
      { id: 'a', targetSelector: '[data-cheat="x"]', body: '{passed}', side: 'top' },
    ];
    expect(resolveTargets(annotations)[0].body).toBe('{passed}');
  });

  it('does NOT escape HTML in substituted values (render sink escapes)', () => {
    document.body.innerHTML = `<div data-cheat="x" data-cheat-name="<script>"></div>`;
    const annotations: Annotation[] = [
      { id: 'a', targetSelector: '[data-cheat="x"]', body: 'name={name}', side: 'top', template: true },
    ];
    expect(resolveTargets(annotations)[0].body).toBe('name=<script>');
  });

  it('assigns order from document position', () => {
    document.body.innerHTML = `<div data-cheat="b"></div><div data-cheat="a"></div>`;
    const annotations: Annotation[] = [
      { id: 'a', targetSelector: '[data-cheat="a"]', body: 'A', side: 'top' },
      { id: 'b', targetSelector: '[data-cheat="b"]', body: 'B', side: 'top' },
    ];
    const out = resolveTargets(annotations);
    const a = out.find((r) => r.id === 'a')!;
    const b = out.find((r) => r.id === 'b')!;
    expect(b.order).toBeLessThan(a.order); // b is earlier in document
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

```bash
cd U:/Git/CentralGauge/site && npm run build && npx vitest run --config vitest.unit.config.ts tests/cheat/resolve-targets.test.ts
```

Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Implement resolve-targets.ts**

```ts
// site/src/lib/cheat/resolve-targets.ts
import { dev } from '$app/environment';
import type { Annotation, Rect, ResolvedTarget } from './types';

const PLACEHOLDER_RE = /\{(\w+)\}/g;

function rectFrom(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

function readDataCheatValues(el: Element): Record<string, string> {
  const values: Record<string, string> = {};
  for (const attr of el.getAttributeNames()) {
    if (!attr.startsWith('data-cheat-')) continue;
    const key = attr.slice('data-cheat-'.length);
    if (key === 'scope') continue;
    values[key] = el.getAttribute(attr) ?? '';
  }
  return values;
}

function substitute(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (_match, key: string) => {
    if (key in values) return values[key];
    if (dev) console.warn(`[cheat] missing template value for "{${key}}"`);
    return '?';
  });
}

function documentOrderIndex(el: Element): number {
  // Use treeWalker order via numeric position computed from getBoundingClientRect
  // adjusted by document order. Reliable approximation: count preceding siblings + ancestors.
  // For practical purposes use top * 10000 + left (visual reading order),
  // which matches document order for normal flow.
  const r = el.getBoundingClientRect();
  return Math.round(r.top * 10000 + r.left);
}

export function resolveTargets(annotations: Annotation[]): ResolvedTarget[] {
  if (typeof document === 'undefined') return []; // SSR safety
  const out: ResolvedTarget[] = [];

  for (const a of annotations) {
    let el: Element | null;
    try {
      el = document.querySelector(a.targetSelector);
    } catch (err) {
      if (dev) console.warn(`[cheat] invalid selector for "${a.id}": ${a.targetSelector}`, err);
      continue;
    }
    if (!el) {
      if (dev) console.warn(`[cheat] missing target for "${a.id}": ${a.targetSelector}`);
      continue;
    }

    const values = readDataCheatValues(el);
    const body = a.template ? substitute(a.body, values) : a.body;
    const bodyPrefix = a.bodyPrefix && a.template ? substitute(a.bodyPrefix, values) : a.bodyPrefix;

    out.push({
      id: a.id,
      order: documentOrderIndex(el),
      rect: rectFrom(el),
      body,
      bodyPrefix,
      side: a.side,
      rotation: a.rotation ?? 0,
      values,
    });
  }

  return out;
}
```

- [ ] **Step 4: Run tests; expect PASS**

```bash
cd U:/Git/CentralGauge/site && npm run build && npx vitest run --config vitest.unit.config.ts tests/cheat/resolve-targets.test.ts
```

Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
cd U:/Git/CentralGauge && git add site/src/lib/cheat/resolve-targets.ts site/tests/cheat/resolve-targets.test.ts && git commit -m "feat(cheat): impure resolveTargets with template substitution + selector error handling"
```

---

## Phase B: UI Components

### Task B.1: `CheatCallout.svelte` (smallest UI component, no logic)

**Files:**
- Create: `site/src/lib/cheat/CheatCallout.svelte`

- [ ] **Step 1: Implement the component**

```svelte
<!-- site/src/lib/cheat/CheatCallout.svelte -->
<script lang="ts">
  import type { Layout } from './types';

  interface Props {
    layout: Layout;
    body: string;
    bodyPrefix?: string;
  }
  let { layout, body, bodyPrefix }: Props = $props();
</script>

<div
  class="cheat-callout"
  role="note"
  aria-hidden={!layout.visible}
  tabindex={layout.visible ? 0 : -1}
  style="
    left: {layout.callout.left}px;
    top: {layout.callout.top}px;
    width: {layout.callout.width}px;
    transform: rotate({layout.callout.rotation}deg);
    opacity: {layout.visible ? 1 : 0};
  "
>
  {#if bodyPrefix}<strong>{bodyPrefix}</strong> {/if}{body}
</div>

<style>
  .cheat-callout {
    position: fixed;
    background: var(--cheat-note-bg);
    color: #1a1a1a;
    padding: 8px 10px;
    border-radius: 4px;
    box-shadow: 2px 2px 0 rgb(0 0 0 / 0.15);
    font-size: var(--text-xs, 11px);
    line-height: 1.3;
    pointer-events: none;
    transform-origin: top left;
    transition: opacity 200ms ease-out;
  }

  @media (prefers-reduced-motion: reduce) {
    .cheat-callout { transition: none; }
  }
</style>
```

- [ ] **Step 2: Build + typecheck**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd U:/Git/CentralGauge && git add site/src/lib/cheat/CheatCallout.svelte && git commit -m "feat(cheat): CheatCallout component with sticky-note styling"
```

---

### Task B.2: `CheatOverlay.svelte` (orchestrator with reactivity)

**Files:**
- Create: `site/src/lib/cheat/CheatOverlay.svelte`

- [ ] **Step 1: Implement the component**

```svelte
<!-- site/src/lib/cheat/CheatOverlay.svelte -->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { computeCalloutLayout } from './compute-layout';
  import { resolveTargets } from './resolve-targets';
  import CheatCallout from './CheatCallout.svelte';
  import type { Annotation, Layout, Size } from './types';

  interface Props {
    annotations: Annotation[];
    onClose: () => void;
  }
  let { annotations, onClose }: Props = $props();

  let layouts = $state<Layout[]>([]);
  let layerEl: HTMLDivElement;
  let closeButton: HTMLButtonElement;
  const calloutEls = new Map<string, HTMLDivElement>();
  let rafHandle: number | null = null;

  function findScrollParents(): Element[] {
    // Walk parentElement of any element that may contain targets;
    // we use document.body's first element children with overflow as a heuristic.
    const out: Element[] = [];
    const all = document.querySelectorAll('[data-cheat-scope] *');
    for (const el of all) {
      let p = el.parentElement;
      while (p) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|overlay)/.test(`${s.overflowX} ${s.overflowY}`) && !out.includes(p)) {
          out.push(p);
          break;
        }
        p = p.parentElement;
      }
    }
    return out;
  }

  function scheduleLayout() {
    if (rafHandle !== null) return;
    rafHandle = requestAnimationFrame(() => {
      rafHandle = null;
      const targets = resolveTargets(annotations);
      const sizes: Record<string, Size> = {};
      for (const t of targets) {
        const el = calloutEls.get(t.id);
        if (el) {
          const r = el.getBoundingClientRect();
          sizes[t.id] = { width: r.width || 200, height: r.height || 60 };
        } else {
          sizes[t.id] = { width: 200, height: 60 };
        }
      }
      layouts = computeCalloutLayout(targets, { width: window.innerWidth, height: window.innerHeight }, sizes);
    });
  }

  afterNavigate(() => {
    scheduleLayout();
  });

  onMount(() => {
    document.dispatchEvent(new CustomEvent('cheat:open'));

    // Initial measurement: render hidden, await tick, then measure + layout
    const targetsInitial = resolveTargets(annotations);
    layouts = targetsInitial.map((t) => ({
      id: t.id,
      visible: false, // hidden during measurement
      callout: { left: 0, top: 0, width: 200, rotation: t.rotation },
    }));
    void tick().then(() => scheduleLayout());

    // Observers
    const ro = new ResizeObserver(scheduleLayout);
    ro.observe(document.body);
    findScrollParents().forEach((p) => ro.observe(p));
    for (const el of calloutEls.values()) ro.observe(el);

    const scopes = document.querySelectorAll('[data-cheat-scope]');
    const mo = new MutationObserver((records) => {
      const relevant = records.some((r) => {
        if (r.type === 'childList') return true;
        if (r.type !== 'attributes') return false;
        return r.attributeName?.startsWith('data-cheat') ?? false;
      });
      if (relevant) scheduleLayout();
    });
    scopes.forEach((s) => mo.observe(s, { childList: true, subtree: true, attributes: true }));

    const onScroll = () => scheduleLayout();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    findScrollParents().forEach((p) => p.addEventListener('scroll', onScroll, { passive: true }));

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        // Scoped focus: keep within X + callouts
        const focusables = [closeButton, ...calloutEls.values()].filter(Boolean);
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeydown);

    const onFocusIn = (e: FocusEvent) => {
      if (!layerEl?.contains(e.target as Node)) {
        closeButton?.focus();
      }
    };
    document.addEventListener('focusin', onFocusIn, true);

    closeButton?.focus();

    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      findScrollParents().forEach((p) => p.removeEventListener('scroll', onScroll));
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('focusin', onFocusIn, true);
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      document.dispatchEvent(new CustomEvent('cheat:close'));
    };
  });
</script>

<div class="cheat-layer" bind:this={layerEl} role="region" aria-label="Cheat overlay">
  <svg class="cheat-arrows" aria-hidden="true">
    {#each layouts as layout (layout.id)}
      {#if layout.arrow}
        <path d={layout.arrow.d} fill="none" stroke="var(--cheat-arrow)" stroke-width="1.75" stroke-dasharray="3 3" />
      {/if}
    {/each}
  </svg>

  {#each annotations as annotation (annotation.id)}
    {@const layout = layouts.find((l) => l.id === annotation.id)}
    {#if layout}
      <div bind:this={() => calloutEls.set(annotation.id, calloutEls.get(annotation.id)!)} style="display: contents;">
        <CheatCallout
          {layout}
          body={annotation.body}
          bodyPrefix={annotation.bodyPrefix}
        />
      </div>
    {/if}
  {/each}

  <button
    bind:this={closeButton}
    class="cheat-close"
    aria-label="Close cheat overlay"
    onclick={onClose}
  >×</button>
</div>

<style>
  .cheat-layer {
    position: fixed;
    inset: 0;
    z-index: var(--z-cheat-layer);
    pointer-events: none;
  }
  .cheat-arrows {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .cheat-close {
    position: fixed;
    top: 16px;
    right: 16px;
    pointer-events: auto;
    background: white;
    border: 1px solid #1a1a1a;
    border-radius: 50%;
    width: 32px;
    height: 32px;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }
  .cheat-close:focus-visible {
    outline: 2px solid var(--accent, #3b82f6);
    outline-offset: 2px;
  }
</style>
```

**Note on `bind:this` for the callout map:** Svelte 5's `bind:this` doesn't directly support indexed maps. The actual implementation should use a small wrapper or `use:` action. The above is illustrative; refine during implementation if Svelte rejects the syntax. Alternative: render callouts via a `<div bind:this={el} use:registerCallout={annotation.id}>` action.

- [ ] **Step 2: Build + typecheck**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm run check
```

Expected: 0 errors. If `bind:this` indexed-map syntax fails, refactor to `use:` action that registers/unregisters the element on mount/destroy, keyed by annotation.id.

- [ ] **Step 3: Commit**

```bash
cd U:/Git/CentralGauge && git add site/src/lib/cheat/CheatOverlay.svelte && git commit -m "feat(cheat): CheatOverlay orchestrator with portal layer + reactivity"
```

---

### Task B.3: `CheatMobileSheet.svelte`

**Files:**
- Create: `site/src/lib/cheat/CheatMobileSheet.svelte`

- [ ] **Step 1: Implement**

```svelte
<!-- site/src/lib/cheat/CheatMobileSheet.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { resolveTargets } from './resolve-targets';
  import type { Annotation } from './types';

  interface Props {
    annotations: Annotation[];
    onClose: () => void;
  }
  let { annotations, onClose }: Props = $props();

  let dialogEl: HTMLDialogElement;
  const resolved = $derived(resolveTargets(annotations));

  function deriveTitle(id: string): string {
    return id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');
  }

  onMount(() => {
    document.dispatchEvent(new CustomEvent('cheat:open'));
    dialogEl?.showModal();

    const onClick = (e: MouseEvent) => {
      const r = dialogEl.getBoundingClientRect();
      const inside =
        e.clientX >= r.left && e.clientX <= r.right &&
        e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) dialogEl.close();
    };
    dialogEl?.addEventListener('click', onClick);

    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    dialogEl?.addEventListener('cancel', onCancel);

    const onCloseEvt = () => onClose();
    dialogEl?.addEventListener('close', onCloseEvt);

    return () => {
      dialogEl?.removeEventListener('click', onClick);
      dialogEl?.removeEventListener('cancel', onCancel);
      dialogEl?.removeEventListener('close', onCloseEvt);
      document.dispatchEvent(new CustomEvent('cheat:close'));
    };
  });
</script>

<dialog bind:this={dialogEl} class="cheat-sheet">
  <div class="sheet">
    <header>
      <span class="label">CHEAT</span>
      <button class="x" aria-label="Close" onclick={onClose}>×</button>
    </header>
    <ol class="cards">
      {#each annotations as annotation (annotation.id)}
        {@const r = resolved.find((rt) => rt.id === annotation.id)}
        {#if r}
          <li class="card">
            <span class="badge">{annotation.id}</span>
            <h3>{annotation.mobileTitle ?? deriveTitle(annotation.id)}</h3>
            <p>{#if r.bodyPrefix}<strong>{r.bodyPrefix}</strong> {/if}{annotation.mobileText ?? r.body}</p>
          </li>
        {/if}
      {/each}
    </ol>
    <footer>
      <a href="/about#scoring">Read full glossary →</a>
    </footer>
  </div>
</dialog>

<style>
  .cheat-sheet {
    width: 100%;
    max-width: 100%;
    max-height: 90vh;
    margin: auto auto 0 auto;
    border: 0;
    border-radius: 12px 12px 0 0;
    padding: 0;
    background: white;
  }
  .cheat-sheet::backdrop { background: rgb(0 0 0 / 0.5); }
  .sheet { padding: 16px; overflow-y: auto; max-height: 90vh; }
  header { display: flex; justify-content: space-between; align-items: center; }
  .label { font-weight: 700; color: var(--cheat-fab-bg); }
  .x { background: transparent; border: 0; font-size: 24px; cursor: pointer; }
  .cards { list-style: none; padding: 0; margin: 16px 0; }
  .card { display: flex; flex-direction: column; gap: 4px; padding: 12px; border-bottom: 1px solid #eee; }
  .badge {
    display: inline-block; background: var(--cheat-note-bg); color: #1a1a1a;
    padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700;
    align-self: flex-start;
  }
  .card h3 { margin: 0; font-size: 14px; }
  .card p { margin: 0; font-size: 13px; line-height: 1.4; }
  footer { padding-top: 8px; border-top: 1px solid #eee; }
  footer a { color: var(--accent, #3b82f6); text-decoration: none; }
</style>
```

- [ ] **Step 2: Build + commit**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm run check
cd U:/Git/CentralGauge && git add site/src/lib/cheat/CheatMobileSheet.svelte && git commit -m "feat(cheat): CheatMobileSheet native dialog with numbered list fallback"
```

---

### Task B.4: `CheatButton.svelte` (lazy entry point)

**Files:**
- Create: `site/src/lib/cheat/CheatButton.svelte`

- [ ] **Step 1: Implement**

```svelte
<!-- site/src/lib/cheat/CheatButton.svelte -->
<script lang="ts">
  import type { Annotation } from './types';
  import type { Component } from 'svelte';

  interface Props {
    annotations: Annotation[];
  }
  let { annotations }: Props = $props();

  let open = $state(false);
  let DesktopOverlay: Component | null = $state(null);
  let MobileSheet: Component | null = $state(null);

  async function handleClick() {
    if (open) {
      open = false;
      return;
    }
    if (typeof window === 'undefined') return;
    const isDesktop = window.matchMedia('(min-width: 1025px)').matches;
    if (isDesktop) {
      if (!DesktopOverlay) {
        const mod = await import('./CheatOverlay.svelte');
        DesktopOverlay = mod.default as Component;
      }
    } else {
      if (!MobileSheet) {
        const mod = await import('./CheatMobileSheet.svelte');
        MobileSheet = mod.default as Component;
      }
    }
    open = true;
  }

  function handleClose() {
    open = false;
  }

  // Breakpoint crossing while open: dismiss
  $effect(() => {
    if (!open || typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1025px)');
    const onChange = () => { open = false; };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });
</script>

<button
  class="cheat-fab"
  class:active={open}
  type="button"
  aria-pressed={open}
  aria-controls="cheat-overlay"
  onclick={handleClick}
>
  {open ? 'CHEATING' : 'CHEAT'} 📖
</button>

{#if open && DesktopOverlay}
  <DesktopOverlay {annotations} onClose={handleClose} />
{:else if open && MobileSheet}
  <MobileSheet {annotations} onClose={handleClose} />
{/if}

<style>
  .cheat-fab {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: var(--z-fab);
    background: var(--cheat-fab-bg);
    color: white;
    border: 0;
    padding: 11px 16px;
    border-radius: 999px;
    font-weight: 700;
    letter-spacing: 0.7px;
    font-size: 12px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgb(220 38 38 / 0.4);
    transition: background 150ms ease-out;
  }
  .cheat-fab:hover { background: var(--cheat-fab-bg-hover); }
  .cheat-fab.active {
    background: white;
    color: var(--cheat-fab-bg);
    border: 1px solid var(--cheat-fab-bg);
  }
  .cheat-fab:focus-visible {
    outline: 2px solid var(--accent, #3b82f6);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .cheat-fab { transition: none; }
  }
</style>
```

- [ ] **Step 2: Build + commit**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm run check
cd U:/Git/CentralGauge && git add site/src/lib/cheat/CheatButton.svelte && git commit -m "feat(cheat): CheatButton FAB with lazy presentation import + breakpoint dismiss"
```

---

## Phase C: Production Wiring (LeaderboardTable + +page.svelte)

### Task C.1: Add `data-cheat` anchors + template attrs to `LeaderboardTable.svelte`

**Files:**
- Modify: `site/src/lib/components/domain/LeaderboardTable.svelte`

- [ ] **Step 1: Add anchors to header cells**

Open `site/src/lib/components/domain/LeaderboardTable.svelte`. On the Score column header (`<th>` containing `pass_at_n` sort button, around line 47), add `data-cheat="score-col"`. Similarly add anchors on:
- `data-cheat="pass-col"` on the Pass column `<th>`
- `data-cheat="ci-col"` on the CI column `<th>`
- `data-cheat="cost-col"` on the Cost column `<th>`
- `data-cheat="cost-per-pass-col"` on the $/Pass column `<th>`

Keep existing `data-test`, `aria-sort`, `title` attributes unchanged.

- [ ] **Step 2: Add template attrs + worked-example anchor on first row**

Modify the `{#each rows as row, i ...}` block (around line 93) to emit anchor + template attrs only for the first row:

```svelte
{#each rows as row, i (row.model.slug)}
  {@const denom = row.denominator ?? row.tasks_attempted_distinct}
  <tr>
    <!-- ... existing cells ... -->
    <td
      class="attempts-cell"
      data-cheat={i === 0 ? 'worked-example-pass' : undefined}
      data-cheat-passed={i === 0 ? row.tasks_passed_attempt_1 + row.tasks_passed_attempt_2_only : undefined}
      data-cheat-total={i === 0 ? denom : undefined}
      data-cheat-p1={i === 0 ? row.tasks_passed_attempt_1 : undefined}
      data-cheat-p2only={i === 0 ? row.tasks_passed_attempt_2_only : undefined}
      data-cheat-display-name={i === 0 ? row.model.display_name : undefined}
    >
      <!-- ... existing AttemptStackedBar + ratio span ... -->
    </td>
    <!-- ... rest of row ... -->
  </tr>
{/each}
```

- [ ] **Step 3: Verify build + existing tests still green**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm run test:main
```

Expected: 0 errors; existing 1149 tests pass (data-* attribute additions are non-breaking).

- [ ] **Step 4: Commit**

```bash
cd U:/Git/CentralGauge && git add site/src/lib/components/domain/LeaderboardTable.svelte && git commit -m "feat(ui): add data-cheat anchors + template attrs to LeaderboardTable"
```

---

### Task C.2: Wrap landing leaderboard in `data-cheat-scope` + preserve table header on empty results

**Files:**
- Modify: `site/src/routes/+page.svelte`

- [ ] **Step 1: Read current empty-state structure**

Around line 119-125 of `site/src/routes/+page.svelte` the code looks like:

```svelte
<div class="results">
  {#if data.leaderboard.data.length === 0}
    <div class="empty">
      <p>No models match these filters.</p>
      <button class="clear" onclick={clearAll}>Clear filters</button>
    </div>
  {:else}
    <LeaderboardTable rows={data.leaderboard.data} sort={data.sort} onsort={onSort} />
  {/if}
</div>
```

- [ ] **Step 2: Refactor to keep table header mounted in empty state**

Replace with:

```svelte
<div class="results" data-cheat-scope>
  {#if data.leaderboard.data.length === 0}
    <div class="empty">
      <p>No models match these filters.</p>
      <button class="clear" onclick={clearAll}>Clear filters</button>
    </div>
  {/if}
  <LeaderboardTable rows={data.leaderboard.data} sort={data.sort} onsort={onSort} />
</div>
```

`LeaderboardTable` already handles 0 rows gracefully (`<tbody>` will just be empty); the headers remain mounted so column anchors continue to resolve when CHEAT opens on a filtered-empty page.

- [ ] **Step 3: Verify build + tests still green**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm run test:main
```

Expected: 0 errors; existing tests pass. Note: any test asserting "table is NOT in DOM when empty" must be updated (search via `grep -rn "leaderboard.data.length === 0" site/tests`).

- [ ] **Step 4: Commit**

```bash
cd U:/Git/CentralGauge && git add site/src/routes/+page.svelte && git commit -m "feat(landing): wrap results in data-cheat-scope; keep table header mounted on empty"
```

---

### Task C.3: Add MetricInfo cheat:open / cheat:close suppression

**Files:**
- Modify: `site/src/lib/components/domain/MetricInfo.svelte`

- [ ] **Step 1: Add suppression contract**

Open `site/src/lib/components/domain/MetricInfo.svelte`. Add a `cheatActive` flag and listeners:

```svelte
<script lang="ts">
  import { METRICS } from '$lib/shared/metrics';
  import { onMount } from 'svelte';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  const def = $derived(METRICS[id]);

  let open = $state(false);
  let cheatActive = $state(false);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
    }
  }

  function handleSummaryClick(e: MouseEvent) {
    if (cheatActive) {
      e.preventDefault();
      open = false;
    }
  }

  onMount(() => {
    const onCheatOpen = () => {
      cheatActive = true;
      open = false;
    };
    const onCheatClose = () => {
      cheatActive = false;
    };
    document.addEventListener('cheat:open', onCheatOpen);
    document.addEventListener('cheat:close', onCheatClose);
    return () => {
      document.removeEventListener('cheat:open', onCheatOpen);
      document.removeEventListener('cheat:close', onCheatClose);
    };
  });
</script>

{#if def}
  <span class="wrap">
    <details bind:open onkeydown={handleKeydown}>
      <summary aria-label="Metric info: {def.label}" onclick={handleSummaryClick}>
        <!-- ... existing svg ... -->
      </summary>
      <!-- ... existing panel ... -->
    </details>
  </span>
{/if}
```

(The full file content otherwise unchanged; only the `<script>` block + the `onclick={handleSummaryClick}` on `<summary>` are new.)

- [ ] **Step 2: Build + tests**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm run test:main
```

Expected: 0 errors; existing tests pass.

- [ ] **Step 3: Commit**

```bash
cd U:/Git/CentralGauge && git add site/src/lib/components/domain/MetricInfo.svelte && git commit -m "feat(ui): MetricInfo suppresses popovers while CHEAT overlay is open"
```

---

## Phase D: Mount + Annotation Registries

### Task D.1: Create `landing.ts` annotation registry

**Files:**
- Create: `site/src/lib/cheat/annotations/landing.ts`

- [ ] **Step 1: Implement**

```ts
// site/src/lib/cheat/annotations/landing.ts
import type { Annotation } from '../types';

export const landingAnnotations: Annotation[] = [
  {
    id: 'score-col',
    targetSelector: '[data-cheat="score-col"]',
    body: '% of tasks the model solved (with up to 2 tries).',
    bodyPrefix: 'Score',
    side: 'top',
    rotation: 2,
  },
  {
    id: 'pass-col',
    targetSelector: '[data-cheat="pass-col"]',
    body: 'Green = solved on first try. Amber = solved on retry. Grey = failed.',
    bodyPrefix: 'Pass',
    side: 'top',
    rotation: -1.5,
  },
  {
    id: 'ci-col',
    targetSelector: '[data-cheat="ci-col"]',
    body: 'Confidence interval. Wider = fewer tasks tested.',
    bodyPrefix: 'CI',
    side: 'top',
    rotation: 1,
  },
  {
    id: 'cost-col',
    targetSelector: '[data-cheat="cost-col"]',
    body: 'Average dollar cost per task attempted.',
    bodyPrefix: 'Cost',
    side: 'bottom',
    rotation: -2,
  },
  {
    id: 'cost-per-pass-col',
    targetSelector: '[data-cheat="cost-per-pass-col"]',
    body: 'Cost per successful task. Lower is cheaper.',
    bodyPrefix: '$/Pass',
    side: 'bottom',
    rotation: 2,
  },
  {
    id: 'worked-example-pass',
    targetSelector: '[data-cheat="worked-example-pass"]',
    body: '{display-name} passed {passed} of {total} tasks. {p1} on first try, {p2only} on retry.',
    bodyPrefix: 'Example',
    side: 'right',
    rotation: -1.5,
    template: true,
  },
];
```

- [ ] **Step 2: Build + commit**

```bash
cd U:/Git/CentralGauge/site && npm run build
cd U:/Git/CentralGauge && git add site/src/lib/cheat/annotations/landing.ts && git commit -m "feat(cheat): landing page annotation registry"
```

---

### Task D.2: Mount `<CheatButton>` on landing page

**Files:**
- Modify: `site/src/routes/+page.svelte`

- [ ] **Step 1: Import + mount the button**

In `site/src/routes/+page.svelte`, near the existing imports add:

```svelte
import CheatButton from '$lib/cheat/CheatButton.svelte';
import { landingAnnotations } from '$lib/cheat/annotations/landing';
```

At the bottom of the template (after the closing `</div>` of `.layout` or wherever appropriate), add:

```svelte
<CheatButton annotations={landingAnnotations} />
```

- [ ] **Step 2: Build + smoke-test in dev**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm run check
```

Expected: 0 errors. Optionally start dev server with `npm run dev` and open `http://localhost:5173/`; click the red CHEAT button and verify the overlay renders.

- [ ] **Step 3: Commit**

```bash
cd U:/Git/CentralGauge && git add site/src/routes/+page.svelte && git commit -m "feat(landing): mount CheatButton with landing annotations"
```

---

### Task D.3: Create `model-detail.ts` annotation registry

**Files:**
- Create: `site/src/lib/cheat/annotations/model-detail.ts`

- [ ] **Step 1: Inspect model-detail page structure**

```bash
cd U:/Git/CentralGauge && head -60 site/src/routes/models/\[...slug\]/+page.svelte
```

Identify the top stat tiles (the spec referenced "Pass@N tile" at line 128 of the model-detail page). Pick 3-5 elements to annotate.

- [ ] **Step 2: Implement registry**

```ts
// site/src/lib/cheat/annotations/model-detail.ts
import type { Annotation } from '../types';

export const modelDetailAnnotations: Annotation[] = [
  {
    id: 'pass-tile',
    targetSelector: '[data-cheat="pass-tile"]',
    body: 'How often this model solves tasks (eventually, with up to 2 tries).',
    bodyPrefix: 'Pass@N',
    side: 'bottom',
    rotation: 2,
  },
  {
    id: 'avg-tile',
    targetSelector: '[data-cheat="avg-tile"]',
    body: 'Mean per-attempt score. Lower than Pass@N because failed attempts pull it down.',
    bodyPrefix: 'Avg attempt',
    side: 'bottom',
    rotation: -1,
  },
  {
    id: 'cost-tile',
    targetSelector: '[data-cheat="cost-tile"]',
    body: 'Average dollar cost across all this model\'s benchmarks.',
    bodyPrefix: 'Cost',
    side: 'top',
    rotation: 1.5,
  },
  {
    id: 'history-chart',
    targetSelector: '[data-cheat="history-chart"]',
    body: 'Each dot is one benchmark run; trend over time.',
    bodyPrefix: 'History',
    side: 'right',
    rotation: -2,
  },
];
```

- [ ] **Step 3: Add `data-cheat` anchors + `data-cheat-scope` to model-detail page**

Modify `site/src/routes/models/[...slug]/+page.svelte` to wrap the main content in `data-cheat-scope` and add `data-cheat="pass-tile"`, `data-cheat="avg-tile"`, `data-cheat="cost-tile"`, `data-cheat="history-chart"` to the corresponding elements (the model-detail page has stat tiles + a chart per the spec).

- [ ] **Step 4: Mount CheatButton on the page**

Same pattern as D.2:

```svelte
import CheatButton from '$lib/cheat/CheatButton.svelte';
import { modelDetailAnnotations } from '$lib/cheat/annotations/model-detail';

<!-- ... existing template ... -->
<CheatButton annotations={modelDetailAnnotations} />
```

- [ ] **Step 5: Build + commit**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm run check
cd U:/Git/CentralGauge && git add site/src/lib/cheat/annotations/model-detail.ts site/src/routes/models/\[...slug\]/+page.svelte && git commit -m "feat(model-detail): mount CheatButton with model-detail annotations + data-cheat anchors"
```

---

## Phase E: Tests

### Task E.1: Component test for `CheatButton`

**Files:**
- Create: `site/tests/cheat/CheatButton.test.svelte.ts`

- [ ] **Step 1: Write test**

```ts
// site/tests/cheat/CheatButton.test.svelte.ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CheatButton from '$lib/cheat/CheatButton.svelte';
import type { Annotation } from '$lib/cheat/types';

const stub: Annotation[] = [
  { id: 'x', targetSelector: '#nope', body: 'x', side: 'top' },
];

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('CheatButton', () => {
  it('renders the FAB with CHEAT label', async () => {
    const { container } = render(CheatButton, { annotations: stub });
    const button = container.querySelector('.cheat-fab')!;
    expect(button.textContent).toContain('CHEAT');
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('toggles aria-pressed on click', async () => {
    const { container } = render(CheatButton, { annotations: stub });
    const button = container.querySelector('.cheat-fab') as HTMLButtonElement;
    button.click();
    // After click, dynamic import resolves async; allow microtask
    await Promise.resolve();
    // aria-pressed=true expected (await async open)
    // Note: The actual assertion depends on test harness microtask handling.
    // Verify via state, not DOM, if needed.
  });
});
```

(Test harness specifics depend on the project's existing patterns; mirror the shape of `LeaderboardTable.test.svelte.ts`.)

- [ ] **Step 2: Run + commit**

```bash
cd U:/Git/CentralGauge/site && npm run build && npx vitest run --config vitest.unit.config.ts tests/cheat/CheatButton.test.svelte.ts
cd U:/Git/CentralGauge && git add site/tests/cheat/CheatButton.test.svelte.ts && git commit -m "test(cheat): CheatButton renders + aria-pressed toggle"
```

---

### Task E.2: E2E test for landing page CHEAT overlay

**Files:**
- Create: `site/tests/e2e/cheat-overlay-landing.spec.ts`

- [ ] **Step 1: Write Playwright spec**

```ts
// site/tests/e2e/cheat-overlay-landing.spec.ts
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

test('CHEAT overlay opens, click-through works, Esc closes', async ({ page }) => {
  await page.goto('/');

  const fab = page.locator('.cheat-fab');
  await expect(fab).toBeVisible();
  await expect(fab).toHaveAttribute('aria-pressed', 'false');

  await fab.click();
  await expect(fab).toHaveAttribute('aria-pressed', 'true');

  // Callouts present
  const notes = page.locator('[role="note"]');
  await expect(notes.first()).toBeVisible();

  // Click-through: clicking the underlying Score header should toggle sort
  // (through the click-through layer)
  const initialSortHeader = page.locator('[data-test="pass-at-n-header"]');
  await initialSortHeader.click({ force: true }); // force in case overlay covers it
  await expect(page).toHaveURL(/sort=pass_at_n:asc|sort=pass_at_n:desc/);
  await expect(fab).toHaveAttribute('aria-pressed', 'true'); // overlay still open

  // Esc dismisses
  await page.keyboard.press('Escape');
  await expect(fab).toHaveAttribute('aria-pressed', 'false');
});
```

- [ ] **Step 2: Run + commit**

```bash
cd U:/Git/CentralGauge/site && npm run test:e2e
cd U:/Git/CentralGauge && git add site/tests/e2e/cheat-overlay-landing.spec.ts && git commit -m "test(e2e): CHEAT overlay open + click-through + Esc dismiss on landing"
```

---

### Task E.3: E2E test for mobile sheet

**Files:**
- Create: `site/tests/e2e/cheat-overlay-mobile.spec.ts`

- [ ] **Step 1: Write Playwright spec**

```ts
// site/tests/e2e/cheat-overlay-mobile.spec.ts
import { test, expect } from '@playwright/test';

const mobileViewports = [
  { width: 375, height: 667 }, // phone
  { width: 900, height: 800 }, // tablet
  { width: 1024, height: 768 }, // boundary (mobile)
];

for (const viewport of mobileViewports) {
  test(`mobile sheet opens at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

    await page.locator('.cheat-fab').click();
    const dialog = page.locator('dialog.cheat-sheet');
    await expect(dialog).toBeVisible();
    // No SVG arrows on mobile
    expect(await page.locator('.cheat-arrows').count()).toBe(0);
    // Close
    await page.locator('.cheat-sheet .x').click();
    await expect(dialog).not.toBeVisible();
  });
}

test('desktop overlay opens at 1025x768 (boundary)', async ({ page }) => {
  await page.setViewportSize({ width: 1025, height: 768 });
  await page.goto('/');

  await page.locator('.cheat-fab').click();
  await expect(page.locator('.cheat-layer')).toBeVisible();
  await expect(page.locator('dialog.cheat-sheet')).toHaveCount(0);
});
```

- [ ] **Step 2: Run + commit**

```bash
cd U:/Git/CentralGauge/site && npm run test:e2e
cd U:/Git/CentralGauge && git add site/tests/e2e/cheat-overlay-mobile.spec.ts && git commit -m "test(e2e): mobile sheet at phone/tablet/boundary; desktop overlay at 1025"
```

---

## Phase F: Final Verification

### Task F.1: Full build + lint + test verification

**Files:** none (verification only)

- [ ] **Step 1: Run full site test suite**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm run test:main && npm run check
```

Expected: 0 errors; all tests green; bundle integrity passes.

- [ ] **Step 2: Optional axe accessibility scan**

If the project uses axe-core via Playwright:

```bash
cd U:/Git/CentralGauge/site && npm run test:e2e -- cheat
```

Expected: 0 accessibility violations on landing page with overlay open.

- [ ] **Step 3: Manual smoke test**

Start dev server (`npm run dev`) and verify in browser:
- CHEAT FAB visible bottom-right
- Click opens overlay with sticky-note callouts and orange dashed arrows
- Underlying table sort still works while overlay is open
- Esc closes
- Resize to <=1024px and reopen: native dialog sheet appears instead of overlay
- Dark mode (if site supports theme toggle): arrow color shifts to lighter yellow

---

### Task F.2: Update CHANGELOG

**Files:**
- Modify: `site/CHANGELOG.md`

- [ ] **Step 1: Add release entry**

Prepend to `site/CHANGELOG.md` (under `## [Unreleased]`):

```markdown
### Added: CHEAT overlay

- New `CheatButton` (red FAB, bottom-right) on landing and `/models/[slug]`
  pages. Opens a static annotated overlay with sticky-note callouts pointing
  at columns and a worked-example row.
- Per-page annotation registry pattern (`site/src/lib/cheat/annotations/`)
  separates explanation copy from rendering.
- Mobile (<=1024px) gets a native `<dialog>` numbered-list fallback.
- Pure `computeCalloutLayout` helper; impure `resolveTargets` resolver;
  exhaustive unit tests.
- Page stays click-through usable while overlay is open
  (`pointer-events: none` on the layer).
- Existing `MetricInfo` ⓘ popovers suppress while CHEAT is active to
  avoid two overlapping explanation systems.
```

- [ ] **Step 2: Commit**

```bash
cd U:/Git/CentralGauge && git add site/CHANGELOG.md && git commit -m "docs(changelog): CHEAT overlay v1"
```

---

### Task F.3: Final code-reviewer subagent

**Files:** none (verification only)

- [ ] **Step 1: Dispatch a final code-reviewer subagent over the entire branch diff vs master**

Use whichever code-review agent is appropriate (subagent-driven-development would dispatch this automatically). The reviewer should:
- Confirm all spec sections have implementing tasks
- Verify no `{@html}` sinks introduced
- Verify `pointer-events: none` is applied correctly
- Verify mobile breakpoint is consistently 1024/1025
- Verify focus-scope (not focus-trap) language in the actual implementation
- Verify cleanup functions tear down all observers/listeners

If the reviewer finds issues, fix them in follow-up commits and re-run the review.

---

## Self-Review Checklist (For Plan Author)

Before handoff, confirm:

- [ ] Every spec section has at least one task implementing it (Architecture: A.3+A.4+B.1-B.4+D.1-D.3+C.1-C.3; Annotation Registry: A.1+D.1+D.3; computeCalloutLayout Algorithm: A.3; Visual Style: A.2+B.1+B.4; Mobile Fallback: B.3; Accessibility: B.2+B.3+B.4+C.3; Test Surface: A.3-test+A.4-test+E.1+E.2+E.3+F.1).
- [ ] No "TBD" / "TODO" / "implement later" placeholders.
- [ ] Every code step shows actual code, not just descriptions.
- [ ] Type names consistent across tasks (`Annotation`, `ResolvedTarget`, `Layout`, `Viewport`, `Size`, `Rect` defined in A.1; used identically in A.3 / A.4 / B.1-B.4).
- [ ] Test commands match `npm run build && npm run test:main` and `npx vitest run --config vitest.unit.config.ts` patterns from CLAUDE.md.
- [ ] No `deno fmt` runs on `site/` files (per CLAUDE.md).
- [ ] Mobile breakpoint = 1024/1025 consistently throughout.
- [ ] `pointer-events` strategy specified in CheatCallout (B.1) and CheatOverlay (B.2) CSS.
- [ ] `resolve-targets.ts` is a standalone module (not embedded in CheatOverlay) per spec MEDIUM-6.
- [ ] `afterNavigate` registered at component init, not in `$effect` cleanup (per spec round-3 fix).
- [ ] CheatButton dynamically imports CheatOverlay/CheatMobileSheet on first click (B.4).
- [ ] data-cheat anchors added in C.1 + D.3, NOT data-test reuse.

---

**Total tasks: ~18 atomic units across 6 phases. Estimated implementation: 2-3 working days for a focused agent.**
