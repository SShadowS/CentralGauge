# Harness Bench Core, Part 2 (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the findings-dependent half of Harness Bench M1: the hostile-artifact copy boundary, refapp staging and the symbols lock, verdict-workspace reconstruction, candidate-scoped BC app sync, the four scorers, the `cg-al` backend, the Windows sandbox runtime, the mock harness, the execution pipeline with retries, the campaign runner with staged runs, and the `harness run / cell / rejudge / images build / symbols lock` commands.

**Architecture:** More small files under `src/harness/`, each with one job, on top of Part 1's records, hashes, manifests and statistics. Everything that touches Docker or a BC container sits behind two narrow seams, `HarnessBc` (the `BcContainerProvider` methods the harness calls) and `DockerCli` (four docker verbs), so every unit test runs with fakes and no container. Real-container behavior is proven by separate lane-ops tasks (M1-26 to M1-30) that write evidence files.

**Tech Stack:** Deno + TypeScript, Zod 4, `@std/path`, `@std/fs`, `@std/fmt/colors`, Cliffy `@cliffy/command@1.2.1`, git and `tar` on PATH, Docker Desktop (Windows containers) and bccontainerhelper 6.1.14 for the ops tasks only.

**Spec:** `docs/superpowers/specs/2026-09-24-harness-bench-design.md` (1a, as edited by M0-08), `docs/superpowers/specs/2026-09-24-harness-refapp-design.md` (1b), findings `docs/superpowers/specs/2026-09-29-harness-spikes-findings.md` (section 8 is binding). Carryover decisions: `H:\cg-coord\decisions\2026-09-25-accept-M0-02.md`, `-accept-M0-03.md`, `-accept-M0-05.md`, `-secrets-accepted-risk.md`, `-m1-metric-rules.md`, `-accept-M0-01.md`. Part 1: `docs/superpowers/plans/2026-09-30-harness-core.md` (revision 2; its "Contracts frozen now for Part 2" section is the interface this plan produces against).

**Status of the code in this plan.** Written against Part 1 revision 2 as of 2026-09-25 while Part 1 was still being revised; it has not been executed. The tests are the contract. When a Part 1 name or signature moved at merge time, follow Part 1 and adjust the call site, never the test's intent.

## Global Constraints

- Lanes: every code task is lane-infra and never touches Docker or a BC container. Every step that needs Docker or a BC container is a lane-ops task (M1-26 to M1-30) with an evidence file. An infra test that would need one uses `FakeBc` / `FakeDocker` instead.
- Unit tests live in `tests/unit/harness/` (never `tests/unit/container/`, which the bench guard blocks and which touches real containers). Run them as `deno test --allow-all <file>`. Never `--parallel`. Never the full `deno task test:unit` while a bench is live (`find results/.bench-running.json -mmin -2` prints a path).
- Subprocess mocks follow Deno 2.8: `Object.defineProperty(Deno, "Command", { value: Mock, configurable: true })` via `tests/utils/command-mock.ts`, never `Deno.Command = Mock`. `CommandMock` has no `spawn()`, so code that spawns goes behind `DockerCli` and is faked, not command-mocked.
- After each task: `deno check`, `deno lint`, `deno fmt` on that task's files only (CRLF/LF drift). Never `deno fmt` under `site/`.
- Zod 4 idioms and `exactOptionalPropertyTypes` exactly as Part 1 (`z.strictObject`, `x?: T | undefined`).
- Import order (CLAUDE.md): `@std/...`, third-party, project type imports, project implementation imports, relative imports.
- Console output: `@std/fmt/colors` with `[OK]` / `[FAIL]` / `[WARN]` / `[PAUSE]` tags, never emoji. No em dash in any committed text.
- Model ids are never hardcoded. The mock arm has no models.
- Secrets (M0-03 carryover a, secrets accepted-risk): never in any argv, never in `docker run -e`, never in an image layer. They reach the sandbox only as files in a per-execution read-only `C:\cg-secrets` mount, and every captured log is scanned for their exact values before it is kept.
- Sandboxes (M0-03 carryover b): container creation and capture-file opening happen inside the protected `try`; `docker rm -f` exit status is checked; startup removes leftover containers named `cg-harness-*` that carry this host's owner label.
- `prepareCandidateApp` is never used for harness apps and never split. Harness app cleanup and publish go through one new warm-slot script per call (`syncHarnessApps`), scoped to candidate app ids (bc-container-quirks.md, M0-02 carryover).
- Every Windows-container subprocess the harness spawns sets `DOCKER_CONTEXT` through `dockerContextEnv()` (`src/container/docker-context.ts`). Ad-hoc operator commands in ops tasks are prefixed with `DOCKER_CONTEXT=desktop-windows`.
- `acquireBenchLock` (`src/utils/bench-lock.ts`, dir `results`) is held for every harness command that touches containers, so a bench and a harness run never share containers.
- Latency is measured with `performance.now()` (monotonic), never `Date.now()` differences (M0-05 carryover). Wall-clock ISO timestamps are only for records.
- Records stay Part 1's immutable, write-once records. Anything Part 1's schemas do not carry (sandbox result, verdict spans, host call log) goes into side files under `results/harness/runs/<execution-id>/` and `results/harness/verdicts/<judgment-id>.json`, not into new record fields.
- ID bands (1b section 4): refapp 70000-74999, visible tests 80000-84999, hidden oracles 85000-89999, 75000-79999 reserved.
- Window: infra 2026-10-01 to 10-08 (15 tasks); ops tasks as their dependencies land. After the last infra task run `graphify update .`.

## Review Focus

1. **A crashed or killed runner leaves a sandbox container behind,** and the next run collides on its name or runs next to it. Expected: startup removes every `cg-harness-*` container with this host's owner label and refuses to start if one cannot be removed; foreign containers are untouched. Pinned in M1-20 (`sweep removes only owned containers and fails loudly when one survives`) and M1-29 step 6.
2. **An agent edits a low-level app (Core) and only that app is republished,** so dependents run against stale symbols or the publish fails on a dependency version. Expected: the changed app, every transitive dependent and Test are candidates; unchanged apps stay installed as prerequisites. Pinned in M1-15 (`candidateFolders: changed apps, their dependents and Test`, `refapp dependency apps stay installed`).
3. **Another product's app on a shared container defines the same object id** (Cronus28's Continia stack defines codeunit 80013, memory note), and the candidate publish failure is scored as the agent's fault. Expected: a collision is infra and reroutes to another container. Pinned in M1-16 (`a collision on publish is infra and reroutes`).
4. **An agent leaves a huge or link-filled workspace** (a junction to `C:\`, 100k files), and freezing either follows the link or runs the host out of disk. Expected: links are refused and never followed, size is capped, both become a hashed violation that fails the build scorer. Pinned in M1-12 (`links and oversize become a hashed violations marker`) and M1-14 (`freeze violations and unknown dependencies fail validation`).
5. **A provider secret reaches a stored log or the docker argv.** Expected: a secret value in argv or `-e` aborts before `docker run`; every stored log has exact secret values replaced. Pinned in M1-20 (`a secret in argv or env is refused before docker run`, `redaction replaces every occurrence`) and M1-22 (`captured logs are redacted before they are kept`).

## Reuse

Reused as-is:
- Part 1 `src/harness/*`: `hashTree`, `listTree`, `hashFile`, `hashJson`, `isTaskBuildArtifact` (hash.ts); `loadTask`, `loadTaskSet`, `LoadedTask` (task.ts); `resolveRefapp`, `RefappRef`, `REFAPP_PATH`, `SymbolsLockSchema`, `SymbolPackage`, `SYMBOLS_LOCK_PATH`, `loadSymbolsLock`, `agentVisibleMetadata`, `oracleHash`, `taskSetIdentity` (identity.ts); `loadExperiment`, `checkModelsInCatalog`, `HarnessConfig` (config.ts); `resolveManifest`, `forTask`, `manifestHash`, `assertVaryHolds`, `RuntimeFacts`, `ResolvedManifest` (manifest.ts); all record schemas, `planBlocks`, `experimentHash`, `RecordStore` (records.ts); `validateCampaignRecords` (integrity.ts); `outcomePolicy`, `cellsFromRecords`, `campaignJudging`, `selectJudgment` (outcome.ts); `buildReport`, `renderReport`, `armSummary` (report.ts, stats.ts); `registerHarnessCommand` (harness-command.ts).
- `src/container/bc-container-provider.ts`: `compileProject` (host-side compile through the container's compiler folder, infra errors propagate), the private `runScriptThroughSession` warm slot, `buildPwshError`, `getCredentials`, `soapConfigFor`, `ensureTestHarness`, `setCredentials`, `dispose`.
- `src/container/bc-script-builders.ts`: `bcchImport`, `bcchConfigInit`, `buildPwshTraceHelper`, `escapeForPS`.
- `src/container/soap-test-client.ts`: `runTestsViaSoap` (the SOAP runner M0-02 measured at 89-154 ms for 5 tests).
- `src/health/classify-publish-failure.ts`: `classifyPublishFailure`, `isCollisionPublishFailure`; `src/health/is-infra-error.ts`: `isInfraError`.
- `src/parallel/infra-retry.ts` `withInfraRetry` (generic `RetryOperation<T>`), `src/parallel/semaphore.ts` `Mutex`, `src/parallel/errors.ts` `NoEligibleContainersError`, `InfraRetriesExhaustedError`.
- `src/container/docker-context.ts` `dockerContextEnv`; `src/sandbox/windows-provider.ts` `buildBindMountArg` (comma/illegal-character checks for `--mount`).
- `src/utils/bench-lock.ts` `acquireBenchLock`; `cli/commands/bench/container-setup.ts` `setupContainers` (credentials, health check, compiler cache, test harness); `src/config/config.ts` `ConfigManager.loadConfig`.
- `src/constants.ts` `BENCHMARK_APP_ID_BUFFER`; `scripts/id-audit.ts` structure.
- Spike code is read, never imported: `scripts/spikes/harness/run-sandbox.ts` (capture shape), `backend-spike.ts` (endpoint shape), `multiapp-timing.ts` (compile order with dependency `.app` files in `.alpackages`), `image/Dockerfile.windows` (node 22.19.0 + PortableGit layers), `image/cg-al.ps1`.

Deliberately not reused:
- `CompileQueuePool` / `CompileQueue`: typed to LLM `CompileWorkItem` (generated code string, `llmResponse`) and to one-candidate publish via `prepareCandidateApp`. The harness needs multi-app sync and per-procedure results. `BcLane` (M1-16) keeps the parts D12 cares about: fixed per-container concurrency, queue-wait measurement, `withInfraRetry` rerouting with the optional health monitor. Open question 2.
- `prepareCandidateApp`, `publishApp`, `cleanupStaleCandidates`, `runTests`: their cleanup removes every non-`*Prereq*` CentralGauge app, which uninstalls the refapp dependencies (findings section 2, M0-02 carryover), and `publishApp` skips a same-version republish, which would keep a stale prerequisite.
- `WindowsSandboxProvider`: it starts a sleeping container and `docker exec`s into it, passes `-e` env, and has no owner label or checked removal. The harness runs the image's own entrypoint once with stdout captured (M0-03 shape).
- `mcp/al-tools-server.ts`: binds `0.0.0.0` with a token and a workspace map; the M0-05 carryover requires per-execution digests, container-facing bind, and snapshot compiles. The al-tools MCP component is M3.

## Decisions argued from the spec and findings

- **Candidate-scoped app sync with content-stamped prerequisite versions** (spec 1a section 7 item 5, findings section 8 "Broken", M0-02 carryover). Every app in the staged workspace is wanted on the container. An app is a *candidate* when it changed, depends transitively on a changed app, is Test, or is the oracle; the rest are *prerequisites*. Prerequisites are published with version `major.minor.<1..32767>.<0..32767>` derived from a content stamp (source tree hash plus dependency stamps); candidates always get `major.minor.0.0`. So a prerequisite is up to date exactly when the container has that app id installed at that stamped version and nothing else, and a stale one (older refapp commit, another task's overlay, a leftover candidate) can never look current. This is the "refresh stale prerequisite versions" rule without a host-side ledger that could drift from container state. Dependencies in `app.json` are minimum versions, so rewriting build and revision never breaks resolution; M1-27 proves it on a real container.
- **One warm-slot script per sync** (bc-container-quirks.md). `syncHarnessApps` removes by app id (dependents first) and publishes in dependency order in one `runScriptThroughSession` call, the same one-bridge pattern as `prepareCandidateApp`. Candidate apps and the oracle are removed after each judgment (spec 1a section 7) best-effort; the next sync removes every non-kept CentralGauge app anyway, so a failed post-cleanup cannot leak state into the next call.
- **Provisioning latency is separate** (spec 1a section 7 item 5, M0-02 carryover). Listing, removals and prerequisite publishes are `provisioning_ms`; candidate publishes are `candidate_publish_ms`; SOAP time is `test_ms`; lock wait is `queue_ms`. The verdict side file and the host call log carry all four.
- **The agent never runs in the verdict's process tree, and the verdict never reads the live workspace.** The runner freezes only after the sandbox container has exited, and the backend compiles a snapshot copy, never the bind-mounted workspace (M0-05 carryover: TOCTOU). Both copies go through `safeCopyTree`, which refuses links and non-regular files and caps size.
- **Link and size violations fail the build scorer, even for otherwise correct code** (spec 1a section 7 items 3-4: "A violation fails the build scorer"). The freeze writes them into `.cg-freeze-violations.txt` inside the frozen tree, so they are part of the workspace hash and survive a rejudge.
- **Mutant 0 is the staged workspace's own production code** (spec 1a section 7: "Mutant 0 is always the task's original buggy state"), recorded as target `mutant:0`.
- **Backend tokens** (M0-05 carryover): 32 random bytes per execution, stored only as a SHA-256 digest, compared with a constant-time loop over the two 32-byte digests. The request names its execution with `X-CG-Execution` (an opaque id); the grant maps it to one approved workspace root. Tokens expire at the execution's timeout plus five minutes and are revoked when the sandbox exits. The server binds the Docker `nat` gateway address (container-facing), never `0.0.0.0`. Malformed JSON is 400, oversized bodies 413, a second concurrent request from one execution 429. There is no endpoint that lists apps, reads another workspace or runs the oracle.
- **The backend returns diagnostics, never `.app` files** (findings section 8: the spike's `.app` was not handed back; D10: the verdict never uses harness-built apps). An agent that wants a local build uses the M3 toolchain component.
- **Secrets inside the sandbox are the owner-accepted risk** (`2026-09-25-secrets-accepted-risk.md`, spec 1a section 5 item 2 threat model). This resolves M0-03 carryover (c). The runner copies only the files the adapter declares (`secretFiles`) plus the backend token into a per-execution temp dir, mounts it read-only, deletes it after the run, and redacts exact values from every kept log. The accepted-risk condition "egress limited to provider and backend" has no implementation in 1a (spec 1a section 1 puts egress lockdown out of scope): open question 1, blocking for M5 real-harness campaigns, not for the mock.
- **Adapters own harness specifics** (D9). The runner only knows `HarnessAdapter`: declared telemetry fields (metrics contract), secret files, native settings, provider routes, extra mounts, and `parse(rawLog)`. M1 ships `mock`; M2 adds `claude-code`, M3 adds `pi`.
- **Termination is decided in one place** (spec 1a section 8): `setup_failed` for image mismatch, a sandbox that never started, `docker run` exit 125, or an observed-manifest mismatch; `timeout` when the timer fired; otherwise the adapter's classification or exit code. `outcomePolicy` (Part 1) decides judge and retry.
- **`did_work`** (Part 1 contract: the agent took any action): adapter signal, or any backend request, or a frozen workspace that differs from the staged one.
- **Staged runs are subsets of the immutable plan** (spec 1a section 6, Part 1 campaign contract): `--sample N` = the first N task ids at repeat 1, `--repeats N` = every block with repeat at most N, no flag = everything. Resume = newest campaign with the same experiment hash, task-set identity and arm manifest hashes.
- **Usage limits pause, then retry the cell** (spec 1a section 8). The runner stops dispatching, lets in-flight cells finish, sleeps until the reported reset when it is within `--max-pause-min` (default 360), then retries the limited cell as an `auto_retry`; otherwise it stops with a resume instruction.
- **Mutant and overlay ID bands** (id-audit, M0-01 carryover): `overlay/`, `correct/`, `naive/` and `mutants/` mirror the workspace, so their module folders are checked against the refapp band and their `Test/` folders against the visible-test band; `oracle/` is checked against the oracle band. Part 1's note put `mutants/` in 85000-89999; mutants are production variants, so this plan follows the mirror rule (open question 7).

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `scripts/id-audit.ts`, `src/constants.ts` | band rules for `harness-tasks/` | M1-11 |
| `src/harness/fsutil.ts` | `safeCopyTree` (link refusal, limits), `freezeWorkspace`, temp sweep | M1-12 |
| `src/harness/symbols.ts` | symbols lock builder, altool reader, symbol store restore | M1-13 |
| `src/harness/staging.ts` | app graph, `applyOverlay`, refapp task source, `TASK_SOURCES` | M1-13 |
| `src/harness/verdict-workspace.ts` | verdict workspace reconstruction, validation, test discovery | M1-14 |
| `src/harness/bc-apps.ts` | content stamps, stamped versions, candidate closure, `planAppSync` | M1-15 |
| `src/container/types.ts`, `bc-script-builders.ts`, `bc-output-parsers.ts`, `bc-container-provider.ts` | `listHarnessApps`, `syncHarnessApps`, `runHarnessTests` | M1-15 |
| `src/harness/bc-lane.ts` | `HarnessBc` seam, `BcLane`, `buildApps`, `prepareApps`, `deploy`, `runTests`, `deployAndTest` | M1-16 |
| `scripts/harness/app-sync-probe.ts` | ops driver for M1-27 | M1-16 |
| `src/harness/verdict.ts` | scorers, `judge`, verdict side file | M1-17, M1-18 |
| `src/harness/backend.ts`, `harness/images/base/cg-al.ps1` | `cg-al` backend and client | M1-19 |
| `src/harness/sandbox.ts` | `DockerCli`, run args, `runSandbox`, sweep, secrets dir, redaction | M1-20 |
| `src/harness/adapter.ts`, `src/harness/adapters/mock.ts`, `src/harness/images.ts` | adapter contract, mock adapter, image build args and facts | M1-21 |
| `harness/images/base/Dockerfile.windows`, `harness/images/mock/{Dockerfile.windows,run.ps1}`, `harness/configs/mock-*.yml`, `harness/experiments/mock-contract.yml` | images and mock arms | M1-21 |
| `src/harness/execution.ts` | `runExecution`, `runCell`, `judgeExecution`, `rejudgeExecution` | M1-22 |
| `src/harness/campaign.ts` | open/resume, stages, todo, spend estimate, reuse, pause, worker pool | M1-23 |
| `src/harness/env.ts`, `cli/commands/harness-command.ts` | real environment wiring, `run`, `cell`, `rejudge`, `images build`, `symbols lock` | M1-24 |
| `src/harness/efficiency.ts` | report Efficiency (backend side) and Slices | M1-25 |
| `tests/unit/harness/{refapp-fixture,fake-bc,fake-docker}.ts` | shared fakes and a temp refapp repo | M1-13, M1-16, M1-20 |

Runtime layout added under `results/harness/` (gitignored via `results/`):

```
results/harness/
  workspaces/<workspace-hash>/        frozen workspaces (content-addressed)
  runs/<execution-id>/                raw.jsonl, stderr.txt, host-log.jsonl, sandbox.json
  verdicts/<judgment-id>.json         verdict side file (spans, violations, diagnostics)
  cells/                              RecordStore root for `harness cell` (never read by report)
  symbols/<sha256>.app                symbol store (operator machine)
  cache/apps/<stamp>/<file>.app       compiled prerequisite apps
  work/<execution-id>/                staging and verdict scratch, deleted after the cell
```

## Traceability: every binding requirement to a task and an acceptance check

| Requirement (source) | Task | Acceptance check (no container) |
| --- | --- | --- |
| Cleanup scoped to candidate app ids, not renamed to `*Prereq*` (findings 8, M0-02) | M1-15 | `bc-apps.test.ts` `refapp dependency apps stay installed` |
| Persistent prerequisite app ids (findings 8, M0-02) | M1-15 | `bc-apps.test.ts` `prerequisites are every non-candidate workspace app` |
| Refresh stale prerequisite versions (findings 8, M0-02) | M1-15 | `bc-apps.test.ts` `a stale prerequisite is removed with its dependents and republished` |
| Provisioning latency separate from verdict latency (findings 8, spec 7.5) | M1-16, M1-17 | `bc-lane.test.ts` `provisioning is split from candidate publish`; `verdict.test.ts` side file spans |
| No secret in argv (M0-03 a) | M1-20, M1-22 | `sandbox.test.ts` `a secret in argv or env is refused before docker run`; `execution.test.ts` FakeDocker argv scan |
| Create and capture inside try; checked `docker rm -f` (M0-03 b) | M1-20 | `sandbox.test.ts` `a run that fails to start still removes and reports`, `rm failure is reported` |
| Startup sweep of owned `cg-harness-*` by prefix + label (M0-03 b) | M1-20, M1-24 | `sandbox.test.ts` `sweep removes only owned containers...`; `harness-command.test.ts` `openHarnessEnv: bench lock first...` |
| Secrets not agent-readable, or threat model states why (M0-03 c) | spec 1a 5.2 (done), M1-20 | accepted-risk decision; `sandbox.test.ts` `prepareSecrets: only declared files plus the token` |
| Accepted-risk conditions: dedicated creds, no argv/image layers, egress limited, logs scanned | M1-20, M1-21, M1-26, open q 1 | redaction tests; M1-26 evidence `docker history` has no secret; egress: open question 1 |
| Per-sandbox short-lived scoped tokens from a secret file (M0-05) | M1-19, M1-22 | `backend.test.ts` `missing, wrong, foreign, expired and revoked tokens are 401`; token only in `C:\cg-secrets\backend-token` |
| Timing-safe compare of fixed-length digests (M0-05) | M1-19 | `backend.test.ts` `timingSafeEqual` unit and token tests |
| Canonical paths, reparse refusal, opaque ids to approved roots (M0-05) | M1-19 | `backend.test.ts` `grant refuses roots outside approved roots and link roots`, `links in the workspace are not followed` |
| TOCTOU and resource limits (M0-05) | M1-19, M1-12 | snapshot test, 413 and 429 tests, `safeCopyTree` limit test |
| Bind to a container-facing interface only (M0-05) | M1-19, M1-26 | `backend.test.ts` `serve refuses wildcard binds`; M1-26 gateway evidence |
| Malformed JSON returns 400 (M0-05) | M1-19 | `backend.test.ts` `malformed JSON is 400` |
| Monotonic latency, separating startup, transport, queue, compile (M0-05) | M1-19 | host log spans test; client `startup_ms`/`total_ms` in the Windows client test |
| id-audit band rule for `harness-tasks/` (M0-01) | M1-11 | `id-audit.test.ts` harness cases |
| Owner metric rules: every attempt's spend, reruns, matched pairs, sparse bootstrap (m1-metric-rules) | Part 1 + M1-22, M1-23 | `execution.test.ts` retry chain records both attempts; campaign resume never rewrites; report is Part 1 |
| 7-app rule did not fire: publish all apps, several executions per container allowed (findings 8) | M1-16 | `BcLane` fixed per-container mutex; M1-29 timings |
| pi has no MCP: MCP arms Claude Code only (findings 8) | none in M1 | M3 plan |
| Cost basis estimated, reported kept (findings 8) | M1-21 | mock telemetry `cost_source: estimated`; M2 for real harnesses |
| Node 22.19.0 in the base image (findings 3, 8) | M1-21 | `images.test.ts` Dockerfile pins `v22.19.0` |
| Hard kill leaves a complete last JSON line (findings 3) | M1-20, M1-29 | continuous capture to file; M1-29 evidence of the last line |
| Pre-run bench-live check (findings 3 note) | M1-24 | `openHarnessEnv: a held bench lock stops before any docker call` |
| Harness version must match the image label, else refuse (spec 4) | M1-21, M1-23 | `images.test.ts` `label mismatch is refused` |
| Observed manifest completion, `setup_failed` on mismatch (spec 4) | M1-21, M1-22 | `adapter.test.ts` `observedMismatch`; `execution.test.ts` `observed version mismatch is setup_failed` |
| Staging: snapshot + overlay + Test + `.alpackages`; interface for `git` (spec 5.1, D16) | M1-13 | `staging.test.ts` |
| Exact mounts; token scoped to its workspace (spec 5.2) | M1-20, M1-19 | `buildRunArgs` test; backend execution-id test |
| Structured output captured continuously (spec 5.3) | M1-20 | `realDocker().run` pipes to files; M1-29 |
| `cg-al` compile/test/symbols only, no list/other/oracle endpoint (spec 5.4) | M1-19 | `backend.test.ts` `only compile, test and symbols exist` |
| Timeout stops the container, the workspace is judged (spec 5.5) | M1-20, M1-22 | `execution.test.ts` `timeout kills the sandbox and the workspace is still judged` |
| Revoke, freeze, destroy, verdict (spec 5.6) | M1-22 | `execution.test.ts` `the correct solution completes...` (asserts the token is revoked before freeze) |
| Metrics contract: declared missing field marks incomplete (spec 5) | M1-21 | `adapter.test.ts` `incompleteTelemetry` |
| Host call log per backend request with spans, units kept apart (spec 5) | M1-19 | host log test (logical request vs `per_app_compiles`) |
| Fixed concurrency; queue wait recorded (spec 5, D12) | M1-16, M1-19 | `bc-lane.test.ts` `one container serializes`, `queue_ms` |
| Campaign: resume, `--reuse-history`, staged runs, cost estimate (spec 6) | M1-23 | `campaign.test.ts` |
| Verdict workspace items 1-5 (spec 7) | M1-14, M1-15 | `verdict-workspace.test.ts`, `bc-apps.test.ts` |
| Scorers build, pass_to_pass, fail_to_pass, mutant_kill; per procedure (spec 7) | M1-17, M1-18 | `verdict.test.ts`, `verdict-mutant.test.ts` |
| Zero tests after publish is infra (spec 7, GH #13) | M1-16 | `bc-lane.test.ts` `runTests: ... zero tests` (a listed codeunit with zero tests throws infra) |
| After a judgment candidates and the oracle are unpublished (spec 7) | M1-16, M1-17 | `deployAndTest: candidates are cleaned up even when tests throw`; verdict `the correct solution passes every scorer` (cleanup ids) |
| Termination, verdict, validity separate; one automatic retry; usage pause (spec 8) | M1-22, M1-23 | `execution.test.ts`, `campaign.test.ts` pause tests |
| Verdict-side BC fault rejudges on another container, agent never re-run (spec 8) | M1-16, M1-17 | `an infra fault on one container rejudges on another`, `infra on every container is unscored, never a fail` |
| Report Efficiency (backend side), Slices (spec 9) | M1-25 | `efficiency.test.ts` |
| CLI `run`, `cell`, `rejudge`, `images build`, Cliffy `--no-X` rule (spec 10) | M1-24 | `harness-command.test.ts`, `deno task start harness --help` |
| Mock harness contract tests on real containers (spec 11) | M1-29 | evidence file |
| Hostile contract tests (spec 11) | M1-30 | evidence file |
| Unit: verdict-workspace reconstruction and validation (spec 11) | M1-14 | `verdict-workspace.test.ts` |

## Schedule

| Day | lane-infra | lane-ops |
| --- | --- | --- |
| 10-01 | M1-11, M1-12, M1-20 | |
| 10-02 | M1-13, M1-14 | |
| 10-03 | M1-15, M1-16 | M1-27 (after M1-16) |
| 10-04 | M1-17, M1-19 | |
| 10-05 | M1-18, M1-21 | |
| 10-06 | M1-22 | |
| 10-07 | M1-23, M1-24 | M1-26 (after M1-24) |
| 10-08 | M1-25 (cut first if late), integration gate | M1-28, then M1-29 and M1-30 as the M4 slice allows |

Part 1 dependencies by task are listed per task; M1-11, M1-20 need nothing from Part 1 and can start on 10-01 while Part 1 finishes.

---
### Task M1-11: id-audit band rule for `harness-tasks/`

M0-01 carryover (`2026-09-25-accept-M0-01.md`: "id-audit has no band rule for `harness-tasks/`"), spec 1b section 4 (bands). The refapp band equals the existing `BENCHMARK_APP_ID_RANGE` (70000-74999); two new constants name the visible-test and oracle bands. `overlay/`, `correct/`, `naive/<variant>/` and `mutants/<name>/` mirror the workspace, so their module folders get the refapp band and their `Test/` folders the visible-test band.

**Lane:** infra. **Deps:** none.

**Files:**
- Modify: `src/constants.ts` (two constants after `TEST_CODEUNIT_ID_RANGE`)
- Modify: `scripts/id-audit.ts` (`unitOf`, `bandOf`, import list)
- Test: `tests/unit/scripts/id-audit.test.ts` (append)

**Interfaces:**
- Produces: `HARNESS_VISIBLE_TEST_RANGE = { start: 80000, end: 84999 }`, `HARNESS_ORACLE_RANGE = { start: 85000, end: 89999 }` (constants.ts); units `refapp:<Module>`, `harness-oracle:<task>`, `harness-<overlay|correct|naive|mutants>:<task>[:<variant>]:<Module>` (id-audit.ts). M1-14 imports both constants.

- [ ] **Step 1: Write the failing test** (append to `tests/unit/scripts/id-audit.test.ts`)

```typescript
Deno.test("harness-tasks: units and bands", async (t) => {
  const f = (file: string, id: number) => obj({ file, unit: unitOf(file), id });
  const core = "harness-tasks/refapp/Core/src/A.Codeunit.al";
  const test = "harness-tasks/refapp/Test/src/T.Test.al";
  const oracle = "harness-tasks/tasks/HX-001/oracle/src/O.Test.al";
  const overlayTest = "harness-tasks/tasks/HX-001/overlay/Test/src/N.Test.al";
  const mutant = "harness-tasks/tasks/HX-003/mutants/off-by-one/Rental/src/M.al";

  await t.step("unitOf classifies refapp modules and task parts", () => {
    assertEquals(unitOf(core), "refapp:Core");
    assertEquals(unitOf(test), "refapp:Test");
    assertEquals(unitOf(oracle), "harness-oracle:HX-001");
    assertEquals(unitOf(overlayTest), "harness-overlay:HX-001:Test");
    assertEquals(
      unitOf("harness-tasks/tasks/HX-001/naive/a/Rental/src/X.al"),
      "harness-naive:HX-001:a:Rental",
    );
    assertEquals(unitOf(mutant), "harness-mutants:HX-003:off-by-one:Rental");
  });

  await t.step("objects in their band pass", () => {
    assertEquals(
      auditObjects([
        f(core, 70001),
        f(test, 80001),
        f(oracle, 85001),
        f(overlayTest, 80002),
        f(mutant, 70210),
      ]).problems,
      [],
    );
  });

  await t.step("objects outside their band fail", () => {
    const problems = auditObjects([
      f(core, 80001),
      f(test, 70001),
      f(oracle, 80001),
      f(mutant, 85001),
    ]).problems;
    assertEquals(problems.length, 4);
    assertStringIncludes(problems[0]!, "refapp band");
    assertStringIncludes(problems[1]!, "harness visible test band");
    assertStringIncludes(problems[2]!, "harness oracle band");
  });

  await t.step("the reserved buffer fails in harness files too", () => {
    const problems = auditObjects([f(core, 75001)]).problems;
    assert(problems.some((p) => p.includes("RESERVED")));
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/scripts/id-audit.test.ts`
Expected: FAIL, `harness-tasks: units and bands ... unitOf classifies` (`unclassified:harness-tasks/...` is not `refapp:Core`).

- [ ] **Step 3: Implement**

`src/constants.ts`, after `TEST_CODEUNIT_ID_RANGE`:

```typescript
/** Harness Bench visible tests in the refapp `Test\` app (spec 1b section 4). */
export const HARNESS_VISIBLE_TEST_RANGE = {
  start: 80000,
  end: 84999,
} as const;

/** Harness Bench hidden oracle apps (spec 1b section 4). */
export const HARNESS_ORACLE_RANGE = {
  start: 85000,
  end: 89999,
} as const;
```

`scripts/id-audit.ts`: add `HARNESS_ORACLE_RANGE, HARNESS_VISIBLE_TEST_RANGE` to the `../src/constants.ts` import list. In `unitOf`, before the final `return`:

```typescript
  const refapp = /^harness-tasks\/refapp\/([^/]+)\//.exec(file);
  if (refapp) return `refapp:${refapp[1]}`;

  // Task parts. oracle/ is its own app; overlay/, correct/, naive/<v>/ and
  // mutants/<m>/ mirror the workspace, one unit per module folder.
  const task =
    /^harness-tasks\/tasks\/([^/]+)\/(overlay|correct|naive|mutants|oracle)\/(.+)$/
      .exec(file);
  if (task) {
    const [, id, part, rest] = task;
    if (part === "oracle") return `harness-oracle:${id}`;
    const segs = rest!.split("/");
    const variant = part === "naive" || part === "mutants"
      ? `:${segs.shift()}`
      : "";
    return `harness-${part}:${id}${variant}:${segs[0]}`;
  }
```

In `bandOf`, before `return null`:

```typescript
  const visibleTest = {
    label: "harness visible test",
    ...HARNESS_VISIBLE_TEST_RANGE,
  };
  const refappBand = { label: "refapp", ...BENCHMARK_APP_ID_RANGE };
  if (unit.startsWith("refapp:")) {
    return unit === "refapp:Test" ? visibleTest : refappBand;
  }
  if (unit.startsWith("harness-oracle:")) {
    return { label: "harness oracle", ...HARNESS_ORACLE_RANGE };
  }
  if (/^harness-(overlay|correct|naive|mutants):/.test(unit)) {
    return unit.endsWith(":Test") ? visibleTest : refappBand;
  }
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/scripts/id-audit.test.ts` then `deno task id-audit`
Expected: all tests pass; `id-audit` exits 0 on the current tree (refapp objects are 70000-70599 and 80000-80099, findings section 2).

- [ ] **Step 5: Check, lint, format**

```bash
deno check scripts/id-audit.ts src/constants.ts tests/unit/scripts/id-audit.test.ts
deno lint scripts/id-audit.ts src/constants.ts tests/unit/scripts/id-audit.test.ts
deno fmt scripts/id-audit.ts src/constants.ts tests/unit/scripts/id-audit.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add scripts/id-audit.ts src/constants.ts tests/unit/scripts/id-audit.test.ts
git commit -m "feat(id-audit): band rules for harness-tasks refapp, tests and oracles"
```

**Acceptance:** `deno test --allow-all tests/unit/scripts/id-audit.test.ts` passes and `deno task id-audit` exits 0.

---

### Task M1-12: hostile-artifact copy boundary and workspace freeze

Spec 1a section 7 item 4 ("Copying refuses symlinks, junctions and other reparse points"), section 5 item 6 ("freezes the workspace (copy, then hash)"), Part 1 contract ("the hostile-artifact copy boundary with its own reparse-point policy (not `listTree`)"; workspaces are content-addressed and may be shared), M0-05 carryover (TOCTOU and resource limits). Deno reports junctions as symlinks through `lstat`, the same property Part 1's `hashTree` relies on. The copy runs only after the sandbox container exited, so nothing can swap an entry between `lstat` and `copyFile`.

**Lane:** infra. **Deps:** M1-02 (`hashTree`, `isTaskBuildArtifact`).

**Files:**
- Create: `src/harness/fsutil.ts`
- Test: `tests/unit/harness/fsutil.test.ts`

**Interfaces:**
- Produces: `FREEZE_VIOLATIONS_FILE = ".cg-freeze-violations.txt"`; `interface CopyLimits { maxFiles: number; maxBytes: number }`; `DEFAULT_COPY_LIMITS`; `class CopyLimitError extends ValidationError`; `interface CopyReport { files: number; bytes: number; refused: string[] }`; `safeCopyTree(src: string, dst: string, opts?: { skip?: (rel: string) => boolean; limits?: CopyLimits }): Promise<CopyReport>`; `interface Frozen { workspace_hash: string; stored_path: string; violations: string[] }`; `freezeWorkspace(resultsRoot: string, workspace: string, limits?: CopyLimits): Promise<Frozen>`; `sweepWorkspaceTemp(resultsRoot: string): Promise<number>`; `exists(path: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/fsutil.test.ts`:

```typescript
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import {
  CopyLimitError,
  exists,
  FREEZE_VIOLATIONS_FILE,
  freezeWorkspace,
  safeCopyTree,
  sweepWorkspaceTemp,
} from "../../../src/harness/fsutil.ts";
import { hashTree, isTaskBuildArtifact } from "../../../src/harness/hash.ts";

async function writeTree(root: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, ...rel.split("/"));
    await Deno.mkdir(join(p, ".."), { recursive: true });
    await Deno.writeTextFile(p, text);
  }
}

/** A junction on Windows (no admin needed), a directory symlink elsewhere. */
async function linkDir(target: string, path: string) {
  await Deno.symlink(target, path, {
    type: Deno.build.os === "windows" ? "junction" : "dir",
  });
}

Deno.test("safeCopyTree: copies files, skips build artifacts, counts", async () => {
  const src = await Deno.makeTempDir();
  const dst = await Deno.makeTempDir();
  await writeTree(src, {
    "Core/app.json": "{}",
    "Core/src/A.Codeunit.al": "codeunit 70000 A {}",
    ".alpackages/sym.app": "bin",
    "Core/output/Core.app": "bin",
    "Core/Core.app": "bin",
  });
  const r = await safeCopyTree(src, dst, { skip: isTaskBuildArtifact });
  assertEquals(r.files, 2);
  assertEquals(r.refused, []);
  assert(await exists(join(dst, "Core", "src", "A.Codeunit.al")));
  assert(!await exists(join(dst, ".alpackages")));
  assert(!await exists(join(dst, "Core", "output")));
  assert(!await exists(join(dst, "Core", "Core.app")));
});

Deno.test("safeCopyTree: a junction is refused and never followed", async () => {
  const target = await Deno.makeTempDir();
  await writeTree(target, { "secret.txt": "host file" });
  const src = await Deno.makeTempDir();
  await writeTree(src, { "Core/app.json": "{}" });
  await linkDir(target, join(src, "Core", "hostlink"));
  const dst = await Deno.makeTempDir();
  const r = await safeCopyTree(src, dst);
  assertEquals(r.refused, ["Core/hostlink"]);
  assert(!await exists(join(dst, "Core", "hostlink")));
});

Deno.test("safeCopyTree: a link as the root is refused", async () => {
  const target = await Deno.makeTempDir();
  const parent = await Deno.makeTempDir();
  await linkDir(target, join(parent, "root"));
  await assertRejects(
    () => safeCopyTree(join(parent, "root"), join(parent, "out")),
    ValidationError,
    "link",
  );
});

Deno.test("safeCopyTree: limits throw CopyLimitError", async () => {
  const src = await Deno.makeTempDir();
  await writeTree(src, { "a.al": "x", "b.al": "y" });
  await assertRejects(
    () =>
      safeCopyTree(src, join(src, "..", "out-" + crypto.randomUUID()), {
        limits: { maxFiles: 1, maxBytes: 1_000_000 },
      }),
    CopyLimitError,
  );
  await assertRejects(
    () =>
      safeCopyTree(src, join(src, "..", "out-" + crypto.randomUUID()), {
        limits: { maxFiles: 100, maxBytes: 1 },
      }),
    CopyLimitError,
  );
});

Deno.test("freezeWorkspace: identical content shares one stored copy", async () => {
  const results = await Deno.makeTempDir();
  const a = await Deno.makeTempDir();
  const b = await Deno.makeTempDir();
  await writeTree(a, { "Core/src/A.al": "x\r\n", ".alpackages/s.app": "bin" });
  await writeTree(b, { "Core/src/A.al": "x\n" });
  const fa = await freezeWorkspace(results, a);
  const fb = await freezeWorkspace(results, b);
  assertEquals(fa.workspace_hash, fb.workspace_hash);
  assertEquals(fa.stored_path, `workspaces/${fa.workspace_hash}`);
  assertEquals(fa.violations, []);
  assertEquals(
    await hashTree(join(results, fa.stored_path), "task"),
    fa.workspace_hash,
  );
  const entries = [];
  for await (const e of Deno.readDir(join(results, "workspaces"))) {
    entries.push(e.name);
  }
  assertEquals(entries, [fa.workspace_hash]);
});

Deno.test("freezeWorkspace: links and oversize become a hashed violations marker", async () => {
  const results = await Deno.makeTempDir();
  const target = await Deno.makeTempDir();
  const clean = await Deno.makeTempDir();
  const linked = await Deno.makeTempDir();
  await writeTree(clean, { "Core/src/A.al": "x" });
  await writeTree(linked, { "Core/src/A.al": "x" });
  await linkDir(target, join(linked, "Core", "hostlink"));
  const c = await freezeWorkspace(results, clean);
  const l = await freezeWorkspace(results, linked);
  assertNotEquals(l.workspace_hash, c.workspace_hash);
  assertEquals(l.violations.length, 1);
  assertStringIncludes(
    await Deno.readTextFile(
      join(results, l.stored_path, FREEZE_VIOLATIONS_FILE),
    ),
    "Core/hostlink",
  );
  const big = await freezeWorkspace(results, clean, {
    maxFiles: 0,
    maxBytes: 0,
  });
  assertEquals(big.violations.length, 1);
  assert(!await exists(join(results, big.stored_path, "Core")));
});

Deno.test("sweepWorkspaceTemp: removes interrupted freezes only", async () => {
  const results = await Deno.makeTempDir();
  await writeTree(results, {
    "workspaces/.tmp-1234/Core/a.al": "x",
    "workspaces/abc/Core/a.al": "x",
  });
  assertEquals(await sweepWorkspaceTemp(results), 1);
  assert(await exists(join(results, "workspaces", "abc")));
  assert(!await exists(join(results, "workspaces", ".tmp-1234")));
  assertEquals(await sweepWorkspaceTemp(join(results, "nope")), 0);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/fsutil.test.ts`
Expected: FAIL, `Module not found ".../src/harness/fsutil.ts"`.

- [ ] **Step 3: Implement**

`src/harness/fsutil.ts`:

```typescript
/**
 * The hostile-artifact copy boundary (spec 1a sections 5 and 7). An agent
 * wrote these trees, so a copy never follows or recreates a link (Deno
 * reports junctions as symlinks), copies nothing but regular files and
 * directories, and stops at a size limit. Callers copy only after the
 * sandbox container exited, so no process can swap an entry between the
 * lstat and the copy.
 */

import { join } from "@std/path";
import { ValidationError } from "../errors.ts";
import { hashTree, isTaskBuildArtifact } from "./hash.ts";

/** Written into a frozen workspace when links or limits were hit; hashed. */
export const FREEZE_VIOLATIONS_FILE = ".cg-freeze-violations.txt";

export interface CopyLimits {
  maxFiles: number;
  maxBytes: number;
}

/** ponytail: fixed limits; make them config when a real task needs more. */
export const DEFAULT_COPY_LIMITS: CopyLimits = {
  maxFiles: 20_000,
  maxBytes: 512 * 1024 * 1024,
};

export class CopyLimitError extends ValidationError {
  constructor(message: string) {
    super(message, [message]);
    this.name = "CopyLimitError";
  }
}

export interface CopyReport {
  files: number;
  bytes: number;
  /** Relative posix paths of links and special files that were not copied. */
  refused: string[];
}

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

/**
 * Copy `src` into `dst` (merging into existing directories, overwriting
 * files). `skip` sees posix paths relative to `src`, for files and
 * directories. Links are reported in `refused`, never followed.
 */
export async function safeCopyTree(
  src: string,
  dst: string,
  opts: { skip?: (rel: string) => boolean; limits?: CopyLimits } = {},
): Promise<CopyReport> {
  const limits = opts.limits ?? DEFAULT_COPY_LIMITS;
  const root = await Deno.lstat(src);
  if (root.isSymlink || !root.isDirectory) {
    throw new ValidationError(
      `copy source is not a plain directory (link refused): ${src}`,
      [src],
    );
  }
  const report: CopyReport = { files: 0, bytes: 0, refused: [] };
  await Deno.mkdir(dst, { recursive: true });
  const walk = async (rel: string): Promise<void> => {
    const names: string[] = [];
    for await (const e of Deno.readDir(rel ? join(src, rel) : src)) {
      names.push(e.name);
    }
    for (const name of names.sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const st = await Deno.lstat(join(src, r));
      if (st.isSymlink || (!st.isFile && !st.isDirectory)) {
        report.refused.push(r);
        continue;
      }
      if (opts.skip?.(r)) continue;
      if (st.isDirectory) {
        await Deno.mkdir(join(dst, r), { recursive: true });
        await walk(r);
        continue;
      }
      report.files++;
      report.bytes += st.size;
      if (report.files > limits.maxFiles || report.bytes > limits.maxBytes) {
        throw new CopyLimitError(
          `${src}: more than ${limits.maxFiles} files or ${limits.maxBytes} bytes`,
        );
      }
      await Deno.copyFile(join(src, r), join(dst, r));
    }
  };
  await walk("");
  return report;
}

export interface Frozen {
  workspace_hash: string;
  /** Relative to resultsRoot, e.g. workspaces/<hash>. */
  stored_path: string;
  violations: string[];
}

/**
 * Freeze a workspace into results/harness/workspaces/<hash>. Build
 * artifacts are dropped (the verdict never uses them, D10). Links and an
 * exceeded limit are recorded in FREEZE_VIOLATIONS_FILE inside the frozen
 * tree (an oversize freeze keeps only the marker), so they are part of the
 * workspace hash and fail the build scorer on every judgment.
 */
export async function freezeWorkspace(
  resultsRoot: string,
  workspace: string,
  limits: CopyLimits = DEFAULT_COPY_LIMITS,
): Promise<Frozen> {
  const base = join(resultsRoot, "workspaces");
  await Deno.mkdir(base, { recursive: true });
  const tmp = join(base, `.tmp-${crypto.randomUUID()}`);
  try {
    const violations: string[] = [];
    try {
      const r = await safeCopyTree(workspace, tmp, {
        skip: isTaskBuildArtifact,
        limits,
      });
      violations.push(...r.refused.map((p) => `link or special file: ${p}`));
    } catch (err) {
      if (!(err instanceof CopyLimitError)) throw err;
      await Deno.remove(tmp, { recursive: true });
      await Deno.mkdir(tmp);
      violations.push(`size limit: ${err.message}`);
    }
    if (violations.length > 0) {
      await Deno.writeTextFile(
        join(tmp, FREEZE_VIOLATIONS_FILE),
        violations.join("\n") + "\n",
      );
    }
    const workspace_hash = await hashTree(tmp, "task");
    const stored_path = `workspaces/${workspace_hash}`;
    // ponytail: exists-then-rename is racy across processes; the bench lock
    // makes the runner the only writer.
    if (await exists(join(resultsRoot, stored_path))) {
      await Deno.remove(tmp, { recursive: true });
    } else {
      await Deno.rename(tmp, join(resultsRoot, stored_path));
    }
    return { workspace_hash, stored_path, violations };
  } catch (err) {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
    throw err;
  }
}

/** Remove workspaces/.tmp-* left by an interrupted freeze. */
export async function sweepWorkspaceTemp(resultsRoot: string): Promise<number> {
  const base = join(resultsRoot, "workspaces");
  let removed = 0;
  try {
    for await (const e of Deno.readDir(base)) {
      if (e.name.startsWith(".tmp-")) {
        await Deno.remove(join(base, e.name), { recursive: true });
        removed++;
      }
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  return removed;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/fsutil.test.ts`
Expected: all 7 tests pass.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/fsutil.ts tests/unit/harness/fsutil.test.ts
deno lint src/harness/fsutil.ts tests/unit/harness/fsutil.test.ts
deno fmt src/harness/fsutil.ts tests/unit/harness/fsutil.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/fsutil.ts tests/unit/harness/fsutil.test.ts
git commit -m "feat(harness): link-refusing copy boundary and content-addressed workspace freeze"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/fsutil.test.ts` passes; check, lint and `deno fmt --check` clean on both files.

---

### Task M1-13: symbols lock, app graph and refapp staging

Spec 1a section 5 item 1 (staging: refapp snapshot at an immutable commit + task overlay + `Test\` + pre-seeded `.alpackages`; the staging interface returns a workspace and its app list in dependency order; D16 pluggable sources, only the interface for `git`), 1b section 5 (overlay applies injected bug, stub or removed feature), Part 1 contracts (staging copies exactly `resolveRefapp(...).files`; `C:\task` gets `agentVisibleMetadata`; symbols lock `{ v: 1, packages }`, written here so identities stop being provisional). Findings section 6 and the M0-06 carryover: 263 symbol apps, 400 MB, from the BCH compiler cache; this plan keeps them in a host symbol store keyed by digest and copies them per staging (the shared read-only symbol mount is an M3 toolchain decision). The `altool GetPackageManifest` JSON key names are checked on a real cache in M1-26.

A removed file is expressed by `overlay/.delete`: one workspace-relative path per line (blank lines and `#` comments ignored). It is part of the overlay tree, so it is in the visible-input hash.

**Lane:** infra. **Deps:** M1-01 (`loadTask`), M1-02 (`hashFile`, `listTree`, `isTaskBuildArtifact`), M1-04 (`resolveRefapp`, `SymbolsLockSchema`, `agentVisibleMetadata`), M1-12.

**Files:**
- Create: `src/harness/symbols.ts`
- Create: `src/harness/staging.ts`
- Create: `tests/unit/harness/refapp-fixture.ts` (temp refapp repo reused by M1-14 to M1-24)
- Test: `tests/unit/harness/staging.test.ts`

**Interfaces:**
- Consumes: `LoadedTask`, `HarnessTask` (M1-01); `hashFile`, `listTree`, `isTaskBuildArtifact` (M1-02); `RefappRef`, `REFAPP_PATH`, `SymbolPackage`, `SymbolsLockSchema`, `SYMBOLS_LOCK_PATH`, `agentVisibleMetadata` (M1-04); `safeCopyTree` (M1-12).
- Produces (symbols.ts): `interface PackageManifest { id; name; publisher; version }`; `type ManifestReader = (appPath: string) => Promise<PackageManifest>`; `altoolReader(altool: string): ManifestReader`; `defaultAltool(symbolsDir: string): string`; `buildSymbolsLock(fromDir: string, store: string, read: ManifestReader): Promise<{ v: 1; packages: SymbolPackage[] }>`; `writeSymbolsLock(repoRoot: string, lock): Promise<void>`; `restoreSymbols(store: string, packages: SymbolPackage[], dst: string): Promise<void>`.
- Produces (staging.ts): `interface StagedApp { folder; id; name; publisher; version; idRanges: { from: number; to: number }[]; depends: string[] /* folders */; external: string[] /* dependency ids outside the workspace */ }`; `readAppJson(path)`; `readAppGraph(workspace: string): Promise<StagedApp[]>` (dependency order, ties by folder); `dependentsClosure(apps: StagedApp[], folders: Iterable<string>): Set<string>`; `DELETE_LIST = ".delete"`; `applyOverlay(overlayDir: string, target: string, opts?: { exclude?: (rel: string) => boolean }): Promise<void>`; `interface StageOptions { repoRoot; task: LoadedTask; refapp: RefappRef; symbols: SymbolPackage[]; symbolStore: string; out: string }`; `interface StagedWorkspace { workspace: string; pristine: string; taskDir: string; apps: StagedApp[] }`; `type TaskSource = (o: StageOptions) => Promise<StagedWorkspace>`; `stageRefappTask`; `TASK_SOURCES: Record<HarnessTask["source"], TaskSource>`.
- Produces (refapp-fixture.ts): `IDS`, `write`, `git`, `appJson`, `interface RefappRepo { root; tasksDir; symbolStore; symbols }`, `makeRefappRepo(): Promise<RefappRepo>`.

`StagedWorkspace.pristine` is a second, untouched copy of the staged workspace: the sandbox mounts `workspace` read-write, and the verdict and backend need the trusted staged inputs afterwards (spec 1a section 7 item 1).

- [ ] **Step 1: Write the fixture and the failing test**

`tests/unit/harness/refapp-fixture.ts`:

```typescript
/**
 * A throwaway git repo with a three-app refapp (Core, Rental -> Core, Test ->
 * both + Library Assert), one bugfix task HX-001 with overlay, oracle,
 * correct/ and naive/a, a symbol store and a symbols lock. Needs git on PATH.
 */

import { join } from "@std/path";
import { hashFile } from "../../../src/harness/hash.ts";
import type { SymbolPackage } from "../../../src/harness/identity.ts";
import { writeSymbolsLock } from "../../../src/harness/symbols.ts";

export const IDS = {
  core: "c6a1e000-0000-4000-8000-000000000001",
  rental: "c6a1e000-0000-4000-8000-000000000003",
  test: "c6a1e000-0000-4000-8000-000000000007",
  oracle: "c6a1e000-0000-4000-8000-0000000000f1",
  assert: "dd0be2ea-f733-4d65-bb34-a28f4624fb14",
};

export async function write(root: string, rel: string, text: string) {
  const p = join(root, ...rel.split("/"));
  await Deno.mkdir(join(p, ".."), { recursive: true });
  await Deno.writeTextFile(p, text);
}

export async function git(root: string, ...args: string[]) {
  const out = await new Deno.Command("git", {
    args,
    cwd: root,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
}

export function appJson(
  id: string,
  name: string,
  range: [number, number],
  deps: { id: string; name: string }[],
): string {
  return JSON.stringify(
    {
      id,
      name,
      publisher: "CentralGauge",
      version: "1.0.0.0",
      platform: "28.0.0.0",
      application: "28.0.0.0",
      idRanges: [{ from: range[0], to: range[1] }],
      runtime: "17.0",
      dependencies: deps.map((d) => ({
        id: d.id,
        name: d.name,
        publisher: d.id === IDS.assert ? "Microsoft" : "CentralGauge",
        version: "1.0.0.0",
      })),
    },
    null,
    2,
  );
}

const rental = (body: string) =>
  `codeunit 70200 "CGR Rental"\n{\n    procedure Price(): Integer\n    begin\n        ${body}\n    end;\n}\n`;

export const TASK_YML = `id: HX-001
refapp_version: refapp-v1
kind: bugfix
prompt: prompt.md
attachments: [shots/screen.png]
source: refapp
scorers: [build, pass_to_pass, fail_to_pass]
pass_to_pass:
  - { codeunit: 80000, procedures: [ShippedPasses] }
fail_to_pass:
  depends_on: [Rental]
  tests:
    - { codeunit: 85001, procedures: [FixWorks] }
limits: { timeout_min: 20 }
`;

export interface RefappRepo {
  root: string;
  tasksDir: string;
  symbolStore: string;
  symbols: SymbolPackage[];
}

export async function makeRefappRepo(): Promise<RefappRepo> {
  const root = await Deno.makeTempDir({ prefix: "cg-refapp-" });
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "t@example.com");
  await git(root, "config", "user.name", "t");
  const r = "harness-tasks/refapp";
  await write(root, `${r}/Core/app.json`, appJson(IDS.core, "CGR Core", [70000, 70099], []));
  await write(root, `${r}/Core/src/Core.Codeunit.al`, `codeunit 70000 "CGR Core"\n{\n}\n`);
  await write(root, `${r}/Core/Core.app`, "tracked build output");
  await write(
    root,
    `${r}/Rental/app.json`,
    appJson(IDS.rental, "CGR Rental", [70200, 70299], [{ id: IDS.core, name: "CGR Core" }]),
  );
  await write(root, `${r}/Rental/src/Rental.Codeunit.al`, rental("exit(10);"));
  await write(root, `${r}/Rental/src/Old.Codeunit.al`, `codeunit 70201 "CGR Old"\n{\n}\n`);
  await write(
    root,
    `${r}/Test/app.json`,
    appJson(IDS.test, "CGR Test", [80000, 80099], [
      { id: IDS.core, name: "CGR Core" },
      { id: IDS.rental, name: "CGR Rental" },
      { id: IDS.assert, name: "Library Assert" },
    ]),
  );
  await write(
    root,
    `${r}/Test/src/Shipped.Test.al`,
    `codeunit 80000 "CGR Shipped Tests"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure ShippedPasses()\n    begin\n    end;\n}\n`,
  );
  await git(root, "add", ".");
  await git(root, "commit", "-q", "-m", "refapp");
  await git(root, "tag", "refapp-v1");

  const t = "harness-tasks/tasks/HX-001";
  await write(root, `${t}/task.yml`, TASK_YML);
  await write(root, `${t}/prompt.md`, "Rental price is wrong.");
  await write(root, `${t}/shots/screen.png`, "png");
  await write(root, `${t}/overlay/Rental/src/Rental.Codeunit.al`, rental("exit(11); // BUG"));
  await write(root, `${t}/overlay/.delete`, "# removed feature\nRental/src/Old.Codeunit.al\n");
  await write(
    root,
    `${t}/oracle/app.json`,
    appJson(IDS.oracle, "CGR Oracle HX-001", [85000, 85099], [
      { id: IDS.core, name: "CGR Core" },
      { id: IDS.rental, name: "CGR Rental" },
      { id: IDS.assert, name: "Library Assert" },
    ]),
  );
  await write(
    root,
    `${t}/oracle/src/Oracle.Test.al`,
    `codeunit 85001 "HX-001 Oracle"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure FixWorks()\n    begin\n    end;\n}\n`,
  );
  await write(root, `${t}/correct/Rental/src/Rental.Codeunit.al`, rental("exit(10); // FIXED"));
  await write(root, `${t}/naive/a/Rental/src/Rental.Codeunit.al`, rental("exit(12); // NAIVE"));

  const symbolStore = await Deno.makeTempDir({ prefix: "cg-symstore-" });
  const file = "Microsoft_Library Assert_28.0.0.0.app";
  const tmp = join(symbolStore, file);
  await Deno.writeTextFile(tmp, "assert-symbols");
  const sha256 = await hashFile(tmp);
  await Deno.rename(tmp, join(symbolStore, `${sha256}.app`));
  const symbols: SymbolPackage[] = [{
    app_id: IDS.assert,
    name: "Library Assert",
    publisher: "Microsoft",
    version: "28.0.0.0",
    file,
    sha256,
  }];
  await writeSymbolsLock(root, { v: 1, packages: symbols });
  return {
    root,
    tasksDir: join(root, "harness-tasks", "tasks"),
    symbolStore,
    symbols,
  };
}
```

`tests/unit/harness/staging.test.ts`:

```typescript
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import { exists } from "../../../src/harness/fsutil.ts";
import { hashFile } from "../../../src/harness/hash.ts";
import {
  agentVisibleMetadata,
  loadSymbolsLock,
  resolveRefapp,
} from "../../../src/harness/identity.ts";
import {
  readAppGraph,
  stageRefappTask,
  TASK_SOURCES,
} from "../../../src/harness/staging.ts";
import {
  altoolReader,
  buildSymbolsLock,
} from "../../../src/harness/symbols.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { createCommandMock } from "../../utils/command-mock.ts";
import { appJson, IDS, makeRefappRepo, write } from "./refapp-fixture.ts";

async function stage(repo: Awaited<ReturnType<typeof makeRefappRepo>>) {
  const task = await loadTask(join(repo.tasksDir, "HX-001"));
  const refapp = await resolveRefapp(repo.root, "refapp-v1");
  return {
    task,
    staged: await stageRefappTask({
      repoRoot: repo.root,
      task,
      refapp,
      symbols: repo.symbols,
      symbolStore: repo.symbolStore,
      out: await Deno.makeTempDir(),
    }),
  };
}

Deno.test("stageRefappTask: refapp at the commit, overlay, deletions, symbols, C:\\task", async () => {
  const repo = await makeRefappRepo();
  const { task, staged: s } = await stage(repo);
  assertEquals(TASK_SOURCES.refapp, stageRefappTask);
  assertEquals(s.apps.map((a) => a.folder), ["Core", "Rental", "Test"]);
  assertEquals(s.apps[2]!.depends, ["Core", "Rental"]);
  assertEquals(s.apps[2]!.external, [IDS.assert]);
  assertStringIncludes(
    await Deno.readTextFile(join(s.workspace, "Rental/src/Rental.Codeunit.al")),
    "BUG",
  );
  assert(!await exists(join(s.workspace, "Rental/src/Old.Codeunit.al")));
  assert(!await exists(join(s.workspace, "Core/Core.app")));
  assert(!await exists(join(s.workspace, ".delete")));
  assertEquals(
    await Deno.readTextFile(
      join(s.workspace, ".alpackages", "Microsoft_Library Assert_28.0.0.0.app"),
    ),
    "assert-symbols",
  );
  assertEquals(
    await Deno.readTextFile(join(s.taskDir, "prompt.md")),
    "Rental price is wrong.",
  );
  assert(await exists(join(s.taskDir, "shots", "screen.png")));
  assertEquals(
    JSON.parse(await Deno.readTextFile(join(s.taskDir, "task.json"))),
    JSON.parse(JSON.stringify(agentVisibleMetadata(task.task))),
  );
  assertEquals(
    await Deno.readTextFile(join(s.pristine, "Rental/src/Rental.Codeunit.al")),
    await Deno.readTextFile(join(s.workspace, "Rental/src/Rental.Codeunit.al")),
  );
  assertEquals((await loadSymbolsLock(repo.root))!.length, 1);
});

Deno.test("stageRefappTask: a symbol store entry that does not match the lock is refused", async () => {
  const repo = await makeRefappRepo();
  await Deno.writeTextFile(
    join(repo.symbolStore, `${repo.symbols[0]!.sha256}.app`),
    "tampered",
  );
  await assertRejects(() => stage(repo), ValidationError, "does not match");
});

Deno.test("stageRefappTask: a .delete entry that escapes or is missing is refused", async () => {
  for (const line of ["../outside.al", "Rental/src/Nope.al"]) {
    const repo = await makeRefappRepo();
    await write(repo.tasksDir, "HX-001/overlay/.delete", `${line}\n`);
    await assertRejects(() => stage(repo), ValidationError, ".delete");
  }
});

Deno.test("readAppGraph: topological with name tie-break; a cycle is loud", async () => {
  const ws = await Deno.makeTempDir();
  const a = "c6a1e000-0000-4000-8000-0000000000a1";
  const b = "c6a1e000-0000-4000-8000-0000000000b1";
  const c = "c6a1e000-0000-4000-8000-0000000000c1";
  await write(ws, "Zeta/app.json", appJson(a, "Z", [70000, 70009], []));
  await write(ws, "Alpha/app.json", appJson(b, "A", [70010, 70019], [{ id: a, name: "Z" }]));
  await write(ws, "Beta/app.json", appJson(c, "B", [70020, 70029], []));
  await write(ws, ".alpackages/x.app", "bin");
  assertEquals((await readAppGraph(ws)).map((x) => x.folder), [
    "Beta",
    "Zeta",
    "Alpha",
  ]);
  await write(ws, "Zeta/app.json", appJson(a, "Z", [70000, 70009], [{ id: b, name: "A" }]));
  await assertRejects(() => readAppGraph(ws), ValidationError, "cycle");
});

Deno.test("buildSymbolsLock: digest store, lower-case ids, sorted by app id", async () => {
  const from = await Deno.makeTempDir();
  const store = await Deno.makeTempDir();
  await Deno.writeTextFile(join(from, "Microsoft_System_28.0.0.0.app"), "sys");
  await Deno.writeTextFile(join(from, "Microsoft_Base Application_28.0.0.0.app"), "base");
  await Deno.writeTextFile(join(from, "readme.txt"), "ignored");
  const ids: Record<string, string> = {
    "Microsoft_System_28.0.0.0.app": "8874ED3A-0643-4247-9CED-7A7002F7135D",
    "Microsoft_Base Application_28.0.0.0.app": "437dbf0e-84ff-417a-965d-ed2bb9650972",
  };
  const lock = await buildSymbolsLock(from, store, (p) => {
    const file = p.split(/[/\\]/).pop()!;
    return Promise.resolve({
      id: ids[file]!,
      name: file.split("_")[1]!,
      publisher: "Microsoft",
      version: "28.0.0.0",
    });
  });
  assertEquals(lock.packages.map((p) => p.app_id), [
    "437dbf0e-84ff-417a-965d-ed2bb9650972",
    "8874ed3a-0643-4247-9ced-7a7002f7135d",
  ]);
  const sys = lock.packages[1]!;
  assertEquals(sys.sha256, await hashFile(join(from, sys.file)));
  assert(await exists(join(store, `${sys.sha256}.app`)));
});

Deno.test("altoolReader: parses GetPackageManifest JSON; a failing altool is loud", async () => {
  const mock = createCommandMock();
  mock.mockCommandOnce({ command: "altool.exe", argsContain: ["GetPackageManifest"] }, {
    code: 0,
    stdout: JSON.stringify({
      id: "437DBF0E-84FF-417A-965D-ED2BB9650972",
      name: "Base Application",
      publisher: "Microsoft",
      version: "28.4.53241.53758",
      platform: "28.0.0.0",
    }),
    stderr: "",
  });
  mock.mockCommandOnce({ command: "altool.exe", argsContain: ["GetPackageManifest"] }, {
    code: 1,
    stdout: "",
    stderr: "boom",
  });
  mock.install();
  try {
    const read = altoolReader("altool.exe");
    assertEquals((await read("x.app")).id, "437dbf0e-84ff-417a-965d-ed2bb9650972");
    await assertRejects(() => read("y.app"), ValidationError, "boom");
  } finally {
    mock.restore();
  }
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/staging.test.ts`
Expected: FAIL, `Module not found ".../src/harness/staging.ts"`.

- [ ] **Step 3: Implement `src/harness/symbols.ts`**

```typescript
/**
 * Symbols lock (Part 1 contract `{ v: 1, packages }`) and the host symbol
 * store. Packages are stored by content digest, so the lock is the only
 * source of truth for which .app files a staged `.alpackages` holds.
 */

import { basename, join } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import { hashFile } from "./hash.ts";
import {
  SYMBOLS_LOCK_PATH,
  type SymbolPackage,
  SymbolsLockSchema,
} from "./identity.ts";
import { exists } from "./fsutil.ts";

export interface PackageManifest {
  id: string;
  name: string;
  publisher: string;
  version: string;
}
export type ManifestReader = (appPath: string) => Promise<PackageManifest>;

// Key names verified against a real compiler cache in M1-26.
const AltoolManifest = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  publisher: z.string().min(1),
  version: z.string().min(1),
});

/** Read an .app manifest with `altool GetPackageManifest` (host process). */
export function altoolReader(altool: string): ManifestReader {
  return async (appPath) => {
    const out = await new Deno.Command(altool, {
      args: ["GetPackageManifest", appPath],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const text = new TextDecoder().decode(out.stdout);
    if (!out.success) {
      const err = new TextDecoder().decode(out.stderr).trim();
      throw new ValidationError(
        `altool GetPackageManifest failed for ${appPath}: ${err}`,
        [appPath],
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ValidationError(`altool output is not JSON for ${appPath}`, [
        text.slice(0, 200),
      ]);
    }
    const m = AltoolManifest.safeParse(raw);
    if (!m.success) {
      throw new ValidationError(
        `unexpected altool manifest shape for ${appPath}`,
        m.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      );
    }
    return { ...m.data, id: m.data.id.toLowerCase() };
  };
}

/** altool next to a BCH compiler-cache symbols folder (layout of bc-platform-version.ts). */
export function defaultAltool(symbolsDir: string): string {
  return join(symbolsDir, "..", "compiler", "extension", "bin", "win32", "altool.exe");
}

/** Hash every .app in fromDir, copy it into the store as <sha256>.app, build the lock. */
export async function buildSymbolsLock(
  fromDir: string,
  store: string,
  read: ManifestReader,
): Promise<{ v: 1; packages: SymbolPackage[] }> {
  await Deno.mkdir(store, { recursive: true });
  const names: string[] = [];
  for await (const e of Deno.readDir(fromDir)) {
    if (e.isFile && e.name.toLowerCase().endsWith(".app")) names.push(e.name);
  }
  if (names.length === 0) {
    throw new ValidationError(`no .app files in ${fromDir}`, [fromDir]);
  }
  const packages: SymbolPackage[] = [];
  for (const name of names.sort()) {
    const path = join(fromDir, name);
    const sha256 = await hashFile(path);
    const m = await read(path);
    const stored = join(store, `${sha256}.app`);
    if (!await exists(stored)) await Deno.copyFile(path, stored);
    packages.push({
      app_id: m.id.toLowerCase(),
      name: m.name,
      publisher: m.publisher,
      version: m.version,
      file: basename(name),
      sha256,
    });
  }
  packages.sort((a, b) => a.app_id.localeCompare(b.app_id));
  const parsed = SymbolsLockSchema.safeParse({ v: 1, packages });
  if (!parsed.success) {
    throw new ValidationError(
      "symbols lock does not validate",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  return { v: 1, packages: parsed.data.packages };
}

export async function writeSymbolsLock(
  repoRoot: string,
  lock: { v: 1; packages: SymbolPackage[] },
): Promise<void> {
  const path = join(repoRoot, SYMBOLS_LOCK_PATH);
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(
    path,
    JSON.stringify(SymbolsLockSchema.parse(lock), null, 2) + "\n",
  );
}

// ponytail: verified once per process; the store is operator-owned.
const verified = new Set<string>();

/** Copy locked packages from the store into dst, verifying each digest once. */
export async function restoreSymbols(
  store: string,
  packages: SymbolPackage[],
  dst: string,
): Promise<void> {
  await Deno.mkdir(dst, { recursive: true });
  for (const p of packages) {
    const src = join(store, `${p.sha256}.app`);
    if (!verified.has(src)) {
      if (!await exists(src) || await hashFile(src) !== p.sha256) {
        throw new ValidationError(
          `symbol store entry ${src} does not match the lock (${p.file})`,
          [p.file],
        );
      }
      verified.add(src);
    }
    await Deno.copyFile(src, join(dst, p.file));
  }
}
```

The `verified` cache would hide the tampering in the second test if both stagings ran in one process against the same store path; the fixture makes a fresh store per repo, so they do not.

- [ ] **Step 4: Implement `src/harness/staging.ts`**

```typescript
/**
 * Task staging (spec 1a section 5 item 1, D16). A task source turns a task
 * into a workspace plus its app list in dependency order. `refapp` is the
 * only source in 1a; `git` (BC-Bench style) plugs in through TASK_SOURCES.
 */

import { isAbsolute, join, normalize } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import { isTaskBuildArtifact, listTree } from "./hash.ts";
import {
  agentVisibleMetadata,
  REFAPP_PATH,
  type RefappRef,
  type SymbolPackage,
} from "./identity.ts";
import { exists, safeCopyTree } from "./fsutil.ts";
import { restoreSymbols } from "./symbols.ts";
import type { HarnessTask, LoadedTask } from "./task.ts";

const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const AppJsonSchema = z.object({
  id: z.string().regex(GUID),
  name: z.string().min(1),
  publisher: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
  idRanges: z.array(z.object({ from: z.number().int(), to: z.number().int() }))
    .default([]),
  dependencies: z.array(z.object({ id: z.string().regex(GUID) })).default([]),
});
export type AppJson = z.output<typeof AppJsonSchema>;

export interface StagedApp {
  folder: string;
  id: string;
  name: string;
  publisher: string;
  version: string;
  idRanges: { from: number; to: number }[];
  /** Workspace folders this app depends on. */
  depends: string[];
  /** Lower-case dependency ids outside the workspace (symbols). */
  external: string[];
}

export async function readAppJson(path: string): Promise<AppJson> {
  let raw: unknown;
  try {
    raw = JSON.parse(await Deno.readTextFile(path));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`${path}: ${msg}`, [msg]);
  }
  const r = AppJsonSchema.safeParse(raw);
  if (!r.success) {
    const errors = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ValidationError(`Invalid app.json at ${path}: ${errors.join("; ")}`, errors);
  }
  return r.data;
}

/** Every top-level folder with an app.json, in dependency order. */
export async function readAppGraph(workspace: string): Promise<StagedApp[]> {
  const found: { app: StagedApp; deps: string[] }[] = [];
  for await (const e of Deno.readDir(workspace)) {
    if (!e.isDirectory || e.name.startsWith(".")) continue;
    let a: AppJson;
    try {
      a = await readAppJson(join(workspace, e.name, "app.json"));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) continue;
      throw err;
    }
    found.push({
      app: {
        folder: e.name,
        id: a.id.toLowerCase(),
        name: a.name,
        publisher: a.publisher,
        version: a.version,
        idRanges: a.idRanges,
        depends: [],
        external: [],
      },
      deps: a.dependencies.map((d) => d.id.toLowerCase()),
    });
  }
  const byId = new Map(found.map((f) => [f.app.id, f.app]));
  for (const f of found) {
    for (const id of f.deps) {
      const t = byId.get(id);
      if (t) f.app.depends.push(t.folder);
      else f.app.external.push(id);
    }
    f.app.depends.sort();
    f.app.external.sort();
  }
  return topoSort(found.map((f) => f.app));
}

function topoSort(apps: StagedApp[]): StagedApp[] {
  const out: StagedApp[] = [];
  const done = new Set<string>();
  let rest = [...apps].sort((a, b) => a.folder.localeCompare(b.folder));
  while (rest.length > 0) {
    const next = rest.find((a) => a.depends.every((d) => done.has(d)));
    if (!next) {
      throw new ValidationError(
        `dependency cycle among: ${rest.map((a) => a.folder).join(", ")}`,
        rest.map((a) => a.folder),
      );
    }
    out.push(next);
    done.add(next.folder);
    rest = rest.filter((a) => a !== next);
  }
  return out;
}

/** `folders` plus every app that depends on one of them, transitively. */
export function dependentsClosure(
  apps: StagedApp[],
  folders: Iterable<string>,
): Set<string> {
  const set = new Set(folders);
  for (const a of apps) { // dependency order: one pass is enough
    if (a.depends.some((d) => set.has(d))) set.add(a.folder);
  }
  return set;
}

export const DELETE_LIST = ".delete";

function safeRelative(line: string): boolean {
  return !isAbsolute(line) &&
    !normalize(line).replaceAll("\\", "/").split("/").includes("..");
}

/** Copy an overlay onto target, then apply its `.delete` list. */
export async function applyOverlay(
  overlayDir: string,
  target: string,
  opts: { exclude?: (rel: string) => boolean } = {},
): Promise<void> {
  if (!await exists(overlayDir)) return;
  const r = await safeCopyTree(overlayDir, target, {
    skip: (rel) => rel === DELETE_LIST || (opts.exclude?.(rel) ?? false),
  });
  if (r.refused.length > 0) {
    throw new ValidationError(`links in ${overlayDir}: ${r.refused.join(", ")}`, r.refused);
  }
  const list = join(overlayDir, DELETE_LIST);
  if (!await exists(list)) return;
  for (const raw of (await Deno.readTextFile(list)).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (opts.exclude?.(line)) continue;
    if (!safeRelative(line)) {
      throw new ValidationError(`${list}: .delete entry escapes the workspace: ${line}`, [line]);
    }
    const p = join(target, line);
    if (!await exists(p)) {
      throw new ValidationError(`${list}: .delete entry not found: ${line}`, [line]);
    }
    await Deno.remove(p, { recursive: true });
  }
}

export interface StageOptions {
  repoRoot: string;
  task: LoadedTask;
  refapp: RefappRef;
  symbols: SymbolPackage[];
  symbolStore: string;
  out: string;
}

export interface StagedWorkspace {
  /** Mounted read-write into the sandbox as C:\workspace. */
  workspace: string;
  /** Untouched copy of the staged workspace: the trusted verdict input. */
  pristine: string;
  /** Mounted read-only as C:\task. */
  taskDir: string;
  apps: StagedApp[];
}

export type TaskSource = (o: StageOptions) => Promise<StagedWorkspace>;

async function run(cmd: string, args: string[], cwd?: string): Promise<void> {
  const out = await new Deno.Command(cmd, {
    args,
    ...(cwd ? { cwd } : {}),
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!out.success) {
    const err = new TextDecoder().decode(out.stderr).trim();
    throw new ValidationError(`${cmd} ${args.join(" ")} failed: ${err}`, [err]);
  }
}

export async function stageRefappTask(o: StageOptions): Promise<StagedWorkspace> {
  const workspace = join(o.out, "workspace");
  const pristine = join(o.out, "pristine");
  const taskDir = join(o.out, "task");
  const extract = join(o.out, "refapp-extract");
  for (const d of [workspace, taskDir, extract]) {
    await Deno.mkdir(d, { recursive: true });
  }
  // 1. The refapp source at the resolved commit, build artifacts dropped:
  //    exactly the files resolveRefapp hashed (Part 1 contract).
  const tar = join(o.out, "refapp.tar");
  await run("git", ["archive", "--format=tar", "-o", tar, o.refapp.commit, REFAPP_PATH], o.repoRoot);
  await run("tar", ["-xf", tar, "-C", extract, "--strip-components=2"]);
  await safeCopyTree(extract, workspace, { skip: isTaskBuildArtifact });
  await Deno.remove(extract, { recursive: true });
  await Deno.remove(tar);
  const got = await listTree(workspace, "task");
  if (JSON.stringify(got) !== JSON.stringify(o.refapp.files)) {
    throw new ValidationError(
      `staged refapp does not match ${o.refapp.version} (${o.refapp.commit})`,
      [o.refapp.commit],
    );
  }
  // 2. Task overlay (injected bug, stub, removed feature).
  await applyOverlay(join(o.task.dir, "overlay"), workspace);
  // 3. Pre-seeded symbols, verified against the lock.
  await restoreSymbols(o.symbolStore, o.symbols, join(workspace, ".alpackages"));
  // 4. C:\task: prompt, attachments, agent-visible metadata only.
  const t = o.task.task;
  await Deno.copyFile(join(o.task.dir, t.prompt), join(taskDir, "prompt.md"));
  for (const a of t.attachments) {
    await Deno.mkdir(join(taskDir, a, ".."), { recursive: true });
    await Deno.copyFile(join(o.task.dir, a), join(taskDir, a));
  }
  await Deno.writeTextFile(
    join(taskDir, "task.json"),
    JSON.stringify(agentVisibleMetadata(t), null, 2) + "\n",
  );
  await safeCopyTree(workspace, pristine);
  return { workspace, pristine, taskDir, apps: await readAppGraph(workspace) };
}

export const TASK_SOURCES: Record<HarnessTask["source"], TaskSource> = {
  refapp: stageRefappTask,
};
```

- [ ] **Step 5: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/staging.test.ts`
Expected: all 7 tests pass (needs `git` and `tar` on PATH; Windows 10+ ships `tar.exe`).

- [ ] **Step 6: Check, lint, format**

```bash
deno check src/harness/symbols.ts src/harness/staging.ts tests/unit/harness/refapp-fixture.ts tests/unit/harness/staging.test.ts
deno lint src/harness/symbols.ts src/harness/staging.ts tests/unit/harness/refapp-fixture.ts tests/unit/harness/staging.test.ts
deno fmt src/harness/symbols.ts src/harness/staging.ts tests/unit/harness/refapp-fixture.ts tests/unit/harness/staging.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/harness/symbols.ts src/harness/staging.ts tests/unit/harness/refapp-fixture.ts tests/unit/harness/staging.test.ts
git commit -m "feat(harness): symbols lock, app graph and refapp task staging"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/staging.test.ts` passes; check, lint and `deno fmt --check` clean on the four files.

---
### Task M1-14: verdict workspace reconstruction and validation

Spec 1a section 7 items 1-4 and section 11 ("Unit: ... verdict-workspace reconstruction and validation"): start from the trusted staged inputs; take from the artifact only source files under the existing app folders and their `app.json`, plus new files under `Test\`; drop every `*.app`; restore shipped test files; validate app ids, names and publishers, acyclic dependencies within the workspace plus symbols, object ids within the declared ranges and outside the reserved bands; refuse links. The test-authoring boundary (production reset to the reference) is the `productionFrom` option. `idRanges` are validated against the pristine `app.json`, because an agent that could widen its own range could move objects into another module's or the reserved band (open question 6).

**Lane:** infra. **Deps:** M1-02 (`hashTree`, `listTree`, `isTaskBuildArtifact`), M1-11 (constants), M1-12, M1-13.

**Files:**
- Create: `src/harness/verdict-workspace.ts`
- Test: `tests/unit/harness/verdict-workspace.test.ts`

**Interfaces:**
- Consumes: `safeCopyTree`, `exists`, `FREEZE_VIOLATIONS_FILE` (M1-12); `readAppGraph`, `StagedApp` (M1-13); `HARNESS_ORACLE_RANGE` (M1-11); `BENCHMARK_APP_ID_BUFFER`.
- Produces: `TEST_APP = "Test"`; `interface ReconstructOptions { pristine: string; artifact: string; out: string; productionFrom?: string | undefined; symbolIds: ReadonlySet<string> }`; `interface VerdictWorkspace { dir: string; apps: StagedApp[]; changed: string[]; violations: string[] }`; `buildVerdictWorkspace(o): Promise<VerdictWorkspace>`; `validateApps(dir, pristine: StagedApp[], apps: StagedApp[], symbolIds): Promise<string[]>`; `stripAlComments(src: string): string`; `interface AlObjectRef { file; kind; id }`; `alObjects(dir): Promise<AlObjectRef[]>`; `interface TestCodeunit { codeunit: number; file: string; testPage: boolean }`; `testCodeunits(dir): Promise<TestCodeunit[]>`; `addedTestCodeunits(pristineTest: string, test: string): Promise<TestCodeunit[]>`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/verdict-workspace.test.ts`:

```typescript
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { exists, FREEZE_VIOLATIONS_FILE, safeCopyTree } from "../../../src/harness/fsutil.ts";
import {
  addedTestCodeunits,
  buildVerdictWorkspace,
  stripAlComments,
} from "../../../src/harness/verdict-workspace.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";

const SHIPPED =
  `codeunit 80000 "CGR Shipped Tests"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure ShippedPasses()\n    begin\n        Assert.AreEqual(10, Rental.Price(), 'price');\n    end;\n}\n`;

async function pristineDir(): Promise<string> {
  const d = await Deno.makeTempDir();
  await write(d, "Core/app.json", appJson(IDS.core, "CGR Core", [70000, 70099], []));
  await write(d, "Core/src/Core.Codeunit.al", `codeunit 70000 "CGR Core"\n{\n}\n`);
  await write(d, "Core/src/Extra.Codeunit.al", `codeunit 70001 "CGR Extra"\n{\n}\n`);
  await write(
    d,
    "Test/app.json",
    appJson(IDS.test, "CGR Test", [80000, 80099], [
      { id: IDS.core, name: "CGR Core" },
      { id: IDS.assert, name: "Library Assert" },
    ]),
  );
  await write(d, "Test/src/Shipped.Test.al", SHIPPED);
  await write(d, ".alpackages/Microsoft_Library Assert_28.0.0.0.app", "sym");
  return d;
}

/** Copy of pristine without symbols, with edits applied (null deletes). */
async function artifactFrom(
  pristine: string,
  edits: Record<string, string | null>,
): Promise<string> {
  const a = await Deno.makeTempDir();
  await safeCopyTree(pristine, a, { skip: (r) => r.startsWith(".alpackages") });
  for (const [rel, text] of Object.entries(edits)) {
    if (text === null) await Deno.remove(join(a, rel));
    else await write(a, rel, text);
  }
  return a;
}

const SYM = new Set([IDS.assert]);

async function rebuild(p: string, a: string, productionFrom?: string) {
  return await buildVerdictWorkspace({
    pristine: p,
    artifact: a,
    out: join(await Deno.makeTempDir(), "verdict"),
    symbolIds: SYM,
    productionFrom,
  });
}

Deno.test("a shipped test edited to always pass is restored", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {
    "Test/src/Shipped.Test.al": SHIPPED.replace(/Assert\.AreEqual[^\n]*\n/, "\n"),
  });
  const v = await rebuild(p, a);
  assertEquals(await Deno.readTextFile(join(v.dir, "Test/src/Shipped.Test.al")), SHIPPED);
  assertEquals(v.violations, []);
  assertEquals(v.changed, []);
});

Deno.test("hand-made .app files and artifact symbols are dropped", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {
    "Core/CentralGauge_CGR Core_9.9.9.9.app": "fake",
    ".alpackages/Evil.app": "fake",
  });
  const v = await rebuild(p, a);
  assert(!await exists(join(v.dir, "Core/CentralGauge_CGR Core_9.9.9.9.app")));
  assert(!await exists(join(v.dir, ".alpackages/Evil.app")));
  assert(await exists(join(v.dir, ".alpackages/Microsoft_Library Assert_28.0.0.0.app")));
});

Deno.test("new test files are taken; new top-level folders and root files are ignored", async () => {
  const p = await pristineDir();
  const added = `codeunit 80010 "Agent Tests"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure T()\n    begin\n    end;\n}\n`;
  const a = await artifactFrom(p, {
    "Test/src/Agent.Test.al": added,
    "NewApp/app.json": appJson("c6a1e000-0000-4000-8000-0000000000ee", "New", [70500, 70599], []),
    "AGENTS.md": "notes",
  });
  const v = await rebuild(p, a);
  assertEquals(await Deno.readTextFile(join(v.dir, "Test/src/Agent.Test.al")), added);
  assert(!await exists(join(v.dir, "NewApp")));
  assert(!await exists(join(v.dir, "AGENTS.md")));
  assertEquals(v.changed, ["Test"]);
  assertEquals(
    (await addedTestCodeunits(join(p, "Test"), join(v.dir, "Test"))).map((t) => t.codeunit),
    [80010],
  );
});

Deno.test("changed app id, name or idRanges is a violation", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {
    "Core/app.json": appJson("c6a1e000-0000-4000-8000-0000000000aa", "CGR Core2", [70000, 70999], []),
  });
  const v = await rebuild(p, a);
  const text = v.violations.join("\n");
  assertStringIncludes(text, "Core: id changed");
  assertStringIncludes(text, "Core: name changed");
  assertStringIncludes(text, "Core: idRanges changed");
});

Deno.test("objects outside idRanges, in the reserved band or the oracle band are violations", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {
    "Core/src/Far.Codeunit.al": `codeunit 70150 "Far"\n{\n}\n`,
    "Core/src/Reserved.Codeunit.al": `codeunit 75001 "R"\n{\n}\n`,
    "Test/src/Oracle.Test.al": `codeunit 85001 "O"\n{\n    Subtype = Test;\n}\n`,
    "Core/src/Commented.Codeunit.al": `// codeunit 75002 "not real"\n/* codeunit 75003 "nor this" */\ncodeunit 70002 "Fine"\n{\n}\n`,
  });
  const v = await rebuild(p, a);
  const text = v.violations.join("\n");
  assertStringIncludes(text, "codeunit 70150 is outside the app's idRanges");
  assertStringIncludes(text, "codeunit 75001 is in the reserved band");
  assertStringIncludes(text, "codeunit 85001 is in the hidden-oracle band");
  assert(!text.includes("75002") && !text.includes("75003"));
});

Deno.test("freeze violations and unknown dependencies fail validation", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {
    [FREEZE_VIOLATIONS_FILE]: "link or special file: Core/hostlink\n",
    "Core/app.json": appJson(IDS.core, "CGR Core", [70000, 70099], [
      { id: "11111111-2222-4333-8444-555555555555", name: "Unknown" },
    ]),
  });
  const text = (await rebuild(p, a)).violations.join("\n");
  assertStringIncludes(text, "workspace link or special file: Core/hostlink");
  assertStringIncludes(text, "11111111-2222-4333-8444-555555555555 is neither");
});

Deno.test("a deleted production file stays deleted and the app is changed", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, { "Core/src/Extra.Codeunit.al": null });
  const v = await rebuild(p, a);
  assert(!await exists(join(v.dir, "Core/src/Extra.Codeunit.al")));
  assertEquals(v.changed, ["Core"]);
});

Deno.test("test-authoring: production comes from the reference, tests from the artifact", async () => {
  const p = await pristineDir();
  const reference = await artifactFrom(p, {
    "Core/src/Core.Codeunit.al": `codeunit 70000 "CGR Core"\n{\n    // reference\n}\n`,
  });
  const a = await artifactFrom(p, {
    "Core/src/Core.Codeunit.al": `codeunit 70000 "CGR Core"\n{\n    // agent change\n}\n`,
    "Test/src/Agent.Test.al": `codeunit 80011 "Agent"\n{\n    Subtype = Test;\n}\n`,
  });
  const v = await rebuild(p, a, reference);
  assertStringIncludes(await Deno.readTextFile(join(v.dir, "Core/src/Core.Codeunit.al")), "reference");
  assert(await exists(join(v.dir, "Test/src/Agent.Test.al")));
});

Deno.test("stripAlComments: line and block comments", () => {
  assertEquals(stripAlComments("a // b\n/* c\nd */e"), "a \ne");
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/verdict-workspace.test.ts`
Expected: FAIL, `Module not found ".../src/harness/verdict-workspace.ts"`.

- [ ] **Step 3: Implement**

`src/harness/verdict-workspace.ts`:

```typescript
/**
 * Verdict workspace (spec 1a section 7 items 1-4). Never the agent's
 * workspace as-is: start from the trusted staged copy, take only production
 * app folders (or the reference, for test-authoring) and new Test\ files
 * from the artifact, then validate. Violations fail the build scorer.
 */

import { join } from "@std/path";
import { BENCHMARK_APP_ID_BUFFER, HARNESS_ORACLE_RANGE } from "../constants.ts";
import { ValidationError } from "../errors.ts";
import { hashTree, isTaskBuildArtifact, listTree } from "./hash.ts";
import { exists, FREEZE_VIOLATIONS_FILE, safeCopyTree } from "./fsutil.ts";
import { readAppGraph, type StagedApp } from "./staging.ts";

export const TEST_APP = "Test";

export interface ReconstructOptions {
  /** Staged workspace (refapp + overlay + symbols): trusted. */
  pristine: string;
  /** Frozen workspace from the store: untrusted. */
  artifact: string;
  out: string;
  /** test-authoring: production app folders come from this reference tree. */
  productionFrom?: string | undefined;
  /** Lower-case app ids of the symbols lock. */
  symbolIds: ReadonlySet<string>;
}

export interface VerdictWorkspace {
  dir: string;
  apps: StagedApp[];
  /** App folders whose content differs from the staged workspace. */
  changed: string[];
  violations: string[];
}

export async function buildVerdictWorkspace(
  o: ReconstructOptions,
): Promise<VerdictWorkspace> {
  const violations: string[] = [];
  const pristineApps = await readAppGraph(o.pristine);
  await safeCopyTree(o.pristine, o.out);

  const marker = join(o.artifact, FREEZE_VIOLATIONS_FILE);
  if (await exists(marker)) {
    for (const line of (await Deno.readTextFile(marker)).split(/\r?\n/)) {
      if (line.trim()) violations.push(`workspace ${line.trim()}`);
    }
  }

  const production = o.productionFrom ?? o.artifact;
  for (const app of pristineApps) {
    if (app.folder === TEST_APP) continue;
    const src = join(production, app.folder);
    if (!await exists(src)) {
      violations.push(`app folder ${app.folder} is missing`);
      continue;
    }
    await Deno.remove(join(o.out, app.folder), { recursive: true });
    const r = await safeCopyTree(src, join(o.out, app.folder), {
      skip: isTaskBuildArtifact,
    });
    violations.push(...r.refused.map((p) => `link refused: ${app.folder}/${p}`));
  }

  const testSrc = join(o.artifact, TEST_APP);
  if (await exists(testSrc)) {
    const shipped = new Set(
      (await listTree(join(o.pristine, TEST_APP), "task")).map((e) => e.path),
    );
    const r = await safeCopyTree(testSrc, join(o.out, TEST_APP), {
      skip: (rel) =>
        isTaskBuildArtifact(rel) || (rel !== "app.json" && shipped.has(rel)),
    });
    violations.push(...r.refused.map((p) => `link refused: ${TEST_APP}/${p}`));
  }

  let apps = pristineApps;
  try {
    apps = await readAppGraph(o.out);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    violations.push(err.message);
  }
  violations.push(...await validateApps(o.out, pristineApps, apps, o.symbolIds));

  const changed: string[] = [];
  for (const app of pristineApps) {
    const before = await hashTree(join(o.pristine, app.folder), "task");
    const after = await hashTree(join(o.out, app.folder), "task");
    if (before !== after) changed.push(app.folder);
  }
  return { dir: o.out, apps, changed, violations };
}

const OBJECT_RE =
  /^\s*(tableextension|pageextension|reportextension|enumextension|permissionsetextension|table|page|report|query|xmlport|codeunit|enum|permissionset|entitlement)\s+(\d+)\b/i;

/**
 * Remove AL comments before scanning declarations.
 * ponytail: a string literal holding comment tokens can hide a declaration
 * from this scan; the publish still catches a real id collision.
 */
export function stripAlComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\r\n]*/g, "");
}

export interface AlObjectRef {
  file: string;
  kind: string;
  id: number;
}

export async function alObjects(dir: string): Promise<AlObjectRef[]> {
  const out: AlObjectRef[] = [];
  for (const e of await listTree(dir, "task", { optional: true })) {
    if (!e.path.toLowerCase().endsWith(".al")) continue;
    const text = stripAlComments(await Deno.readTextFile(join(dir, e.path)));
    for (const line of text.split(/\r?\n/)) {
      const m = OBJECT_RE.exec(line);
      if (m) out.push({ file: e.path, kind: m[1]!.toLowerCase(), id: Number(m[2]) });
    }
  }
  return out;
}

export async function validateApps(
  dir: string,
  pristine: StagedApp[],
  apps: StagedApp[],
  symbolIds: ReadonlySet<string>,
): Promise<string[]> {
  const v: string[] = [];
  const now = new Map(apps.map((a) => [a.folder, a]));
  for (const p of pristine) {
    const a = now.get(p.folder);
    if (!a) {
      v.push(`${p.folder}: app.json missing or unreadable`);
      continue;
    }
    for (const k of ["id", "name", "publisher"] as const) {
      if (a[k] !== p[k]) v.push(`${p.folder}: ${k} changed from ${p[k]} to ${a[k]}`);
    }
    if (JSON.stringify(a.idRanges) !== JSON.stringify(p.idRanges)) {
      v.push(`${p.folder}: idRanges changed`);
    }
    for (const ext of a.external) {
      if (!symbolIds.has(ext)) {
        v.push(`${p.folder}: dependency ${ext} is neither a workspace app nor a locked symbol package`);
      }
    }
    for (const o of await alObjects(join(dir, p.folder))) {
      const where = `${p.folder}/${o.file}: ${o.kind} ${o.id}`;
      if (!p.idRanges.some((r) => o.id >= r.from && o.id <= r.to)) {
        v.push(`${where} is outside the app's idRanges`);
      }
      if (o.id >= BENCHMARK_APP_ID_BUFFER.start && o.id <= BENCHMARK_APP_ID_BUFFER.end) {
        v.push(`${where} is in the reserved band`);
      }
      if (o.id >= HARNESS_ORACLE_RANGE.start && o.id <= HARNESS_ORACLE_RANGE.end) {
        v.push(`${where} is in the hidden-oracle band`);
      }
    }
  }
  return v;
}

export interface TestCodeunit {
  codeunit: number;
  file: string;
  /** TestPage cannot run on the SOAP runner (soap-test-harness.md). */
  testPage: boolean;
}

/** Codeunits with `Subtype = Test` under dir. */
export async function testCodeunits(dir: string): Promise<TestCodeunit[]> {
  const out: TestCodeunit[] = [];
  for (const e of await listTree(dir, "task", { optional: true })) {
    if (!e.path.toLowerCase().endsWith(".al")) continue;
    const text = stripAlComments(await Deno.readTextFile(join(dir, e.path)));
    const m = /^\s*codeunit\s+(\d+)\b/im.exec(text);
    if (m && /\bSubtype\s*=\s*Test\s*;/i.test(text)) {
      out.push({ codeunit: Number(m[1]), file: e.path, testPage: /\bTestPage\b/i.test(text) });
    }
  }
  return out.sort((a, b) => a.codeunit - b.codeunit);
}

/** Test codeunits in files the shipped Test app does not have. */
export async function addedTestCodeunits(
  pristineTest: string,
  test: string,
): Promise<TestCodeunit[]> {
  const shipped = new Set((await listTree(pristineTest, "task")).map((e) => e.path));
  return (await testCodeunits(test)).filter((t) => !shipped.has(t.file));
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/verdict-workspace.test.ts`
Expected: all 9 tests pass.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/verdict-workspace.ts tests/unit/harness/verdict-workspace.test.ts
deno lint src/harness/verdict-workspace.ts tests/unit/harness/verdict-workspace.test.ts
deno fmt src/harness/verdict-workspace.ts tests/unit/harness/verdict-workspace.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/verdict-workspace.ts tests/unit/harness/verdict-workspace.test.ts
git commit -m "feat(harness): verdict workspace reconstruction and validation"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/verdict-workspace.test.ts` passes; check, lint and `deno fmt --check` clean.

---

### Task M1-15: candidate-scoped BC app sync

Spec 1a section 7 item 5 and findings section 8 ("Broken: `prepareCandidateApp` cleanup removes refapp dependency apps. The M1 verdict workspace must scope cleanup to candidate app ids (not rename apps to `*Prereq*`), define persistent prerequisite app ids, refresh stale prerequisite versions"). bc-container-quirks.md: one warm-slot script per operation, never split. The pure planner decides; the provider executes. A bench candidate left on the container (shared `BENCHMARK_APP_ID`, objects in 70000-74999, the same band as the refapp) would collide with refapp objects, so every CentralGauge app that is not wanted, not `*Prereq*` and not the test harness is removed too.

**Lane:** infra. **Deps:** M1-02 (`hashJson`, `hashTree`), M1-13 (`StagedApp`, `dependentsClosure`).

**Files:**
- Create: `src/harness/bc-apps.ts`
- Modify: `src/container/types.ts` (two interfaces)
- Modify: `src/container/bc-script-builders.ts` (two builders)
- Modify: `src/container/bc-output-parsers.ts` (two parsers)
- Modify: `src/container/bc-container-provider.ts` (three public methods, one protected helper, two `SCRIPT_LABEL_OPERATION` entries)
- Test: `tests/unit/harness/bc-apps.test.ts`, `tests/unit/harness/bc-sync-provider.test.ts`

**Interfaces:**
- Produces (types.ts): `interface HarnessInstalledApp { id; name; publisher; version; installed: boolean }`; `interface HarnessSyncResult { removed: string[]; warnings: string[]; removeIncomplete: string[]; published: { index: number; startMs: number; endMs: number }[]; failed: { index: number; message: string } | null; done: boolean; output: string }`.
- Produces (provider): `listHarnessApps(container): Promise<HarnessInstalledApp[]>`; `syncHarnessApps(container, plan: { removeIds: string[]; publish: string[] }): Promise<HarnessSyncResult>` (throws `ContainerError` on incomplete removal, returns a publish failure); `runHarnessTests(container, codeunit: number): Promise<TestResult>`.
- Produces (builders/parsers): `buildListHarnessAppsScript(container)`, `buildSyncHarnessAppsScript(container, removeIds, appFiles, credentials)`, `parseHarnessAppList(output): HarnessInstalledApp[] | null`, `parseHarnessSyncOutput(output): Omit<HarnessSyncResult, "output">`.
- Produces (bc-apps.ts): `CG_PUBLISHER`, `HARNESS_APP_NAME`; `type AppRole = "prereq" | "candidate"`; `interface WantedApp { id; name; publisher; version; file: string; role: AppRole; depends: string[] /* ids */ }`; `interface SyncPlan { remove: string[]; publish: WantedApp[] }`; `stampVersion(base: string, role: AppRole, stamp: string): string`; `appStamps(dir: string, apps: StagedApp[]): Promise<Map<string, string>>`; `candidateFolders(apps: StagedApp[], changed: string[]): string[]`; `planAppSync(installed: HarnessInstalledApp[], wanted: WantedApp[]): SyncPlan`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/harness/bc-apps.test.ts`:

```typescript
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { HarnessInstalledApp } from "../../../src/container/types.ts";
import {
  appStamps,
  candidateFolders,
  planAppSync,
  stampVersion,
  type WantedApp,
} from "../../../src/harness/bc-apps.ts";
import type { StagedApp } from "../../../src/harness/staging.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";

const id = (n: number) => `c6a1e000-0000-4000-8000-00000000000${n}`;
const app = (folder: string, n: number, depends: string[] = []): StagedApp => ({
  folder,
  id: id(n),
  name: `CGR ${folder}`,
  publisher: "CentralGauge",
  version: "1.0.0.0",
  idRanges: [],
  depends,
  external: [],
});
/** The refapp graph from findings section 2, in dependency order. */
const APPS = [
  app("Core", 1),
  app("Fleet", 2, ["Core"]),
  app("Integration", 5, ["Core"]),
  app("Leasing", 4, ["Core"]),
  app("Rental", 3, ["Core", "Fleet"]),
  app("Reporting", 6, ["Fleet", "Leasing", "Rental"]),
  app("Test", 7, ["Core", "Fleet", "Integration", "Leasing", "Rental", "Reporting"]),
];
const PREREQ_V = "1.0.1234.56";

function wanted(candidates: string[]): WantedApp[] {
  const byFolder = new Map(APPS.map((a) => [a.folder, a]));
  return APPS.map((a) => {
    const role = candidates.includes(a.folder) ? "candidate" : "prereq";
    return {
      id: a.id,
      name: a.name,
      publisher: a.publisher,
      version: role === "prereq" ? PREREQ_V : "1.0.0.0",
      file: `${a.folder}.app`,
      role,
      depends: a.depends.map((d) => byFolder.get(d)!.id),
    };
  });
}
const inst = (n: number, version: string, installed = true): HarnessInstalledApp => ({
  id: id(n),
  name: `x${n}`,
  publisher: "CentralGauge",
  version,
  installed,
});

Deno.test("candidateFolders: changed apps, their dependents and Test", () => {
  assertEquals(candidateFolders(APPS, []), ["Test"]);
  assertEquals(candidateFolders(APPS, ["Rental"]), ["Rental", "Reporting", "Test"]);
  assertEquals(candidateFolders(APPS, ["Core"]), APPS.map((a) => a.folder));
});

Deno.test("planAppSync: a fresh container publishes everything in dependency order", () => {
  const plan = planAppSync([], wanted(["Test"]));
  // Every wanted id that is not kept is removed first; absent ids are no-ops
  // in the script, and a published-but-unlisted candidate can never survive.
  assertEquals(plan.remove, [...APPS].reverse().map((a) => a.id));
  assertEquals(plan.publish.map((w) => w.file), APPS.map((a) => `${a.folder}.app`));
});

Deno.test("planAppSync: refapp dependency apps stay installed", () => {
  const installed = [
    inst(1, PREREQ_V), inst(2, PREREQ_V), inst(5, PREREQ_V), inst(4, PREREQ_V),
    inst(3, "1.0.0.0"), inst(6, "1.0.0.0"), inst(7, "1.0.0.0"),
  ];
  const plan = planAppSync(installed, wanted(["Rental", "Reporting", "Test"]));
  assertEquals(plan.remove, [id(7), id(6), id(3)]);
  assertEquals(plan.publish.map((w) => w.file), ["Rental.app", "Reporting.app", "Test.app"]);
});

Deno.test("planAppSync: prerequisites are every non-candidate workspace app", () => {
  const w = wanted(["Test"]);
  assertEquals(w.filter((x) => x.role === "prereq").length, 6);
  const warm = planAppSync(
    [1, 2, 5, 4, 3, 6].map((n) => inst(n, PREREQ_V)),
    w,
  );
  assertEquals(warm.remove, [id(7)]);
  assertEquals(warm.publish.map((x) => x.file), ["Test.app"]);
});

Deno.test("planAppSync: a stale prerequisite is removed with its dependents and republished", () => {
  const installed = [inst(1, "1.0.999.1"), ...[2, 5, 4, 3, 6].map((n) => inst(n, PREREQ_V))];
  const plan = planAppSync(installed, wanted(["Test"]));
  assertEquals(plan.remove, [id(7), id(6), id(3), id(4), id(5), id(2), id(1)]);
  assertEquals(plan.publish.length, 7);
});

Deno.test("planAppSync: bench candidates go, prereqs of other suites, the harness and foreign publishers stay", () => {
  const installed: HarnessInstalledApp[] = [
    { id: "00000000-cafe-0000-0000-be4c00decade", name: "CentralGauge_CG-AL-E001_1", publisher: "CentralGauge", version: "1.0.0.0", installed: true },
    { id: "00000000-0000-4000-8000-00000000aaaa", name: "CG-AL-E002 Prereq", publisher: "CentralGauge", version: "1.0.0.0", installed: true },
    { id: "00000000-0000-4000-8000-00000000bbbb", name: "CG Test Harness", publisher: "CentralGauge", version: "1.0.0.0", installed: true },
    { id: "00000000-0000-4000-8000-00000000cccc", name: "Continia Core", publisher: "Continia", version: "1.0.0.0", installed: true },
  ];
  const plan = planAppSync(installed, wanted(["Test"]));
  assertEquals(plan.remove[0], "00000000-cafe-0000-0000-be4c00decade");
  for (const kept of ["aaaa", "bbbb", "cccc"]) {
    assert(!plan.remove.includes(`00000000-0000-4000-8000-00000000${kept}`));
  }
});

Deno.test("planAppSync: duplicate or uninstalled prerequisite versions are not kept", () => {
  const dup = planAppSync(
    [inst(1, PREREQ_V), inst(1, "1.0.1.1", false), ...[2, 5, 4, 3, 6].map((n) => inst(n, PREREQ_V))],
    wanted(["Test"]),
  );
  assert(dup.remove.includes(id(1)));
  const uninstalled = planAppSync(
    [inst(1, PREREQ_V, false), ...[2, 5, 4, 3, 6].map((n) => inst(n, PREREQ_V))],
    wanted(["Test"]),
  );
  assert(uninstalled.remove.includes(id(1)));
});

Deno.test("stampVersion: candidates use build 0, prerequisites build 1..32767", () => {
  assertEquals(stampVersion("2.3.4.5", "candidate", "ffff0000"), "2.3.0.0");
  const v = stampVersion("1.0.0.0", "prereq", "0000ffff".padEnd(64, "0"));
  const [, , build] = v.split(".").map(Number);
  assert(build! >= 1 && build! <= 32767);
  assertEquals(v, stampVersion("1.0.0.0", "prereq", "0000ffff".padEnd(64, "0")));
  assertNotEquals(
    stampVersion("1.0.0.0", "prereq", "12345678".padEnd(64, "0")),
    stampVersion("1.0.0.0", "prereq", "87654321".padEnd(64, "0")),
  );
});

Deno.test("appStamps: a dependency change moves dependents, not the other way", async () => {
  const ws = await Deno.makeTempDir();
  await write(ws, "Core/app.json", appJson(IDS.core, "CGR Core", [70000, 70099], []));
  await write(ws, "Rental/app.json", appJson(IDS.rental, "CGR Rental", [70200, 70299], [{ id: IDS.core, name: "CGR Core" }]));
  const apps: StagedApp[] = [
    { ...app("Core", 1), id: IDS.core },
    { ...app("Rental", 3, ["Core"]), id: IDS.rental },
  ];
  const a = await appStamps(ws, apps);
  await write(ws, "Rental/src/R.al", "x");
  const b = await appStamps(ws, apps);
  assertEquals(b.get("Core"), a.get("Core"));
  assertNotEquals(b.get("Rental"), a.get("Rental"));
  await write(ws, "Core/src/C.al", "y");
  const c = await appStamps(ws, apps);
  assertNotEquals(c.get("Core"), b.get("Core"));
  assertNotEquals(c.get("Rental"), b.get("Rental"));
  assertEquals(a.size, 2);
});
```

`tests/unit/harness/bc-sync-provider.test.ts`:

```typescript
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import { buildSyncHarnessAppsScript } from "../../../src/container/bc-script-builders.ts";
import { parseHarnessSyncOutput } from "../../../src/container/bc-output-parsers.ts";
import { ContainerError } from "../../../src/errors.ts";
import { IDS } from "./refapp-fixture.ts";

const isWindows = Deno.build.os === "windows";

interface Stub {
  provider: BcContainerProvider;
  // deno-lint-ignore no-explicit-any
  calls: any[];
  shared: string;
}

async function stubbed(output: string): Promise<Stub> {
  const provider = new BcContainerProvider();
  // deno-lint-ignore no-explicit-any
  const calls: any[] = [];
  const shared = await Deno.makeTempDir();
  // deno-lint-ignore no-explicit-any
  const p = provider as any;
  p.harnessSharedFolder = () => shared;
  p.runScriptThroughSession = (name: string, script: string, label: string) => {
    calls.push({ name, script, label });
    return Promise.resolve({ output, exitCode: 0 });
  };
  return { provider, calls, shared };
}

Deno.test({
  name: "syncHarnessApps: one warm-slot script, staged files removed afterwards",
  ignore: !isWindows,
  async fn() {
    const out = `SYNC_REMOVE:${IDS.rental} v1.0.0.0
SYNC_PUBLISH_START:0:100
SYNC_PUBLISH_END:0:250
SYNC_DONE
`;
    const { provider, calls, shared } = await stubbed(out);
    const app = join(await Deno.makeTempDir(), "CentralGauge_CGR Rental_1.0.0.0.app");
    await Deno.writeTextFile(app, "x");
    const r = await provider.syncHarnessApps("Cronus28", { removeIds: [IDS.rental], publish: [app] });
    assertEquals(calls.length, 1);
    assertEquals(calls[0].label, "harness-sync");
    assertStringIncludes(calls[0].script, IDS.rental);
    assertStringIncludes(calls[0].script, shared);
    assertEquals(r.removed, [IDS.rental]);
    assertEquals(r.published, [{ index: 0, startMs: 100, endMs: 250 }]);
    assertEquals([...Deno.readDirSync(shared)].length, 0);
  },
});

Deno.test({
  name: "syncHarnessApps: incomplete removal throws, a publish failure is returned",
  ignore: !isWindows,
  async fn() {
    const bad = await stubbed(`SYNC_REMOVE_INCOMPLETE:${IDS.rental}\nSYNC_DONE\n`);
    await assertRejects(
      () => bad.provider.syncHarnessApps("Cronus28", { removeIds: [IDS.rental], publish: [] }),
      ContainerError,
      "incomplete",
    );
    const failed = await stubbed("SYNC_PUBLISH_START:0:1\nSYNC_PUBLISH_END:0:2\nSYNC_PUBLISH_FAILED:0:The schema synchronization failed\n");
    const r = await failed.provider.syncHarnessApps("Cronus28", { removeIds: [], publish: [] });
    assertEquals(r.failed, { index: 0, message: "The schema synchronization failed" });
  },
});

Deno.test("syncHarnessApps: a non-GUID id is refused before any script runs", async () => {
  const { provider, calls } = await stubbed("SYNC_DONE");
  await assertRejects(
    () => provider.syncHarnessApps("Cronus28", { removeIds: ["x'; Remove-Item C:\\"], publish: [] }),
    Error,
    "not an app id",
  );
  assertEquals(calls.length, 0);
});

Deno.test({
  name: "listHarnessApps: parses CG_APP lines; no done marker is loud",
  ignore: !isWindows,
  async fn() {
    const ok = await stubbed(
      `CG_APP:{"id":"${IDS.core.toUpperCase()}","name":"CGR Core","publisher":"CentralGauge","version":"1.0.5.6","installed":true}\nCG_APPS_DONE\n`,
    );
    assertEquals(await ok.provider.listHarnessApps("Cronus28"), [
      { id: IDS.core, name: "CGR Core", publisher: "CentralGauge", version: "1.0.5.6", installed: true },
    ]);
    assertEquals(ok.calls[0].label, "harness-apps");
    const bad = await stubbed("CG_APPS_FAILED:boom");
    await assertRejects(() => bad.provider.listHarnessApps("Cronus28"), ContainerError);
  },
});

Deno.test("buildSyncHarnessAppsScript: removal before publish, quoted paths, dev endpoint toggle", () => {
  const s = buildSyncHarnessAppsScript("Cronus28", [IDS.rental], ["C:\\my\\ab_O'Brien.app"], { username: "u", password: "p'w" });
  assert(!s.includes("${"), "no unexpanded template placeholders");
  assert(s.indexOf("Get-NAVAppInfo") < s.indexOf("Publish-BcContainerApp"));
  assertStringIncludes(s, "'C:\\my\\ab_O''Brien.app'");
  assertStringIncludes(s, "-useDevEndpoint -credential $cgPubCredential");
  assertStringIncludes(s, "'p''w'");
  Deno.env.set("CENTRALGAUGE_DEV_ENDPOINT_PUBLISH", "0");
  try {
    assert(!buildSyncHarnessAppsScript("C", [], [], { username: "u", password: "p" }).includes("useDevEndpoint"));
  } finally {
    Deno.env.delete("CENTRALGAUGE_DEV_ENDPOINT_PUBLISH");
  }
});

Deno.test("parseHarnessSyncOutput: markers to structure", () => {
  const r = parseHarnessSyncOutput(
    `SYNC_REMOVE:${IDS.core.toUpperCase()} v1.0.0.0\nSYNC_REMOVE_WARN:x unpublish failed\nSYNC_PUBLISH_START:0:10\nSYNC_PUBLISH_END:0:30\nSYNC_DONE\n`,
  );
  assertEquals(r.removed, [IDS.core]);
  assertEquals(r.warnings, ["x unpublish failed"]);
  assertEquals(r.published, [{ index: 0, startMs: 10, endMs: 30 }]);
  assertEquals(r.done, true);
  assertEquals(r.failed, null);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `deno test --allow-all tests/unit/harness/bc-apps.test.ts tests/unit/harness/bc-sync-provider.test.ts`
Expected: FAIL, `Module not found ".../src/harness/bc-apps.ts"` and `buildSyncHarnessAppsScript` not exported.

- [ ] **Step 3: Implement the pure planner, `src/harness/bc-apps.ts`**

```typescript
/**
 * Candidate-scoped app sync (spec 1a section 7 item 5, findings 2026-09-29
 * section 8). Candidates are removed and republished; prerequisites stay
 * installed while their content stamp matches. A prerequisite's version
 * encodes that stamp, so a stale one never looks current.
 */

import { join } from "@std/path";
import type { HarnessInstalledApp } from "../container/types.ts";
import { hashJson, hashTree } from "./hash.ts";
import { dependentsClosure, type StagedApp } from "./staging.ts";

export const CG_PUBLISHER = "CentralGauge";
export const HARNESS_APP_NAME = "CG Test Harness";

export type AppRole = "prereq" | "candidate";

export interface WantedApp {
  id: string;
  name: string;
  publisher: string;
  version: string;
  /** Compiled .app on the host. */
  file: string;
  role: AppRole;
  /** App ids this app depends on (workspace apps only). */
  depends: string[];
}

export interface SyncPlan {
  /** App ids to remove, dependents first. */
  remove: string[];
  /** Apps to publish, dependencies first. */
  publish: WantedApp[];
}

/**
 * Candidates: major.minor.0.0. Prerequisites: major.minor.<1..32767>.<0..32767>
 * from the content stamp. Dependencies are minimum versions, so rewriting
 * build and revision never breaks resolution (verified in M1-27).
 */
export function stampVersion(base: string, role: AppRole, stamp: string): string {
  const [major, minor] = base.split(".");
  if (role === "candidate") return `${major}.${minor}.0.0`;
  const build = 1 + (parseInt(stamp.slice(0, 4), 16) % 32767);
  const revision = parseInt(stamp.slice(4, 8), 16) % 32768;
  return `${major}.${minor}.${build}.${revision}`;
}

/** Stamp per app folder: its source tree plus its dependencies' stamps. */
export async function appStamps(
  dir: string,
  apps: StagedApp[],
): Promise<Map<string, string>> {
  const stamps = new Map<string, string>();
  for (const a of apps) {
    stamps.set(
      a.folder,
      await hashJson({
        app: a.id,
        tree: await hashTree(join(dir, a.folder), "task"),
        deps: a.depends.map((d) => stamps.get(d) ?? null),
      }),
    );
  }
  return stamps;
}

/** Changed apps, everything depending on them, and Test; dependency order. */
export function candidateFolders(apps: StagedApp[], changed: string[]): string[] {
  const set = dependentsClosure(apps, [...changed, "Test"]);
  return apps.filter((a) => set.has(a.folder)).map((a) => a.folder);
}

/**
 * Keep a prerequisite only when the container has exactly that app id,
 * installed, at the stamped version, and every wanted dependency is kept.
 * Remove every other wanted app id, plus unwanted CentralGauge apps
 * that are not `*Prereq*` or the test harness (bench candidates, old
 * oracles): those share the refapp object band.
 */
export function planAppSync(
  installed: HarnessInstalledApp[],
  wanted: WantedApp[],
): SyncPlan {
  const wantedIds = new Set(wanted.map((w) => w.id));
  const byId = new Map<string, HarnessInstalledApp[]>();
  for (const i of installed) {
    if (i.publisher !== CG_PUBLISHER) continue;
    byId.set(i.id, [...(byId.get(i.id) ?? []), i]);
  }
  const kept = new Set<string>();
  for (const w of wanted) {
    const have = byId.get(w.id) ?? [];
    const exact = w.role === "prereq" && have.length === 1 &&
      have[0]!.version === w.version && have[0]!.installed;
    if (exact && w.depends.every((d) => !wantedIds.has(d) || kept.has(d))) {
      kept.add(w.id);
    }
  }
  const foreign = [...byId.entries()]
    .filter(([id, list]) =>
      !wantedIds.has(id) &&
      list.every((i) => i.name !== HARNESS_APP_NAME && !/prereq/i.test(i.name))
    )
    .map(([id]) => id)
    .sort();
  // Every wanted id that is not kept, listed or not: removing an absent id
  // is a no-op, and a published-but-unlisted leftover can never survive.
  const ours = [...wanted].reverse().map((w) => w.id)
    .filter((id) => !kept.has(id));
  return {
    remove: [...foreign, ...ours],
    publish: wanted.filter((w) => !kept.has(w.id)),
  };
}
```

- [ ] **Step 4: Implement the container side**

`src/container/types.ts`, append:

```typescript
/** A CentralGauge app on a container, as Harness Bench lists it. */
export interface HarnessInstalledApp {
  id: string;
  name: string;
  publisher: string;
  version: string;
  installed: boolean;
}

/** Outcome of one `syncHarnessApps` warm-slot script. */
export interface HarnessSyncResult {
  removed: string[];
  warnings: string[];
  removeIncomplete: string[];
  /** Per published file (index into the publish list), unix ms. */
  published: { index: number; startMs: number; endMs: number }[];
  failed: { index: number; message: string } | null;
  done: boolean;
  output: string;
}
```

`src/container/bc-output-parsers.ts`, append (add `HarnessInstalledApp, HarnessSyncResult` to its `./types.ts` import):

```typescript
/** Parse `buildListHarnessAppsScript` output; null when the done marker is missing. */
export function parseHarnessAppList(output: string): HarnessInstalledApp[] | null {
  if (!output.includes("CG_APPS_DONE")) return null;
  const apps: HarnessInstalledApp[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^CG_APP:(.+)$/.exec(line.trim());
    if (!m) continue;
    const j = JSON.parse(m[1]!) as Record<string, unknown>;
    apps.push({
      id: String(j.id).toLowerCase(),
      name: String(j.name),
      publisher: String(j.publisher),
      version: String(j.version),
      installed: j.installed === true,
    });
  }
  return apps;
}

/** Parse `buildSyncHarnessAppsScript` markers. */
export function parseHarnessSyncOutput(
  output: string,
): Omit<HarnessSyncResult, "output"> {
  const r: Omit<HarnessSyncResult, "output"> = {
    removed: [],
    warnings: [],
    removeIncomplete: [],
    published: [],
    failed: null,
    done: false,
  };
  const starts = new Map<number, number>();
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    let m: RegExpExecArray | null;
    if ((m = /^SYNC_REMOVE:(\S+)/.exec(line))) r.removed.push(m[1]!.toLowerCase());
    else if ((m = /^SYNC_REMOVE_WARN:(.*)$/.exec(line))) r.warnings.push(m[1]!);
    else if ((m = /^SYNC_REMOVE_INCOMPLETE:(.*)$/.exec(line))) r.removeIncomplete.push(m[1]!);
    else if ((m = /^SYNC_PUBLISH_START:(\d+):(\d+)$/.exec(line))) starts.set(Number(m[1]), Number(m[2]));
    else if ((m = /^SYNC_PUBLISH_END:(\d+):(\d+)$/.exec(line))) {
      const i = Number(m[1]);
      r.published.push({ index: i, startMs: starts.get(i) ?? Number(m[2]), endMs: Number(m[2]) });
    } else if ((m = /^SYNC_PUBLISH_FAILED:(\d+):(.*)$/.exec(line))) {
      r.failed = { index: Number(m[1]), message: m[2]!.trim() };
    } else if (line === "SYNC_DONE") r.done = true;
  }
  return r;
}
```

`src/container/bc-script-builders.ts`, append:

```typescript
/** Harness Bench: every CentralGauge app with its installed state (verified in M1-27). */
export function buildListHarnessAppsScript(containerName: string): string {
  return `
      ${bcchImport()}
      ${bcchConfigInit()}
      try {
        $cgRows = Invoke-ScriptInBcContainer -containerName "${containerName}" -scriptblock {
          Get-NAVAppInfo -ServerInstance BC -Tenant default -TenantSpecificProperties |
            Where-Object { $_.Publisher -eq "CentralGauge" } |
            ForEach-Object {
              "CG_APP:" + (@{ id = "$($_.AppId)"; name = $_.Name; publisher = $_.Publisher; version = "$($_.Version)"; installed = [bool]$_.IsInstalled } | ConvertTo-Json -Compress)
            }
        }
        $cgRows | ForEach-Object { Write-Output $_ }
        Write-Output "CG_APPS_DONE"
      } catch {
        Write-Output "CG_APPS_FAILED:$($_.Exception.Message)"
      }
    `;
}

/**
 * Harness Bench app sync in ONE warm-slot script (bc-container-quirks.md):
 * remove the given app ids (every version, tenant first then global, in the
 * order given: dependents first), then publish the given files in order
 * with ForceSync + install. Removal is scoped to these ids only, unlike
 * buildPrepareCandidateScript, whose filter removes the refapp dependencies.
 * ponytail: the dev-endpoint credential block duplicates
 * buildPrepareCandidateScript; extract a shared helper when a third caller
 * appears.
 *
 * Markers: SYNC_REMOVE:<id> v<ver>, SYNC_REMOVE_WARN:<msg>,
 * SYNC_REMOVE_INCOMPLETE:<id>, SYNC_PUBLISH_START:<i>:<ms>,
 * SYNC_PUBLISH_END:<i>:<ms>, SYNC_PUBLISH_FAILED:<i>:<msg>, SYNC_DONE.
 */
export function buildSyncHarnessAppsScript(
  containerName: string,
  removeIds: string[],
  appFiles: string[],
  credentials: ContainerCredentials = { username: "admin", password: "admin" },
): string {
  const useDevEndpoint =
    Deno.env.get("CENTRALGAUGE_DEV_ENDPOINT_PUBLISH") !== "0";
  const credentialSetup = useDevEndpoint
    ? `      $cgPubPassword = ConvertTo-SecureString '${
      escapeForPS(credentials.password)
    }' -AsPlainText -Force
      $cgPubCredential = New-Object PSCredential('${
      escapeForPS(credentials.username)
    }', $cgPubPassword)
`
    : "";
  const flag = useDevEndpoint ? " -useDevEndpoint -credential $cgPubCredential" : "";
  const list = (xs: string[]) =>
    xs.length === 0 ? "@()" : `@(${xs.map((x) => `'${escapeForPS(x)}'`).join(", ")})`;
  return `
      ${bcchImport()}
      ${bcchConfigInit()}
${credentialSetup}
      $cgRemoveIds = ${list(removeIds)}
      if ($cgRemoveIds.Count -gt 0) {
        try {
          $cgReport = Invoke-ScriptInBcContainer -containerName "${containerName}" -scriptblock {
            param([string[]]$ids)
            foreach ($id in $ids) {
              foreach ($app in @(Get-NAVAppInfo -ServerInstance BC -Id $id)) {
                Write-Output "SYNC_REMOVE:$id v$($app.Version)"
                try { Uninstall-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -Tenant default -Force -ErrorAction SilentlyContinue } catch { }
                try { Uninstall-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -Force -ErrorAction SilentlyContinue } catch { }
                $done = $false
                try { Unpublish-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -Tenant default -ErrorAction Stop; $done = $true } catch { }
                if (-not $done) {
                  try { Unpublish-NAVApp -ServerInstance BC -Name $app.Name -Publisher $app.Publisher -Version $app.Version -ErrorAction Stop; $done = $true } catch { }
                }
                if (-not $done) { Write-Output "SYNC_REMOVE_WARN:$id v$($app.Version) unpublish failed" }
              }
              if (@(Get-NAVAppInfo -ServerInstance BC -Id $id).Count -gt 0) { Write-Output "SYNC_REMOVE_INCOMPLETE:$id" }
            }
          } -argumentList (,$cgRemoveIds)
          $cgReport | ForEach-Object { Write-Output $_ }
        } catch {
          Write-Output "SYNC_REMOVE_INCOMPLETE:invoke $($_.Exception.Message)"
        }
      }
      $cgFiles = ${list(appFiles)}
      for ($i = 0; $i -lt $cgFiles.Count; $i++) {
        Write-Output "SYNC_PUBLISH_START:$($i):$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
        try {
          Publish-BcContainerApp -containerName "${containerName}" -appFile $cgFiles[$i] -skipVerification -sync -syncMode ForceSync -install${flag} -ErrorAction Stop
          Write-Output "SYNC_PUBLISH_END:$($i):$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
        } catch {
          Write-Output "SYNC_PUBLISH_END:$($i):$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
          Write-Output "SYNC_PUBLISH_FAILED:$($i):$(($_.Exception.Message) -replace '\\s+', ' ')"
          exit 1
        }
      }
      Write-Output "SYNC_DONE"
    `;
}
```

`src/container/bc-container-provider.ts`:
1. Import `buildListHarnessAppsScript, buildSyncHarnessAppsScript` from `./bc-script-builders.ts`, `parseHarnessAppList, parseHarnessSyncOutput` from `./bc-output-parsers.ts`, and `HarnessInstalledApp, HarnessSyncResult` from `./types.ts` (runTestsViaSoap is already imported for the SOAP fork).
2. Add to `SCRIPT_LABEL_OPERATION`: `"harness-apps": "publish",` and `"harness-sync": "publish",`.
3. Add after `cleanupOrphanedPrereqs`:

```typescript
  /** BCH shared "my" folder for app files. Overridden in unit tests. */
  protected harnessSharedFolder(containerName: string): string {
    return `C:\\ProgramData\\BcContainerHelper\\Extensions\\${containerName}\\my`;
  }

  /** Harness Bench: every CentralGauge app on the container. One warm-slot script. */
  async listHarnessApps(containerName: string): Promise<HarnessInstalledApp[]> {
    const result = await this.runScriptThroughSession(
      containerName,
      buildListHarnessAppsScript(containerName),
      "harness-apps",
    );
    const apps = parseHarnessAppList(result.output);
    if (apps === null) {
      throw this.buildPwshError({
        containerName,
        operation: "publish",
        message: "Listing harness apps failed",
        output: result.output,
      });
    }
    return apps;
  }

  /**
   * Harness Bench app sync: remove `removeIds` and publish `publish` in ONE
   * warm-slot script (see buildSyncHarnessAppsScript). Never use
   * prepareCandidateApp for harness apps: its cleanup removes the refapp
   * dependency apps (findings 2026-09-29 section 2). Incomplete removal is
   * container contamination and throws; a publish failure is returned so
   * the caller can tell a model defect from infra.
   */
  async syncHarnessApps(
    containerName: string,
    plan: { removeIds: string[]; publish: string[] },
  ): Promise<HarnessSyncResult> {
    const guid =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    for (const id of plan.removeIds) {
      if (!guid.test(id)) throw new Error(`not an app id: ${id}`);
    }
    const shared = this.harnessSharedFolder(containerName);
    const staged: string[] = [];
    try {
      if (plan.publish.length > 0) await Deno.mkdir(shared, { recursive: true });
      for (const f of plan.publish) {
        const p = `${shared}\\${crypto.randomUUID().slice(0, 8)}_${f.split(/[/\\]/).pop()!}`;
        await Deno.copyFile(f, p);
        staged.push(p);
      }
      const result = await this.runScriptThroughSession(
        containerName,
        buildSyncHarnessAppsScript(
          containerName,
          plan.removeIds,
          staged,
          this.getCredentials(containerName),
        ),
        "harness-sync",
      );
      const parsed = parseHarnessSyncOutput(result.output);
      if (
        parsed.removeIncomplete.length > 0 ||
        (!parsed.done && parsed.failed === null)
      ) {
        throw this.buildPwshError({
          containerName,
          operation: "setup",
          message: `Harness app sync incomplete: ${
            parsed.removeIncomplete.join(", ") || "no SYNC_DONE marker"
          }`,
          output: result.output,
        });
      }
      return { ...parsed, output: result.output };
    } finally {
      for (const p of staged) await Deno.remove(p).catch(() => {});
    }
  }

  /** Harness Bench: one test codeunit through the SOAP runner. */
  runHarnessTests(containerName: string, codeunit: number): Promise<TestResult> {
    return runTestsViaSoap(this.soapConfigFor(containerName), codeunit, "");
  }
```

- [ ] **Step 5: Run them and see them pass**

Run: `deno test --allow-all tests/unit/harness/bc-apps.test.ts tests/unit/harness/bc-sync-provider.test.ts`
Expected: all pass (the four provider tests that stage files are Windows-only).

- [ ] **Step 6: Check, lint, format**

```bash
deno check src/harness/bc-apps.ts src/container/bc-container-provider.ts src/container/bc-script-builders.ts src/container/bc-output-parsers.ts src/container/types.ts tests/unit/harness/bc-apps.test.ts tests/unit/harness/bc-sync-provider.test.ts
deno lint src/harness/bc-apps.ts src/container/bc-container-provider.ts src/container/bc-script-builders.ts src/container/bc-output-parsers.ts src/container/types.ts tests/unit/harness/bc-apps.test.ts tests/unit/harness/bc-sync-provider.test.ts
deno fmt src/harness/bc-apps.ts src/container/bc-container-provider.ts src/container/bc-script-builders.ts src/container/bc-output-parsers.ts src/container/types.ts tests/unit/harness/bc-apps.test.ts tests/unit/harness/bc-sync-provider.test.ts
```

Also re-run the existing pure script-builder tests when no bench is live: `deno test --allow-all tests/unit/container/bc-script-builders.test.ts tests/unit/container/bc-output-parsers.test.ts` (the guard hook blocks this while a bench runs; it does not touch a container, but wait for the bench anyway).

- [ ] **Step 7: Commit**

```bash
git add src/harness/bc-apps.ts src/container/bc-container-provider.ts src/container/bc-script-builders.ts src/container/bc-output-parsers.ts src/container/types.ts tests/unit/harness/bc-apps.test.ts tests/unit/harness/bc-sync-provider.test.ts
git commit -m "feat(harness): candidate-scoped BC app sync with stamped prerequisite versions"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/bc-apps.test.ts tests/unit/harness/bc-sync-provider.test.ts` passes; check, lint and `deno fmt --check` clean on the seven files. Real-container behavior is M1-27.

---
### Task M1-16: BC lane: compile, deploy, test, reroute

Spec 1a section 5 (container throughput: fixed concurrency, queue wait recorded per backend call), D12 (agent `cg-al` calls and verdict runs share one lane at fixed concurrency plus the health/drain machinery), section 7 (compile every app in dependency order; zero tests after publish is infra, GH #13), section 8 (a BC fault re-judges the same artifact on another container). Findings section 1: each app compiles against the earlier apps' `.app` files in its `.alpackages`; publish is about 60% of the time. The lane holds one container per publish+test (per-container `Mutex`) and reroutes through `withInfraRetry`; host-side compiles do not take the lock.

**Lane:** infra. **Deps:** M1-07 (`TestResultSchema`), M1-12, M1-13, M1-15.

**Files:**
- Create: `src/harness/bc-lane.ts`
- Create: `tests/unit/harness/fake-bc.ts` (reused by M1-17 to M1-24)
- Create: `scripts/harness/app-sync-probe.ts` (ops driver for M1-27; wiring only, no unit test)
- Test: `tests/unit/harness/bc-lane.test.ts`

**Interfaces:**
- Consumes: `planAppSync`, `appStamps`, `candidateFolders`, `stampVersion`, `WantedApp` (M1-15); `HarnessInstalledApp`, `HarnessSyncResult`, `TestResult`, `ALProject`, `CompilationResult`, `CompilationError` (container types); `withInfraRetry`, `Mutex`, `NoEligibleContainersError`, `classifyPublishFailure`, `isCollisionPublishFailure`.
- Produces: `interface HarnessBc { compileProject; listHarnessApps; syncHarnessApps; runHarnessTests }` (BcContainerProvider satisfies it); `type TestRow = z.output<typeof TestResultSchema>`; `class BcLane { constructor(bc: HarnessBc, containers: string[], opts?: { healthMonitor?: ContainerHealthMonitor; maxInfraRetries?: number }); readonly bc; readonly containers; compileContainer(): string; compile<T>(fn: (container: string) => Promise<T>): Promise<T>; exclusive<T>(ctx: { taskId: string; variantId: string; attemptNumber: number }, fn: (container: string) => Promise<T>): Promise<Held<T>> }`; `interface Held<T> { result: T; container: string; queue_ms: number; retries: InfraRetryRecord[] }`; `interface BuiltApp { folder; id; version; ok: boolean; attempted: boolean; file: string | null; diagnostics: CompilationError[]; compile_ms: number }`; `buildApps(bc, container, o: { srcDir; apps: StagedApp[]; versions: Map<string, string>; outDir; prebuilt?: Map<string, string> }): Promise<BuiltApp[]>`; `interface PrepareInput { pristine; pristineApps; candidateDir; candidateApps; changed; workDir; cacheDir }`; `interface Prepared { container: string; built: BuiltApp[]; wanted: WantedApp[]; candidateIds: string[]; buildOk: boolean; compile_ms: number; per_app_compiles: number }`; `prepareApps(lane, o: PrepareInput): Promise<Prepared>`; `interface TestSpec { codeunit: number; procedures: string[] | null; target: string; zeroIsInfra: boolean }`; `interface TestMessage { codeunit; procedure; target; message }`; `classifyTestFailure(error: string): "assertion" | "runtime_error"`; `runTests(bc, container, specs): Promise<{ rows: TestRow[]; messages: TestMessage[]; test_ms: number }>`; `interface Deployed { provisioning_ms; candidate_publish_ms; candidateFailure: { id: string; message: string } | null; removed: number; published: number }`; `deploy(bc, container, wanted): Promise<Deployed>`; `interface DeployTestResult { deployed: Deployed; rows: TestRow[]; messages: TestMessage[]; test_ms: number }`; `deployAndTest(bc, container, i: { wanted: WantedApp[]; tests: TestSpec[]; cleanupIds: string[] }): Promise<DeployTestResult>`; `scorerPassed(rows: TestRow[]): boolean | null`.

A candidate publish failure classified `model` by `classifyPublishFailure` is the agent's defect: the tests are recorded `not_run` / `runtime_error` and scored. `infra`, `unknown` (the module's documented caller policy is "throw as infra for safety") and collisions (with per-app id ranges validated in M1-14, a collision can only come from a foreign app on that container) throw `ContainerError` and reroute.

- [ ] **Step 1: Write the fake and the failing test**

`tests/unit/harness/fake-bc.ts`:

```typescript
/** In-memory HarnessBc for unit tests: no container, no pwsh. */

import { basename, join } from "@std/path";
import type {
  ALProject,
  CompilationResult,
  HarnessInstalledApp,
  HarnessSyncResult,
  TestResult,
} from "../../../src/container/types.ts";
import { ContainerError } from "../../../src/errors.ts";
import type { HarnessBc } from "../../../src/harness/bc-lane.ts";

/** What a fake .app holds, so a test script can see what was deployed. */
export interface FakeApp {
  id: string;
  name: string;
  version: string;
  folder: string;
  source: string;
}

export type TestScript = (
  codeunit: number,
  deployed: Map<string, FakeApp>,
  container: string,
) => TestResult;

/** A TestResult from {procedure: true | errorMessage}. */
export function result(procs: Record<string, true | string>): TestResult {
  const results = Object.entries(procs).map(([name, v]) =>
    v === true
      ? { name, passed: true, duration: 1 }
      : { name, passed: false, duration: 1, error: v }
  );
  const passed = results.filter((r) => r.passed).length;
  return {
    success: passed === results.length && passed > 0,
    totalTests: results.length,
    passedTests: passed,
    failedTests: results.length - passed,
    duration: 5,
    results,
    output: "",
  };
}

async function sources(dir: string): Promise<string> {
  const parts: string[] = [];
  const walk = async (d: string) => {
    const names: string[] = [];
    for await (const e of Deno.readDir(d)) names.push(e.name);
    for (const n of names.sort()) {
      if (n === ".alpackages") continue;
      const p = join(d, n);
      const st = await Deno.stat(p);
      if (st.isDirectory) await walk(p);
      else if (n.endsWith(".al")) parts.push(await Deno.readTextFile(p));
    }
  };
  await walk(dir);
  return parts.join("\n");
}

export class FakeBc implements HarnessBc {
  compiles: string[] = [];
  syncs: { container: string; removeIds: string[]; publish: string[] }[] = [];
  tests: { container: string; codeunit: number }[] = [];
  /** Containers where every call throws an infra ContainerError. */
  broken = new Set<string>();
  /** Returns a publish failure message for (container, app name), or null. */
  publishFailure: (container: string, appName: string) => string | null = () => null;
  private readonly deployed = new Map<string, Map<string, FakeApp>>();

  constructor(public script: TestScript = () => result({})) {}

  state(container: string): Map<string, FakeApp> {
    let s = this.deployed.get(container);
    if (!s) this.deployed.set(container, s = new Map());
    return s;
  }

  private check(container: string, op: ContainerError["operation"]) {
    if (this.broken.has(container)) {
      throw new ContainerError(`fake infra fault on ${container}`, container, op);
    }
  }

  async compileProject(container: string, project: ALProject): Promise<CompilationResult> {
    this.check(container, "compile");
    const folder = basename(project.path);
    this.compiles.push(folder);
    const aj = project.appJson as { id: string; name: string; version: string };
    const source = await sources(project.path);
    if (source.includes("COMPILE_ERROR")) {
      return {
        success: false,
        errors: [{ code: "AL0001", message: "fake compile error", file: "x.al", line: 1, column: 1, severity: "error" }],
        warnings: [],
        output: "",
        duration: 1,
      };
    }
    const out = join(project.path, "..", `.fake-out-${crypto.randomUUID().slice(0, 8)}`);
    await Deno.mkdir(out, { recursive: true });
    const artifactPath = join(out, `CentralGauge_${aj.name}_${aj.version}.app`);
    const app: FakeApp = { id: aj.id.toLowerCase(), name: aj.name, version: aj.version, folder, source };
    await Deno.writeTextFile(artifactPath, JSON.stringify(app));
    return { success: true, errors: [], warnings: [], output: "", duration: 1, artifactPath };
  }

  listHarnessApps(container: string): Promise<HarnessInstalledApp[]> {
    this.check(container, "publish");
    return Promise.resolve(
      [...this.state(container).values()].map((a) => ({
        id: a.id,
        name: a.name,
        publisher: "CentralGauge",
        version: a.version,
        installed: true,
      })),
    );
  }

  async syncHarnessApps(
    container: string,
    plan: { removeIds: string[]; publish: string[] },
  ): Promise<HarnessSyncResult> {
    this.check(container, "publish");
    this.syncs.push({ container, removeIds: [...plan.removeIds], publish: [...plan.publish] });
    const st = this.state(container);
    for (const id of plan.removeIds) st.delete(id);
    const published: HarnessSyncResult["published"] = [];
    for (const [index, file] of plan.publish.entries()) {
      const app = JSON.parse(await Deno.readTextFile(file)) as FakeApp;
      published.push({ index, startMs: 1000 + index * 10, endMs: 1005 + index * 10 });
      const fail = this.publishFailure(container, app.name);
      if (fail !== null) {
        return { removed: plan.removeIds, warnings: [], removeIncomplete: [], published, failed: { index, message: fail }, done: false, output: fail };
      }
      st.set(app.id, app);
    }
    return { removed: plan.removeIds, warnings: [], removeIncomplete: [], published, failed: null, done: true, output: "" };
  }

  runHarnessTests(container: string, codeunit: number): Promise<TestResult> {
    this.check(container, "test");
    this.tests.push({ container, codeunit });
    return Promise.resolve(this.script(codeunit, this.state(container), container));
  }
}

/** Source of the deployed app with this name, or "". */
export function deployedSource(deployed: Map<string, FakeApp>, name: string): string {
  return [...deployed.values()].find((a) => a.name === name)?.source ?? "";
}
```

`tests/unit/harness/bc-lane.test.ts`:

```typescript
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { basename, join } from "@std/path";
import { ContainerError } from "../../../src/errors.ts";
import {
  BcLane,
  buildApps,
  classifyTestFailure,
  deploy,
  deployAndTest,
  prepareApps,
  runTests,
} from "../../../src/harness/bc-lane.ts";
import { exists, safeCopyTree } from "../../../src/harness/fsutil.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import { type FakeApp, FakeBc, result } from "./fake-bc.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";

async function workspace(): Promise<string> {
  const ws = await Deno.makeTempDir();
  await write(ws, "Core/app.json", appJson(IDS.core, "CGR Core", [70000, 70099], []));
  await write(ws, "Core/src/C.al", `codeunit 70000 "CGR Core"\n{\n}\n`);
  await write(ws, "Rental/app.json", appJson(IDS.rental, "CGR Rental", [70200, 70299], [{ id: IDS.core, name: "CGR Core" }]));
  await write(ws, "Rental/src/R.al", `codeunit 70200 "CGR Rental"\n{\n}\n`);
  await write(ws, "Test/app.json", appJson(IDS.test, "CGR Test", [80000, 80099], [
    { id: IDS.core, name: "CGR Core" },
    { id: IDS.rental, name: "CGR Rental" },
  ]));
  await write(ws, "Test/src/T.al", `codeunit 80000 "T"\n{\n    Subtype = Test;\n}\n`);
  return ws;
}

const readApp = async (f: string) => JSON.parse(await Deno.readTextFile(f)) as FakeApp;

Deno.test("buildApps: dependency order, rewritten versions, dependency symbols", async () => {
  const ws = await workspace();
  const apps = await readAppGraph(ws);
  const bc = new FakeBc();
  const versions = new Map([["Core", "1.0.7.7"], ["Rental", "1.0.0.0"], ["Test", "1.0.0.0"]]);
  const out = await Deno.makeTempDir();
  const built = await buildApps(bc, "C1", { srcDir: ws, apps, versions, outDir: out });
  assertEquals(bc.compiles, ["Core", "Rental", "Test"]);
  assert(built.every((b) => b.ok && b.attempted));
  assertEquals((await readApp(built[0]!.file!)).version, "1.0.7.7");
  assert(await exists(join(out, "Rental", ".alpackages", basename(built[0]!.file!))));
  assert(await exists(join(out, "Test", ".alpackages", basename(built[1]!.file!))));
});

Deno.test("buildApps: a failed dependency stops its dependents", async () => {
  const ws = await workspace();
  await write(ws, "Core/src/C.al", "COMPILE_ERROR");
  const bc = new FakeBc();
  const built = await buildApps(bc, "C1", {
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await Deno.makeTempDir(),
  });
  assertEquals(bc.compiles, ["Core"]);
  assertEquals(built.map((b) => [b.ok, b.attempted]), [[false, true], [false, false], [false, false]]);
  assertStringIncludes(built[1]!.diagnostics[0]!.message, "Core did not build");
});

Deno.test("prepareApps: prerequisites are cached by stamp; candidates are rebuilt", async () => {
  const pristine = await workspace();
  const changed = await Deno.makeTempDir();
  await safeCopyTree(pristine, changed);
  await write(changed, "Rental/src/R.al", `codeunit 70200 "CGR Rental"\n{\n    // agent\n}\n`);
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const cacheDir = await Deno.makeTempDir();
  const input = async () => ({
    pristine,
    pristineApps: await readAppGraph(pristine),
    candidateDir: changed,
    candidateApps: await readAppGraph(changed),
    changed: ["Rental"],
    workDir: await Deno.makeTempDir(),
    cacheDir,
  });
  const first = await prepareApps(lane, await input());
  assertEquals(bc.compiles, ["Core", "Rental", "Test"]);
  assertEquals(first.candidateIds, [IDS.rental, IDS.test]);
  const core = first.wanted.find((w) => w.id === IDS.core)!;
  assertEquals(core.role, "prereq");
  assert(Number(core.version.split(".")[2]) >= 1);
  assertEquals(first.wanted.find((w) => w.id === IDS.rental)!.version, "1.0.0.0");
  bc.compiles = [];
  const second = await prepareApps(lane, await input());
  assertEquals(bc.compiles, ["Rental", "Test"]);
  assertEquals(second.per_app_compiles, 2);
  assertEquals(second.wanted.find((w) => w.id === IDS.core)!.version, core.version);
});

Deno.test("deploy: refapp prerequisites stay, provisioning is split from candidate publish", async () => {
  const pristine = await workspace();
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const prep = await prepareApps(lane, {
    pristine,
    pristineApps: await readAppGraph(pristine),
    candidateDir: pristine,
    candidateApps: await readAppGraph(pristine),
    changed: [],
    workDir: await Deno.makeTempDir(),
    cacheDir: await Deno.makeTempDir(),
  });
  const first = await deploy(bc, "C1", prep.wanted);
  assertEquals(first.published, 3);
  const second = await deploy(bc, "C1", prep.wanted);
  assertEquals(second.published, 1);
  assert(!bc.syncs[1]!.removeIds.includes(IDS.core));
  assert(!bc.syncs[1]!.removeIds.includes(IDS.rental));
  assertEquals(second.candidate_publish_ms, 5);
  assert(second.provisioning_ms >= 0);
});

Deno.test("deploy: prerequisite failure and unknown failures are infra; a model defect is returned", async () => {
  const pristine = await workspace();
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const prep = await prepareApps(lane, {
    pristine,
    pristineApps: await readAppGraph(pristine),
    candidateDir: pristine,
    candidateApps: await readAppGraph(pristine),
    changed: ["Rental"],
    workDir: await Deno.makeTempDir(),
    cacheDir: await Deno.makeTempDir(),
  });
  bc.publishFailure = (_c, name) => name === "CGR Core" ? "boom" : null;
  await assertRejects(() => deploy(bc, "C1", prep.wanted), ContainerError, "prereq");
  bc.publishFailure = (_c, name) => name === "CGR Rental" ? "something unrecognized" : null;
  await assertRejects(() => deploy(bc, "C2", prep.wanted), ContainerError, "candidate");
  bc.publishFailure = (_c, name) =>
    name === "CGR Rental" ? "The schema synchronization failed: destructive changes" : null;
  const d = await deploy(bc, "C3", prep.wanted);
  assertEquals(d.candidateFailure!.id, IDS.rental);
});

Deno.test("a collision on publish is infra and reroutes", async () => {
  const pristine = await workspace();
  const bc = new FakeBc((cu) => cu === 80000 ? result({ Works: true }) : result({}));
  const lane = new BcLane(bc, ["Cronus28", "Cronus281"]);
  const prep = await prepareApps(lane, {
    pristine,
    pristineApps: await readAppGraph(pristine),
    candidateDir: pristine,
    candidateApps: await readAppGraph(pristine),
    changed: [],
    workDir: await Deno.makeTempDir(),
    cacheDir: await Deno.makeTempDir(),
  });
  bc.publishFailure = (c, name) =>
    c === "Cronus28" && name === "CGR Test" ? "Codeunit 80013 is already defined in 'Continia Core'" : null;
  const held = await lane.exclusive({ taskId: "HX-001", variantId: "e1", attemptNumber: 1 }, (c) =>
    deployAndTest(bc, c, {
      wanted: prep.wanted,
      tests: [{ codeunit: 80000, procedures: ["Works"], target: "candidate", zeroIsInfra: true }],
      cleanupIds: [IDS.test],
    }));
  assertEquals(held.container, "Cronus281");
  assertEquals(held.retries.length, 1);
  assertEquals(held.result.rows.map((r) => r.outcome), ["pass"]);
});

Deno.test("runTests: assertion vs runtime error, skipped, missing listed procedure, zero tests", async () => {
  const bc = new FakeBc((cu) =>
    cu === 80000
      ? result({ A: true, B: "Assert.AreEqual failed. Expected:<1> (Integer). Actual:<2>", C: "Division by zero" })
      : result({})
  );
  const r = await runTests(bc, "C1", [
    { codeunit: 80000, procedures: ["A", "b", "C", "Missing"], target: "candidate", zeroIsInfra: true },
  ]);
  assertEquals(r.rows.map((x) => [x.procedure, x.outcome, x.failure]), [
    ["A", "pass", null],
    ["b", "fail", "assertion"],
    ["C", "fail", "runtime_error"],
    ["Missing", "not_run", "infra"],
  ]);
  assertEquals(r.messages.length, 2);
  await assertRejects(
    () => runTests(bc, "C1", [{ codeunit: 80001, procedures: ["X"], target: "candidate", zeroIsInfra: true }]),
    ContainerError,
    "zero tests",
  );
  const agent = await runTests(bc, "C1", [{ codeunit: 80001, procedures: null, target: "candidate", zeroIsInfra: false }]);
  assertEquals(agent.rows.map((x) => x.outcome), ["not_run"]);
  assertEquals(classifyTestFailure("Assert.IsTrue failed. x"), "assertion");
});

Deno.test("deployAndTest: candidates are cleaned up even when tests throw", async () => {
  const pristine = await workspace();
  const bc = new FakeBc(() => {
    throw new ContainerError("soap down", "C1", "test");
  });
  const lane = new BcLane(bc, ["C1"]);
  const prep = await prepareApps(lane, {
    pristine,
    pristineApps: await readAppGraph(pristine),
    candidateDir: pristine,
    candidateApps: await readAppGraph(pristine),
    changed: [],
    workDir: await Deno.makeTempDir(),
    cacheDir: await Deno.makeTempDir(),
  });
  await assertRejects(() =>
    deployAndTest(bc, "C1", {
      wanted: prep.wanted,
      tests: [{ codeunit: 80000, procedures: null, target: "candidate", zeroIsInfra: true }],
      cleanupIds: [IDS.test],
    })
  );
  assertEquals(bc.syncs.at(-1)!.removeIds, [IDS.test]);
  assertEquals(bc.syncs.at(-1)!.publish, []);
});

Deno.test("BcLane: one container serializes; queue wait is measured", async () => {
  const lane = new BcLane(new FakeBc(), ["C1"]);
  const order: string[] = [];
  const ctx = { taskId: "t", variantId: "v", attemptNumber: 1 };
  const slow = lane.exclusive(ctx, async (c) => {
    order.push(`start-a-${c}`);
    await new Promise((r) => setTimeout(r, 30));
    order.push("end-a");
  });
  const fast = lane.exclusive(ctx, (c) => {
    order.push(`start-b-${c}`);
    return Promise.resolve();
  });
  const [, b] = await Promise.all([slow, fast]);
  assertEquals(order, ["start-a-C1", "end-a", "start-b-C1"]);
  assert(b.queue_ms >= 20);
});

Deno.test("BcLane.compile: an infra error moves the compile to the next container", async () => {
  const lane = new BcLane(new FakeBc(), ["C1", "C2"]);
  const tried: string[] = [];
  const got = await lane.compile((c) => {
    tried.push(c);
    if (c === "C1") throw new ContainerError("down", c, "compile");
    return Promise.resolve(c);
  });
  assertEquals([got, tried], ["C2", ["C1", "C2"]]);
});

Deno.test("BcLane: infra on every container exhausts the retries", async () => {
  const lane = new BcLane(new FakeBc(), ["C1", "C2"]);
  await assertRejects(() =>
    lane.exclusive({ taskId: "t", variantId: "v", attemptNumber: 1 }, (c) => {
      throw new ContainerError("down", c, "test");
    })
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/bc-lane.test.ts`
Expected: FAIL, `Module not found ".../src/harness/bc-lane.ts"`.

- [ ] **Step 3: Implement**

`src/harness/bc-lane.ts`:

```typescript
/**
 * The harness BC lane (spec 1a section 5, D12). Host-side compiles through a
 * container's compiler folder; publish + test hold one container under a
 * per-container mutex and reroute to another container on an infra fault
 * (withInfraRetry, optional health monitor). Agent `cg-al` calls (M1-19) and
 * verdicts (M1-17) share one lane, so they share the fixed concurrency.
 */

import { basename, join } from "@std/path";
import type { z } from "zod";
import type {
  ALProject,
  CompilationError,
  CompilationResult,
  HarnessInstalledApp,
  HarnessSyncResult,
  TestResult,
} from "../container/types.ts";
import type { ContainerHealthMonitor } from "../health/monitor.ts";
import type { InfraRetryRecord } from "../tasks/interfaces.ts";
import { ContainerError, ValidationError } from "../errors.ts";
import {
  classifyPublishFailure,
  isCollisionPublishFailure,
} from "../health/classify-publish-failure.ts";
import { isInfraError } from "../health/is-infra-error.ts";
import { NoEligibleContainersError } from "../parallel/errors.ts";
import { withInfraRetry } from "../parallel/infra-retry.ts";
import { Mutex } from "../parallel/semaphore.ts";
import {
  appStamps,
  candidateFolders,
  planAppSync,
  stampVersion,
  type WantedApp,
} from "./bc-apps.ts";
import { exists, safeCopyTree } from "./fsutil.ts";
import { isTaskBuildArtifact } from "./hash.ts";
import type { TestResultSchema } from "./records.ts";
import type { StagedApp } from "./staging.ts";

/** The BcContainerProvider surface the harness uses. Tests pass a fake. */
export interface HarnessBc {
  compileProject(container: string, project: ALProject): Promise<CompilationResult>;
  listHarnessApps(container: string): Promise<HarnessInstalledApp[]>;
  syncHarnessApps(
    container: string,
    plan: { removeIds: string[]; publish: string[] },
  ): Promise<HarnessSyncResult>;
  runHarnessTests(container: string, codeunit: number): Promise<TestResult>;
}

export type TestRow = z.output<typeof TestResultSchema>;

export interface Held<T> {
  result: T;
  container: string;
  queue_ms: number;
  retries: InfraRetryRecord[];
}

export class BcLane {
  private readonly locks = new Map<string, Mutex>();
  private readonly load = new Map<string, number>();
  private rotor = 0;

  constructor(
    readonly bc: HarnessBc,
    readonly containers: string[],
    private readonly opts: {
      healthMonitor?: ContainerHealthMonitor;
      maxInfraRetries?: number;
    } = {},
  ) {
    if (containers.length === 0) throw new Error("BcLane needs a container");
    for (const c of containers) {
      this.locks.set(c, new Mutex());
      this.load.set(c, 0);
    }
  }

  /** Container whose compiler folder a host-side compile uses. No lock. */
  compileContainer(): string {
    return this.containers[this.rotor++ % this.containers.length]!;
  }

  /**
   * Run a host-side compile job with one container's compiler folder; on an
   * infra error try the next container, each at most once.
   */
  async compile<T>(fn: (container: string) => Promise<T>): Promise<T> {
    for (let k = 1;; k++) {
      const c = this.compileContainer();
      try {
        return await fn(c);
      } catch (err) {
        if (!isInfraError(err) || k >= this.containers.length) throw err;
      }
    }
  }

  /** Hold one container for publish + test; infra faults reroute. */
  async exclusive<T>(
    ctx: { taskId: string; variantId: string; attemptNumber: number },
    fn: (container: string) => Promise<T>,
  ): Promise<Held<T>> {
    let container = "";
    let queue_ms = 0;
    const { result, retries } = await withInfraRetry<T>(
      async ({ excludeContainers, onRouted }) => {
        const eligible = this.containers.filter((c) => !excludeContainers.includes(c));
        if (eligible.length === 0) {
          throw new NoEligibleContainersError(excludeContainers, this.containers);
        }
        const c = eligible.reduce((a, b) => this.load.get(b)! < this.load.get(a)! ? b : a);
        onRouted(c);
        this.load.set(c, this.load.get(c)! + 1);
        const t0 = performance.now();
        const release = await this.locks.get(c)!.acquire();
        queue_ms = performance.now() - t0;
        container = c;
        try {
          return await fn(c);
        } finally {
          release();
          this.load.set(c, this.load.get(c)! - 1);
        }
      },
      {
        maxRetries: this.opts.maxInfraRetries ?? Math.max(1, this.containers.length - 1),
        configuredContainers: this.containers,
        context: ctx,
        ...(this.opts.healthMonitor ? { healthMonitor: this.opts.healthMonitor } : {}),
      },
    );
    return { result, container, queue_ms, retries };
  }
}

export interface BuiltApp {
  folder: string;
  id: string;
  version: string;
  ok: boolean;
  /** False when a dependency failed and the compiler never ran. */
  attempted: boolean;
  file: string | null;
  diagnostics: CompilationError[];
  compile_ms: number;
}

const synthetic = (message: string): CompilationError => ({
  code: "CG0001",
  message,
  file: "app.json",
  line: 0,
  column: 0,
  severity: "error",
});

/**
 * Compile apps in the given (dependency) order from copies whose app.json
 * version is replaced from `versions`, each with every earlier .app (and
 * every `prebuilt` .app) in its .alpackages (findings section 1).
 */
export async function buildApps(
  bc: HarnessBc,
  container: string,
  o: {
    srcDir: string;
    apps: StagedApp[];
    versions: Map<string, string>;
    outDir: string;
    prebuilt?: Map<string, string>;
  },
): Promise<BuiltApp[]> {
  const files = new Map(o.prebuilt ?? []);
  const out: BuiltApp[] = [];
  await Deno.mkdir(join(o.outDir, ".apps"), { recursive: true });
  for (const app of o.apps) {
    const version = o.versions.get(app.folder) ?? app.version;
    const failed = app.depends.find((d) => !files.has(d));
    if (failed) {
      out.push({
        folder: app.folder, id: app.id, version, ok: false, attempted: false, file: null,
        diagnostics: [synthetic(`dependency ${failed} did not build`)], compile_ms: 0,
      });
      continue;
    }
    const dir = join(o.outDir, app.folder);
    await Deno.remove(dir, { recursive: true }).catch(() => {});
    await safeCopyTree(join(o.srcDir, app.folder), dir, { skip: isTaskBuildArtifact });
    const appJson = JSON.parse(await Deno.readTextFile(join(dir, "app.json")));
    appJson.version = version;
    await Deno.writeTextFile(join(dir, "app.json"), JSON.stringify(appJson, null, 2));
    await Deno.mkdir(join(dir, ".alpackages"), { recursive: true });
    for (const f of files.values()) {
      await Deno.copyFile(f, join(dir, ".alpackages", basename(f)));
    }
    const t0 = performance.now();
    const r = await bc.compileProject(container, { path: dir, appJson, sourceFiles: [], testFiles: [] });
    const compile_ms = performance.now() - t0;
    let file: string | null = null;
    if (r.success && r.artifactPath) {
      file = join(o.outDir, ".apps", basename(r.artifactPath));
      await Deno.copyFile(r.artifactPath, file);
      files.set(app.folder, file);
    }
    out.push({
      folder: app.folder, id: app.id, version, ok: file !== null, attempted: true, file,
      diagnostics: r.errors, compile_ms,
    });
  }
  return out;
}

export interface PrepareInput {
  /** Staged workspace: prerequisite sources and stamps. */
  pristine: string;
  pristineApps: StagedApp[];
  /** Verdict workspace or backend snapshot: candidate sources. */
  candidateDir: string;
  candidateApps: StagedApp[];
  changed: string[];
  workDir: string;
  /** results/harness/cache/apps: compiled prerequisites by stamp. */
  cacheDir: string;
}

export interface Prepared {
  container: string;
  built: BuiltApp[];
  wanted: WantedApp[];
  /** Candidate app ids in dependency order. */
  candidateIds: string[];
  buildOk: boolean;
  compile_ms: number;
  /** Compiler executions (units kept apart from logical requests, spec 1a section 5). */
  per_app_compiles: number;
}

async function cachedApp(cacheDir: string, stamp: string): Promise<string | null> {
  const dir = join(cacheDir, stamp);
  if (!await exists(dir)) return null;
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && e.name.endsWith(".app")) return join(dir, e.name);
  }
  return null;
}

/** Stamp, build (prerequisites from the cache when possible) and list what to deploy. */
export function prepareApps(lane: BcLane, o: PrepareInput): Promise<Prepared> {
  return lane.compile((container) => prepareOn(lane, container, o));
}

async function prepareOn(lane: BcLane, container: string, o: PrepareInput): Promise<Prepared> {
  const graph = o.candidateApps;
  const base = new Map(o.pristineApps.map((a) => [a.folder, a.version]));
  const cands = new Set(candidateFolders(graph, o.changed));
  const stamps = await appStamps(o.pristine, o.pristineApps);
  const versions = new Map(graph.map((a) => [
    a.folder,
    stampVersion(
      base.get(a.folder) ?? a.version,
      cands.has(a.folder) ? "candidate" : "prereq",
      stamps.get(a.folder) ?? "",
    ),
  ]));
  let compile_ms = 0;
  let per_app_compiles = 0;
  const prebuilt = new Map<string, string>();
  const missing: StagedApp[] = [];
  for (const a of graph.filter((x) => !cands.has(x.folder))) {
    const f = await cachedApp(o.cacheDir, stamps.get(a.folder)!);
    if (f) prebuilt.set(a.folder, f);
    else missing.push(a);
  }
  if (missing.length > 0) {
    const built = await buildApps(lane.bc, container, {
      srcDir: o.pristine, apps: missing, versions, outDir: join(o.workDir, "prereq"), prebuilt,
    });
    for (const b of built) {
      compile_ms += b.compile_ms;
      if (b.attempted) per_app_compiles++;
      if (!b.ok) {
        // The staged baseline must compile (authoring gate, 1b section 8):
        // this is a task bug, not the agent's.
        throw new ValidationError(
          `staged prerequisite ${b.folder} does not compile: ${b.diagnostics.map((d) => d.message).join("; ")}`,
          [b.folder],
        );
      }
      const dir = join(o.cacheDir, stamps.get(b.folder)!);
      await Deno.mkdir(dir, { recursive: true });
      const cached = join(dir, basename(b.file!));
      await Deno.copyFile(b.file!, cached);
      prebuilt.set(b.folder, cached);
    }
  }
  const candApps = graph.filter((a) => cands.has(a.folder));
  const built = await buildApps(lane.bc, container, {
    srcDir: o.candidateDir, apps: candApps, versions, outDir: join(o.workDir, "candidate"), prebuilt,
  });
  for (const b of built) {
    compile_ms += b.compile_ms;
    if (b.attempted) per_app_compiles++;
  }
  const buildOk = built.every((b) => b.ok);
  const fileOf = new Map([...prebuilt, ...built.filter((b) => b.ok).map((b) => [b.folder, b.file!] as const)]);
  const idOf = new Map(graph.map((a) => [a.folder, a.id]));
  const wanted: WantedApp[] = buildOk
    ? graph.map((a) => ({
      id: a.id,
      name: a.name,
      publisher: a.publisher,
      version: versions.get(a.folder)!,
      file: fileOf.get(a.folder)!,
      role: cands.has(a.folder) ? "candidate" : "prereq",
      depends: a.depends.map((d) => idOf.get(d)!),
    }))
    : [];
  return {
    container, built, wanted, candidateIds: candApps.map((a) => a.id), buildOk, compile_ms, per_app_compiles,
  };
}

export interface TestSpec {
  codeunit: number;
  /** null = every procedure the codeunit ran (agent-added codeunits). */
  procedures: string[] | null;
  /** "candidate" | "reference" | "mutant:<name>" (Part 1 TestResultSchema). */
  target: string;
  /** Listed (shipped or oracle) codeunits: zero tests after publish is infra (GH #13). */
  zeroIsInfra: boolean;
}

export interface TestMessage {
  codeunit: number;
  procedure: string;
  target: string;
  message: string;
}

export function classifyTestFailure(error: string): "assertion" | "runtime_error" {
  return /\bAssert\.\w+ failed\b/i.test(error) ? "assertion" : "runtime_error";
}

function row(
  s: TestSpec,
  procedure: string,
  outcome: TestRow["outcome"],
  failure: TestRow["failure"],
): TestRow {
  return { codeunit: s.codeunit, procedure, target: s.target, outcome, failure };
}

export async function runTests(
  bc: HarnessBc,
  container: string,
  specs: TestSpec[],
): Promise<{ rows: TestRow[]; messages: TestMessage[]; test_ms: number }> {
  const rows: TestRow[] = [];
  const messages: TestMessage[] = [];
  let test_ms = 0;
  for (const s of specs) {
    const t0 = performance.now();
    let r: TestResult;
    try {
      r = await bc.runHarnessTests(container, s.codeunit);
    } catch (err) {
      if (err instanceof ContainerError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new ContainerError(`SOAP run of ${s.codeunit} failed on ${container}: ${msg}`, container, "test");
    }
    test_ms += performance.now() - t0;
    if (r.totalTests === 0 || r.results.length === 0) {
      if (s.zeroIsInfra) {
        throw new ContainerError(
          `codeunit ${s.codeunit} ran zero tests after publish on ${container} (infra, GH #13)`,
          container,
          "test",
        );
      }
      rows.push(row(s, s.procedures?.[0] ?? "(none)", "not_run", "runtime_error"));
      continue;
    }
    const byName = new Map(r.results.map((x) => [x.name.toLowerCase(), x]));
    for (const name of s.procedures ?? r.results.map((x) => x.name)) {
      const x = byName.get(name.toLowerCase());
      if (!x) rows.push(row(s, name, "not_run", "infra"));
      else if (x.passed) rows.push(row(s, name, "pass", null));
      else if (x.error === undefined) rows.push(row(s, name, "not_run", "runtime_error"));
      else {
        rows.push(row(s, name, "fail", classifyTestFailure(x.error)));
        messages.push({ codeunit: s.codeunit, procedure: name, target: s.target, message: x.error.slice(0, 2000) });
      }
    }
  }
  return { rows, messages, test_ms };
}

/** Passed when every row passed; null (unscored) when any row is infra. */
export function scorerPassed(rows: TestRow[]): boolean | null {
  if (rows.some((r) => r.failure === "infra")) return null;
  return rows.length > 0 && rows.every((r) => r.outcome === "pass");
}

export interface Deployed {
  /** Listing, removals and prerequisite publishes (spec 1a section 7 item 5). */
  provisioning_ms: number;
  candidate_publish_ms: number;
  candidateFailure: { id: string; message: string } | null;
  removed: number;
  published: number;
}

export async function deploy(
  bc: HarnessBc,
  container: string,
  wanted: WantedApp[],
): Promise<Deployed> {
  const t0 = performance.now();
  const plan = planAppSync(await bc.listHarnessApps(container), wanted);
  const sync = await bc.syncHarnessApps(container, {
    removeIds: plan.remove,
    publish: plan.publish.map((w) => w.file),
  });
  const total = performance.now() - t0;
  let candidate_publish_ms = 0;
  for (const p of sync.published) {
    if (plan.publish[p.index]?.role === "candidate") candidate_publish_ms += p.endMs - p.startMs;
  }
  const d: Deployed = {
    provisioning_ms: Math.max(0, total - candidate_publish_ms),
    candidate_publish_ms,
    candidateFailure: null,
    removed: plan.remove.length,
    published: sync.published.length,
  };
  if (sync.failed) {
    const w = plan.publish[sync.failed.index];
    const msg = sync.failed.message;
    const modelDefect = w?.role === "candidate" && !isCollisionPublishFailure(msg) &&
      classifyPublishFailure(msg) === "model";
    if (!modelDefect) {
      throw new ContainerError(
        `harness ${w?.role ?? "app"} publish failed on ${container}: ${msg}`,
        container,
        "publish",
        { rawOutput: sync.output.slice(-4096) },
      );
    }
    d.candidateFailure = { id: w!.id, message: msg };
  }
  return d;
}

export interface DeployTestResult {
  deployed: Deployed;
  rows: TestRow[];
  messages: TestMessage[];
  test_ms: number;
}

/**
 * Deploy, run tests, then unpublish the candidates and the oracle (spec 1a
 * section 7). The cleanup is best-effort: the next deploy removes every
 * non-kept CentralGauge app anyway, so a failed cleanup cannot leak state.
 */
export async function deployAndTest(
  bc: HarnessBc,
  container: string,
  i: { wanted: WantedApp[]; tests: TestSpec[]; cleanupIds: string[] },
): Promise<DeployTestResult> {
  try {
    const deployed = await deploy(bc, container, i.wanted);
    if (deployed.candidateFailure) {
      const message = `candidate publish/install failed: ${deployed.candidateFailure.message}`;
      return {
        deployed,
        rows: i.tests.flatMap((s) =>
          (s.procedures ?? ["(publish)"]).map((p) => row(s, p, "not_run", "runtime_error"))
        ),
        messages: [{ codeunit: 0, procedure: "(publish)", target: i.tests[0]?.target ?? "candidate", message }],
        test_ms: 0,
      };
    }
    return { deployed, ...await runTests(bc, container, i.tests) };
  } finally {
    if (i.cleanupIds.length > 0) {
      await bc.syncHarnessApps(container, { removeIds: i.cleanupIds, publish: [] })
        .catch(() => {});
    }
  }
}
```

`scripts/harness/app-sync-probe.ts` (ops driver, wiring only):

```typescript
// Ops driver for M1-27 (lane-ops). Wires M1-15/M1-16 to ONE real container.
// Usage (bench stopped, container leased):
//   DOCKER_CONTEXT=desktop-windows deno run --allow-all scripts/harness/app-sync-probe.ts <container> <outDir>
// Prints one JSON line per step; the evidence file quotes them.
import { join } from "@std/path";
import { setupContainers } from "../../cli/commands/bench/container-setup.ts";
import type { BcContainerProvider } from "../../src/container/bc-container-provider.ts";
import { ConfigManager } from "../../src/config/config.ts";
import { BcLane, deploy, prepareApps, runTests } from "../../src/harness/bc-lane.ts";
import { safeCopyTree } from "../../src/harness/fsutil.ts";
import { isTaskBuildArtifact } from "../../src/harness/hash.ts";
import { readAppGraph } from "../../src/harness/staging.ts";

const [container, outDir] = Deno.args;
if (!container || !outDir) throw new Error("usage: app-sync-probe.ts <container> <outDir>");
const cfg = await ConfigManager.loadConfig();
const { containerProvider } = await setupContainers([container], "bccontainer", cfg.container ?? {});
const bc = containerProvider as BcContainerProvider;
const lane = new BcLane(bc, [container]);
const cacheDir = join(outDir, "cache");
const log = (step: string, data: Record<string, unknown>) =>
  console.log(JSON.stringify({ step, at: new Date().toISOString(), ...data }));
const listed = async () =>
  (await bc.listHarnessApps(container))
    .map((a) => `${a.name}@${a.version}${a.installed ? "" : " (not installed)"}`).sort();

async function copyRefapp(to: string) {
  await safeCopyTree("harness-tasks/refapp", to, { skip: isTaskBuildArtifact });
  return to;
}
async function touchFirstAl(dir: string, app: string) {
  const src = join(dir, app, "src");
  for await (const e of Deno.readDir(src)) {
    if (e.name.endsWith(".al")) {
      await Deno.writeTextFile(join(src, e.name), "\n// probe\n", { append: true });
      return;
    }
  }
}
async function step(name: string, pristine: string, candidateDir: string, changed: string[]) {
  const prep = await prepareApps(lane, {
    pristine,
    pristineApps: await readAppGraph(pristine),
    candidateDir,
    candidateApps: await readAppGraph(candidateDir),
    changed,
    workDir: join(outDir, name),
    cacheDir,
  });
  const before = await listed();
  const deployed = await deploy(bc, container, prep.wanted);
  const tests = await runTests(bc, container, [
    { codeunit: 80000, procedures: null, target: "candidate", zeroIsInfra: true },
  ]);
  log(name, {
    before, after: await listed(), candidates: prep.candidateIds, compile_ms: prep.compile_ms,
    per_app_compiles: prep.per_app_compiles, deployed, rows: tests.rows, test_ms: tests.test_ms,
  });
  return prep;
}

const pristine = await copyRefapp(join(outDir, "pristine"));
await bc.prenukeCentralGaugeApps([container]);
log("prenuke", { after: await listed() });
await step("a-fresh", pristine, pristine, []);
const rental = await copyRefapp(join(outDir, "rental-changed"));
await touchFirstAl(rental, "Rental");
const b = await step("b-rental-changed", pristine, rental, ["Rental"]);
const stale = await copyRefapp(join(outDir, "core-stale"));
await touchFirstAl(stale, "Core");
await step("c-stale-core", stale, stale, []);
await bc.syncHarnessApps(container, { removeIds: [...b.candidateIds].reverse(), publish: [] });
log("d-cleanup", { after: await listed() });
await bc.prenukeCentralGaugeApps([container]);
await step("e-after-bench-prenuke", pristine, pristine, []);
await bc.dispose();
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/bc-lane.test.ts`
Expected: all 11 tests pass. Then `deno check scripts/harness/app-sync-probe.ts` (compiles; not executed here).

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/bc-lane.ts tests/unit/harness/fake-bc.ts tests/unit/harness/bc-lane.test.ts scripts/harness/app-sync-probe.ts
deno lint src/harness/bc-lane.ts tests/unit/harness/fake-bc.ts tests/unit/harness/bc-lane.test.ts scripts/harness/app-sync-probe.ts
deno fmt src/harness/bc-lane.ts tests/unit/harness/fake-bc.ts tests/unit/harness/bc-lane.test.ts scripts/harness/app-sync-probe.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/bc-lane.ts tests/unit/harness/fake-bc.ts tests/unit/harness/bc-lane.test.ts scripts/harness/app-sync-probe.ts
git commit -m "feat(harness): BC lane with dependency-order builds, scoped deploy and rerouting tests"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/bc-lane.test.ts` passes; check, lint and `deno fmt --check` clean on the four files.

---

### Task M1-17: verdict: build, pass_to_pass, fail_to_pass and `judge`

Spec 1a section 7 scorers 1-3 ("An execution passes only if every scorer passes"; pass_to_pass runs the listed visible procedures from the pristine copy plus tests the agent added; fail_to_pass publishes the hidden oracle; results per test procedure), section 8 (a BC fault during the verdict re-judges on another container; the agent is never re-run), findings section 8 (provisioning latency reported separately). Judgment records are Part 1's schema; spans, violations, compiler diagnostics and failure messages go to `results/harness/verdicts/<judgment-id>.json`. Agent-added `TestPage` codeunits cannot run on the SOAP runner (soap-test-harness.md), so they are listed in the side file and not scored (open question 5).

**Lane:** infra. **Deps:** M1-07 (`JudgmentRecordSchema`), M1-13, M1-14, M1-16.

**Files:**
- Create: `src/harness/verdict.ts`
- Test: `tests/unit/harness/verdict.test.ts`

**Interfaces:**
- Consumes: `BcLane`, `prepareApps`, `buildApps`, `deployAndTest`, `scorerPassed`, `TestRow`, `TestSpec`, `TestMessage` (M1-16); `stampVersion`, `WantedApp` (M1-15); `buildVerdictWorkspace`, `addedTestCodeunits`, `TEST_APP` (M1-14); `readAppGraph`, `readAppJson`, `applyOverlay`, `StagedApp` (M1-13); `safeCopyTree` (M1-12); `JudgmentRecordSchema`, `JudgmentRecord` (M1-07); `LoadedTask` (M1-01).
- Produces: `SCORER_VERSIONS`; `interface JudgeInput { executionId; workspaceHash; task: LoadedTask; oracleHash; pristine; artifact; symbolIds: ReadonlySet<string>; workDir; cacheDir }`; `interface VerdictSpans { reconstruct_ms; compile_ms; queue_ms; provisioning_ms; candidate_publish_ms; test_ms; total_ms }`; `interface VerdictLog { v: 1; judgment_id; execution_id; violations: string[]; diagnostics: { app: string; code: string; message: string }[]; test_messages: TestMessage[]; notes: string[]; spans: VerdictSpans; containers: string[]; infra_retries: InfraRetryRecord[]; per_app_compiles: number; error: string | null }`; `judge(lane: BcLane, i: JudgeInput, now?: () => Date): Promise<{ judgment: JudgmentRecord; log: VerdictLog }>`; `writeVerdictLog(resultsRoot: string, log: VerdictLog): Promise<void>`. M1-18 adds the test-authoring path inside `judge`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/verdict.test.ts`:

```typescript
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import { freezeWorkspace, safeCopyTree } from "../../../src/harness/fsutil.ts";
import { oracleHash, resolveRefapp } from "../../../src/harness/identity.ts";
import { JudgmentRecordSchema } from "../../../src/harness/records.ts";
import { applyOverlay, stageRefappTask } from "../../../src/harness/staging.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { judge, writeVerdictLog } from "../../../src/harness/verdict.ts";
import { deployedSource, FakeBc, result } from "./fake-bc.ts";
import { IDS, makeRefappRepo, write } from "./refapp-fixture.ts";

/** Shipped test passes unless Rental carries BREAK_P2P; the oracle passes iff Rental returns 10. */
function script() {
  return new FakeBc((cu, deployed) => {
    const rental = deployedSource(deployed, "CGR Rental");
    if (cu === 80000) {
      return result({ ShippedPasses: rental.includes("BREAK_P2P") ? "Assert.IsTrue failed. broken" : true });
    }
    if (cu === 85001) {
      return result({ FixWorks: rental.includes("exit(10)") ? true : "Assert.AreEqual failed. Expected:<10>" });
    }
    if (cu === 80020) return result({ AgentTest: true });
    return result({});
  });
}

/** Stage HX-001, build an artifact (solution overlay + extra edits), freeze it. */
async function setup(solution: "correct" | "naive/a" | null, edits: Record<string, string> = {}) {
  const repo = await makeRefappRepo();
  const task = await loadTask(join(repo.tasksDir, "HX-001"));
  const staged = await stageRefappTask({
    repoRoot: repo.root,
    task,
    refapp: await resolveRefapp(repo.root, "refapp-v1"),
    symbols: repo.symbols,
    symbolStore: repo.symbolStore,
    out: await Deno.makeTempDir(),
  });
  const ws = await Deno.makeTempDir();
  await safeCopyTree(staged.pristine, ws);
  if (solution) await applyOverlay(join(task.dir, solution), ws);
  for (const [rel, text] of Object.entries(edits)) await write(ws, rel, text);
  const results = await Deno.makeTempDir();
  const frozen = await freezeWorkspace(results, ws);
  return {
    results,
    input: {
      executionId: crypto.randomUUID(),
      workspaceHash: frozen.workspace_hash,
      task,
      oracleHash: await oracleHash(task),
      pristine: staged.pristine,
      artifact: join(results, frozen.stored_path),
      symbolIds: new Set([IDS.assert]),
      workDir: await Deno.makeTempDir(),
      cacheDir: await Deno.makeTempDir(),
    },
  };
}

Deno.test("judge: the correct solution passes every scorer; the record validates", async () => {
  const bc = script();
  const { input, results } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  JudgmentRecordSchema.parse(judgment);
  assertEquals(judgment.verdict, "pass");
  assertEquals(judgment.scorers.map((s) => [s.name, s.passed]), [
    ["build", true],
    ["pass_to_pass", true],
    ["fail_to_pass", true],
  ]);
  assertEquals(judgment.scorers[2]!.tests, [
    { codeunit: 85001, procedure: "FixWorks", target: "candidate", outcome: "pass", failure: null },
  ]);
  assertEquals(judgment.verdict_container, "C1");
  const cleanup = bc.syncs.at(-1)!;
  assertEquals(cleanup.publish, []);
  assertEquals(cleanup.removeIds[0], IDS.oracle);
  assert(!cleanup.removeIds.includes(IDS.core));
  for (const k of ["reconstruct_ms", "compile_ms", "provisioning_ms", "candidate_publish_ms", "test_ms", "total_ms"] as const) {
    assert(log.spans[k] >= 0);
  }
  await writeVerdictLog(results, log);
  const stored = JSON.parse(await Deno.readTextFile(join(results, "verdicts", `${judgment.id}.json`)));
  assertEquals(stored.execution_id, input.executionId);
});

Deno.test("judge: a naive solution fails fail_to_pass by an assertion", async () => {
  const { input } = await setup("naive/a");
  const { judgment, log } = await judge(new BcLane(script(), ["C1"]), input);
  assertEquals(judgment.verdict, "fail");
  assertEquals(judgment.scorers[2]!.tests[0]!.failure, "assertion");
  assertStringIncludes(log.test_messages[0]!.message, "Expected:<10>");
});

Deno.test("judge: a compile error fails build and runs no tests", async () => {
  const bc = script();
  const { input } = await setup("correct", { "Rental/src/Broken.al": "COMPILE_ERROR" });
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.scorers.map((s) => s.passed), [false, false, false]);
  assertEquals(bc.tests, []);
  assert(log.diagnostics.length > 0);
});

Deno.test("judge: a validation violation fails build before any compile", async () => {
  const bc = script();
  const { input } = await setup("correct", {
    "Rental/src/Reserved.al": `codeunit 75001 "Nope"\n{\n}\n`,
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.verdict, "fail");
  assertEquals(bc.compiles, []);
  assertStringIncludes(log.violations.join("\n"), "reserved band");
});

Deno.test("judge: a pass_to_pass regression fails the verdict", async () => {
  const { input } = await setup("correct", {
    "Rental/src/Break.al": `codeunit 70210 "Break"\n{\n    // BREAK_P2P\n}\n`,
  });
  const { judgment } = await judge(new BcLane(script(), ["C1"]), input);
  assertEquals(judgment.scorers[1]!.passed, false);
  assertEquals(judgment.verdict, "fail");
});

Deno.test("judge: agent-added tests run under pass_to_pass; TestPage ones are noted, not scored", async () => {
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": `codeunit 80020 "Agent"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure AgentTest()\n    begin\n    end;\n}\n`,
    "Test/src/Page.Test.al": `codeunit 80021 "Page"\n{\n    Subtype = Test;\n    var P: TestPage "Customer Card";\n}\n`,
  });
  const { judgment, log } = await judge(new BcLane(script(), ["C1"]), input);
  assertEquals(judgment.verdict, "pass");
  assert(judgment.scorers[1]!.tests.some((t) => t.codeunit === 80020 && t.outcome === "pass"));
  assertStringIncludes(log.notes.join("\n"), "80021");
});

Deno.test("judge: an infra fault on one container rejudges on another", async () => {
  const bc = script();
  bc.broken.add("C1");
  const { input } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(judgment.verdict, "pass");
  assertEquals(judgment.verdict_container, "C2");
  assertEquals(log.infra_retries.length, 1);
});

Deno.test("judge: infra on every container is unscored, never a fail", async () => {
  const bc = script();
  const { input } = await setup("correct");
  const lane = new BcLane(bc, ["C1", "C2"]);
  bc.broken.add("C1");
  bc.broken.add("C2");
  const { judgment, log } = await judge(lane, input);
  assertEquals(judgment.verdict, "unscored");
  assertEquals(judgment.scorers.map((s) => s.passed), [null, null, null]);
  assert(log.error !== null);
});

Deno.test("judge: a candidate install defect is the agent's failure", async () => {
  const bc = script();
  bc.publishFailure = (_c, name) =>
    name === "CGR Rental" ? "The schema synchronization failed: destructive changes" : null;
  const { input } = await setup("correct");
  const { judgment } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.verdict, "fail");
  assertEquals(judgment.scorers[2]!.tests[0]!.failure, "runtime_error");
});
```

The infra-everywhere test marks build `null` too: the compile container is also broken, so the build never finished. With only publish broken, build stays `true` and the test scorers are `null`.

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/verdict.test.ts`
Expected: FAIL, `Module not found ".../src/harness/verdict.ts"`.

- [ ] **Step 3: Implement**

`src/harness/verdict.ts`:

```typescript
/**
 * Verdict pipeline (spec 1a section 7): scorers on a reconstructed
 * workspace, per-procedure results. A BC fault rejudges on another
 * container (BcLane); when every container fails, the scorers that did not
 * finish are null and the verdict is unscored (spec 1a section 8). The
 * agent is never re-run for a verdict-side fault.
 */

import { join } from "@std/path";
import type { InfraRetryRecord } from "../tasks/interfaces.ts";
import { isInfraError } from "../health/is-infra-error.ts";
import { InfraRetriesExhaustedError } from "../parallel/errors.ts";
import { stampVersion, type WantedApp } from "./bc-apps.ts";
import {
  type BcLane,
  buildApps,
  deployAndTest,
  type Prepared,
  prepareApps,
  scorerPassed,
  type TestMessage,
  type TestRow,
  type TestSpec,
} from "./bc-lane.ts";
import { type JudgmentRecord, JudgmentRecordSchema } from "./records.ts";
import { readAppGraph, readAppJson, type StagedApp } from "./staging.ts";
import type { LoadedTask } from "./task.ts";
import {
  addedTestCodeunits,
  buildVerdictWorkspace,
  TEST_APP,
} from "./verdict-workspace.ts";

export const SCORER_VERSIONS = {
  build: "1",
  pass_to_pass: "1",
  fail_to_pass: "1",
  mutant_kill: "1",
} as const;
type ScorerName = keyof typeof SCORER_VERSIONS;

export interface JudgeInput {
  executionId: string;
  workspaceHash: string;
  task: LoadedTask;
  /** The oracle hash this judgment is recorded against (campaign or current). */
  oracleHash: string;
  /** Staged workspace of this task: trusted. */
  pristine: string;
  /** Frozen workspace in the store. */
  artifact: string;
  symbolIds: ReadonlySet<string>;
  workDir: string;
  cacheDir: string;
}

export interface VerdictSpans {
  reconstruct_ms: number;
  compile_ms: number;
  queue_ms: number;
  provisioning_ms: number;
  candidate_publish_ms: number;
  test_ms: number;
  total_ms: number;
}

export interface VerdictLog {
  v: 1;
  judgment_id: string;
  execution_id: string;
  violations: string[];
  diagnostics: { app: string; code: string; message: string }[];
  test_messages: TestMessage[];
  notes: string[];
  spans: VerdictSpans;
  containers: string[];
  infra_retries: InfraRetryRecord[];
  per_app_compiles: number;
  error: string | null;
}

interface Scorer {
  name: string;
  passed: boolean | null;
  tests: TestRow[];
}

/** Scorer state for one judgment: unfinished scorers become null on infra. */
export class Scores {
  readonly list: Scorer[];
  private readonly done = new Set<string>();
  constructor(names: readonly string[]) {
    this.list = names.map((name) => ({ name, passed: false, tests: [] }));
  }
  has(name: ScorerName): boolean {
    return this.list.some((s) => s.name === name);
  }
  set(name: ScorerName, passed: boolean | null, tests: TestRow[] = []): void {
    const s = this.list.find((x) => x.name === name);
    if (!s) return;
    s.passed = passed;
    s.tests = tests;
    this.done.add(name);
  }
  /** Every scorer not yet decided fails (after a build failure or violation). */
  failRest(): void {
    for (const s of this.list) if (!this.done.has(s.name)) this.set(s.name as ScorerName, false);
  }
  /** Every scorer not yet decided is unscored (infra on every container). */
  nullRest(): void {
    for (const s of this.list) if (!this.done.has(s.name)) this.set(s.name as ScorerName, null);
  }
}

export interface JudgeContext {
  lane: BcLane;
  i: JudgeInput;
  scores: Scores;
  log: VerdictLog;
}

function recordBuild(ctx: JudgeContext, prep: Prepared, label: string): void {
  ctx.log.spans.compile_ms += prep.compile_ms;
  ctx.log.per_app_compiles += prep.per_app_compiles;
  for (const b of prep.built) {
    for (const d of b.diagnostics) {
      ctx.log.diagnostics.push({ app: `${label}/${b.folder}`, code: d.code, message: d.message });
    }
  }
}

/** Publish + test on one held container; spans and retries go to the log. */
export async function runHeld(
  ctx: JudgeContext,
  wanted: WantedApp[],
  tests: TestSpec[],
  cleanupIds: string[],
): Promise<{ rows: TestRow[] }> {
  const held = await ctx.lane.exclusive(
    { taskId: ctx.i.task.task.id, variantId: ctx.i.executionId, attemptNumber: 1 },
    (c) => deployAndTest(ctx.lane.bc, c, { wanted, tests, cleanupIds }),
  );
  const s = ctx.log.spans;
  s.queue_ms += held.queue_ms;
  s.provisioning_ms += held.result.deployed.provisioning_ms;
  s.candidate_publish_ms += held.result.deployed.candidate_publish_ms;
  s.test_ms += held.result.test_ms;
  ctx.log.containers.push(held.container);
  ctx.log.infra_retries.push(...held.retries);
  ctx.log.test_messages.push(...held.result.messages);
  return { rows: held.result.rows };
}

async function buildOracle(ctx: JudgeContext, prep: Prepared): Promise<WantedApp | null> {
  const dir = join(ctx.i.task.dir, "oracle");
  const aj = await readAppJson(join(dir, "app.json"));
  const app: StagedApp = {
    folder: "oracle",
    id: aj.id.toLowerCase(),
    name: aj.name,
    publisher: aj.publisher,
    version: aj.version,
    idRanges: aj.idRanges,
    depends: [],
    external: [],
  };
  const version = stampVersion(aj.version, "candidate", "");
  const [b] = await buildApps(ctx.lane.bc, prep.container, {
    srcDir: ctx.i.task.dir,
    apps: [app],
    versions: new Map([["oracle", version]]),
    outDir: join(ctx.i.workDir, "oracle-build"),
    prebuilt: new Map(prep.wanted.map((w) => [w.id, w.file])),
  });
  ctx.log.spans.compile_ms += b!.compile_ms;
  ctx.log.per_app_compiles++;
  for (const d of b!.diagnostics) {
    ctx.log.diagnostics.push({ app: "oracle", code: d.code, message: d.message });
  }
  if (!b!.ok) return null;
  const workspaceIds = new Set(prep.wanted.map((w) => w.id));
  return {
    id: app.id,
    name: app.name,
    publisher: app.publisher,
    version,
    file: b!.file!,
    role: "candidate",
    depends: aj.dependencies.map((d) => d.id.toLowerCase()).filter((id) => workspaceIds.has(id)),
  };
}

/** feature, bugfix, refactor: build, pass_to_pass, fail_to_pass. */
async function scoreChange(ctx: JudgeContext): Promise<void> {
  const { i, scores, log } = ctx;
  const t = i.task.task;
  const tr = performance.now();
  const vw = await buildVerdictWorkspace({
    pristine: i.pristine,
    artifact: i.artifact,
    out: join(i.workDir, "verdict"),
    symbolIds: i.symbolIds,
  });
  log.spans.reconstruct_ms = performance.now() - tr;
  log.violations = vw.violations;
  if (vw.violations.length > 0) return scores.failRest();

  const prep = await prepareApps(ctx.lane, {
    pristine: i.pristine,
    pristineApps: await readAppGraph(i.pristine),
    candidateDir: vw.dir,
    candidateApps: vw.apps,
    changed: vw.changed,
    workDir: join(i.workDir, "apps"),
    cacheDir: i.cacheDir,
  });
  recordBuild(ctx, prep, "candidate");
  if (!prep.buildOk) return scores.failRest();
  scores.set("build", true);

  const p2p: TestSpec[] = [];
  if (scores.has("pass_to_pass")) {
    for (const r of t.pass_to_pass) {
      p2p.push({ codeunit: r.codeunit, procedures: r.procedures, target: "candidate", zeroIsInfra: true });
    }
    for (const a of await addedTestCodeunits(join(i.pristine, TEST_APP), join(vw.dir, TEST_APP))) {
      if (a.testPage) {
        log.notes.push(`agent test codeunit ${a.codeunit} uses TestPage: not runnable on the SOAP runner, not scored`);
        continue;
      }
      p2p.push({ codeunit: a.codeunit, procedures: null, target: "candidate", zeroIsInfra: false });
    }
  }
  const wanted = [...prep.wanted];
  const cleanup = [...prep.candidateIds];
  const f2p: TestSpec[] = [];
  if (t.fail_to_pass) {
    const oracle = await buildOracle(ctx, prep);
    if (oracle === null) {
      scores.set(
        "fail_to_pass",
        false,
        t.fail_to_pass.tests.flatMap((x) =>
          x.procedures.map((p) => ({
            codeunit: x.codeunit, procedure: p, target: "candidate", outcome: "not_run" as const, failure: "compile" as const,
          }))
        ),
      );
    } else {
      wanted.push(oracle);
      cleanup.push(oracle.id);
      for (const x of t.fail_to_pass.tests) {
        f2p.push({ codeunit: x.codeunit, procedures: x.procedures, target: "candidate", zeroIsInfra: true });
      }
    }
  }
  if (p2p.length + f2p.length === 0) return scores.failRest();
  const { rows } = await runHeld(ctx, wanted, [...p2p, ...f2p], [...cleanup].reverse());
  const oracleUnits = new Set(f2p.map((s) => s.codeunit));
  if (scores.has("pass_to_pass")) {
    const r = rows.filter((x) => !oracleUnits.has(x.codeunit));
    scores.set("pass_to_pass", scorerPassed(r), r);
  }
  if (f2p.length > 0) {
    const r = rows.filter((x) => oracleUnits.has(x.codeunit));
    scores.set("fail_to_pass", scorerPassed(r), r);
  }
  scores.failRest();
}

/** Implemented in M1-18; until then a test-authoring task is refused loudly. */
export async function scoreTestAuthoring(_ctx: JudgeContext): Promise<void> {
  throw new Error("mutant_kill is implemented in M1-18");
}

export async function judge(
  lane: BcLane,
  i: JudgeInput,
  now: () => Date = () => new Date(),
): Promise<{ judgment: JudgmentRecord; log: VerdictLog }> {
  const started_at = now().toISOString();
  const t0 = performance.now();
  const log: VerdictLog = {
    v: 1,
    judgment_id: crypto.randomUUID(),
    execution_id: i.executionId,
    violations: [],
    diagnostics: [],
    test_messages: [],
    notes: [],
    spans: {
      reconstruct_ms: 0, compile_ms: 0, queue_ms: 0, provisioning_ms: 0,
      candidate_publish_ms: 0, test_ms: 0, total_ms: 0,
    },
    containers: [],
    infra_retries: [],
    per_app_compiles: 0,
    error: null,
  };
  const scores = new Scores(i.task.task.scorers);
  const ctx: JudgeContext = { lane, i, scores, log };
  try {
    if (i.task.task.kind === "test-authoring") await scoreTestAuthoring(ctx);
    else await scoreChange(ctx);
  } catch (err) {
    if (!(err instanceof InfraRetriesExhaustedError) && !isInfraError(err)) throw err;
    log.error = err instanceof Error ? err.message : String(err);
    scores.nullRest();
  }
  log.spans.total_ms = performance.now() - t0;
  const list = scores.list;
  const verdict = list.some((s) => s.passed === null)
    ? "unscored"
    : list.every((s) => s.passed)
    ? "pass"
    : "fail";
  const judgment = JudgmentRecordSchema.parse({
    v: 1,
    id: log.judgment_id,
    execution_id: i.executionId,
    workspace_hash: i.workspaceHash,
    task_id: i.task.task.id,
    task_oracle_hash: i.oracleHash,
    scorer_versions: Object.fromEntries(
      i.task.task.scorers.map((n) => [n, SCORER_VERSIONS[n as ScorerName]]),
    ),
    scorers: list,
    verdict,
    verdict_container: log.containers.at(-1) ?? null,
    started_at,
    ended_at: now().toISOString(),
  });
  return { judgment, log };
}

/** Write-once side file results/harness/verdicts/<judgment-id>.json. */
export async function writeVerdictLog(resultsRoot: string, log: VerdictLog): Promise<void> {
  const dir = join(resultsRoot, "verdicts");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, `${log.judgment_id}.json`), JSON.stringify(log, null, 2) + "\n", {
    createNew: true,
  });
}
```

`buildOracle` passes `prebuilt` keyed by app id, not folder: `buildApps` copies every prebuilt file into `.alpackages` and only looks keys up for the app's own `depends`, which is empty for the oracle.

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/verdict.test.ts`
Expected: all 9 tests pass.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/verdict.ts tests/unit/harness/verdict.test.ts
deno lint src/harness/verdict.ts tests/unit/harness/verdict.test.ts
deno fmt src/harness/verdict.ts tests/unit/harness/verdict.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/verdict.ts tests/unit/harness/verdict.test.ts
git commit -m "feat(harness): verdict pipeline with build, pass_to_pass and fail_to_pass scorers"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/verdict.test.ts` passes; check, lint and `deno fmt --check` clean.

---

### Task M1-18: verdict: `mutant_kill` (test-authoring)

Spec 1a section 7 "Test-authoring boundary": only the agent's changes under `Test\` are kept; production code is reset to the reference sources; the agent's tests must build, discover at least one test, pass on the reference-correct code, and fail on every hidden mutant by an assertion failure; a compile error or an infra fault on a mutant is not a kill; mutant 0 is the original buggy state. 1b section 5: `correct/` is the reference solution, `mutants/<name>/` are hidden buggy variants; both mirror the workspace, so they apply as overlays (production paths only). A definite surviving mutant is a fail even if another mutant hit infra; infra with no survivor is unscored.

**Lane:** infra. **Deps:** M1-17.

**Files:**
- Modify: `src/harness/verdict.ts` (replace the `scoreTestAuthoring` stub)
- Modify: `tests/unit/harness/refapp-fixture.ts` (add `addTestAuthoringTask`)
- Test: `tests/unit/harness/verdict-mutant.test.ts`

**Interfaces:**
- Consumes: M1-17's `JudgeContext`, `Scores`, `runHeld`; `applyOverlay` (M1-13); `safeCopyTree` (M1-12).
- Produces: `scoreTestAuthoring(ctx: JudgeContext): Promise<void>` (real); fixture `rental(body)` exported (was module-private); fixture `addTestAuthoringTask(repo: RefappRepo, mutants: Record<string, string>): Promise<string>` (returns the task dir; mutant value = the Rental `Price` body).

- [ ] **Step 1: Write the failing test**

In `tests/unit/harness/refapp-fixture.ts`, export the `rental` helper (`export const rental = ...`) and append:

```typescript
/** HX-002: test-authoring on Rental.Price. Staged = bug (exit(11)), correct = exit(10). */
export async function addTestAuthoringTask(
  repo: RefappRepo,
  mutants: Record<string, string>,
): Promise<string> {
  const t = "harness-tasks/tasks/HX-002";
  await write(
    repo.root,
    `${t}/task.yml`,
    `id: HX-002
refapp_version: refapp-v1
kind: test-authoring
prompt: prompt.md
source: refapp
scorers: [build, mutant_kill]
mutants: [${Object.keys(mutants).join(", ")}]
`,
  );
  await write(repo.root, `${t}/prompt.md`, "Write tests for Rental.Price.");
  await write(repo.root, `${t}/overlay/Rental/src/Rental.Codeunit.al`, rental("exit(11);"));
  await write(repo.root, `${t}/correct/Rental/src/Rental.Codeunit.al`, rental("exit(10);"));
  for (const [name, body] of Object.entries(mutants)) {
    await write(repo.root, `${t}/mutants/${name}/Rental/src/Rental.Codeunit.al`, rental(body));
  }
  return join(repo.root, t);
}
```

`tests/unit/harness/verdict-mutant.test.ts`:

```typescript
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import { freezeWorkspace, safeCopyTree } from "../../../src/harness/fsutil.ts";
import { oracleHash, resolveRefapp } from "../../../src/harness/identity.ts";
import { JudgmentRecordSchema } from "../../../src/harness/records.ts";
import { stageRefappTask } from "../../../src/harness/staging.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { judge } from "../../../src/harness/verdict.ts";
import { deployedSource, FakeBc, result } from "./fake-bc.ts";
import { addTestAuthoringTask, IDS, makeRefappRepo, rental, write } from "./refapp-fixture.ts";

const agentTest = (cu: number) =>
  `codeunit ${cu} "Agent ${cu}"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure PriceIsTen()\n    begin\n    end;\n}\n`;

/**
 * 80050: a good test (passes iff Rental returns 10, else an assertion).
 * 80051: a weak test (always passes). 80052: fails everywhere.
 * 80053: runtime error unless Rental returns 10.
 */
function bc() {
  return new FakeBc((cu, deployed) => {
    const ten = deployedSource(deployed, "CGR Rental").includes("exit(10);");
    if (cu === 80050) return result({ PriceIsTen: ten ? true : "Assert.AreEqual failed. Expected:<10>" });
    if (cu === 80051) return result({ PriceIsTen: true });
    if (cu === 80052) return result({ PriceIsTen: "Assert.IsTrue failed." });
    if (cu === 80053) return result({ PriceIsTen: ten ? true : "Division by zero" });
    return result({});
  });
}

async function setup(
  mutants: Record<string, string>,
  tests: number[],
  edits: Record<string, string> = {},
) {
  const repo = await makeRefappRepo();
  const task = await loadTask(await addTestAuthoringTask(repo, mutants));
  const staged = await stageRefappTask({
    repoRoot: repo.root,
    task,
    refapp: await resolveRefapp(repo.root, "refapp-v1"),
    symbols: repo.symbols,
    symbolStore: repo.symbolStore,
    out: await Deno.makeTempDir(),
  });
  const ws = await Deno.makeTempDir();
  await safeCopyTree(staged.pristine, ws);
  for (const cu of tests) await write(ws, `Test/src/Agent${cu}.Test.al`, agentTest(cu));
  for (const [rel, text] of Object.entries(edits)) await write(ws, rel, text);
  const results = await Deno.makeTempDir();
  const frozen = await freezeWorkspace(results, ws);
  return {
    executionId: crypto.randomUUID(),
    workspaceHash: frozen.workspace_hash,
    task,
    oracleHash: await oracleHash(task),
    pristine: staged.pristine,
    artifact: join(results, frozen.stored_path),
    symbolIds: new Set([IDS.assert]),
    workDir: await Deno.makeTempDir(),
    cacheDir: await Deno.makeTempDir(),
  };
}

Deno.test("mutant_kill: good tests kill mutant 0 and every hidden mutant", async () => {
  const input = await setup({ "off-by-one": "exit(9);" }, [80050]);
  const { judgment } = await judge(new BcLane(bc(), ["C1"]), input);
  JudgmentRecordSchema.parse(judgment);
  assertEquals(judgment.verdict, "pass");
  const mk = judgment.scorers.find((s) => s.name === "mutant_kill")!;
  assertEquals(mk.tests.map((t) => [t.target, t.outcome, t.failure]), [
    ["reference", "pass", null],
    ["mutant:0", "fail", "assertion"],
    ["mutant:off-by-one", "fail", "assertion"],
  ]);
});

Deno.test("mutant_kill: a weak test lets mutants survive", async () => {
  const { judgment } = await judge(new BcLane(bc(), ["C1"]), await setup({ "off-by-one": "exit(9);" }, [80051]));
  assertEquals(judgment.verdict, "fail");
});

Deno.test("mutant_kill: tests that fail on the reference fail, mutants are not run", async () => {
  const fake = bc();
  const { judgment } = await judge(new BcLane(fake, ["C1"]), await setup({ "off-by-one": "exit(9);" }, [80052]));
  assertEquals(judgment.verdict, "fail");
  assertEquals(fake.tests.length, 1);
});

Deno.test("mutant_kill: a mutant that does not compile or a runtime error is not a kill", async () => {
  const broken = await judge(
    new BcLane(bc(), ["C1"]),
    await setup({ broken: "COMPILE_ERROR" }, [80050]),
  );
  assertEquals(broken.judgment.verdict, "fail");
  const crash = await judge(new BcLane(bc(), ["C1"]), await setup({ "off-by-one": "exit(9);" }, [80053]));
  assertEquals(crash.judgment.verdict, "fail");
});

Deno.test("mutant_kill: no agent test is a fail with a note", async () => {
  const { judgment, log } = await judge(new BcLane(bc(), ["C1"]), await setup({ "off-by-one": "exit(9);" }, []));
  assertEquals(judgment.verdict, "fail");
  assertStringIncludes(log.notes.join("\n"), "no agent test");
});

Deno.test("mutant_kill: agent production edits are reset to the reference", async () => {
  // The agent rewrites production to return 12; its test asserts 10. On the
  // reference (10) it must pass, which proves the edit was discarded.
  const input = await setup({ "off-by-one": "exit(9);" }, [80050], {
    "Rental/src/Rental.Codeunit.al": rental("exit(12);"),
  });
  const { judgment } = await judge(new BcLane(bc(), ["C1"]), input);
  assertEquals(judgment.verdict, "pass");
});

Deno.test("mutant_kill: infra everywhere is unscored", async () => {
  const fake = bc();
  fake.broken.add("C1");
  const { judgment } = await judge(new BcLane(fake, ["C1"]), await setup({ "off-by-one": "exit(9);" }, [80050]));
  assertEquals(judgment.verdict, "unscored");
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/verdict-mutant.test.ts`
Expected: FAIL, `mutant_kill is implemented in M1-18`.

- [ ] **Step 3: Implement** (replace the stub in `src/harness/verdict.ts`; add `import { applyOverlay } from "./staging.ts";` and `import { safeCopyTree } from "./fsutil.ts";` and `import { ValidationError } from "../errors.ts";`)

```typescript
const isTestPath = (rel: string) => rel === TEST_APP || rel.startsWith(`${TEST_APP}/`);

/**
 * test-authoring: build, (pass_to_pass on the reference), mutant_kill.
 * Production is the reference (staged + correct/); only the agent's new
 * Test\ files are kept. Mutant 0 = the staged production code.
 */
export async function scoreTestAuthoring(ctx: JudgeContext): Promise<void> {
  const { i, scores, log } = ctx;
  const t = i.task.task;
  if (t.mutants.includes("0")) {
    throw new ValidationError(`${t.id}: mutant name "0" is reserved for the original state`, ["0"]);
  }
  const tr = performance.now();
  const reference = join(i.workDir, "reference");
  await safeCopyTree(i.pristine, reference);
  await applyOverlay(join(i.task.dir, "correct"), reference, { exclude: isTestPath });
  const vw = await buildVerdictWorkspace({
    pristine: i.pristine,
    artifact: i.artifact,
    out: join(i.workDir, "verdict"),
    productionFrom: reference,
    symbolIds: i.symbolIds,
  });
  log.spans.reconstruct_ms = performance.now() - tr;
  log.violations = vw.violations;
  if (vw.violations.length > 0) return scores.failRest();

  const pristineApps = await readAppGraph(i.pristine);
  const prep = await prepareApps(ctx.lane, {
    pristine: i.pristine, pristineApps, candidateDir: vw.dir, candidateApps: vw.apps,
    changed: vw.changed, workDir: join(i.workDir, "apps-reference"), cacheDir: i.cacheDir,
  });
  recordBuild(ctx, prep, "reference");
  if (!prep.buildOk) return scores.failRest();
  scores.set("build", true);

  const agent = [];
  for (const a of await addedTestCodeunits(join(i.pristine, TEST_APP), join(vw.dir, TEST_APP))) {
    if (a.testPage) log.notes.push(`agent test codeunit ${a.codeunit} uses TestPage: not runnable on the SOAP runner, not counted`);
    else agent.push(a);
  }
  const specs = (target: string): TestSpec[] =>
    agent.map((a) => ({ codeunit: a.codeunit, procedures: null, target, zeroIsInfra: false }));
  const p2p: TestSpec[] = scores.has("pass_to_pass")
    ? t.pass_to_pass.map((r) => ({ codeunit: r.codeunit, procedures: r.procedures, target: "reference", zeroIsInfra: true }))
    : [];
  const { rows } = await runHeld(ctx, prep.wanted, [...p2p, ...specs("reference")], [...prep.candidateIds].reverse());
  const p2pUnits = new Set(p2p.map((s) => s.codeunit));
  if (p2p.length > 0) {
    const r = rows.filter((x) => p2pUnits.has(x.codeunit));
    scores.set("pass_to_pass", scorerPassed(r), r);
  }
  const mkRows = rows.filter((x) => !p2pUnits.has(x.codeunit));
  if (agent.length === 0) {
    log.notes.push("mutant_kill: no agent test codeunit discovered");
    scores.set("mutant_kill", false, mkRows);
    return scores.failRest();
  }
  const onReference = scorerPassed(mkRows);
  if (onReference !== true) {
    scores.set("mutant_kill", onReference === null ? null : false, mkRows);
    return scores.failRest();
  }

  let survivors = 0;
  let infra = false;
  const mutants = [{ name: "0", overlay: null as string | null }, ...t.mutants.map((m) => ({
    name: m,
    overlay: join(i.task.dir, "mutants", m),
  }))];
  for (const m of mutants) {
    const target = `mutant:${m.name}`;
    let production = i.pristine;
    if (m.overlay) {
      production = join(i.workDir, `mutant-src-${m.name}`);
      await safeCopyTree(reference, production);
      await applyOverlay(m.overlay, production, { exclude: isTestPath });
    }
    const mv = await buildVerdictWorkspace({
      pristine: i.pristine, artifact: i.artifact, out: join(i.workDir, `mutant-${m.name}`),
      productionFrom: production, symbolIds: i.symbolIds,
    });
    const mp = await prepareApps(ctx.lane, {
      pristine: i.pristine, pristineApps, candidateDir: mv.dir, candidateApps: mv.apps,
      changed: mv.changed, workDir: join(i.workDir, `apps-mutant-${m.name}`), cacheDir: i.cacheDir,
    });
    recordBuild(ctx, mp, target);
    if (!mp.buildOk) {
      // Not a kill: the agent's tests (or the mutant) do not compile.
      mkRows.push(...agent.map((a) => ({
        codeunit: a.codeunit, procedure: "(compile)", target, outcome: "not_run" as const, failure: "compile" as const,
      })));
      survivors++;
      continue;
    }
    const { rows: mr } = await runHeld(ctx, mp.wanted, specs(target), [...mp.candidateIds].reverse());
    mkRows.push(...mr);
    if (mr.some((r) => r.outcome === "fail" && r.failure === "assertion")) continue;
    if (mr.some((r) => r.failure === "infra")) infra = true;
    else survivors++;
  }
  scores.set("mutant_kill", survivors > 0 ? false : infra ? null : true, mkRows);
  scores.failRest();
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/verdict-mutant.test.ts tests/unit/harness/verdict.test.ts`
Expected: all pass.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/verdict.ts tests/unit/harness/refapp-fixture.ts tests/unit/harness/verdict-mutant.test.ts
deno lint src/harness/verdict.ts tests/unit/harness/refapp-fixture.ts tests/unit/harness/verdict-mutant.test.ts
deno fmt src/harness/verdict.ts tests/unit/harness/refapp-fixture.ts tests/unit/harness/verdict-mutant.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/verdict.ts tests/unit/harness/refapp-fixture.ts tests/unit/harness/verdict-mutant.test.ts
git commit -m "feat(harness): mutant_kill scorer for test-authoring tasks"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/verdict-mutant.test.ts tests/unit/harness/verdict.test.ts` passes; check, lint and `deno fmt --check` clean.

---
### Task M1-19: `cg-al` backend and client

Spec 1a section 5 item 4 (`cg-al compile` and `cg-al test` are thin clients; the backend compiles host-side and for `test` publishes all apps and runs tests via SOAP; the token allows only compile, test and symbol lookup on its own workspace; no endpoint lists apps, reads other workspaces or runs the oracle), section 5 telemetry (host call log: per request operation, apps compiled, diagnostics, tests run and failed, spans for queue wait, compile, publish and test, container, units kept apart), D12, section 8 (a BC fault on the agent's own call is returned to the agent as a tool error and marks the execution `infra_exposed`). M0-05 carryover, every item: per-execution short-lived token from a secret file, SHA-256 digests compared in constant time, opaque execution ids mapped to approved roots, canonical path and link refusal, TOCTOU (compile a snapshot, never the live workspace), resource limits (64 KiB body, one request at a time per execution, copy limits), container-facing bind only, 400 on malformed JSON, monotonic spans separating client startup, transport, queue and compile.

The runner and the backend share one process, so the token never crosses an argv: `grant` returns it and the runner writes it into the execution's secrets dir (M1-20, M1-22). The client reads it from `C:\cg-secrets\backend-token`.

**Lane:** infra. **Deps:** M1-12, M1-13, M1-14 (`testCodeunits`), M1-15, M1-16.

**Files:**
- Create: `src/harness/backend.ts`
- Create: `harness/images/base/cg-al.ps1`
- Test: `tests/unit/harness/backend.test.ts`

**Interfaces:**
- Consumes: `BcLane`, `buildApps`, `prepareApps`, `deployAndTest` (M1-16); `stampVersion` (M1-15); `testCodeunits`, `TEST_APP` (M1-14); `readAppGraph`, `StagedApp` (M1-13); `safeCopyTree` (M1-12); `SymbolPackage` (M1-04); `HARNESS_VISIBLE_TEST_RANGE` (M1-11); `dockerContextEnv`.
- Produces: `BACKEND_VERSION = "cg-al-backend@1"` (goes into `RuntimeFacts.backend_version`); `MAX_BODY_BYTES`; `sha256(text): Promise<Uint8Array>`; `timingSafeEqual(a, b): boolean`; `interface BackendGrant { executionId; workspace; pristine; apps: StagedApp[]; symbols: SymbolPackage[]; hostLog: string }`; `interface HostLogLine { v: 1; request; execution; op; status; outcome: "ok" | "failed" | "infra" | "rejected" | "error"; at; spans: Record<string, number>; apps_compiled: string[]; per_app_compiles; diagnostics; tests_run; tests_failed; container: string | null; retries: number; message?: string }`; `interface OpContext { grant; snapshot; apps; requestId; workDir }`; `interface OpResult { body: Record<string, unknown>; log: Partial<HostLogLine> & { outcome: "ok" | "failed" } }`; `interface BackendOps { compile(ctx, apps: string[]); test(ctx, codeunits: number[]) }`; `class Backend { constructor(o: { approvedRoots: string[]; workRoot: string; ops: BackendOps; now?: () => number }); grant(g, ttlMs): Promise<string>; revoke(executionId): void; handle(req: Request): Promise<Response>; serve(hostname, port): { url: string; shutdown(): Promise<void> } }`; `defaultBackendOps(lane: BcLane, cacheDir: string): BackendOps`; `resolveBackendHost(): Promise<string>`; `readHostLog(path): Promise<HostLogLine[]>`.

Client exit codes (the agent sees them as tool errors): 0 ok, 1 compile or test failed, 2 backend or infra error, 3 unauthorized, 64 usage.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/backend.test.ts`:

```typescript
import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError, ContainerError, ValidationError } from "../../../src/errors.ts";
import {
  Backend,
  type BackendOps,
  readHostLog,
  resolveBackendHost,
  timingSafeEqual,
} from "../../../src/harness/backend.ts";
import { exists } from "../../../src/harness/fsutil.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import { createCommandMock } from "../../utils/command-mock.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";

const EXEC = "00000000-0000-4000-8000-00000000e001";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

interface Setup {
  root: string;
  ws: string;
  hostLog: string;
  backend: Backend;
  token: string;
  seen: string[];
  clock: { t: number };
  gate: { wait: Promise<void> | null };
  failWith: { err: Error | null };
}

async function setup(): Promise<Setup> {
  const root = await Deno.makeTempDir();
  const ws = join(root, "work", EXEC, "workspace");
  await write(ws, "Core/app.json", appJson(IDS.core, "CGR Core", [70000, 70099], []));
  await write(ws, "Core/src/C.al", `codeunit 70000 "CGR Core"\n{\n}\n`);
  const seen: string[] = [];
  const gate: Setup["gate"] = { wait: null };
  const failWith: Setup["failWith"] = { err: null };
  const ops: BackendOps = {
    async compile(ctx, apps) {
      seen.push(ctx.snapshot);
      assert(await exists(join(ctx.snapshot, "Core", "src", "C.al")));
      if (gate.wait) await gate.wait;
      if (failWith.err) throw failWith.err;
      return {
        body: { apps: apps.map((a) => ({ app: a, ok: true, diagnostics: [] })) },
        log: { outcome: "ok", apps_compiled: apps, per_app_compiles: apps.length, spans: { compile_ms: 1 } },
      };
    },
    test: () => Promise.resolve({ body: { tests: [] }, log: { outcome: "ok" } }),
  };
  const clock = { t: 1_000 };
  const hostLog = join(root, "host-log.jsonl");
  const backend = new Backend({
    approvedRoots: [join(root, "work")],
    workRoot: join(root, "backend"),
    ops,
    now: () => clock.t,
  });
  const token = await backend.grant({
    executionId: EXEC,
    workspace: ws,
    pristine: ws,
    apps: await readAppGraph(ws),
    symbols: [{ app_id: IDS.assert, name: "Library Assert", publisher: "Microsoft", version: "28.0.0.0", file: "a.app", sha256: "0".repeat(64) }],
    hostLog,
  }, 60_000);
  return { root, ws, hostLog, backend, token, seen, clock, gate, failWith };
}

function req(path: string, token: string | null, body: string, exec = EXEC, method = "POST") {
  const headers: Record<string, string> = { "x-cg-execution": exec, "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request(`http://backend${path}`, { method, headers, ...(method === "POST" ? { body } : {}) });
}

Deno.test("backend: missing, wrong, foreign, expired and revoked tokens are 401", async () => {
  const s = await setup();
  assertEquals((await s.backend.handle(req("/v1/compile", null, "{}"))).status, 401);
  assertEquals((await s.backend.handle(req("/v1/compile", "nope", "{}"))).status, 401);
  assertEquals(
    (await s.backend.handle(req("/v1/compile", s.token, "{}", "00000000-0000-4000-8000-00000000beef"))).status,
    401,
  );
  s.clock.t += 61_000;
  assertEquals((await s.backend.handle(req("/v1/compile", s.token, "{}"))).status, 401);
  s.clock.t -= 61_000;
  s.backend.revoke(EXEC);
  assertEquals((await s.backend.handle(req("/v1/compile", s.token, "{}"))).status, 401);
});

Deno.test("backend: only compile, test and symbols exist", async () => {
  const s = await setup();
  for (const p of ["/v1/oracle", "/v1/apps", "/v1/workspaces", "/v1/compile/../oracle"]) {
    assertEquals((await s.backend.handle(req(p, s.token, "{}"))).status, 404, p);
  }
  assertEquals((await s.backend.handle(req("/v1/compile", s.token, "", EXEC, "GET"))).status, 404);
});

Deno.test("backend: malformed JSON is 400; unknown fields, paths and hidden codeunits are 400", async () => {
  const s = await setup();
  const bad = [
    ["/v1/compile", "{"],
    ["/v1/compile", '{"apps":["Core"],"path":"C:\\\\"}'],
    ["/v1/compile", '{"apps":["..\\\\x"]}'],
    ["/v1/compile", '{"apps":["C:\\\\Windows"]}'],
    ["/v1/compile", '{"apps":["Rental"]}'],
    ["/v1/test", '{"codeunits":[85001]}'],
  ];
  for (const [p, body] of bad) {
    const r = await s.backend.handle(req(p!, s.token, body!));
    assertEquals(r.status, 400, body);
  }
  const lines = await readHostLog(s.hostLog);
  assertEquals(lines.length, bad.length);
  assert(lines.every((l) => l.outcome === "rejected" && l.status === 400));
  assertEquals(s.seen, []);
});

Deno.test("backend: oversized bodies are 413, a second concurrent request is 429", async () => {
  const s = await setup();
  const big = JSON.stringify({ apps: ["Core"], pad: "x".repeat(70_000) });
  assertEquals((await s.backend.handle(req("/v1/compile", s.token, big))).status, 413);
  const d = deferred();
  s.gate.wait = d.promise;
  const first = s.backend.handle(req("/v1/compile", s.token, '{"apps":["Core"]}'));
  await new Promise((r) => setTimeout(r, 20));
  assertEquals((await s.backend.handle(req("/v1/compile", s.token, '{"apps":["Core"]}'))).status, 429);
  d.resolve();
  assertEquals((await first).status, 200);
});

Deno.test("backend: compile runs on a snapshot, logs monotonic spans, cleans up", async () => {
  const s = await setup();
  const r = await s.backend.handle(req("/v1/compile", s.token, '{"apps":["Core"]}'));
  assertEquals(r.status, 200);
  const body = await r.json();
  assertEquals(body.request, "br_1");
  assertEquals(body.ok, true);
  assert(!s.seen[0]!.startsWith(s.ws));
  assert(!await exists(s.seen[0]!));
  const [line] = await readHostLog(s.hostLog);
  assertEquals([line!.request, line!.op, line!.outcome, line!.per_app_compiles], ["br_1", "compile", "ok", 1]);
  for (const k of ["snapshot_ms", "compile_ms", "total_ms"]) assert(line!.spans[k]! >= 0, k);
});

Deno.test("backend: links in the workspace are not followed", async () => {
  const s = await setup();
  const target = await Deno.makeTempDir();
  await Deno.writeTextFile(join(target, "secret.txt"), "host");
  await Deno.symlink(target, join(s.ws, "Core", "hostlink"), {
    type: Deno.build.os === "windows" ? "junction" : "dir",
  });
  const body = await (await s.backend.handle(req("/v1/compile", s.token, '{"apps":["Core"]}'))).json();
  assertEquals(body.ignored_links, ["Core/hostlink"]);
});

Deno.test("backend: an infra fault is a 503 tool error and marks the host log", async () => {
  const s = await setup();
  s.failWith.err = new ContainerError("SOAP timeout", "Cronus28", "test");
  const r = await s.backend.handle(req("/v1/compile", s.token, '{"apps":["Core"]}'));
  assertEquals(r.status, 503);
  assertStringIncludes((await r.json()).infra, "SOAP timeout");
  assertEquals((await readHostLog(s.hostLog))[0]!.outcome, "infra");
});

Deno.test("backend: symbols lists the locked packages", async () => {
  const s = await setup();
  const body = await (await s.backend.handle(req("/v1/symbols", s.token, ""))).json();
  assertEquals(body.packages, [{ name: "Library Assert", publisher: "Microsoft", version: "28.0.0.0" }]);
});

Deno.test("backend: grant refuses roots outside the approved roots and link roots", async () => {
  const s = await setup();
  const outside = await Deno.makeTempDir();
  const g = { executionId: EXEC, pristine: outside, apps: [], symbols: [], hostLog: s.hostLog };
  await assertRejects(() => s.backend.grant({ ...g, workspace: outside }, 1000), ValidationError, "approved roots");
  const link = join(s.root, "work", "link");
  await Deno.symlink(outside, link, { type: Deno.build.os === "windows" ? "junction" : "dir" });
  await assertRejects(() => s.backend.grant({ ...g, workspace: link }, 1000), ValidationError, "plain directory");
});

Deno.test("backend: serve refuses wildcard binds", async () => {
  const s = await setup();
  for (const h of ["0.0.0.0", "::", ""]) {
    assertThrows(() => s.backend.serve(h, 0), ConfigurationError);
  }
});

Deno.test("timingSafeEqual: equal, different, different length", () => {
  const a = new Uint8Array([1, 2, 3]);
  assertEquals(timingSafeEqual(a, new Uint8Array([1, 2, 3])), true);
  assertEquals(timingSafeEqual(a, new Uint8Array([1, 2, 4])), false);
  assertEquals(timingSafeEqual(a, new Uint8Array([1, 2])), false);
});

Deno.test("resolveBackendHost: nat gateway, override, loud failure", async () => {
  const mock = createCommandMock();
  mock.mockCommandOnce({ command: "docker", argsContain: ["network", "inspect", "nat"] }, {
    code: 0, stdout: "172.23.64.1\n", stderr: "",
  });
  mock.mockCommandOnce({ command: "docker", argsContain: ["network", "inspect", "nat"] }, {
    code: 1, stdout: "", stderr: "Error: No such network: nat",
  });
  mock.install();
  try {
    assertEquals(await resolveBackendHost(), "172.23.64.1");
    await assertRejects(() => resolveBackendHost(), ConfigurationError, "nat");
  } finally {
    mock.restore();
  }
  Deno.env.set("CENTRALGAUGE_HARNESS_BACKEND_HOST", "10.0.0.5");
  try {
    assertEquals(await resolveBackendHost(), "10.0.0.5");
  } finally {
    Deno.env.delete("CENTRALGAUGE_HARNESS_BACKEND_HOST");
  }
});

Deno.test({
  name: "cg-al.ps1: round trip with the token from a file; startup and total time reported",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const s = await setup();
    const server = s.backend.serve("127.0.0.1", 0);
    const secrets = await Deno.makeTempDir();
    try {
      const run = async (token: string, ...args: string[]) => {
        await Deno.writeTextFile(join(secrets, "backend-token"), token);
        const out = await new Deno.Command("powershell", {
          args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "harness/images/base/cg-al.ps1", ...args],
          env: { CG_BACKEND_URL: server.url, CG_EXECUTION_ID: EXEC, CG_SECRETS_DIR: secrets },
          stdout: "piped",
          stderr: "piped",
        }).output();
        return { code: out.code, json: JSON.parse(new TextDecoder().decode(out.stdout).trim() || "{}") };
      };
      const ok = await run(s.token, "compile", "Core");
      assertEquals(ok.code, 0);
      assertEquals(ok.json.result.request, "br_1");
      assert(ok.json.client.startup_ms >= 0 && ok.json.client.total_ms >= 0);
      assertEquals((await run("wrong", "compile", "Core")).code, 3);
      assertEquals((await run(s.token, "bogus")).code, 64);
    } finally {
      await server.shutdown();
    }
  },
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/backend.test.ts`
Expected: FAIL, `Module not found ".../src/harness/backend.ts"`.

- [ ] **Step 3: Implement the backend**

`src/harness/backend.ts`:

```typescript
/**
 * cg-al backend (spec 1a section 5 item 4, D5, D12). Hard requirements from
 * H:\cg-coord\decisions\2026-09-25-accept-M0-05.md:
 * - per-execution token (32 random bytes), kept only as a SHA-256 digest and
 *   compared in constant time; expires; revoked when the sandbox exits;
 * - the request names its execution (opaque id); the grant maps it to one
 *   approved, canonical, link-free workspace root;
 * - every compile/test runs on a snapshot copy (TOCTOU), links refused;
 * - 64 KiB bodies, one request at a time per execution, copy limits;
 * - binds a container-facing address only, never a wildcard;
 * - malformed JSON is 400; spans are monotonic (performance.now()).
 * There is no endpoint that lists apps, reads other workspaces or runs the
 * oracle.
 */

import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { join, SEPARATOR } from "@std/path";
import { z } from "zod";
import type { SymbolPackage } from "./identity.ts";
import { HARNESS_VISIBLE_TEST_RANGE } from "../constants.ts";
import { dockerContextEnv } from "../container/docker-context.ts";
import { ConfigurationError, ValidationError } from "../errors.ts";
import { isInfraError } from "../health/is-infra-error.ts";
import { InfraRetriesExhaustedError } from "../parallel/errors.ts";
import { stampVersion } from "./bc-apps.ts";
import { type BcLane, buildApps, deployAndTest, prepareApps } from "./bc-lane.ts";
import { exists, safeCopyTree } from "./fsutil.ts";
import { hashTree, isTaskBuildArtifact } from "./hash.ts";
import { readAppGraph, type StagedApp } from "./staging.ts";
import { TEST_APP, testCodeunits } from "./verdict-workspace.ts";

export const BACKEND_VERSION = "cg-al-backend@1";
export const MAX_BODY_BYTES = 64 * 1024;

export interface BackendGrant {
  executionId: string;
  /** The agent's live workspace (bind-mounted RW into the sandbox). */
  workspace: string;
  /** Staged copy: prerequisite sources and the change baseline. */
  pristine: string;
  apps: StagedApp[];
  symbols: SymbolPackage[];
  /** results/harness/runs/<execution-id>/host-log.jsonl */
  hostLog: string;
}

export interface HostLogLine {
  v: 1;
  request: string;
  execution: string;
  op: string;
  status: number;
  outcome: "ok" | "failed" | "infra" | "rejected" | "error";
  at: string;
  spans: Record<string, number>;
  /** Logical request vs compiler executions are different units (spec 1a section 5). */
  apps_compiled: string[];
  per_app_compiles: number;
  diagnostics: number;
  tests_run: number;
  tests_failed: number;
  container: string | null;
  retries: number;
  message?: string;
}

export interface OpContext {
  grant: BackendGrant;
  snapshot: string;
  apps: StagedApp[];
  requestId: string;
  workDir: string;
}

export interface OpResult {
  body: Record<string, unknown>;
  log: Partial<HostLogLine> & { outcome: "ok" | "failed" };
}

export interface BackendOps {
  compile(ctx: OpContext, apps: string[]): Promise<OpResult>;
  test(ctx: OpContext, codeunits: number[]): Promise<OpResult>;
}

const CompileBody = z.strictObject({
  apps: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9 ]{0,63}$/)).max(32).default([]),
});
const TestBody = z.strictObject({
  codeunits: z.array(
    z.number().int().min(HARNESS_VISIBLE_TEST_RANGE.start).max(HARNESS_VISIBLE_TEST_RANGE.end),
  ).max(64).default([]),
});
const SymbolsBody = z.strictObject({});

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Constant-time compare of two fixed-length digests. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

const NO_DIGEST = new Uint8Array(32);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface GrantState {
  g: BackendGrant;
  digest: Uint8Array;
  expiresAt: number;
  busy: boolean;
  seq: number;
  canonical: string;
}

export class Backend {
  private readonly grants = new Map<string, GrantState>();
  private readonly now: () => number;

  constructor(
    private readonly o: {
      approvedRoots: string[];
      workRoot: string;
      ops: BackendOps;
      now?: () => number;
    },
  ) {
    this.now = o.now ?? (() => Date.now());
  }

  /** Issue a token for one execution's workspace. Returned once, stored as a digest. */
  async grant(g: BackendGrant, ttlMs: number): Promise<string> {
    const st = await Deno.lstat(g.workspace);
    if (st.isSymlink || !st.isDirectory) {
      throw new ValidationError(`grant refused: workspace is not a plain directory: ${g.workspace}`, [g.workspace]);
    }
    const canonical = await Deno.realPath(g.workspace);
    const roots = await Promise.all(this.o.approvedRoots.map((r) => Deno.realPath(r)));
    const lower = canonical.toLowerCase();
    if (!roots.some((r) => lower.startsWith(r.toLowerCase() + SEPARATOR))) {
      throw new ValidationError(`grant refused: ${canonical} is outside the approved roots`, [canonical]);
    }
    const token = encodeHex(crypto.getRandomValues(new Uint8Array(32)));
    this.grants.set(g.executionId, {
      g,
      digest: await sha256(token),
      expiresAt: this.now() + ttlMs,
      busy: false,
      seq: 0,
      canonical,
    });
    return token;
  }

  revoke(executionId: string): void {
    this.grants.delete(executionId);
  }

  private async append(g: BackendGrant, line: HostLogLine): Promise<void> {
    await Deno.mkdir(join(g.hostLog, ".."), { recursive: true });
    await Deno.writeTextFile(g.hostLog, JSON.stringify(line) + "\n", { append: true, create: true });
  }

  private line(st: GrantState, op: string, status: number, outcome: HostLogLine["outcome"], t0: number, extra: Partial<HostLogLine> = {}): HostLogLine {
    return {
      v: 1,
      request: extra.request ?? `br_${st.seq}`,
      execution: st.g.executionId,
      op,
      status,
      outcome,
      at: new Date().toISOString(),
      apps_compiled: [],
      per_app_compiles: 0,
      diagnostics: 0,
      tests_run: 0,
      tests_failed: 0,
      container: null,
      retries: 0,
      ...extra,
      spans: { ...(extra.spans ?? {}), total_ms: performance.now() - t0 },
    };
  }

  private async reject(st: GrantState, op: string, status: number, message: string, t0: number): Promise<Response> {
    await this.append(st.g, this.line(st, op, status, "rejected", t0, { request: `rejected_${st.seq}`, message }));
    return json(status, { error: message });
  }

  async handle(req: Request): Promise<Response> {
    const t0 = performance.now();
    const op = /^\/v1\/(compile|test|symbols)$/.exec(new URL(req.url).pathname)?.[1];
    if (req.method !== "POST" || !op) return json(404, { error: "not found" });
    const st = this.grants.get(req.headers.get("x-cg-execution") ?? "");
    const auth = req.headers.get("authorization") ?? "";
    const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const same = timingSafeEqual(await sha256(presented), st?.digest ?? NO_DIGEST);
    if (!st || presented === "" || !same || this.now() > st.expiresAt) {
      return json(401, { error: "unauthorized" });
    }
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
      return await this.reject(st, op, 413, "body too large", t0);
    }
    const text = await req.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
      return await this.reject(st, op, 413, "body too large", t0);
    }
    let raw: unknown;
    try {
      raw = text.trim() === "" ? {} : JSON.parse(text);
    } catch {
      return await this.reject(st, op, 400, "malformed JSON", t0);
    }
    const schema = op === "compile" ? CompileBody : op === "test" ? TestBody : SymbolsBody;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return await this.reject(st, op, 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), t0);
    }
    const folders = new Set(st.g.apps.map((a) => a.folder));
    const apps = op === "compile" ? (parsed.data as { apps: string[] }).apps : [];
    const unknown = apps.filter((a) => !folders.has(a));
    if (unknown.length > 0) return await this.reject(st, op, 400, `unknown app(s): ${unknown.join(", ")}`, t0);
    if (st.busy) return await this.reject(st, op, 429, "one request at a time per execution", t0);

    st.busy = true;
    const requestId = `br_${++st.seq}`;
    const snapshot = join(this.o.workRoot, st.g.executionId, requestId);
    const workDir = `${snapshot}-work`;
    try {
      if (op === "symbols") {
        await this.append(st.g, this.line(st, op, 200, "ok", t0, { request: requestId }));
        return json(200, {
          request: requestId,
          backend_version: BACKEND_VERSION,
          ok: true,
          packages: st.g.symbols.map((p) => ({ name: p.name, publisher: p.publisher, version: p.version })),
        });
      }
      if (await Deno.realPath(st.g.workspace) !== st.canonical) {
        await this.append(st.g, this.line(st, op, 400, "rejected", t0, { request: requestId, message: "workspace root changed" }));
        return json(400, { error: "workspace root changed" });
      }
      const ts = performance.now();
      const copy = await safeCopyTree(st.g.workspace, snapshot, { skip: isTaskBuildArtifact });
      const snapshot_ms = performance.now() - ts;
      let graph: StagedApp[];
      try {
        graph = await readAppGraph(snapshot);
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err;
        await this.append(st.g, this.line(st, op, 200, "failed", t0, { request: requestId, message: err.message, spans: { snapshot_ms } }));
        return json(200, { request: requestId, ok: false, error: err.message });
      }
      const ctx: OpContext = { grant: st.g, snapshot, apps: graph, requestId, workDir };
      const r = op === "compile"
        ? await this.o.ops.compile(ctx, apps)
        : await this.o.ops.test(ctx, (parsed.data as { codeunits: number[] }).codeunits);
      const line = this.line(st, op, 200, r.log.outcome, t0, {
        ...r.log,
        request: requestId,
        spans: { snapshot_ms, ...(r.log.spans ?? {}) },
      });
      await this.append(st.g, line);
      return json(200, {
        request: requestId,
        backend_version: BACKEND_VERSION,
        ok: r.log.outcome === "ok",
        ...r.body,
        ignored_links: copy.refused,
        backend_ms: line.spans.total_ms,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const infra = err instanceof InfraRetriesExhaustedError || isInfraError(err);
      await this.append(st.g, this.line(st, op, infra ? 503 : 500, infra ? "infra" : "error", t0, { request: requestId, message }));
      if (!infra) console.error(`[FAIL] cg-al backend ${requestId}: ${message}`);
      return json(infra ? 503 : 500, infra ? { request: requestId, infra: message } : { request: requestId, error: message });
    } finally {
      st.busy = false;
      await Deno.remove(snapshot, { recursive: true }).catch(() => {});
      await Deno.remove(workDir, { recursive: true }).catch(() => {});
    }
  }

  /** Listen on a container-facing address. Wildcards are refused (M0-05). */
  serve(hostname: string, port: number): { url: string; shutdown(): Promise<void> } {
    if (["0.0.0.0", "::", "", "*"].includes(hostname)) {
      throw new ConfigurationError(
        `cg-al backend refuses to bind "${hostname}": bind the container-facing address (Docker nat gateway)`,
      );
    }
    const server = Deno.serve({ hostname, port, onListen: () => {} }, (r) => this.handle(r));
    const addr = server.addr as Deno.NetAddr;
    return { url: `http://${addr.hostname}:${addr.port}`, shutdown: () => server.shutdown() };
  }
}

/** Apps plus everything they depend on, in dependency order. */
function withDependencies(apps: StagedApp[], folders: string[]): StagedApp[] {
  const need = new Set(folders);
  for (const a of [...apps].reverse()) if (need.has(a.folder)) a.depends.forEach((d) => need.add(d));
  return apps.filter((a) => need.has(a.folder));
}

/** The real operations over the shared BC lane. */
export function defaultBackendOps(lane: BcLane, cacheDir: string): BackendOps {
  return {
    async compile(ctx, apps) {
      const selected = apps.length === 0 ? ctx.apps : withDependencies(ctx.apps, apps);
      const versions = new Map(ctx.apps.map((a) => [a.folder, stampVersion(a.version, "candidate", "")]));
      const t0 = performance.now();
      const built = await lane.compile((c) =>
        buildApps(lane.bc, c, { srcDir: ctx.snapshot, apps: selected, versions, outDir: ctx.workDir })
      );
      const ok = built.every((b) => b.ok);
      return {
        body: { apps: built.map((b) => ({ app: b.folder, ok: b.ok, diagnostics: b.diagnostics })) },
        log: {
          outcome: ok ? "ok" : "failed",
          apps_compiled: built.filter((b) => b.attempted).map((b) => b.folder),
          per_app_compiles: built.filter((b) => b.attempted).length,
          diagnostics: built.reduce((n, b) => n + b.diagnostics.length, 0),
          spans: { compile_ms: performance.now() - t0 },
        },
      };
    },
    async test(ctx, codeunits) {
      const pristineApps = await readAppGraph(ctx.grant.pristine);
      const changed: string[] = [];
      for (const a of pristineApps) {
        const now = join(ctx.snapshot, a.folder);
        if (
          !await exists(now) ||
          await hashTree(join(ctx.grant.pristine, a.folder), "task") !== await hashTree(now, "task")
        ) changed.push(a.folder);
      }
      const prep = await prepareApps(lane, {
        pristine: ctx.grant.pristine, pristineApps, candidateDir: ctx.snapshot, candidateApps: ctx.apps,
        changed, workDir: ctx.workDir, cacheDir,
      });
      const compiled = prep.built.filter((b) => b.attempted).map((b) => b.folder);
      if (!prep.buildOk) {
        return {
          body: { apps: prep.built.map((b) => ({ app: b.folder, ok: b.ok, diagnostics: b.diagnostics })) },
          log: { outcome: "failed", apps_compiled: compiled, per_app_compiles: prep.per_app_compiles, spans: { compile_ms: prep.compile_ms } },
        };
      }
      const units = codeunits.length > 0
        ? codeunits
        : (await testCodeunits(join(ctx.snapshot, TEST_APP))).filter((t) => !t.testPage).map((t) => t.codeunit);
      const held = await lane.exclusive(
        { taskId: ctx.grant.executionId, variantId: "cg-al", attemptNumber: 1 },
        (c) =>
          deployAndTest(lane.bc, c, {
            wanted: prep.wanted,
            tests: units.map((u) => ({ codeunit: u, procedures: null, target: "candidate", zeroIsInfra: false })),
            cleanupIds: [...prep.candidateIds].reverse(),
          }),
      );
      const rows = held.result.rows;
      const failed = rows.filter((r) => r.outcome !== "pass").length;
      return {
        body: { tests: rows, messages: held.result.messages },
        log: {
          outcome: rows.length > 0 && failed === 0 ? "ok" : "failed",
          apps_compiled: compiled,
          per_app_compiles: prep.per_app_compiles,
          tests_run: rows.length,
          tests_failed: failed,
          container: held.container,
          retries: held.retries.length,
          spans: {
            compile_ms: prep.compile_ms,
            queue_ms: held.queue_ms,
            provisioning_ms: held.result.deployed.provisioning_ms,
            publish_ms: held.result.deployed.candidate_publish_ms,
            test_ms: held.result.test_ms,
          },
        },
      };
    },
  };
}

/** The Docker `nat` gateway: the host address Windows containers reach. */
export async function resolveBackendHost(): Promise<string> {
  const override = Deno.env.get("CENTRALGAUGE_HARNESS_BACKEND_HOST");
  if (override) return override;
  const out = await new Deno.Command("docker", {
    args: ["network", "inspect", "nat", "--format", "{{range .IPAM.Config}}{{.Gateway}}{{end}}"],
    env: dockerContextEnv(),
    stdout: "piped",
    stderr: "piped",
  }).output();
  const ip = new TextDecoder().decode(out.stdout).trim();
  if (!out.success || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    throw new ConfigurationError(
      `cannot resolve the Docker nat gateway: ${new TextDecoder().decode(out.stderr).trim()}; set CENTRALGAUGE_HARNESS_BACKEND_HOST`,
    );
  }
  return ip;
}

export async function readHostLog(path: string): Promise<HostLogLine[]> {
  try {
    return (await Deno.readTextFile(path)).split(/\r?\n/).filter(Boolean)
      .map((l) => JSON.parse(l) as HostLogLine);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
}
```

- [ ] **Step 4: Implement the client**

`harness/images/base/cg-al.ps1`:

```powershell
# cg-al: thin client for the Harness Bench backend (spec 1a section 5 item 4).
# Usage: cg-al compile [App ...] | cg-al test [codeunit ...] | cg-al symbols | cg-al --version
# The token is read from a file (never argv, never env). CG_BACKEND_URL and
# CG_EXECUTION_ID are non-secret env vars set by the runner.
# Exit codes: 0 ok, 1 compile/test failed, 2 backend or infra error, 3 unauthorized, 64 usage.
param(
  [Parameter(Position = 0)][string]$Op,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
$ErrorActionPreference = 'Stop'
$sw = [Diagnostics.Stopwatch]::StartNew()
$startupMs = [int]((Get-Date) - (Get-Process -Id $PID).StartTime).TotalMilliseconds
if ($Op -eq '--version') { Write-Output '{"cg_al":"1"}'; exit 0 }
if ($Op -notin @('compile', 'test', 'symbols')) {
  [Console]::Error.WriteLine('usage: cg-al compile [App ...] | test [codeunit ...] | symbols')
  exit 64
}
$secrets = if ($env:CG_SECRETS_DIR) { $env:CG_SECRETS_DIR } else { 'C:\cg-secrets' }
$token = (Get-Content (Join-Path $secrets 'backend-token') -Raw).Trim()
$Rest = @($Rest | Where-Object { $_ })
$body = switch ($Op) {
  'compile' { @{ apps = @($Rest) } }
  'test' { @{ codeunits = @($Rest | ForEach-Object { [int]$_ }) } }
  default { @{} }
}
$json = ConvertTo-Json -InputObject $body -Compress -Depth 4
$status = 0
$content = ''
try {
  $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$($env:CG_BACKEND_URL)/v1/$Op" `
    -Headers @{ Authorization = "Bearer $token"; 'X-CG-Execution' = $env:CG_EXECUTION_ID } `
    -ContentType 'application/json' -Body $json -TimeoutSec 1800
  $status = [int]$r.StatusCode
  $content = $r.Content
} catch [System.Net.WebException] {
  $resp = $_.Exception.Response
  if ($null -eq $resp) {
    $content = ConvertTo-Json -InputObject @{ error = $_.Exception.Message } -Compress
  } else {
    $status = [int]$resp.StatusCode
    $content = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
  }
}
$result = $content
try { $result = $content | ConvertFrom-Json } catch { }
$out = @{
  op = $Op
  client = @{ startup_ms = $startupMs; total_ms = [int]$sw.ElapsedMilliseconds; status = $status }
  result = $result
}
Write-Output (ConvertTo-Json -InputObject $out -Compress -Depth 12)
if ($status -eq 200 -and $result.ok) { exit 0 }
if ($status -eq 200) { exit 1 }
if ($status -eq 401) { exit 3 }
exit 2
```

Transport time for the report is `client.total_ms - result.backend_ms`; process startup is `client.startup_ms` (M0-05: 891-1229 ms of client overhead).

- [ ] **Step 5: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/backend.test.ts`
Expected: all 13 tests pass (the `cg-al.ps1` test runs on Windows only; it binds 127.0.0.1 on a free port, no container).

- [ ] **Step 6: Check, lint, format**

```bash
deno check src/harness/backend.ts tests/unit/harness/backend.test.ts
deno lint src/harness/backend.ts tests/unit/harness/backend.test.ts
deno fmt src/harness/backend.ts tests/unit/harness/backend.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/harness/backend.ts harness/images/base/cg-al.ps1 tests/unit/harness/backend.test.ts
git commit -m "feat(harness): cg-al backend with scoped digests, snapshots and host call log"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/backend.test.ts` passes on Windows; check, lint and `deno fmt --check` clean. Real sandbox round trip is M1-28.

---

### Task M1-20: sandbox runtime

Spec 1a section 5 items 2-6 (exact mounts; `C:\cg-secrets` read-only, never `-e`, never argv; structured output streams to stdout and is captured continuously so a hard kill still leaves a log; on `timeout_min` the container is stopped and the workspace still judged; revoke, freeze, destroy), section 8 (cleanup in `finally`; the runner creates the container and opens the capture files inside the protected region and checks `docker rm -f`; owned containers `cg-harness-<id>-*` plus a label; startup sweep), M0-03 carryover (a)-(b), secrets accepted-risk ("every captured log is scanned for the exact secret values before it leaves the sandbox"). Findings section 3: `docker kill` at the timeout left a complete last JSON line for both harnesses. Every docker verb goes through `DockerCli`, so unit tests fake it (`CommandMock` cannot `spawn()`).

**Lane:** infra. **Deps:** none from Part 1 (uses `dockerContextEnv`, `buildBindMountArg`, `ContainerError`, `ConfigurationError`).

**Files:**
- Create: `src/harness/sandbox.ts`
- Create: `tests/unit/harness/fake-docker.ts` (M1-21 appends the mock-image behavior)
- Test: `tests/unit/harness/sandbox.test.ts`

**Interfaces:**
- Produces: `SANDBOX_PREFIX = "cg-harness-"`, `OWNER_LABEL`, `EXECUTION_LABEL`; `interface DockerCli { run(args, stdoutPath, stderrPath): Promise<number>; kill(name): Promise<number>; rm(name): Promise<{ code; stderr }>; listOwned(owner): Promise<string[]>; inspectImage(ref): Promise<unknown | null>; build(args): Promise<number> }`; `realDocker(): DockerCli`; `sandboxName(campaignId, executionId): string`; `interface SandboxSpec { name; owner; executionId; image; workspace; taskDir; configDir; secretsDir; extraMounts: { src; dst }[]; env: Record<string, string>; timeoutMs; rawLog; stderrLog }`; `buildRunArgs(s): string[]`; `interface SandboxResult { exitCode: number | null; timedOut: boolean; startError: string | null; cleanup: "ok" | string; wall_ms: number }`; `runSandbox(docker, spec, secretValues: string[]): Promise<SandboxResult>`; `sweepOwnedSandboxes(docker, owner): Promise<string[]>`; `interface SecretValue { name; value }`; `prepareSecrets(source: string, files: readonly string[], backendToken: string): Promise<{ dir: string; values: SecretValue[] }>`; `removeSecrets(dir)`; `redactSecrets(paths: string[], secrets: SecretValue[]): Promise<number>`; (fake) `FakeDocker`, `parseRunArgs(args): RunCall`, `interface RunCall { name; image; mounts: Map<string, { src: string; readonly: boolean }>; env: Map<string, string>; labels: Map<string, string> }`, `type RunBehavior`.

- [ ] **Step 1: Write the fake and the failing test**

`tests/unit/harness/fake-docker.ts`:

```typescript
/** In-memory DockerCli for unit tests. */

import type { DockerCli } from "../../../src/harness/sandbox.ts";

export interface RunCall {
  args: string[];
  name: string;
  image: string;
  /** dst -> { src, readonly } */
  mounts: Map<string, { src: string; readonly: boolean }>;
  env: Map<string, string>;
  labels: Map<string, string>;
}

export function parseRunArgs(args: string[]): RunCall {
  const call: RunCall = { args, name: "", image: args.at(-1)!, mounts: new Map(), env: new Map(), labels: new Map() };
  for (let i = 1; i < args.length - 1; i++) {
    const a = args[i]!;
    const v = args[i + 1]!;
    if (a === "--name") call.name = v;
    else if (a === "--label") call.labels.set(v.split("=")[0]!, v.slice(v.indexOf("=") + 1));
    else if (a === "-e") call.env.set(v.split("=")[0]!, v.slice(v.indexOf("=") + 1));
    else if (a === "--mount") {
      const parts = Object.fromEntries(v.split(",").map((p) => p.includes("=") ? p.split("=") : [p, "true"]));
      call.mounts.set(parts.dst, { src: parts.src, readonly: parts.readonly === "true" });
    } else continue;
    i++;
  }
  return call;
}

export interface RunIO {
  stdout(line: string): Promise<void>;
  /** Resolves when `docker kill` is called for this container. */
  killed: Promise<void>;
}
export type RunBehavior = (call: RunCall, io: RunIO) => Promise<number>;

export class FakeDocker implements DockerCli {
  runs: RunCall[] = [];
  kills: string[] = [];
  removed: string[] = [];
  builds: string[][] = [];
  owned: string[] = [];
  images = new Map<string, unknown>();
  rmFails = new Set<string>();
  behavior: RunBehavior = () => Promise.resolve(0);
  runError: Error | null = null;
  private killers = new Map<string, () => void>();

  async run(args: string[], stdoutPath: string, stderrPath: string): Promise<number> {
    if (this.runError) throw this.runError;
    const out = await Deno.open(stdoutPath, { write: true, createNew: true });
    await Deno.writeTextFile(stderrPath, "", { createNew: true });
    const call = parseRunArgs(args);
    this.runs.push(call);
    const killed = new Promise<void>((r) => this.killers.set(call.name, r));
    try {
      return await this.behavior(call, {
        stdout: async (line) => {
          await out.write(new TextEncoder().encode(line + "\n"));
        },
        killed,
      });
    } finally {
      out.close();
    }
  }
  kill(name: string): Promise<number> {
    this.kills.push(name);
    this.killers.get(name)?.();
    return Promise.resolve(0);
  }
  rm(name: string): Promise<{ code: number; stderr: string }> {
    this.removed.push(name);
    if (this.rmFails.has(name)) return Promise.resolve({ code: 1, stderr: "Error: device busy" });
    if (!this.runs.some((r) => r.name === name) && !this.owned.includes(name)) {
      return Promise.resolve({ code: 1, stderr: `Error response from daemon: No such container: ${name}` });
    }
    return Promise.resolve({ code: 0, stderr: "" });
  }
  listOwned(_owner: string): Promise<string[]> {
    return Promise.resolve([...this.owned]);
  }
  inspectImage(ref: string): Promise<unknown | null> {
    return Promise.resolve(this.images.get(ref) ?? null);
  }
  build(args: string[]): Promise<number> {
    this.builds.push(args);
    return Promise.resolve(0);
  }
}
```

`tests/unit/harness/sandbox.test.ts`:

```typescript
import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError, ContainerError } from "../../../src/errors.ts";
import { exists } from "../../../src/harness/fsutil.ts";
import {
  buildRunArgs,
  EXECUTION_LABEL,
  OWNER_LABEL,
  prepareSecrets,
  redactSecrets,
  runSandbox,
  sandboxName,
  type SandboxSpec,
  sweepOwnedSandboxes,
} from "../../../src/harness/sandbox.ts";
import { FakeDocker, parseRunArgs } from "./fake-docker.ts";

async function spec(over: Partial<SandboxSpec> = {}): Promise<SandboxSpec> {
  const run = await Deno.makeTempDir();
  return {
    name: sandboxName("11111111-2222-4333-8444-555555555555", "aaaaaaaa-0000-4000-8000-000000000001"),
    owner: "HOST1",
    executionId: "aaaaaaaa-0000-4000-8000-000000000001",
    image: "centralgauge/harness-mock:1",
    workspace: "C:\\h\\work space\\ws",
    taskDir: "C:\\h\\task",
    configDir: "C:\\h\\config",
    secretsDir: "C:\\h\\secrets",
    extraMounts: [{ src: "C:\\h\\solution", dst: "C:\\mock\\solution" }],
    env: { CG_EXECUTION_ID: "aaaaaaaa-0000-4000-8000-000000000001", CG_BACKEND_URL: "http://172.23.64.1:3210" },
    timeoutMs: 60_000,
    rawLog: join(run, "raw.jsonl"),
    stderrLog: join(run, "stderr.txt"),
    ...over,
  };
}

Deno.test("buildRunArgs: owned name and labels, exact mounts, read-only inputs, image last", async () => {
  const s = await spec();
  assertEquals(s.name, "cg-harness-11111111-aaaaaaaa");
  const call = parseRunArgs(buildRunArgs(s));
  assertEquals(call.name, s.name);
  assertEquals(call.labels.get(OWNER_LABEL), "HOST1");
  assertEquals(call.labels.get(EXECUTION_LABEL), s.executionId);
  assertEquals([...call.mounts.entries()].map(([dst, m]) => [dst, m.readonly]), [
    ["C:\\workspace", false],
    ["C:\\task", true],
    ["C:\\config", true],
    ["C:\\cg-secrets", true],
    ["C:\\mock\\solution", true],
  ]);
  assertEquals(call.mounts.get("C:\\workspace")!.src, "C:\\h\\work space\\ws");
  assertEquals(call.image, "centralgauge/harness-mock:1");
  assertThrows(() => buildRunArgs({ ...s, workspace: "C:\\a,b" }), Error, "commas");
});

Deno.test("runSandbox: a secret in argv or env is refused before docker run", async () => {
  const docker = new FakeDocker();
  const s = await spec({ env: { CG_BACKEND_URL: "http://x", LEAK: "sk-live-0123456789" } });
  await assertRejects(() => runSandbox(docker, s, ["sk-live-0123456789"]), ConfigurationError, "secret");
  const s2 = await spec({ workspace: "C:\\sk-live-0123456789" });
  await assertRejects(() => runSandbox(docker, s2, ["sk-live-0123456789"]), ConfigurationError);
  assertEquals(docker.runs, []);
});

Deno.test("runSandbox: timeout kills, the log holds every complete line, rm runs", async () => {
  const docker = new FakeDocker();
  docker.behavior = async (_call, io) => {
    await io.stdout('{"type":"a"}');
    await io.stdout('{"type":"b"}');
    await io.killed;
    return 137;
  };
  const s = await spec({ timeoutMs: 30 });
  const r = await runSandbox(docker, s, []);
  assertEquals(r.timedOut, true);
  assertEquals(r.exitCode, 137);
  assertEquals(docker.kills, [s.name]);
  assertEquals(docker.removed, [s.name]);
  assertEquals(r.cleanup, "ok");
  assertEquals((await Deno.readTextFile(s.rawLog)).trim().split("\n").map((l) => JSON.parse(l).type), ["a", "b"]);
});

Deno.test("runSandbox: a run that fails to start still removes and reports", async () => {
  const docker = new FakeDocker();
  docker.runError = new Error("open raw.jsonl: access denied");
  const s = await spec();
  const r = await runSandbox(docker, s, []);
  assertStringIncludes(r.startError!, "access denied");
  assertEquals(docker.removed, [s.name]);
  assertEquals(r.cleanup, "ok");
});

Deno.test("runSandbox: rm failure is reported, a missing container is fine", async () => {
  const docker = new FakeDocker();
  const s = await spec();
  docker.rmFails.add(s.name);
  const r = await runSandbox(docker, s, []);
  assertStringIncludes(r.cleanup, "docker rm -f");
});

Deno.test("sweep removes only owned containers and fails loudly when one survives", async () => {
  const docker = new FakeDocker();
  docker.owned = ["cg-harness-aaaaaaaa-11111111", "cg-harness-bbbbbbbb-22222222"];
  assertEquals(await sweepOwnedSandboxes(docker, "HOST1"), docker.owned);
  docker.rmFails.add("cg-harness-bbbbbbbb-22222222");
  await assertRejects(() => sweepOwnedSandboxes(docker, "HOST1"), ContainerError, "bbbbbbbb");
});

Deno.test("prepareSecrets: only declared files plus the token; missing is loud and leaves nothing", async () => {
  const src = await Deno.makeTempDir();
  await Deno.writeTextFile(join(src, "claude-oauth-token"), "oauth-123456789\n");
  await Deno.writeTextFile(join(src, "openrouter-api-key"), "not-declared-123456");
  const s = await prepareSecrets(src, ["claude-oauth-token"], "tok-abcdef123456");
  const names = [...Deno.readDirSync(s.dir)].map((e) => e.name).sort();
  assertEquals(names, ["backend-token", "claude-oauth-token"]);
  assertEquals(s.values.map((v) => v.value), ["oauth-123456789", "tok-abcdef123456"]);
  await assertRejects(() => prepareSecrets(src, ["missing"], "t"), ConfigurationError, "missing");
  await assertRejects(() => prepareSecrets(src, ["..\\x"], "t"), ConfigurationError);
});

Deno.test("redaction replaces every occurrence and ignores short values", async () => {
  const dir = await Deno.makeTempDir();
  const p = join(dir, "raw.jsonl");
  await Deno.writeTextFile(p, "a oauth-123456789 b oauth-123456789 short\n");
  const n = await redactSecrets([p, join(dir, "missing.txt")], [
    { name: "claude-oauth-token", value: "oauth-123456789" },
    { name: "tiny", value: "short" },
  ]);
  assertEquals(n, 2);
  assertEquals(await Deno.readTextFile(p), "a [REDACTED:claude-oauth-token] b [REDACTED:claude-oauth-token] short\n");
  assert(await exists(p));
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/sandbox.test.ts`
Expected: FAIL, `Module not found ".../src/harness/sandbox.ts"`.

- [ ] **Step 3: Implement**

`src/harness/sandbox.ts`:

```typescript
/**
 * Sandbox runtime (spec 1a sections 5 and 8; M0-03 carryover a-b; secrets
 * accepted-risk decision 2026-09-25). One `docker run` of the harness image's
 * own entrypoint per execution, stdout/stderr piped straight to files so a
 * hard kill still leaves every complete line (findings section 3).
 */

import { join } from "@std/path";
import { dockerContextEnv } from "../container/docker-context.ts";
import { ConfigurationError, ContainerError } from "../errors.ts";
import { buildBindMountArg } from "../sandbox/windows-provider.ts";

export const SANDBOX_PREFIX = "cg-harness-";
export const OWNER_LABEL = "centralgauge.harness.owner";
export const EXECUTION_LABEL = "centralgauge.harness.execution";

/** The docker verbs the harness uses. Unit tests pass a fake. */
export interface DockerCli {
  /** `docker run` (foreground); stdout/stderr go to the two files. Returns the exit code. */
  run(args: string[], stdoutPath: string, stderrPath: string): Promise<number>;
  kill(name: string): Promise<number>;
  rm(name: string): Promise<{ code: number; stderr: string }>;
  /** Names of `cg-harness-*` containers carrying this owner label. */
  listOwned(owner: string): Promise<string[]>;
  /** `docker image inspect` object, or null when the image does not exist. */
  inspectImage(ref: string): Promise<unknown | null>;
  /** `docker build`, output inherited. Returns the exit code. */
  build(args: string[]): Promise<number>;
}

export function realDocker(): DockerCli {
  const env = dockerContextEnv();
  const dec = new TextDecoder();
  const out = async (args: string[]) => {
    const r = await new Deno.Command("docker", { args, env, stdout: "piped", stderr: "piped" }).output();
    return { code: r.code, stdout: dec.decode(r.stdout), stderr: dec.decode(r.stderr) };
  };
  return {
    async run(args, stdoutPath, stderrPath) {
      const o = await Deno.open(stdoutPath, { write: true, createNew: true });
      let e: Deno.FsFile | null = null;
      try {
        e = await Deno.open(stderrPath, { write: true, createNew: true });
        const child = new Deno.Command("docker", {
          args, env, stdin: "null", stdout: "piped", stderr: "piped",
        }).spawn();
        await Promise.all([child.stdout.pipeTo(o.writable), child.stderr.pipeTo(e.writable)]);
        return (await child.status).code;
      } catch (err) {
        try { o.close(); } catch { /* closed by pipeTo */ }
        try { e?.close(); } catch { /* closed by pipeTo */ }
        throw err;
      }
    },
    kill: async (name) => (await out(["kill", name])).code,
    rm: async (name) => {
      const r = await out(["rm", "-f", name]);
      return { code: r.code, stderr: r.stderr };
    },
    listOwned: async (owner) => {
      const r = await out(["ps", "-a", "--filter", `label=${OWNER_LABEL}=${owner}`, "--format", "{{.Names}}"]);
      if (r.code !== 0) throw new ContainerError(`docker ps failed: ${r.stderr.trim()}`, "docker", "setup");
      return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter((n) => n.startsWith(SANDBOX_PREFIX));
    },
    inspectImage: async (ref) => {
      const r = await out(["image", "inspect", ref]);
      return r.code === 0 ? (JSON.parse(r.stdout) as unknown[])[0] ?? null : null;
    },
    build: async (args) =>
      (await new Deno.Command("docker", { args, env, stdout: "inherit", stderr: "inherit" }).output()).code,
  };
}

/** `cg-harness-<campaign8>-<execution8>` (spec 1a section 8 naming). */
export function sandboxName(campaignId: string, executionId: string): string {
  return `${SANDBOX_PREFIX}${campaignId.slice(0, 8)}-${executionId.slice(0, 8)}`;
}

export interface SandboxSpec {
  name: string;
  owner: string;
  executionId: string;
  image: string;
  workspace: string;
  taskDir: string;
  configDir: string;
  secretsDir: string;
  extraMounts: { src: string; dst: string }[];
  /** Non-secret env only (backend URL, execution id). */
  env: Record<string, string>;
  timeoutMs: number;
  rawLog: string;
  stderrLog: string;
}

export function buildRunArgs(s: SandboxSpec): string[] {
  const m = (src: string, dst: string, ro: boolean) => ["--mount", buildBindMountArg(src, dst, ro)];
  return [
    "run",
    "--name", s.name,
    "--label", `${OWNER_LABEL}=${s.owner}`,
    "--label", `${EXECUTION_LABEL}=${s.executionId}`,
    ...m(s.workspace, "C:\\workspace", false),
    ...m(s.taskDir, "C:\\task", true),
    ...m(s.configDir, "C:\\config", true),
    ...m(s.secretsDir, "C:\\cg-secrets", true),
    ...s.extraMounts.flatMap((x) => m(x.src, x.dst, true)),
    ...Object.entries(s.env).sort(([a], [b]) => a.localeCompare(b)).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    s.image,
  ];
}

export interface SandboxResult {
  exitCode: number | null;
  timedOut: boolean;
  /** The container never ran (docker/file error). */
  startError: string | null;
  cleanup: "ok" | string;
  wall_ms: number;
}

export async function runSandbox(
  docker: DockerCli,
  spec: SandboxSpec,
  secretValues: string[],
): Promise<SandboxResult> {
  const args = buildRunArgs(spec);
  const leaked = secretValues.filter((v) => v.length > 0 && args.some((a) => a.includes(v)));
  if (leaked.length > 0) {
    throw new ConfigurationError(`refusing docker run: a secret value appears in argv or env (${spec.name})`);
  }
  const t0 = performance.now();
  let exitCode: number | null = null;
  let startError: string | null = null;
  let timedOut = false;
  let cleanup = "ok";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Create + capture happen inside the protected region (M0-03 b).
    timer = setTimeout(() => {
      timedOut = true;
      docker.kill(spec.name).catch(() => {});
    }, spec.timeoutMs);
    exitCode = await docker.run(args, spec.rawLog, spec.stderrLog);
  } catch (err) {
    startError = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
    const rm = await docker.rm(spec.name).catch((e) => ({ code: -1, stderr: String(e) }));
    if (rm.code !== 0 && !/no such container/i.test(rm.stderr)) {
      cleanup = `docker rm -f ${spec.name} exited ${rm.code}: ${rm.stderr.trim()}`;
    }
  }
  return { exitCode, timedOut, startError, cleanup, wall_ms: performance.now() - t0 };
}

/** Remove leftover sandboxes this host owns; refuse to continue if one survives. */
export async function sweepOwnedSandboxes(docker: DockerCli, owner: string): Promise<string[]> {
  const names = await docker.listOwned(owner);
  const failed: string[] = [];
  for (const n of names) {
    const r = await docker.rm(n);
    if (r.code !== 0 && !/no such container/i.test(r.stderr)) failed.push(`${n}: ${r.stderr.trim()}`);
  }
  if (failed.length > 0) {
    throw new ContainerError(`could not remove leftover sandboxes: ${failed.join("; ")}`, failed[0]!.split(":")[0]!, "setup");
  }
  return names;
}

export interface SecretValue {
  name: string;
  value: string;
}

/**
 * Per-execution read-only secrets dir: exactly the adapter's declared files
 * from the operator's secret source, plus the backend token. Deleted after
 * the run (removeSecrets).
 */
export async function prepareSecrets(
  source: string,
  files: readonly string[],
  backendToken: string,
): Promise<{ dir: string; values: SecretValue[] }> {
  const dir = await Deno.makeTempDir({ prefix: "cg-harness-secrets-" });
  try {
    const values: SecretValue[] = [];
    for (const f of files) {
      if (!/^[A-Za-z0-9._-]+$/.test(f) || f.startsWith(".")) {
        throw new ConfigurationError(`bad secret file name: ${f}`);
      }
      let v: string;
      try {
        v = await Deno.readTextFile(join(source, f));
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          throw new ConfigurationError(`harness secret ${f} not found in ${source}`);
        }
        throw err;
      }
      await Deno.writeTextFile(join(dir, f), v);
      values.push({ name: f, value: v.trim() });
    }
    await Deno.writeTextFile(join(dir, "backend-token"), backendToken);
    values.push({ name: "backend-token", value: backendToken });
    return { dir, values };
  } catch (err) {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
    throw err;
  }
}

export async function removeSecrets(dir: string): Promise<void> {
  await Deno.remove(dir, { recursive: true }).catch(() => {});
}

/** Replace exact secret values (8+ chars) in kept logs. Returns the count. */
export async function redactSecrets(paths: string[], secrets: SecretValue[]): Promise<number> {
  let count = 0;
  const usable = secrets.filter((s) => s.value.length >= 8);
  for (const p of paths) {
    let text: string;
    try {
      text = await Deno.readTextFile(p);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) continue;
      throw err;
    }
    let next = text;
    for (const s of usable) {
      count += next.split(s.value).length - 1;
      next = next.replaceAll(s.value, `[REDACTED:${s.name}]`);
    }
    if (next !== text) await Deno.writeTextFile(p, next);
  }
  return count;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/sandbox.test.ts`
Expected: all 8 tests pass.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/sandbox.ts tests/unit/harness/fake-docker.ts tests/unit/harness/sandbox.test.ts
deno lint src/harness/sandbox.ts tests/unit/harness/fake-docker.ts tests/unit/harness/sandbox.test.ts
deno fmt src/harness/sandbox.ts tests/unit/harness/fake-docker.ts tests/unit/harness/sandbox.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/sandbox.ts tests/unit/harness/fake-docker.ts tests/unit/harness/sandbox.test.ts
git commit -m "feat(harness): sandbox runtime with owned containers, checked cleanup and secret hygiene"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/sandbox.test.ts` passes; check, lint and `deno fmt --check` clean. Real docker behavior is M1-29.

---
### Task M1-21: adapter contract, mock harness and images

Spec 1a D9 (harness-specific logic lives in its image and entrypoint, not the orchestrator), section 4 (`harness_version` must match the image label, else refuse; the manifest records image digest and the observed harness version and loaded components; a requested component that did not load or a version mismatch is `setup_failed`), section 5 metrics contract (each adapter declares the fields it supplies; a declared field that is missing marks the execution `incomplete_telemetry`), section 11 (a `mock` harness image whose `run.ps1` applies a scripted patch: correct, naive, crash, timeout; hostile variants), section 3 layout (`harness/images/base/`: Node, Git, `cg-al` client). Findings section 3: node 22.19.0. Part 1 contract: `RuntimeFacts = { native_settings, image: { digest, base_digest }, backend_version, servers, provider_routes }`.

The mock arm has no model. Part 1's config schema requires at least one model and a catalog check; this task relaxes both for `harness: mock` only (open question 8 asks the Part 1 owner to confirm).

The mock chooses its scripted change from `settings.solution`: `correct` (the task's `correct/`), `naive` (the first `naive/<variant>` by name), `naive/<variant>`, or `fixture:tests/fixtures/harness/...`. The runner mounts that folder read-only at `C:\mock\solution` (the mock is a trusted operator tool, so reading hidden solutions is fine). Modes: `none`, `apply`, `cg-al` (apply, then `cg-al compile` and `cg-al test`), `crash`, `crash-after-work`, `sleep`, `usage-limit`, and the hostile modes `hostile-edit-tests`, `hostile-app`, `hostile-junction`, `hostile-app-id`, `hostile-probe-backend`.

**Lane:** infra. **Deps:** M1-03 (`config.ts`), M1-05 (`RuntimeFacts`), M1-07 (`Telemetry`, `ExecutionRecord`), M1-08 (`Termination`), M1-19 (`BACKEND_VERSION`), M1-20 (`DockerCli`, `fake-docker.ts`).

**Files:**
- Create: `src/harness/adapter.ts`, `src/harness/adapters/mock.ts`, `src/harness/images.ts`
- Create: `harness/images/base/Dockerfile.windows`, `harness/images/mock/Dockerfile.windows`, `harness/images/mock/run.ps1`
- Create: `harness/configs/mock-{correct,naive,cgal,crash,crash-after-work,sleep,usage,hostile-edit-tests,hostile-app,hostile-junction,hostile-app-id,hostile-probe-backend,leave-state,detect-state}.yml`, `harness/experiments/mock-contract.yml`
- Create: `tests/fixtures/harness/hostile/leave-state/Test/src/HostileLeaveState.Test.al`, `tests/fixtures/harness/hostile/detect-state/Test/src/HostileDetectState.Test.al`
- Modify: `src/harness/config.ts` (mock needs no models; catalog check skips mock); `tests/unit/harness/config.test.ts` (one test)
- Modify: `tests/unit/harness/fake-docker.ts` (append `mockImageBehavior`)
- Test: `tests/unit/harness/adapter.test.ts`, `tests/unit/harness/images.test.ts`

**Interfaces:**
- Produces (adapter.ts): `interface ParsedRun { telemetry: Telemetry; observed: ExecutionRecord["observed"]; didWork: boolean; termination: Termination | null; usageResetAt: string | null; imageSupport: boolean | null }`; `interface MountSpec { src; dst }`; `interface HarnessAdapter { harness; declared: readonly (keyof Telemetry)[]; secretFiles: readonly string[]; nativeSettings(requested): Record<string, unknown>; providerRoutes(models): Record<string, string>; extraMounts(settings, taskSourceDir, repoRoot): Promise<MountSpec[]>; parse(rawLog, exitCode): Promise<ParsedRun> }`; `ADAPTERS`; `adapterFor(harness): HarnessAdapter`; `incompleteTelemetry(declared, t): string[]`; `requestedComponents(m: ResolvedManifest): string[]` (names `instructions`, `skills`, `agents`, `hooks`, `plugin:<path>`, `mcp:<name>`, `lsp:<name>`, `toolchain:<id>`; M2/M3 adapters report `loaded_components` with the same names); `observedMismatch(m, observed): string | null`.
- Produces (images.ts): `BASE_IMAGE`, `HARNESS_LABEL`, `VERSION_LABEL`, `BASE_DIGEST_LABEL`; `imageTag(harness, version)`; `buildImageArgs(harnessRoot, harness, opts?: { version?; baseDigest? }): string[]`; `interface ImageFacts { ref; digest; base_digest; harness; version }`; `imageFacts(docker, ref): Promise<ImageFacts>`; `assertImageMatches(f, config)`; `runtimeFacts(config, facts, adapter): RuntimeFacts`.
- Produces (fake-docker.ts): `mockImageBehavior(): RunBehavior` (mirrors `run.ps1` modes `none`, `apply`, `crash`, `crash-after-work`, `sleep`, `usage-limit`).
- The config dir the runner writes (M1-22) holds `settings.json` = `{ harness, harness_version, models, settings: <native>, limits, mcp, lsp, toolchain }`, `manifest.json` and `bundle/<component>/`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/harness/adapter.test.ts`:

```typescript
import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import {
  adapterFor,
  incompleteTelemetry,
  observedMismatch,
} from "../../../src/harness/adapter.ts";
import { mockAdapter } from "../../../src/harness/adapters/mock.ts";
import { manifest, telemetry } from "./fixtures.ts";

async function log(lines: unknown[]): Promise<string> {
  const p = join(await Deno.makeTempDir(), "raw.jsonl");
  await Deno.writeTextFile(p, lines.map((l) => typeof l === "string" ? l : JSON.stringify(l)).join("\n") + "\n");
  return p;
}

Deno.test("mock parse: a normal run", async () => {
  const p = await log([
    { type: "mock_init", version: "1", loaded: [] },
    "not json from cg-al",
    { type: "mock_action", action: "apply" },
    { type: "mock_done" },
  ]);
  const r = await mockAdapter.parse(p, 0);
  assertEquals(r.telemetry.harness_version, "1");
  assertEquals(r.telemetry.cost_usd, 0);
  assertEquals(r.telemetry.cost_source, "estimated");
  assertEquals(r.didWork, true);
  assertEquals(r.termination, null);
  assertEquals(incompleteTelemetry(mockAdapter.declared, r.telemetry), []);
});

Deno.test("mock parse: a crash before init is incomplete and did no work", async () => {
  const r = await mockAdapter.parse(await log([]), 3);
  assertEquals(r.didWork, false);
  assertEquals(incompleteTelemetry(mockAdapter.declared, r.telemetry), ["harness_version", "cost_usd"]);
});

Deno.test("mock parse: usage limit", async () => {
  const r = await mockAdapter.parse(
    await log([{ type: "mock_init", version: "1", loaded: [] }, { type: "mock_usage_limited", reset_at: "2026-10-05T10:00:00.000Z" }]),
    1,
  );
  assertEquals(r.termination, "usage_limited");
  assertEquals(r.usageResetAt, "2026-10-05T10:00:00.000Z");
});

Deno.test("observedMismatch: version and requested components", () => {
  const m = manifest("x", { skills: { path: "bundles/s", hash: "a".repeat(64), files: [] } });
  assertEquals(observedMismatch(m, { harness_version: null, models: null, loaded_components: null }), null);
  assertStringIncludes(
    observedMismatch(m, { harness_version: "9.9.9", models: null, loaded_components: null })!,
    "9.9.9",
  );
  assertStringIncludes(
    observedMismatch(m, { harness_version: m.harness_version, models: null, loaded_components: [] })!,
    "skills",
  );
  assertEquals(
    observedMismatch(m, { harness_version: m.harness_version, models: null, loaded_components: ["skills"] }),
    null,
  );
});

Deno.test("incompleteTelemetry: declared nulls only", () => {
  const t = telemetry(null);
  assertEquals(incompleteTelemetry(["cost_usd", "exit_code"], t), ["cost_usd"]);
});

Deno.test("mock extraMounts: correct, first naive, named naive, fixtures only under tests/fixtures/harness", async () => {
  const task = await Deno.makeTempDir();
  for (const d of ["correct/Rental", "naive/b/Rental", "naive/a/Rental"]) await Deno.mkdir(join(task, d), { recursive: true });
  const repo = await Deno.makeTempDir();
  const m = (solution: unknown) => mockAdapter.extraMounts({ mode: "apply", solution }, task, repo);
  assertEquals((await m("correct"))[0]!.src, join(task, "correct"));
  assertEquals((await m("naive"))[0]!.src, join(task, "naive", "a"));
  assertEquals((await m("naive/b"))[0]!.dst, "C:\\mock\\solution");
  assertEquals((await m("fixture:tests/fixtures/harness/hostile/leave-state"))[0]!.src,
    join(repo, "tests/fixtures/harness/hostile/leave-state"));
  assertEquals(await mockAdapter.extraMounts({ mode: "crash" }, task, repo), []);
  for (const bad of ["fixture:../../etc", "fixture:C:\\Windows", "fixture:src/harness", "other", 7]) {
    await assertRejects(() => m(bad), ConfigurationError);
  }
});

Deno.test("adapterFor: unknown harness is loud", () => {
  assertEquals(adapterFor("mock"), mockAdapter);
  assertThrows(() => adapterFor("claude-code"), ConfigurationError, "no adapter");
});
```

`tests/unit/harness/images.test.ts`:

```typescript
import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { parse } from "@std/yaml";
import { join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import { mockAdapter } from "../../../src/harness/adapters/mock.ts";
import { BACKEND_VERSION } from "../../../src/harness/backend.ts";
import { HarnessConfigSchema } from "../../../src/harness/config.ts";
import {
  assertImageMatches,
  BASE_IMAGE,
  buildImageArgs,
  imageFacts,
  imageTag,
  runtimeFacts,
} from "../../../src/harness/images.ts";
import { FakeDocker } from "./fake-docker.ts";

const mockImage = (labels: Record<string, string>) => ({ Id: "sha256:mock", Config: { Labels: labels } });
const LABELS = {
  "centralgauge.harness": "mock",
  "centralgauge.harness.version": "1",
  "centralgauge.harness.base_digest": "sha256:base",
};

Deno.test("buildImageArgs: base and harness images carry the identity labels", () => {
  const base = buildImageArgs("harness", "base");
  assertEquals(base.slice(0, 1), ["build"]);
  assert(base.includes(BASE_IMAGE));
  const mock = buildImageArgs("harness", "mock", { version: "1", baseDigest: "sha256:base" });
  assert(mock.includes(imageTag("mock", "1")));
  assert(mock.includes("centralgauge.harness.version=1"));
  assert(mock.includes("centralgauge.harness.base_digest=sha256:base"));
  assertThrows(() => buildImageArgs("harness", "mock"), ConfigurationError, "--version");
});

Deno.test("imageFacts: digest and labels; missing image or labels is loud; label mismatch is refused", async () => {
  const d = new FakeDocker();
  d.images.set("centralgauge/harness-mock:1", mockImage(LABELS));
  d.images.set("centralgauge/harness-mock:2", mockImage({}));
  const f = await imageFacts(d, "centralgauge/harness-mock:1");
  assertEquals([f.digest, f.base_digest, f.harness, f.version], ["sha256:mock", "sha256:base", "mock", "1"]);
  await assertRejects(() => imageFacts(d, "centralgauge/harness-mock:9"), ConfigurationError, "not found");
  await assertRejects(() => imageFacts(d, "centralgauge/harness-mock:2"), ConfigurationError, "labels");
  const config = HarnessConfigSchema.parse({
    id: "mock-a", harness: "mock", harness_version: "2", models: {}, settings: { mode: "apply" },
    limits: { timeout_min: 10, max_budget_usd: 1 },
  });
  assertThrows(() => assertImageMatches(f, config), ConfigurationError, "mock@1");
  const facts = runtimeFacts({ ...config, harness_version: "1" }, f, mockAdapter);
  assertEquals(facts.backend_version, BACKEND_VERSION);
  assertEquals(facts.native_settings, { mode: "apply" });
  assertEquals(facts.provider_routes, {});
});

Deno.test("images: base pins node 22.19.0 and copies no secret; run.ps1 knows every configured mode", async () => {
  const dockerfile = await Deno.readTextFile("harness/images/base/Dockerfile.windows");
  assertStringIncludes(dockerfile, "node-v22.19.0-x64.msi");
  assert(!/cg-secrets\\\\|oauth|api-key/i.test(dockerfile.replace(/C:\\cg-secrets/g, "")));
  const runPs1 = await Deno.readTextFile("harness/images/mock/run.ps1");
  for await (const e of Deno.readDir("harness/configs")) {
    if (!e.name.startsWith("mock-")) continue;
    const cfg = parse(await Deno.readTextFile(join("harness/configs", e.name))) as { settings: { mode: string } };
    assertStringIncludes(runPs1, `'${cfg.settings.mode}'`, e.name);
  }
});
```

Append to `tests/unit/harness/config.test.ts`:

```typescript
Deno.test("config: the mock harness needs no model and skips the catalog; others still do", async () => {
  const root = await harnessRoot({
    "configs/mock-a.yml": `id: mock-a
harness: mock
harness_version: "1"
models: {}
settings: { mode: apply, solution: correct }
limits: { timeout_min: 10, max_budget_usd: 1 }
`,
    "configs/cc-a.yml": CONFIG("cc-a").replace("  main: anthropic/model-a\n", "").replace("models:\n", "models: {}\n"),
  });
  const mock = await loadConfig(root, "mock-a");
  assertEquals(mock.models, {});
  await checkModelsInCatalog([mock], join(root, "no-catalog-here"));
  await assertRejects(() => loadConfig(root, "cc-a"), Error, "model");
});
```

(Add `checkModelsInCatalog` to that file's import list if it is not already imported.)

- [ ] **Step 2: Run them and see them fail**

Run: `deno test --allow-all tests/unit/harness/adapter.test.ts tests/unit/harness/images.test.ts tests/unit/harness/config.test.ts`
Expected: FAIL, `Module not found ".../src/harness/adapter.ts"`, and the new config test fails on `models: {}`.

- [ ] **Step 3: Relax the model rule for mock in `src/harness/config.ts`**

In `HarnessConfigSchema`, remove the `.refine(... "at least one model")` on `models` and add an object-level check (keep whatever else Part 1's schema has):

```typescript
}).superRefine((c, ctx) => {
  // The mock harness (spec 1a section 11) calls no model.
  if (c.harness !== "mock" && Object.keys(c.models).length === 0) {
    ctx.addIssue({ code: "custom", message: "at least one model", path: ["models"] });
  }
});
```

At the top of `checkModelsInCatalog`:

```typescript
  const real = configs.filter((c) => c.harness !== "mock");
  if (real.length === 0) return;
```

and use `real` instead of `configs` in the rest of the function.

- [ ] **Step 4: Implement the adapter contract and the mock adapter**

`src/harness/adapter.ts`:

```typescript
/**
 * Harness adapter contract (D9, spec 1a section 5 metrics contract). The
 * runner knows only this interface; harness specifics live in the image
 * and here. M1 ships mock; M2 adds claude-code; M3 adds pi.
 */

import type { ResolvedManifest } from "./manifest.ts";
import type { Termination } from "./outcome.ts";
import type { ExecutionRecord, Telemetry } from "./records.ts";
import { ConfigurationError } from "../errors.ts";
import { mockAdapter } from "./adapters/mock.ts";

export interface ParsedRun {
  telemetry: Telemetry;
  observed: ExecutionRecord["observed"];
  /** Adapter-visible action (model request, tool call, edit, build). */
  didWork: boolean;
  /** usage_limited, refusal, budget_exhausted; null = decide from the exit code. */
  termination: Termination | null;
  usageResetAt: string | null;
  /** Whether image attachments reached the model; null = unknown. */
  imageSupport: boolean | null;
}

export interface MountSpec {
  src: string;
  dst: string;
}

export interface HarnessAdapter {
  harness: string;
  /** Telemetry fields this harness always supplies (metrics contract). */
  declared: readonly (keyof Telemetry)[];
  /** Operator secret files mounted read-only into C:\cg-secrets. */
  secretFiles: readonly string[];
  /** Native settings exactly as written into C:\config (RuntimeFacts.native_settings). */
  nativeSettings(requested: Record<string, unknown>): Record<string, unknown>;
  /** Provider route per model slot (RuntimeFacts.provider_routes). */
  providerRoutes(models: Record<string, string>): Record<string, string>;
  /** Extra read-only mounts; taskSourceDir is the task's folder in the repo. */
  extraMounts(settings: Record<string, unknown>, taskSourceDir: string, repoRoot: string): Promise<MountSpec[]>;
  parse(rawLog: string, exitCode: number | null): Promise<ParsedRun>;
}

export const ADAPTERS: Record<string, HarnessAdapter> = { mock: mockAdapter };

export function adapterFor(harness: string): HarnessAdapter {
  const a = ADAPTERS[harness];
  if (!a) {
    throw new ConfigurationError(`no adapter for harness ${harness} (known: ${Object.keys(ADAPTERS).join(", ")})`);
  }
  return a;
}

/** Declared fields that came back null or empty. */
export function incompleteTelemetry(declared: readonly (keyof Telemetry)[], t: Telemetry): string[] {
  return declared.filter((k) => {
    const v = t[k];
    return v === null || v === undefined || (Array.isArray(v) && v.length === 0);
  }).map(String);
}

/** Component names an adapter must report as loaded (shared naming for M2/M3). */
export function requestedComponents(m: ResolvedManifest): string[] {
  return [
    ...(["instructions", "skills", "agents", "hooks"] as const).filter((k) => m[k] !== null),
    ...m.plugins.map((p) => `plugin:${p.path}`),
    ...m.mcp.map((s) => `mcp:${s.name}`),
    ...m.lsp.map((s) => `lsp:${s.name}`),
    ...m.toolchain.map((t) => `toolchain:${t}`),
  ];
}

/** Spec 1a section 4: a version mismatch or a requested component that did not load fails setup. */
export function observedMismatch(
  m: ResolvedManifest,
  o: ExecutionRecord["observed"],
): string | null {
  if (o.harness_version !== null && o.harness_version !== m.harness_version) {
    return `harness version ${o.harness_version} ran, ${m.harness_version} was requested`;
  }
  if (o.loaded_components !== null) {
    const missing = requestedComponents(m).filter((c) => !o.loaded_components!.includes(c));
    if (missing.length > 0) return `requested components did not load: ${missing.join(", ")}`;
  }
  return null;
}
```

`src/harness/adapters/mock.ts`:

```typescript
/**
 * Mock harness adapter (spec 1a section 11). Its image applies a scripted
 * solution and prints JSON lines; it calls no model, so its cost is an
 * exact 0 estimate.
 */

import { isAbsolute, join, normalize } from "@std/path";
import { z } from "zod";
import type { HarnessAdapter, MountSpec, ParsedRun } from "../adapter.ts";
import { ConfigurationError } from "../../errors.ts";

const Line = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mock_init"), version: z.string(), loaded: z.array(z.string()).default([]) }),
  z.object({ type: z.literal("mock_action"), action: z.string() }),
  z.object({ type: z.literal("mock_usage_limited"), reset_at: z.string() }),
  z.object({ type: z.literal("mock_done") }),
]);

async function solutionDir(solution: string, taskDir: string, repoRoot: string): Promise<string> {
  if (solution === "correct") return join(taskDir, "correct");
  if (solution === "naive") {
    const names: string[] = [];
    for await (const e of Deno.readDir(join(taskDir, "naive"))) if (e.isDirectory) names.push(e.name);
    if (names.length === 0) throw new ConfigurationError(`${taskDir} has no naive/ variant`);
    return join(taskDir, "naive", names.sort()[0]!);
  }
  if (/^naive\/[A-Za-z0-9_-]+$/.test(solution)) return join(taskDir, ...solution.split("/"));
  if (solution.startsWith("fixture:")) {
    const rel = solution.slice("fixture:".length).replaceAll("\\", "/");
    if (
      isAbsolute(rel) || normalize(rel).replaceAll("\\", "/").split("/").includes("..") ||
      !rel.startsWith("tests/fixtures/harness/")
    ) {
      throw new ConfigurationError(`mock fixture must be under tests/fixtures/harness/: ${rel}`);
    }
    return join(repoRoot, rel);
  }
  throw new ConfigurationError(`unknown mock solution: ${solution}`);
}

export const mockAdapter: HarnessAdapter = {
  harness: "mock",
  declared: ["harness_version", "cost_usd", "exit_code"],
  secretFiles: [],
  nativeSettings: (requested) => ({ ...requested }),
  providerRoutes: () => ({}),
  async extraMounts(settings, taskDir, repoRoot): Promise<MountSpec[]> {
    const s = settings.solution;
    if (s === undefined || s === null) return [];
    if (typeof s !== "string") throw new ConfigurationError("mock settings.solution must be a string");
    return [{ src: await solutionDir(s, taskDir, repoRoot), dst: "C:\\mock\\solution" }];
  },
  async parse(rawLog, exitCode): Promise<ParsedRun> {
    let text = "";
    try {
      text = await Deno.readTextFile(rawLog);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
    let init: { version: string; loaded: string[] } | null = null;
    let didWork = false;
    let resetAt: string | null = null;
    for (const l of text.split(/\r?\n/)) {
      if (!l.trim().startsWith("{")) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(l);
      } catch {
        continue;
      }
      const r = Line.safeParse(raw);
      if (!r.success) continue;
      if (r.data.type === "mock_init") init = r.data;
      else if (r.data.type === "mock_action") didWork = true;
      else if (r.data.type === "mock_usage_limited") resetAt = r.data.reset_at;
    }
    return {
      telemetry: {
        harness_version: init?.version ?? null,
        cost_usd: init ? 0 : null,
        cost_source: init ? "estimated" : null,
        pricing_snapshot: init ? "mock: no model calls" : null,
        reported_cost_usd: null,
        per_model: [],
        turns: null,
        compactions: null,
        wall_ms: null,
        exit_code: exitCode,
        stop_reason: null,
        refusal_detected: null,
        raw_usage: null,
      },
      observed: {
        harness_version: init?.version ?? null,
        models: init ? [] : null,
        loaded_components: init ? init.loaded : null,
      },
      didWork,
      termination: resetAt ? "usage_limited" : null,
      usageResetAt: resetAt,
      imageSupport: false,
    };
  },
};
```

- [ ] **Step 5: Implement `src/harness/images.ts`**

```typescript
/**
 * Harness images (spec 1a sections 3-4): tags, build args with identity
 * labels, and the runtime facts a manifest pins (image digest, base digest,
 * backend version). harness_version must match the image label.
 */

import { join } from "@std/path";
import type { HarnessAdapter } from "./adapter.ts";
import type { HarnessConfig } from "./config.ts";
import type { RuntimeFacts } from "./manifest.ts";
import type { DockerCli } from "./sandbox.ts";
import { ConfigurationError } from "../errors.ts";
import { BACKEND_VERSION } from "./backend.ts";

export const BASE_IMAGE = "centralgauge/harness-base:windows";
export const HARNESS_LABEL = "centralgauge.harness";
export const VERSION_LABEL = "centralgauge.harness.version";
export const BASE_DIGEST_LABEL = "centralgauge.harness.base_digest";

export function imageTag(harness: string, version: string): string {
  return `centralgauge/harness-${harness}:${version}`;
}

export function buildImageArgs(
  harnessRoot: string,
  harness: string,
  opts: { version?: string; baseDigest?: string } = {},
): string[] {
  const dir = join(harnessRoot, "images", harness);
  const file = join(dir, "Dockerfile.windows");
  if (harness === "base") {
    return ["build", "-f", file, "-t", BASE_IMAGE, "--label", "centralgauge.harness.image=base", dir];
  }
  if (!opts.version || !opts.baseDigest) {
    throw new ConfigurationError(`building ${harness} needs --version and a built base image`);
  }
  return [
    "build", "-f", file, "-t", imageTag(harness, opts.version),
    "--build-arg", `BASE=${BASE_IMAGE}`,
    "--label", `${HARNESS_LABEL}=${harness}`,
    "--label", `${VERSION_LABEL}=${opts.version}`,
    "--label", `${BASE_DIGEST_LABEL}=${opts.baseDigest}`,
    dir,
  ];
}

export interface ImageFacts {
  ref: string;
  digest: string;
  base_digest: string;
  harness: string;
  version: string;
}

export async function imageFacts(docker: DockerCli, ref: string): Promise<ImageFacts> {
  const raw = await docker.inspectImage(ref) as
    | { Id?: string; Config?: { Labels?: Record<string, string> | null } }
    | null;
  if (!raw?.Id) throw new ConfigurationError(`image ${ref} not found: run harness images build`);
  const labels = raw.Config?.Labels ?? {};
  const harness = labels[HARNESS_LABEL];
  const version = labels[VERSION_LABEL];
  const base = labels[BASE_DIGEST_LABEL];
  if (!harness || !version || !base) {
    throw new ConfigurationError(`image ${ref} lacks the harness labels (build it with harness images build)`);
  }
  return { ref, digest: raw.Id, base_digest: base, harness, version };
}

/** Spec 1a section 4: harness_version must match the image label, else refuse. */
export function assertImageMatches(f: ImageFacts, c: HarnessConfig): void {
  if (f.harness !== c.harness || f.version !== c.harness_version) {
    throw new ConfigurationError(
      `image ${f.ref} is ${f.harness}@${f.version}; config ${c.id} wants ${c.harness}@${c.harness_version}`,
    );
  }
}

/** MCP/LSP server facts arrive with M3; until then a named server is refused by resolveManifest. */
export function runtimeFacts(c: HarnessConfig, f: ImageFacts, a: HarnessAdapter): RuntimeFacts {
  return {
    native_settings: a.nativeSettings(c.settings),
    image: { digest: f.digest, base_digest: f.base_digest },
    backend_version: BACKEND_VERSION,
    servers: {},
    provider_routes: a.providerRoutes(c.models),
  };
}
```

- [ ] **Step 6: Images, mock script, configs, fixtures**

`harness/images/base/Dockerfile.windows`:

```dockerfile
# Harness Bench base sandbox (spec 1a section 3): Node, Git, cg-al client.
# Node 22.19.0, not 22.12.0: pi-coding-agent 0.87.1 needs >= 22.19.0 (findings section 3).
# No secret is ever copied into a layer; secrets arrive as a read-only mount
# at run time (secrets accepted-risk decision 2026-09-25).
# ponytail: tag-pinned base; digest pinning is open question 13.
FROM mcr.microsoft.com/windows/servercore:ltsc2025
SHELL ["powershell", "-Command", "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue';"]

RUN Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.19.0/node-v22.19.0-x64.msi' -OutFile 'nodejs.msi'; \
    Start-Process msiexec.exe -ArgumentList '/i', 'nodejs.msi', '/quiet', '/norestart' -Wait; \
    Remove-Item -Force nodejs.msi; \
    [Environment]::SetEnvironmentVariable('PATH', 'C:\Program Files\nodejs;' + $env:PATH, [EnvironmentVariableTarget]::Machine)

RUN Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/PortableGit-2.47.1-64-bit.7z.exe' -OutFile 'git-portable.exe'; \
    Start-Process -FilePath '.\git-portable.exe' -ArgumentList '-o', 'C:\Git', '-y' -Wait; \
    Remove-Item -Force git-portable.exe; \
    [Environment]::SetEnvironmentVariable('PATH', 'C:\Git\cmd;C:\Git\bin;C:\Git\usr\bin;' + [Environment]::GetEnvironmentVariable('PATH', 'Machine'), [EnvironmentVariableTarget]::Machine)

RUN New-Item -ItemType Directory -Force -Path C:\workspace, C:\task, C:\config | Out-Null
WORKDIR C:/workspace
COPY cg-al.ps1 C:/cg-al.ps1
RUN Set-Content -Path C:\Windows\System32\cg-al.cmd -Value '@powershell -NoProfile -ExecutionPolicy Bypass -File C:\cg-al.ps1 %*'
```

`harness/images/mock/Dockerfile.windows`:

```dockerfile
# Mock harness (spec 1a section 11). Built by `harness images build mock --version 1`,
# which adds the centralgauge.harness* labels.
ARG BASE=centralgauge/harness-base:windows
FROM ${BASE}
COPY run.ps1 C:/run.ps1
CMD ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\run.ps1"]
```

`harness/images/mock/run.ps1`:

```powershell
# Mock harness (spec 1a section 11): applies a scripted change for contract
# and hostile tests on real containers. Mode and solution come from
# C:\config\settings.json; the solution is mounted at C:\mock\solution.
$ErrorActionPreference = 'Stop'
$cfg = Get-Content 'C:\config\settings.json' -Raw | ConvertFrom-Json
$mode = [string]$cfg.settings.mode
function Emit($o) {
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress -Depth 6))
  [Console]::Out.Flush()
}
function Act($name) { Emit @{ type = 'mock_action'; action = $name } }
function Apply {
  if (Test-Path 'C:\mock\solution') {
    robocopy 'C:\mock\solution' 'C:\workspace' /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }
    $global:LASTEXITCODE = 0
    Act 'apply'
  }
}
function CgAl($op) {
  $out = (& cg-al $op 2>&1 | Out-String).Trim()
  Emit @{ type = 'mock_cg_al'; op = $op; exit_code = $LASTEXITCODE; output = $out }
  Act "cg-al $op"
}
Emit @{ type = 'mock_init'; version = '1'; loaded = @() }
switch ($mode) {
  'none' { }
  'apply' { Apply }
  'cg-al' { Apply; CgAl 'compile'; CgAl 'test' }
  'crash' { exit 3 }
  'crash-after-work' { Apply; exit 3 }
  'sleep' { Apply; Start-Sleep -Seconds 86400 }
  'usage-limit' {
    Emit @{ type = 'mock_usage_limited'; reset_at = (Get-Date).ToUniversalTime().AddMinutes(2).ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
    exit 1
  }
  'hostile-edit-tests' {
    Apply
    Get-ChildItem 'C:\workspace\Test' -Recurse -Filter *.al | ForEach-Object {
      $t = Get-Content $_.FullName -Raw
      $t = [regex]::Replace($t, '(?im)^(\s*begin\s*)$', '$1 exit;')
      Set-Content -Path $_.FullName -Value $t -NoNewline
    }
    Act 'edit shipped tests'
  }
  'hostile-app' {
    Apply
    [IO.File]::WriteAllBytes('C:\workspace\Rental\CentralGauge_CGR Rental_9.9.9.9.app', [byte[]](1..64))
    New-Item -ItemType Directory -Force 'C:\workspace\.alpackages' | Out-Null
    [IO.File]::WriteAllBytes('C:\workspace\.alpackages\Evil_Evil_1.0.0.0.app', [byte[]](1..64))
    Act 'hand-made app'
  }
  'hostile-junction' {
    Apply
    cmd /c mklink /J 'C:\workspace\Rental\hostlink' 'C:\Windows' | Out-Null
    Act 'junction'
  }
  'hostile-app-id' {
    Apply
    $p = 'C:\workspace\Rental\app.json'
    $j = Get-Content $p -Raw | ConvertFrom-Json
    $j.id = [guid]::NewGuid().ToString()
    ConvertTo-Json -InputObject $j -Depth 10 | Set-Content $p
    Act 'change app id'
  }
  'hostile-probe-backend' {
    $token = (Get-Content 'C:\cg-secrets\backend-token' -Raw).Trim()
    $probes = @(
      @{ name = 'other-execution'; path = '/v1/compile'; exec = '00000000-0000-4000-8000-00000000beef'; body = '{}' },
      @{ name = 'oracle-path'; path = '/v1/oracle'; exec = $env:CG_EXECUTION_ID; body = '{}' },
      @{ name = 'list-apps'; path = '/v1/apps'; exec = $env:CG_EXECUTION_ID; body = '{}' },
      @{ name = 'traversal'; path = '/v1/compile'; exec = $env:CG_EXECUTION_ID; body = '{"apps":["..\\..\\x"]}' },
      @{ name = 'hidden-codeunit'; path = '/v1/test'; exec = $env:CG_EXECUTION_ID; body = '{"codeunits":[85001]}' },
      @{ name = 'malformed'; path = '/v1/compile'; exec = $env:CG_EXECUTION_ID; body = '{' }
    )
    foreach ($p in $probes) {
      $code = 0
      try {
        $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$($env:CG_BACKEND_URL)$($p.path)" `
          -Headers @{ Authorization = "Bearer $token"; 'X-CG-Execution' = $p.exec } -ContentType 'application/json' -Body $p.body
        $code = [int]$r.StatusCode
      } catch [System.Net.WebException] {
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
      }
      Emit @{ type = 'mock_probe'; name = $p.name; status = $code }
    }
    Act 'probe backend'
  }
  default { Emit @{ type = 'mock_error'; message = "unknown mode $mode" }; exit 2 }
}
Emit @{ type = 'mock_done' }
exit 0
```

Configs, one file each under `harness/configs/`, all with the same body except `id` and `settings`:

```yaml
id: mock-correct
harness: mock
harness_version: "1"
models: {}
settings: { mode: apply, solution: correct }
limits: { timeout_min: 15, max_budget_usd: 1 }
```

| File | `settings` | `limits.timeout_min` |
| --- | --- | --- |
| `mock-correct.yml` | `{ mode: apply, solution: correct }` | 15 |
| `mock-naive.yml` | `{ mode: apply, solution: naive }` | 15 |
| `mock-cgal.yml` | `{ mode: cg-al, solution: correct }` | 20 |
| `mock-crash.yml` | `{ mode: crash }` | 15 |
| `mock-crash-after-work.yml` | `{ mode: crash-after-work, solution: correct }` | 15 |
| `mock-sleep.yml` | `{ mode: sleep, solution: correct }` | 1 |
| `mock-usage.yml` | `{ mode: usage-limit }` | 15 |
| `mock-hostile-edit-tests.yml` | `{ mode: hostile-edit-tests, solution: naive }` | 15 |
| `mock-hostile-app.yml` | `{ mode: hostile-app, solution: naive }` | 15 |
| `mock-hostile-junction.yml` | `{ mode: hostile-junction, solution: correct }` | 15 |
| `mock-hostile-app-id.yml` | `{ mode: hostile-app-id, solution: correct }` | 15 |
| `mock-hostile-probe-backend.yml` | `{ mode: hostile-probe-backend }` | 15 |
| `mock-leave-state.yml` | `{ mode: cg-al, solution: "fixture:tests/fixtures/harness/hostile/leave-state" }` | 20 |
| `mock-detect-state.yml` | `{ mode: cg-al, solution: "fixture:tests/fixtures/harness/hostile/detect-state" }` | 20 |

`harness/experiments/mock-contract.yml`:

```yaml
id: mock-contract
hypothesis: >-
  The pipeline scores each task's reference solution as solved and a naive
  solution as unsolved (mock harness contract, spec 1a section 11).
primary_metric: pass_rate
baseline: mock-naive
variants: [mock-correct]
vary: [settings]
tasks: "harness-tasks/tasks/*"
repeats: 1
```

`tests/fixtures/harness/hostile/leave-state/Test/src/HostileLeaveState.Test.al` (the `CGR Vehicle` table and its `"No."` key come from the refapp; M1-30 adapts the field names to refapp-v1 if they differ):

```al
codeunit 80098 "CG Hostile Leave State"
{
    Subtype = Test;
    TestPermissions = Disabled;

    [Test]
    procedure LeaveState()
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Init();
        Vehicle."No." := 'CGHOSTILE';
        Vehicle.Insert();
        Commit();
    end;
}
```

`tests/fixtures/harness/hostile/detect-state/Test/src/HostileDetectState.Test.al`:

```al
codeunit 80099 "CG Hostile Detect State"
{
    Subtype = Test;
    TestPermissions = Disabled;

    [Test]
    procedure NoLeftoverState()
    var
        Vehicle: Record "CGR Vehicle";
        Assert: Codeunit "Library Assert";
    begin
        Vehicle.SetRange("No.", 'CGHOSTILE');
        Assert.RecordIsEmpty(Vehicle);
    end;
}
```

Append to `tests/unit/harness/fake-docker.ts` (add `import { join } from "@std/path";` and `import { safeCopyTree } from "../../../src/harness/fsutil.ts";` at the top):

```typescript
/** Behaves like harness/images/mock/run.ps1 for the modes unit tests use. */
export function mockImageBehavior(): RunBehavior {
  return async (call, io) => {
    const cfg = JSON.parse(await Deno.readTextFile(join(call.mounts.get("C:\\config")!.src, "settings.json")));
    const mode = String(cfg.settings.mode);
    const ws = call.mounts.get("C:\\workspace")!.src;
    const sol = call.mounts.get("C:\\mock\\solution")?.src;
    const emit = (o: unknown) => io.stdout(JSON.stringify(o));
    const apply = async () => {
      if (!sol) return;
      await safeCopyTree(sol, ws);
      await emit({ type: "mock_action", action: "apply" });
    };
    await emit({ type: "mock_init", version: "1", loaded: [] });
    switch (mode) {
      case "none":
        break;
      case "apply":
        await apply();
        break;
      case "crash":
        return 3;
      case "crash-after-work":
        await apply();
        return 3;
      case "sleep":
        await apply();
        await io.killed;
        return 137;
      case "usage-limit":
        await emit({ type: "mock_usage_limited", reset_at: new Date(Date.now() + 60_000).toISOString() });
        return 1;
      default:
        await emit({ type: "mock_error", message: mode });
        return 2;
    }
    await emit({ type: "mock_done" });
    return 0;
  };
}
```

- [ ] **Step 7: Run them and see them pass**

Run: `deno test --allow-all tests/unit/harness/adapter.test.ts tests/unit/harness/images.test.ts tests/unit/harness/config.test.ts`
Expected: all pass.

- [ ] **Step 8: Check, lint, format**

```bash
deno check src/harness/adapter.ts src/harness/adapters/mock.ts src/harness/images.ts src/harness/config.ts tests/unit/harness/adapter.test.ts tests/unit/harness/images.test.ts tests/unit/harness/config.test.ts tests/unit/harness/fake-docker.ts
deno lint src/harness/adapter.ts src/harness/adapters/mock.ts src/harness/images.ts src/harness/config.ts tests/unit/harness/adapter.test.ts tests/unit/harness/images.test.ts tests/unit/harness/config.test.ts tests/unit/harness/fake-docker.ts
deno fmt src/harness/adapter.ts src/harness/adapters/mock.ts src/harness/images.ts src/harness/config.ts tests/unit/harness/adapter.test.ts tests/unit/harness/images.test.ts tests/unit/harness/config.test.ts tests/unit/harness/fake-docker.ts
deno task start harness validate
```

`harness validate` must still load every experiment, including `mock-contract` (it fails loudly on the real repo until M4 lands a task, as Part 1 documents).

- [ ] **Step 9: Commit**

```bash
git add src/harness/adapter.ts src/harness/adapters/mock.ts src/harness/images.ts src/harness/config.ts harness/images harness/configs harness/experiments tests/fixtures/harness/hostile tests/unit/harness/adapter.test.ts tests/unit/harness/images.test.ts tests/unit/harness/config.test.ts tests/unit/harness/fake-docker.ts
git commit -m "feat(harness): adapter contract, mock harness image and arms, image identity"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/adapter.test.ts tests/unit/harness/images.test.ts tests/unit/harness/config.test.ts` passes; check, lint and `deno fmt --check` clean on the TypeScript files. Image builds are M1-26.

---

### Task M1-22: execution pipeline and cell retries

Spec 1a section 5 items 1-6 in order (stage; issue a per-execution token scoped to the workspace; `docker run` with exactly the four mounts; capture; stop on timeout, still judged; revoke the token, freeze, destroy, hand the artifact to the verdict), section 4 (image digest pinned by the campaign; observed-manifest check), section 8 (termination table via Part 1 `outcomePolicy`; one automatic retry for a crash before work and for setup failures; usage limits pause and retry the cell; every attempt kept with its cost; cleanup checked), secrets accepted-risk (logs scanned and redacted before they are kept). Part 1 contracts: `did_work` = any agent action; `run_kind`, `retry_of`, `attempt`; `workspace_hash` and one artifact association per execution; `image_attachments`.

**Lane:** infra. **Deps:** M1-05 (`forTask`, `resolveManifest`, `manifestHash`), M1-07 (records, `RecordStore`), M1-08 (`outcomePolicy`), M1-12, M1-13, M1-17, M1-18, M1-19, M1-20, M1-21.

**Files:**
- Create: `src/harness/execution.ts`
- Create: `tests/unit/harness/runtime-fixture.ts` (a full `HarnessEnv` over fakes; reused by M1-23, M1-24)
- Test: `tests/unit/harness/execution.test.ts`

**Interfaces:**
- Produces: `interface HarnessEnv { repoRoot; harnessRoot; resultsRoot; workRoot; cacheDir; store: RecordStore; lane: BcLane; backend: Backend; backendUrl; docker: DockerCli; owner; symbols: SymbolPackage[]; symbolStore; secretsSource; now?: () => Date; timeoutMsFor?: (minutes: number) => number }`; `interface CellRef { campaignId; block: Block; orderInBlock; arm; armManifest: ResolvedManifest; armManifestHash; task: LoadedTask; taskVisibleHash; oracleHash; refapp: RefappRef }`; `interface AttemptRef { attempt: number; runKind: RunKind; retryOf: string | null }`; `interface ExecutionOutcome { execution: ExecutionRecord; usageResetAt: string | null; staged: StagedWorkspace }`; `imageAttachments(attachments, support)`; `writeConfigDir(harnessRoot, dir, m: ResolvedManifest): Promise<void>`; `runExecution(env, cell, at): Promise<ExecutionOutcome>`; `judgeExecution(env, cell, e, pristine, oracleHash?): Promise<JudgmentRecord>`; `rejudgeExecution(env, cell, e, oracleHash): Promise<JudgmentRecord>`; `interface CellResult { executions: ExecutionRecord[]; pause: string | null }`; `runCell(env, cell, first?: AttemptRef): Promise<CellResult>`.
- Produces (runtime-fixture.ts): `interface TestEnv { env; repo; docker: FakeDocker; bc: FakeBc; harnessRoot }`; `makeEnv(opts?: { bc?: FakeBc }): Promise<TestEnv>` (writes `mock-correct`, `mock-naive`, `mock-crash`, `mock-crash-after-work`, `mock-sleep`, `mock-usage` configs and a `mock-contract` experiment with `repeats: 2` into a temp harness root; registers `centralgauge/harness-mock:1` in the fake docker); `cellFor(t: TestEnv, configId: string, taskId?: string): Promise<CellRef>`; `verdictBc(): FakeBc` (the HX-001 test script from M1-17).

Every execution gets its own staged workspace under `results/harness/work/<execution-id>/`, removed when the cell ends. The execution record is written before a failed `docker rm -f` is raised, so the attempt and its cost are never lost; the campaign then stops (M1-23) and the next start sweeps.

- [ ] **Step 1: Write the fixture and the failing test**

`tests/unit/harness/runtime-fixture.ts`:

```typescript
/** A complete HarnessEnv over FakeBc + FakeDocker + a temp refapp repo. */

import { join } from "@std/path";
import { Backend, defaultBackendOps } from "../../../src/harness/backend.ts";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import { loadConfig } from "../../../src/harness/config.ts";
import type { CellRef, HarnessEnv } from "../../../src/harness/execution.ts";
import { resolveRefapp, taskSetIdentity } from "../../../src/harness/identity.ts";
import { imageFacts, imageTag, runtimeFacts } from "../../../src/harness/images.ts";
import { mockAdapter } from "../../../src/harness/adapters/mock.ts";
import { manifestHash, resolveManifest } from "../../../src/harness/manifest.ts";
import { RecordStore } from "../../../src/harness/records.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { deployedSource, FakeBc, result } from "./fake-bc.ts";
import { FakeDocker, mockImageBehavior } from "./fake-docker.ts";
import { makeRefappRepo, type RefappRepo, write } from "./refapp-fixture.ts";

export function verdictBc(): FakeBc {
  return new FakeBc((cu, deployed) => {
    const rental = deployedSource(deployed, "CGR Rental");
    if (cu === 80000) return result({ ShippedPasses: true });
    if (cu === 85001) {
      return result({ FixWorks: rental.includes("exit(10)") ? true : "Assert.AreEqual failed. Expected:<10>" });
    }
    return result({});
  });
}

const MODES: Record<string, string> = {
  "mock-correct": "{ mode: apply, solution: correct }",
  "mock-naive": "{ mode: apply, solution: naive }",
  "mock-crash": "{ mode: crash }",
  "mock-crash-after-work": "{ mode: crash-after-work, solution: correct }",
  "mock-sleep": "{ mode: sleep, solution: correct }",
  "mock-usage": "{ mode: usage-limit }",
};

export interface TestEnv {
  env: HarnessEnv;
  repo: RefappRepo;
  docker: FakeDocker;
  bc: FakeBc;
  harnessRoot: string;
}

export async function makeEnv(opts: { bc?: FakeBc } = {}): Promise<TestEnv> {
  const repo = await makeRefappRepo();
  const harnessRoot = join(repo.root, "harness");
  for (const [id, settings] of Object.entries(MODES)) {
    await write(harnessRoot, `configs/${id}.yml`, `id: ${id}
harness: mock
harness_version: "1"
models: {}
settings: ${settings}
limits: { timeout_min: 15, max_budget_usd: 1 }
`);
  }
  await write(harnessRoot, "experiments/mock-contract.yml", `id: mock-contract
hypothesis: Correct solves, naive does not.
primary_metric: pass_rate
baseline: mock-naive
variants: [mock-correct]
vary: [settings]
tasks: "harness-tasks/tasks/*"
repeats: 2
`);
  const docker = new FakeDocker();
  docker.behavior = mockImageBehavior();
  docker.images.set(imageTag("mock", "1"), {
    Id: "sha256:mockimage",
    Config: {
      Labels: {
        "centralgauge.harness": "mock",
        "centralgauge.harness.version": "1",
        "centralgauge.harness.base_digest": "sha256:base",
      },
    },
  });
  const bc = opts.bc ?? verdictBc();
  const lane = new BcLane(bc, ["C1"]);
  const resultsRoot = join(repo.root, "results", "harness");
  const workRoot = join(resultsRoot, "work");
  await Deno.mkdir(workRoot, { recursive: true });
  const cacheDir = join(resultsRoot, "cache", "apps");
  const env: HarnessEnv = {
    repoRoot: repo.root,
    harnessRoot,
    resultsRoot,
    workRoot,
    cacheDir,
    store: new RecordStore(resultsRoot),
    lane,
    backend: new Backend({ approvedRoots: [workRoot], workRoot: join(workRoot, "backend"), ops: defaultBackendOps(lane, cacheDir) }),
    backendUrl: "http://127.0.0.1:9",
    docker,
    owner: "HOST1",
    symbols: repo.symbols,
    symbolStore: repo.symbolStore,
    secretsSource: await Deno.makeTempDir(),
  };
  return { env, repo, docker, bc, harnessRoot };
}

export async function cellFor(t: TestEnv, configId: string, taskId = "HX-001"): Promise<CellRef> {
  const config = await loadConfig(t.harnessRoot, configId);
  const facts = runtimeFacts(config, await imageFacts(t.docker, imageTag("mock", "1")), mockAdapter);
  const armManifest = await resolveManifest(t.harnessRoot, config, facts);
  const task = await loadTask(join(t.repo.tasksDir, taskId));
  const ids = await taskSetIdentity(t.repo.root, [task], t.repo.symbols);
  return {
    campaignId: "11111111-2222-4333-8444-555555555555",
    block: { index: 0, task_id: taskId, repeat: 1, order: [configId] },
    orderInBlock: 0,
    arm: configId,
    armManifest,
    armManifestHash: await manifestHash(armManifest),
    task,
    taskVisibleHash: ids.tasks[0]!.visible,
    oracleHash: ids.tasks[0]!.oracle,
    refapp: await resolveRefapp(t.repo.root, task.task.refapp_version),
  };
}
```

`tests/unit/harness/execution.test.ts`:

```typescript
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ContainerError } from "../../../src/errors.ts";
import { runCell } from "../../../src/harness/execution.ts";
import { ExecutionRecordSchema } from "../../../src/harness/records.ts";
import { cellFor, makeEnv } from "./runtime-fixture.ts";

Deno.test("runCell: the correct solution completes, freezes, passes; the token never reaches argv", async () => {
  const t = await makeEnv();
  let token = "";
  const inner = t.docker.behavior;
  t.docker.behavior = async (call, io) => {
    token = (await Deno.readTextFile(join(call.mounts.get("C:\\cg-secrets")!.src, "backend-token"))).trim();
    return await inner(call, io);
  };
  const r = await runCell(t.env, await cellFor(t, "mock-correct"));
  assertEquals(r.pause, null);
  assertEquals(r.executions.length, 1);
  const e = ExecutionRecordSchema.parse(r.executions[0]);
  assertEquals([e.termination, e.did_work, e.run_kind, e.attempt], ["completed", true, "planned", 1]);
  assertEquals(e.validity, { incomplete_telemetry: [], infra_exposed: false });
  // HX-001 ships shots/screen.png and the mock passes no images to a model.
  assertEquals(e.image_attachments, "unsupported");
  assert(e.workspace_hash !== null);
  assert(token.length === 64);
  assert(!t.docker.runs[0]!.args.some((a) => a.includes(token)));
  const res = await t.env.backend.handle(new Request("http://b/v1/symbols", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-cg-execution": e.id },
    body: "{}",
  }));
  assertEquals(res.status, 401, "token revoked before freeze");
  const [j] = await t.env.store.judgments(e.id);
  assertEquals(j!.verdict, "pass");
  assertEquals((await t.env.store.artifact(e.id))!.workspace_hash, e.workspace_hash);
  assert(!await Deno.stat(join(t.env.workRoot, e.id)).then(() => true, () => false));
});

Deno.test("runCell: a naive solution is judged a fail", async () => {
  const t = await makeEnv();
  const r = await runCell(t.env, await cellFor(t, "mock-naive"));
  const [j] = await t.env.store.judgments(r.executions[0]!.id);
  assertEquals(j!.verdict, "fail");
});

Deno.test("runCell: a crash before work is retried once and never judged", async () => {
  const t = await makeEnv();
  const r = await runCell(t.env, await cellFor(t, "mock-crash"));
  assertEquals(r.executions.map((e) => [e.termination, e.did_work, e.run_kind, e.attempt]), [
    ["harness_crash", false, "planned", 1],
    ["harness_crash", false, "auto_retry", 2],
  ]);
  assertEquals(r.executions[1]!.retry_of, r.executions[0]!.id);
  assertEquals(await t.env.store.judgments(r.executions[0]!.id), []);
});

Deno.test("runCell: a crash after work is judged, not retried", async () => {
  const t = await makeEnv();
  const r = await runCell(t.env, await cellFor(t, "mock-crash-after-work"));
  assertEquals(r.executions.length, 1);
  assertEquals((await t.env.store.judgments(r.executions[0]!.id)).length, 1);
});

Deno.test("runCell: timeout kills the sandbox and the workspace is still judged", async () => {
  const t = await makeEnv();
  t.env.timeoutMsFor = () => 50;
  const r = await runCell(t.env, await cellFor(t, "mock-sleep"));
  assertEquals(r.executions[0]!.termination, "timeout");
  assertEquals(t.docker.kills.length, 1);
  assertEquals((await t.env.store.judgments(r.executions[0]!.id))[0]!.verdict, "pass");
});

Deno.test("runCell: an image rebuilt since the campaign is setup_failed, retried once, never run", async () => {
  const t = await makeEnv();
  const cell = await cellFor(t, "mock-correct");
  const img = t.docker.images.get("centralgauge/harness-mock:1") as { Id: string };
  img.Id = "sha256:rebuilt";
  const r = await runCell(t.env, cell);
  assertEquals(r.executions.map((e) => e.termination), ["setup_failed", "setup_failed"]);
  assertEquals(t.docker.runs, []);
  assertEquals(r.executions[0]!.telemetry.cost_usd, 0);
});

Deno.test("runCell: a usage limit pauses and is not judged", async () => {
  const t = await makeEnv();
  const r = await runCell(t.env, await cellFor(t, "mock-usage"));
  assertEquals(r.executions[0]!.termination, "usage_limited");
  assert(r.pause !== null);
  assertEquals(await t.env.store.judgments(r.executions[0]!.id), []);
});

Deno.test("runCell: an observed version mismatch is setup_failed", async () => {
  const t = await makeEnv();
  t.docker.behavior = async (_c, io) => {
    await io.stdout(JSON.stringify({ type: "mock_init", version: "2", loaded: [] }));
    return 0;
  };
  const r = await runCell(t.env, await cellFor(t, "mock-correct"));
  assertEquals(r.executions[0]!.termination, "setup_failed");
  const side = JSON.parse(await Deno.readTextFile(join(t.env.resultsRoot, "runs", r.executions[0]!.id, "sandbox.json")));
  assertStringIncludes(side.setup_error, "version 2 ran");
});

Deno.test("runCell: a failed docker rm stops the run after the record is written", async () => {
  const t = await makeEnv();
  const inner = t.docker.behavior;
  t.docker.behavior = (call, io) => {
    t.docker.rmFails.add(call.name);
    return inner(call, io);
  };
  const cell = await cellFor(t, "mock-correct");
  await assertRejects(() => runCell(t.env, cell), ContainerError, "docker rm -f");
  assertEquals((await t.env.store.executions(cell.campaignId)).length, 1);
});

Deno.test("captured logs are redacted before they are kept", async () => {
  const t = await makeEnv();
  t.docker.behavior = async (call, io) => {
    const token = (await Deno.readTextFile(join(call.mounts.get("C:\\cg-secrets")!.src, "backend-token"))).trim();
    await io.stdout(JSON.stringify({ type: "mock_init", version: "1", loaded: [] }));
    await io.stdout(JSON.stringify({ type: "leak", token }));
    return 0;
  };
  const r = await runCell(t.env, await cellFor(t, "mock-correct"));
  const raw = await Deno.readTextFile(join(t.env.resultsRoot, r.executions[0]!.raw_log_path!));
  assertStringIncludes(raw, "[REDACTED:backend-token]");
  const side = JSON.parse(await Deno.readTextFile(join(t.env.resultsRoot, "runs", r.executions[0]!.id, "sandbox.json")));
  assertEquals(side.redactions, 1);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/execution.test.ts`
Expected: FAIL, `Module not found ".../src/harness/execution.ts"`.

- [ ] **Step 3: Implement**

`src/harness/execution.ts`:

```typescript
/**
 * One execution (spec 1a section 5 items 1-6) and one cell with its
 * automatic retries (section 8). Order: stage, pin image, write config,
 * grant token, secrets dir, docker run (capture), revoke, delete secrets,
 * redact logs, parse, freeze, record, judge.
 */

import { basename, join } from "@std/path";
import type { RefappRef, SymbolPackage } from "./identity.ts";
import type { ResolvedManifest } from "./manifest.ts";
import type { RunKind } from "./outcome.ts";
import type { Block, ExecutionRecord, JudgmentRecord } from "./records.ts";
import type { LoadedTask } from "./task.ts";
import { ConfigurationError, ContainerError, ValidationError } from "../errors.ts";
import { adapterFor, incompleteTelemetry, observedMismatch, type ParsedRun } from "./adapter.ts";
import { type Backend, readHostLog } from "./backend.ts";
import type { BcLane } from "./bc-lane.ts";
import { freezeWorkspace, safeCopyTree } from "./fsutil.ts";
import { hashFile, hashJson, hashTree } from "./hash.ts";
import { imageFacts, imageTag } from "./images.ts";
import { forTask } from "./manifest.ts";
import { outcomePolicy } from "./outcome.ts";
import { ExecutionRecordSchema, type RecordStore } from "./records.ts";
import {
  type DockerCli,
  prepareSecrets,
  redactSecrets,
  removeSecrets,
  runSandbox,
  sandboxName,
  type SandboxResult,
  type SecretValue,
} from "./sandbox.ts";
import { type StagedWorkspace, TASK_SOURCES } from "./staging.ts";
import { judge, writeVerdictLog } from "./verdict.ts";

export interface HarnessEnv {
  repoRoot: string;
  harnessRoot: string;
  /** results/harness */
  resultsRoot: string;
  /** Staging and verdict scratch; the backend's approved root. */
  workRoot: string;
  cacheDir: string;
  store: RecordStore;
  lane: BcLane;
  backend: Backend;
  /** URL the sandbox uses to reach the backend (container-facing address). */
  backendUrl: string;
  docker: DockerCli;
  /** Owner label value for sandbox containers (this host). */
  owner: string;
  symbols: SymbolPackage[];
  symbolStore: string;
  /** Operator directory holding the harness secret files. */
  secretsSource: string;
  now?: () => Date;
  /** Test seam; default minutes * 60 000. */
  timeoutMsFor?: (minutes: number) => number;
}

export interface CellRef {
  campaignId: string;
  block: Block;
  orderInBlock: number;
  arm: string;
  armManifest: ResolvedManifest;
  armManifestHash: string;
  task: LoadedTask;
  taskVisibleHash: string;
  oracleHash: string;
  refapp: RefappRef;
}

export interface AttemptRef {
  attempt: number;
  runKind: RunKind;
  retryOf: string | null;
}

export interface ExecutionOutcome {
  execution: ExecutionRecord;
  usageResetAt: string | null;
  staged: StagedWorkspace;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp)$/i;

/** Spec 1b section 6: whether image attachments reached the model. */
export function imageAttachments(
  attachments: string[],
  support: boolean | null,
): ExecutionRecord["image_attachments"] {
  if (!attachments.some((a) => IMAGE_EXT.test(a))) return "none";
  return support === true ? "delivered" : support === false ? "unsupported" : "unknown";
}

async function componentHash(abs: string): Promise<string> {
  const st = await Deno.lstat(abs);
  return st.isDirectory ? await hashTree(abs, "bundle") : await hashJson({ file: await hashFile(abs) });
}

/**
 * C:\config: settings.json (native settings as the adapter translated them),
 * manifest.json, and bundle copies. A bundle that changed since the
 * campaign pinned it is refused (it would be a different arm).
 */
export async function writeConfigDir(harnessRoot: string, dir: string, m: ResolvedManifest): Promise<void> {
  await Deno.mkdir(join(dir, "bundle"), { recursive: true });
  const parts: [string, { path: string; hash: string }][] = [];
  for (const k of ["instructions", "skills", "agents", "hooks"] as const) {
    const c = m[k];
    if (c !== null) parts.push([k, c]);
  }
  m.plugins.forEach((p, i) => parts.push([`plugins/${i}`, p]));
  for (const [name, c] of parts) {
    const src = join(harnessRoot, c.path);
    if (await componentHash(src) !== c.hash) {
      throw new ConfigurationError(`component ${name} (${c.path}) changed since the campaign was created`);
    }
    const dst = join(dir, "bundle", name);
    if ((await Deno.lstat(src)).isDirectory) await safeCopyTree(src, dst);
    else {
      await Deno.mkdir(dst, { recursive: true });
      await Deno.copyFile(src, join(dst, basename(src)));
    }
  }
  await Deno.writeTextFile(join(dir, "settings.json"), JSON.stringify({
    harness: m.harness,
    harness_version: m.harness_version,
    models: m.models,
    settings: m.settings.native,
    limits: m.limits,
    mcp: m.mcp.map((s) => s.name),
    lsp: m.lsp.map((s) => s.name),
    toolchain: m.toolchain,
  }, null, 2) + "\n");
  await Deno.writeTextFile(join(dir, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
}

/** The harness never started: exact zero spend, nothing observed. */
function notStarted(exitCode: number | null): ParsedRun {
  return {
    telemetry: {
      harness_version: null, cost_usd: 0, cost_source: "estimated",
      pricing_snapshot: "none: the harness did not start", reported_cost_usd: null, per_model: [],
      turns: null, compactions: null, wall_ms: null, exit_code: exitCode, stop_reason: null,
      refusal_detected: null, raw_usage: null,
    },
    observed: { harness_version: null, models: null, loaded_components: null },
    didWork: false,
    termination: null,
    usageResetAt: null,
    imageSupport: null,
  };
}

export async function runExecution(env: HarnessEnv, cell: CellRef, at: AttemptRef): Promise<ExecutionOutcome> {
  const now = env.now ?? (() => new Date());
  const id = crypto.randomUUID();
  const started_at = now().toISOString();
  const adapter = adapterFor(cell.armManifest.harness);
  const manifest = forTask(cell.armManifest, cell.task.task.limits);
  const runRel = `runs/${id}`;
  const runDir = join(env.resultsRoot, runRel);
  await Deno.mkdir(runDir, { recursive: true });
  const rawLog = join(runDir, "raw.jsonl");
  const stderrLog = join(runDir, "stderr.txt");
  const hostLog = join(runDir, "host-log.jsonl");
  const work = join(env.workRoot, id);
  const name = sandboxName(cell.campaignId, id);

  const staged = await TASK_SOURCES[cell.task.task.source]({
    repoRoot: env.repoRoot, task: cell.task, refapp: cell.refapp,
    symbols: env.symbols, symbolStore: env.symbolStore, out: work,
  });
  const pristineHash = await hashTree(staged.pristine, "task");

  let setupError: string | null = null;
  let sandbox: SandboxResult | null = null;
  let secrets: SecretValue[] = [];
  const ref = imageTag(manifest.harness, manifest.harness_version);
  try {
    const facts = await imageFacts(env.docker, ref);
    if (facts.digest !== manifest.image.digest) {
      throw new ConfigurationError(`image ${ref} is ${facts.digest}; the campaign pinned ${manifest.image.digest}`);
    }
    const configDir = join(work, "config");
    await writeConfigDir(env.harnessRoot, configDir, manifest);
    const extraMounts = await adapter.extraMounts(manifest.settings.native, cell.task.dir, env.repoRoot);
    const timeoutMs = (env.timeoutMsFor ?? ((m) => m * 60_000))(manifest.limits.timeout_min);
    const token = await env.backend.grant({
      executionId: id, workspace: staged.workspace, pristine: staged.pristine,
      apps: staged.apps, symbols: env.symbols, hostLog,
    }, timeoutMs + 5 * 60_000);
    let secretsDir: string | null = null;
    try {
      const s = await prepareSecrets(env.secretsSource, adapter.secretFiles, token);
      secretsDir = s.dir;
      secrets = s.values;
      sandbox = await runSandbox(env.docker, {
        name, owner: env.owner, executionId: id, image: ref,
        workspace: staged.workspace, taskDir: staged.taskDir, configDir, secretsDir: s.dir,
        extraMounts, env: { CG_BACKEND_URL: env.backendUrl, CG_EXECUTION_ID: id },
        timeoutMs, rawLog, stderrLog,
      }, secrets.map((v) => v.value));
    } finally {
      env.backend.revoke(id); // spec 1a section 5 item 6: revoke before freeze
      if (secretsDir) await removeSecrets(secretsDir);
    }
  } catch (err) {
    if (!(err instanceof ConfigurationError) && !(err instanceof ValidationError)) throw err;
    setupError = err.message;
  }

  const redactions = await redactSecrets([rawLog, stderrLog, hostLog], secrets);
  const ran = sandbox !== null && sandbox.startError === null && sandbox.exitCode !== 125;
  const parsed = ran ? await adapter.parse(rawLog, sandbox!.exitCode) : notStarted(sandbox?.exitCode ?? null);
  // The container has exited: nothing can write the workspace any more.
  const frozen = ran ? await freezeWorkspace(env.resultsRoot, staged.workspace) : null;
  const host = await readHostLog(hostLog);
  const mismatch = ran ? observedMismatch(manifest, parsed.observed) : null;
  const termination: ExecutionRecord["termination"] = !ran || setupError !== null || mismatch !== null
    ? "setup_failed"
    : parsed.termination === "usage_limited"
    ? "usage_limited"
    : sandbox!.timedOut
    ? "timeout"
    : parsed.termination ?? (sandbox!.exitCode === 0 ? "completed" : "harness_crash");
  const did_work = parsed.didWork || host.length > 0 ||
    (frozen !== null && frozen.workspace_hash !== pristineHash);

  const execution = ExecutionRecordSchema.parse({
    v: 1,
    id,
    campaign_id: cell.campaignId,
    block: cell.block.index,
    order_in_block: cell.orderInBlock,
    arm: cell.arm,
    task_id: cell.task.task.id,
    task_visible_hash: cell.taskVisibleHash,
    repeat: cell.block.repeat,
    attempt: at.attempt,
    run_kind: at.runKind,
    retry_of: at.retryOf,
    started_at,
    ended_at: now().toISOString(),
    arm_manifest_hash: cell.armManifestHash,
    manifest,
    observed: parsed.observed,
    termination,
    did_work,
    validity: {
      incomplete_telemetry: ran ? incompleteTelemetry(adapter.declared, parsed.telemetry) : [],
      infra_exposed: host.some((l) => l.outcome === "infra"),
    },
    image_attachments: imageAttachments(cell.task.task.attachments, parsed.imageSupport),
    telemetry: parsed.telemetry,
    trace_path: null,
    host_log_path: `${runRel}/host-log.jsonl`,
    raw_log_path: `${runRel}/raw.jsonl`,
    container_assignments: [...new Set(host.map((l) => l.container).filter((c): c is string => !!c))],
    workspace_hash: frozen?.workspace_hash ?? null,
  });
  await env.store.writeExecution(execution);
  if (frozen) {
    await env.store.writeArtifact({
      v: 1, execution_id: id, workspace_hash: frozen.workspace_hash,
      stored_path: frozen.stored_path, created_at: now().toISOString(),
    });
  }
  await Deno.writeTextFile(join(runDir, "sandbox.json"), JSON.stringify({
    v: 1, sandbox, setup_error: setupError ?? mismatch, redactions,
    pristine_hash: pristineHash, freeze_violations: frozen?.violations ?? [],
  }, null, 2) + "\n");
  if (sandbox && sandbox.cleanup !== "ok") {
    throw new ContainerError(`${sandbox.cleanup} (execution ${id} is recorded; stop and let the next start sweep)`, name, "stop");
  }
  return { execution, usageResetAt: parsed.usageResetAt, staged };
}

export async function judgeExecution(
  env: HarnessEnv,
  cell: CellRef,
  e: ExecutionRecord,
  pristine: string,
  oracleHash = cell.oracleHash,
): Promise<JudgmentRecord> {
  const art = await env.store.artifact(e.id);
  if (!art) throw new ValidationError(`no artifact for execution ${e.id}`, [e.id]);
  const { judgment, log } = await judge(env.lane, {
    executionId: e.id,
    workspaceHash: art.workspace_hash,
    task: cell.task,
    oracleHash,
    pristine,
    artifact: join(env.resultsRoot, art.stored_path),
    symbolIds: new Set(env.symbols.map((s) => s.app_id)),
    workDir: join(env.workRoot, e.id, `judge-${crypto.randomUUID().slice(0, 8)}`),
    cacheDir: env.cacheDir,
  }, env.now);
  await env.store.writeJudgment(judgment);
  await writeVerdictLog(env.resultsRoot, log);
  return judgment;
}

/** Judge a stored execution again: restage the task, never re-run the agent. */
export async function rejudgeExecution(
  env: HarnessEnv,
  cell: CellRef,
  e: ExecutionRecord,
  oracleHash: string,
): Promise<JudgmentRecord> {
  const out = join(env.workRoot, `rejudge-${e.id}-${crypto.randomUUID().slice(0, 8)}`);
  try {
    const staged = await TASK_SOURCES[cell.task.task.source]({
      repoRoot: env.repoRoot, task: cell.task, refapp: cell.refapp,
      symbols: env.symbols, symbolStore: env.symbolStore, out,
    });
    return await judgeExecution(env, cell, e, staged.pristine, oracleHash);
  } finally {
    await Deno.remove(out, { recursive: true }).catch(() => {});
    await Deno.remove(join(env.workRoot, e.id), { recursive: true }).catch(() => {});
  }
}

export interface CellResult {
  executions: ExecutionRecord[];
  /** Reset time (or "unknown") when a usage limit paused the cell. */
  pause: string | null;
}

/** One cell: run, judge per policy, one automatic retry (spec 1a section 8). */
export async function runCell(
  env: HarnessEnv,
  cell: CellRef,
  first: AttemptRef = { attempt: 1, runKind: "planned", retryOf: null },
): Promise<CellResult> {
  const executions: ExecutionRecord[] = [];
  let at = first;
  for (;;) {
    const { execution: e, usageResetAt, staged } = await runExecution(env, cell, at);
    executions.push(e);
    try {
      const policy = outcomePolicy(e.termination, e.did_work);
      if (policy.judge && e.workspace_hash !== null) {
        await judgeExecution(env, cell, e, staged.pristine);
      }
      if (policy.retry === "after_usage_reset") return { executions, pause: usageResetAt ?? "unknown" };
      if (policy.retry === "once" && at.runKind !== "auto_retry") {
        at = { attempt: at.attempt + 1, runKind: "auto_retry", retryOf: e.id };
        continue;
      }
      return { executions, pause: null };
    } finally {
      await Deno.remove(join(env.workRoot, e.id), { recursive: true }).catch(() => {});
    }
  }
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/execution.test.ts`
Expected: all 10 tests pass.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/execution.ts tests/unit/harness/runtime-fixture.ts tests/unit/harness/execution.test.ts
deno lint src/harness/execution.ts tests/unit/harness/runtime-fixture.ts tests/unit/harness/execution.test.ts
deno fmt src/harness/execution.ts tests/unit/harness/runtime-fixture.ts tests/unit/harness/execution.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/execution.ts tests/unit/harness/runtime-fixture.ts tests/unit/harness/execution.test.ts
git commit -m "feat(harness): execution pipeline with pinned image, revoke-before-freeze and cell retries"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/execution.test.ts` passes; check, lint and `deno fmt --check` clean.

---
### Task M1-23: campaign runner

Spec 1a section 6 (running an experiment creates a campaign; each (task, repeat) block runs every arm in a recorded randomized order; `harness run` resumes the current campaign; `--reuse-history` is explicit and marked; staged runs: `--sample N` runs N tasks at 1 repeat, then a full run at 1 repeat, then the remaining repeats; before a run, print the execution count and an estimated cost from prior executions of the same manifest), D15 (refuse arms that differ outside `vary`), D17, section 8 (usage limit: pause new executions until the window resets, then retry the cell), section 5 (fixed concurrency). Part 1 contracts: the campaign is the full immutable plan; resume calls `validateCampaignRecords` first; `reuse` references historical executions; `tasks_meta` carries `kind` and `coupling`; a provisional task set is refused.

**Lane:** infra. **Deps:** M1-03, M1-04, M1-05, M1-07, M1-07b, M1-08, M1-21, M1-22.

**Files:**
- Create: `src/harness/campaign.ts`
- Test: `tests/unit/harness/campaign.test.ts`

**Interfaces:**
- Consumes: `loadExperiment`, `checkModelsInCatalog` (M1-03); `loadTaskSet` (M1-01); `taskSetIdentity`, `loadSymbolsLock`, `resolveRefapp` (M1-04); `resolveManifest`, `manifestHash`, `assertVaryHolds` (M1-05); `CampaignRecordSchema`, `experimentHash`, `planBlocks`, `RecordStore` (M1-07); `validateCampaignRecords`, `CampaignRecords` (M1-07b); `cellsFromRecords`, `outcomePolicy` (M1-08); `adapterFor` (M1-21); `imageFacts`, `imageTag`, `assertImageMatches`, `runtimeFacts` (M1-21); `runCell`, `rejudgeExecution`, `HarnessEnv`, `CellRef`, `AttemptRef` (M1-22).
- Produces: `interface RunOptions { sample?: number | undefined; repeats?: number | undefined; reuseHistory: boolean; dryRun: boolean; concurrency: number; seed?: number | undefined; maxPauseMs: number }`; `interface CampaignIO { log(line: string): void; sleep(ms: number): Promise<void> }`; `tasksDirOf(repoRoot, glob): string`; `stageBlocks(c, o): Block[]`; `interface CampaignData { executions; judgments: Map<string, JudgmentRecord[]>; reused }`; `loadCampaignData(store, c)`; `interface Action { block; arm; orderInBlock; kind: "run" | "judge"; at: AttemptRef; execution: ExecutionRecord | null }`; `planActions(c, d, stage): Action[]`; `interface SpendEstimate { perArm: { arm; mean: number | null; history: number; pending: number }[]; total: number | null }`; `estimateSpend(history, c, actions)`; `resolveArm(env, config): Promise<{ config_id; manifest_hash; manifest }>`; `findReuse(store, c)`; `interface Opened { campaign; created; tasks: Map<string, LoadedTask>; refapps: Map<string, RefappRef> }`; `openCampaign(env, experimentId, o, io): Promise<Opened>`; `cellRefFor(c, opened, block, arm, orderInBlock): CellRef`; `interface CampaignSummary { campaign; created; actions; executions; judged; paused: string | null; estimate: SpendEstimate }`; `runCampaign(env, experimentId, o, io): Promise<CampaignSummary>`.

`--sample N` takes the first N task ids in sorted order (deterministic, and the plan is repeat-major, so it is a prefix of the plan's first repeat). `--sample` and `--repeats` are separate stages and are refused together. The spend estimate uses every prior execution of the same arm manifest hash within this experiment's campaigns (ponytail: cross-experiment history needs a store index).

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/campaign.test.ts`:

```typescript
import { assert, assertEquals, assertNotEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError, ValidationError } from "../../../src/errors.ts";
import { type RunOptions, runCampaign, stageBlocks } from "../../../src/harness/campaign.ts";
import { campaign as campaignFixture } from "./fixtures.ts";
import { write } from "./refapp-fixture.ts";
import { makeEnv, type TestEnv } from "./runtime-fixture.ts";

const OPTS: RunOptions = { reuseHistory: false, dryRun: false, concurrency: 1, maxPauseMs: 0, seed: 7 };

function io() {
  const lines: string[] = [];
  const sleeps: number[] = [];
  return {
    lines,
    sleeps,
    log: (l: string) => void lines.push(l),
    sleep: (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };
}

async function executionsOf(t: TestEnv, id: string) {
  return await t.env.store.executions(id);
}

Deno.test("stageBlocks: sample, repeats and full are subsets; out-of-range is refused", async () => {
  const c = await campaignFixture({ repeats: 2 });
  const ids = [...new Set(c.blocks.map((b) => b.task_id))].sort();
  assertEquals(stageBlocks(c, { sample: 1 }).map((b) => `${b.task_id}#${b.repeat}`), [`${ids[0]}#1`]);
  assertEquals(stageBlocks(c, { repeats: 1 }).every((b) => b.repeat === 1), true);
  assertEquals(stageBlocks(c, {}).length, c.blocks.length);
  assertThrows(() => stageBlocks(c, { repeats: 3 }), ConfigurationError);
});

Deno.test("runCampaign --dry-run: prints the plan and an n/a estimate, writes nothing", async () => {
  const t = await makeEnv();
  const o = io();
  const s = await runCampaign(t.env, "mock-contract", { ...OPTS, dryRun: true }, o);
  assertEquals(s.created, true);
  assertEquals(await t.env.store.campaigns("mock-contract"), []);
  const text = o.lines.join("\n");
  assertStringIncludes(text, "4 cell actions");
  assertStringIncludes(text, "n/a");
  assertStringIncludes(text, "hypothesis: Correct solves, naive does not.");
});

Deno.test("runCampaign: staged runs execute subsets of the immutable plan", async () => {
  const t = await makeEnv();
  const s1 = await runCampaign(t.env, "mock-contract", { ...OPTS, sample: 1 }, io());
  const id = s1.campaign.id;
  const planFile = join(t.env.resultsRoot, "campaigns", `${id}.json`);
  const plan = await Deno.readTextFile(planFile);
  assertEquals((await executionsOf(t, id)).length, 2);
  const s2 = await runCampaign(t.env, "mock-contract", { ...OPTS, repeats: 1 }, io());
  assertEquals([s2.created, s2.campaign.id, s2.executions], [false, id, 0]);
  const s3 = await runCampaign(t.env, "mock-contract", OPTS, io());
  assertEquals(s3.executions, 2);
  assertEquals(await Deno.readTextFile(planFile), plan);
  for (const e of await executionsOf(t, id)) {
    const [j] = await t.env.store.judgments(e.id);
    assertEquals(j!.verdict, e.arm === "mock-correct" ? "pass" : "fail");
  }
  const s4 = await runCampaign(t.env, "mock-contract", OPTS, io());
  assertEquals(s4.actions, 0);
});

Deno.test("runCampaign: a changed experiment opens a new campaign", async () => {
  const t = await makeEnv();
  const a = await runCampaign(t.env, "mock-contract", { ...OPTS, sample: 1 }, io());
  const p = join(t.harnessRoot, "experiments", "mock-contract.yml");
  await Deno.writeTextFile(p, (await Deno.readTextFile(p)).replace("naive does not.", "naive never does."));
  const b = await runCampaign(t.env, "mock-contract", { ...OPTS, sample: 1 }, io());
  assertEquals(b.created, true);
  assertNotEquals(b.campaign.id, a.campaign.id);
});

Deno.test("runCampaign: arms that differ outside vary are refused", async () => {
  const t = await makeEnv();
  await write(t.harnessRoot, "experiments/bad-vary.yml", `id: bad-vary
hypothesis: h
primary_metric: pass_rate
baseline: mock-naive
variants: [mock-correct]
vary: [limits]
tasks: "harness-tasks/tasks/*"
repeats: 1
`);
  await assertRejects(() => runCampaign(t.env, "bad-vary", OPTS, io()), ConfigurationError, "outside vary");
});

Deno.test("runCampaign: a provisional task set is refused", async () => {
  const t = await makeEnv();
  await Deno.remove(join(t.repo.root, "harness-tasks", "symbols.lock.json"));
  await assertRejects(() => runCampaign(t.env, "mock-contract", OPTS, io()), ValidationError, "symbols lock");
});

Deno.test("runCampaign: resume validates the records first", async () => {
  const t = await makeEnv();
  const s = await runCampaign(t.env, "mock-contract", { ...OPTS, sample: 1 }, io());
  const [e] = await executionsOf(t, s.campaign.id);
  const forged = { ...e!, id: crypto.randomUUID(), task_visible_hash: "f".repeat(64) };
  await Deno.writeTextFile(
    join(t.env.resultsRoot, "executions", s.campaign.id, `${forged.id}.json`),
    JSON.stringify(forged),
  );
  await assertRejects(() => runCampaign(t.env, "mock-contract", OPTS, io()), ValidationError);
});

Deno.test("runCampaign: a far usage reset stops; the next run retries the cell as auto_retry", async () => {
  const t = await makeEnv();
  const inner = t.docker.behavior;
  let n = 0;
  t.docker.behavior = async (call, io) => {
    if (n++ > 0) return await inner(call, io);
    await io.stdout(JSON.stringify({ type: "mock_init", version: "1", loaded: [] }));
    await io.stdout(JSON.stringify({ type: "mock_usage_limited", reset_at: "2099-01-01T00:00:00.000Z" }));
    return 1;
  };
  const o = io();
  const s1 = await runCampaign(t.env, "mock-contract", { ...OPTS, sample: 1 }, o);
  assertEquals(s1.paused, "2099-01-01T00:00:00.000Z");
  assertStringIncludes(o.lines.join("\n"), "resume with: centralgauge harness run mock-contract");
  assertEquals((await executionsOf(t, s1.campaign.id)).length, 1);
  await runCampaign(t.env, "mock-contract", { ...OPTS, sample: 1 }, io());
  const all = await executionsOf(t, s1.campaign.id);
  const limited = all.find((e) => e.termination === "usage_limited")!;
  const retry = all.find((e) => e.retry_of === limited.id)!;
  assertEquals([retry.run_kind, retry.attempt, retry.termination], ["auto_retry", 2, "completed"]);
});

Deno.test("runCampaign: a near usage reset sleeps and continues in the same run", async () => {
  const t = await makeEnv();
  const inner = t.docker.behavior;
  let n = 0;
  t.docker.behavior = async (call, io) => {
    if (n++ > 0) return await inner(call, io);
    await io.stdout(JSON.stringify({ type: "mock_init", version: "1", loaded: [] }));
    await io.stdout(JSON.stringify({ type: "mock_usage_limited", reset_at: new Date(Date.now() + 1_000).toISOString() }));
    return 1;
  };
  const o = io();
  const s = await runCampaign(t.env, "mock-contract", { ...OPTS, sample: 1, maxPauseMs: 3_600_000 }, o);
  assertEquals(s.paused, null);
  assertEquals(o.sleeps.length, 1);
  assertEquals((await executionsOf(t, s.campaign.id)).length, 3);
});

Deno.test("runCampaign --reuse-history: references scored executions and runs none of them", async () => {
  const t = await makeEnv();
  const a = await runCampaign(t.env, "mock-contract", OPTS, io());
  const p = join(t.harnessRoot, "experiments", "mock-contract.yml");
  await Deno.writeTextFile(p, (await Deno.readTextFile(p)).replace("naive does not.", "naive still does not."));
  const o = io();
  const b = await runCampaign(t.env, "mock-contract", { ...OPTS, reuseHistory: true }, o);
  assertEquals(b.campaign.reuse.length, 4);
  assert(b.campaign.reuse.every((r) => r.campaign_id === a.campaign.id));
  assertEquals((await executionsOf(t, b.campaign.id)).length, 0);
  assertStringIncludes(o.lines.join("\n"), "4 reused");
});

Deno.test("runCampaign: the estimate uses prior executions of the same arm manifest", async () => {
  const t = await makeEnv();
  await runCampaign(t.env, "mock-contract", { ...OPTS, sample: 1 }, io());
  const o = io();
  await runCampaign(t.env, "mock-contract", { ...OPTS, dryRun: true }, o);
  assertStringIncludes(o.lines.join("\n"), "estimated spend $0.00");
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/campaign.test.ts`
Expected: FAIL, `Module not found ".../src/harness/campaign.ts"`.

- [ ] **Step 3: Implement**

`src/harness/campaign.ts`:

```typescript
/**
 * Campaigns (spec 1a section 6): open or resume, staged runs over the
 * immutable plan, spend estimate, --reuse-history, usage-limit pause
 * (section 8), fixed concurrency (section 5).
 */

import { join } from "@std/path";
import type { HarnessConfig } from "./config.ts";
import type { RefappRef } from "./identity.ts";
import type { Block, CampaignRecord, ExecutionRecord, JudgmentRecord } from "./records.ts";
import type { LoadedTask } from "./task.ts";
import { ConfigurationError, ValidationError } from "../errors.ts";
import { adapterFor } from "./adapter.ts";
import { checkModelsInCatalog, loadExperiment } from "./config.ts";
import {
  type AttemptRef,
  type CellRef,
  type HarnessEnv,
  rejudgeExecution,
  runCell,
} from "./execution.ts";
import { loadSymbolsLock, resolveRefapp, taskSetIdentity } from "./identity.ts";
import { assertImageMatches, imageFacts, imageTag, runtimeFacts } from "./images.ts";
import { validateCampaignRecords } from "./integrity.ts";
import { assertVaryHolds, manifestHash, resolveManifest } from "./manifest.ts";
import { cellsFromRecords, outcomePolicy } from "./outcome.ts";
import { CampaignRecordSchema, experimentHash, planBlocks, type RecordStore } from "./records.ts";
import { loadTaskSet } from "./task.ts";

export interface RunOptions {
  sample?: number | undefined;
  repeats?: number | undefined;
  reuseHistory: boolean;
  dryRun: boolean;
  concurrency: number;
  seed?: number | undefined;
  maxPauseMs: number;
}

export interface CampaignIO {
  log(line: string): void;
  sleep(ms: number): Promise<void>;
}

export function tasksDirOf(repoRoot: string, glob: string): string {
  if (!glob.endsWith("/*")) {
    throw new ConfigurationError(`experiment tasks must look like "<dir>/*": ${glob}`);
  }
  return join(repoRoot, glob.slice(0, -2));
}

/** Staged runs select blocks from the immutable plan; they never rewrite it. */
export function stageBlocks(
  c: CampaignRecord,
  o: { sample?: number | undefined; repeats?: number | undefined },
): Block[] {
  if (o.sample !== undefined && o.repeats !== undefined) {
    throw new ConfigurationError("--sample and --repeats are separate stages; pass one");
  }
  if (o.sample !== undefined) {
    if (o.sample < 1) throw new ConfigurationError("--sample must be at least 1");
    const ids = c.task_set.tasks.map((t) => t.id).sort().slice(0, o.sample);
    return c.blocks.filter((b) => b.repeat === 1 && ids.includes(b.task_id));
  }
  if (o.repeats !== undefined) {
    if (o.repeats < 1 || o.repeats > c.experiment.repeats) {
      throw new ConfigurationError(`--repeats ${o.repeats} is outside 1..${c.experiment.repeats}`);
    }
    return c.blocks.filter((b) => b.repeat <= o.repeats!);
  }
  return c.blocks;
}

export interface CampaignData {
  executions: ExecutionRecord[];
  judgments: Map<string, JudgmentRecord[]>;
  reused: ExecutionRecord[];
}

export async function loadCampaignData(store: RecordStore, c: CampaignRecord): Promise<CampaignData> {
  const executions = await store.executions(c.id);
  const reused: ExecutionRecord[] = [];
  for (const r of c.reuse) {
    const e = (await store.executions(r.campaign_id)).find((x) => x.id === r.execution_id);
    if (!e) throw new ValidationError(`reused execution ${r.execution_id} not found`, [r.execution_id]);
    reused.push(e);
  }
  const judgments = new Map<string, JudgmentRecord[]>();
  for (const e of [...executions, ...reused]) judgments.set(e.id, await store.judgments(e.id));
  return { executions, judgments, reused };
}

async function validate(store: RecordStore, c: CampaignRecord, d: CampaignData): Promise<void> {
  const all = [...d.executions, ...d.reused];
  const artifacts = [];
  for (const e of all) {
    const a = await store.artifact(e.id);
    if (a) artifacts.push(a);
  }
  // Shape of CampaignRecords as produced by M1-07b; adapt if it changed at merge.
  await validateCampaignRecords({
    campaign: c,
    executions: all,
    artifacts,
    judgments: [...d.judgments.values()].flat(),
  });
}

export interface Action {
  block: Block;
  arm: string;
  orderInBlock: number;
  kind: "run" | "judge";
  at: AttemptRef;
  execution: ExecutionRecord | null;
}

/** What each planned cell of the stage still needs (spec 1a section 8 policy). */
export function planActions(c: CampaignRecord, d: CampaignData, stage: Block[]): Action[] {
  const reused = new Set(d.reused.map((e) => {
    const arm = c.arms.find((a) => a.manifest_hash === e.arm_manifest_hash);
    return `${e.task_id}#${e.repeat}#${arm?.config_id}`;
  }));
  const actions: Action[] = [];
  for (const block of stage) {
    block.order.forEach((arm, orderInBlock) => {
      if (reused.has(`${block.task_id}#${block.repeat}#${arm}`)) return;
      const cell = d.executions.filter((e) =>
        e.task_id === block.task_id && e.repeat === block.repeat && e.arm === arm
      );
      const chain = cell.filter((e) => e.run_kind !== "manual_rerun").sort((a, b) => a.attempt - b.attempt);
      const last = chain.at(-1);
      const base = { block, arm, orderInBlock };
      if (!last) {
        actions.push({ ...base, kind: "run", at: { attempt: 1, runKind: "planned", retryOf: null }, execution: null });
        return;
      }
      const policy = outcomePolicy(last.termination, last.did_work);
      if (policy.judge && last.workspace_hash !== null && (d.judgments.get(last.id) ?? []).length === 0) {
        actions.push({
          ...base, kind: "judge",
          at: { attempt: last.attempt, runKind: last.run_kind, retryOf: last.retry_of }, execution: last,
        });
        return;
      }
      if (policy.retry === "after_usage_reset" || (policy.retry === "once" && last.run_kind === "planned")) {
        const next = Math.max(...cell.map((e) => e.attempt)) + 1;
        actions.push({ ...base, kind: "run", at: { attempt: next, runKind: "auto_retry", retryOf: last.id }, execution: null });
      }
    });
  }
  return actions;
}

export interface SpendEstimate {
  perArm: { arm: string; mean: number | null; history: number; pending: number }[];
  total: number | null;
}

export function estimateSpend(history: ExecutionRecord[], c: CampaignRecord, actions: Action[]): SpendEstimate {
  const perArm = c.arms.map((a) => {
    const costs = history
      .filter((e) => e.arm_manifest_hash === a.manifest_hash && e.telemetry.cost_usd !== null)
      .map((e) => e.telemetry.cost_usd!);
    return {
      arm: a.config_id,
      mean: costs.length > 0 ? costs.reduce((s, v) => s + v, 0) / costs.length : null,
      history: costs.length,
      pending: actions.filter((x) => x.arm === a.config_id && x.kind === "run").length,
    };
  });
  const known = perArm.every((a) => a.pending === 0 || a.mean !== null);
  return { perArm, total: known ? perArm.reduce((s, a) => s + (a.mean ?? 0) * a.pending, 0) : null };
}

export async function resolveArm(env: HarnessEnv, c: HarnessConfig) {
  const adapter = adapterFor(c.harness);
  const facts = await imageFacts(env.docker, imageTag(c.harness, c.harness_version));
  assertImageMatches(facts, c);
  const manifest = await resolveManifest(env.harnessRoot, c, runtimeFacts(c, facts, adapter));
  return { config_id: c.id, manifest_hash: await manifestHash(manifest), manifest };
}

/** Scored executions of older campaigns whose arm manifest and task visible hash match. */
export async function findReuse(store: RecordStore, c: CampaignRecord): Promise<CampaignRecord["reuse"]> {
  const taken = new Set<string>();
  const out: CampaignRecord["reuse"] = [];
  for (const old of await store.campaigns(c.experiment.id)) {
    if (old.id === c.id) continue;
    const d = await loadCampaignData(store, old);
    const own = d.executions;
    for (const cell of cellsFromRecords(old, [...own, ...d.reused], d.judgments)) {
      if (cell.status !== "scored" || !cell.used_execution) continue;
      const e = own.find((x) => x.id === cell.used_execution);
      if (!e) continue;
      const arm = c.arms.find((a) => a.manifest_hash === e.arm_manifest_hash);
      const task = c.task_set.tasks.find((t) => t.id === e.task_id && t.visible === e.task_visible_hash);
      const key = `${e.task_id}#${e.repeat}#${arm?.config_id}`;
      if (!arm || !task || e.repeat > c.experiment.repeats || taken.has(key)) continue;
      taken.add(key);
      out.push({ campaign_id: old.id, execution_id: e.id });
    }
  }
  return out;
}

export interface Opened {
  campaign: CampaignRecord;
  created: boolean;
  tasks: Map<string, LoadedTask>;
  refapps: Map<string, RefappRef>;
}

export async function openCampaign(
  env: HarnessEnv,
  experimentId: string,
  o: RunOptions,
  io: CampaignIO,
): Promise<Opened> {
  const { experiment, configs } = await loadExperiment(env.harnessRoot, experimentId);
  await checkModelsInCatalog(configs, join(env.repoRoot, "site", "catalog"));
  const loaded = await loadTaskSet(tasksDirOf(env.repoRoot, experiment.tasks));
  const identity = await taskSetIdentity(env.repoRoot, loaded, await loadSymbolsLock(env.repoRoot));
  if (identity.provisional) {
    throw new ValidationError(
      "no symbols lock: run `centralgauge harness symbols lock --from <symbols dir>` first",
      ["harness-tasks/symbols.lock.json"],
    );
  }
  const arms = [];
  for (const c of configs) arms.push(await resolveArm(env, c));
  for (const v of arms.slice(1)) await assertVaryHolds(arms[0]!.manifest, v.manifest, experiment.vary);
  const tasks = new Map(loaded.map((t) => [t.task.id, t]));
  const refapps = new Map<string, RefappRef>();
  for (const t of loaded) {
    const v = t.task.refapp_version;
    if (!refapps.has(v)) refapps.set(v, await resolveRefapp(env.repoRoot, v));
  }
  const expHash = await experimentHash(experiment);
  const key = (xs: { config_id: string; manifest_hash: string }[]) =>
    xs.map((a) => `${a.config_id}=${a.manifest_hash}`).sort().join(",");
  const previous = await env.store.campaigns(experiment.id);
  const existing = previous.find((c) =>
    c.experiment_hash === expHash && c.task_set.identity === identity.identity && key(c.arms) === key(arms)
  );
  if (existing) {
    io.log(`[OK] resuming campaign ${existing.id} (created ${existing.created_at})`);
    return { campaign: existing, created: false, tasks, refapps };
  }
  if (previous.length > 0) {
    io.log("[WARN] experiment, task set or arm manifests changed since the last campaign; starting a new one");
  }
  const seed = o.seed ?? crypto.getRandomValues(new Uint32Array(1))[0]!;
  let campaign: CampaignRecord = CampaignRecordSchema.parse({
    v: 1,
    id: crypto.randomUUID(),
    experiment,
    experiment_hash: expHash,
    created_at: (env.now?.() ?? new Date()).toISOString(),
    seed,
    reuse: [],
    task_set: identity,
    tasks_meta: loaded.map((t) => ({ id: t.task.id, kind: t.task.kind, coupling: t.task.coupling })),
    arms,
    blocks: planBlocks(identity.tasks.map((t) => t.id), experiment.repeats, arms.map((a) => a.config_id), seed),
  });
  if (o.reuseHistory) {
    campaign = CampaignRecordSchema.parse({ ...campaign, reuse: await findReuse(env.store, campaign) });
  }
  if (!o.dryRun) await env.store.writeCampaign(campaign);
  io.log(
    `[OK] new campaign ${campaign.id} (seed ${seed}${
      campaign.reuse.length > 0 ? `, ${campaign.reuse.length} reused executions, marked in the report` : ""
    })`,
  );
  return { campaign, created: true, tasks, refapps };
}

export function cellRefFor(c: CampaignRecord, opened: Opened, block: Block, arm: string, orderInBlock: number): CellRef {
  const a = c.arms.find((x) => x.config_id === arm)!;
  const ident = c.task_set.tasks.find((t) => t.id === block.task_id)!;
  const task = opened.tasks.get(block.task_id);
  if (!task) throw new ValidationError(`task ${block.task_id} of campaign ${c.id} is not in the task set`, [block.task_id]);
  return {
    campaignId: c.id,
    block,
    orderInBlock,
    arm,
    armManifest: a.manifest,
    armManifestHash: a.manifest_hash,
    task,
    taskVisibleHash: ident.visible,
    oracleHash: ident.oracle,
    refapp: opened.refapps.get(task.task.refapp_version)!,
  };
}

/** N workers over an ordered list; a worker returning true stops dispatch. */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<boolean>): Promise<void> {
  let next = 0;
  let stop = false;
  let error: unknown = null;
  const worker = async () => {
    while (!stop && next < items.length) {
      const it = items[next++]!;
      try {
        if (await fn(it)) stop = true;
      } catch (err) {
        stop = true;
        error ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, n) }, worker));
  if (error !== null) throw error;
}

export interface CampaignSummary {
  campaign: CampaignRecord;
  created: boolean;
  actions: number;
  executions: number;
  judged: number;
  paused: string | null;
  estimate: SpendEstimate;
}

export async function runCampaign(
  env: HarnessEnv,
  experimentId: string,
  o: RunOptions,
  io: CampaignIO,
): Promise<CampaignSummary> {
  const opened = await openCampaign(env, experimentId, o, io);
  const c = opened.campaign;
  io.log(`hypothesis: ${c.experiment.hypothesis}`);
  io.log(`primary metric: ${c.experiment.primary_metric}`);
  const stage = stageBlocks(c, o);
  const history: ExecutionRecord[] = [];
  for (const old of await env.store.campaigns(c.experiment.id)) {
    history.push(...await env.store.executions(old.id));
  }
  const summary: CampaignSummary = {
    campaign: c, created: opened.created, actions: 0, executions: 0, judged: 0, paused: null,
    estimate: { perArm: [], total: null },
  };
  for (;;) {
    const d = opened.created && o.dryRun
      ? { executions: [], judgments: new Map(), reused: [] }
      : await loadCampaignData(env.store, c);
    if (!o.dryRun) await validate(env.store, c, d);
    const actions = planActions(c, d, stage);
    summary.estimate = estimateSpend(history, c, actions);
    const total = summary.estimate.total;
    io.log(
      `${actions.length} cell actions in this stage (${stage.length} blocks x ${c.arms.length} arms); estimated spend ${
        total === null ? "n/a (no prior executions of an arm manifest)" : `$${total.toFixed(2)}`
      }`,
    );
    for (const a of summary.estimate.perArm) {
      io.log(`  ${a.arm}: ${a.pending} runs, mean ${a.mean === null ? "n/a" : `$${a.mean.toFixed(4)}`} over ${a.history} prior executions`);
    }
    if (o.dryRun || actions.length === 0) return summary;
    summary.actions += actions.length;
    let paused: string | null = null;
    await pool(actions, o.concurrency, async (a) => {
      const cell = cellRefFor(c, opened, a.block, a.arm, a.orderInBlock);
      if (a.kind === "judge") {
        const j = await rejudgeExecution(env, cell, a.execution!, cell.oracleHash);
        summary.judged++;
        io.log(`[OK] ${a.block.task_id} r${a.block.repeat} ${a.arm}: judged ${j.verdict}`);
        return false;
      }
      const r = await runCell(env, cell, a.at);
      summary.executions += r.executions.length;
      io.log(`[OK] ${a.block.task_id} r${a.block.repeat} ${a.arm}: ${r.executions.map((e) => e.termination).join(" -> ")}`);
      if (r.pause !== null) {
        paused = r.pause;
        return true;
      }
      return false;
    });
    history.push(...(await env.store.executions(c.id)).filter((e) => !history.some((h) => h.id === e.id)));
    if (paused === null) continue;
    const wait = Date.parse(paused) - (env.now?.() ?? new Date()).getTime();
    if (Number.isFinite(wait) && wait <= o.maxPauseMs) {
      io.log(`[PAUSE] usage limit until ${paused}; waiting, then retrying the cell`);
      await io.sleep(Math.max(0, wait) + 60_000);
      continue;
    }
    io.log(
      `[PAUSE] usage limit${paused === "unknown" ? "" : ` until ${paused}`}; resume with: centralgauge harness run ${experimentId}`,
    );
    summary.paused = paused;
    return summary;
  }
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/campaign.test.ts`
Expected: all 11 tests pass.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/campaign.ts tests/unit/harness/campaign.test.ts
deno lint src/harness/campaign.ts tests/unit/harness/campaign.test.ts
deno fmt src/harness/campaign.ts tests/unit/harness/campaign.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/campaign.ts tests/unit/harness/campaign.test.ts
git commit -m "feat(harness): campaign runner with resume, staged runs, estimate, reuse and usage pause"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/campaign.test.ts` passes; check, lint and `deno fmt --check` clean.

---

### Task M1-24: CLI: `harness run`, `cell`, `rejudge`, `images build`, `symbols lock`

Spec 1a section 10 (`harness run <experiment> [--dry-run] [--sample N] [--repeats N] [--reuse-history]`, `harness cell <config> <task> [--repeat N]`, `harness rejudge <experiment|artifact>`, `harness images build <harness>`; Cliffy, following the `--no-X` rule), section 8 (`acquireBenchLock` is held for harness runs), findings section 3 (results record no pre-run bench-live check: the lock is taken before anything touches Docker or a container), M0-03 carryover (b) startup sweep. `rejudge` takes the experiment and an optional `--execution <id>`; artifacts are keyed by execution id in Part 1's store, so `--execution` is the "artifact" form. `harness cell` writes its records to `results/harness/cells/` (a separate `RecordStore`), so a one-off cell never enters a campaign or a report (open question 14). No `--no-X` option is added.

The wiring lives in `cli/commands/harness-env.ts` because it imports `cli/commands/bench/container-setup.ts`; `src/harness/` stays free of CLI imports.

**Lane:** infra. **Deps:** M1-10 (`registerHarnessCommand`), M1-13 (symbols), M1-19, M1-20, M1-21, M1-22, M1-23.

**Files:**
- Create: `cli/commands/harness-env.ts`
- Modify: `cli/commands/harness-command.ts` (five subcommands and exported action functions)
- Test: `tests/unit/cli/commands/harness-command.test.ts` (append)

**Interfaces:**
- Produces (harness-env.ts): `interface EnvOptions { repoRoot; resultsDir; containers?: string[] | undefined; backendHost?: string | undefined; backendPort: number; secretsSource: string; symbolStore: string; command: string; dryRun: boolean }`; `interface EnvDeps { acquireLock; docker: () => DockerCli; setup(names: string[]): Promise<{ bc: HarnessBc; names: string[]; dispose(): Promise<void> }>; resolveHost(): Promise<string>; owner(): string }`; `REAL_DEPS`; `interface OpenEnv { env: HarnessEnv; close(): Promise<void> }`; `openHarnessEnv(o, deps?): Promise<OpenEnv>`.
- Produces (harness-command.ts): `interface HarnessCliOptions { root; resultsDir; containers?; backendHost?; backendPort; secretsDir; symbolStore }`; `harnessRun(experiment, o: HarnessCliOptions & RunFlags, open?): Promise<CampaignSummary>`; `harnessCell(configId, taskId, o: HarnessCliOptions & { repeat: number }, open?): Promise<CellResult>`; `harnessRejudge(experiment, o: HarnessCliOptions & { campaign?; execution?; all?: boolean }, open?): Promise<number>`; `harnessImagesBuild(harness, o: { root; version? }, docker?): Promise<ImageFacts | null>`; `harnessSymbolsLock(o: { root; from; altool?; store }, read?): Promise<number>`.

- [ ] **Step 1: Write the failing test** (append to `tests/unit/cli/commands/harness-command.test.ts`)

```typescript
import { join as joinPath } from "@std/path";
import { openHarnessEnv, type EnvDeps } from "../../../../cli/commands/harness-env.ts";
import {
  harnessCell,
  harnessImagesBuild,
  harnessRejudge,
  harnessRun,
  harnessSymbolsLock,
} from "../../../../cli/commands/harness-command.ts";
import { BenchLockHeldError } from "../../../../src/utils/bench-lock.ts";
import { loadSymbolsLock } from "../../../../src/harness/identity.ts";
import { BASE_IMAGE } from "../../../../src/harness/images.ts";
import { FakeBc } from "../../harness/fake-bc.ts";
import { FakeDocker } from "../../harness/fake-docker.ts";
import { makeEnv } from "../../harness/runtime-fixture.ts";

function deps(order: string[], lock?: () => never): EnvDeps {
  const docker = new FakeDocker();
  docker.owned = ["cg-harness-dead-beef"];
  const listOwned = docker.listOwned.bind(docker);
  docker.listOwned = (o) => {
    order.push("sweep");
    return listOwned(o);
  };
  return {
    acquireLock: () => {
      if (lock) lock();
      order.push("lock");
      return () => {
        order.push("release");
        return Promise.resolve();
      };
    },
    docker: () => docker,
    setup: (names) => {
      order.push("setup");
      return Promise.resolve({ bc: new FakeBc(), names, dispose: () => Promise.resolve() });
    },
    resolveHost: () => {
      order.push("host");
      return Promise.resolve("127.0.0.1");
    },
    owner: () => "HOST1",
  };
}

const CLI = (root: string) => ({
  root,
  resultsDir: joinPath(root, "results", "harness"),
  containers: ["C1"],
  backendPort: 0,
  secretsDir: root,
  symbolStore: joinPath(root, "symbols"),
});

Deno.test("openHarnessEnv: bench lock first, then sweep, containers, backend; release last", async () => {
  const t = await makeEnv();
  const order: string[] = [];
  const h = await openHarnessEnv({
    repoRoot: t.repo.root, resultsDir: t.env.resultsRoot, containers: ["C1"], backendPort: 0,
    secretsSource: t.env.secretsSource, symbolStore: t.repo.symbolStore, command: "test", dryRun: false,
  }, deps(order));
  await h.close();
  assertEquals(order, ["lock", "sweep", "setup", "host", "release"]);
});

Deno.test("openHarnessEnv: a held bench lock stops before any docker call; dry run takes no lock", async () => {
  const t = await makeEnv();
  const order: string[] = [];
  const base = {
    repoRoot: t.repo.root, resultsDir: t.env.resultsRoot, containers: ["C1"], backendPort: 0,
    secretsSource: t.env.secretsSource, symbolStore: t.repo.symbolStore, command: "test",
  };
  const held = () => {
    throw new BenchLockHeldError(null, "results/.bench-running.json");
  };
  await assertRejects(() => openHarnessEnv({ ...base, dryRun: false }, deps(order, held)), BenchLockHeldError);
  assertEquals(order, []);
  const h = await openHarnessEnv({ ...base, dryRun: true }, deps(order, held));
  await h.close();
  assertEquals(order, []);
});

Deno.test("harnessRun --dry-run and harnessCell use the environment they are given", async () => {
  const t = await makeEnv();
  const open = () => Promise.resolve({ env: t.env, close: () => Promise.resolve() });
  const s = await harnessRun("mock-contract", { ...CLI(t.repo.root), dryRun: true, concurrency: 1, maxPauseMin: 0 }, open);
  assertEquals(s.created, true);
  const cell = await harnessCell("mock-correct", "HX-001", { ...CLI(t.repo.root), repeat: 1 }, open);
  assertEquals(cell.executions[0]!.termination, "completed");
  assertEquals(await t.env.store.campaigns("mock-contract"), []);
});

Deno.test("harnessRejudge: an oracle change adds a judgment against the current oracle once", async () => {
  const t = await makeEnv();
  const open = () => Promise.resolve({ env: t.env, close: () => Promise.resolve() });
  await harnessRun("mock-contract", { ...CLI(t.repo.root), sample: 1, concurrency: 1, maxPauseMin: 0 }, open);
  assertEquals(await harnessRejudge("mock-contract", CLI(t.repo.root), open), 0);
  const oracle = joinPath(t.repo.tasksDir, "HX-001", "oracle", "src", "Oracle.Test.al");
  await Deno.writeTextFile(oracle, (await Deno.readTextFile(oracle)) + "\n// v2\n");
  assertEquals(await harnessRejudge("mock-contract", CLI(t.repo.root), open), 2);
  assertEquals(await harnessRejudge("mock-contract", CLI(t.repo.root), open), 0);
});

Deno.test("harnessImagesBuild: base, then a labelled harness image on top", async () => {
  const docker = new FakeDocker();
  await assertRejects(() => harnessImagesBuild("mock", { root: ".", version: "1" }, docker), Error, "base");
  await harnessImagesBuild("base", { root: "." }, docker);
  assertStringIncludes(docker.builds[0]!.join(" "), BASE_IMAGE);
  docker.images.set(BASE_IMAGE, { Id: "sha256:base", Config: { Labels: {} } });
  docker.images.set("centralgauge/harness-mock:1", {
    Id: "sha256:m",
    Config: { Labels: { "centralgauge.harness": "mock", "centralgauge.harness.version": "1", "centralgauge.harness.base_digest": "sha256:base" } },
  });
  const f = await harnessImagesBuild("mock", { root: ".", version: "1" }, docker);
  assertStringIncludes(docker.builds[1]!.join(" "), "centralgauge.harness.base_digest=sha256:base");
  assertEquals(f!.digest, "sha256:m");
});

Deno.test("harnessSymbolsLock: writes a strict lock the identity accepts", async () => {
  const root = await Deno.makeTempDir();
  const from = await Deno.makeTempDir();
  await Deno.writeTextFile(joinPath(from, "Microsoft_System_28.0.0.0.app"), "sys");
  const n = await harnessSymbolsLock(
    { root, from, store: joinPath(root, "store") },
    () => Promise.resolve({ id: "8874ed3a-0643-4247-9ced-7a7002f7135d", name: "System", publisher: "Microsoft", version: "28.0.0.0" }),
  );
  assertEquals(n, 1);
  assertEquals((await loadSymbolsLock(root))!.length, 1);
});
```

(Merge these imports into the file's existing import block; `assertEquals`, `assertRejects`, `assertStringIncludes` are already imported there.)

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/cli/commands/harness-command.test.ts`
Expected: FAIL, `Module not found ".../cli/commands/harness-env.ts"`.

- [ ] **Step 3: Implement `cli/commands/harness-env.ts`**

```typescript
/**
 * Real Harness Bench environment for the CLI. Order matters: the bench lock
 * first (a harness run and a bench never share containers; spec 1a section
 * 8), then temp and sandbox sweeps (M0-03 carryover b), containers, lane,
 * and the backend on the container-facing address (M0-05).
 */

import * as colors from "@std/fmt/colors";
import { join } from "@std/path";
import type { BcContainerProvider } from "../../src/container/bc-container-provider.ts";
import type { HarnessBc } from "../../src/harness/bc-lane.ts";
import type { HarnessEnv } from "../../src/harness/execution.ts";
import type { DockerCli } from "../../src/harness/sandbox.ts";
import { ConfigManager } from "../../src/config/config.ts";
import { ConfigurationError, ValidationError } from "../../src/errors.ts";
import { Backend, defaultBackendOps, resolveBackendHost } from "../../src/harness/backend.ts";
import { BcLane } from "../../src/harness/bc-lane.ts";
import { sweepWorkspaceTemp } from "../../src/harness/fsutil.ts";
import { loadSymbolsLock, SYMBOLS_LOCK_PATH } from "../../src/harness/identity.ts";
import { RecordStore } from "../../src/harness/records.ts";
import { realDocker, sweepOwnedSandboxes } from "../../src/harness/sandbox.ts";
import { acquireBenchLock, DEFAULT_BENCH_LOCK_DIR } from "../../src/utils/bench-lock.ts";
import { setupContainers } from "./bench/container-setup.ts";

export interface EnvOptions {
  repoRoot: string;
  resultsDir: string;
  containers?: string[] | undefined;
  backendHost?: string | undefined;
  backendPort: number;
  secretsSource: string;
  symbolStore: string;
  command: string;
  dryRun: boolean;
}

export interface EnvDeps {
  acquireLock: (dir: string, o: { command: string }) => () => Promise<void>;
  docker: () => DockerCli;
  setup(names: string[]): Promise<{ bc: HarnessBc; names: string[]; dispose(): Promise<void> }>;
  resolveHost(): Promise<string>;
  owner(): string;
}

export const REAL_DEPS: EnvDeps = {
  acquireLock: (dir, o) => acquireBenchLock(dir, o),
  docker: realDocker,
  async setup(names) {
    const cfg = await ConfigManager.loadConfig();
    const r = await setupContainers(names, "bccontainer", cfg.container ?? {});
    const bc = r.containerProvider as BcContainerProvider;
    return { bc, names: r.containerNames, dispose: () => bc.dispose() };
  },
  resolveHost: resolveBackendHost,
  owner: () => Deno.hostname(),
};

const DRY_RUN_BC: HarnessBc = {
  compileProject: () => Promise.reject(new Error("dry run: no containers")),
  listHarnessApps: () => Promise.reject(new Error("dry run: no containers")),
  syncHarnessApps: () => Promise.reject(new Error("dry run: no containers")),
  runHarnessTests: () => Promise.reject(new Error("dry run: no containers")),
};

export interface OpenEnv {
  env: HarnessEnv;
  close(): Promise<void>;
}

export async function openHarnessEnv(o: EnvOptions, deps: EnvDeps = REAL_DEPS): Promise<OpenEnv> {
  const symbols = await loadSymbolsLock(o.repoRoot);
  const workRoot = join(o.resultsDir, "work");
  await Deno.mkdir(workRoot, { recursive: true });
  const cacheDir = join(o.resultsDir, "cache", "apps");
  const store = new RecordStore(o.resultsDir);
  const base = {
    repoRoot: o.repoRoot,
    harnessRoot: join(o.repoRoot, "harness"),
    resultsRoot: o.resultsDir,
    workRoot,
    cacheDir,
    store,
    owner: deps.owner(),
    symbols: symbols ?? [],
    symbolStore: o.symbolStore,
    secretsSource: o.secretsSource,
  };
  if (o.dryRun) {
    const lane = new BcLane(DRY_RUN_BC, ["dry-run"]);
    const backend = new Backend({ approvedRoots: [workRoot], workRoot, ops: defaultBackendOps(lane, cacheDir) });
    return { env: { ...base, lane, backend, backendUrl: "", docker: deps.docker() }, close: () => Promise.resolve() };
  }
  if (!symbols) {
    throw new ValidationError("no symbols lock: run `centralgauge harness symbols lock --from <dir>`", [SYMBOLS_LOCK_PATH]);
  }
  if (!o.containers || o.containers.length === 0) {
    throw new ConfigurationError("pass --containers (BC containers the harness may use)");
  }
  const release = deps.acquireLock(DEFAULT_BENCH_LOCK_DIR, { command: o.command });
  const closers: (() => Promise<void>)[] = [release];
  const closeAll = async () => {
    for (const c of closers) await c().catch(() => {});
  };
  try {
    await store.sweepTemp();
    await sweepWorkspaceTemp(o.resultsDir);
    const docker = deps.docker();
    const swept = await sweepOwnedSandboxes(docker, base.owner);
    if (swept.length > 0) {
      console.log(`${colors.yellow("[WARN]")} removed ${swept.length} leftover sandbox container(s): ${swept.join(", ")}`);
    }
    const ready = await deps.setup(o.containers);
    closers.unshift(ready.dispose);
    const lane = new BcLane(ready.bc, ready.names);
    const backend = new Backend({
      approvedRoots: [workRoot],
      workRoot: join(workRoot, "backend"),
      ops: defaultBackendOps(lane, cacheDir),
    });
    const server = backend.serve(o.backendHost ?? await deps.resolveHost(), o.backendPort);
    closers.unshift(() => server.shutdown());
    return { env: { ...base, lane, backend, backendUrl: server.url, docker }, close: closeAll };
  } catch (err) {
    await closeAll();
    throw err;
  }
}
```

- [ ] **Step 4: Add the commands to `cli/commands/harness-command.ts`**

Add imports (`@std/path` `join`; `openHarnessEnv`, `OpenEnv`, `EnvOptions` from `./harness-env.ts`; `runCampaign`, `CampaignSummary`, `loadCampaignData`, `resolveArm`, `tasksDirOf`, `cellRefFor` from `../../src/harness/campaign.ts`; `runCell`, `rejudgeExecution`, `CellResult` from `../../src/harness/execution.ts`; `loadConfig`, `loadExperiment` from `../../src/harness/config.ts`; `oracleHash`, `resolveRefapp`, `taskSetIdentity` from `../../src/harness/identity.ts`; `RecordStore` already imported; `loadTask`, `loadTaskSet` from `../../src/harness/task.ts`; `BASE_IMAGE`, `buildImageArgs`, `imageFacts`, `imageTag`, `ImageFacts` from `../../src/harness/images.ts`; `realDocker`, `DockerCli` from `../../src/harness/sandbox.ts`; `altoolReader`, `buildSymbolsLock`, `defaultAltool`, `ManifestReader`, `writeSymbolsLock` from `../../src/harness/symbols.ts`; `ConfigurationError`, `ContainerError` from `../../src/errors.ts`), then:

```typescript
export interface HarnessCliOptions {
  root: string;
  resultsDir: string;
  containers?: string[] | undefined;
  backendHost?: string | undefined;
  backendPort: number;
  secretsDir: string;
  symbolStore: string;
}

type Opener = (o: EnvOptions) => Promise<OpenEnv>;

function envOptions(o: HarnessCliOptions, command: string, dryRun: boolean): EnvOptions {
  return {
    repoRoot: o.root, resultsDir: o.resultsDir, containers: o.containers, backendHost: o.backendHost,
    backendPort: o.backendPort, secretsSource: o.secretsDir, symbolStore: o.symbolStore, command, dryRun,
  };
}

const consoleIO = {
  log: (l: string) => console.log(l),
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

export async function harnessRun(
  experiment: string,
  o: HarnessCliOptions & {
    dryRun?: boolean; sample?: number; repeats?: number; reuseHistory?: boolean;
    concurrency: number; seed?: number; maxPauseMin: number;
  },
  open: Opener = openHarnessEnv,
): Promise<CampaignSummary> {
  const h = await open(envOptions(o, `harness run ${experiment}`, o.dryRun ?? false));
  try {
    return await runCampaign(h.env, experiment, {
      sample: o.sample, repeats: o.repeats, reuseHistory: o.reuseHistory ?? false, dryRun: o.dryRun ?? false,
      concurrency: o.concurrency, seed: o.seed, maxPauseMs: o.maxPauseMin * 60_000,
    }, consoleIO);
  } finally {
    await h.close();
  }
}

/** One ad-hoc cell; records go to results/harness/cells, never into a campaign. */
export async function harnessCell(
  configId: string,
  taskId: string,
  o: HarnessCliOptions & { repeat: number },
  open: Opener = openHarnessEnv,
): Promise<CellResult> {
  const h = await open(envOptions(o, `harness cell ${configId} ${taskId}`, false));
  try {
    const env = { ...h.env, store: new RecordStore(join(o.resultsDir, "cells")) };
    const arm = await resolveArm(env, await loadConfig(env.harnessRoot, configId));
    const task = await loadTask(join(o.root, "harness-tasks", "tasks", taskId));
    const ids = await taskSetIdentity(o.root, [task], env.symbols);
    const r = await runCell(env, {
      campaignId: crypto.randomUUID(),
      block: { index: 0, task_id: taskId, repeat: o.repeat, order: [configId] },
      orderInBlock: 0, arm: configId, armManifest: arm.manifest, armManifestHash: arm.manifest_hash,
      task, taskVisibleHash: ids.tasks[0]!.visible, oracleHash: ids.tasks[0]!.oracle,
      refapp: await resolveRefapp(o.root, task.task.refapp_version),
    });
    for (const e of r.executions) {
      const j = (await env.store.judgments(e.id))[0];
      console.log(`${colors.green("[OK]")} ${e.id} ${e.termination}${j ? `, verdict ${j.verdict}` : ""} (raw log ${e.raw_log_path})`);
    }
    return r;
  } finally {
    await h.close();
  }
}

/** Judge stored executions again against the current oracle; the agent never re-runs. */
export async function harnessRejudge(
  experiment: string,
  o: HarnessCliOptions & { campaign?: string; execution?: string; all?: boolean },
  open: Opener = openHarnessEnv,
): Promise<number> {
  const h = await open(envOptions(o, `harness rejudge ${experiment}`, false));
  try {
    const env = h.env;
    const campaigns = await env.store.campaigns(experiment);
    const c = o.campaign ? campaigns.find((x) => x.id === o.campaign) : campaigns[0];
    if (!c) throw new ConfigurationError(`no campaign for experiment ${experiment}`);
    const { experiment: exp } = await loadExperiment(env.harnessRoot, experiment);
    const tasks = new Map((await loadTaskSet(tasksDirOf(o.root, exp.tasks))).map((t) => [t.task.id, t]));
    const refapps = new Map();
    for (const t of tasks.values()) {
      if (!refapps.has(t.task.refapp_version)) refapps.set(t.task.refapp_version, await resolveRefapp(o.root, t.task.refapp_version));
    }
    const d = await loadCampaignData(env.store, c);
    let n = 0;
    for (const e of d.executions) {
      if (o.execution && e.id !== o.execution) continue;
      if (e.workspace_hash === null) continue;
      const task = tasks.get(e.task_id);
      if (!task) continue;
      const current = await oracleHash(task);
      const done = (d.judgments.get(e.id) ?? []).some((j) => j.task_oracle_hash === current);
      if (done && !o.all) continue;
      const block = c.blocks.find((b) => b.task_id === e.task_id && b.repeat === e.repeat)!;
      const cell = cellRefFor(c, { campaign: c, created: false, tasks, refapps }, block, e.arm, e.order_in_block);
      const j = await rejudgeExecution(env, { ...cell, oracleHash: current }, e, current);
      console.log(`${colors.green("[OK]")} rejudged ${e.id}: ${j.verdict}`);
      n++;
    }
    return n;
  } finally {
    await h.close();
  }
}

export async function harnessImagesBuild(
  harness: string,
  o: { root: string; version?: string | undefined },
  docker: DockerCli = realDocker(),
): Promise<ImageFacts | null> {
  const harnessRoot = join(o.root, "harness");
  let args: string[];
  if (harness === "base") args = buildImageArgs(harnessRoot, "base");
  else {
    const base = await docker.inspectImage(BASE_IMAGE) as { Id?: string } | null;
    if (!base?.Id) throw new ConfigurationError(`build the base image first: harness images build base`);
    args = buildImageArgs(harnessRoot, harness, { version: o.version, baseDigest: base.Id });
  }
  const code = await docker.build(args);
  if (code !== 0) throw new ContainerError(`docker build exited ${code}`, harness, "setup");
  if (harness === "base") return null;
  const f = await imageFacts(docker, imageTag(harness, o.version!));
  console.log(`${colors.green("[OK]")} ${f.ref} ${f.digest} (base ${f.base_digest})`);
  return f;
}

export async function harnessSymbolsLock(
  o: { root: string; from: string; altool?: string | undefined; store: string },
  read?: ManifestReader,
): Promise<number> {
  const lock = await buildSymbolsLock(o.from, o.store, read ?? altoolReader(o.altool ?? defaultAltool(o.from)));
  await writeSymbolsLock(o.root, lock);
  console.log(`${colors.green("[OK]")} ${lock.packages.length} symbol packages locked; store ${o.store}`);
  return lock.packages.length;
}
```

In `registerHarnessCommand`, before the final `(cli as any).command("harness", parent)`:

```typescript
  const shared = (c: Command) =>
    c.option("--root <dir:string>", "Repository root", { default: "." })
      .option("--results-dir <dir:string>", "Harness records root", { default: "results/harness" })
      .option("--containers <names:string[]>", "BC containers the harness may use (required unless --dry-run)")
      .option("--backend-host <ip:string>", "Backend bind address (default: Docker nat gateway)")
      .option("--backend-port <n:integer>", "Backend port", { default: 3210 })
      .option("--secrets-dir <dir:string>", "Operator harness secret files", {
        default: Deno.env.get("CENTRALGAUGE_HARNESS_SECRETS") ??
          join(Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".", ".centralgauge", "harness-secrets"),
      })
      .option("--symbol-store <dir:string>", "Symbol store", { default: "results/harness/symbols" });

  // deno-lint-ignore no-explicit-any
  const cliOpts = (opts: any): HarnessCliOptions => ({
    root: opts.root, resultsDir: opts.resultsDir, containers: opts.containers, backendHost: opts.backendHost,
    backendPort: opts.backendPort, secretsDir: opts.secretsDir, symbolStore: opts.symbolStore,
  });

  shared(parent.command("run <experiment:string>", "Run or resume an experiment's campaign (spec 1a section 6)"))
    .option("--dry-run", "Plan and estimate only: no lock, no containers, no records")
    .option("--sample <n:integer>", "Stage 1: the first N tasks at repeat 1")
    .option("--repeats <n:integer>", "Run only blocks with repeat <= N")
    .option("--reuse-history", "Reuse scored executions of older campaigns (marked in the report)")
    .option("--concurrency <n:integer>", "Executions in parallel", { default: 1 })
    .option("--seed <n:integer>", "Arm-order seed for a new campaign")
    .option("--max-pause-min <n:integer>", "Sleep through a usage-limit pause up to this long", { default: 360 })
    .action((opts, experiment: string) =>
      fail(async () => {
        const s = await harnessRun(experiment, {
          ...cliOpts(opts), dryRun: opts.dryRun, sample: opts.sample, repeats: opts.repeats,
          reuseHistory: opts.reuseHistory, concurrency: opts.concurrency, seed: opts.seed, maxPauseMin: opts.maxPauseMin,
        });
        if (s.paused) Deno.exit(3);
      })
    );

  shared(parent.command("cell <config:string> <task:string>", "Run one ad-hoc cell (records under results/harness/cells)"))
    .option("--repeat <n:integer>", "Repeat index recorded on the execution", { default: 1 })
    .action((opts, config: string, task: string) =>
      fail(async () => {
        await harnessCell(config, task, { ...cliOpts(opts), repeat: opts.repeat });
      })
    );

  shared(parent.command("rejudge <experiment:string>", "Judge stored executions against the current oracle"))
    .option("--campaign <id:string>", "Campaign id (default: newest)")
    .option("--execution <id:string>", "Only this execution (its artifact)")
    .option("--all", "Also rejudge executions already judged against the current oracle")
    .action((opts, experiment: string) =>
      fail(async () => {
        const n = await harnessRejudge(experiment, { ...cliOpts(opts), campaign: opts.campaign, execution: opts.execution, all: opts.all });
        console.log(`${colors.green("[OK]")} ${n} rejudged`);
      })
    );

  parent.command(
    "images",
    new Command().description("Harness images").command("build <harness:string>", "Build a harness image (base first)")
      .option("--root <dir:string>", "Repository root", { default: "." })
      .option("--version <v:string>", "Harness version label (required except for base)")
      .action((opts, harness: string) =>
        fail(async () => {
          await harnessImagesBuild(harness, { root: opts.root, version: opts.version });
        })
      ),
  );

  parent.command(
    "symbols",
    new Command().description("Symbols lock").command("lock", "Lock and store the symbol packages of a folder")
      .option("--from <dir:string>", "Folder of .app symbol packages (BCH compiler-cache symbols)", { required: true })
      .option("--altool <path:string>", "altool.exe (default: next to the compiler cache)")
      .option("--root <dir:string>", "Repository root", { default: "." })
      .option("--store <dir:string>", "Symbol store", { default: "results/harness/symbols" })
      .action((opts) =>
        fail(async () => {
          await harnessSymbolsLock({ root: opts.root, from: opts.from, altool: opts.altool, store: opts.store });
        })
      ),
  );
```

- [ ] **Step 5: Run it and see it pass**

Run: `deno test --allow-all tests/unit/cli/commands/harness-command.test.ts`
Expected: all pass (Part 1's three plus the six new ones).

Run: `deno task start harness --help`
Expected: lists `validate`, `report`, `run`, `cell`, `rejudge`, `images`, `symbols`.

- [ ] **Step 6: Check, lint, format**

```bash
deno check cli/commands/harness-env.ts cli/commands/harness-command.ts cli/centralgauge.ts tests/unit/cli/commands/harness-command.test.ts
deno lint cli/commands/harness-env.ts cli/commands/harness-command.ts tests/unit/cli/commands/harness-command.test.ts
deno fmt cli/commands/harness-env.ts cli/commands/harness-command.ts tests/unit/cli/commands/harness-command.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add cli/commands/harness-env.ts cli/commands/harness-command.ts tests/unit/cli/commands/harness-command.test.ts
git commit -m "feat(harness): run, cell, rejudge, images build and symbols lock commands"
```

**Acceptance:** `deno test --allow-all tests/unit/cli/commands/harness-command.test.ts` passes; `deno task start harness --help` lists all seven subcommands; check, lint and `deno fmt --check` clean.

---

### Task M1-25: report Efficiency (backend side) and Slices

Spec 1a section 9 items 3 and 5: per arm, backend logical build requests, per-app compiles, test runs, diagnostics per build, queue wait, time to first green build (censored: reported as the share that reached one plus the median among those, never a missing median), wall time split into agent time and backend wait; the both-pass view as a descriptive table only; slices by task `kind` and `coupling`, exploratory. Findings section 8: provisioning latency reported separately from verdict latency. Trace-based columns (tool calls by transport, categories, tokens, skill invocation rates) need the M2 parsers and are not here.

**Cut order:** first to cut if the week runs late; Part 1's report already answers the primary question.

**Lane:** infra. **Deps:** M1-06 (`armSummary`), M1-08 (`cellsFromRecords`, `CellRecord`), M1-09/M1-10 (report command), M1-17 (verdict side files), M1-19 (host log), M1-23 (`loadCampaignData`).

**Files:**
- Create: `src/harness/efficiency.ts`
- Modify: `cli/commands/harness-command.ts` (`report` prints and emits the extras)
- Test: `tests/unit/harness/efficiency.test.ts`

**Interfaces:**
- Produces: `interface ArmEfficiency { arm; executions; backend_requests; logical_builds; per_app_compiles; test_runs; diagnostics_per_build: number | null; queue_ms_median: number | null; backend_ms_total: number; sandbox_wall_ms_total: number; infra_exposed: number; first_green: { reached: number; share: number | null; median_ms: number | null }; provisioning_ms_median: number | null; verdict_ms_median: number | null }`; `efficiency(resultsRoot, c: CampaignRecord, executions: ExecutionRecord[], judgments: Map<string, JudgmentRecord[]>): Promise<ArmEfficiency[]>`; `interface SliceRow { dimension: "kind" | "coupling"; value; arm; tasks; pass_rate: number | null; cost_per_solved_task: number | null }`; `slices(c, cells: CellRecord[]): SliceRow[]`; `interface BothPassRow { baseline; variant; both; only_baseline; only_variant; neither }`; `bothPass(c, cells): BothPassRow[]`; `renderExtras(e, s, b): string`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/efficiency.test.ts`:

```typescript
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { bothPass, efficiency, renderExtras, slices } from "../../../src/harness/efficiency.ts";
import type { CellRecord } from "../../../src/harness/outcome.ts";
import { campaign, execution } from "./fixtures.ts";

async function hostLog(root: string, rel: string, lines: object[]) {
  const p = join(root, rel);
  await Deno.mkdir(join(p, ".."), { recursive: true });
  await Deno.writeTextFile(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

const line = (op: string, outcome: string, atMs: number, extra: object = {}) => ({
  v: 1, request: "br_1", execution: "x", op, status: 200, outcome,
  at: new Date(Date.parse("2026-10-01T10:00:00.000Z") + atMs).toISOString(),
  spans: { queue_ms: 100, total_ms: 1000 }, apps_compiled: ["Core"], per_app_compiles: 2,
  diagnostics: 3, tests_run: op === "test" ? 5 : 0, tests_failed: 0, container: "C1", retries: 0, ...extra,
});

Deno.test("efficiency: backend units kept apart; first green build is a censored share", async () => {
  const root = await Deno.makeTempDir();
  const c = await campaign();
  const arm = c.arms[0]!.config_id;
  const e1 = execution(c, {}, { arm, started_at: "2026-10-01T10:00:00.000Z", host_log_path: "runs/e1/host-log.jsonl" });
  const e2 = execution(c, {}, { arm, started_at: "2026-10-01T10:00:00.000Z", host_log_path: "runs/e2/host-log.jsonl" });
  await hostLog(root, "runs/e1/host-log.jsonl", [
    line("compile", "failed", 10_000),
    line("compile", "ok", 60_000),
    line("test", "ok", 90_000),
  ]);
  await hostLog(root, "runs/e2/host-log.jsonl", [line("compile", "failed", 5_000)]);
  const [a] = (await efficiency(root, c, [e1, e2], new Map())).filter((x) => x.arm === arm);
  assertEquals([a!.backend_requests, a!.logical_builds, a!.per_app_compiles, a!.test_runs], [4, 4, 8, 1]);
  assertEquals(a!.diagnostics_per_build, 3);
  assertEquals(a!.first_green, { reached: 1, share: 0.5, median_ms: 60_000 });
});

Deno.test("slices and both-pass: descriptive tables by kind, coupling and matched cells", async () => {
  const c = await campaign();
  const [base, variant] = c.arms.map((a) => a.config_id);
  const task = c.task_set.tasks[0]!.id;
  const cell = (arm: string, pass: boolean): CellRecord => ({
    task, arm: arm!, repeat: 1, status: "scored", pass, spend_usd: 1, attempts: 1,
    used_execution: null, used_kind: "planned", judgment_id: null, oracle_hash: null, manual_reruns: 0,
  } as CellRecord);
  const cells = [cell(base!, true), cell(variant!, false)];
  const rows = slices(c, cells);
  const kind = c.tasks_meta.find((t) => t.id === task)!.kind;
  assertEquals(rows.filter((r) => r.dimension === "kind" && r.value === kind).length, 2);
  assertEquals(bothPass(c, cells)[0], { baseline: base, variant, both: 0, only_baseline: 1, only_variant: 0, neither: 0 });
  const text = renderExtras([], rows, bothPass(c, cells));
  assertStringIncludes(text, "descriptive only");
  assertEquals(/\bequal\b/i.test(text), false);
});
```

(The Part 1 fixture helpers `campaign(opts)` and `execution(c, sel, over)` are used as Part 1 defines them; adapt the selector argument if their shape moved at merge time.)

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/efficiency.test.ts`
Expected: FAIL, `Module not found ".../src/harness/efficiency.ts"`.

- [ ] **Step 3: Implement**

`src/harness/efficiency.ts`:

```typescript
/**
 * Report extras (spec 1a section 9): Efficiency from the host call logs and
 * verdict side files (backend side; trace columns arrive with M2), Slices by
 * kind and coupling, and the both-pass descriptive table. All exploratory.
 */

import { join } from "@std/path";
import type { CellRecord } from "./outcome.ts";
import type { CampaignRecord, ExecutionRecord, JudgmentRecord } from "./records.ts";
import { readHostLog } from "./backend.ts";
import { armSummary } from "./stats.ts";

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface ArmEfficiency {
  arm: string;
  executions: number;
  backend_requests: number;
  logical_builds: number;
  per_app_compiles: number;
  test_runs: number;
  diagnostics_per_build: number | null;
  queue_ms_median: number | null;
  backend_ms_total: number;
  sandbox_wall_ms_total: number;
  infra_exposed: number;
  /** Censored: share of executions that reached a green build, median among those. */
  first_green: { reached: number; share: number | null; median_ms: number | null };
  provisioning_ms_median: number | null;
  verdict_ms_median: number | null;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

export async function efficiency(
  resultsRoot: string,
  c: CampaignRecord,
  executions: ExecutionRecord[],
  judgments: Map<string, JudgmentRecord[]>,
): Promise<ArmEfficiency[]> {
  const out: ArmEfficiency[] = [];
  for (const arm of c.arms.map((a) => a.config_id)) {
    const es = executions.filter((e) => e.arm === arm);
    const a: ArmEfficiency = {
      arm, executions: es.length, backend_requests: 0, logical_builds: 0, per_app_compiles: 0, test_runs: 0,
      diagnostics_per_build: null, queue_ms_median: null, backend_ms_total: 0, sandbox_wall_ms_total: 0,
      infra_exposed: es.filter((e) => e.validity.infra_exposed).length,
      first_green: { reached: 0, share: null, median_ms: null },
      provisioning_ms_median: null, verdict_ms_median: null,
    };
    let diagnostics = 0;
    const queue: number[] = [];
    const green: number[] = [];
    const provisioning: number[] = [];
    const verdict: number[] = [];
    for (const e of es) {
      const lines = e.host_log_path ? await readHostLog(join(resultsRoot, e.host_log_path)) : [];
      const served = lines.filter((l) => l.outcome !== "rejected");
      a.backend_requests += served.length;
      for (const l of served) {
        if (l.op === "compile" || l.op === "test") a.logical_builds++;
        if (l.op === "test") a.test_runs++;
        a.per_app_compiles += l.per_app_compiles;
        diagnostics += l.diagnostics;
        a.backend_ms_total += l.spans.total_ms ?? 0;
        if (l.spans.queue_ms !== undefined) queue.push(l.spans.queue_ms);
      }
      const firstOk = served.find((l) => (l.op === "compile" || l.op === "test") && l.outcome === "ok");
      if (firstOk) green.push(Date.parse(firstOk.at) - Date.parse(e.started_at));
      const side = await readJson(join(resultsRoot, "runs", e.id, "sandbox.json"));
      const wall = (side?.sandbox as { wall_ms?: number } | null)?.wall_ms;
      if (typeof wall === "number") a.sandbox_wall_ms_total += wall;
      for (const j of judgments.get(e.id) ?? []) {
        const v = await readJson(join(resultsRoot, "verdicts", `${j.id}.json`));
        const spans = v?.spans as { provisioning_ms?: number; total_ms?: number } | undefined;
        if (spans?.provisioning_ms !== undefined) provisioning.push(spans.provisioning_ms);
        if (spans?.total_ms !== undefined) verdict.push(spans.total_ms - (spans.provisioning_ms ?? 0));
      }
    }
    a.diagnostics_per_build = a.logical_builds > 0 ? diagnostics / a.logical_builds : null;
    a.queue_ms_median = median(queue);
    a.first_green = {
      reached: green.length,
      share: es.length > 0 ? green.length / es.length : null,
      median_ms: median(green),
    };
    a.provisioning_ms_median = median(provisioning);
    a.verdict_ms_median = median(verdict);
    out.push(a);
  }
  return out;
}

export interface SliceRow {
  dimension: "kind" | "coupling";
  value: string;
  arm: string;
  tasks: number;
  pass_rate: number | null;
  cost_per_solved_task: number | null;
}

export function slices(c: CampaignRecord, cells: CellRecord[]): SliceRow[] {
  const groups: { dimension: SliceRow["dimension"]; value: string; tasks: Set<string> }[] = [];
  const add = (dimension: SliceRow["dimension"], value: string, task: string) => {
    let g = groups.find((x) => x.dimension === dimension && x.value === value);
    if (!g) groups.push(g = { dimension, value, tasks: new Set() });
    g.tasks.add(task);
  };
  for (const t of c.tasks_meta) {
    add("kind", t.kind, t.id);
    for (const cp of t.coupling) add("coupling", cp, t.id);
  }
  const rows: SliceRow[] = [];
  for (const g of groups) {
    for (const arm of c.arms.map((a) => a.config_id)) {
      const s = armSummary(cells.filter((x) => g.tasks.has(x.task)), arm, c.experiment.repeats);
      rows.push({
        dimension: g.dimension, value: g.value, arm, tasks: g.tasks.size,
        pass_rate: s.pass_rate, cost_per_solved_task: s.cost_per_solved_task,
      });
    }
  }
  return rows;
}

export interface BothPassRow {
  baseline: string;
  variant: string;
  both: number;
  only_baseline: number;
  only_variant: number;
  neither: number;
}

/** Matched scored (task, repeat) cells; descriptive only, never a winner (spec 1a section 9). */
export function bothPass(c: CampaignRecord, cells: CellRecord[]): BothPassRow[] {
  const baseline = c.experiment.baseline;
  const pass = (arm: string, task: string, repeat: number) =>
    cells.find((x) => x.arm === arm && x.task === task && x.repeat === repeat && x.status === "scored")?.pass ?? null;
  return c.experiment.variants.map((variant) => {
    const row: BothPassRow = { baseline, variant, both: 0, only_baseline: 0, only_variant: 0, neither: 0 };
    for (const b of c.blocks) {
      const x = pass(baseline, b.task_id, b.repeat);
      const y = pass(variant, b.task_id, b.repeat);
      if (x === null || y === null) continue;
      if (x && y) row.both++;
      else if (x) row.only_baseline++;
      else if (y) row.only_variant++;
      else row.neither++;
    }
    return row;
  });
}

const n = (v: number | null, d = 0) => v === null ? "n/a" : v.toFixed(d);

export function renderExtras(e: ArmEfficiency[], s: SliceRow[], b: BothPassRow[]): string {
  const out: string[] = ["", "Efficiency (exploratory, backend side; trace columns arrive with M2)"];
  for (const a of e) {
    out.push(
      `  ${a.arm}: ${a.executions} executions, ${a.backend_requests} backend requests, ${a.logical_builds} builds ` +
        `(${a.per_app_compiles} per-app compiles), ${a.test_runs} test runs, ${n(a.diagnostics_per_build, 1)} diagnostics/build, ` +
        `queue median ${n(a.queue_ms_median)} ms, infra-exposed ${a.infra_exposed}`,
      `    first green build: ${a.first_green.reached}/${a.executions} executions (${
        a.first_green.share === null ? "n/a" : `${(a.first_green.share * 100).toFixed(0)}%`
      }), median ${n(a.first_green.median_ms)} ms among those; provisioning median ${n(a.provisioning_ms_median)} ms, verdict median ${n(a.verdict_ms_median)} ms`,
    );
  }
  out.push("", "Slices (exploratory)");
  for (const r of s) {
    out.push(`  ${r.dimension}=${r.value} ${r.arm}: ${r.tasks} tasks, pass rate ${n(r.pass_rate, 2)}, cost per solved task ${r.cost_per_solved_task === null ? "n/a" : `$${r.cost_per_solved_task.toFixed(2)}`}`);
  }
  out.push("", "Both-pass (descriptive only, never used to pick a winner)");
  for (const r of b) {
    out.push(`  ${r.baseline} vs ${r.variant}: both ${r.both}, only baseline ${r.only_baseline}, only variant ${r.only_variant}, neither ${r.neither}`);
  }
  return out.join("\n");
}
```

In `cli/commands/harness-command.ts`, in the `report` action after the report is built: load the campaign's records with `loadCampaignData(new RecordStore(opts.resultsDir), report campaign)` and `cellsFromRecords`; with `--json`, print `{ ...report, efficiency, slices, both_pass }`; otherwise print `renderReport(report) + renderExtras(...)`.

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/efficiency.test.ts tests/unit/cli/commands/harness-command.test.ts`
Expected: all pass.

- [ ] **Step 5: Check, lint, format**

```bash
deno check src/harness/efficiency.ts cli/commands/harness-command.ts tests/unit/harness/efficiency.test.ts
deno lint src/harness/efficiency.ts cli/commands/harness-command.ts tests/unit/harness/efficiency.test.ts
deno fmt src/harness/efficiency.ts cli/commands/harness-command.ts tests/unit/harness/efficiency.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/harness/efficiency.ts cli/commands/harness-command.ts tests/unit/harness/efficiency.test.ts
git commit -m "feat(harness): report efficiency from host logs, slices and both-pass table"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/efficiency.test.ts` passes; check, lint and `deno fmt --check` clean.

---
## Ops tasks (lane-ops, real Docker and BC containers)

Common rules for M1-26 to M1-30:

- Before any step: no bench is live (`find results/.bench-running.json -mmin -2` prints nothing), the container lease is taken per `H:\cg-coord\leases\<container>`, and Cronus284 stays untouched (owner decision pending). Every harness command takes the bench lock itself.
- Ad-hoc docker and pwsh commands are prefixed with `DOCKER_CONTEXT=desktop-windows`. Ad-hoc pwsh imports the pin explicitly: `Import-Module bccontainerhelper -RequiredVersion 6.1.14` (bc-container-quirks.md).
- Evidence goes to `H:\cg-coord\tasks\<task-id>\runs\<nnn>\evidence.md` plus the raw files it quotes (JSON lines, logs) in the same folder. Every expected value below is a line the evidence file must quote verbatim or state as observed. A deviation is recorded, not fixed by ops; the orchestrator decides.
- Mock arms spend no provider money. No task here uses the Team account or OpenRouter.
- Code changes are lane-infra's. Ops commits only `harness-tasks/symbols.lock.json` (M1-26) and the evidence-driven field-name adjustment of the two hostile fixture files (M1-30), on the lane-ops branch.

---

### Task M1-26 (ops): host prerequisites: symbols lock, images, backend address

Findings section 6 (symbols: 263 apps from `C:\ProgramData\BcContainerHelper\compiler-cache-15ff3c5d109b\symbols\`, BC 28.4.53241.53758) and M0-06 carryover (record BC build and symbol provenance with the hashes), findings section 3 (image, node 22.19.0), secrets accepted-risk (no secret in image layers), M0-05 carryover (container-facing bind).

**Lane:** ops. **Deps:** M1-13, M1-19, M1-21, M1-24.

- [ ] **Step 1: altool manifest shape.** `& "C:\ProgramData\BcContainerHelper\compiler-cache-15ff3c5d109b\compiler\extension\bin\win32\altool.exe" GetPackageManifest "<one Microsoft_*.app from ...\symbols>"`. Quote the raw JSON. Expected: top-level `id`, `name`, `publisher`, `version` (the keys `altoolReader` parses). If they differ, stop and report (M1-13 must adapt).
- [ ] **Step 2: lock.** `deno task start harness symbols lock --from "C:\ProgramData\BcContainerHelper\compiler-cache-15ff3c5d109b\symbols"`. Expected: `[OK] 263 symbol packages locked` (or the actual count, quoted). If the lock fails on an `app_id` (Part 1 validates `z.uuid()`), quote the failing ids and stop (open question 9). Record: container artifact URL (`docker inspect Cronus281`), BC build, `sha256sum harness-tasks/symbols.lock.json`, store size.
- [ ] **Step 3: commit the lock** on the lane-ops branch: `git add harness-tasks/symbols.lock.json && git commit -m "chore(harness): symbols lock from BC 28.4.53241.53758 compiler cache"`.
- [ ] **Step 4: images.** `deno task start harness images build base`, then `deno task start harness images build mock --version 1`. Quote the final `[OK] centralgauge/harness-mock:1 sha256:... (base sha256:...)` line and `docker image inspect centralgauge/harness-mock:1 --format "{{json .Config.Labels}}"`.
- [ ] **Step 5: no secret in layers.** `docker history --no-trunc centralgauge/harness-mock:1 | grep -icE "token|api-key|oauth|secret"`. Expected: `0`.
- [ ] **Step 6: backend address.** `docker network inspect nat --format "{{range .IPAM.Config}}{{.Gateway}} {{.Subnet}}{{end}}"`. Quote gateway and subnet. Check the Windows firewall allows inbound TCP 3210 from that subnet only (`Get-NetFirewallRule | Where-Object DisplayName -like '*CentralGauge*'`); if absent, add it as admin: `New-NetFirewallRule -DisplayName "CentralGauge harness backend" -Direction Inbound -Protocol TCP -LocalPort 3210 -RemoteAddress <subnet> -Action Allow`, and quote the rule.
- [ ] **Step 7: identity.** `deno task start harness validate`. Expected once M4 has a task: `[OK] <n> tasks, task set <hash>` without `(provisional ...)`. Before M4: quote the documented expected failure.

**Acceptance (no container):** the evidence file quotes the altool JSON, the lock count and sha256, the two image digests and labels, `0` from the history grep, the gateway, subnet and firewall rule; on the lane-ops branch `deno eval "import { loadSymbolsLock } from './src/harness/identity.ts'; console.log((await loadSymbolsLock('.'))!.length)"` prints the same count.

---

### Task M1-27 (ops): candidate-scoped app sync on a real container

Findings section 8 "Broken: `prepareCandidateApp` cleanup removes refapp dependency apps" and the M0-02 carryover: prove the replacement keeps prerequisites installed, refreshes stale ones, removes candidates, and reports provisioning separately. Also verifies what the unit tests cannot: `Get-NAVAppInfo -Tenant default -TenantSpecificProperties` output, `Get-NAVAppInfo -Id`, stamped versions accepted by BC, dependency resolution with minimum versions. Memory note: Cronus28 hosts a Continia stack that defines codeunit 80013, inside the refapp Test range 80000-80099.

**Lane:** ops. **Deps:** M1-16 (`scripts/harness/app-sync-probe.ts`).

- [ ] **Step 1: run the probe on Cronus281.** `DOCKER_CONTEXT=desktop-windows deno run --allow-all scripts/harness/app-sync-probe.ts Cronus281 H:\Temp3\harness-m1\sync-281 > H:\cg-coord\tasks\M1-27\runs\001\probe-281.jsonl`.
- [ ] **Step 2: check each JSON line and quote it.**
  - `prenuke`: `after` has no `CGR ...` entry.
  - `a-fresh`: `after` lists all seven `CGR` apps installed; Core, Fleet, Leasing, Integration, Rental, Reporting at `1.0.<1..32767>.<n>`, Test at `1.0.0.0`; `rows` all `pass` (5 procedures, findings section 1); `deployed.provisioning_ms` and `deployed.candidate_publish_ms` both present.
  - `b-rental-changed`: `candidates` = Rental, Reporting, Test ids; the `before` and `after` entries for `CGR Core`, `CGR Fleet`, `CGR Leasing`, `CGR Integration` are identical (not republished); Rental and Reporting are now `1.0.0.0`; rows all pass.
  - `c-stale-core`: every prerequisite version differs from `a-fresh`; rows all pass.
  - `d-cleanup`: Rental, Reporting and Test gone, the other four still installed.
  - `e-after-bench-prenuke`: republished from nothing; rows all pass.
- [ ] **Step 3: uninstalled-but-published is listed.** `pwsh -c "Import-Module bccontainerhelper -RequiredVersion 6.1.14; Invoke-ScriptInBcContainer -containerName Cronus281 -scriptblock { Uninstall-NAVApp -ServerInstance BC -Name 'CGR Test' -Tenant default -Force }"`, then `deno eval "import {BcContainerProvider} from './src/container/bc-container-provider.ts'; const p = new BcContainerProvider(); p.setCredentials('Cronus281', {username:'sshadows', password:'1234'}); console.log(JSON.stringify(await p.listHarnessApps('Cronus281'))); await p.dispose();"`. Expected: `CGR Test` present with `"installed":false`. If it is absent, report it (the planner then cannot see such an app; `planAppSync` still removes every non-kept wanted id, so the risk is only foreign leftovers).
- [ ] **Step 4: Cronus28 collision check.** Repeat Step 1 on Cronus28 into `probe-28.jsonl`. Quote whether `a-fresh` publishes the Test app or fails with `already defined` (Continia codeunit 80013). If it fails, record that the harness must exclude Cronus28 until the refapp Test range avoids 80013 (open question 12).
- [ ] **Step 5: leave the containers clean.** `pwsh -c "Import-Module bccontainerhelper -RequiredVersion 6.1.14"` then run the bench prenuke via `deno eval` (`new BcContainerProvider().prenukeCentralGaugeApps(['Cronus281','Cronus28'])`) and quote the empty `CGR` listing.

**Acceptance (no container):** `probe-281.jsonl` has the six step lines; the `b-rental-changed` `before`/`after` arrays contain the same four prerequisite entries; every `rows[].outcome` is `pass`; Step 3 quotes `"installed":false`; Step 4 states the Cronus28 result.

---

### Task M1-28 (ops): `cg-al` round trip and backend negatives from a real sandbox

M0-05 carryover in production form: token from `C:\cg-secrets`, container-facing bind, 401/404/400 negatives including malformed JSON (not tested in M0-05), host call log spans; spec 1a section 5 item 4.

**Lane:** ops. **Deps:** M1-24, M1-26, M4 first task `HX-001` with `correct/` (and `refapp-v1` tagged).

- [ ] **Step 1: round trip.** `deno task start harness cell mock-cgal HX-001 --containers Cronus281`. From `results/harness/cells/.../runs/<id>/raw.jsonl` quote the two `mock_cg_al` lines (`exit_code` 0 for `compile` and `test`); from `host-log.jsonl` quote `br_1` (compile, ok) and `br_2` (test, ok, `tests_run` > 0) with their spans. Record `client.startup_ms`, `client.total_ms`, `result.backend_ms` for each call; transport = total minus backend.
- [ ] **Step 2: negatives.** `deno task start harness cell mock-hostile-probe-backend HX-001 --containers Cronus281`. Expected `mock_probe` statuses: `other-execution` 401, `oracle-path` 404, `list-apps` 404, `traversal` 400, `hidden-codeunit` 400, `malformed` 400. Quote them and the matching `rejected` host-log lines.
- [ ] **Step 3: bind and env.** Start `deno task start harness cell mock-sleep HX-001 --containers Cronus281` (1-minute timeout) and, while it runs: `netstat -ano | findstr :3210` (expected: listening only on the nat gateway address, never `0.0.0.0`), and `docker inspect $(docker ps -q --filter label=centralgauge.harness.owner=$env:COMPUTERNAME) --format "{{json .Config.Env}} {{json .Config.Cmd}}"` (expected: only `CG_BACKEND_URL` and `CG_EXECUTION_ID` besides the image defaults; no token, no key). After it ends: `Get-ChildItem $env:TEMP -Filter cg-harness-secrets-*` is empty.

**Acceptance (no container):** the evidence file quotes both `mock_cg_al` exit codes, the six probe statuses exactly as above, the host-log spans, the netstat line and the container env.

---

### Task M1-29 (ops): mock contract end to end

Spec 1a section 11 (a mock harness exercises the full pipeline on real containers; correct passes, naive fails; crash; timeout), section 8 (hard-kill capture, cleanup, sweep, resume), findings section 3 (last JSON line complete after a kill; no orphans), spec 1a section 12 item 6 (prove multi-app build, pass_to_pass, fail_to_pass and mutant_kill on the refapp slice).

**Lane:** ops. **Deps:** M1-24, M1-26, M1-27, M1-28, M4 slice (`refapp-v1`, at least one feature or bugfix task and one test-authoring task, each with `correct/` and at least two `naive/`).

- [ ] **Step 1:** `deno task start harness run mock-contract --dry-run` (quote the plan line and `n/a` estimate), then `... run mock-contract --sample 1 --containers Cronus281,Cronus282`, `... --repeats 1 ...`, and the full run. Quote the campaign id; it must be the same for all three.
- [ ] **Step 2:** `deno task start harness report mock-contract --json > report.json`. Expected: pass rate 1.00 for `mock-correct` and 0.00 for `mock-naive` on every task; the test-authoring task's `mutant_kill` scorer passed for `mock-correct`, with `target` values `reference`, `mutant:0` and each named mutant; efficiency section shows per-arm provisioning and verdict medians.
- [ ] **Step 3: timeout and hard kill.** `deno task start harness cell mock-sleep HX-001 --containers Cronus281`. Expected: termination `timeout`, a judgment exists, the last line of `raw.jsonl` parses as JSON (`Get-Content raw.jsonl -Tail 1 | ConvertFrom-Json`), and `docker ps -a --filter label=centralgauge.harness.owner=$env:COMPUTERNAME` is empty afterwards.
- [ ] **Step 4: crash and usage.** `... cell mock-crash HX-001` (expected: two executions, `harness_crash`, second `auto_retry`, no judgment); `... cell mock-usage HX-001` (expected: `usage_limited`, no judgment).
- [ ] **Step 5: sweep.** `docker run -d --name cg-harness-orphan00-00000000 --label centralgauge.harness.owner=$env:COMPUTERNAME centralgauge/harness-mock:1 powershell -Command "Start-Sleep 600"` and `docker run -d --name cg-harness-foreign0-00000000 --label centralgauge.harness.owner=someone-else centralgauge/harness-mock:1 powershell -Command "Start-Sleep 600"`. Run `... cell mock-correct HX-001`. Expected: `[WARN] removed 1 leftover sandbox container(s): cg-harness-orphan00-00000000`; the foreign one survives (then remove it by hand).
- [ ] **Step 6: killed runner.** Copy `harness/experiments/mock-contract.yml` to `mock-contract-kill.yml` (change `id` only), start `deno task start harness run mock-contract-kill --containers Cronus281`, and kill the deno process (`taskkill /F /PID <pid>`) while a sandbox container runs. Wait until the killed run's bench-lock marker is stale (2 minutes, `find results/.bench-running.json -mmin -2` prints nothing), then rerun the same command. Expected: the sweep line names the killed run's container, the campaign id is unchanged, and the run completes (`validateCampaignRecords` passed on resume). Delete the copy afterwards.
- [ ] **Step 7: container state.** After the runs, list apps (M1-27 Step 3 command): only prerequisite `CGR` apps remain, no Test candidate and no oracle app.

**Acceptance (no container):** the evidence file quotes the campaign id (same three times), the report pass rates and mutant targets, the timeout termination and the parsed last line, the crash and usage terminations, both sweep lines and the empty `docker ps`, and the final app listing.

---

### Task M1-30 (ops): hostile contract tests

Spec 1a section 11: "edit a shipped test to always pass, ship a hand-made `.app`, add a junction to a host path, change an app id, try to reach the oracle or another workspace through the backend, leave state behind for the next execution. Each must be caught."

**Lane:** ops. **Deps:** M1-29.

- [ ] **Step 1:** run each on Cronus281 with `deno task start harness cell <config> HX-001 --containers Cronus281` and record the verdict and the verdict side file (`results/harness/cells/verdicts/<judgment-id>.json`):

| Config | Expected |
| --- | --- |
| `mock-hostile-edit-tests` | verdict `fail` (naive code, shipped tests restored); the frozen workspace still holds the edited test file (the edit happened), the verdict side file has no violation |
| `mock-hostile-app` | verdict `fail`; the frozen workspace contains no `*.app`; no `.app` from the artifact was published (listing after the run) |
| `mock-hostile-junction` | frozen workspace has `.cg-freeze-violations.txt` naming `Rental/hostlink`; build `false`; verdict `fail` although the code is correct; the stored workspace does not contain `C:\Windows` content |
| `mock-hostile-app-id` | violation `Rental: id changed`; build `false`; verdict `fail` |
| `mock-hostile-probe-backend` | as M1-28 Step 2 (quote again) |

- [ ] **Step 2: leave state.** Check the `CGR Vehicle` table and key field in refapp-v1; if `"No."` differs, adjust the two fixture files under `tests/fixtures/harness/hostile/` (only the field or table name) and commit on the lane-ops branch. Run `... cell mock-leave-state HX-001 --containers Cronus281`, then `... cell mock-detect-state HX-001 --containers Cronus281`. Expected: the detect-state `mock_cg_al` test output shows `NoLeftoverState` passing. If it fails, record it as a finding (state survives the SOAP runner's isolation, contrary to spec 1a section 7) and stop.
- [ ] **Step 3: next execution is clean.** `... cell mock-correct HX-001 --containers Cronus281`: verdict `pass`.

**Acceptance (no container):** the evidence table has one observed line per row matching the expected column, the leave-state result, and the final `pass`.

---

## Integration gate (orchestrator)

After M1-24 (M1-25 if not cut) merges, on the merge tree; no container needed:

```bash
deno test --allow-all tests/unit/harness/ tests/unit/cli/commands/harness-command.test.ts tests/unit/scripts/id-audit.test.ts
deno check cli/centralgauge.ts src/harness/ cli/commands/harness-env.ts scripts/harness/app-sync-probe.ts
deno lint src/harness/ cli/commands/harness-command.ts cli/commands/harness-env.ts tests/unit/harness/ scripts/harness/
deno fmt --check src/harness/ tests/unit/harness/ cli/commands/harness-command.ts cli/commands/harness-env.ts scripts/harness/
deno task id-audit
deno task start harness --help
graphify update .
```

When no bench is live, also run the existing pure container-module tests the M1-15 edits touch: `deno test --allow-all tests/unit/container/bc-script-builders.test.ts tests/unit/container/bc-output-parsers.test.ts`.

Expected: all tests pass, check, lint, fmt clean, `id-audit` exits 0, help lists `validate`, `report`, `run`, `cell`, `rejudge`, `images`, `symbols`. The M1 milestone closes when M1-26 to M1-30 evidence is accepted.

## Self-review notes

- Every row of the traceability table names a task and a test or evidence line; the one requirement without an implementation is the accepted-risk egress condition (open question 1).
- Placeholders: none; each code step carries the code. Part 1 names are used as its revision 2 defines them; where a shape may still move (`CampaignRecords`, fixture selectors), the step says so.
- Types across tasks: `WantedApp` (M1-15) feeds `deploy` (M1-16); `Prepared.container` (M1-16) feeds `buildOracle` (M1-17); `HarnessEnv`/`CellRef`/`AttemptRef` (M1-22) feed M1-23 and M1-24; `BACKEND_VERSION` (M1-19) feeds `runtimeFacts` (M1-21); `mockImageBehavior` reads the `settings.json` shape M1-22 writes.

## Open questions

1. **Egress limitation is unimplemented.** The secrets accepted-risk decision is conditional on "egress limited to provider and backend", while spec 1a sections 1 and 12 put egress lockdown out of scope. The mock has no provider credential, so M1 is unaffected, but real-harness campaigns (M5) would run outside the accepted conditions. Options: a host-side Windows Firewall policy on the `nat` subnet (allowlist provider endpoints), an HTTP(S) proxy the sandbox must use, or an owner decision that the other three conditions suffice. Blocking for M5.
2. **D12 says agent calls and verdicts share `CompileQueuePool`.** It is typed to single LLM candidates and `prepareCandidateApp`; this plan reuses its concurrency and infra-retry parts through `BcLane` instead. Harness runs and benches never overlap (bench lock), so no bench queue is bypassed. Accept, or generalize `CompileQueuePool` (a larger refactor of the bench hot path)?
3. **Stamped prerequisite versions** (`major.minor.<1..32767>.<0..32767>`, candidates `major.minor.0.0`) replace a host-side ledger. M1-27 proves BC accepts them. Accept the approach?
4. **Candidate publish failures classified `unknown`** are treated as infra (the module's documented "throw as infra for safety"), so an unrecognized agent-caused install error ends unscored after the reroute. Alternative: score it as a failure when two containers agree.
5. **Agent-added `TestPage` tests** cannot run on the SOAP runner and are listed in the verdict side file but not scored; the legacy client-session path goes through `prepareCandidateApp`, which is forbidden here. Accept for 1a?
6. **`idRanges` are frozen.** refapp-v1's Test app declares 80000-80099, which leaves little room for test-authoring tasks; should M4 widen Test to 80000-84999 before tagging `refapp-v1`?
7. **`mutants/` band.** Part 1 listed `mutants/` under 85000-89999; this plan checks mutants like overlays (module folders in the refapp band), because a mutant is a production variant. Confirm.
8. **Mock arm config.** M1-21 lets `harness: mock` have no models and skips the catalog check for it, which touches Part 1's `config.ts`. The Part 1 reviser should confirm this is compatible with their revision.
9. **Symbols lock `app_id` uses `z.uuid()`** (RFC version and variant bits). If any of the 263 Microsoft package ids fails it, Part 1 must switch to a plain GUID pattern; M1-26 Step 2 finds out.
10. **Manual reruns.** Part 1 supports `run_kind: manual_rerun`, but spec 1a section 10 lists no command that creates one, so M1 has none. Needed for M5?
11. **Usage-limit pause.** The runner sleeps through a reset up to `--max-pause-min` (default 360) and otherwise stops with a resume line. Is 6 hours the right default for the Team account's five-hour window?
12. **Cronus28 and codeunit 80013.** The Continia stack on Cronus28 collides with the refapp Test range. A collision reroutes (infra), but a campaign on Cronus28 would waste a publish per verdict. Exclude Cronus28 from harness runs, or move the Test range? M1-27 Step 4 measures it.
13. **Base image pinning.** The base image is tag-pinned (`ltsc2025`) with the digest recorded as image provenance; the M0-06 review asked for digest pins, scheduled for the M3 toolchain. Pin the base `FROM` by digest in M1 already?
14. **`harness cell` records** go to a separate store (`results/harness/cells/`) and never appear in a report. Acceptable for authoring and ops checks?
15. **`harness rejudge` form.** Spec 1a says `rejudge <experiment|artifact>`; artifacts are keyed by execution id, so this plan implements `rejudge <experiment> [--execution <id>] [--campaign <id>] [--all]` and always judges against the current oracle files (a campaign-time oracle is not stored). Confirm.
16. **Freeze violations fail even correct code** (a junction or an oversize workspace fails the build scorer). This follows spec 1a section 7 literally; confirm it should also apply to harness-created links (none observed in M0).
17. **Throughput.** Default `--concurrency 1`. M0-02's 73.2 s per 7-app verdict plus agent time suggests 2-3 parallel executions for M5; the concurrency flag exists, the right default depends on M1-29 timings.
