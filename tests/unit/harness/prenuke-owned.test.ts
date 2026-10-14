/**
 * H-05 run 002: the prenuke's destructive steps (uninstall without data,
 * Sync-NAVApp -Mode Clean) apply only to OWNED apps (trusted AppId and exact
 * name, the gate's refapp + task-oracle allowlist), never by name prefix; a
 * failed clean is fatal (PREREQ_CLEANUP_CLEAN_FAILED, no DONE).
 *
 * SAFETY: the real script runs in a LOCAL pwsh against stubbed NAV cmdlets and
 * a stubbed Invoke-ScriptInBcContainer; the bccontainerhelper import is removed.
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import { buildPrereqCleanupScript } from "../../../src/container/bc-script-builders.ts";
import {
  bcchConfigInit,
  bcchImport,
} from "../../../src/container/bcch-config.ts";

const isWindows = Deno.build.os === "windows";

const OWNED_ID = "c6a1e000-0000-4000-8000-000000000001";
const FOREIGN_ID = "0badf00d-0000-4000-8000-000000000099";

const STUBS = `
$global:log = @()
function Invoke-ScriptInBcContainer { param($containerName, [scriptblock]$scriptblock, $argumentList)
  & $scriptblock @argumentList }
function Get-NAVAppInfo { param($ServerInstance, $Name, $Publisher, $Tenant)
  @($global:apps | Where-Object { -not $Name -or $_.Name -eq $Name }) }
function Uninstall-NAVApp { param($ServerInstance, $Name, $Publisher, $Version, $Tenant, [switch]$Force, [switch]$DoNotSaveData, $ErrorAction)
  $global:log += "uninstall $Name nodata=$([bool]$DoNotSaveData)" }
function Unpublish-NAVApp { param($ServerInstance, $Name, $Publisher, $Version, $Tenant, $ErrorAction)
  $global:apps = @($global:apps | Where-Object { $_.Name -ne $Name }) }
function Sync-NAVApp { param($ServerInstance, $Name, $Publisher, $Tenant, $Mode, [switch]$Force, $ErrorAction)
  $global:log += "clean $Name"
  if ($global:failClean) { throw 'clean boom' } }
`;

async function runPrenuke(
  apps: { AppId: string; Name: string }[],
  owned: { id: string; name: string }[],
  failClean = false,
): Promise<{ out: string; log: string[] }> {
  const script = buildPrereqCleanupScript(
    "Cronus281",
    [],
    "CG Test Harness",
    owned,
  ).replace(bcchImport(), "").replace(bcchConfigInit(), "");
  const setup = `$global:apps = @(${
    apps.map((a) =>
      `[pscustomobject]@{ AppId = '${a.AppId}'; Name = '${a.Name}'; Publisher = 'CentralGauge'; Version = '1.0.25913.28211' }`
    ).join(", ")
  })\n$global:failClean = $${failClean}\n`;
  const body = STUBS + setup + script +
    `\n$global:log | ForEach-Object { "LOG:$_" }\n`;
  const out = await new Deno.Command("pwsh", {
    args: ["-NoProfile", "-NonInteractive", "-Command", "-"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const w = out.stdin.getWriter();
  await w.write(new TextEncoder().encode(body));
  await w.close();
  const r = await out.output();
  const text = new TextDecoder().decode(r.stdout);
  return {
    out: text,
    log: text.split(/\r?\n/).filter((l) => l.startsWith("LOG:")).map((l) =>
      l.slice(4)
    ),
  };
}

Deno.test({
  name:
    "prenuke (H-05 run 002): an owned app (trusted id + exact name) goes without its data and is cleaned",
  ignore: !isWindows,
  fn: async () => {
    const { out, log } = await runPrenuke(
      [{ AppId: OWNED_ID, Name: "CGR Core" }],
      [{ id: OWNED_ID, name: "CGR Core" }],
    );
    assertEquals(log, [
      "uninstall CGR Core nodata=True",
      "uninstall CGR Core nodata=True",
      "clean CGR Core",
    ], out);
    assertStringIncludes(out, "PREREQ_CLEANUP_DONE");
  },
});

Deno.test({
  name:
    "prenuke (H-05 run 002): a CentralGauge 'CGR ...' app with a foreign id, or an owned id under another name, keeps its data and is never cleaned",
  ignore: !isWindows,
  fn: async () => {
    for (
      const app of [
        { AppId: FOREIGN_ID, Name: "CGR Something" },
        { AppId: OWNED_ID, Name: "CGR Core2" },
      ]
    ) {
      const { out, log } = await runPrenuke(
        [app],
        [{ id: OWNED_ID, name: "CGR Core" }],
      );
      assertEquals(log, [
        `uninstall ${app.Name} nodata=False`,
        `uninstall ${app.Name} nodata=False`,
      ], out);
      assertStringIncludes(out, "PREREQ_CLEANUP_DONE");
    }
  },
});

Deno.test({
  name:
    "prenuke (H-05 run 002): with no owned list (the bench prenuke) nothing is destructive",
  ignore: !isWindows,
  fn: async () => {
    const { log } = await runPrenuke(
      [{ AppId: OWNED_ID, Name: "CGR Core" }],
      [],
    );
    assert(log.every((l) => !l.startsWith("clean ")), log.join());
    assert(log.every((l) => l.endsWith("nodata=False")), log.join());
  },
});

Deno.test({
  name:
    "prenuke (H-05 run 002): a failed clean is fatal: CLEAN_FAILED, no DONE",
  ignore: !isWindows,
  fn: async () => {
    const { out } = await runPrenuke(
      [{ AppId: OWNED_ID, Name: "CGR Core" }],
      [{ id: OWNED_ID, name: "CGR Core" }],
      true,
    );
    assertStringIncludes(out, "PREREQ_CLEANUP_CLEAN_FAILED:CGR Core");
    assertEquals(out.includes("PREREQ_CLEANUP_DONE"), false, out);
  },
});

/** A provider whose warm-slot call returns `output` (no container). */
function stubbedProvider(output: string | Error) {
  const provider = new BcContainerProvider();
  const scripts: string[] = [];
  // deno-lint-ignore no-explicit-any
  (provider as any).runScriptThroughSession = (_n: string, script: string) => {
    scripts.push(script);
    return output instanceof Error
      ? Promise.reject(output)
      : Promise.resolve({ output, exitCode: 0 });
  };
  return { provider, scripts };
}

