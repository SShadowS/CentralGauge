// tests/unit/cli/container-setup.test.ts
//
// GH #13 (footnote): the last task's candidate + prereq stayed published at
// bench end — cleanup only ran at next-task prep and bench startup, never at
// end-of-run. endOfRunNuke() sweeps all CentralGauge apps from the bench
// containers when a run completes.
import { assertEquals } from "@std/assert";
import type { ContainerProvider } from "../../../src/container/interface.ts";
import {
  cleanupContainer,
  endOfRunNuke,
  setupContainer,
  setupContainers,
} from "../../../cli/commands/bench/container-setup.ts";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import { ContainerProviderRegistry } from "../../../src/container/registry.ts";

Deno.test("endOfRunNuke calls prenukeCentralGaugeApps with all containers", async () => {
  const calls: string[][] = [];
  const provider = {
    prenukeCentralGaugeApps: (names: string[]) => {
      calls.push(names);
      return Promise.resolve();
    },
  } as unknown as ContainerProvider;

  await endOfRunNuke(provider, ["Cronus28", "Cronus281"]);

  assertEquals(calls, [["Cronus28", "Cronus281"]]);
});

Deno.test("endOfRunNuke no-ops when provider lacks prenukeCentralGaugeApps", async () => {
  // Must not throw (e.g. docker/mock providers).
  await endOfRunNuke({} as unknown as ContainerProvider, ["Cronus28"]);
});

Deno.test("endOfRunNuke is best-effort and swallows provider errors", async () => {
  const provider = {
    prenukeCentralGaugeApps: () => Promise.reject(new Error("container down")),
  } as unknown as ContainerProvider;

  // Must not throw — end-of-run cleanup must never fail the bench.
  await endOfRunNuke(provider, ["Cronus28"]);
});

Deno.test("endOfRunNuke no-ops on an empty container list", async () => {
  let called = false;
  const provider = {
    prenukeCentralGaugeApps: () => {
      called = true;
      return Promise.resolve();
    },
  } as unknown as ContainerProvider;

  await endOfRunNuke(provider, []);

  assertEquals(called, false);
});

// CLI7: cleanupContainer steps must each be individually try/caught
// (best-effort). A container that's already gone or unresponsive must not
// stop the remaining steps from running, and must never throw out of the
// caller's finally block.

Deno.test("cleanupContainer runs stop, remove, and cleanupCompilerFolders when the container was created by the run", async () => {
  const calls: string[] = [];
  const provider = {
    stop: (name: string) => {
      calls.push(`stop:${name}`);
      return Promise.resolve();
    },
    remove: (name: string) => {
      calls.push(`remove:${name}`);
      return Promise.resolve();
    },
    cleanupCompilerFolders: () => {
      calls.push("cleanupCompilerFolders");
      return Promise.resolve();
    },
  } as unknown as ContainerProvider;

  await cleanupContainer(provider, "Cronus28", false);

  assertEquals(calls, [
    "stop:Cronus28",
    "remove:Cronus28",
    "cleanupCompilerFolders",
  ]);
});

Deno.test("cleanupContainer skips stop/remove when the container was pre-existing", async () => {
  const calls: string[] = [];
  const provider = {
    stop: () => {
      calls.push("stop");
      return Promise.resolve();
    },
    remove: () => {
      calls.push("remove");
      return Promise.resolve();
    },
    cleanupCompilerFolders: () => {
      calls.push("cleanupCompilerFolders");
      return Promise.resolve();
    },
  } as unknown as ContainerProvider;

  await cleanupContainer(provider, "Cronus28", true);

  assertEquals(calls, ["cleanupCompilerFolders"]);
});

Deno.test("cleanupContainer continues to remove() even when stop() throws", async () => {
  const calls: string[] = [];
  const provider = {
    stop: () => {
      calls.push("stop");
      return Promise.reject(new Error("container already stopped"));
    },
    remove: (name: string) => {
      calls.push(`remove:${name}`);
      return Promise.resolve();
    },
  } as unknown as ContainerProvider;

  // Must not throw: stop() failing is best-effort.
  await cleanupContainer(provider, "Cronus28", false);

  assertEquals(calls, ["stop", "remove:Cronus28"]);
});

Deno.test("cleanupContainer continues to cleanupCompilerFolders() even when remove() throws", async () => {
  const calls: string[] = [];
  const provider = {
    stop: () => Promise.resolve(),
    remove: () => {
      calls.push("remove");
      return Promise.reject(new Error("container not found"));
    },
    cleanupCompilerFolders: () => {
      calls.push("cleanupCompilerFolders");
      return Promise.resolve();
    },
  } as unknown as ContainerProvider;

  // Must not throw: remove() failing is best-effort and must not skip
  // the disk-space cleanup step.
  await cleanupContainer(provider, "Cronus28", false);

  assertEquals(calls, ["remove", "cleanupCompilerFolders"]);
});

Deno.test("cleanupContainer swallows a throwing cleanupCompilerFolders", async () => {
  const provider = {
    stop: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    cleanupCompilerFolders: () => Promise.reject(new Error("disk busy")),
  } as unknown as ContainerProvider;

  // Must not throw.
  await cleanupContainer(provider, "Cronus28", false);
});

Deno.test("cleanupContainer no-ops cleanupCompilerFolders when the provider lacks it", async () => {
  const provider = {
    stop: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  } as unknown as ContainerProvider;

  // Must not throw (mock/docker-style providers without the method).
  await cleanupContainer(provider, "Cronus28", false);
});

