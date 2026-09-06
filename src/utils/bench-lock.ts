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
 * The marker is an exclusive lock (spec D14): creation is atomic, the owner
 * token guards heartbeat and release, and a stale marker is reclaimed by
 * atomic rename. Liveness for READERS is still mtime-only:
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

/** Metadata written into the marker. Liveness still comes from the file's mtime. */
export interface BenchLockInfo {
  /** Pid of the bench process that wrote the marker. */
  pid: number;
  /** ISO timestamp of when the bench acquired the lock. */
  startedAt: string;
  /** ISO timestamp of the most recent heartbeat (the file's mtime). */
  heartbeatAt: string;
  /** Human-readable description of the run, e.g. `bench --llms sonnet`. */
  command: string;
  /** Owner token; release only removes a marker carrying this token. */
  token: string;
}

export interface AcquireBenchLockOptions {
  /** Description of the run, stored for diagnostics. */
  command?: string;
  /** Heartbeat interval; defaults to {@link DEFAULT_HEARTBEAT_MS}. */
  heartbeatMs?: number;
  /** Age past which an existing marker may be reclaimed; defaults to {@link DEFAULT_STALE_AFTER_MS}. */
  staleAfterMs?: number;
}

export interface IsBenchRunningOptions {
  /** Age past which the marker is ignored; defaults to {@link DEFAULT_STALE_AFTER_MS}. */
  staleAfterMs?: number;
  /** Injectable clock for tests. */
  now?: number;
}

export type TryAcquireResult =
  | { acquired: true; release: () => Promise<void>; token: string }
  | { acquired: false; holder: BenchLockInfo | null };

/** Thrown by {@link acquireBenchLock} when a live marker is held by someone else. */
export class BenchLockHeldError extends Error {
  constructor(
    public readonly holder: BenchLockInfo | null,
    public readonly path: string,
  ) {
    super(
      holder
        ? `bench lock is held by pid ${holder.pid} since ${holder.startedAt} (${
          holder.command || "unknown command"
        }); marker: ${path}`
        : `bench lock is held; marker: ${path}`,
    );
    this.name = "BenchLockHeldError";
  }
}

/** Absolute-or-relative path of the marker inside `dir`. */
export function benchLockPath(dir: string = DEFAULT_BENCH_LOCK_DIR): string {
  return join(dir, BENCH_LOCK_FILENAME);
}

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
  const mtimeMs = stat.mtime?.getTime();
  if (mtimeMs === undefined) return true;
  return now - mtimeMs <= staleAfterMs;
}

/** Parsed marker metadata, or `null` when absent or unreadable. Not for liveness. */
export function readBenchLock(
  dir: string = DEFAULT_BENCH_LOCK_DIR,
): BenchLockInfo | null {
  const path = benchLockPath(dir);
  try {
    const raw = Deno.readTextFileSync(path);
    const parsed = JSON.parse(raw) as Partial<BenchLockInfo>;
    if (typeof parsed.pid !== "number") return null;
    let heartbeatAt = parsed.heartbeatAt ?? "";
    try {
      const mtime = Deno.statSync(path).mtime;
      if (mtime) heartbeatAt = mtime.toISOString();
    } catch {
      // keep the stored value
    }
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt ?? "",
      heartbeatAt,
      command: parsed.command ?? "",
      token: typeof parsed.token === "string" ? parsed.token : "",
    };
  } catch {
    return null;
  }
}

/** Create the marker only if it does not exist. Returns false on AlreadyExists. */
function createExclusive(path: string, body: string): boolean {
  let file: Deno.FsFile;
  try {
    file = Deno.openSync(path, { write: true, createNew: true });
  } catch (err) {
    if (err instanceof Deno.errors.AlreadyExists) return false;
    throw err;
  }
  try {
    file.writeSync(new TextEncoder().encode(body));
    file.syncSync();
  } finally {
    file.close();
  }
  return true;
}

/**
 * Move a stale marker out of the way. Rename is atomic, so when two processes
 * both see a stale marker only one rename succeeds; the other sees NotFound
 * and simply retries the exclusive create.
 */
function reclaimStale(
  path: string,
  staleAfterMs: number,
): "reclaimed" | "live" | "gone" {
  let stat: Deno.FileInfo;
  try {
    stat = Deno.statSync(path);
  } catch {
    return "gone";
  }
  const mtimeMs = stat.mtime?.getTime();
  if (mtimeMs === undefined || Date.now() - mtimeMs <= staleAfterMs) {
    return "live";
  }
  const tomb = `${path}.stale-${crypto.randomUUID()}`;
  try {
    Deno.renameSync(path, tomb);
  } catch (err) {
    return err instanceof Deno.errors.NotFound ? "gone" : "live";
  }
  try {
    Deno.removeSync(tomb);
  } catch {
    // best effort
  }
  return "reclaimed";
}

/**
 * Try to take the exclusive bench lock. Exactly one process can hold a live
 * marker: creation is `createNew`, a stale marker is reclaimed by atomic
 * rename, the heartbeat only touches a marker that still carries our token,
 * and release only removes a marker that still carries our token.
 */
export function tryAcquireBenchLock(
  dir: string = DEFAULT_BENCH_LOCK_DIR,
  options: AcquireBenchLockOptions = {},
): TryAcquireResult {
  const path = benchLockPath(dir);
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const token = crypto.randomUUID();
  const info: BenchLockInfo = {
    pid: Deno.pid,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    command: options.command ?? "",
    token,
  };
  Deno.mkdirSync(dir, { recursive: true });
  const body = `${JSON.stringify(info, null, 2)}\n`;

  let created = false;
  for (let i = 0; i < 3 && !created; i++) {
    created = createExclusive(path, body);
    if (created) break;
    const state = reclaimStale(path, staleAfterMs);
    if (state === "live") {
      return { acquired: false, holder: readBenchLock(dir) };
    }
  }
  if (!created) return { acquired: false, holder: readBenchLock(dir) };

  let lost = false;
  const heartbeat = () => {
    if (lost) return;
    const current = readBenchLock(dir);
    if (current?.token !== token) {
      lost = true;
      return;
    }
    try {
      const now = new Date();
      Deno.utimeSync(path, now, now);
    } catch {
      // best effort; the next tick tries again
    }
  };
  const timer = setInterval(heartbeat, heartbeatMs);
  Deno.unrefTimer(timer);

  let released = false;
  const release = () => {
    if (released) return Promise.resolve();
    released = true;
    clearInterval(timer);
    if (!lost && readBenchLock(dir)?.token === token) {
      try {
        Deno.removeSync(path);
      } catch {
        // already gone
      }
    }
    return Promise.resolve();
  };
  return { acquired: true, release, token };
}

/**
 * Take the exclusive bench lock or throw {@link BenchLockHeldError}. Returns
 * the release function; call it from a `finally`.
 */
export function acquireBenchLock(
  dir: string = DEFAULT_BENCH_LOCK_DIR,
  options: AcquireBenchLockOptions = {},
): () => Promise<void> {
  const result = tryAcquireBenchLock(dir, options);
  if (!result.acquired) {
    throw new BenchLockHeldError(result.holder, benchLockPath(dir));
  }
  return result.release;
}