Deno.test({
  name:
    "prenukeCentralGaugeApps (H-05 run 002): with owned apps a failed clean, a missing DONE or a failed call is thrown (infra), never logged and passed",
  ignore: !isWindows,
  fn: async () => {
    const owned = [{ id: OWNED_ID, name: "CGR Core" }];
    for (
      const output of [
        "PREREQ_CLEANUP_FOUND:1\nPREREQ_CLEANUP_CLEAN_FAILED:CGR Core - boom\n",
        "PREREQ_CLEANUP_WARN:invoke-script - gone\n",
        new Error("session crashed"),
      ]
    ) {
      const { provider, scripts } = stubbedProvider(output);
      await assertRejects(
        () => provider.prenukeCentralGaugeApps(["Cronus281"], owned),
        Error,
      );
      if (!(output instanceof Error)) {
        assertStringIncludes(scripts[0]!, `'${OWNED_ID}' = 'CGR Core'`);
      }
    }
    const ok = stubbedProvider(
      "PREREQ_CLEANUP_FOUND:1\nPREREQ_CLEANUP_CLEAN:CGR Core\nPREREQ_CLEANUP_DONE\n",
    );
    await ok.provider.prenukeCentralGaugeApps(["Cronus281"], owned);
  },
});

Deno.test({
  name:
    "prenukeCentralGaugeApps (H-05 run 002): without owned apps (the bench) it stays best-effort",
  ignore: !isWindows,
  fn: async () => {
    const { provider } = stubbedProvider(new Error("session crashed"));
    await provider.prenukeCentralGaugeApps(["Cronus281"]);
  },
});
