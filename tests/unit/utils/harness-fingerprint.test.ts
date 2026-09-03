import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import {
  HARNESS_INPUTS,
  harnessFingerprint,
  hashFiles,
} from "../../../src/utils/harness-fingerprint.ts";

Deno.test("fingerprint is 64 hex and stable across CRLF/LF", async () => {
  const a = await harnessFingerprint(".");
  assertMatch(a, /^[0-9a-f]{64}$/);
  const dir = await Deno.makeTempDir();
  for (const p of HARNESS_INPUTS) {
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
  // Write every input but the last one - a partial checkout of the harness
  // inputs must fail loudly, not silently hash a narrower set.
  for (const p of HARNESS_INPUTS.slice(0, -1)) {
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
