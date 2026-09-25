import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import {
  buildHarnessCleanBlock,
  buildHarnessRemoveBlock,
  buildListHarnessAppsScript,
  buildSyncHarnessAppsScript,
} from "../../../src/container/bc-script-builders.ts";
import {
  parseHarnessAppList,
  parseHarnessSyncOutput,
} from "../../../src/container/bc-output-parsers.ts";
import { ContainerError } from "../../../src/errors.ts";
import { IDS } from "./refapp-fixture.ts";

const isWindows = Deno.build.os === "windows";

interface Stub {
  provider: BcContainerProvider;
  // deno-lint-ignore no-explicit-any
  calls: any[];
  shared: string;
}

async function stubbed(output: string): Promise<Stub> {
  const provider = new BcContainerProvider();
  // deno-lint-ignore no-explicit-any
  const calls: any[] = [];
  const shared = await Deno.makeTempDir();
  // deno-lint-ignore no-explicit-any
  const p = provider as any;
  p.harnessSharedFolder = () => shared;
  p.runScriptThroughSession = (name: string, script: string, label: string) => {
    calls.push({ name, script, label });
    return Promise.resolve({ output, exitCode: 0 });
  };
  return { provider, calls, shared };
}

Deno.test({
  name:
    "syncHarnessApps: one warm-slot script, staged files removed afterwards",
  ignore: !isWindows,
  async fn() {
    const out = `SYNC_REMOVE:${IDS.rental} v1.0.0.0
SYNC_PUBLISH_MS:0:150
SYNC_DONE
`;
    const { provider, calls, shared } = await stubbed(out);
    const app = join(
      await Deno.makeTempDir(),
      "CentralGauge_CGR Rental_1.0.0.0.app",
    );
    await Deno.writeTextFile(app, "x");
    const r = await provider.syncHarnessApps("Cronus281", {
      removeIds: [IDS.rental],
      allow: new Map([[IDS.rental, "^CGR Rental$"], [IDS.core, "^CGR Core$"]]),
      publish: [app],
    });
    assertEquals(calls.length, 1);
    assertEquals(calls[0].label, "harness-sync");
    assertStringIncludes(calls[0].script, IDS.rental);
    assertStringIncludes(calls[0].script, shared);
    assertEquals(r.removed, [IDS.rental]);
    assertEquals(r.published, [{ index: 0, ms: 150 }]);
    assertEquals([...Deno.readDirSync(shared)].length, 0);
  },
});

Deno.test({
  name:
    "syncHarnessApps: incomplete removal throws, a publish failure is returned",
  ignore: !isWindows,
  async fn() {
    const bad = await stubbed(
      `SYNC_REMOVE_INCOMPLETE:${IDS.rental}\nSYNC_DONE\n`,
    );
    await assertRejects(
      () =>
        bad.provider.syncHarnessApps("Cronus281", {
          removeIds: [IDS.rental],
          allow: new Map([[IDS.rental, "^CGR Rental$"], [
            IDS.core,
            "^CGR Core$",
          ]]),
          publish: [],
        }),
      ContainerError,
      "incomplete",
    );
    const failed = await stubbed(
      "SYNC_PUBLISH_MS:0:2\nSYNC_PUBLISH_FAILED:0:The schema synchronization failed\n",
    );
    const r = await failed.provider.syncHarnessApps("Cronus281", {
      removeIds: [],
      allow: new Map([[IDS.rental, "^CGR Rental$"], [IDS.core, "^CGR Core$"]]),
      publish: [],
    });
    assertEquals(r.failed, {
      index: 0,
      message: "The schema synchronization failed",
    });
  },
});

Deno.test("syncHarnessApps: a non-GUID id is refused before any script runs", async () => {
  const { provider, calls } = await stubbed("SYNC_DONE");
  await assertRejects(
    () =>
      provider.syncHarnessApps("Cronus281", {
        removeIds: ["x'; Remove-Item C:\\"],
        allow: new Map([[IDS.rental, "^CGR Rental$"], [
          IDS.core,
          "^CGR Core$",
        ]]),
        publish: [],
      }),
    Error,
    "not an app id",
  );
  assertEquals(calls.length, 0);
});

Deno.test({
  name: "listHarnessApps: parses CG_APP lines; no done marker is loud",
  ignore: !isWindows,
  async fn() {
    const ok = await stubbed(
      `CG_APP:{"id":"${IDS.core.toUpperCase()}","name":"CGR Core","publisher":"CentralGauge","version":"1.0.5.6","installed":true}\nCG_APPS_DONE\n`,
    );
    assertEquals(await ok.provider.listHarnessApps("Cronus281"), [
      {
        id: IDS.core,
        name: "CGR Core",
        publisher: "CentralGauge",
        version: "1.0.5.6",
        installed: true,
      },
    ]);
    assertEquals(ok.calls[0].label, "harness-apps");
    const bad = await stubbed("CG_APPS_FAILED:boom");
    await assertRejects(
      () => bad.provider.listHarnessApps("Cronus281"),
      ContainerError,
    );
  },
});

