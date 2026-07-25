import { assertEquals } from "@std/assert";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";

Deno.test("isHealthy reports false when Docker says the container is not running", async () => {
  // The Cronus284 case: Test-BcContainer passed while Docker reported the
  // container not running, so every task dispatched there failed and the
  // Phase 1 measurement was contaminated.
  const p = new BcContainerProvider();
  Object.defineProperty(p, "inspectForAdoption", {
    value: () =>
      Promise.resolve({
        artifactUrl: "https://x/sandbox/28.3/dk",
        running: false,
      }),
    configurable: true,
  });
  assertEquals(await p.isHealthy("Cronus284"), false);
});

Deno.test("isHealthy falls through to Test-BcContainer when Docker inspection is inconclusive", async () => {
  // inspectForAdoption returns undefined for BOTH "container doesn't exist
  // yet" and "docker CLI failed" (docker-inspect.ts's contract). Neither
  // case should short-circuit to false -- a container that genuinely does
  // not exist yet must still reach the PowerShell probe, which is what
  // actually determines existence/health for that case.
  const p = new BcContainerProvider();
  Object.defineProperty(p, "inspectForAdoption", {
    value: () => Promise.resolve(undefined),
    configurable: true,
  });
  let pwshCalled = false;
  Object.defineProperty(p, "executePowerShell", {
    value: (_script: string) => {
      pwshCalled = true;
      return Promise.resolve({ output: "HEALTHY:True", exitCode: 0 });
    },
    configurable: true,
  });
  assertEquals(await p.isHealthy("Cronus28"), true);
  assertEquals(pwshCalled, true);
});
