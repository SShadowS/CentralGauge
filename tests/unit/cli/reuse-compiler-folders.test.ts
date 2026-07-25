import { assertEquals } from "@std/assert";
import type { ContainerProvider } from "../../../src/container/interface.ts";
import {
  setupContainer,
  setupContainers,
} from "../../../cli/commands/bench/container-setup.ts";
import { ContainerProviderRegistry } from "../../../src/container/registry.ts";

function makeProvider(calls: boolean[]) {
  return {
    isHealthy: () => Promise.resolve(true),
    setCredentials: () => {},
    setCompilerCacheEnabled: () => {},
    setReuseCompilerFolders: (enabled: boolean) => calls.push(enabled),
    prenukeCentralGaugeApps: () => Promise.resolve(),
    warmupCompilerFolders: () => Promise.resolve(),
    ensureTestHarness: () => Promise.resolve(),
  } as unknown as ContainerProvider;
}

Deno.test("setupContainers leaves folder reuse ON by default", async () => {
  const calls: boolean[] = [];
  ContainerProviderRegistry.register(
    "fake-reuse-on",
    () => makeProvider(calls),
  );
  try {
    await setupContainers(["Cronus28"], "fake-reuse-on", { name: "Cronus28" });
    // Either never disabled, or explicitly enabled — never disabled.
    assertEquals(calls.includes(false), false);
  } finally {
    ContainerProviderRegistry.clearInstances();
  }
});

Deno.test("setupContainers disables folder reuse when asked", async () => {
  const calls: boolean[] = [];
  ContainerProviderRegistry.register(
    "fake-reuse-off",
    () => makeProvider(calls),
  );
  try {
    await setupContainers(
      ["Cronus28"],
      "fake-reuse-off",
      { name: "Cronus28" },
      {
        noReuseCompilerFolders: true,
      },
    );
    assertEquals(calls.includes(false), true);
  } finally {
    ContainerProviderRegistry.clearInstances();
  }
});

// Singular path (setupContainer) must apply the same setting — Phase 1
// shipped a bug where only the plural path was gated, so this pair guards
// against that regression recurring.
Deno.test("setupContainer leaves folder reuse ON by default", async () => {
  const calls: boolean[] = [];
  ContainerProviderRegistry.register(
    "fake-reuse-on-single",
    () => makeProvider(calls),
  );
  try {
    await setupContainer("fake-reuse-on-single", { name: "Cronus28" });
    // Either never disabled, or explicitly enabled — never disabled.
    assertEquals(calls.includes(false), false);
  } finally {
    ContainerProviderRegistry.clearInstances();
  }
});

Deno.test("setupContainer disables folder reuse when asked", async () => {
  const calls: boolean[] = [];
  ContainerProviderRegistry.register(
    "fake-reuse-off-single",
    () => makeProvider(calls),
  );
  try {
    await setupContainer("fake-reuse-off-single", { name: "Cronus28" }, {
      noReuseCompilerFolders: true,
    });
    assertEquals(calls.includes(false), true);
  } finally {
    ContainerProviderRegistry.clearInstances();
  }
});
