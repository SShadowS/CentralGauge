/**
 * Unit tests for compiler-folder adoption in BcContainerProvider.
 *
 * SAFETY: nothing here may touch C:\ProgramData\BcContainerHelper — the real
 * compiler folders and artifact caches live there, and preserving them is the
 * entire point of adoption. Every test that needs a folder on disk stubs
 * `adoptableFolderPath` onto a `Deno.makeTempDir()` path; every test that
 * would otherwise shell out stubs `dockerInspectSeam`.
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import type { ContainerInspection } from "../../../src/container/docker-inspect.ts";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import { BCCH_PINNED_VERSION } from "../../../src/container/bcch-config.ts";
import { compilerCacheKey } from "../../../src/container/compiler-cache-key.ts";
import {
  LAYOUT_VERSION,
  MARKER_FILENAME,
  writeMarker,
} from "../../../src/container/compiler-folder-marker.ts";

const ARTIFACT_URL =
  "https://bcartifacts.blob.core.windows.net/sandbox/28.0.1.2/w";

/** Shape of the private surface the tests drive. Cast, never exported. */
interface AdoptionInternals {
  dockerInspectSeam(name: string): Promise<ContainerInspection | undefined>;
  adoptableFolderPath(name: string): string | undefined;
  tryAdoptCompilerFolder(name: string): Promise<string | undefined>;
  pruneCompilerOutput(folder: string, keep?: number): Promise<void>;
  rebuildCompilerFolder(name: string): Promise<string>;
  executePowerShell(
    script: string,
  ): Promise<{ output: string; exitCode: number }>;
}

function internals(p: BcContainerProvider): AdoptionInternals {
  return p as unknown as AdoptionInternals;
}

/**
 * Shadow a prototype method with an own property. Restoring means deleting
 * that own property — assigning the "original" back would install `undefined`
 * as an own property, since the real method lives on the prototype.
 */
function stub(
  p: BcContainerProvider,
  name: keyof AdoptionInternals,
  value: unknown,
): () => void {
  Object.defineProperty(p, name, { value, configurable: true });
  return () => {
    delete (p as unknown as Record<string, unknown>)[name];
  };
}

/** Build a folder that `validateFolder` accepts, in a temp dir. */
async function seedValidFolder(artifactUrl = ARTIFACT_URL): Promise<string> {
  const folder = await Deno.makeTempDir({ prefix: "cg-adopt-" });
  await Deno.mkdir(`${folder}/compiler/extension/bin`, { recursive: true });
  await Deno.writeTextFile(`${folder}/compiler/extension/bin/alc.exe`, "x");
  await Deno.mkdir(`${folder}/symbols`, { recursive: true });
  await Deno.mkdir(`${folder}/dlls/Test Assemblies`, { recursive: true });
  await Deno.mkdir(`${folder}/dlls/Service`, { recursive: true });
  await Deno.mkdir(`${folder}/dlls/Mock Assemblies`, { recursive: true });
  await Deno.mkdir(`${folder}/dlls/OpenXML`, { recursive: true });
  await Deno.writeTextFile(`${folder}/symbols/cache_AppInfo.json`, "{}");
  await Deno.writeTextFile(`${folder}/symbols/Microsoft_Base.app`, "app");
  await Deno.writeTextFile(`${folder}/manifest.json`, "{}");
  await writeMarker(folder, {
    layoutVersion: LAYOUT_VERSION,
    artifactUrl,
    cacheKey: "0123456789ab",
    bchVersion: BCCH_PINNED_VERSION,
    containerName: "Cronus282",
    createdAt: new Date().toISOString(),
  });
  return folder;
}

/** `count` output subfolders, oldest first by mtime (`out-0` is oldest). */
async function seedOutput(folder: string, count: number): Promise<void> {
  const base = Date.UTC(2026, 0, 1) / 1000;
  for (let i = 0; i < count; i++) {
    const dir = `${folder}/output/out-${i}`;
    await Deno.mkdir(dir, { recursive: true });
    const when = new Date((base + i * 60) * 1000);
    await Deno.utime(dir, when, when);
  }
}

