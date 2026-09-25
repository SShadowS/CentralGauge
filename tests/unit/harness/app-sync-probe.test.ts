import { assertEquals, assertStringIncludes } from "@std/assert";
import { stub } from "@std/testing/mock";
import type { ContainerProvider } from "../../../src/container/interface.ts";
import { ContainerProviderRegistry } from "../../../src/container/registry.ts";
import { main } from "../../../scripts/harness/app-sync-probe.ts";

Deno.test("app-sync-probe --list-only: strictly read-only (no setup, prenuke, publish, harness or warmup); the kept apps are listed", async () => {
  const calls: string[] = [];
  const kept = {
    id: "c6a1e000-0000-4000-8000-000000000001",
    name: "CGR Core",
    publisher: "CentralGauge",
    version: "1.0.0.7",
    installed: true,
  };
  const provider = {
    isHealthy: () => Promise.resolve(true),
    prenukeCentralGaugeApps: () => {
      calls.push("prenuke");
      return Promise.resolve();
    },
    syncHarnessApps: () => {
      calls.push("sync");
      return Promise.resolve();
    },
    warmupCompilerFolders: () => {
      calls.push("warmup");
      return Promise.resolve();
    },
    ensureTestHarness: () => {
      calls.push("ensureTestHarness");
      return Promise.resolve();
    },
    publishApp: () => {
      calls.push("publish");
      return Promise.resolve();
    },
    listHarnessApps: () => {
      calls.push("list");
      return Promise.resolve([kept]);
    },
    dispose: () => {
      calls.push("dispose");
      return Promise.resolve();
    },
  } as unknown as ContainerProvider;
  ContainerProviderRegistry.register("fake-probe", () => provider);
  const out = await Deno.realPath(await Deno.makeTempDir());
  const lines: string[] = [];
  const log = stub(console, "log", (...a: unknown[]) => {
    lines.push(a.join(" "));
  });
  let released = false;
  try {
    await main(["Cronus281", out, "--list-only"], {
      provider: "fake-probe",
      allocated: (c) => Promise.resolve(c),
      lock: () => () => {
        released = true;
        return Promise.resolve();
      },
      containerConfig: () => Promise.resolve({}),
    });
  } finally {
    log.restore();
    ContainerProviderRegistry.clearInstances();
  }
  assertEquals(calls, ["list", "dispose"]);
  assertEquals(released, true);
  assertStringIncludes(lines.join("\n"), '"name":"CGR Core"');
});
