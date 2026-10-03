import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { buildCompileScript } from "../../../src/container/bc-script-builders.ts";
import {
  parseCompilationErrors,
  parseCompilationWarnings,
} from "../../../src/container/bc-output-parsers.ts";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import {
  canaryCheck,
  finalCode,
  finalCodeCounts,
  type FinalCounts,
} from "../../../src/harness/measures.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import { FakeBc } from "./fake-bc.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";

const analysis = { codeCop: true, uiCop: true, rulesetFile: "r.json" };
const w = (code: string) => ({
  code,
  message: "m",
  file: "C.al",
  line: 1,
  column: 1,
  severity: "warning" as const,
});
const counts = (o: Partial<FinalCounts>): FinalCounts => ({
  errors: 0,
  warnings: 0,
  warning_codes: {},
  incomplete_apps: [],
  compiler: "c",
  ...o,
});

Deno.test("buildCompileScript: analysis adds the cop switches and the ruleset; none without it", () => {
  assertEquals(
    buildCompileScript("C:\\\\cf", "C:\\\\p", "C:\\\\o").includes(
      "EnableCodeCop",
    ),
    false,
  );
  const s = buildCompileScript("C:\\\\cf", "C:\\\\p", "C:\\\\o", {
    ...analysis,
    rulesetFile: "C:\\r\\f.json",
  });
  assertStringIncludes(s, "-EnableCodeCop");
  assertStringIncludes(s, "-EnableUICop");
  assertStringIncludes(s, "-rulesetFile 'C:\\r\\f.json'");
});

Deno.test("buildCompileScript: the ruleset path is a PowerShell literal ($, backtick, quote, space) (M11-05 run 002)", () => {
  const path = "C:\\analysis\\$frozen\\`n it's\\final code.ruleset.json";
  const s = buildCompileScript("C:\\\\cf", "C:\\\\p", "C:\\\\o", {
    ...analysis,
    rulesetFile: path,
  });
  // Single-quoted: no $ expansion, no backtick escapes; ' doubled.
  assertStringIncludes(
    s,
    "-rulesetFile 'C:\\analysis\\$frozen\\`n it''s\\final code.ruleset.json'",
  );
  assertEquals(s.includes(`"${path}"`), false);
});

const ANALYZER_OUT = [
  "C:\\w\\Core\\src\\C.al(5,9): warning AA0137: The variable 'X' is declared but never used.",
  "C:\\w\\Core\\src\\P.al(2,1): warning AW0006: The page 'P' should have the UsageCategory set.",
  "C:\\w\\Core\\src\\C.al(7,1): error AA0001: There must be exactly one space character.",
  "C:\\w\\Core\\src\\C.al(8,1): error LC0001: lc.",
  "C:\\w\\Core\\src\\C.al(9,1): error UI0001: ui.",
  "C:\\w\\Core\\src\\C.al(10,1): error AL12345: long code.",
  "C:\\w\\Core\\src\\C.al(11,1): warning AL0432: obsolete.",
].join("\n");

Deno.test("parsers: an analysis compile keeps CodeCop and UICop codes", () => {
  const o = { analyzerCodes: true };
  assertEquals(parseCompilationWarnings(ANALYZER_OUT, o).map((x) => x.code), [
    "AA0137",
    "AW0006",
    "AL0432",
  ]);
  assertEquals(parseCompilationErrors(ANALYZER_OUT, o).map((x) => x.code), [
    "AA0001",
    "LC0001",
    "UI0001",
    "AL12345",
  ]);
});

Deno.test("parsers: without analysis the bench parsing is unchanged (generic AL0000, warnings dropped, any AL digit count) (M11-05 run 002)", () => {
  assertEquals(parseCompilationWarnings(ANALYZER_OUT).map((x) => x.code), [
    "AL0432",
  ]);
  assertEquals(
    parseCompilationErrors(ANALYZER_OUT).map((x) => [x.code, x.file]),
    [
      ["AL0000", "unknown"],
      ["AL0000", "unknown"],
      ["AL0000", "unknown"],
      ["AL12345", "C:\\w\\Core\\src\\C.al"],
    ],
  );
});

Deno.test("finalCodeCounts: analysis reaches the compile; a failed app is incomplete", async () => {
  const root = await Deno.makeTempDir();
  const ws = join(root, "ws");
  await write(
    ws,
    "Core/app.json",
    appJson(IDS.core, "CGR Core", [70000, 70099], []),
  );
  await write(ws, "Core/src/C.al", `codeunit 70000 "CGR Core"\n{\n}\n`);
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  bc.warningsFor = () => [w("AA0137")];
  const o = {
    dir: ws,
    apps: await readAppGraph(ws),
    lock: { store: root, packages: [] },
    outDir: join(root, "o1"),
    analysis,
  };
  assertEquals(
    await finalCodeCounts(lane, o),
    counts({
      warnings: 1,
      warning_codes: { AA0137: 1 },
      compiler: bc.compilerId,
    }),
  );
  assertEquals(bc.analysisSeen.at(-1), analysis);
  bc.errorsFor = () => [{
    code: "AL0118",
    message: "x",
    file: "C.al",
    line: 1,
    column: 1,
    severity: "error",
  }];
  const bad = await finalCodeCounts(lane, { ...o, outDir: join(root, "o2") });
  assertEquals([bad.errors, bad.incomplete_apps], [1, ["Core"]]);
});

Deno.test("finalCode: per-code increases; incomplete final has no warning numbers; incomplete start is missing", () => {
  const start = counts({
    warnings: 1,
    warning_codes: { AA0137: 1, AA0072: 2 },
  });
  const end = counts({ warnings: 4, warning_codes: { AA0137: 3, AW0006: 1 } });
  assertEquals(finalCode(start, end), {
    status: "ok",
    value: {
      errors: 0,
      warnings: 4,
      start_errors: 0,
      start_warnings: 1,
      new_warnings: 3,
      new_warning_codes: { AA0137: 2, AW0006: 1 },
      complete: true,
      incomplete_apps: [],
    },
  });
  const part = finalCode(
    start,
    counts({ errors: 2, incomplete_apps: ["Rental"] }),
  );
  assertEquals(
    part.status === "ok" &&
      [part.value.warnings, part.value.new_warnings, part.value.complete],
    [null, null, false],
  );
  assertEquals(
    finalCode(counts({ incomplete_apps: ["Core"] }), end).status,
    "missing",
  );
  assertEquals(
    finalCode(start, counts({ compiler: "other" })).status,
    "missing",
  );
});

Deno.test("canaryCheck: ok only when every expected code appears", async () => {
  const root = await Deno.makeTempDir();
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const o = {
    canaryDir: "harness/analysis/canary",
    lock: { store: root, packages: [] },
    outDir: join(root, "c"),
    analysis,
    expected: ["AA0137"],
  };
  bc.warningsFor = () => [w("AA0137")];
  assertEquals((await canaryCheck(lane, o)).ok, true);
  bc.warningsFor = () => [];
  assertEquals(
    (await canaryCheck(lane, { ...o, outDir: join(root, "c2") })).ok,
    false,
  );
});
