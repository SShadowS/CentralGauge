# SOAP Test Harness — Hybrid Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run non-TestPage AL test codeunits through a headless SOAP web-service harness (~38× faster than `Run-TestsInBcContainer`), while keeping TestPage test codeunits on the existing client-session path.

**Architecture:** A small AL app (`CG Test Harness`, codeunit 50500) is published once per container. It exposes a SOAP operation `RunTests(extensionId, testCodeunitId)` that drives Microsoft's `Test Suite Mgt.` codeunit headlessly and returns a JSON summary. `BcContainerProvider.runTests()` gains a routing fork: if no project test file uses the `TestPage` type, it publishes the app then calls the harness over SOAP; otherwise it falls through to the existing `buildTestScript` path unchanged.

**Tech Stack:** Deno + TypeScript, AL (Business Central 28), bccontainerhelper 6.1.11, SOAP over HTTP (Deno `fetch`).

---

## Background (verified during the 2026-05-14 spike)

- Harness codeunit calls `Test Suite Mgt.` (codeunit 130456): `CreateTestSuite` → `SelectTestMethodsByRange(Format(testCodeunitId))` → `RunAllTests` → `TestResultsToJSON` + `CalcTestResults`. Same isolation runner (130450) as the page path.
- Measured warm: `Run-TestsInBcContainer` ~9.2s vs SOAP harness ~0.24s for the same codeunit.
- **TestPage limit:** a web-service session has no UI/test-service connection. `TestPage.OpenView()/.OpenEdit()` throw `System.NotSupportedException` at `NavSession.CreateNavTestService()`. A TestPage failure via SOAP looks like an ordinary test failure in the JSON — **routing must be decided statically** by scanning test source, never inferred from harness output.
- 12 of 110 test codeunits use `TestPage`: E002 E006 E053 H033 H057 M001 M004 M010 M028 M029 M039 M044.
- Containers are **multi-tenant** — every web-service URL needs `?tenant=<tenant>` (default `default`). Omitting it returns HTTP 401.
- Working spike artifacts live in `spike-ws-test/` (harness source, `measure.ps1`). The harness app source promoted in Task 1 is a copy of `spike-ws-test/harness-app/`.

## File Structure

| File | Responsibility |
|------|----------------|
| `infra/cg-test-harness/app.json` | Harness AL app manifest (fixed app id, depends on Microsoft `Test Runner`) |
| `infra/cg-test-harness/src/WSTestRunner.Codeunit.al` | Codeunit 50500 — headless test runner, returns JSON |
| `infra/cg-test-harness/src/Install.Codeunit.al` | Codeunit 50501 — install trigger registers the `CGTestRunner` SOAP service |
| `src/container/soap-test-client.ts` | NEW — build SOAP envelope, parse SOAP/JSON response → `TestResult`, perform the HTTP call |
| `src/container/test-routing.ts` | NEW — static `TestPage` detection over an `ALProject` |
| `src/container/bc-container-provider.ts` | MODIFY — add `ensureTestHarness()`, fork `runTests()` to the SOAP path |
| `cli/commands/bench/container-setup.ts` | MODIFY — call `ensureTestHarness()` at bench startup, beside `warmupCompilerFolders` |
| `tests/unit/container/soap-test-client.test.ts` | NEW — unit tests for envelope + response parsing |
| `tests/unit/container/test-routing.test.ts` | NEW — unit tests for TestPage detection |
| `.claude/rules/soap-test-harness.md` | NEW — pattern doc for the hybrid path |

---

## Task 1: Promote the harness AL app into the repo

**Files:**
- Create: `infra/cg-test-harness/app.json`
- Create: `infra/cg-test-harness/src/WSTestRunner.Codeunit.al`
- Create: `infra/cg-test-harness/src/Install.Codeunit.al`

- [ ] **Step 1: Create the app manifest**

Create `infra/cg-test-harness/app.json`:

```json
{
  "id": "c0a8f1d2-7e3b-4a90-9c11-c0ffee000001",
  "name": "CG Test Harness",
  "publisher": "CentralGauge",
  "version": "1.0.0.0",
  "brief": "Headless web-service test runner for the CentralGauge benchmark",
  "description": "Exposes a codeunit web service that runs AL test codeunits via Test Suite Mgt. without a UI client session.",
  "platform": "28.0.0.0",
  "application": "28.0.0.0",
  "runtime": "16.0",
  "target": "OnPrem",
  "idRanges": [{ "from": 50500, "to": 50599 }],
  "dependencies": [
    {
      "id": "23de40a6-dfe8-4f80-80db-d70f83ce8caf",
      "name": "Test Runner",
      "publisher": "Microsoft",
      "version": "28.0.0.0"
    }
  ],
  "features": ["NoImplicitWith"]
}
```

