/**
 * Bench run marker ("is a bench live right now?").
 *
 * `tests/unit/container/` publishes and unpublishes apps on the real Cronus
 * containers, which corrupts the BC NST PSSession of a bench that is running at
 * the same time (CLAUDE.md: "Never run the full `deno task test:unit` while a
 * bench is live"). That rule was previously enforced by memory alone. This
 * module publishes a heartbeat file so tooling — a Claude Code PreToolUse hook,
 * a shell wrapper, CI — can check the invariant mechanically.
 *
 * Liveness is **mtime-only** on purpose:
 * - A crashed or killed bench leaves the file behind, but the heartbeat stops,
 *   so the lock ages out by itself. No pid liveness probing, which is awkward
 *   and unreliable across the Git-Bash/Windows boundary.
 * - A half-written file still reads as "running". The dangerous answer is a
 *   false "no bench is running", so ambiguity resolves toward caution.
 *
 * Equivalent shell check (what the hook uses):
 *   find results/.bench-running.json -mmin -2
 */

import { join } from "@std/path";

export const BENCH_LOCK_FILENAME = ".bench-running.json";

/** Default directory holding the marker, relative to the repo root. */
export const DEFAULT_BENCH_LOCK_DIR = "results";

/** How often the marker's mtime is refreshed while a bench runs. */
export const DEFAULT_HEARTBEAT_MS = 30_000;

/**
 * How long after the last heartbeat the marker is considered dead. Must stay
 * comfortably above {@link DEFAULT_HEARTBEAT_MS} so a slow tick never reads as
 * a crash.
 */
export const DEFAULT_STALE_AFTER_MS = 120_000;

/** Metadata written into the marker. Diagnostics only — never used for liveness. */
export interface BenchLockInfo {
  /** Pid of the bench process that wrote the marker. */
  pid: number;
  /** ISO timestamp of when the bench acquired the lock. */
  startedAt: string;
  /** ISO timestamp of the most recent heartbeat. */
  heartbeatAt: string;
  /** Human-readable description of the run, e.g. `bench --llms sonnet`. */
  command: string;
}

export interface AcquireBenchLockOptions {
  /** Description of the run, stored for diagnostics. */
  command?: string;
  /** Heartbeat interval; defaults to {@link DEFAULT_HEARTBEAT_MS}. */
  heartbeatMs?: number;
}

export interface IsBenchRunningOptions {
  /** Age past which the marker is ignored; defaults to {@link DEFAULT_STALE_AFTER_MS}. */
  staleAfterMs?: number;
  /** Injectable clock for tests. */
  now?: number;
}

/** Absolute-or-relative path of the marker inside `dir`. */
export function benchLockPath(dir: string = DEFAULT_BENCH_LOCK_DIR): string {
  return join(dir, BENCH_LOCK_FILENAME);
}

/**
 * Whether a bench is currently running, i.e. the marker exists and its mtime is
 * within the stale window. Never throws: any read problem answers `false` only
 * when the file genuinely is not there.
 */
export function isBenchRunning(
  dir: string = DEFAULT_BENCH_LOCK_DIR,
  options: IsBenchRunningOptions = {},
): boolean {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const now = options.now ?? Date.now();

  let stat: Deno.FileInfo;
  try {
    stat = Deno.statSync(benchLockPath(dir));
  } catch {
    return false;
  }

  // No mtime (rare filesystems) — treat the marker's presence as live rather
  // than green-lighting container tests.
  const mtimeMs = stat.mtime?.getTime();
  if (mtimeMs === undefined) return true;

  return now - mtimeMs <= staleAfterMs;
}

/**
 * Parsed marker metadata, or `null` when absent or unreadable. Callers must not
 * use this for liveness — see {@link isBenchRunning}.
 */
export function readBenchLock(
  dir: string = DEFAULT_BENCH_LOCK_DIR,
): BenchLockInfo | null {
  try {
    const raw = Deno.readTextFileSync(benchLockPath(dir));
    const parsed = JSON.parse(raw) as Partial<BenchLockInfo>;
    if (typeof parsed.pid !== "number") return null;
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt ?? "",
      heartbeatAt: parsed.heartbeatAt ?? "",
      command: parsed.command ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * Publish the marker and start its heartbeat. Returns the release function;
 * call it from a `finally` so every exit path clears the marker. Release is
 * idempotent, and failures are swallowed — this is telemetry, it must never
 * fail a bench.
 */
export function acquireBenchLock(
  dir: string = DEFAULT_BENCH_LOCK_DIR,
  options: AcquireBenchLockOptions = {},
): () => Promise<void> {
  const path = benchLockPath(dir);
  const startedAt = new Date().toISOString();
  const command = options.command ?? "";
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

  const write = () => {
    const info: BenchLockInfo = {
      pid: Deno.pid,
      startedAt,
      heartbeatAt: new Date().toISOString(),
      command,
    };
    try {
      Deno.mkdirSync(dir, { recursive: true });
      Deno.writeTextFileSync(path, `${JSON.stringify(info, null, 2)}\n`);
    } catch {
      // Best-effort only.
    }
  };

  write();

  const timer = setInterval(write, heartbeatMs);
  // The heartbeat must not be a reason for the process to stay alive.
  Deno.unrefTimer(timer);

  let released = false;
  return () => {
    if (released) return Promise.resolve();
    released = true;
    clearInterval(timer);
    try {
      Deno.removeSync(path);
    } catch {
      // Already gone, or never written.
    }
    return Promise.resolve();
  };
}
