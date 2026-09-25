import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import {
  CopyLimitError,
  DEFAULT_COPY_LIMITS,
  exists,
  FREEZE_VIOLATIONS_FILE,
  freezeWorkspace,
  MAX_VIOLATIONS,
  redactBytes,
  redactTree,
  safeCopyTree,
  scanReparsePoints,
  sweepWorkspaceTemp,
  validatedDest,
  validatedDir,
} from "../../../src/harness/fsutil.ts";
import { hashTree, isTaskBuildArtifact } from "../../../src/harness/hash.ts";

const windows = Deno.build.os === "windows";
const TOKEN = "a".repeat(8) + "0123456789abcdef0123456789abcdef";
const SECRETS = [{ name: "backend-token", value: TOKEN }];

async function tmp(): Promise<string> {
  return await validatedDir(await Deno.realPath(await Deno.makeTempDir()));
}

async function writeTree(root: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, ...rel.split("/"));
    await Deno.mkdir(join(p, ".."), { recursive: true });
    await Deno.writeTextFile(p, text);
  }
}

async function linkDir(target: string, path: string) {
  await Deno.symlink(target, path, { type: windows ? "junction" : "dir" });
}

/** A directory where "a.al" and "A.al" can coexist, or null when the OS cannot make one. */
async function caseSensitiveDir(): Promise<string | null> {
  const d = await tmp();
  if (!windows) return d;
  const out = await new Deno.Command("fsutil.exe", {
    args: ["file", "setCaseSensitiveInfo", d, "enable"],
    stdout: "null",
    stderr: "null",
  }).output().catch(() => null);
  return out?.success ? d : null;
}

async function freeze(
  results: string,
  workspace: string,
  over: Record<string, unknown> = {},
) {
  return await freezeWorkspace({
    resultsRoot: results,
    privateRoot: await tmp(),
    workspace,
    secrets: SECRETS,
    ...over,
  });
}

Deno.test("validatedDir: relative, drive-relative, linked ancestor and case alias are refused", async () => {
  await assertRejects(
    () => validatedDir("relative/path"),
    ValidationError,
    "relative",
  );
  if (windows) {
    await assertRejects(
      () => validatedDir("C:Windows"),
      ValidationError,
      "drive-relative",
    );
  }
  const target = await tmp();
  await writeTree(target, { "inner/x.al": "x" });
  const parent = await tmp();
  await linkDir(target, join(parent, "link"));
  await assertRejects(
    () => validatedDir(join(parent, "link", "inner")),
    ValidationError,
    "canonical",
  );
  if (windows) {
    await assertRejects(
      () => validatedDir(target.toUpperCase()),
      ValidationError,
      "canonical",
    );
  }
  assertEquals(await validatedDir(target), target);
});

Deno.test("validatedDest: creates one level at a time and refuses a linked ancestor", async () => {
  const root = await tmp();
  assertEquals(
    await validatedDest(join(root, "a", "b", "c")),
    join(root, "a", "b", "c"),
  );
  const target = await tmp();
  await linkDir(target, join(root, "hop"));
  await assertRejects(
    () => validatedDest(join(root, "hop", "x")),
    ValidationError,
  );
  assert(!await exists(join(target, "x")));
});

Deno.test("safeCopyTree: copies files, skips build artifacts, counts", async () => {
  const src = await tmp();
  const dst = join(await tmp(), "out");
  await writeTree(src, {
    "Core/app.json": "{}",
    "Core/src/A.Codeunit.al": "codeunit 70000 A {}",
    ".alpackages/sym.app": "bin",
    "Core/output/Core.app": "bin",
  });
  const r = await safeCopyTree(src, dst, { skip: isTaskBuildArtifact });
  assertEquals([r.files, r.refused, r.ambiguous], [2, [], []]);
  assert(await exists(join(dst, "Core", "src", "A.Codeunit.al")));
  assert(!await exists(join(dst, ".alpackages")));
});