- [ ] **Step 2: Create the runner codeunit**

Create `infra/cg-test-harness/src/WSTestRunner.Codeunit.al`:

```al
namespace CentralGauge.TestHarness;

using System.TestTools.TestRunner;

/// <summary>
/// Headless test runner. Builds a fresh AL Test Suite, runs the requested
/// test codeunit through Test Suite Mgt., and returns a JSON summary.
/// Exposed as a codeunit web service by the install codeunit, so callers
/// hit it over SOAP without opening a UI client session.
/// </summary>
codeunit 50500 "CG WS Test Runner"
{
    procedure RunTests(ExtensionId: Text; TestCodeunitId: Integer) ResultJson: Text
    var
        ALTestSuite: Record "AL Test Suite";
        TestMethodLine: Record "Test Method Line";
        CodeunitLine: Record "Test Method Line";
        TestSuiteMgt: Codeunit "Test Suite Mgt.";
        ResultObj: JsonObject;
        CodeunitArr: JsonArray;
        CodeunitTok: JsonToken;
        SuiteName: Code[10];
        StartedAt: DateTime;
        Success: Integer;
        Fail: Integer;
        Skipped: Integer;
        NotExecuted: Integer;
    begin
        StartedAt := CurrentDateTime();

        SuiteName := 'CGWS';
        if ALTestSuite.Get(SuiteName) then
            ALTestSuite.Delete(true);
        TestSuiteMgt.CreateTestSuite(SuiteName);
        ALTestSuite.Get(SuiteName);

        if TestCodeunitId > 0 then
            TestSuiteMgt.SelectTestMethodsByRange(ALTestSuite, Format(TestCodeunitId))
        else
            TestSuiteMgt.SelectTestMethodsByExtension(ALTestSuite, ExtensionId);

        // RunAllTests / CalcTestResults read the "Test Suite" FIELD value, not the
        // filter, so a record must actually be loaded before calling them.
        TestMethodLine.SetRange("Test Suite", SuiteName);
        if not TestMethodLine.FindFirst() then begin
            ResultObj.Add('error', 'no test methods found for the given filter');
            ResultObj.WriteTo(ResultJson);
            exit;
        end;
        TestSuiteMgt.RunAllTests(TestMethodLine);

        TestMethodLine.Reset();
        TestMethodLine.SetRange("Test Suite", SuiteName);
        TestMethodLine.FindFirst();
        TestSuiteMgt.CalcTestResults(TestMethodLine, Success, Fail, Skipped, NotExecuted);

        CodeunitLine.SetRange("Test Suite", SuiteName);
        CodeunitLine.SetRange("Line Type", CodeunitLine."Line Type"::Codeunit);
        if CodeunitLine.FindSet() then
            repeat
                CodeunitTok.ReadFrom(TestSuiteMgt.TestResultsToJSON(CodeunitLine));
                CodeunitArr.Add(CodeunitTok);
            until CodeunitLine.Next() = 0;

        ResultObj.Add('passed', Success);
        ResultObj.Add('failed', Fail);
        ResultObj.Add('skipped', Skipped);
        ResultObj.Add('notExecuted', NotExecuted);
        ResultObj.Add('durationMs', CurrentDateTime() - StartedAt);
        ResultObj.Add('codeunits', CodeunitArr);
        ResultObj.WriteTo(ResultJson);
    end;
}
```

- [ ] **Step 3: Create the install codeunit**

Create `infra/cg-test-harness/src/Install.Codeunit.al`:

```al
namespace CentralGauge.TestHarness;

using System.Integration;

/// <summary>
/// Registers the headless test runner codeunit as a published web service
/// so it is callable over SOAP immediately after install.
/// </summary>
codeunit 50501 "CG WS Harness Install"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        TenantWebService: Record "Tenant Web Service";
    begin
        if TenantWebService.Get(TenantWebService."Object Type"::Codeunit, 'CGTestRunner') then
            exit;

        TenantWebService.Init();
        TenantWebService."Object Type" := TenantWebService."Object Type"::Codeunit;
        TenantWebService."Object ID" := Codeunit::"CG WS Test Runner";
        TenantWebService."Service Name" := 'CGTestRunner';
        TenantWebService.Published := true;
        TenantWebService.Insert(true);
    end;
}
```

- [ ] **Step 4: Commit**

```bash
git add infra/cg-test-harness
git commit -m "feat(infra): add CG Test Harness AL app for headless SOAP test runs"
```

---

## Task 2: SOAP test client — envelope builder + response parser

**Files:**
- Create: `src/container/soap-test-client.ts`
- Test: `tests/unit/container/soap-test-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/container/soap-test-client.test.ts`:

