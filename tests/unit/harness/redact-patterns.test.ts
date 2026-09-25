import { assertEquals } from "@std/assert";
import {
  redactPatterns,
  redactPatternText,
} from "../../../src/harness/redact-patterns.ts";

const A = "A".repeat(40);
const enc = new TextEncoder();
const u16 = (s: string) =>
  new Uint8Array(
    [...s].flatMap((ch) => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8]),
  );

Deno.test("redactPatternText: every pattern, surrounding text kept", () => {
  const cases: [string, string][] = [
    [`x sk-ant-oat01-${A} y`, "x [REDACTED:anthropic-key] y"],
    [`x sk-ant-api03-${A} y`, "x [REDACTED:anthropic-key] y"],
    [`x sk-or-v1-${"0".repeat(64)} y`, "x [REDACTED:openrouter-key] y"],
    [`x sk-proj-${A} y`, "x [REDACTED:openai-key] y"],
    [`x ghp_${A} y`, "x [REDACTED:github-token] y"],
    [`x eyJ${A}.eyJ${A}.${A} y`, "x [REDACTED:jwt] y"],
    [`Authorization: Bearer ${A}`, "Authorization: Bearer [REDACTED:bearer]"],
  ];
  for (const [input, want] of cases) {
    assertEquals(redactPatternText(input).text, want, input);
  }
});

Deno.test("redactPatternText: hashes, uuids, stream ids and existing markers are not secrets", () => {
  for (
    const s of [
      "sha256:" + "a".repeat(64),
      "1ae7bb8f-04b6-4431-b315-c3a36ef73f35",
      "toolu_01YBAhLW7fMAGUsCorHcdN6D msg_011CfQ7y4eF8fJdGnHsHN2P3",
      "Bearer [REDACTED:backend-token]",
      "sk-short",
    ]
  ) {
    assertEquals(redactPatternText(s), { text: s, count: 0 }, s);
  }
});

Deno.test("redactPatterns: UTF-8 bytes around the match untouched; UTF-16LE runs redacted in UTF-16LE", () => {
  const r = redactPatterns(enc.encode(`ø sk-ant-oat01-${A} æ\n`));
  assertEquals([new TextDecoder().decode(r.out), r.count], [
    "ø [REDACTED:anthropic-key] æ\n",
    1,
  ]);
  const w = redactPatterns(
    new Uint8Array([0xff, 0xfe, ...u16(`err sk-ant-oat01-${A}\r\n`)]),
  );
  assertEquals(
    new TextDecoder("utf-16le").decode(w.out.subarray(2)),
    "err [REDACTED:anthropic-key]\r\n",
  );
  assertEquals(w.count, 1);
});

Deno.test("redactPatterns: the M0-04 probe fixture has no false positives", async () => {
  const data = await Deno.readFile(
    "tests/fixtures/harness/claude-code/probe.jsonl",
  );
  const r = redactPatterns(data);
  assertEquals([r.count, r.out], [0, data]);
});
