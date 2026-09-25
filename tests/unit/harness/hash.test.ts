import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import {
  HASH_RULES_VERSION,
  hashFile,
  hashJson,
  hashTree,
  listTree,
  posixRel,
} from "../../../src/harness/hash.ts";

async function writeTree(root: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, ...rel.split("/"));
    await Deno.mkdir(join(p, ".."), { recursive: true });
    await Deno.writeTextFile(p, text);
  }
}

/** Directory link: a junction on Windows, a symlink elsewhere. */
async function linkDir(target: string, path: string) {
  await Deno.symlink(target, path, {
    type: Deno.build.os === "windows" ? "junction" : "dir",
  });
}

Deno.test("hashJson: golden value pins rules hr1", async () => {
  assertEquals(HASH_RULES_VERSION, "hr1");
  assertEquals(
    await hashJson({ b: [true, null, "x"], a: 1 }),
    "b93bfb4cd226bb75b69866d163145c6bbe6e71eae8eb09e6079cf8b54747ea2a",
  );
});

Deno.test("hashJson: key order does not matter, values and types do", async () => {
  assertEquals(await hashJson({ a: 1, b: 2 }), await hashJson({ b: 2, a: 1 }));
  assertNotEquals(await hashJson({ a: 1 }), await hashJson({ a: 2 }));
  assertNotEquals(await hashJson({ a: 1 }), await hashJson({ a: "1" }));
  assertNotEquals(await hashJson([1, 2]), await hashJson([2, 1]));
});

Deno.test("hashTree task domain: golden, CRLF-invariant, drops only build artifacts", async () => {
  const crlf = await Deno.makeTempDir();
  const lf = await Deno.makeTempDir();
  await writeTree(crlf, {
    "Core/src/A.Codeunit.al": "line1\r\nline2\r\n",
    ".vscode/settings.json": "{}",
    ".alpackages/x.app": "bin",
    "Core/output/Core.app": "bin",
    "Core/Core.app": "bin",
  });
  await writeTree(lf, {
    "Core/src/A.Codeunit.al": "line1\nline2\n",
    ".vscode/settings.json": "{}",
  });
  assertEquals(
    (await listTree(crlf, "task")).map((e) => e.path),
    [".vscode/settings.json", "Core/src/A.Codeunit.al"],
  );
  assertEquals(await hashTree(crlf, "task"), await hashTree(lf, "task"));
  assertEquals(
    await hashTree(lf, "task"),
    "188dc9078eb86ea57ad930412e661ebe2a2323ab1ea3bc7b633d5e0b902cb677",
  );
});

Deno.test("hashTree bundle domain: every file counts, dotfiles included", async () => {
  const root = await Deno.makeTempDir();
  await writeTree(root, { "SKILL.md": "x", ".plugin/manifest.json": "{}" });
  const before = await hashTree(root, "bundle");
  assertEquals((await listTree(root, "bundle")).length, 2);
  await Deno.writeTextFile(join(root, ".plugin", "manifest.json"), '{"a":1}');
  assertNotEquals(await hashTree(root, "bundle"), before);
  await writeTree(root, { "out/x.app": "bin" });
  assertEquals((await listTree(root, "bundle")).length, 3);
});

Deno.test("hashFile: binary bytes are preserved, text CRLF is normalized", async () => {
  const root = await Deno.makeTempDir();
  await Deno.writeFile(join(root, "a.bin"), new Uint8Array([13, 10, 65]));
  await Deno.writeFile(join(root, "b.bin"), new Uint8Array([10, 65]));
  await Deno.writeTextFile(join(root, "a.al"), "x\r\n");
  await Deno.writeTextFile(join(root, "b.al"), "x\n");
  assertNotEquals(
    await hashFile(root, join(root, "a.bin")),
    await hashFile(root, join(root, "b.bin")),
  );
  assertEquals(
    await hashFile(root, join(root, "a.al")),
    await hashFile(root, join(root, "b.al")),
  );
});

Deno.test("hashTree: missing dir throws unless optional", async () => {
  const root = await Deno.makeTempDir();
  await assertRejects(
    () => hashTree(join(root, "nope"), "task"),
    Deno.errors.NotFound,
  );
  assertEquals(
    await hashTree(join(root, "nope"), "task", { optional: true }),
    await hashJson({ domain: "task", tree: [] }),
  );
});