```typescript
import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  buildRunTestsEnvelope,
  parseRunTestsResponse,
} from "../../../src/container/soap-test-client.ts";

Deno.test("buildRunTestsEnvelope embeds codeunit id and namespace", () => {
  const xml = buildRunTestsEnvelope("", 80052);
  assertStringIncludes(xml, "<t:testCodeunitId>80052</t:testCodeunitId>");
  assertStringIncludes(
    xml,
    'xmlns:t="urn:microsoft-dynamics-schemas/codeunit/CGTestRunner"',
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
  const soap =
    `<Soap:Envelope><Soap:Body><RunTests_Result><return_value>` +
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
  const soap =
    `<Soap:Envelope><Soap:Body><RunTests_Result><return_value>` +
    `{"error":"no test methods found for the given filter"}` +
    `</return_value></RunTests_Result></Soap:Body></Soap:Envelope>`;
  assertThrows(
    () => parseRunTestsResponse(soap),
    Error,
    "no test methods found",
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno task test:unit -- --filter "soap-test-client"`
Expected: FAIL — `src/container/soap-test-client.ts` does not exist.

- [ ] **Step 3: Implement the SOAP client**

Create `src/container/soap-test-client.ts`:

```typescript
/**
 * SOAP client for the `CG Test Harness` codeunit web service.
 *
 * The harness runs an AL test codeunit headlessly (no UI client session) and
 * returns a JSON summary. This module builds the SOAP envelope, performs the
 * HTTP call, and maps the response onto the shared `TestResult` shape.
 *
 * NOTE: callers must NOT route TestPage test codeunits here — a web-service
 * session cannot open TestPages. See `test-routing.ts`.
 *
 * @module container/soap-test-client
 */

import type { ContainerCredentials, TestCaseResult, TestResult } from "./types.ts";
import { ContainerError } from "../errors.ts";

const SOAP_NS = "urn:microsoft-dynamics-schemas/codeunit/CGTestRunner";

/** Connection details for one container's harness web service. */
export interface SoapTestRunnerConfig {
  /** Container hostname, e.g. "Cronus28". */
  host: string;
  /** SOAP services port. BC default 7047. */
  port: number;
  /** Company name segment of the web-service URL, e.g. "My Company". */
  company: string;
  /** Tenant id — containers are multi-tenant, this is REQUIRED. */
  tenant: string;
  /** Container credentials (Basic auth). */
  credentials: ContainerCredentials;
}

// AL "Test Method Line".Result option: " ,Failure,Success,Skipped".
const RESULT_FAILURE = 1;
const RESULT_SUCCESS = 2;

interface HarnessTestMethod {
  method: string;
  startTime: string;
  finishTime: string;
  result: number;
  message?: string;
  stackTrace?: string;
}

interface HarnessJson {
  passed?: number;
  failed?: number;
  skipped?: number;
  notExecuted?: number;
  durationMs?: number;
  error?: string;
  codeunits?: Array<{
    codeUnit: number;
    codeunitName: string;
    testResults?: HarnessTestMethod[];
  }>;
}

/** Build the SOAP envelope for `CG WS Test Runner.RunTests`. */
export function buildRunTestsEnvelope(
  extensionId: string,
  testCodeunitId: number,
): string {
  return `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:t="${SOAP_NS}"><soap:Body><t:RunTests>` +
    `<t:extensionId>${extensionId}</t:extensionId>` +
    `<t:testCodeunitId>${testCodeunitId}</t:testCodeunitId>` +
    `</t:RunTests></soap:Body></soap:Envelope>`;
}

/** Decode the five XML predefined entities (BC escapes `<` and `&` in text). */
function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Parse a SOAP response from `RunTests` into a `TestResult`. Throws on SOAP faults. */
export function parseRunTestsResponse(soapXml: string): TestResult {
  const fault = soapXml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/);
  if (fault) {
    throw new Error(`harness SOAP fault: ${xmlUnescape(fault[1]!.trim())}`);
  }

  const rv = soapXml.match(/<return_value>([\s\S]*?)<\/return_value>/);
  if (!rv) {
    throw new Error(
      `harness response missing <return_value>: ${soapXml.slice(0, 400)}`,
    );
  }

  const json = JSON.parse(xmlUnescape(rv[1]!)) as HarnessJson;
  if (json.error) {
    throw new Error(`harness error: ${json.error}`);
  }

  const results: TestCaseResult[] = [];
  for (const cu of json.codeunits ?? []) {
    for (const m of cu.testResults ?? []) {
      const result: TestCaseResult = {
        name: m.method,
        passed: m.result === RESULT_SUCCESS,
        duration: Math.max(
          0,
          new Date(m.finishTime).getTime() - new Date(m.startTime).getTime(),
        ),
      };
      if (m.result === RESULT_FAILURE) {
        result.error = [m.message, m.stackTrace].filter(Boolean).join("\n");
      }
      results.push(result);
    }
  }

  const passedTests = json.passed ?? 0;
  const failedTests = json.failed ?? 0;
  const skipped = json.skipped ?? 0;
  const totalTests = results.length || (passedTests + failedTests + skipped);

  return {
    success: failedTests === 0 && passedTests > 0,
    totalTests,
    passedTests,
    failedTests,
    duration: json.durationMs ?? 0,
    results,
    output: rv[1]!,
  };
}

/** Build the harness web-service URL for a container. */
export function buildHarnessUrl(config: SoapTestRunnerConfig): string {
  const company = encodeURIComponent(config.company);
  return `http://${config.host}:${config.port}/BC/ws/${company}/Codeunit/CGTestRunner` +
    `?tenant=${encodeURIComponent(config.tenant)}`;
}

