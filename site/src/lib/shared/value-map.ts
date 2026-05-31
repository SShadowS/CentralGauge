// site/src/lib/shared/value-map.ts
import type { LeaderboardRow } from './api-types';
import { aucFraction } from './leaderboard-derive';

export interface ValueMapDims { width: number; height: number; padding: number; }

export interface ValuePoint {
  slug: string;
  display_name: string;
  cost: number;
  auc: number;      // 0..100
  cx: number;       // pixel x
  cy: number;       // pixel y (SVG, grows downward)
  onFrontier: boolean;
}

export interface ValueMapModel {
  points: ValuePoint[];
  frontierPath: string;
  xTicks: { value: number; x: number; label: string }[];
  yTicks: { value: number; y: number; label: string }[];
  omittedCount: number;
}

const aucOf = (r: LeaderboardRow) => aucFraction(r) * 100;

export function computeValueMap(rows: LeaderboardRow[], dims: ValueMapDims): ValueMapModel {
  const { width, height, padding } = dims;
  const priced = rows.filter((r) => r.avg_cost_usd > 0);
  const omittedCount = rows.length - priced.length;
  if (priced.length === 0) {
    return { points: [], frontierPath: '', xTicks: [], yTicks: [], omittedCount };
  }

  const innerW = width - 2 * padding;
  const innerH = height - 2 * padding;

  const logs = priced.map((r) => Math.log10(r.avg_cost_usd));
  let minLog = logs.reduce((a, b) => Math.min(a, b), Infinity);
  let maxLog = logs.reduce((a, b) => Math.max(a, b), -Infinity);
  if (minLog === maxLog) { minLog -= 0.5; maxLog += 0.5; } // avoid divide-by-zero for a single x

  // Y is the AUC 0..100 axis, fixed so plots are comparable across filters.
  const yMin = 0, yMax = 100;

  const xOf = (cost: number) =>
    padding + ((Math.log10(cost) - minLog) / (maxLog - minLog)) * innerW;
  const yOf = (auc: number) =>
    padding + innerH - ((auc - yMin) / (yMax - yMin)) * innerH;

  // Pareto frontier: sort by cost asc; a point is on the frontier if its auc
  // exceeds the best auc seen at strictly-lower-or-equal cost. Sweep keeping a
  // running max auc; ties in cost resolved by auc desc so the better one wins.
  const sorted = [...priced].sort((a, b) =>
    a.avg_cost_usd - b.avg_cost_usd || aucOf(b) - aucOf(a));
  const frontierSlugs = new Set<string>();
  let runningMaxAuc = -Infinity;
  for (const r of sorted) {
    const a = aucOf(r);
    if (a > runningMaxAuc) { frontierSlugs.add(r.model.slug); runningMaxAuc = a; }
  }

  const points: ValuePoint[] = priced.map((r) => ({
    slug: r.model.slug,
    display_name: r.model.display_name,
    cost: r.avg_cost_usd,
    auc: aucOf(r),
    cx: xOf(r.avg_cost_usd),
    cy: yOf(aucOf(r)),
    onFrontier: frontierSlugs.has(r.model.slug),
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
    const costs = priced.map((r) => r.avg_cost_usd);
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
