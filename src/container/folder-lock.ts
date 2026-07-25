import { Logger } from "../logger/mod.ts";

const log = Logger.create("container:folder-lock");

/**
 * Cross-process advisory lock built on atomic file creation.
 *
 * Needed because `trap-probe` and `bench` run as separate processes by design,
 * so the in-process `compilerFolderQueue` cannot serialize them. Only the
 * rebuild path takes this lock — adoption is read-only.
 */
export interface HeldLock {
  /** False when the timeout elapsed. Callers proceed anyway. */
  acquired: boolean;
  release(): Promise<void>;
}

/**
 * Default staleness threshold. Sized against the PER-CONTAINER rebuild cost,
 * not the aggregate: Phase 1 measured `setup.warmup-compiler` at 146.17s cold
 * across 3 containers run sequentially in one process
 * (docs/superpowers/plans/2026-07-24-fast-trap-iteration-measurements.md),
 * i.e. ~48.7s per container. This lock is per-container (one
 * `.cg-<container>.lock` file each), so a single legitimate holder's real
 * rebuild is close to that ~49s figure, not the 146s aggregate — the margin
 * below is therefore roughly 6x a real rebuild, not the ~2x it looks like
 * against the raw aggregate number. There is no heartbeat to extend this
 * window for a holder that is legitimately still running past it: a
 * slow-but-alive rebuild past 300s will have its lock broken out from under
 * it by the next waiter.
 */
const DEFAULT_STALE_MS = 300_000;

/**
 * Margin `acquireLock`'s default timeout keeps above `staleMs`. Required
 * because a caller that starts waiting right after the true owner died can
 * otherwise exhaust its own timeout before the lock file's age ever crosses
 * `staleMs` — stale-breaking then never gets a chance to fire within that
 * caller's wait window, and it gives up and proceeds unlocked despite the
 * lock being dead. Any caller-supplied `timeoutMs` should stay above
 * `staleMs` for the same reason; the default enforces it automatically.
 */
const TIMEOUT_MARGIN_MS = 60_000;

const POLL_MS = 200;

interface LockPayload {
  /**
   * Unique per acquisition. `release()` only deletes the file if this still
   * matches its own token, so a holder that was broken as stale and
   * re-acquired by someone else does not get its new lock deleted out from
   * under it by the original (now-late) release() call.
   */
  token: string;
  /**
   * Diagnostic only — useful in a stuck-lock postmortem to identify which
   * process wrote the file. NOT read back for a liveness decision: on
   * Windows, `Deno.kill(pid, "SIGCONT")` throws
   * `TypeError: Invalid signal: SIGCONT` unconditionally (verified against a
   * live self-process and a nonexistent PID alike), so it carries no
   * liveness signal on this platform. Staleness is decided by mtime age
   * alone (see `breakIfStale`).
   */
  pid: number;
  at: string;
}

/**
 * Break the lock file if it is older than `staleMs`.
 *
 * The brief called for a PID-liveness refinement on top of the mtime check.
 * Dropped per the `Deno.kill`/SIGCONT finding documented on `LockPayload.pid`
 * above — mtime age alone is the staleness signal (this was already the
 * load-bearing check per the brief).
 */
async function breakIfStale(lockPath: string, staleMs: number): Promise<void> {
  let mtime: Date | null = null;
  try {
    const stat = await Deno.stat(lockPath);
    mtime = stat.mtime;
  } catch {
    // Unreadable or already gone — nothing to break.
    return;
  }
  const ageMs = mtime ? Date.now() - mtime.getTime() : Number.MAX_SAFE_INTEGER;
  if (ageMs < staleMs) return;
  try {
    await Deno.remove(lockPath);
    log.warn(`Broke stale compiler-folder lock: ${lockPath}`);
  } catch {
    // Someone else broke it first.
  }
}

/**
 * Acquire a cross-process lock at `lockPath`, polling until acquired,
 * `opts.timeoutMs` elapses, or an unstale-able error occurs.
 *
 * Never throws. On timeout, or when the lock file cannot be created at all
 * (permissions, missing parent), returns `{ acquired: false }` and the
 * caller is expected to proceed unlocked — a redundant rebuild is wasteful,
 * not incorrect, whereas a hung bench is an outage.
 */
export async function acquireLock(
  lockPath: string,
  opts?: { timeoutMs?: number; staleMs?: number },
): Promise<HeldLock> {
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;
  const timeoutMs = opts?.timeoutMs ?? staleMs + TIMEOUT_MARGIN_MS;
  const deadline = Date.now() + timeoutMs;
  let released = false;

  const makeHeld = (token: string): HeldLock => ({
    acquired: true,
    release: async () => {
      if (released) return;
      released = true;
      try {
        const current = JSON.parse(
          await Deno.readTextFile(lockPath),
        ) as LockPayload;
        if (current.token !== token) {
          // Someone else's lock now lives at this path — ours was already
          // broken as stale and re-acquired by another holder. Not ours to
          // delete.
          return;
        }
      } catch {
        // Unreadable or already gone — nothing to compare against, nothing
        // left to remove.
        return;
      }
      try {
        await Deno.remove(lockPath);
      } catch {
        // Raced with someone else removing/breaking it between our read and
        // this remove — already gone.
      }
    },
  });

  for (;;) {
    const token = crypto.randomUUID();
    try {
      const file = await Deno.open(lockPath, { createNew: true, write: true });
      try {
        const payload: LockPayload = {
          token,
          pid: Deno.pid,
          at: new Date().toISOString(),
        };
        await file.write(new TextEncoder().encode(JSON.stringify(payload)));
      } finally {
        file.close();
      }
      return makeHeld(token);
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        // Cannot lock at all (permissions, missing parent). Proceed unlocked:
        // a redundant rebuild is wasteful, not incorrect.
        log.warn(`Could not create lock ${lockPath}: ${error}`);
        return { acquired: false, release: () => Promise.resolve() };
      }
    }

    await breakIfStale(lockPath, staleMs);

    if (Date.now() >= deadline) {
      log.warn(`Timed out waiting for compiler-folder lock: ${lockPath}`);
      return { acquired: false, release: () => Promise.resolve() };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
