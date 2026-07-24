// The startup path is where the unmeasured bench time lives. These spans are
// what turn the spec's ranked hypothesis (cold-spawn tax vs compiler rebuild
// vs per-task variance) into a measurement.
import { assertEquals } from "@std/assert";
import type { ContainerProvider } from "../../../src/container/interface.ts";
import { setupContainers } from "../../../cli/commands/bench/container-setup.ts";
import { ContainerProviderRegistry } from "../../../src/container/registry.ts";
import { closeTracer, initTracer } from "../../../src/tracing/tracer.ts";

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
  }
});
