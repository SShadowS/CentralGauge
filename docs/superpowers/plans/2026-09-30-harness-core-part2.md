# Harness Bench Core, Part 2 (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** By 2026-10-05, one narrow vertical slice runs end to end: HX-001 at `refapp-v1-rc1`, Claude Code in the Windows sandbox under supervision, a trusted host-side verdict on Cronus281, and the execution's cost in the records. The rest of Part 2 (mutant scoring, mock contract, campaigns, egress enforcement, report extras) follows in a separate "After 10-05" section, planned to finish before the 10-10 campaigns.

**Architecture:** Small files under `src/harness/` on top of Part 1 as implemented on master. Everything that touches Docker or a BC container sits behind two seams, `HarnessBc` (the `BcContainerProvider` methods the harness calls) and `DockerCli` (the docker verbs), so every unit test runs with fakes. Real-container behavior is proven only by lane-ops tasks with evidence files.

**Tech Stack:** Deno + TypeScript, Zod 4, `@std/path`, `@std/fs`, `@std/fmt/colors`, Cliffy `@cliffy/command@1.2.1`, git and `tar` on PATH; Docker Desktop (Windows containers, Hyper-V isolation), bccontainerhelper 6.1.14 and Claude Code 2.1.282 for the ops tasks only.

**Spec and binding inputs:** spec 1a `docs/superpowers/specs/2026-09-24-harness-bench-design.md`, spec 1b `2026-09-24-harness-refapp-design.md`, findings `2026-09-29-harness-spikes-findings.md` (section 8). Decisions under `H:\cg-coord\decisions\`: `accept-M0-02`, `accept-M0-03`, `accept-M0-05`, `accept-M1-02` (containment carryover), `secrets-accepted-risk`, `egress` (amends it), `gate-1002-moved`, `m1-metric-rules`, `m4-coverage-pilot`, `accept-M1-31`, `m1p2-round2`. Reviews: `H:\cg-coord\reviews\M1p2-plan-001\review-gpt6astra.md` (REJECT of 7bccd03b) and `H:\cg-coord\reviews\M1p2-plan-002\review-gpt6astra-round2.md` (REJECT of d8374fbc; revision 3 applies all 11 must-change items, mapped in the Schedule section), `H:\cg-coord\reviews\M4-plan-002\review-gpt6astra-round2.md` section 4 (classifier, RC tags, probe). Part 1: `docs/superpowers/plans/2026-09-30-harness-core.md` (final) and `src/harness/*.ts` on master.

**Revision 4 (2026-09-25, after round 3 ACCEPT-WITH-CHANGES, `H:\cg-coord\reviews\M1p2-plan-003\review-gpt6astra-round3.md`).** Applies B1 to B6 and the part-2 share of B7 (mapped in the Schedule section); M1-11 and M1-21 are unchanged from f6865359.

**Revision 3 (2026-09-25, for the third review round).** Applies the 11 round-2 must-change items and the owner decisions in `2026-09-25-m1p2-round2.md` (cache pricing by logged TTL; D12 amended to `BcLane`; P5 a hard predecessor; no NAT Allow rule; one shared five-run budget, fail closed) and the integrated M1/M4 schedule. No date moves.

**Revision 2 (2026-09-25).** Replanned as a vertical slice after the M1p2-plan-001 rejection and the owner decisions of 2026-09-25. The code in this plan has not been executed; the tests are the contract. Where Part 1 is still in implementation (M1-05 in review; M1-07, M1-07b, M1-08 not merged), this plan uses the names and shapes of the final Part 1 plan; if they move at merge, follow Part 1 and keep each test's intent.

## Reconciliation with Part 1 as implemented

Verified on master (`src/harness/{task,hash,config,identity,stats,yaml}.ts`) or in the final Part 1 plan:

- `hashFile(root, path)` takes the containing root (M1-02 ruling). Every call here passes one.
- `hashTree(dir, domain)`, `listTree(dir, domain)`, `isTaskBuildArtifact(rel)` (directory segments `.alpackages`, `output`; `*.app` files), `posixRel`.
- `resolveRefapp(repoRoot, version)` returns `{ version, commit, source_hash, files }`; `SymbolsLockSchema` `{ v: 1, packages: [{ app_id: z.uuid(), name, publisher, version, file, sha256 }] }`, duplicate ids case-insensitive; `loadSymbolsLock(repoRoot)`; `agentVisibleMetadata(task)`; `oracleHash(t)`; `taskSetIdentity(repoRoot, tasks, symbols)`.
- `config.ts` (M1-03) exports `checkModelsInCatalog(configs: HarnessConfig[], catalogDir: string): Promise<void>`; this plan calls `await checkModelsInCatalog([config], catalogDir)`.
- `records.ts` (M1-07) exports `TERMINATIONS`, `VERDICTS`, `RUN_KINDS`, `type Termination`, `type RunKind`, `outcomePolicy`, `retryChains`, `retryProblem`, `scorerFingerprint`, the record schemas and `RecordStore`. `outcome.ts` (M1-08) exports `JudgingContext`, `campaignJudging`, `checkJudging`, `selectJudgment`, `CellRecord`, `cellsFromRecords`. This plan imports `outcomePolicy`, `retryProblem` and `retryChains` from `records.ts`, never from `outcome.ts`. `ValiditySchema.incomplete_telemetry` accepts telemetry field names only; M1-22 adds the additive, defaulted `incomplete_observed` field for unverifiable components.
- `JudgmentRecord` requires `scorer_fingerprint = scorerFingerprint(scorer_versions)`. `CampaignRecord.tasks_meta` carries `limits`; `reuse` is `.max(0)` until historical reuse is implemented (After 10-05, M1-37).
- `Cell` carries `spend_usd` and `known_spend_usd`; `CellRecord` carries `scorer_fingerprint`. Cells come from `cellsFromRecords`, never reconstructed here.
- The mutant ID band: Part 1's carryover text says `mutants/` uses 85000-89999; this plan (and the M4 round-2 ruling, section 4 item 5) treats production-replacing mutants like overlays with module ids. M1-11 records the correction; the Part 1 doc is corrected by its owner.

## Global Constraints

- Lanes: code is lane-infra (stream A, coord lane `infra`) or lane-infra2 (stream B, coord lane `infra2`) and never touches Docker or a BC container. Anything that needs one is a lane-ops task with an evidence file under `H:\cg-coord\tasks\<id>\runs\<nnn>\evidence.md`. M1-31 (egress feasibility, ops) is already running and is not redefined here.
- Unit tests live in `tests/unit/harness/` and run as `deno test --allow-all <file>`; never `--parallel`, never `tests/unit/container/` while a bench is live. Unit-test temp dirs are created under an authorized root (`Deno.makeTempDir()` output passed through `validatedDir`, M1-12).
- Subprocess mocks: `tests/utils/command-mock.ts` (`Object.defineProperty(Deno, "Command", ...)`); it has no `spawn()`, so spawning code sits behind `DockerCli`.
- After each task: `deno check`, `deno lint`, `deno fmt` on that task's files only. Never `deno fmt` under `site/`. Zod 4 and `exactOptionalPropertyTypes` as Part 1. Import order per CLAUDE.md. `[OK]`/`[FAIL]`/`[WARN]`/`[PAUSE]` tags, no emoji. No em dash anywhere.
- Model ids are never hardcoded in code; configs name catalog slugs, the adapter maps them through `site/catalog/models.yml`.
- **Containment (M1-02 carryover, round 2 item 1).** Untrusted trees are copied only while quiescent (sandbox paused for backend snapshots, confirmed gone before the freeze). Every path goes through `validatedDir` / `safeCopyTree` (M1-12): absolute input only, drive-relative refused, the exact canonical path used afterwards, every entry re-resolved, every ancestor's identity re-checked before each open, destinations new or empty. Redaction happens only on a private copy, byte-wise.
- **Secrets and private state (M0-03 a, accepted-risk and egress decisions, round 2 item 3).** Never in argv, never in `docker run -e`, never in an image layer; only as files in a per-execution read-only `C:\cg-secrets` mount; minimum length 16 characters. Mutable workspaces, captures, secret custody, drafts and intents live under a private root outside `results/` (`%LOCALAPPDATA%\centralgauge\harness`); every published file (logs, trace, side file, record, frozen workspace) is redacted byte-wise (UTF-8 and UTF-16LE) with the attempt's custody secrets before it reaches `results/`, and publication is idempotent step by step.
- **Egress (decision 2026-09-25-egress and addenda, round 2 item 9).** Until the verified `authorized` state exists (M1-33/M1-34): at most 5 supervised credential-bearing runs **across all lanes**, reserved in one shared ledger (`CG_CREDENTIAL_LEDGER`) before any credential is released, started by a human at a terminal with `harness cell --supervised`, no automatic retries, Ctrl+C kills the sandbox at once. A marker whose verification fails stops every command (fail closed). Non-credential arms (mocks) run unattended.
- **Sandboxes (M0-03 b, round 2 item 2).** Create and capture inside the protected region; every docker verb bounded; `docker rm -f` status checked; termination confirmed (run settled, container absent) before any workspace processing, otherwise the intent is kept and nothing is frozen; capture output capped; startup sweep of `cg-harness-*` containers carrying this host's owner label; images run by immutable id with `--isolation hyperv`.
- **BC (bc-container-quirks.md, round 2 item 5).** `prepareCandidateApp` is never used or split for harness apps. Harness cleanup and publish run in one warm-slot script scoped to an explicit owned-id allowlist; one per-container ledger under `results/harness/bc-ledger/` for every caller, invalidated before each mutation; a failed cleanup quarantines the container in the lane; the lane records outcomes into `ContainerHealthMonitor`. Every Windows-container subprocess pins `DOCKER_CONTEXT` via `dockerContextEnv()`. Ad-hoc ops commands prefix `DOCKER_CONTEXT=desktop-windows` and import bccontainerhelper 6.1.14 explicitly.
- Containers: Cronus281 is the slice's container; Cronus282/283 are qualified before use for reroutes (M1-27). Cronus28 is excluded (codeunit 80013 collision) and Cronus284 is untouched (owner pending); `harness` refuses both by name.
- `acquireBenchLock` (dir `results`) is held by every harness command that touches containers, before any docker call.
- Latency: `performance.now()` host side, `[Diagnostics.Stopwatch]` inside PowerShell; wall-clock timestamps only as record fields.
- Records are Part 1's immutable records; anything they do not carry goes to side files under the execution's run dir or `verdicts/`.
- ID bands (1b section 4, M4): refapp 70000-74999 per module; Test app `idRanges` 80000-84999 with reserved subranges: shipped visible tests and library 80000-80099, task reference and naive test suites 80100-80999, hostile and harness fixtures 84900-84999; 80013 never used; hidden oracles 85000-89999 (HX-00N owns 85000+(N-1)*100 to +99); 75000-79999 reserved.
- After the last infra task of each section: `graphify update .`.

## Review Focus

1. **An agent plants a junction or a case alias in the workspace** (`Rental\src\link -> C:\`, `Test\src\shipped.test.al` next to `Shipped.Test.al`), and the copy follows it or overwrites a protected file. Expected: refused, recorded as a freeze violation, build fails. Pinned in M1-12 (`redirecting reparse points are refused`, `an ancestor swapped between the checks and the open stops the copy`, `case-ambiguous names are refused together (deterministic, any host)`) and M1-14 (`a case alias of a shipped test is a violation`).
2. **A backend request carries an agent-edited app.json with a foreign app id**, and the backend compiles, publishes or removes that app. Expected: snapshot validated against the grant's trusted apps before any BC call; removal only of owned ids. Pinned in M1-19 (`a changed app id is refused before any BC call`) and M1-15 (`unowned CentralGauge apps are preserved`).
3. **The runner is killed mid-run**, and a paid attempt disappears from the records. Expected: the intent journal recovers it at the next start as an execution with known or explicitly unknown cost. Pinned in M1-22 (`recovery: an interrupted attempt keeps its spend at the original prices`, `recovery: a crash after the <step> step completes exactly once`).
4. **A secret reaches `results/`** through a log, a side file or an error message, including after a crash. Expected: logs live in a private quarantine until redacted; every published surface is scanned; a quarantine is never published unredacted. Pinned in M1-12 (`redactBytes`, `freezeWorkspace: never writes the live tree`), M1-20 (`publishing is byte-safe`) and M1-22 (`every published surface is redacted (UTF-8 and UTF-16)`, `a crashed run leaves no unredacted log under results`).
5. **A lost `ASSERTERROR`, a missing procedure, or a mixed assertion+infra run** is scored differently from the M4 gate. Expected: lost ASSERTERROR is an assertion, missing or zero results are infra, mixed assertion+infra is infra (unscored). Pinned in M1-16 (`classification matches the M4 gate`, with the P5 texts) and M1-18 (`conformance fixture: assertion in A, missing B on a mutant is infra, not a kill`).

## Reuse

Reused as-is: Part 1 modules listed above; `BcContainerProvider` (`compileProject`, private `runScriptThroughSession`, `buildPwshError`, `getCredentials`, `soapConfigFor`, `ensureTestHarness`, `prenukeCentralGaugeApps`, `dispose`); `bcchImport`, `bcchConfigInit`, `escapeForPS`; `runTestsViaSoap`; `classifyPublishFailure`, `isCollisionPublishFailure`, `isInfraError`; `withInfraRetry`, `Mutex`, `Semaphore`, `NoEligibleContainersError`, `InfraRetriesExhaustedError`; `ContainerHealthMonitor` (`getState`, `record`); `dockerContextEnv`; `buildBindMountArg`; `acquireBenchLock`; `setupContainers`; `ConfigManager.loadConfig`; `readCatalog` (`src/ingest/catalog/read.ts`); `BENCHMARK_APP_ID_BUFFER`; `tests/fixtures/harness/claude-code/probe.jsonl` (M0-04 fixture). Spike code is read, never imported.

Not reused, with the reason: `CompileQueuePool` (typed to single LLM candidates and `prepareCandidateApp`; `BcLane` keeps its admission, health exclusion, rerouting and queue telemetry, D12 amended by the owner on 2026-09-25); `prepareCandidateApp`/`publishApp`/`cleanupStaleCandidates`/`runTests` (their cleanup removes the refapp dependencies, findings section 2); `WindowsSandboxProvider` (exec into a sleeping container, `-e` env, no owner label); `mcp/al-tools-server.ts` (binds 0.0.0.0).

## Answers to the review's open questions (reviewer recommendation adopted)

| # | Question | Answer in this plan |
| --- | --- | --- |
| 1 | Egress | Owner decisions 2026-09-25-egress (final form after M1-31 showed HNS endpoint ACLs are not enforced on this host): max 5 supervised dev runs across all lanes, reserved in one shared ledger before credential release (M1-22, M1-24, `scripts/harness/reserve-credential-run.ts` for M4-17); then an internal sandbox network with no uplink, a host allowlisting proxy, and the Windows Firewall on with default inbound and outbound ALLOW on every profile plus inbound BLOCK rules scoped to the sandbox vEthernet except the proxy and backend ports (M1-33 generates the rules and verifies the effective policy; M1-34 applies elevated with a tested per-invocation revert and before/after internet checks for every other container). Verified before credentials are released; a marker that fails verification stops every command; hard gate before unattended runs and the 10-10 campaigns. Every pre-enforcement credential (Claude OAuth, M4's OpenRouter key) is revoked and reissued before campaigns (M1-34). |
| 2 | CompileQueuePool | Separate `BcLane`, conditional on bounded compile admission (per-container `Semaphore`), health exclusion (alerted containers never selected), rerouting (`withInfraRetry`) and queue telemetry summed over retries, plus outcome recording into `ContainerHealthMonitor` and quarantine on a failed cleanup (M1-16). D12 amended by the owner (2026-09-25-m1p2-round2). |
| 3 | Stamped versions | Not the sole identity: a per-container ledger stores the full content stamp; a prerequisite is kept only when installed version and ledger stamp both match, and the stamp covers the symbols lock and the container's compiler identity (M1-15, M1-16); the ledger is invalidated before each mutation. Prerequisite versions are bumped above the pristine version so dependency minima hold. The build cache is deferred (M1-36). |
| 4 | Unknown publish failures | Infra (reroute, then unscored) until classified (M1-16). |
| 5 | TestPage | Not skipped: an agent-added `TestPage` codeunit fails `pass_to_pass` (M1-17), and a submitted `TestPage` codeunit fails `mutant_kill` (M1-18), each with the reason "TestPage tests are not supported by the harness test runner". |
| 6, 12 | Test ids, Cronus28 | M4 widened Test to 80000-84999; M1-11 enforces the reserved subranges and bans 80013; Cronus28 excluded (no harness script touches it, M1-27 lists it read-only), Cronus284 untouched. |
| 7 | Mutant bands | Production-overlay interpretation confirmed (M1-11); Part 1 wording corrected by its owner. |
| 8 | Mock models | Mock-only empty `models` (and only empty); catalog checks kept for every real config and added to `harness cell` (After 10-05, M1-35; the slice's real Claude config is catalog-checked in M1-24). |
| 9 | Symbol GUIDs | Checked early (M1-26, 09-29). If a Microsoft id fails `z.uuid()`, Part 1's lock schema switches to BC's GUID pattern (8-4-4-4-12 hex, case-insensitive) by its owner; generated execution ids keep `z.uuid()`. |
| 10 | Manual reruns | Not on the slice path. Before campaigns the owner decides on an explicit rerun command; retries already follow ancestry through `retryProblem`, including manual roots (M1-22, M1-23). |
| 11 | Usage pause | Configurable; reset state persisted in the run side file and honored on resume; concurrent limits combine to the latest reset; no automatic sleep in milestone ops (`--max-pause-min 0`) (M1-23). |
| 13 | Base pinning | Pinned now: `harness/images/pins.json` holds the servercore digest (M1-26 resolves it); every build passes it; the harness image is built from the inspected base and verified by layers; sandboxes run the image by its immutable id (M1-20, M1-24). |
| 14 | Cell store | `harness cell` uses `results/harness/cells/` as a complete results root (records, runs, workspaces, verdicts), so every relative pointer resolves inside it (M1-24). |
| 15 | Rejudge CLI | `rejudge <experiment> [--execution <id>]` with owner confirmation; requires unchanged visible inputs (restaged `visibleInputHash` equals the execution's), complete task coverage, record validation and the current scorer suite; always labeled against the current oracle (After 10-05, M1-24b). |
| 16 | Freeze violations | Build fails regardless of who created the link. |
| 17 | Throughput | Default concurrency 1 until measured; raised only with admission control and clean-container evidence. |

---

## Schedule

Two infra lanes (owner decision): stream A is coord lane `infra` (lane-infra) and finishes Part 1's record modules first (M1-05 review fixes, M1-07, M1-07b, M1-08 per the Part 1 plan, **accepted by the orchestrator by 09-29 end of day**, before M1-21 starts on 09-30); stream B is coord lane `infra2` (lane-infra2) and starts Part 2's boundary work at once. Container verification is lane-ops. No round-2 or round-3 fix moves a date. P5 is already accepted (decision `2026-09-25-accept-M4-16`); M1-16 consumes the accepted texts. M1-22's first commit (the shared credential budget and its reservation helper) is due 10-02, before M4-17's first pilot on 10-03.

**Vertical slice (gate 10-05):**

| Task | Lane | Deps | Date | What |
| --- | --- | --- | --- | --- |
| M1-11 | infra2 | none | 09-26 | id-audit bands, reserved Test subranges, 80013 ban |
| M1-12 | infra2 | M1-02 | 09-26 | containment: ancestor identity, deterministic case test, byte-safe redaction of a private freeze copy |
| M1-20 | infra2 | M1-12 | 09-27 | sandbox runtime: bounded verbs, confirmed termination, capture cap, interrupt, Hyper-V isolation |
| M1-13 | infra2 | M1-01, M1-02, M1-04, M1-12 | 09-28 | symbols lock (plus operator script), app graph, overlay, staging |
| M1-26 | ops | M1-13 | 09-29 | host checks: altool, GUIDs, lock, servercore digest, nat gateway, Hyper-V pause, pricing (no firewall rule) |
| M1-14 | infra2 | M1-11, M1-13 | 09-29 | verdict workspace; discovered `[Test]` procedures |
| M1-15 | infra2 | M1-13 | 09-30 | owned-id app sync; build identity in stamps; invalidate-before-mutate ledger |
| M1-21 | infra | M1-05, M1-07 (accepted) | 09-30 | adapter contract, TTL-aware pricing book, cost estimate, trace v1 |
| M1-16 | infra2 | M1-07, M1-15, M4-16 (P5 accepted) | 10-01 | BC lane: admission, health record, quarantine, compileOn, P5 classifier fixture, probe script |
| M1-32 | infra | M1-21 | 10-01 | Claude Code adapter, image (base passed in), cost parser with TTL split, budget flag |
| M1-17 | infra | M1-07, M1-14, M1-16 | 10-02 | verdict: build, pass_to_pass, fail_to_pass, full-suite fingerprint, oracle through admission |
| M1-19 | infra2 | M1-14, M1-16, M1-20 | 10-02 | `cg-al` backend: paused snapshot, atomic admission and revoke, bounded body, trusted identities |
| M1-27 | ops | M1-16, M4-03 accepted (rc1) | 10-02 | app sync on Cronus281 (read-only uninstalled check), qualify Cronus282/283 (10-03 morning) |
| M1-22 | infra | M1-07b, M1-09, M1-17, M1-19, M1-20, M1-32 | 10-02 (first commit: credential budget and `reserve-credential-run.ts`), 10-03 | execution: private state, custody phases, transactional publication, store-true recovery, versioned records, ancestry retries, backend faults |
| M1-24 | infra | M1-22 | 10-04 | CLI: `cell` (gate, interrupt), `judge-fixture` (persisted, `--rev`, manifest), `images build` (layer provenance), `symbols lock`; task revisions; qualification manifest schema |
| M1-28 | ops | M1-24, M1-27 | 10-04 | images, budget flag, verdict controls at rc1 (every naive), backend round trip |
| M1-29 | ops | M1-28, M4-16 (P5 accepted), M4-03 accepted | 10-05 | **gate:** supervised Claude Code cell, HX-001 at rc1, Cronus281 |

**After 10-05 (to finish before the 10-10 campaigns):**

| Task | Lane | Deps | Date | What |
| --- | --- | --- | --- | --- |
| M1-33 | infra | M1-31, M1-22, M1-24 | 10-06 to 10-08 | egress: internal network, rules on one interface index, effective-policy verifier, transactional apply/revert scripts, proxy, preflight before credentials |
| M1-18 | infra2 | M1-17, M1-14 | 10-06 (by 10-08) | `mutant_kill` on the HX-002 contract: pass_to_pass, expected procedures, per-mutant infra, M4 conformance fixture |
| M1-35 | infra2 | M1-22, M1-24 | 10-06 | mock adapter, image and arms from the shared qualification manifest |
| M1-23 | infra2 | M1-08, M1-09, M1-22, M1-35 | 10-07 | campaign runner (task overrides in `tasks_meta.limits`, ancestry retries) |
| M1-24b | infra2 | M1-23 | 10-08 | CLI `run`, `rejudge`, `qualify` |
| M1-34 | ops (elevated) | M1-33 | 10-08 to 10-09 | apply, verify, revert-test, recreate drill, authorize; rotate Claude and OpenRouter credentials |
| M1-30 | ops | M1-35, M1-24b | 10-08 | mock contract and hostile tests |
| M1-38 | ops | M1-18, M1-24b, M1-30, M4-05 accepted (rc2) | 10-09 morning | qualification at rc1/rc2, every named variant, persisted judgments |
| M1-25 | infra2 | M1-23 | 10-09 | report efficiency and slices (cut first) |
| M1-36 | infra or infra2 | M1-16 | after 10-10 | prerequisite build cache with a complete key |
| M1-37 | infra or infra2 | M1-23 | after 10-10 | historical reuse |

## Integrated M1/M4 schedule and handoff contract (round 2 item 11)

**Content-gate chain to the 10-05 gate** (no fallback, no waiver without the owner): P5 accepted (done: decision `2026-09-25-accept-M4-16`, integrated 6443bb31) -> M4-03 HX-001 gate accepted (10-01) -> orchestrator tags `refapp-v1-rc1` at the gated commit (by 10-02) -> M1-27 (10-02) -> M1-28 (10-04) -> M1-29 (10-05). The accepted P5 texts feed M1-16's classifier fixture (`tests/fixtures/harness/p5-messages.json`, copied verbatim from `H:\Temp3\harness-spike\M4-16-results.md`; no rerun). HX-002 at `refapp-v1-rc2` comes from M4-05 (10-02) and is needed only by M1-38 (10-09).

**One ops lane, per day** (M4 gate runs from the M4 plan's container budget: 168 interim gate runs, about 3.4 container-hours at 73 s per operation plus overhead; containers Cronus281 to Cronus283 only; Cronus28 and Cronus284 never; each job holds its container lease):

| Day | lane-ops jobs, in order | Containers |
| --- | --- | --- |
| 09-29 | M1-26 (host checks; Hyper-V pause on a throwaway servercore container) | none of the BC containers |
| 09-30 | M4-01a, M4-01b (per the M4 plan) | none |
| 10-01 | M4-01c, M4-03 HX-001 gate (10 runs) (M4-16 is already accepted) | M4-03 on Cronus281 |
| 10-02 | M1-27 Steps 1 to 4 and 6 (morning); M4-05 HX-002 gate (27 runs) | M1-27 on Cronus281; M4-05 on Cronus282 and Cronus283 |
| 10-03 | M1-27 Step 5 on Cronus282 then Cronus283 (morning, before any gate there); M4-07 HX-003 gate (10 runs); M4-17 HX-002 pilot (credential slot 1 of 5, reserved with `scripts/harness/reserve-credential-run.ts` from M1-22's 10-02 commit) | M1-27 then M4-07 on Cronus282/283; the pilot judges on Cronus281 |
| 10-04 | M1-28 (images, verdict controls at rc1, backend probe) | Cronus281 |
| 10-05 | M1-29 gate (credential slot 2); M4-09 HX-004 and HX-003 re-gate (20 runs) | M1-29 on Cronus281; M4-09 on Cronus282/283 |
| 10-06 | M4-11 HX-005 gate (12 runs); M4-17 HX-005 pilot (slot 3) | Cronus282/283; pilot judging on Cronus281 |
| 10-07 | M4-13 HX-006 gate (10 runs) | Cronus282/283 |
| 10-08 | M1-34 Steps 0 to 8 (morning; host-wide firewall change, **no job running during apply, revert and re-apply**); M1-30 (afternoon); M4-15 Step 1 stand-in re-gates start (79 runs) | M1-30 on Cronus281; M4-15 on Cronus282/283 |
| 10-09 | M1-34 Steps 9 to 12 (morning; enforced cell = slot 4); M1-38 (morning; judge-fixture and mock cells carry no credential, so it does not wait for M1-34); M4-15 re-gates finish, then its Step 3 real pipeline via `harness qualify` on the freeze manifest | M1-38 on Cronus281; M4-15 on Cronus282/283 |

Slot 5 of the shared credential ledger is the reserve for one repeat of M1-29 if its first run fails for an infra reason.

**Shared credential ledger.** One file for every lane: `H:\cg-coord\ledgers\credential-runs.jsonl`, set as `CG_CREDENTIAL_LEDGER` in every lane's environment. `harness cell` reserves through it (M1-22); M4-17's pilot runner reserves with `deno run --allow-all scripts/harness/reserve-credential-run.ts --lane lane-ops --task <HX-00N> --config <model> --purpose "M4-17 pilot"` before it releases the OpenRouter key. The sixth reservation is refused for everyone until M1-34 writes the `authorized` marker and the verification passes.

**Agreed M4-14 / M4-15 contract (round 3 B7; the M4 plan's Steps are updated to this text by the orchestrator).**
- M4-14 Step 3 writes `H:\Temp3\harness-spike\M4\freeze\qualify-manifest.json` exactly in this form (validated by `QualifyManifestSchema` from `src/harness/qualify.ts`):

```json
{
  "v": 1,
  "refapp_version": "refapp-v1",
  "tasks": {
    "HX-001": { "rev": "refapp-v1", "positive": "correct", "naive": ["<every folder under naive/>"] },
    "HX-002": { "rev": "refapp-v1", "positive": "reference-tests", "naive": ["drift-repro-only", "near-complete"] },
    "HX-003": { "rev": "refapp-v1", "positive": "correct", "naive": ["<every folder under naive/>"] },
    "HX-004": { "rev": "refapp-v1", "positive": "correct", "naive": ["<every folder under naive/>"] },
    "HX-005": { "rev": "refapp-v1", "positive": "correct", "naive": ["<every folder under naive/>"] },
    "HX-006": { "rev": "refapp-v1", "positive": "correct", "naive": ["count-sequence", "string-km", "always-description"] }
  }
}
```

  Every `naive` list names every folder under the task's `naive/` at the `rev` (M4-14's acceptance checks this with `git ls-tree`).
- M4-15 Step 3 runs exactly `deno task start harness qualify --manifest H:\Temp3\harness-spike\M4\freeze\qualify-manifest.json --containers Cronus282,Cronus283` (M1-24b) and reads `results/harness/qualify/<manifest sha256>/index.json`: one entry per `(task, variant)` with `judgment_path`, `provenance_path`, `verdict`, `expected` (`pass` for the positive, `fail` for each naive), `reasons` (failing oracle procedures, or surviving mutants for HX-002), `targets` (HX-002: `reference`, `mutant:0` and each named mutant) and `mock_cell` (the mock cell's execution id and verdict). M4-15's `pipeline.md` quotes that index; `task-set.json`'s `pipeline` entries copy `variant`, `judgment_path` (as `judgment`), `verdict` and `expected`.
- Both sides use the `refapp-v1` tag as `rev`; judging at that immutable revision is what makes the result independent of later working-tree edits.

**Qualification manifest (shared path, schema, route).** Schema `QualifyManifestSchema` in `src/harness/qualify.ts` (M1-24): `{ "v": 1, "refapp_version": "...", "tasks": { "HX-00N": { "rev": "<tag or commit>", "positive": "correct" | "reference-tests", "naive": ["<name>", ...] } } }`. M4-14 writes the freeze manifest at `H:\Temp3\harness-spike\M4\freeze\qualify-manifest.json` on 10-08 with `rev: "refapp-v1"` for all six tasks (cross-lane request to M4: add `v`, `refapp_version` and per-task `rev` to its Step 3 manifest). M1-38 uses its own manifest `H:\cg-coord\tasks\M1-38\qualify-rc.json` in the same schema with `rev: refapp-v1-rc1` (HX-001) and `refapp-v1-rc2` (HX-002). The route is the CLI option: `harness judge-fixture --manifest <path>` and `harness qualify --manifest <path>` (M1-24b); unit tests use temporary manifests, never `harness/qualify-manifest.json`.

**Immutable task revisions.** `harness cell --rev` and `harness judge-fixture --rev` load `harness-tasks/tasks/<id>` from `git archive` of that revision, so M4-14's working-tree repin to `refapp-v1` on 10-08 cannot change what M1-28 and M1-38 judge at rc1 and rc2. The judgment provenance records the rev, the commit and the task tree id (M4's `TASK TREE`).

**Persisted `judge-fixture` results.** `<results-dir>/fixtures/<task>/<variant>/<judgment-id>/judgment.json` (default `results/harness/fixtures/...`, built once from `--results-dir`) (the complete judgment: every scorer, every test row and target), `provenance.json` (variant tree hash, rev, commit, task tree, visible and oracle hashes, refapp, workspace hash, scorer fingerprint, containers) and the verdict log; `harness qualify` indexes them per manifest.

**M1-27 checks** (fixed): the uninstalled-app observation uses the probe's read-only `--list-only` mode after a `--keep` run; Cronus28 is only listed read-only with ad-hoc pwsh, never touched by a harness script.

## Round 3 blocking corrections (M1p2-plan-003) and where each is addressed

M1-11 and M1-21 are unchanged from f6865359 (they were being loaded); no round-3 item needed them.

| # | Correction | Tasks | Tested by |
| --- | --- | --- | --- |
| B1 | Slice-blocking contracts | M1-13 (overlay into scratch, validated merge), M1-24 (`loadTaskAt` creates its export dir), M1-22 (run dir always created; versioned execution `v: 2` with `incomplete_observed`, one version per campaign, report coverage), M1-16 (`HarnessBc.harnessCompilerIdentity` declared) | `applyOverlay: merges into a populated workspace ...`; `loadTaskAt` fresh-dir case; `a setup failure with no captures still writes its draft`; `execution v2` round trip, mixed-version campaign, coverage line |
| B2 | Cancellation end to end; bounded shutdown; failed unpause | M1-16 (signals in `compile`, `compileOn`, `exclusive`, `buildApps`), M1-19 (per-request deadline, production ops pass the signal, unpause fault), M1-22 (`onFault` stops the execution), M1-24 (bounded server shutdown) | `production ops: a revoke past the grace cancels before any further BC mutation`; `a request past its deadline is refused before any publish`; `a failed unpause is a 503 infra fault`; `a backend fault (failed unpause) stops the execution as infra` |
| B3 | Recovery isolation, custody fail-closed, cleanup protocol, secret-bearing names | M1-22 (intent results root, stored manifest, task snapshot, phases prepared/released/published, strict custody, cleanup after `published`), M1-12 (names and marker redaction) | cross-store/deleted-task/changed-limits recovery; custody missing after release; interruption inside cleanup; `secret-bearing file names and link names never reach the stored tree or the marker` |
| B4 | Quarantine before release; recheck after waits | M1-16 (`CleanupFailedError`, quarantine inside `exclusive`, `admit` after every wait, `compileOn` checks) | `tests throwing together with a cleanup failure quarantine the container before release`; `queued work is refused after its container is quarantined` |
| B5 | Incomplete firewall observations and broken probes fail closed | M1-33 (exact profile set, collector throws, probe `error` field, .NET ping under Windows PowerShell) | `verifyEgressState` `profiles` cases; `collectEgressState ... throws`; `evaluatePreflight` `could not run`; probe script test |
| B6 | Budget never reset on read failure | M1-22 (`reserveCredentialRun`) | `an unreadable ledger refuses; partial lines still count` |
| B7 (part 2 share) | Helper before the pilot; M4-14/M4-15 contract | M1-22 first commit 10-02; the agreed contract above | `credential-budget.test.ts` in the 10-02 commit; schema test in M1-24 |

Non-blocking notes applied: P5 wording (accepted, no rerun); `judge-fixture` output path built once from `--results-dir`. The M4 rows of B7 (HX-003 and HX-006 post-`asserterror` assertions) are fixed in the M4 plan by the orchestrator.

## Round 2 must-change items (M1p2-plan-002) and where each is addressed

| # | Item | Tasks | Tested by |
| --- | --- | --- | --- |
| 1 | Containment incl. the pre-freeze redactor | M1-12, M1-19, M1-20, M1-22, M1-26 | quiescence (paused snapshot, confirmed-gone freeze); `fsutil.test.ts` ancestor-swap, junction-after-listing, destination, deterministic case test, `redactBytes`/`redactTree`, freeze never writes the live tree; `backend.test.ts` paused snapshot |
| 2 | Bounded timeout, revocation, interrupt | M1-20, M1-19, M1-22, M1-24 | `sandbox.test.ts` hung kill/rm, interrupt, overflow, lingering container; `backend.test.ts` revoke-during-check, revoke-abort, stalled body; `execution.test.ts` unconfirmed termination; `harness-command.test.ts` Ctrl+C |
| 3 | Idempotent publication, custody, private workspaces, durable inputs, unknown cost | M1-22, M1-12 | `execution.test.ts` crash after each step, rotated credential, UTF-16 and workspace leaks, original prices, task changed, failure after spawn |
| 4 | Part 1 interfaces and launch blockers | M1-22, M1-24, M1-23, M1-32, M1-20, M1-21 | `outcomePolicy`/`retryProblem` from `records.ts`; `await checkModelsInCatalog([config], catalogDir)`; `tasks_meta.limits` overrides test (M1-23); ancestry retries and `usage_reset_at`; file-component hash; `incomplete_observed`; base passed and layer provenance; `--isolation hyperv`; images by immutable id; oracle ids only where an oracle exists |
| 5 | Build identity and BC lifecycle | M1-15, M1-16, M1-17, M1-24 | changed lock or compiler moves stamps; invalidate-before-sync; cleanup failure quarantines; health record; oracle through `compileOn`; one ledger root |
| 6 | M1-18 on the HX-002 contract | M1-18, M1-14 | real scorer list with pass_to_pass; discovered procedures; per-mutant infra keeps earlier survivor; TestPage rejected; M4 conformance fixture |
| 7 | Effective firewall verification; no NAT Allow rule | M1-33, M1-26 | `verifyEgressState` mutations (disabled, direction, action, profile, filters, interface index, recreation); M1-26 creates no rule |
| 8 | M1-34 bootstrap, revert, no-regression | M1-34, M1-33 | ordered states candidate/qualified/authorized; listeners before checks; per-invocation rollback and archived revert; pinned Linux commands; complete baseline; Claude and OpenRouter rotation; probe shipped and bounded |
| 9 | One shared five-run budget; fail closed | M1-22, M1-24 | `credential-budget.test.ts`; `resolveEgress` stale marker stops; `cellGate` unattended mocks |
| 10 | Cost completeness and pricing | M1-21, M1-32, M1-22 | missing field and unknown TTL give null; TTL-priced probe; book persisted in the intent (original-price recovery test); `--max-budget-usd` and `enforcesBudget` |
| 11 | Integrated M1/M4 schedule and handoff | this section, M1-24, M1-27, M1-38 | `task-rev.test.ts`; persisted judgment and provenance test; manifest refusals; M1-27 read-only checks |

## Traceability: requirements and resubmission gates

| Requirement (source) | Task | Container-free acceptance |
| --- | --- | --- |
| Gate 1: exact containment and a quiescent copy boundary (M1-02, M0-05 TOCTOU) | M1-12, M1-19 | `fsutil.test.ts` drive-relative, linked-ancestor, case-alias, deterministic case-ambiguity, ancestor swap, junction after listing, destination tests; `backend.test.ts` paused snapshot, links not followed |
| Gate 2: backend authorization, cleanup scope, redaction, timeout | M1-19, M1-15, M1-16, M1-20, M1-22 | `backend.test.ts` crossed grants, streamed oversize and stalled bodies, atomic revoke, changed app id refused before any BC call; `bc-apps.test.ts` unowned apps preserved; `bc-lane.test.ts` cleanup failure quarantines; `sandbox.test.ts` bounded verbs; `execution.test.ts` every published surface redacted |
| Gate 3: Part 1 interfaces | reconciliation section, M1-17, M1-22, M1-23 | judgments with the full-suite fingerprint; records pass `validateCampaignRecords`; ancestry retries through `retryProblem`; `tasks_meta.limits` overrides |
| Gate 4: locked compile inputs, safe identity | M1-16, M1-15 | locked symbols seen by the compiler; unlocked package refused; build identity in stamps; invalidate-before-sync |
| Gate 5: interruption recovery preserving attempts and spend | M1-22 | crash after each publication step; original pricing; custody secrets |
| Gate 6: dated Claude Code slice with an owner-approved security gate | schedule, M1-32, M1-24, M1-29 | `claude-code.test.ts`; `credential-budget.test.ts`; `harness-command.test.ts` cell gate, interrupt, fail-closed egress |
| No secret in any argv (M0-03 a) | M1-20, M1-32, M1-24 | argv/env scan; `run.ps1` token by env only; operator scripts read credentials from files |
| Create/capture in try, checked rm, sweep (M0-03 b) | M1-20, M1-24 | capture-open and spawn failures, rm failure, lingering container, hung verbs, bounded sweep |
| Accepted-risk conditions | M1-20, M1-22, M1-24, M1-33, M1-34 | byte-safe redaction from custody; shared five-run ledger; M1-33 tests; M1-34 evidence |
| Scoped short-lived tokens, timing-safe digests (M0-05) | M1-19 | crossed grants; digest compare; expiry; atomic revoke |
| Container-facing bind (M0-05) | M1-19, M1-26, M1-33 | `serve refuses wildcard and non-allowed addresses`; proxy bind test; M1-26 gateway evidence |
| Malformed JSON 400 (M0-05) | M1-19 | malformed and truncated bodies |
| Monotonic timing (M0-05) | M1-15, M1-16, M1-19 | Stopwatch publish spans; `performance.now()` host spans; client `script_ms` |
| Candidate-scoped cleanup, persistent prerequisites, stale refresh, provisioning latency (M0-02) | M1-15, M1-16, M1-27 | `bc-apps.test.ts`; `bc-lane.test.ts`; M1-27 evidence |
| id-audit bands (M0-01) | M1-11 | `id-audit.test.ts` |
| Cost basis: estimated list price by logged TTL, reported kept (findings 8, owner decision) | M1-21, M1-32 | `pricing.test.ts`, `claude-code.test.ts` |
| Classifier parity with the M4 gate | M1-16, M1-18 | P5 fixture texts; M4 conformance fixture |
| Spec 1a sections 4-11 not deferred | M1-12..M1-24 | per-task tests |

---

# Part A: vertical slice (gate 10-05)

### Task M1-11: id-audit bands, reserved Test subranges, 80013 ban

M0-01 carryover (no band rule for `harness-tasks/`), spec 1b section 4, M4 constraints (Test app 80000-84999, 80013 never used because Cronus28 hosts a foreign 80013), review answers 6, 7, 12. Subranges: shipped visible tests and the test library 80000-80099; task reference and naive test suites 80100-80999; harness and hostile fixtures (`tests/fixtures/harness/**/Test/`) 84900-84999. `overlay/`, `correct/`, `naive/<v>/` and `mutants/<m>/` mirror the workspace: module folders get the refapp band, `Test/` folders the suite band. `oracle/` is 85000-89999.

**Doc note for Part 1 (coordinated correction):** Part 1's carryover text lists `mutants` under 85000-89999. Production-replacing mutants keep their module's ids (M4 round-2 ruling section 4 item 5); hidden support objects, if any are ever added, go under `oracle/`. The Part 1 owner corrects that sentence; this task implements the corrected rule.

**Lane:** infra2 (stream B). **Deps:** none. **Date:** 09-26.

**Files:**
- Modify: `src/constants.ts`, `scripts/id-audit.ts`
- Test: `tests/unit/scripts/id-audit.test.ts` (append)

**Interfaces:**
- Produces: `HARNESS_SHIPPED_TEST_RANGE = { start: 80000, end: 80099 }`, `HARNESS_TASK_SUITE_RANGE = { start: 80100, end: 80999 }`, `HARNESS_FIXTURE_TEST_RANGE = { start: 84900, end: 84999 }`, `HARNESS_TEST_APP_RANGE = { start: 80000, end: 84999 }`, `HARNESS_ORACLE_RANGE = { start: 85000, end: 89999 }`, `HARNESS_FORBIDDEN_IDS = [80013]` (constants.ts; M1-14 imports them).

- [ ] **Step 1: Write the failing test** (append)

```typescript
Deno.test("harness-tasks: units, bands, reserved subranges, 80013", async (t) => {
  const f = (file: string, id: number) => obj({ file, unit: unitOf(file), id });
  const shipped = "harness-tasks/refapp/Test/src/RentalTests.Codeunit.al";
  const core = "harness-tasks/refapp/Core/src/A.Codeunit.al";
  const oracle = "harness-tasks/tasks/HX-001/oracle/src/O.Codeunit.al";
  const refTests = "harness-tasks/tasks/HX-002/reference-tests/Test/src/L.Codeunit.al";
  const naiveTests = "harness-tasks/tasks/HX-002/naive/near-complete/Test/src/N.Codeunit.al";
  const mutant = "harness-tasks/tasks/HX-002/mutants/off-by-one/Leasing/src/M.Codeunit.al";
  const fixture = "tests/fixtures/harness/hostile/leave-state/Test/src/H.Codeunit.al";

  await t.step("unitOf", () => {
    assertEquals(unitOf(shipped), "refapp:Test");
    assertEquals(unitOf(oracle), "harness-oracle:HX-001");
    assertEquals(unitOf(refTests), "harness-reference-tests:HX-002:Test");
    assertEquals(unitOf(naiveTests), "harness-naive:HX-002:near-complete:Test");
    assertEquals(unitOf(mutant), "harness-mutants:HX-002:off-by-one:Leasing");
    assertEquals(unitOf(fixture), "harness-fixture:Test");
  });

  await t.step("in-band objects pass", () => {
    assertEquals(
      auditObjects([
        f(core, 70001), f(shipped, 80010), f(oracle, 85001), f(refTests, 80100),
        f(naiveTests, 80101), f(mutant, 70310), f(fixture, 84998),
      ]).problems,
      [],
    );
  });

  await t.step("out-of-band objects fail", () => {
    const p = auditObjects([
      f(core, 80001), f(shipped, 80150), f(oracle, 80001), f(refTests, 80050),
      f(fixture, 80098), f(mutant, 85001),
    ]).problems;
    assertEquals(p.length, 6);
    assertStringIncludes(p[1]!, "shipped visible test band");
    assertStringIncludes(p[3]!, "task test suite band");
    assertStringIncludes(p[4]!, "harness fixture band");
  });

  await t.step("80013 is refused everywhere in harness content", () => {
    const p = auditObjects([f(shipped, 80013), f(refTests, 80013)]).problems;
    assertEquals(p.filter((x) => x.includes("80013")).length, 2);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/scripts/id-audit.test.ts`
Expected: FAIL at `unitOf` (`unclassified:...`).

- [ ] **Step 3: Implement**

`src/constants.ts`, after `TEST_CODEUNIT_ID_RANGE`:

```typescript
/** Harness Bench Test app (spec 1b section 4, M4): the declared idRanges. */
export const HARNESS_TEST_APP_RANGE = { start: 80000, end: 84999 } as const;
/** Shipped visible tests and the test library. */
export const HARNESS_SHIPPED_TEST_RANGE = { start: 80000, end: 80099 } as const;
/** Task reference-tests and naive test suites. */
export const HARNESS_TASK_SUITE_RANGE = { start: 80100, end: 80999 } as const;
/** Harness and hostile fixture tests. Agents may not use it. */
export const HARNESS_FIXTURE_TEST_RANGE = { start: 84900, end: 84999 } as const;
/** Hidden oracle apps. */
export const HARNESS_ORACLE_RANGE = { start: 85000, end: 89999 } as const;
/** Ids that collide with foreign apps on shared containers (Cronus28: 80013). */
export const HARNESS_FORBIDDEN_IDS = [80013] as const;
```

`scripts/id-audit.ts`: import the five ranges and `HARNESS_FORBIDDEN_IDS`. In `unitOf`, before the final return:

```typescript
  const refapp = /^harness-tasks\/refapp\/([^/]+)\//.exec(file);
  if (refapp) return `refapp:${refapp[1]}`;
  if (/^tests\/fixtures\/harness\/.*\/Test\//.test(file)) return "harness-fixture:Test";
  const task =
    /^harness-tasks\/tasks\/([^/]+)\/(overlay|correct|naive|mutants|oracle|reference-tests)\/(.+)$/
      .exec(file);
  if (task) {
    const [, id, part, rest] = task;
    if (part === "oracle") return `harness-oracle:${id}`;
    const segs = rest!.split("/");
    const variant = part === "naive" || part === "mutants" ? `:${segs.shift()}` : "";
    return `harness-${part}:${id}${variant}:${segs[0]}`;
  }
```

In `bandOf`, before `return null`:

```typescript
  const refappBand = { label: "refapp", ...BENCHMARK_APP_ID_RANGE };
  if (unit === "refapp:Test") return { label: "shipped visible test", ...HARNESS_SHIPPED_TEST_RANGE };
  if (unit.startsWith("refapp:")) return refappBand;
  if (unit === "harness-fixture:Test") return { label: "harness fixture", ...HARNESS_FIXTURE_TEST_RANGE };
  if (unit.startsWith("harness-oracle:")) return { label: "harness oracle", ...HARNESS_ORACLE_RANGE };
  if (/^harness-(overlay|correct|naive|mutants|reference-tests):/.test(unit)) {
    return unit.endsWith(":Test")
      ? { label: "task test suite", ...HARNESS_TASK_SUITE_RANGE }
      : refappBand;
  }
```

In `auditObjects`, inside the range loop after the buffer check:

```typescript
    const harnessUnit = /^(refapp|harness-)/.test(obj.unit);
    if (harnessUnit && (HARNESS_FORBIDDEN_IDS as readonly number[]).includes(obj.id)) {
      problems.push(`${obj.file}: ${obj.kind} ${obj.id} is forbidden in harness content (collides with a foreign app on Cronus28)`);
    }
```

Overlays under `Test/` are task suites by this rule (M4: task content never replaces shipped tests; visible tests live in the refapp).

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/scripts/id-audit.test.ts` then `deno task id-audit`
Expected: all pass; `id-audit` exits 0 on the current tree (M4 content follows these bands).

- [ ] **Step 5: Check, lint, format** (`deno check|lint|fmt scripts/id-audit.ts src/constants.ts tests/unit/scripts/id-audit.test.ts`)

- [ ] **Step 6: Commit**

```bash
git add scripts/id-audit.ts src/constants.ts tests/unit/scripts/id-audit.test.ts
git commit -m "feat(id-audit): harness bands, reserved Test subranges and the 80013 ban"
```

**Acceptance:** `deno test --allow-all tests/unit/scripts/id-audit.test.ts` passes and `deno task id-audit` exits 0.

---

### Task M1-12: containment copy boundary, byte-safe redaction, private freeze

Spec 1a section 7 item 4 (refuse symlinks, junctions and other reparse points), section 5 item 6 (freeze = copy, then hash), M1-02 carryover (operate on the exact validated absolute path; reject drive-relative input and case ambiguity; with tests), M0-05 carryover (TOCTOU, resource limits), review gate 1 and round-2 item 1 (ancestor swaps, redirecting reparse points, destinations; the redactor uses the same containment policy on a private copy).

**Quiescence first.** Every caller copies a quiescent source: the backend pauses the sandbox for the snapshot (`docker pause` under Hyper-V isolation, M1-19; M1-26 proves pause works on this host), and the freeze runs only after the container is confirmed gone (M1-20 `confirmedGone`, M1-22). Pathname traversal is then safe because no agent process can run. The checks below are defense in depth that also detect a concurrent writer:
- **Roots** go through `validatedDir`: absolute only, drive-relative (`C:foo`) refused, `Deno.realPath` must equal the given spelling (same case, no link, junction or short name anywhere above), and the returned canonical string is the only path used afterwards.
- **Entries**: `lstat` must be a plain file or directory with a known `(dev, ino)`; `realPath(entry)` must equal `join(canonicalParent, name)` (this refuses every reparse point that redirects, whatever its tag, and a directory swapped for a junction after listing); names in one directory that differ only by case are refused together.
- **Ancestors**: every directory's `(dev, ino)` is recorded when it is entered; before each file is opened the whole ancestor chain is re-checked (not a link, same identity, same canonical path). A swapped ancestor stops the copy.
- **Files** are opened and the handle's `(dev, ino)` must equal the pre-open `lstat`; bytes are counted while reading, so a file that grows past the limit stops the copy.
- **Destinations** are created one level at a time under a validated parent (`validatedDest`) and must be new or empty; the destination is always private to the harness.
- **Limits**: files, bytes, directories and depth.
- **Redaction** never touches the live tree: `freezeWorkspace` copies the quiescent workspace into a private scratch directory (outside `results/`), redacts the private copy byte-wise (`redactTree`: every secret as UTF-8 and as UTF-16LE bytes, longest first, no word-boundary assumption), refuses files larger than `MAX_SCAN_BYTES` (removed from the copy and recorded as a freeze violation, so the build fails), and only then hashes and publishes the copy under `results/harness/workspaces/`.
- **Names are scanned too** (round 3 B3): after content redaction, any file or directory whose name contains a secret is removed from the private copy and reported with the name redacted; the violations marker is itself redacted before it is written and hashed, so a secret in a refused link's name never reaches `results/`.
- The case-ambiguity rule is proven by a deterministic test through the `listDir` seam; the host case-sensitive-directory test is an additional check only and never counts as proof when it is skipped.

On this host `Deno.realPath("u:/git/centralgauge")` returns `U:\Git\CentralGauge`, and `lstat` reports `ino` and `dev` on NTFS (checked 2026-09-25).

**Lane:** infra2 (stream B). **Deps:** M1-02 (`hashTree`, `isTaskBuildArtifact`). **Date:** 09-26.

**Files:**
- Create: `src/harness/fsutil.ts`
- Test: `tests/unit/harness/fsutil.test.ts`

**Interfaces:**
- Produces: `FREEZE_VIOLATIONS_FILE`; `MAX_SCAN_BYTES = 64 MiB`; `interface SecretValue { name; value }` (re-exported by M1-20's `sandbox.ts`); `redactBytes(data: Uint8Array, secrets): { out: Uint8Array; count: number }`; `redactTree(dir, secrets, maxScanBytes?): Promise<{ count: number; violations: string[] }>`; `interface CopyLimits { maxFiles; maxBytes; maxDirs; maxDepth }`; `DEFAULT_COPY_LIMITS`; `class CopyLimitError extends ValidationError`; `validatedDir(p)`; `validatedDest(p)`; `interface CopyReport { files; bytes; dirs; refused: string[]; ambiguous: string[] }`; `interface CopyOptions { skip?; limits?; beforeOpen?(rel); afterList?(rel); listDir?(dirAbs): Promise<string[]> /* test seams */ }`; `safeCopyTree(src, dst, opts?): Promise<CopyReport & { src; dst }>`; `interface FreezeInput { resultsRoot; privateRoot; workspace; secrets: SecretValue[]; limits?; maxScanBytes? }`; `interface Frozen { workspace_hash; stored_path; violations; redactions }`; `freezeWorkspace(i: FreezeInput): Promise<Frozen>`; `sweepWorkspaceTemp(resultsRoot, privateRoot): Promise<number>`; `exists(path)`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/fsutil.test.ts`:

```typescript
import { assert, assertEquals, assertNotEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import {
  CopyLimitError,
  exists,
  FREEZE_VIOLATIONS_FILE,
  freezeWorkspace,
  redactBytes,
  redactTree,
  safeCopyTree,
  sweepWorkspaceTemp,
  validatedDest,
  validatedDir,
} from "../../../src/harness/fsutil.ts";
import { hashTree, isTaskBuildArtifact } from "../../../src/harness/hash.ts";

const windows = Deno.build.os === "windows";
const TOKEN = "a".repeat(8) + "0123456789abcdef0123456789abcdef";
const SECRETS = [{ name: "backend-token", value: TOKEN }];

async function tmp(): Promise<string> {
  return await validatedDir(await Deno.realPath(await Deno.makeTempDir()));
}

async function writeTree(root: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, ...rel.split("/"));
    await Deno.mkdir(join(p, ".."), { recursive: true });
    await Deno.writeTextFile(p, text);
  }
}

async function linkDir(target: string, path: string) {
  await Deno.symlink(target, path, { type: windows ? "junction" : "dir" });
}

/** A directory where "a.al" and "A.al" can coexist, or null when the OS cannot make one. */
async function caseSensitiveDir(): Promise<string | null> {
  const d = await tmp();
  if (!windows) return d;
  const out = await new Deno.Command("fsutil.exe", {
    args: ["file", "setCaseSensitiveInfo", d, "enable"],
    stdout: "null",
    stderr: "null",
  }).output().catch(() => null);
  return out?.success ? d : null;
}

async function freeze(results: string, workspace: string, over: Record<string, unknown> = {}) {
  return await freezeWorkspace({ resultsRoot: results, privateRoot: await tmp(), workspace, secrets: SECRETS, ...over });
}

Deno.test("validatedDir: relative, drive-relative, linked ancestor and case alias are refused", async () => {
  await assertRejects(() => validatedDir("relative/path"), ValidationError, "relative");
  if (windows) await assertRejects(() => validatedDir("C:Windows"), ValidationError, "drive-relative");
  const target = await tmp();
  await writeTree(target, { "inner/x.al": "x" });
  const parent = await tmp();
  await linkDir(target, join(parent, "link"));
  await assertRejects(() => validatedDir(join(parent, "link", "inner")), ValidationError, "canonical");
  if (windows) await assertRejects(() => validatedDir(target.toUpperCase()), ValidationError, "canonical");
  assertEquals(await validatedDir(target), target);
});

Deno.test("validatedDest: creates one level at a time and refuses a linked ancestor", async () => {
  const root = await tmp();
  assertEquals(await validatedDest(join(root, "a", "b", "c")), join(root, "a", "b", "c"));
  const target = await tmp();
  await linkDir(target, join(root, "hop"));
  await assertRejects(() => validatedDest(join(root, "hop", "x")), ValidationError);
  assert(!await exists(join(target, "x")));
});

Deno.test("safeCopyTree: copies files, skips build artifacts, counts", async () => {
  const src = await tmp();
  const dst = join(await tmp(), "out");
  await writeTree(src, {
    "Core/app.json": "{}",
    "Core/src/A.Codeunit.al": "codeunit 70000 A {}",
    ".alpackages/sym.app": "bin",
    "Core/output/Core.app": "bin",
  });
  const r = await safeCopyTree(src, dst, { skip: isTaskBuildArtifact });
  assertEquals([r.files, r.refused, r.ambiguous], [2, [], []]);
  assert(await exists(join(dst, "Core", "src", "A.Codeunit.al")));
  assert(!await exists(join(dst, ".alpackages")));
});

Deno.test("safeCopyTree: redirecting reparse points are refused, never followed", async () => {
  const target = await tmp();
  await writeTree(target, { "secret.txt": "host" });
  const src = await tmp();
  await writeTree(src, { "Core/app.json": "{}" });
  await linkDir(target, join(src, "Core", "hostlink"));
  const dst = join(await tmp(), "out");
  const r = await safeCopyTree(src, dst);
  assertEquals(r.refused, ["Core/hostlink"]);
  assert(!await exists(join(dst, "Core", "hostlink")));
});

Deno.test("safeCopyTree: a directory swapped for a junction after listing is refused", async () => {
  const decoy = await tmp();
  await writeTree(decoy, { "a.al": "host" });
  const src = await tmp();
  await writeTree(src, { "sub/a.al": "mine" });
  const dst = join(await tmp(), "out");
  const r = await safeCopyTree(src, dst, {
    afterList: async (rel) => {
      if (rel !== "") return;
      await Deno.rename(join(src, "sub"), join(src, "sub-old"));
      await linkDir(decoy, join(src, "sub"));
    },
  });
  assert(r.refused.includes("sub"));
  assert(!await exists(join(dst, "sub", "a.al")));
});

Deno.test("safeCopyTree: an ancestor swapped between the checks and the open stops the copy", async () => {
  const decoy = await tmp();
  await writeTree(decoy, { "a.al": "host" });
  const src = await tmp();
  await writeTree(src, { "sub/a.al": "mine" });
  await assertRejects(
    async () =>
      safeCopyTree(src, join(await tmp(), "out"), {
        beforeOpen: async (rel) => {
          if (rel !== "sub/a.al") return;
          await Deno.rename(join(src, "sub"), join(src, "sub-old"));
          await linkDir(decoy, join(src, "sub"));
        },
      }),
    ValidationError,
    "changed identity",
  );
});

Deno.test("safeCopyTree: a file swapped between check and open is refused", async () => {
  const src = await tmp();
  await writeTree(src, { "a.al": "original", "other.txt": "other" });
  await assertRejects(
    async () =>
      safeCopyTree(src, join(await tmp(), "out"), {
        beforeOpen: async (rel) => {
          if (rel !== "a.al") return;
          await Deno.remove(join(src, "a.al"));
          await Deno.rename(join(src, "other.txt"), join(src, "a.al"));
        },
      }),
    ValidationError,
    "changed identity",
  );
});

Deno.test("safeCopyTree: case-ambiguous names are refused together (deterministic, any host)", async () => {
  const src = await tmp();
  await writeTree(src, { "a.al": "one", "b.al": "three" });
  const r = await safeCopyTree(src, join(await tmp(), "out"), {
    listDir: (d) => Promise.resolve(d === src ? ["a.al", "A.al", "b.al"] : []),
  });
  assertEquals([r.ambiguous.sort(), r.files], [["A.al", "a.al"], 1]);
});

Deno.test("safeCopyTree: case-ambiguous names on a real case-sensitive directory (additional, host-dependent)", async () => {
  const src = await caseSensitiveDir();
  if (src === null) return; // not proof of anything; the deterministic test above is
  await Deno.writeTextFile(join(src, "a.al"), "one");
  await Deno.writeTextFile(join(src, "A.al"), "two");
  const r = await safeCopyTree(src, join(await tmp(), "out"));
  assertEquals(r.ambiguous.sort(), ["A.al", "a.al"]);
});

Deno.test("safeCopyTree: destination must be new or empty and never under a link", async () => {
  const src = await tmp();
  await writeTree(src, { "a.al": "x" });
  const full = await tmp();
  await writeTree(full, { "old.al": "y" });
  await assertRejects(() => safeCopyTree(src, full), ValidationError, "not empty");
  const root = await tmp();
  const target = await tmp();
  await linkDir(target, join(root, "hop"));
  await assertRejects(() => safeCopyTree(src, join(root, "hop", "out")), ValidationError);
  assert(!await exists(join(target, "out")));
});

Deno.test("safeCopyTree: limits on files, bytes, dirs, depth and a growing file", async () => {
  const src = await tmp();
  await writeTree(src, { "a/b/c/d.al": "x", "e.al": "y" });
  const limits = { maxFiles: 100, maxBytes: 1_000_000, maxDirs: 100, maxDepth: 100 };
  const out = async () => join(await tmp(), "out");
  await assertRejects(async () => safeCopyTree(src, await out(), { limits: { ...limits, maxFiles: 1 } }), CopyLimitError);
  await assertRejects(async () => safeCopyTree(src, await out(), { limits: { ...limits, maxBytes: 1 } }), CopyLimitError);
  await assertRejects(async () => safeCopyTree(src, await out(), { limits: { ...limits, maxDirs: 1 } }), CopyLimitError);
  await assertRejects(async () => safeCopyTree(src, await out(), { limits: { ...limits, maxDepth: 2 } }), CopyLimitError);
  await assertRejects(
    async () =>
      safeCopyTree(src, await out(), {
        limits: { ...limits, maxBytes: 100 },
        beforeOpen: async (rel) => {
          if (rel === "e.al") await Deno.writeTextFile(join(src, "e.al"), "z".repeat(500), { append: true });
        },
      }),
    CopyLimitError,
  );
});

Deno.test("redactBytes: UTF-8 and UTF-16LE forms, adjacent to word characters, longest first, binary-safe", () => {
  const enc = new TextEncoder();
  const u16 = (s: string) => new Uint8Array(new Uint16Array([...s].map((c) => c.charCodeAt(0))).buffer);
  const data = new Uint8Array([0, 255, ...enc.encode(`x${TOKEN}y`), 0, ...u16(TOKEN), 7]);
  const r = redactBytes(data, [...SECRETS, { name: "prefix", value: TOKEN.slice(0, 20) }]);
  assertEquals(r.count, 2);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(r.out);
  assertStringIncludes(text, "x[REDACTED:backend-token]y");
  assert(!text.includes(TOKEN.slice(0, 20)));
  assertEquals([r.out[0], r.out[1], r.out.at(-1)], [0, 255, 7]);
});

Deno.test("redactTree: redacts in place in a private copy; oversize files are removed and reported", async () => {
  const d = await tmp();
  await writeTree(d, { "Test/src/Leak.al": `// ${TOKEN}`, "big.bin": "z".repeat(2048) });
  const r = await redactTree(d, SECRETS, 1024);
  assertEquals(r.count, 1);
  assertEquals(await Deno.readTextFile(join(d, "Test", "src", "Leak.al")), "// [REDACTED:backend-token]");
  assert(!await exists(join(d, "big.bin")));
  assertStringIncludes(r.violations[0]!, "big.bin");
});

Deno.test("freezeWorkspace: never writes the live tree; stores a redacted copy; oversize is a violation", async () => {
  const results = await tmp();
  const a = await tmp();
  await writeTree(a, { "Core/src/A.al": `x ${TOKEN}\r\n`, ".alpackages/s.app": "bin" });
  const fa = await freeze(results, a);
  assertEquals(await Deno.readTextFile(join(a, "Core", "src", "A.al")), `x ${TOKEN}\r\n`, "live tree untouched");
  assertEquals(fa.redactions, 1);
  assert(!(await Deno.readTextFile(join(results, fa.stored_path, "Core", "src", "A.al"))).includes(TOKEN));
  assertEquals(await hashTree(join(results, fa.stored_path), "task"), fa.workspace_hash);
  const b = await tmp();
  await writeTree(b, { "Core/src/A.al": "x [REDACTED:backend-token]\n" });
  assertEquals((await freeze(results, b)).workspace_hash, fa.workspace_hash, "same redacted content, one copy");
  const target = await tmp();
  await linkDir(target, join(b, "Core", "hostlink"));
  const fl = await freeze(results, b);
  assertNotEquals(fl.workspace_hash, fa.workspace_hash);
  assertStringIncludes(await Deno.readTextFile(join(results, fl.stored_path, FREEZE_VIOLATIONS_FILE)), "Core/hostlink");
  const big = await freeze(results, a, { maxScanBytes: 4 });
  assertStringIncludes(big.violations.join("\n"), "larger than");
  const over = await freeze(results, a, { limits: { maxFiles: 0, maxBytes: 0, maxDirs: 0, maxDepth: 0 } });
  assertStringIncludes(over.violations[0]!, "size limit");
});

Deno.test("freezeWorkspace: secret-bearing file names and link names never reach the stored tree or the marker", async () => {
  const results = await tmp();
  const ws = await tmp();
  await writeTree(ws, { [`Core/src/${TOKEN}.al`]: "x", "Core/src/Ok.al": "y" });
  const target = await tmp();
  await linkDir(target, join(ws, "Core", `link-${TOKEN}`));
  const f = await freeze(results, ws);
  const stored = join(results, f.stored_path);
  assert(!await exists(join(stored, "Core", "src", `${TOKEN}.al`)));
  assert(await exists(join(stored, "Core", "src", "Ok.al")));
  const marker = await Deno.readTextFile(join(stored, FREEZE_VIOLATIONS_FILE));
  assert(!marker.includes(TOKEN));
  assertStringIncludes(marker, "[REDACTED:backend-token]");
  assertStringIncludes(marker, "name contains a secret");
});

Deno.test("sweepWorkspaceTemp: removes interrupted freezes and private scratch only", async () => {
  const results = await tmp();
  const priv = await tmp();
  await writeTree(results, { "workspaces/.tmp-1/a.al": "x", "workspaces/abc/a.al": "x" });
  await writeTree(priv, { "freeze/1/a.al": "x" });
  assertEquals(await sweepWorkspaceTemp(results, priv), 2);
  assert(await exists(join(results, "workspaces", "abc")));
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/fsutil.test.ts`
Expected: FAIL, `Module not found ".../src/harness/fsutil.ts"`.

- [ ] **Step 3: Implement**

`src/harness/fsutil.ts`:

```typescript
/**
 * Hostile-artifact containment (spec 1a sections 5 and 7; M1-02 carryover;
 * M0-05 TOCTOU). Callers copy a quiescent source (paused or removed
 * sandbox); the checks below also detect a concurrent writer:
 * - roots: absolute, not drive-relative, canonical spelling;
 * - entries: plain file or directory with a known identity, realPath equal
 *   to join(canonicalParent, name), case-ambiguous siblings refused;
 * - ancestors: identity recorded on entry and re-checked before each open;
 * - files: handle identity equal to the pre-open lstat; bytes counted;
 * - destinations: new or empty, created under a validated parent;
 * - redaction: byte-wise on a private copy, never on the live tree.
 */

import { basename, dirname, isAbsolute, join, resolve } from "@std/path";
import { ValidationError } from "../errors.ts";
import { hashTree, isTaskBuildArtifact } from "./hash.ts";

export const FREEZE_VIOLATIONS_FILE = ".cg-freeze-violations.txt";
export const MAX_SCAN_BYTES = 64 * 1024 * 1024;

export interface SecretValue {
  name: string;
  value: string;
}

export interface CopyLimits {
  maxFiles: number;
  maxBytes: number;
  maxDirs: number;
  maxDepth: number;
}

/** ponytail: fixed limits; make them config when a real task needs more. */
export const DEFAULT_COPY_LIMITS: CopyLimits = {
  maxFiles: 20_000,
  maxBytes: 512 * 1024 * 1024,
  maxDirs: 5_000,
  maxDepth: 24,
};

export class CopyLimitError extends ValidationError {
  constructor(message: string) {
    super(message, [message]);
    this.name = "CopyLimitError";
  }
}

const DRIVE_RELATIVE = /^[A-Za-z]:(?![\\/])/;
const upperDrive = (p: string) => p.replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`);

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

/** The exact canonical path of an existing plain directory, or a ValidationError. */
export async function validatedDir(p: string): Promise<string> {
  if (DRIVE_RELATIVE.test(p)) throw new ValidationError(`refusing a drive-relative path: ${p}`, [p]);
  if (!isAbsolute(p)) throw new ValidationError(`refusing a relative path: ${p}`, [p]);
  const abs = upperDrive(resolve(p));
  const real = upperDrive(await Deno.realPath(abs));
  if (real !== abs) {
    throw new ValidationError(
      `refusing a path whose canonical form differs (link, junction, short name or case): ${p} -> ${real}`,
      [p],
    );
  }
  const st = await Deno.lstat(real);
  if (st.isSymlink || !st.isDirectory) throw new ValidationError(`not a plain directory: ${real}`, [real]);
  return real;
}

/** Validate or create a destination directory; ancestors are validated first. */
export async function validatedDest(p: string): Promise<string> {
  if (DRIVE_RELATIVE.test(p) || !isAbsolute(p)) {
    throw new ValidationError(`refusing a relative or drive-relative destination: ${p}`, [p]);
  }
  const abs = upperDrive(resolve(p));
  if (await exists(abs)) return await validatedDir(abs);
  const parent = dirname(abs);
  if (parent === abs) throw new ValidationError(`no such root: ${abs}`, [abs]);
  const created = join(await validatedDest(parent), basename(abs));
  await Deno.mkdir(created);
  return await validatedDir(created);
}

export interface CopyReport {
  files: number;
  bytes: number;
  dirs: number;
  /** Links and special or redirected entries: never copied. */
  refused: string[];
  /** Names that differ only by case from a sibling: never copied. */
  ambiguous: string[];
}

export interface CopyOptions {
  skip?: (rel: string, isDir: boolean) => boolean;
  limits?: CopyLimits;
  /** Test seams. */
  beforeOpen?: (rel: string) => Promise<void>;
  afterList?: (rel: string) => Promise<void>;
  listDir?: (dirAbs: string) => Promise<string[]>;
}

interface DirId {
  path: string;
  ino: number;
  dev: number;
}

async function listNames(dirAbs: string): Promise<string[]> {
  const names: string[] = [];
  for await (const e of Deno.readDir(dirAbs)) names.push(e.name);
  return names;
}

/** ponytail: O(depth) re-check per file; fine for workspace depths (limit 24). */
async function checkChain(chain: DirId[]): Promise<void> {
  for (const c of chain) {
    const s = await Deno.lstat(c.path);
    if (
      s.isSymlink || !s.isDirectory || s.ino !== c.ino || s.dev !== c.dev ||
      upperDrive(await Deno.realPath(c.path)) !== c.path
    ) {
      throw new ValidationError(`directory changed identity during the copy: ${c.path}`, [c.path]);
    }
  }
}

export async function safeCopyTree(
  src: string,
  dst: string,
  opts: CopyOptions = {},
): Promise<CopyReport & { src: string; dst: string }> {
  const limits = opts.limits ?? DEFAULT_COPY_LIMITS;
  const list = opts.listDir ?? listNames;
  const root = await validatedDir(src);
  const out = await validatedDest(dst);
  for await (const _ of Deno.readDir(out)) throw new ValidationError(`destination is not empty: ${out}`, [out]);
  const rootSt = await Deno.lstat(root);
  if (rootSt.ino === null || rootSt.dev === null) {
    throw new ValidationError(`cannot verify directory identity on this filesystem: ${root}`, [root]);
  }
  const r: CopyReport = { files: 0, bytes: 0, dirs: 0, refused: [], ambiguous: [] };
  const buf = new Uint8Array(64 * 1024);

  const walk = async (dirAbs: string, rel: string, depth: number, chain: DirId[]): Promise<void> => {
    if (depth > limits.maxDepth) throw new CopyLimitError(`${root}: deeper than ${limits.maxDepth}`);
    const names = await list(dirAbs);
    await opts.afterList?.(rel);
    const byLower = new Map<string, number>();
    for (const n of names) byLower.set(n.toLowerCase(), (byLower.get(n.toLowerCase()) ?? 0) + 1);
    for (const name of [...names].sort()) {
      const r1 = rel ? `${rel}/${name}` : name;
      if (byLower.get(name.toLowerCase())! > 1) {
        r.ambiguous.push(r1);
        continue;
      }
      const p = join(dirAbs, name);
      const st = await Deno.lstat(p).catch(() => null);
      if (!st || st.isSymlink || (!st.isFile && !st.isDirectory)) {
        r.refused.push(r1);
        continue;
      }
      if (upperDrive(await Deno.realPath(p)) !== p) {
        r.refused.push(r1);
        continue;
      }
      if (st.ino === null || st.dev === null) {
        throw new ValidationError(`cannot verify identity on this filesystem: ${p}`, [p]);
      }
      if (opts.skip?.(r1, st.isDirectory)) continue;
      const target = join(out, ...r1.split("/"));
      if (st.isDirectory) {
        if (++r.dirs > limits.maxDirs) throw new CopyLimitError(`${root}: more than ${limits.maxDirs} directories`);
        await Deno.mkdir(target);
        await walk(p, r1, depth + 1, [...chain, { path: p, ino: st.ino, dev: st.dev }]);
        continue;
      }
      if (++r.files > limits.maxFiles) throw new CopyLimitError(`${root}: more than ${limits.maxFiles} files`);
      await opts.beforeOpen?.(r1);
      await checkChain(chain);
      const f = await Deno.open(p, { read: true });
      try {
        const hs = await f.stat();
        if (!hs.isFile || hs.ino !== st.ino || hs.dev !== st.dev) {
          throw new ValidationError(`file changed identity between check and open: ${r1}`, [r1]);
        }
        const w = await Deno.open(target, { write: true, createNew: true });
        try {
          for (;;) {
            const n = await f.read(buf);
            if (n === null) break;
            r.bytes += n;
            if (r.bytes > limits.maxBytes) throw new CopyLimitError(`${root}: more than ${limits.maxBytes} bytes`);
            let off = 0;
            while (off < n) off += await w.write(buf.subarray(off, n));
          }
        } finally {
          w.close();
        }
      } finally {
        f.close();
      }
    }
  };
  await walk(root, "", 0, [{ path: root, ino: rootSt.ino, dev: rootSt.dev }]);
  return { ...r, src: root, dst: out };
}

const utf16le = (s: string) => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 * i] = c & 0xff;
    out[2 * i + 1] = c >> 8;
  }
  return out;
};

function replaceAll(data: Uint8Array, needle: Uint8Array, repl: Uint8Array): { out: Uint8Array; count: number } {
  const parts: Uint8Array[] = [];
  let count = 0;
  let from = 0;
  let i = 0;
  // ponytail: naive scan; secrets are short and files are bounded by MAX_SCAN_BYTES.
  while (i + needle.length <= data.length) {
    let k = 0;
    while (k < needle.length && data[i + k] === needle[k]) k++;
    if (k === needle.length) {
      parts.push(data.subarray(from, i), repl);
      count++;
      i += needle.length;
      from = i;
    } else i++;
  }
  if (count === 0) return { out: data, count };
  parts.push(data.subarray(from));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return { out, count };
}

/** Replace every secret (UTF-8 and UTF-16LE forms), longest first. */
export function redactBytes(data: Uint8Array, secrets: SecretValue[]): { out: Uint8Array; count: number } {
  const enc = new TextEncoder();
  let out = data;
  let count = 0;
  for (const s of [...secrets].filter((x) => x.value.length > 0).sort((a, b) => b.value.length - a.value.length)) {
    const mark = `[REDACTED:${s.name}]`;
    for (const [needle, repl] of [[enc.encode(s.value), enc.encode(mark)], [utf16le(s.value), utf16le(mark)]]) {
      const r = replaceAll(out, needle!, repl!);
      out = r.out;
      count += r.count;
    }
  }
  return { out, count };
}

/** Redact a private tree in place; files larger than maxScanBytes are removed and reported. */
export async function redactTree(
  dir: string,
  secrets: SecretValue[],
  maxScanBytes = MAX_SCAN_BYTES,
): Promise<{ count: number; violations: string[] }> {
  const root = await validatedDir(dir);
  let count = 0;
  const violations: string[] = [];
  const visit = async (d: string, rel: string): Promise<void> => {
    for (const name of (await listNames(d)).sort()) {
      const p = join(d, name);
      const r1 = rel ? `${rel}/${name}` : name;
      const st = await Deno.lstat(p);
      if (st.isDirectory) await visit(p, r1);
      else if (st.size > maxScanBytes) {
        await Deno.remove(p);
        violations.push(`file larger than ${maxScanBytes} bytes cannot be scanned for secrets: ${r1}`);
      } else {
        const r = redactBytes(await Deno.readFile(p), secrets);
        if (r.count > 0) {
          count += r.count;
          await Deno.writeFile(p, r.out);
        }
      }
    }
  };
  await visit(root, "");
  return { count, violations };
}

/** Replace every secret in a string, longest first. */
function redactString(text: string, secrets: SecretValue[]): string {
  let out = text;
  for (const x of [...secrets].filter((y) => y.value.length > 0).sort((a, b) => b.value.length - a.value.length)) {
    out = out.replaceAll(x.value, `[REDACTED:${x.name}]`);
  }
  return out;
}

/** Remove entries of a private tree whose name contains a secret; report them with the name redacted. */
async function dropSecretNames(dir: string, secrets: SecretValue[]): Promise<string[]> {
  const out: string[] = [];
  const visit = async (d: string, rel: string): Promise<void> => {
    for (const name of await listNames(d)) {
      const r1 = rel ? `${rel}/${name}` : name;
      const p = join(d, name);
      if (secrets.some((x) => x.value.length > 0 && name.includes(x.value))) {
        await Deno.remove(p, { recursive: true });
        out.push(`name contains a secret: ${redactString(r1, secrets)}`);
      } else if ((await Deno.lstat(p)).isDirectory) await visit(p, r1);
    }
  };
  await visit(dir, "");
  return out;
}

export interface FreezeInput {
  resultsRoot: string;
  /** Harness-private area outside results/ (M1-22 privateRoot). */
  privateRoot: string;
  /** Quiescent: the sandbox is confirmed gone. */
  workspace: string;
  secrets: SecretValue[];
  limits?: CopyLimits;
  maxScanBytes?: number;
}

export interface Frozen {
  workspace_hash: string;
  /** Relative to resultsRoot, e.g. workspaces/<hash>. */
  stored_path: string;
  violations: string[];
  redactions: number;
}

/**
 * Freeze: private copy (build artifacts dropped, D10) -> byte-wise redaction
 * -> violations marker (hashed, fails the build scorer, spec 1a section 7)
 * -> hash -> publish under results/harness/workspaces/<hash>.
 */
export async function freezeWorkspace(i: FreezeInput): Promise<Frozen> {
  const limits = i.limits ?? DEFAULT_COPY_LIMITS;
  const scratch = join(await validatedDest(join(i.privateRoot, "freeze")), crypto.randomUUID());
  const base = await validatedDest(join(i.resultsRoot, "workspaces"));
  const tmpDir = join(base, `.tmp-${crypto.randomUUID()}`);
  try {
    const violations: string[] = [];
    try {
      const r = await safeCopyTree(i.workspace, scratch, { skip: isTaskBuildArtifact, limits });
      violations.push(...r.refused.map((p) => `link, reparse point or special file: ${p}`));
      violations.push(...r.ambiguous.map((p) => `case-ambiguous name: ${p}`));
    } catch (err) {
      if (!(err instanceof CopyLimitError)) throw err;
      await Deno.remove(scratch, { recursive: true }).catch(() => {});
      await validatedDest(scratch);
      violations.push(`size limit: ${err.message}`);
    }
    const red = await redactTree(scratch, i.secrets, i.maxScanBytes ?? MAX_SCAN_BYTES);
    violations.push(...red.violations);
    violations.push(...await dropSecretNames(scratch, i.secrets));
    if (violations.length > 0) {
      // The marker is generated metadata built from untrusted names: redact it before it is hashed.
      await Deno.writeTextFile(join(scratch, FREEZE_VIOLATIONS_FILE), redactString(violations.join("\n"), i.secrets) + "\n");
    }
    const workspace_hash = await hashTree(scratch, "task");
    const stored_path = `workspaces/${workspace_hash}`;
    // ponytail: exists-then-rename; the bench lock makes the runner the only writer.
    if (!await exists(join(base, workspace_hash))) {
      await safeCopyTree(scratch, tmpDir);
      await Deno.rename(tmpDir, join(base, workspace_hash));
    }
    return { workspace_hash, stored_path, violations, redactions: red.count };
  } finally {
    await Deno.remove(scratch, { recursive: true }).catch(() => {});
    await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
  }
}

export async function sweepWorkspaceTemp(resultsRoot: string, privateRoot: string): Promise<number> {
  let removed = 0;
  const sweep = async (dir: string, match: (name: string) => boolean) => {
    try {
      for await (const e of Deno.readDir(dir)) {
        if (!match(e.name)) continue;
        await Deno.remove(join(dir, e.name), { recursive: true });
        removed++;
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  };
  await sweep(join(resultsRoot, "workspaces"), (n) => n.startsWith(".tmp-"));
  await sweep(join(privateRoot, "freeze"), () => true);
  return removed;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/fsutil.test.ts`
Expected: all 16 tests pass. The host case-sensitive test may return early on a Windows host without `fsutil setCaseSensitiveInfo`; the deterministic `listDir` test is the requirement's proof.

- [ ] **Step 5: Check, lint, format** (`src/harness/fsutil.ts`, `tests/unit/harness/fsutil.test.ts`)

- [ ] **Step 6: Commit**

```bash
git add src/harness/fsutil.ts tests/unit/harness/fsutil.test.ts
git commit -m "feat(harness): containment copy with ancestor identity, byte-safe redaction and private freeze"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/fsutil.test.ts` passes (16 tests, the secret-name, ancestor-swap, junction-after-listing, destination and deterministic case-ambiguity tests among them); check, lint and `deno fmt --check` clean.

---

### Task M1-20: sandbox runtime: bounded lifecycle, confirmed termination, capture cap, secrets and redaction

Spec 1a sections 5 and 8; M0-03 carryover (a) no secret in argv, (b) create and capture inside the protected region, checked `docker rm -f`, startup sweep by prefix plus label; accepted-risk conditions (never in argv or image layers; every captured log scanned for exact values before it leaves the sandbox); review round 2 items 1, 2 and 4 (every docker operation bounded; termination confirmed before any workspace processing; capture output bounded; a tested operator interrupt; Hyper-V isolation; images by immutable id). Findings section 3: `docker kill` left a complete last JSON line.

Design:
- **Quarantine.** Capture files go to a private quarantine under the execution's private directory (M1-22 `privateRoot`, never under `results/`); publication happens only through `publishRedacted` (byte-wise, UTF-8 and UTF-16LE forms, via M1-12 `redactBytes`).
- **Every docker verb is bounded.** `realDocker` passes `AbortSignal.timeout(opTimeoutMs)` to each short command (`kill`, `rm`, `pause`, `unpause`, `state`, `ps`, `image inspect`); `runSandbox` additionally wraps each call in a deadline, so a daemon that never answers cannot hold the runner.
- **Confirmed termination.** After the run, `runSandbox` removes the container (bounded), then requires both (a) the `docker run` call has settled, so both capture streams are closed, and (b) `docker inspect` reports no such container. Only then is `confirmedGone` true. M1-22 never redacts, freezes or publishes a workspace whose sandbox is not `confirmedGone`; it keeps the intent and stops.
- **Stop triggers:** the timeout, an operator interrupt (`AbortSignal`, wired to Ctrl+C by M1-24), and a capture overflow (`maxCaptureBytes`, default 256 MiB over stdout plus stderr; further bytes are dropped and the sandbox is killed). Each is recorded (`timedOut`, `interrupted`, `overflow`).
- **Started vs not started.** `started` is set by the capture's `onStarted` callback right after the spawn. A failure before it (capture file cannot be opened, spawn error) means the harness never ran (exact zero cost is allowed); any failure after it means the process may have spent money (M1-22 records unknown cost).
- **Arguments:** `--isolation hyperv` always; `--network <name>` when the spec names one (M1-33's internal network); the image by immutable id; an optional command after the image (ops probes only).
- **Pause/unpause** (bounded) are exposed for the backend's quiescent snapshot (M1-19).
- Secrets shorter than 16 characters are refused at `prepareSecrets`.

**Lane:** infra2 (stream B). **Deps:** M1-12. **Date:** 09-27.

**Files:**
- Create: `src/harness/sandbox.ts`, `tests/unit/harness/fake-docker.ts`
- Test: `tests/unit/harness/sandbox.test.ts`

**Interfaces:**
- Produces: `SANDBOX_PREFIX = "cg-harness-"`, `OWNER_LABEL`, `EXECUTION_LABEL`, `OP_TIMEOUT_MS = 60_000`, `MAX_CAPTURE_BYTES = 256 MiB`; `interface Capture { stdoutPath; stderrPath; maxBytes; onStarted(): void; onOverflow(): void }`; `interface DockerCli { run(args, c: Capture): Promise<number>; kill(name): Promise<number>; rm(name): Promise<{ code; stderr }>; pause(name): Promise<number>; unpause(name): Promise<number>; state(name): Promise<{ running: boolean } | null>; listOwned(owner): Promise<string[]>; inspectImage(ref): Promise<unknown | null>; build(args): Promise<number> }`; `realDocker(opTimeoutMs?): DockerCli`; `sandboxName(campaignId, executionId)`; `interface SandboxSpec { name; owner; executionId; imageId; workspace; taskDir; configDir; secretsDir; extraMounts: { src; dst }[]; env: Record<string, string>; network?; command?; timeoutMs; killGraceMs; opTimeoutMs; maxCaptureBytes; rawLog; stderrLog }`; `buildRunArgs(s)`; `interface SandboxResult { exitCode: number | null; started: boolean; startError: string | null; timedOut: boolean; interrupted: boolean; overflow: boolean; confirmedGone: boolean; cleanup: "ok" | string; wall_ms: number }`; `runSandbox(docker, spec, secretValues, stop?: AbortSignal): Promise<SandboxResult>`; `bounded<T>(p, ms, what): Promise<T>`; `sweepOwnedSandboxes(docker, owner, opTimeoutMs?): Promise<string[]>`; `MIN_SECRET_LENGTH = 16`; `type SecretValue` (re-exported from M1-12); `prepareSecrets(source, files, backendToken): Promise<{ dir; values }>`; `removeSecrets(dir)`; `redactText(text, secrets): { text; count }`; `publishRedacted(files: { src; dest }[], secrets): Promise<number>`; fake: `FakeDocker` (images by immutable id plus a tag map; `addImage(tag, id, labels, layers?)`), `parseRunArgs`, `RunCall`, `RunIO`, `RunBehavior`.

- [ ] **Step 1: Write the fake and the failing test**

`tests/unit/harness/fake-docker.ts`:

```typescript
/** In-memory DockerCli for unit tests. Images are stored by immutable id; tags point at ids. */

import type { Capture, DockerCli } from "../../../src/harness/sandbox.ts";

export interface RunCall {
  args: string[];
  name: string;
  image: string;
  network: string | null;
  isolation: string | null;
  command: string[];
  mounts: Map<string, { src: string; readonly: boolean }>;
  env: Map<string, string>;
  labels: Map<string, string>;
}

export function parseRunArgs(args: string[]): RunCall {
  const at = args.findIndex((a) => a.startsWith("sha256:"));
  const imageAt = at >= 0 ? at : args.length - 1;
  const call: RunCall = {
    args, name: "", image: args[imageAt]!, network: null, isolation: null, command: args.slice(imageAt + 1),
    mounts: new Map(), env: new Map(), labels: new Map(),
  };
  for (let i = 1; i < imageAt; i++) {
    const a = args[i]!;
    const v = args[i + 1]!;
    if (a === "--name") call.name = v;
    else if (a === "--network") call.network = v;
    else if (a === "--isolation") call.isolation = v;
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
  /** Resolves when `docker kill` or `docker rm -f` hits this container. */
  killed: Promise<void>;
}
export type RunBehavior = (call: RunCall, io: RunIO) => Promise<number>;

const never = <T>() => new Promise<T>(() => {});

export class FakeDocker implements DockerCli {
  runs: RunCall[] = [];
  kills: string[] = [];
  removed: string[] = [];
  paused: string[] = [];
  builds: string[][] = [];
  owned: string[] = [];
  /** Immutable id -> inspect object; tag -> id. */
  images = new Map<string, unknown>();
  tags = new Map<string, string>();
  rmFails = new Set<string>();
  /** Containers `state` still reports as present after rm. */
  lingering = new Set<string>();
  killFails = false;
  killHangs = false;
  rmHangs = false;
  /** `docker run` never returns even after kill (a wedged daemon). */
  wedged = false;
  /** Fails before the spawn (capture file, spawn error). */
  runError: Error | null = null;
  /** Fails after the spawn (capture broke mid-run). */
  failAfterStart: Error | null = null;
  behavior: RunBehavior = () => Promise.resolve(0);
  private stoppers = new Map<string, () => void>();

  addImage(tag: string, id: string, labels: Record<string, string>, layers: string[] = [id]): void {
    this.images.set(id, { Id: id, Config: { Labels: labels }, RootFS: { Layers: layers } });
    this.tags.set(tag, id);
  }

  async run(args: string[], c: Capture): Promise<number> {
    if (this.runError) throw this.runError;
    const out = await Deno.open(c.stdoutPath, { write: true, createNew: true });
    await Deno.writeTextFile(c.stderrPath, "", { createNew: true });
    const call = parseRunArgs(args);
    this.runs.push(call);
    c.onStarted();
    const killed = new Promise<void>((r) => this.stoppers.set(call.name, r));
    let written = 0;
    try {
      if (this.failAfterStart) throw this.failAfterStart;
      const code = await this.behavior(call, {
        stdout: async (line) => {
          const bytes = new TextEncoder().encode(line + "\n");
          if (written + bytes.length > c.maxBytes) {
            c.onOverflow();
            return;
          }
          written += bytes.length;
          await out.write(bytes);
        },
        killed,
      });
      if (this.wedged) await never();
      return code;
    } finally {
      out.close();
    }
  }
  kill(name: string): Promise<number> {
    this.kills.push(name);
    if (this.killHangs) return never();
    if (this.killFails) return Promise.resolve(1);
    this.stoppers.get(name)?.();
    return Promise.resolve(0);
  }
  rm(name: string): Promise<{ code: number; stderr: string }> {
    this.removed.push(name);
    if (this.rmHangs) return never();
    if (this.rmFails.has(name)) return Promise.resolve({ code: 1, stderr: "Error: device busy" });
    this.stoppers.get(name)?.();
    if (!this.runs.some((r) => r.name === name) && !this.owned.includes(name)) {
      return Promise.resolve({ code: 1, stderr: `Error response from daemon: No such container: ${name}` });
    }
    return Promise.resolve({ code: 0, stderr: "" });
  }
  pause(name: string): Promise<number> {
    this.paused.push(name);
    return Promise.resolve(0);
  }
  unpause(_name: string): Promise<number> {
    return Promise.resolve(0);
  }
  state(name: string): Promise<{ running: boolean } | null> {
    if (this.lingering.has(name) || this.rmFails.has(name)) return Promise.resolve({ running: true });
    return Promise.resolve(null);
  }
  listOwned(_owner: string): Promise<string[]> {
    return Promise.resolve([...this.owned]);
  }
  inspectImage(ref: string): Promise<unknown | null> {
    return Promise.resolve(this.images.get(this.tags.get(ref) ?? ref) ?? null);
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
import { __setContextListerForTests } from "../../../src/container/docker-context.ts";
import { ConfigurationError, ContainerError } from "../../../src/errors.ts";
import { exists, validatedDir } from "../../../src/harness/fsutil.ts";
import {
  buildRunArgs,
  EXECUTION_LABEL,
  OWNER_LABEL,
  prepareSecrets,
  publishRedacted,
  realDocker,
  redactText,
  runSandbox,
  sandboxName,
  type SandboxSpec,
  sweepOwnedSandboxes,
} from "../../../src/harness/sandbox.ts";
import { createCommandMock } from "../../utils/command-mock.ts";
import { FakeDocker, parseRunArgs } from "./fake-docker.ts";

const TOKEN = "tok-0123456789abcdef";
const tmp = async () => await validatedDir(await Deno.realPath(await Deno.makeTempDir()));

async function spec(over: Partial<SandboxSpec> = {}): Promise<SandboxSpec> {
  const q = await tmp();
  return {
    name: sandboxName("11111111-2222-4333-8444-555555555555", "aaaaaaaa-0000-4000-8000-000000000001"),
    owner: "HOST1",
    executionId: "aaaaaaaa-0000-4000-8000-000000000001",
    imageId: "sha256:" + "a".repeat(64),
    workspace: "C:\\h\\work space\\ws",
    taskDir: "C:\\h\\task",
    configDir: "C:\\h\\config",
    secretsDir: "C:\\h\\secrets",
    extraMounts: [],
    env: { CG_EXECUTION_ID: "aaaaaaaa-0000-4000-8000-000000000001", CG_BACKEND_URL: "http://172.23.64.1:3210" },
    timeoutMs: 60_000,
    killGraceMs: 50,
    opTimeoutMs: 50,
    maxCaptureBytes: 1024 * 1024,
    rawLog: join(q, "raw.jsonl"),
    stderrLog: join(q, "stderr.txt"),
    ...over,
  };
}

const quick = { sanitizeResources: false, sanitizeOps: false };

Deno.test("buildRunArgs: owned name and labels, Hyper-V isolation, exact mounts, image by id, optional network and command", async () => {
  const s = await spec({ extraMounts: [{ src: "C:\\h\\sol", dst: "C:\\mock\\variant" }] });
  assertEquals(s.name, "cg-harness-11111111-aaaaaaaa");
  const call = parseRunArgs(buildRunArgs(s));
  assertEquals([call.labels.get(OWNER_LABEL), call.labels.get(EXECUTION_LABEL)], ["HOST1", s.executionId]);
  assertEquals([call.isolation, call.network, call.image, call.command], ["hyperv", null, s.imageId, []]);
  assertEquals([...call.mounts.entries()].map(([d, m]) => [d, m.readonly]), [
    ["C:\\workspace", false], ["C:\\task", true], ["C:\\config", true], ["C:\\cg-secrets", true], ["C:\\mock\\variant", true],
  ]);
  const n = parseRunArgs(buildRunArgs({ ...s, network: "cg-harness-sandbox", command: ["powershell", "-File", "C:\\config\\p.ps1"] }));
  assertEquals([n.network, n.command.length], ["cg-harness-sandbox", 3]);
  assertThrows(() => buildRunArgs({ ...s, workspace: "C:\\a,b" }), Error, "commas");
  assertThrows(() => buildRunArgs({ ...s, imageId: "centralgauge/harness-claude-code:2.1.282" }), ConfigurationError, "immutable");
});

Deno.test("runSandbox: a secret in argv or env is refused before docker run", async () => {
  const d = new FakeDocker();
  await assertRejects(async () => runSandbox(d, await spec({ env: { LEAK: TOKEN } }), [TOKEN]), ConfigurationError, "secret");
  await assertRejects(async () => runSandbox(d, await spec({ workspace: `C:\\${TOKEN}` }), [TOKEN]), ConfigurationError);
  assertEquals(d.runs, []);
});

Deno.test("runSandbox: timeout kills; complete lines captured; termination confirmed", async () => {
  const d = new FakeDocker();
  d.behavior = async (_c, io) => {
    await io.stdout('{"type":"a"}');
    await io.stdout('{"type":"b"}');
    await io.killed;
    return 137;
  };
  const s = await spec({ timeoutMs: 30 });
  const r = await runSandbox(d, s, []);
  assertEquals([r.timedOut, r.exitCode, r.started, r.confirmedGone, r.cleanup], [true, 137, true, true, "ok"]);
  assertEquals(d.kills, [s.name]);
  assertEquals((await Deno.readTextFile(s.rawLog)).trim().split("\n").map((l) => JSON.parse(l).type), ["a", "b"]);
});

Deno.test({ name: "runSandbox: a failed kill falls through to rm -f; a wedged run is bounded and not confirmed gone", ...quick }, async () => {
  const d = new FakeDocker();
  d.killFails = true;
  d.behavior = async (_c, io) => {
    await io.killed;
    return 137;
  };
  const r = await runSandbox(d, await spec({ timeoutMs: 20 }), []);
  assertEquals([r.timedOut, r.confirmedGone], [true, true]);
  const w = new FakeDocker();
  w.wedged = true;
  const t0 = performance.now();
  const rw = await runSandbox(w, await spec({ timeoutMs: 20, killGraceMs: 30 }), []);
  assert(performance.now() - t0 < 2_000);
  assertEquals([rw.exitCode, rw.confirmedGone], [null, false]);
  assertStringIncludes(rw.cleanup, "did not stop");
});

Deno.test({ name: "runSandbox: kill and rm that never answer are bounded; termination is not confirmed", ...quick }, async () => {
  const d = new FakeDocker();
  d.killHangs = true;
  d.rmHangs = true;
  d.behavior = async (_c, io) => {
    await io.killed;
    return 137;
  };
  const t0 = performance.now();
  const r = await runSandbox(d, await spec({ timeoutMs: 20, killGraceMs: 30, opTimeoutMs: 30 }), []);
  assert(performance.now() - t0 < 2_000);
  assertEquals(r.confirmedGone, false);
  assertStringIncludes(r.cleanup, "timed out");
});

Deno.test("runSandbox: operator interrupt stops the sandbox at once and is recorded", async () => {
  const d = new FakeDocker();
  d.behavior = async (_c, io) => {
    await io.killed;
    return 137;
  };
  const stop = new AbortController();
  const p = runSandbox(d, await spec(), [], stop.signal);
  setTimeout(() => stop.abort(), 10);
  const r = await p;
  assertEquals([r.interrupted, r.timedOut, r.confirmedGone], [true, false, true]);
});

Deno.test("runSandbox: capture overflow kills the sandbox; the log stays bounded", async () => {
  const d = new FakeDocker();
  d.behavior = async (_c, io) => {
    for (let i = 0; i < 1000; i++) await io.stdout("x".repeat(100));
    await io.killed;
    return 137;
  };
  const s = await spec({ maxCaptureBytes: 1000 });
  const r = await runSandbox(d, s, []);
  assertEquals([r.overflow, r.confirmedGone], [true, true]);
  assert((await Deno.stat(s.rawLog)).size <= 1000);
});

Deno.test("runSandbox: a failure before the spawn is not started; after the spawn it is started", async () => {
  const d = new FakeDocker();
  d.runError = new Error("open raw.jsonl: access denied");
  const s = await spec();
  const r = await runSandbox(d, s, []);
  assertEquals([r.started, r.confirmedGone, r.cleanup], [false, true, "ok"]);
  assertStringIncludes(r.startError!, "access denied");
  const d2 = new FakeDocker();
  d2.failAfterStart = new Error("pipe broken");
  const r2 = await runSandbox(d2, await spec(), []);
  assertEquals([r2.started, r2.startError], [true, "pipe broken"]);
});

Deno.test("runSandbox: rm failure or a lingering container means not confirmed gone", async () => {
  const d = new FakeDocker();
  const s = await spec();
  d.rmFails.add(s.name);
  const r = await runSandbox(d, s, []);
  assertEquals(r.confirmedGone, false);
  assertStringIncludes(r.cleanup, "docker rm -f");
  const d2 = new FakeDocker();
  const s2 = await spec();
  d2.lingering.add(s2.name);
  assertEquals((await runSandbox(d2, s2, [])).confirmedGone, false);
});

Deno.test("realDocker.run: a capture file that cannot be opened fails before any spawn and leaks no handle", async () => {
  const q = await tmp();
  const c = (o: string, e: string) => ({ stdoutPath: o, stderrPath: e, maxBytes: 1024, onStarted: () => {}, onOverflow: () => {} });
  await assertRejects(() => realDocker().run(["run"], c(join(q, "missing-dir", "raw.jsonl"), join(q, "err.txt"))));
  await assertRejects(() => realDocker().run(["run"], c(join(q, "raw.jsonl"), join(q, "missing-dir", "err.txt"))));
  await Deno.remove(join(q, "raw.jsonl")); // succeeds only if the handle was closed
});

Deno.test("realDocker.listOwned: label filter, prefix filter, context pinned", async () => {
  if (Deno.build.os === "windows") __setContextListerForTests(() => ["desktop-windows", "default"]);
  const mock = createCommandMock();
  mock.mockCommandOnce({ command: "docker", argsContain: ["ps", "-a"] }, {
    code: 0,
    stdout: "cg-harness-aaaaaaaa-11111111\ncg-harnessX-lookalike\nother-cg-harness-1\n\n",
    stderr: "",
  });
  mock.install();
  try {
    assertEquals(await realDocker().listOwned("HOST1"), ["cg-harness-aaaaaaaa-11111111"]);
    const call = mock.getCallsFor("docker")[0]!;
    assert(call.args.includes(`label=${OWNER_LABEL}=HOST1`));
    if (Deno.build.os === "windows") assertEquals(call.options?.env?.DOCKER_CONTEXT, "desktop-windows");
  } finally {
    mock.restore();
    __setContextListerForTests(undefined);
  }
});

Deno.test({ name: "sweep removes only owned containers, is bounded, and fails loudly when one survives", ...quick }, async () => {
  const d = new FakeDocker();
  d.owned = ["cg-harness-aaaaaaaa-11111111", "cg-harness-bbbbbbbb-22222222"];
  assertEquals(await sweepOwnedSandboxes(d, "HOST1", 50), d.owned);
  d.rmFails.add("cg-harness-bbbbbbbb-22222222");
  await assertRejects(() => sweepOwnedSandboxes(d, "HOST1", 50), ContainerError, "bbbbbbbb");
  const h = new FakeDocker();
  h.owned = ["cg-harness-cccccccc-33333333"];
  h.rmHangs = true;
  await assertRejects(() => sweepOwnedSandboxes(h, "HOST1", 30), ContainerError, "timed out");
});

Deno.test("prepareSecrets: declared files plus the token; short or missing secrets are refused", async () => {
  const src = await tmp();
  await Deno.writeTextFile(join(src, "claude-oauth-token"), "oauth-0123456789abcdef\n");
  await Deno.writeTextFile(join(src, "short"), "abc");
  const s = await prepareSecrets(src, ["claude-oauth-token"], TOKEN);
  assertEquals([...Deno.readDirSync(s.dir)].map((e) => e.name).sort(), ["backend-token", "claude-oauth-token"]);
  await assertRejects(() => prepareSecrets(src, ["short"], TOKEN), ConfigurationError, "16");
  await assertRejects(() => prepareSecrets(src, ["missing"], TOKEN), ConfigurationError, "missing");
  await assertRejects(() => prepareSecrets(src, ["..\\x"], TOKEN), ConfigurationError);
});

Deno.test("redaction is longest-first and complete; publishing is byte-safe and reads the quarantine", async () => {
  const secrets = [
    { name: "short-prefix", value: "abcdefghijklmnop" },
    { name: "long", value: "abcdefghijklmnopqrstuvwx" },
  ];
  const r = redactText("x abcdefghijklmnopqrstuvwx y abcdefghijklmnop", secrets);
  assertEquals([r.text, r.count], ["x [REDACTED:long] y [REDACTED:short-prefix]", 2]);
  const q = await tmp();
  const pub = await tmp();
  const u16 = new Uint8Array(new Uint16Array([...TOKEN].map((c) => c.charCodeAt(0))).buffer);
  await Deno.writeFile(join(q, "raw.jsonl"), new Uint8Array([...new TextEncoder().encode(`{"t":"${TOKEN}"}\n`), ...u16]));
  const n = await publishRedacted(
    [{ src: join(q, "raw.jsonl"), dest: join(pub, "raw.jsonl") }, { src: join(q, "none.txt"), dest: join(pub, "none.txt") }],
    [{ name: "backend-token", value: TOKEN }],
  );
  assertEquals(n, 2);
  assert(!(await Deno.readTextFile(join(pub, "raw.jsonl"))).includes(TOKEN));
  assert(!await exists(join(pub, "none.txt")));
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
 * accepted-risk and egress decisions). One `docker run` per execution, by
 * immutable image id, Hyper-V isolation, capture into a private quarantine.
 * Every docker verb is bounded; termination is confirmed (run settled,
 * container absent) before anyone may touch the workspace.
 */

import { join } from "@std/path";
import { dockerContextEnv } from "../container/docker-context.ts";
import { ConfigurationError, ContainerError } from "../errors.ts";
import { buildBindMountArg } from "../sandbox/windows-provider.ts";
import { redactBytes, type SecretValue } from "./fsutil.ts";

export type { SecretValue } from "./fsutil.ts";

export const SANDBOX_PREFIX = "cg-harness-";
export const OWNER_LABEL = "centralgauge.harness.owner";
export const EXECUTION_LABEL = "centralgauge.harness.execution";
export const MIN_SECRET_LENGTH = 16;
export const OP_TIMEOUT_MS = 60_000;
export const MAX_CAPTURE_BYTES = 256 * 1024 * 1024;

export interface Capture {
  stdoutPath: string;
  stderrPath: string;
  /** stdout plus stderr; bytes beyond it are dropped and onOverflow fires once. */
  maxBytes: number;
  onStarted(): void;
  onOverflow(): void;
}

export interface DockerCli {
  run(args: string[], c: Capture): Promise<number>;
  kill(name: string): Promise<number>;
  rm(name: string): Promise<{ code: number; stderr: string }>;
  pause(name: string): Promise<number>;
  unpause(name: string): Promise<number>;
  /** null when no such container exists. */
  state(name: string): Promise<{ running: boolean } | null>;
  listOwned(owner: string): Promise<string[]>;
  inspectImage(ref: string): Promise<unknown | null>;
  build(args: string[]): Promise<number>;
}

/** Resolve p or throw a ContainerError after ms. */
export async function bounded<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => (t = setTimeout(() => rej(new ContainerError(`${what} timed out after ${ms} ms`, "docker", "stop")), ms))),
    ]);
  } finally {
    clearTimeout(t);
  }
}

export function realDocker(opTimeoutMs = OP_TIMEOUT_MS): DockerCli {
  const dec = new TextDecoder();
  const out = async (args: string[]) => {
    try {
      const r = await new Deno.Command("docker", {
        args, env: dockerContextEnv(), stdout: "piped", stderr: "piped", signal: AbortSignal.timeout(opTimeoutMs),
      }).output();
      return { code: r.code, stdout: dec.decode(r.stdout), stderr: dec.decode(r.stderr) };
    } catch (err) {
      return { code: -1, stdout: "", stderr: `docker ${args[0]} failed or timed out: ${err instanceof Error ? err.message : err}` };
    }
  };
  return {
    async run(args, c) {
      // Both capture files are opened before the spawn; a failure closes what was opened.
      const o = await Deno.open(c.stdoutPath, { write: true, createNew: true });
      let e: Deno.FsFile;
      try {
        e = await Deno.open(c.stderrPath, { write: true, createNew: true });
      } catch (err) {
        o.close();
        throw err;
      }
      let child: Deno.ChildProcess;
      try {
        child = new Deno.Command("docker", {
          args, env: dockerContextEnv(), stdin: "null", stdout: "piped", stderr: "piped",
        }).spawn();
      } catch (err) {
        o.close();
        e.close();
        throw err;
      }
      c.onStarted();
      let total = 0;
      let overflowed = false;
      const cap = () =>
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, ctl) {
            if (total + chunk.length > c.maxBytes) {
              if (!overflowed) {
                overflowed = true;
                c.onOverflow();
              }
              return; // keep draining so the process never blocks on a full pipe
            }
            total += chunk.length;
            ctl.enqueue(chunk);
          },
        });
      await Promise.all([
        child.stdout.pipeThrough(cap()).pipeTo(o.writable),
        child.stderr.pipeThrough(cap()).pipeTo(e.writable),
      ]);
      return (await child.status).code;
    },
    kill: async (name) => (await out(["kill", name])).code,
    rm: async (name) => {
      const r = await out(["rm", "-f", name]);
      return { code: r.code, stderr: r.stderr };
    },
    pause: async (name) => (await out(["pause", name])).code,
    unpause: async (name) => (await out(["unpause", name])).code,
    state: async (name) => {
      const r = await out(["inspect", "--format", "{{.State.Running}}", name]);
      if (r.code === 0) return { running: r.stdout.trim() === "true" };
      if (/no such (object|container)/i.test(r.stderr)) return null;
      throw new ContainerError(`docker inspect ${name}: ${r.stderr.trim()}`, name, "stop");
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
      (await new Deno.Command("docker", { args, env: dockerContextEnv(), stdout: "inherit", stderr: "inherit" }).output())
        .code,
  };
}

export function sandboxName(campaignId: string, executionId: string): string {
  return `${SANDBOX_PREFIX}${campaignId.slice(0, 8)}-${executionId.slice(0, 8)}`;
}

export interface SandboxSpec {
  name: string;
  owner: string;
  executionId: string;
  /** Immutable image id (sha256:...), never a tag. */
  imageId: string;
  workspace: string;
  taskDir: string;
  configDir: string;
  secretsDir: string;
  extraMounts: { src: string; dst: string }[];
  /** Non-secret env only. */
  env: Record<string, string>;
  /** Docker network (M1-33's internal network when egress is enforced). */
  network?: string;
  /** Overrides the image's CMD (ops probes only). */
  command?: string[];
  timeoutMs: number;
  /** How long to wait for docker run to return after kill / rm -f. */
  killGraceMs: number;
  /** Deadline for each short docker verb. */
  opTimeoutMs: number;
  maxCaptureBytes: number;
  /** Quarantine paths (private, never under results/). */
  rawLog: string;
  stderrLog: string;
}

export function buildRunArgs(s: SandboxSpec): string[] {
  if (!/^sha256:[0-9a-f]{64}$/.test(s.imageId)) {
    throw new ConfigurationError(`sandbox image must be an immutable id (sha256:...), got ${s.imageId}`);
  }
  const m = (src: string, dst: string, ro: boolean) => ["--mount", buildBindMountArg(src, dst, ro)];
  return [
    "run", "--name", s.name,
    "--isolation", "hyperv",
    ...(s.network ? ["--network", s.network] : []),
    "--label", `${OWNER_LABEL}=${s.owner}`,
    "--label", `${EXECUTION_LABEL}=${s.executionId}`,
    ...m(s.workspace, "C:\\workspace", false),
    ...m(s.taskDir, "C:\\task", true),
    ...m(s.configDir, "C:\\config", true),
    ...m(s.secretsDir, "C:\\cg-secrets", true),
    ...s.extraMounts.flatMap((x) => m(x.src, x.dst, true)),
    ...Object.entries(s.env).sort(([a], [b]) => a.localeCompare(b)).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    s.imageId,
    ...(s.command ?? []),
  ];
}

export interface SandboxResult {
  exitCode: number | null;
  /** The docker process was spawned: money may have been spent. */
  started: boolean;
  startError: string | null;
  timedOut: boolean;
  interrupted: boolean;
  overflow: boolean;
  /** docker run settled (captures closed) and the container no longer exists. */
  confirmedGone: boolean;
  cleanup: "ok" | string;
  wall_ms: number;
}

async function settle<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<"timeout">((r) => (t = setTimeout(() => r("timeout"), ms)))]);
  } finally {
    clearTimeout(t);
  }
}

export async function runSandbox(
  docker: DockerCli,
  spec: SandboxSpec,
  secretValues: string[],
  stop?: AbortSignal,
): Promise<SandboxResult> {
  const args = buildRunArgs(spec);
  if (secretValues.some((v) => v.length > 0 && args.some((a) => a.includes(v)))) {
    throw new ConfigurationError(`refusing docker run: a secret value appears in argv or env (${spec.name})`);
  }
  const t0 = performance.now();
  const r: SandboxResult = {
    exitCode: null, started: false, startError: null, timedOut: false, interrupted: false, overflow: false,
    confirmedGone: false, cleanup: "ok", wall_ms: 0,
  };
  const problems: string[] = [];
  const op = async <T>(p: Promise<T>, what: string): Promise<T | null> => {
    try {
      return await bounded(p, spec.opTimeoutMs, what);
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
      return null;
    }
  };
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestStop!: () => void;
  const stopped = new Promise<void>((res) => (requestStop = res));
  const onAbort = () => {
    r.interrupted = true;
    requestStop();
  };
  try {
    timer = setTimeout(() => {
      r.timedOut = true;
      requestStop();
    }, spec.timeoutMs);
    if (stop?.aborted) onAbort();
    stop?.addEventListener("abort", onAbort, { once: true });
    const running = docker.run(args, {
      stdoutPath: spec.rawLog,
      stderrPath: spec.stderrLog,
      maxBytes: spec.maxCaptureBytes,
      onStarted: () => (r.started = true),
      onOverflow: () => {
        r.overflow = true;
        requestStop();
      },
    }).finally(() => (settled = true));
    const first = await Promise.race([running.then((c) => ({ c })), stopped.then(() => null)]);
    if (first) r.exitCode = first.c;
    else {
      // Stop: kill (bounded); a failed or hung kill falls through to rm -f; each wait is bounded.
      const k = await op(docker.kill(spec.name), `docker kill ${spec.name}`);
      let res = await settle(running, spec.killGraceMs);
      if (res === "timeout" || k !== 0) {
        await op(docker.rm(spec.name), `docker rm -f ${spec.name}`);
        if (res === "timeout") res = await settle(running, spec.killGraceMs);
      }
      if (res === "timeout") problems.push(`container ${spec.name} did not stop after kill and rm -f`);
      else r.exitCode = res;
    }
  } catch (err) {
    r.startError = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
    stop?.removeEventListener("abort", onAbort);
    const rm = await op(docker.rm(spec.name), `docker rm -f ${spec.name}`);
    if (rm && rm.code !== 0 && !/no such container/i.test(rm.stderr)) {
      problems.push(`docker rm -f ${spec.name} exited ${rm.code}: ${rm.stderr.trim()}`);
    }
    let gone = false;
    try {
      gone = (await bounded(docker.state(spec.name), spec.opTimeoutMs, `docker inspect ${spec.name}`)) === null;
      if (!gone) problems.push(`container ${spec.name} still exists after rm -f`);
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
    r.confirmedGone = (settled || !r.started) && gone;
    if (problems.length > 0) r.cleanup = problems.join("; ");
  }
  r.wall_ms = performance.now() - t0;
  return r;
}

export async function sweepOwnedSandboxes(docker: DockerCli, owner: string, opTimeoutMs = OP_TIMEOUT_MS): Promise<string[]> {
  const names = await bounded(docker.listOwned(owner), opTimeoutMs, "docker ps");
  const failed: string[] = [];
  for (const n of names) {
    try {
      const r = await bounded(docker.rm(n), opTimeoutMs, `docker rm -f ${n}`);
      if (r.code !== 0 && !/no such container/i.test(r.stderr)) failed.push(`${n}: ${r.stderr.trim()}`);
    } catch (err) {
      failed.push(`${n}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (failed.length > 0) {
    throw new ContainerError(`could not remove leftover sandboxes: ${failed.join("; ")}`, failed[0]!.split(":")[0]!, "setup");
  }
  return names;
}

export async function prepareSecrets(
  source: string,
  files: readonly string[],
  backendToken: string,
): Promise<{ dir: string; values: SecretValue[] }> {
  const dir = await Deno.makeTempDir({ prefix: "cg-harness-secrets-" });
  try {
    const values: SecretValue[] = [];
    const add = async (name: string, value: string) => {
      if (value.length < MIN_SECRET_LENGTH) {
        throw new ConfigurationError(`secret ${name} is shorter than ${MIN_SECRET_LENGTH} characters`);
      }
      await Deno.writeTextFile(join(dir, name), value);
      values.push({ name, value });
    };
    for (const f of files) {
      if (!/^[A-Za-z0-9._-]+$/.test(f) || f.startsWith(".")) throw new ConfigurationError(`bad secret file name: ${f}`);
      let v: string;
      try {
        v = (await Deno.readTextFile(join(source, f))).trim();
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) throw new ConfigurationError(`harness secret ${f} not found in ${source}`);
        throw err;
      }
      await add(f, v);
    }
    await add("backend-token", backendToken);
    return { dir, values };
  } catch (err) {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
    throw err;
  }
}

export async function removeSecrets(dir: string): Promise<void> {
  await Deno.remove(dir, { recursive: true }).catch(() => {});
}

/** Replace every exact secret value in a string, longest first. */
export function redactText(text: string, secrets: SecretValue[]): { text: string; count: number } {
  let count = 0;
  let next = text;
  for (const s of [...secrets].sort((a, b) => b.value.length - a.value.length)) {
    if (s.value.length === 0) continue;
    count += next.split(s.value).length - 1;
    next = next.replaceAll(s.value, `[REDACTED:${s.name}]`);
  }
  return { text: next, count };
}

/** Copy quarantined files to fresh destinations, byte-wise redacted. Missing sources are skipped. */
export async function publishRedacted(files: { src: string; dest: string }[], secrets: SecretValue[]): Promise<number> {
  let count = 0;
  for (const f of files) {
    let data: Uint8Array;
    try {
      data = await Deno.readFile(f.src);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) continue;
      throw err;
    }
    const r = redactBytes(data, secrets);
    count += r.count;
    await Deno.mkdir(join(f.dest, ".."), { recursive: true });
    await Deno.writeFile(f.dest, r.out, { createNew: true });
  }
  return count;
}
```

Captured logs are bounded by `maxCaptureBytes`, so `publishRedacted` reads each whole file.

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/sandbox.test.ts`
Expected: all 14 tests pass.

- [ ] **Step 5: Check, lint, format** (the three files)

- [ ] **Step 6: Commit**

```bash
git add src/harness/sandbox.ts tests/unit/harness/fake-docker.ts tests/unit/harness/sandbox.test.ts
git commit -m "feat(harness): sandbox runtime with bounded verbs, confirmed termination, capture cap and interrupt"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/sandbox.test.ts` passes (the hung-kill/rm, interrupt, overflow, started/not-started and lingering-container tests among them); check, lint and `deno fmt --check` clean.

---

### Task M1-13: symbols lock, app graph and refapp staging

Spec 1a section 5 item 1 (staging: refapp snapshot at an immutable commit + task overlay + `Test\` + pre-seeded `.alpackages`; the staging interface returns a workspace and its app list in dependency order; D16 pluggable sources, only the interface for `git`), 1b section 5 (overlay applies injected bug, stub or removed feature), Part 1 contracts (staging copies exactly `resolveRefapp(...).files`; `C:\task` gets `agentVisibleMetadata`; symbols lock `{ v: 1, packages }`, written here so identities stop being provisional). Findings section 6 and the M0-06 carryover: 263 symbol apps, 400 MB, from the BCH compiler cache; this plan keeps them in a host symbol store keyed by digest and copies them per staging (the shared read-only symbol mount is an M3 toolchain decision). The `altool GetPackageManifest` JSON key names are checked on a real cache in M1-26.

A removed file is expressed by `overlay/.delete`: one workspace-relative path per line (blank lines and `#` comments ignored). It is part of the overlay tree, so it is in the visible-input hash.

**Lane:** infra2 (stream B). **Deps:** M1-01 (`loadTask`), M1-02 (`hashFile(root, path)`, `listTree`, `isTaskBuildArtifact`), M1-04 (`resolveRefapp`, `SymbolsLockSchema`, `agentVisibleMetadata`), M1-12. **Date:** 09-28.

Revision 2 changes: `hashFile` takes its root (M1-02 ruling); every directory goes through `validatedDir`/`validatedDest`; overlay application refuses case-ambiguous and linked entries; fixture ids follow M4 (shipped tests 80010, library 80090, HX-001 oracle 85000); `applyOverlay` is the one overlay implementation (the mock and `judge-fixture` reuse it, so `.delete` semantics are identical everywhere). Round 3 B1: `safeCopyTree` keeps its strict new-or-empty destination rule, so `applyOverlay` first copies the overlay into fresh private scratch with it, then performs an explicitly validated merge into the populated workspace: every destination directory is validated or created under a validated parent, and an existing destination entry must be a plain file with the same canonical spelling (a link, a directory or a case alias is refused).

**Files:**
- Create: `src/harness/symbols.ts`
- Create: `src/harness/staging.ts`
- Create: `tests/unit/harness/refapp-fixture.ts` (temp refapp repo reused by M1-14 to M1-24)
- Create: `scripts/harness/symbols-lock.ts` (operator script for M1-26 on 09-29; `harness symbols lock` in M1-24 calls the same functions)
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
  - { codeunit: 80010, procedures: [ShippedPasses] }
fail_to_pass:
  depends_on: [Rental]
  tests:
    - { codeunit: 85000, procedures: [FixWorks] }
limits: { timeout_min: 20 }
`;

export interface RefappRepo {
  root: string;
  tasksDir: string;
  symbolStore: string;
  symbols: SymbolPackage[];
}

export async function makeRefappRepo(): Promise<RefappRepo> {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "cg-refapp-" }));
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
    appJson(IDS.test, "CGR Test", [80000, 84999], [
      { id: IDS.core, name: "CGR Core" },
      { id: IDS.rental, name: "CGR Rental" },
      { id: IDS.assert, name: "Library Assert" },
    ]),
  );
  await write(
    root,
    `${r}/Test/src/Shipped.Test.al`,
    `codeunit 80010 "CGR Shipped Tests"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure ShippedPasses()\n    begin\n    end;\n}\n`,
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
    `codeunit 85000 "HX-001 Oracle"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure FixWorks()\n    begin\n    end;\n}\n`,
  );
  await write(root, `${t}/correct/Rental/src/Rental.Codeunit.al`, rental("exit(10); // FIXED"));
  await write(root, `${t}/naive/a/Rental/src/Rental.Codeunit.al`, rental("exit(12); // NAIVE"));

  const symbolStore = await Deno.realPath(await Deno.makeTempDir({ prefix: "cg-symstore-" }));
  const file = "Microsoft_Library Assert_28.0.0.0.app";
  const tmp = join(symbolStore, file);
  await Deno.writeTextFile(tmp, "assert-symbols");
  const sha256 = await hashFile(symbolStore, tmp);
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
  applyOverlay,
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
      out: join(await Deno.realPath(await Deno.makeTempDir()), "stage"),
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

Deno.test("applyOverlay: merges into a populated workspace; a linked destination or a case alias is refused", async () => {
  const tmp = async () => await Deno.realPath(await Deno.makeTempDir());
  const ws = await tmp();
  await write(ws, "Rental/src/Rental.al", "old");
  await write(ws, "Core/src/Core.al", "core");
  const ov = await tmp();
  await write(ov, "Rental/src/Rental.al", "new");
  await write(ov, "Rental/src/Added.al", "added");
  await write(ov, "Fresh/src/F.al", "fresh");
  await write(ov, ".delete", "Core/src/Core.al\n");
  await applyOverlay(ov, ws);
  assertEquals(await Deno.readTextFile(join(ws, "Rental", "src", "Rental.al")), "new");
  assert(await exists(join(ws, "Rental", "src", "Added.al")) && await exists(join(ws, "Fresh", "src", "F.al")));
  assert(!await exists(join(ws, "Core", "src", "Core.al")));
  const outside = await tmp();
  await Deno.symlink(outside, join(ws, "Linked"), { type: Deno.build.os === "windows" ? "junction" : "dir" });
  const ov2 = await tmp();
  await write(ov2, "Linked/x.al", "x");
  await assertRejects(() => applyOverlay(ov2, ws), ValidationError);
  assert(!await exists(join(outside, "x.al")));
  if (Deno.build.os === "windows") {
    const ov3 = await tmp();
    await write(ov3, "Rental/src/rental.al", "alias");
    await assertRejects(() => applyOverlay(ov3, ws), ValidationError, "case");
  }
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
  const ws = await Deno.realPath(await Deno.makeTempDir());
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
  const from = await Deno.realPath(await Deno.makeTempDir());
  const store = await Deno.realPath(await Deno.makeTempDir());
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
  assertEquals(sys.sha256, await hashFile(from, join(from, sys.file)));
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
    const sha256 = await hashFile(fromDir, path);
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
      if (!await exists(src) || await hashFile(store, src) !== p.sha256) {
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
import { exists, safeCopyTree, validatedDest, validatedDir } from "./fsutil.ts";
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
  const root = await validatedDir(target);
  // 1. Hostile copy into fresh private scratch (the strict new-or-empty API is unchanged).
  const tmp = await Deno.makeTempDir({ prefix: "cg-overlay-" });
  try {
    const r = await safeCopyTree(overlayDir, join(tmp, "o"), {
      skip: (rel) => rel === DELETE_LIST || (opts.exclude?.(rel) ?? false),
    });
    if (r.refused.length + r.ambiguous.length > 0) {
      const bad = [...r.refused, ...r.ambiguous];
      throw new ValidationError(`links or case-ambiguous names in ${overlayDir}: ${bad.join(", ")}`, bad);
    }
    // 2. Validated merge into the populated workspace.
    const files: string[] = [];
    const walk = async (d: string, rel: string): Promise<void> => {
      for await (const e of Deno.readDir(d)) {
        const r1 = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory) await walk(join(d, e.name), r1);
        else files.push(r1);
      }
    };
    await walk(r.dst, "");
    for (const rel of files.sort()) {
      const parts = rel.split("/");
      const dir = await validatedDest(join(root, ...parts.slice(0, -1)));
      const dest = join(dir, parts.at(-1)!);
      const st = await Deno.lstat(dest).catch(() => null);
      if (st) {
        if (st.isSymlink || !st.isFile) throw new ValidationError(`overlay destination is not a plain file: ${rel}`, [rel]);
        if (await Deno.realPath(dest) !== dest) throw new ValidationError(`overlay destination is a case alias: ${rel}`, [rel]);
      } else {
        const alias = [...Deno.readDirSync(dir)].find((e) => e.name.toLowerCase() === parts.at(-1)!.toLowerCase());
        if (alias) throw new ValidationError(`overlay destination is a case alias of ${alias.name}: ${rel}`, [rel]);
      }
      await Deno.copyFile(join(r.dst, ...parts), dest);
    }
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
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
    const p = join(root, ...line.replaceAll("\\", "/").split("/"));
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
  const out = await validatedDest(o.out);
  const workspace = await validatedDest(join(out, "workspace"));
  const pristine = join(out, "pristine");
  const taskDir = await validatedDest(join(out, "task"));
  const extract = await validatedDest(join(out, "refapp-extract"));
  // 1. The refapp source at the resolved commit, build artifacts dropped:
  //    exactly the files resolveRefapp hashed (Part 1 contract).
  const tar = join(out, "refapp.tar");
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
  await Deno.writeFile(join(taskDir, "prompt.md"), await Deno.readFile(join(o.task.dir, t.prompt)));
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

- [ ] **Step 4b: Add the operator script** `scripts/harness/symbols-lock.ts` (no container; reads a compiler-cache symbols folder the operator names):

```typescript
/**
 * Write harness-tasks/symbols.lock.json from a BCH compiler-cache symbols
 * folder (M1-26). Usage:
 *   deno run --allow-all scripts/harness/symbols-lock.ts --from <symbolsDir> --store <symbolStore> [--altool <path>]
 */

import { parseArgs } from "@std/cli/parse-args";
import { altoolReader, buildSymbolsLock, defaultAltool, writeSymbolsLock } from "../../src/harness/symbols.ts";

const a = parseArgs(Deno.args, { string: ["from", "store", "altool"] });
if (!a.from || !a.store) {
  console.error("usage: symbols-lock.ts --from <symbolsDir> --store <symbolStore> [--altool <path>]");
  Deno.exit(64);
}
const lock = await buildSymbolsLock(a.from, a.store, altoolReader(a.altool ?? defaultAltool(a.from)));
await writeSymbolsLock(Deno.cwd(), lock);
console.log(`[OK] ${lock.packages.length} symbol packages locked; store ${a.store}`);
```

(`@std/cli` is already a dependency; this is a one-shot operator script, so plain `parseArgs` is enough.)

- [ ] **Step 5: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/staging.test.ts`
Expected: all 8 tests pass (needs `git` and `tar` on PATH; Windows 10+ ships `tar.exe`).

- [ ] **Step 6: Check, lint, format**

```bash
deno check src/harness/symbols.ts src/harness/staging.ts tests/unit/harness/refapp-fixture.ts tests/unit/harness/staging.test.ts
deno lint src/harness/symbols.ts src/harness/staging.ts tests/unit/harness/refapp-fixture.ts tests/unit/harness/staging.test.ts
deno fmt src/harness/symbols.ts src/harness/staging.ts tests/unit/harness/refapp-fixture.ts tests/unit/harness/staging.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/harness/symbols.ts src/harness/staging.ts scripts/harness/symbols-lock.ts tests/unit/harness/refapp-fixture.ts tests/unit/harness/staging.test.ts
git commit -m "feat(harness): symbols lock, app graph and refapp task staging"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/staging.test.ts` passes; check, lint and `deno fmt --check` clean on the four files.

---

### Task M1-14: verdict workspace reconstruction and validation

Spec 1a section 7 items 1-4 and section 11; review section 2 items 2 and 5 (case-alias bypass of shipped-test restoration; take only permitted source files and keep trusted compiler settings; adversarial lexer fixtures). Rules:

- Start from the staged workspace (`pristine`, trusted), symbols included.
- Production app folders are replaced by the artifact's folder (or the reference, for test-authoring) but only **source files** are taken: `.al`, `.xlf`, `.rdl`, `.rdlc`, `.docx`, `.xlsx`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, plus `app.json`. Everything else (scripts, rulesets, `.vscode`, extensionless files, `*.app`) is dropped.
- `app.json` is rebuilt from the pristine one: only `dependencies` come from the artifact. A changed `id`, `name`, `publisher` or `idRanges` is a violation; other fields (`runtime`, `target`, `features`, `platform`, `application`, `version`) silently stay trusted.
- `Test\`: shipped files are restored; new source files are taken. A path that equals a shipped path case-insensitively but not exactly is a **violation** (case-alias bypass).
- Validation: dependencies acyclic and inside the workspace plus the symbols lock; object ids inside the pristine app's `idRanges`, outside 75000-79999 and 85000-89999; in the Test app additionally not 80013 and not the fixture band 84900-84999.
- Declarations are scanned after a small lexer removes comments and string literals (quoted identifiers kept), so `'/*'` in a string cannot hide the next declaration.

**Lane:** infra2 (stream B). **Deps:** M1-02, M1-11 (constants), M1-12, M1-13. **Date:** 09-29.

**Files:**
- Create: `src/harness/verdict-workspace.ts`
- Test: `tests/unit/harness/verdict-workspace.test.ts`

**Interfaces:**
- Produces: `TEST_APP = "Test"`; `SOURCE_EXTENSIONS`; `isSourceFile(rel): boolean`; `interface ReconstructOptions { pristine; artifact; out; productionFrom?: string | undefined; symbolIds: ReadonlySet<string> }`; `interface VerdictWorkspace { dir; apps: StagedApp[]; changed: string[]; violations: string[] }`; `buildVerdictWorkspace(o)`; `validateApps(dir, pristine, apps, symbolIds): Promise<string[]>`; `stripAlNoise(src): string`; `interface AlObjectRef { file; kind; id }`; `alObjects(dir)`; `interface TestCodeunit { codeunit; file; testPage: boolean; procedures: string[] /* [Test] procedures, discovered */ }`; `testCodeunits(dir)`; `addedTestCodeunits(pristineTest, test)`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/verdict-workspace.test.ts`:

```typescript
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists, FREEZE_VIOLATIONS_FILE, safeCopyTree } from "../../../src/harness/fsutil.ts";
import {
  addedTestCodeunits,
  alObjects,
  buildVerdictWorkspace,
  stripAlNoise,
} from "../../../src/harness/verdict-workspace.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";

const SHIPPED =
  `codeunit 80010 "CGR Shipped Tests"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure ShippedPasses()\n    begin\n        Assert.AreEqual(10, Rental.Price(), 'price');\n    end;\n}\n`;
const tmp = async () => await Deno.realPath(await Deno.makeTempDir());

async function pristineDir(): Promise<string> {
  const d = await tmp();
  await write(d, "Core/app.json", appJson(IDS.core, "CGR Core", [70000, 70099], []));
  await write(d, "Core/src/Core.Codeunit.al", `codeunit 70000 "CGR Core"\n{\n}\n`);
  await write(d, "Core/src/Extra.Codeunit.al", `codeunit 70001 "CGR Extra"\n{\n}\n`);
  await write(d, "Test/app.json", appJson(IDS.test, "CGR Test", [80000, 84999], [
    { id: IDS.core, name: "CGR Core" },
    { id: IDS.assert, name: "Library Assert" },
  ]));
  await write(d, "Test/src/Shipped.Test.al", SHIPPED);
  await write(d, ".alpackages/Microsoft_Library Assert_28.0.0.0.app", "sym");
  return d;
}

async function artifactFrom(pristine: string, edits: Record<string, string | null>): Promise<string> {
  const a = await tmp();
  await safeCopyTree(pristine, a, { skip: (r) => r.startsWith(".alpackages") });
  for (const [rel, text] of Object.entries(edits)) {
    if (text === null) await Deno.remove(join(a, rel));
    else await write(a, rel, text);
  }
  return a;
}

const SYM = new Set([IDS.assert]);
const rebuild = async (p: string, a: string, productionFrom?: string) =>
  await buildVerdictWorkspace({ pristine: p, artifact: a, out: join(await tmp(), "verdict"), symbolIds: SYM, productionFrom });

Deno.test("a shipped test edited to always pass is restored", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, { "Test/src/Shipped.Test.al": SHIPPED.replace(/Assert\.AreEqual[^\n]*\n/, "\n") });
  const v = await rebuild(p, a);
  assertEquals(await Deno.readTextFile(join(v.dir, "Test/src/Shipped.Test.al")), SHIPPED);
  assertEquals([v.violations, v.changed], [[], []]);
});

Deno.test("a case alias of a shipped test is a violation", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, { "Test/src/Shipped.Test.al": null, "Test/src/shipped.test.al": "codeunit 80011 X\n{\n}\n" });
  const v = await rebuild(p, a);
  assertStringIncludes(v.violations.join("\n"), "case alias of a shipped test file: Test/src/shipped.test.al");
  assertEquals(await Deno.readTextFile(join(v.dir, "Test/src/Shipped.Test.al")), SHIPPED);
});

Deno.test("only source files are taken; build output, scripts and new folders are dropped", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {
    "Core/CentralGauge_CGR Core_9.9.9.9.app": "fake",
    ".alpackages/Evil.app": "fake",
    "Core/build.ps1": "Remove-Item C:\\",
    "Core/.vscode/settings.json": "{}",
    "Core/LICENSE": "x",
    "Core/translations/Core.g.xlf": "<xliff/>",
    "NewApp/app.json": appJson("c6a1e000-0000-4000-8000-0000000000ee", "New", [70500, 70599], []),
    "AGENTS.md": "notes",
  });
  const v = await rebuild(p, a);
  for (const gone of ["Core/CentralGauge_CGR Core_9.9.9.9.app", ".alpackages/Evil.app", "Core/build.ps1", "Core/.vscode", "Core/LICENSE", "NewApp", "AGENTS.md"]) {
    assert(!await exists(join(v.dir, gone)), gone);
  }
  assert(await exists(join(v.dir, "Core/translations/Core.g.xlf")));
  assert(await exists(join(v.dir, ".alpackages/Microsoft_Library Assert_28.0.0.0.app")));
});

Deno.test("app.json: identity changes are violations, compiler settings stay trusted, dependencies are taken", async () => {
  const p = await pristineDir();
  const changed = JSON.parse(appJson("c6a1e000-0000-4000-8000-0000000000aa", "CGR Core2", [70000, 70999], []));
  changed.runtime = "99.0";
  const v1 = await rebuild(p, await artifactFrom(p, { "Core/app.json": JSON.stringify(changed) }));
  const text = v1.violations.join("\n");
  for (const k of ["id changed", "name changed", "idRanges changed"]) assertStringIncludes(text, `Core: ${k}`);
  const settings = JSON.parse(appJson(IDS.core, "CGR Core", [70000, 70099], [{ id: IDS.assert, name: "Library Assert" }]));
  settings.runtime = "99.0";
  const v2 = await rebuild(p, await artifactFrom(p, { "Core/app.json": JSON.stringify(settings) }));
  assertEquals(v2.violations, []);
  const merged = JSON.parse(await Deno.readTextFile(join(v2.dir, "Core/app.json")));
  assertEquals(merged.runtime, "17.0");
  assertEquals(merged.dependencies.map((d: { id: string }) => d.id), [IDS.assert]);
});

Deno.test("object ids: outside idRanges, reserved band, oracle band, 80013 and the fixture band", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {
    "Core/src/Far.Codeunit.al": `codeunit 70150 "Far"\n{\n}\n`,
    "Core/src/Reserved.Codeunit.al": `codeunit 75001 "R"\n{\n}\n`,
    "Test/src/Oracle.Test.al": `codeunit 85001 "O"\n{\n    Subtype = Test;\n}\n`,
    "Test/src/Clash.Test.al": `codeunit 80013 "C"\n{\n    Subtype = Test;\n}\n`,
    "Test/src/Fixture.Test.al": `codeunit 84950 "F"\n{\n    Subtype = Test;\n}\n`,
  });
  const text = (await rebuild(p, a)).violations.join("\n");
  for (const n of ["codeunit 70150 is outside the app's idRanges", "codeunit 75001 is in the reserved band", "codeunit 85001 is in the hidden-oracle band", "codeunit 80013 is forbidden", "codeunit 84950 is in the harness fixture band"]) {
    assertStringIncludes(text, n);
  }
});

Deno.test("stripAlNoise: comments and strings cannot hide or fake a declaration", async () => {
  const src = [
    "// codeunit 75002 \"not real\"",
    "/* codeunit 75003 \"nor this\" 'quote */",
    "codeunit 70002 \"Fine // not a comment\"",
    "{ var s: Text; begin s := '/*'; end; }",
    "codeunit 75004 \"Hidden after string\"",
    "{ }",
  ].join("\n");
  const d = await tmp();
  await write(d, "x.al", src);
  assertEquals((await alObjects(d)).map((o) => o.id), [70002, 75004]);
  assertEquals(stripAlNoise("a 'b''c' d").replace(/\s+/g, " ").trim(), "a d");
});

Deno.test("freeze violations and unknown dependencies fail validation", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {
    [FREEZE_VIOLATIONS_FILE]: "link, reparse point or special file: Core/hostlink\n",
    "Core/app.json": appJson(IDS.core, "CGR Core", [70000, 70099], [{ id: "11111111-2222-4333-8444-555555555555", name: "Unknown" }]),
  });
  const text = (await rebuild(p, a)).violations.join("\n");
  assertStringIncludes(text, "workspace link, reparse point or special file: Core/hostlink");
  assertStringIncludes(text, "11111111-2222-4333-8444-555555555555 is neither");
});

Deno.test("a deleted production file stays deleted and the app is changed", async () => {
  const p = await pristineDir();
  const v = await rebuild(p, await artifactFrom(p, { "Core/src/Extra.Codeunit.al": null }));
  assert(!await exists(join(v.dir, "Core/src/Extra.Codeunit.al")));
  assertEquals(v.changed, ["Core"]);
});

Deno.test("test-authoring: production from the reference, tests from the artifact", async () => {
  const p = await pristineDir();
  const reference = await artifactFrom(p, { "Core/src/Core.Codeunit.al": `codeunit 70000 "CGR Core"\n{\n    // reference\n}\n` });
  const a = await artifactFrom(p, {
    "Core/src/Core.Codeunit.al": `codeunit 70000 "CGR Core"\n{\n    // agent change\n}\n`,
    "Test/src/Agent.Test.al": `codeunit 81000 "Agent"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure PriceIsTen()\n    begin\n    end;\n\n    [Test]\n    [HandlerFunctions('Confirm')]\n    procedure "Rejects Invoiced"()\n    begin\n    end;\n\n    procedure Helper()\n    begin\n    end;\n\n    // [Test] procedure Commented()\n}\n`,
  });
  const v = await rebuild(p, a, reference);
  assertStringIncludes(await Deno.readTextFile(join(v.dir, "Core/src/Core.Codeunit.al")), "reference");
  const added = await addedTestCodeunits(join(p, "Test"), join(v.dir, "Test"));
  assertEquals(added.map((t) => [t.codeunit, t.procedures]), [[81000, ["PriceIsTen", "Rejects Invoiced"]]]);
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
 * workspace as-is: the staged copy, plus permitted source files from the
 * artifact (or the reference, for test-authoring), plus new Test\ sources;
 * app.json rebuilt from the trusted one. Violations fail the build scorer.
 */

import { join } from "@std/path";
import {
  BENCHMARK_APP_ID_BUFFER,
  HARNESS_FIXTURE_TEST_RANGE,
  HARNESS_FORBIDDEN_IDS,
  HARNESS_ORACLE_RANGE,
} from "../constants.ts";
import { ValidationError } from "../errors.ts";
import { hashTree, isTaskBuildArtifact, listTree } from "./hash.ts";
import { exists, FREEZE_VIOLATIONS_FILE, safeCopyTree, validatedDest } from "./fsutil.ts";
import { readAppGraph, type StagedApp } from "./staging.ts";

export const TEST_APP = "Test";
export const SOURCE_EXTENSIONS = [".al", ".xlf", ".rdl", ".rdlc", ".docx", ".xlsx", ".png", ".jpg", ".jpeg", ".gif", ".bmp"];

export function isSourceFile(rel: string): boolean {
  const lower = rel.toLowerCase();
  return lower === "app.json" || SOURCE_EXTENSIONS.some((e) => lower.endsWith(e));
}

/** Directories pass; files pass only when they are sources and not build artifacts. */
const sourcesOnly = (rel: string, isDir: boolean) =>
  isTaskBuildArtifact(rel) || (!isDir && !isSourceFile(rel.split("/").pop()!)) ||
  rel.split("/").some((s) => s.startsWith("."));

export interface ReconstructOptions {
  pristine: string;
  artifact: string;
  out: string;
  productionFrom?: string | undefined;
  symbolIds: ReadonlySet<string>;
}

export interface VerdictWorkspace {
  dir: string;
  apps: StagedApp[];
  changed: string[];
  violations: string[];
}

const IDENTITY = ["id", "name", "publisher"] as const;

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Trusted app.json with only `dependencies` from the candidate; identity changes are violations. */
async function mergeAppJson(folder: string, trustedPath: string, candidatePath: string, violations: string[]) {
  const trusted = (await readJson(trustedPath))!;
  const cand = await readJson(candidatePath);
  if (cand === null) {
    violations.push(`${folder}: app.json missing or unreadable`);
    await Deno.writeTextFile(candidatePath, JSON.stringify(trusted, null, 2));
    return;
  }
  for (const k of IDENTITY) {
    const a = String(trusted[k] ?? "");
    const b = String(cand[k] ?? "");
    if (k === "id" ? a.toLowerCase() !== b.toLowerCase() : a !== b) {
      violations.push(`${folder}: ${k} changed from ${a} to ${b}`);
    }
  }
  if (JSON.stringify(trusted.idRanges ?? []) !== JSON.stringify(cand.idRanges ?? [])) {
    violations.push(`${folder}: idRanges changed`);
  }
  const merged = { ...trusted, dependencies: Array.isArray(cand.dependencies) ? cand.dependencies : trusted.dependencies ?? [] };
  await Deno.writeTextFile(candidatePath, JSON.stringify(merged, null, 2));
}

export async function buildVerdictWorkspace(o: ReconstructOptions): Promise<VerdictWorkspace> {
  const violations: string[] = [];
  const pristineApps = await readAppGraph(o.pristine);
  const copy = await safeCopyTree(o.pristine, o.out);
  const out = copy.dst;

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
    await Deno.remove(join(out, app.folder), { recursive: true });
    const r = await safeCopyTree(src, join(out, app.folder), { skip: sourcesOnly });
    violations.push(...r.refused.map((p) => `link refused: ${app.folder}/${p}`));
    violations.push(...r.ambiguous.map((p) => `case-ambiguous name: ${app.folder}/${p}`));
    await mergeAppJson(app.folder, join(o.pristine, app.folder, "app.json"), join(out, app.folder, "app.json"), violations);
  }

  const testSrc = join(o.artifact, TEST_APP);
  if (await exists(testSrc)) {
    const shipped = new Map((await listTree(join(o.pristine, TEST_APP), "task")).map((e) => [e.path.toLowerCase(), e.path]));
    const scratch = join(out, ".cg-test-incoming");
    const r = await safeCopyTree(testSrc, scratch, { skip: sourcesOnly });
    violations.push(...r.refused.map((p) => `link refused: ${TEST_APP}/${p}`));
    violations.push(...r.ambiguous.map((p) => `case-ambiguous name: ${TEST_APP}/${p}`));
    for (const e of await listTree(scratch, "task")) {
      const known = shipped.get(e.path.toLowerCase());
      if (e.path === "app.json") continue;
      if (known !== undefined && known !== e.path) {
        violations.push(`case alias of a shipped test file: ${TEST_APP}/${e.path}`);
        continue;
      }
      if (known !== undefined) continue; // shipped: the pristine copy stays
      const dest = join(out, TEST_APP, ...e.path.split("/"));
      await validatedDest(join(dest, ".."));
      await Deno.writeFile(dest, await Deno.readFile(join(scratch, ...e.path.split("/"))));
    }
    if (await exists(join(scratch, "app.json"))) {
      await Deno.copyFile(join(scratch, "app.json"), join(out, TEST_APP, "app.json"));
    }
    await Deno.remove(scratch, { recursive: true });
    await mergeAppJson(TEST_APP, join(o.pristine, TEST_APP, "app.json"), join(out, TEST_APP, "app.json"), violations);
  }

  let apps = pristineApps;
  try {
    apps = await readAppGraph(out);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    violations.push(err.message);
  }
  violations.push(...await validateApps(out, pristineApps, apps, o.symbolIds));

  const changed: string[] = [];
  for (const app of pristineApps) {
    if (await hashTree(join(o.pristine, app.folder), "task") !== await hashTree(join(out, app.folder), "task")) {
      changed.push(app.folder);
    }
  }
  return { dir: out, apps, changed, violations };
}

/**
 * Remove comments and string literals (quoted identifiers kept), keeping
 * newlines so line-based declaration scanning still works.
 */
export function stripAlNoise(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
    } else if (c === "'") {
      i++;
      while (i < n) {
        if (src[i] === "'" && src[i + 1] === "'") i += 2;
        else if (src[i] === "'") {
          i++;
          break;
        } else {
          if (src[i] === "\n") out += "\n";
          i++;
        }
      }
      out += " ";
    } else if (c === '"') {
      out += c;
      i++;
      while (i < n && src[i] !== '"' && src[i] !== "\n") out += src[i++];
      if (src[i] === '"') out += src[i++];
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const OBJECT_RE =
  /^\s*(tableextension|pageextension|reportextension|enumextension|permissionsetextension|table|page|report|query|xmlport|codeunit|enum|permissionset|entitlement)\s+(\d+)\b/i;

export interface AlObjectRef {
  file: string;
  kind: string;
  id: number;
}

export async function alObjects(dir: string): Promise<AlObjectRef[]> {
  const out: AlObjectRef[] = [];
  for (const e of await listTree(dir, "task", { optional: true })) {
    if (!e.path.toLowerCase().endsWith(".al")) continue;
    for (const line of stripAlNoise(await Deno.readTextFile(join(dir, e.path))).split(/\r?\n/)) {
      const m = OBJECT_RE.exec(line);
      if (m) out.push({ file: e.path, kind: m[1]!.toLowerCase(), id: Number(m[2]) });
    }
  }
  return out;
}

const inRange = (id: number, r: { start: number; end: number }) => id >= r.start && id <= r.end;

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
    for (const ext of a.external) {
      if (!symbolIds.has(ext)) v.push(`${p.folder}: dependency ${ext} is neither a workspace app nor a locked symbol package`);
    }
    for (const o of await alObjects(join(dir, p.folder))) {
      const where = `${p.folder}/${o.file}: ${o.kind} ${o.id}`;
      if (!p.idRanges.some((r) => o.id >= r.from && o.id <= r.to)) v.push(`${where} is outside the app's idRanges`);
      if (inRange(o.id, BENCHMARK_APP_ID_BUFFER)) v.push(`${where} is in the reserved band`);
      if (inRange(o.id, HARNESS_ORACLE_RANGE)) v.push(`${where} is in the hidden-oracle band`);
      if (p.folder === TEST_APP) {
        if ((HARNESS_FORBIDDEN_IDS as readonly number[]).includes(o.id)) v.push(`${where} is forbidden (foreign app collision)`);
        if (inRange(o.id, HARNESS_FIXTURE_TEST_RANGE)) v.push(`${where} is in the harness fixture band`);
      }
    }
  }
  return v;
}

export interface TestCodeunit {
  codeunit: number;
  file: string;
  testPage: boolean;
  /** Procedures carrying [Test] (other attributes may sit between), from comment- and string-stripped source. */
  procedures: string[];
}

const TEST_PROC = /\[Test\]\s*(?:\[[^\]]*\]\s*)*(?:local\s+|internal\s+)?procedure\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*\(/gi;

export async function testCodeunits(dir: string): Promise<TestCodeunit[]> {
  const out: TestCodeunit[] = [];
  for (const e of await listTree(dir, "task", { optional: true })) {
    if (!e.path.toLowerCase().endsWith(".al")) continue;
    const text = stripAlNoise(await Deno.readTextFile(join(dir, e.path)));
    const m = /^\s*codeunit\s+(\d+)\b/im.exec(text);
    if (m && /\bSubtype\s*=\s*Test\s*;/i.test(text)) {
      const procedures = [...text.matchAll(TEST_PROC)].map((p) => p[1] ?? p[2]!);
      out.push({ codeunit: Number(m[1]), file: e.path, testPage: /\bTestPage\b/i.test(text), procedures });
    }
  }
  return out.sort((a, b) => a.codeunit - b.codeunit);
}

/** Test codeunits in files the shipped Test app does not have (case-insensitive paths). */
export async function addedTestCodeunits(pristineTest: string, test: string): Promise<TestCodeunit[]> {
  const shipped = new Set((await listTree(pristineTest, "task")).map((e) => e.path.toLowerCase()));
  return (await testCodeunits(test)).filter((t) => !shipped.has(t.file.toLowerCase()));
}
```

The `sourcesOnly` rule also drops dot-folders and dot-files anywhere (`.vscode`, `.git`); the freeze marker is read from the artifact root before copying, never copied.

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/verdict-workspace.test.ts`
Expected: all 10 tests pass.

- [ ] **Step 5: Check, lint, format** (the two files)

- [ ] **Step 6: Commit**

```bash
git add src/harness/verdict-workspace.ts tests/unit/harness/verdict-workspace.test.ts
git commit -m "feat(harness): verdict workspace with source allowlist, trusted app.json and case-alias checks"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/verdict-workspace.test.ts` passes; check, lint and `deno fmt --check` clean.

---

### Task M1-15: owned-id app sync, ledger, bumped prerequisite versions

Spec 1a section 7 item 5; findings section 8 and M0-02 carryover (cleanup scoped to candidate ids, persistent prerequisite ids, refresh stale prerequisites, provisioning latency separate); bc-container-quirks.md (one warm-slot script; never `prepareCandidateApp`); review sections 1 and 2 (explicit owned-id allowlist, unrelated CentralGauge apps preserved, full-content identity, dependency minima, Stopwatch timing, context and BCH settings asserted in the script).

Identity: every workspace app is wanted. Candidates (changed apps, their dependents, Test, the oracle) are published at their **pristine** version. Prerequisites are published at a bumped version `major.minor.(build + 1 + s1).s2` (s1, s2 from the content stamp, each below 30000), so every dependency minimum written against the pristine version still holds and a prerequisite never shares a version with its candidate form. A per-container **ledger** (`results/harness/bc-ledger/<container>.json`) stores the full 64-hex content stamp per installed app id; a prerequisite is kept only when the container lists exactly one version of that id, installed, equal to the wanted version, and the ledger holds the same full stamp, and every wanted dependency is kept. Version collisions therefore cannot keep stale content. The ledger only drifts toward "republish" (a prenuke or manual removal makes an app absent), never toward keeping unknown content.

Build identity (review round 2 item 5): a prerequisite's stamp covers its sources, its dependencies' stamps **and the build inputs**: the symbols lock hash and the container's compiler identity (artifact URL plus the pinned bccontainerhelper version). A changed lock or compiler therefore changes every stamp, so the installed prerequisite is republished instead of kept.

Ledger (round 2 item 5): one per-container ledger under a fixed `ledgerRoot` (`results/harness/bc-ledger/`, the same for campaigns, cells, fixtures and the backend). Before any container mutation, the entries of every id the sync will remove or publish are dropped and the ledger is saved (`invalidate`); after the sync the published entries are added. An interrupted sync can therefore only lose entries (forcing a republish), never keep a stale claim.

Removal scope: the wanted ids that are not kept, plus installed apps whose id is in an explicit **owned allowlist** (the task set's oracle app ids and the bench candidate id `00000000-cafe-0000-0000-be4c00decade`, whose objects share the refapp band). Every other CentralGauge app is preserved; if one collides, the publish fails as a collision, which is infra and reroutes (M1-16).

**Lane:** infra2 (stream B). **Deps:** M1-02, M1-13. **Date:** 09-30.

**Files:**
- Create: `src/harness/bc-apps.ts`
- Modify: `src/container/types.ts`, `src/container/bc-script-builders.ts`, `src/container/bc-output-parsers.ts`, `src/container/bc-container-provider.ts`
- Test: `tests/unit/harness/bc-apps.test.ts`, `tests/unit/harness/bc-sync-provider.test.ts`

**Interfaces:**
- Produces (types.ts): `HarnessInstalledApp { id; name; publisher; version; installed }`; `HarnessSyncResult { removed; warnings; removeIncomplete; published: { index: number; ms: number }[]; failed: { index; message } | null; done; output }`.
- Produces (provider): `harnessCompilerIdentity(container)` (artifact URL from `docker inspect` plus the pinned BCH version); `listHarnessApps(container)`; `syncHarnessApps(container, plan: { removeIds; publish })`; `runHarnessTests(container, codeunit)`; protected `harnessSharedFolder(container)`.
- Produces (bc-apps.ts): `CG_PUBLISHER`, `HARNESS_APP_NAME`, `BENCH_CANDIDATE_APP_ID`; `type AppRole`; `interface WantedApp { id; name; publisher; version; stamp: string; file; role; depends: string[] }`; `interface SyncPlan { remove: string[]; publish: WantedApp[] }`; `type Ledger = Record<string, { version: string; stamp: string }>`; `prereqVersion(base, stamp)`; `appStamps(dir, apps, buildId)`; `candidateFolders(apps, changed)`; `planAppSync(installed, wanted, ledger, owned: ReadonlySet<string>)`; `loadLedger(ledgerRoot, container)`; `saveLedger(ledgerRoot, container, ledger)`; `invalidate(ledger, ids): Ledger`; `applySync(ledger, plan, sync): Ledger`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/harness/bc-apps.test.ts`:

```typescript
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { HarnessInstalledApp } from "../../../src/container/types.ts";
import {
  appStamps,
  applySync,
  invalidate,
  BENCH_CANDIDATE_APP_ID,
  candidateFolders,
  type Ledger,
  planAppSync,
  prereqVersion,
  type WantedApp,
} from "../../../src/harness/bc-apps.ts";
import type { StagedApp } from "../../../src/harness/staging.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";

const id = (n: number) => `c6a1e000-0000-4000-8000-00000000000${n}`;
const app = (folder: string, n: number, depends: string[] = []): StagedApp => ({
  folder, id: id(n), name: `CGR ${folder}`, publisher: "CentralGauge", version: "1.0.0.0", idRanges: [], depends, external: [],
});
const APPS = [
  app("Core", 1), app("Fleet", 2, ["Core"]), app("Integration", 5, ["Core"]), app("Leasing", 4, ["Core"]),
  app("Rental", 3, ["Core", "Fleet"]), app("Reporting", 6, ["Fleet", "Leasing", "Rental"]),
  app("Test", 7, ["Core", "Fleet", "Integration", "Leasing", "Rental", "Reporting"]),
];
const STAMP = (n: number) => String(n).padStart(64, "a");
const PV = (n: number) => prereqVersion("1.0.0.0", STAMP(n));

function wanted(candidates: string[]): WantedApp[] {
  const byFolder = new Map(APPS.map((a) => [a.folder, a]));
  return APPS.map((a, i) => {
    const role = candidates.includes(a.folder) ? "candidate" as const : "prereq" as const;
    return {
      id: a.id, name: a.name, publisher: a.publisher, stamp: STAMP(i),
      version: role === "prereq" ? PV(i) : "1.0.0.0", file: `${a.folder}.app`, role,
      depends: a.depends.map((d) => byFolder.get(d)!.id),
    };
  });
}
const inst = (n: number, version: string, installed = true, name = `x${n}`): HarnessInstalledApp => ({
  id: id(n), name, publisher: "CentralGauge", version, installed,
});
/** Ledger and listing for "these prerequisites are installed and current". */
function current(folders: string[]): { installed: HarnessInstalledApp[]; ledger: Ledger } {
  const w = wanted([]);
  const installed: HarnessInstalledApp[] = [];
  const ledger: Ledger = {};
  for (const f of folders) {
    const x = w.find((y) => y.name === `CGR ${f}`)!;
    installed.push({ id: x.id, name: x.name, publisher: "CentralGauge", version: x.version, installed: true });
    ledger[x.id] = { version: x.version, stamp: x.stamp };
  }
  return { installed, ledger };
}
const OWNED = new Set([BENCH_CANDIDATE_APP_ID]);

Deno.test("candidateFolders: changed apps, their dependents and Test", () => {
  assertEquals(candidateFolders(APPS, []), ["Test"]);
  assertEquals(candidateFolders(APPS, ["Rental"]), ["Rental", "Reporting", "Test"]);
  assertEquals(candidateFolders(APPS, ["Core"]), APPS.map((a) => a.folder));
});

Deno.test("prereqVersion: above the pristine version, deterministic, 16-bit safe", () => {
  const v = prereqVersion("1.2.3.4", "f".repeat(64));
  const [ma, mi, bu, re] = v.split(".").map(Number);
  assertEquals([ma, mi], [1, 2]);
  assert(bu! > 3 && bu! <= 3 + 30000 && re! < 30000);
  assertEquals(v, prereqVersion("1.2.3.4", "f".repeat(64)));
  assertNotEquals(prereqVersion("1.0.0.0", "1".repeat(64)), prereqVersion("1.0.0.0", "2".repeat(64)));
});

Deno.test("planAppSync: a fresh container removes wanted ids (no-ops) and publishes all in order", () => {
  const plan = planAppSync([], wanted(["Test"]), {}, OWNED);
  assertEquals(plan.remove, [...APPS].reverse().map((a) => a.id));
  assertEquals(plan.publish.map((w) => w.file), APPS.map((a) => `${a.folder}.app`));
});

Deno.test("planAppSync: refapp dependency apps stay installed", () => {
  const { installed, ledger } = current(["Core", "Fleet", "Integration", "Leasing"]);
  installed.push(inst(3, "1.0.0.0"), inst(6, "1.0.0.0"), inst(7, "1.0.0.0"));
  const plan = planAppSync(installed, wanted(["Rental", "Reporting", "Test"]), ledger, OWNED);
  assertEquals(plan.remove, [id(7), id(6), id(3)]);
  assertEquals(plan.publish.map((w) => w.file), ["Rental.app", "Reporting.app", "Test.app"]);
});

Deno.test("planAppSync: a ledger stamp mismatch refreshes the prerequisite and its dependents", () => {
  const { installed, ledger } = current(["Core", "Fleet", "Integration", "Leasing", "Rental", "Reporting"]);
  ledger[id(1)] = { version: ledger[id(1)]!.version, stamp: "0".repeat(64) };
  const plan = planAppSync(installed, wanted(["Test"]), ledger, OWNED);
  assertEquals(plan.remove, [id(7), id(6), id(3), id(4), id(5), id(2), id(1)]);
  assertEquals(plan.publish.length, 7);
});

Deno.test("planAppSync: unowned CentralGauge apps are preserved; owned leftovers go", () => {
  const { installed, ledger } = current(["Core", "Fleet", "Integration", "Leasing", "Rental", "Reporting"]);
  installed.push(
    { id: BENCH_CANDIDATE_APP_ID, name: "CentralGauge_CG-AL-E001_1", publisher: "CentralGauge", version: "1.0.0.0", installed: true },
    { id: "00000000-0000-4000-8000-00000000aaaa", name: "Someone Else's App", publisher: "CentralGauge", version: "1.0.0.0", installed: true },
    { id: "00000000-0000-4000-8000-00000000cccc", name: "Continia Core", publisher: "Continia", version: "1.0.0.0", installed: true },
  );
  const plan = planAppSync(installed, wanted(["Test"]), ledger, OWNED);
  assertEquals(plan.remove, [BENCH_CANDIDATE_APP_ID, id(7)]);
});

Deno.test("planAppSync: duplicate or uninstalled versions are not kept", () => {
  const a = current(["Core", "Fleet", "Integration", "Leasing", "Rental", "Reporting"]);
  a.installed.push(inst(1, "1.0.1.1", false));
  assert(planAppSync(a.installed, wanted(["Test"]), a.ledger, OWNED).remove.includes(id(1)));
  const b = current(["Core", "Fleet", "Integration", "Leasing", "Rental", "Reporting"]);
  b.installed[0] = { ...b.installed[0]!, installed: false };
  assert(planAppSync(b.installed, wanted(["Test"]), b.ledger, OWNED).remove.includes(id(1)));
});

Deno.test("applySync: removed ids leave the ledger, published ids enter it", () => {
  const w = wanted(["Test"]);
  const plan = planAppSync([], w, { [id(9)]: { version: "1", stamp: "x" } }, OWNED);
  const next = applySync({ [id(9)]: { version: "1", stamp: "x" } }, { remove: [id(9), ...plan.remove], publish: plan.publish }, {
    removed: [id(9)], warnings: [], removeIncomplete: [], published: plan.publish.map((_, index) => ({ index, ms: 1 })),
    failed: null, done: true, output: "",
  });
  assertEquals(Object.keys(next).length, 7);
  assertEquals(next[id(1)]!.stamp, w[0]!.stamp);
});

Deno.test("appStamps: a dependency change moves dependents, not the other way", async () => {
  const ws = await Deno.realPath(await Deno.makeTempDir());
  await write(ws, "Core/app.json", appJson(IDS.core, "CGR Core", [70000, 70099], []));
  await write(ws, "Rental/app.json", appJson(IDS.rental, "CGR Rental", [70200, 70299], [{ id: IDS.core, name: "CGR Core" }]));
  const apps: StagedApp[] = [{ ...app("Core", 1), id: IDS.core }, { ...app("Rental", 3, ["Core"]), id: IDS.rental }];
  const a = await appStamps(ws, apps, "build-1");
  await write(ws, "Rental/src/R.al", "x");
  const b = await appStamps(ws, apps, "build-1");
  assertEquals(b.get("Core"), a.get("Core"));
  assertNotEquals(b.get("Rental"), a.get("Rental"));
  await write(ws, "Core/src/C.al", "y");
  const c = await appStamps(ws, apps, "build-1");
  assertNotEquals(c.get("Rental"), b.get("Rental"));
});

Deno.test("appStamps: a changed symbols lock or compiler identity moves every stamp", async () => {
  const ws = await Deno.realPath(await Deno.makeTempDir());
  await write(ws, "Core/app.json", appJson(IDS.core, "CGR Core", [70000, 70099], []));
  const apps: StagedApp[] = [{ ...app("Core", 1), id: IDS.core }];
  assertNotEquals((await appStamps(ws, apps, "lock-a|compiler-1")).get("Core"), (await appStamps(ws, apps, "lock-b|compiler-1")).get("Core"));
  assertNotEquals((await appStamps(ws, apps, "lock-a|compiler-1")).get("Core"), (await appStamps(ws, apps, "lock-a|compiler-2")).get("Core"));
});

Deno.test("invalidate: every id the sync touches leaves the ledger before the mutation", () => {
  const w = wanted(["Test"]);
  const ledger: Ledger = Object.fromEntries(w.map((x) => [x.id, { version: x.version, stamp: x.stamp }]));
  const next = invalidate(ledger, [id(7), id(3)]);
  assertEquals(Object.keys(next).length, 5);
  assert(!(id(7) in next) && !(id(3) in next));
  assertEquals(Object.keys(ledger).length, 7, "input unchanged");
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
SYNC_PUBLISH_MS:0:150
SYNC_DONE
`;
    const { provider, calls, shared } = await stubbed(out);
    const app = join(await Deno.makeTempDir(), "CentralGauge_CGR Rental_1.0.0.0.app");
    await Deno.writeTextFile(app, "x");
    const r = await provider.syncHarnessApps("Cronus281", { removeIds: [IDS.rental], publish: [app] });
    assertEquals(calls.length, 1);
    assertEquals(calls[0].label, "harness-sync");
    assertStringIncludes(calls[0].script, IDS.rental);
    assertStringIncludes(calls[0].script, shared);
    assertEquals(r.removed, [IDS.rental]);
    assertEquals(r.published, [{ index: 0, ms: 150 }]);
    assertEquals([...Deno.readDirSync(shared)].length, 0);
  },
});

Deno.test({
  name: "syncHarnessApps: incomplete removal throws, a publish failure is returned",
  ignore: !isWindows,
  async fn() {
    const bad = await stubbed(`SYNC_REMOVE_INCOMPLETE:${IDS.rental}\nSYNC_DONE\n`);
    await assertRejects(
      () => bad.provider.syncHarnessApps("Cronus281", { removeIds: [IDS.rental], publish: [] }),
      ContainerError,
      "incomplete",
    );
    const failed = await stubbed("SYNC_PUBLISH_MS:0:2\nSYNC_PUBLISH_FAILED:0:The schema synchronization failed\n");
    const r = await failed.provider.syncHarnessApps("Cronus281", { removeIds: [], publish: [] });
    assertEquals(r.failed, { index: 0, message: "The schema synchronization failed" });
  },
});

Deno.test("syncHarnessApps: a non-GUID id is refused before any script runs", async () => {
  const { provider, calls } = await stubbed("SYNC_DONE");
  await assertRejects(
    () => provider.syncHarnessApps("Cronus281", { removeIds: ["x'; Remove-Item C:\\"], publish: [] }),
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
    assertEquals(await ok.provider.listHarnessApps("Cronus281"), [
      { id: IDS.core, name: "CGR Core", publisher: "CentralGauge", version: "1.0.5.6", installed: true },
    ]);
    assertEquals(ok.calls[0].label, "harness-apps");
    const bad = await stubbed("CG_APPS_FAILED:boom");
    await assertRejects(() => bad.provider.listHarnessApps("Cronus281"), ContainerError);
  },
});

Deno.test("buildSyncHarnessAppsScript: pinned BCH, settings, removal before publish, Stopwatch timing", () => {
  const s = buildSyncHarnessAppsScript("Cronus281", [IDS.rental], ["C:\\my\\ab_O'Brien.app"], { username: "u", password: "p'w" });
  assert(!s.includes("${"));
  assertStringIncludes(s, "Import-Module bccontainerhelper -RequiredVersion 6.1.14");
  assertStringIncludes(s, "$bcContainerHelperConfig.usePsSessionForBc28 = $false");
  assert(s.indexOf("Get-NAVAppInfo") < s.indexOf("Publish-BcContainerApp"));
  assertStringIncludes(s, "[Diagnostics.Stopwatch]::StartNew()");
  assertStringIncludes(s, "'C:\\my\\ab_O''Brien.app'");
  assertStringIncludes(s, "-useDevEndpoint -credential $cgPubCredential");
});

Deno.test("parseHarnessSyncOutput: Stopwatch milliseconds per published file", () => {
  const r = parseHarnessSyncOutput(`SYNC_REMOVE:${IDS.core.toUpperCase()} v1.0.0.0\nSYNC_PUBLISH_MS:0:4120\nSYNC_DONE\n`);
  assertEquals([r.removed, r.published, r.done], [[IDS.core], [{ index: 0, ms: 4120 }], true]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `deno test --allow-all tests/unit/harness/bc-apps.test.ts tests/unit/harness/bc-sync-provider.test.ts`
Expected: FAIL, `Module not found ".../src/harness/bc-apps.ts"`.

- [ ] **Step 3: Implement `src/harness/bc-apps.ts`**

```typescript
/**
 * Candidate-scoped app sync (spec 1a section 7 item 5; findings section 8).
 * Candidates run at their pristine version; prerequisites at a bumped
 * version; a per-container ledger holds each installed app's full content
 * stamp, so only a matching stamp keeps a prerequisite.
 */

import { join } from "@std/path";
import type { HarnessInstalledApp, HarnessSyncResult } from "../container/types.ts";
import { ValidationError } from "../errors.ts";
import { hashJson, hashTree } from "./hash.ts";
import { dependentsClosure, type StagedApp } from "./staging.ts";

export const CG_PUBLISHER = "CentralGauge";
export const HARNESS_APP_NAME = "CG Test Harness";
/** The bench's shared candidate id (compile-queue.ts); its objects share the refapp band. */
export const BENCH_CANDIDATE_APP_ID = "00000000-cafe-0000-0000-be4c00decade";

export type AppRole = "prereq" | "candidate";

export interface WantedApp {
  id: string;
  name: string;
  publisher: string;
  version: string;
  /** Full 64-hex content stamp (source tree plus dependency stamps). */
  stamp: string;
  file: string;
  role: AppRole;
  depends: string[];
}

export interface SyncPlan {
  remove: string[];
  publish: WantedApp[];
}

export type Ledger = Record<string, { version: string; stamp: string }>;

/** Above the pristine version so dependency minima hold; build part stays below 65535 for build < 35000. */
export function prereqVersion(base: string, stamp: string): string {
  const [ma, mi, bu] = base.split(".").map(Number);
  if ([ma, mi, bu].some((x) => x === undefined || !Number.isInteger(x)) || bu! > 35000) {
    throw new ValidationError(`cannot derive a prerequisite version from ${base}`, [base]);
  }
  const s1 = parseInt(stamp.slice(0, 8), 16) % 30000;
  const s2 = parseInt(stamp.slice(8, 16), 16) % 30000;
  return `${ma}.${mi}.${bu! + 1 + s1}.${s2}`;
}

/** Content stamps; `buildId` = hash of the symbols lock and the container's compiler identity. */
export async function appStamps(dir: string, apps: StagedApp[], buildId: string): Promise<Map<string, string>> {
  const stamps = new Map<string, string>();
  for (const a of apps) {
    stamps.set(a.folder, await hashJson({
      app: a.id,
      build: buildId,
      tree: await hashTree(join(dir, a.folder), "task"),
      deps: a.depends.map((d) => stamps.get(d) ?? null),
    }));
  }
  return stamps;
}

export function candidateFolders(apps: StagedApp[], changed: string[]): string[] {
  const set = dependentsClosure(apps, [...changed, "Test"]);
  return apps.filter((a) => set.has(a.folder)).map((a) => a.folder);
}

export function planAppSync(
  installed: HarnessInstalledApp[],
  wanted: WantedApp[],
  ledger: Ledger,
  owned: ReadonlySet<string>,
): SyncPlan {
  const wantedIds = new Set(wanted.map((w) => w.id));
  const byId = new Map<string, HarnessInstalledApp[]>();
  for (const i of installed) {
    if (i.publisher === CG_PUBLISHER) byId.set(i.id, [...(byId.get(i.id) ?? []), i]);
  }
  const kept = new Set<string>();
  for (const w of wanted) {
    const have = byId.get(w.id) ?? [];
    const exact = w.role === "prereq" && have.length === 1 && have[0]!.installed &&
      have[0]!.version === w.version && ledger[w.id]?.stamp === w.stamp && ledger[w.id]?.version === w.version;
    if (exact && w.depends.every((d) => !wantedIds.has(d) || kept.has(d))) kept.add(w.id);
  }
  const ownedLeftovers = [...byId.keys()].filter((id) => owned.has(id) && !wantedIds.has(id)).sort();
  const ours = [...wanted].reverse().map((w) => w.id).filter((id) => !kept.has(id));
  return { remove: [...ownedLeftovers, ...ours], publish: wanted.filter((w) => !kept.has(w.id)) };
}

const ledgerPath = (ledgerRoot: string, container: string) => join(ledgerRoot, `${container}.json`);

export async function loadLedger(ledgerRoot: string, container: string): Promise<Ledger> {
  try {
    return JSON.parse(await Deno.readTextFile(ledgerPath(ledgerRoot, container))) as Ledger;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return {};
    throw err;
  }
}

export async function saveLedger(ledgerRoot: string, container: string, ledger: Ledger): Promise<void> {
  const p = ledgerPath(ledgerRoot, container);
  await Deno.mkdir(join(p, ".."), { recursive: true });
  const tmp = `${p}.tmp-${crypto.randomUUID()}`;
  await Deno.writeTextFile(tmp, JSON.stringify(ledger, null, 2));
  await Deno.rename(tmp, p);
}

/** The ledger without the given ids; saved before any container mutation. */
export function invalidate(ledger: Ledger, ids: Iterable<string>): Ledger {
  const next: Ledger = { ...ledger };
  for (const id of ids) delete next[id];
  return next;
}

/** The ledger after a sync: removed ids drop out, successfully published ids enter. */
export function applySync(ledger: Ledger, plan: SyncPlan, sync: HarnessSyncResult): Ledger {
  const next: Ledger = { ...ledger };
  for (const id of plan.remove) delete next[id];
  for (const p of sync.published) {
    if (sync.failed?.index === p.index) continue;
    const w = plan.publish[p.index];
    if (w) next[w.id] = { version: w.version, stamp: w.stamp };
  }
  return next;
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
  /** Per published file (index into the publish list), Stopwatch milliseconds. */
  published: { index: number; ms: number }[];
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
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    let m: RegExpExecArray | null;
    if ((m = /^SYNC_REMOVE:(\S+)/.exec(line))) r.removed.push(m[1]!.toLowerCase());
    else if ((m = /^SYNC_REMOVE_WARN:(.*)$/.exec(line))) r.warnings.push(m[1]!);
    else if ((m = /^SYNC_REMOVE_INCOMPLETE:(.*)$/.exec(line))) r.removeIncomplete.push(m[1]!);
    else if ((m = /^SYNC_PUBLISH_MS:(\d+):(\d+)$/.exec(line))) r.published.push({ index: Number(m[1]), ms: Number(m[2]) });
    else if ((m = /^SYNC_PUBLISH_FAILED:(\d+):(.*)$/.exec(line))) {
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
 * SYNC_REMOVE_INCOMPLETE:<id>, SYNC_PUBLISH_MS:<i>:<stopwatch ms>,
 * SYNC_PUBLISH_FAILED:<i>:<msg>, SYNC_DONE.
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
        $cgSw = [Diagnostics.Stopwatch]::StartNew()
        try {
          Publish-BcContainerApp -containerName "${containerName}" -appFile $cgFiles[$i] -skipVerification -sync -syncMode ForceSync -install${flag} -ErrorAction Stop
          Write-Output "SYNC_PUBLISH_MS:$($i):$($cgSw.ElapsedMilliseconds)"
        } catch {
          Write-Output "SYNC_PUBLISH_MS:$($i):$($cgSw.ElapsedMilliseconds)"
          Write-Output "SYNC_PUBLISH_FAILED:$($i):$(($_.Exception.Message) -replace '\s+', ' ')"
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

  /** Harness Bench: compiler identity for prerequisite stamps (review round 2 item 5). */
  async harnessCompilerIdentity(containerName: string): Promise<string> {
    const i = await this.dockerInspectSeam(containerName);
    if (!i?.artifactUrl) {
      throw new ContainerError(`cannot read the artifact URL of ${containerName}`, containerName, "compile");
    }
    return `${i.artifactUrl}|bccontainerhelper ${BCCH_PINNED_VERSION}`;
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
Expected: all pass (the provider tests that stage files are Windows-only).

- [ ] **Step 6: Check, lint, format** (the seven files); when no bench is live also `deno test --allow-all tests/unit/container/bc-script-builders.test.ts tests/unit/container/bc-output-parsers.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/harness/bc-apps.ts src/container/bc-container-provider.ts src/container/bc-script-builders.ts src/container/bc-output-parsers.ts src/container/types.ts tests/unit/harness/bc-apps.test.ts tests/unit/harness/bc-sync-provider.test.ts
git commit -m "feat(harness): owned-id app sync with content ledger and bumped prerequisite versions"
```

**Acceptance:** both test files pass; check, lint and `deno fmt --check` clean. Real-container behavior is M1-27.

---

### Task M1-16: BC lane: admission, health, locked symbols, deploy, tests, classifier

Spec 1a section 5 (fixed concurrency, queue wait recorded), D12 (agent calls and verdicts share one lane; amended: `BcLane` instead of `CompileQueuePool`), section 7 (build every app in dependency order; zero tests after publish is infra), section 8 (a BC fault rejudges on another container), findings section 1 (each app compiles with earlier apps' `.app` files in `.alpackages`). Review gates 2 and 4 and section 2 (compile admission, health exclusion, queue time over retries; the locked symbol set is demonstrably what the compiler used; no build cache in the slice). M4 round 2 section 4 item 3: lost `ASSERTERROR` is an assertion; missing or zero results are infra; mixed assertion+infra is infra.

- **Compile admission**: at most `compileSlots` (default 2) host-side compiles per container at once (`Semaphore`), matching the provider's warm compile pool; compiles move to the next container on an infra error.
- **Health**: containers with an active alert in the supplied health monitor are never selected, for compiles or for exclusive holds.
- **Locked symbols**: each app's `.alpackages` gets every locked package (restored from the store and hash-verified) plus the earlier workspace apps. After the compile, every file in `.alpackages` must be one of those; an extra file means BCH filled a gap from its compiler cache, and the build stops with a `ValidationError` naming the unlocked package (an environment error, never the agent's).
- **No prerequisite cache** in the slice (M1-36 adds one with a complete key: stamp, symbols lock hash, container artifact URL).
- **Build identity** (round 2 item 5): `prepareApps` computes `buildId = hash(symbols lock packages, bc.harnessCompilerIdentity(container))` on the container it compiles for and passes it to `appStamps`, so a deployed prerequisite built against other inputs is never kept.
- **Ledger ordering**: `deploy` saves the ledger with every touched id invalidated **before** calling the sync, then adds the published entries; a failed or interrupted sync leaves at most missing entries.
- **Cleanup is never swallowed** (round 3 B4): a failed or incomplete cleanup empties that container's ledger and is carried structurally: as `cleanupError` on the result, or as a `CleanupFailedError` (a `ContainerError`, so infra) wrapping the original error when the tests threw too. `BcLane.exclusive` quarantines the container **inside the held region, before the lock is released**, on both paths; a quarantined container is excluded from every later compile and hold until the operator clears it.
- **Eligibility is rechecked after waiting** (round 3 B4): `exclusive`, `compile` and `compileOn` check health and quarantine again after acquiring the lock or slot; queued work on a container that became ineligible is refused (infra, so holds reroute) without calling the job.
- **Cancellation** (round 3 B2): `compile`, `compileOn` and `exclusive` take an optional `AbortSignal`; an aborted signal refuses admission before and after the wait, so no BC mutation starts after cancellation (an operation already inside SOAP completes, then no further step runs).
- **Health handling**: the lane records every held attempt's outcome into the health view (`record`: pass, or `infra_error` on an infra fault), and skips alerted and quarantined containers. The real wiring passes `ContainerHealthMonitor` (M1-24).
- **Oracle compiles take admission**: `BcLane.compileOn(container, fn)` runs `fn` under that container's compile slot (the oracle build must use the container whose prerequisites it links against, M1-17).
- **Classifier** shared with the M4 gate (`scripts/harness/gate-core.ts` uses the same two patterns): `Assert.<x> failed` and "An error was expected inside an ASSERTERROR statement." are `assertion`; other messages `runtime_error`. A listed procedure missing from a run that returned results is `infra`; a listed codeunit with zero results throws infra (reroute); a scorer with any infra row is unscored even when another row has an assertion. The M4-16 P5 captured texts are the classifier fixture (`tests/fixtures/harness/p5-messages.json`, copied verbatim from `H:\Temp3\harness-spike\M4-16-results.md`); P5 is accepted (decision `2026-09-25-accept-M4-16`: the failure texts match the classifier); the fixture copies the accepted texts, with no rerun.

**Lane:** infra2 (stream B). **Deps:** M1-07 (`TestResultSchema`), M1-13 (`restoreSymbols`), M1-15, M4-16 (P5 is accepted, decision accept-M4-16: its captured texts are the classifier fixture). **Date:** 10-01.

**Files:**
- Create: `src/harness/bc-lane.ts`, `tests/unit/harness/fake-bc.ts`, `scripts/harness/app-sync-probe.ts`
- Test: `tests/unit/harness/bc-lane.test.ts`

**Interfaces:**
- Produces: `interface HarnessBc { compileProject; harnessCompilerIdentity; listHarnessApps; syncHarnessApps; runHarnessTests }` (declared in the interface code below); `class CleanupFailedError extends ContainerError { cleanupError; cause }`; `type TestRow`; `interface HealthView { getState(): { containers: { containerName: string; alert?: unknown }[] }; record(o: ContainerOutcome): unknown }`; `class BcLane { constructor(bc, containers, opts?: { health?: HealthView; maxInfraRetries?: number; compileSlots?: number }); bc; containers; compile<T>(fn, signal?): Promise<T>; compileOn<T>(container, fn, signal?): Promise<T>; exclusive<T>(ctx, fn, signal?): Promise<Held<T>>; quarantine(container, reason): void; quarantined: Map<string, string> }`; `interface Held<T> { result; container; queue_ms /* summed over attempts */; retries }`; `interface LockedSymbols { store: string; packages: SymbolPackage[] }`; `interface BuiltApp { folder; id; version; ok; attempted; file; diagnostics; compile_ms }`; `buildApps(bc, container, o: { srcDir; apps; versions; outDir; lock: LockedSymbols; prebuilt?: Map<string, string>; signal? })`; `interface PrepareInput { pristine; pristineApps; candidateDir; candidateApps; changed; workDir; lock; signal? }`; `interface Prepared { container; built; wanted: WantedApp[]; candidateIds; buildOk; compile_ms; per_app_compiles }`; `prepareApps(lane, o)`; `interface TestSpec { codeunit; procedures: string[] | null; target; zeroIsInfra }`; `interface TestMessage`; `classifyTestFailure(error)`; `runTests(bc, container, specs)`; `scorerPassed(rows)`; `interface DeployContext { ledgerRoot: string; owned: ReadonlySet<string> }`; `interface Deployed { provisioning_ms; candidate_publish_ms; candidateFailure; removed; published }`; `deploy(bc, container, wanted, ctx)`; `interface DeployTestResult { deployed; rows; messages; test_ms; cleanupError: string | null }`; `deployAndTest(bc, container, i: { wanted; tests; cleanupIds; ctx: DeployContext })`.

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

export interface FakeApp {
  id: string;
  name: string;
  version: string;
  folder: string;
  source: string;
}

export type TestScript = (codeunit: number, deployed: Map<string, FakeApp>, container: string) => TestResult;

export function result(procs: Record<string, true | string>): TestResult {
  const results = Object.entries(procs).map(([name, v]) =>
    v === true ? { name, passed: true, duration: 1 } : { name, passed: false, duration: 1, error: v }
  );
  const passed = results.filter((r) => r.passed).length;
  return {
    success: passed === results.length && passed > 0,
    totalTests: results.length, passedTests: passed, failedTests: results.length - passed,
    duration: 5, results, output: "",
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
      if ((await Deno.stat(p)).isDirectory) await walk(p);
      else if (n.endsWith(".al")) parts.push(await Deno.readTextFile(p));
    }
  };
  await walk(dir);
  return parts.join("\n");
}

export class FakeBc implements HarnessBc {
  compiles: string[] = [];
  /** .alpackages file names seen at each compile, by folder. */
  compileSeen = new Map<string, string[]>();
  /** Test hook: runs inside compileProject (e.g. to plant an unlocked package). */
  onCompile: ((projectDir: string) => Promise<void>) | null = null;
  concurrentCompiles = 0;
  maxConcurrentCompiles = 0;
  syncs: { container: string; removeIds: string[]; publish: string[] }[] = [];
  tests: { container: string; codeunit: number }[] = [];
  broken = new Set<string>();
  publishFailure: (container: string, appName: string) => string | null = () => null;
  private readonly deployed = new Map<string, Map<string, FakeApp>>();

  compilerId = "fake-artifact|bccontainerhelper 6.1.14";
  /** Containers whose cleanup (a sync with no publish) fails. */
  cleanupFails = new Set<string>();

  constructor(public script: TestScript = () => result({})) {}

  harnessCompilerIdentity(_container: string): Promise<string> {
    return Promise.resolve(this.compilerId);
  }

  state(container: string): Map<string, FakeApp> {
    let s = this.deployed.get(container);
    if (!s) this.deployed.set(container, s = new Map());
    return s;
  }

  private check(container: string, op: ContainerError["operation"]) {
    if (this.broken.has(container)) throw new ContainerError(`fake infra fault on ${container}`, container, op);
  }

  async compileProject(container: string, project: ALProject): Promise<CompilationResult> {
    this.check(container, "compile");
    this.concurrentCompiles++;
    this.maxConcurrentCompiles = Math.max(this.maxConcurrentCompiles, this.concurrentCompiles);
    try {
      await new Promise((r) => setTimeout(r, 5));
      const folder = basename(project.path);
      this.compiles.push(folder);
      const pk: string[] = [];
      for await (const e of Deno.readDir(join(project.path, ".alpackages"))) pk.push(e.name);
      this.compileSeen.set(folder, pk.sort());
      if (this.onCompile) await this.onCompile(project.path);
      const aj = project.appJson as { id: string; name: string; version: string };
      const source = await sources(project.path);
      if (source.includes("COMPILE_ERROR")) {
        return {
          success: false,
          errors: [{ code: "AL0001", message: "fake compile error", file: "x.al", line: 1, column: 1, severity: "error" }],
          warnings: [], output: "", duration: 1,
        };
      }
      const out = join(project.path, "..", `.fake-out-${crypto.randomUUID().slice(0, 8)}`);
      await Deno.mkdir(out, { recursive: true });
      const artifactPath = join(out, `CentralGauge_${aj.name}_${aj.version}.app`);
      const app: FakeApp = { id: aj.id.toLowerCase(), name: aj.name, version: aj.version, folder, source };
      await Deno.writeTextFile(artifactPath, JSON.stringify(app));
      return { success: true, errors: [], warnings: [], output: "", duration: 1, artifactPath };
    } finally {
      this.concurrentCompiles--;
    }
  }

  listHarnessApps(container: string): Promise<HarnessInstalledApp[]> {
    this.check(container, "publish");
    return Promise.resolve([...this.state(container).values()].map((a) => ({
      id: a.id, name: a.name, publisher: "CentralGauge", version: a.version, installed: true,
    })));
  }

  async syncHarnessApps(container: string, plan: { removeIds: string[]; publish: string[] }): Promise<HarnessSyncResult> {
    this.check(container, "publish");
    this.syncs.push({ container, removeIds: [...plan.removeIds], publish: [...plan.publish] });
    if (plan.publish.length === 0 && this.cleanupFails.has(container)) {
      throw new ContainerError(`Harness app sync incomplete: ${plan.removeIds.join(", ")}`, container, "setup");
    }
    const st = this.state(container);
    for (const id of plan.removeIds) st.delete(id);
    const published: HarnessSyncResult["published"] = [];
    for (const [index, file] of plan.publish.entries()) {
      const app = JSON.parse(await Deno.readTextFile(file)) as FakeApp;
      published.push({ index, ms: 5 });
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

export function deployedSource(deployed: Map<string, FakeApp>, name: string): string {
  return [...deployed.values()].find((a) => a.name === name)?.source ?? "";
}
```

`tests/unit/harness/bc-lane.test.ts`:

```typescript
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { basename, join } from "@std/path";
import { ContainerError, ValidationError } from "../../../src/errors.ts";
import { BENCH_CANDIDATE_APP_ID, loadLedger } from "../../../src/harness/bc-apps.ts";
import {
  BcLane,
  buildApps,
  classifyTestFailure,
  deploy,
  deployAndTest,
  type LockedSymbols,
  prepareApps,
  runTests,
  scorerPassed,
} from "../../../src/harness/bc-lane.ts";
import { hashFile } from "../../../src/harness/hash.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import { type FakeApp, FakeBc, result } from "./fake-bc.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";

const tmp = async () => await Deno.realPath(await Deno.makeTempDir());

async function workspace(): Promise<string> {
  const ws = await tmp();
  await write(ws, "Core/app.json", appJson(IDS.core, "CGR Core", [70000, 70099], []));
  await write(ws, "Core/src/C.al", `codeunit 70000 "CGR Core"\n{\n}\n`);
  await write(ws, "Rental/app.json", appJson(IDS.rental, "CGR Rental", [70200, 70299], [{ id: IDS.core, name: "CGR Core" }]));
  await write(ws, "Rental/src/R.al", `codeunit 70200 "CGR Rental"\n{\n}\n`);
  await write(ws, "Test/app.json", appJson(IDS.test, "CGR Test", [80000, 84999], [
    { id: IDS.core, name: "CGR Core" }, { id: IDS.rental, name: "CGR Rental" }, { id: IDS.assert, name: "Library Assert" },
  ]));
  await write(ws, "Test/src/T.al", `codeunit 80010 "T"\n{\n    Subtype = Test;\n}\n`);
  return ws;
}

async function lock(): Promise<LockedSymbols> {
  const store = await tmp();
  const file = "Microsoft_Library Assert_28.0.0.0.app";
  await Deno.writeTextFile(join(store, "staging.app"), "assert-symbols");
  const sha256 = await hashFile(store, join(store, "staging.app"));
  await Deno.rename(join(store, "staging.app"), join(store, `${sha256}.app`));
  return { store, packages: [{ app_id: IDS.assert, name: "Library Assert", publisher: "Microsoft", version: "28.0.0.0", file, sha256 }] };
}

const readApp = async (f: string) => JSON.parse(await Deno.readTextFile(f)) as FakeApp;

async function prep(bc: FakeBc, lane: BcLane, changed: string[] = []) {
  const pristine = await workspace();
  return await prepareApps(lane, {
    pristine, pristineApps: await readAppGraph(pristine), candidateDir: pristine,
    candidateApps: await readAppGraph(pristine), changed, workDir: await tmp(), lock: await lock(),
  });
}

Deno.test("buildApps: dependency order, versions, workspace and locked symbols", async () => {
  const ws = await workspace();
  const bc = new FakeBc();
  const built = await buildApps(bc, "C1", {
    srcDir: ws, apps: await readAppGraph(ws), versions: new Map([["Core", "1.0.7.7"]]),
    outDir: await tmp(), lock: await lock(),
  });
  assertEquals(bc.compiles, ["Core", "Rental", "Test"]);
  assert(built.every((b) => b.ok && b.attempted));
  assertEquals((await readApp(built[0]!.file!)).version, "1.0.7.7");
  assertEquals(bc.compileSeen.get("Test"), [
    basename(built[0]!.file!), basename(built[1]!.file!), "Microsoft_Library Assert_28.0.0.0.app",
  ].sort());
});

Deno.test("buildApps: an unlocked package after compile is refused", async () => {
  const ws = await workspace();
  const bc = new FakeBc();
  bc.onCompile = async (dir) => {
    await Deno.writeTextFile(join(dir, ".alpackages", "Microsoft_System Application_28.0.0.0.app"), "from compiler cache");
  };
  await assertRejects(
    async () => buildApps(bc, "C1", { srcDir: ws, apps: await readAppGraph(ws), versions: new Map(), outDir: await tmp(), lock: await lock() }),
    ValidationError,
    "unlocked symbol package",
  );
});

Deno.test("buildApps: a failed dependency stops its dependents", async () => {
  const ws = await workspace();
  await write(ws, "Core/src/C.al", "COMPILE_ERROR");
  const bc = new FakeBc();
  const built = await buildApps(bc, "C1", { srcDir: ws, apps: await readAppGraph(ws), versions: new Map(), outDir: await tmp(), lock: await lock() });
  assertEquals(bc.compiles, ["Core"]);
  assertStringIncludes(built[1]!.diagnostics[0]!.message, "Core did not build");
});

Deno.test("prepareApps: prerequisites bumped above the pristine version, candidates pristine, stamps carried", async () => {
  const bc = new FakeBc();
  const p = await prep(bc, new BcLane(bc, ["C1"]), ["Rental"]);
  const core = p.wanted.find((w) => w.id === IDS.core)!;
  assertEquals(core.role, "prereq");
  assert(Number(core.version.split(".")[2]) >= 1);
  assertEquals(p.wanted.find((w) => w.id === IDS.rental)!.version, "1.0.0.0");
  assertEquals(p.candidateIds, [IDS.rental, IDS.test]);
  assert(p.wanted.every((w) => /^[0-9a-f]{64}$/.test(w.stamp)));
});

Deno.test("deploy: prerequisites stay across calls through the ledger; provisioning is split from candidate publish", async () => {
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const p = await prep(bc, lane);
  const ctx = { ledgerRoot: await tmp(), owned: new Set([BENCH_CANDIDATE_APP_ID]) };
  assertEquals((await deploy(bc, "C1", p.wanted, ctx)).published, 3);
  const second = await deploy(bc, "C1", p.wanted, ctx);
  assertEquals(second.published, 1);
  assert(!bc.syncs[1]!.removeIds.includes(IDS.core));
  assertEquals(second.candidate_publish_ms, 5);
  assert(second.provisioning_ms >= 0);
  assertEquals(Object.keys(await loadLedger(ctx.ledgerRoot, "C1")).length, 3);
});

Deno.test("deploy: prerequisite and unknown failures are infra; a model defect is returned", async () => {
  const bc = new FakeBc();
  const p = await prep(bc, new BcLane(bc, ["C1"]), ["Rental"]);
  const ctx = { ledgerRoot: await tmp(), owned: new Set<string>() };
  bc.publishFailure = (_c, n) => n === "CGR Core" ? "boom" : null;
  await assertRejects(() => deploy(bc, "C1", p.wanted, ctx), ContainerError, "prereq");
  bc.publishFailure = (_c, n) => n === "CGR Rental" ? "something unrecognized" : null;
  await assertRejects(() => deploy(bc, "C2", p.wanted, ctx), ContainerError, "candidate");
  bc.publishFailure = (_c, n) => n === "CGR Rental" ? "The schema synchronization failed: destructive changes" : null;
  assertEquals((await deploy(bc, "C3", p.wanted, ctx)).candidateFailure!.id, IDS.rental);
});

Deno.test("a collision on publish is infra and reroutes", async () => {
  const bc = new FakeBc((cu) => cu === 80010 ? result({ Works: true }) : result({}));
  const lane = new BcLane(bc, ["Cronus281", "Cronus282"]);
  const p = await prep(bc, lane);
  bc.publishFailure = (c, n) => c === "Cronus281" && n === "CGR Test" ? "Codeunit 80013 is already defined in 'Continia Core'" : null;
  const ctx = { ledgerRoot: await tmp(), owned: new Set<string>() };
  const held = await lane.exclusive({ taskId: "HX-001", variantId: "e1", attemptNumber: 1 }, (c) =>
    deployAndTest(bc, c, { wanted: p.wanted, tests: [{ codeunit: 80010, procedures: ["Works"], target: "candidate", zeroIsInfra: true }], cleanupIds: [IDS.test], ctx }));
  assertEquals([held.container, held.retries.length], ["Cronus282", 1]);
  assertEquals(held.result.rows.map((r) => r.outcome), ["pass"]);
});

Deno.test("classification matches the M4 gate", async () => {
  // The accepted M4-16 P5 texts, verbatim (decision accept-M4-16).
  const P5 = JSON.parse(await Deno.readTextFile("tests/fixtures/harness/p5-messages.json")) as Record<string, string>;
  const AREEQUAL = P5.assert_areequal!;
  const EXPECTEDERROR = P5.assert_expectederror!;
  const LOST_ASSERTERROR = P5.lost_asserterror!;
  const RUNTIME = P5.runtime_error!;
  assertEquals(classifyTestFailure(AREEQUAL), "assertion");
  assertEquals(classifyTestFailure(EXPECTEDERROR), "assertion");
  assertEquals(classifyTestFailure(LOST_ASSERTERROR), "assertion");
  assertEquals(classifyTestFailure(RUNTIME), "runtime_error");
  const bc = new FakeBc((cu) => cu === 80010 ? result({ A: true, B: LOST_ASSERTERROR, C: RUNTIME }) : result({}));
  const r = await runTests(bc, "C1", [{ codeunit: 80010, procedures: ["A", "b", "C", "Missing"], target: "candidate", zeroIsInfra: true }]);
  assertEquals(r.rows.map((x) => [x.procedure, x.outcome, x.failure]), [
    ["A", "pass", null], ["b", "fail", "assertion"], ["C", "fail", "runtime_error"], ["Missing", "not_run", "infra"],
  ]);
  assertEquals(scorerPassed(r.rows), null, "mixed assertion and infra is infra");
  await assertRejects(
    () => runTests(bc, "C1", [{ codeunit: 80011, procedures: ["X"], target: "candidate", zeroIsInfra: true }]),
    ContainerError,
    "zero tests",
  );
  const agent = await runTests(bc, "C1", [{ codeunit: 80011, procedures: null, target: "candidate", zeroIsInfra: false }]);
  assertEquals(agent.rows.map((x) => x.outcome), ["not_run"]);
});

Deno.test("deployAndTest: candidates are cleaned up even when tests throw", async () => {
  const bc = new FakeBc(() => {
    throw new ContainerError("soap down", "C1", "test");
  });
  const p = await prep(bc, new BcLane(bc, ["C1"]));
  await assertRejects(() =>
    deployAndTest(bc, "C1", {
      wanted: p.wanted, tests: [{ codeunit: 80010, procedures: null, target: "candidate", zeroIsInfra: true }],
      cleanupIds: [IDS.test], ctx: { ledgerRoot: await tmp(), owned: new Set() },
    })
  );
  assertEquals(bc.syncs.at(-1)!.removeIds, [IDS.test]);
});

Deno.test("deploy: the ledger drops touched ids before the sync; an interrupted sync leaves no stale claim", async () => {
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const p = await prep(bc, lane, ["Rental"]);
  const ctx = { ledgerRoot: await tmp(), owned: new Set<string>() };
  await deploy(bc, "C1", p.wanted, ctx);
  const before = await loadLedger(ctx.ledgerRoot, "C1");
  const seen: { ledger: Record<string, unknown> } = { ledger: {} };
  const sync = bc.syncHarnessApps.bind(bc);
  bc.syncHarnessApps = async (c) => {
    seen.ledger = await loadLedger(ctx.ledgerRoot, c);
    throw new ContainerError("pwsh session died", c, "publish");
  };
  const q = await prep(bc, lane, ["Core"]);
  await assertRejects(() => deploy(bc, "C1", q.wanted, ctx), ContainerError);
  assert(Object.keys(before).length > 0);
  for (const w of q.wanted) assert(!(w.id in seen.ledger), `${w.name} still claimed during the sync`);
  bc.syncHarnessApps = sync;
});

Deno.test("prepareApps: a changed compiler identity republishes every prerequisite", async () => {
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const ctx = { ledgerRoot: await tmp(), owned: new Set<string>() };
  await deploy(bc, "C1", (await prep(bc, lane)).wanted, ctx);
  bc.compilerId = "other-artifact|bccontainerhelper 6.1.14";
  const again = await deploy(bc, "C1", (await prep(bc, lane)).wanted, ctx);
  assertEquals(again.published, 3);
});

Deno.test("deployAndTest: a failed cleanup empties the ledger, is returned, and the caller quarantines the container", async () => {
  const bc = new FakeBc((cu) => cu === 80010 ? result({ Works: true }) : result({}));
  const lane = new BcLane(bc, ["C1", "C2"]);
  const p = await prep(bc, lane);
  const ctx = { ledgerRoot: await tmp(), owned: new Set<string>() };
  bc.cleanupFails.add("C1");
  const held = await lane.exclusive({ taskId: "t", variantId: "v", attemptNumber: 1 }, (c) =>
    deployAndTest(bc, c, { wanted: p.wanted, tests: [{ codeunit: 80010, procedures: ["Works"], target: "candidate", zeroIsInfra: true }], cleanupIds: [IDS.test], ctx }));
  assertEquals(held.container, "C1");
  assertStringIncludes(held.result.cleanupError!, "incomplete");
  assertEquals(await loadLedger(ctx.ledgerRoot, "C1"), {});
  assert(lane.quarantined.has("C1"), "quarantined inside the held region");
  assertEquals((await lane.exclusive({ taskId: "t", variantId: "v", attemptNumber: 1 }, (c) => Promise.resolve(c))).container, "C2");
  assertEquals(await lane.compile((c) => Promise.resolve(c)), "C2");
});

Deno.test("deployAndTest: tests throwing together with a cleanup failure quarantine the container before release", async () => {
  const bc = new FakeBc(() => {
    throw new ContainerError("soap down", "C1", "test");
  });
  const lane = new BcLane(bc, ["C1", "C2"], { maxInfraRetries: 0 });
  const p = await prep(bc, lane);
  bc.cleanupFails.add("C1");
  await assertRejects(() =>
    lane.exclusive({ taskId: "t", variantId: "v", attemptNumber: 1 }, (c) =>
      deployAndTest(bc, c, {
        wanted: p.wanted, tests: [{ codeunit: 80010, procedures: null, target: "candidate", zeroIsInfra: true }],
        cleanupIds: [IDS.test], ctx: { ledgerRoot: Deno.makeTempDirSync(), owned: new Set() },
      }))
  );
  assert(lane.quarantined.has("C1"));
});

Deno.test("BcLane: queued work is refused after its container is quarantined; a cancelled signal is never admitted", async () => {
  const lane = new BcLane(new FakeBc(), ["C1"], { compileSlots: 1 });
  let release!: () => void;
  const first = lane.compileOn("C1", () => new Promise<void>((r) => (release = r)));
  let ran = false;
  const queued = lane.compileOn("C1", () => Promise.resolve(void (ran = true)));
  lane.quarantine("C1", "cleanup failed");
  release();
  await first;
  await assertRejects(() => queued, ContainerError, "ineligible");
  assertEquals(ran, false);
  const l2 = new BcLane(new FakeBc(), ["C1"]);
  const stop = new AbortController();
  stop.abort(new Error("grant revoked"));
  let called = false;
  await assertRejects(() => l2.exclusive({ taskId: "t", variantId: "v", attemptNumber: 1 }, () => Promise.resolve(void (called = true)), stop.signal));
  await assertRejects(() => l2.compile(() => Promise.resolve(void (called = true)), stop.signal));
  assertEquals(called, false);
});

Deno.test("BcLane: outcomes are recorded into the health view; compileOn takes that container's slot", async () => {
  const recorded: { containerName: string; result: string }[] = [];
  const health = { getState: () => ({ containers: [] }), record: (o: { containerName: string; result: string }) => recorded.push(o) };
  const bc = new FakeBc();
  bc.broken.add("C1");
  const lane = new BcLane(bc, ["C1", "C2"], { health, compileSlots: 1 });
  const held = await lane.exclusive({ taskId: "t", variantId: "v", attemptNumber: 1 }, async (c) => {
    await bc.listHarnessApps(c);
    return c;
  });
  assertEquals(held.container, "C2");
  assertEquals(recorded.map((r) => [r.containerName, r.result]), [["C1", "infra_error"], ["C2", "pass"]]);
  let inside = 0;
  let max = 0;
  await Promise.all([1, 2].map(() =>
    lane.compileOn("C2", async () => {
      max = Math.max(max, ++inside);
      await new Promise((r) => setTimeout(r, 10));
      inside--;
    })
  ));
  assertEquals(max, 1);
});

Deno.test("BcLane: one container serializes; queue time sums over retries; alerted containers are skipped", async () => {
  const lane = new BcLane(new FakeBc(), ["C1"]);
  const ctx = { taskId: "t", variantId: "v", attemptNumber: 1 };
  const order: string[] = [];
  const slow = lane.exclusive(ctx, async () => {
    order.push("a");
    await new Promise((r) => setTimeout(r, 30));
    order.push("a-end");
  });
  const fast = lane.exclusive(ctx, () => Promise.resolve(void order.push("b")));
  const [, b] = await Promise.all([slow, fast]);
  assertEquals(order, ["a", "a-end", "b"]);
  assert(b.queue_ms >= 20);
  const health = { getState: () => ({ containers: [{ containerName: "C1", alert: { alertId: "alert-1" } }, { containerName: "C2" }] }), record: () => {} };
  const l2 = new BcLane(new FakeBc(), ["C1", "C2"], { health });
  assertEquals((await l2.exclusive(ctx, (c) => Promise.resolve(c))).container, "C2");
  assertEquals(await l2.compile((c) => Promise.resolve(c)), "C2");
});

Deno.test("BcLane: compiles are admitted at most compileSlots at a time per container", async () => {
  const ws = await workspace();
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"], { compileSlots: 1 });
  const lk = await lock();
  await Promise.all([1, 2, 3].map(async () =>
    lane.compile(async (c) =>
      buildApps(bc, c, { srcDir: ws, apps: await readAppGraph(ws), versions: new Map(), outDir: await tmp(), lock: lk })
    )
  ));
  assertEquals(bc.maxConcurrentCompiles, 1);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/bc-lane.test.ts`
Expected: FAIL, `Module not found ".../src/harness/bc-lane.ts"`.

- [ ] **Step 3: Implement**

`src/harness/bc-lane.ts`:

```typescript
/**
 * The harness BC lane (spec 1a section 5, D12 as amended). Host-side
 * compiles are admitted per container (Semaphore) and move on infra
 * errors; publish + test hold one container (Mutex) and reroute through
 * withInfraRetry; alerted containers are never selected.
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
import type { ContainerOutcome } from "../health/types.ts";
import type { InfraRetryRecord } from "../tasks/interfaces.ts";
import type { SymbolPackage } from "./identity.ts";
import type { TestResultSchema } from "./records.ts";
import type { StagedApp } from "./staging.ts";
import { ContainerError, ValidationError } from "../errors.ts";
import { classifyPublishFailure, isCollisionPublishFailure } from "../health/classify-publish-failure.ts";
import { isInfraError } from "../health/is-infra-error.ts";
import { NoEligibleContainersError } from "../parallel/errors.ts";
import { withInfraRetry } from "../parallel/infra-retry.ts";
import { Mutex, Semaphore } from "../parallel/semaphore.ts";
import {
  appStamps,
  applySync,
  candidateFolders,
  invalidate,
  loadLedger,
  planAppSync,
  prereqVersion,
  saveLedger,
  type WantedApp,
} from "./bc-apps.ts";
import { safeCopyTree } from "./fsutil.ts";
import { hashFile, hashJson, isTaskBuildArtifact } from "./hash.ts";
import { restoreSymbols } from "./symbols.ts";

export interface HarnessBc {
  compileProject(container: string, project: ALProject): Promise<CompilationResult>;
  /** Artifact URL plus pinned BCH version: part of every prerequisite stamp. */
  harnessCompilerIdentity(container: string): Promise<string>;
  listHarnessApps(container: string): Promise<HarnessInstalledApp[]>;
  syncHarnessApps(container: string, plan: { removeIds: string[]; publish: string[] }): Promise<HarnessSyncResult>;
  runHarnessTests(container: string, codeunit: number): Promise<TestResult>;
}

export type TestRow = z.output<typeof TestResultSchema>;

/** The part of ContainerHealthMonitor the lane reads. */
export interface HealthView {
  getState(): { containers: { containerName: string; alert?: unknown }[] };
  record(o: ContainerOutcome): unknown;
}

export interface Held<T> {
  result: T;
  container: string;
  /** Lock wait summed over every attempt, including rerouted ones. */
  queue_ms: number;
  retries: InfraRetryRecord[];
}

export class BcLane {
  private readonly locks = new Map<string, Mutex>();
  private readonly slots = new Map<string, Semaphore>();
  private readonly load = new Map<string, number>();
  private rotor = 0;

  constructor(
    readonly bc: HarnessBc,
    readonly containers: string[],
    private readonly opts: { health?: HealthView; maxInfraRetries?: number; compileSlots?: number } = {},
  ) {
    if (containers.length === 0) throw new Error("BcLane needs a container");
    for (const c of containers) {
      this.locks.set(c, new Mutex());
      this.slots.set(c, new Semaphore(opts.compileSlots ?? 2));
      this.load.set(c, 0);
    }
  }

  /** Containers whose cleanup failed: never selected until the operator clears them. */
  readonly quarantined = new Map<string, string>();

  quarantine(container: string, reason: string): void {
    this.quarantined.set(container, reason);
  }

  private healthy(): string[] {
    const alerted = new Set(
      (this.opts.health?.getState().containers ?? []).filter((c) => c.alert).map((c) => c.containerName),
    );
    return this.containers.filter((c) => !alerted.has(c) && !this.quarantined.has(c));
  }

  private record(containerName: string, result: "pass" | "infra_error") {
    this.opts.health?.record({ containerName, result, timestamp: Date.now() });
  }

  /** After a wait: refuse if cancelled or if the container became ineligible (infra, so holds reroute). */
  private admit(c: string, signal?: AbortSignal): void {
    signal?.throwIfAborted();
    if (!this.healthy().includes(c)) {
      throw new ContainerError(`${c} became ineligible while queued (${this.quarantined.get(c) ?? "health alert"})`, c, "setup");
    }
  }

  /** Run fn under `container`'s compile slot (the oracle build must use a specific container). */
  async compileOn<T>(container: string, fn: (container: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const slot = this.slots.get(container);
    if (!slot) throw new Error(`unknown container ${container}`);
    this.admit(container, signal);
    const release = await slot.acquire();
    try {
      this.admit(container, signal);
      return await fn(container);
    } finally {
      release();
    }
  }

  /** Host-side compile job; admitted per container; next container on infra error. */
  async compile<T>(fn: (container: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const eligible = this.healthy();
    if (eligible.length === 0) throw new NoEligibleContainersError(this.containers, this.containers);
    for (let k = 0;; k++) {
      const c = eligible[this.rotor++ % eligible.length]!;
      const release = await this.slots.get(c)!.acquire();
      try {
        this.admit(c, signal);
        return await fn(c);
      } catch (err) {
        if (signal?.aborted || !isInfraError(err) || k + 1 >= eligible.length) throw err;
      } finally {
        release();
      }
    }
  }

  async exclusive<T>(
    ctx: { taskId: string; variantId: string; attemptNumber: number },
    fn: (container: string) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<Held<T>> {
    signal?.throwIfAborted();
    let container = "";
    let queue_ms = 0;
    const { result, retries } = await withInfraRetry<T>(
      async ({ excludeContainers, onRouted }) => {
        const eligible = this.healthy().filter((c) => !excludeContainers.includes(c));
        if (eligible.length === 0) throw new NoEligibleContainersError(excludeContainers, this.containers);
        const c = eligible.reduce((a, b) => this.load.get(b)! < this.load.get(a)! ? b : a);
        onRouted(c);
        this.load.set(c, this.load.get(c)! + 1);
        const t0 = performance.now();
        const release = await this.locks.get(c)!.acquire();
        queue_ms += performance.now() - t0;
        container = c;
        try {
          this.admit(c, signal);
          const out = await fn(c);
          // Quarantine inside the held region, before the lock is released (round 3 B4).
          const cleanupError = (out as { cleanupError?: string | null } | null)?.cleanupError;
          if (cleanupError) this.quarantine(c, cleanupError);
          this.record(c, "pass");
          return out;
        } catch (err) {
          if (err instanceof CleanupFailedError) this.quarantine(c, err.cleanupError);
          if (isInfraError(err)) this.record(c, "infra_error");
          throw err;
        } finally {
          release();
          this.load.set(c, this.load.get(c)! - 1);
        }
      },
      {
        maxRetries: this.opts.maxInfraRetries ?? Math.max(1, this.containers.length - 1),
        configuredContainers: this.containers,
        context: ctx,
      },
    );
    return { result, container, queue_ms, retries };
  }
}

export interface LockedSymbols {
  store: string;
  packages: SymbolPackage[];
}

/** Tests (or deploy) failed and the cleanup failed too: the container is quarantined by the lane. */
export class CleanupFailedError extends ContainerError {
  constructor(readonly original: unknown, readonly cleanupError: string, container: string) {
    super(`${original instanceof Error ? original.message : String(original)} (and ${cleanupError})`, container, "setup");
    this.name = "CleanupFailedError";
  }
}

export interface BuiltApp {
  folder: string;
  id: string;
  version: string;
  ok: boolean;
  attempted: boolean;
  file: string | null;
  diagnostics: CompilationError[];
  compile_ms: number;
}

const synthetic = (message: string): CompilationError => ({
  code: "CG0001", message, file: "app.json", line: 0, column: 0, severity: "error",
});

/**
 * Compile apps in dependency order. Each app's .alpackages holds the locked
 * packages plus every earlier (or prebuilt) workspace app; after the
 * compile nothing else may be there (BCH filled a gap from its cache).
 */
export async function buildApps(
  bc: HarnessBc,
  container: string,
  o: {
    srcDir: string;
    apps: StagedApp[];
    versions: Map<string, string>;
    outDir: string;
    lock: LockedSymbols;
    prebuilt?: Map<string, string>;
    /** Cancellation: checked before every compile, so no further app is built after an abort. */
    signal?: AbortSignal;
  },
): Promise<BuiltApp[]> {
  const files = new Map(o.prebuilt ?? []);
  const out: BuiltApp[] = [];
  await Deno.mkdir(join(o.outDir, ".apps"), { recursive: true });
  const lockedByName = new Map(o.lock.packages.map((p) => [p.file, p.sha256]));
  for (const app of o.apps) {
    o.signal?.throwIfAborted();
    const version = o.versions.get(app.folder) ?? app.version;
    const failed = app.depends.find((d) => !files.has(d));
    if (failed) {
      out.push({ folder: app.folder, id: app.id, version, ok: false, attempted: false, file: null,
        diagnostics: [synthetic(`dependency ${failed} did not build`)], compile_ms: 0 });
      continue;
    }
    const dir = join(o.outDir, app.folder);
    await Deno.remove(dir, { recursive: true }).catch(() => {});
    await safeCopyTree(join(o.srcDir, app.folder), dir, { skip: isTaskBuildArtifact });
    const appJson = JSON.parse(await Deno.readTextFile(join(dir, "app.json")));
    appJson.version = version;
    await Deno.writeTextFile(join(dir, "app.json"), JSON.stringify(appJson, null, 2));
    const pk = join(dir, ".alpackages");
    await restoreSymbols(o.lock.store, o.lock.packages, pk);
    const workspaceFiles = new Set<string>();
    for (const f of files.values()) {
      await Deno.copyFile(f, join(pk, basename(f)));
      workspaceFiles.add(basename(f));
    }
    const t0 = performance.now();
    const r = await bc.compileProject(container, { path: dir, appJson, sourceFiles: [], testFiles: [] });
    const compile_ms = performance.now() - t0;
    for await (const e of Deno.readDir(pk)) {
      if (workspaceFiles.has(e.name)) continue;
      const sha = lockedByName.get(e.name);
      if (sha === undefined || await hashFile(pk, join(pk, e.name)) !== sha) {
        throw new ValidationError(
          `compile of ${app.folder} used an unlocked symbol package: ${e.name} (the symbols lock does not match the compiler cache)`,
          [e.name],
        );
      }
    }
    let file: string | null = null;
    if (r.success && r.artifactPath) {
      file = join(o.outDir, ".apps", basename(r.artifactPath));
      await Deno.copyFile(r.artifactPath, file);
      files.set(app.folder, file);
    }
    out.push({ folder: app.folder, id: app.id, version, ok: file !== null, attempted: true, file, diagnostics: r.errors, compile_ms });
  }
  return out;
}

export interface PrepareInput {
  pristine: string;
  pristineApps: StagedApp[];
  candidateDir: string;
  candidateApps: StagedApp[];
  changed: string[];
  workDir: string;
  lock: LockedSymbols;
  signal?: AbortSignal;
}

export interface Prepared {
  container: string;
  built: BuiltApp[];
  wanted: WantedApp[];
  candidateIds: string[];
  buildOk: boolean;
  compile_ms: number;
  per_app_compiles: number;
}

export function prepareApps(lane: BcLane, o: PrepareInput): Promise<Prepared> {
  return lane.compile((container) => prepareOn(lane, container, o), o.signal);
}

async function prepareOn(lane: BcLane, container: string, o: PrepareInput): Promise<Prepared> {
  const graph = o.candidateApps;
  const pristineVersion = new Map(o.pristineApps.map((a) => [a.folder, a.version]));
  const cands = new Set(candidateFolders(graph, o.changed));
  const buildId = await hashJson({
    symbols: o.lock.packages.map((p) => [p.app_id, p.version, p.sha256]),
    compiler: await lane.bc.harnessCompilerIdentity(container),
  });
  const stamps = await appStamps(o.pristine, o.pristineApps, buildId);
  const candStamps = await appStamps(o.candidateDir, graph, buildId);
  const versions = new Map(graph.map((a) => {
    const base = pristineVersion.get(a.folder) ?? a.version;
    return [a.folder, cands.has(a.folder) ? base : prereqVersion(base, stamps.get(a.folder)!)];
  }));
  const prereqs = graph.filter((a) => !cands.has(a.folder));
  const pre = await buildApps(lane.bc, container, {
    srcDir: o.pristine, apps: prereqs, versions, outDir: join(o.workDir, "prereq"), lock: o.lock, signal: o.signal,
  });
  const failedPre = pre.find((b) => !b.ok);
  if (failedPre) {
    // The staged baseline must compile (authoring gate): a task bug, not the agent's.
    throw new ValidationError(
      `staged prerequisite ${failedPre.folder} does not compile: ${failedPre.diagnostics.map((d) => d.message).join("; ")}`,
      [failedPre.folder],
    );
  }
  const prebuilt = new Map(pre.map((b) => [b.folder, b.file!] as const));
  const candApps = graph.filter((a) => cands.has(a.folder));
  const built = await buildApps(lane.bc, container, {
    srcDir: o.candidateDir, apps: candApps, versions, outDir: join(o.workDir, "candidate"), lock: o.lock, prebuilt, signal: o.signal,
  });
  const all = [...pre, ...built];
  const buildOk = built.every((b) => b.ok);
  const fileOf = new Map(all.filter((b) => b.ok).map((b) => [b.folder, b.file!] as const));
  const idOf = new Map(graph.map((a) => [a.folder, a.id]));
  const wanted: WantedApp[] = buildOk
    ? graph.map((a) => ({
      id: a.id, name: a.name, publisher: a.publisher, version: versions.get(a.folder)!,
      stamp: cands.has(a.folder) ? candStamps.get(a.folder)! : stamps.get(a.folder)!,
      file: fileOf.get(a.folder)!, role: cands.has(a.folder) ? "candidate" : "prereq",
      depends: a.depends.map((d) => idOf.get(d)!),
    }))
    : [];
  return {
    container, built, wanted, candidateIds: candApps.map((a) => a.id), buildOk,
    compile_ms: all.reduce((s, b) => s + b.compile_ms, 0),
    per_app_compiles: all.filter((b) => b.attempted).length,
  };
}

export interface TestSpec {
  codeunit: number;
  procedures: string[] | null;
  target: string;
  zeroIsInfra: boolean;
}

export interface TestMessage {
  codeunit: number;
  procedure: string;
  target: string;
  message: string;
}

/** Shared with the M4 gate (gate-core.ts). */
export function classifyTestFailure(error: string): "assertion" | "runtime_error" {
  return /\bAssert\.\w+ failed\b/i.test(error) || /An error was expected inside an ASSERTERROR statement/i.test(error)
    ? "assertion"
    : "runtime_error";
}

const row = (s: TestSpec, procedure: string, outcome: TestRow["outcome"], failure: TestRow["failure"]): TestRow => ({
  codeunit: s.codeunit, procedure, target: s.target, outcome, failure,
});

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
      throw new ContainerError(`SOAP run of ${s.codeunit} failed on ${container}: ${err instanceof Error ? err.message : String(err)}`, container, "test");
    }
    test_ms += performance.now() - t0;
    if (r.totalTests === 0 || r.results.length === 0) {
      if (s.zeroIsInfra) throw new ContainerError(`codeunit ${s.codeunit} ran zero tests after publish on ${container} (infra, GH #13)`, container, "test");
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

/** Any infra row makes the scorer unscored, even next to an assertion (M4 parity). */
export function scorerPassed(rows: TestRow[]): boolean | null {
  if (rows.some((r) => r.failure === "infra")) return null;
  return rows.length > 0 && rows.every((r) => r.outcome === "pass");
}

export interface DeployContext {
  /** Fixed per-container ledger directory (results/harness/bc-ledger), shared by every caller. */
  ledgerRoot: string;
  /** App ids the harness owns beyond the wanted set (task oracles, bench candidate). */
  owned: ReadonlySet<string>;
}

export interface Deployed {
  provisioning_ms: number;
  candidate_publish_ms: number;
  candidateFailure: { id: string; message: string } | null;
  removed: number;
  published: number;
}

export async function deploy(bc: HarnessBc, container: string, wanted: WantedApp[], ctx: DeployContext): Promise<Deployed> {
  const t0 = performance.now();
  const ledger = await loadLedger(ctx.ledgerRoot, container);
  const plan = planAppSync(await bc.listHarnessApps(container), wanted, ledger, ctx.owned);
  // Durably drop every touched id before mutating the container.
  const pending = invalidate(ledger, [...plan.remove, ...plan.publish.map((w) => w.id)]);
  await saveLedger(ctx.ledgerRoot, container, pending);
  let sync: HarnessSyncResult;
  try {
    sync = await bc.syncHarnessApps(container, { removeIds: plan.remove, publish: plan.publish.map((w) => w.file) });
  } catch (err) {
    // Unknown container state: forget it so the next deploy republishes everything.
    await saveLedger(ctx.ledgerRoot, container, {});
    throw err;
  }
  await saveLedger(ctx.ledgerRoot, container, applySync(pending, plan, sync));
  const total = performance.now() - t0;
  let candidate_publish_ms = 0;
  for (const p of sync.published) if (plan.publish[p.index]?.role === "candidate") candidate_publish_ms += p.ms;
  const d: Deployed = {
    provisioning_ms: Math.max(0, total - candidate_publish_ms), candidate_publish_ms,
    candidateFailure: null, removed: plan.remove.length, published: sync.published.length,
  };
  if (sync.failed) {
    const w = plan.publish[sync.failed.index];
    const msg = sync.failed.message;
    const modelDefect = w?.role === "candidate" && !isCollisionPublishFailure(msg) && classifyPublishFailure(msg) === "model";
    if (!modelDefect) {
      throw new ContainerError(`harness ${w?.role ?? "app"} publish failed on ${container}: ${msg}`, container, "publish", {
        rawOutput: sync.output.slice(-4096),
      });
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
  /** Non-null when unpublishing the candidates failed: the caller quarantines the container. */
  cleanupError: string | null;
}

/**
 * Deploy, test, then unpublish candidates and the oracle. A failed cleanup
 * empties the container's ledger and is reported (returned, or attached to
 * a thrown error) so the caller quarantines the container; it is never
 * swallowed.
 */
export async function deployAndTest(
  bc: HarnessBc,
  container: string,
  i: { wanted: WantedApp[]; tests: TestSpec[]; cleanupIds: string[]; ctx: DeployContext },
): Promise<DeployTestResult> {
  const cleanup = async (): Promise<string | null> => {
    if (i.cleanupIds.length === 0) return null;
    try {
      const s = await bc.syncHarnessApps(container, { removeIds: i.cleanupIds, publish: [] });
      await saveLedger(i.ctx.ledgerRoot, container, invalidate(await loadLedger(i.ctx.ledgerRoot, container), [...s.removed, ...i.cleanupIds]));
      return null;
    } catch (err) {
      await saveLedger(i.ctx.ledgerRoot, container, {}).catch(() => {});
      return `cleanup on ${container} failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
  let r: Omit<DeployTestResult, "cleanupError">;
  try {
    const deployed = await deploy(bc, container, i.wanted, i.ctx);
    r = deployed.candidateFailure
      ? {
        deployed,
        rows: i.tests.flatMap((s) => (s.procedures ?? ["(publish)"]).map((p) => row(s, p, "not_run", "runtime_error"))),
        messages: [{ codeunit: 0, procedure: "(publish)", target: i.tests[0]?.target ?? "candidate", message: `candidate publish/install failed: ${deployed.candidateFailure.message}` }],
        test_ms: 0,
      }
      : { deployed, ...await runTests(bc, container, i.tests) };
  } catch (err) {
    const c = await cleanup();
    if (c) throw new CleanupFailedError(err, c, container);
    throw err;
  }
  return { ...r, cleanupError: await cleanup() };
}
```

`scripts/harness/app-sync-probe.ts` (ops driver for M1-27; wiring only). It takes the bench lock, stages the refapp at a given revision (default `refapp-v1-rc1`) with `git archive`, discovers the visible test codeunits of the staged `Test` app (no hardcoded codeunit), and cleans up in `finally`:

```typescript
// Ops driver for M1-27. Usage (container leased, no bench live):
//   DOCKER_CONTEXT=desktop-windows deno run --allow-all scripts/harness/app-sync-probe.ts <container> <outDir> [refapp-rev]
import { join, resolve } from "@std/path";
import { setupContainers } from "../../cli/commands/bench/container-setup.ts";
import type { BcContainerProvider } from "../../src/container/bc-container-provider.ts";
import { ConfigManager } from "../../src/config/config.ts";
import { BENCH_CANDIDATE_APP_ID, saveLedger } from "../../src/harness/bc-apps.ts";
import { BcLane, deploy, prepareApps, runTests } from "../../src/harness/bc-lane.ts";
import { safeCopyTree, validatedDest } from "../../src/harness/fsutil.ts";
import { isTaskBuildArtifact } from "../../src/harness/hash.ts";
import { loadSymbolsLock, REFAPP_PATH } from "../../src/harness/identity.ts";
import { readAppGraph } from "../../src/harness/staging.ts";
import { TEST_APP, testCodeunits } from "../../src/harness/verdict-workspace.ts";
import { acquireBenchLock } from "../../src/utils/bench-lock.ts";

const [container, outArg, rev = "refapp-v1-rc1"] = Deno.args;
if (!container || !outArg) throw new Error("usage: app-sync-probe.ts <container> <outDir> [refapp-rev] [--list-only | --keep]");
const listOnly = Deno.args.includes("--list-only");
/** Leave the apps of the last step installed (M1-27 Step 3 observes them afterwards). */
const keep = Deno.args.includes("--keep");
if (["cronus28", "cronus284"].includes(container.toLowerCase())) {
  throw new Error(`${container} is excluded from harness use`);
}
const release = acquireBenchLock("results", { command: `app-sync-probe ${container}` });
let bc: BcContainerProvider | null = null;
try {
  const outDir = await validatedDest(resolve(outArg));
  const packages = await loadSymbolsLock(".");
  if (!packages) throw new Error("no symbols lock; run M1-26 first");
  const lock = { store: resolve("results/harness/symbols"), packages };
  const cfg = await ConfigManager.loadConfig();
  bc = (await setupContainers([container], "bccontainer", cfg.container ?? {})).containerProvider as BcContainerProvider;
  const lane = new BcLane(bc, [container]);
  // The shared ledger scope (M1-15): the probe empties it for this container because it prenukes.
  const ctx = { ledgerRoot: resolve("results/harness/bc-ledger"), owned: new Set([BENCH_CANDIDATE_APP_ID]) };
  const log = (step: string, data: Record<string, unknown>) =>
    console.log(JSON.stringify({ step, at: new Date().toISOString(), ...data }));
  const listed = async () =>
    (await bc!.listHarnessApps(container)).map((a) => `${a.name}@${a.version}${a.installed ? "" : " (not installed)"}`).sort();
  const exportRefapp = async (to: string) => {
    const tar = join(outDir, `refapp-${crypto.randomUUID().slice(0, 8)}.tar`);
    const x = join(outDir, `x-${crypto.randomUUID().slice(0, 8)}`);
    await Deno.mkdir(x);
    for (const [cmd, args] of [["git", ["archive", "--format=tar", "-o", tar, rev, REFAPP_PATH]], ["tar", ["-xf", tar, "-C", x, "--strip-components=2"]]] as const) {
      const r = await new Deno.Command(cmd, { args: [...args] }).output();
      if (!r.success) throw new Error(`${cmd} failed: ${new TextDecoder().decode(r.stderr)}`);
    }
    await safeCopyTree(x, to, { skip: isTaskBuildArtifact });
    return to;
  };
  const touchFirstAl = async (dir: string, app: string) => {
    for await (const e of Deno.readDir(join(dir, app, "src"))) {
      if (e.name.endsWith(".al")) return await Deno.writeTextFile(join(dir, app, "src", e.name), "\n// probe\n", { append: true });
    }
  };
  const step = async (name: string, pristine: string, candidateDir: string, changed: string[]) => {
    const prep = await prepareApps(lane, {
      pristine, pristineApps: await readAppGraph(pristine), candidateDir, candidateApps: await readAppGraph(candidateDir),
      changed, workDir: join(outDir, name), lock,
    });
    const before = await listed();
    const deployed = await deploy(bc!, container, prep.wanted, ctx);
    const units = (await testCodeunits(join(candidateDir, TEST_APP))).filter((t) => !t.testPage);
    const tests = await runTests(bc!, container, units.map((u) => ({ codeunit: u.codeunit, procedures: null, target: "candidate", zeroIsInfra: true })));
    log(name, { before, after: await listed(), candidates: prep.candidateIds, compile_ms: prep.compile_ms,
      per_app_compiles: prep.per_app_compiles, deployed, codeunits: units.map((u) => u.codeunit), rows: tests.rows, test_ms: tests.test_ms });
    return prep;
  };
  if (listOnly) {
    // Read-only observation: no prenuke, no publish, no cleanup (M1-27 Step 3).
    const all = await bc.listHarnessApps(container);
    log("list-only", { apps: all });
    Deno.exit(0);
  }
  const pristine = await exportRefapp(join(outDir, "pristine"));
  await bc.prenukeCentralGaugeApps([container]);
  await saveLedger(ctx.ledgerRoot, container, {});
  log("prenuke", { after: await listed() });
  await step("a-fresh", pristine, pristine, []);
  const rental = await exportRefapp(join(outDir, "rental-changed"));
  await touchFirstAl(rental, "Rental");
  const b = await step("b-rental-changed", pristine, rental, ["Rental"]);
  const stale = await exportRefapp(join(outDir, "core-stale"));
  await touchFirstAl(stale, "Core");
  await step("c-stale-core", stale, stale, []);
  await bc.syncHarnessApps(container, { removeIds: [...b.candidateIds].reverse(), publish: [] });
  log("d-cleanup", { after: await listed() });
  await bc.prenukeCentralGaugeApps([container]);
  await step("e-after-bench-prenuke", pristine, pristine, []);
} finally {
  if (!listOnly && !keep) {
    try {
      await bc?.prenukeCentralGaugeApps([container]);
      await saveLedger(resolve("results/harness/bc-ledger"), container, {});
    } catch { /* reported by the next step's listing */ }
  }
  await bc?.dispose();
  await release();
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/bc-lane.test.ts` then `deno check scripts/harness/app-sync-probe.ts`
Expected: all 18 tests pass; the probe type-checks.

- [ ] **Step 5: Check, lint, format** (the four files)

- [ ] **Step 6: Commit**

```bash
git add src/harness/bc-lane.ts tests/unit/harness/fake-bc.ts tests/unit/harness/bc-lane.test.ts scripts/harness/app-sync-probe.ts
git commit -m "feat(harness): BC lane with admission, health exclusion, locked symbols and M4-aligned classifier"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/bc-lane.test.ts` passes; check, lint and `deno fmt --check` clean; `deno check scripts/harness/app-sync-probe.ts` clean.

---

### Task M1-21: adapter contract, pricing book, cost estimate, trace v1

Spec 1a D9 (harness specifics live in the image and its adapter), section 4 (observed manifest; a requested component that did not load or a version mismatch is `setup_failed`), section 5 (metrics contract; `telemetry.json` fields; `trace.jsonl` event schema v1; cost basis: list price from reported tokens with the catalog pricing snapshot, reported cost kept), findings section 8 (cost basis stands; Claude must not sum repeated assistant chunk usage). Review section 2 item 6: freeze the parser, trace and cost contract now, and distinguish an unobservable component from a confirmed load.

Contract:
- `parse(input)` receives the quarantined raw log, the exit code, the execution's manifest, a `PricingBook` fixed at run start, and a trace output path; it returns telemetry (cost estimated here, never the harness's own figure), observed facts, the list of requested components it **cannot observe**, whether the agent acted, a termination hint, a usage-limit reset, and the number of trace events written.
- `observedMismatch` returns a mismatch (setup_failed) for a version difference or a requested component that is neither loaded nor unobservable; unobservable requested components are returned as `unverified`; the runner records `validity.incomplete_observed: ["loaded_components"]` (M1-22 adds this defaulted field to Part 1's `ValiditySchema`, whose `incomplete_telemetry` accepts telemetry field names only) and lists the components in the side file.
- `estimateCost` prices per model from the book by **logged cache TTL** (owner decision 2026-09-25-m1p2-round2): cache writes are priced as 5-minute or 1-hour writes only when the log states the split; tokens without a stated TTL make the cost `null` with the reason `cache write TTL unknown` (disclosed, never guessed). The 5-minute write price is the catalog's `cache_write_per_mtoken` (now non-zero for Sonnet 5, Opus 5 and Haiku 4.5). The catalog has no 1-hour field; the harness pricing snapshot derives it by the published Anthropic rule, 2x the input price, for `anthropic/*` models only (`ponytail:` a pricing.yml field replaces the rule if the catalog adds one; the site D1 schema is not touched), and for every other provider 1-hour writes price as `null` with a reason. A model missing from the book, a missing or non-numeric usage field, or a zero or null rate for a token kind that was used also makes the cost `null` and names the reason; the snapshot records each model's `pricing_version` and whether the 1-hour rate was derived. The book is loaded once at run start and persisted with the attempt (M1-22), so recovery prices with the same book.
- Adapters register in `src/harness/adapters/mod.ts` (M1-32 adds `claude-code`, M1-35 adds `mock`), so helper modules never import the registry.

**Lane:** infra (stream A). **Deps:** M1-05 (`ResolvedManifest`), M1-07 (`Telemetry`, `ExecutionRecord`, `Termination`). **Date:** 09-30.

**Files:**
- Create: `src/harness/pricing.ts`, `src/harness/trace.ts`, `src/harness/adapter.ts`, `src/harness/adapters/mod.ts`
- Test: `tests/unit/harness/pricing.test.ts`, `tests/unit/harness/adapter.test.ts`

**Interfaces:**
- Produces (pricing.ts): `interface ModelPrice { slug; pricing_version; input; output; cache_read; cache_write_5m; cache_write_1h: number | null; cache_write_1h_derived: boolean }` (USD per million tokens); `interface PricingBook { at: string; models: Record<string /* api model id */, ModelPrice> }`; `loadPricingBook(catalogDir, at: Date): Promise<PricingBook>`; `interface ModelTokens { model /* api id */; requests: number | null; input; cache_read; cache_write_5m; cache_write_1h; cache_write_unknown; output; reasoning: number | null; problems: string[] /* missing usage fields */ }`; `interface CostEstimate { cost_usd: number | null; pricing_snapshot: string | null; per_model: Telemetry["per_model"]; missing: string[] }`; `estimateCost(usage, book): CostEstimate`.
- Produces (trace.ts): `TRACE_VERSION = 1`; `interface TraceEvent { v: 1; seq; t_ms: number | null; type: "tool_call" | "model_request" | "skill_invoke" | "subagent_spawn" | "compaction" | "retry"; session: string | null; agent: string; parent: string | null; call_id: string | null; request_id: string | null; tool: string | null; transport: string | null; skill: string | null; backend_request: string | null; outcome: "ok" | "error" | "denied" | "cancelled" | null; error_class: string | null; result_bytes: number | null; truncated: boolean | null; duration_ms: number | null; model: string | null }`; `writeTrace(path, events): Promise<number>`.
- Produces (adapter.ts): `interface ParseInput { rawLog; exitCode: number | null; manifest: ResolvedManifest; pricing: PricingBook; traceOut: string }`; `interface ParsedRun { telemetry; observed; unobservable: string[]; didWork; termination: Termination | null; usageResetAt: string | null; imageSupport: boolean | null; traceEvents: number }`; `interface MountSpec { src; dst }`; `interface HarnessAdapter { harness; declared; secretFiles; credentialBearing: boolean; enforcesBudget: boolean /* the entrypoint passes the effective max_budget_usd to the harness; M1-22 refuses an adapter without it */; nativeSettings(config, catalog): Record<string, unknown>; providerRoutes(config): Record<string, string>; extraMounts(settings, taskSourceDir, repoRoot): Promise<MountSpec[]>; parse(input): Promise<ParsedRun> }`; `incompleteTelemetry(declared, t)`; `requestedComponents(m)`; `observedMismatch(m, observed, unobservable): { mismatch: string | null; unverified: string[] }`.
- Produces (adapters/mod.ts): `ADAPTERS: Record<string, HarnessAdapter>`; `adapterFor(harness): HarnessAdapter`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/harness/pricing.test.ts`:

```typescript
import { assertAlmostEquals, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { estimateCost, loadPricingBook, type ModelTokens, type PricingBook } from "../../../src/harness/pricing.ts";

const BOOK: PricingBook = {
  at: "2026-10-05T00:00:00.000Z",
  models: {
    "claude-sonnet-5": { slug: "anthropic/claude-sonnet-5", pricing_version: "2026-09-25", input: 2, output: 10, cache_read: 0.2, cache_write_5m: 2.5, cache_write_1h: 4, cache_write_1h_derived: true },
    "zero-cache": { slug: "x/zero-cache", pricing_version: "v1", input: 1, output: 1, cache_read: 0, cache_write_5m: 0, cache_write_1h: null, cache_write_1h_derived: false },
  },
};
const T = (over: Partial<ModelTokens> = {}): ModelTokens => ({
  model: "claude-sonnet-5", requests: null, input: 10, cache_read: 120646, cache_write_5m: 22276, cache_write_1h: 6792,
  cache_write_unknown: 0, output: 2181, reasoning: 694, problems: [], ...over,
});

Deno.test("loadPricingBook: newest entry effective at the run time; 1-hour write derived for anthropic/* only", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(join(dir, "models.yml"), `- slug: anthropic/claude-sonnet-5
  api_model_id: claude-sonnet-5
  family: claude
  display_name: Claude Sonnet 5
- slug: openai/gpt-x
  api_model_id: gpt-x
  family: gpt
  display_name: GPT X
`);
  await Deno.writeTextFile(join(dir, "pricing.yml"), `- pricing_version: '2026-09-08'
  model_slug: anthropic/claude-sonnet-5
  effective_from: '2026-09-08T00:00:00.000Z'
  effective_until: null
  input_per_mtoken: 2
  output_per_mtoken: 10
  cache_read_per_mtoken: 0
  cache_write_per_mtoken: 0
- pricing_version: '2026-09-25'
  model_slug: anthropic/claude-sonnet-5
  effective_from: '2026-09-25T00:00:00.000Z'
  effective_until: null
  input_per_mtoken: 2
  output_per_mtoken: 10
  cache_read_per_mtoken: 0.2
  cache_write_per_mtoken: 2.5
- pricing_version: '2026-12-01'
  model_slug: anthropic/claude-sonnet-5
  effective_from: '2026-12-01T00:00:00.000Z'
  effective_until: null
  input_per_mtoken: 3
  output_per_mtoken: 15
  cache_read_per_mtoken: 0.3
  cache_write_per_mtoken: 3.75
- pricing_version: 'v1'
  model_slug: openai/gpt-x
  effective_from: '2026-01-01T00:00:00.000Z'
  effective_until: null
  input_per_mtoken: 1
  output_per_mtoken: 4
  cache_read_per_mtoken: 0.1
  cache_write_per_mtoken: 0
`);
  const book = await loadPricingBook(dir, new Date("2026-10-05T00:00:00.000Z"));
  const s5 = book.models["claude-sonnet-5"]!;
  assertEquals([s5.pricing_version, s5.cache_write_5m, s5.cache_write_1h, s5.cache_write_1h_derived], ["2026-09-25", 2.5, 4, true]);
  assertEquals(book.models["gpt-x"]!.cache_write_1h, null);
});

Deno.test("estimateCost: priced by logged TTL, per model", () => {
  const r = estimateCost([T()], BOOK);
  assertAlmostEquals(r.cost_usd!, (10 * 2 + 120646 * 0.2 + 22276 * 2.5 + 6792 * 4 + 2181 * 10) / 1e6, 1e-12);
  assertEquals(r.pricing_snapshot, "anthropic/claude-sonnet-5@2026-09-25(1h=2x input)");
  assertEquals([r.per_model[0]!.tokens_cache_write, r.per_model[0]!.tokens_out, r.per_model[0]!.tokens_reasoning], [29068, 2181, 694]);
});

Deno.test("estimateCost: unknown TTL, a missing usage field, an unknown model, a zero or missing rate give null with a reason", () => {
  const ttl = estimateCost([T({ cache_write_5m: 0, cache_write_1h: 0, cache_write_unknown: 29068 })], BOOK);
  assertEquals([ttl.cost_usd, ttl.missing], [null, ["claude-sonnet-5: cache write TTL unknown (29068 tokens)"]]);
  const field = estimateCost([T({ problems: ["outputTokens missing"] })], BOOK);
  assertEquals([field.cost_usd, field.missing], [null, ["claude-sonnet-5: outputTokens missing"]]);
  const unknown = estimateCost([T({ model: "nope" })], BOOK);
  assertEquals([unknown.cost_usd, unknown.missing], [null, ["nope: not in the pricing book"]]);
  const zero = estimateCost([T({ model: "zero-cache", cache_write_5m: 0, cache_write_1h: 0 })], BOOK);
  assertEquals(zero.missing, ["zero-cache: cache_read rate is 0"]);
  const noHour = estimateCost([T({ model: "zero-cache", cache_read: 0, cache_write_5m: 0 })], BOOK);
  assertEquals(noHour.missing, ["zero-cache: cache_write_1h rate is unknown"]);
  const fine = estimateCost([T({ model: "zero-cache", input: 1_000_000, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, output: 0 })], BOOK);
  assertEquals(fine.cost_usd, 1);
});
```

`tests/unit/harness/adapter.test.ts`:

```typescript
import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import { incompleteTelemetry, observedMismatch } from "../../../src/harness/adapter.ts";
import { adapterFor } from "../../../src/harness/adapters/mod.ts";
import { writeTrace } from "../../../src/harness/trace.ts";
import { manifest, telemetry } from "./fixtures.ts";

Deno.test("observedMismatch: version, missing component, unobservable component", () => {
  const m = manifest("x", {
    skills: { path: "bundles/s", hash: "a".repeat(64), files: [] },
    instructions: { path: "bundles/i", hash: "b".repeat(64), files: [] },
  });
  const base = { harness_version: m.harness_version, models: null, loaded_components: ["skills"] };
  assertEquals(observedMismatch(m, base, ["instructions"]), { mismatch: null, unverified: ["instructions"] });
  assertStringIncludes(observedMismatch(m, { ...base, harness_version: "9.9.9" }, ["instructions"]).mismatch!, "9.9.9");
  assertStringIncludes(observedMismatch(m, { ...base, loaded_components: [] }, ["instructions"]).mismatch!, "skills");
  assertStringIncludes(observedMismatch(m, base, []).mismatch!, "instructions");
});

Deno.test("incompleteTelemetry: declared nulls and empty lists", () => {
  assertEquals(incompleteTelemetry(["cost_usd", "exit_code", "per_model"], telemetry(null)), ["cost_usd", "per_model"]);
});

Deno.test("writeTrace: one versioned JSON line per event", async () => {
  const p = join(await Deno.realPath(await Deno.makeTempDir()), "trace.jsonl");
  const n = await writeTrace(p, [{
    v: 1, seq: 1, t_ms: null, type: "tool_call", session: "s1", agent: "main", parent: null, call_id: "toolu_1",
    request_id: null, tool: "Read", transport: "builtin", skill: null, backend_request: null, outcome: "ok",
    error_class: null, result_bytes: 10, truncated: false, duration_ms: null, model: "anthropic/claude-sonnet-5",
  }]);
  assertEquals(n, 1);
  assertEquals(JSON.parse((await Deno.readTextFile(p)).trim()).tool, "Read");
});

Deno.test("adapterFor: unknown harness is loud", () => {
  assertThrows(() => adapterFor("no-such-harness"), ConfigurationError, "no adapter");
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `deno test --allow-all tests/unit/harness/pricing.test.ts tests/unit/harness/adapter.test.ts`
Expected: FAIL, `Module not found ".../src/harness/pricing.ts"`.

- [ ] **Step 3: Implement**

`src/harness/pricing.ts`:

```typescript
/**
 * List-price cost from reported tokens (cost basis decided 2026-09-24; spec
 * 1a section 1). Prices come from the catalog (site/catalog), fixed per run
 * as a PricingBook; the snapshot string names every model@pricing_version.
 */

import type { Telemetry } from "./records.ts";
import { readCatalog } from "../ingest/catalog/read.ts";

export interface ModelPrice {
  slug: string;
  pricing_version: string;
  input: number;
  output: number;
  cache_read: number;
  /** Catalog cache_write_per_mtoken (5-minute TTL). */
  cache_write_5m: number;
  /** 1-hour TTL write; derived as 2x input for anthropic/* (published rule), else null (unknown). */
  cache_write_1h: number | null;
  cache_write_1h_derived: boolean;
}

export interface PricingBook {
  at: string;
  /** Keyed by the provider's api model id (what harness logs report). */
  models: Record<string, ModelPrice>;
}

export async function loadPricingBook(catalogDir: string, at: Date): Promise<PricingBook> {
  const cat = await readCatalog(catalogDir);
  const t = at.getTime();
  const models: Record<string, ModelPrice> = {};
  for (const m of cat.models) {
    const p = cat.pricing
      .filter((x) =>
        x.model_slug === m.slug && Date.parse(x.effective_from) <= t &&
        (x.effective_until == null || Date.parse(x.effective_until) > t)
      )
      .sort((a, b) => Date.parse(b.effective_from) - Date.parse(a.effective_from))[0];
    if (!p) continue;
    // ponytail: derived 1-hour write price; a pricing.yml field replaces this rule if the catalog adds one.
    const anthropic = m.slug.startsWith("anthropic/");
    models[m.api_model_id] = {
      slug: m.slug, pricing_version: p.pricing_version, input: p.input_per_mtoken, output: p.output_per_mtoken,
      cache_read: p.cache_read_per_mtoken, cache_write_5m: p.cache_write_per_mtoken,
      cache_write_1h: anthropic ? 2 * p.input_per_mtoken : null, cache_write_1h_derived: anthropic,
    };
  }
  return { at: at.toISOString(), models };
}

export interface ModelTokens {
  model: string;
  requests: number | null;
  /** Non-overlapping: input + cache_read + all cache writes is the input total. */
  input: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
  /** Cache-write tokens whose TTL the log does not state: never priced. */
  cache_write_unknown: number;
  /** Includes reasoning; reasoning is never added again. */
  output: number;
  reasoning: number | null;
  /** Usage fields the log lacked or reported non-numerically. */
  problems: string[];
}

export interface CostEstimate {
  cost_usd: number | null;
  pricing_snapshot: string | null;
  per_model: Telemetry["per_model"];
  missing: string[];
}

export function estimateCost(usage: ModelTokens[], book: PricingBook): CostEstimate {
  const missing: string[] = [];
  const per_model: Telemetry["per_model"] = [];
  const snapshot: string[] = [];
  let total = 0;
  for (const u of usage) {
    const p = book.models[u.model];
    let cost: number | null = null;
    const why: string[] = u.problems.map((x) => `${u.model}: ${x}`);
    if (u.cache_write_unknown > 0) why.push(`${u.model}: cache write TTL unknown (${u.cache_write_unknown} tokens)`);
    if (!p) why.push(`${u.model}: not in the pricing book`);
    else {
      const kinds: [string, number, number | null][] = [
        ["input", u.input, p.input], ["cache_read", u.cache_read, p.cache_read], ["cache_write_5m", u.cache_write_5m, p.cache_write_5m],
        ["cache_write_1h", u.cache_write_1h, p.cache_write_1h], ["output", u.output, p.output],
      ];
      for (const [k, n, rate] of kinds) {
        if (n > 0 && rate === null) why.push(`${u.model}: ${k} rate is unknown`);
        else if (n > 0 && rate! <= 0) why.push(`${u.model}: ${k} rate is 0`);
      }
      if (why.length === 0) {
        cost = kinds.reduce((sum, [, n, rate]) => sum + n * (rate ?? 0), 0) / 1e6;
        total += cost;
        snapshot.push(`${p.slug}@${p.pricing_version}${p.cache_write_1h_derived && u.cache_write_1h > 0 ? "(1h=2x input)" : ""}`);
      }
    }
    missing.push(...why);
    per_model.push({
      model: p?.slug ?? u.model, requests: u.requests, tokens_in_uncached: u.input, tokens_cache_read: u.cache_read,
      tokens_cache_write: u.cache_write_5m + u.cache_write_1h + u.cache_write_unknown, tokens_out: u.output,
      tokens_reasoning: u.reasoning, cost_usd: cost,
    });
  }
  const ok = missing.length === 0 && usage.length > 0;
  return { cost_usd: ok ? total : null, pricing_snapshot: ok ? snapshot.sort().join(";") : null, per_model, missing };
}
```

`src/harness/trace.ts`:

```typescript
/** Normalized trace events, schema v1 (spec 1a section 5). M2/M3 extend producers, not the shape. */

export const TRACE_VERSION = 1;

export interface TraceEvent {
  v: 1;
  seq: number;
  t_ms: number | null;
  type: "tool_call" | "model_request" | "skill_invoke" | "subagent_spawn" | "compaction" | "retry";
  session: string | null;
  agent: string;
  parent: string | null;
  call_id: string | null;
  request_id: string | null;
  tool: string | null;
  /** builtin, mcp:<server>, shell */
  transport: string | null;
  skill: string | null;
  backend_request: string | null;
  outcome: "ok" | "error" | "denied" | "cancelled" | null;
  error_class: string | null;
  result_bytes: number | null;
  truncated: boolean | null;
  duration_ms: number | null;
  model: string | null;
}

export async function writeTrace(path: string, events: TraceEvent[]): Promise<number> {
  await Deno.writeTextFile(path, events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""));
  return events.length;
}
```

`src/harness/adapter.ts`:

```typescript
/**
 * Harness adapter contract (D9; spec 1a sections 4 and 5). Frozen here so
 * M2/M3 adapters add producers, not interface changes.
 */

import type { Catalog } from "../ingest/catalog/read.ts";
import type { HarnessConfig } from "./config.ts";
import type { ResolvedManifest } from "./manifest.ts";
import type { PricingBook } from "./pricing.ts";
import type { ExecutionRecord, Telemetry, Termination } from "./records.ts";

export interface ParseInput {
  /** Quarantined raw log (redaction happens on publication). */
  rawLog: string;
  exitCode: number | null;
  manifest: ResolvedManifest;
  /** Fixed at run start; the snapshot goes into telemetry. */
  pricing: PricingBook;
  /** Where the normalized trace.jsonl is written (quarantine). */
  traceOut: string;
}

export interface ParsedRun {
  telemetry: Telemetry;
  observed: ExecutionRecord["observed"];
  /** Requested components this harness cannot confirm as loaded. */
  unobservable: string[];
  didWork: boolean;
  termination: Termination | null;
  usageResetAt: string | null;
  imageSupport: boolean | null;
  traceEvents: number;
}

export interface MountSpec {
  src: string;
  dst: string;
}

export interface HarnessAdapter {
  harness: string;
  declared: readonly (keyof Telemetry)[];
  secretFiles: readonly string[];
  /** Carries provider credentials: the egress rules apply. */
  credentialBearing: boolean;
  /** The entrypoint enforces the manifest's effective max_budget_usd (round 2 item 10). */
  enforcesBudget: boolean;
  nativeSettings(config: HarnessConfig, catalog: Catalog): Record<string, unknown>;
  providerRoutes(config: HarnessConfig): Record<string, string>;
  extraMounts(settings: Record<string, unknown>, taskSourceDir: string, repoRoot: string): Promise<MountSpec[]>;
  parse(input: ParseInput): Promise<ParsedRun>;
}

export function incompleteTelemetry(declared: readonly (keyof Telemetry)[], t: Telemetry): string[] {
  return declared.filter((k) => {
    const v = t[k];
    return v === null || v === undefined || (Array.isArray(v) && v.length === 0);
  }).map(String);
}

export function requestedComponents(m: ResolvedManifest): string[] {
  return [
    ...(["instructions", "skills", "agents", "hooks"] as const).filter((k) => m[k] !== null),
    ...m.plugins.map((p) => `plugin:${p.path}`),
    ...m.mcp.map((s) => `mcp:${s.name}`),
    ...m.lsp.map((s) => `lsp:${s.name}`),
    ...m.toolchain.map((t) => `toolchain:${t}`),
  ];
}

export function observedMismatch(
  m: ResolvedManifest,
  o: ExecutionRecord["observed"],
  unobservable: string[],
): { mismatch: string | null; unverified: string[] } {
  if (o.harness_version !== null && o.harness_version !== m.harness_version) {
    return { mismatch: `harness version ${o.harness_version} ran, ${m.harness_version} was requested`, unverified: [] };
  }
  const requested = requestedComponents(m);
  const loaded = o.loaded_components ?? [];
  const unverified = requested.filter((c) => !loaded.includes(c) && unobservable.includes(c));
  const missing = requested.filter((c) => !loaded.includes(c) && !unobservable.includes(c));
  return {
    mismatch: missing.length > 0 ? `requested components did not load: ${missing.join(", ")}` : null,
    unverified,
  };
}
```

`src/harness/adapters/mod.ts` (M1-32 and M1-35 add their entries):

```typescript
import type { HarnessAdapter } from "../adapter.ts";
import { ConfigurationError } from "../../errors.ts";

export const ADAPTERS: Record<string, HarnessAdapter> = {};

export function adapterFor(harness: string): HarnessAdapter {
  const a = ADAPTERS[harness];
  if (!a) throw new ConfigurationError(`no adapter for harness ${harness} (known: ${Object.keys(ADAPTERS).join(", ") || "none"})`);
  return a;
}
```

- [ ] **Step 4: Run them and see them pass**

Run: `deno test --allow-all tests/unit/harness/pricing.test.ts tests/unit/harness/adapter.test.ts`
Expected: all pass.

- [ ] **Step 5: Check, lint, format** (the six files)

- [ ] **Step 6: Commit**

```bash
git add src/harness/pricing.ts src/harness/trace.ts src/harness/adapter.ts src/harness/adapters/mod.ts tests/unit/harness/pricing.test.ts tests/unit/harness/adapter.test.ts
git commit -m "feat(harness): adapter contract, pricing book, list-price cost and trace v1"
```

**Acceptance:** both test files pass; check, lint and `deno fmt --check` clean.

---

### Task M1-32: Claude Code adapter, image and cost parser (pulled forward from M2)

Owner decision 2026-09-25-gate-1002-moved (minimal Claude Code adapter and cost parser pulled forward), findings section 4 (stream-json shapes: `system/init` with `claude_code_version`, `skills`, `mcp_servers`; tool calls as `assistant.message.content[].tool_use`, one record per call; errors as `tool_result.is_error`; final `result` with `usage`, `modelUsage.<model>`, `total_cost_usd`, `num_turns`, `stop_reason`; `rate_limit_event.rate_limit_info.status` and `resetsAt` in unix seconds; do not sum repeated assistant chunk usage), M0-03 (OAuth token path works, `apiKeySource: "none"`), secrets rules (token by file, handed to the claude process as env, never argv). M2 keeps the full trace parser (sub-agent attribution, skill events, categories, retry and compaction fixtures).

Cost: from `result.modelUsage` per model (it includes sub-agent usage; `result.usage` covers the main loop only): `inputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `outputTokens` (includes thinking), `thinkingTokens` as reasoning; a missing or non-numeric field makes that model's cost `null` with the field named. Cache-write TTL: the `cache_creation` splits (`ephemeral_5m_input_tokens`, `ephemeral_1h_input_tokens`) of every assistant message (deduplicated by message id; the stream repeats a message per content block) plus every sub-agent `tool_use_result.usage` are summed per model; when the sum equals the model's `cacheCreationInputTokens` exactly, writes are priced by TTL; otherwise all of that model's writes are `cache_write_unknown` and the cost is `null` (the M0-04 probe sums exactly: 22276 five-minute plus 6792 one-hour equals 29068). Budget: `run.ps1` passes the manifest's effective `limits.max_budget_usd` as `--max-budget-usd`; Claude Code ends with `error_max_budget_usd`, parsed as `budget_exhausted`. Without a final `result` record (hard kill), the cost is `null` and `cost_usd` is incomplete (the per-message sum is only a lower bound; it is stored in `raw_usage.partial` for inspection). `total_cost_usd` goes to `reported_cost_usd`.

Configuration placement keeps the workspace untouched by setup: instructions go to `%USERPROFILE%\.claude\CLAUDE.md` and skills to `%USERPROFILE%\.claude\skills\`, so a frozen workspace that equals the staged one still means "no work". Instructions and hooks are unobservable in stream-json and are reported as such; skills are confirmed by name in `init.skills`, MCP servers by `init.mcp_servers[].status === "connected"`.

**Lane:** infra (stream A). **Deps:** M1-21. **Date:** 10-01.

**Files:**
- Create: `src/harness/adapters/claude-code.ts`
- Modify: `src/harness/adapters/mod.ts` (register)
- Create: `harness/images/base/Dockerfile.windows` (it copies `cg-al.ps1`, created by M1-19), `harness/images/claude-code/Dockerfile.windows`, `harness/images/claude-code/run.ps1`, `harness/configs/cc-sonnet-plain.yml`, `harness/bundles/env/instructions/CLAUDE.md`
- Test: `tests/unit/harness/claude-code.test.ts`

**Interfaces:**
- Produces: `claudeCodeAdapter: HarnessAdapter` (harness `claude-code`, `secretFiles: ["claude-oauth-token"]`, `credentialBearing: true`, declared `harness_version`, `cost_usd`, `reported_cost_usd`, `per_model`, `turns`, `wall_ms`, `exit_code`, `stop_reason`); `parseClaudeStream(text, input): ParsedRun` (pure, for tests); config `cc-sonnet-plain` (models `main: anthropic/claude-sonnet-5`, components `instructions: bundles/env/instructions`).

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/claude-code.test.ts`:

```typescript
import { assert, assertAlmostEquals, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import { incompleteTelemetry } from "../../../src/harness/adapter.ts";
import { claudeCodeAdapter } from "../../../src/harness/adapters/claude-code.ts";
import { adapterFor } from "../../../src/harness/adapters/mod.ts";
import { HarnessConfigSchema } from "../../../src/harness/config.ts";
import type { PricingBook } from "../../../src/harness/pricing.ts";
import { manifest } from "./fixtures.ts";

const FIXTURE = "tests/fixtures/harness/claude-code/probe.jsonl";
const BOOK: PricingBook = {
  at: "2026-10-05T00:00:00.000Z",
  models: { "claude-sonnet-5": { slug: "anthropic/claude-sonnet-5", pricing_version: "2026-09-25", input: 2, output: 10, cache_read: 0.2, cache_write_5m: 2.5, cache_write_1h: 4, cache_write_1h_derived: true } },
};

async function parse(text: string, exitCode: number | null = 0, over = {}) {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(join(dir, "raw.jsonl"), text);
  return {
    dir,
    r: await claudeCodeAdapter.parse({
      rawLog: join(dir, "raw.jsonl"), exitCode, pricing: BOOK, traceOut: join(dir, "trace.jsonl"),
      manifest: manifest("cc", { harness_version: "2.1.282", ...over }),
    }),
  };
}

Deno.test("claude-code parse: the M0-04 probe log gives estimated cost, reported cost, observed facts and a trace", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  const { r, dir } = await parse(text);
  assertEquals(adapterFor("claude-code"), claudeCodeAdapter);
  assertEquals(r.telemetry.harness_version, "2.1.282");
  assertAlmostEquals(r.telemetry.cost_usd!, (10 * 2 + 120646 * 0.2 + 22276 * 2.5 + 6792 * 4 + 2181 * 10) / 1e6, 1e-12);
  assertEquals(r.telemetry.cost_source, "estimated");
  assertEquals(r.telemetry.pricing_snapshot, "anthropic/claude-sonnet-5@2026-09-25(1h=2x input)");
  assertAlmostEquals(r.telemetry.reported_cost_usd!, 0.1288172, 1e-9);
  assertEquals([r.telemetry.turns, r.telemetry.stop_reason], [8, "end_turn"]);
  assertEquals(r.termination, "completed");
  assert(r.didWork);
  assertEquals(r.observed.models, ["anthropic/claude-sonnet-5"]);
  const toolUses = text.split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((j) => j.type === "assistant")
    .flatMap((j) => j.message.content.filter((c: { type: string }) => c.type === "tool_use")).length;
  assertEquals(r.traceEvents, toolUses);
  const trace = (await Deno.readTextFile(join(dir, "trace.jsonl"))).trim().split("\n").map((l) => JSON.parse(l));
  assertEquals(trace.find((e) => e.tool === "mcp__al-tools__al_compile").transport, "mcp:al-tools");
  assertEquals(trace.find((e) => e.tool === "Bash").transport, "shell");
  assertEquals(incompleteTelemetry(claudeCodeAdapter.declared, r.telemetry), []);
});

Deno.test("claude-code parse: a hard kill has no result record, so cost is unknown, never a lower bound", async () => {
  const lines = (await Deno.readTextFile(FIXTURE)).split("\n").filter(Boolean);
  const { r } = await parse(lines.slice(0, 20).join("\n") + "\n", -1);
  assertEquals(r.telemetry.cost_usd, null);
  assert(incompleteTelemetry(claudeCodeAdapter.declared, r.telemetry).includes("cost_usd"));
  assertEquals(r.termination, null);
  assert((r.telemetry.raw_usage as { partial: unknown }).partial !== undefined);
});

Deno.test("claude-code parse: an unstated cache TTL or a missing usage field gives null cost with the reason", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  const noTtl = text.split("\n").map((l) => l.replace(/"cache_creation":\{[^}]*\}/g, '"cache_creation":{}')).join("\n");
  const a = (await parse(noTtl)).r;
  assertEquals(a.telemetry.cost_usd, null);
  assertStringIncludes(JSON.stringify(a.telemetry.raw_usage), "cache write TTL unknown");
  const noOut = text.replace('"outputTokens":2181', '"outputTokens":"n/a"');
  const b = (await parse(noOut)).r;
  assertEquals(b.telemetry.cost_usd, null);
  assertStringIncludes(JSON.stringify(b.telemetry.raw_usage), "outputTokens");
  assert(incompleteTelemetry(claudeCodeAdapter.declared, b.telemetry).includes("cost_usd"));
});

Deno.test("claude-code parse: the budget stop is budget_exhausted", async () => {
  const init = JSON.stringify({ type: "system", subtype: "init", claude_code_version: "2.1.282", skills: [], mcp_servers: [] });
  const r = (await parse([init, JSON.stringify({ type: "result", subtype: "error_max_budget_usd", is_error: true, modelUsage: {} })].join("\n"), 1)).r;
  assertEquals(r.termination, "budget_exhausted");
});

Deno.test("claude-code parse: usage limit, refusal and error results", async () => {
  const init = JSON.stringify({ type: "system", subtype: "init", claude_code_version: "2.1.282", skills: [], mcp_servers: [] });
  const limited = await parse([init,
    JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1790643600 } }),
    JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, api_error_status: 429, modelUsage: {} }),
  ].join("\n"), 1);
  assertEquals([limited.r.termination, limited.r.usageResetAt], ["usage_limited", new Date(1790643600 * 1000).toISOString()]);
  const refusal = await parse([init, JSON.stringify({ type: "result", subtype: "success", is_error: false, stop_reason: "refusal", modelUsage: {} })].join("\n"));
  assertEquals([refusal.r.termination, refusal.r.telemetry.refusal_detected], ["refusal", true]);
  const crash = await parse([init, JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, modelUsage: {} })].join("\n"), 1);
  assertEquals(crash.r.termination, "harness_crash");
});

Deno.test("claude-code parse: skills and MCP are confirmed from init; instructions are unobservable", async () => {
  const init = JSON.stringify({ type: "system", subtype: "init", claude_code_version: "2.1.282", skills: ["objid"], mcp_servers: [{ name: "al-tools", status: "connected" }] });
  const { r } = await parse(init + "\n", 0, {
    skills: { path: "bundles/s/skills", hash: "a".repeat(64), files: [{ path: "objid/SKILL.md", sha256: "b".repeat(64) }] },
    instructions: { path: "bundles/env/instructions", hash: "c".repeat(64), files: [] },
    mcp: [{ name: "al-tools", version: "1", tool_schema_hash: "x" }],
  });
  assertEquals(r.observed.loaded_components?.sort(), ["mcp:al-tools", "skills"]);
  assert(r.unobservable.includes("instructions"));
});

Deno.test("claude-code settings: catalog slug to api id; unknown slug refused", () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc", harness: "claude-code", harness_version: "2.1.282", models: { main: "anthropic/claude-sonnet-5" },
    settings: {}, limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const catalog = { models: [{ slug: "anthropic/claude-sonnet-5", api_model_id: "claude-sonnet-5", family: "claude", display_name: "S5" }], pricing: [], families: [] };
  assertEquals(claudeCodeAdapter.nativeSettings(cfg, catalog).api_models, { main: "claude-sonnet-5" });
  assertEquals(claudeCodeAdapter.providerRoutes(cfg), { main: "anthropic:first-party-oauth" });
  assertThrows(() => claudeCodeAdapter.nativeSettings({ ...cfg, models: { main: "anthropic/nope" } }, catalog), ConfigurationError);
});

Deno.test("run.ps1: the token travels by file and env only; the image pins the harness version", async () => {
  const run = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  assertStringIncludes(run, "Get-Content 'C:\\cg-secrets\\claude-oauth-token'");
  assertStringIncludes(run, "$env:CLAUDE_CODE_OAUTH_TOKEN");
  const argsLine = run.split("\n").find((l) => l.includes("$claudeArgs = @("))!;
  assert(!/token/i.test(argsLine));
  assertStringIncludes(run, "'--max-budget-usd', $cfg.limits.max_budget_usd");
  const cc = await Deno.readTextFile("harness/images/claude-code/Dockerfile.windows");
  assertStringIncludes(cc, "@anthropic-ai/claude-code@2.1.282");
  assert(/^ARG BASE\s*$/m.test(cc) && cc.includes("FROM ${BASE}"), "no default base: the builder passes the inspected immutable base");
  const base = await Deno.readTextFile("harness/images/base/Dockerfile.windows");
  assertStringIncludes(base, "node-v22.19.0-x64.msi");
  assertStringIncludes(base, "ARG SERVERCORE");
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/claude-code.test.ts`
Expected: FAIL, `Module not found ".../src/harness/adapters/claude-code.ts"`.

- [ ] **Step 3: Implement the adapter**

`src/harness/adapters/claude-code.ts`:

```typescript
/**
 * Claude Code adapter, minimal (pulled forward from M2 for the 10-05 gate).
 * Parses stream-json (findings section 4): cost from result.modelUsage,
 * tool calls from assistant tool_use blocks, errors from tool_result.
 */

import type { HarnessAdapter, ParseInput, ParsedRun } from "../adapter.ts";
import type { ModelTokens } from "../pricing.ts";
import type { TraceEvent } from "../trace.ts";
import { ConfigurationError } from "../../errors.ts";
import { requestedComponents } from "../adapter.ts";
import { estimateCost } from "../pricing.ts";
import { writeTrace } from "../trace.ts";

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" ? v as J : {});
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** A required usage field: missing or non-numeric is recorded, never treated as zero. */
const req = (x: J, k: string, problems: string[]): number => {
  const v = x[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  problems.push(`${k} missing`);
  return 0;
};

function transportOf(tool: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool);
  if (m) return `mcp:${m[1]}`;
  return tool === "Bash" || tool === "PowerShell" ? "shell" : "builtin";
}

export function parseClaudeStream(text: string, input: Omit<ParseInput, "rawLog" | "traceOut">): ParsedRun & { trace: TraceEvent[] } {
  const records: J[] = [];
  for (const l of text.split(/\r?\n/)) {
    if (!l.trim().startsWith("{")) continue;
    try {
      records.push(JSON.parse(l));
    } catch { /* partial last line after a kill */ }
  }
  const init = records.find((r) => r.type === "system" && r.subtype === "init");
  const result = [...records].reverse().find((r) => r.type === "result");
  const version = typeof init?.claude_code_version === "string" ? init.claude_code_version : null;

  // Tool calls and outcomes.
  const outcomes = new Map<string, { error: boolean; bytes: number }>();
  for (const r of records.filter((x) => x.type === "user")) {
    for (const c of (obj(r.message).content as J[] | undefined) ?? []) {
      if (c.type === "tool_result") {
        outcomes.set(String(c.tool_use_id), { error: c.is_error === true, bytes: JSON.stringify(c.content ?? "").length });
      }
    }
  }
  const trace: TraceEvent[] = [];
  const perMessage = new Map<string, { model: string; usage: J }>();
  let didWork = false;
  for (const r of records.filter((x) => x.type === "assistant")) {
    didWork = true;
    const msg = obj(r.message);
    if (typeof msg.id === "string") perMessage.set(msg.id, { model: String(msg.model ?? ""), usage: obj(msg.usage) });
    for (const c of (msg.content as J[] | undefined) ?? []) {
      if (c.type !== "tool_use") continue;
      const id = String(c.id);
      const out = outcomes.get(id);
      trace.push({
        v: 1, seq: trace.length + 1, t_ms: null, type: "tool_call",
        session: typeof r.session_id === "string" ? r.session_id : null,
        agent: r.parent_tool_use_id ? "subagent" : "main",
        parent: typeof r.parent_tool_use_id === "string" ? r.parent_tool_use_id : null,
        call_id: id, request_id: typeof msg.id === "string" ? msg.id : null, tool: String(c.name),
        transport: transportOf(String(c.name)), skill: null, backend_request: null,
        outcome: out ? (out.error ? "error" : "ok") : null, error_class: null,
        result_bytes: out?.bytes ?? null, truncated: null, duration_ms: null, model: String(msg.model ?? "") || null,
      });
    }
  }

  // TTL splits: assistant messages (deduplicated by id) plus sub-agent tool_use_result usage, per model.
  const split = new Map<string, { m5: number; h1: number }>();
  const models = Object.keys(obj(result?.modelUsage));
  const addSplit = (model: string | null, u: J) => {
    const cc = obj(u.cache_creation);
    if (model === null || (cc.ephemeral_5m_input_tokens === undefined && cc.ephemeral_1h_input_tokens === undefined)) return;
    const e = split.get(model) ?? { m5: 0, h1: 0 };
    e.m5 += num(cc.ephemeral_5m_input_tokens);
    e.h1 += num(cc.ephemeral_1h_input_tokens);
    split.set(model, e);
  };
  for (const { model, usage: u } of perMessage.values()) addSplit(model, u);
  for (const r of records.filter((x) => x.type === "user")) {
    const tu = obj(obj(r.tool_use_result).usage);
    if (Object.keys(tu).length > 0) addSplit(typeof obj(r.tool_use_result).model === "string" ? String(obj(r.tool_use_result).model) : models.length === 1 ? models[0]! : null, tu);
  }

  // Usage: result.modelUsage is authoritative (includes sub-agents).
  const usage: ModelTokens[] = Object.entries(obj(result?.modelUsage)).map(([model, u]) => {
    const x = obj(u);
    const problems: string[] = [];
    const writes = req(x, "cacheCreationInputTokens", problems);
    const s5 = split.get(model);
    const exact = s5 !== undefined && s5.m5 + s5.h1 === writes;
    return {
      model, requests: null, input: req(x, "inputTokens", problems), cache_read: req(x, "cacheReadInputTokens", problems),
      cache_write_5m: exact ? s5.m5 : 0, cache_write_1h: exact ? s5.h1 : 0, cache_write_unknown: exact ? 0 : writes,
      output: req(x, "outputTokens", problems), reasoning: typeof x.thinkingTokens === "number" ? x.thinkingTokens : null, problems,
    };
  });
  const est = result ? estimateCost(usage, input.pricing) : null;
  const partial: Record<string, ModelTokens> = {};
  for (const { model, usage: u } of perMessage.values()) {
    const p = partial[model] ??= {
      model, requests: 0, input: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, cache_write_unknown: 0, output: 0,
      reasoning: null, problems: [],
    };
    p.requests! += 1;
    p.input += num(u.input_tokens);
    p.cache_read += num(u.cache_read_input_tokens);
    p.cache_write_unknown += num(u.cache_creation_input_tokens);
    p.output += num(u.output_tokens);
  }

  const rate = [...records].reverse().find((r) => r.type === "rate_limit_event");
  const rateInfo = obj(rate?.rate_limit_info);
  const limited = rateInfo.status === "rejected" || (result?.is_error === true && result?.api_error_status === 429);
  const resetAt = typeof rateInfo.resetsAt === "number" ? new Date(rateInfo.resetsAt * 1000).toISOString() : null;
  const stop = typeof result?.stop_reason === "string" ? result.stop_reason : null;
  const termination = !result
    ? (limited ? "usage_limited" : null)
    : limited
    ? "usage_limited"
    : stop === "refusal"
    ? "refusal"
    : result.subtype === "error_max_budget_usd"
    ? "budget_exhausted"
    : result.is_error === true
    ? "harness_crash"
    : "completed";

  const slugOf = (api: string) => input.pricing.models[api]?.slug ?? api;
  const skillNames = new Set(((init?.skills as string[] | undefined) ?? []).map(String));
  const wantSkills = [...new Set((input.manifest.skills?.files ?? []).map((f) => f.path.split("/")[0]!))];
  const connected = ((init?.mcp_servers as J[] | undefined) ?? []).filter((s) => s.status === "connected").map((s) => `mcp:${s.name}`);
  const loaded = init
    ? [
      ...(input.manifest.skills && wantSkills.every((s) => skillNames.has(s)) ? ["skills"] : []),
      ...connected,
    ]
    : null;
  const unobservable = requestedComponents(input.manifest).filter((c) =>
    ["instructions", "agents", "hooks"].includes(c) || c.startsWith("plugin:") || c.startsWith("lsp:") || c.startsWith("toolchain:")
  );
  return {
    telemetry: {
      harness_version: version,
      cost_usd: est?.cost_usd ?? null,
      cost_source: est?.cost_usd != null ? "estimated" : null,
      pricing_snapshot: est?.cost_usd != null ? est.pricing_snapshot : null,
      reported_cost_usd: typeof result?.total_cost_usd === "number" ? result.total_cost_usd : null,
      per_model: est?.per_model ?? [],
      turns: typeof result?.num_turns === "number" ? result.num_turns : null,
      compactions: null,
      wall_ms: typeof result?.duration_ms === "number" ? result.duration_ms : null,
      exit_code: input.exitCode,
      stop_reason: stop,
      refusal_detected: result ? stop === "refusal" : null,
      raw_usage: { usage: result?.usage ?? null, modelUsage: result?.modelUsage ?? null, partial, missing: est?.missing ?? [] },
    },
    observed: {
      harness_version: version,
      models: result ? Object.keys(obj(result.modelUsage)).map(slugOf) : null,
      loaded_components: loaded,
    },
    unobservable,
    didWork,
    termination,
    usageResetAt: limited ? resetAt : null,
    imageSupport: null,
    traceEvents: trace.length,
    trace,
  };
}

export const claudeCodeAdapter: HarnessAdapter = {
  harness: "claude-code",
  declared: ["harness_version", "cost_usd", "reported_cost_usd", "per_model", "turns", "wall_ms", "exit_code", "stop_reason"],
  secretFiles: ["claude-oauth-token"],
  credentialBearing: true,
  enforcesBudget: true,
  nativeSettings(config, catalog) {
    const api_models: Record<string, string> = {};
    for (const [slot, slug] of Object.entries(config.models)) {
      const m = catalog.models.find((x) => x.slug === slug);
      if (!m) throw new ConfigurationError(`model ${slug} (slot ${slot}) is not in the catalog`);
      api_models[slot] = m.api_model_id;
    }
    return { ...config.settings, api_models };
  },
  providerRoutes(config) {
    return Object.fromEntries(Object.keys(config.models).map((slot) => [slot, "anthropic:first-party-oauth"]));
  },
  extraMounts: () => Promise.resolve([]),
  async parse(input) {
    let text = "";
    try {
      text = await Deno.readTextFile(input.rawLog);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
    const { trace, ...parsed } = parseClaudeStream(text, input);
    await writeTrace(input.traceOut, trace);
    return parsed;
  },
};
```

`src/harness/adapters/mod.ts`: import `claudeCodeAdapter` and set `ADAPTERS["claude-code"] = claudeCodeAdapter` (initialize the record literal with it).

- [ ] **Step 4: Images, config, bundle**

`harness/images/base/Dockerfile.windows`:

```dockerfile
# Harness Bench base sandbox (spec 1a section 3): Node, Git, cg-al client.
# SERVERCORE is the digest-pinned image from harness/images/pins.json (M1-26).
# Node 22.19.0, not 22.12.0: pi-coding-agent 0.87.1 needs >= 22.19.0 (findings section 3).
# No secret is ever copied into a layer.
ARG SERVERCORE
FROM ${SERVERCORE}
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

`harness/images/claude-code/Dockerfile.windows`:

```dockerfile
# Claude Code harness image. Built by `harness images build claude-code --version 2.1.282`.
# BASE has no default: `harness images build` passes the inspected immutable base image and then
# verifies that the built image's layers start with the base's layers (M1-24).
ARG BASE
FROM ${BASE}
RUN $env:PATH = 'C:\Program Files\nodejs;' + $env:PATH; \
    npm install -g @anthropic-ai/claude-code@2.1.282; \
    [Environment]::SetEnvironmentVariable('PATH', (npm config get prefix) + ';' + [Environment]::GetEnvironmentVariable('PATH', 'Machine'), [EnvironmentVariableTarget]::Machine)
COPY run.ps1 C:/run.ps1
CMD ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\run.ps1"]
```

`harness/images/claude-code/run.ps1`:

```powershell
# Claude Code entrypoint (D9): translate C:\config to native config, run
# non-interactively, stream-json to stdout. The OAuth token is read from the
# read-only secrets mount and passed to the claude process as env only.
$ErrorActionPreference = 'Stop'
$cfg = Get-Content 'C:\config\settings.json' -Raw | ConvertFrom-Json
$userHome = $env:USERPROFILE
New-Item -ItemType Directory -Force -Path "$userHome\.claude" | Out-Null
if (Test-Path 'C:\config\bundle\instructions') {
  Get-ChildItem 'C:\config\bundle\instructions' -File | Get-Content -Raw | Set-Content "$userHome\.claude\CLAUDE.md"
}
if (Test-Path 'C:\config\bundle\skills') {
  Copy-Item 'C:\config\bundle\skills' "$userHome\.claude\skills" -Recurse -Force
}
$env:CLAUDE_CODE_OAUTH_TOKEN = (Get-Content 'C:\cg-secrets\claude-oauth-token' -Raw).Trim()
$env:CLAUDE_CODE_GIT_BASH_PATH = 'C:\Git\bin\bash.exe'
$env:DISABLE_TELEMETRY = '1'
$env:DISABLE_ERROR_REPORTING = '1'
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
$prompt = Get-Content 'C:\task\prompt.md' -Raw
$claudeArgs = @('-p', $prompt, '--output-format', 'stream-json', '--verbose', '--model', $cfg.settings.api_models.main, '--dangerously-skip-permissions', '--max-budget-usd', $cfg.limits.max_budget_usd)
Set-Location C:\workspace
& claude @claudeArgs
exit $LASTEXITCODE
```

`harness/configs/cc-sonnet-plain.yml`:

```yaml
id: cc-sonnet-plain
harness: claude-code
harness_version: "2.1.282"
models:
  main: anthropic/claude-sonnet-5
settings: {}
components:
  instructions: bundles/env/instructions
limits: { timeout_min: 30, max_budget_usd: 5 }
```

`harness/bundles/env/instructions/CLAUDE.md` (environment facts only, no task guidance; shared by every Claude Code arm so it never differs between arms):

```markdown
The repository is at C:\workspace: one folder per Business Central app, each with an app.json.
The task statement is in C:\task\prompt.md.
Build and test through the harness tool: `cg-al compile [App ...]`, `cg-al test [codeunit ...]`, `cg-al symbols`.
The tool compiles and runs tests on a Business Central server and prints JSON.
```

- [ ] **Step 5: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/claude-code.test.ts`
Expected: all 8 tests pass.

- [ ] **Step 6: Check, lint, format** (the TypeScript files)

- [ ] **Step 7: Commit**

```bash
git add src/harness/adapters harness/images/base harness/images/claude-code harness/configs/cc-sonnet-plain.yml harness/bundles/env tests/unit/harness/claude-code.test.ts
git commit -m "feat(harness): Claude Code adapter, image and list-price cost parser"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/claude-code.test.ts` passes; check, lint and `deno fmt --check` clean. The real run is M1-29.

---

### Task M1-17: verdict: build, pass_to_pass, fail_to_pass, full-suite fingerprint

Revision 2 changes (review sections 2 and 3): judgments store the **full scorer suite** in `scorer_versions` and its `scorer_fingerprint` (Part 1 `scorerFingerprint`), so bugfix and test-authoring judgments of one suite version share a fingerprint and compare; `isCurrentJudgment` defines supersession (current suite fingerprint and not unscored), used by resume and rejudge (After 10-05); an agent-added `TestPage` codeunit fails `pass_to_pass` with a stated reason instead of being skipped; builds use the locked symbols; deploys use the ledger and the owned-id allowlist.

Spec 1a section 7 scorers 1-3 ("An execution passes only if every scorer passes"; pass_to_pass runs the listed visible procedures from the pristine copy plus tests the agent added; fail_to_pass publishes the hidden oracle; results per test procedure), section 8 (a BC fault during the verdict re-judges on another container; the agent is never re-run), findings section 8 (provisioning latency reported separately). Judgment records are Part 1's schema; spans, violations, compiler diagnostics and failure messages go to `results/harness/verdicts/<judgment-id>.json`. Agent-added `TestPage` codeunits cannot run on the SOAP runner (soap-test-harness.md), so they are listed in the side file and not scored (open question 5).

**Lane:** infra (stream A). **Deps:** M1-07 (`JudgmentRecordSchema`, `scorerFingerprint`), M1-13, M1-14, M1-16. **Date:** 10-02.

**Files:**
- Create: `src/harness/verdict.ts`
- Test: `tests/unit/harness/verdict.test.ts`

**Interfaces:**
- Consumes: `BcLane`, `prepareApps`, `buildApps`, `deployAndTest`, `scorerPassed`, `TestRow`, `TestSpec`, `TestMessage` (M1-16); `WantedApp` (M1-15); `scorerFingerprint` (M1-07); `buildVerdictWorkspace`, `addedTestCodeunits`, `TEST_APP` (M1-14); `readAppGraph`, `readAppJson`, `applyOverlay`, `StagedApp` (M1-13); `safeCopyTree` (M1-12); `JudgmentRecordSchema`, `JudgmentRecord` (M1-07); `LoadedTask` (M1-01).
- Produces: `SCORER_SUITE` (full map, all four scorers); `currentScorerFingerprint(): Promise<string>`; `isCurrentJudgment(j): Promise<boolean>`; `interface JudgeInput { executionId; workspaceHash; task: LoadedTask; oracleHash; pristine; artifact; symbolIds: ReadonlySet<string>; workDir; lock: LockedSymbols; deploy: DeployContext }`; `interface VerdictSpans { reconstruct_ms; compile_ms; queue_ms; provisioning_ms; candidate_publish_ms; test_ms; total_ms }`; `interface VerdictLog { v: 1; judgment_id; execution_id; violations: string[]; diagnostics: { app: string; code: string; message: string }[]; test_messages: TestMessage[]; notes: string[]; spans: VerdictSpans; containers: string[]; infra_retries: InfraRetryRecord[]; per_app_compiles: number; error: string | null }`; `judge(lane: BcLane, i: JudgeInput, now?: () => Date): Promise<{ judgment: JudgmentRecord; log: VerdictLog }>`; `writeVerdictLog(resultsRoot: string, log: VerdictLog): Promise<void>`. M1-18 adds the test-authoring path inside `judge`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/verdict.test.ts`:

```typescript
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import { freezeWorkspace, safeCopyTree } from "../../../src/harness/fsutil.ts";
import { oracleHash, resolveRefapp } from "../../../src/harness/identity.ts";
import { JudgmentRecordSchema, scorerFingerprint } from "../../../src/harness/records.ts";
import { applyOverlay, stageRefappTask } from "../../../src/harness/staging.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { isCurrentJudgment, judge, SCORER_SUITE, writeVerdictLog } from "../../../src/harness/verdict.ts";
import { deployedSource, FakeBc, result } from "./fake-bc.ts";
import { IDS, makeRefappRepo, write } from "./refapp-fixture.ts";

/** Shipped test passes unless Rental carries BREAK_P2P; the oracle passes iff Rental returns 10. */
function script() {
  return new FakeBc((cu, deployed) => {
    const rental = deployedSource(deployed, "CGR Rental");
    if (cu === 80010) {
      return result({ ShippedPasses: rental.includes("BREAK_P2P") ? "Assert.IsTrue failed. broken" : true });
    }
    if (cu === 85000) {
      return result({ FixWorks: rental.includes("exit(10)") ? true : "Assert.AreEqual failed. Expected:<10>" });
    }
    if (cu === 81000) return result({ AgentTest: true });
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
    out: join(await Deno.realPath(await Deno.makeTempDir()), "stage"),
  });
  const ws = await Deno.realPath(await Deno.makeTempDir());
  await safeCopyTree(staged.pristine, ws);
  if (solution) await applyOverlay(join(task.dir, solution), ws);
  for (const [rel, text] of Object.entries(edits)) await write(ws, rel, text);
  const results = await Deno.realPath(await Deno.makeTempDir());
  const frozen = await freezeWorkspace({ resultsRoot: results, privateRoot: await Deno.realPath(await Deno.makeTempDir()), workspace: ws, secrets: [] });
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
      workDir: await Deno.realPath(await Deno.makeTempDir()),
      lock: { store: repo.symbolStore, packages: repo.symbols },
      deploy: { ledgerRoot: join(results, "bc-ledger"), owned: new Set<string>() },
    },
  };
}

Deno.test("judge: the correct solution passes every scorer; the record validates", async () => {
  const bc = script();
  const { input, results } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  JudgmentRecordSchema.parse(judgment);
  assertEquals(judgment.verdict, "pass");
  assertEquals(judgment.scorer_versions, SCORER_SUITE);
  assertEquals(judgment.scorer_fingerprint, await scorerFingerprint(SCORER_SUITE));
  assert(await isCurrentJudgment(judgment));
  assertEquals(judgment.scorers.map((s) => [s.name, s.passed]), [
    ["build", true],
    ["pass_to_pass", true],
    ["fail_to_pass", true],
  ]);
  assertEquals(judgment.scorers[2]!.tests, [
    { codeunit: 85000, procedure: "FixWorks", target: "candidate", outcome: "pass", failure: null },
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

Deno.test("judge: agent-added tests run under pass_to_pass; a TestPage test fails with a reason", async () => {
  const added = `codeunit 81000 "Agent"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure AgentTest()\n    begin\n    end;\n}\n`;
  const ok = await setup("correct", { "Test/src/Agent.Test.al": added });
  const r1 = await judge(new BcLane(script(), ["C1"]), ok.input);
  assertEquals(r1.judgment.verdict, "pass");
  assert(r1.judgment.scorers[1]!.tests.some((t) => t.codeunit === 81000 && t.outcome === "pass"));
  const page = await setup("correct", {
    "Test/src/Agent.Test.al": added,
    "Test/src/Page.Test.al": `codeunit 81001 "Page"\n{\n    Subtype = Test;\n    var P: TestPage "Customer Card";\n}\n`,
  });
  const r2 = await judge(new BcLane(script(), ["C1"]), page.input);
  assertEquals(r2.judgment.verdict, "fail");
  assertStringIncludes(r2.log.test_messages.map((m) => m.message).join("\n"), "TestPage tests are not supported");
});

Deno.test("scorer suite: every scorer, one fingerprint for every task kind", () => {
  assertEquals(Object.keys(SCORER_SUITE).sort(), ["build", "fail_to_pass", "mutant_kill", "pass_to_pass"]);
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
import type { WantedApp } from "./bc-apps.ts";
import {
  type BcLane,
  buildApps,
  type DeployContext,
  deployAndTest,
  type LockedSymbols,
  type Prepared,
  prepareApps,
  scorerPassed,
  type TestMessage,
  type TestRow,
  type TestSpec,
} from "./bc-lane.ts";
import { type JudgmentRecord, JudgmentRecordSchema, scorerFingerprint } from "./records.ts";
import { readAppGraph, readAppJson, type StagedApp } from "./staging.ts";
import type { LoadedTask } from "./task.ts";
import {
  addedTestCodeunits,
  buildVerdictWorkspace,
  TEST_APP,
} from "./verdict-workspace.ts";

/**
 * The full scorer suite, recorded on every judgment whatever the task kind,
 * so one suite version has one fingerprint (Part 1 refuses mixed
 * fingerprints in a comparison). Bump a version when a scorer's semantics
 * change; judgments with another fingerprint are superseded (rejudge).
 */
export const SCORER_SUITE: Record<string, string> = {
  build: "1",
  pass_to_pass: "1",
  fail_to_pass: "1",
  mutant_kill: "1",
};
type ScorerName = "build" | "pass_to_pass" | "fail_to_pass" | "mutant_kill";

export function currentScorerFingerprint(): Promise<string> {
  return scorerFingerprint(SCORER_SUITE);
}

/** A judgment that needs no rejudge: current suite and not unscored. */
export async function isCurrentJudgment(j: JudgmentRecord): Promise<boolean> {
  return j.verdict !== "unscored" && j.scorer_fingerprint === await currentScorerFingerprint();
}

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
  lock: LockedSymbols;
  deploy: DeployContext;
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
    (c) => deployAndTest(ctx.lane.bc, c, { wanted, tests, cleanupIds, ctx: ctx.i.deploy }),
  );
  const s = ctx.log.spans;
  s.queue_ms += held.queue_ms;
  s.provisioning_ms += held.result.deployed.provisioning_ms;
  s.candidate_publish_ms += held.result.deployed.candidate_publish_ms;
  s.test_ms += held.result.test_ms;
  ctx.log.containers.push(held.container);
  ctx.log.infra_retries.push(...held.retries);
  ctx.log.test_messages.push(...held.result.messages);
  if (held.result.cleanupError) {
    // Never swallowed (round 2 item 5): the container leaves the lane until the operator clears it.
    ctx.lane.quarantine(held.container, held.result.cleanupError);
    ctx.log.notes.push(`quarantined ${held.container}: ${held.result.cleanupError}`);
  }
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
  const version = aj.version;
  // Through the lane's admission for that container (round 2 item 5).
  const [b] = await ctx.lane.compileOn(prep.container, (c) => buildApps(ctx.lane.bc, c, {
    srcDir: ctx.i.task.dir,
    apps: [app],
    versions: new Map([["oracle", version]]),
    outDir: join(ctx.i.workDir, "oracle-build"),
    lock: ctx.i.lock,
    prebuilt: new Map(prep.wanted.map((w) => [w.id, w.file])),
  }));
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
    stamp: "0".repeat(64),
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
    lock: i.lock,
  });
  recordBuild(ctx, prep, "candidate");
  if (!prep.buildOk) return scores.failRest();
  scores.set("build", true);

  const p2p: TestSpec[] = [];
  const testPageRows: TestRow[] = [];
  if (scores.has("pass_to_pass")) {
    for (const r of t.pass_to_pass) {
      p2p.push({ codeunit: r.codeunit, procedures: r.procedures, target: "candidate", zeroIsInfra: true });
    }
    for (const a of await addedTestCodeunits(join(i.pristine, TEST_APP), join(vw.dir, TEST_APP))) {
      if (a.testPage) {
        testPageRows.push({ codeunit: a.codeunit, procedure: "(TestPage)", target: "candidate", outcome: "not_run", failure: "runtime_error" });
        log.test_messages.push({ codeunit: a.codeunit, procedure: "(TestPage)", target: "candidate", message: "TestPage tests are not supported by the harness test runner" });
        continue;
      }
      // Discovered procedures are expected: a missing one or zero results is infra, never a pass (round 2 item 6).
      p2p.push({ codeunit: a.codeunit, procedures: a.procedures, target: "candidate", zeroIsInfra: true });
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
    const r = [...rows.filter((x) => !oracleUnits.has(x.codeunit)), ...testPageRows];
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
    scorer_versions: SCORER_SUITE,
    scorer_fingerprint: await currentScorerFingerprint(),
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
Expected: all 10 tests pass.

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


### Task M1-19: `cg-al` backend and client

Spec 1a section 5 item 4 (compile, test and symbol lookup on the caller's own workspace only; no endpoint lists apps, reads other workspaces or runs the oracle), section 5 telemetry (host call log per request, units kept apart), D12, section 8 (a BC fault on the agent's own call is a tool error and marks `infra_exposed`). M0-05 carryover in full. Review gate 2 and section 2 item 1: the snapshot is validated against the grant's **trusted** app identities before any compile, publish or cleanup; cleanup is limited to owned ids (M1-15); discovered codeunits obey the same bands as explicit ones; the body is read as a stream with a hard limit and the busy check comes first; revocation waits for the in-flight request; two simultaneously valid grants cannot be crossed; the server binds only an allowed container-facing address.

The snapshot is taken from a **quiescent** workspace (review round 2 item 1): the backend pauses the sandbox (`docker pause`, bounded; Hyper-V isolation, proven on this host in M1-26), copies with `safeCopyTree` (M1-12), and unpauses in `finally`. A failed pause is an infra error (503) and nothing is copied. Every request is bounded (review round 2 item 2): the body read has a deadline (408), each operation receives an `AbortSignal`, and `revoke` is atomic with admission (a `closing` flag checked synchronously right before a request is admitted) and waits for the in-flight request up to a grace, then aborts it and waits once more; it reports whether the grant drained. Round 3 B2: the cancellation reaches the **production** operations: `defaultBackendOps` passes the request signal (grant revocation combined with a per-request deadline, `requestDeadlineMs`, default 30 minutes) to compile admission, every app compile and the exclusive publish-and-test hold, so no BC mutation starts after cancellation; an operation already inside a SOAP call finishes, then nothing further runs and the candidates are cleaned up. A failed or throwing `docker unpause` is an infra fault: the request returns 503 and the grant's `onFault` is called, so the runner stops the execution (M1-22). The client measures its own script time with a Stopwatch (`script_ms`, monotonic); process start-up is derived later from the trace's tool duration minus `script_ms` (M2).

**Lane:** infra2 (stream B). **Deps:** M1-12, M1-13, M1-14 (`validateApps`, `testCodeunits`), M1-15, M1-16, M1-20. **Date:** 10-02.

**Files:**
- Create: `src/harness/backend.ts`, `harness/images/base/cg-al.ps1`
- Test: `tests/unit/harness/backend.test.ts`

**Interfaces:**
- Produces: `BACKEND_VERSION = "cg-al-backend@1"`; `MAX_BODY_BYTES = 65536`; `sha256(text)`; `timingSafeEqual(a, b)`; `interface BackendGrant { executionId; sandbox: string | null /* container to pause for snapshots */; onFault?(reason: string): void /* unpause failed: stop the execution */; workspace; pristine; trusted: StagedApp[]; symbols: SymbolPackage[]; lock: LockedSymbols; deploy: DeployContext; hostLog }`; `interface HostLogLine`; `interface OpContext { grant; snapshot; apps; requestId; workDir; signal: AbortSignal }`; `interface OpResult`; `interface BackendOps { compile(ctx, apps); test(ctx, codeunits) }`; `class Backend { constructor(o: { approvedRoots; workRoot; ops; allowedHosts: string[]; docker?: DockerCli; opTimeoutMs?; bodyTimeoutMs?; revokeGraceMs?; requestDeadlineMs?; now? }); grant(g, ttlMs): Promise<string>; revoke(executionId): Promise<boolean /* drained */>; handle(req): Promise<Response>; serve(hostname, port) }`; `checkSnapshot(snapshot, trusted, symbolIds): Promise<string[]>`; `defaultBackendOps(lane): BackendOps`; `resolveBackendHost(): Promise<string>`; `readHostLog(path)`.

- [ ] **Step 1: Write the failing test**

`tests/unit/harness/backend.test.ts`:

```typescript
import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError, ContainerError, ValidationError } from "../../../src/errors.ts";
import {
  Backend,
  type BackendGrant,
  type BackendOps,
  defaultBackendOps,
  readHostLog,
  resolveBackendHost,
  timingSafeEqual,
} from "../../../src/harness/backend.ts";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import { exists } from "../../../src/harness/fsutil.ts";
import { FakeDocker } from "./fake-docker.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import { createCommandMock } from "../../utils/command-mock.ts";
import { FakeBc, result } from "./fake-bc.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";

const EXEC_A = "00000000-0000-4000-8000-00000000e001";
const EXEC_B = "00000000-0000-4000-8000-00000000e002";
const tmp = async () => await Deno.realPath(await Deno.makeTempDir());

interface Setup {
  root: string;
  wsA: string;
  hostLog: string;
  backend: Backend;
  tokenA: string;
  tokenB: string;
  seen: string[];
  clock: { t: number };
  gate: { wait: Promise<void> | null };
  failWith: { err: Error | null };
  docker: FakeDocker;
}

async function workspace(root: string, exec: string): Promise<string> {
  const ws = join(root, "work", exec, "workspace");
  await write(ws, "Core/app.json", appJson(IDS.core, "CGR Core", [70000, 70099], []));
  await write(ws, "Core/src/C.al", `codeunit 70000 "CGR Core"\n{\n}\n`);
  await write(ws, "Test/app.json", appJson(IDS.test, "CGR Test", [80000, 84999], [{ id: IDS.core, name: "CGR Core" }]));
  await write(ws, "Test/src/T.al", `codeunit 80010 "T"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure A()\n    begin\n    end;\n}\n`);
  return ws;
}

async function grantFor(b: Backend, root: string, exec: string, hostLog: string): Promise<string> {
  const ws = await workspace(root, exec);
  const g: BackendGrant = {
    executionId: exec, sandbox: `cg-harness-test-${exec.slice(-4)}`, workspace: ws, pristine: ws, trusted: await readAppGraph(ws),
    symbols: [{ app_id: IDS.assert, name: "Library Assert", publisher: "Microsoft", version: "28.0.0.0", file: "a.app", sha256: "0".repeat(64) }],
    lock: { store: root, packages: [] }, deploy: { ledgerRoot: root, owned: new Set() }, hostLog,
  };
  return await b.grant(g, 60_000);
}

async function setup(): Promise<Setup> {
  const root = await tmp();
  const seen: string[] = [];
  const gate: Setup["gate"] = { wait: null };
  const failWith: Setup["failWith"] = { err: null };
  const ops: BackendOps = {
    async compile(ctx, apps) {
      seen.push(ctx.snapshot);
      if (gate.wait) await Promise.race([gate.wait, new Promise((_, rej) => ctx.signal.addEventListener("abort", () => rej(ctx.signal.reason)))]);
      if (failWith.err) throw failWith.err;
      return { body: { apps: apps.map((a) => ({ app: a, ok: true, diagnostics: [] })) }, log: { outcome: "ok", apps_compiled: apps, per_app_compiles: apps.length, spans: { compile_ms: 1 } } };
    },
    test: () => Promise.resolve({ body: { tests: [] }, log: { outcome: "ok" } }),
  };
  const clock = { t: 1_000 };
  const hostLog = join(root, "host-log.jsonl");
  const docker = new FakeDocker();
  const backend = new Backend({
    approvedRoots: [join(root, "work")], workRoot: join(root, "backend"), ops, allowedHosts: ["127.0.0.1"], now: () => clock.t,
    docker, opTimeoutMs: 100, bodyTimeoutMs: 100, revokeGraceMs: 50,
  });
  await Deno.mkdir(join(root, "work"), { recursive: true });
  const tokenA = await grantFor(backend, root, EXEC_A, hostLog);
  const tokenB = await grantFor(backend, root, EXEC_B, join(root, "host-log-b.jsonl"));
  return { root, wsA: join(root, "work", EXEC_A, "workspace"), hostLog, backend, tokenA, tokenB, seen, clock, gate, failWith, docker };
}

function req(path: string, token: string | null, body: BodyInit | null, exec = EXEC_A, method = "POST", headers: Record<string, string> = {}) {
  const h: Record<string, string> = { "x-cg-execution": exec, "content-type": "application/json", ...headers };
  if (token !== null) h.authorization = `Bearer ${token}`;
  return new Request(`http://backend${path}`, { method, headers: h, ...(method === "POST" && body !== null ? { body } : {}) });
}

Deno.test("backend: missing, wrong, crossed, expired and revoked tokens are 401", async () => {
  const s = await setup();
  assertEquals((await s.backend.handle(req("/v1/compile", null, "{}"))).status, 401);
  assertEquals((await s.backend.handle(req("/v1/compile", "nope", "{}"))).status, 401);
  assertEquals((await s.backend.handle(req("/v1/compile", s.tokenA, "{}", EXEC_B))).status, 401, "A's token on B's grant");
  assertEquals((await s.backend.handle(req("/v1/compile", s.tokenB, "{}", EXEC_B))).status, 200);
  s.clock.t += 61_000;
  assertEquals((await s.backend.handle(req("/v1/compile", s.tokenA, "{}"))).status, 401);
  s.clock.t -= 61_000;
  await s.backend.revoke(EXEC_A);
  assertEquals((await s.backend.handle(req("/v1/compile", s.tokenA, "{}"))).status, 401);
});

Deno.test("backend: only compile, test and symbols exist", async () => {
  const s = await setup();
  for (const p of ["/v1/oracle", "/v1/apps", "/v1/workspaces", "/v1/compile/../oracle"]) {
    assertEquals((await s.backend.handle(req(p, s.tokenA, "{}"))).status, 404, p);
  }
  assertEquals((await s.backend.handle(req("/v1/compile", s.tokenA, null, EXEC_A, "GET"))).status, 404);
});

Deno.test("backend: malformed JSON, unknown fields, unknown apps and hidden codeunits are 400", async () => {
  const s = await setup();
  const bad = [
    ["/v1/compile", "{"], ["/v1/compile", '{"apps":["Core"],"path":"C:\\\\"}'], ["/v1/compile", '{"apps":["..\\\\x"]}'],
    ["/v1/compile", '{"apps":["Rental"]}'], ["/v1/test", '{"codeunits":[85001]}'], ["/v1/test", '{"codeunits":[80013]}'],
    ["/v1/test", '{"codeunits":[84950]}'],
  ];
  for (const [p, body] of bad) assertEquals((await s.backend.handle(req(p!, s.tokenA, body!))).status, 400, body);
  assert((await readHostLog(s.hostLog)).every((l) => l.outcome === "rejected"));
  assertEquals(s.seen, []);
});

Deno.test("backend: a streamed oversize body without length is 413; a truncated stream is 400", async () => {
  const s = await setup();
  let chunks = 0;
  const big = new ReadableStream<Uint8Array>({
    pull(c) {
      c.enqueue(new TextEncoder().encode("x".repeat(16_384)));
      if (++chunks > 8) c.close();
    },
  });
  assertEquals((await s.backend.handle(req("/v1/compile", s.tokenA, big))).status, 413);
  const truncated = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"apps":["Co'));
      c.close();
    },
  });
  assertEquals((await s.backend.handle(req("/v1/compile", s.tokenA, truncated))).status, 400);
});

Deno.test("backend: a second concurrent request is 429; revoke waits for the in-flight request", async () => {
  const s = await setup();
  let open!: () => void;
  s.gate.wait = new Promise<void>((r) => (open = r));
  const first = s.backend.handle(req("/v1/compile", s.tokenA, '{"apps":["Core"]}'));
  await new Promise((r) => setTimeout(r, 20));
  assertEquals((await s.backend.handle(req("/v1/compile", s.tokenA, '{"apps":["Core"]}'))).status, 429);
  let drained: boolean | null = null;
  const rev = s.backend.revoke(EXEC_A).then((d) => (drained = d));
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(drained, null, "revoke must wait for the in-flight request");
  open();
  assertEquals((await first).status, 200);
  await rev;
  assertEquals(drained, true);
});

Deno.test("backend: revoke aborts an operation that outlives the grace and still returns", async () => {
  const s = await setup();
  s.gate.wait = new Promise<void>(() => {}); // never opens: only the abort ends it
  const first = s.backend.handle(req("/v1/compile", s.tokenA, '{"apps":["Core"]}'));
  await new Promise((r) => setTimeout(r, 20));
  const t0 = performance.now();
  assertEquals(await s.backend.revoke(EXEC_A), true, "aborted within the second grace");
  assert(performance.now() - t0 < 1_000);
  assertEquals((await first).status, 500);
});

Deno.test("backend: a revoke during the token check never admits the request", async () => {
  const s = await setup();
  const pending = s.backend.handle(req("/v1/compile", s.tokenA, '{"apps":["Core"]}'));
  await s.backend.revoke(EXEC_A); // runs while handle awaits the digest
  assertEquals((await pending).status, 401);
  assertEquals(s.seen, []);
});

Deno.test("backend: a stalled body is 408 within the deadline", async () => {
  const s = await setup();
  const stalled = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"apps":'));
    },
  });
  const t0 = performance.now();
  assertEquals((await s.backend.handle(req("/v1/compile", s.tokenA, stalled))).status, 408);
  assert(performance.now() - t0 < 1_000);
});

Deno.test("backend: a failed unpause is a 503 infra fault and stops the execution through onFault", async () => {
  const root = await tmp();
  await Deno.mkdir(join(root, "work"), { recursive: true });
  const docker = new FakeDocker();
  docker.unpause = () => Promise.resolve(1);
  const faults: string[] = [];
  const ops: BackendOps = {
    compile: () => Promise.resolve({ body: {}, log: { outcome: "ok" } }),
    test: () => Promise.resolve({ body: {}, log: { outcome: "ok" } }),
  };
  const b = new Backend({ approvedRoots: [join(root, "work")], workRoot: join(root, "backend"), ops, allowedHosts: ["127.0.0.1"], docker, opTimeoutMs: 100 });
  const ws = await workspace(root, EXEC_A);
  const tok = await b.grant({
    executionId: EXEC_A, sandbox: "cg-harness-x", onFault: (r) => faults.push(r), workspace: ws, pristine: ws,
    trusted: await readAppGraph(ws), symbols: [], lock: { store: root, packages: [] }, deploy: { ledgerRoot: root, owned: new Set() },
    hostLog: join(root, "hl.jsonl"),
  }, 60_000);
  assertEquals((await b.handle(req("/v1/compile", tok, '{"apps":["Core"]}'))).status, 503);
  assertStringIncludes(faults.join("\n"), "unpause");
});

Deno.test("production ops: a revoke past the grace cancels before any further BC mutation", async () => {
  const s = await setup();
  let releaseCompile!: () => void;
  const gate = new Promise<void>((r) => (releaseCompile = r));
  const bc = new FakeBc(() => result({ A: true }));
  bc.onCompile = () => gate;
  const exec = "00000000-0000-4000-8000-00000000e004";
  const b = new Backend({
    approvedRoots: [join(s.root, "work")], workRoot: join(s.root, "backend4"), ops: defaultBackendOps(new BcLane(bc, ["C1"])),
    allowedHosts: ["127.0.0.1"], docker: new FakeDocker(), revokeGraceMs: 100,
  });
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl4.jsonl"));
  const pending = b.handle(req("/v1/test", tok, "{}", exec));
  await new Promise((r) => setTimeout(r, 30));
  const revoking = b.revoke(exec);
  await new Promise((r) => setTimeout(r, 150)); // past the first grace: the signal is aborted
  releaseCompile();
  assertEquals(await revoking, true);
  assert([500, 503].includes((await pending).status));
  assertEquals(bc.compiles.length, 1, "no further app compiled after the abort");
  assertEquals(bc.syncs, [], "no publish after the abort");
});

Deno.test("production ops: a request past its deadline is refused before any publish", async () => {
  const s = await setup();
  const bc = new FakeBc(() => result({ A: true }));
  bc.onCompile = () => new Promise((r) => setTimeout(r, 80));
  const exec = "00000000-0000-4000-8000-00000000e005";
  const b = new Backend({
    approvedRoots: [join(s.root, "work")], workRoot: join(s.root, "backend5"), ops: defaultBackendOps(new BcLane(bc, ["C1"])),
    allowedHosts: ["127.0.0.1"], docker: new FakeDocker(), requestDeadlineMs: 40,
  });
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl5.jsonl"));
  assertEquals((await b.handle(req("/v1/test", tok, "{}", exec))).status, 503);
  assertEquals(bc.syncs, []);
});

Deno.test("backend: the snapshot is taken with the sandbox paused; a failed pause is 503 and copies nothing", async () => {
  const s = await setup();
  assertEquals((await s.backend.handle(req("/v1/compile", s.tokenA, '{"apps":["Core"]}'))).status, 200);
  assertEquals(s.docker.paused, [`cg-harness-test-e001`]);
  s.docker.pause = () => Promise.resolve(1);
  assertEquals((await s.backend.handle(req("/v1/compile", s.tokenA, '{"apps":["Core"]}'))).status, 503);
  assertEquals(s.seen.length, 1);
});

Deno.test("backend: compile runs on a snapshot, logs monotonic spans, cleans up", async () => {
  const s = await setup();
  const r = await s.backend.handle(req("/v1/compile", s.tokenA, '{"apps":["Core"]}'));
  const body = await r.json();
  assertEquals([r.status, body.request, body.ok], [200, "br_1", true]);
  assert(!s.seen[0]!.startsWith(s.wsA));
  assert(!await exists(s.seen[0]!));
  const [line] = await readHostLog(s.hostLog);
  assertEquals([line!.request, line!.op, line!.outcome, line!.per_app_compiles], ["br_1", "compile", "ok", 1]);
  for (const k of ["snapshot_ms", "compile_ms", "total_ms"]) assert(line!.spans[k]! >= 0, k);
});

Deno.test("backend: a changed app id is refused before any BC call", async () => {
  const s = await setup();
  await write(s.wsA, "Core/app.json", appJson("11111111-2222-4333-8444-555555555555", "CGR Core", [70000, 70099], []));
  const r = await s.backend.handle(req("/v1/compile", s.tokenA, '{"apps":["Core"]}'));
  const body = await r.json();
  assertEquals([r.status, body.ok], [200, false]);
  assertStringIncludes(body.violations.join("\n"), "Core: id changed");
  assertEquals(s.seen, []);
});

Deno.test("backend: links in the workspace are not followed", async () => {
  const s = await setup();
  const target = await tmp();
  await Deno.writeTextFile(join(target, "secret.txt"), "host");
  await Deno.symlink(target, join(s.wsA, "Core", "hostlink"), { type: Deno.build.os === "windows" ? "junction" : "dir" });
  const body = await (await s.backend.handle(req("/v1/compile", s.tokenA, '{"apps":["Core"]}'))).json();
  assertEquals(body.ignored_links, ["Core/hostlink"]);
});

Deno.test("backend: an infra fault is a 503 tool error and marks the host log", async () => {
  const s = await setup();
  s.failWith.err = new ContainerError("SOAP timeout", "Cronus281", "test");
  const r = await s.backend.handle(req("/v1/compile", s.tokenA, '{"apps":["Core"]}'));
  assertEquals(r.status, 503);
  assertStringIncludes((await r.json()).infra, "SOAP timeout");
  assertEquals((await readHostLog(s.hostLog))[0]!.outcome, "infra");
});

Deno.test("backend: symbols lists the locked packages", async () => {
  const s = await setup();
  const body = await (await s.backend.handle(req("/v1/symbols", s.tokenA, ""))).json();
  assertEquals(body.packages, [{ name: "Library Assert", publisher: "Microsoft", version: "28.0.0.0" }]);
});

Deno.test("backend: grant refuses roots outside the approved roots, link roots and non-canonical spellings", async () => {
  const s = await setup();
  const outside = await tmp();
  const g = (workspace: string): BackendGrant => ({
    executionId: EXEC_A, sandbox: null, workspace, pristine: workspace, trusted: [], symbols: [], lock: { store: s.root, packages: [] },
    deploy: { ledgerRoot: s.root, owned: new Set() }, hostLog: s.hostLog,
  });
  await assertRejects(() => s.backend.grant(g(outside), 1000), ValidationError, "approved roots");
  const link = join(s.root, "work", "link");
  await Deno.symlink(outside, link, { type: Deno.build.os === "windows" ? "junction" : "dir" });
  await assertRejects(() => s.backend.grant(g(link), 1000), ValidationError);
  if (Deno.build.os === "windows") await assertRejects(() => s.backend.grant(g(s.wsA.toUpperCase()), 1000), ValidationError);
});

Deno.test("backend: serve refuses wildcard and non-allowed addresses", async () => {
  const s = await setup();
  for (const h of ["0.0.0.0", "::", "", "192.168.1.10"]) assertThrows(() => s.backend.serve(h, 0), ConfigurationError);
});

Deno.test("defaultBackendOps: a fixture-band codeunit is refused before any BC call; visible tests run", async () => {
  const s = await setup();
  const bc = new FakeBc((cu) => cu === 80010 ? result({ A: true }) : result({ X: true }));
  const b = new Backend({ approvedRoots: [join(s.root, "work")], workRoot: join(s.root, "backend2"), ops: defaultBackendOps(new BcLane(bc, ["C1"])), allowedHosts: ["127.0.0.1"], docker: new FakeDocker() });
  const exec = "00000000-0000-4000-8000-00000000e003";
  const tok = await grantFor(b, s.root, exec, join(s.root, "hl3.jsonl"));
  const ws3 = join(s.root, "work", exec, "workspace");
  await write(ws3, "Test/src/Fixture.al", `codeunit 84950 "F"\n{\n    Subtype = Test;\n}\n`);
  const refused = await (await b.handle(req("/v1/test", tok, "{}", exec))).json();
  assertEquals(refused.ok, false);
  assertStringIncludes(refused.violations.join("\n"), "harness fixture band");
  assertEquals(bc.tests, []);
  await Deno.remove(join(ws3, "Test/src/Fixture.al"));
  const ran = await (await b.handle(req("/v1/test", tok, "{}", exec))).json();
  assertEquals(ran.tests.map((t: { codeunit: number }) => t.codeunit), [80010]);
  assertEquals(bc.tests.map((t) => t.codeunit), [80010]);
});

Deno.test("timingSafeEqual and resolveBackendHost", async () => {
  const a = new Uint8Array([1, 2, 3]);
  assertEquals([timingSafeEqual(a, new Uint8Array([1, 2, 3])), timingSafeEqual(a, new Uint8Array([1, 2, 4])), timingSafeEqual(a, new Uint8Array([1, 2]))], [true, false, false]);
  const mock = createCommandMock();
  mock.mockCommandOnce({ command: "docker", argsContain: ["network", "inspect", "nat"] }, { code: 0, stdout: "172.23.64.1\n", stderr: "" });
  mock.mockCommandOnce({ command: "docker", argsContain: ["network", "inspect", "nat"] }, { code: 1, stdout: "", stderr: "Error: No such network: nat" });
  mock.install();
  try {
    assertEquals(await resolveBackendHost(), "172.23.64.1");
    await assertRejects(() => resolveBackendHost(), ConfigurationError, "nat");
  } finally {
    mock.restore();
  }
});

Deno.test({
  name: "cg-al.ps1: round trip with the token from a file; Stopwatch script time reported",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const s = await setup();
    const server = s.backend.serve("127.0.0.1", 0);
    const secrets = await tmp();
    try {
      const run = async (token: string, ...args: string[]) => {
        await Deno.writeTextFile(join(secrets, "backend-token"), token);
        const out = await new Deno.Command("powershell", {
          args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "harness/images/base/cg-al.ps1", ...args],
          env: { CG_BACKEND_URL: server.url, CG_EXECUTION_ID: EXEC_A, CG_SECRETS_DIR: secrets },
          stdout: "piped", stderr: "piped",
        }).output();
        return { code: out.code, json: JSON.parse(new TextDecoder().decode(out.stdout).trim() || "{}") };
      };
      const ok = await run(s.tokenA, "compile", "Core");
      assertEquals([ok.code, ok.json.result.request], [0, "br_1"]);
      assert(ok.json.client.script_ms >= 0);
      assertEquals((await run("wrong-token-0123456789", "compile", "Core")).code, 3);
      assertEquals((await run(s.tokenA, "bogus")).code, 64);
    } finally {
      await server.shutdown();
    }
  },
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/backend.test.ts`
Expected: FAIL, `Module not found ".../src/harness/backend.ts"`.

- [ ] **Step 3: Implement**

`src/harness/backend.ts`:

```typescript
/**
 * cg-al backend (spec 1a section 5 item 4; M0-05 carryover): per-execution
 * token kept as a SHA-256 digest (constant-time compare); opaque execution
 * id mapped to one canonical approved workspace; live-safe snapshot copy;
 * snapshot validated against trusted app identities before any BC call;
 * streamed body with a hard limit; one request at a time per execution;
 * revocation drains the in-flight request; allowed bind addresses only.
 */

import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { join, SEPARATOR } from "@std/path";
import { z } from "zod";
import type { SymbolPackage } from "./identity.ts";
import {
  HARNESS_FIXTURE_TEST_RANGE,
  HARNESS_FORBIDDEN_IDS,
  HARNESS_TEST_APP_RANGE,
} from "../constants.ts";
import { dockerContextEnv } from "../container/docker-context.ts";
import { ConfigurationError, ContainerError, ValidationError } from "../errors.ts";
import { isInfraError } from "../health/is-infra-error.ts";
import { InfraRetriesExhaustedError } from "../parallel/errors.ts";
import {
  type BcLane,
  buildApps,
  type DeployContext,
  deployAndTest,
  type LockedSymbols,
  prepareApps,
} from "./bc-lane.ts";
import { exists, safeCopyTree, validatedDir } from "./fsutil.ts";
import { bounded, type DockerCli, OP_TIMEOUT_MS } from "./sandbox.ts";
import { hashTree, isTaskBuildArtifact } from "./hash.ts";
import { readAppGraph, readAppJson, type StagedApp } from "./staging.ts";
import { TEST_APP, testCodeunits, validateApps } from "./verdict-workspace.ts";

export const BACKEND_VERSION = "cg-al-backend@1";
export const MAX_BODY_BYTES = 64 * 1024;

export interface BackendGrant {
  executionId: string;
  /** Sandbox container paused for each snapshot; null only in unit tests without a sandbox. */
  sandbox: string | null;
  /** Called when the sandbox cannot be unpaused: the runner stops the execution. */
  onFault?(reason: string): void;
  workspace: string;
  pristine: string;
  /** The staged workspace's app identities: the only apps the backend builds. */
  trusted: StagedApp[];
  symbols: SymbolPackage[];
  lock: LockedSymbols;
  deploy: DeployContext;
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
  /** Aborted when the grant is revoked past its grace. */
  signal: AbortSignal;
}

export interface OpResult {
  body: Record<string, unknown>;
  log: Partial<HostLogLine> & { outcome: "ok" | "failed" };
}

export interface BackendOps {
  compile(ctx: OpContext, apps: string[]): Promise<OpResult>;
  test(ctx: OpContext, codeunits: number[]): Promise<OpResult>;
}

const agentCodeunit = (n: number) =>
  n >= HARNESS_TEST_APP_RANGE.start && n <= HARNESS_TEST_APP_RANGE.end &&
  !(n >= HARNESS_FIXTURE_TEST_RANGE.start && n <= HARNESS_FIXTURE_TEST_RANGE.end) &&
  !(HARNESS_FORBIDDEN_IDS as readonly number[]).includes(n);

const CompileBody = z.strictObject({ apps: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9 ]{0,63}$/)).max(32).default([]) });
const TestBody = z.strictObject({
  codeunits: z.array(z.number().int().refine(agentCodeunit, "not a visible test codeunit")).max(64).default([]),
});
const SymbolsBody = z.strictObject({});

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

const NO_DIGEST = new Uint8Array(32);
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Identity and band checks of a snapshot against the trusted apps. */
export async function checkSnapshot(snapshot: string, trusted: StagedApp[], symbolIds: ReadonlySet<string>): Promise<string[]> {
  const v: string[] = [];
  let apps: StagedApp[];
  try {
    apps = await readAppGraph(snapshot);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    return [err.message];
  }
  const known = new Map(trusted.map((t) => [t.folder, t]));
  for (const a of apps) if (!known.has(a.folder)) v.push(`${a.folder}: not an app of this task`);
  for (const t of trusted) {
    const aj = await readAppJson(join(snapshot, t.folder, "app.json")).catch(() => null);
    if (!aj) {
      v.push(`${t.folder}: app.json missing or unreadable`);
      continue;
    }
    if (aj.id.toLowerCase() !== t.id) v.push(`${t.folder}: id changed from ${t.id} to ${aj.id}`);
    if (aj.name !== t.name) v.push(`${t.folder}: name changed from ${t.name} to ${aj.name}`);
    if (aj.publisher !== t.publisher) v.push(`${t.folder}: publisher changed`);
    if (JSON.stringify(aj.idRanges) !== JSON.stringify(t.idRanges)) v.push(`${t.folder}: idRanges changed`);
  }
  v.push(...await validateApps(snapshot, trusted, apps, symbolIds));
  return v;
}

interface GrantState {
  g: BackendGrant;
  digest: Uint8Array;
  expiresAt: number;
  inflight: Promise<unknown> | null;
  seq: number;
  canonical: string;
  /** Set synchronously by revoke; checked synchronously right before admission. */
  closing: boolean;
  abort: AbortController;
}

async function drainedWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p.then(() => true, () => true), new Promise<boolean>((r) => (t = setTimeout(() => r(false), ms)))]);
  } finally {
    clearTimeout(t);
  }
}

/** Read a body stream up to `max` bytes within `ms`; null when longer, "timeout" when it stalls. */
async function readLimited(req: Request, max: number, ms: number): Promise<string | null | "timeout"> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const deadline = Date.now() + ms;
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    let t: ReturnType<typeof setTimeout> | undefined;
    const next = await Promise.race([
      reader.read(),
      new Promise<"timeout">((r) => (t = setTimeout(() => r("timeout"), Math.max(0, deadline - Date.now())))),
    ]).finally(() => clearTimeout(t));
    if (next === "timeout") {
      await reader.cancel().catch(() => {});
      return "timeout";
    }
    if (next.done) break;
    n += next.value.length;
    if (n > max) {
      await reader.cancel();
      return null;
    }
    parts.push(next.value);
  }
  const all = new Uint8Array(n);
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  return new TextDecoder().decode(all);
}

export class Backend {
  private readonly grants = new Map<string, GrantState>();
  private readonly now: () => number;

  constructor(private readonly o: {
    approvedRoots: string[];
    workRoot: string;
    ops: BackendOps;
    /** Container-facing addresses the server may bind (the nat gateway; loopback in tests). */
    allowedHosts: string[];
    /** Pauses the sandbox for each snapshot (quiescence, review round 2 item 1). */
    docker?: DockerCli;
    opTimeoutMs?: number;
    bodyTimeoutMs?: number;
    revokeGraceMs?: number;
    /** End-to-end deadline of one request (compile admission, compiles, publish and tests). */
    requestDeadlineMs?: number;
    now?: () => number;
  }) {
    this.now = o.now ?? (() => Date.now());
  }

  async grant(g: BackendGrant, ttlMs: number): Promise<string> {
    const canonical = await validatedDir(g.workspace);
    const roots = await Promise.all(this.o.approvedRoots.map((r) => validatedDir(r)));
    if (!roots.some((r) => canonical.startsWith(r + SEPARATOR))) {
      throw new ValidationError(`grant refused: ${canonical} is outside the approved roots`, [canonical]);
    }
    const token = encodeHex(crypto.getRandomValues(new Uint8Array(32)));
    this.grants.set(g.executionId, {
      g: { ...g, workspace: canonical }, digest: await sha256(token), expiresAt: this.now() + ttlMs,
      inflight: null, seq: 0, canonical, closing: false, abort: new AbortController(),
    });
    return token;
  }

  /**
   * Stop accepting requests at once, wait for the one in flight up to the
   * grace, then abort it and wait once more. Returns whether it drained.
   */
  async revoke(executionId: string): Promise<boolean> {
    const st = this.grants.get(executionId);
    this.grants.delete(executionId);
    if (!st) return true;
    st.closing = true;
    if (!st.inflight) return true;
    const grace = this.o.revokeGraceMs ?? 30_000;
    if (await drainedWithin(st.inflight, grace)) return true;
    st.abort.abort(new Error("grant revoked"));
    return await drainedWithin(st.inflight, grace);
  }

  private async append(g: BackendGrant, line: HostLogLine) {
    await Deno.mkdir(join(g.hostLog, ".."), { recursive: true });
    await Deno.writeTextFile(g.hostLog, JSON.stringify(line) + "\n", { append: true, create: true });
  }

  private line(st: GrantState, op: string, status: number, outcome: HostLogLine["outcome"], t0: number, extra: Partial<HostLogLine> = {}): HostLogLine {
    return {
      v: 1, request: `br_${st.seq}`, execution: st.g.executionId, op, status, outcome, at: new Date().toISOString(),
      apps_compiled: [], per_app_compiles: 0, diagnostics: 0, tests_run: 0, tests_failed: 0, container: null, retries: 0,
      ...extra, spans: { ...(extra.spans ?? {}), total_ms: performance.now() - t0 },
    };
  }

  private async reject(st: GrantState, op: string, status: number, message: string, t0: number) {
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
    if (!st || presented === "" || !same || this.now() > st.expiresAt) return json(401, { error: "unauthorized" });
    // Admission is synchronous from here: no await between this check and setting inflight.
    if (st.closing || this.grants.get(st.g.executionId) !== st) return json(401, { error: "unauthorized" });
    if (st.inflight) return await this.reject(st, op, 429, "one request at a time per execution", t0);
    let done!: () => void;
    st.inflight = new Promise<void>((r) => (done = r));
    try {
      return await this.serveOp(st, op, req, t0);
    } finally {
      st.inflight = null;
      done();
    }
  }

  private async serveOp(st: GrantState, op: string, req: Request, t0: number): Promise<Response> {
    const text = await readLimited(req, MAX_BODY_BYTES, this.o.bodyTimeoutMs ?? 30_000);
    if (text === "timeout") return await this.reject(st, op, 408, "request body timed out", t0);
    if (text === null) return await this.reject(st, op, 413, "body too large", t0);
    let raw: unknown;
    try {
      raw = text.trim() === "" ? {} : JSON.parse(text);
    } catch {
      return await this.reject(st, op, 400, "malformed JSON", t0);
    }
    const parsed = (op === "compile" ? CompileBody : op === "test" ? TestBody : SymbolsBody).safeParse(raw);
    if (!parsed.success) {
      return await this.reject(st, op, 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), t0);
    }
    const folders = new Set(st.g.trusted.map((a) => a.folder));
    const apps = op === "compile" ? (parsed.data as { apps: string[] }).apps : [];
    const unknown = apps.filter((a) => !folders.has(a));
    if (unknown.length > 0) return await this.reject(st, op, 400, `unknown app(s): ${unknown.join(", ")}`, t0);

    const requestId = `br_${++st.seq}`;
    if (op === "symbols") {
      await this.append(st.g, this.line(st, op, 200, "ok", t0, { request: requestId }));
      return json(200, {
        request: requestId, backend_version: BACKEND_VERSION, ok: true,
        packages: st.g.symbols.map((p) => ({ name: p.name, publisher: p.publisher, version: p.version })),
      });
    }
    const snapshot = join(this.o.workRoot, st.g.executionId, requestId);
    const workDir = `${snapshot}-work`;
    try {
      const ts = performance.now();
      const copy = await this.quiescentCopy(st, snapshot);
      const snapshot_ms = performance.now() - ts;
      const violations = [
        ...copy.ambiguous.map((p) => `case-ambiguous name: ${p}`),
        ...await checkSnapshot(copy.dst, st.g.trusted, new Set(st.g.symbols.map((s) => s.app_id.toLowerCase()))),
      ];
      if (violations.length > 0) {
        await this.append(st.g, this.line(st, op, 200, "failed", t0, { request: requestId, message: violations.join("; "), spans: { snapshot_ms } }));
        return json(200, { request: requestId, backend_version: BACKEND_VERSION, ok: false, violations, ignored_links: copy.refused });
      }
      const signal = AbortSignal.any([st.abort.signal, AbortSignal.timeout(this.o.requestDeadlineMs ?? 30 * 60_000)]);
      const ctx: OpContext = { grant: st.g, snapshot: copy.dst, apps: await readAppGraph(copy.dst), requestId, workDir, signal };
      const r = op === "compile" ? await this.o.ops.compile(ctx, apps) : await this.o.ops.test(ctx, (parsed.data as { codeunits: number[] }).codeunits);
      const line = this.line(st, op, 200, r.log.outcome, t0, { ...r.log, request: requestId, spans: { snapshot_ms, ...(r.log.spans ?? {}) } });
      await this.append(st.g, line);
      return json(200, {
        request: requestId, backend_version: BACKEND_VERSION, ok: r.log.outcome === "ok", ...r.body,
        ignored_links: copy.refused, backend_ms: line.spans.total_ms,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const infra = err instanceof InfraRetriesExhaustedError || isInfraError(err);
      await this.append(st.g, this.line(st, op, infra ? 503 : 500, infra ? "infra" : "error", t0, { request: requestId, message }));
      if (!infra) console.error(`[FAIL] cg-al backend ${requestId}: ${message}`);
      return json(infra ? 503 : 500, infra ? { request: requestId, infra: message } : { request: requestId, error: message });
    } finally {
      await Deno.remove(snapshot, { recursive: true }).catch(() => {});
      await Deno.remove(workDir, { recursive: true }).catch(() => {});
    }
  }

  /** Pause the sandbox, copy, unpause (all bounded). A failed pause is infra: nothing is copied. */
  private async quiescentCopy(st: GrantState, snapshot: string) {
    const d = this.o.docker;
    const name = st.g.sandbox;
    const ms = this.o.opTimeoutMs ?? OP_TIMEOUT_MS;
    if (!d || !name) return await safeCopyTree(st.canonical, snapshot, { skip: isTaskBuildArtifact });
    if (await bounded(d.pause(name), ms, `docker pause ${name}`) !== 0) {
      throw new ContainerError(`docker pause ${name} failed: snapshot refused`, name, "test");
    }
    let copy;
    try {
      copy = await safeCopyTree(st.canonical, snapshot, { skip: isTaskBuildArtifact });
    } finally {
      const code = await bounded(d.unpause(name), ms, `docker unpause ${name}`).catch((e) => String(e));
      if (code !== 0) {
        const reason = `docker unpause ${name} failed (${code}): the sandbox may still be paused`;
        st.g.onFault?.(reason);
        // deno-lint-ignore no-unsafe-finally
        throw new ContainerError(reason, name, "test");
      }
    }
    return copy;
  }

  serve(hostname: string, port: number): { url: string; shutdown(): Promise<void> } {
    if (!this.o.allowedHosts.includes(hostname) || ["0.0.0.0", "::", ""].includes(hostname)) {
      throw new ConfigurationError(
        `cg-al backend refuses to bind "${hostname}": allowed are ${this.o.allowedHosts.join(", ")} (container-facing only)`,
      );
    }
    const server = Deno.serve({ hostname, port, onListen: () => {} }, (r) => this.handle(r));
    const addr = server.addr as Deno.NetAddr;
    return { url: `http://${addr.hostname}:${addr.port}`, shutdown: () => server.shutdown() };
  }
}

function withDependencies(apps: StagedApp[], folders: string[]): StagedApp[] {
  const need = new Set(folders);
  for (const a of [...apps].reverse()) if (need.has(a.folder)) a.depends.forEach((d) => need.add(d));
  return apps.filter((a) => need.has(a.folder));
}

export function defaultBackendOps(lane: BcLane): BackendOps {
  return {
    async compile(ctx, apps) {
      const selected = apps.length === 0 ? ctx.apps : withDependencies(ctx.apps, apps);
      const versions = new Map(ctx.grant.trusted.map((a) => [a.folder, a.version]));
      const t0 = performance.now();
      const built = await lane.compile((c) =>
        buildApps(lane.bc, c, {
          srcDir: ctx.snapshot, apps: selected, versions, outDir: ctx.workDir, lock: ctx.grant.lock, signal: ctx.signal,
        }), ctx.signal);
      const ok = built.every((b) => b.ok);
      return {
        body: { apps: built.map((b) => ({ app: b.folder, ok: b.ok, diagnostics: b.diagnostics })) },
        log: {
          outcome: ok ? "ok" : "failed", apps_compiled: built.filter((b) => b.attempted).map((b) => b.folder),
          per_app_compiles: built.filter((b) => b.attempted).length, diagnostics: built.reduce((n, b) => n + b.diagnostics.length, 0),
          spans: { compile_ms: performance.now() - t0 },
        },
      };
    },
    async test(ctx, codeunits) {
      const changed: string[] = [];
      for (const a of ctx.grant.trusted) {
        const now = join(ctx.snapshot, a.folder);
        if (!await exists(now) || await hashTree(join(ctx.grant.pristine, a.folder), "task") !== await hashTree(now, "task")) changed.push(a.folder);
      }
      const prep = await prepareApps(lane, {
        pristine: ctx.grant.pristine, pristineApps: ctx.grant.trusted, candidateDir: ctx.snapshot, candidateApps: ctx.apps,
        changed, workDir: ctx.workDir, lock: ctx.grant.lock, signal: ctx.signal,
      });
      const compiled = prep.built.filter((b) => b.attempted).map((b) => b.folder);
      if (!prep.buildOk) {
        return {
          body: { apps: prep.built.map((b) => ({ app: b.folder, ok: b.ok, diagnostics: b.diagnostics })) },
          log: { outcome: "failed", apps_compiled: compiled, per_app_compiles: prep.per_app_compiles, spans: { compile_ms: prep.compile_ms } },
        };
      }
      const discovered = (await testCodeunits(join(ctx.snapshot, TEST_APP)));
      const skipped = discovered.filter((t) => t.testPage).map((t) => t.codeunit);
      const byCu = new Map(discovered.map((t) => [t.codeunit, t]));
      const units = codeunits.length > 0
        ? codeunits
        : discovered.filter((t) => !t.testPage && agentCodeunit(t.codeunit)).map((t) => t.codeunit);
      const held = await lane.exclusive({ taskId: ctx.grant.executionId, variantId: "cg-al", attemptNumber: 1 }, (c) =>
        deployAndTest(lane.bc, c, {
          wanted: prep.wanted,
          tests: units.map((u) => ({ codeunit: u, procedures: byCu.get(u)?.procedures ?? null, target: "candidate", zeroIsInfra: false })),
          cleanupIds: [...prep.candidateIds].reverse(), ctx: ctx.grant.deploy,
        }), ctx.signal); // a failed cleanup is quarantined by the lane before release
      const rows = held.result.rows;
      const failed = rows.filter((r) => r.outcome !== "pass").length;
      return {
        body: { tests: rows, messages: held.result.messages, skipped_testpage: skipped },
        log: {
          outcome: rows.length > 0 && failed === 0 ? "ok" : "failed", apps_compiled: compiled, per_app_compiles: prep.per_app_compiles,
          tests_run: rows.length, tests_failed: failed, container: held.container, retries: held.retries.length,
          spans: {
            compile_ms: prep.compile_ms, queue_ms: held.queue_ms, provisioning_ms: held.result.deployed.provisioning_ms,
            publish_ms: held.result.deployed.candidate_publish_ms, test_ms: held.result.test_ms,
          },
        },
      };
    },
  };
}

export async function resolveBackendHost(): Promise<string> {
  const out = await new Deno.Command("docker", {
    args: ["network", "inspect", "nat", "--format", "{{range .IPAM.Config}}{{.Gateway}}{{end}}"],
    env: dockerContextEnv(), stdout: "piped", stderr: "piped",
  }).output();
  const ip = new TextDecoder().decode(out.stdout).trim();
  if (!out.success || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    throw new ConfigurationError(`cannot resolve the Docker nat gateway: ${new TextDecoder().decode(out.stderr).trim()}`);
  }
  return ip;
}

export async function readHostLog(path: string): Promise<HostLogLine[]> {
  try {
    return (await Deno.readTextFile(path)).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as HostLogLine);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
}
```

`harness/images/base/cg-al.ps1`:

```powershell
# cg-al: thin client for the Harness Bench backend (spec 1a section 5 item 4).
# Usage: cg-al compile [App ...] | cg-al test [codeunit ...] | cg-al symbols | cg-al --version
# The token is read from a file (never argv, never env). CG_BACKEND_URL and
# CG_EXECUTION_ID are non-secret env vars set by the runner.
# Exit codes: 0 ok, 1 compile/test failed or refused, 2 backend or infra error, 3 unauthorized, 64 usage.
param(
  [Parameter(Position = 0)][string]$Op,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
$ErrorActionPreference = 'Stop'
$sw = [Diagnostics.Stopwatch]::StartNew()
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
$out = @{ op = $Op; client = @{ script_ms = [int]$sw.ElapsedMilliseconds; status = $status }; result = $result }
Write-Output (ConvertTo-Json -InputObject $out -Compress -Depth 12)
if ($status -eq 200 -and $result.ok) { exit 0 }
if ($status -eq 200) { exit 1 }
if ($status -eq 401) { exit 3 }
exit 2
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/backend.test.ts`
Expected: all 22 tests pass (the client test runs on Windows only; it binds 127.0.0.1, no container).

- [ ] **Step 5: Check, lint, format** (`src/harness/backend.ts`, the test)

- [ ] **Step 6: Commit**

```bash
git add src/harness/backend.ts harness/images/base/cg-al.ps1 tests/unit/harness/backend.test.ts
git commit -m "feat(harness): cg-al backend with trusted-identity checks, streamed limits and draining revocation"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/backend.test.ts` passes on Windows (revoke-during-check, revoke-abort, stalled-body and paused-snapshot tests among them); check, lint and `deno fmt --check` clean. Real sandbox round trip: M1-28.

---

### Task M1-22: execution pipeline: private state, transactional publication, recovery, supervised mode, shared credential budget

Spec 1a section 5 items 1-6 in order (stage; per-execution token scoped to the workspace; `docker run` with exactly the four mounts; capture; stop on timeout, still judged; revoke the token, freeze, destroy, hand the artifact to the verdict), section 4 (image pinned by immutable id; observed-manifest check), section 8 (termination table via Part 1 `outcomePolicy`; retries by ancestry via Part 1 `retryProblem`; every attempt kept with its cost; cleanup checked). Secrets accepted-risk and egress decisions (redaction before anything leaves; supervised only before enforcement; one shared five-run budget, fail closed). Review round 2 items 2, 3, 4, 9 and 10.

Design:
- **Private state outside `results/`.** `env.privateRoot` (default `%LOCALAPPDATA%\centralgauge\harness`) holds everything mutable or secret-bearing: `work/<id>/` (the staged workspace the sandbox mounts, the backend's approved root), `quarantine/<id>/` (captures, host log, trace), `custody/<id>.json` (the exact secret values of this attempt), `pending/<id>/` (the redacted draft), `intents/<id>.json` and the freeze scratch. `results/` receives only redacted, finished files.
- **Secret custody.** Right after `prepareSecrets` and before `docker run`, the attempt's secret values (operator files as read now, plus the backend token) are written to `custody/<id>.json`; recovery redacts with exactly these values, so a rotated or deleted operator file cannot shrink the redaction set. Custody is deleted only after publication completes.
- **Confirmed termination before workspace processing.** After the run, the grant is revoked (draining, M1-19) and the secrets mount is deleted. If the sandbox is not `confirmedGone` or the grant did not drain, the runner keeps the intent, freezes nothing, publishes nothing, and raises a `ContainerError`; the next start's recovery re-checks the container (bounded), and only a confirmed-gone container is finalized.
- **Transactional publication.** Finalization first builds a **draft** in `pending/<id>/` (redacted run files, side file, the execution record and the artifact association, the workspace already frozen content-addressed) and saves `draft.json` atomically. Publication then runs idempotent steps, each skipped when already done: `run` (copy the staged run directory to `runs/.tmp-*`, rename to `runs/<id>`), `execution`, `artifact`, `judgment` (only when the policy judges and no judgment with the current scorer fingerprint exists), then cleanup of the private state. A crash after any step resumes at the next one; tests crash after each step.
- **Durable inputs.** The intent stores the pricing book loaded at run start, the task's visible and oracle hashes, the refapp commit, the sandbox name and the workspace path. Recovery prices with that book, and judges only when the current task files still have the stored hashes (otherwise the execution is recorded and marked for `rejudge`).
- **Unknown, not zero.** Exact zero cost is recorded only when the sandbox never started (`started` false). Any failure after the spawn yields the adapter's parse of whatever was captured, so a missing `result` record is `cost_usd: null` with `cost_usd` incomplete.
- **Retries by ancestry.** `runCell` asks Part 1's `retryProblem(parent, candidate, grandparent)` over the cell's prior and new executions; supervised mode withholds every automatic retry. `usage_reset_at` is persisted in the side file.
- **Credential gate and shared budget (item 9).** A credential-bearing arm runs only when (a) `env.egressEnforced` is true, which M1-24 sets only after the verified enforcement state checks out (M1-33), or (b) `env.supervised` and a reservation in the **shared cross-lane ledger** (`env.credentialLedger`, one file for M1 and M4, see the integrated schedule) succeeds before any container or credential is touched. Five reservations across all lanes, then every further supervised run is refused. No ledger configured means refused.
- **Budget (item 10).** An adapter must declare `enforcesBudget` (its entrypoint passes the manifest's effective `max_budget_usd`); otherwise the arm is refused.
- **Validity and record version (round 3 B1).** Unverifiable requested components set `validity.incomplete_observed: ["loaded_components"]`. Part 1 froze the execution shape ("no change without a schema version bump"), so this is a **versioned** change, coordinated with the Part 1 maintainer: execution records carry `v: 2` when written by Part 2 and must then include `incomplete_observed`; `v: 1` records must not carry it and read as `[]`; `validateCampaignRecords` refuses a campaign whose executions mix versions (a campaign has one producer version); the Part 1 fixtures gain a `v: 2` default with a `v: 1` variant for the compatibility tests; the report (M1-09) lists executions with unverified components in its coverage section. Old strict readers do not exist outside this repository, so no dual-writing is needed.
- **Recovery isolation (round 3 B3).** The intent records the command's **results root**, the **effective manifest** and the task's immutable metadata, and a private **snapshot of the task directory** (`privateRoot/taskcopy/<id>/`) taken at run start, so recovery publishes into the original store and never re-derives the attempt from current files; it judges only when the current task files still have the recorded hashes (otherwise the execution is recorded and left for `rejudge`), and a deleted task never blocks recovery.
- **Custody phases (round 3 B3).** The intent moves through `prepared` (before any secret is read), `released` (custody written, right before `docker run`) and `published` (every record written); custody is read strictly: in `released` a missing or unreadable custody file stops recovery (fail closed, intent kept); only `prepared` proves nothing was released. Cleanup runs after `published` is saved and deletes the intent last, so a crash inside cleanup only repeats the cleanup.
- **Backend faults (round 3 B2).** The grant's `onFault` (a failed unpause) aborts the execution's stop signal; the attempt ends `harness_crash` with side-file reason `backend_fault` and `infra_exposed: true`.

**Lane:** infra (stream A). **Deps:** M1-05 (`resolveManifest`, `forTask`, `manifestHash`), M1-07 (records, `outcomePolicy`, `retryProblem`), M1-07b, M1-09 (report coverage), M1-12, M1-13, M1-17, M1-19, M1-20, M1-21, M1-32. **Date:** 10-03; the shared credential budget (`credential-budget.ts`, its test and `scripts/harness/reserve-credential-run.ts`) is this task's **first commit, due 10-02**, before M4-17's 10-03 pilot (round 3 B7).

**Files:**
- Create (first commit, 10-02): `src/harness/credential-budget.ts`, `scripts/harness/reserve-credential-run.ts`, `tests/unit/harness/credential-budget.test.ts`
- Create: `src/harness/images.ts`, `src/harness/execution.ts`
- Modify: `src/harness/records.ts` (execution `v: 2` with `incomplete_observed`), `src/harness/integrity.ts` (one version per campaign), `src/harness/report.ts` (coverage line), `tests/unit/harness/fixtures.ts` (`v: 2` default, `v: 1` variant), `tests/unit/harness/records.test.ts`, `tests/unit/harness/integrity.test.ts`, `tests/unit/harness/report.test.ts` (append)
- Create: `tests/unit/harness/runtime-fixture.ts` (a full `HarnessEnv` over fakes; reused by M1-24, M1-23, M1-35)
- Test: `tests/unit/harness/images.test.ts`, `tests/unit/harness/credential-budget.test.ts`, `tests/unit/harness/execution.test.ts`

**Interfaces:**
- Produces (records.ts, versioned): `ExecutionRecord.v: 1 | 2`; `validity.incomplete_observed?: ("harness_version" | "models" | "loaded_components")[]` (required in `v: 2`, absent in `v: 1`); `incompleteObserved(e): string[]` (`[]` for `v: 1`).
- Produces (images.ts): `BASE_IMAGE = "centralgauge/harness-base:1"`; `imageTag(harness, version)`; `IMAGE_LABELS`; `interface ImageFacts { digest; base_digest; harness; version }`; `imageFacts(docker, ref)`; `hasBaseLayers(docker, imageRef, baseRef): Promise<boolean>`; `runtimeFacts(config, image, adapter, catalog): RuntimeFacts`.
- Produces (credential-budget.ts): `CREDENTIAL_RUN_LIMIT = 5`; `interface Reservation { lane; task; config; purpose }`; `reserveCredentialRun(ledgerPath: string | null, r, limit?): Promise<number>` (the reservation's ordinal).
- Produces (execution.ts): `interface HarnessEnv { repoRoot; harnessRoot; resultsRoot; privateRoot; store; lane; backend; backendUrl; docker; owner; symbols; symbolStore; secretsSource; deploy: DeployContext; pricing(at): Promise<PricingBook>; supervised; egressEnforced; credentialLedger: string | null; lane_id: string; stop?: AbortSignal; now?; timeoutMsFor?; killGraceMs?; opTimeoutMs?; maxCaptureBytes?; hooks?: { after?(step: PublishStep): Promise<void> } }`; `type PublishStep = "draft" | "run" | "execution" | "artifact" | "judgment"`; `privatePaths(env, id)`; `interface CellRef`; `interface AttemptRef`; `imageAttachments(attachments, support)`; `writeConfigDir(harnessRoot, dir, m)`; `runExecution(env, cell, at)`; `judgeExecution(env, cell, e, pristine, oracleHash?)`; `rejudgeExecution(env, cell, e, oracleHash)`; `interface CellResult { executions; pause: string | null; withheld: string | null; stopped: string | null }`; `runCell(env, cell, first?, prior?: ExecutionRecord[])`; `recoverInterrupted(env, loadTask): Promise<ExecutionRecord[]>`.
- Produces (runtime-fixture.ts): `SECRET_OAUTH`, `INIT`, `BOOK`, `PROBE_COST`, `verdictBc()`, `probeLines()`, `ccBehavior(taskDir, solution, lines?)`, `interface TestEnv { env; repo; docker: FakeDocker; bc: FakeBc; harnessRoot }`, `makeEnv(opts?)`, `cellFor(t, configId?, taskId?)`.

- [ ] **Step 1: Write the fixture and the failing tests**

Append to `tests/unit/harness/records.test.ts`:

```typescript
Deno.test("execution v2: incomplete_observed required in v2, forbidden in v1; both round-trip", async () => {
  const c = await campaign();
  const e2 = execution(c); // fixtures now default to v: 2 with incomplete_observed: []
  assertEquals(ExecutionRecordSchema.parse(e2).v, 2);
  const e1 = execution(c, {}, { v: 1, validity: { incomplete_telemetry: [], infra_exposed: false } });
  assertEquals(incompleteObserved(ExecutionRecordSchema.parse(e1)), []);
  assertThrows(() => ExecutionRecordSchema.parse({ ...e2, validity: { incomplete_telemetry: [], infra_exposed: false } }));
  assertThrows(() => ExecutionRecordSchema.parse({ ...e1, validity: { ...e1.validity, incomplete_observed: [] } }));
  assertThrows(() => ExecutionRecordSchema.parse({ ...e2, validity: { ...e2.validity, incomplete_observed: ["cost_usd"] } }));
  const store = new RecordStore(await Deno.makeTempDir());
  await store.writeExecution(e2);
  assertEquals((await store.executions(c.id))[0], ExecutionRecordSchema.parse(e2));
});
```

Append to `tests/unit/harness/integrity.test.ts`: `a campaign mixing execution record versions is refused` (one `v: 1` and one `v: 2` execution; `validateCampaignRecords` names both ids). Append to `tests/unit/harness/report.test.ts`: `coverage lists executions with unverified components` (a `v: 2` execution with `["loaded_components"]` appears in the coverage section by id).

`records.ts` change: `v: z.union([z.literal(1), z.literal(2)])`; `ValiditySchema` gains `incomplete_observed: z.array(z.enum(["harness_version", "models", "loaded_components"])).optional()` with the duplicate refinement; the execution `superRefine` requires the field when `v === 2` and refuses it when `v === 1`; `export const incompleteObserved = (e: ExecutionRecord) => e.validity.incomplete_observed ?? [];`. `integrity.ts`: one execution `v` per campaign. `report.ts`: coverage section line `unverified components: <ids>` when any.

`tests/unit/harness/credential-budget.test.ts`:

```typescript
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import { reserveCredentialRun } from "../../../src/harness/credential-budget.ts";

const r = { lane: "lane-ops", task: "HX-001", config: "cc-sonnet-plain", purpose: "M1-29 gate" };

Deno.test("reserveCredentialRun: five across all lanes, then refused; concurrent callers serialize", async () => {
  const ledger = join(await Deno.realPath(await Deno.makeTempDir()), "credential-runs.jsonl");
  const results = await Promise.allSettled(Array.from({ length: 7 }, (_, i) => reserveCredentialRun(ledger, { ...r, lane: i % 2 ? "lane-ops" : "M4-17" })));
  assertEquals(results.filter((x) => x.status === "fulfilled").map((x) => (x as PromiseFulfilledResult<number>).value).sort(), [1, 2, 3, 4, 5]);
  assertEquals((await Deno.readTextFile(ledger)).trim().split("\n").length, 5);
  await assertRejects(() => reserveCredentialRun(ledger, r), ConfigurationError, "5 supervised");
});

Deno.test("reserveCredentialRun: no shared ledger configured is refused (fail closed)", async () => {
  await assertRejects(() => reserveCredentialRun(null, r), ConfigurationError, "ledger");
});

Deno.test("reserveCredentialRun: an unreadable ledger refuses; partial lines still count", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const asDir = join(dir, "ledger-is-a-directory");
  await Deno.mkdir(asDir);
  await assertRejects(() => reserveCredentialRun(asDir, r), ConfigurationError, "cannot read");
  const partial = join(dir, "partial.jsonl");
  await Deno.writeTextFile(partial, '{"v":1}\n{"trunc\nx\nx\nx\n');
  await assertRejects(() => reserveCredentialRun(partial, r), ConfigurationError, "5 supervised");
});
```

`scripts/harness/reserve-credential-run.ts` (first commit; M4-17's pilot runner calls it before releasing a key):

```typescript
// Usage: deno run --allow-all scripts/harness/reserve-credential-run.ts --lane <lane> --task <HX-00N> --config <model-or-arm> --purpose <text>
// Uses CG_CREDENTIAL_LEDGER, the one ledger for every lane. Exit 0 with the ordinal, exit 1 when refused.
import { parseArgs } from "@std/cli/parse-args";
import { reserveCredentialRun } from "../../src/harness/credential-budget.ts";

const a = parseArgs(Deno.args, { string: ["lane", "task", "config", "purpose"] });
try {
  const n = await reserveCredentialRun(Deno.env.get("CG_CREDENTIAL_LEDGER") ?? null, {
    lane: a.lane ?? "", task: a.task ?? "", config: a.config ?? "", purpose: a.purpose ?? "",
  });
  console.log(`[OK] credential run ${n} of 5 reserved`);
} catch (err) {
  console.error(`[FAIL] ${err instanceof Error ? err.message : err}`);
  Deno.exit(1);
}
```

`tests/unit/harness/images.test.ts`:

```typescript
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { ConfigurationError } from "../../../src/errors.ts";
import { claudeCodeAdapter } from "../../../src/harness/adapters/claude-code.ts";
import { HarnessConfigSchema } from "../../../src/harness/config.ts";
import { hasBaseLayers, imageFacts, imageTag, runtimeFacts } from "../../../src/harness/images.ts";
import { FakeDocker } from "./fake-docker.ts";

const ID = `sha256:${"a".repeat(64)}`;
const BASE = `sha256:${"b".repeat(64)}`;
const LABELS = { "centralgauge.harness": "claude-code", "centralgauge.harness.version": "2.1.282", "centralgauge.harness.base_digest": BASE };
const catalog = { models: [{ slug: "anthropic/claude-sonnet-5", api_model_id: "claude-sonnet-5", family: "claude", display_name: "S5" }], pricing: [], families: [] };

Deno.test("imageFacts: immutable id and labelled base digest; wrong labels refused", async () => {
  const d = new FakeDocker();
  await assertRejects(() => imageFacts(d, imageTag("claude-code", "2.1.282")), ConfigurationError, "images build");
  d.addImage("centralgauge/harness-claude-code:2.1.282", ID, LABELS);
  assertEquals((await imageFacts(d, "centralgauge/harness-claude-code:2.1.282")).digest, ID);
  d.addImage("centralgauge/harness-claude-code:9", `sha256:${"9".repeat(64)}`, { "centralgauge.harness": "claude-code" });
  await assertRejects(() => imageFacts(d, "centralgauge/harness-claude-code:9"), ConfigurationError, "label");
});

Deno.test("hasBaseLayers: the built image's layers start with the base's layers", async () => {
  const d = new FakeDocker();
  d.addImage("centralgauge/harness-base:1", BASE, {}, ["l1", "l2"]);
  d.addImage("good", ID, LABELS, ["l1", "l2", "l3"]);
  d.addImage("bad", `sha256:${"c".repeat(64)}`, LABELS, ["x1", "l2", "l3"]);
  assert(await hasBaseLayers(d, "good", "centralgauge/harness-base:1"));
  assert(!await hasBaseLayers(d, "bad", "centralgauge/harness-base:1"));
});

Deno.test("runtimeFacts: native settings from the catalog; MCP and LSP refused until M2", () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc", harness: "claude-code", harness_version: "2.1.282", models: { main: "anthropic/claude-sonnet-5" },
    settings: {}, limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const image = { digest: ID, base_digest: BASE, harness: "claude-code", version: "2.1.282" };
  const f = runtimeFacts(cfg, image, claudeCodeAdapter, catalog);
  assertEquals([f.image.digest, f.backend_version, f.provider_routes.main], [ID, "cg-al-backend@1", "anthropic:first-party-oauth"]);
  assertThrows(() => runtimeFacts({ ...cfg, components: { ...cfg.components, mcp: ["al-tools"] } }, image, claudeCodeAdapter, catalog), ConfigurationError, "M2");
  assertThrows(() => runtimeFacts(cfg, { ...image, version: "2.1.281" }, claudeCodeAdapter, catalog), ConfigurationError, "2.1.281");
});
```

`tests/unit/harness/runtime-fixture.ts`:

```typescript
/** A complete HarnessEnv over FakeBc + FakeDocker + a temp refapp repo, with the real Claude Code adapter. */

import { join } from "@std/path";
import type { PricingBook } from "../../../src/harness/pricing.ts";
import { claudeCodeAdapter } from "../../../src/harness/adapters/claude-code.ts";
import { Backend, defaultBackendOps } from "../../../src/harness/backend.ts";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import { loadConfig } from "../../../src/harness/config.ts";
import type { CellRef, HarnessEnv } from "../../../src/harness/execution.ts";
import { resolveRefapp, taskSetIdentity } from "../../../src/harness/identity.ts";
import { imageFacts, imageTag, runtimeFacts } from "../../../src/harness/images.ts";
import { manifestHash, resolveManifest } from "../../../src/harness/manifest.ts";
import { RecordStore } from "../../../src/harness/records.ts";
import { applyOverlay } from "../../../src/harness/staging.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { deployedSource, FakeBc, result } from "./fake-bc.ts";
import { FakeDocker, type RunBehavior } from "./fake-docker.ts";
import { makeRefappRepo, type RefappRepo, write } from "./refapp-fixture.ts";

export const SECRET_OAUTH = "sk-ant-oat01-fixture-0123456789abcdefXYZ";
const PROBE = "tests/fixtures/harness/claude-code/probe.jsonl";
export const INIT = JSON.stringify({ type: "system", subtype: "init", claude_code_version: "2.1.282", skills: [], mcp_servers: [] });
export const BOOK: PricingBook = {
  at: "2026-10-05T00:00:00.000Z",
  models: {
    "claude-sonnet-5": { slug: "anthropic/claude-sonnet-5", pricing_version: "2026-09-25", input: 2, output: 10, cache_read: 0.2, cache_write_5m: 2.5, cache_write_1h: 4, cache_write_1h_derived: true },
  },
};
export const PROBE_COST = (10 * 2 + 120646 * 0.2 + 22276 * 2.5 + 6792 * 4 + 2181 * 10) / 1e6;
export const IMAGE_ID = `sha256:${"c".repeat(64)}`;
const catalog = { models: [{ slug: "anthropic/claude-sonnet-5", api_model_id: "claude-sonnet-5", family: "claude", display_name: "S5" }], pricing: [], families: [] };

export function verdictBc(): FakeBc {
  return new FakeBc((cu, deployed) => {
    const rental = deployedSource(deployed, "CGR Rental");
    if (cu === 80010) return result({ ShippedPasses: true });
    if (cu === 85000) return result({ FixWorks: rental.includes("exit(10)") ? true : "Assert.AreEqual failed. Expected:<10>" });
    return result({});
  });
}

/** The probe log after a fixture init line (the probe's own init lists skills and MCP servers this arm does not request). */
export async function probeLines(): Promise<string[]> {
  return (await Deno.readTextFile(PROBE)).split(/\r?\n/).filter(Boolean).slice(1);
}

export function ccBehavior(taskDir: string, solution: "correct" | "naive/a" | null, lines?: string[]): RunBehavior {
  return async (call, io) => {
    if (solution) await applyOverlay(join(taskDir, solution), call.mounts.get("C:\\workspace")!.src);
    for (const l of [INIT, ...(lines ?? await probeLines())]) await io.stdout(l);
    return 0;
  };
}

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
  await write(harnessRoot, "configs/cc-sonnet-plain.yml", `id: cc-sonnet-plain
harness: claude-code
harness_version: "2.1.282"
models: { main: anthropic/claude-sonnet-5 }
settings: {}
components: { instructions: bundles/env/instructions }
limits: { timeout_min: 30, max_budget_usd: 5 }
`);
  await write(harnessRoot, "bundles/env/instructions/CLAUDE.md", "Environment facts.\n");
  const docker = new FakeDocker();
  docker.addImage(imageTag("claude-code", "2.1.282"), IMAGE_ID, {
    "centralgauge.harness": "claude-code", "centralgauge.harness.version": "2.1.282",
    "centralgauge.harness.base_digest": `sha256:${"b".repeat(64)}`,
  });
  docker.behavior = ccBehavior(join(repo.tasksDir, "HX-001"), "correct");
  const bc = opts.bc ?? verdictBc();
  const lane = new BcLane(bc, ["C1"]);
  const resultsRoot = join(repo.root, "results", "harness");
  await Deno.mkdir(resultsRoot, { recursive: true });
  const privateRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "cg-private-" }));
  await Deno.mkdir(join(privateRoot, "work"), { recursive: true });
  const secretsSource = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(join(secretsSource, "claude-oauth-token"), SECRET_OAUTH);
  const env: HarnessEnv = {
    repoRoot: repo.root,
    harnessRoot,
    resultsRoot,
    privateRoot,
    store: new RecordStore(resultsRoot),
    lane,
    backend: new Backend({
      approvedRoots: [join(privateRoot, "work")], workRoot: join(privateRoot, "backend"), ops: defaultBackendOps(lane),
      allowedHosts: ["127.0.0.1"], docker, opTimeoutMs: 100, revokeGraceMs: 100,
    }),
    backendUrl: "http://127.0.0.1:9",
    docker,
    owner: "HOST1",
    symbols: repo.symbols,
    symbolStore: repo.symbolStore,
    secretsSource,
    deploy: { ledgerRoot: join(privateRoot, "bc-ledger"), owned: new Set<string>() },
    pricing: () => Promise.resolve(BOOK),
    supervised: true,
    egressEnforced: false,
    credentialLedger: join(privateRoot, "credential-runs.jsonl"),
    lane_id: "lane-test",
    killGraceMs: 50,
    opTimeoutMs: 100,
  };
  return { env, repo, docker, bc, harnessRoot };
}

export async function cellFor(t: TestEnv, configId = "cc-sonnet-plain", taskId = "HX-001"): Promise<CellRef> {
  const config = await loadConfig(t.harnessRoot, configId);
  const facts = runtimeFacts(config, await imageFacts(t.docker, imageTag("claude-code", "2.1.282")), claudeCodeAdapter, catalog);
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
import { assert, assertAlmostEquals, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { walk } from "@std/fs";
import { join } from "@std/path";
import { ConfigurationError, ContainerError } from "../../../src/errors.ts";
import { adapterFor } from "../../../src/harness/adapters/mod.ts";
import { privatePaths, type PublishStep, recoverInterrupted, runCell } from "../../../src/harness/execution.ts";
import { ExecutionRecordSchema, RecordStore } from "../../../src/harness/records.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { ccBehavior, cellFor, IMAGE_ID, INIT, makeEnv, PROBE_COST, probeLines, SECRET_OAUTH } from "./runtime-fixture.ts";
import { write } from "./refapp-fixture.ts";

const U16 = (s: string) => String.fromCharCode(...new Uint8Array(new Uint16Array([...s].map((c) => c.charCodeAt(0))).buffer));

async function tokenOf(call: { mounts: Map<string, { src: string }> }) {
  return (await Deno.readTextFile(join(call.mounts.get("C:\\cg-secrets")!.src, "backend-token"))).trim();
}

/** Every file under a root, as latin1 text (byte-faithful), for secret scans. */
async function allBytes(root: string): Promise<string> {
  let out = "";
  for await (const e of walk(root, { includeDirs: false })) {
    out += new TextDecoder("latin1").decode(await Deno.readFile(e.path).catch(() => new Uint8Array()));
  }
  return out;
}
const leaks = (text: string, secret: string) => text.includes(secret) || text.includes(U16(secret));
const exists = (p: string) => Deno.stat(p).then(() => true, () => false);

Deno.test("runCell: Claude Code solves HX-001; TTL-priced cost; no secret in argv; private state cleaned up", async () => {
  const t = await makeEnv();
  let token = "";
  let workspaceMount = "";
  const inner = t.docker.behavior;
  t.docker.behavior = async (call, io) => {
    token = await tokenOf(call);
    workspaceMount = call.mounts.get("C:\\workspace")!.src;
    return await inner(call, io);
  };
  const r = await runCell(t.env, await cellFor(t));
  assertEquals([r.pause, r.withheld, r.executions.length], [null, null, 1]);
  const e = ExecutionRecordSchema.parse(r.executions[0]);
  assertEquals([e.termination, e.did_work, e.run_kind, e.attempt], ["completed", true, "planned", 1]);
  assertAlmostEquals(e.telemetry.cost_usd!, PROBE_COST, 1e-12);
  assertEquals(e.validity, { incomplete_telemetry: [], incomplete_observed: ["loaded_components"], infra_exposed: false });
  assert(workspaceMount.startsWith(t.env.privateRoot), "the mutable workspace is private, never under results/");
  const args = t.docker.runs[0]!.args.join(" ");
  assert(token.length === 64 && !args.includes(token) && !args.includes(SECRET_OAUTH));
  assertEquals([t.docker.runs[0]!.image, t.docker.runs[0]!.isolation], [IMAGE_ID, "hyperv"]);
  const res = await t.env.backend.handle(new Request("http://b/v1/symbols", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "x-cg-execution": e.id }, body: "{}",
  }));
  assertEquals(res.status, 401, "token revoked before freeze");
  assertEquals((await t.env.store.judgments(e.id))[0]!.verdict, "pass");
  assertEquals((await t.env.store.artifact(e.id))!.workspace_hash, e.workspace_hash);
  assert((await Deno.readTextFile(join(t.env.resultsRoot, e.trace_path!))).includes("tool_call"));
  const p = privatePaths(t.env, e.id);
  for (const d of [p.work, p.quarantine, p.custody, p.pending, p.intent]) assert(!await exists(d), d);
});

Deno.test("runCell: a naive solution is judged a fail", async () => {
  const t = await makeEnv();
  t.docker.behavior = ccBehavior(join(t.repo.tasksDir, "HX-001"), "naive/a");
  const r = await runCell(t.env, await cellFor(t));
  assertEquals((await t.env.store.judgments(r.executions[0]!.id))[0]!.verdict, "fail");
});

Deno.test("credential gate: refused without supervision or enforcement; supervised runs reserve in the shared ledger first", async () => {
  const t = await makeEnv();
  t.env.supervised = false;
  await assertRejects(async () => runCell(t.env, await cellFor(t)), ConfigurationError, "egress");
  t.env.supervised = true;
  t.env.credentialLedger = null;
  await assertRejects(async () => runCell(t.env, await cellFor(t)), ConfigurationError, "ledger");
  t.env.credentialLedger = join(t.env.privateRoot, "shared.jsonl");
  await Deno.writeTextFile(t.env.credentialLedger, '{"lane":"M4-17"}\n'.repeat(5));
  await assertRejects(async () => runCell(t.env, await cellFor(t)), ConfigurationError, "5 supervised");
  assertEquals(t.docker.runs, [], "no docker call before the reservation");
  t.env.egressEnforced = true;
  assertEquals((await runCell(t.env, await cellFor(t))).executions.length, 1, "verified enforcement needs no reservation");
});

Deno.test("an adapter that cannot enforce the budget is refused", async () => {
  const t = await makeEnv();
  const a = adapterFor("claude-code");
  a.enforcesBudget = false;
  try {
    await assertRejects(async () => runCell(t.env, await cellFor(t)), ConfigurationError, "budget");
  } finally {
    a.enforcesBudget = true;
  }
});

Deno.test("retries follow ancestry: supervised withholds; usage-limit then setup-failure may retry once more, never twice", async () => {
  const crash = [JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, modelUsage: {} })];
  const t = await makeEnv();
  const cell = await cellFor(t);
  t.docker.behavior = async (_c, io) => {
    for (const l of [INIT, ...crash]) await io.stdout(l);
    return 1;
  };
  const s = await runCell(t.env, cell);
  assertEquals(s.executions.map((e) => [e.termination, e.did_work]), [["harness_crash", false]]);
  assertStringIncludes(s.withheld!, "supervised");
  t.env.supervised = false;
  t.env.egressEnforced = true;
  const u = await runCell(t.env, cell);
  assertEquals(u.executions.map((e) => [e.run_kind, e.attempt]), [["planned", 1], ["auto_retry", 2]]);
  // A usage-limited planned attempt, then its retry fails setup twice: one more retry after the first, none after the second.
  const limited = { ...u.executions[0]!, id: crypto.randomUUID(), termination: "usage_limited" as const, did_work: false };
  t.docker.images.delete(IMAGE_ID);
  const chain = await runCell(t.env, cell, { attempt: 2, runKind: "auto_retry", retryOf: limited.id }, [limited]);
  assertEquals(chain.executions.map((e) => [e.termination, e.attempt]), [["setup_failed", 2], ["setup_failed", 3]]);
  assertStringIncludes(chain.stopped!, "one retry was used");
});

Deno.test("runCell: timeout kills the sandbox; the workspace is judged; cost is unknown, never a lower bound", async () => {
  const t = await makeEnv();
  t.env.timeoutMsFor = () => 50;
  const lines = (await probeLines()).slice(0, 12);
  t.docker.behavior = async (call, io) => {
    await ccBehavior(join(t.repo.tasksDir, "HX-001"), "correct", lines)(call, io);
    await io.killed;
    return 137;
  };
  const e = (await runCell(t.env, await cellFor(t))).executions[0]!;
  assertEquals([e.termination, e.telemetry.cost_usd], ["timeout", null]);
  assert(e.validity.incomplete_telemetry.includes("cost_usd"));
  assertEquals((await t.env.store.judgments(e.id))[0]!.verdict, "pass");
});

Deno.test("a failure after the spawn is unknown cost, not zero; a failure before it is exact zero", async () => {
  const t = await makeEnv();
  t.docker.failAfterStart = new Error("capture pipe broke");
  const after = (await runCell(t.env, await cellFor(t))).executions[0]!;
  assertEquals([after.termination, after.telemetry.cost_usd], ["harness_crash", null]);
  assert(after.validity.incomplete_telemetry.includes("cost_usd"));
  const t2 = await makeEnv();
  t2.docker.runError = new Error("open raw.jsonl: access denied");
  const before = (await runCell(t2.env, await cellFor(t2))).executions[0]!;
  assertEquals([before.termination, before.telemetry.cost_usd], ["setup_failed", 0]);
});

Deno.test("images: retagging never invalidates a pinned image; a removed pinned image is setup_failed and never runs", async () => {
  const t = await makeEnv();
  const cell = await cellFor(t);
  t.docker.addImage("centralgauge/harness-claude-code:2.1.282", `sha256:${"d".repeat(64)}`, {});
  assertEquals((await runCell(t.env, cell)).executions[0]!.termination, "completed");
  assertEquals(t.docker.runs[0]!.image, IMAGE_ID);
  t.docker.images.delete(IMAGE_ID);
  const r = await runCell(t.env, cell);
  assertEquals([r.executions[0]!.termination, r.executions[0]!.telemetry.cost_usd, t.docker.runs.length], ["setup_failed", 0, 1]);
});

Deno.test("runCell: a usage limit pauses, is not judged, and persists the reset time", async () => {
  const t = await makeEnv();
  t.docker.behavior = async (_c, io) => {
    for (const l of [INIT, JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1790643600 } }),
      JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, api_error_status: 429, modelUsage: {} })]) await io.stdout(l);
    return 1;
  };
  const r = await runCell(t.env, await cellFor(t));
  const reset = new Date(1790643600 * 1000).toISOString();
  assertEquals([r.executions[0]!.termination, r.pause], ["usage_limited", reset]);
  assertEquals(await t.env.store.judgments(r.executions[0]!.id), []);
  const side = JSON.parse(await Deno.readTextFile(join(t.env.resultsRoot, "runs", r.executions[0]!.id, "sandbox.json")));
  assertEquals(side.usage_reset_at, reset);
});

Deno.test("runCell: an observed version mismatch is setup_failed", async () => {
  const t = await makeEnv();
  t.docker.behavior = async (_c, io) => {
    await io.stdout(INIT.replace("2.1.282", "2.1.300"));
    return 0;
  };
  const r = await runCell(t.env, await cellFor(t));
  assertEquals(r.executions[0]!.termination, "setup_failed");
  const side = JSON.parse(await Deno.readTextFile(join(t.env.resultsRoot, "runs", r.executions[0]!.id, "sandbox.json")));
  assertStringIncludes(side.setup_error, "2.1.300");
});

Deno.test("unconfirmed termination: nothing is frozen or published; recovery finalizes once the container is gone", async () => {
  const t = await makeEnv();
  const cell = await cellFor(t);
  t.docker.behavior = async (call, io) => {
    t.docker.lingering.add(call.name);
    return await ccBehavior(join(t.repo.tasksDir, "HX-001"), "correct")(call, io);
  };
  await assertRejects(() => runCell(t.env, cell), ContainerError, "termination not confirmed");
  assertEquals(await t.env.store.executions(cell.campaignId), []);
  assert(!await exists(join(t.env.resultsRoot, "workspaces")) || [...Deno.readDirSync(join(t.env.resultsRoot, "workspaces"))].length === 0);
  t.docker.lingering.clear();
  const [e] = await recoverInterrupted(t.env, loadTask);
  assertEquals([e!.termination, e!.did_work], ["harness_crash", true]);
  assertEquals((await t.env.store.judgments(e!.id))[0]!.verdict, "pass");
});

Deno.test("every published surface is redacted (UTF-8 and UTF-16): logs, stderr, trace, side file, record, workspace", async () => {
  const t = await makeEnv();
  let token = "";
  t.docker.behavior = async (call, io) => {
    token = await tokenOf(call);
    const ws = call.mounts.get("C:\\workspace")!.src;
    await Deno.writeTextFile(join(ws, "leak.txt"), `x${SECRET_OAUTH}y${token}`);
    await Deno.writeFile(join(ws, "leak16.txt"), new Uint8Array(new Uint16Array([...SECRET_OAUTH].map((c) => c.charCodeAt(0))).buffer));
    await io.stdout(INIT);
    await io.stdout(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: `${SECRET_OAUTH}/${token}` }] } }));
    for (const l of await probeLines()) await io.stdout(l);
    return 0;
  };
  const r = await runCell(t.env, await cellFor(t));
  const published = await allBytes(t.env.resultsRoot);
  assert(!leaks(published, SECRET_OAUTH) && !leaks(published, token));
  const side = JSON.parse(await Deno.readTextFile(join(t.env.resultsRoot, "runs", r.executions[0]!.id, "sandbox.json")));
  assertEquals([side.redactions, side.workspace_redactions], [2, 3]);
  assert(!await exists(privatePaths(t.env, r.executions[0]!.id).custody));
});

Deno.test("recovery: an interrupted attempt keeps its spend at the original prices and is redacted with the custody secrets", async () => {
  const t = await makeEnv();
  t.docker.behavior = async (call, io) => {
    const token = await tokenOf(call);
    await ccBehavior(join(t.repo.tasksDir, "HX-001"), "correct")(call, io);
    await io.stdout(JSON.stringify({ type: "leak", token, oauth: SECRET_OAUTH }));
    return 0;
  };
  t.env.hooks = { beforeDraft: () => Promise.reject(new Error("runner killed")) };
  const cell = await cellFor(t);
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  assertEquals(await t.env.store.executions(cell.campaignId), []);
  assert(!leaks(await allBytes(t.env.resultsRoot), SECRET_OAUTH), "a crashed run leaves no unredacted log under results");
  // Prices changed and the operator rotated the credential file since the attempt.
  t.env.pricing = () => Promise.resolve({ at: "x", models: {} });
  await Deno.writeTextFile(join(t.env.secretsSource, "claude-oauth-token"), "rotated-0123456789abcdef");
  t.env.hooks = {};
  const [e] = await recoverInterrupted(t.env, loadTask);
  assertEquals([e!.termination, e!.did_work], ["harness_crash", true]);
  assertAlmostEquals(e!.telemetry.cost_usd!, PROBE_COST, 1e-12);
  const raw = await Deno.readTextFile(join(t.env.resultsRoot, e!.raw_log_path!));
  assertStringIncludes(raw, "[REDACTED:backend-token]");
  assertStringIncludes(raw, "[REDACTED:claude-oauth-token]");
  assertEquals((await t.env.store.judgments(e!.id))[0]!.verdict, "pass");
  assertEquals(await recoverInterrupted(t.env, loadTask), [], "recovery is idempotent");
});

Deno.test("recovery: publishes into the original results root, from the stored manifest and task snapshot, even after the task was deleted or its limits changed", async () => {
  const t = await makeEnv();
  const cellsRoot = join(t.env.resultsRoot, "cells");
  const cellsEnv = { ...t.env, resultsRoot: cellsRoot, store: new RecordStore(cellsRoot) };
  cellsEnv.hooks = { beforeDraft: () => Promise.reject(new Error("runner killed")) };
  const cell = await cellFor(t);
  await assertRejects(() => runCell(cellsEnv, cell), Error, "runner killed");
  await write(t.repo.tasksDir, "HX-001/task.yml", (await Deno.readTextFile(join(t.repo.tasksDir, "HX-001", "task.yml"))).replace("timeout_min: 20", "timeout_min: 5"));
  await Deno.rename(join(t.repo.tasksDir, "HX-001"), join(t.repo.tasksDir, "HX-001-moved"));
  const [e] = await recoverInterrupted(t.env, loadTask); // a different command's env: results/harness
  assertEquals(await t.env.store.executions(cell.campaignId), [], "nothing lands in the other command's store");
  const stored = await cellsEnv.store.executions(cell.campaignId);
  assertEquals(stored.map((x) => x.id), [e!.id]);
  assertEquals(stored[0]!.manifest.limits.timeout_min, 20, "the original effective limits, not the edited ones");
  assertEquals(await cellsEnv.store.judgments(e!.id), [], "task unavailable: recorded, not judged");
});

Deno.test("recovery: custody missing after release stops (fail closed) and keeps the intent", async () => {
  const t = await makeEnv();
  t.env.hooks = { beforeDraft: () => Promise.reject(new Error("runner killed")) };
  const cell = await cellFor(t);
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  const intentFile = [...Deno.readDirSync(join(t.env.privateRoot, "intents"))][0]!.name;
  const id = intentFile.replace(".json", "");
  await Deno.remove(privatePaths(t.env, id).custody);
  t.env.hooks = {};
  await assertRejects(() => recoverInterrupted(t.env, loadTask), ContainerError, "custody");
  assert(await exists(privatePaths(t.env, id).intent), "intent kept");
});

Deno.test("a setup failure with no captures still writes its draft and publishes", async () => {
  const t = await makeEnv();
  const cell = await cellFor(t);
  t.docker.images.delete(IMAGE_ID);
  const e = (await runCell(t.env, cell)).executions[0]!;
  assertEquals([e.termination, e.telemetry.cost_usd], ["setup_failed", 0]);
  assert(await exists(join(t.env.resultsRoot, "runs", e.id, "sandbox.json")));
});

Deno.test("recovery: an interruption inside cleanup only repeats the cleanup", async () => {
  const t = await makeEnv();
  t.env.hooks = { afterPublished: () => Promise.reject(new Error("runner killed")) };
  const cell = await cellFor(t);
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  t.env.hooks = {};
  assertEquals(await recoverInterrupted(t.env, loadTask), []);
  const [e] = await t.env.store.executions(cell.campaignId);
  assertEquals((await t.env.store.judgments(e!.id)).length, 1);
  assertEquals([...Deno.readDirSync(join(t.env.privateRoot, "intents"))], []);
});

Deno.test("a backend fault (failed unpause) stops the execution as infra", async () => {
  const t = await makeEnv();
  t.docker.unpause = () => Promise.resolve(1);
  t.docker.behavior = async (call, io) => {
    await ccBehavior(join(t.repo.tasksDir, "HX-001"), "correct", (await probeLines()).slice(0, 12))(call, io);
    const token = await tokenOf(call);
    await t.env.backend.handle(new Request("http://b/v1/compile", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "x-cg-execution": call.env.get("CG_EXECUTION_ID")! }, body: '{"apps":["Core"]}',
    }));
    await io.killed;
    return 137;
  };
  const e = (await runCell(t.env, await cellFor(t))).executions[0]!;
  assertEquals([e.termination, e.validity.infra_exposed], ["harness_crash", true]);
  const side = JSON.parse(await Deno.readTextFile(join(t.env.resultsRoot, "runs", e.id, "sandbox.json")));
  assertEquals(side.stop_reason, "backend_fault");
});

for (const step of ["draft", "run", "execution", "artifact", "judgment"] as PublishStep[]) {
  Deno.test(`recovery: a crash after the ${step} step completes exactly once`, async () => {
    const t = await makeEnv();
    t.env.hooks = { after: (s) => s === step ? Promise.reject(new Error("runner killed")) : Promise.resolve() };
    const cell = await cellFor(t);
    await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
    t.env.hooks = {};
    await recoverInterrupted(t.env, loadTask);
    const execs = await t.env.store.executions(cell.campaignId);
    assertEquals(execs.length, 1);
    assert((await t.env.store.artifact(execs[0]!.id)) !== null);
    assertEquals((await t.env.store.judgments(execs[0]!.id)).length, 1);
    assert(await exists(join(t.env.resultsRoot, "runs", execs[0]!.id, "raw.jsonl")));
    const p = privatePaths(t.env, execs[0]!.id);
    for (const d of [p.pending, p.custody, p.intent]) assert(!await exists(d), d);
  });
}

Deno.test("recovery: a task changed since the attempt is recorded but not judged", async () => {
  const t = await makeEnv();
  t.env.hooks = { after: (s) => s === "draft" ? Promise.reject(new Error("runner killed")) : Promise.resolve() };
  const cell = await cellFor(t);
  await assertRejects(() => runCell(t.env, cell), Error, "runner killed");
  await write(t.repo.tasksDir, "HX-001/oracle/src/Extra.Test.al", "// changed oracle\n");
  t.env.hooks = {};
  await recoverInterrupted(t.env, loadTask);
  const [e] = await t.env.store.executions(cell.campaignId);
  assertEquals(await t.env.store.judgments(e!.id), []);
});

Deno.test("operator interrupt stops the sandbox; the attempt is recorded and judged as work done", async () => {
  const t = await makeEnv();
  const stop = new AbortController();
  t.env.stop = stop.signal;
  t.docker.behavior = async (call, io) => {
    await ccBehavior(join(t.repo.tasksDir, "HX-001"), "correct", (await probeLines()).slice(0, 12))(call, io);
    stop.abort();
    await io.killed;
    return 137;
  };
  const e = (await runCell(t.env, await cellFor(t))).executions[0]!;
  assertEquals([e.termination, e.telemetry.cost_usd], ["harness_crash", null]);
  const side = JSON.parse(await Deno.readTextFile(join(t.env.resultsRoot, "runs", e.id, "sandbox.json")));
  assertEquals(side.stop_reason, "operator_interrupt");
  assertEquals((await t.env.store.judgments(e.id))[0]!.verdict, "pass");
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `deno test --allow-all tests/unit/harness/records.test.ts tests/unit/harness/credential-budget.test.ts tests/unit/harness/images.test.ts tests/unit/harness/execution.test.ts`
Expected: FAIL, `Module not found ".../src/harness/credential-budget.ts"` (and the records test fails on the missing field).

- [ ] **Step 3: Implement**

`src/harness/credential-budget.ts`:

```typescript
/**
 * One shared, cross-lane budget of supervised credential-bearing runs
 * before egress enforcement (egress decision; round 2 item 9). M1 and M4
 * reserve in the same append-only ledger; a reservation is made before any
 * credential is released; no ledger configured means refused.
 */

import { ConfigurationError } from "../errors.ts";

export const CREDENTIAL_RUN_LIMIT = 5;

export interface Reservation {
  lane: string;
  task: string;
  config: string;
  purpose: string;
}

const STALE_LOCK_MS = 60_000;

export async function reserveCredentialRun(ledgerPath: string | null, r: Reservation, limit = CREDENTIAL_RUN_LIMIT): Promise<number> {
  if (!ledgerPath) {
    throw new ConfigurationError("no shared credential-run ledger configured (CG_CREDENTIAL_LEDGER): refusing a credential-bearing run");
  }
  const lock = `${ledgerPath}.lock`;
  // ponytail: lock file with a stale timeout; a crashed holder costs one minute.
  for (let i = 0;; i++) {
    try {
      (await Deno.open(lock, { write: true, createNew: true })).close();
      break;
    } catch (err) {
      if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
      const st = await Deno.stat(lock).catch(() => null);
      if (st?.mtime && Date.now() - st.mtime.getTime() > STALE_LOCK_MS) await Deno.remove(lock).catch(() => {});
      if (i > 600) throw new ConfigurationError(`credential-run ledger is locked: ${lock}`);
      await new Promise((res) => setTimeout(res, 20));
    }
  }
  try {
    let used: number;
    try {
      // Every non-empty line counts, parseable or not (conservative).
      used = (await Deno.readTextFile(ledgerPath)).split(/\r?\n/).filter((l) => l.trim() !== "").length;
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        throw new ConfigurationError(`cannot read the credential-run ledger ${ledgerPath}: ${err instanceof Error ? err.message : err}; refusing`);
      }
      used = 0; // only a genuinely absent ledger means no run yet
    }
    if (used >= limit) {
      throw new ConfigurationError(
        `${limit} supervised credential-bearing runs are used across all lanes; egress enforcement must be verified (M1-33, M1-34) before more`,
      );
    }
    await Deno.writeTextFile(ledgerPath, JSON.stringify({ v: 1, at: new Date().toISOString(), ordinal: used + 1, ...r }) + "\n", { append: true, create: true });
    return used + 1;
  } finally {
    await Deno.remove(lock).catch(() => {});
  }
}
```

`src/harness/images.ts`:

```typescript
/** Harness images (spec 1a section 5, D9): tags, labels, facts, provenance, runtime facts. */

import type { Catalog } from "../ingest/catalog/read.ts";
import type { HarnessAdapter } from "./adapter.ts";
import type { HarnessConfig } from "./config.ts";
import type { RuntimeFacts } from "./manifest.ts";
import type { DockerCli } from "./sandbox.ts";
import { ConfigurationError } from "../errors.ts";
import { BACKEND_VERSION } from "./backend.ts";

export const BASE_IMAGE = "centralgauge/harness-base:1";
export const IMAGE_LABELS = {
  harness: "centralgauge.harness",
  version: "centralgauge.harness.version",
  base: "centralgauge.harness.base_digest",
} as const;

export const imageTag = (harness: string, version: string) => `centralgauge/harness-${harness}:${version}`;

export interface ImageFacts {
  digest: string;
  base_digest: string;
  harness: string;
  version: string;
}

type Inspect = { Id?: string; Config?: { Labels?: Record<string, string> }; RootFS?: { Layers?: string[] } } | null;

export async function imageFacts(docker: DockerCli, ref: string): Promise<ImageFacts> {
  const img = await docker.inspectImage(ref) as Inspect;
  if (!img?.Id) throw new ConfigurationError(`image ${ref} not found: run \`centralgauge harness images build\``);
  const l = img.Config?.Labels ?? {};
  const missing = Object.values(IMAGE_LABELS).filter((k) => !l[k]);
  if (missing.length > 0) throw new ConfigurationError(`image ${ref} lacks label(s) ${missing.join(", ")}`);
  return { digest: img.Id, base_digest: l[IMAGE_LABELS.base]!, harness: l[IMAGE_LABELS.harness]!, version: l[IMAGE_LABELS.version]! };
}

/** Provenance, not a label: the image's layers must start with the base image's layers. */
export async function hasBaseLayers(docker: DockerCli, imageRef: string, baseRef: string): Promise<boolean> {
  const [img, base] = [await docker.inspectImage(imageRef) as Inspect, await docker.inspectImage(baseRef) as Inspect];
  const a = img?.RootFS?.Layers ?? [];
  const b = base?.RootFS?.Layers ?? [];
  return b.length > 0 && a.length >= b.length && b.every((x, i) => a[i] === x);
}

export function runtimeFacts(config: HarnessConfig, image: ImageFacts, adapter: HarnessAdapter, catalog: Catalog): RuntimeFacts {
  if (image.harness !== config.harness || image.version !== config.harness_version) {
    throw new ConfigurationError(
      `${config.id}: image is ${image.harness} ${image.version}, config wants ${config.harness} ${config.harness_version}`,
    );
  }
  if (config.components.mcp.length > 0 || config.components.lsp.length > 0) {
    throw new ConfigurationError(`${config.id}: MCP and LSP components need runtime facts collected in M2`);
  }
  return {
    native_settings: adapter.nativeSettings(config, catalog),
    image: { digest: image.digest, base_digest: image.base_digest },
    backend_version: BACKEND_VERSION,
    servers: {},
    provider_routes: adapter.providerRoutes(config),
  };
}
```

`src/harness/execution.ts`:

```typescript
/**
 * One execution (spec 1a section 5 items 1-6) and one cell (section 8).
 * Live path: gate -> stage (private) -> pin image -> config -> grant ->
 * intent -> secrets + custody -> docker run (quarantine) -> revoke (drain)
 * -> delete secrets mount -> confirmed termination -> draft -> publish.
 * Recovery resumes from the intent or the draft; every step is idempotent.
 */

import { basename, join } from "@std/path";
import type { PricingBook } from "./pricing.ts";
import type { RefappRef, SymbolPackage } from "./identity.ts";
import type { ResolvedManifest } from "./manifest.ts";
import type { Block, ExecutionRecord, JudgmentRecord, RunKind } from "./records.ts";
import type { LoadedTask } from "./task.ts";
import { ConfigurationError, ContainerError, ValidationError } from "../errors.ts";
import { incompleteTelemetry, observedMismatch, type ParsedRun } from "./adapter.ts";
import { adapterFor } from "./adapters/mod.ts";
import { type Backend, readHostLog } from "./backend.ts";
import type { BcLane, DeployContext } from "./bc-lane.ts";
import { reserveCredentialRun } from "./credential-budget.ts";
import { exists, freezeWorkspace, safeCopyTree } from "./fsutil.ts";
import { hashFile, hashJson, hashTree } from "./hash.ts";
import { taskSetIdentity } from "./identity.ts";
import { forTask } from "./manifest.ts";
import { ExecutionRecordSchema, outcomePolicy, RecordStore, retryProblem } from "./records.ts";
import {
  bounded,
  type DockerCli,
  OP_TIMEOUT_MS,
  prepareSecrets,
  publishRedacted,
  redactText,
  removeSecrets,
  runSandbox,
  sandboxName,
  type SandboxResult,
  type SecretValue,
} from "./sandbox.ts";
import { type StagedWorkspace, TASK_SOURCES } from "./staging.ts";
import { currentScorerFingerprint, judge, writeVerdictLog } from "./verdict.ts";

export type PublishStep = "draft" | "run" | "execution" | "artifact" | "judgment";

export interface HarnessEnv {
  repoRoot: string;
  harnessRoot: string;
  /** results/harness: finished, redacted files only. */
  resultsRoot: string;
  /** Private state (work, quarantine, custody, pending, intents), never under results/. */
  privateRoot: string;
  store: RecordStore;
  lane: BcLane;
  backend: Backend;
  backendUrl: string;
  docker: DockerCli;
  owner: string;
  symbols: SymbolPackage[];
  symbolStore: string;
  secretsSource: string;
  deploy: DeployContext;
  pricing(at: Date): Promise<PricingBook>;
  /** Started by a human at a terminal; no automatic retries. */
  supervised: boolean;
  /** True only when M1-24 confirmed the verified enforcement state at start (M1-33, M1-34). */
  egressEnforced: boolean;
  /** Shared cross-lane reservation ledger for supervised credential-bearing runs. */
  credentialLedger: string | null;
  /** Coordination lane name recorded with a reservation. */
  lane_id: string;
  /** Operator interrupt (Ctrl+C, M1-24). */
  stop?: AbortSignal;
  now?: () => Date;
  timeoutMsFor?: (minutes: number) => number;
  killGraceMs?: number;
  opTimeoutMs?: number;
  maxCaptureBytes?: number;
  /** Test seams: crash after a publication step, before the draft, or inside cleanup. */
  hooks?: { after?(step: PublishStep): Promise<void>; beforeDraft?(): Promise<void>; afterPublished?(): Promise<void> };
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

interface Intent {
  v: 2;
  execution_id: string;
  /** prepared: nothing released; released: custody written, sandbox may start; published: records written. */
  phase: "prepared" | "released" | "published";
  /** The results root of the command that started the attempt (recovery publishes there). */
  results_root: string;
  cell: Omit<CellRef, "task"> & { task_dir: string };
  /** Private snapshot of the task directory at run start. */
  task_snapshot: string;
  /** The effective execution manifest (forTask), never re-derived. */
  manifest: ResolvedManifest;
  at: AttemptRef;
  started_at: string;
  pricing: PricingBook;
  sandbox: string;
  workspace: string;
  pristine_hash: string;
}

interface Draft {
  v: 1;
  execution: ExecutionRecord;
  artifact: { workspace_hash: string; stored_path: string } | null;
  usage_reset_at: string | null;
}

export function privatePaths(env: HarnessEnv, id: string) {
  const p = env.privateRoot;
  return {
    work: join(p, "work", id),
    quarantine: join(p, "quarantine", id),
    custody: join(p, "custody", `${id}.json`),
    pending: join(p, "pending", id),
    intent: join(p, "intents", `${id}.json`),
    taskCopy: join(p, "taskcopy", id),
    raw: join(p, "quarantine", id, "raw.jsonl"),
    stderr: join(p, "quarantine", id, "stderr.txt"),
    host: join(p, "quarantine", id, "host-log.jsonl"),
    trace: join(p, "quarantine", id, "trace.jsonl"),
  };
}

async function writeAtomic(path: string, text: string) {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  await Deno.writeTextFile(tmp, text);
  await Deno.rename(tmp, path);
}

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp)$/i;

/** Spec 1b section 6: whether image attachments reached the model. */
export function imageAttachments(attachments: string[], support: boolean | null): ExecutionRecord["image_attachments"] {
  if (!attachments.some((a) => IMAGE_EXT.test(a))) return "none";
  return support === true ? "delivered" : support === false ? "unsupported" : "unknown";
}

/** C:\config: settings.json, manifest.json and bundle copies; any changed component (file or directory) is refused. */
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
    const isDir = (await Deno.lstat(src)).isDirectory;
    // Part 1 rule: a directory hashes as its bundle tree, a file as hashJson({ file: sha256 }).
    const now = isDir ? await hashTree(src, "bundle") : await hashJson({ file: await hashFile(harnessRoot, src) });
    if (now !== c.hash) throw new ConfigurationError(`component ${name} (${c.path}) changed since the campaign was created`);
    const dst = join(dir, "bundle", name);
    if (isDir) await safeCopyTree(src, dst);
    else {
      await Deno.mkdir(dst, { recursive: true });
      await Deno.copyFile(src, join(dst, basename(src)));
    }
  }
  await Deno.writeTextFile(join(dir, "settings.json"), JSON.stringify({
    harness: m.harness, harness_version: m.harness_version, models: m.models, settings: m.settings.native,
    limits: m.limits, toolchain: m.toolchain,
  }, null, 2) + "\n");
  await Deno.writeTextFile(join(dir, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
}

function notStarted(exitCode: number | null): ParsedRun {
  return {
    telemetry: {
      harness_version: null, cost_usd: 0, cost_source: "estimated", pricing_snapshot: "none: the harness did not start",
      reported_cost_usd: null, per_model: [], turns: null, compactions: null, wall_ms: null, exit_code: exitCode,
      stop_reason: null, refusal_detected: null, raw_usage: null,
    },
    observed: { harness_version: null, models: null, loaded_components: null },
    unobservable: [], didWork: false, termination: null, usageResetAt: null, imageSupport: null, traceEvents: 0,
  };
}

async function stage(env: HarnessEnv, cell: CellRef, out: string): Promise<StagedWorkspace> {
  return await TASK_SOURCES[cell.task.task.source]({
    repoRoot: env.repoRoot, task: cell.task, refapp: cell.refapp, symbols: env.symbols, symbolStore: env.symbolStore, out,
  });
}

/** Strict: a released attempt must have its exact redaction set (round 3 B3). */
async function readCustody(path: string): Promise<SecretValue[]> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as SecretValue[];
  } catch (err) {
    throw new ContainerError(`secret custody ${path} is unavailable (${err instanceof Error ? err.message : err}); refusing to publish`, "custody", "stop");
  }
}

interface DraftInput {
  id: string;
  cell: CellRef;
  at: AttemptRef;
  started_at: string;
  manifest: ResolvedManifest;
  workspace: string;
  pristineHash: string;
  sandbox: SandboxResult;
  setupError: string | null;
  pricing: PricingBook;
  interrupted: boolean;
  /** The exact secrets released to this attempt ([] only when nothing was released). */
  secrets: SecretValue[];
  /** Set when the backend reported a fault (failed unpause). */
  fault: string | null;
}

/** Everything after the container is confirmed gone: freeze, parse, stage redacted files, save the draft. */
async function buildDraft(env: HarnessEnv, f: DraftInput): Promise<Draft> {
  const now = env.now ?? (() => new Date());
  const adapter = adapterFor(f.manifest.harness);
  const p = privatePaths(env, f.id);
  const secrets = f.secrets;
  const started = f.sandbox.started;
  const wsThere = started && await exists(f.workspace);
  const frozen = wsThere
    ? await freezeWorkspace({ resultsRoot: env.resultsRoot, privateRoot: env.privateRoot, workspace: f.workspace, secrets })
    : null;
  const parsed = started
    ? await adapter.parse({ rawLog: p.raw, exitCode: f.sandbox.exitCode, manifest: f.manifest, pricing: f.pricing, traceOut: p.trace })
    : notStarted(f.sandbox.exitCode);
  const host = await readHostLog(p.host);
  const check = started ? observedMismatch(f.manifest, parsed.observed, parsed.unobservable) : { mismatch: null, unverified: [] };
  const stopReason = f.fault
    ? "backend_fault"
    : f.sandbox.interrupted
    ? "operator_interrupt"
    : f.sandbox.overflow
    ? "capture_overflow"
    : f.interrupted
    ? "runner_interrupted"
    : null;
  const termination: ExecutionRecord["termination"] = !started || f.setupError !== null || check.mismatch !== null
    ? "setup_failed"
    : stopReason !== null
    ? "harness_crash"
    : parsed.termination === "usage_limited"
    ? "usage_limited"
    : f.sandbox.timedOut
    ? "timeout"
    : f.sandbox.startError !== null
    ? "harness_crash"
    : parsed.termination ?? (f.sandbox.exitCode === 0 ? "completed" : "harness_crash");
  const did_work = parsed.didWork || host.length > 0 || (frozen !== null && frozen.workspace_hash !== f.pristineHash);
  const runDir = join(p.pending, "run");
  await Deno.remove(runDir, { recursive: true }).catch(() => {});
  await Deno.mkdir(runDir, { recursive: true }); // a setup failure has no captures but still writes its side file
  const redactions = await publishRedacted([
    { src: p.raw, dest: join(runDir, "raw.jsonl") },
    { src: p.stderr, dest: join(runDir, "stderr.txt") },
    { src: p.host, dest: join(runDir, "host-log.jsonl") },
    { src: p.trace, dest: join(runDir, "trace.jsonl") },
  ], secrets);
  const side = redactText(JSON.stringify({
    v: 1, sandbox: f.sandbox, setup_error: f.setupError ?? check.mismatch, unverified: check.unverified, stop_reason: stopReason, fault: f.fault,
    usage_reset_at: parsed.usageResetAt, redactions, workspace_redactions: frozen?.redactions ?? 0,
    pricing_book_at: f.pricing.at, pristine_hash: f.pristineHash, freeze_violations: frozen?.violations ?? [],
  }, null, 2), secrets).text;
  await Deno.writeTextFile(join(runDir, "sandbox.json"), side + "\n");
  const runRel = `runs/${f.id}`;
  const record = {
    v: 2, id: f.id, campaign_id: f.cell.campaignId, block: f.cell.block.index, order_in_block: f.cell.orderInBlock,
    arm: f.cell.arm, task_id: f.cell.task.task.id, task_visible_hash: f.cell.taskVisibleHash, repeat: f.cell.block.repeat,
    attempt: f.at.attempt, run_kind: f.at.runKind, retry_of: f.at.retryOf, started_at: f.started_at,
    ended_at: now().toISOString(), arm_manifest_hash: f.cell.armManifestHash, manifest: f.manifest,
    observed: parsed.observed, termination, did_work,
    validity: {
      incomplete_telemetry: started ? incompleteTelemetry(adapter.declared, parsed.telemetry) : [],
      incomplete_observed: check.unverified.length > 0 ? ["loaded_components"] : [],
      infra_exposed: f.fault !== null || host.some((l) => l.outcome === "infra"),
    },
    image_attachments: imageAttachments(f.cell.task.task.attachments, parsed.imageSupport),
    telemetry: parsed.telemetry,
    trace_path: parsed.traceEvents > 0 ? `${runRel}/trace.jsonl` : null,
    host_log_path: `${runRel}/host-log.jsonl`,
    raw_log_path: `${runRel}/raw.jsonl`,
    container_assignments: [...new Set(host.map((l) => l.container).filter((c): c is string => !!c))],
    workspace_hash: frozen?.workspace_hash ?? null,
  };
  const draft: Draft = {
    v: 1,
    execution: ExecutionRecordSchema.parse(JSON.parse(redactText(JSON.stringify(record), secrets).text)),
    artifact: frozen ? { workspace_hash: frozen.workspace_hash, stored_path: frozen.stored_path } : null,
    usage_reset_at: parsed.usageResetAt,
  };
  await env.hooks?.beforeDraft?.();
  await writeAtomic(join(p.pending, "draft.json"), JSON.stringify(draft));
  await env.hooks?.after?.("draft");
  return draft;
}

/** Idempotent publication of a saved draft; judging only when the task is unchanged. */
async function publishDraft(env: HarnessEnv, cell: CellRef, draft: Draft, pristine: string | null, taskUnchanged: boolean) {
  const now = env.now ?? (() => new Date());
  const e = draft.execution;
  const p = privatePaths(env, e.id);
  const runs = join(env.resultsRoot, "runs");
  if (!await exists(join(runs, e.id))) {
    const tmp = join(runs, `.tmp-${e.id}-${crypto.randomUUID().slice(0, 8)}`);
    await Deno.mkdir(runs, { recursive: true });
    await safeCopyTree(join(p.pending, "run"), tmp);
    await Deno.rename(tmp, join(runs, e.id));
  }
  await env.hooks?.after?.("run");
  if (!(await env.store.executions(e.campaign_id)).some((x) => x.id === e.id)) await env.store.writeExecution(e);
  await env.hooks?.after?.("execution");
  if (draft.artifact && !await env.store.artifact(e.id)) {
    await env.store.writeArtifact({ v: 1, execution_id: e.id, ...draft.artifact, created_at: now().toISOString() });
  }
  await env.hooks?.after?.("artifact");
  const policy = outcomePolicy(e.termination, e.did_work);
  const fp = await currentScorerFingerprint();
  const judged = (await env.store.judgments(e.id)).some((j) => j.scorer_fingerprint === fp);
  if (policy.judge && e.workspace_hash !== null && !judged && taskUnchanged) {
    const out = join(p.work, `restage-${crypto.randomUUID().slice(0, 8)}`);
    try {
      await judgeExecution(env, cell, e, pristine ?? (await stage(env, cell, out)).pristine);
    } finally {
      await Deno.remove(out, { recursive: true }).catch(() => {});
    }
  }
  await env.hooks?.after?.("judgment");
  await finishCleanup(env, e.id);
}

/** Completion protocol: mark published, delete private state, delete the intent last. */
async function finishCleanup(env: HarnessEnv, id: string) {
  const p = privatePaths(env, id);
  const intent = await Deno.readTextFile(p.intent).then((t) => JSON.parse(t) as Intent, () => null);
  if (intent && intent.phase !== "published") await writeAtomic(p.intent, JSON.stringify({ ...intent, phase: "published" }, null, 2));
  await env.hooks?.afterPublished?.();
  for (const d of [p.work, p.quarantine, p.pending, p.taskCopy]) await Deno.remove(d, { recursive: true }).catch(() => {});
  await Deno.remove(p.custody).catch(() => {});
  await Deno.remove(p.intent).catch(() => {});
}

export async function runExecution(
  env: HarnessEnv,
  cell: CellRef,
  at: AttemptRef,
): Promise<{ execution: ExecutionRecord; usageResetAt: string | null }> {
  const adapter = adapterFor(cell.armManifest.harness);
  if (!adapter.enforcesBudget) {
    throw new ConfigurationError(`${cell.arm}: the ${adapter.harness} adapter cannot enforce max_budget_usd; refusing the arm`);
  }
  if (adapter.credentialBearing && !env.egressEnforced) {
    if (!env.supervised) {
      throw new ConfigurationError(
        `${cell.arm}: credential-bearing arms run only supervised (harness cell --supervised) until egress enforcement is verified (M1-33/M1-34)`,
      );
    }
    await reserveCredentialRun(env.credentialLedger, { lane: env.lane_id, task: cell.task.task.id, config: cell.arm, purpose: "supervised dev run" });
  }
  const now = env.now ?? (() => new Date());
  const id = crypto.randomUUID();
  const started_at = now().toISOString();
  const pricing = await env.pricing(now());
  const manifest = forTask(cell.armManifest, cell.task.task.limits);
  const p = privatePaths(env, id);
  await Deno.mkdir(p.quarantine, { recursive: true });
  await safeCopyTree(cell.task.dir, p.taskCopy); // immutable task snapshot for recovery
  const staged = await stage(env, cell, p.work);
  const pristineHash = await hashTree(staged.pristine, "task");
  const name = sandboxName(cell.campaignId, id);
  const opMs = env.opTimeoutMs ?? OP_TIMEOUT_MS;
  const { task: _t, ...rest } = cell;
  const intent: Intent = {
    v: 2, execution_id: id, phase: "prepared", results_root: env.resultsRoot, cell: { ...rest, task_dir: cell.task.dir },
    task_snapshot: p.taskCopy, manifest, at, started_at, pricing, sandbox: name, workspace: staged.workspace, pristine_hash: pristineHash,
  };
  await writeAtomic(p.intent, JSON.stringify(intent, null, 2));

  let setupError: string | null = null;
  let sandbox: SandboxResult = {
    exitCode: null, started: false, startError: null, timedOut: false, interrupted: false, overflow: false,
    confirmedGone: true, cleanup: "ok", wall_ms: 0,
  };
  let secrets: SecretValue[] = [];
  let drained = true;
  let fault: string | null = null;
  const faultStop = new AbortController();
  const stop = env.stop ? AbortSignal.any([env.stop, faultStop.signal]) : faultStop.signal;
  try {
    const img = await bounded(env.docker.inspectImage(manifest.image.digest), opMs, "docker image inspect") as { Id?: string } | null;
    if (img?.Id !== manifest.image.digest) {
      throw new ConfigurationError(`image ${manifest.image.digest} pinned by the campaign is no longer present`);
    }
    const configDir = join(p.work, "config");
    await writeConfigDir(env.harnessRoot, configDir, manifest);
    const extraMounts = await adapter.extraMounts(manifest.settings.native, cell.task.dir, env.repoRoot);
    const timeoutMs = (env.timeoutMsFor ?? ((m) => m * 60_000))(manifest.limits.timeout_min);
    const token = await env.backend.grant({
      executionId: id, sandbox: name, workspace: staged.workspace, pristine: staged.pristine, trusted: staged.apps,
      symbols: env.symbols, lock: { store: env.symbolStore, packages: env.symbols }, deploy: env.deploy, hostLog: p.host,
      onFault: (reason) => {
        fault = reason;
        faultStop.abort(new Error(reason));
      },
    }, timeoutMs + 5 * 60_000);
    let secretsDir: string | null = null;
    try {
      const s = await prepareSecrets(env.secretsSource, adapter.secretFiles, token);
      secretsDir = s.dir;
      secrets = s.values;
      await writeAtomic(p.custody, JSON.stringify(s.values));
      await writeAtomic(p.intent, JSON.stringify({ ...intent, phase: "released" }, null, 2));
      sandbox = await runSandbox(env.docker, {
        name, owner: env.owner, executionId: id, imageId: manifest.image.digest,
        workspace: staged.workspace, taskDir: staged.taskDir, configDir, secretsDir: s.dir, extraMounts,
        env: { CG_BACKEND_URL: env.backendUrl, CG_EXECUTION_ID: id }, timeoutMs,
        killGraceMs: env.killGraceMs ?? 60_000, opTimeoutMs: opMs, maxCaptureBytes: env.maxCaptureBytes ?? 256 * 1024 * 1024,
        rawLog: p.raw, stderrLog: p.stderr,
      }, s.values.map((v) => v.value), stop);
    } finally {
      drained = await env.backend.revoke(id); // spec 1a section 5 item 6: revoke (and drain) before freeze
      if (secretsDir) await removeSecrets(secretsDir);
    }
  } catch (err) {
    if (!(err instanceof ConfigurationError) && !(err instanceof ValidationError)) throw err;
    setupError = err.message;
  }
  if (!sandbox.confirmedGone || !drained) {
    throw new ContainerError(
      `termination not confirmed for ${name} (${sandbox.cleanup}${drained ? "" : "; backend request did not drain"}); nothing frozen, intent kept; resolve and restart (recovery finalizes it)`,
      name,
      "stop",
    );
  }
  const draft = await buildDraft(env, {
    id, cell, at, started_at, manifest, workspace: staged.workspace, pristineHash, sandbox, setupError, pricing,
    interrupted: false, secrets, fault,
  });
  await publishDraft(env, cell, draft, staged.pristine, true);
  return { execution: draft.execution, usageResetAt: draft.usage_reset_at };
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
  const workDir = join(env.privateRoot, "judge", `${e.id}-${crypto.randomUUID().slice(0, 8)}`);
  try {
    const { judgment, log } = await judge(env.lane, {
      executionId: e.id, workspaceHash: art.workspace_hash, task: cell.task, oracleHash, pristine,
      artifact: join(env.resultsRoot, art.stored_path), symbolIds: new Set(env.symbols.map((s) => s.app_id.toLowerCase())),
      workDir, lock: { store: env.symbolStore, packages: env.symbols }, deploy: env.deploy,
    }, env.now);
    await env.store.writeJudgment(judgment);
    await writeVerdictLog(env.resultsRoot, log);
    return judgment;
  } finally {
    await Deno.remove(workDir, { recursive: true }).catch(() => {});
  }
}

/** Judge a stored execution again: restage the task, never re-run the agent. */
export async function rejudgeExecution(env: HarnessEnv, cell: CellRef, e: ExecutionRecord, oracleHash: string): Promise<JudgmentRecord> {
  const out = join(env.privateRoot, "work", `rejudge-${e.id}-${crypto.randomUUID().slice(0, 8)}`);
  try {
    return await judgeExecution(env, cell, e, (await stage(env, cell, out)).pristine, oracleHash);
  } finally {
    await Deno.remove(out, { recursive: true }).catch(() => {});
  }
}

export interface CellResult {
  executions: ExecutionRecord[];
  /** Reset time (or "unknown") when a usage limit paused the cell. */
  pause: string | null;
  /** Why an automatic retry the policy allows was not started (supervised mode). */
  withheld: string | null;
  /** Why no further automatic retry is allowed (Part 1 retryProblem). */
  stopped: string | null;
}

/** One cell: run, judge per policy, automatic retries decided by ancestry (never in supervised mode). */
export async function runCell(
  env: HarnessEnv,
  cell: CellRef,
  first: AttemptRef = { attempt: 1, runKind: "planned", retryOf: null },
  prior: ExecutionRecord[] = [],
): Promise<CellResult> {
  const executions: ExecutionRecord[] = [];
  let at = first;
  for (;;) {
    const { execution: e, usageResetAt } = await runExecution(env, cell, at);
    executions.push(e);
    const policy = outcomePolicy(e.termination, e.did_work);
    if (policy.retry === "after_usage_reset") return { executions, pause: usageResetAt ?? "unknown", withheld: null, stopped: null };
    if (policy.retry === "none") return { executions, pause: null, withheld: null, stopped: null };
    const all = [...prior, ...executions];
    const grandparent = all.find((x) => x.id === e.retry_of);
    const candidate = { ...e, id: "(next automatic retry)", run_kind: "auto_retry" as const, retry_of: e.id };
    const problem = retryProblem(e, candidate, grandparent);
    if (problem) return { executions, pause: null, withheld: null, stopped: problem };
    if (env.supervised) {
      return { executions, pause: null, withheld: `automatic retry after ${e.termination} withheld in supervised mode`, stopped: null };
    }
    at = { attempt: Math.max(...all.map((x) => x.attempt)) + 1, runKind: "auto_retry", retryOf: e.id };
  }
}

/** Complete every attempt a killed runner left behind (review gate 5, round 2 item 3, round 3 B3). */
export async function recoverInterrupted(
  env: HarnessEnv,
  loadTaskFn: (dir: string) => Promise<LoadedTask>,
): Promise<ExecutionRecord[]> {
  const dir = join(env.privateRoot, "intents");
  const recovered: ExecutionRecord[] = [];
  let names: string[] = [];
  try {
    names = [...Deno.readDirSync(dir)].filter((e) => e.isFile && e.name.endsWith(".json")).map((e) => e.name).sort();
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  const opMs = env.opTimeoutMs ?? OP_TIMEOUT_MS;
  for (const n of names) {
    const intent = JSON.parse(await Deno.readTextFile(join(dir, n))) as Intent;
    const id = intent.execution_id;
    // Publish into the store of the command that started the attempt, whatever command recovers it.
    const store = new RecordStore(intent.results_root);
    const own: HarnessEnv = { ...env, resultsRoot: intent.results_root, store };
    if (intent.phase === "published") {
      await finishCleanup(own, id);
      continue;
    }
    const p = privatePaths(own, id);
    const { task_dir, ...rest } = intent.cell;
    // The task comes from the private snapshot: a deleted or edited task never blocks or relabels recovery.
    const cell: CellRef = { ...rest, task: await loadTaskFn(intent.task_snapshot) };
    const current = await loadTaskFn(task_dir).catch(() => null);
    const ids = current ? await taskSetIdentity(env.repoRoot, [current], env.symbols).catch(() => null) : null;
    const taskUnchanged = ids !== null && ids.tasks[0]!.visible === cell.taskVisibleHash && ids.tasks[0]!.oracle === cell.oracleHash;
    let draft = await Deno.readTextFile(join(p.pending, "draft.json")).then((t) => JSON.parse(t) as Draft, () => null);
    if (!draft) {
      if (await bounded(env.docker.state(intent.sandbox), opMs, `docker inspect ${intent.sandbox}`) !== null) {
        await bounded(env.docker.rm(intent.sandbox), opMs, `docker rm -f ${intent.sandbox}`);
        if (await bounded(env.docker.state(intent.sandbox), opMs, `docker inspect ${intent.sandbox}`) !== null) {
          throw new ContainerError(`recovery: ${intent.sandbox} still exists; intent kept`, intent.sandbox, "stop");
        }
      }
      const released = intent.phase === "released";
      const secrets = released ? await readCustody(p.custody) : [];
      draft = await buildDraft(own, {
        id, cell, at: intent.at, started_at: intent.started_at, manifest: intent.manifest,
        workspace: intent.workspace, pristineHash: intent.pristine_hash,
        sandbox: {
          exitCode: null, started: released, startError: released ? null : "interrupted before any secret was released",
          timedOut: false, interrupted: false, overflow: false, confirmedGone: true, cleanup: "ok", wall_ms: 0,
        },
        setupError: released ? null : "interrupted before any secret was released", pricing: intent.pricing,
        interrupted: true, secrets, fault: null,
      });
    }
    await publishDraft(own, cell, draft, null, taskUnchanged);
    if (!taskUnchanged) console.warn(`[WARN] ${id}: task files changed or unavailable since the attempt; recorded, not judged (use harness rejudge)`);
    recovered.push(draft.execution);
  }
  return recovered;
}
```

Notes for the implementer:
- `runExecution` inspects the pinned image by immutable id, so retagging never substitutes an image and never invalidates a pinned one.
- The intent's phase, not the custody file's existence, decides: `prepared` means nothing was released (exact zero), `released` means the sandbox may have started, so its custody must be readable or recovery stops.
- `publishDraft` is idempotent step by step; the `run` step copies into `runs/.tmp-*` and renames, so a partial copy never looks published (M1-07's `sweepTemp` removes leftover temp names under `results/`).
- The recovery-crash test simulates a kill before the draft through `hooks.beforeDraft`; the per-step tests use `hooks.after`.

- [ ] **Step 4: Run them and see them pass**

Run: `deno test --allow-all tests/unit/harness/records.test.ts tests/unit/harness/credential-budget.test.ts tests/unit/harness/images.test.ts tests/unit/harness/execution.test.ts`
Expected: all pass (execution: 26 tests including the five per-step recovery tests; credential budget: 3).

- [ ] **Step 5: Check, lint, format** (the files above)

- [ ] **Step 6: Commit**

```bash
# first commit, due 10-02 (before M4-17's 10-03 pilot):
git add src/harness/credential-budget.ts scripts/harness/reserve-credential-run.ts tests/unit/harness/credential-budget.test.ts
git commit -m "feat(harness): shared cross-lane credential-run budget and reservation helper"
# then:
git add src/harness/records.ts src/harness/integrity.ts src/harness/report.ts src/harness/images.ts src/harness/execution.ts tests/unit/harness/fixtures.ts tests/unit/harness/records.test.ts tests/unit/harness/integrity.test.ts tests/unit/harness/report.test.ts tests/unit/harness/runtime-fixture.ts tests/unit/harness/images.test.ts tests/unit/harness/execution.test.ts
git commit -m "feat(harness): execution pipeline with private state, transactional publication, recovery and versioned execution records"
```

**Acceptance:** the four test files pass (per-step crash recovery, credential rotation before recovery, workspace-only and UTF-16 leaks, capture failure after the spawn, unconfirmed termination, ancestry retries and the shared ledger among them); records pass Part 1's `ExecutionRecordSchema` and `validateCampaignRecords` (M1-07b) where a campaign exists; check, lint and `deno fmt --check` clean.

---

### Task M1-24: thin CLI for the slice: `cell`, `judge-fixture`, `images build`, `symbols lock`, task revisions, qualification manifest

Spec 1a section 10 (`harness cell <config> <task>`, `harness images build <harness>`; Cliffy, no `--no-X` option added), section 8 (`acquireBenchLock` held before anything touches Docker or a container), M0-03 carryover (b) startup sweep, review gate 5 (recovery at every start), review round 2 items 2, 4, 5, 9 and 11: an operator interrupt stops the sandbox at once; `checkModelsInCatalog` per Part 1's contract; oracle ids only for tasks that have an oracle; the base image passed into the harness build and verified by layers; the health monitor wired into the lane; one shared credential budget with fail-closed egress state; immutable task revisions; full `judge-fixture` persistence; the qualification manifest shared with M4. Containers: Cronus28 and Cronus284 are refused by name.

`harness run`, `rejudge` and `qualify` are After 10-05 (M1-24b). The wiring lives in `cli/commands/harness-env.ts` because it imports `cli/commands/bench/container-setup.ts`; `src/harness/` stays free of CLI imports.

Rules:
- **Cell gating** (`cellGate`, pure): a non-credential-bearing arm (mocks, M1-35) runs unattended; a credential-bearing arm runs when egress is enforced and verified, or with `--supervised` from an interactive terminal (then M1-22 reserves in the shared ledger before any credential is released).
- **Egress state fails closed** (`resolveEgress`): no marker means not enforced; a marker in state `authorized` counts only if the host verification passes now; a marker whose verification fails **stops** the command (it never downgrades to another supervised run). Until M1-33 lands, the verifier reports "not implemented" and any marker therefore stops the command.
- **Shared credential ledger**: `--credential-ledger` or `CG_CREDENTIAL_LEDGER` (the orchestrator sets one path for every lane, see the integrated schedule); absent means every credential-bearing supervised run is refused. `scripts/harness/reserve-credential-run.ts` (delivered by M1-22's first commit on 10-02) is the same reservation for M4-17's pilot runner.
- **Bounded shutdown** (round 3 B2): closing the environment bounds the backend server's shutdown (10 s); a server that does not stop in time is reported and abandoned (the process exits) rather than awaited forever.
- **Interrupt**: `harness cell` installs a Ctrl+C handler that aborts the execution's `stop` signal; the sandbox is killed at once (bounded), and the attempt is finalized (or recovered at the next start).
- **Task revisions**: `--rev <commit-or-tag>` loads the task from `git archive` of that revision into private storage; the judgment provenance records the commit and the task tree id (`git rev-parse <rev>:harness-tasks/tasks/<id>`, the same tree M4's audits name). Without `--rev` the working tree is used and recorded as such.
- **`judge-fixture` persistence**: each run writes `<results-dir>/fixtures/<task>/<variant>/<judgment-id>/` (default `results/harness/fixtures/...`; the path is built once from `--results-dir`, round 3 note) with `judgment.json` (the complete judgment record: every scorer, every test row with its target), `provenance.json` (task id, variant, variant tree hash, task commit and tree, visible and oracle hashes, refapp version and commit, workspace hash, scorer fingerprint, container, command line) and the verdict log.
- **Qualification manifest** (`src/harness/qualify.ts`, shared with M4): `{ v: 1, refapp_version, tasks: { "<HX id>": { rev, positive: "correct" | "reference-tests", naive: string[] } } }`; `judge-fixture --manifest <path>` refuses a variant or revision the manifest does not list for that task.

**Lane:** infra (stream A). **Deps:** M1-10 (`registerHarnessCommand`), M1-03 (`checkModelsInCatalog`), M1-13, M1-16, M1-17, M1-19, M1-21, M1-22, M1-32. **Date:** 10-04.

**Files:**
- Create: `cli/commands/harness-env.ts`, `src/harness/task-rev.ts`, `src/harness/qualify.ts`, `harness/images/pins.json`, `scripts/harness/backend-probe.ts`, `scripts/harness/cg-al-probe.ps1`
- Modify: `cli/commands/harness-command.ts` (four subcommands and exported action functions)
- Test: `tests/unit/cli/commands/harness-command.test.ts` (append), `tests/unit/harness/task-rev.test.ts`

**Interfaces:**
- Produces (task-rev.ts): `interface TaskAt { task: LoadedTask; commit: string | null; tree: string | null }`; `loadTaskAt(repoRoot, taskId, rev: string | null, outDir): Promise<TaskAt>`.
- Produces (qualify.ts): `QualifyManifestSchema`; `type QualifyManifest`; `loadQualifyManifest(path)`; `variantAllowed(m, taskId, variant, rev): string | null` (the refusal reason or null).
- Produces (harness-env.ts): `REFUSED_CONTAINERS`; `EGRESS_MARKER = "egress-verified.json"`; `interface EgressVerifier { (): Promise<string[]> }`; `resolveEgress(sharedResults, verify): Promise<boolean>`; `interface EnvOptions { repoRoot; resultsDir; containers; backendHost?; backendPort; secretsSource; symbolStore; privateRoot; credentialLedger: string | null; command; supervised }`; `interface EnvDeps { acquireLock; docker(); setup(names); resolveHost(); owner(); health(names): HealthView; verifyEgress: EgressVerifier }`; `REAL_DEPS`; `interface OpenEnv { env; close() }`; `openHarnessEnv(o, deps?)`.
- Produces (harness-command.ts): `cellGate(adapter, o: { supervised; egressEnforced }, isTerminal): void`; `interface CellCliOptions { root; resultsDir; containers; backendHost?; backendPort; secretsDir; symbolStore; privateDir; credentialLedger: string | null; supervised: boolean; repeat: number; rev: string | null }`; `harnessCell(configId, taskId, o, open?, isTerminal?, onInterrupt?)`; `harnessJudgeFixture(taskId, variant, o & { manifest: string | null }, open?)`; `harnessImagesBuild(harness, o: { root; version? }, docker?)`; `harnessSymbolsLock(o, read?)`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/harness/task-rev.test.ts`:

```typescript
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { loadTaskAt } from "../../../src/harness/task-rev.ts";
import { git, makeRefappRepo, write } from "./refapp-fixture.ts";

Deno.test("loadTaskAt: a tag yields the task as committed, with commit and tree; no rev is the working tree", async () => {
  const repo = await makeRefappRepo();
  await git(repo.root, "add", ".");
  await git(repo.root, "commit", "-q", "-m", "tasks");
  await git(repo.root, "tag", "refapp-v1-rc1");
  await write(repo.root, "harness-tasks/tasks/HX-001/correct/Rental/src/Rental.Codeunit.al", "// edited after the tag\n");
  const at = await loadTaskAt(repo.root, "HX-001", "refapp-v1-rc1", await Deno.realPath(await Deno.makeTempDir()));
  assertEquals(at.commit!.length, 40);
  assertEquals(at.tree!.length, 40);
  assertStringIncludes(await Deno.readTextFile(join(at.task.dir, "correct", "Rental", "src", "Rental.Codeunit.al")), "FIXED");
  const wt = await loadTaskAt(repo.root, "HX-001", null, await Deno.realPath(await Deno.makeTempDir()));
  assertEquals([wt.commit, wt.tree], [null, null]);
  // Production passes a directory that does not exist yet (harness cell --rev).
  const fresh = join(await Deno.realPath(await Deno.makeTempDir()), "work", "task-new");
  assertEquals((await loadTaskAt(repo.root, "HX-001", "refapp-v1-rc1", fresh)).commit, at.commit);
  assertStringIncludes(await Deno.readTextFile(join(wt.task.dir, "correct", "Rental", "src", "Rental.Codeunit.al")), "edited after the tag");
});
```

(`git` is exported from `refapp-fixture.ts`; `makeRefappRepo` leaves the task files uncommitted, so the test commits them first.)

Append to `tests/unit/cli/commands/harness-command.test.ts` (merge imports into the file's import block):

```typescript
import { join as joinPath } from "@std/path";
import { type EnvDeps, EGRESS_MARKER, openHarnessEnv, resolveEgress } from "../../../../cli/commands/harness-env.ts";
import { cellGate, harnessCell, harnessImagesBuild, harnessJudgeFixture, harnessSymbolsLock } from "../../../../cli/commands/harness-command.ts";
import { ConfigurationError } from "../../../../src/errors.ts";
import { claudeCodeAdapter } from "../../../../src/harness/adapters/claude-code.ts";
import { loadSymbolsLock } from "../../../../src/harness/identity.ts";
import { BASE_IMAGE } from "../../../../src/harness/images.ts";
import { BenchLockHeldError } from "../../../../src/utils/bench-lock.ts";
import { FakeBc } from "../../harness/fake-bc.ts";
import { FakeDocker } from "../../harness/fake-docker.ts";
import { git, write } from "../../harness/refapp-fixture.ts";
import { ccBehavior, makeEnv, probeLines, type TestEnv } from "../../harness/runtime-fixture.ts";

function deps(order: string[], lock?: () => never, verify: () => Promise<string[]> = () => Promise.resolve(["not implemented (M1-33)"])): EnvDeps {
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
    health: (names) => {
      order.push(`health:${names.join(",")}`);
      return { getState: () => ({ containers: [] }), record: () => {} };
    },
    verifyEgress: verify,
  };
}

const envOpts = (t: TestEnv, containers = ["Cronus281"]) => ({
  repoRoot: t.repo.root, resultsDir: t.env.resultsRoot, containers, backendPort: 0, secretsSource: t.env.secretsSource,
  symbolStore: t.repo.symbolStore, privateRoot: t.env.privateRoot, credentialLedger: t.env.credentialLedger, command: "test", supervised: true,
});

const cellOpts = (t: TestEnv, over: Record<string, unknown> = {}) => ({
  root: t.repo.root, resultsDir: t.env.resultsRoot, containers: ["Cronus281"], backendPort: 0, secretsDir: t.env.secretsSource,
  symbolStore: t.repo.symbolStore, privateDir: t.env.privateRoot, credentialLedger: t.env.credentialLedger, supervised: true,
  repeat: 1, rev: null, ...over,
});

const opener = (t: TestEnv) => () => Promise.resolve({ env: t.env, close: () => Promise.resolve() });
const noInterrupt = () => () => {};

Deno.test("openHarnessEnv: refused containers first, then lock, sweep, containers, health monitor, backend; release last", async () => {
  const t = await makeEnv();
  const order: string[] = [];
  await assertRejects(() => openHarnessEnv(envOpts(t, ["Cronus281", "Cronus28"]), deps(order)), ConfigurationError, "Cronus28");
  await assertRejects(() => openHarnessEnv(envOpts(t, ["cronus284"]), deps(order)), ConfigurationError, "Cronus284");
  assertEquals(order, []);
  const h = await openHarnessEnv(envOpts(t), deps(order));
  assertEquals(h.env.deploy.ledgerRoot, joinPath(t.repo.root, "results", "harness", "bc-ledger"), "one ledger scope for every caller");
  await h.close();
  assertEquals(order, ["lock", "sweep", "setup", "health:Cronus281", "host", "release"]);
});

Deno.test("openHarnessEnv: owned ids come only from tasks that have an oracle app", async () => {
  const t = await makeEnv();
  await write(t.repo.tasksDir, "HX-002/task.yml", "id: HX-002\nrefapp_version: refapp-v1\nkind: test-authoring\nprompt: prompt.md\nsource: refapp\nscorers: [build, mutant_kill]\n");
  await write(t.repo.tasksDir, "HX-002/prompt.md", "x");
  await write(t.repo.tasksDir, "HX-002/correct/Rental/src/R.al", "x");
  const h = await openHarnessEnv(envOpts(t), deps([]));
  assert(h.env.deploy.owned.has("c6a1e000-0000-4000-8000-0000000000f1"));
  await h.close();
});

Deno.test("openHarnessEnv: a held bench lock stops before any docker call", async () => {
  const t = await makeEnv();
  const order: string[] = [];
  const held = () => {
    throw new BenchLockHeldError(null, "results/.bench-running.json");
  };
  await assertRejects(() => openHarnessEnv(envOpts(t), deps(order, held)), BenchLockHeldError);
  assertEquals(order, []);
});

Deno.test("resolveEgress: no marker is not enforced; a marker that fails verification stops; only verified authorized counts", async () => {
  const root = await Deno.realPath(await Deno.makeTempDir());
  assertEquals(await resolveEgress(root, () => Promise.resolve([])), false);
  await Deno.writeTextFile(joinPath(root, EGRESS_MARKER), JSON.stringify({ v: 1, state: "authorized" }));
  await assertRejects(() => resolveEgress(root, () => Promise.resolve(["rule cg-harness-egress-tcp disabled"])), ConfigurationError, "disabled");
  assertEquals(await resolveEgress(root, () => Promise.resolve([])), true);
  await Deno.writeTextFile(joinPath(root, EGRESS_MARKER), JSON.stringify({ v: 1, state: "qualified" }));
  assertEquals(await resolveEgress(root, () => Promise.resolve([])), false);
});

Deno.test("cellGate: credential-bearing arms need enforcement, or --supervised at a terminal; others run unattended", () => {
  const mock = { ...claudeCodeAdapter, credentialBearing: false };
  cellGate(mock, { supervised: false, egressEnforced: false }, () => false);
  cellGate(claudeCodeAdapter, { supervised: false, egressEnforced: true }, () => false);
  cellGate(claudeCodeAdapter, { supervised: true, egressEnforced: false }, () => true);
  assertThrows(() => cellGate(claudeCodeAdapter, { supervised: false, egressEnforced: false }, () => true), ConfigurationError, "--supervised");
  assertThrows(() => cellGate(claudeCodeAdapter, { supervised: true, egressEnforced: false }, () => false), ConfigurationError, "terminal");
});

Deno.test("harnessCell: one supervised cell; the reservation lands in the shared ledger", async () => {
  const t = await makeEnv();
  const r = await harnessCell("cc-sonnet-plain", "HX-001", cellOpts(t), opener(t), () => true, noInterrupt);
  assertEquals([r.executions.length, r.executions[0]!.termination], [1, "completed"]);
  assertEquals((await Deno.readTextFile(t.env.credentialLedger!)).trim().split("\n").length, 1);
});

Deno.test("harnessCell: Ctrl+C stops the sandbox at once and the attempt is recorded", async () => {
  const t = await makeEnv();
  let fire: () => void = () => {};
  t.docker.behavior = async (call, io) => {
    await ccBehavior(joinPath(t.repo.tasksDir, "HX-001"), "correct", (await probeLines()).slice(0, 12))(call, io);
    fire();
    await io.killed;
    return 137;
  };
  const r = await harnessCell("cc-sonnet-plain", "HX-001", cellOpts(t), opener(t), () => true, (cb) => {
    fire = cb;
    return () => {};
  });
  assertEquals(r.executions[0]!.termination, "harness_crash");
  assertEquals(t.docker.kills.length, 1);
});

Deno.test("harnessJudgeFixture: complete judgment and provenance persisted; variants and revisions follow the manifest", async () => {
  const t = await makeEnv();
  await git(t.repo.root, "add", ".");
  await git(t.repo.root, "commit", "-q", "-m", "tasks");
  await git(t.repo.root, "tag", "refapp-v1-rc1");
  const manifest = joinPath(t.env.privateRoot, "qualify-manifest.json");
  await Deno.writeTextFile(manifest, JSON.stringify({ v: 1, refapp_version: "refapp-v1", tasks: { "HX-001": { rev: "refapp-v1-rc1", positive: "correct", naive: ["a"] } } }));
  const o = cellOpts(t, { rev: "refapp-v1-rc1", manifest });
  const pass = await harnessJudgeFixture("HX-001", "correct", o, opener(t));
  assertEquals(pass.verdict, "pass");
  const dir = joinPath(t.env.resultsRoot, "fixtures", "HX-001", "correct", pass.id);
  const saved = JSON.parse(await Deno.readTextFile(joinPath(dir, "judgment.json")));
  assertEquals(saved.scorers.map((s: { name: string }) => s.name), ["build", "pass_to_pass", "fail_to_pass"]);
  const prov = JSON.parse(await Deno.readTextFile(joinPath(dir, "provenance.json")));
  assertEquals([prov.task_id, prov.variant, prov.rev, prov.task_commit.length, prov.task_tree.length], ["HX-001", "correct", "refapp-v1-rc1", 40, 40]);
  assertEquals(prov.workspace_hash, pass.workspace_hash);
  assertEquals((await harnessJudgeFixture("HX-001", "naive/a", o, opener(t))).verdict, "fail");
  await assertRejects(() => harnessJudgeFixture("HX-001", "naive/zz", o, opener(t)), ConfigurationError, "not listed");
  await assertRejects(() => harnessJudgeFixture("HX-001", "correct", { ...o, rev: null }, opener(t)), ConfigurationError, "refapp-v1-rc1");
  await assertRejects(() => harnessJudgeFixture("HX-001", "naive/../oracle", { ...o, manifest: null }, opener(t)), ConfigurationError, "variant");
  assertEquals(await t.env.store.executions("11111111-2222-4333-8444-555555555555"), [], "fixtures never create executions");
});

Deno.test("harnessImagesBuild: base needs a digest pin; the harness build gets the base and is verified by layers", async () => {
  const root = await Deno.realPath(await Deno.makeTempDir());
  const docker = new FakeDocker();
  await assertRejects(() => harnessImagesBuild("base", { root }, docker), ConfigurationError, "pins.json");
  await Deno.mkdir(joinPath(root, "harness", "images"), { recursive: true });
  await Deno.writeTextFile(joinPath(root, "harness", "images", "pins.json"), JSON.stringify({ servercore: "mcr.microsoft.com/windows/servercore:ltsc2025" }));
  await assertRejects(() => harnessImagesBuild("base", { root }, docker), ConfigurationError, "@sha256:");
  const pin = `mcr.microsoft.com/windows/servercore@sha256:${"e".repeat(64)}`;
  await Deno.writeTextFile(joinPath(root, "harness", "images", "pins.json"), JSON.stringify({ servercore: pin }));
  await assertRejects(() => harnessImagesBuild("claude-code", { root, version: "2.1.282" }, docker), ConfigurationError, "base");
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1", "l2"]);
  await harnessImagesBuild("base", { root }, docker);
  assertStringIncludes(docker.builds[0]!.join(" "), `SERVERCORE=${pin}`);
  const labels = { "centralgauge.harness": "claude-code", "centralgauge.harness.version": "2.1.282", "centralgauge.harness.base_digest": baseId };
  docker.addImage("centralgauge/harness-claude-code:2.1.282", `sha256:${"c".repeat(64)}`, labels, ["l1", "l2", "l3"]);
  const f = await harnessImagesBuild("claude-code", { root, version: "2.1.282" }, docker);
  const args = docker.builds[1]!.join(" ");
  assertStringIncludes(args, `BASE=${BASE_IMAGE}`);
  assertStringIncludes(args, `centralgauge.harness.base_digest=${baseId}`);
  assertEquals(f.digest, `sha256:${"c".repeat(64)}`);
  docker.addImage("centralgauge/harness-claude-code:2.1.282", `sha256:${"d".repeat(64)}`, labels, ["x1", "l3"]);
  await assertRejects(() => harnessImagesBuild("claude-code", { root, version: "2.1.282" }, docker), ConfigurationError, "layers");
});

Deno.test("harnessSymbolsLock: writes a strict lock the identity accepts", async () => {
  const root = await Deno.realPath(await Deno.makeTempDir());
  const from = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(joinPath(from, "Microsoft_System_28.0.0.0.app"), "sys");
  const n = await harnessSymbolsLock(
    { root, from, store: joinPath(root, "store") },
    () => Promise.resolve({ id: "8874ed3a-0643-4247-9ced-7a7002f7135d", name: "System", publisher: "Microsoft", version: "28.0.0.0" }),
  );
  assertEquals([n, (await loadSymbolsLock(root))!.length], [1, 1]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `deno test --allow-all tests/unit/harness/task-rev.test.ts tests/unit/cli/commands/harness-command.test.ts`
Expected: FAIL, `Module not found ".../src/harness/task-rev.ts"`.

- [ ] **Step 3: Implement `src/harness/task-rev.ts` and `src/harness/qualify.ts`**

```typescript
/** Load a task from an immutable git revision (round 2 item 11). */

import { join } from "@std/path";
import { ValidationError } from "../errors.ts";
import { type LoadedTask, loadTask } from "./task.ts";

export interface TaskAt {
  task: LoadedTask;
  /** Resolved commit, or null for the working tree. */
  commit: string | null;
  /** Tree id of harness-tasks/tasks/<id> at that commit (M4's TASK TREE), or null. */
  tree: string | null;
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  const out = await new Deno.Command("git", { args, cwd: repoRoot, stdout: "piped", stderr: "piped" }).output();
  if (!out.success) throw new ValidationError(`git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr).trim()}`, args);
  return new TextDecoder().decode(out.stdout).trim();
}

export async function loadTaskAt(repoRoot: string, taskId: string, rev: string | null, outDir: string): Promise<TaskAt> {
  if (!/^HX-\d{3}$/.test(taskId)) throw new ValidationError(`not a task id: ${taskId}`, [taskId]);
  const rel = `harness-tasks/tasks/${taskId}`;
  if (rev === null) return { task: await loadTask(join(repoRoot, rel)), commit: null, tree: null };
  const commit = await git(repoRoot, ["rev-parse", "--verify", `${rev}^{commit}`]);
  const tree = await git(repoRoot, ["rev-parse", `${commit}:${rel}`]);
  await Deno.mkdir(outDir, { recursive: true });
  const tar = join(outDir, `${taskId}-${commit.slice(0, 12)}.tar`);
  await git(repoRoot, ["archive", "--format=tar", "-o", tar, commit, rel]);
  const out = await new Deno.Command("tar", { args: ["-xf", tar, "-C", outDir], stdout: "null", stderr: "piped" }).output();
  if (!out.success) throw new ValidationError(`tar: ${new TextDecoder().decode(out.stderr).trim()}`, [tar]);
  return { task: await loadTask(join(outDir, ...rel.split("/"))), commit, tree };
}
```

```typescript
/**
 * The qualification manifest shared with M4 (M4-14 writes it; M1-38 and
 * M4-15 read it): per task, the immutable revision to judge, the positive
 * variant and every named naive variant.
 */

import { z } from "zod";
import { ConfigurationError } from "../errors.ts";

export const QualifyManifestSchema = z.strictObject({
  v: z.literal(1),
  refapp_version: z.string().min(1),
  tasks: z.record(
    z.string().regex(/^HX-\d{3}$/),
    z.strictObject({
      rev: z.string().min(1),
      positive: z.enum(["correct", "reference-tests"]),
      naive: z.array(z.string().regex(/^[A-Za-z0-9_-]+$/)).min(1),
    }),
  ),
});
export type QualifyManifest = z.output<typeof QualifyManifestSchema>;

export async function loadQualifyManifest(path: string): Promise<QualifyManifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(await Deno.readTextFile(path));
  } catch (err) {
    throw new ConfigurationError(`qualification manifest ${path}: ${err instanceof Error ? err.message : err}`);
  }
  const r = QualifyManifestSchema.safeParse(raw);
  if (!r.success) throw new ConfigurationError(`qualification manifest ${path}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

/** Why the manifest refuses this (task, variant, rev), or null. */
export function variantAllowed(m: QualifyManifest, taskId: string, variant: string, rev: string | null): string | null {
  const t = m.tasks[taskId];
  if (!t) return `${taskId} is not listed in the qualification manifest`;
  if (rev !== t.rev) return `${taskId} must be judged at ${t.rev} (got ${rev ?? "the working tree"})`;
  const listed = [t.positive, ...t.naive.map((n) => `naive/${n}`)];
  return listed.includes(variant) ? null : `${taskId} variant ${variant} is not listed (listed: ${listed.join(", ")})`;
}
```

- [ ] **Step 4: Implement `cli/commands/harness-env.ts`**

```typescript
/**
 * Real Harness Bench environment for the CLI. Order: refused containers, the
 * bench lock, temp and sandbox sweeps (M0-03 b), containers with a health
 * monitor, lane, backend on the container-facing address (M0-05), egress
 * state (fail closed), then recovery of interrupted executions.
 */

import * as colors from "@std/fmt/colors";
import { join } from "@std/path";
import type { BcContainerProvider } from "../../src/container/bc-container-provider.ts";
import type { HarnessBc, HealthView } from "../../src/harness/bc-lane.ts";
import type { HarnessEnv } from "../../src/harness/execution.ts";
import type { DockerCli } from "../../src/harness/sandbox.ts";
import { ConfigManager } from "../../src/config/config.ts";
import { ConfigurationError, ValidationError } from "../../src/errors.ts";
import { Backend, defaultBackendOps, resolveBackendHost } from "../../src/harness/backend.ts";
import { BcLane } from "../../src/harness/bc-lane.ts";
import { BENCH_CANDIDATE_APP_ID } from "../../src/harness/bc-apps.ts";
import { recoverInterrupted } from "../../src/harness/execution.ts";
import { sweepWorkspaceTemp } from "../../src/harness/fsutil.ts";
import { loadSymbolsLock, SYMBOLS_LOCK_PATH } from "../../src/harness/identity.ts";
import { loadPricingBook } from "../../src/harness/pricing.ts";
import { RecordStore } from "../../src/harness/records.ts";
import { bounded, realDocker, sweepOwnedSandboxes } from "../../src/harness/sandbox.ts";
import { loadTask, loadTaskSet } from "../../src/harness/task.ts";
import { ContainerHealthMonitor } from "../../src/health/monitor.ts";
import { acquireBenchLock, DEFAULT_BENCH_LOCK_DIR } from "../../src/utils/bench-lock.ts";
import { setupContainers } from "./bench/container-setup.ts";

/** Cronus28 hosts a foreign app on codeunit 80013; Cronus284 is untouched pending the owner. */
export const REFUSED_CONTAINERS = ["Cronus28", "Cronus284"];
export const EGRESS_MARKER = "egress-verified.json";

/** Host egress verification; M1-33 supplies the real one. Returns problems; empty means verified. */
export type EgressVerifier = () => Promise<string[]>;

export interface EnvOptions {
  repoRoot: string;
  /** Records root of this command (results/harness, or .../cells, .../fixtures). */
  resultsDir: string;
  containers: string[];
  backendHost?: string | undefined;
  backendPort: number;
  secretsSource: string;
  symbolStore: string;
  privateRoot: string;
  credentialLedger: string | null;
  command: string;
  supervised: boolean;
}

export interface EnvDeps {
  acquireLock: (dir: string, o: { command: string }) => () => Promise<void>;
  docker: () => DockerCli;
  setup(names: string[]): Promise<{ bc: HarnessBc; names: string[]; dispose(): Promise<void> }>;
  resolveHost(): Promise<string>;
  owner(): string;
  health(names: string[]): HealthView;
  verifyEgress: EgressVerifier;
}

export const REAL_DEPS: EnvDeps = {
  acquireLock: (dir, o) => acquireBenchLock(dir, o),
  docker: () => realDocker(),
  async setup(names) {
    const cfg = await ConfigManager.loadConfig();
    const r = await setupContainers(names, "bccontainer", cfg.container ?? {});
    const bc = r.containerProvider as BcContainerProvider;
    return { bc, names: r.containerNames, dispose: () => bc.dispose() };
  },
  resolveHost: resolveBackendHost,
  owner: () => Deno.hostname(),
  health: (names) => new ContainerHealthMonitor({ windowSize: 20, expectedContainerNames: names }),
  // Replaced by M1-33 with verifyEgressState(await collectEgressState()).
  verifyEgress: () => Promise.resolve(["egress verification is not implemented yet (M1-33)"]),
};

export interface OpenEnv {
  env: HarnessEnv;
  close(): Promise<void>;
}

/** Enforcement counts only when the marker says authorized AND the host verifies now; a failing marker stops. */
export async function resolveEgress(sharedResults: string, verify: EgressVerifier): Promise<boolean> {
  let marker: { state?: string } | null = null;
  try {
    marker = JSON.parse(await Deno.readTextFile(join(sharedResults, EGRESS_MARKER)));
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  if (marker === null) return false;
  const problems = await verify();
  if (problems.length > 0) {
    throw new ConfigurationError(`egress marker present but verification failed, refusing to run: ${problems.join("; ")}`);
  }
  return marker.state === "authorized";
}

/** Oracle app ids of the tasks that have an oracle, plus the bench candidate id. */
async function ownedIds(repoRoot: string): Promise<Set<string>> {
  const owned = new Set([BENCH_CANDIDATE_APP_ID]);
  for (const t of await loadTaskSet(join(repoRoot, "harness-tasks", "tasks"))) {
    if (t.task.fail_to_pass === null) continue;
    const aj = JSON.parse(await Deno.readTextFile(join(t.dir, "oracle", "app.json"))) as { id: string };
    owned.add(aj.id.toLowerCase());
  }
  return owned;
}

export async function openHarnessEnv(o: EnvOptions, deps: EnvDeps = REAL_DEPS): Promise<OpenEnv> {
  const refused = o.containers.filter((c) => REFUSED_CONTAINERS.some((r) => r.toLowerCase() === c.toLowerCase()));
  if (refused.length > 0) {
    throw new ConfigurationError(`harness refuses container(s) ${refused.join(", ")} (Cronus28: codeunit 80013 collision; Cronus284: owner pending)`);
  }
  if (o.containers.length === 0) throw new ConfigurationError("pass --containers (BC containers the harness may use)");
  const symbols = await loadSymbolsLock(o.repoRoot);
  if (!symbols) {
    throw new ValidationError("no symbols lock: run `centralgauge harness symbols lock --from <dir> --store <dir>`", [SYMBOLS_LOCK_PATH]);
  }
  const sharedResults = join(o.repoRoot, "results", "harness");
  const release = deps.acquireLock(DEFAULT_BENCH_LOCK_DIR, { command: o.command });
  const closers: (() => Promise<void>)[] = [release];
  const closeAll = async () => {
    for (const c of closers) await c().catch(() => {});
  };
  try {
    const store = new RecordStore(o.resultsDir);
    await Deno.mkdir(join(o.privateRoot, "work"), { recursive: true });
    await store.sweepTemp();
    await sweepWorkspaceTemp(o.resultsDir, o.privateRoot);
    const docker = deps.docker();
    const owner = deps.owner();
    const swept = await sweepOwnedSandboxes(docker, owner);
    if (swept.length > 0) console.log(`${colors.yellow("[WARN]")} removed ${swept.length} leftover sandbox(es): ${swept.join(", ")}`);
    const ready = await deps.setup(o.containers);
    closers.unshift(ready.dispose);
    const lane = new BcLane(ready.bc, ready.names, { health: deps.health(ready.names) });
    const host = o.backendHost ?? await deps.resolveHost();
    const backend = new Backend({
      approvedRoots: [join(o.privateRoot, "work")], workRoot: join(o.privateRoot, "backend"), ops: defaultBackendOps(lane),
      allowedHosts: [host], docker,
    });
    const server = backend.serve(host, o.backendPort);
    closers.unshift(async () => {
      try {
        await bounded(server.shutdown(), 10_000, "backend server shutdown");
      } catch (err) {
        console.error(`${colors.yellow("[WARN]")} ${err instanceof Error ? err.message : err}; abandoning the server`);
      }
    });
    const env: HarnessEnv = {
      repoRoot: o.repoRoot, harnessRoot: join(o.repoRoot, "harness"), resultsRoot: o.resultsDir, privateRoot: o.privateRoot,
      store, lane, backend, backendUrl: server.url, docker, owner, symbols, symbolStore: o.symbolStore,
      secretsSource: o.secretsSource,
      deploy: { ledgerRoot: join(sharedResults, "bc-ledger"), owned: await ownedIds(o.repoRoot) },
      pricing: (at) => loadPricingBook(join(o.repoRoot, "site", "catalog"), at),
      supervised: o.supervised,
      egressEnforced: await resolveEgress(sharedResults, deps.verifyEgress),
      credentialLedger: o.credentialLedger,
      lane_id: Deno.env.get("CG_LANE") ?? "unknown-lane",
    };
    const recovered = await recoverInterrupted(env, loadTask);
    for (const e of recovered) {
      console.log(`${colors.yellow("[WARN]")} recovered interrupted execution ${e.id} (${e.termination}, cost ${e.telemetry.cost_usd ?? "unknown"})`);
    }
    return { env, close: closeAll };
  } catch (err) {
    await closeAll();
    throw err;
  }
}
```

`harness/images/pins.json` (M1-26 fills the digest; this placeholder is refused by `images build`):

```json
{ "servercore": "mcr.microsoft.com/windows/servercore:ltsc2025" }
```

- [ ] **Step 5: Add the commands to `cli/commands/harness-command.ts`**

Imports to add: `join`; `openHarnessEnv`, `OpenEnv`, `EnvOptions` from `./harness-env.ts`; `runCell`, `CellResult` from `../../src/harness/execution.ts`; `adapterFor` from `../../src/harness/adapters/mod.ts`; `type HarnessAdapter` from `../../src/harness/adapter.ts`; `imageFacts`, `imageTag`, `runtimeFacts`, `hasBaseLayers`, `BASE_IMAGE`, `IMAGE_LABELS`, `ImageFacts` from `../../src/harness/images.ts`; `resolveManifest`, `manifestHash` from `../../src/harness/manifest.ts`; `hashTree` from `../../src/harness/hash.ts`; `oracleHash`, `resolveRefapp` from `../../src/harness/identity.ts`; `loadTaskAt` from `../../src/harness/task-rev.ts`; `loadQualifyManifest`, `variantAllowed` from `../../src/harness/qualify.ts`; `applyOverlay`, `TASK_SOURCES` from `../../src/harness/staging.ts`; `freezeWorkspace`, `safeCopyTree` from `../../src/harness/fsutil.ts`; `judge`, `writeVerdictLog` from `../../src/harness/verdict.ts`; `realDocker`, `DockerCli` from `../../src/harness/sandbox.ts`; `altoolReader`, `buildSymbolsLock`, `defaultAltool`, `ManifestReader`, `writeSymbolsLock` from `../../src/harness/symbols.ts`; `readCatalog` from `../../src/ingest/catalog/read.ts`.

```typescript
export interface CellCliOptions {
  root: string;
  resultsDir: string;
  containers: string[];
  backendHost?: string | undefined;
  backendPort: number;
  secretsDir: string;
  symbolStore: string;
  privateDir: string;
  credentialLedger: string | null;
  supervised: boolean;
  repeat: number;
  rev: string | null;
}

type Opener = (o: EnvOptions) => Promise<OpenEnv>;
type OnInterrupt = (cb: () => void) => () => void;

const sigint: OnInterrupt = (cb) => {
  Deno.addSignalListener("SIGINT", cb);
  return () => Deno.removeSignalListener("SIGINT", cb);
};

function envOptions(o: CellCliOptions, resultsDir: string, command: string): EnvOptions {
  return {
    repoRoot: o.root, resultsDir, containers: o.containers, backendHost: o.backendHost, backendPort: o.backendPort,
    secretsSource: o.secretsDir, symbolStore: o.symbolStore, privateRoot: o.privateDir, credentialLedger: o.credentialLedger,
    command, supervised: o.supervised,
  };
}

/** Who may run this arm now (egress decision, round 2 item 9). */
export function cellGate(adapter: HarnessAdapter, o: { supervised: boolean; egressEnforced: boolean }, isTerminal: () => boolean): void {
  if (!adapter.credentialBearing || o.egressEnforced) return;
  if (!o.supervised) throw new ConfigurationError(`${adapter.harness} carries credentials: pass --supervised until egress enforcement is verified`);
  if (!isTerminal()) throw new ConfigurationError("a supervised run must be started from an interactive terminal");
}

/** One cell; records under results/harness/cells (a complete results root). */
export async function harnessCell(
  configId: string,
  taskId: string,
  o: CellCliOptions,
  open: Opener = openHarnessEnv,
  isTerminal: () => boolean = () => Deno.stdin.isTerminal(),
  onInterrupt: OnInterrupt = sigint,
): Promise<CellResult> {
  const config = await loadConfig(join(o.root, "harness"), configId);
  await checkModelsInCatalog([config], join(o.root, "site", "catalog"));
  const catalog = await readCatalog(join(o.root, "site", "catalog"));
  const adapter = adapterFor(config.harness);
  const h = await open(envOptions(o, join(o.resultsDir, "cells"), `harness cell ${configId} ${taskId}`));
  const stop = new AbortController();
  const unhook = onInterrupt(() => {
    console.log(`${colors.yellow("[PAUSE]")} interrupt: stopping the sandbox now`);
    stop.abort();
  });
  try {
    const env = { ...h.env, stop: stop.signal };
    cellGate(adapter, env, isTerminal);
    const facts = runtimeFacts(config, await imageFacts(env.docker, imageTag(config.harness, config.harness_version)), adapter, catalog);
    const armManifest = await resolveManifest(env.harnessRoot, config, facts);
    const at = await loadTaskAt(o.root, taskId, o.rev, join(env.privateRoot, "work", `task-${crypto.randomUUID().slice(0, 8)}`));
    const ids = await taskSetIdentity(o.root, [at.task], env.symbols);
    if (adapter.credentialBearing && !env.egressEnforced) {
      console.log(`${colors.yellow("[PAUSE]")} supervised run: watch network activity; press Ctrl+C on anything unexpected`);
    }
    const r = await runCell(env, {
      campaignId: crypto.randomUUID(),
      block: { index: 0, task_id: taskId, repeat: o.repeat, order: [configId] },
      orderInBlock: 0, arm: configId, armManifest, armManifestHash: await manifestHash(armManifest), task: at.task,
      taskVisibleHash: ids.tasks[0]!.visible, oracleHash: ids.tasks[0]!.oracle,
      refapp: await resolveRefapp(o.root, at.task.task.refapp_version),
    });
    for (const e of r.executions) {
      const j = (await env.store.judgments(e.id))[0];
      console.log(`${colors.green("[OK]")} ${e.id} ${e.termination}${j ? `, verdict ${j.verdict}` : ""}, cost ${e.telemetry.cost_usd ?? "unknown"} USD`);
    }
    if (r.withheld) console.log(`${colors.yellow("[WARN]")} ${r.withheld}`);
    return r;
  } finally {
    unhook();
    await h.close();
  }
}

/** Judge a task variant without an agent; persists the complete judgment and its provenance; writes no execution. */
export async function harnessJudgeFixture(
  taskId: string,
  variant: string,
  o: CellCliOptions & { manifest: string | null },
  open: Opener = openHarnessEnv,
): Promise<JudgmentRecord> {
  if (!/^(correct|reference-tests|naive\/[A-Za-z0-9_-]+)$/.test(variant)) {
    throw new ConfigurationError(`variant must be correct, reference-tests or naive/<name>, got ${variant}`);
  }
  if (o.manifest) {
    const why = variantAllowed(await loadQualifyManifest(o.manifest), taskId, variant, o.rev);
    if (why) throw new ConfigurationError(why);
  }
  const root = join(o.resultsDir, "fixtures");
  const h = await open(envOptions(o, root, `harness judge-fixture ${taskId} ${variant}${o.rev ? ` --rev ${o.rev}` : ""}`));
  const scratch = join(h.env.privateRoot, "work", `fixture-${crypto.randomUUID().slice(0, 8)}`);
  try {
    await Deno.mkdir(join(scratch, "task"), { recursive: true });
    const at = await loadTaskAt(o.root, taskId, o.rev, join(scratch, "task"));
    const task = at.task;
    if (!await Deno.stat(join(task.dir, variant)).then((s) => s.isDirectory, () => false)) {
      throw new ConfigurationError(`${taskId} has no variant ${variant}${o.rev ? ` at ${o.rev}` : ""}`);
    }
    const refapp = await resolveRefapp(o.root, task.task.refapp_version);
    const staged = await TASK_SOURCES[task.task.source]({
      repoRoot: o.root, task, refapp, symbols: h.env.symbols, symbolStore: h.env.symbolStore, out: join(scratch, "stage"),
    });
    const ws = join(scratch, "ws");
    await safeCopyTree(staged.pristine, ws);
    await applyOverlay(join(task.dir, variant), ws);
    const frozen = await freezeWorkspace({ resultsRoot: h.env.resultsRoot, privateRoot: h.env.privateRoot, workspace: ws, secrets: [] });
    const ids = await taskSetIdentity(o.root, [task], h.env.symbols);
    const { judgment, log } = await judge(h.env.lane, {
      executionId: crypto.randomUUID(), workspaceHash: frozen.workspace_hash, task, oracleHash: await oracleHash(task),
      pristine: staged.pristine, artifact: join(h.env.resultsRoot, frozen.stored_path),
      symbolIds: new Set(h.env.symbols.map((s) => s.app_id.toLowerCase())), workDir: join(scratch, "judge"),
      lock: { store: h.env.symbolStore, packages: h.env.symbols }, deploy: h.env.deploy,
    });
    const out = join(o.resultsDir, "fixtures", taskId, variant, judgment.id);
    await Deno.mkdir(out, { recursive: true });
    await Deno.writeTextFile(join(out, "judgment.json"), JSON.stringify(judgment, null, 2) + "\n");
    await Deno.writeTextFile(join(out, "provenance.json"), JSON.stringify({
      v: 1, task_id: taskId, variant, variant_tree_hash: await hashTree(join(task.dir, variant), "task"),
      rev: o.rev, task_commit: at.commit, task_tree: at.tree, task_visible_hash: ids.tasks[0]!.visible,
      oracle_hash: ids.tasks[0]!.oracle, refapp: { version: refapp.version, commit: refapp.commit },
      workspace_hash: frozen.workspace_hash, scorer_fingerprint: judgment.scorer_fingerprint,
      containers: log.containers, command: `harness judge-fixture ${taskId} ${variant}`,
    }, null, 2) + "\n");
    await writeVerdictLog(h.env.resultsRoot, log);
    console.log(`${judgment.verdict === "pass" ? colors.green("[OK]") : colors.red("[FAIL]")} ${taskId} ${variant}: ${judgment.verdict} (${out})`);
    return judgment;
  } finally {
    await Deno.remove(scratch, { recursive: true }).catch(() => {});
    await h.close();
  }
}

async function servercorePin(root: string): Promise<string> {
  let pins: { servercore?: string };
  try {
    pins = JSON.parse(await Deno.readTextFile(join(root, "harness", "images", "pins.json")));
  } catch {
    throw new ConfigurationError("harness/images/pins.json is missing or unreadable (M1-26 resolves the servercore digest)");
  }
  if (!pins.servercore || !/@sha256:[0-9a-f]{64}$/.test(pins.servercore)) {
    throw new ConfigurationError(`pins.json servercore must be pinned as <image>@sha256:<digest>, got ${pins.servercore}`);
  }
  return pins.servercore;
}

/**
 * Base image from the digest pin; a harness image from the inspected base.
 * Provenance is checked, not asserted: after the build, the base tag must
 * still resolve to the inspected id and the new image's layers must start
 * with the base's layers.
 */
export async function harnessImagesBuild(harness: string, o: { root: string; version?: string }, docker: DockerCli = realDocker()): Promise<ImageFacts> {
  const images = join(o.root, "harness", "images");
  if (harness === "base") {
    const pin = await servercorePin(o.root);
    const code = await docker.build(["build", "-f", join(images, "base", "Dockerfile.windows"), "--build-arg", `SERVERCORE=${pin}`, "-t", BASE_IMAGE, join(images, "base")]);
    if (code !== 0) throw new ConfigurationError(`base image build failed (exit ${code})`);
    const img = await docker.inspectImage(BASE_IMAGE) as { Id: string } | null;
    return { digest: img!.Id, base_digest: pin, harness: "base", version: "1" };
  }
  if (!o.version) throw new ConfigurationError(`pass --version for ${harness}`);
  const base = await docker.inspectImage(BASE_IMAGE) as { Id?: string } | null;
  if (!base?.Id) throw new ConfigurationError(`build the base image first: centralgauge harness images build base`);
  const tag = imageTag(harness, o.version);
  const code = await docker.build([
    "build", "-f", join(images, harness, "Dockerfile.windows"), "--build-arg", `BASE=${BASE_IMAGE}`,
    "--label", `${IMAGE_LABELS.harness}=${harness}`, "--label", `${IMAGE_LABELS.version}=${o.version}`,
    "--label", `${IMAGE_LABELS.base}=${base.Id}`, "-t", tag, join(images, harness),
  ]);
  if (code !== 0) throw new ConfigurationError(`${tag} build failed (exit ${code})`);
  const after = await docker.inspectImage(BASE_IMAGE) as { Id?: string } | null;
  if (after?.Id !== base.Id || !await hasBaseLayers(docker, tag, BASE_IMAGE)) {
    throw new ConfigurationError(`${tag} was not built on base ${base.Id}: the layers do not start with the base's layers`);
  }
  const f = await imageFacts(docker, tag);
  console.log(`${colors.green("[OK]")} ${tag} = ${f.digest} (base ${base.Id})`);
  return f;
}

export async function harnessSymbolsLock(
  o: { root: string; from: string; store: string; altool?: string },
  read: ManifestReader = altoolReader(o.altool ?? defaultAltool(o.from)),
): Promise<number> {
  const lock = await buildSymbolsLock(o.from, o.store, read);
  await writeSymbolsLock(o.root, lock);
  return lock.packages.length;
}
```

In `registerHarnessCommand`, add (shared options: `--results-dir <dir:string>` default `results/harness`, `--containers <names:string>` default `Cronus281`, `--backend-host <ip:string>`, `--backend-port <port:number>` default 3210, `--secrets-dir <dir:string>` required, `--symbol-store <dir:string>` default `results/harness/symbols`, `--private-dir <dir:string>` default `%LOCALAPPDATA%\centralgauge\harness`, `--credential-ledger <path:string>` default `CG_CREDENTIAL_LEDGER`, `--rev <commit:string>`):

```typescript
  shared(parent.command("cell <config:string> <task:string>", "Run one cell (records under results/harness/cells)"))
    .option("--supervised", "Operator watches this credential-bearing run at the terminal (before egress enforcement)")
    .option("--repeat <n:integer>", "Repeat index", { default: 1 })
    .action((opts, config, task) => fail(async () => void await harnessCell(config, task, cliOpts(opts))));
  shared(parent.command("judge-fixture <task:string> <variant:string>", "Judge correct/, reference-tests/ or naive/<name>/ without an agent"))
    .option("--manifest <path:string>", "Qualification manifest shared with M4; refuses unlisted variants or revisions")
    .action((opts, task, variant) => fail(async () => void await harnessJudgeFixture(task, variant, { ...cliOpts(opts), manifest: opts.manifest ?? null })));
  parent.command("images", new Command()
    .command("build <harness:string>", "Build the base image or a harness image")
    .option("--version <v:string>", "Harness version (image tag and label)")
    .action((opts, harness) => fail(async () => void await harnessImagesBuild(harness, { root: Deno.cwd(), ...(opts.version ? { version: opts.version } : {}) }))));
  parent.command("symbols", new Command()
    .command("lock", "Write harness-tasks/symbols.lock.json from a compiler-cache symbols folder")
    .option("--from <dir:string>", "Symbols folder", { required: true })
    .option("--store <dir:string>", "Host symbol store", { default: "results/harness/symbols" })
    .option("--altool <path:string>", "altool.exe (default: next to the symbols folder)")
    .action((opts) =>
      fail(async () => {
        const n = await harnessSymbolsLock({ root: Deno.cwd(), from: opts.from, store: opts.store, ...(opts.altool ? { altool: opts.altool } : {}) });
        console.log(`${colors.green("[OK]")} ${n} symbol packages locked`);
      })
    ));
```

`cliOpts` resolves relative directories against `Deno.cwd()`, splits `--containers` on commas, and takes `credentialLedger` from the option or `CG_CREDENTIAL_LEDGER` (null when neither is set). `--supervised` is a plain flag (no `default`, no `--no-` form).

- [ ] **Step 6: Operator scripts**

`scripts/harness/cg-al-probe.ps1` (copied into the config dir; runs inside the sandbox; statuses only, never the token):

```powershell
$ErrorActionPreference = 'Continue'
function Call($label, [string[]]$a) {
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File C:\cg-al.ps1 @a
  Write-Output (ConvertTo-Json -Compress -InputObject @{ label = $label; exit = $LASTEXITCODE; out = "$o" })
}
function Raw($label, $path, $body, $exec) {
  $token = (Get-Content C:\cg-secrets\backend-token -Raw).Trim()
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$($env:CG_BACKEND_URL)$path" `
      -Headers @{ Authorization = "Bearer $token"; 'X-CG-Execution' = $exec } -ContentType 'application/json' -Body $body -TimeoutSec 60
    $s = [int]$r.StatusCode
  } catch [System.Net.WebException] { $s = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 } }
  Write-Output (ConvertTo-Json -Compress -InputObject @{ label = $label; status = $s })
}
Call 'compile' @('compile')
Call 'test' @('test')
Call 'symbols' @('symbols')
Raw 'other-execution' '/v1/symbols' '{}' '00000000-0000-4000-8000-000000000000'
Raw 'oracle-path' '/v1/oracle' '{}' $env:CG_EXECUTION_ID
Raw 'list-apps' '/v1/apps' '{}' $env:CG_EXECUTION_ID
Raw 'traversal' '/v1/compile' '{"apps":["..\\Rental"]}' $env:CG_EXECUTION_ID
Raw 'hidden-codeunit' '/v1/test' '{"codeunits":[85001]}' $env:CG_EXECUTION_ID
Raw 'malformed' '/v1/compile' '{"apps":' $env:CG_EXECUTION_ID
```

`scripts/harness/backend-probe.ts` (ops driver for M1-28 Step 4; no provider credential, so not a supervised run and no reservation):

```typescript
// Usage (container leased, no bench live):
//   DOCKER_CONTEXT=desktop-windows deno run --allow-all scripts/harness/backend-probe.ts <container> <secretsDir>
import { join } from "@std/path";
import { openHarnessEnv } from "../../cli/commands/harness-env.ts";
import { resolveRefapp } from "../../src/harness/identity.ts";
import { imageFacts, imageTag } from "../../src/harness/images.ts";
import { prepareSecrets, removeSecrets, runSandbox, sandboxName } from "../../src/harness/sandbox.ts";
import { TASK_SOURCES } from "../../src/harness/staging.ts";
import { loadTask } from "../../src/harness/task.ts";

const [container, secretsDir] = Deno.args;
if (!container || !secretsDir) throw new Error("usage: backend-probe.ts <container> <secretsDir>");
const root = Deno.cwd();
const privateRoot = join(Deno.env.get("LOCALAPPDATA")!, "centralgauge", "harness");
const h = await openHarnessEnv({
  repoRoot: root, resultsDir: join(root, "results", "harness", "probes"), containers: [container], backendPort: 3210,
  secretsSource: secretsDir, symbolStore: join(root, "results", "harness", "symbols"), privateRoot,
  credentialLedger: null, command: "backend-probe", supervised: false,
});
const id = crypto.randomUUID();
const work = join(privateRoot, "work", id);
const out = join(privateRoot, "probes", id);
let secrets: string | null = null;
try {
  const task = await loadTask(join(root, "harness-tasks", "tasks", "HX-001"));
  const staged = await TASK_SOURCES[task.task.source]({
    repoRoot: root, task, refapp: await resolveRefapp(root, task.task.refapp_version), symbols: h.env.symbols,
    symbolStore: h.env.symbolStore, out: work,
  });
  const configDir = join(work, "config");
  await Deno.mkdir(configDir, { recursive: true });
  await Deno.copyFile(join(root, "scripts", "harness", "cg-al-probe.ps1"), join(configDir, "cg-al-probe.ps1"));
  await Deno.mkdir(out, { recursive: true });
  const hostLog = join(out, "host-log.jsonl");
  const name = sandboxName("00000000-0000-4000-8000-0000000000b0", id);
  const token = await h.env.backend.grant({
    executionId: id, sandbox: name, workspace: staged.workspace, pristine: staged.pristine, trusted: staged.apps,
    symbols: h.env.symbols, lock: { store: h.env.symbolStore, packages: h.env.symbols }, deploy: h.env.deploy, hostLog,
  }, 30 * 60_000);
  const s = await prepareSecrets(secretsDir, [], token);
  secrets = s.dir;
  const img = await imageFacts(h.env.docker, imageTag("claude-code", "2.1.282"));
  const r = await runSandbox(h.env.docker, {
    name, owner: h.env.owner, executionId: id, imageId: img.digest,
    workspace: staged.workspace, taskDir: staged.taskDir, configDir, secretsDir: s.dir, extraMounts: [],
    env: { CG_BACKEND_URL: h.env.backendUrl, CG_EXECUTION_ID: id }, timeoutMs: 20 * 60_000, killGraceMs: 60_000,
    opTimeoutMs: 60_000, maxCaptureBytes: 16 * 1024 * 1024,
    rawLog: join(out, "probe.jsonl"), stderrLog: join(out, "stderr.txt"),
    command: ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\config\\cg-al-probe.ps1"],
  }, s.values.map((v) => v.value));
  console.log(JSON.stringify({ execution: id, sandbox: r, probe: join(out, "probe.jsonl"), hostLog }));
} finally {
  await h.env.backend.revoke(id);
  if (secrets) await removeSecrets(secrets);
  await Deno.remove(work, { recursive: true }).catch(() => {});
  await h.close();
}
```

The probe prints statuses only (never the token), and the token is revoked when the script ends; its outputs stay under the private root and ops quotes them into the evidence.

- [ ] **Step 7: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/task-rev.test.ts tests/unit/cli/commands/harness-command.test.ts`
Expected: all pass, including the Part 1 tests already in the file.

Run: `deno task start harness --help`
Expected: lists `validate`, `report`, `cell`, `judge-fixture`, `images`, `symbols`.

- [ ] **Step 8: Check, lint, format** (the files above; `deno check scripts/harness/backend-probe.ts`)

- [ ] **Step 9: Commit, then refresh the graph**

```bash
git add cli/commands/harness-env.ts cli/commands/harness-command.ts src/harness/task-rev.ts src/harness/qualify.ts harness/images/pins.json scripts/harness/backend-probe.ts scripts/harness/cg-al-probe.ps1 tests/unit/harness/task-rev.test.ts tests/unit/cli/commands/harness-command.test.ts
git commit -m "feat(harness): cell, judge-fixture with provenance, images build with base provenance, task revisions, qualification manifest"
graphify update .
```

**Acceptance:** both test files pass (fail-closed egress state, cell gating, interrupt, ownership, persisted judgment and provenance, revision and manifest refusals, base-layer provenance among them); `deno task start harness --help` lists the four new subcommands; the probe script type-checks; check, lint and `deno fmt --check` clean.

---

### Slice ops tasks (lane-ops, real Docker and BC containers)

Common rules for every ops task in this plan (M1-26 to M1-29 here, M1-30, M1-34, M1-38 After 10-05):

- Before any step: no bench is live (`find results/.bench-running.json -mmin -2` prints nothing); the container lease is taken per `H:\cg-coord\leases\<container>`; Cronus28 and Cronus284 are never used by any harness script (Cronus28 is excluded, codeunit 80013 collision; Cronus284 is untouched, owner pending). Every harness command takes the bench lock itself.
- Ad-hoc docker and pwsh commands are prefixed with `DOCKER_CONTEXT=desktop-windows`; ad-hoc pwsh imports the pin explicitly: `Import-Module bccontainerhelper -RequiredVersion 6.1.14`.
- **No secret in any argv**, including ad-hoc commands: credentials come from the config (`sshadows` per the BC credential config, never typed into a command line) and from the secret files in the operator secrets directory; no `deno eval` with a literal password or token. The Claude OAuth token for M1-29 is a dedicated benchmark credential, stored only as `<secrets-dir>\claude-oauth-token`.
- Every credential-bearing run reserves in the one shared ledger first (`CG_CREDENTIAL_LEDGER=H:\cg-coord\ledgers\credential-runs.jsonl`, see the integrated schedule); `harness cell` does it itself.
- Evidence goes to `H:\cg-coord\tasks\<task-id>\runs\<nnn>\evidence.md` plus the raw files it quotes, in the same folder. Every expected value below is quoted verbatim or stated as observed. A deviation is recorded, not fixed by ops; the orchestrator decides.
- Code changes belong to lane-infra and lane-infra2. Ops commits only `harness-tasks/symbols.lock.json` and `harness/images/pins.json` (M1-26), on the lane-ops branch.

---

### Task M1-26 (ops): early host checks: altool shape, GUIDs, lock, servercore digest, nat gateway, Hyper-V pause, pricing

Findings section 6 (263 symbol apps in `C:\ProgramData\BcContainerHelper\compiler-cache-15ff3c5d109b\symbols\`, BC 28.4.53241.53758), M0-06 carryover (build and symbol provenance with hashes), open questions 9 and 13, M0-05 carryover (container-facing address), review round 2 item 1 (the backend's quiescent snapshot needs `docker pause` under Hyper-V isolation) and item 10 (pricing).

No firewall rule is created here (review round 2 item 7 and the owner constraint: the only new rules on this host are M1-34's inbound Block rules on the sandbox interface; the Windows Firewall is off on this host until M1-34, so the backend port needs no rule).

**Lane:** ops. **Deps:** M1-13 (`scripts/harness/symbols-lock.ts`). **Date:** 09-29.

- [ ] **Step 1: altool manifest shape.** `& "C:\ProgramData\BcContainerHelper\compiler-cache-15ff3c5d109b\compiler\extension\bin\win32\altool.exe" GetPackageManifest "<one Microsoft_*.app from ...\symbols>"`. Quote the raw JSON. Expected: top-level `id`, `name`, `publisher`, `version`. If they differ, stop and report (M1-13 adapts `altoolReader`).
- [ ] **Step 2: GUIDs and lock.** `deno run --allow-all scripts/harness/symbols-lock.ts --from "C:\ProgramData\BcContainerHelper\compiler-cache-15ff3c5d109b\symbols" --store results\harness\symbols`. Expected: `[OK] 263 symbol packages locked` (or the actual count, quoted). If the lock fails `z.uuid()` on an `app_id`, quote the failing ids and stop (open question 9: Part 1's owner switches the lock schema to the BC GUID pattern). Record the container artifact URL (`docker inspect Cronus281 --format "{{json .Config.Labels}}"`), the BC build, `sha256sum harness-tasks/symbols.lock.json`, and the store size.
- [ ] **Step 3: servercore digest.** `docker pull mcr.microsoft.com/windows/servercore:ltsc2025` then `docker image inspect mcr.microsoft.com/windows/servercore:ltsc2025 --format "{{index .RepoDigests 0}}"`. Write the `<image>@sha256:<digest>` value into `harness/images/pins.json` as `servercore`. Quote it and the host OS build (`cmd /c ver`).
- [ ] **Step 4: nat gateway.** `docker network inspect nat --format "{{range .IPAM.Config}}{{.Gateway}} {{.Subnet}}{{end}}"`. Quote gateway and subnet (the slice's backend binds the gateway address, M1-19).
- [ ] **Step 5: Hyper-V pause.** `docker run -d --isolation hyperv --name cg-harness-pausetest-00000000 <servercore pin> ping -t localhost`, then `docker pause cg-harness-pausetest-00000000`, `docker inspect --format "{{.State.Paused}}" cg-harness-pausetest-00000000` (expected `true`), `docker unpause ...` (expected `false` after), `docker rm -f ...` (exit 0). Quote each line. If pause is unsupported, stop and report (M1-19's quiescence depends on it).
- [ ] **Step 6: case-sensitive directories.** `fsutil file setCaseSensitiveInfo <temp dir> enable` in an elevated shell; quote whether it works (the host test is additional only; M1-12's deterministic test is the proof).
- [ ] **Step 7: pricing.** Quote the `anthropic/claude-sonnet-5` pricing row effective now from `site/catalog/pricing.yml` (expected after the orchestrator's catalog update: `cache_read_per_mtoken: 0.2`, `cache_write_per_mtoken: 2.5`). The harness derives the 1-hour write price (2x input) itself; nothing else is needed from the catalog.
- [ ] **Step 8: commit** on the lane-ops branch: `git add harness-tasks/symbols.lock.json harness/images/pins.json && git commit -m "chore(harness): symbols lock and servercore pin from BC 28.4.53241.53758 host"`.

**Acceptance (no container):** the evidence file quotes the altool JSON, the lock count and sha256, the servercore digest and host build, the gateway and subnet, the pause/unpause lines, the case-sensitivity result and the pricing row; no firewall rule was created; on the lane-ops branch `harness/images/pins.json` matches `@sha256:[0-9a-f]{64}$` and the lock parses with Part 1's `loadSymbolsLock`.

---

### Task M1-27 (ops): candidate-scoped app sync on Cronus281; qualify Cronus282/283

Findings section 8 ("`prepareCandidateApp` cleanup removes refapp dependency apps") and the M0-02 carryover: the replacement keeps prerequisites installed, refreshes stale ones through the ledger and bumped versions, removes only owned candidates, and reports provisioning separately. Also verifies what unit tests cannot: `Get-NAVAppInfo -TenantSpecificProperties` output and BC accepting the bumped prerequisite versions with dependency minima. Review round 2 item 11: the uninstalled-app observation is read-only, and Cronus28 is never touched by a harness script.

**Lane:** ops. **Deps:** M1-16 (`scripts/harness/app-sync-probe.ts`), M4-03 accepted (`refapp-v1-rc1` tagged; the chain is P5 accepted, M4-03 accepted, rc1). **Date:** 10-02.

- [ ] **Step 1: probe Cronus281.** `DOCKER_CONTEXT=desktop-windows deno run --allow-all scripts/harness/app-sync-probe.ts Cronus281 H:\Temp3\harness-m1\sync-281 refapp-v1-rc1 > H:\cg-coord\tasks\M1-27\runs\001\probe-281.jsonl`.
- [ ] **Step 2: check each line and quote it.**
  - `prenuke`: `after` has no `CGR ...` entry.
  - `a-fresh`: `after` lists every refapp app installed; prerequisites at their bumped versions (`major.minor.(build+1+n).n`), candidates at their pristine versions; `codeunits` equals the visible test codeunits discovered in the staged Test app (no hardcoded list); every `rows[].outcome` is `pass`; `deployed.provisioning_ms` and `deployed.candidate_publish_ms` both present.
  - `b-rental-changed`: `candidates` are Rental, its dependents and Test; the `before` and `after` entries of the other prerequisites are identical (not republished).
  - `c-stale-core`: every prerequisite version differs from `a-fresh` (ledger stamp changed); rows all pass.
  - `d-cleanup`: the candidates are gone, the prerequisites still installed.
  - `e-after-bench-prenuke`: republished from nothing; rows all pass.
- [ ] **Step 3: uninstalled-but-published is listed (read-only observation).** Run Step 1 with `--keep` (the apps of the last step stay installed) into `probe-281-keep.jsonl`. In pwsh with the pin imported: `Invoke-ScriptInBcContainer -containerName Cronus281 -scriptblock { Uninstall-NAVApp -ServerInstance BC -Name 'CGR Test' -Tenant default -Force }`. Observe with the read-only mode: `deno run --allow-all scripts/harness/app-sync-probe.ts Cronus281 H:\Temp3\harness-m1\sync-281-list refapp-v1-rc1 --list-only > probe-281-list.jsonl` (no prenuke, no publish, no cleanup). Expected: the `list-only` line shows `CGR Test` with `"installed":false`. Then run Step 1 again into `probe-281b.jsonl`: every step passes.
- [ ] **Step 4: Cronus28 collision (read-only, no harness script).** With a read lease on Cronus28, in pwsh with the pin imported: `Invoke-ScriptInBcContainer -containerName Cronus28 -scriptblock { Get-NAVAppInfo -ServerInstance BC -Tenant default | Select-Object Name, Publisher, Version | Format-Table -AutoSize }`. Quote the Continia apps listed. Nothing is published, unpublished or prenuked on Cronus28; the exclusion stands.
- [ ] **Step 5: qualify reroute targets.** Step 1 on Cronus282 and Cronus283 (`probe-282.jsonl`, `probe-283.jsonl`). A container qualifies when every step passes; quote the verdict per container. Only qualified containers are passed to `--containers` for the slice.
- [ ] **Step 6: leave the containers clean.** The probe prenukes in `finally` and empties the shared ledger entry for the container; quote an empty `CGR` listing per container used (`--list-only`).

**Acceptance (no container):** `probe-281.jsonl` has the six step lines with the properties above; `probe-281-list.jsonl` shows `"installed":false` for `CGR Test` from a read-only listing; `probe-281b.jsonl` passes every step; the Cronus28 listing is quoted with no harness script run there; Cronus282 and Cronus283 each have a qualified or not-qualified line with the reason.

---

### Task M1-28 (ops): images, verdict controls at rc1, backend round trip

Spec 1a section 5 (image build, backend on the container-facing address, token from `C:\cg-secrets`), M0-05 carryover in production form (401/404/400 negatives including malformed JSON, host-log spans), findings section 8 (verdict controls: correct passes, **every** named naive fails, before any agent run), secrets accepted-risk (no secret in image layers or container config), review round 2 items 4, 10 and 11 (base provenance by layers; the harness enforces the budget flag; immutable task revision; complete judgment persistence).

**Lane:** ops. **Deps:** M1-24, M1-26, M1-27. **Date:** 10-04.

- [ ] **Step 1: images.** `deno task start harness images build base`, then `deno task start harness images build claude-code --version 2.1.282`. Quote the `[OK] centralgauge/harness-claude-code:2.1.282 = sha256:... (base sha256:...)` line (the build verified the base layers) and `docker image inspect centralgauge/harness-claude-code:2.1.282 --format "{{json .Config.Labels}}"`.
- [ ] **Step 2: no secret in layers; budget flag present.** `docker history --no-trunc centralgauge/harness-claude-code:2.1.282 | grep -icE "token|api-key|oauth|secret"` (expected `0`); `docker run --rm --isolation hyperv <image id> powershell -Command "claude --help" | findstr /C:"--max-budget-usd"` (expected one line; if absent, stop: M1-32's entrypoint relies on it).
- [ ] **Step 3: verdict controls at the immutable revision.** For HX-001: `deno task start harness judge-fixture HX-001 correct --rev refapp-v1-rc1 --containers Cronus281 --secrets-dir <dir>` (expected `pass`), then the same with `naive/<name>` for **every** folder under `naive/` at `refapp-v1-rc1` (`git ls-tree --name-only refapp-v1-rc1 harness-tasks/tasks/HX-001/naive/`; expected `fail` each). For each run quote the `[OK]`/`[FAIL]` line and, from `results/harness/fixtures/HX-001/<variant>/<judgment-id>/`, the scorer results of `judgment.json` and `provenance.json`'s `task_commit`, `task_tree` and `variant_tree_hash`; for each naive variant the failing oracle procedure. A naive variant that passes stops the slice (oracle hole, M4 owns the fix).
- [ ] **Step 4: backend round trip from a real sandbox.** `DOCKER_CONTEXT=desktop-windows deno run --allow-all scripts/harness/backend-probe.ts Cronus281 <secrets-dir>` (no provider credential, not a supervised run). From the printed `probe` file quote each line. Expected: `compile`, `test`, `symbols` exit 0; `other-execution` 401, `oracle-path` 404, `list-apps` 404, `traversal` 400, `hidden-codeunit` 400, `malformed` 400. From the host log quote `br_1` (compile, ok) and `br_2` (test, ok, `tests_run` > 0) with their spans (including the snapshot span taken under pause), the `rejected` lines, and the client's `script_ms` from the `compile` line.
- [ ] **Step 5: bind and env.** While Step 4 runs: `netstat -ano | findstr :3210` (expected: listening only on the nat gateway address, never `0.0.0.0`), and `docker inspect <sandbox> --format "{{json .Config.Env}} {{json .Config.Cmd}} {{json .HostConfig.Isolation}}"` (expected: only `CG_BACKEND_URL` and `CG_EXECUTION_ID` besides the image defaults; isolation `hyperv`). After it ends: `Get-ChildItem $env:TEMP -Filter cg-harness-secrets-*` is empty.

**Acceptance (no container):** the evidence file quotes the image digest and labels with the verified base, `0` from the history grep, the budget-flag line, one verdict line per variant at `refapp-v1-rc1` (correct `pass`, every naive `fail`) with its persisted judgment scorers and provenance, the nine probe statuses exactly as listed, the host-log spans, the netstat line, the container env and isolation, and the empty secrets listing.

---

### Task M1-29 (ops): GATE 10-05: supervised Claude Code cell on HX-001 at rc1

The slice gate (decision 2026-09-25-gate-1002-moved): one task, Claude Code in the sandbox, a trusted verdict, cost in the records. Egress decision: this is one of at most 5 supervised credential-bearing runs across all lanes (the shared ledger); the operator watches and terminates on unexpected network activity; no automatic retries. P5 is a hard predecessor: no P5 acceptance, no gate.

**Lane:** ops. **Deps:** M1-28, M4-16 (P5 accepted; its texts are M1-16's classifier fixture), M4-03 accepted. **Date:** 10-05.

- [ ] **Step 1: preflight.** Quote `deno task start harness --help` (lists `cell`), the lease on Cronus281, the empty `docker ps -a --filter label=centralgauge.harness.owner=$env:COMPUTERNAME`, the line count of `H:\cg-coord\ledgers\credential-runs.jsonl` (expected below 5; the reservation is refused at 5), and that `tests/fixtures/harness/p5-messages.json` on this commit matches `H:\Temp3\harness-spike\M4-16-results.md`.
- [ ] **Step 2: network watch.** In a second terminal, capture the sandbox's traffic for the run's duration: `pktmon filter add -i <nat subnet>` and `pktmon start --etw -c` (or Resource Monitor's network tab on the vmmem process). The expected destinations are the Anthropic API hosts and the backend on the nat gateway only.
- [ ] **Step 3: run.** `CG_CREDENTIAL_LEDGER=H:\cg-coord\ledgers\credential-runs.jsonl deno task start harness cell cc-sonnet-plain HX-001 --rev refapp-v1-rc1 --supervised --containers Cronus281 --secrets-dir <dedicated benchmark secrets dir>`. On any destination other than the expected ones: Ctrl+C (the handler kills the sandbox at once), record it, stop the slice.
- [ ] **Step 4: check the records** under `results/harness/cells/`:
  - the execution record: `termination`, `did_work`, `telemetry.cost_usd` (non-null), `cost_source: "estimated"`, `pricing_snapshot`, `reported_cost_usd`, `per_model`, `turns`, `validity` (`incomplete_observed: ["loaded_components"]` is expected: the instructions component is unobservable); quote them;
  - the judgment: `verdict`, `scorer_fingerprint`, every scorer's `passed`; quote them;
  - `runs/<id>/raw.jsonl` has a final `result` line; `runs/<id>/trace.jsonl` exists; `runs/<id>/sandbox.json` shows `confirmedGone: true`;
  - secret scan: `grep -rF -f <secrets-dir>/claude-oauth-token results/harness | wc -l` prints `0` (the token value is read by grep from the file, never typed);
  - the private state for the execution is gone (`work`, `quarantine`, `custody`, `pending`, `intents` under `%LOCALAPPDATA%\centralgauge\harness`); `docker ps -a --filter label=centralgauge.harness.owner=$env:COMPUTERNAME` is empty.
- [ ] **Step 5: stop the capture** and quote the destination list with byte counts, and the new ledger line.

**Acceptance (no container):** the evidence file quotes the execution and judgment fields above with a non-null estimated cost and a verdict (pass or fail are both a gate pass: the gate is the pipeline, not the model), `0` from the secret scan, the empty private state and `docker ps`, the destination list with no unexpected host, and the shared ledger line of this run.

---

## Integration gate for the slice (orchestrator, 10-05)

After M1-24 merges, on the merge tree, no container needed:

```bash
deno test --allow-all tests/unit/harness/ tests/unit/cli/commands/harness-command.test.ts tests/unit/scripts/id-audit.test.ts
deno check cli/centralgauge.ts src/harness/ cli/commands/harness-env.ts scripts/harness/
deno lint src/harness/ cli/commands/harness-command.ts cli/commands/harness-env.ts tests/unit/harness/ scripts/harness/
deno fmt --check src/harness/ tests/unit/harness/ cli/commands/harness-command.ts cli/commands/harness-env.ts scripts/harness/
deno task id-audit
deno task start harness --help
graphify update .
```

When no bench is live, also run the pure container-module tests the M1-15 edits touch: `deno test --allow-all tests/unit/container/bc-script-builders.test.ts tests/unit/container/bc-output-parsers.test.ts`.

The slice is done when this gate is clean and the M1-26, M1-27, M1-28 and M1-29 evidence files are accepted.

---

# Part B: After 10-05

Everything below starts 10-06 and is planned to finish before the 10-10 campaigns. Nothing here is on the slice's path. The hard gates for 10-10: M1-18 (by 10-08, HX-002 cannot be qualified without it), M1-33 + M1-34 (internal sandbox network, scoped firewall rules and proxy applied, verified and revert-tested, credentials rotated, before any unattended or campaign run), M1-38 (real-pipeline qualification of every named variant). M1-25 is cut first if time runs short; M1-36 and M1-37 are after 10-10.

These tasks are specified by their tests and rules; each task's implementer writes the code against the merged slice, test first, following the same step pattern (failing test, run, implement, run, check/lint/fmt, commit). Where a rule is load-bearing, the code is given.

---

### Task M1-18: verdict: `mutant_kill` on the real HX-002 contract

Spec 1a section 7 "Test-authoring boundary": only the agent's changes under `Test\` are kept; production is reset to the reference sources; the agent's tests must build, be discovered, pass on the reference and fail on every hidden mutant **by an assertion**; a compile error or an infra fault on a mutant is not a kill; mutant 0 is the original state. 1b section 5: `correct/` is the reference production solution, `mutants/<name>/` are production overlays with module ids (M1-11 doc note). M4 round 2 and the M4 plan (HX-002 `scorers: [build, pass_to_pass, mutant_kill]`, `pass_to_pass` on the visible suite; conformance fixture `tests/fixtures/harness/conformance/mixed-assertion-missing.json`): `reference-tests/` is the positive test-authoring artifact; naive suites live in `naive/<name>/`; a lost `ASSERTERROR` is an assertion; an expected procedure missing from a run is infra, and "assertion in A, missing B" is infra, not a kill. Review round 2 item 6.

Rules:
- **pass_to_pass** runs the task's listed visible procedures on the reference production (the pristine Test app plus reference production), as the scorer list requires; it is decided before `mutant_kill`.
- **Expected procedures** are discovered in the submitted suite (`[Test]` procedures, M1-14) and requested by name with `zeroIsInfra: true`; a missing procedure or zero results is infra. Target coverage is complete: every discovered procedure has a row for `reference`, `mutant:0` and each named mutant.
- **Unsupported submissions are rejected, not dropped**: a submitted `TestPage` codeunit fails `mutant_kill` with the reason "TestPage tests are not supported by the harness test runner"; a submitted codeunit with no `[Test]` procedure is noted and ignored only when another codeunit has procedures.
- **Per mutant** (M4 gate parity): any infra row, or an infra error thrown for that mutant after the lane's reroutes, makes that mutant **infra** (not a kill, not a survivor) and the loop continues, so an earlier survivor is never lost; otherwise any `fail` with `failure: "assertion"` is a **kill**; otherwise it **survived**. Scorer: any survivor gives `false`; no survivor and any infra gives `null` (unscored); every mutant killed gives `true`. On the reference: infra gives `null`, a failure `false`, and mutants are not run.

**Lane:** infra2 (stream B). **Deps:** M1-17, M1-14 (`procedures`). **Date:** 10-06 (no later than 10-08).

**Files:**
- Modify: `src/harness/verdict.ts` (replace the `scoreTestAuthoring` stub)
- Modify: `tests/unit/harness/refapp-fixture.ts` (export `rental`; add `addTestAuthoringTask`)
- Test: `tests/unit/harness/verdict-mutant.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/unit/harness/refapp-fixture.ts`, change `const rental =` to `export const rental =` and append:

```typescript
/** HX-002 shape (M4 contract): test-authoring on Rental.Price; staged = bug exit(11), correct = exit(10). */
export async function addTestAuthoringTask(
  repo: RefappRepo,
  mutants: Record<string, string>,
  suites: Record<string, string> = {},
): Promise<string> {
  const t = "harness-tasks/tasks/HX-002";
  await write(repo.root, `${t}/task.yml`, `id: HX-002
refapp_version: refapp-v1
kind: test-authoring
prompt: prompt.md
source: refapp
scorers: [build, pass_to_pass, mutant_kill]
pass_to_pass:
  - { codeunit: 80010, procedures: [ShippedPasses] }
mutants: [${Object.keys(mutants).join(", ")}]
`);
  await write(repo.root, `${t}/prompt.md`, "Write tests for Rental.Price.");
  await write(repo.root, `${t}/overlay/Rental/src/Rental.Codeunit.al`, rental("exit(11);"));
  await write(repo.root, `${t}/correct/Rental/src/Rental.Codeunit.al`, rental("exit(10);"));
  for (const [name, body] of Object.entries(mutants)) {
    await write(repo.root, `${t}/mutants/${name}/Rental/src/Rental.Codeunit.al`, rental(body));
  }
  for (const [folder, text] of Object.entries(suites)) {
    await write(repo.root, `${t}/${folder}/Test/src/Suite.Test.al`, text);
  }
  return join(repo.root, t);
}
```

`tests/unit/harness/verdict-mutant.test.ts`:

```typescript
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import { freezeWorkspace, safeCopyTree } from "../../../src/harness/fsutil.ts";
import { oracleHash, resolveRefapp } from "../../../src/harness/identity.ts";
import { JudgmentRecordSchema } from "../../../src/harness/records.ts";
import { applyOverlay, stageRefappTask } from "../../../src/harness/staging.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { judge } from "../../../src/harness/verdict.ts";
import { deployedSource, FakeBc, result } from "./fake-bc.ts";
import { addTestAuthoringTask, IDS, makeRefappRepo, rental, write } from "./refapp-fixture.ts";

const suite = (cu: number, procs: string[] = ["PriceIsTen"], extra = "") =>
  `codeunit ${cu} "Suite ${cu}"\n{\n    Subtype = Test;\n${extra}\n${procs.map((p) => `    [Test]\n    procedure ${p}()\n    begin\n    end;\n`).join("\n")}}\n`;

type Script = (cu: number, src: string) => ReturnType<typeof result> | "throw-infra";

/**
 * 80100 good (assertion unless Rental returns 10); 80101 weak (always passes);
 * 80102 fails everywhere; 80103 runtime error unless 10; 80104 lost ASSERTERROR unless 10.
 */
function bc(extra: Script = () => result({})) {
  return new FakeBc((cu, deployed, container) => {
    const src = deployedSource(deployed, "CGR Rental");
    const ten = src.includes("exit(10);");
    if (cu === 80010) return result({ ShippedPasses: true });
    if (cu === 80100) return result({ PriceIsTen: ten ? true : "Assert.AreEqual failed. Expected:<10>" });
    if (cu === 80101) return result({ PriceIsTen: true });
    if (cu === 80102) return result({ PriceIsTen: "Assert.IsTrue failed." });
    if (cu === 80103) return result({ PriceIsTen: ten ? true : "Division by zero" });
    if (cu === 80104) return result({ PriceIsTen: ten ? true : "An error was expected inside an ASSERTERROR statement." });
    const x = extra(cu, src);
    if (x === "throw-infra") throw new Error(`SOAP request timed out on ${container}`);
    return x;
  });
}

async function setup(mutants: Record<string, string>, artifact: { suite?: string; tests?: number[]; edits?: Record<string, string> }) {
  const repo = await makeRefappRepo();
  const task = await loadTask(await addTestAuthoringTask(repo, mutants, {
    "reference-tests": suite(80100),
    "naive/weak": suite(80101),
    "naive/crashy": suite(80103),
  }));
  const tmp = async () => await Deno.realPath(await Deno.makeTempDir());
  const staged = await stageRefappTask({
    repoRoot: repo.root, task, refapp: await resolveRefapp(repo.root, "refapp-v1"), symbols: repo.symbols,
    symbolStore: repo.symbolStore, out: join(await tmp(), "stage"),
  });
  const ws = await tmp();
  await safeCopyTree(staged.pristine, ws);
  if (artifact.suite) await applyOverlay(join(task.dir, artifact.suite), ws);
  for (const cu of artifact.tests ?? []) await write(ws, `Test/src/Agent${cu}.Test.al`, suite(cu));
  for (const [rel, text] of Object.entries(artifact.edits ?? {})) await write(ws, rel, text);
  const results = await tmp();
  const frozen = await freezeWorkspace({ resultsRoot: results, privateRoot: await tmp(), workspace: ws, secrets: [] });
  return {
    executionId: crypto.randomUUID(), workspaceHash: frozen.workspace_hash, task, oracleHash: await oracleHash(task),
    pristine: staged.pristine, artifact: join(results, frozen.stored_path), symbolIds: new Set([IDS.assert]),
    workDir: await tmp(), lock: { store: repo.symbolStore, packages: repo.symbols },
    deploy: { ledgerRoot: join(results, "bc-ledger"), owned: new Set<string>() },
  };
}

const sc = (j: { scorers: { name: string; passed: boolean | null; tests: { target: string; outcome: string; failure: string | null; procedure: string }[] }[] }, n: string) =>
  j.scorers.find((s) => s.name === n)!;

Deno.test("mutant_kill: reference-tests is the positive artifact; the real HX-002 scorer list, pass_to_pass included, all pass", async () => {
  const { judgment } = await judge(new BcLane(bc(), ["C1"]), await setup({ "off-by-one": "exit(9);" }, { suite: "reference-tests" }));
  JudgmentRecordSchema.parse(judgment);
  assertEquals(judgment.scorers.map((s) => [s.name, s.passed]), [["build", true], ["pass_to_pass", true], ["mutant_kill", true]]);
  assertEquals(judgment.verdict, "pass");
  assertEquals(sc(judgment, "mutant_kill").tests.map((t) => [t.target, t.procedure, t.outcome, t.failure]), [
    ["reference", "PriceIsTen", "pass", null],
    ["mutant:0", "PriceIsTen", "fail", "assertion"],
    ["mutant:off-by-one", "PriceIsTen", "fail", "assertion"],
  ]);
});

Deno.test("mutant_kill: each named naive suite fails (weak survives, runtime errors are not kills)", async () => {
  for (const naive of ["naive/weak", "naive/crashy"]) {
    const { judgment } = await judge(new BcLane(bc(), ["C1"]), await setup({ "off-by-one": "exit(9);" }, { suite: naive }));
    assertEquals(judgment.verdict, "fail", naive);
  }
});

Deno.test("mutant_kill: a lost ASSERTERROR is an assertion and kills", async () => {
  const { judgment } = await judge(new BcLane(bc(), ["C1"]), await setup({ "off-by-one": "exit(9);" }, { tests: [80104] }));
  assertEquals(judgment.verdict, "pass");
});

Deno.test("mutant_kill: tests failing on the reference fail and mutants are not run", async () => {
  const fake = bc();
  const { judgment } = await judge(new BcLane(fake, ["C1"]), await setup({ "off-by-one": "exit(9);" }, { tests: [80102] }));
  assertEquals(judgment.verdict, "fail");
  assertEquals(fake.tests.filter((x) => x.codeunit === 80102).length, 1, "only the reference run");
});

Deno.test("mutant_kill: a mutant that does not compile is not a kill", async () => {
  const { judgment } = await judge(new BcLane(bc(), ["C1"]), await setup({ broken: "COMPILE_ERROR" }, { suite: "reference-tests" }));
  assertEquals(judgment.verdict, "fail");
});

Deno.test("mutant_kill: conformance fixture: assertion in A, missing B on a mutant is infra, not a kill", async () => {
  const fx = JSON.parse(await Deno.readTextFile("tests/fixtures/harness/conformance/mixed-assertion-missing.json"));
  const reported = new Map<string, true | string>(
    fx.run.tests.filter((t: { codeunit: number }) => t.codeunit === 85000)
      .map((t: { procedure: string; passed: boolean; message?: string }) => [t.procedure, t.passed ? true : t.message!]),
  );
  const procs = fx.task.fail_to_pass.tests[0].procedures as string[]; // ["A", "B"]: B never reports
  const fake = bc((cu, src) => {
    if (cu !== 80105) return result({});
    if (src.includes("exit(10);")) return result(Object.fromEntries(procs.map((p) => [p, true])));
    return result(Object.fromEntries(reported));
  });
  const input = await setup({ "off-by-one": "exit(9);" }, { edits: { "Test/src/Agent80105.Test.al": suite(80105, procs) } });
  const { judgment } = await judge(new BcLane(fake, ["C1"]), input);
  assertEquals(fx.expected, { infra: true, kill: false });
  assertEquals(sc(judgment, "mutant_kill").passed, null, "no survivor, every mutant infra: unscored");
  assertEquals(judgment.verdict, "unscored");
});

Deno.test("mutant_kill: infra on a later mutant keeps an earlier survivor (definite fail)", async () => {
  const fake = bc((cu, src) => cu === 80106 ? (src.includes("exit(8);") ? "throw-infra" : result({ PriceIsTen: true })) : result({}));
  const input = await setup({ same: "exit(10);  ", flaky: "exit(8);" }, { edits: { "Test/src/Agent80106.Test.al": suite(80106) } });
  const { judgment } = await judge(new BcLane(fake, ["C1"]), input);
  assertEquals(sc(judgment, "mutant_kill").passed, false);
  assert(sc(judgment, "mutant_kill").tests.some((t) => t.target === "mutant:flaky" && t.failure === "infra"));
});

Deno.test("mutant_kill: a submitted TestPage codeunit is rejected with the reason; no agent test is a fail", async () => {
  const page = await judge(new BcLane(bc(), ["C1"]), await setup({ "off-by-one": "exit(9);" }, {
    suite: "reference-tests",
    edits: { "Test/src/Page.Test.al": suite(80107, ["UsesPage"], '    var P: TestPage "Customer Card";') },
  }));
  assertEquals(page.judgment.verdict, "fail");
  assertStringIncludes(page.log.test_messages.map((m) => m.message).join("\n"), "TestPage tests are not supported");
  const none = await judge(new BcLane(bc(), ["C1"]), await setup({ "off-by-one": "exit(9);" }, {}));
  assertEquals(none.judgment.verdict, "fail");
  assertStringIncludes(none.log.notes.join("\n"), "no agent test");
});

Deno.test("mutant_kill: agent production edits are reset to the reference", async () => {
  const { judgment } = await judge(new BcLane(bc(), ["C1"]), await setup({ "off-by-one": "exit(9);" }, {
    suite: "reference-tests", edits: { "Rental/src/Rental.Codeunit.al": rental("exit(12);") },
  }));
  assertEquals(judgment.verdict, "pass");
});
```

(The `same` mutant differs textually but behaves like the reference, so it survives. `FakeBc` turns `COMPILE_ERROR` in a source into a compile diagnostic, as in M1-16; a thrown `timed out` error is infra for the lane, which reroutes and then gives up on the single container.)

- [ ] **Step 2: Run it and see it fail**

Run: `deno test --allow-all tests/unit/harness/verdict-mutant.test.ts`
Expected: FAIL, `mutant_kill is implemented in M1-18`.

- [ ] **Step 3: Implement** (replace the stub in `src/harness/verdict.ts`; import `applyOverlay` from `./staging.ts`, `safeCopyTree` from `./fsutil.ts`, `ValidationError` from `../errors.ts`, `isInfraError` from `../health/is-infra-error.ts`, `InfraRetriesExhaustedError`, `NoEligibleContainersError` from `../parallel/errors.ts`)

```typescript
const isTestPath = (rel: string) => rel === TEST_APP || rel.startsWith(`${TEST_APP}/`);
const infraThrown = (err: unknown) =>
  err instanceof InfraRetriesExhaustedError || err instanceof NoEligibleContainersError || isInfraError(err);

type MutantOutcome = "killed" | "survived" | "infra";

/** Per mutant (M4 gate parity): any infra row is infra; else an assertion failure kills; else it survived. */
function mutantOutcome(rows: TestRow[]): MutantOutcome {
  if (rows.length === 0 || rows.some((r) => r.failure === "infra")) return "infra";
  if (rows.some((r) => r.outcome === "fail" && r.failure === "assertion")) return "killed";
  return "survived";
}

/**
 * test-authoring: production is the reference (staged + correct/); only the
 * agent's Test\\ changes are kept. pass_to_pass runs on the reference; the
 * submitted suite runs on the reference, on mutant 0 (staged production)
 * and on every named mutant.
 */
export async function scoreTestAuthoring(ctx: JudgeContext): Promise<void> {
  const { i, scores, log } = ctx;
  const t = i.task.task;
  if (t.mutants.includes("0")) throw new ValidationError(`${t.id}: mutant name "0" is reserved`, ["0"]);
  const tr = performance.now();
  const reference = join(i.workDir, "reference");
  await safeCopyTree(i.pristine, reference);
  await applyOverlay(join(i.task.dir, "correct"), reference, { exclude: isTestPath });
  const vw = await buildVerdictWorkspace({
    pristine: i.pristine, artifact: i.artifact, out: join(i.workDir, "verdict"), productionFrom: reference, symbolIds: i.symbolIds,
  });
  log.spans.reconstruct_ms = performance.now() - tr;
  log.violations = vw.violations;
  if (vw.violations.length > 0) return scores.failRest();

  const pristineApps = await readAppGraph(i.pristine);
  const prepare = (dir: string, apps: StagedApp[], changed: string[], name: string) =>
    prepareApps(ctx.lane, {
      pristine: i.pristine, pristineApps, candidateDir: dir, candidateApps: apps, changed, workDir: join(i.workDir, name), lock: i.lock,
    });
  const prep = await prepare(vw.dir, vw.apps, vw.changed, "apps-reference");
  recordBuild(ctx, prep, "reference");
  if (!prep.buildOk) return scores.failRest();
  scores.set("build", true);

  const added = await addedTestCodeunits(join(i.pristine, TEST_APP), join(vw.dir, TEST_APP));
  const unsupported = added.filter((a) => a.testPage);
  if (unsupported.length > 0) {
    for (const u of unsupported) {
      log.test_messages.push({ codeunit: u.codeunit, procedure: "(TestPage)", target: "reference", message: "TestPage tests are not supported by the harness test runner" });
    }
    scores.set("mutant_kill", false);
    return scores.failRest();
  }
  const agent = added.filter((a) => a.procedures.length > 0);
  for (const a of added.filter((x) => x.procedures.length === 0)) log.notes.push(`codeunit ${a.codeunit} has no [Test] procedure`);
  if (agent.length === 0) {
    log.notes.push("mutant_kill: no agent test codeunit discovered");
    scores.set("mutant_kill", false);
    return scores.failRest();
  }
  const specs = (target: string): TestSpec[] =>
    agent.map((a) => ({ codeunit: a.codeunit, procedures: a.procedures, target, zeroIsInfra: true }));
  const p2p: TestSpec[] = t.pass_to_pass.map((r) => ({ codeunit: r.codeunit, procedures: r.procedures, target: "reference", zeroIsInfra: true }));
  const p2pUnits = new Set(p2p.map((s) => s.codeunit));

  let refRows: TestRow[];
  try {
    refRows = (await runHeld(ctx, prep.wanted, [...p2p, ...specs("reference")], [...prep.candidateIds].reverse())).rows;
  } catch (err) {
    if (!infraThrown(err)) throw err;
    log.error = err instanceof Error ? err.message : String(err);
    return scores.nullRest();
  }
  if (scores.has("pass_to_pass")) {
    const r = refRows.filter((x) => p2pUnits.has(x.codeunit));
    scores.set("pass_to_pass", scorerPassed(r), r);
  }
  const mkRows = refRows.filter((x) => !p2pUnits.has(x.codeunit));
  const onRef = scorerPassed(mkRows);
  if (onRef !== true) {
    scores.set("mutant_kill", onRef, mkRows);
    return scores.failRest();
  }

  const outcomes: MutantOutcome[] = [];
  for (const m of ["0", ...t.mutants]) {
    const target = `mutant:${m}`;
    const allRows = (failure: TestRow["failure"], procedureOverride?: string): TestRow[] =>
      agent.flatMap((a) => a.procedures.map((p) => ({
        codeunit: a.codeunit, procedure: procedureOverride ?? p, target, outcome: "not_run" as const, failure,
      })));
    try {
      let production = i.pristine;
      if (m !== "0") {
        production = join(i.workDir, `mutant-src-${m}`);
        await safeCopyTree(reference, production);
        await applyOverlay(join(i.task.dir, "mutants", m), production, { exclude: isTestPath });
      }
      const mv = await buildVerdictWorkspace({
        pristine: i.pristine, artifact: i.artifact, out: join(i.workDir, `mutant-${m}`), productionFrom: production, symbolIds: i.symbolIds,
      });
      const mp = await prepare(mv.dir, mv.apps, mv.changed, `apps-mutant-${m}`);
      recordBuild(ctx, mp, target);
      if (!mp.buildOk) {
        mkRows.push(...allRows("compile"));
        outcomes.push("survived"); // not a kill
        continue;
      }
      const rows = (await runHeld(ctx, mp.wanted, specs(target), [...mp.candidateIds].reverse())).rows;
      mkRows.push(...rows);
      outcomes.push(mutantOutcome(rows));
    } catch (err) {
      if (!infraThrown(err)) throw err;
      log.notes.push(`${target}: infra after reroutes: ${err instanceof Error ? err.message : err}`);
      mkRows.push(...allRows("infra"));
      outcomes.push("infra");
    }
  }
  const passed = outcomes.includes("survived") ? false : outcomes.includes("infra") ? null : true;
  scores.set("mutant_kill", passed, mkRows);
  scores.failRest();
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `deno test --allow-all tests/unit/harness/verdict-mutant.test.ts tests/unit/harness/verdict.test.ts`
Expected: all pass (10 + 10).

- [ ] **Step 5: Check, lint, format; commit**

```bash
git add src/harness/verdict.ts tests/unit/harness/refapp-fixture.ts tests/unit/harness/verdict-mutant.test.ts
git commit -m "feat(harness): mutant_kill on the HX-002 contract with pass_to_pass, expected procedures and per-mutant infra"
```

**Acceptance:** both test files pass, including the real HX-002 scorer list (`build`, `pass_to_pass`, `mutant_kill`) and the M4 conformance fixture `tests/fixtures/harness/conformance/mixed-assertion-missing.json` read verbatim (infra, not a kill); `harness judge-fixture HX-002 reference-tests --rev refapp-v1-rc2` passes and every `naive/<name>` at rc2 fails on a container (M1-38); check, lint and `deno fmt --check` clean.

---

### Task M1-35: mock harness: adapter, image, arms from a per-task qualification manifest

Spec 1a section 11 (a mock harness exercises the full pipeline without a model), M4 round 2 section 4: the positive mock artifact is `correct/` for change tasks and `reference-tests/` for test-authoring tasks; named naive variants come from the explicit qualification manifest shared with M4 (`src/harness/qualify.ts`, M1-24; the path is passed with `--qualify-manifest`, see the integrated schedule), not "first alphabetically". Open question 8: mock configs have empty `models` (and only mock configs); every real config keeps the catalog check.

The mock image (`harness/images/mock/`) runs `mock.ps1`: it reads `C:\config\settings.json` (`mode`, `variant`) and `C:\config\variant\` (the runner copies the named variant folder there, because `C:\task` is agent-visible metadata only and never holds solutions), applies it to `C:\workspace` with `.delete` semantics, optionally calls `cg-al`, and prints JSON lines (`mock_init`, `mock_apply`, `mock_cg_al`, `mock_done`). Modes: `apply`, `crash`, `crash-after-work`, `sleep`, `usage-limit`, and the hostile fixtures of M1-30. The adapter is not credential-bearing, so mock arms run unattended without egress enforcement.

**Lane:** infra2 (stream B). **Deps:** M1-22, M1-24. **Date:** 10-06.

**Files:**
- Create: `src/harness/adapters/mock.ts`, `harness/images/mock/Dockerfile.windows`, `harness/images/mock/mock.ps1`, `harness/configs/mock-*.yml` (positive, naive, crash, crash-after-work, sleep, usage, and the hostile set), `tests/fixtures/harness/hostile/*`
- Modify: `src/harness/adapters/mod.ts` (register), `src/harness/config.ts` (empty `models` allowed only for `harness: mock`), `src/harness/execution.ts` (`MockVariant` hook: copy the resolved variant folder into the config dir), `tests/unit/harness/runtime-fixture.ts` (mock configs and image)
- Test: `tests/unit/harness/mock.test.ts`

**Interfaces:** `mockAdapter: HarnessAdapter` (`credentialBearing: false`, `enforcesBudget: true` (no spend), `secretFiles: []`); `QualifyManifest` and `loadQualifyManifest` from M1-24's `qualify.ts`; `resolveVariant(task, settings, manifest): string` (`positive` resolves per task; `naive:<name>` must be listed; anything else refused).

- [ ] **Step 1: Write the failing tests** (`tests/unit/harness/mock.test.ts`):

```typescript
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import { mockAdapter, resolveVariant } from "../../../src/harness/adapters/mock.ts";
import { HarnessConfigSchema } from "../../../src/harness/config.ts";
import { runCell } from "../../../src/harness/execution.ts";
import { cellFor, makeEnv, mockImageBehavior } from "./runtime-fixture.ts";

const manifest = {
  v: 1 as const,
  refapp_version: "refapp-v1",
  tasks: {
    "HX-001": { rev: "refapp-v1-rc1", positive: "correct" as const, naive: ["a"] },
    "HX-002": { rev: "refapp-v1-rc2", positive: "reference-tests" as const, naive: ["weak", "crashy"] },
  },
};

Deno.test("resolveVariant: positive per task kind; named naive only from the manifest", () => {
  assertEquals(resolveVariant("HX-001", { variant: "positive" }, manifest), "correct");
  assertEquals(resolveVariant("HX-002", { variant: "positive" }, manifest), "reference-tests");
  assertEquals(resolveVariant("HX-002", { variant: "naive:crashy" }, manifest), "naive/crashy");
  assertThrows(() => resolveVariant("HX-002", { variant: "naive:missing" }, manifest), ConfigurationError, "missing");
  assertThrows(() => resolveVariant("HX-002", { variant: "naive" }, manifest), ConfigurationError, "name");
  assertThrows(() => resolveVariant("HX-009", { variant: "positive" }, manifest), ConfigurationError, "HX-009");
});

Deno.test("mock configs may have empty models; real configs may not", () => {
  HarnessConfigSchema.parse({ id: "m", harness: "mock", harness_version: "1", models: {}, settings: {}, limits: { timeout_min: 5, max_budget_usd: 1 } });
  assertThrows(() => HarnessConfigSchema.parse({ id: "c", harness: "claude-code", harness_version: "2.1.282", models: {}, settings: {}, limits: { timeout_min: 5, max_budget_usd: 1 } }));
});

Deno.test("mock arms: positive passes, a named naive fails, unattended without egress enforcement", async () => {
  const t = await makeEnv();
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  const pos = await runCell(t.env, await cellFor(t, "mock-positive"));
  assertEquals((await t.env.store.judgments(pos.executions[0]!.id))[0]!.verdict, "pass");
  const neg = await runCell(t.env, await cellFor(t, "mock-naive-a"));
  assertEquals((await t.env.store.judgments(neg.executions[0]!.id))[0]!.verdict, "fail");
  assertEquals(mockAdapter.credentialBearing, false);
});

Deno.test("mock arms: crash before work is retried once when unattended; usage limit pauses", async () => {
  const t = await makeEnv();
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  const crash = await runCell(t.env, await cellFor(t, "mock-crash"));
  assertEquals(crash.executions.map((e) => e.run_kind), ["planned", "auto_retry"]);
  const usage = await runCell(t.env, await cellFor(t, "mock-usage"));
  assertEquals(usage.executions[0]!.termination, "usage_limited");
});

Deno.test("the variant is copied into the config dir, never into C:\\task", async () => {
  const t = await makeEnv();
  t.env.supervised = false;
  t.docker.behavior = mockImageBehavior();
  await runCell(t.env, await cellFor(t, "mock-positive"));
  const call = t.docker.runs[0]!;
  await assertRejects(() => Deno.stat(join(call.mounts.get("C:\\task")!.src, "correct")));
});
```

`runtime-fixture.ts` gains the mock configs (`settings: { mode: apply, variant: positive }`, `{ mode: apply, variant: "naive:a" }`, `{ mode: crash }`, `{ mode: usage-limit }`), a `harness/qualify-manifest.json` in the temp repo, the mock image entry in the fake docker, and `mockImageBehavior()` for `FakeDocker` (reads the mounted config dir and applies `C:\config\variant` to the mounted workspace, prints the mock lines).

- [ ] **Steps 2-6:** run (fails: module not found), implement, run (5 pass), check/lint/fmt, commit `feat(harness): mock adapter and arms with per-task variant manifest`.

**Acceptance:** `deno test --allow-all tests/unit/harness/mock.test.ts tests/unit/harness/execution.test.ts` passes; `deno task start harness images build mock --version 1` type-checks its path (built for real in M1-30).

---

### Task M1-33: egress enforcement: internal sandbox network, scoped inbound block rules, allowlisting proxy, verified effective policy, preflight before credentials

Egress decision 2026-09-25 as amended the same evening (M1-31: HNS endpoint ACLs are accepted but not enforced on this host, so that path is dropped), the owner constraint (every other container keeps internet; default inbound and outbound ALLOW on every profile; the only new rules are inbound BLOCK rules on the sandbox vEthernet except the proxy and backend ports; nothing on `nat`, WSL, Default Switch or the Hyper-V firewall), decision accept-M1-31 (complementary TCP ranges; UDP, ICMP and every other protocol blocked; gateway binds; rules re-verified whenever the network is recreated; foreign block inventory before enabling profiles) and review round 2 item 7 (verify **effective** enforcement). lane-ops applies the host change elevated (M1-34); the harness never elevates and only reads.

Design:
- **One persistent network** `cg-harness-sandbox` (`docker network create -d internal --subnet 172.30.60.0/24 --gateway 172.30.60.1`), created by ops. Proxy `3128` and cg-al backend `3210` bind `172.30.60.1` only.
- **Rules** (group `cg-harness-egress`): every rule is enabled, `Inbound`, `Block`, profile `Any`, remote address `Any`, local address `Any`, program `Any`, service `Any`, bound to the **interface index** of the adapter that owns the gateway IP. TCP as complementary ranges (`1-3127`, `3129-3209`, `3211-65535`), because a block rule overrides any allow rule; one rule per other IP protocol number (0-255 except 6), which covers UDP, ICMPv4, ICMPv6 and the rest. No allow rule, no outbound rule.
- **Effective policy, not intent; incomplete observations fail** (round 3 B5). `collectEgressState` throws when any part of its output is missing, truncated or unparseable (never an empty inventory), and `verifyEgressState` requires exactly the three profiles Domain, Private and Public, each once. `collectEgressState` reads the **active store** (`Get-NetFirewallRule -PolicyStore ActiveStore`, which includes policy-derived rules) with each rule's port, address, application, service and interface filters, the three profiles, the docker network (`Id`, driver, subnet, gateway and its `com.docker.network.windowsshim.hnsid`), the HNS network with that id (type `Internal`, same subnet), and the adapter that owns the gateway IP (index, alias, prefix). `verifyEgressState` requires: network internal with the planned subnet and gateway; the HNS network internal with the same subnet; the gateway adapter's prefix equal to the subnet; the group's rules exactly the plan, compared field by field (enabled, direction, action, profile, protocol, ports, remote and local address, program, service, interface index); every profile enabled with default inbound and outbound `Allow`; no effective foreign `Block` rule; and the marker's recorded network id and interface index equal to the current ones (a recreated network fails until the rules are regenerated and reapplied).
- **Transactional apply and revert** (`applyScript`, `revertScript`, generated by `scripts/harness/egress-scripts.ts`, run by ops elevated): the apply script takes an invocation id; it refuses before any change if the group already exists, if the gateway's adapter is not the planned one, or if any effective foreign enabled Block rule exists (inventory written to `fw-block-inventory-<id>.json`: owner decision); it snapshots the profiles to `fw-snapshot-<id>.json`, sets defaults to Allow **before** enabling profiles, creates the rules while recording each created name in `fw-apply-<id>.json`; on any error it rolls back **only what this invocation did** (the recorded rule names; the profiles only if this invocation changed them). The revert script removes the group, restores the profiles from the latest applied snapshot, and archives that invocation's files (`*.reverted-<timestamp>`), so a later apply starts clean.
- **States** in the marker `results/harness/egress-verified.json`: `candidate` (applied), `qualified` (host verified and in-sandbox probes passed, no credential), `authorized` (after credential rotation and one enforced supervised Claude cell). M1-24's `resolveEgress` treats only `authorized` plus a passing verification as enforced for unattended credential runs; `qualified` or `authorized` plus a passing verification places sandboxes on the internal network with the proxy; any marker with a failing verification stops the command.
- **Per-run preflight before credentials.** An enforced sandbox starts on `cg-harness-sandbox` with `HTTPS_PROXY`/`HTTP_PROXY=http://172.30.60.1:3128`, `NO_PROXY=172.30.60.1`, and an **empty** secrets mount; the entrypoints wait for `C:\cg-secrets\ready`. The runner (1) checks that the proxy and backend are listening on the gateway only, (2) runs `C:\egress-check.ps1` (shipped in the base image) and evaluates its lines, (3) only then writes the secret files and `ready`. Any failure: kill, no secret written, `setup_failed`, the campaign stops. The probe script runs under the image's Windows PowerShell 5.1 and bounds every attempt itself with .NET APIs available there (a `TcpClient.ConnectAsync(...).Wait(3000)` wrapper, `System.Net.NetworkInformation.Ping.Send(host, 3000)` for ICMP, a UDP client with `ReceiveTimeout = 3000`, `Resolve-DnsName -QuickTimeout`, `Invoke-WebRequest -TimeoutSec 5`), never `Test-NetConnection` or PowerShell 7's `Test-Connection -TimeoutSeconds`. Each line reports `ok` for the connection outcome and, separately, `error` when the probe itself could not run (missing cmdlet or parameter, bad setup); an `error` line is never read as "blocked" (round 3 B5).
- **Proxy** `src/harness/egress-proxy.ts`: CONNECT only, port 443 only, exact host allowlist from the arm's provider routes (plus the OAuth hosts M1-34 records), no IP literals, resolves DNS itself and refuses private, loopback and link-local resolutions, binds the gateway only, logs every decision to the execution's quarantine `egress.jsonl`; a `deny` during a run kills the sandbox (`harness_crash`, reason `egress_violation`).

**Lane:** infra (stream A). **Deps:** M1-31, M1-22, M1-24. **Date:** 10-06 to 10-08.

**Files:**
- Create: `src/harness/egress.ts` (constants, plan, scripts, state types, verifier, preflight evaluator, collector behind a command seam), `src/harness/egress-proxy.ts`, `harness/images/base/egress-check.ps1`, `scripts/harness/egress-scripts.ts`
- Modify: `harness/images/base/Dockerfile.windows` (`COPY egress-check.ps1 C:/egress-check.ps1`), `harness/images/claude-code/run.ps1` (wait for `ready`), `src/harness/sandbox.ts` users (`network` set when enforced), `src/harness/execution.ts` (listener check, preflight, secrets after preflight), `cli/commands/harness-env.ts` (`REAL_DEPS.verifyEgress`, proxy start, backend on the sandbox gateway when placed), `cli/commands/harness-command.ts` (`harness egress verify`), `scripts/harness/backend-probe.ts` (`--enforced`)
- Test: `tests/unit/harness/egress.test.ts`

**Interfaces:** `SANDBOX_NETWORK = { name: "cg-harness-sandbox", subnet: "172.30.60.0/24", gateway: "172.30.60.1" }`; `PROXY_PORT = 3128`; `BACKEND_PORT = 3210`; `RULE_GROUP = "cg-harness-egress"`; `blockedTcpRanges(allowed)`; `interface FirewallRule { name; enabled: boolean; direction: "Inbound" | "Outbound"; action: "Block" | "Allow"; profile: string; protocol: number; localPorts: string[] | "Any"; remoteAddress: string; localAddress: string; program: string; service: string; interfaceIndex: number }`; `firewallPlan(interfaceIndex): FirewallRule[]`; `applyScript(plan, o: { invocation; dir; interfaceAlias }): string`; `revertScript(dir): string`; `interface EgressState { network: { id; driver; subnet; gateway; hnsId } | null; hns: { id; type; subnet } | null; gatewayAdapter: { index; alias; prefix } | null; profiles: { name; enabled; inbound; outbound }[]; groupRules: FirewallRule[]; foreignBlockRules: string[]; marker: { state; networkId; interfaceIndex } | null }`; `verifyEgressState(s): string[]`; `collectEgressState(run?): Promise<EgressState>`; `PREFLIGHT_EXPECT: Record<string, boolean>`; `interface ProbeLine { probe; ok: boolean; error?: string }`; `evaluatePreflight(lines): string[]`; `startEgressProxy(o: { hostname; port; allow; log; allowedHosts; resolve?; dial? }): { port: number; shutdown(): Promise<void> }`.

- [ ] **Step 1: Write the failing tests** (`tests/unit/harness/egress.test.ts`):

```typescript
import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { ConfigurationError } from "../../../src/errors.ts";
import {
  applyScript,
  blockedTcpRanges,
  collectEgressState,
  type EgressState,
  evaluatePreflight,
  firewallPlan,
  PREFLIGHT_EXPECT,
  revertScript,
  RULE_GROUP,
  SANDBOX_NETWORK,
  verifyEgressState,
} from "../../../src/harness/egress.ts";
import { startEgressProxy } from "../../../src/harness/egress-proxy.ts";

const IDX = 42;

function goodState(): EgressState {
  return {
    network: { id: "net1", driver: "internal", subnet: SANDBOX_NETWORK.subnet, gateway: SANDBOX_NETWORK.gateway, hnsId: "hns1" },
    hns: { id: "hns1", type: "Internal", subnet: SANDBOX_NETWORK.subnet },
    gatewayAdapter: { index: IDX, alias: "vEthernet (a1b2c3)", prefix: 24 },
    profiles: ["Domain", "Private", "Public"].map((name) => ({ name, enabled: true, inbound: "Allow", outbound: "Allow" })),
    groupRules: firewallPlan(IDX),
    foreignBlockRules: [],
    marker: { state: "qualified", networkId: "net1", interfaceIndex: IDX },
  };
}

Deno.test("blockedTcpRanges: complementary ranges around the proxy and the backend", () => {
  assertEquals(blockedTcpRanges([3210, 3128]), ["1-3127", "3129-3209", "3211-65535"]);
  assertEquals(blockedTcpRanges([1, 65535]), ["2-65534"]);
});

Deno.test("firewallPlan: enabled inbound blocks only, every protocol, on one interface index; never a TCP block over 3128 or 3210", () => {
  const plan = firewallPlan(IDX);
  assert(plan.every((r) => r.enabled && r.direction === "Inbound" && r.action === "Block" && r.profile === "Any" && r.interfaceIndex === IDX));
  assert(plan.every((r) => r.remoteAddress === "Any" && r.localAddress === "Any" && r.program === "Any" && r.service === "Any"));
  const tcp = plan.filter((r) => r.protocol === 6);
  assertEquals([tcp.length, tcp[0]!.localPorts], [1, ["1-3127", "3129-3209", "3211-65535"]]);
  const others = plan.filter((r) => r.protocol !== 6).map((r) => r.protocol);
  assertEquals(others.length, 255);
  assert([1, 17, 58, 47].every((n) => others.includes(n)));
  assertThrows(() => firewallPlan(0), ConfigurationError);
});

Deno.test("applyScript: refuses before any change, inventories effective foreign blocks, defaults Allow before enabling, per-invocation rollback", () => {
  const s = applyScript(firewallPlan(IDX), { invocation: "inv1", dir: "C:\\cg\\fw", interfaceAlias: "vEthernet (a1b2c3)" });
  const at = (x: string) => s.indexOf(x);
  assert(at("Get-NetFirewallRule -Group") < at("Set-NetFirewallProfile"), "an existing group refuses before any change");
  assert(at("-PolicyStore ActiveStore -Enabled True -Action Block") < at("Set-NetFirewallProfile"), "effective inventory before any change");
  assertStringIncludes(s, "fw-block-inventory-inv1.json");
  assertStringIncludes(s, "owner decision required");
  assert(at("fw-snapshot-inv1.json") < at("Set-NetFirewallProfile"));
  assert(at("-DefaultInboundAction Allow -DefaultOutboundAction Allow") < at("Set-NetFirewallProfile -All -Enabled True"));
  assertEquals(s.match(/New-NetFirewallRule/g)!.length, 256);
  assert(!/-Direction Outbound|-Action Allow |Set-NetFirewallHyperV/.test(s));
  assertStringIncludes(s, "fw-apply-inv1.json");
  assertStringIncludes(s, "$created"); // rollback removes only this invocation's rules
  assertStringIncludes(s, `-Group '${RULE_GROUP}'`);
});

Deno.test("revertScript: removes the group, restores the applied snapshot, archives the invocation files for a clean re-apply", () => {
  const s = revertScript("C:\\cg\\fw");
  assertStringIncludes(s, `Remove-NetFirewallRule -Group '${RULE_GROUP}'`);
  assertStringIncludes(s, "Set-NetFirewallProfile -Name $p.Name -Enabled $p.Enabled -DefaultInboundAction $p.DefaultInboundAction -DefaultOutboundAction $p.DefaultOutboundAction");
  assertStringIncludes(s, ".reverted-");
});

Deno.test("verifyEgressState: effective-policy mutations are each a named problem", () => {
  assertEquals(verifyEgressState(goodState()), []);
  const cases: [string, (s: EgressState) => void][] = [
    ["network", (s) => (s.network = null)],
    ["internal", (s) => (s.network!.driver = "nat")],
    ["hns", (s) => (s.hns!.type = "NAT")],
    ["prefix", (s) => (s.gatewayAdapter!.prefix = 16)],
    ["disabled", (s) => (s.groupRules[0]!.enabled = false)],
    ["direction", (s) => (s.groupRules[1]!.direction = "Outbound")],
    ["action", (s) => (s.groupRules[2]!.action = "Allow")],
    ["profile", (s) => (s.groupRules[3]!.profile = "Domain")],
    ["remote", (s) => (s.groupRules[0]!.remoteAddress = "10.0.0.0/8")],
    ["program", (s) => (s.groupRules[0]!.program = "C:\\x.exe")],
    ["interface", (s) => (s.groupRules[4]!.interfaceIndex = 7)],
    ["ports", (s) => (s.groupRules[0]!.localPorts = ["1-65535"])],
    ["missing rule", (s) => s.groupRules.pop()],
    ["extra rule", (s) => s.groupRules.push({ ...s.groupRules[1]!, name: "x" })],
    ["firewall profile", (s) => (s.profiles[2]!.enabled = false)],
    ["default inbound", (s) => (s.profiles[0]!.inbound = "Block")],
    ["default outbound", (s) => (s.profiles[1]!.outbound = "Block")],
    ["foreign block", (s) => (s.foreignBlockRules = ["Some app block (policy)"])],
    ["profiles", (s) => (s.profiles = [])],
    ["profiles", (s) => (s.profiles = [s.profiles[0]!, s.profiles[0]!, s.profiles[1]!])],
    ["recreated", (s) => (s.network!.id = "net2")],
    ["recreated", (s) => (s.gatewayAdapter!.index = 43)],
  ];
  for (const [word, mutate] of cases) {
    const s = goodState();
    mutate(s);
    const p = verifyEgressState(s);
    assert(p.length > 0 && p.join("\n").toLowerCase().includes(word), `${word}: ${p.join("; ")}`);
  }
});

Deno.test("evaluatePreflight: every negative must fail, every positive pass, no probe missing", () => {
  const all = Object.entries(PREFLIGHT_EXPECT).map(([probe, ok]) => ({ probe, ok }));
  assertEquals(evaluatePreflight(all), []);
  for (const p of ["direct-https", "dns-1.1.1.1", "lan-router", "gw-smb-445", "gw-rdp-3389", "gw-winrm-5985", "gw-winrm-47001", "gw-ssh-22", "gw-docker-443", "gw-docker-3001", "gw-rpc-135", "gw-vmms-2179", "gw-udp-3202", "gw-icmp", "proxy-deny-example.com", "proxy-ip-literal"]) {
    assertEquals(PREFLIGHT_EXPECT[p], false, p);
  }
  assertEquals([PREFLIGHT_EXPECT["proxy-allow-api.anthropic.com"], PREFLIGHT_EXPECT["backend-3210"]], [true, true]);
  assertStringIncludes(evaluatePreflight(all.map((l) => l.probe === "gw-smb-445" ? { ...l, ok: true } : l)).join("\n"), "gw-smb-445");
  assertStringIncludes(evaluatePreflight(all.slice(1)).join("\n"), "missing");
  const broken = all.map((l) => l.probe === "gw-icmp" ? { ...l, ok: false, error: "The term 'Test-Connection' parameter TimeoutSeconds was not found" } : l);
  assertStringIncludes(evaluatePreflight(broken).join("\n"), "could not run");
});

Deno.test("collectEgressState: a failed or truncated observation throws; it is never an empty inventory", async () => {
  const run = (out: string) => () => Promise.resolve({ code: 0, stdout: out });
  await assertRejects(() => collectEgressState(run("")), Error, "egress");
  await assertRejects(() => collectEgressState(run('{"profiles":[')), Error, "egress");
  await assertRejects(() => collectEgressState(() => Promise.resolve({ code: 1, stdout: "Access denied" })), Error, "egress");
});

Deno.test("egress-check.ps1 ships in the base image and bounds every probe itself", async () => {
  assertStringIncludes(await Deno.readTextFile("harness/images/base/Dockerfile.windows"), "COPY egress-check.ps1 C:/egress-check.ps1");
  const ps = await Deno.readTextFile("harness/images/base/egress-check.ps1");
  assertStringIncludes(ps, ".Wait(3000)");
  assertStringIncludes(ps, "System.Net.NetworkInformation.Ping");
  assert(!ps.includes("Test-NetConnection") && !ps.includes("-TimeoutSeconds"));
  assertStringIncludes(ps, "error ="); // execution errors are reported separately from blocked connections
  for (const probe of Object.keys(PREFLIGHT_EXPECT)) assertStringIncludes(ps, `'${probe}'`);
});

Deno.test("proxy: exact allowlist, CONNECT 443 only, no IP literals, no private resolutions, gateway bind only", async () => {
  const lines: { decision: string; target: string; reason: string }[] = [];
  const resolve = (h: string) => Promise.resolve(h === "internal.test" ? ["10.0.0.5"] : ["93.184.216.34"]);
  for (const h of ["0.0.0.0", "::", "192.168.2.99"]) {
    assertThrows(() => startEgressProxy({ hostname: h, port: 0, allow: [], log: () => {}, allowedHosts: ["127.0.0.1"] }), ConfigurationError);
  }
  const p = startEgressProxy({
    hostname: "127.0.0.1", port: 0, allow: ["allowed.test", "internal.test"], log: (l) => lines.push(l), resolve,
    allowedHosts: ["127.0.0.1"], dial: () => Promise.reject(new Error("no network in unit tests")),
  });
  try {
    const status = async (reqLine: string) => {
      const c = await Deno.connect({ hostname: "127.0.0.1", port: p.port });
      await c.write(new TextEncoder().encode(reqLine));
      const buf = new Uint8Array(64);
      const n = (await c.read(buf)) ?? 0;
      c.close();
      return new TextDecoder().decode(buf.subarray(0, n)).split(" ")[1];
    };
    assertEquals(await status("CONNECT denied.test:443 HTTP/1.1\r\nHost: denied.test:443\r\n\r\n"), "403");
    assertEquals(await status("CONNECT allowed.test:80 HTTP/1.1\r\nHost: allowed.test:80\r\n\r\n"), "403");
    assertEquals(await status("CONNECT 1.1.1.1:443 HTTP/1.1\r\nHost: 1.1.1.1:443\r\n\r\n"), "403");
    assertEquals(await status("CONNECT internal.test:443 HTTP/1.1\r\nHost: internal.test:443\r\n\r\n"), "403");
    assertEquals(await status("GET http://allowed.test/ HTTP/1.1\r\nHost: allowed.test\r\n\r\n"), "403");
    assertEquals(await status("CONNECT allowed.test:443 HTTP/1.1\r\nHost: allowed.test:443\r\n\r\n"), "502");
    assertEquals(lines.map((l) => l.reason), ["host not allowed", "port", "ip literal", "private address", "method", "dial failed"]);
  } finally {
    await p.shutdown();
  }
});
```

Run-time tests appended to `tests/unit/harness/execution.test.ts` (fake collector, `FakeDocker`, an in-memory preflight line source); each is written in full by the implementer before the code, with these assertions:
- `enforced run: listeners checked, preflight run, then secrets and ready; nothing earlier` (one ordered event list; the sandbox's `network` is `cg-harness-sandbox`; the secrets mount is empty until after the preflight);
- `enforced run: a proxy not listening, a failed host verification or a failed preflight aborts before any secret file exists` (three cases; `setup_failed`; secrets dir empty; no `ready`);
- `enforced run: a deny line during the run kills the sandbox (egress_violation)`;
- `enforced run: a recreated network (new id or interface index) fails until the rules are regenerated`.

- [ ] **Step 2:** run, see the failures (modules missing).
- [ ] **Step 3: Implement.** The load-bearing parts:

```typescript
export function blockedTcpRanges(allowed: number[]): string[] {
  const out: string[] = [];
  let from = 1;
  for (const p of [...new Set(allowed)].sort((a, b) => a - b)) {
    if (p > from) out.push(p - 1 === from ? `${from}` : `${from}-${p - 1}`);
    from = p + 1;
  }
  if (from <= 65535) out.push(from === 65535 ? "65535" : `${from}-65535`);
  return out;
}

/** TCP as complementary ranges (a block rule overrides any allow); every other IP protocol blocked whole. */
export function firewallPlan(interfaceIndex: number): FirewallRule[] {
  if (!Number.isInteger(interfaceIndex) || interfaceIndex <= 0) {
    throw new ConfigurationError(`refusing rules without a real interface index (got ${interfaceIndex})`);
  }
  const base = {
    enabled: true, direction: "Inbound" as const, action: "Block" as const, profile: "Any",
    remoteAddress: "Any", localAddress: "Any", program: "Any", service: "Any", interfaceIndex,
  };
  const rules: FirewallRule[] = [{ ...base, name: `${RULE_GROUP}-tcp`, protocol: 6, localPorts: blockedTcpRanges([PROXY_PORT, BACKEND_PORT]) }];
  for (let n = 0; n <= 255; n++) {
    if (n !== 6) rules.push({ ...base, name: `${RULE_GROUP}-proto-${n}`, protocol: n, localPorts: "Any" });
  }
  return rules;
}

const FIELDS = ["enabled", "direction", "action", "profile", "protocol", "localPorts", "remoteAddress", "localAddress", "program", "service", "interfaceIndex"] as const;
const LABEL: Record<(typeof FIELDS)[number], string> = {
  enabled: "disabled", direction: "direction", action: "action", profile: "profile", protocol: "protocol", localPorts: "ports",
  remoteAddress: "remote address", localAddress: "local address", program: "program", service: "service", interfaceIndex: "interface",
};

export function verifyEgressState(s: EgressState): string[] {
  const p: string[] = [];
  const n = s.network;
  if (!n) p.push("network cg-harness-sandbox is missing");
  else {
    if (n.driver !== "internal") p.push(`network driver is ${n.driver}, not internal`);
    if (n.subnet !== SANDBOX_NETWORK.subnet || n.gateway !== SANDBOX_NETWORK.gateway) p.push("network subnet or gateway differs from the plan");
  }
  if (!s.hns || s.hns.id !== n?.hnsId || s.hns.type !== "Internal" || s.hns.subnet !== SANDBOX_NETWORK.subnet) {
    p.push("hns network behind cg-harness-sandbox is not the internal network of the plan");
  }
  if (!s.gatewayAdapter || s.gatewayAdapter.prefix !== Number(SANDBOX_NETWORK.subnet.split("/")[1])) {
    p.push("gateway adapter prefix does not match the sandbox subnet");
  }
  if (s.marker && (s.marker.networkId !== n?.id || s.marker.interfaceIndex !== s.gatewayAdapter?.index)) {
    p.push("network recreated since verification (network id or interface index changed): regenerate and reapply the rules");
  }
  const plan = s.gatewayAdapter ? firewallPlan(s.gatewayAdapter.index) : [];
  const byName = new Map(s.groupRules.map((r) => [r.name, r]));
  for (const want of plan) {
    const got = byName.get(want.name);
    if (!got) {
      p.push(`missing rule ${want.name}`);
      continue;
    }
    for (const f of FIELDS) {
      if (JSON.stringify(got[f]) !== JSON.stringify(want[f])) p.push(`rule ${want.name}: ${LABEL[f]} is ${JSON.stringify(got[f])}, expected ${JSON.stringify(want[f])}`);
    }
  }
  for (const r of s.groupRules) if (!plan.some((w) => w.name === r.name)) p.push(`extra rule ${r.name} in ${RULE_GROUP}`);
  const names = s.profiles.map((x) => x.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(["Domain", "Private", "Public"])) {
    p.push(`firewall profiles observed ${JSON.stringify(names)}: expected exactly Domain, Private and Public`);
  }
  for (const pr of s.profiles) {
    if (!pr.enabled) p.push(`firewall profile ${pr.name} disabled`);
    if (pr.inbound !== "Allow") p.push(`profile ${pr.name}: default inbound is ${pr.inbound}`);
    if (pr.outbound !== "Allow") p.push(`profile ${pr.name}: default outbound is ${pr.outbound}`);
  }
  for (const f of s.foreignBlockRules) p.push(`foreign block rule is effective: ${f}`);
  return p;
}
```

`applyScript` emits, in order: an elevation check; `if (Get-NetFirewallRule -Group '<group>' -ErrorAction SilentlyContinue) { throw "group exists: revert first" }` (nothing changed yet, nothing to roll back); `(Get-NetIPAddress -IPAddress <gateway>).InterfaceAlias` must equal the planned alias; `$foreign = Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Action Block | Where-Object Group -ne '<group>'` written to `fw-block-inventory-<id>.json`, then `if ($foreign) { throw "owner decision required: effective block rules exist outside cg-harness-egress" }`; the profile snapshot to `fw-snapshot-<id>.json`; `$changedProfiles = $true`; `Set-NetFirewallProfile -All -DefaultInboundAction Allow -DefaultOutboundAction Allow`; `Set-NetFirewallProfile -All -Enabled True`; one `New-NetFirewallRule -Group '<group>' -Name ... -Direction Inbound -Action Block -Profile Any -Protocol <n> [-LocalPort ...] -InterfaceAlias '<alias>'` per rule, each name appended to `$created` and written to `fw-apply-<id>.json`; the whole body in `try { } catch { foreach ($n in $created) { Remove-NetFirewallRule -Name $n }; if ($changedProfiles) { <restore fw-snapshot-<id>.json> }; throw }`. `revertScript` finds the newest `fw-apply-*.json` without a `.reverted-` twin, removes the group, restores that invocation's snapshot per profile, and renames the invocation's three files to `*.reverted-<timestamp>`. `evaluatePreflight` reports, per expected probe, `missing`, `<probe> could not run: <error>` for a line carrying `error`, or the mismatch between `ok` and the expectation. `collectEgressState(run = realRun)` throws an error naming `egress` when the command fails, prints nothing, or its JSON lacks any of the expected sections; otherwise it runs one non-elevated `powershell -NoProfile -Command` script (no secret in it) that prints JSON for the active-store rules of the group with their filters, the foreign effective block rules, the profiles, `Get-NetIPAddress -IPAddress <gateway>` (index, alias, prefix) and `Get-HnsNetwork | Where-Object Id -eq <hnsId>`, plus `docker network inspect cg-harness-sandbox` through `dockerContextEnv()`, and reads the marker. `egress-check.ps1` prints one `{ "probe": ..., "ok": ..., "error": ... }` line per `PREFLIGHT_EXPECT` key (each probe in its own `try`; `ok = $false` for a refused or timed-out connection, `error = <message>` when the probe itself threw for any other reason), using a `TcpClient.ConnectAsync(host, port).Wait(3000)` wrapper for TCP, a UDP client with `ReceiveTimeout = 3000` for `gw-udp-3202` (a UDP echo the preflight starts on the gateway), `(New-Object System.Net.NetworkInformation.Ping).Send(host, 3000).Status -eq 'Success'` for ICMP, `Resolve-DnsName -Server 1.1.1.1 -QuickTimeout` for DNS, and `Invoke-WebRequest -Proxy -TimeoutSec 5` for the proxy.

- [ ] **Steps 4-6:** run (9 plus the 4 run-time tests pass), check/lint/fmt, commit `feat(harness): egress enforcement with verified effective firewall policy, internal network, proxy and preflight-gated credentials`.

**Acceptance (reviewer conditions from accept-M1-31 and round 2 item 7, each a tested item):**

| Condition | Test |
| --- | --- |
| TCP blocked as complementary ranges; no allow rule | `firewallPlan: ... never a TCP block over 3128 or 3210`; `applyScript` (no `-Action Allow` rule) |
| UDP, ICMP and every other IP protocol blocked on the sandbox interface | `firewallPlan: ... every protocol`; preflight `gw-udp-3202`, `gw-icmp`; M1-34 Step 6 |
| Proxy and backend bind the gateway, never 0.0.0.0 | proxy bind test; M1-19 `serve refuses wildcard and non-allowed addresses`; run-time `listeners checked` test |
| Rules recreated and verified when the network is recreated | `verifyEgressState` `recreated` cases; run-time `recreated network` test; M1-34 Step 9 drill |
| Effective foreign block rules inventoried before enabling profiles; abort for an owner decision | `applyScript` inventory ordering; `verifyEgressState` `foreign block`; M1-34 Step 0 |
| Effective enforcement verified (enabled, direction, action, profile, filters, interface index) | `verifyEgressState: effective-policy mutations` |
| Probe delivered in the image, bounded, runnable on Windows PowerShell, errors never read as blocked | `egress-check.ps1 ships in the base image and bounds every probe itself`; `evaluatePreflight` `could not run` case |
| Incomplete observations fail closed | `verifyEgressState` `profiles` cases; `collectEgressState: a failed or truncated observation throws` |
| WSL, Linux and BC containers regression-checked | M1-34 Steps 0, 4, 8 and its acceptance |

---

### Task M1-34 (ops, elevated): apply, verify, revert-test and authorize the scoped firewall; rotate every pre-enforcement credential

Owner decisions: lane-ops applies the host change elevated with a tested revert script and re-checks BC access; every other container keeps internet; before/after internet checks are mandatory and any regression triggers the revert immediately. Review round 2 item 8: listeners before checks; credentialless qualification separate from campaign authorization; a transactional, repeatable apply/revert/re-apply; every Linux command pinned; complete evidence; every pre-enforcement credential rotated. Elevated for this task only; back to non-elevated afterwards.

**Lane:** ops. **Deps:** M1-33. **Date:** 10-08 to 10-09.

Every Linux-side command in this task is written with the context pinned: `DOCKER_CONTEXT=desktop-linux docker ...` (enumeration, `exec`, and sidecars alike); every Windows-side one with `DOCKER_CONTEXT=desktop-windows`.

- [ ] **Step 0: baseline (before any change; complete or stop).** Record into `baseline.md`, each check as an explicit `OK` or `FAIL` line; any `FAIL`, missing tool or unreachable target stops the task before Step 3 (a failed baseline is not a baseline):
  - internet from **each running Linux container**: `DOCKER_CONTEXT=desktop-linux docker ps --format "{{.Names}}"`, then for each `DOCKER_CONTEXT=desktop-linux docker exec <c> sh -c "wget -q -O /dev/null https://example.com && echo HTTPS_OK; nslookup example.com >/dev/null && echo DNS_OK"`; where the image lacks those tools, a sidecar in its namespace: `DOCKER_CONTEXT=desktop-linux docker run --rm --network container:<c> curlimages/curl -sS -o /dev/null -w "%{http_code}" https://example.com` and `DOCKER_CONTEXT=desktop-linux docker run --rm --network container:<c> busybox nslookup example.com`;
  - internet from the WSL distribution itself: `wsl -e sh -c "curl -sS -o /dev/null -w '%{http_code}' https://example.com; getent hosts example.com"`;
  - internet and BC access from Cronus28, Cronus281, Cronus282, Cronus283 (read-only pwsh with the pin imported: `Invoke-ScriptInBcContainer -containerName <c> -scriptblock { (Invoke-WebRequest https://example.com -UseBasicParsing -TimeoutSec 15).StatusCode; (Resolve-DnsName example.com -QuickTimeout).Count }`; `http://<c>/BC/?tenant=default` loads the login page);
  - internet from the host (`Invoke-WebRequest https://example.com -TimeoutSec 15`, `Resolve-DnsName example.com`);
  - `Get-NetFirewallProfile | Format-Table Name,Enabled,DefaultInboundAction,DefaultOutboundAction`; the **effective** block inventory `Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Action Block | Select-Object Name,DisplayName,Direction,Group,PolicyStoreSourceType | ConvertTo-Json` (expected empty; otherwise stop and escalate for an owner decision); `Get-NetFirewallHyperVVMSetting | ConvertTo-Json` (for the after-comparison); `Get-VMSwitch`; `docker network ls` on both contexts.
- [ ] **Step 1: network.** `DOCKER_CONTEXT=desktop-windows docker network create -d internal --subnet 172.30.60.0/24 --gateway 172.30.60.1 cg-harness-sandbox`; quote `docker network inspect cg-harness-sandbox --format "{{.Id}} {{index .Options \"com.docker.network.windowsshim.hnsid\"}}"` and `Get-NetIPAddress -IPAddress 172.30.60.1 | Select-Object InterfaceIndex,InterfaceAlias,PrefixLength`.
- [ ] **Step 2: scripts.** `deno run --allow-all scripts/harness/egress-scripts.ts --index <InterfaceIndex> --alias "<InterfaceAlias>" --invocation apply1 --out H:\cg-coord\tasks\M1-34\runs\<nnn>\`; attach both scripts.
- [ ] **Step 3: apply** (elevated): `pwsh -File egress-apply.ps1`. Quote its output, the snapshot and the apply record. Write the marker in state `candidate` with the network id and interface index.
- [ ] **Step 4: after-check, immediately.** Repeat every Step 0 check. Any check that was `OK` in Step 0 and is not `OK` now is a regression: run `egress-revert.ps1` at once, repeat the checks, record, stop. Also quote `Get-NetFirewallRule -Group cg-harness-egress -PolicyStore ActiveStore | Get-NetFirewallInterfaceFilter` (only the sandbox interface) and confirm `Get-NetFirewallHyperVVMSetting` equals the Step 0 output.
- [ ] **Step 5: host verification.** `deno task start harness egress verify` prints no problem (host state only; no listener is required for it).
- [ ] **Step 6: listeners first, then probes.** `deno run --allow-all scripts/harness/backend-probe.ts Cronus281 <secrets-dir> --enforced` starts the proxy and the backend on 172.30.60.1, confirms both are listening (`netstat -ano | findstr "172.30.60.1:3128 172.30.60.1:3210"`, and neither on `0.0.0.0`), then runs `C:\egress-check.ps1` in a sandbox on `cg-harness-sandbox` with no credential. Expected blocked: `direct-https`, `dns-1.1.1.1`, `lan-router`, `gw-smb-445`, `gw-rdp-3389`, `gw-winrm-5985`, `gw-winrm-47001`, `gw-ssh-22`, `gw-docker-443`, `gw-docker-3001`, `gw-rpc-135`, `gw-vmms-2179`, `gw-udp-3202`, `gw-icmp`, a test listener on 3201; expected open: `proxy-allow-api.anthropic.com`, `backend-3210` (401 without a token); proxy 403 for `example.com` and an IP literal. Quote every line. Update the marker to `qualified`.
- [ ] **Step 7: scope check.** The 3201 test listener is still reachable from Cronus281 (on `nat`) and from a Linux container: the rules bind only to the sandbox interface.
- [ ] **Step 8: revert test and re-apply.** Run `egress-revert.ps1`; quote the profiles (equal to the Step 0 snapshot), `(Get-NetFirewallRule -Group cg-harness-egress).Count` = 0, the archived `*.reverted-*` files, and repeat the Step 0 checks (all as baseline). Regenerate the scripts with `--invocation apply2`, apply again, and repeat Steps 4, 5 and 6 (all as before). Also run the apply once more without reverting and quote its refusal ("group exists") with nothing changed.
- [ ] **Step 9: network recreation drill and fault paths.** Remove and recreate `cg-harness-sandbox` (same subnet): `harness egress verify` reports `recreated`, and an enforced mock cell ends `setup_failed` with an empty secrets dir. Revert, regenerate for the new index (`--invocation apply3`), apply, verify, probe (Steps 3 to 6). Then, with enforcement on, stop the proxy before a preflight, and separately disable one group rule (`Disable-NetFirewallRule -Name cg-harness-egress-proto-17`): each enforced mock cell ends `setup_failed` with an empty secrets dir and no container left, and `harness egress verify` names the disabled rule; re-enable it.
- [ ] **Step 10: rotate every pre-enforcement credential.** Revoke the Claude OAuth token used by the supervised runs and the OpenRouter key used by M4-17's pilot; issue new dedicated benchmark credentials; store them only as files in the operator secrets directory. Record revocation and creation times, never the values. Quote the shared ledger's lines for the pre-enforcement runs.
- [ ] **Step 11: one enforced supervised Claude Code cell** on HX-001 (it reserves a slot in the shared ledger: the marker is not yet `authorized`): `egress.jsonl` shows only allowlisted CONNECTs (record the OAuth host names used, for the allowlist); no `deny` line; the traffic capture shows only the proxy and the backend from the sandbox.
- [ ] **Step 12: authorize.** Write the marker `{ "v": 1, "state": "authorized", "verified_at": ..., "evidence": "M1-34/<nnn>", "network": "cg-harness-sandbox", "network_id": ..., "interface_index": ..., "proxy_allowlist": [...] }`; `harness egress verify` prints no problem. Leave the session non-elevated.

**Acceptance (no container):** the evidence records, **before and after** the first apply, after the revert, after the re-apply and after the recreation drill, `OK` HTTPS and DNS results from each running Linux container (context-pinned commands quoted), the WSL distribution, Cronus28, Cronus281, Cronus282, Cronus283 and the host, with no regression (or the immediate revert and stop if one occurred); BC login pages load after each change; the effective block inventory (empty, or the owner decision quoted); the rule listing shows only inbound block rules on the sandbox interface; Hyper-V firewall settings unchanged; the listeners on the gateway only; every Step 6 probe as expected; the revert restored the baseline and archived its files, the re-apply succeeded and a second apply refused without changes; the recreation drill failed closed and passed after regeneration; both fault paths ended with empty secrets dirs; rotation timestamps for the Claude OAuth token and the OpenRouter key; the enforced cell's `egress.jsonl`; the marker's `candidate`, `qualified` and `authorized` contents in order.

---

### Task M1-23: campaign runner (no historical reuse)

Spec 1a section 6 (a campaign fixes arms, image ids and task identities; each (task, repeat) block runs every arm in a recorded randomized order; `harness run` resumes the current campaign), section 8 (retry policy via Part 1 `outcomePolicy`/`retryChains`/`retryProblem`; usage pause; stop on a sandbox cleanup failure), Part 1 (`CampaignRecord.tasks_meta.limits` stores each task's **own overrides**, never an arm-specific effective result: every execution derives its limits from its own arm template with `forTask`; `reuse` stays empty; `validateCampaignRecords` on resume), retries by ancestry (`runCell` receives the cell's prior executions so `retryProblem` sees manual roots and usage-limit chains), answer 11 (pause state persisted; concurrent limits combine to the latest reset; `--max-pause-min 0` means stop with a resume line), answer 17 (concurrency 1 default), egress decision (a credential-bearing arm is refused unless `env.egressEnforced`, which requires the verified `authorized` state; a marker that fails verification stops the run; supervised campaigns do not exist).

**Lane:** infra2 (stream B). **Deps:** M1-08, M1-09, M1-22, M1-35. **Date:** 10-07.

**Files:** create `src/harness/campaign.ts`; test `tests/unit/harness/campaign.test.ts`.

**Interfaces:** `interface RunOptions { sample?; repeats?; dryRun; concurrency; seed?; maxPauseMs }`; `interface CampaignSummary { campaignId; created; planned; ran; judged; unscored; paused: string | null }`; `runCampaign(env, experimentId, o, io): Promise<CampaignSummary>`; `cellRefFor(c, opened, block, arm, orderInBlock): CellRef`; `loadCampaignData(store, c)`.

- [ ] **Step 1: failing tests** (mock arms from M1-35), minimum set:
  - `dry run plans blocks x arms with the recorded order and writes nothing`;
  - `a full run judges every planned cell; resume after a kill reuses the campaign id and skips done cells` (records pass `validateCampaignRecords`);
  - `a crash before work gets one auto_retry decided by ancestry; a second crash is final; a manual_rerun root may get its own retry`;
  - `a usage limit with maxPauseMs 0 stops with a resume line; the next run retries the cell as auto_retry`;
  - `an unconfirmed sandbox termination stops the campaign with the intent kept; the next run recovers it before planning`;
  - `a credential-bearing arm is refused without egress enforcement; with it, the campaign runs unattended`;
  - `tasks_meta.limits stores the task's own overrides; two arms with different limits against one task override get their own effective execution limits; reuse stays empty`.
- [ ] **Steps 2-6** as usual; commit `feat(harness): campaign runner with blocks, resume, retries and pause`.

**Acceptance:** `campaign.test.ts` passes; check, lint, fmt clean.

---

### Task M1-24b: CLI `run`, `rejudge`, `qualify`

Spec 1a section 10 (`harness run <experiment> [--dry-run] [--sample N] [--repeats N]`, `harness rejudge`), answer 15 (`rejudge <experiment> [--execution <id>]` with owner confirmation; requires the restaged `visibleInputHash` to equal the execution's, complete task coverage, record validation and the current scorer suite; always judged against the current oracle and labeled so), `--reuse-history` is not added until M1-37. `harness qualify --manifest <path>` runs, for every manifest entry at its immutable `rev`, `judge-fixture` for the positive variant and each named naive variant and one mock cell per variant (M1-35), and writes `results/harness/qualify/<manifest sha256>/index.json`: one entry per `(task, variant)` with `judgment_path`, `provenance_path`, `verdict`, `expected`, `reasons`, `targets` and `mock_cell`, exactly as the agreed M4-14/M4-15 contract in the Schedule section specifies (the M1-38 and M4-15 evidence source).

**Lane:** infra2 (stream B). **Deps:** M1-23. **Date:** 10-08.

- [ ] **Step 1: failing tests** (append to `harness-command.test.ts`): `run --dry-run prints the plan without a lock`; `run refuses a credential-bearing arm unless the verified state is authorized; a marker failing verification stops`; `qualify judges every manifest variant at its rev and indexes judgment, provenance, expected and actual verdicts`; `rejudge adds one judgment per execution whose scorer fingerprint is not current, and none on a second call`; `rejudge refuses when the restaged visible inputs differ`; `rejudge asks for confirmation unless --yes`; `images build lists the resulting digest and labels`.
- [ ] **Steps 2-6** as usual; commit `feat(harness): run, rejudge and qualify commands`.

**Acceptance:** tests pass; `deno task start harness --help` lists `run`, `rejudge` and `qualify`.

---

### Task M1-30 (ops): mock contract and hostile tests on containers

Spec 1a section 11: correct passes, naive fails; crash; timeout; "edit a shipped test to always pass, ship a hand-made `.app`, add a junction to a host path, change an app id, try to reach the oracle or another workspace through the backend, leave state behind for the next execution. Each must be caught."

**Lane:** ops. **Deps:** M1-35, M1-24b. **Date:** 10-08.

- [ ] **Step 1:** `deno task start harness images build mock --version 1`; `harness run mock-contract --dry-run`, then the full run on Cronus281 (plus qualified Cronus282/283). Quote the campaign id, per-arm pass rates, and the raw judgments of one positive and one naive cell.
- [ ] **Step 2: timeout and hard kill.** `mock-sleep`: termination `timeout`, a judgment exists, the last line of `raw.jsonl` parses, `docker ps -a --filter label=centralgauge.harness.owner=$env:COMPUTERNAME` empty afterwards.
- [ ] **Step 3: killed runner.** Kill the deno process during a campaign run; after the bench-lock marker is stale, rerun: the sweep line names the killed container, recovery completes the interrupted execution with its records (priced with the original book), the campaign id is unchanged, and no file under `results/` contains a secret; the private state for that execution is gone afterwards.
- [ ] **Step 4: hostile rows** (each one cell; quote verdict and verdict log): `mock-hostile-edit-tests` (fail, shipped tests restored), `mock-hostile-app` (fail, no `.app` stored or published), `mock-hostile-junction` (freeze violation, build false, no host content stored), `mock-hostile-case-alias` (violation), `mock-hostile-app-id` (backend refuses before any BC call; verdict violation), `mock-hostile-probe-backend` (the M1-28 statuses), `mock-leave-state` then `mock-detect-state` (no leftover state).
- [ ] **Step 5: container state.** Only prerequisite `CGR` apps remain; no candidate, no oracle app.

**Acceptance (no container):** evidence quotes each expected line above.

---

### Task M1-38 (ops): real-pipeline qualification at immutable revisions: HX-001 at rc1, HX-002 at rc2, every named variant

M4 round 2 section 4: every named naive variant through the real pipeline with the explicit per-task manifest; raw judgment reasons, target coverage and artifact identity, not only aggregates. Review round 2 item 11: judged at immutable revisions (the working tree is repinned to `refapp-v1` by M4-14 on 10-08), with complete persisted judgments.

**Lane:** ops. **Deps:** M1-18, M1-24b, M1-30, M4-05 accepted (HX-002 at `refapp-v1-rc2`). **Date:** 10-09 (morning, before M4-15's real-pipeline step).

- [ ] **Step 1: manifest.** Until M4-14 writes the freeze manifest, use `H:\cg-coord\tasks\M1-38\qualify-rc.json` (same schema, `src/harness/qualify.ts`): HX-001 `rev: refapp-v1-rc1`, positive `correct`, every folder under `naive/` at rc1; HX-002 `rev: refapp-v1-rc2`, positive `reference-tests`, every folder under `naive/` at rc2 (`git ls-tree --name-only <rev> harness-tasks/tasks/<id>/naive/`). Quote it.
- [ ] **Step 2: run.** `deno task start harness qualify --manifest H:\cg-coord\tasks\M1-38\qualify-rc.json --containers Cronus281,Cronus282`. Quote the index file.
- [ ] **Step 3: per variant quote**, from each persisted `judgment.json` and `provenance.json`: verdict (positive `pass`, each naive `fail`); the scorer reason (HX-001: at least one oracle assertion failure; HX-002: at least one surviving mutant named); HX-002 target coverage (`reference`, `mutant:0`, each named mutant) with every discovered procedure present; `workspace_hash` and `variant_tree_hash`; `task_commit` equal to the rev's commit and `task_tree` equal to the tree M4's latest audit names; visible and oracle hashes; the mock cell's judgment agreeing with `judge-fixture`.
- [ ] **Step 4:** any disagreement (fixture vs mock cell, or vs M4's gate report for the same rev) goes to the orchestrator with both files; neither side is edited to agree.

**Acceptance (no container):** one evidence row per manifest entry with the fields above, all at the stated immutable revisions; no disagreement, or each one escalated.

---

### Task M1-25: report efficiency and slices (cut first)

Spec 1a section 9 (efficiency: backend requests, logical builds, per-app compiles, test runs, diagnostics per build, queue and verdict medians; descriptive slices by kind and coupling; both-pass tables, never a winner). Uses host logs (M1-19), verdict logs (M1-17) and `cellsFromRecords` (M1-08).

**Lane:** infra2 (stream B). **Deps:** M1-23. **Date:** 10-09.

- [ ] **Step 1: failing tests** (`tests/unit/harness/report-extras.test.ts`): `efficiency counts backend requests, logical builds and per-app compiles per arm from host logs`; `verdict medians come from verdict logs`; `slices group by kind and coupling`; `both-pass table is descriptive and matched on scored cells only`.
- [ ] **Steps 2-6** as usual.

**Acceptance:** tests pass; `harness report --json` gains `efficiency` and `slices`.

---

### Task M1-36 (after 10-10): prerequisite build cache with a complete key

Key: app content stamp, symbols lock hash, compiler version, container artifact URL. **Lane:** infra or infra2, whichever is free. **Deps:** M1-16.

### Task M1-37 (after 10-10): historical reuse

Enables `CampaignRecord.reuse` (Part 1 `.max(0)` lifted by its owner) and `--reuse-history`. **Lane:** infra or infra2, whichever is free. **Deps:** M1-23.

---

## Final integration gate (orchestrator, 10-09)

The slice gate commands plus `tests/unit/harness/verdict-mutant.test.ts`, `mock.test.ts`, `egress.test.ts`, `campaign.test.ts`, `report-extras.test.ts` (if M1-25 was not cut), and `deno task start harness --help` listing `validate`, `report`, `cell`, `judge-fixture`, `images`, `symbols`, `run`, `rejudge`, `qualify`, `egress`. Campaigns on 10-10 need: M1-30, M1-34 (marker `authorized` and verifying, every pre-enforcement credential rotated) and M1-38 evidence accepted, plus M4-15's freeze.

## Self-review notes

- Every row of the traceability table names a task and a test or evidence line; every round-2 must-change item maps to the tasks listed in the round-2 table in the Schedule section.
- The slice path (M1-11 to M1-24, M1-26 to M1-29) and M1-18 carry full test and implementation code; M1-33 carries full tests and the load-bearing code; M1-35, M1-23, M1-24b and M1-25 are specified by named tests and rules.
- Types across tasks: `SecretValue` and `redactBytes` (M1-12) feed the sandbox (M1-20) and the freeze; `WantedApp` (M1-15) feeds `deploy` (M1-16); `LockedSymbols`, `DeployContext { ledgerRoot }` and `BcLane.quarantine/compileOn` (M1-16) feed `judge` (M1-17), the backend (M1-19) and `HarnessEnv` (M1-22); `TestCodeunit.procedures` (M1-14) feeds M1-17, M1-18 and the backend; `BACKEND_VERSION` (M1-19) feeds `runtimeFacts`; `QualifyManifest` (M1-24) feeds M1-35, M1-24b and M1-38; `reserveCredentialRun` (M1-22) is shared with M4-17 through `scripts/harness/reserve-credential-run.ts`.
- Part 1 touch points, all additive: `ValiditySchema.incomplete_observed` (defaulted, M1-22); the Part 1 doc note on mutant ids (M1-11).

## Remaining open questions

Owner decisions already recorded and applied: cache pricing by logged TTL with unknown TTL as null plus a reason (1-hour writes priced by the derived 2x-input rule for Anthropic models); D12 amended to `BcLane`; P5 a hard predecessor with no fallback; no NAT Allow rule; one shared five-run budget failing closed. Still open:

1. **Pre-existing effective Block rules.** If M1-34 Step 0 finds any, the owner decides whether to disable them or accept their effect before the firewall is enabled (the apply script aborts until then).
2. **Any relaxation** of P5, the five-run cap, the no-regression requirement, or the 10-05 and 10-09 gates needs the owner; the plan assumes none.

