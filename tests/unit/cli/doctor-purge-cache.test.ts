// The artifact cache purge is the operator escape hatch for a cache left
// incomplete by a run killed mid-population. BCH only repopulates when
// `symbols/` is absent, so a partial cache is otherwise sticky forever.
import { assertEquals, assertRejects } from "@std/assert";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import { runPurgeCompilerCache } from "../../../cli/commands/doctor-command.ts";

Deno.test("runPurgeCompilerCache delegates to purgeArtifactCache", async () => {
  let called = false;
  const original = BcContainerProvider.purgeArtifactCache;
  Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
    value: () => {
      called = true;
      return Promise.resolve();
    },
    configurable: true,
  });

  try {
    await runPurgeCompilerCache();
    assertEquals(called, true);
  } finally {
    Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
      value: original,
      configurable: true,
    });
  }
});

Deno.test("runPurgeCompilerCache rejects when purgeArtifactCache rejects", async () => {
  const original = BcContainerProvider.purgeArtifactCache;
  const testError = new Error("Test purge failure");
  Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
    value: () => Promise.reject(testError),
    configurable: true,
  });

  try {
    await assertRejects(
      () => runPurgeCompilerCache(),
      Error,
      "Test purge failure",
    );
  } finally {
    Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
      value: original,
      configurable: true,
    });
  }
});