async function listDir(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) names.push(e.name);
  return names.sort();
}

Deno.test("setReuseCompilerFolders toggles adoption", () => {
  const p = new BcContainerProvider();
  // Default is on — adoption is opt-out, not opt-in.
  assertEquals(p.isReuseCompilerFoldersEnabled(), true);
  p.setReuseCompilerFolders(false);
  assertEquals(p.isReuseCompilerFoldersEnabled(), false);
  p.setReuseCompilerFolders(true);
  assertEquals(p.isReuseCompilerFoldersEnabled(), true);
});

Deno.test("warmup stats start at zero and count outcomes", () => {
  const p = new BcContainerProvider();
  assertEquals(p.lastWarmupStats, { adopted: 0, rebuilt: 0 });
});

Deno.test("adoption is skipped entirely when disabled", async () => {
  // With reuse off, tryAdoptCompilerFolder must not even inspect the container.
  const p = new BcContainerProvider();
  p.setReuseCompilerFolders(false);
  let inspected = false;
  const restore = stub(p, "dockerInspectSeam", () => {
    inspected = true;
    return Promise.resolve(undefined);
  });
  try {
    const adopted = await internals(p).tryAdoptCompilerFolder("Cronus282");
    assertEquals(adopted, undefined);
    assertEquals(inspected, false);
  } finally {
    restore();
  }
});

Deno.test("adoption is skipped when the compiler cache is disabled", async () => {
  // --no-compiler-cache drops -containerName, so BCH rebuilds into a fresh
  // GUID folder and there is no stable path to adopt. Adopting the folder a
  // cached run left behind would also defeat that flag's clean-baseline point.
  const p = new BcContainerProvider();
  p.setCompilerCacheEnabled(false);
  let inspected = false;
  const restore = stub(p, "dockerInspectSeam", () => {
    inspected = true;
    return Promise.resolve(undefined);
  });
  try {
    assertEquals(internals(p).adoptableFolderPath("Cronus282"), undefined);
    assertEquals(
      await internals(p).tryAdoptCompilerFolder("Cronus282"),
      undefined,
    );
    assertEquals(inspected, false);
  } finally {
    restore();
  }
});

Deno.test("adoptableFolderPath is the folder BCH names from -containerName", () => {
  const p = new BcContainerProvider();
  assertEquals(
    internals(p).adoptableFolderPath("Cronus282"),
    `${BcContainerProvider.COMPILER_FOLDER_DIR}\\CentralGauge-Cronus282`,
  );
});

Deno.test("adoption bails when docker inspect yields no artifact URL", async (t) => {
  await t.step("inspect failed outright", async () => {
    const p = new BcContainerProvider();
    const restore = stub(
      p,
      "dockerInspectSeam",
      () => Promise.resolve(undefined),
    );
    // A folder that WOULD validate — proves the bail is on the inspection,
    // not on the folder.
    const folder = await seedValidFolder();
    const restorePath = stub(p, "adoptableFolderPath", () => folder);
    try {
      assertEquals(
        await internals(p).tryAdoptCompilerFolder("Cronus282"),
        undefined,
      );
    } finally {
      restorePath();
      restore();
      await Deno.remove(folder, { recursive: true });
    }
  });

  await t.step("container has no artifactUrl env entry", async () => {
    const p = new BcContainerProvider();
    const restore = stub(
      p,
      "dockerInspectSeam",
      () => Promise.resolve({ artifactUrl: undefined, running: true }),
    );
    try {
      assertEquals(
        await internals(p).tryAdoptCompilerFolder("Cronus282"),
        undefined,
      );
    } finally {
      restore();
    }
  });

  await t.step("artifactUrl env entry is present but empty", async () => {
    const p = new BcContainerProvider();
    const restore = stub(
      p,
      "dockerInspectSeam",
      () => Promise.resolve({ artifactUrl: "", running: true }),
    );
    try {
      assertEquals(
        await internals(p).tryAdoptCompilerFolder("Cronus282"),
        undefined,
      );
    } finally {
      restore();
    }
  });
});

