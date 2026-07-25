// The startup path is where the unmeasured bench time lives. These spans are
// what turn the spec's ranked hypothesis (cold-spawn tax vs compiler rebuild
// vs per-task variance) into a measurement.
import { assertEquals } from "@std/assert";
import type { ContainerProvider } from "../../../src/container/interface.ts";
import {
  setupContainer,
  setupContainers,
} from "../../../cli/commands/bench/container-setup.ts";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import { ContainerProviderRegistry } from "../../../src/container/registry.ts";
import { closeTracer, initTracer } from "../../../src/tracing/tracer.ts";

/**
 * Both tracing tests below exercise the REAL setupContainer(s) with
 * `noCompilerCache` unset, relying on that gate being false to avoid ever
 * reaching `clearCompilerFolders` / `purgeArtifactCache` — which delete real
 * directories under `C:\ProgramData\BcContainerHelper`. Stub both statics
 * defensively (as the sibling tests in container-setup.test.ts already do)
 * so a future edit that inverts or drops the gate fails an assertion instead
 * of deleting a developer's real CentralGauge-* folders during a test run.
 */
function stubCacheStatics(): { restore: () => void } {
  const originalClear = BcContainerProvider.clearCompilerFolders;
  const originalPurge = BcContainerProvider.purgeArtifactCache;
  Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
    value: () => {
      throw new Error(
        "clearCompilerFolders must not be called in this test (noCompilerCache is unset)",
      );
    },
    configurable: true,
  });
  Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
    value: () => {
      throw new Error(
        "purgeArtifactCache must never be called from the startup path",
      );
    },
    configurable: true,
  });
  return {
    restore: () => {
      Object.defineProperty(BcContainerProvider, "clearCompilerFolders", {
        value: originalClear,
        configurable: true,
      });
      Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
        value: originalPurge,
        configurable: true,
      });
    },
  };
}

Deno.test("setupContainers emits a span for each startup phase", async () => {
  const provider = {
    isHealthy: () => Promise.resolve(true),
    setCredentials: () => {},
    prenukeCentralGaugeApps: () => Promise.resolve(),
    warmupCompilerFolders: () => Promise.resolve(),
    ensureTestHarness: () => Promise.resolve(),
  } as unknown as ContainerProvider;
  ContainerProviderRegistry.register("fake-trace", () => provider);

  const traceFile = await Deno.makeTempFile({ suffix: ".json" });
  const stub = stubCacheStatics();
  try {
    initTracer(traceFile);
    await setupContainers(["Cronus28", "Cronus282"], "fake-trace", {
      name: "Cronus28",
    });
    await closeTracer();

    const trace = JSON.parse(await Deno.readTextFile(traceFile)) as {
      traceEvents: Array<
        { name: string; ph: string; args?: Record<string, unknown> }
      >;
    };
    const spanNames = trace.traceEvents
      .filter((e) => e.ph === "X")
      .map((e) => e.name)
      .sort();

    assertEquals(spanNames, [
      "setup.harness",
      "setup.health",
      "setup.health",
      "setup.prenuke",
      "setup.warmup-compiler",
    ]);

    // Health spans are per-container and must say which one.
    const healthArgs = trace.traceEvents
      .filter((e) => e.ph === "X" && e.name === "setup.health")
      .map((e) => e.args?.["container"])
      .sort();
    assertEquals(healthArgs, ["Cronus28", "Cronus282"]);
  } finally {
    await closeTracer();
    await Deno.remove(traceFile).catch(() => {});
    ContainerProviderRegistry.clearInstances();
    stub.restore();
  }
});

// Task 4 wired spans into setupContainers (plural) only. setupContainer
// (singular, the branch a single-container bench uses when --containers is
// absent — parallel-executor.ts's `else` branch) did the same four phases
// with zero spans, so a single-container bench's trace had a root `bench`
// span and NO setup.* spans at all. This mirrors the plural test above
// against the singular entry point so the two paths cannot drift again.
Deno.test("setupContainer (singular) emits a span for each startup phase on the existing-container path", async () => {
  const provider = {
    isHealthy: () => Promise.resolve(true),
    setCredentials: () => {},
    prenukeCentralGaugeApps: () => Promise.resolve(),
    warmupCompilerFolders: () => Promise.resolve(),
    ensureTestHarness: () => Promise.resolve(),
  } as unknown as ContainerProvider;
  ContainerProviderRegistry.register("fake-trace-single", () => provider);

  const traceFile = await Deno.makeTempFile({ suffix: ".json" });
  const stub = stubCacheStatics();
  try {
    initTracer(traceFile);
    await setupContainer("fake-trace-single", { name: "Cronus28" });
    await closeTracer();

    const trace = JSON.parse(await Deno.readTextFile(traceFile)) as {
      traceEvents: Array<
        { name: string; ph: string; args?: Record<string, unknown> }
      >;
    };
    const spanNames = trace.traceEvents
      .filter((e) => e.ph === "X")
      .map((e) => e.name)
      .sort();

    assertEquals(spanNames, [
      "setup.harness",
      "setup.health",
      "setup.prenuke",
      "setup.warmup-compiler",
    ]);

    const healthArgs = trace.traceEvents
      .filter((e) => e.ph === "X" && e.name === "setup.health")
      .map((e) => e.args?.["container"]);
    assertEquals(healthArgs, ["Cronus28"]);
  } finally {
    await closeTracer();
    await Deno.remove(traceFile).catch(() => {});
    ContainerProviderRegistry.clearInstances();
    stub.restore();
  }
});

