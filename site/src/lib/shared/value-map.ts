// site/src/lib/shared/value-map.ts
import type { LeaderboardRow } from './api-types';
import { aucFraction } from './leaderboard-derive';
import { isCostProvisional } from './cost-provisional';

export interface ValueMapDims { width: number; height: number; padding: number; }

export interface ValuePoint {
  slug: string;
  display_name: string;
  cost: number;
  y: number;        // 0..100
  cx: number;       // pixel x
  cy: number;       // pixel y (SVG, grows downward)
  onFrontier: boolean;
  provisional: boolean; // cost understated/under review — dimmed, never on frontier
}

export interface ValueMapModel {
  points: ValuePoint[];
  frontierPath: string;
  xTicks: { value: number; x: number; label: string }[];
  yTicks: { value: number; y: number; label: string }[];
  omittedCount: number;
}

export interface ValueInput {
  slug: string;
  display_name: string;
  cost: number | null;
  y: number;            // 0..100
  provisional: boolean; // cost understated/under review
}

export function leaderboardValueInputs(rows: LeaderboardRow[]): ValueInput[] {
  return rows.map((r) => ({
    slug: r.model.slug,
    display_name: r.model.display_name,
    cost: r.avg_cost_usd,
    y: aucFraction(r) * 100,
    provisional: isCostProvisional(r.model.slug),
  }));
}

export function computeValueMap(rows: LeaderboardRow[], dims: ValueMapDims): ValueMapModel {
  return computeValueMapFrom(leaderboardValueInputs(rows), dims);
}

export function computeValueMapFrom(items: ValueInput[], dims: ValueMapDims): ValueMapModel {
  const { width, height, padding } = dims;
  const priced = items.filter((r): r is ValueInput & { cost: number } => r.cost != null && r.cost > 0);
  const omittedCount = items.length - priced.length;
  if (priced.length === 0) {
    return { points: [], frontierPath: '', xTicks: [], yTicks: [], omittedCount };
  }

  const innerW = width - 2 * padding;
  const innerH = height - 2 * padding;

  const logs = priced.map((r) => Math.log10(r.cost));
  let minLog = logs.reduce((a, b) => Math.min(a, b), Infinity);
  let maxLog = logs.reduce((a, b) => Math.max(a, b), -Infinity);
  if (minLog === maxLog) { minLog -= 0.5; maxLog += 0.5; } // avoid divide-by-zero for a single x

  // Y is the AUC 0..100 axis, fixed so plots are comparable across filters.
  const yMin = 0, yMax = 100;

  const xOf = (cost: number) =>
    padding + ((Math.log10(cost) - minLog) / (maxLog - minLog)) * innerW;
  const yOf = (y: number) =>
    padding + innerH - ((y - yMin) / (yMax - yMin)) * innerH;

  // Pareto frontier: sort by cost asc; a point is on the frontier if its auc
  // exceeds the best auc seen at strictly-lower-or-equal cost. Sweep keeping a
  // running max auc; ties in cost resolved by auc desc so the better one wins.
  const sorted = [...priced].sort((a, b) =>
    a.cost - b.cost || b.y - a.y);
  // Provisional-cost models are skipped in the sweep: their x-position (cost) is
  // understated, so letting them define the value frontier would be wrong. They
  // are still plotted (dimmed) so their skill is visible.
  const frontierSlugs = new Set<string>();
  let runningMaxAuc = -Infinity;
  for (const r of sorted) {
    if (r.provisional) continue;
    if (r.y > runningMaxAuc) { frontierSlugs.add(r.slug); runningMaxAuc = r.y; }
  }

  const points: ValuePoint[] = priced.map((r) => ({
    slug: r.slug,
    display_name: r.display_name,
    cost: r.cost,
    y: r.y,
    cx: xOf(r.cost),
    cy: yOf(r.y),
    onFrontier: frontierSlugs.has(r.slug),
    provisional: r.provisional,
  }));

  // Frontier polyline through frontier points sorted by cost asc.
  const frontierPts = points.filter((p) => p.onFrontier).sort((a, b) => a.cost - b.cost);
  const frontierPath = frontierPts.length
    ? 'M' + frontierPts.map((p) => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join('L')
    : '';

  // Axis ticks: x at each integer power of 10 within range; y every 25.
  const xTicks: ValueMapModel['xTicks'] = [];
  for (let e = Math.ceil(minLog); e <= Math.floor(maxLog); e++) {
    const value = Math.pow(10, e);
    xTicks.push({ value, x: xOf(value), label: `$${value}` });
  }
  // Fallback: when all priced models share one decade, no integer power-of-ten
  // tick falls in range. Emit ticks at the actual min/max cost so the axis is
  // never blank.
  if (xTicks.length === 0) {
    const costs = priced.map((r) => r.cost);
    const lo = costs.reduce((a, b) => Math.min(a, b), Infinity);
    const hi = costs.reduce((a, b) => Math.max(a, b), -Infinity);
    for (const value of lo === hi ? [lo] : [lo, hi]) {
      xTicks.push({ value, x: xOf(value), label: `$${value}` });
    }
  }
  const yTicks: ValueMapModel['yTicks'] = [];
  for (let v = 0; v <= 100; v += 25) yTicks.push({ value: v, y: yOf(v), label: String(v) });

  return { points, frontierPath, xTicks, yTicks, omittedCount };
}
