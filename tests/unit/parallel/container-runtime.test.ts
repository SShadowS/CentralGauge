// tests/unit/parallel/container-runtime.test.ts
//
// ContainerRuntime lifts container setup + health monitor + compile queue +
// optional recovery prober out of the sync executor
// (`cli/commands/bench/parallel-executor.ts`) so batch mode's compile/test
// phase can stand up the same infrastructure without an orchestrator.
//
// Mirrors how `tests/unit/cli/container-setup.test.ts` fakes `setupContainers`
// (a hand-built fake satisfying every `"method" in provider` probe) rather
// than driving the real bccontainerhelper path.
import { assertEquals, assertNotEquals } from "@std/assert";
import type { ContainerProvider } from "../../../src/container/interface.ts";
import { ContainerProviderRegistry } from "../../../src/container/registry.ts";
import { ContainerRuntime } from "../../../src/parallel/container-runtime.ts";
import type { ContainerInspection } from "../../../src/container/docker-inspect.ts";

const TEST_PROVIDER_NAME = "container-runtime-test-mock";

/**
 * A fake `ContainerProvider` satisfying every capability `setupContainers`
 * probes for via `"method" in provider`, plus call-count tracking for
 * `stop()`'s cleanup assertions.
 */
function makeFakeProvider(): { provider: ContainerProvider; calls: string[] } {
  const calls: string[] = [];
  const provider = {
    isHealthy: (_name: string) => {
      calls.push("isHealthy");
      return Promise.resolve(true);
    },
    setCredentials: () => {
      calls.push("setCredentials");
    },
    setReuseCompilerFolders: () => {
      calls.push("setReuseCompilerFolders");
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
    cleanupCompilerFolders: () => {
      calls.push("cleanupCompilerFolders");
      return Promise.resolve();
    },
  } as unknown as ContainerProvider;
  return { provider, calls };
}

function fakeInspect(
  digests: Record<string, string>,
): (name: string) => Promise<ContainerInspection | undefined> {
  return (name: string) =>
    Promise.resolve({
      artifactUrl: `https://example.test/${name}?sig=abc`,
      running: true,
      imageDigest: digests[name],
    });
}

/** Restores the registry's real "mock" factory after a test overrides it. */
function withFakeProvider<T>(
  provider: ContainerProvider,
  fn: () => Promise<T>,
): Promise<T> {
  ContainerProviderRegistry.register(TEST_PROVIDER_NAME, () => provider);
  return fn().finally(() => {
    ContainerProviderRegistry.clearInstances();
  });
}

Deno.test("ContainerRuntime.start returns containerNames matching the input", async () => {
  const { provider } = makeFakeProvider();
  const names = ["Cronus28", "Cronus281"];

  const runtime = await withFakeProvider(
    provider,
    () =>
      ContainerRuntime.start({
        containers: names,
        containerProviderName: TEST_PROVIDER_NAME,
        containerConfig: {},
        queue: { maxQueueSize: 100, timeout: 300_000, compileConcurrency: 3 },
      }),
  );

  try {
    assertEquals(runtime.containerNames, names);
    assertEquals(runtime.provider, provider);
  } finally {
    await runtime.stop();
  }
});

Deno.test("ContainerRuntime.start seeds the monitor with expectedContainerNames", async () => {
  const { provider } = makeFakeProvider();
  const names = ["Cronus28", "Cronus281", "Cronus282"];

  const runtime = await withFakeProvider(
    provider,
    () =>
      ContainerRuntime.start({
        containers: names,
        containerProviderName: TEST_PROVIDER_NAME,
        containerConfig: {},
        queue: { maxQueueSize: 100, timeout: 300_000, compileConcurrency: 3 },
      }),
  );

  try {
    const state = runtime.monitor.getState();
    const seeded = state.containers.map((c) => c.containerName).sort();
    assertEquals(seeded, [...names].sort());
  } finally {
    await runtime.stop();
  }
});

Deno.test("environmentSet returns containers sorted by name", async () => {
  const { provider } = makeFakeProvider();
  const names = ["Cronus282", "Cronus28", "Cronus281"];

  const runtime = await withFakeProvider(
    provider,
    () =>
      ContainerRuntime.start({
        containers: names,
        containerProviderName: TEST_PROVIDER_NAME,
        containerConfig: {},
        queue: { maxQueueSize: 100, timeout: 300_000, compileConcurrency: 3 },
      }),
  );

  try {
    const env = await runtime.environmentSet(
      fakeInspect({
        Cronus28: "sha256:aaa",
        Cronus281: "sha256:bbb",
        Cronus282: "sha256:ccc",
      }),
    );
    assertEquals(
      env.containers.map((c) => c.name),
      ["Cronus28", "Cronus281", "Cronus282"],
    );
    assertEquals(
      env.containers[0]!.bcArtifact,
      "https://example.test/Cronus28",
    );
    assertEquals(env.containers[0]!.imageDigest, "sha256:aaa");
  } finally {
    await runtime.stop();
  }
});

Deno.test("environmentSet reports testRunner from CENTRALGAUGE_SOAP_TEST_RUNNER", async () => {
  const { provider } = makeFakeProvider();
  const names = ["Cronus28"];

  const runtime = await withFakeProvider(
    provider,
    () =>
      ContainerRuntime.start({
        containers: names,
        containerProviderName: TEST_PROVIDER_NAME,
        containerConfig: {},
        queue: { maxQueueSize: 100, timeout: 300_000, compileConcurrency: 3 },
      }),
  );

  try {
    const original = Deno.env.get("CENTRALGAUGE_SOAP_TEST_RUNNER");
    try {
      Deno.env.set("CENTRALGAUGE_SOAP_TEST_RUNNER", "0");
      const legacy = await runtime.environmentSet(fakeInspect({}));
      assertEquals(legacy.testRunner, "legacy");

      Deno.env.set("CENTRALGAUGE_SOAP_TEST_RUNNER", "1");
      const soap = await runtime.environmentSet(fakeInspect({}));
      assertEquals(soap.testRunner, "soap");
    } finally {
      if (original === undefined) {
        Deno.env.delete("CENTRALGAUGE_SOAP_TEST_RUNNER");
      } else {
        Deno.env.set("CENTRALGAUGE_SOAP_TEST_RUNNER", original);
      }
    }
  } finally {
    await runtime.stop();
  }
});

Deno.test("stop() is idempotent and calls the provider's cleanup once", async () => {
  const { provider, calls } = makeFakeProvider();
  const names = ["Cronus28", "Cronus281"];

  const runtime = await withFakeProvider(
    provider,
    () =>
      ContainerRuntime.start({
        containers: names,
        containerProviderName: TEST_PROVIDER_NAME,
        containerConfig: {},
        queue: { maxQueueSize: 100, timeout: 300_000, compileConcurrency: 3 },
      }),
  );

  await runtime.stop();
  await runtime.stop();

  assertEquals(calls.filter((c) => c === "cleanupCompilerFolders").length, 1);
  // Once at setup (`setupContainers`'s own prenuke) and once at stop()'s
  // end-of-run sweep. The second `stop()` call must add no further calls.
  assertEquals(calls.filter((c) => c === "prenuke").length, 2);
});

Deno.test("ContainerRuntime.start does not build a recovery prober when recoveryProbeIntervalMs is unset", async () => {
  const { provider } = makeFakeProvider();
  const names = ["Cronus28"];

  const runtime = await withFakeProvider(
    provider,
    () =>
      ContainerRuntime.start({
        containers: names,
        containerProviderName: TEST_PROVIDER_NAME,
        containerConfig: {},
        queue: { maxQueueSize: 100, timeout: 300_000, compileConcurrency: 3 },
      }),
  );

  // No direct getter for the prober; stop() must still be a clean no-op
  // (nothing to await) rather than throwing on an undefined prober.
  await runtime.stop();
  assertNotEquals(runtime.queue, undefined);
});