Deno.test("adoption bails, without throwing, when the folder does not validate", async (t) => {
  const p = new BcContainerProvider();
  const restoreInspect = stub(
    p,
    "dockerInspectSeam",
    () => Promise.resolve({ artifactUrl: ARTIFACT_URL, running: true }),
  );

  await t.step("folder does not exist at all", async () => {
    const parent = await Deno.makeTempDir({ prefix: "cg-adopt-" });
    const restorePath = stub(p, "adoptableFolderPath", () => `${parent}/nope`);
    try {
      assertEquals(
        await internals(p).tryAdoptCompilerFolder("Cronus282"),
        undefined,
      );
    } finally {
      restorePath();
      await Deno.remove(parent, { recursive: true });
    }
  });

  await t.step("marker records a different artifact URL", async () => {
    const folder = await seedValidFolder("https://example.invalid/other/28/w");
    const restorePath = stub(p, "adoptableFolderPath", () => folder);
    try {
      assertEquals(
        await internals(p).tryAdoptCompilerFolder("Cronus282"),
        undefined,
      );
    } finally {
      restorePath();
      await Deno.remove(folder, { recursive: true });
    }
  });

  await t.step("folder is missing an expected entry", async () => {
    const folder = await seedValidFolder();
    await Deno.remove(`${folder}/manifest.json`);
    const restorePath = stub(p, "adoptableFolderPath", () => folder);
    try {
      assertEquals(
        await internals(p).tryAdoptCompilerFolder("Cronus282"),
        undefined,
      );
    } finally {
      restorePath();
      await Deno.remove(folder, { recursive: true });
    }
  });

  restoreInspect();
});

Deno.test("adopts a matching folder and prunes its stale output", async () => {
  const p = new BcContainerProvider();
  const folder = await seedValidFolder();
  await seedOutput(folder, 12);
  const restoreInspect = stub(
    p,
    "dockerInspectSeam",
    // A SAS query string must not defeat the match — validateFolder compares
    // the raw URL, so the marker carries the raw URL too.
    () => Promise.resolve({ artifactUrl: ARTIFACT_URL, running: true }),
  );
  const restorePath = stub(p, "adoptableFolderPath", () => folder);
  try {
    assertEquals(
      await internals(p).tryAdoptCompilerFolder("Cronus282"),
      folder,
    );
    const remaining = await listDir(`${folder}/output`);
    assertEquals(remaining.length, 10);
    // The two oldest went; the newest stayed.
    assert(!remaining.includes("out-0"));
    assert(!remaining.includes("out-1"));
    assert(remaining.includes("out-11"));
  } finally {
    restorePath();
    restoreInspect();
    await Deno.remove(folder, { recursive: true });
  }
});

/**
 * Drive `rebuildCompilerFolder` with the pwsh call stubbed out, returning the
 * script it would have run plus the folder it built into (a temp dir, so the
 * marker write is safe).
 */
async function captureRebuild(
  p: BcContainerProvider,
  inspection: ContainerInspection | undefined,
): Promise<{ script: string; folder: string }> {
  const folder = await Deno.makeTempDir({ prefix: "cg-rebuild-" });
  let script = "";
  const restoreInspect = stub(
    p,
    "dockerInspectSeam",
    () => Promise.resolve(inspection),
  );
  const restoreExec = stub(p, "executePowerShell", (s: string) => {
    script = s;
    return Promise.resolve({
      output: `COMPILER_FOLDER:${folder}`,
      exitCode: 0,
    });
  });
  try {
    await internals(p).rebuildCompilerFolder("Cronus282");
  } finally {
    restoreExec();
    restoreInspect();
  }
  return { script, folder };
}

