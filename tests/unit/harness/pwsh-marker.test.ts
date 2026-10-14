/**
 * H-05: the warm pwsh session's per-call line must always emit its completion
 * marker, with the error text, even when the script throws a terminating error
 * (a refused Publish-BcContainerApp -ErrorAction Stop, PipelineStoppedException).
 * Without it the host waits the full 300 s marker timeout (gate exit 3).
 *
 * SAFETY: a LOCAL pwsh with the same flags as the warm session; no container.
 */

import { assert, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markerOneLiner } from "../../../src/container/pwsh-session.ts";

const hasPwsh = await new Deno.Command("pwsh", {
  args: ["-NoProfile", "-Command", "exit 0"],
  stdout: "null",
  stderr: "null",
}).output().then((o) => o.success, () => false);

/** Feed the session's one-liner for `body` to `pwsh -NoExit -Command -`, as the warm session does. */
async function runInSession(body: string): Promise<string> {
  const dir = await Deno.makeTempDir();
  const script = join(dir, "s.ps1");
  await Deno.writeTextFile(script, body);
  const p = new Deno.Command("pwsh", {
    args: ["-NoLogo", "-NoProfile", "-NoExit", "-Command", "-"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const w = p.stdin.getWriter();
  const enc = new TextEncoder();
  await w.write(enc.encode("$ErrorActionPreference = 'Continue'\n"));
  await w.write(enc.encode(markerOneLiner(script, "tok")));
  await w.write(enc.encode("exit\n"));
  await w.close();
  const out = await p.output();
  await Deno.remove(dir, { recursive: true });
  return new TextDecoder().decode(out.stdout);
}

Deno.test({
  name:
    "markerOneLiner (H-05): a script that throws a terminating error still emits the marker, non-zero, with the error text",
  ignore: !hasPwsh,
  fn: async () => {
    const out = await runInSession(
      "Write-Output 'before'\nthrow 'Cannot install the extension CGR Core: a newer version was already installed'\n",
    );
    assertStringIncludes(out, "before");
    assertStringIncludes(out, "a newer version was already installed");
    assert(
      /@@CG-DONE-tok-EXIT-[1-9]\d*@@/.test(out),
      `no non-zero marker in:\n${out}`,
    );
  },
});

Deno.test({
  name:
    "markerOneLiner (H-05): -ErrorAction Stop inside the script still emits the marker",
  ignore: !hasPwsh,
  fn: async () => {
    const out = await runInSession(
      "Write-Error 'publish refused' -ErrorAction Stop\n",
    );
    assertStringIncludes(out, "publish refused");
    assert(
      /@@CG-DONE-tok-EXIT-[1-9]\d*@@/.test(out),
      `no non-zero marker in:\n${out}`,
    );
  },
});

Deno.test({
  name:
    "markerOneLiner (H-05): a clean script is EXIT-0 and an exit code passes through",
  ignore: !hasPwsh,
  fn: async () => {
    assertStringIncludes(
      await runInSession("Write-Output 'ok'\n"),
      "@@CG-DONE-tok-EXIT-0@@",
    );
    assertStringIncludes(
      await runInSession("exit 3\n"),
      "@@CG-DONE-tok-EXIT-3@@",
    );
  },
});
