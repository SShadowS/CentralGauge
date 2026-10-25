/** Q-06: the opt-in measuring SOAP path (endpoint, envelope, parsing, default unchanged). */
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  buildHarnessUrl,
  buildRunTestsEnvelope,
  parseMeasureResponse,
  parseRunTestsResponse,
  runTestsViaSoap,
} from "../../../src/container/soap-test-client.ts";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import { buildSqlMeasureCompileScript } from "../../../src/container/bc-script-builders.ts";

const config = {
  host: "Cronus28",
  port: 7047,
  company: "My Company",
  tenant: "default",
  credentials: { username: "u", password: "p" },
};

const results = {
  passed: 1,
  failed: 0,
  skipped: 0,
  notExecuted: 0,
  durationMs: 12,
  codeunits: [{
    codeUnit: 85001,
    codeunitName: "T",
    testResults: [{
      method: "TestA",
      startTime: "2026-01-01T00:00:00Z",
      finishTime: "2026-01-01T00:00:01Z",
      result: 2,
    }],
  }],
};
const measurement = {
  codeunitId: 85001,
  functionName: "TestA",
  statements: 7,
  ms: 31,
  isSuccess: true,
};

const soap = (json: unknown) =>
  `<s:Envelope><s:Body><RunTests_Result><return_value>${
    JSON.stringify(json).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  }</return_value></RunTests_Result></s:Body></s:Envelope>`;

Deno.test("measure endpoint and envelope differ from the normal ones", () => {
  assertStringIncludes(buildHarnessUrl(config), "/Codeunit/CGTestRunner?");
  assertStringIncludes(
    buildHarnessUrl(config, true),
    "/Codeunit/CGSqlMeasure?tenant=default",
  );
  assertStringIncludes(
    buildRunTestsEnvelope("", 85001),
    "codeunit/CGTestRunner",
  );
  const m = buildRunTestsEnvelope("", 85001, true);
  assertStringIncludes(m, "codeunit/CGSqlMeasure");
  assertStringIncludes(m, "<t:testCodeunitId>85001</t:testCodeunitId>");
});

Deno.test("parseMeasureResponse: results equal the normal parse, measurements kept", () => {
  const r = parseMeasureResponse(
    soap({ results, measurements: [measurement] }),
  );
  const normal = parseRunTestsResponse(soap(results));
  assertEquals(r.results, normal);
  assertEquals(r.measurements, [
    {
      codeunit: 85001,
      procedure: "TestA",
      statements: 7,
      ms: 31,
      success: true,
    },
  ]);
});

Deno.test("parseMeasureResponse: malformed measurements throw", () => {
  assertThrows(() => parseMeasureResponse(soap({ results })), Error);
  assertThrows(
    () =>
      parseMeasureResponse(
        soap({
          results,
          measurements: [{ ...measurement, statements: "7" }],
        }),
      ),
    Error,
    "statements",
  );
  assertThrows(
    () =>
      parseMeasureResponse(
        soap({ results: { error: "boom" }, measurements: [] }),
      ),
    Error,
    "boom",
  );
});

function stubFetch(body: unknown) {
  const calls: { url: string; action: string; body: string }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    calls.push({
      url: String(url),
      action: (init!.headers as Record<string, string>)["SOAPAction"]!,
      body: String(init!.body),
    });
    return Promise.resolve(new Response(soap(body), { status: 200 }));
  };
  return { calls, restore: () => (globalThis.fetch = orig) };
}

Deno.test("runTestsViaSoap: default posts to CGTestRunner and returns no measurements", async () => {
  const s = stubFetch(results);
  try {
    const r = await runTestsViaSoap(config, 85001, "");
    assertEquals(s.calls.length, 1);
    assertStringIncludes(s.calls[0]!.url, "/Codeunit/CGTestRunner?");
    assertStringIncludes(s.calls[0]!.action, "CGTestRunner:RunTests");
    assertEquals("measurements" in r, false);
    assertEquals(r.passedTests, 1);
  } finally {
    s.restore();
  }
});

Deno.test("runTestsViaSoap: measure posts to CGSqlMeasure and returns both parts", async () => {
  const s = stubFetch({ results, measurements: [measurement] });
  try {
    const r = await runTestsViaSoap(config, 85001, "", true);
    assertStringIncludes(s.calls[0]!.url, "/Codeunit/CGSqlMeasure?");
    assertStringIncludes(s.calls[0]!.action, "CGSqlMeasure:RunTests");
    assertEquals(r.measurements?.length, 1);
    assertEquals(r.passedTests, 1);
  } finally {
    s.restore();
  }
});