Deno.test("safeCopyTree: redirecting reparse points are refused, never followed", async () => {
  const target = await tmp();
  await writeTree(target, { "secret.txt": "host" });
  const src = await tmp();
  await writeTree(src, { "Core/app.json": "{}" });
  await linkDir(target, join(src, "Core", "hostlink"));
  const dst = join(await tmp(), "out");
  const r = await safeCopyTree(src, dst);
  assertEquals(r.refused, ["Core/hostlink"]);
  assert(!await exists(join(dst, "Core", "hostlink")));
});

Deno.test("safeCopyTree: a directory swapped for a junction after listing is refused", async () => {
  const decoy = await tmp();
  await writeTree(decoy, { "a.al": "host" });
  const src = await tmp();
  await writeTree(src, { "sub/a.al": "mine" });
  const dst = join(await tmp(), "out");
  const r = await safeCopyTree(src, dst, {
    afterList: async (rel) => {
      if (rel !== "") return;
      await Deno.rename(join(src, "sub"), join(src, "sub-old"));
      await linkDir(decoy, join(src, "sub"));
    },
  });
  assert(r.refused.includes("sub"));
  assert(!await exists(join(dst, "sub", "a.al")));
});

Deno.test("safeCopyTree: an ancestor swapped between the checks and the open stops the copy", async () => {
  const decoy = await tmp();
  await writeTree(decoy, { "a.al": "host" });
  const src = await tmp();
  await writeTree(src, { "sub/a.al": "mine" });
  await assertRejects(
    async () =>
      safeCopyTree(src, join(await tmp(), "out"), {
        beforeOpen: async (rel) => {
          if (rel !== "sub/a.al") return;
          await Deno.rename(join(src, "sub"), join(src, "sub-old"));
          await linkDir(decoy, join(src, "sub"));
        },
      }),
    ValidationError,
    "changed identity",
  );
});

Deno.test("safeCopyTree: a file swapped between check and open is refused", async () => {
  const src = await tmp();
  await writeTree(src, { "a.al": "original", "other.txt": "other" });
  await assertRejects(
    async () =>
      safeCopyTree(src, join(await tmp(), "out"), {
        beforeOpen: async (rel) => {
          if (rel !== "a.al") return;
          await Deno.remove(join(src, "a.al"));
          await Deno.rename(join(src, "other.txt"), join(src, "a.al"));
        },
      }),
    ValidationError,
    "changed identity",
  );
});

Deno.test("safeCopyTree: case-ambiguous names are refused together (deterministic, any host)", async () => {
  const src = await tmp();
  await writeTree(src, { "a.al": "one", "b.al": "three" });
  const r = await safeCopyTree(src, join(await tmp(), "out"), {
    listDir: (d) => Promise.resolve(d === src ? ["a.al", "A.al", "b.al"] : []),
  });
  assertEquals([r.ambiguous.sort(), r.files], [["A.al", "a.al"], 1]);
});

Deno.test("safeCopyTree: case-ambiguous names on a real case-sensitive directory (additional, host-dependent)", async () => {
  const src = await caseSensitiveDir();
  if (src === null) return; // not proof of anything; the deterministic test above is
  await Deno.writeTextFile(join(src, "a.al"), "one");
  await Deno.writeTextFile(join(src, "A.al"), "two");
  const r = await safeCopyTree(src, join(await tmp(), "out"));
  assertEquals(r.ambiguous.sort(), ["A.al", "a.al"]);
});

Deno.test("safeCopyTree: destination must be new or empty and never under a link", async () => {
  const src = await tmp();
  await writeTree(src, { "a.al": "x" });
  const full = await tmp();
  await writeTree(full, { "old.al": "y" });
  await assertRejects(
    () => safeCopyTree(src, full),
    ValidationError,
    "not empty",
  );
  const root = await tmp();
  const target = await tmp();
  await linkDir(target, join(root, "hop"));
  await assertRejects(
    () => safeCopyTree(src, join(root, "hop", "out")),
    ValidationError,
  );
  assert(!await exists(join(target, "out")));
});

