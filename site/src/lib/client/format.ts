/**
 * Display formatters used in tables and cards. All functions are pure;
 * deterministic given (input, optional now). No locale-specific output —
 * deliberate, the audience is global-technical, en-US conventions only.
 */

export function formatScore(score: number): string {
  return score.toFixed(2);
}

// formatCost returns "<$0.001" only for usd strictly less than 0.001.
// Exactly 0.001 renders as "$0.001" — the threshold is a strict floor.
export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.001) return '<$0.001';
  if (usd < 0.01) return '$' + usd.toFixed(3);
  return '$' + usd.toFixed(2);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1) + 'M';
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const deltaSec = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDay = Math.floor(deltaHr / 24);
  if (deltaDay < 30) return `${deltaDay}d ago`;
  const deltaMonth = Math.floor(deltaDay / 30);
  if (deltaMonth < 12) return `${deltaMonth}mo ago`;
  return `${Math.floor(deltaMonth / 12)}y ago`;
}

export function formatTaskRatio(passed: number, total: number): string {
  return `${passed}/${total}`;
}
