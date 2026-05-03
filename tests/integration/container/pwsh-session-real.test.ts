/**
 * Real pwsh round-trip integration test for PwshContainerSession.
 *
 * Prerequisites:
 * - Windows only
 * - bccontainerhelper PowerShell module installed (any version)
 *
 * Run with: deno test --allow-all tests/integration/container/pwsh-session-real.test.ts
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { PwshContainerSession } from "../../../src/container/pwsh-session.ts";

const isWindows = Deno.build.os === "windows";

async function checkBcContainerHelper(): Promise<boolean> {
  if (!isWindows) return false;
  try {
    const cmd = new Deno.Command("pwsh", {
      args: [
        "-NoProfile",
        "-Command",
        "if (Get-Module -ListAvailable bccontainerhelper) { 'yes' } else { 'no' }",
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const { success, stdout } = await cmd.output();
    if (!success) return false;
    return new TextDecoder().decode(stdout).trim() === "yes";
  } catch {
    return false;
  }
}

const hasBch = await checkBcContainerHelper();

Deno.test({
  name: "PwshContainerSession real pwsh round-trip",
  ignore: !isWindows || !hasBch,
  fn: async () => {
    const sess = new PwshContainerSession("integration-test", {
      recycleThreshold: 5,
      bootstrapTimeoutMs: 60_000,
      defaultTimeoutMs: 30_000,
    });
    try {
      await sess.init();
      assertEquals(sess.state, "idle");

      const r = await sess.execute(`Write-Output "hello from session"`);
      assertEquals(r.exitCode, 0);
      assertStringIncludes(r.output, "hello from session");
      assertEquals(sess.callCount, 1);

      // A second call should be much faster (no module re-load)
      const r2 = await sess.execute(`Write-Output "second call"`);
      assertEquals(r2.exitCode, 0);
      assertStringIncludes(r2.output, "second call");
      assertEquals(sess.callCount, 2);
    } finally {
      await sess.dispose();
      assertEquals(sess.state, "dead");
    }
  },
});
