/**
 * Unit tests for `BcContainerProvider.ensureTestHarness`.
 *
 * Covers the split between the concurrent, warm-slot presence probe and the
 * serial, cold-`executePowerShell` publish path (perf follow-up: setup.harness
 * measured 26.2-26.6s across three containers -- three serial cold-pwsh
 * presence probes, ~8.8s each, for a read-only "is it installed?" check).
 */

import { assert, assertEquals } from "@std/assert";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";

const isWindows = Deno.build.os === "windows";

/** Small deferred helper so a mocked probe can be resolved on demand. */
function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

Deno.test({
  name:
    "ensureTestHarness: presence probe routes through runScriptThroughSession, not executePowerShell",
  ignore: !isWindows,
  async fn() {
    const provider = new BcContainerProvider();
    const sessionCalls: Array<{ name: string; label: string | undefined }> = [];
    let coldCalls = 0;

    // deno-lint-ignore no-explicit-any
    (provider as any).runScriptThroughSession = (
      name: string,
      _script: string,
      label?: string,
    ) => {
      sessionCalls.push({ name, label });
      return Promise.resolve({ output: "HARNESS_PRESENT", exitCode: 0 });
    };
    // deno-lint-ignore no-explicit-any
    (provider as any).executePowerShell = () => {
      coldCalls++;
      return Promise.resolve({ output: "", exitCode: 0 });
    };

    await provider.ensureTestHarness(["Cronus28"]);

    assertEquals(
      sessionCalls.length,
      1,
      "probe must go through the warm session slot",
    );
    assertEquals(sessionCalls[0]!.name, "Cronus28");
    assertEquals(
      sessionCalls[0]!.label,
      "harness-probe",
      "probe must pass a scriptLabel so ContainerError classification works",
    );
    assertEquals(
      coldCalls,
      0,
      "the cold executePowerShell path must not be used for the probe",
    );
  },
});

Deno.test({
  name: "ensureTestHarness: probes all containers concurrently, not serially",
  ignore: !isWindows,
  async fn() {
    const provider = new BcContainerProvider();
    const containers = ["Cronus28", "Cronus281", "Cronus282"];
    const deferreds = new Map<
      string,
      ReturnType<typeof createDeferred<{ output: string; exitCode: number }>>
    >();
    for (const name of containers) {
      deferreds.set(name, createDeferred());
    }
    const started: string[] = [];

    // deno-lint-ignore no-explicit-any
    (provider as any).runScriptThroughSession = (name: string) => {
      started.push(name);
      return deferreds.get(name)!.promise;
    };

    const donePromise = provider.ensureTestHarness(containers);

    // An async function runs synchronously up to its first `await`. If the
    // probe loop is a serial `for` loop awaiting each call, only the FIRST
    // container's probe would have started by now. If it is
    // `containerNames.map(...)` (concurrent dispatch), all three synchronous
    // invocations happen before the first `await Promise.allSettled(...)`.
    assertEquals(
      started.length,
      3,
      "all N probes must have started before any of them resolves",
    );
    assertEquals(new Set(started), new Set(containers));

    // Let the run finish cleanly.
    for (const name of containers) {
      deferreds.get(name)!.resolve({ output: "HARNESS_PRESENT", exitCode: 0 });
    }
    await donePromise;
  },
});

Deno.test({
  name:
    "ensureTestHarness: HARNESS_PRESENT does no further work (no compile, no publish)",
  ignore: !isWindows,
  async fn() {
    const provider = new BcContainerProvider();
    let compilerFolderCalls = 0;
    let coldCalls = 0;

    // deno-lint-ignore no-explicit-any
    (provider as any).runScriptThroughSession = () =>
      Promise.resolve({ output: "HARNESS_PRESENT", exitCode: 0 });
    // deno-lint-ignore no-explicit-any
    (provider as any).getOrCreateCompilerFolder = () => {
      compilerFolderCalls++;
      return Promise.resolve("C:\\fake-compiler-folder");
    };
    // deno-lint-ignore no-explicit-any
    (provider as any).executePowerShell = () => {
      coldCalls++;
      return Promise.resolve({
        output: "HARNESS_PUBLISHED:fake.app",
        exitCode: 0,
      });
    };

    await provider.ensureTestHarness(["Cronus28", "Cronus281"]);

    assertEquals(
      compilerFolderCalls,
      0,
      "an already-present harness must not trigger a compile",
    );
    assertEquals(
      coldCalls,
      0,
      "an already-present harness must not trigger a publish",
    );
  },
});

Deno.test({
  name:
    "ensureTestHarness: a probe that throws for one container does not block the others and does not reject",
  ignore: !isWindows,
  async fn() {
    const provider = new BcContainerProvider();
    const probed: string[] = [];
    const publishAttempted: string[] = [];

    // deno-lint-ignore no-explicit-any
    (provider as any).runScriptThroughSession = (name: string) => {
      probed.push(name);
      if (name === "Cronus281") {
        return Promise.reject(new Error("simulated session-slot failure"));
      }
      return Promise.resolve({ output: "HARNESS_PRESENT", exitCode: 0 });
    };
    // deno-lint-ignore no-explicit-any
    (provider as any).getOrCreateCompilerFolder = (name: string) => {
      publishAttempted.push(name);
      // Fail fast; the per-container try/catch around the publish phase
      // must swallow this non-fatally too.
      return Promise.reject(new Error("simulated compiler-folder failure"));
    };

    // Must not throw.
    await provider.ensureTestHarness(["Cronus28", "Cronus281", "Cronus282"]);

    assertEquals(
      new Set(probed),
      new Set(["Cronus28", "Cronus281", "Cronus282"]),
      "all containers must be probed even though one probe threw",
    );
    assertEquals(
      publishAttempted,
      ["Cronus281"],
      "only the container whose probe failed should fall through to publish",
    );
  },
});

Deno.test({
  name: "ensureTestHarness: on non-Windows, short-circuits with no work at all",
  ignore: isWindows,
  async fn() {
    const provider = new BcContainerProvider();
    let sessionCalls = 0;
    let coldCalls = 0;

    // deno-lint-ignore no-explicit-any
    (provider as any).runScriptThroughSession = () => {
      sessionCalls++;
      return Promise.resolve({ output: "HARNESS_PRESENT", exitCode: 0 });
    };
    // deno-lint-ignore no-explicit-any
    (provider as any).executePowerShell = () => {
      coldCalls++;
      return Promise.resolve({ output: "", exitCode: 0 });
    };

    await provider.ensureTestHarness(["Cronus28", "Cronus281"]);

    assertEquals(sessionCalls, 0);
    assertEquals(coldCalls, 0);
    assert(true);
  },
});