Deno.test("buildSyncHarnessAppsScript: pinned BCH, settings, removal before publish, Stopwatch timing", () => {
  const s = buildSyncHarnessAppsScript("Cronus281", [IDS.rental], [
    "C:\\my\\ab_O'Brien.app",
  ], { username: "u", password: "p'w" });
  assert(!s.includes("${"));
  assertStringIncludes(
    s,
    "Import-Module bccontainerhelper -RequiredVersion 6.1.14",
  );
  assertStringIncludes(
    s,
    "$bcContainerHelperConfig.usePsSessionForBc28 = $false",
  );
  assert(s.indexOf("Get-NAVAppInfo") < s.indexOf("Publish-BcContainerApp"));
  assertStringIncludes(s, "[Diagnostics.Stopwatch]::StartNew()");
  assertStringIncludes(s, "'C:\\my\\ab_O''Brien.app'");
  assertStringIncludes(s, "-useDevEndpoint -credential $cgPubCredential");
});

Deno.test("parseHarnessSyncOutput: Stopwatch milliseconds per published file", () => {
  const r = parseHarnessSyncOutput(
    `SYNC_REMOVE:${IDS.core.toUpperCase()} v1.0.0.0\nSYNC_PUBLISH_MS:0:4120\nSYNC_DONE\n`,
  );
  assertEquals([r.removed, r.published, r.done], [[IDS.core], [{
    index: 0,
    ms: 4120,
  }], true]);
});

Deno.test("buildSyncHarnessAppsScript: removal retries in passes and never publishes after an incomplete removal", () => {
  const s = buildSyncHarnessAppsScript("Cronus281", [IDS.rental, IDS.core], [
    "C:\a.app",
  ]);
  // Passes: an owned app that another owned app depends on goes in a later pass.
  assertStringIncludes(
    s,
    "for ($cgPass = 1; $cgPass -le $ids.Count; $cgPass++)",
  );
  // A failed removal stops the script before any publish.
  const guard = s.indexOf("SYNC_REMOVE_FAILED:");
  const stop = s.indexOf("exit 1", guard);
  assert(
    guard > 0 && stop > guard && stop < s.indexOf("Publish-BcContainerApp"),
  );
});

Deno.test("parseHarnessAppList: a malformed CG_APP line is a failed listing, not a SyntaxError", () => {
  assertEquals(parseHarnessAppList(`CG_APP:{not json\nCG_APPS_DONE\n`), null);
});

Deno.test("syncHarnessApps: a removal id outside the trusted allowlist is refused before any script", async () => {
  const { provider, calls } = await stubbed("SYNC_DONE");
  await assertRejects(
    () =>
      provider.syncHarnessApps("Cronus281", {
        removeIds: [IDS.rental],
        publish: [],
        allow: new Map([[IDS.core, "^CGR Core$"]]),
      }),
    Error,
    "not on the removal allowlist",
  );
  assertEquals(calls.length, 0);
});

Deno.test("syncHarnessApps: a foreign app sharing a removal id is refused (nothing removed)", async () => {
  const { provider } = await stubbed(
    `SYNC_REMOVE_REFUSED:${IDS.rental} publisher Continia\n`,
  );
  await assertRejects(
    () =>
      provider.syncHarnessApps("Cronus281", {
        removeIds: [IDS.rental],
        publish: [],
        allow: new Map([[IDS.rental, "^CGR Rental$"]]),
      }),
    ContainerError,
    "refused",
  );
});

Deno.test("buildSyncHarnessAppsScript: publisher and allowlist pre-check before any uninstall; clean removal", () => {
  const s = buildSyncHarnessAppsScript(
    "Cronus281",
    [IDS.rental],
    [],
    undefined,
    new Map([[IDS.rental, "^CGR Rental$"]]),
  );
  const refused = s.indexOf("SYNC_REMOVE_REFUSED:");
  const firstUninstall = s.indexOf("Uninstall-NAVApp");
  assert(
    refused > 0 && refused < firstUninstall,
    "pre-check before any uninstall",
  );
  assert(
    s.indexOf("exit 1", refused) < firstUninstall,
    "a refusal stops before any uninstall",
  );
  assertStringIncludes(s, "$app.Publisher -ne 'CentralGauge'");
  assertStringIncludes(s, "-not $allow.ContainsKey($id)");
  const uninstalls = s.split("Uninstall-NAVApp").slice(1);
  assert(
    uninstalls.length > 0 &&
      uninstalls.every((u) => u.split("\n")[0]!.includes("-DoNotSaveData")),
  );
  const clean = s.indexOf("Sync-NAVApp");
  assert(clean > firstUninstall && clean < s.indexOf("Unpublish-NAVApp"));
  assertStringIncludes(s.slice(clean, clean + 200), "-Mode Clean");
});

