/**
 * `setCompilerCacheEnabled` must be called unconditionally (never only when
 * `noCompilerCache` is set), mirroring `setReuseCompilerFolders`'s pattern in
 * `reuse-compiler-folders.test.ts`. `ContainerProviderRegistry` caches
 * provider instances as singletons (registry-pattern.md), so a leaked
 * `false` from an earlier setup call in the same process would otherwise
 * survive into a run that never asked to disable the cache — and since
 * `adoptableFolderPath()` also gates on `_compilerCacheEnabled`, a leaked
 * `false` silently disables compiler-folder adoption too, not just the
 * cache parameter it used to only skip (final-review Minor 6).
 */

import { assertEquals } from "@std/assert";
import type { ContainerProvider } from "../../../src/container/interface.ts";
import {
  setupContainer,
  setupContainers,
} from "../../../cli/commands/bench/container-setup.ts";
import { ContainerProviderRegistry } from "../../../src/container/registry.ts";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";

function makeProvider(calls: boolean[]) {
  return {
    isHealthy: () => Promise.resolve(true),
    setCredentials: () => {},
    setCompilerCacheEnabled: (enabled: boolean) => calls.push(enabled),
    setReuseCompilerFolders: () => {},
    prenukeCentralGaugeApps: () => Promise.resolve(),
    warmupCompilerFolders: () => Promise.resolve(),
    ensureTestHarness: () => Promise.resolve(),
  } as unknown as ContainerProvider;
}

/**
 * `{ noCompilerCache: true }` also makes `setupContainer(s)` call the real
 * static `BcContainerProvider.clearCompilerFolders`, which touches
 * `C:\ProgramData\BcContainerHelper`. SAFETY forbids that — stub it (and
 * `purgeArtifactCache`, never legitimately called from this path) for the
 * duration of a test, same pattern as `container-setup.test.ts`.
 */
function stubStaticCleanup(): () => void {
  const originalClear = BcContainerProvider.clearCompilerFolders;
  const originalPurge = BcContainerProvider.purgeArtifactCache;
  Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
    value: () => Promise.resolve(),
    configurable: true,
  });
  Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
    value: () => Promise.resolve(),
    configurable: true,
  });
  return () => {
    Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
      value: originalClear,
      configurable: true,
    });
    Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
      value: originalPurge,
      configurable: true,
    });
  };
}

Deno.test("setupContainers leaves compiler cache ON by default", async () => {
  const calls: boolean[] = [];
  ContainerProviderRegistry.register(
    "fake-cache-on",
    () => makeProvider(calls),
  );
  try {
    await setupContainers(["Cronus28"], "fake-cache-on", { name: "Cronus28" });
    assertEquals(calls, [true]);
  } finally {
    ContainerProviderRegistry.clearInstances();
  }
});

Deno.test("setupContainers disables compiler cache when asked", async () => {
  const calls: boolean[] = [];
  ContainerProviderRegistry.register(
    "fake-cache-off",
    () => makeProvider(calls),
  );
  const restoreCleanup = stubStaticCleanup();
  try {
    await setupContainers(
      ["Cronus28"],
      "fake-cache-off",
      { name: "Cronus28" },
      { noCompilerCache: true },
    );
    assertEquals(calls, [false]);
  } finally {
    restoreCleanup();
    ContainerProviderRegistry.clearInstances();
  }
});

// Singular path (setupContainer) must apply the same setting — mirrors the
// plural/singular regression pair in reuse-compiler-folders.test.ts.
Deno.test("setupContainer leaves compiler cache ON by default", async () => {
  const calls: boolean[] = [];
  ContainerProviderRegistry.register(
    "fake-cache-on-single",
    () => makeProvider(calls),
  );
  try {
    await setupContainer("fake-cache-on-single", { name: "Cronus28" });
    assertEquals(calls, [true]);
  } finally {
    ContainerProviderRegistry.clearInstances();
  }
});

Deno.test("setupContainer disables compiler cache when asked", async () => {
  const calls: boolean[] = [];
  ContainerProviderRegistry.register(
    "fake-cache-off-single",
    () => makeProvider(calls),
  );
  const restoreCleanup = stubStaticCleanup();
  try {
    await setupContainer("fake-cache-off-single", { name: "Cronus28" }, {
      noCompilerCache: true,
    });
    assertEquals(calls, [false]);
  } finally {
    restoreCleanup();
    ContainerProviderRegistry.clearInstances();
  }
});
