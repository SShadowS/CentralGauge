/**
 * Short-lived mutate lock (`mutate.lock`, spec section 4).
 *
 * Every batch command wraps its state mutation in {@link withMutateLock}:
 *
 * ```ts
 * await withMutateLock(dir, async () => {
 *   const state = await loadState(dir);
 *   const next = ...;
 *   await writeState(dir, next);
 * });
 * ```
 *
 * The lock is exclusive creation of `mutate.lock` (never overwritten), a
 * stale marker is reclaimed by atomic rename, and the file is always
 * removed in `finally` - the same shape as the bench lock
 * (`src/utils/bench-lock.ts`, spec D14), scaled down to "hold for the
 * duration of one command" rather than "hold for a whole bench run" (no
 * heartbeat, no owner token: a mutate-lock holder is a single `await`
 * away from releasing, so there is nothing to keep alive).
 *
 * @module src/batch/mutate-lock
 */
import { join } from "@std/path";
import { RUN_FILES } from "./paths.ts";

/** How long a `mutate.lock` may sit unreleased before it is reclaimed as stale. */
export const DEFAULT_STALE_AFTER_MS = 600_000;

/** Thrown by {@link withMutateLock} when a live lock is already held. */
export class MutateLockHeldError extends Error {
  constructor(public readonly path: string) {
    super(`mutate lock is held: ${path}`);
    this.name = "MutateLockHeldError";
  }
}

export interface WithMutateLockOptions {
  /** Age past which an existing lock file may be reclaimed; defaults to {@link DEFAULT_STALE_AFTER_MS}. */
  staleAfterMs?: number;
}

function mutateLockPath(dir: string): string {
  return join(dir, RUN_FILES.mutateLock);
}

/** Create the lock file only if it does not exist. Returns `false` on AlreadyExists. */
function createExclusive(path: string): boolean {
  let file: Deno.FsFile;
  try {
    file = Deno.openSync(path, { write: true, createNew: true });
  } catch (err) {
    if (err instanceof Deno.errors.AlreadyExists) return false;
    throw err;
  }
  try {
    file.writeSync(new TextEncoder().encode(new Date().toISOString()));
    file.syncSync();
  } finally {
    file.close();
  }
  return true;
}

/**
 * Move a stale lock out of the way. Rename is atomic, so when two processes
 * both see a stale lock only one rename succeeds; the other sees NotFound
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
 * Runs `fn` while holding the exclusive mutate lock on the run at `dir`.
 * Throws {@link MutateLockHeldError} when a live lock is already held; a
 * lock older than `staleAfterMs` (default 10 minutes) is reclaimed instead.
 * The lock is always removed in `finally`, including when `fn` throws.
 */
export async function withMutateLock<T>(
  dir: string,
  fn: () => Promise<T>,
  opts: WithMutateLockOptions = {},
): Promise<T> {
  const path = mutateLockPath(dir);
  const staleAfterMs = opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;

  let created = false;
  for (let i = 0; i < 3 && !created; i++) {
    created = createExclusive(path);
    if (created) break;
    const state = reclaimStale(path, staleAfterMs);
    if (state === "live") {
      throw new MutateLockHeldError(path);
    }
  }
  if (!created) {
    throw new MutateLockHeldError(path);
  }

  try {
    return await fn();
  } finally {
    try {
      Deno.removeSync(path);
    } catch {
      // already gone
    }
  }
}