Deno.test("safeCopyTree: limits on files, bytes, dirs, depth and a growing file", async () => {
  const src = await tmp();
  await writeTree(src, { "a/b/c/d.al": "x", "e.al": "y" });
  const limits = {
    maxFiles: 100,
    maxBytes: 1_000_000,
    maxDirs: 100,
    maxDepth: 100,
    maxEntries: 1000,
  };
  const out = async () => join(await tmp(), "out");
  await assertRejects(
    async () =>
      safeCopyTree(src, await out(), { limits: { ...limits, maxFiles: 1 } }),
    CopyLimitError,
  );
  await assertRejects(
    async () =>
      safeCopyTree(src, await out(), { limits: { ...limits, maxBytes: 1 } }),
    CopyLimitError,
  );
  await assertRejects(
    async () =>
      safeCopyTree(src, await out(), { limits: { ...limits, maxDirs: 1 } }),
    CopyLimitError,
  );
  await assertRejects(
    async () =>
      safeCopyTree(src, await out(), { limits: { ...limits, maxDepth: 2 } }),
    CopyLimitError,
  );
  await assertRejects(
    async () =>
      safeCopyTree(src, await out(), {
        limits: { ...limits, maxBytes: 100 },
        beforeOpen: async (rel) => {
          if (rel === "e.al") {
            await Deno.writeTextFile(join(src, "e.al"), "z".repeat(500), {
              append: true,
            });
          }
        },
      }),
    CopyLimitError,
  );
});

Deno.test("redactBytes: UTF-8 and UTF-16LE forms, adjacent to word characters, longest first, binary-safe", () => {
  const enc = new TextEncoder();
  const u16 = (s: string) =>
    new Uint8Array(new Uint16Array([...s].map((c) => c.charCodeAt(0))).buffer);
  const data = new Uint8Array([
    0,
    255,
    ...enc.encode(`x${TOKEN}y`),
    0,
    ...u16(TOKEN),
    7,
  ]);
  const r = redactBytes(data, [...SECRETS, {
    name: "prefix",
    value: TOKEN.slice(0, 20),
  }]);
  assertEquals(r.count, 2);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(r.out);
  assertStringIncludes(text, "x[REDACTED:backend-token]y");
  assert(!text.includes(TOKEN.slice(0, 20)));
  assertEquals([r.out[0], r.out[1], r.out.at(-1)], [0, 255, 7]);
});

Deno.test("redactTree: redacts in place in a private copy; oversize files are removed and reported", async () => {
  const d = await tmp();
  await writeTree(d, {
    "Test/src/Leak.al": `// ${TOKEN}`,
    "big.bin": "z".repeat(2048),
  });
  const r = await redactTree(d, SECRETS, 1024);
  assertEquals(r.count, 1);
  assertEquals(
    await Deno.readTextFile(join(d, "Test", "src", "Leak.al")),
    "// [REDACTED:backend-token]",
  );
  assert(!await exists(join(d, "big.bin")));
  assertStringIncludes(r.violations[0]!, "big.bin");
});

Deno.test("freezeWorkspace: never writes the live tree; stores a redacted copy; oversize is a violation", async () => {
  const results = await tmp();
  const a = await tmp();
  await writeTree(a, {
    "Core/src/A.al": `x ${TOKEN}\r\n`,
    ".alpackages/s.app": "bin",
  });
  const fa = await freeze(results, a);
  assertEquals(
    await Deno.readTextFile(join(a, "Core", "src", "A.al")),
    `x ${TOKEN}\r\n`,
    "live tree untouched",
  );
  assertEquals(fa.redactions, 1);
  assert(
    !(await Deno.readTextFile(
      join(results, fa.stored_path, "Core", "src", "A.al"),
    )).includes(TOKEN),
  );
  assertEquals(
    await hashTree(join(results, fa.stored_path), "task"),
    fa.workspace_hash,
  );
  const b = await tmp();
  await writeTree(b, { "Core/src/A.al": "x [REDACTED:backend-token]\n" });
  assertEquals(
    (await freeze(results, b)).workspace_hash,
    fa.workspace_hash,
    "same redacted content, one copy",
  );
  const target = await tmp();
  await linkDir(target, join(b, "Core", "hostlink"));
  const fl = await freeze(results, b);
  assertNotEquals(fl.workspace_hash, fa.workspace_hash);
  assertStringIncludes(
    await Deno.readTextFile(
      join(results, fl.stored_path, FREEZE_VIOLATIONS_FILE),
    ),
    "Core/hostlink",
  );
  const big = await freeze(results, a, { maxScanBytes: 4 });
  assertStringIncludes(big.violations.join("\n"), "larger than");
  const over = await freeze(results, a, {
    limits: {
      maxFiles: 0,
      maxBytes: 0,
      maxDirs: 0,
      maxDepth: 0,
      maxEntries: 0,
    },
  });
  assertStringIncludes(over.violations[0]!, "size limit");
});

