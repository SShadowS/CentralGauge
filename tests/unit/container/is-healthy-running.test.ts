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