Deno.test("harness script builders refuse a hostile container name", () => {
  const bad = `x"; Remove-Item C:\ -Recurse; "`;
  assertThrows(
    () => buildSyncHarnessAppsScript(bad, [], []),
    Error,
    "container name",
  );
  assertThrows(() => buildListHarnessAppsScript(bad), Error, "container name");
});

// ---- The removal block, executed in local pwsh against stubbed BC cmdlets ----

interface StubApp {
  AppId: string;
  Name: string;
  Publisher: string;
  Version: string;
  IsInstalled: boolean;
}

const STUBS = `
function Get-NAVAppInfo { param($ServerInstance, $Id, $Version, $Tenant, [switch]$TenantSpecificProperties)
  @($global:apps | Where-Object { $_.AppId -eq $Id -and (-not $Version -or "$($_.Version)" -eq "$Version") }) }
function Uninstall-NAVApp { param($ServerInstance, $Name, $Publisher, $Version, $Tenant, [switch]$DoNotSaveData)
  if ($global:fail -eq 'uninstall') { throw 'uninstall boom' }
  $dep = $global:deps[$Name]
  if ($dep -and @($global:apps | Where-Object { $_.Name -eq $dep -and $_.IsInstalled }).Count -gt 0) { throw "$dep depends on $Name" }
  if ($global:fail -ne 'verify-uninstalled') { $global:apps | Where-Object { $_.Name -eq $Name } | ForEach-Object { $_.IsInstalled = $false } } }
function Sync-NAVApp { param($ServerInstance, $Name, $Publisher, $Version, $Mode, [switch]$Force)
  if ($global:fail -eq 'clean') { throw 'clean boom' }
  if ($Mode -ne 'Clean') { throw 'not clean' } }
function Unpublish-NAVApp { param($ServerInstance, $Name, $Publisher, $Version, $Tenant)
  if ($global:fail -eq 'unpublish') { throw 'unpublish boom' }
  if ($global:fail -ne 'verify-gone') { $global:apps = @($global:apps | Where-Object { $_.Name -ne $Name }) } }
`;

