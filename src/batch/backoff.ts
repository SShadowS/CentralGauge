/**
 * Bounded exponential backoff with full jitter for provider transport
 * failures (spec section 5: "Transport failures on any operation get
 * bounded exponential backoff inside `advance` (5 tries, 2 s base, 60 s
 * cap)").
 *
 * `BatchSubmitRejected` (a synchronous submission rejection) is never a
 * transport failure and propagates on the attempt that threw it, without
 * sleeping or consuming a retry; the same applies to any error the
 * caller's `isTransport` predicate rejects (a provider item error, for
 * instance, is never worth retrying at this layer).
 *
 * @module src/batch/backoff
 */
import { BatchSubmitRejected } from "../llm/batch/types.ts";

export interface WithTransportBackoffOptions {
  /** Total attempts, including the first. Defaults to 5. */
  tries?: number;
  /** Base delay in ms for the exponential curve. Defaults to 2_000. */
  baseMs?: number;
  /** Upper bound on the delay before jitter. Defaults to 60_000. */
  capMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to: everything except {@link BatchSubmitRejected}. */
  isTransport?: (e: unknown) => boolean;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultIsTransport(e: unknown): boolean {
  return !(e instanceof BatchSubmitRejected);
}

/**
 * Runs `op`, retrying on a transport error (per `isTransport`) up to
 * `tries` attempts total. Before attempt `n` (0-based, `n >= 1`), sleeps
 * `random(0, min(capMs, baseMs * 2 ** (n - 1)))` ms - full jitter over an
 * exponentially growing bound. A non-transport error, or the error from
 * the final attempt, propagates immediately without a further sleep.
 */
export async function withTransportBackoff<T>(
  op: () => Promise<T>,
  opts: WithTransportBackoffOptions = {},
): Promise<T> {
  const tries = opts.tries ?? 5;
  const baseMs = opts.baseMs ?? 2_000;
  const capMs = opts.capMs ?? 60_000;
  const sleep = opts.sleep ?? defaultSleep;
  const isTransport = opts.isTransport ?? defaultIsTransport;

  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await op();
    } catch (err) {
      if (!isTransport(err) || attempt === tries - 1) {
        throw err;
      }
      const bound = Math.min(capMs, baseMs * 2 ** attempt);
      await sleep(Math.random() * bound);
    }
  }
  // Unreachable: the loop above always returns or throws.
  throw new Error("withTransportBackoff: unreachable");
}
