/**
 * Temp dirs for tests (GH #28: the suite used to leave ~1M dirs in %TEMP%).
 *
 * Every dir made here is removed when the test process exits (the `unload`
 * event fires under `deno test`), so a test that forgets to clean up still
 * leaves nothing behind. `await using` / `withTempDir` remove it earlier, at
 * the end of the block. Removal is best effort: a dir still locked by a child
 * process (Windows) is logged, never thrown, so a cleanup failure can't hide
 * the real test result.
 */
import { join } from "@std/path";

const live = new Set<string>();

function report(path: string, e: unknown): void {
  if (e instanceof Deno.errors.NotFound) return;
  console.warn(
    `[temp-dir] could not remove ${path}: ${
      e instanceof Error ? e.message : e
    }`,
  );
}

globalThis.addEventListener("unload", () => {
  for (const d of live) {
    try {
      Deno.removeSync(d, { recursive: true });
    } catch (e) {
      report(d, e);
    }
  }
  live.clear();
});

/** Track a dir made elsewhere (e.g. by the code under test) for exit removal. */
export function trackTempDir(path: string): string {
  live.add(path);
  return path;
}

/** `Deno.makeTempDir`, removed at process exit at the latest. */
export async function testTempDir(
  opts?: Deno.MakeTempOptions,
): Promise<string> {
  return trackTempDir(await Deno.makeTempDir(opts));
}

/** `Deno.makeTempFile`, removed at process exit at the latest. */
export async function testTempFile(
  opts?: Deno.MakeTempOptions,
): Promise<string> {
  return trackTempDir(await Deno.makeTempFile(opts));
}

/** Remove a dir now; best effort, logs instead of throwing. */
export async function removeTempDir(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (e) {
    report(path, e);
  }
  live.delete(path);
}

export interface ScopedTempDir extends AsyncDisposable {
  path: string;
  /** join(path, ...parts) */
  at(...parts: string[]): string;
}

/** `await using d = await scopedTempDir()`: removed at the end of the block. */
export async function scopedTempDir(
  opts?: Deno.MakeTempOptions,
): Promise<ScopedTempDir> {
  const path = await testTempDir(opts);
  return {
    path,
    at: (...parts) => join(path, ...parts),
    [Symbol.asyncDispose]: () => removeTempDir(path),
  };
}

/** Run fn with a fresh temp dir, removed afterwards whatever fn does. */
export async function withTempDir<T>(
  fn: (dir: string) => Promise<T> | T,
  opts?: Deno.MakeTempOptions,
): Promise<T> {
  await using d = await scopedTempDir(opts);
  return await fn(d.path);
}