/**
 * Call the harness over SOAP and return a `TestResult`.
 * `extensionId` may be empty — the harness filters by `testCodeunitId` when it
 * is > 0.
 */
export async function runTestsViaSoap(
  config: SoapTestRunnerConfig,
  testCodeunitId: number,
  extensionId = "",
): Promise<TestResult> {
  const url = buildHarnessUrl(config);
  const auth = btoa(
    `${config.credentials.username}:${config.credentials.password}`,
  );
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": `${SOAP_NS}:RunTests`,
        "Authorization": `Basic ${auth}`,
      },
      body: buildRunTestsEnvelope(extensionId, testCodeunitId),
    });
  } catch (e) {
    throw new ContainerError(
      `harness SOAP call failed: ${e instanceof Error ? e.message : String(e)}`,
      config.host,
      "test",
    );
  }

  const text = await response.text();
  // BC returns HTTP 500 for AL errors but still wraps a SOAP fault in the body;
  // parseRunTestsResponse turns that into a thrown Error with the fault string.
  if (response.status !== 200 && !text.includes("<faultstring")) {
    throw new ContainerError(
      `harness SOAP call HTTP ${response.status}: ${text.slice(0, 400)}`,
      config.host,
      "test",
    );
  }
  return parseRunTestsResponse(text);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno task test:unit -- --filter "soap-test-client"`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Lint + format the new files**

Run: `deno check src/container/soap-test-client.ts tests/unit/container/soap-test-client.test.ts`
Run: `deno lint src/container`
Run: `deno fmt src/container/soap-test-client.ts tests/unit/container/soap-test-client.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/container/soap-test-client.ts tests/unit/container/soap-test-client.test.ts
git commit -m "feat(container): SOAP client for the CG Test Harness web service"
```

---

## Task 3: TestPage routing detection

**Files:**
- Create: `src/container/test-routing.ts`
- Test: `tests/unit/container/test-routing.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/container/test-routing.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { createTempDir, cleanupTempDir } from "../../utils/test-helpers.ts";
import type { ALProject } from "../../../src/container/types.ts";
import { projectUsesTestPage } from "../../../src/container/test-routing.ts";

function project(path: string, testFiles: string[]): ALProject {
  return { path, appJson: {}, sourceFiles: [], testFiles };
}

