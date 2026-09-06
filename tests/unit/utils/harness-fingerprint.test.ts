import { assert, assertEquals, assertMatch, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  expandInputs,
  HARNESS_INPUTS,
  harnessFingerprint,
  hashFiles,
  LEGACY_HARNESS_INPUTS_2026_08,
} from "../../../src/utils/harness-fingerprint.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

Deno.test("fingerprint is 64 hex and stable across CRLF/LF", async () => {
  const a = await harnessFingerprint(".");
  assertMatch(a, /^[0-9a-f]{64}$/);
  const dir = await Deno.makeTempDir();
  // HARNESS_INPUTS can name a directory (e.g. "src/parallel/shared"), so
  // expand to concrete files first rather than treating every entry as a
  // file to copy directly.
  const files = await expandInputs(HARNESS_INPUTS, ".");
  for (const p of files) {
    await Deno.mkdir(`${dir}/${p.split("/").slice(0, -1).join("/")}`, {
      recursive: true,
    });
    await Deno.writeTextFile(
      `${dir}/${p}`,
      (await Deno.readTextFile(p)).replace(/\r?\n/g, "\r\n"),
    );
  }
  assertEquals(await harnessFingerprint(dir), a);
});

Deno.test("harnessFingerprint rejects a root missing a harness input", async () => {
  const dir = await Deno.makeTempDir();
  const files = await expandInputs(HARNESS_INPUTS, ".");
  // Write every input but the last one - a partial checkout of the harness
  // inputs must fail loudly, not silently hash a narrower set.
  for (const p of files.slice(0, -1)) {
    await Deno.mkdir(`${dir}/${p.split("/").slice(0, -1).join("/")}`, {
      recursive: true,
    });
    await Deno.writeTextFile(`${dir}/${p}`, await Deno.readTextFile(p));
  }
  await assertRejects(
    () => harnessFingerprint(dir),
    Error,
    "missing input",
  );
});

Deno.test("hashFiles with missing: skip omits an absent file instead of throwing", async () => {
  const dir = await Deno.makeTempDir();
  const present = HARNESS_INPUTS[0]!;
  await Deno.mkdir(`${dir}/${present.split("/").slice(0, -1).join("/")}`, {
    recursive: true,
  });
  await Deno.writeTextFile(
    `${dir}/${present}`,
    await Deno.readTextFile(present),
  );

  const withSkip = await hashFiles([present, "does/not/exist.ts"], dir, {
    missing: "skip",
  });
  const onlyPresent = await hashFiles([present], dir, { missing: "skip" });
  assertEquals(withSkip, onlyPresent);
});

Deno.test("expandInputs walks a directory entry in sorted order with posix separators", async () => {
  const root = await createTempDir("hf-expand");
  try {
    await Deno.mkdir(join(root, "dir", "sub"), { recursive: true });
    await Deno.writeTextFile(join(root, "dir", "b.ts"), "b");
    await Deno.writeTextFile(join(root, "dir", "sub", "a.ts"), "a");
    await Deno.writeTextFile(join(root, "dir", "notes.md"), "ignored");
    await Deno.writeTextFile(join(root, "file.ts"), "f");
    const out = await expandInputs(["file.ts", "dir", "missing.ts"], root);
    assertEquals(out, ["dir/b.ts", "dir/sub/a.ts", "file.ts", "missing.ts"]);
  } finally {
    await cleanupTempDir(root);
  }
});

Deno.test("hashFiles over a directory changes when a file inside it changes", async () => {
  const root = await createTempDir("hf-dir-hash");
  try {
    await Deno.mkdir(join(root, "dir"), { recursive: true });
    await Deno.writeTextFile(join(root, "dir", "a.ts"), "one");
    const h1 = await hashFiles(["dir"], root);
    await Deno.writeTextFile(join(root, "dir", "a.ts"), "two");
    const h2 = await hashFiles(["dir"], root);
    assertEquals(h1 === h2, false);
    assertEquals(h1.length, 64);
  } finally {
    await cleanupTempDir(root);
  }
});

Deno.test("HARNESS_INPUTS names the shared units and every legacy entry", () => {
  for (const legacy of LEGACY_HARNESS_INPUTS_2026_08) {
    assert(HARNESS_INPUTS.includes(legacy));
  }
  assert(HARNESS_INPUTS.includes("src/parallel/shared"));
  assert(HARNESS_INPUTS.includes("src/parallel/llm-work-pool.ts"));
});
