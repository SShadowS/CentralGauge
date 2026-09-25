import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import {
  HASH_RULES_VERSION,
  hashFile,
  hashJson,
  hashTree,
  listTree,
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
    await hashFile(join(root, "a.bin")),
    await hashFile(join(root, "b.bin")),
  );
  assertEquals(
    await hashFile(join(root, "a.al")),
    await hashFile(join(root, "b.al")),
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
    () => hashFile(join(parent, "rootlink")),
    ValidationError,
    "link",
  );
});