Deno.test("links: refused as root, as entry, inside a skipped folder, and by hashFile", async () => {
  const target = await Deno.makeTempDir();
  await writeTree(target, { "t.al": "x" });

  const root = await Deno.makeTempDir();
  await writeTree(root, { "a.al": "x" });
  await linkDir(target, join(root, "link"));
  await assertRejects(() => hashTree(root, "task"), ValidationError, "link");

  const skipped = await Deno.makeTempDir();
  await Deno.mkdir(join(skipped, "output"));
  await linkDir(target, join(skipped, "output", "inner"));
  await assertRejects(() => hashTree(skipped, "task"), ValidationError, "link");

  const parent = await Deno.makeTempDir();
  await linkDir(target, join(parent, "rootlink"));
  await assertRejects(
    () => hashTree(join(parent, "rootlink"), "bundle"),
    ValidationError,
    "link",
  );

  // A direct hashFile call on a link is refused too (a junction here, since
  // file symlinks need Developer Mode on Windows).
  await assertRejects(
    () => hashFile(parent, join(parent, "rootlink")),
    ValidationError,
    "link",
  );
});

Deno.test("hashFile: text normalization is byte-level (BOM and malformed UTF-8 kept)", async () => {
  const root = await Deno.makeTempDir();
  const body = [120, 13, 10, 121];
  await Deno.writeFile(
    join(root, "bom.al"),
    new Uint8Array([0xef, 0xbb, 0xbf, ...body]),
  );
  await Deno.writeFile(join(root, "plain.al"), new Uint8Array(body));
  assertNotEquals(
    await hashFile(root, join(root, "bom.al")),
    await hashFile(root, join(root, "plain.al")),
  );
  // 0xff is not valid UTF-8; a decode round trip would turn it into U+FFFD.
  await Deno.writeFile(join(root, "bad.al"), new Uint8Array([0xff, 13, 10]));
  await Deno.writeFile(
    join(root, "fffd.al"),
    new Uint8Array([0xef, 0xbf, 0xbd, 10]),
  );
  assertNotEquals(
    await hashFile(root, join(root, "bad.al")),
    await hashFile(root, join(root, "fffd.al")),
  );
});

Deno.test("posixRel: backslash is a separator only on Windows", () => {
  assertEquals(posixRel("a\\b/c", "windows"), "a/b/c");
  assertEquals(posixRel("a/b", "linux"), "a/b");
  assertThrows(() => posixRel("a\\b", "linux"), ValidationError, "backslash");
  assertThrows(() => posixRel("a\\b", "darwin"), ValidationError, "backslash");
});

Deno.test("hashTree task domain: only DIRECTORIES named output/.alpackages are artifacts", async () => {
  const root = await Deno.makeTempDir();
  await writeTree(root, {
    "output": "o",
    "Core/.alpackages": "p",
    "Core/output/x.al": "dropped",
  });
  assertEquals(
    (await listTree(root, "task")).map((e) => e.path),
    ["Core/.alpackages", "output"],
  );
});

Deno.test("links: a junction ABOVE the root is accepted, one BELOW it refused", async () => {
  const target = await Deno.makeTempDir();
  await writeTree(target, { "sub/t.al": "x" });
  const parent = await Deno.makeTempDir();
  await linkDir(target, join(parent, "anc"));
  const above = join(parent, "anc", "sub");
  const file = join(above, "t.al");

  // Tree root and file root below the junction: nothing above the root is inspected.
  assertEquals((await listTree(above, "task")).map((e) => e.path), ["t.al"]);
  assertEquals(
    await hashFile(above, file),
    (await listTree(above, "task"))[0]!.sha256,
  );

  // Root above the junction: the junction is between root and file, refused.
  await assertRejects(() => hashFile(parent, file), ValidationError, "link");
  await assertRejects(
    () => hashTree(join(parent, "anc"), "task"),
    ValidationError,
    "link",
  );
});

Deno.test("hashFile: a file outside its root is refused", async () => {
  const root = await Deno.makeTempDir();
  const other = await Deno.makeTempDir();
  await Deno.writeTextFile(join(other, "x.al"), "x");
  await assertRejects(
    () => hashFile(root, join(other, "x.al")),
    ValidationError,
    "outside",
  );
  await assertRejects(
    () => hashFile(root, join(root, "..", "x.al")),
    ValidationError,
    "outside",
  );
});
