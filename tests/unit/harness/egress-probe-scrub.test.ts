// M9-01a run 003: the qualification probe's capture scrub works on bytes and
// matches each secret in UTF-8 and in UTF-16LE (PowerShell 5.1 `>` output).
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { scrubFiles } from "../../../src/harness/egress-probe.ts";

const utf16le = (s: string) => {
  const b = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    b[i * 2] = s.charCodeAt(i) & 0xff;
    b[i * 2 + 1] = s.charCodeAt(i) >> 8;
  }
  return b;
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const has = (hay: Uint8Array, needle: Uint8Array) => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
};

Deno.test("scrubFiles: UTF-8 and UTF-16LE occurrences are both redacted; other bytes are kept", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const secret = "sk-ant-oat01-secretvalue0123456789";
    const enc = new TextEncoder();
    const f8 = join(dir, "out8.txt");
    const f16 = join(dir, "run1.jsonl");
    // A UTF-16LE file with a BOM, as Windows PowerShell 5.1 `>` writes it.
    await Deno.writeFile(
      f16,
      concat(
        new Uint8Array([0xff, 0xfe]),
        utf16le(`{"token":"${secret}","n":1}\r\n`),
        utf16le(`again ${secret}\r\n`),
      ),
    );
    await Deno.writeFile(f8, enc.encode(`a ${secret} b ${secret} c\n`));
    assertEquals(
      await scrubFiles([f8, f16, join(dir, "missing.txt")], [secret]),
      null,
    );
    const b8 = await Deno.readFile(f8);
    const b16 = await Deno.readFile(f16);
    assertEquals(has(b8, enc.encode(secret)), false);
    assertEquals(has(b16, utf16le(secret)), false);
    assertEquals(new TextDecoder().decode(b8), "a [REDACTED] b [REDACTED] c\n");
    assertEquals(
      new TextDecoder("utf-16le").decode(b16.subarray(2)),
      '{"token":"[REDACTED]","n":1}\r\nagain [REDACTED]\r\n',
    );
    assertEquals([b16[0], b16[1]], [0xff, 0xfe], "BOM kept");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("scrubFiles: an unreadable path is reported, never skipped as clean", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // A directory where a capture file should be: reading it fails (not NotFound).
    await Deno.mkdir(join(dir, "probe.jsonl"));
    const r = await scrubFiles([join(dir, "probe.jsonl")], ["x"]);
    assertEquals(typeof r, "string");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
