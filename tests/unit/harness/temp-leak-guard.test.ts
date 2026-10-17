/**
 * GH #28 guard: fixture-heavy test files leave nothing in the temp dir.
 *
 * Runs them in a child `deno test` whose TEMP and TMP point at a fresh empty
 * dir, so Deno.makeTempDir lands there, then checks the dir is empty again.
 * staging.test.ts covers makeRefappRepo and plain temp dirs, mock.test.ts
 * covers makeEnv (refapp repo, symbol store, cg-private root, secrets dir).
 */
import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { scopedTempDir } from "../../utils/temp-dir.ts";

const REPO = fromFileUrl(new URL("../../../", import.meta.url));
const FILES = [
  "tests/unit/harness/staging.test.ts",
  "tests/unit/harness/mock.test.ts",
];

Deno.test("temp leak guard (GH #28): fixture-heavy files leave no temp entries", async () => {
  await using temp = await scopedTempDir({ prefix: "cg-leakguard-" });
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["test", "--allow-all", ...FILES],
    cwd: REPO,
    env: { TEMP: temp.path, TMP: temp.path },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const log = new TextDecoder().decode(out.stdout) +
    new TextDecoder().decode(out.stderr);
  assertEquals(out.code, 0, `the guarded files pass:\n${log.slice(-4000)}`);
  const left: string[] = [];
  for await (const e of Deno.readDir(temp.path)) left.push(e.name);
  assertEquals(left.sort(), [], "every temp entry the files made is removed");
});
