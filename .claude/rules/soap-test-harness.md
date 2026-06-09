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

| File                                      | Role                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `infra/cg-test-harness/`                  | AL app — codeunit 50500 drives `Test Suite Mgt.`, exposed as SOAP service `CGTestRunner` |
| `src/container/soap-test-client.ts`       | Build envelope, call the service, map JSON -> `TestResult`                               |
| `src/container/test-routing.ts`           | `projectUsesTestPage()` — the routing gate                                               |
| `BcContainerProvider.ensureTestHarness()` | Compile+publish the harness once per container at bench startup                          |
| `BcContainerProvider.runTests()`          | Forks to SOAP for non-TestPage codeunits; legacy path otherwise and as fallback          |

## Gotchas

- Containers are multi-tenant — the web-service URL MUST include `?tenant=<tenant>`
  or it returns HTTP 401.
- The harness only RUNS tests; `runTests()` still publishes the app first.
- **Path is ON by default** (2026-05-15, after Phase 2 of
  `BenchBattleplan.md`). Opt out via `CENTRALGAUGE_SOAP_TEST_RUNNER=0`.
  Mini bench A+C: legacy 1 h 1 m → SOAP 29 m 29 s on 2 models × 3 tasks ×
  2 containers (-52 %). Projected benchsmall ~3.5-4 h.
- Pre-publish cleanup + new candidate publish go through
  `BcContainerProvider.prepareCandidateApp()` — one warm-slot script that
  routes cleanup via `Invoke-ScriptInBcContainer { Uninstall-NAVApp;
  Unpublish-NAVApp }` (direct in-container, ~4 s) and then runs
  `Publish-BcContainerApp -sync -syncMode ForceSync -install` in the
  same script. ONE BCH bridge setup, not two.
- Env knobs: `CENTRALGAUGE_BC_COMPANY` (default `My Company`),
  `CENTRALGAUGE_BC_TENANT` (default `default`), `CENTRALGAUGE_BC_SOAP_PORT`
  (default `7047`).
- **Infra failures REROUTE, they do NOT fall back to legacy.** `runTests()`
  classifies a SOAP failure via `decideSoapFailureAction`:
  - `score_model` — deterministic model publish/install/schema defect.
  - `fallback_legacy` — duplicate-object COLLISION (needs legacy's broader
    cleanup) or a genuinely unknown non-infra error.
  - `reroute_infra` — ANY infra failure (SOAP timeout, HTTP 401, SQL
    "wait operation timed out", PSSession/network) -> throws `ContainerError`
    so the inline infra-retry reroutes to a HEALTHY container.
  Why: on a SOAP timeout the aborted host fetch sends NO server-side
  cancellation, so the AL test keeps running in the NST. Falling back to legacy
  then ran a SECOND concurrent publish+test on the same container, exhausting
  the in-container SQLEXPRESS worker pool ("TCP Provider, error: 0 - The wait
  operation timed out") — a progressive death spiral. Legacy is also frequently
  broken on these containers (PsTestTool SYSLIB0014). Confirmed via GPT-5.5 +
  Gemini 3.1 Pro review.
- **Periodic light NST maintenance** counters the durable in-container SQL
  pressure (per-task `ForceSync` plan-cache churn + session buildup). Set
  `CENTRALGAUGE_NST_MAINTAIN_EVERY=N` (default 0 = off): every N tasks per
  container, between tasks (test mutex released), the provider runs — WITHOUT an
  NST restart — `Invoke-ScriptInBcContainer { Remove-NAVServerSession <stale
  web-service>; DBCC FREEPROCCACHE }` via the warm slot. Best-effort; never
  aborts a task. `BcContainerProvider.maybeMaintainNst`.
