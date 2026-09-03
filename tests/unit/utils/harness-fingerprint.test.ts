import { assertEquals, assertMatch } from "@std/assert";
import {
  HARNESS_INPUTS,
  harnessFingerprint,
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
