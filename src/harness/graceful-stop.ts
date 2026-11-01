/**
 * Graceful stop of a harness environment (anything that holds in-use records).
 *
 * SIGINT, SIGBREAK (Windows; SIGTERM elsewhere) or the stop file
 * `<private root>/STOP` request a stop. The holder finishes or aborts its
 * current row (never caching a partial one), then closes the environment the
 * normal way (post-cleanup check, L4 after-capture, in-use records released)
 * and exits non-zero. A detached process that no console signal reaches is
 * stopped by creating the stop file. A hard kill (taskkill /F) cannot be
 * caught: its records stay and recover refuses them (fail closed).
 */
import * as colors from "@std/fmt/colors";
import { join } from "@std/path";

/** The stop file's name, in the environment's private root (`--private-dir`). */
export const STOP_FILE = "STOP";

/** How often the stop file is polled while the environment is open. */
const POLL_MS = 2_000;

export type OnStopSignal = (cb: () => void) => () => void;

/** SIGINT plus SIGBREAK on Windows (SIGTERM elsewhere). */
export const stopSignals: OnStopSignal = (cb) => {
  const signals: Deno.Signal[] = Deno.build.os === "windows"
    ? ["SIGINT", "SIGBREAK"]
    : ["SIGINT", "SIGTERM"];
  for (const s of signals) Deno.addSignalListener(s, cb);
  return () => {
    for (const s of signals) Deno.removeSignalListener(s, cb);
  };
};

export const stopFileOf = (privateRoot: string) => join(privateRoot, STOP_FILE);

export interface StopWatch {
  signal: AbortSignal;
  /** Checks the stop file now; true once any stop was requested. */
  requested(): Promise<boolean>;
  /** Stops listening; removes the stop file when it was what stopped us. */
  dispose(): Promise<void>;
}

async function present(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

/** A stop file left at start would stop the next holder at once: refuse instead. */
export async function stopFileLeft(
  privateRoot: string,
): Promise<string | null> {
  const path = stopFileOf(privateRoot);
  return await present(path) ? path : null;
}

export function watchStop(
  privateRoot: string,
  onSignal: OnStopSignal = stopSignals,
): StopWatch {
  const path = stopFileOf(privateRoot);
  const stop = new AbortController();
  let byFile = false;
  const request = (why: string) => {
    if (stop.signal.aborted) return;
    console.error(
      `${
        colors.yellow("[STOP]")
      } ${why}: finishing the current row, then a clean close (in-use records released); exit non-zero`,
    );
    stop.abort(new Error(`stopped: ${why}`));
  };
  const unhook = onSignal(() => request("interrupt signal"));
  const requested = async () => {
    if (!stop.signal.aborted && await present(path)) {
      byFile = true;
      request(`stop file ${path}`);
    }
    return stop.signal.aborted;
  };
  const timer = setInterval(() => void requested().catch(() => {}), POLL_MS);
  Deno.unrefTimer(timer);
  return {
    signal: stop.signal,
    requested,
    dispose: async () => {
      clearInterval(timer);
      unhook();
      // Consumed: the next holder of this private root starts normally.
      if (byFile) await Deno.remove(path).catch(() => {});
    },
  };
}
