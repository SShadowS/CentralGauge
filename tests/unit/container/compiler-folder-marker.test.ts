import { assertEquals } from "@std/assert";
import {
  LAYOUT_VERSION,
  MARKER_FILENAME,
  validateFolder,
  writeMarker,
} from "../../../src/container/compiler-folder-marker.ts";

const URL_A = "https://x/sandbox/28.3.52162.52884/dk";
const BCH = "6.1.14";

/** Build a folder that satisfies every expected-file check. */
async function makeGoodFolder(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "cg-marker-" });
  await Deno.mkdir(`${dir}/compiler/extension/bin`, { recursive: true });
  await Deno.writeTextFile(`${dir}/compiler/extension/bin/alc.exe`, "x");
  await Deno.mkdir(`${dir}/symbols`, { recursive: true });
  await Deno.writeTextFile(`${dir}/symbols/Base.app`, "x");
  await Deno.writeTextFile(`${dir}/symbols/cache_AppInfo.json`, "{}");
  await Deno.writeTextFile(`${dir}/manifest.json`, "{}");
  await Deno.mkdir(`${dir}/dlls/Test Assemblies`, { recursive: true });
  await writeMarker(dir, {
    layoutVersion: LAYOUT_VERSION,
    artifactUrl: URL_A,
    cacheKey: "036dceedc9cc",
    bchVersion: BCH,
    containerName: "Cronus282",
    createdAt: "2026-07-25T00:00:00.000Z",
  });
  return dir;
}

Deno.test("validateFolder accepts a complete, matching folder", async () => {
  const dir = await makeGoodFolder();
  try {
    const r = await validateFolder(dir, {
      artifactUrl: URL_A,
      bchVersion: BCH,
    });
    assertEquals(r.ok, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFolder rejects an artifact-URL mismatch", async () => {
  // The staleness case: adopting here would compile against old symbols.
  const dir = await makeGoodFolder();
  try {
    const r = await validateFolder(dir, {
      artifactUrl: "https://x/sandbox/28.4.00000.00000/dk",
      bchVersion: BCH,
    });
    assertEquals(r.ok, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFolder rejects a BCH-version mismatch", async () => {
  const dir = await makeGoodFolder();
  try {
    const r = await validateFolder(dir, {
      artifactUrl: URL_A,
      bchVersion: "6.1.15",
    });
    assertEquals(r.ok, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFolder rejects a layout-version mismatch", async () => {
  const dir = await makeGoodFolder();
  try {
    await Deno.writeTextFile(
      `${dir}/${MARKER_FILENAME}`,
      JSON.stringify({
        layoutVersion: LAYOUT_VERSION + 1,
        artifactUrl: URL_A,
        cacheKey: "036dceedc9cc",
        bchVersion: BCH,
        containerName: "Cronus282",
        createdAt: "2026-07-25T00:00:00.000Z",
      }),
    );
    const r = await validateFolder(dir, {
      artifactUrl: URL_A,
      bchVersion: BCH,
    });
    assertEquals(r.ok, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFolder rejects a torn marker", async () => {
  const dir = await makeGoodFolder();
  try {
    await Deno.writeTextFile(
      `${dir}/${MARKER_FILENAME}`,
      '{"layoutVersion":1,',
    );
    const r = await validateFolder(dir, {
      artifactUrl: URL_A,
      bchVersion: BCH,
    });
    assertEquals(r.ok, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFolder rejects a missing marker", async () => {
  const dir = await makeGoodFolder();
  try {
    await Deno.remove(`${dir}/${MARKER_FILENAME}`);
    const r = await validateFolder(dir, {
      artifactUrl: URL_A,
      bchVersion: BCH,
    });
    assertEquals(r.ok, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFolder rejects each missing expected entry", async () => {
  const victims = [
    "compiler/extension/bin",
    "symbols/cache_AppInfo.json",
    "manifest.json",
    "dlls/Test Assemblies",
  ];
  for (const victim of victims) {
    const dir = await makeGoodFolder();
    try {
      await Deno.remove(`${dir}/${victim}`, { recursive: true });
      const r = await validateFolder(dir, {
        artifactUrl: URL_A,
        bchVersion: BCH,
      });
      assertEquals(r.ok, false, `expected rebuild when ${victim} is missing`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});

Deno.test("validateFolder rejects a symbols folder with no .app", async () => {
  const dir = await makeGoodFolder();
  try {
    await Deno.remove(`${dir}/symbols/Base.app`);
    const r = await validateFolder(dir, {
      artifactUrl: URL_A,
      bchVersion: BCH,
    });
    assertEquals(r.ok, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeMarker leaves no temp file behind", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-marker-tmp-" });
  try {
    await writeMarker(dir, {
      layoutVersion: LAYOUT_VERSION,
      artifactUrl: URL_A,
      cacheKey: "036dceedc9cc",
      bchVersion: BCH,
      containerName: "Cronus282",
      createdAt: "2026-07-25T00:00:00.000Z",
    });
    const names: string[] = [];
    for await (const e of Deno.readDir(dir)) names.push(e.name);
    assertEquals(names, [MARKER_FILENAME]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
