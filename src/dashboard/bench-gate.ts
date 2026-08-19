import {
  DEFAULT_BENCH_LOCK_DIR,
  isBenchRunning,
  type IsBenchRunningOptions,
  readBenchLock,
} from "../utils/bench-lock.ts";

export type GateDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Whether container work may start right now.
 *
 * Liveness comes from `isBenchRunning`, which fails toward "a bench IS running"
 * when it cannot read an mtime. `readBenchLock` is used ONLY to name the
 * command in the refusal message; it returns null for an unreadable marker,
 * which must never be mistaken for "no bench".
 */
export function checkBenchGate(
  dir: string = DEFAULT_BENCH_LOCK_DIR,
  opts: IsBenchRunningOptions = {},
): GateDecision {
  if (!isBenchRunning(dir, opts)) return { allowed: true };

  const info = readBenchLock(dir);
  const what = info?.command ? `\`${info.command}\`` : "A bench";
  const since = info?.startedAt ? `, started ${info.startedAt}` : "";
  return {
    allowed: false,
    reason:
      `${what} is running${since}. Compile and test publishes to the same container and would corrupt that run. Ask N models still works.`,
  };
}
