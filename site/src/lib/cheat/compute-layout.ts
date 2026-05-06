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
    case 'top':
      return { x: (r.left + r.right) / 2, y: r.top };
    case 'bottom':
      return { x: (r.left + r.right) / 2, y: r.bottom };
    case 'left':
      return { x: r.left, y: (r.top + r.bottom) / 2 };
    case 'right':
      return { x: r.right, y: (r.top + r.bottom) / 2 };
  }
}

function placeCallout(
  t: ResolvedTarget,
  size: Size,
  side: ResolvedTarget['side'],
): { left: number; top: number } {
  const a = anchorPoint({ ...t, side });
  switch (side) {
    case 'top':
      return { left: a.x - size.width / 2, top: a.y - ANCHOR_OFFSET - size.height };
    case 'bottom':
      return { left: a.x - size.width / 2, top: a.y + ANCHOR_OFFSET };
    case 'left':
      return { left: a.x - ANCHOR_OFFSET - size.width, top: a.y - size.height / 2 };
    case 'right':
      return { left: a.x + ANCHOR_OFFSET, top: a.y - size.height / 2 };
  }
}

function clipsViewport(left: number, top: number, size: Size, viewport: Viewport): boolean {
  return (
    left < 0 ||
    top < 0 ||
    left + size.width > viewport.width ||
    top + size.height > viewport.height
  );
}

function rectsOverlap(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
): boolean {
  return !(
    a.left + a.width < b.left ||
    b.left + b.width < a.left ||
    a.top + a.height < b.top ||
    b.top + b.height < a.top
  );
}

function arrowPath(
  target: ResolvedTarget,
  callout: { left: number; top: number; width: number },
  side: ResolvedTarget['side'],
  size: Size,
): string {
  const a = anchorPoint(target);
  // Aim at nearest edge midpoint of callout box
  let cx: number;
  let cy: number;
  switch (side) {
    case 'top':
      cx = callout.left + callout.width / 2;
      cy = callout.top + size.height;
      break;
    case 'bottom':
      cx = callout.left + callout.width / 2;
      cy = callout.top;
      break;
    case 'left':
      cx = callout.left + callout.width;
      cy = callout.top + size.height / 2;
      break;
    case 'right':
      cx = callout.left;
      cy = callout.top + size.height / 2;
      break;
  }
  // Quadratic bezier with slight upward control point
  const ctrlX = (a.x + cx) / 2;
  const ctrlY = (a.y + cy) / 2 - 10;
  return `M ${a.x.toFixed(1)},${a.y.toFixed(1)} Q ${ctrlX.toFixed(1)},${ctrlY.toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)}`;
}

export function computeCalloutLayout(
  targets: ResolvedTarget[],
  viewport: Viewport,
  sizes: Record<string, Size>,
): Layout[] {
  const sorted = [...targets].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );
  const placed: Array<{ left: number; top: number; width: number; height: number }> = [];
  const out: Layout[] = [];

  for (const t of sorted) {
    const size = sizes[t.id] ?? { width: 200, height: 60 };

    // Off-viewport: skip layout, mark invisible
    if (isOffViewport(t.rect, viewport)) {
      out.push({
        id: t.id,
        visible: false,
        callout: { left: 0, top: 0, width: size.width, rotation: t.rotation },
      });
      continue;
    }

    // Choose preferred placement; flip to opposite side if it clips the viewport
    let side = t.side;
    let pos = placeCallout(t, size, side);
    if (clipsViewport(pos.left, pos.top, size, viewport)) {
      const opposite: Record<ResolvedTarget['side'], ResolvedTarget['side']> = {
        top: 'bottom',
        bottom: 'top',
        left: 'right',
        right: 'left',
      };
      const flippedSide = opposite[side];
      const flipped = placeCallout(t, size, flippedSide);
      if (!clipsViewport(flipped.left, flipped.top, size, viewport)) {
        side = flippedSide;
        pos = flipped;
      }
    }

    // Collision avoidance: check base position first, then push along the
    // attachment axis until no overlap or COLLISION_MAX is exceeded.
    let pushed = pos;
    const baseCandidate = { ...pos, width: size.width, height: size.height };
    if (placed.some((p) => rectsOverlap(baseCandidate, p))) {
      for (let pushDistance = COLLISION_STEP; pushDistance <= COLLISION_MAX; pushDistance += COLLISION_STEP) {
        // Compute candidate position shifted along the attachment axis
        let candidate: { left: number; top: number; width: number; height: number };
        if (side === 'top') {
          candidate = { left: pos.left, top: pos.top - pushDistance, width: size.width, height: size.height };
        } else if (side === 'bottom') {
          candidate = { left: pos.left, top: pos.top + pushDistance, width: size.width, height: size.height };
        } else if (side === 'left') {
          candidate = { left: pos.left - pushDistance, top: pos.top, width: size.width, height: size.height };
        } else {
          candidate = { left: pos.left + pushDistance, top: pos.top, width: size.width, height: size.height };
        }
        pushed = { left: candidate.left, top: candidate.top };
        if (!placed.some((p) => rectsOverlap(candidate, p))) break;
      }
    }

    placed.push({ left: pushed.left, top: pushed.top, width: size.width, height: size.height });

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
