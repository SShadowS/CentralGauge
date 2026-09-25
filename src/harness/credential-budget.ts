/**
 * One shared, cross-lane budget of supervised credential-bearing runs
 * before egress enforcement (egress decision; round 2 item 9). M1 and M4
 * reserve in the same append-only ledger; a reservation is made before any
 * credential is released; no ledger configured means refused.
 *
 * Crash safety: the ledger is guarded by an OS file lock on `<ledger>.lock`
 * (released by the OS when a holder dies, so no stale-age heuristic can let
 * two holders in); every non-empty line counts, parseable or not; a line a
 * crashed writer left without its newline is terminated before the next
 * reservation, so two reservations never merge into one line; the new line
 * is synced before the lock is released.
 */

import { ConfigurationError } from "../errors.ts";

export const CREDENTIAL_RUN_LIMIT = 5;

export interface Reservation {
  lane: string;
  task: string;
  config: string;
  purpose: string;
}

/** How long a caller waits for another lane's reservation to finish. */
const LOCK_WAIT_MS = 60_000;

const msg = (err: unknown) => err instanceof Error ? err.message : String(err);

export interface ReserveOptions {
  /** Operator interrupt: refuses before the lock and aborts the wait. */
  signal?: AbortSignal;
  /** How long to wait for another holder (default LOCK_WAIT_MS). */
  waitMs?: number;
}

export async function reserveCredentialRun(
  ledgerPath: string | null,
  r: Reservation,
  limit = CREDENTIAL_RUN_LIMIT,
  opts: ReserveOptions = {},
): Promise<number> {
  if (!ledgerPath) {
    throw new ConfigurationError(
      "no shared credential-run ledger configured (CG_CREDENTIAL_LEDGER): refusing a credential-bearing run",
    );
  }
  for (const k of ["lane", "task", "config", "purpose"] as const) {
    if (r[k].trim() === "") {
      throw new ConfigurationError(
        `credential-run reservation needs a non-empty ${k}`,
      );
    }
  }
  const stopped = () =>
    new ConfigurationError(
      "stopped by the operator: no credential run reserved",
    );
  if (opts.signal?.aborted) throw stopped();
  const lockPath = `${ledgerPath}.lock`;
  let lock: Deno.FsFile;
  try {
    lock = await Deno.open(lockPath, { read: true, write: true, create: true });
  } catch (err) {
    throw new ConfigurationError(
      `cannot open the credential-run ledger lock ${lockPath}: ${
        msg(err)
      }; refusing`,
    );
  }
  // Non-blocking tries with bounded backoff: a refusal or a stop leaves no
  // pending lock request behind (a blocking lock() would keep the process alive).
  const waitMs = opts.waitMs ?? LOCK_WAIT_MS;
  const t0 = performance.now();
  try {
    for (let delay = 10;; delay = Math.min(delay * 2, 500)) {
      if (await lock.tryLock(true)) break;
      if (opts.signal?.aborted) throw stopped();
      const left = waitMs - (performance.now() - t0);
      if (left <= 0) {
        throw new ConfigurationError(
          `credential-run ledger ${lockPath} stayed locked for ${waitMs} ms; refusing`,
        );
      }
      await new Promise<void>((res) => {
        const t = setTimeout(done, Math.min(delay, left));
        function done() {
          clearTimeout(t);
          opts.signal?.removeEventListener("abort", done);
          res();
        }
        opts.signal?.addEventListener("abort", done, { once: true });
      });
    }
  } catch (err) {
    lock.close();
    throw err;
  }
  try {
    let text: string;
    try {
      text = await Deno.readTextFile(ledgerPath);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        throw new ConfigurationError(
          `cannot read the credential-run ledger ${ledgerPath}: ${
            msg(err)
          }; refusing`,
        );
      }
      text = ""; // only a genuinely absent ledger means no run yet
    }
    // Every non-empty line counts, parseable or not (conservative).
    const used = text.split(/\r?\n/).filter((l) => l.trim() !== "").length;
    if (used >= limit) {
      throw new ConfigurationError(
        `${limit} supervised credential-bearing runs are used across all lanes; egress enforcement must be verified (M1-33, M1-34) before more`,
      );
    }
    const line = JSON.stringify({
      v: 1,
      at: new Date().toISOString(),
      ordinal: used + 1,
      ...r,
    }) + "\n";
    const bytes = new TextEncoder().encode(
      text !== "" && !text.endsWith("\n") ? `\n${line}` : line,
    );
    const f = await Deno.open(ledgerPath, { append: true, create: true });
    try {
      for (let off = 0; off < bytes.length;) {
        off += await f.write(bytes.subarray(off));
      }
      await f.sync();
    } catch (err) {
      throw new ConfigurationError(
        `cannot append to the credential-run ledger ${ledgerPath}: ${
          msg(err)
        }; the reservation may be partial and counts`,
      );
    } finally {
      f.close();
    }
    return used + 1;
  } finally {
    lock.close(); // closing the handle releases the lock
  }
}
