/**
 * Temp dirs removed when the test process exits (the `unload` event fires
 * under `deno test`). Fixtures put test secrets in these roots, so none may
 * outlive the run (M1-20a).
 */
const dirs: string[] = [];

globalThis.addEventListener("unload", () => {
  for (const d of dirs) {
    try {
      Deno.removeSync(d, { recursive: true });
    } catch {
      // Already gone or still locked: nothing more to do at exit.
    }
  }
});

export async function tempDir(opts?: Deno.MakeTempOptions): Promise<string> {
  const d = await Deno.makeTempDir(opts);
  dirs.push(d);
  return d;
}