/**
 * Build a fake ContainerProvider that satisfies every capability
 * `setupContainers` probes for via the `"method" in provider` checks.
 */
function makeFakeProvider(): {
  provider: ContainerProvider;
  calls: string[];
} {
  const calls: string[] = [];
  const provider = {
    isHealthy: (_name: string) => {
      calls.push("isHealthy");
      return Promise.resolve(true);
    },
    setCredentials: () => {
      calls.push("setCredentials");
    },
    setCompilerCacheEnabled: () => {
      calls.push("setCompilerCacheEnabled");
    },
    prenukeCentralGaugeApps: (_names: string[]) => {
      calls.push("prenuke");
      return Promise.resolve();
    },
    warmupCompilerFolders: (_names: string[]) => {
      calls.push("warmup");
      return Promise.resolve();
    },
    ensureTestHarness: (_names: string[]) => {
      calls.push("ensureTestHarness");
      return Promise.resolve();
    },
  } as unknown as ContainerProvider;
  return { provider, calls };
}

Deno.test("setupContainers does NOT clear compiler folders by default", async () => {
  const { provider } = makeFakeProvider();
  ContainerProviderRegistry.register("fake-warm", () => provider);

  let clearCalled = false;
  const originalClear = BcContainerProvider.clearCompilerFolders;
  const originalPurge = BcContainerProvider.purgeArtifactCache;
  let purgeCalled = false;
  Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
    value: () => {
      clearCalled = true;
      return Promise.resolve();
    },
    configurable: true,
  });
  Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
    value: () => {
      purgeCalled = true;
      return Promise.resolve();
    },
    configurable: true,
  });

  try {
    await setupContainers(["Cronus28"], "fake-warm", { name: "Cronus28" });
    assertEquals(clearCalled, false);
    // The artifact cache must NEVER be purged from the startup path.
    assertEquals(purgeCalled, false);
  } finally {
    Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
      value: originalClear,
      configurable: true,
    });
    Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
      value: originalPurge,
      configurable: true,
    });
    ContainerProviderRegistry.clearInstances();
  }
});

Deno.test("setupContainers clears compiler folders when noCompilerCache is set", async () => {
  const { provider } = makeFakeProvider();
  ContainerProviderRegistry.register("fake-cold", () => provider);

  let clearCalled = false;
  let purgeCalled = false;
  const originalClear = BcContainerProvider.clearCompilerFolders;
  const originalPurge = BcContainerProvider.purgeArtifactCache;
  Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
    value: () => {
      clearCalled = true;
      return Promise.resolve();
    },
    configurable: true,
  });
  Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
    value: () => {
      purgeCalled = true;
      return Promise.resolve();
    },
    configurable: true,
  });

  try {
    await setupContainers(["Cronus28"], "fake-cold", { name: "Cronus28" }, {
      noCompilerCache: true,
    });
    assertEquals(clearCalled, true);
    // Even the explicit opt-out only clears folders, never the shared cache.
    assertEquals(purgeCalled, false);
  } finally {
    Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
      value: originalClear,
      configurable: true,
    });
    Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
      value: originalPurge,
      configurable: true,
    });
    ContainerProviderRegistry.clearInstances();
  }
});

Deno.test("setupContainer does NOT clear compiler folders by default", async () => {
  const { provider } = makeFakeProvider();
  ContainerProviderRegistry.register("fake-warm-single", () => provider);

  let clearCalled = false;
  let purgeCalled = false;
  const originalClear = BcContainerProvider.clearCompilerFolders;
  const originalPurge = BcContainerProvider.purgeArtifactCache;
  Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
    value: () => {
      clearCalled = true;
      return Promise.resolve();
    },
    configurable: true,
  });
  Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
    value: () => {
      purgeCalled = true;
      return Promise.resolve();
    },
    configurable: true,
  });

  try {
    await setupContainer("fake-warm-single", { name: "Cronus28" });
    assertEquals(clearCalled, false);
    // The artifact cache must NEVER be purged from the startup path.
    assertEquals(purgeCalled, false);
  } finally {
    Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
      value: originalClear,
      configurable: true,
    });
    Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
      value: originalPurge,
      configurable: true,
    });
    ContainerProviderRegistry.clearInstances();
  }
});

Deno.test("setupContainer clears compiler folders when noCompilerCache is set", async () => {
  const { provider } = makeFakeProvider();
  ContainerProviderRegistry.register("fake-cold-single", () => provider);

  let clearCalled = false;
  let purgeCalled = false;
  const originalClear = BcContainerProvider.clearCompilerFolders;
  const originalPurge = BcContainerProvider.purgeArtifactCache;
  Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
    value: () => {
      clearCalled = true;
      return Promise.resolve();
    },
    configurable: true,
  });
  Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
    value: () => {
      purgeCalled = true;
      return Promise.resolve();
    },
    configurable: true,
  });

  try {
    await setupContainer("fake-cold-single", { name: "Cronus28" }, {
      noCompilerCache: true,
    });
    assertEquals(clearCalled, true);
    // Even the explicit opt-out only clears folders, never the shared cache.
    assertEquals(purgeCalled, false);
  } finally {
    Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
      value: originalClear,
      configurable: true,
    });
    Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
      value: originalPurge,
      configurable: true,
    });
    ContainerProviderRegistry.clearInstances();
  }
});