Deno.test("freezeWorkspace: secret-bearing file names and link names never reach the stored tree or the marker", async () => {
  const results = await tmp();
  const ws = await tmp();
  await writeTree(ws, { [`Core/src/${TOKEN}.al`]: "x", "Core/src/Ok.al": "y" });
  const target = await tmp();
  await linkDir(target, join(ws, "Core", `link-${TOKEN}`));
  const f = await freeze(results, ws);
  const stored = join(results, f.stored_path);
  assert(!await exists(join(stored, "Core", "src", `${TOKEN}.al`)));
  assert(await exists(join(stored, "Core", "src", "Ok.al")));
  const marker = await Deno.readTextFile(join(stored, FREEZE_VIOLATIONS_FILE));
  assert(!marker.includes(TOKEN));
  assertStringIncludes(marker, "[REDACTED:backend-token]");
  assertStringIncludes(marker, "name contains a secret");
  assert(
    !f.violations.join(" | ").includes(TOKEN),
    "returned violations are redacted",
  );
});

Deno.test("sweepWorkspaceTemp: removes interrupted freezes and private scratch only", async () => {
  const results = await tmp();
  const priv = await tmp();
  await writeTree(results, {
    "workspaces/.tmp-1/a.al": "x",
    "workspaces/abc/a.al": "x",
  });
  await writeTree(priv, { "freeze/1/a.al": "x" });
  assertEquals(await sweepWorkspaceTemp(results, priv), 2);
  assert(await exists(join(results, "workspaces", "abc")));
});

Deno.test("freezeWorkspace: the publish copy accepts every tree the freeze accepted", async () => {
  const results = await tmp();
  const ws = await tmp();
  await writeTree(ws, { [`${"d/".repeat(26)}a.al`]: "x" });
  const limits = {
    maxFiles: 100,
    maxBytes: 1_000_000,
    maxDirs: 100,
    maxDepth: 30,
    maxEntries: 1000,
  };
  const f = await freeze(results, ws, { limits });
  assertEquals(f.violations, []);
  assert(
    await exists(
      join(results, f.stored_path, ...`${"d/".repeat(26)}a.al`.split("/")),
    ),
  );
});

Deno.test("freezeWorkspace: a secret spread over path components never reaches the stored tree", async () => {
  const results = await tmp();
  const ws = await tmp();
  const split = { name: "split", value: "abcdefgh/ijklmnopqrst" };
  await writeTree(ws, { "abcdefgh/ijklmnopqrst": "x", "abcdefgh/ok.al": "y" });
  const f = await freeze(results, ws, { secrets: [split] });
  const stored = join(results, f.stored_path);
  assert(!await exists(join(stored, "abcdefgh", "ijklmnopqrst")));
  assert(await exists(join(stored, "abcdefgh", "ok.al")));
  assertStringIncludes(f.violations.join(" | "), "[REDACTED:split]");
});

