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

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_STALE_MS = 300_000;
const POLL_MS = 200;

interface LockPayload {
  pid: number;
  at: string;
}

/**
 * Break the lock file if it is older than `staleMs`.
 *
 * The brief called for a PID-liveness refinement on top of the mtime check
 * (`Deno.kill(pid, "SIGCONT")` as a signal-0-style existence probe). Verified
 * on Windows (Deno 2.8.1): `Deno.kill(pid, "SIGCONT")` throws
 * `TypeError: Invalid signal: SIGCONT` unconditionally — for both a live
 * self-process and a nonexistent PID. It is not a liveness check on this
 * platform at all, just an unsupported signal, so treating a throw as "not
 * alive" would make every process look dead and break the lock immediately
 * regardless of who holds it. Dropped the PID check; mtime age alone is the
 * staleness signal (this was already the load-bearing check per the brief).
 * `pid` is kept in the payload for diagnostics only.
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
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;
  const deadline = Date.now() + timeoutMs;
  let released = false;

  const makeHeld = (): HeldLock => ({
    acquired: true,
    release: async () => {
      if (released) return;
      released = true;
      try {
        await Deno.remove(lockPath);
      } catch {
        // Already gone (broken as stale by another process).
      }
    },
  });

  for (;;) {
    try {
      const file = await Deno.open(lockPath, { createNew: true, write: true });
      try {
        const payload: LockPayload = {
          pid: Deno.pid,
          at: new Date().toISOString(),
        };
        await file.write(new TextEncoder().encode(JSON.stringify(payload)));
      } finally {
        file.close();
      }
      return makeHeld();
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
