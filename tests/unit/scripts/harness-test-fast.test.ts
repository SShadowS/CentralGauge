import { assert, assertEquals } from "@std/assert";
import {
  CLASSES,
  gate,
  parseSummary,
  plan,
} from "../../../scripts/harness/test-fast.ts";

const classes = {
  "a.test.ts": { safe: false, seconds: 50 },
  "b.test.ts": { safe: true, seconds: 40 },
  "c.test.ts": { safe: true, seconds: 30 },
  "d.test.ts": { safe: true, seconds: 20 },
  "e.test.ts": { safe: false, seconds: 5 },
};

Deno.test("plan: every file runs exactly once and all unsafe files share chunk 0", () => {
  const files = [...Object.keys(classes), "new.test.ts"];
  const p = plan(files, classes, 3);
  assertEquals(p.chunks.flat().sort(), [...files].sort());
  for (const f of ["a.test.ts", "e.test.ts", "new.test.ts"]) {
    assert(p.chunks[0]?.includes(f), `${f} must run in the serial chunk`);
  }
  assertEquals(p.unclassified, ["new.test.ts"]);
});

Deno.test("plan: safe files are balanced by duration across the chunks", () => {
  const p = plan(Object.keys(classes), classes, 3);
  // serial chunk 55s + 3 safe files into 3 chunks: b and c each get a chunk,
  // d goes to whichever is lightest (c at 30s).
  assertEquals(p.chunks.length, 3);
  assertEquals(p.seconds, [55, 40, 50]);
  assert(p.chunks[2]?.includes("d.test.ts"));
});

Deno.test("plan: chunks keep alphabetical order and empty chunks are dropped", () => {
  const p = plan(["b.test.ts", "a.test.ts"], classes, 5);
  assertEquals(p.chunks, [["a.test.ts"], ["b.test.ts"]]);
});

Deno.test("parseSummary: ok and FAILED summary lines, with ANSI and steps", () => {
  assertEquals(
    parseSummary(
      "x\n\x1b[0m\x1b[32mok\x1b[0m | 2004 passed | 0 failed | 2 ignored \x1b[0m(42m55s)\n",
    ),
    { ok: true, passed: 2004, failed: 0, ignored: 2 },
  );
  assertEquals(
    parseSummary("FAILED | 12 passed (3 steps) | 1 failed (1 step) (2s)\n"),
    { ok: false, passed: 12, failed: 1, ignored: 0 },
  );
  assertEquals(parseSummary("error: Module not found"), undefined);
});

Deno.test("T-09 gate: the fast suite passes only when every chunk passed and no file is unclassified", () => {
  const ok = {
    code: 0,
    summary: { ok: true, passed: 3, failed: 0, ignored: 0 },
  };
  assertEquals(gate([ok, ok], []), true);
  // An unclassified file fails the run even when it and every chunk passed.
  assertEquals(gate([ok, ok], ["tests/unit/harness/new.test.ts"]), false);
  assertEquals(gate([ok, { ...ok, code: 1 }], []), false);
  assertEquals(gate([ok, { code: 0, summary: undefined }], []), false);
});

Deno.test("CLASSES covers every harness test file", () => {
  const files = [...Deno.readDirSync("tests/unit/harness")]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".test.ts"))
    .map((n) => `tests/unit/harness/${n}`);
  files.push("tests/unit/cli/commands/harness-command.test.ts");
  assertEquals(
    files.filter((f) => !(f in CLASSES)),
    [],
  );
});