Deno.test("rebuild pins the script to the host-resolved artifact URL", async () => {
  const p = new BcContainerProvider();
  // A SAS-style query with a `$` in it: proof the value is emitted as a
  // single-quoted PS string, where `$sig` cannot expand to nothing.
  const url = `${ARTIFACT_URL}?sv=2021&sig=$abc`;
  const { script, folder } = await captureRebuild(p, {
    artifactUrl: url,
    running: true,
    imageDigest: undefined,
  });
  try {
    assertStringIncludes(script, `$artifactUrl = '${url}'`);
    // The in-script resolution is what the pin replaces.
    assert(!script.includes("Get-BcContainerArtifactUrl"));
    assertStringIncludes(script, 'Write-Output "ARTIFACT_URL:$artifactUrl"');
    // The Phase 1 explanatory comment must survive every rework.
    assertStringIncludes(script, "# No -includeTestToolkit");
    assertStringIncludes(
      script,
      "# -includeAL — that forces Download-Artifacts",
    );
    // Cache key is derived from the normalized (query-stripped) URL.
    assertStringIncludes(
      script,
      ` -containerName "CentralGauge-Cronus282" -cacheFolder "${BcContainerProvider.COMPILER_CACHE_ROOT}\\${BcContainerProvider.COMPILER_CACHE_PREFIX}-${await compilerCacheKey(
        url,
      )}"`,
    );
    // The marker records the SAME string the script was pinned to — that
    // identity is the whole point of the pin.
    const marker = JSON.parse(
      await Deno.readTextFile(`${folder}/${MARKER_FILENAME}`),
    );
    assertEquals(marker.artifactUrl, url);
    assertEquals(marker.bchVersion, BCCH_PINNED_VERSION);
    assertEquals(marker.layoutVersion, LAYOUT_VERSION);
  } finally {
    await Deno.remove(folder, { recursive: true });
  }
});

Deno.test("rebuild falls back to in-script resolution when inspect gives nothing", async () => {
  const p = new BcContainerProvider();
  const { script, folder } = await captureRebuild(p, undefined);
  try {
    assertStringIncludes(
      script,
      '$artifactUrl = Get-BcContainerArtifactUrl -containerName "Cronus282"',
    );
    assertStringIncludes(script, 'Write-Output "ARTIFACT_URL:$artifactUrl"');
    // No host-side URL means no cache params and no marker to write.
    assert(!script.includes("-cacheFolder"));
    await assertRejects(
      () => Deno.stat(`${folder}/${MARKER_FILENAME}`),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(folder, { recursive: true });
  }
});

Deno.test("rebuild writes no marker when the folder can never be adopted", async () => {
  // --no-compiler-cache: BCH builds into a GUID folder that
  // adoptableFolderPath will never consult, so a marker there is dead weight.
  const p = new BcContainerProvider();
  p.setCompilerCacheEnabled(false);
  const { script, folder } = await captureRebuild(p, {
    artifactUrl: ARTIFACT_URL,
    running: true,
    imageDigest: undefined,
  });
  try {
    assert(!script.includes("-cacheFolder"));
    assert(!script.includes('-containerName "CentralGauge-'));
    await assertRejects(
      () => Deno.stat(`${folder}/${MARKER_FILENAME}`),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(folder, { recursive: true });
  }
});

Deno.test("pruneCompilerOutput", async (t) => {
  const p = new BcContainerProvider();

  await t.step("keeps the newest `keep` entries", async () => {
    const folder = await Deno.makeTempDir({ prefix: "cg-prune-" });
    try {
      await seedOutput(folder, 5);
      await internals(p).pruneCompilerOutput(folder, 2);
      assertEquals(await listDir(`${folder}/output`), ["out-3", "out-4"]);
    } finally {
      await Deno.remove(folder, { recursive: true });
    }
  });

  await t.step("leaves loose files alone", async () => {
    const folder = await Deno.makeTempDir({ prefix: "cg-prune-" });
    try {
      await seedOutput(folder, 3);
      await Deno.writeTextFile(`${folder}/output/stray.log`, "x");
      await internals(p).pruneCompilerOutput(folder, 1);
      assertEquals(await listDir(`${folder}/output`), ["out-2", "stray.log"]);
    } finally {
      await Deno.remove(folder, { recursive: true });
    }
  });

  await t.step("is a no-op when output/ does not exist", async () => {
    const folder = await Deno.makeTempDir({ prefix: "cg-prune-" });
    try {
      // Must not throw — pruning is best-effort and never fails a run.
      await internals(p).pruneCompilerOutput(folder, 1);
    } finally {
      await Deno.remove(folder, { recursive: true });
    }
  });
});
