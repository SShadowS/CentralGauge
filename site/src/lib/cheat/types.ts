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

/**
 * Viewport bounds in CSS pixels. No scrollX/scrollY: the cheat layer is
 * `position: fixed; inset: 0`, so all coordinates are viewport-relative.
 * Adding scroll offsets would invite document-coordinate confusion and
 * arrow drift.
 */
export interface Viewport {
  width: number;
  height: number;
}

/** Measured callout dimensions in CSS pixels. Distinct from Viewport
 *  (structurally identical) to make intent clear at call sites. */
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
