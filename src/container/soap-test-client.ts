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

/**
 * Default cap on the harness SOAP call. The harness test execution is
 * sub-second to a few seconds in practice (observed p99 ~1s, max ~3s), so this
 * is ~40x headroom — its only job is to bound an unresponsive web service so
 * the call cannot hang indefinitely. On timeout `runTestsViaSoap` throws a
 * `ContainerError`; `runTests()` classifies it as infra (`reroute_infra`) and
 * reroutes the task to a HEALTHY container — it does NOT fall back to the
 * legacy client-session path on the same container (see `decideSoapFailureAction`
 * / `soap-test-harness.md`: falling back there would run a second concurrent
 * publish+test against an already-degraded container). Override with
 * `CENTRALGAUGE_SOAP_TIMEOUT_MS`.
 */
export const DEFAULT_SOAP_TIMEOUT_MS = 120_000;

/**
 * Resolve the SOAP request timeout (ms) from a raw env value, falling back to
 * {@link DEFAULT_SOAP_TIMEOUT_MS} for absent / non-numeric / non-positive
 * input. Pure + exported for testing.
 */
export function resolveSoapTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_SOAP_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SOAP_TIMEOUT_MS;
}

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
  /** Request timeout in ms. Defaults to {@link DEFAULT_SOAP_TIMEOUT_MS}. */
  timeoutMs?: number;
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
  // `extensionId` is a GUID (or empty) and `testCodeunitId` an integer, so no
  // XML escaping is needed; the harness ignores extensionId when testCodeunitId > 0.
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

  const decoded = xmlUnescape(rv[1]!);
  const json = JSON.parse(decoded) as HarnessJson;
  if (json.error) {
    throw new Error(`harness error: ${json.error}`);
  }

  const results: TestCaseResult[] = [];
  for (const cu of json.codeunits ?? []) {
    for (const m of cu.testResults ?? []) {
      // result codes: 1=Failure, 2=Success, 3=Skipped. Skipped maps to
      // passed:false here for the per-method detail; the totals above count
      // it under `skipped`, not `failedTests`.
      // `Math.max(0, NaN)` is `NaN` (Math.max propagates any NaN operand), so
      // an unparseable start/finish timestamp must be guarded explicitly —
      // otherwise it poisons this per-method duration (the authoritative
      // summary counts/duration come from the harness totals above, unaffected).
      const rawDuration = new Date(m.finishTime).getTime() -
        new Date(m.startTime).getTime();
      const result: TestCaseResult = {
        name: m.method,
        passed: m.result === RESULT_SUCCESS,
        duration: Number.isFinite(rawDuration) ? Math.max(0, rawDuration) : 0,
      };
      if (m.result === RESULT_FAILURE) {
        result.error = [m.message, m.stackTrace].filter(Boolean).join("\n");
      }
      results.push(result);
    }
  }

  // Counts come from the harness summary (AL `CalcTestResults`, authoritative).
  // `results` carries per-method detail; its length always equals the sum
  // because the harness emits one entry per test function line.
  const passedTests = json.passed ?? 0;
  const failedTests = json.failed ?? 0;
  const skipped = json.skipped ?? 0;
  const totalTests = passedTests + failedTests + skipped;

  return {
    // `passedTests > 0` guards against a codeunit where nothing actually ran
    // (empty / all-skipped) being reported as a pass — matches the legacy
    // parser's `totalTests > 0` requirement in bc-output-parsers.ts.
    success: failedTests === 0 && passedTests > 0,
    totalTests,
    passedTests,
    failedTests,
    duration: json.durationMs ?? 0,
    results,
    output: decoded,
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
  const timeoutMs = config.timeoutMs ?? DEFAULT_SOAP_TIMEOUT_MS;
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
      // Bound the call so an unresponsive web service can't hang indefinitely.
      // On timeout the fetch rejects; we wrap it below as a ContainerError,
      // which runTests()/decideSoapFailureAction classifies as infra and
      // reroutes to a HEALTHY container (reroute_infra) — NOT a fallback to
      // the legacy path on this same (possibly degraded) container.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    throw new ContainerError(
      timedOut
        ? `harness SOAP call timed out after ${timeoutMs}ms`
        : `harness SOAP call failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      config.host,
      "test",
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch (e) {
    throw new ContainerError(
      `harness SOAP response read failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
      config.host,
      "test",
    );
  }
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