Deno.test("freezeWorkspace: thrown errors are redacted", async () => {
  const results = await tmp();
  const target = await tmp();
  const parent = await tmp();
  const ws = join(parent, `ws-${TOKEN}`);
  await linkDir(target, ws);
  const err = await assertRejects(() => freeze(results, ws), ValidationError);
  assert(!err.message.includes(TOKEN), err.message);
  assert(!JSON.stringify([err.errors, err.context]).includes(TOKEN));
  assertStringIncludes(err.message, "[REDACTED:backend-token]");
});

Deno.test("safeCopyTree: every listed entry counts toward maxEntries (dirs, links, skipped)", async () => {
  const limits = {
    maxFiles: 100,
    maxBytes: 1_000_000,
    maxDirs: 100,
    maxDepth: 100,
    maxEntries: 4,
  };
  const dirs = await tmp();
  for (let i = 0; i < 5; i++) await Deno.mkdir(join(dirs, `d${i}`));
  await assertRejects(
    async () => safeCopyTree(dirs, join(await tmp(), "out"), { limits }),
    CopyLimitError,
    "entries",
  );
  const links = await tmp();
  const target = await tmp();
  for (let i = 0; i < 5; i++) await linkDir(target, join(links, `l${i}`));
  await assertRejects(
    async () => safeCopyTree(links, join(await tmp(), "out"), { limits }),
    CopyLimitError,
    "entries",
  );
  const skipped = await tmp();
  await writeTree(
    skipped,
    Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`x${i}.app`, "b"])),
  );
  await assertRejects(
    async () =>
      safeCopyTree(skipped, join(await tmp(), "out"), {
        limits,
        skip: isTaskBuildArtifact,
      }),
    CopyLimitError,
    "entries",
  );
});

Deno.test("safeCopyTree: case collisions are over-approximated (NFC/NFD, lower and upper)", async () => {
  const src = await tmp();
  await writeTree(src, { "b.al": "x" });
  const names = [
    "a.al",
    "A.al",
    "straße",
    "STRASSE",
    "σ",
    "ς",
    "\u00e9.al",
    "e\u0301.al",
    "b.al",
  ];
  const r = await safeCopyTree(src, join(await tmp(), "out"), {
    listDir: (d) => Promise.resolve(d === src ? names : []),
  });
  assertEquals(r.ambiguous.sort(), names.filter((n) => n !== "b.al").sort());
  assertEquals(r.files, 1);
});

Deno.test("freezeWorkspace: violations are capped", async () => {
  const results = await tmp();
  const ws = await tmp();
  const target = await tmp();
  for (let i = 0; i < MAX_VIOLATIONS + 5; i++) {
    await linkDir(target, join(ws, `l${String(i).padStart(3, "0")}`));
  }
  const f = await freeze(results, ws);
  assertEquals(f.violations.length, MAX_VIOLATIONS + 1);
  assertStringIncludes(f.violations.at(-1)!, "and 5 more");
  const marker = await Deno.readTextFile(
    join(results, f.stored_path, FREEZE_VIOLATIONS_FILE),
  );
  assertStringIncludes(marker, "and 5 more");
});

Deno.test("freezeWorkspace: the publish copy is bounded and still accepts a full tree", async () => {
  // maxFiles files plus a link: the marker makes maxFiles + 1 in the private copy.
  const results = await tmp();
  const ws = await tmp();
  await writeTree(ws, { "a.al": "x", "b.al": "y" });
  await linkDir(await tmp(), join(ws, "link"));
  const limits = {
    maxFiles: 2,
    maxBytes: 1_000_000,
    maxDirs: 10,
    maxDepth: 10,
    maxEntries: 10,
  };
  const f = await freeze(results, ws, { limits });
  assert(await exists(join(results, f.stored_path, FREEZE_VIOLATIONS_FILE)));
  // Redaction growth: a short secret with a long name, content exactly at maxBytes.
  const s = {
    name: "a-rather-long-secret-name-for-growth",
    value: "abcdefghijklmnop",
  };
  const ws2 = await tmp();
  await writeTree(ws2, { "a.al": s.value.repeat(2) });
  const f2 = await freeze(results, ws2, {
    secrets: [s],
    limits: { ...limits, maxBytes: 32 },
  });
  assertEquals(f2.redactions, 2);
  assertEquals(f2.violations, []);
});

