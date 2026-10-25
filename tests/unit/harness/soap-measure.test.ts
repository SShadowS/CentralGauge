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
