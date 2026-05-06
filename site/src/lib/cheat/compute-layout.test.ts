import { describe, it, expect } from 'vitest';
import { computeCalloutLayout } from './compute-layout';
import type { ResolvedTarget, Viewport, Size } from './types';

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
    const layoutA = out.find((l) => l.id === 'a')!;
    const layoutB = out.find((l) => l.id === 'b')!;
    // b placed first (lower order), a is pushed perpendicular → lefts differ, tops equal
    expect(layoutA.callout.top).toBe(layoutB.callout.top);
    expect(layoutA.callout.left).not.toBe(layoutB.callout.left);
  });

  it('pushes perpendicular (vertical) for side=left collisions', () => {
    const a = target('a', 'left', 600, 400, 2);
    const b = target('b', 'left', 600, 400, 1);
    const out = computeCalloutLayout([a, b], VIEWPORT, { a: STD_SIZE, b: STD_SIZE });
    const layoutA = out.find((l) => l.id === 'a')!;
    const layoutB = out.find((l) => l.id === 'b')!;
    // perpendicular to left/right is vertical: lefts equal, tops differ
    expect(layoutA.callout.left).toBe(layoutB.callout.left);
    expect(layoutA.callout.top).not.toBe(layoutB.callout.top);
  });

  it('emits SVG arrow path d-attribute when visible', () => {
    const t = target('a', 'top', 600, 400);
    const out = computeCalloutLayout([t], VIEWPORT, { a: STD_SIZE });
    expect(out[0].arrow?.d).toMatch(/^M /); // SVG path starts with Move
  });
});
