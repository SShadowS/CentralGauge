import type { Annotation, Rect, ResolvedTarget } from './types';

const PLACEHOLDER_RE = /\{(\w[\w-]*)\}/g;

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
    if (import.meta.env.DEV) {
      console.warn(`[cheat] missing template value for "{${key}}"`);
    }
    return '?';
  });
}

/**
 * Document-order index used for stable callout collision sorting.
 *
 * In a real browser we use viewport rect (top * 10000 + left) as a numeric
 * proxy; for normal flow this matches DOM source order.
 *
 * jsdom never runs layout, so getBoundingClientRect() returns all-zeros for
 * every element. In that degenerate case we fall back to a DOM-walk counter:
 * we enumerate all elements in tree order and record each element's position.
 * This is O(N elements in body) per resolveTargets call, but resolveTargets
 * only runs in jsdom under test; production always has real rects.
 */
function documentOrderIndex(el: Element): number {
  const r = el.getBoundingClientRect();
  // Fast path: real browser gave us a real rect.
  if (r.top !== 0 || r.left !== 0 || r.width !== 0 || r.height !== 0) {
    return Math.round(r.top * 10000 + r.left);
  }
  // Fallback: DOM walk (jsdom / headless environments with no layout engine).
  let index = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.nextNode();
  while (node !== null) {
    if (node === el) return index;
    index++;
    node = walker.nextNode();
  }
  return index; // Not found — place last.
}

export function resolveTargets(annotations: Annotation[]): ResolvedTarget[] {
  if (typeof document === 'undefined') return []; // SSR safety
  const out: ResolvedTarget[] = [];

  for (const a of annotations) {
    let el: Element | null;
    try {
      el = document.querySelector(a.targetSelector);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn(`[cheat] invalid selector for "${a.id}": ${a.targetSelector}`, err);
      }
      continue;
    }
    if (!el) {
      if (import.meta.env.DEV) {
        console.warn(`[cheat] missing target for "${a.id}": ${a.targetSelector}`);
      }
      continue;
    }

    const values = readDataCheatValues(el);
    const body = a.template ? substitute(a.body, values) : a.body;
    const bodyPrefix =
      a.bodyPrefix && a.template ? substitute(a.bodyPrefix, values) : a.bodyPrefix;

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
