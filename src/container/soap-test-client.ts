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

import type {
  ContainerCredentials,
  TestCaseResult,
  TestResult,
} from "./types.ts";
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
