import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import { buildSyncHarnessAppsScript } from "../../../src/container/bc-script-builders.ts";
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
  const guard = s.indexOf("SYNC_REMOVE_INCOMPLETE:");
  const stop = s.indexOf("exit 1", guard);
  assert(
    guard > 0 && stop > guard && stop < s.indexOf("Publish-BcContainerApp"),
  );
});

Deno.test("parseHarnessAppList: a malformed CG_APP line is a failed listing, not a SyntaxError", () => {
  assertEquals(parseHarnessAppList(`CG_APP:{not json\nCG_APPS_DONE\n`), null);
});
