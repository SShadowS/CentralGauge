import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  buildHarnessUrl,
  buildRunTestsEnvelope,
  DEFAULT_SOAP_TIMEOUT_MS,
  parseRunTestsResponse,
  resolveSoapTimeoutMs,
} from "../../../src/container/soap-test-client.ts";

Deno.test("resolveSoapTimeoutMs", async (t) => {
  await t.step("defaults when absent or blank", () => {
    assertEquals(resolveSoapTimeoutMs(undefined), DEFAULT_SOAP_TIMEOUT_MS);
    assertEquals(resolveSoapTimeoutMs(""), DEFAULT_SOAP_TIMEOUT_MS);
    assertEquals(resolveSoapTimeoutMs("   "), DEFAULT_SOAP_TIMEOUT_MS);
  });
  await t.step("parses a positive value", () => {
    assertEquals(resolveSoapTimeoutMs("5000"), 5000);
    assertEquals(resolveSoapTimeoutMs("  3000  "), 3000);
  });
  await t.step("defaults on non-positive / non-numeric", () => {
    assertEquals(resolveSoapTimeoutMs("0"), DEFAULT_SOAP_TIMEOUT_MS);
    assertEquals(resolveSoapTimeoutMs("-1"), DEFAULT_SOAP_TIMEOUT_MS);
    assertEquals(resolveSoapTimeoutMs("abc"), DEFAULT_SOAP_TIMEOUT_MS);
  });
});

Deno.test("buildRunTestsEnvelope embeds codeunit id and namespace", () => {
  const xml = buildRunTestsEnvelope("", 80052);
  assertStringIncludes(xml, "<t:testCodeunitId>80052</t:testCodeunitId>");
  assertStringIncludes(
    xml,
    'xmlns:t="urn:microsoft-dynamics-schemas/codeunit/CGTestRunner"',
  );
});

Deno.test("buildHarnessUrl encodes company and tenant", () => {
  const url = buildHarnessUrl({
    host: "Cronus28",
    port: 7047,
    company: "My Company",
    tenant: "default",
    credentials: { username: "u", password: "p" },
  });
  assertEquals(
    url,
    "http://Cronus28:7047/BC/ws/My%20Company/Codeunit/CGTestRunner?tenant=default",
  );
});

Deno.test("parseRunTestsResponse maps a passing run to TestResult", () => {
  const soap =
    `<Soap:Envelope xmlns:Soap="http://schemas.xmlsoap.org/soap/envelope/"><Soap:Body>` +
    `<RunTests_Result xmlns="urn:microsoft-dynamics-schemas/codeunit/CGTestRunner"><return_value>` +
    `{"passed":2,"failed":0,"skipped":0,"notExecuted":0,"durationMs":150,"codeunits":[` +
    `{"codeUnit":80052,"codeunitName":"CG Test","testResults":[` +
    `{"method":"TestA","startTime":"2026-05-14T19:20:03.700Z","finishTime":"2026-05-14T19:20:03.900Z","result":2},` +
    `{"method":"TestB","startTime":"2026-05-14T19:20:03.900Z","finishTime":"2026-05-14T19:20:04.000Z","result":2}]}]}` +
    `</return_value></RunTests_Result></Soap:Body></Soap:Envelope>`;
  const r = parseRunTestsResponse(soap);
  assertEquals(r.success, true);
  assertEquals(r.totalTests, 2);
  assertEquals(r.passedTests, 2);
  assertEquals(r.failedTests, 0);
  assertEquals(r.duration, 150);
  assertEquals(r.results.length, 2);
  assertEquals(r.results[0]!.name, "TestA");
  assertEquals(r.results[0]!.passed, true);
});

Deno.test("parseRunTestsResponse maps failures with XML-escaped messages", () => {
  const soap = `<Soap:Envelope><Soap:Body><RunTests_Result><return_value>` +
    `{"passed":0,"failed":1,"skipped":0,"notExecuted":0,"durationMs":40,"codeunits":[` +
    `{"codeUnit":80006,"codeunitName":"CG Test","testResults":[` +
    `{"method":"TestX","startTime":"2026-05-14T00:00:00.000Z","finishTime":"2026-05-14T00:00:00.040Z","result":1,` +
    `"message":"Assert failed: a &lt; b &amp; c","stackTrace":"Codeunit 80006 line 3"}]}]}` +
    `</return_value></RunTests_Result></Soap:Body></Soap:Envelope>`;
  const r = parseRunTestsResponse(soap);
  assertEquals(r.success, false);
  assertEquals(r.failedTests, 1);
  assertEquals(r.results[0]!.passed, false);
  assertStringIncludes(r.results[0]!.error ?? "", "a < b & c");
});

Deno.test("parseRunTestsResponse throws on a SOAP fault", () => {
  const soap =
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>` +
    `<faultcode>a:FailedAuthentication</faultcode>` +
    `<faultstring xml:lang="en-US">The server has rejected the client credentials.</faultstring>` +
    `</s:Fault></s:Body></s:Envelope>`;
  assertThrows(
    () => parseRunTestsResponse(soap),
    Error,
    "rejected the client credentials",
  );
});

Deno.test("parseRunTestsResponse throws when the harness reports no test methods", () => {
  const soap = `<Soap:Envelope><Soap:Body><RunTests_Result><return_value>` +
    `{"error":"no test methods found for the given filter"}` +
    `</return_value></RunTests_Result></Soap:Body></Soap:Envelope>`;
  assertThrows(
    () => parseRunTestsResponse(soap),
    Error,
    "no test methods found",
  );
});
