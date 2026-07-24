// The artifact cache purge is the operator escape hatch for a cache left
// incomplete by a run killed mid-population. BCH only repopulates when
// `symbols/` is absent, so a partial cache is otherwise sticky forever.
import { assertEquals } from "@std/assert";
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