Deno.test("projectUsesTestPage is true when a test file declares a TestPage", async () => {
  const dir = await createTempDir("routing");
  try {
    const f = `${dir}/CG.Test.al`;
    await Deno.writeTextFile(
      f,
      "codeunit 80006 X { procedure T() var P: TestPage \"Customer Card\"; begin end; }",
    );
    assertEquals(await projectUsesTestPage(project(dir, [f])), true);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("projectUsesTestPage is false for a pure codeunit-logic test", async () => {
  const dir = await createTempDir("routing");
  try {
    const f = `${dir}/CG.Test.al`;
    await Deno.writeTextFile(
      f,
      "codeunit 80052 X { procedure T() var R: Decimal; begin R := 1; end; }",
    );
    assertEquals(await projectUsesTestPage(project(dir, [f])), false);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("projectUsesTestPage ignores the word inside identifiers/comments", async () => {
  const dir = await createTempDir("routing");
  try {
    const f = `${dir}/CG.Test.al`;
    // "TestPageView" is an identifier, "// TestPage" is a comment — neither is a TestPage var.
    await Deno.writeTextFile(
      f,
      "codeunit 80001 X { // TestPage usage avoided\n  var TestPageViewCount: Integer; }",
    );
    assertEquals(await projectUsesTestPage(project(dir, [f])), false);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("projectUsesTestPage tolerates a missing test file", async () => {
  assertEquals(
    await projectUsesTestPage(project("/nope", ["/nope/missing.al"])),
    false,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno task test:unit -- --filter "test-routing"`
Expected: FAIL — `src/container/test-routing.ts` does not exist.

- [ ] **Step 3: Implement the detector**

Create `src/container/test-routing.ts`:

```typescript
/**
 * Decides whether an AL test project can run through the headless SOAP
 * harness, or must use the legacy client-session path.
 *
 * A web-service session cannot open a `TestPage` (it throws
 * `System.NotSupportedException` at `NavSession.CreateNavTestService()`), and
 * such a failure is indistinguishable from a genuine test failure in the
 * harness output — so the decision MUST be made statically from source.
 *
 * @module container/test-routing
 */

import type { ALProject } from "./types.ts";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("container:test-routing");

// Matches a `TestPage` type usage: the keyword preceded by `:` or whitespace
// (a variable/parameter declaration) and followed by whitespace + `"` or an
// identifier char. Excludes identifiers like `TestPageView` and comment text.
const TEST_PAGE_DECL = /(?::|\s)TestPage\s+["A-Za-z]/;

/** True when any test file in the project declares a `TestPage` variable. */
export async function projectUsesTestPage(project: ALProject): Promise<boolean> {
  for (const file of project.testFiles) {
    let source: string;
    try {
      source = await Deno.readTextFile(file);
    } catch (e) {
      log.warn("could not read test file for routing; assuming non-TestPage", {
        file,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    if (TEST_PAGE_DECL.test(source)) {
      log.debug("project uses TestPage; routing to client-session path", {
        file,
      });
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno task test:unit -- --filter "test-routing"`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Lint + format**

Run: `deno check src/container/test-routing.ts tests/unit/container/test-routing.test.ts`
Run: `deno lint src/container`
Run: `deno fmt src/container/test-routing.ts tests/unit/container/test-routing.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/container/test-routing.ts tests/unit/container/test-routing.test.ts
git commit -m "feat(container): static TestPage detection for harness routing"
```

---

## Task 4: Harness deployment — `ensureTestHarness()`

**Files:**
- Modify: `src/container/bc-container-provider.ts` (add a method near `warmupCompilerFolders`, around line 776)

- [ ] **Step 1: Add the harness-deploy method**

In `src/container/bc-container-provider.ts`, add the constant near the other static fields (after `COMPILER_CACHE_DIR`, around line 124):

```typescript
  // Source folder of the CG Test Harness AL app (compiled + published once per
  // container so the SOAP test path is available).
  private static readonly HARNESS_APP_DIR = "infra/cg-test-harness";
  private static readonly HARNESS_APP_NAME = "CG Test Harness";
  private static readonly HARNESS_APP_VERSION = "1.0.0.0";
```

Add this method immediately after `warmupCompilerFolders` (after line 780):

```typescript
  /**
   * Ensure the `CG Test Harness` app is published on each container. Compiles
   * it from `infra/cg-test-harness/` against the container's compiler folder
   * and publishes it, unless the expected name+version is already installed.
   * Idempotent; safe to call at every bench startup.
   */
  async ensureTestHarness(containerNames: string[]): Promise<void> {
    if (!this.isWindows()) return;
    for (const name of containerNames) {
      try {
        const installed = await this.executePowerShell(`
          Import-Module bccontainerhelper -RequiredVersion 6.1.11 -WarningAction SilentlyContinue
          $a = Get-BcContainerAppInfo -containerName "${name}" | Where-Object {
            $_.Name -eq "${BcContainerProvider.HARNESS_APP_NAME}" -and
            $_.Version -eq "${BcContainerProvider.HARNESS_APP_VERSION}"
          }
          if ($a) { Write-Output "HARNESS_PRESENT" } else { Write-Output "HARNESS_ABSENT" }
        `);
        if (installed.output.includes("HARNESS_PRESENT")) {
          log.info(`Test harness already published on ${name}`);
          continue;
        }

        const compilerFolder = await this.getOrCreateCompilerFolder(name);
        const projectDir = BcContainerProvider.HARNESS_APP_DIR;
        const outputDir = `${projectDir}/output`;
        await Deno.mkdir(outputDir, { recursive: true });

        const escapedCompiler = compilerFolder.replace(/\\/g, "\\\\");
        const result = await this.executePowerShell(`
          Import-Module bccontainerhelper -RequiredVersion 6.1.11 -WarningAction SilentlyContinue
          $bcContainerHelperConfig.usePwshForBc24 = $false
          Get-ChildItem "${outputDir}" -Filter *.app -ErrorAction SilentlyContinue | Remove-Item -Force
          $app = Compile-AppWithBcCompilerFolder -compilerFolder "${escapedCompiler}" \`
            -appProjectFolder "${projectDir}" -appOutputFolder "${outputDir}" -ErrorAction Stop
          Publish-BcContainerApp -containerName "${name}" -appFile $app \`
            -skipVerification -sync -syncMode ForceSync -install -ErrorAction Stop
          Write-Output "HARNESS_PUBLISHED:$app"
        `);
        if (!result.output.includes("HARNESS_PUBLISHED:")) {
          throw this.buildPwshError({
            containerName: name,
            operation: "setup",
            message: "Failed to compile/publish CG Test Harness",
            output: result.output,
          });
        }
        log.info(`Test harness published on ${name}`);
      } catch (e) {
        // Non-fatal: runTests() falls back to the legacy path when the harness
        // is unavailable, so a deploy failure must not abort the bench.
        log.warn(`ensureTestHarness failed for ${name}; SOAP path disabled`, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
```

- [ ] **Step 2: Type-check**

Run: `deno check src/container/bc-container-provider.ts`
Expected: no errors.

- [ ] **Step 3: Manual verification against a live container**

Run:
```bash
deno run --allow-all - <<'EOF'
import { BcContainerProvider } from "./src/container/bc-container-provider.ts";
const p = new BcContainerProvider();
await p.ensureTestHarness(["Cronus28"]);
await p.dispose();
EOF
```
Expected: log line `Test harness published on Cronus28` (first run) or `Test harness already published on Cronus28` (subsequent runs). Confirm:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -u 'sshadows:1234' \
  "http://Cronus28:7047/BC/ws/My%20Company/Codeunit/CGTestRunner?tenant=default"
```
Expected: `200`.

- [ ] **Step 4: Commit**

```bash
git add src/container/bc-container-provider.ts
git commit -m "feat(container): ensureTestHarness() compiles+publishes the harness app"
```

---

## Task 5: Hybrid routing in `runTests()`

**Files:**
- Modify: `src/container/bc-container-provider.ts` (the `runTests` method, around lines 1058-1181)

- [ ] **Step 1: Add imports**

At the top of `src/container/bc-container-provider.ts`, after the existing `bc-script-builders.ts` import (line 48), add:

```typescript
import { runTestsViaSoap } from "./soap-test-client.ts";
import type { SoapTestRunnerConfig } from "./soap-test-client.ts";
import { projectUsesTestPage } from "./test-routing.ts";
```

- [ ] **Step 2: Add a private helper that builds the SOAP config**

Add this method to `BcContainerProvider`, immediately before `runTests` (before line 1058):

```typescript
  /**
   * Whether the SOAP harness path is enabled. Disabled by setting
   * `CENTRALGAUGE_SOAP_TEST_RUNNER=0` (escape hatch — falls back to the
   * legacy client-session path for every test).
   */
  private soapTestRunnerEnabled(): boolean {
    return Deno.env.get("CENTRALGAUGE_SOAP_TEST_RUNNER") !== "0";
  }

  /** Build the harness SOAP config for a container from env + credentials. */
  private soapConfigFor(containerName: string): SoapTestRunnerConfig {
    return {
      host: containerName,
      port: Number(Deno.env.get("CENTRALGAUGE_BC_SOAP_PORT") ?? "7047"),
      company: Deno.env.get("CENTRALGAUGE_BC_COMPANY") ?? "My Company",
      tenant: Deno.env.get("CENTRALGAUGE_BC_TENANT") ?? "default",
      credentials: this.getCredentials(containerName),
    };
  }
```

- [ ] **Step 3: Fork `runTests()` to the SOAP path**

In `runTests()`, the current body (after `actualAppFilePath` is resolved and the main app is known) builds `buildTestScript` and runs it through the session. Insert the SOAP fork **after** `actualAppFilePath` is finalized and **before** the existing `// Copy main app to shared folder` block (around line 1089).

Find this block (around lines 1084-1089):

```typescript
    // Extract extensionId from app.json for test filtering
    const appJson = project.appJson as { id?: string };
    const extensionId = appJson.id || "";

    // Copy main app to shared folder accessible by container
```

Replace it with:

```typescript
    // Extract extensionId from app.json for test filtering
    const appJson = project.appJson as { id?: string };
    const extensionId = appJson.id || "";

    // --- Hybrid routing -----------------------------------------------------
    // Non-TestPage codeunits run ~38x faster through the headless SOAP harness.
    // TestPage codeunits must use the legacy client-session path below — a
    // web-service session cannot open a TestPage.
    if (
      this.soapTestRunnerEnabled() &&
      testCodeunitId &&
      !(await projectUsesTestPage(project))
    ) {
      try {
        // The harness only RUNS tests; the app must be published first.
        await this.publishApp(containerName, actualAppFilePath);
        const soapResult = await runTestsViaSoap(
          this.soapConfigFor(containerName),
          testCodeunitId,
          extensionId,
        );
        this.logTestResult(
          soapResult.success,
          soapResult.passedTests,
          soapResult.totalTests,
          contextLog,
        );
        contextLog.debug("Ran tests via SOAP harness", {
          durationMs: soapResult.duration,
        });
        return soapResult;
      } catch (e) {
        // Any harness problem (deploy missing, fault, network) falls back to
        // the legacy path so the bench never loses a test run to the new path.
        contextLog.warn(
          "SOAP harness path failed; falling back to client-session path",
          { error: e instanceof Error ? e.message : String(e) },
        );
      }
    }
    // --- Legacy client-session path (unchanged below) ----------------------

    // Copy main app to shared folder accessible by container
```

Leave the rest of `runTests()` (the `buildTestScript` / `runScriptThroughSession` block and result parsing) exactly as is — it is the fallback and the TestPage path.

- [ ] **Step 4: Type-check, lint, format**

Run: `deno check src/container/bc-container-provider.ts`
Run: `deno lint src/container`
Run: `deno fmt src/container/bc-container-provider.ts`
Expected: no errors.

- [ ] **Step 5: Run the container unit tests**

Run: `deno task test:unit -- --filter "container"`
Expected: PASS — existing container tests stay green (the SOAP fork is skipped when `testCodeunitId` is undefined, which mock-based tests use).

- [ ] **Step 6: Manual A/B verification on a live container**

With the harness published (Task 4) and the E052 candidate app available, run:
```bash
deno run --allow-all - <<'EOF'
import { BcContainerProvider } from "./src/container/bc-container-provider.ts";
const p = new BcContainerProvider();
p.setCredentials("Cronus28", { username: "sshadows", password: "1234" });
const project = {
  path: "spike-ws-test/e006-app",
  appJson: { id: "00000000-cafe-0000-0000-be4c00decade" },
  sourceFiles: [],
  testFiles: ["tests/al/easy/CG-AL-E052.Test.al"], // non-TestPage -> SOAP path
};
const r = await p.runTests("Cronus28", project, undefined, 80052);
console.log("E052 (SOAP path):", r.success, r.passedTests + "/" + r.totalTests, r.duration + "ms");
await p.dispose();
EOF
```
Expected: completes in well under 2s, prints `passed/total` matching a known-good run.

Then verify the TestPage fallback — point `testFiles` at `tests/al/easy/CG-AL-E006.Test.al` and `testCodeunitId` `80006`; expected: takes ~9s (legacy path) and the log shows no "Ran tests via SOAP harness" line.

- [ ] **Step 7: Commit**

```bash
git add src/container/bc-container-provider.ts
git commit -m "feat(container): route non-TestPage test runs through the SOAP harness"
```

---

## Task 6: Wire harness deploy into bench startup

**Files:**
- Modify: `cli/commands/bench/container-setup.ts` (around lines 107-114 and 213-221)

- [ ] **Step 1: Add the per-container call**

In `cli/commands/bench/container-setup.ts`, find the single-container block (around line 112):

```typescript
    if ("warmupCompilerFolders" in containerProvider) {
      await (containerProvider as BcContainerProvider).warmupCompilerFolders([
        containerName,
      ]);
    }
```

Add immediately after it:

```typescript
    if ("ensureTestHarness" in containerProvider) {
      await (containerProvider as BcContainerProvider).ensureTestHarness([
        containerName,
      ]);
    }
```

- [ ] **Step 2: Add the multi-container call**

In the same file, find the multi-container block (around line 219):

```typescript
  if ("warmupCompilerFolders" in containerProvider) {
    await (containerProvider as BcContainerProvider).warmupCompilerFolders(
      containerNames,
    );
  }
```

Add immediately after it:

```typescript
  if ("ensureTestHarness" in containerProvider) {
    await (containerProvider as BcContainerProvider).ensureTestHarness(
      containerNames,
    );
  }
```

- [ ] **Step 3: Type-check + format**

Run: `deno check cli/commands/bench/container-setup.ts`
Run: `deno fmt cli/commands/bench/container-setup.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add cli/commands/bench/container-setup.ts
git commit -m "feat(bench): publish the test harness during container setup"
```

---

## Task 7: Pattern doc + CLAUDE.md note

**Files:**
- Create: `.claude/rules/soap-test-harness.md`
- Modify: `CLAUDE.md` (add a row to the architecture-patterns table)

- [ ] **Step 1: Write the pattern doc**

Create `.claude/rules/soap-test-harness.md`:

```markdown
# SOAP Test Harness (hybrid test execution)

Non-TestPage AL test codeunits run through a headless SOAP web service
(~38x faster than `Run-TestsInBcContainer`); TestPage codeunits stay on the
legacy client-session path.

## Why hybrid

A web-service session has no UI/test-service connection — `TestPage.OpenView()`
throws `System.NotSupportedException` at `NavSession.CreateNavTestService()`.
That failure is indistinguishable from a real test failure in harness output,
so routing is decided **statically** by scanning test source for `TestPage`.

## Components

| File | Role |
|------|------|
| `infra/cg-test-harness/` | AL app — codeunit 50500 drives `Test Suite Mgt.`, exposed as SOAP service `CGTestRunner` |
| `src/container/soap-test-client.ts` | Build envelope, call the service, map JSON -> `TestResult` |
| `src/container/test-routing.ts` | `projectUsesTestPage()` — the routing gate |
| `BcContainerProvider.ensureTestHarness()` | Compile+publish the harness once per container at bench startup |
| `BcContainerProvider.runTests()` | Forks to SOAP for non-TestPage codeunits; legacy path otherwise and as fallback |

## Gotchas

- Containers are multi-tenant — the web-service URL MUST include `?tenant=<tenant>`
  or it returns HTTP 401.
- The harness only RUNS tests; `runTests()` still publishes the app first.
- Escape hatch: `CENTRALGAUGE_SOAP_TEST_RUNNER=0` forces the legacy path.
- Env knobs: `CENTRALGAUGE_BC_COMPANY` (default `My Company`),
  `CENTRALGAUGE_BC_TENANT` (default `default`), `CENTRALGAUGE_BC_SOAP_PORT`
  (default `7047`).
- Any harness failure falls back to the legacy path — the bench never loses a
  run to the new path.
```

- [ ] **Step 2: Add the CLAUDE.md table row**

In `CLAUDE.md`, in the "Architecture Patterns" table (the `.claude/rules/` table), add this row:

```markdown
| SOAP Test Harness | `soap-test-harness.md`     | Hybrid test execution, TestPage routing, headless web-service runner    |
```

- [ ] **Step 3: Commit**

```bash
git add .claude/rules/soap-test-harness.md CLAUDE.md
git commit -m "docs: document the SOAP test harness hybrid path"
```

---

## Task 8: Full verification

- [ ] **Step 1: Run the full unit suite**

Run: `deno task test:unit 2>&1 | tee /tmp/test-unit.log`
Expected: all tests pass, including the new `soap-test-client` and `test-routing` suites.

- [ ] **Step 2: End-to-end dry-run bench (no ingest)**

Run a tiny bench against one container, one model, mixing a non-TestPage and a TestPage task:
```bash
deno task start bench --llms <one-model> --containers Cronus28 --no-ingest \
  --tasks "tasks/easy/CG-AL-E052-totext-method.yml" --tasks "tasks/easy/CG-AL-E006-page-extension.yml"
```
Expected: E052 logs `Ran tests via SOAP harness`; E006 does not (legacy path). Both produce test counts. Total wall time noticeably lower than a pre-change baseline.

- [ ] **Step 3: Confirm the escape hatch**

Run the same bench with `CENTRALGAUGE_SOAP_TEST_RUNNER=0` set.
Expected: neither task logs `Ran tests via SOAP harness`; results unchanged.

- [ ] **Step 4: Clean up spike artifacts**

```bash
git rm -r --cached spike-ws-test 2>/dev/null || true
rm -rf spike-ws-test
```
The harness now lives in `infra/cg-test-harness/`; `spike-ws-test/` is no longer needed.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: remove SOAP harness spike artifacts"
```

---

## Self-Review Notes

- **Spec coverage:** harness app (Task 1), SOAP transport (Task 2), TestPage routing gate (Task 3), per-container deploy (Task 4), `runTests` fork + publish-before-run + fallback (Task 5), bench wiring (Task 6), docs (Task 7), verification incl. escape hatch (Task 8). All spike findings covered.
- **TestPage correctness:** routing is static (Task 3) and the gate is checked before the SOAP branch (Task 5 Step 3) — TestPage codeunits never reach the harness.
- **No silent loss:** every harness failure path in Task 5 Step 3 falls back to the legacy path; `ensureTestHarness` failures are non-fatal (Task 4).
- **Type consistency:** `SoapTestRunnerConfig`, `runTestsViaSoap`, `parseRunTestsResponse`, `projectUsesTestPage` names are identical across Tasks 2, 3, 5. `TestResult`/`TestCaseResult` match `src/container/types.ts` (`success`, `totalTests`, `passedTests`, `failedTests`, `duration`, `results`, `output`; `name`, `passed`, `duration`, `error?`).
- **Open assumption to verify in Task 4 Step 3 / Task 5 Step 6:** the harness web-service company. The plan defaults to `My Company`; if a container's default company differs, set `CENTRALGAUGE_BC_COMPANY`. CentralGauge tests are self-contained (they create their own data), so any company with the test toolkit works.
```