Deno.test({
  name:
    "scanReparsePoints: entries and ancestors by FILE_ATTRIBUTE_REPARSE_POINT (Windows)",
  ignore: !windows,
  fn: async () => {
    const target = await tmp();
    await writeTree(target, { "inner/f.txt": "x" });
    const root = await tmp();
    await writeTree(root, { "Core/a.al": "x" });
    await linkDir(target, join(root, "Core", "j"));
    let fileLink = false;
    try {
      await Deno.symlink(join(target, "inner", "f.txt"), join(root, "fl.txt"), {
        type: "file",
      });
      fileLink = true;
    } catch { /* needs Developer Mode or admin */ }
    const s = await scanReparsePoints(root);
    assertEquals(s.ancestors, []);
    assertEquals(
      s.entries.sort(),
      fileLink ? ["Core/j", "fl.txt"] : ["Core/j"],
    );
    const parent = await tmp();
    await linkDir(target, join(parent, "hop"));
    const under = await scanReparsePoints(join(parent, "hop", "inner"));
    assertEquals(under.ancestors.length, 1);
    assertStringIncludes(under.ancestors[0]!, "hop");
  },
});

Deno.test("safeCopyTree: entries in the refuse set are refused whatever lstat says", async () => {
  // The attribute scan's result reaches the copy through `refuse`: a
  // non-redirecting reparse point looks like a plain file to lstat and realPath.
  const src = await tmp();
  await writeTree(src, { "Core/plain.al": "x", "Core/ok.al": "y" });
  const dst = join(await tmp(), "out");
  const r = await safeCopyTree(src, dst, {
    refuse: new Set(["Core/plain.al"]),
  });
  assertEquals([r.refused, r.files], [["Core/plain.al"], 1]);
  assert(!await exists(join(dst, "Core", "plain.al")));
});

Deno.test("safeCopyTree: maxEntries is enforced while a directory is being read", async () => {
  const src = await tmp();
  await writeTree(
    src,
    Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`f${i}.al`, "x"])),
  );
  let listed = 0;
  const realReadDir = Deno.readDir;
  const setReadDir = (value: typeof Deno.readDir) =>
    Object.defineProperty(Deno, "readDir", {
      value,
      configurable: true,
      writable: true,
    });
  setReadDir((path: string | URL) => {
    const it = realReadDir(path);
    return (async function* () {
      for await (const e of it) {
        listed++;
        yield e;
      }
    })();
  });
  try {
    await assertRejects(
      async () =>
        safeCopyTree(src, join(await tmp(), "out"), {
          limits: { ...DEFAULT_COPY_LIMITS, maxEntries: 10 },
        }),
      CopyLimitError,
      "entries",
    );
  } finally {
    setReadDir(realReadDir);
  }
  // The destination emptiness check reads nothing; the source read stops at the cap.
  assertEquals(listed, 11);
});

Deno.test({
  name: "scanReparsePoints: the scan stops at the entry cap (Windows)",
  ignore: !windows,
  fn: async () => {
    const root = await tmp();
    await writeTree(
      root,
      Object.fromEntries(
        Array.from({ length: 50 }, (_, i) => [`d/f${i}.al`, "x"]),
      ),
    );
    const s = await scanReparsePoints(root, 10);
    assertEquals([s.capped, s.seen], [true, 11]);
    const all = await scanReparsePoints(root, 100);
    assertEquals([all.capped, all.seen], [false, 51]);
  },
});

Deno.test("freezeWorkspace: a workspace over maxEntries is refused", async () => {
  const results = await tmp();
  const ws = await tmp();
  await writeTree(
    ws,
    Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`f${i}.al`, "x"])),
  );
  const f = await freeze(results, ws, {
    limits: { ...DEFAULT_COPY_LIMITS, maxEntries: 10 },
  });
  assertStringIncludes(f.violations.join(" | "), "size limit");
  assert(!await exists(join(results, f.stored_path, "f0.al")));
});
