# SOAP Test Harness (hybrid test execution)

Non-TestPage AL test codeunits run through a headless SOAP web service
(~38x faster than `Run-TestsInBcContainer`); TestPage codeunits stay on the
legacy client-session path.

## Why hybrid

A web-service session has no UI/test-service connection — `TestPage.OpenView()`
throws `System.NotSupportedException` at `NavSession.CreateNavTestService()`.
That failure is indistinguishable from a real test failure in harness output,
so routing is decided **statically** by parsing test source with the tree-sitter-al grammar.

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
