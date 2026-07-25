// The artifact cache purge is the operator escape hatch for a cache left
// incomplete by a run killed mid-population. BCH only repopulates when
// `symbols/` is absent, so a partial cache is otherwise sticky forever.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import { runPurgeCompilerCache } from "../../../cli/commands/doctor-command.ts";

Deno.test("runPurgeCompilerCache delegates to purgeArtifactCache", async () => {
  let called = false;
  const original = BcContainerProvider.purgeArtifactCache;
  Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
    value: () => {
      called = true;
      return Promise.resolve({ removed: 1, skipped: [] });
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

// Task 6b changed purgeArtifactCache from "remove one fixed path" to
// "enumerate the root and remove N matches", which created a removed === 0
// outcome the original [OK]-on-any-non-throw reporting couldn't see. A
// junctioned cache directory (Deno.readDir reports isDirectory: false,
// isSymlink: true for a Windows junction) hits this exact path: enumeration
// succeeds, nothing gets removed, and the old code printed a bare [OK] even
// though the cache was never actually cleared.

Deno.test("runPurgeCompilerCache warns (not [OK]) when nothing was removed and nothing was skipped", async () => {
  const original = BcContainerProvider.purgeArtifactCache;
  const logs: string[] = [];
  const originalLog = console.log;
  Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
    value: () => Promise.resolve({ removed: 0, skipped: [] }),
    configurable: true,
  });
  console.log = (msg: string) => {
    logs.push(msg);
  };

  try {
    await runPurgeCompilerCache();
    const joined = logs.join("\n");
    assert(joined.includes("WARN"));
    assert(joined.includes("nothing to purge"));
    assert(!joined.includes("[OK]"));
  } finally {
    console.log = originalLog;
    Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
      value: original,
      configurable: true,
    });
  }
});

Deno.test("runPurgeCompilerCache reports skipped junction/symlink entries and does not claim a clean [OK]", async () => {
  const original = BcContainerProvider.purgeArtifactCache;
  const logs: string[] = [];
  const originalLog = console.log;
  Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
    value: () =>
      Promise.resolve({
        removed: 0,
        skipped: ["compiler-cache-a1b2c3d4e5f6"],
      }),
    configurable: true,
  });
  console.log = (msg: string) => {
    logs.push(msg);
  };

  try {
    await runPurgeCompilerCache();
    const joined = logs.join("\n");
    assert(joined.includes("WARN"));
    assert(joined.includes("compiler-cache-a1b2c3d4e5f6"));
    assert(joined.includes("INCOMPLETE"));
    assert(!joined.includes("[OK]"));
  } finally {
    console.log = originalLog;
    Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
      value: original,
      configurable: true,
    });
  }
});

Deno.test("runPurgeCompilerCache reports [OK] with the real removed count on a normal purge", async () => {
  const original = BcContainerProvider.purgeArtifactCache;
  const logs: string[] = [];
  const originalLog = console.log;
  Object.defineProperty(BcContainerProvider, "purgeArtifactCache", {
    value: () => Promise.resolve({ removed: 3, skipped: [] }),
    configurable: true,
  });
  console.log = (msg: string) => {
    logs.push(msg);
  };

  try {
    await runPurgeCompilerCache();
    const joined = logs.join("\n");
    assert(joined.includes("[OK]"));
    assert(joined.includes("3"));
    assert(!joined.includes("WARN"));
  } finally {
    console.log = originalLog;
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