// The singular path has a SECOND ensureTestHarness call site (the
// freshly-created-container branch, when isHealthy() returns false and
// containerProvider.setup() runs). Both branches must be covered so the two
// cannot drift.
Deno.test("setupContainer (singular) emits setup.harness on the freshly-created-container path", async () => {
  const provider = {
    isHealthy: () => Promise.resolve(false),
    status: () => Promise.reject(new Error("no such container")),
    setCredentials: () => {},
    setup: () => Promise.resolve(),
    ensureTestHarness: () => Promise.resolve(),
  } as unknown as ContainerProvider;
  ContainerProviderRegistry.register("fake-trace-fresh", () => provider);

  const traceFile = await Deno.makeTempFile({ suffix: ".json" });
  const stub = stubCacheStatics();
  try {
    initTracer(traceFile);
    await setupContainer("fake-trace-fresh", { name: "Cronus28" });
    await closeTracer();

    const trace = JSON.parse(await Deno.readTextFile(traceFile)) as {
      traceEvents: Array<{ name: string; ph: string }>;
    };
    const spanNames = trace.traceEvents
      .filter((e) => e.ph === "X")
      .map((e) => e.name)
      .sort();

    assertEquals(spanNames, ["setup.harness", "setup.health"]);
  } finally {
    await closeTracer();
    await Deno.remove(traceFile).catch(() => {});
    ContainerProviderRegistry.clearInstances();
    stub.restore();
  }
});

// Task 7 fix-round 1: every fake provider above omits lastWarmupStats, so
// they only exercise warmupCompilerFoldersTraced's "no stats" branch. That
// left the actual adopted/rebuilt attachment -- the thing Task 10's
// acceptance gate reads -- completely untested. These two cover the
// true branch on both entry points, mirroring the split above.
Deno.test("setupContainers attaches adopted/rebuilt to the setup.warmup-compiler span", async () => {
  const provider = {
    isHealthy: () => Promise.resolve(true),
    setCredentials: () => {},
    prenukeCentralGaugeApps: () => Promise.resolve(),
    warmupCompilerFolders: () => Promise.resolve(),
    ensureTestHarness: () => Promise.resolve(),
    lastWarmupStats: { adopted: 2, rebuilt: 1 },
  } as unknown as ContainerProvider;
  ContainerProviderRegistry.register("fake-trace-stats", () => provider);

  const traceFile = await Deno.makeTempFile({ suffix: ".json" });
  const stub = stubCacheStatics();
  try {
    initTracer(traceFile);
    await setupContainers(["Cronus28", "Cronus282"], "fake-trace-stats", {
      name: "Cronus28",
    });
    await closeTracer();

    const trace = JSON.parse(await Deno.readTextFile(traceFile)) as {
      traceEvents: Array<
        { name: string; ph: string; args?: Record<string, unknown> }
      >;
    };
    const warmupSpan = trace.traceEvents.find((e) =>
      e.ph === "X" && e.name === "setup.warmup-compiler"
    );
    assertEquals(warmupSpan?.args?.["adopted"], 2);
    assertEquals(warmupSpan?.args?.["rebuilt"], 1);
    assertEquals(warmupSpan?.args?.["ok"], true);
  } finally {
    await closeTracer();
    await Deno.remove(traceFile).catch(() => {});
    ContainerProviderRegistry.clearInstances();
    stub.restore();
  }
});

Deno.test("setupContainer (singular) attaches adopted/rebuilt to the setup.warmup-compiler span", async () => {
  const provider = {
    isHealthy: () => Promise.resolve(true),
    setCredentials: () => {},
    prenukeCentralGaugeApps: () => Promise.resolve(),
    warmupCompilerFolders: () => Promise.resolve(),
    ensureTestHarness: () => Promise.resolve(),
    lastWarmupStats: { adopted: 1, rebuilt: 1 },
  } as unknown as ContainerProvider;
  ContainerProviderRegistry.register(
    "fake-trace-stats-single",
    () => provider,
  );

  const traceFile = await Deno.makeTempFile({ suffix: ".json" });
  const stub = stubCacheStatics();
  try {
    initTracer(traceFile);
    await setupContainer("fake-trace-stats-single", { name: "Cronus28" });
    await closeTracer();

    const trace = JSON.parse(await Deno.readTextFile(traceFile)) as {
      traceEvents: Array<
        { name: string; ph: string; args?: Record<string, unknown> }
      >;
    };
    const warmupSpan = trace.traceEvents.find((e) =>
      e.ph === "X" && e.name === "setup.warmup-compiler"
    );
    assertEquals(warmupSpan?.args?.["adopted"], 1);
    assertEquals(warmupSpan?.args?.["rebuilt"], 1);
    assertEquals(warmupSpan?.args?.["ok"], true);
  } finally {
    await closeTracer();
    await Deno.remove(traceFile).catch(() => {});
    ContainerProviderRegistry.clearInstances();
    stub.restore();
  }
});