Deno.test("measure app build: from a cold symbol cache the pinned harness package is built and staged into the measure compile's symbols folder before that compile", () => {
  // A fresh work folder: an empty symbols folder, and a compiler folder whose
  // symbols are the artifact apps only (no CG Test Harness).
  const s = buildSqlMeasureCompileScript({
    compilerFolder: "C:\\cache\\Cronus28",
    harnessProject: "U:\\repo\\infra\\cg-test-harness",
    measureProject: "U:\\repo\\infra\\cg-sql-measure",
    work: "H:\\work\\m1",
  });
  const harnessCompile = s.indexOf(
    "-appProjectFolder 'U:\\repo\\infra\\cg-test-harness'",
  );
  const stage = s.indexOf(
    "Copy-Item -LiteralPath $cgHarness -Destination $cgSymbols",
  );
  const measureCompile = s.indexOf(
    "-appProjectFolder 'U:\\repo\\infra\\cg-sql-measure'",
  );
  assertEquals(harnessCompile > 0, true, "the harness is compiled");
  assertEquals(stage > harnessCompile, true, "then staged");
  assertEquals(measureCompile > stage, true, "before the measure compile");
  // the measure compile reads exactly the staged folder, never the project's .alpackages
  assertStringIncludes(s, "$cgSymbols = 'H:\\work\\m1\\symbols'");
  assertStringIncludes(
    s.slice(measureCompile),
    "-appSymbolsFolder $cgSymbols",
  );
  assertEquals(s.includes(".alpackages"), false);
  // a fresh, emptied symbols folder: nothing stale satisfies the dependency
  assertStringIncludes(s, "Remove-Item -LiteralPath $cgSymbols -Recurse");
  // the staged package is checked to exist before the compile uses it
  assertStringIncludes(s, "MEASURE_HARNESS_STAGED:");
  assertStringIncludes(s, "MEASURE_BUILT:");
  // escaping: a quote in a path cannot break out of the PS string
  const q = buildSqlMeasureCompileScript({
    compilerFolder: "C:\\c",
    harnessProject: "U:\\a'b\\h",
    measureProject: "U:\\m",
    work: "H:\\w",
  });
  assertStringIncludes(q, "'U:\\a''b\\h'");
});

Deno.test("measure app AL: the store records only while the runner has it on, and the runner switches it off after the run, a failed run included", async () => {
  const src = (f: string) =>
    Deno.readTextFile(
      new URL(`../../../infra/cg-sql-measure/src/${f}`, import.meta.url),
    );
  const store = await src("Store.Codeunit.al");
  // the event signatures stay exactly as they are
  for (
    const sig of [
      'local procedure OnBeforeTestMethodRun(var CurrentTestMethodLine: Record "Test Method Line"; CodeunitID: Integer; CodeunitName: Text[30]; FunctionName: Text[128]; FunctionTestPermissions: TestPermissions; var Skip: Boolean)',
      'local procedure OnAfterTestMethodRun(var CurrentTestMethodLine: Record "Test Method Line"; CodeunitID: Integer; CodeunitName: Text[30]; FunctionName: Text[128]; FunctionTestPermissions: TestPermissions; IsSuccess: Boolean)',
    ]
  ) {
    const at = store.indexOf(sig);
    assertEquals(at > 0, true, sig);
    // the first statement of each subscriber is the gate
    const body = store.slice(at).split("begin")[1]!;
    assertEquals(body.trimStart().startsWith("if not Active then"), true);
  }
  const runner = (await src("Runner.Codeunit.al")).replace(/\r/g, "");
  const on = runner.indexOf("Store.SetActive(true);");
  const run = runner.indexOf("Ok := HarnessRun.Run();");
  const off = runner.indexOf("Store.SetActive(false);");
  const raise = runner.indexOf("if not Ok then");
  assertEquals(on > 0 && on < run && run < off && off < raise, true);
  // the harness call itself is inside the Codeunit.Run target
  assertStringIncludes(
    await src("HarnessRun.Codeunit.al"),
    "RunResult := Harness.RunTests(RunExtensionId, RunTestCodeunitId);",
  );
});

Deno.test("measure app AL: every file declares a namespace first, so its using directives apply (AL0789 ignores them otherwise)", async () => {
  const dir = new URL("../../../infra/cg-sql-measure/src/", import.meta.url);
  let files = 0;
  for await (const e of Deno.readDir(dir)) {
    if (!e.name.endsWith(".al")) continue;
    files++;
    const text = (await Deno.readTextFile(new URL(e.name, dir))).replace(
      /\r/g,
      "",
    );
    assertEquals(
      /^namespace [\w.]+;\n/.test(text),
      true,
      `${e.name}: first line is a namespace declaration`,
    );
  }
  assertEquals(files >= 4, true);
});

Deno.test("provider.runHarnessTests: measure is refused when the SOAP path is off", async () => {
  const prev = Deno.env.get("CENTRALGAUGE_SOAP_TEST_RUNNER");
  Deno.env.set("CENTRALGAUGE_SOAP_TEST_RUNNER", "0");
  try {
    await assertRejects(
      () =>
        new BcContainerProvider().runHarnessTests("Cronus28", 85001, {
          measure: true,
        }),
      Error,
      "measure",
    );
  } finally {
    if (prev === undefined) Deno.env.delete("CENTRALGAUGE_SOAP_TEST_RUNNER");
    else Deno.env.set("CENTRALGAUGE_SOAP_TEST_RUNNER", prev);
  }
});