async function runRemoval(
  apps: StubApp[],
  ids: string[],
  allow: Record<string, string>,
  fail = "",
  deps: Record<string, string> = {},
): Promise<string> {
  const dir = await Deno.makeTempDir();
  const ps = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$global:fail = ${ps(fail)}`,
    `$global:deps = @{ ${
      Object.entries(deps).map(([k, v]) => `${ps(k)} = ${ps(v)}`).join("; ")
    } }`,
    `$global:apps = @(${
      apps.map((a) =>
        `[pscustomobject]@{ AppId = ${ps(a.AppId)}; Name = ${
          ps(a.Name)
        }; Publisher = ${ps(a.Publisher)}; Version = ${
          ps(a.Version)
        }; IsInstalled = $${a.IsInstalled} }`
      ).join(", ")
    })`,
    STUBS,
    `$sb = [scriptblock]::Create(${ps(buildHarnessRemoveBlock())})`,
    `& $sb @(${ids.map(ps).join(", ")}) @{ ${
      Object.entries(allow).map(([k, v]) => `${ps(k)} = ${ps(v)}`).join("; ")
    } }`,
  ].join("\n");
  await Deno.writeTextFile(join(dir, "t.ps1"), script);
  const out = await new Deno.Command("pwsh", {
    args: ["-NoProfile", "-NonInteractive", "-File", join(dir, "t.ps1")],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return new TextDecoder().decode(out.stdout) +
    new TextDecoder().decode(out.stderr);
}

const CORE: StubApp = {
  AppId: IDS.core,
  Name: "CGR Core",
  Publisher: "CentralGauge",
  Version: "1.0.5.5",
  IsInstalled: true,
};
const RENTAL: StubApp = {
  AppId: IDS.rental,
  Name: "CGR Rental",
  Publisher: "CentralGauge",
  Version: "1.0.0.0",
  IsInstalled: true,
};
const ALLOW = { [IDS.core]: "^CGR Core$", [IDS.rental]: "^CGR Rental$" };

Deno.test({
  name:
    "removal block: every failing step prints SYNC_REMOVE_FAILED <id> <step> and never reports success",
  ignore: !isWindows,
  async fn() {
    for (
      const step of [
        "uninstall",
        "verify-uninstalled",
        "clean",
        "unpublish",
        "verify-gone",
      ]
    ) {
      const out = await runRemoval([CORE], [IDS.core], ALLOW, step);
      assertStringIncludes(out, `SYNC_REMOVE_FAILED:${IDS.core} ${step}`, step);
      assert(
        !out.includes(`SYNC_REMOVE:${IDS.core}`),
        `${step}: no success report`,
      );
    }
  },
});

Deno.test({
  name:
    "removal block: publisher, allowlist and name are checked per app before any mutation",
  ignore: !isWindows,
  async fn() {
    const cases: [StubApp, Record<string, string>][] = [
      [{ ...CORE, Publisher: "Continia" }, ALLOW],
      [{ ...CORE, Name: "Someone Else" }, ALLOW],
      [CORE, { [IDS.rental]: "^CGR Rental$" }],
    ];
    for (const [app, allow] of cases) {
      const out = await runRemoval([app], [IDS.core], allow);
      assertStringIncludes(out, `SYNC_REMOVE_FAILED:${IDS.core} check`);
      assert(!out.includes(`SYNC_REMOVE:${IDS.core}`));
    }
  },
});

Deno.test({
  name:
    "removal block: a dependency listed first is removed after its dependent; clean removal succeeds",
  ignore: !isWindows,
  async fn() {
    const out = await runRemoval(
      [CORE, RENTAL],
      [IDS.core, IDS.rental],
      ALLOW,
      "",
      { "CGR Core": "CGR Rental" },
    );
    assert(!out.includes("SYNC_REMOVE_FAILED"), out);
    assertStringIncludes(out, `SYNC_REMOVE:${IDS.rental} v1.0.0.0`);
    assertStringIncludes(out, `SYNC_REMOVE:${IDS.core} v1.0.5.5`);
  },
});

Deno.test("buildSyncHarnessAppsScript: publish failure messages collapse whitespace, not the letter s", () => {
  assertStringIncludes(
    buildSyncHarnessAppsScript("Cronus281", [], ["C:\\a.app"]),
    "-replace '\\s+', ' '",
  );
});

Deno.test("buildSyncHarnessAppsScript: owned apps to publish are cleaned by name only when not published, before any publish", () => {
  const s = buildSyncHarnessAppsScript(
    "Cronus281",
    [],
    ["C:\a.app"],
    undefined,
    new Map([[IDS.core, "^CGR Core$"]]),
    [
      { id: IDS.core, name: "CGR Core" },
    ],
  );
  const clean = s.indexOf("-Mode Clean", s.indexOf("SYNC_CLEAN"));
  assert(clean > 0 && clean < s.indexOf("Publish-BcContainerApp"));
  assertStringIncludes(s, "'CGR Core'");
  assertStringIncludes(s, "SYNC_CLEAN:");
});

// ---- The clean block (M1-15a), executed in local pwsh against stubbed BC cmdlets ----

interface CleanApp {
  AppId: string;
  Name: string;
  Publisher: string;
  Version: string;
}

const CLEAN_STUBS = `
function Get-NAVAppInfo { param($ServerInstance, $Id, $Name, $Publisher, $Tenant, [switch]$TenantSpecificProperties)
  $src = if ($Tenant) { $global:tenantApps } else { $global:published }
  @($src | Where-Object {
    (-not $Id -or $_.AppId -eq $Id) -and (-not $Name -or $_.Name -eq $Name) -and (-not $Publisher -or $_.Publisher -eq $Publisher)
  }) }
function Sync-NAVApp { param($ServerInstance, $Tenant, $Name, $Publisher, $Version, $Mode, [switch]$Force)
  $global:syncCalls += "$Name|$Mode"
  if ($global:cleanThrows) { throw 'clean boom' } }
`;

async function runClean(
  published: CleanApp[],
  tenantApps: CleanApp[],
  items: { id: string; name: string }[],
  allow: Record<string, string>,
  cleanThrows = false,
): Promise<string> {
  const dir = await Deno.makeTempDir();
  const ps = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const apps = (xs: CleanApp[]) =>
    `@(${
      xs.map((a) =>
        `[pscustomobject]@{ AppId = ${ps(a.AppId)}; Name = ${
          ps(a.Name)
        }; Publisher = ${ps(a.Publisher)}; Version = ${ps(a.Version)} }`
      ).join(", ")
    })`;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$global:published = ${apps(published)}`,
    `$global:tenantApps = ${apps(tenantApps)}`,
    `$global:cleanThrows = $${cleanThrows}`,
    "$global:syncCalls = @()",
    CLEAN_STUBS,
    `$sb = [scriptblock]::Create(${ps(buildHarnessCleanBlock())})`,
    `& $sb @(${
      items.map((i) => `@{ id = ${ps(i.id)}; name = ${ps(i.name)} }`).join(", ")
    }) @{ ${
      Object.entries(allow).map(([k, v]) => `${ps(k)} = ${ps(v)}`).join("; ")
    } }`,
    `Write-Output ("SYNC_CALLS:" + ($global:syncCalls -join ","))`,
  ].join("\n");
  await Deno.writeTextFile(join(dir, "t.ps1"), script);
  const out = await new Deno.Command("pwsh", {
    args: ["-NoProfile", "-NonInteractive", "-File", join(dir, "t.ps1")],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return new TextDecoder().decode(out.stdout) +
    new TextDecoder().decode(out.stderr);
}

const FOREIGN_ID = "00000000-0000-4000-8000-00000000f0f0";
const CLEAN_ALLOW = { [IDS.core]: "^CGR Core$" };
const CORE_ITEM = [{ id: IDS.core, name: "CGR Core" }];

Deno.test({
  name:
    "clean block: an app with the same name and publisher but another id is refused; nothing is cleaned",
  ignore: !isWindows,
  async fn() {
    const foreign = {
      AppId: FOREIGN_ID,
      Name: "CGR Core",
      Publisher: "CentralGauge",
      Version: "9.0.0.0",
    };
    for (const [pub, ten] of [[[], [foreign]], [[foreign], []]] as const) {
      const out = await runClean([...pub], [...ten], CORE_ITEM, CLEAN_ALLOW);
      assertStringIncludes(out, `SYNC_CLEAN_REFUSED:${IDS.core}`);
      assert(!out.includes("|Clean"), "nothing is cleaned");
    }
  },
});

Deno.test({
  name:
    "clean block: skipped while an app with that name and publisher is published; cleans otherwise",
  ignore: !isWindows,
  async fn() {
    const ours = {
      AppId: IDS.core,
      Name: "CGR Core",
      Publisher: "CentralGauge",
      Version: "1.0.5.5",
    };
    const skipped = await runClean([ours], [ours], CORE_ITEM, CLEAN_ALLOW);
    assert(
      !skipped.includes("SYNC_CLEAN:") &&
        !skipped.includes("SYNC_CLEAN_FAILED"),
      skipped,
    );
    assert(!skipped.includes("|Clean"), "no clean while published");
    const cleaned = await runClean([], [], CORE_ITEM, CLEAN_ALLOW);
    assertStringIncludes(cleaned, `SYNC_CLEAN:${IDS.core}`);
    assertStringIncludes(cleaned, "SYNC_CALLS:CGR Core|Clean");
  },
});

Deno.test({
  name:
    "clean block: a clean error is SYNC_CLEAN_FAILED (fatal), never a warning",
  ignore: !isWindows,
  async fn() {
    const out = await runClean([], [], CORE_ITEM, CLEAN_ALLOW, true);
    assertStringIncludes(out, `SYNC_CLEAN_FAILED:${IDS.core}`);
    assert(!out.includes("SYNC_CLEAN_WARN"));
  },
});

Deno.test("buildSyncHarnessAppsScript: a failed or refused clean stops the script before any publish", () => {
  const s = buildSyncHarnessAppsScript(
    "Cronus281",
    [],
    ["C:/a.app"],
    undefined,
    new Map([[IDS.core, "^CGR Core$"]]),
    [
      { id: IDS.core, name: "CGR Core" },
    ],
  );
  const guard = s.indexOf("'SYNC_CLEAN_FAILED:*'");
  assert(
    guard > 0 &&
      s.indexOf("exit 1", guard) < s.indexOf("Publish-BcContainerApp"),
  );
});

Deno.test({
  name:
    "syncHarnessApps: a failed clean is a thrown container failure, not a completed sync",
  ignore: !isWindows,
  async fn() {
    const { provider } = await stubbed(
      `SYNC_CLEAN_FAILED:${IDS.core} clean boom\n`,
    );
    await assertRejects(
      () =>
        provider.syncHarnessApps("Cronus281", {
          removeIds: [],
          publish: [],
          allow: new Map([[IDS.core, "^CGR Core$"]]),
          clean: [{ id: IDS.core, name: "CGR Core" }],
        }),
      ContainerError,
      "incomplete",
    );
  },
});
