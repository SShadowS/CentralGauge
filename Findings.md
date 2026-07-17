# CentralGauge Deep Review — Findings & Progress Tracker

Source: 10-subsystem parallel code review, 2026-07-17. 108 raw findings (some cross-referenced across reviewers — see dedup notes).

**How to use this file:** tick `- [ ]` → `- [x]` as each item lands. Put the fixing commit SHA and a one-line note after the item. Keep the Progress Dashboard counts in sync. Each finding has a stable ID (e.g. `P1`, `L1`, `S3`) — reference it in commits (`fix(llm): wire variant thinkingBudget to adapter (L1)`).

Status legend: `[ ]` open · `[x]` done · `[~]` in progress · `[-]` won't-fix / not-a-bug (add reason).

---

## Progress Dashboard

| Tier | Total | Done | In progress | Open |
|---|---|---|---|---|
| CRITICAL | 8 | 3 | 0 | 5 |
| HIGH | 22 | 3 | 0 | 19 |
| MEDIUM | 39 | 9 | 0 | 30 |
| LOW | 39 | 1 | 0 | 38 |
| **Total** | **108** | **16** | **0** | **92** |

Update these counts as items close.

---

## Fix-Order Roadmap (recommended clusters)

Work top-down. Each cluster groups items that share a root cause or a file.

- [x] **Cluster 1 — Variant/config wiring (data validity, collected wrong NOW).** L1, D5, plus add seam test (TEST1). Silent-drop of thinkingBudget / systemPrompt / `@prompt=name`. (L5 folded in.)
- [x] **Cluster 2 — Concurrency reliability (bench hangs/blackholes).** P1, P2, P3, P4. (Delivered as P1, P2, P4b, P3 + P6, P7, P8, P11, C4, TEST2, TEST5 folded in.)
- [ ] **Cluster 3 — Infra-to-model score leakage (scoring validity).** C1, C3, T2, T11, P5, P9, D4 (zero-price), plus SOAP precedence C2.
- [ ] **Cluster 4 — Ingest/admin security (prod exposure).** T1/S5/S6/D1 (sign run_id+signed_at — DEDUP), T10/S3 (finalize auth — DEDUP), S1 (admin SSR auth), S4 (SSE reset), T3 (replay dup UUID).
- [ ] **Cluster 5 — Sandbox integrity (before any agent-bench publish).** M1, M2, M3, M4.
- [ ] **Cluster 6 — Confidence review gate (restore human review).** V1, V2, V3, V9.
- [ ] **Cluster 7 — Test seams (stop the next escape).** TEST1–TEST8.

---

## CRITICAL (8)

- [x] **L1** — `src/parallel/llm-work-pool.ts:324-330` — Variant config (thinkingBudget/systemPrompt/reasoning) never reaches the adapter. getAdapter() forwards only `{provider,model,temperature,maxTokens,apiKey}`; `item.context.variantConfig` dropped. Serial path same (`src/tasks/executor-v2.ts:89-94`). *Scenario:* `opus@thinking=50000` runs as plain no-thinking call while ingest labels it a thinking run; `gpt-5@reasoning=high` runs at default; `@prompt=name` dropped. Wiring never existed (`git log -S thinkingBudget -- src/parallel/` empty). OpenRouter has no reasoning-param support even after wiring. — 4639c47 getAdapter + executor-v2 spread thinkingBudget/timeout into LLMConfig (apiKey restored on serial path); variant systemPrompt precedence in buildRequest + prompt-generator.
- [ ] **M1** — `src/agents/sandbox-executor.ts:221,236` — Sandbox success scored from model-controlled chat text (stdout+stderr of Claude Code `--print`), not verified tool results. *Scenario:* model printing "All tests passed" / "Task completed successfully" scores SUCCESS with no compile/test. Non-sandbox `executor.ts:140-193` path is sound (reads tool_result blocks). Sandbox-only gap.
- [ ] **M2** — `src/agents/success-detector.ts:73,82,28-32` — detectTestSuccess heuristics yield false passes non-adversarially: `/\d+ tests passed/` matches "0 tests passed" (zero_tests infra signature → SUCCESS); `hasCompileSuccess && !includes("failed")` scores full pass when tests never ran; `hasCompileSuccess` matches substring "success: true" anywhere.
- [x] **P1** — `src/parallel/compile-queue.ts:592-599` — Compile-semaphore slot leaks when executeCompilePhase throws. releaseCompile() only on success path (599); catch (678)/finally (687) never release. compileProject throws ContainerError/PwshSessionError on the routine infra path. *Scenario:* 3 thrown compile errors exhaust compileSemaphore (default 3); processQueue blocks forever in acquire() with dispatching=true; activeItems already decremented in .finally so pool sees LOW load and keeps feeding work → progressive blackhole, every entry eats the 5-min timeout. — PENDING-SHA release-once compile permit (`releaseOnce` at both release sites + finally BEFORE awaited cleanup); TEST2 guards.
- [x] **P2** — `src/parallel/compile-queue-pool.ts:369-379` + `src/parallel/orchestrator.ts:460` — Parked entries deadlock the whole bench. No-eligible-target drain parks entries with queue-wait timers cancelled and never re-armed; enqueue promises never settle; task promises never settle; `Promise.allSettled(taskPromises)` at orchestrator.ts:460 hangs forever. cancelParked escape (orchestrator.ts:497-517) is in the finally AFTER that await — unreachable. Recovery prober default-off. *Scenario:* 2 catastrophic suspects on a 2-container pool at default config = permanent hang. — PENDING-SHA parked-entry state machine: `ParkedRecord` + settlement timer armed with EXACTLY the remaining queue-wait budget (exhausted → immediate reject); `canRecover(alert)` predicate fail-fasts when the prober is off / alert is global_outage; flush/timeout/cancel all remove-by-identity before acting; TEST5 guards.
- [ ] **T4 / L2 (streaming truncation) — see also TEST3** — `src/llm/openai-adapter.ts:315`, `src/llm/openrouter-adapter.ts:334` — Streaming hardcodes finishReason "stop"; processStreamChunks never captures `choices[0].finish_reason`. *Scenario:* under `--stream`, a max_tokens-truncated response reports "stop", generateWithContinuation (gate: finishReason==="length") never fires, wasTruncated=false, truncated code compiles as model output. Azure/Gemini streaming propagate correctly. **DEDUP: rev-llm #2 == rev-tests #3.** ID = **L2**.
- [ ] **T4** — `src/llm/code-extractor.ts:84,101` — Greedy fence regex `[\s\S]*` (no `?`) mangles multi-block responses: two ```al blocks capture first-opener→last-closer, embedding prose + inner opener lines; cleanCode (253-255) strips only backtick-only lines, not "```al". *Scenario:* guaranteed compile failure charged to the model. **DEDUP: rev-tasks-ingest #4 == rev-tests #5 (enshrined).** ID = **T4**.
- [ ] **T2** — `cli/commands/bench/ingest-assembly.ts:72-105` — Infra-invalidated attempts ingested to leaderboard as model failures. synthesizeInfraFailureResult rows (`src/health/terminal-record.ts:74-85`) are excluded from local pass-rate (`result-aggregator.ts:388-393`) but ingest converts every attempt to `passed=false` with no infra marker (infraRetryExhausted/quarantined dropped). *Scenario:* prod pass@1/AUC@2 charge container outages to the model; site can't filter (only signal is prose in failure_reasons_json). Contradicts GH #13.

---

## HIGH (22)

### Scoring correctness
- [ ] **C1** — `src/container/bc-container-provider.ts:1808-1827` — SOAP path (DEFAULT) missing the GH #13 zero-tests-after-publish infra guard. Legacy path throws ContainerError("test") on totalTests===0 post-publish (2024-2037); SOAP branch returns `{success:false,totalTests:0}` (`soap-test-client.ts:163`) → scored as model failure, no reroute. Re-opens the "hid a broken BCH across a whole run" hole.
- [ ] **CLI1** — `cli/commands/bench-command.ts:749-796` (mergePresetWithOptions) — Preset fields attempts/temperature/maxTokens/runs/stream/debug/format/output/container can never take effect. Cliffy defaults make `cliOptions.X===undefined`/`!cliOptions.format` always false → preset values silently discarded. Only llms/agents/containers/maxConcurrency/taskConcurrency/tasks work (special-cased). *Scenario:* `presets.foo.attempts:1` runs at 2.
- [ ] **CLI2** — `cli/commands/bench/parallel-executor.ts:522-604,616-640` — After interactive transient-retry, `lastSummary` holds stats of the LAST runParallel (retried subset) only; saveResultsJson/saveScoresFile persist subset stats over the full `results` set. Same class in `--retry <file>` mode.
- [ ] **P5** — `src/parallel/infra-retry.ts:263-267,560-565` + `orchestrator.ts:577-581,641` — Synthetic exhaustion causes evade infra classification, dropping attempts from results. When exhaustion throws with lastInfraError undefined (quarantine-only trail, waiver-budget bottom throw, or Branch A NoEligibleContainersError on first call), unwrapped `.cause` fails isInfraError() → synthesizeInfraFailureResult skipped → attempt lands only in failures map (the ERR-cell bias the synthesizer exists to prevent).
- [x] **H4 / monitor global-outage** — `src/health/monitor.ts:313-332,348-349` — Global-outage retraction RE-OPENS dispatch to sick containers. Raising global_outage deletes per-container `ch.alert` for that fp on all affected containers but attaches the global alert only to the trigger; alertedContainerNames (pool:153-161) reads per-container ch.alert → N-1 known-sick containers become dispatch-eligible at the fleet's sickest moment, and the global alert's listener round-robins the trigger's drained work onto them. ID = **P4b**. — PENDING-SHA global alert now carries `affectedContainers[]` and attaches to EVERY member's ch.alert; orchestrator listener fans out one drain per member; pool drain-dedupe key is now `${alertId}:${containerName}`.
- [ ] **T3** — `cli/commands/bench/ingest-assembly.ts:60` — Documented replay path always duplicates runs. assembleBenchResultsForVariant mints `runId=crypto.randomUUID()` per invocation; the retryable-failure recovery (`bench-command.ts:869` "Replay: centralgauge ingest <path>") re-assembles with a NEW UUID → server run_id idempotency never triggers → transient finalize failure + replay double-counts the whole run. Bonus: replay stamps `todayPricingVersion()` → wrong/fatal pricing on late replay.

### Security (site + ingest + sandbox)
- [ ] **S1** — `site/src/routes/admin/lifecycle/+page.server.ts:12`, `.../status/+page.server.ts:26` — SSR admin pages have NO in-code auth; rely solely on edge CF Access ("CF Access already gates at the edge"). API layer verifies JWT in-code but these loaders don't; hooks.server.ts does no hostname/Access enforcement. workers.dev hostname is reachable → `GET centralgauge.sshadows.workers.dev/admin/lifecycle` likely bypasses the gate and leaks pending-review counts, full model roster, lifecycle-state matrix. (/review sub-page is safe — hits an API that re-verifies.)
- [ ] **SIGN (DEDUP)** — Ed25519 signature covers neither `run_id` nor `signed_at`. `src/ingest/sign.ts:12-27` signs only `canonicalJSON(payload)`; run_id + signed_at sit unsigned in the envelope (`src/ingest/mod.ts:232`). Server (`site/src/lib/server/signature.ts:83-104`) reads the unsigned signed_at for its ±10-min skew check → a captured signed body is replayable forever with fresh signed_at + fresh run_id → unlimited duplicate runs, inflating run_count/tasks_attempted/avg_score/avg_cost (pass_at_1/n use COUNT(DISTINCT task_id), protected; count/avg not). `signBlobUpload`/lifecycle headers fold signed_at in correctly — payload POSTs left open (repo already fixed this class "pre-fix C1"). **DEDUP: rev-site #5+#6, rev-tasks-ingest #1, rev-catalog-doctor #1.** ID = **S5**.
- [ ] **FINALIZE (DEDUP)** — `site/src/routes/api/v1/runs/[id]/finalize/+server.ts:7` — POST /runs/[id]/finalize unauthenticated (no signature/JWT; only guard = referenced blobs exist). Run IDs enumerable via public GET /runs. *Scenario:* attacker flips any in-flight run → completed and injects a run_finalized SSE broadcast to every subscriber. Only write endpoint without a signature gate. Client also calls it via bare fetch, no retry (`src/ingest/mod.ts:192-195`). **DEDUP: rev-site #3 == rev-tasks-ingest #10.** ID = **S3**.
- [ ] **M3** — `mcp/al-tools-server.ts:1688,1673,1729` — MCP HTTP server binds all interfaces (default 0.0.0.0) with no auth, Allow-Origin *. al_compile/al_verify/al_verify_task read+write host files (translatePath) and exec AL/PowerShell in BC containers → any host/LAN process drives host FS writes + container exec unauthenticated. `request.text()` unbounded (memory DoS).
- [ ] **M4** — `mcp/al-tools-server.ts:91-108,1301` — Path-translation traversal; untrusted model controls projectDir. translatePath maps any `C:\workspace`-prefixed path to hostPath+relativePart with NO `..` normalization; al_verify writes verifyDir = join(projectDir,"..",...) and copies .al there → arbitrary host READ and WRITE outside workspace, reachable via M3.

### LLM / verify / stats
- [ ] **V1** — `src/verify/shortcomings-tracker.ts:87-100` + `src/lifecycle/steps/analyze-step.ts:173-181` — Confidence human-review gate is dead end-to-end. Tracker never writes `confidence`; analyze-step reads `s.confidence ?? 1` → every entry defaults to 1 → pending_review_count always 0. `lifecycle.confidence_threshold` is a no-op; low-confidence + parse-failure verdicts auto-publish with no review.
- [ ] **V2** — `src/verify/schema.ts:36,61` / `analyzer.ts:327,343,375` vs `src/lifecycle/analyzer-schema.ts:36` / `confidence.ts:135` — Two incompatible "confidence" reps, no bridge. Analyzer emits string enum "high|medium|low"; lifecycle expects numeric 0..1. Numeric scorer `scoreEntry` called only from tests (dead in prod). If the string ever persisted, `analyze-step.ts:157` parse rejects → analysis.failed on every model.

### Test suite (why the criticals escaped) — see also TEST section
- [x] **TEST1** — Variant thinkingBudget seam has ZERO real coverage; `tests/integration/thinking-budget-tokens.test.ts` calls `adapter.configure()` directly and is `ignore:!hasAnthropicKey` (skipped in CI); `orchestrator.test.ts:1178` REIMPLEMENTS the merge inline + MockLLMWorkPool so getAdapter never runs. Guards L1. — 4639c47 seam test `tests/unit/parallel/llm-work-pool-config-seam.test.ts` through the real registry (RED before L1 fix, GREEN after).
- [x] **TEST2** — Compile-semaphore-leak-on-throw untested (`compile-queue.test.ts` only uses success:false which returns, never throws). Guards P1. — PENDING-SHA “compile slot released when compileProject throws” (concurrency 3, deadline-raced allSettled; RED pre-fix: starved).
- [ ] **TEST3** — Streaming finishReason untested AND mock hides it (`mock-adapter.ts:367` also hardcodes "stop", never simulates length/content_filter). Guards L2.

---

## MEDIUM (39)

### Concurrency / health
- [x] **P3** — `src/health/recovery-prober.ts:199-201,219-229,345` — Flap cap is dead code. recoveriesCompleted++ only on successful recovery, which clears the alert; next tick sees no alert and DELETES state (201); re-death gets fresh alertId which resets state (219-229) → `recoveriesCompleted >= max` can never trip for cap>=1. Documented "left excluded (flap_cap_reached)" violated; infinite restart/recover/re-die flap possible with autoRestart on. — PENDING-SHA prober-lifetime `lifetimeRecoveries` map (never reset on episode change); incremented after clearAlert BEFORE onContainerRecovered; flap-cap test inverted per rule doc (capped containers stay excluded).
- [x] **P6** — `src/health/monitor.ts:368-393,141-162` — Second catastrophic fingerprint on an already-alerted container overwrites ch.alert (fp2 replaces fp1), orphaning fp1's `suspect:C:fp1` dedupe key; clearAlert for fp2 purges only fp2 keys → later fp1 catastrophic failure raises NO alert for the rest of the run. — PENDING-SHA `purgeAlertDedupeKeys` helper; `attachAlert` purges the replaced different-fp alert's keys in suspect/persistent/global raise paths + clearAlert.
- [x] **P7** — `src/parallel/compile-queue-pool.ts:353-390,286-302` — Rebalance/park re-admission drops the entry's per-call excludeContainers context (QueueEntry doesn't carry it) → a drained entry can be round-robined straight back onto the container that just infra-failed that exact work item. — PENDING-SHA `QueueEntry.excludeContainers` captured at enqueue; rebalance + park-flush filter targets per entry.
- [x] **P8** — `src/health/recovery-prober.ts:383-404` + `orchestrator.ts:358-361` — Per-probe timeout ineffective: isHealthy ignores the AbortSignal so ctrl.abort() no-ops; a probe that later resolves true is counted probe_success despite timing out; a wedged Test-BcContainer blocks `await prober.stop()` in the finally → unbounded shutdown delay. — PENDING-SHA `isHealthy(name, {signal})` on the provider interface + aborted-checks between phases; late probe result after timeout counts as probe_timeout; stop() bounded at 2×probeTimeout.
- [x] **C4** — `src/container/pwsh-session.ts:383-387` + `session-slot.ts:173-193` — session_timeout re-runs the same mutating script on the same container. Killing host pwsh does NOT cancel the in-container Publish/Run-Tests; session_timeout ≠ session_crashed so runScript falls through to fallback(script) → concurrent double publish/test (SQL death-spiral class). Reachable whenever a heavy op exceeds the 300s default; a timeout on a mutating op should reroute as infra, not re-run. — PENDING-SHA session_timeout throws ContainerError(caller op, {sessionTimeout:true}) — never fallback/retry; queue taint flag set before test-mutex release, every waiter re-checks after acquire and reroutes; taint clears only on recovery/disposal.
- [ ] **C2** — `src/container/bc-container-provider.ts:224-233` — decideSoapFailureAction checks isCollisionPublishFailure BEFORE infra classification; `classify-publish-failure.ts:13-15` documents infra must be first. *Scenario:* output with both "timed out" (SQL) and "already defined in" → fallback_legacy → legacy publish+test on the SAME degraded container → death spiral.
- [ ] **C3** — `src/container/bc-container-provider.ts:1360-1379` — compileProjectInner catch-all turns ANY thrown error (getOrCreateCompilerFolder ContainerError at :1148, session death) into a synthetic code:"SYSTEM" AL error with success:false; compileProject never throws → `compile-queue.ts:660` scores it as a model compile failure — no infra classification, no reroute, no health event.
- [ ] **C5** — `src/container/bc-container-provider.ts:2190-2197,2201-2205` — bcchConfigInit() omitted at fresh-spawn sites (executeCommand via executePowerShell, isHealthy/Test-BcContainer) → behavior depends on machine-level BcContainerHelper.config.json (invariant 1 partial violation, GH #12 class). executeCommand also interpolates raw `command` (injection-by-construction; callers today integration-tests only). Mutating sites all correctly emit both.

### LLM / config
- [ ] **L3** — `src/llm/continuation.ts:93-99` (streaming twin :372-378) — Continuation accumulation drops reasoningTokens/cacheCreationTokens/cacheReadTokens (sums only prompt/completion/total/estimatedCost; streaming path starts from zeros :263-267) → any continuation under-reports tokens_reasoning/cache (migration-0012 undercount class).
- [ ] **L4** — `src/llm/gemini-adapter.ts:235-251,302-318,386` — Gemini generation has no request timeout or abort (client built with only {apiKey}; config.timeout used solely by discoverModels); LLMWorkPool.submit has no outer timeout → one hung Gemini request stalls that model attempt indefinitely; transient-retry never engages.
- [x] **L5** — `src/llm/registry.ts:85-96` — LLMAdapterRegistry.acquire() returns a pooled adapter without reconfiguring it (match = provider+model+!inUse). Two callers with different temperature/apiKey/thinkingBudget → second silently runs with the first's settings. Latent (current callers use constant config). — 4639c47 acquire() pool-hit now calls adapter.configure(config) before returning.
- [ ] **L6** — `src/config/config.ts:459-481` — Malformed .centralgauge.yml silently ignored (empty catch on parseYaml for home + cwd). A YAML typo drops the whole file (creds, presets, emptyRetry tuning) with zero warning; run proceeds on defaults (container "mock"). Contradicts the repo's own "silent YAML failures wasted bench runs" rule.
- [ ] **L7** — `src/llm/local-adapter.ts:387,851` — Local adapter misclassifies finish reasons: non-streaming hardcodes "stop" (ignores done_reason/finish_reason) so truncated local responses never continue; streaming maps "length"→"error" so truncation reports error and continuation never fires.

### tasks / ingest / lifecycle
- [ ] **T5** — `cli/commands/bench/ingest-assembly.ts:79` — Attempt >2 collapses to 2. `attemptNumber <= 1 ? 1 : 2`; schema allows any positive max_attempts and --attempts is operator-settable → a 3-attempt run yields two attempt=2 rows per task → violates UNIQUE(run_id,task_id,attempt) + CHECK attempt IN (1,2) (`site/migrations/0001_core.sql:123,141`) → entire D1 batch insert fails.
- [ ] **T6** — `src/ingest/catalog/task-set-hash.ts:117-120` — Task-set hash is line-ending sensitive (hashes raw bytes; paths normalized 112-113 but CRLF/LF not). With documented CRLF drift + autocrlf, two checkouts of the same commit on different OS produce different task_sets hashes → leaderboard fragmentation.
- [ ] **T7** — `src/tasks/transformer.ts:87-91,296-312` — Transformer ignores manifest expected.mustContain/mustNotContain; builds validation from description-scraped regexes (`/procedure\s+(\w+)/gi` can capture "procedure called" from prose) + hardcoded [] forbidden. executor-v2 evaluateAttempt (412-444) enforces wrong patterns → can make tasks unpassable. Parallel path reads manifest.expected directly (latent for bench, but violates benchmark-consistency + public API).
- [ ] **T8** — `src/parallel/orchestrator.ts:1064` — `testSuccess = compileResult.testResult?.success ?? true` passes a testApp task whose testResult went missing; mustContain/mustNotContain affect score only, never pass/fail → diverges from executor-v2 semantics.
- [ ] **T9** — `src/tasks/interfaces.ts:16-22,49` — Zod `expected` silently strips unknown keys (non-strict); root `.passthrough()`. A typo'd `test_app`/`mustcontain` silently converts a tested task into compile-only and everything "passes"; no typo anywhere is flagged.
- [ ] **V4** — `src/lifecycle/event-log.ts:79-94` — Reducer poisoning by non-finite ts. reduceCurrentState stores the first event unconditionally then replaces only on `ev.ts > cur.ts`; ts parsed from untrusted D1 JSON → a first event with NaN/null ts pins that step forever (`realTs > NaN` = false) → state silently frozen, status matrix wrong.
- [ ] **V3** — `src/lifecycle/confidence.ts:190-201` — Cross-LLM disagreement cannot veto a publish; crossScore is purely additive (0..+0.3). A fully-disagreeing second model scores identically to unsampled (schema+cluster already sum to exactly the 0.7 threshold) → agreement check has zero gating power (moot per V2, design flaw if wired).
- [ ] **V5** — `src/stats/importer.ts:202-206` — Local stats task-set hash is content-blind (`contentHash: id` = task ID as its own hash). Two runs with same IDs but different content collapse into one bucket → avgPassRate/avgScore mix incomparable runs across content edits.
- [ ] **V6** — `src/stats/hasher.ts` vs `src/ingest/catalog/task-set-hash.ts` — Two divergent hashers (16-hex, content.trim(), `{taskId}*.al`+app.json, silently drops erroring tasks at :315 vs 64-hex binary-safe ALL tests/al/**+tasks/**). Only 64-hex gates the leaderboard; can't cross-reference; silent omission on read error. **DEDUP: rev-tasks-ingest note.**

### catalog / doctor / prompts
- [ ] **D2** — `src/catalog/seed/writer.ts:123-146,105-121` — appendPricingIfChanged accumulates duplicate (model_slug, pricing_version) rows: same-day price change appends rather than replaces; findPricingAtVersion returns the FIRST match → each same-day seed re-compares stale first row and appends again → sync-catalog pushes ambiguous/last-wins price.
- [ ] **D3** — `src/catalog/seed/inference.ts:78-83` vs `cli/commands/bench-command.ts:556-557` — Two divergent family-slug algorithms for openrouter slugs: seeder uses model-tail first segment (`openrouter/qwen/qwen3-coder`→"qwen3"); precheck probe uses sub-vendor (→"qwen") → probe and auto-seed never agree for any slug whose sub-vendor ≠ tail leading token → model stays "missing" post-seed.
- [ ] **D4** — `src/catalog/seed/inference.ts:269,295` + `sources.ts:113-127` — A zero price from a provider API is accepted as authoritative "free" (floor is open interval (0,0.01); sources reject only MISSING, not 0). A placeholder-0 paid model seeds input/output=$0 without tripping SEED_NO_PRICING → silent cost undercount. NaN/undefined correctly blocked; only 0 slips.
- [x] **D5** — `src/llm/variant-parser.ts:171-177,144-149` — `@prompt=name`/systemPromptName lookup miss is silent: sets systemPromptName but resolves content only `if (config?.systemPrompts?.[value])`; a typo'd/absent name → NO system prompt, no error → run proceeds with zero injection, silently invalidating the comparison. (Same silent-drop class as L1; fix together in Cluster 1.) — 4639c47 `@prompt=` miss throws ConfigurationError naming available prompts on BOTH the inline and profile paths; unknown keys warn instead of silently skipping.

### cli / dashboard
- [ ] **CLI3** — `cli/commands/bench/parallel-executor.ts:636` + `results-writer.ts:305-311` — scores-file health snapshot read via `dashboard?.getHealthSnapshot()`; on `--no-dashboard` (run-xbench.ps1) the `# Container Health` block + `infra_invalidated:` line vanish though the shared healthMonitor holds the data. Should read healthMonitor.getState(). infra_invalidated nested inside the containerHealth-present branch.
- [ ] **CLI4** — `cli/helpers/task-loader.ts:101-104` + `parallel-executor.ts:162-164` + `bench-command.ts:709` — Zero matched task manifests → log.fail (no throw), executor returns `{}`, bench warns then `Deno.exit(0)`. A typo'd `--tasks` glob exits 0; CI/scripts see success with no results.
- [ ] **CLI5** — `cli/dashboard/page.ts:648` (`handleSSEEvent`: `if (!state) return`) — When the initial `/api/state` fetch fails, the guard also drops the SSE full-state/health-snapshot/pool-snapshot replay events meant to fix that (server.ts:203-208) → tab stays blank until manual reload; the full-state case must run with state===null.
- [ ] **CLI6** — `cli/commands/ingest-command.ts:144-186` — raw-bench replay treats per-variant transient failures as warn-and-continue and exits 0 even when 0/N ingested (bench-command.ts:908-912 throws on 100%-transient for the same op) → scripted replays silently no-op.

### mcp / sandbox
- [ ] **M5** — `src/agents/sandbox-executor.ts:112` + `mcp-manager.ts:38-77` — Hardcoded MCP port 3100 breaks parallel sandbox runs; each concurrent SandboxExecutor spawns its own deno server on 3100 → second bind fails → ~15s health-check timeout → StateError. Parallel `--agents` in sandbox mode unusable without distinct ports.
- [ ] **M6** — `src/sandbox/windows-provider.ts:328-333,186` — API key exposed on docker CLI argv (`-e ANTHROPIC_API_KEY=<key>`); visible via `docker inspect`/process listing to anyone with docker access.
- [ ] **M7** — `mcp-manager.ts:105-114` — MCP server child leak on Windows: stop() sends SIGTERM and nulls serverProcess without awaiting exit; the deno server (and pwsh grandchildren) can survive → orphaned processes across many tasks.
- [ ] **T6b (finalize client no-retry)** — folded into S3.

### site
- [ ] **S2** — `site/src/lib/server/cf-access.ts:296-319` — verifyCfAccessJwt accepts any JWT whose aud matches CF_ACCESS_AUD; no email/sub allowlist anywhere. AuthZ fully delegated to the out-of-repo CF Access policy → a permissive policy grants full admin (catalog mutation, key register/revoke, task-set DELETE) to anyone who can mint a JWT. No defense-in-depth.
- [ ] **S4** — `site/src/routes/api/v1/__test__/events/reset/+server.ts:16` + `site/src/do/leaderboard-broadcaster.ts:174` — Prod-reachable test route wipes the live SSE buffer, gated only by client-settable `x-test-only: 1` (no env gate, unlike sibling __test_only__/broadcast). Attacker repeatedly disconnects all subscribers + wipes replay state.

### verify
- [ ] **V9** — `src/verify/analyzer.ts:359-380` — parseFallback returns `outcome:"model_shortcoming"` (concept "parse-failure") on any JSON/zod failure. Confidence "low" (correct) but per V1 that low confidence is dropped → a garbled judge response lands a fabricated shortcoming in the tracker/registry.

### tests
- [ ] **TEST4** — `success-detector.ts` thoroughly tested but the primary `src/agents/executor.ts:183-193` uses its own naive 2-substring check; detectSuccess used ONLY by sandbox-executor. `success-detector.test.ts` (40 cases) gives false confidence, divergence between the two detectors invisible.
- [x] **TEST5** — Parked-entry shutdown-drain untested: `compile-queue-pool.test.ts` covers park/flush but every test calls `pool.cancelParked()` manually; no test proves the orchestrator shutdown path drains parked entries → P2 hang undetected. — PENDING-SHA new `compile-queue-pool-park-bounds.test.ts`: every park path settles bounded with NO manual cancelParked.
- [ ] **TEST6** — `tests/unit/ingest/*` has ZERO references to quarantine/infra/infraRetryExhaustion; nothing guards that an infra-exhausted attempt isn't ingested as a model verdict (guards T2).
- [x] **TEST7** — PricingService shared static across 8 test files (cost-tracker, estimate-usage-cost, pricing-service + 5 adapter tests) — order-dependent state can mask/flip results; matches the documented --parallel hazard. — 54769e6 per-test reset

---

## LOW (39)

### Concurrency / health
- [ ] **P9** — `src/parallel/infra-retry.ts:142-148` — maxRetries<=0 fast path skips classifyResult → with infra retry disabled but monitor wired, a quarantined non-success result is returned as-is and SCORED as a model failure. Marker prevents monitor pollution but not scoring.
- [ ] **P10** — `src/parallel/infra-retry.ts:271-301,548-565` — A quarantine-reroute record pushed on the final allowed iteration is never finalized; the thrown trail's last record carries retryContainerName "(pending)" (violates the module's no-placeholder comment). Telemetry only.
- [x] **P11** — `src/parallel/compile-queue.ts:402-417` — Each re-admission arms a FRESH full queue-wait timeout → an entry repeatedly drained/re-admitted has no cumulative wait bound (each hop resets 5-min; parked hops have no timer). — PENDING-SHA admitRebalancedEntry + park timer re-arm with the REMAINING budget (min 1 ms; exhausted → immediate reject); original enqueuedAt preserved.
- [ ] **P12** — `src/parallel/orchestrator.ts:145,1289-1296` — recoveryEvents never cleared by reset() or at runParallel start → a reused orchestrator's second run reports the first run's recovery events.

### container
- [ ] **C6** — `src/container/soap-test-client.ts:26-28,205-207` — Stale comments assert timeout "falls back to legacy", contradicting the reroute invariant (actual: timeout→ContainerError→reroute_infra, correct). A maintainer trusting them could reintroduce the SQL death spiral.
- [ ] **C7** — `src/container/bc-script-builders.ts:244-245,611-612` — Container password interpolated unescaped into PS double-quoted strings (`ConvertTo-SecureString "${credentials.password}"`); a password with `"`, `$(...)`, or backtick breaks/execs. Config-sourced (not model-reachable); the only unescaped point in builders that otherwise use escapeForPS.
- [ ] **C8** — `src/container/soap-test-client.ts:139-142` — `Math.max(0, NaN)` === NaN when start/finish timestamps don't parse → poisons per-test duration only (summary counts come from authoritative harness totals).

### llm / config
- [ ] **L8** — abort-signal handling: anthropic-adapter.ts:461-470, openai-adapter.ts:541-553, openrouter-adapter.ts:299-303, azure-openai-adapter.ts:415-423, local-adapter.ts:554-562 all `addEventListener("abort")` without checking `signal.aborted` first; streamProviderResponses (openai-adapter.ts:330-407, codex) wires no abort; Gemini break-on-abort (gemini-adapter.ts:321) doesn't cancel the request and still fires onComplete.
- [ ] **L9** — `src/config/config.ts:658-659` + `src/llm/variant-parser.ts:163-169,185` — Numeric parsing without NaN guards: CENTRALGAUGE_TEMPERATURE=abc → NaN into config → provider 400; same for MAX_TOKENS and `@temp=abc`/`@thinking=abc`. (lifecycle env loader guards with Number.isFinite at config.ts:793-800 — apply same.)
- [ ] **L10** — `src/llm/types.ts:47-51` — Stale docstring: EmptyRetryConfig still lists finishReason="content_filter" as a "deterministic block" that is skipped; `empty-retry.ts:57-61` now retries it (shipped in 4d64992). A maintainer could re-"fix" the wrong direction.
- [ ] **L11** — `src/llm/gemini-adapter.ts:190` — API key in URL query string (`?key=${apiKey}`); fetch-level errors (DNS/TLS) include the URL → key flows into logs and LLMProviderError contexts. Use x-goog-api-key header.

### tasks / ingest / rules / verify / stats
- [ ] **T11** — `src/tasks/executor-v2.ts:579-591` — Prereq compile failure continues silently ("Continue without prereq") → candidate fails compile on missing symbols and is scored as a model failure (infra/authoring misattribution; executor-v2 path only).
- [ ] **T12** — `src/ingest/catalog/task-set-hash.ts:90` — SKIP_DIR_RE applied by walk() to absolute paths → a checkout under any dir segment named `output`/`.alpackages` (e.g. `C:\bench\output\CentralGauge`) skips every file → wrong near-empty content hash while task_count stays nonzero.
- [ ] **T13** — `site/src/routes/api/v1/runs/+server.ts:297` — POST /runs never checks payload.machine_id against the verified key's machine_id → any valid ingest key can attribute runs to another machine.
- [ ] **T14 / D-rules** — `src/rules/generator.ts:287` — Hardcodes model ID "claude-sonnet-4-5-20250929" as default (violates catalog rule; may be deprecated). **DEDUP with V11.**
- [ ] **V7** — `src/lifecycle/event-log.ts:188-231` — Lifecycle request signing has no nonce (binds method+path+query+body_sha256+signed_at); replay protection is signed_at window only → a captured signed PUT (pending-review decision) replayable within the window; idempotency depends entirely on the server.
- [ ] **V8** — `src/lifecycle/embedder.ts:117-118` + `cluster-decide.ts:49` — Embedding outage silently fragments the concept registry: a failed/zero embedding yields cosine 0 for every candidate → decideCluster auto-creates an orphan concept instead of erroring → append-only accretes duplicates recoverable only via --split.
- [ ] **V10** — `src/stats/importer.ts:214` — Pass-rate guard uses falsy not nullish (`if (!stats.passRate1 && !stats.passRate2)`): a run with real passRate1 but omitted passRate2 keeps passRate2=0 → impossible ordering passRate2 < passRate1.
- [ ] **V11** — `src/verify/analyzer.ts:44,47` — Hardcoded analyzer model "claude-sonnet-4-5-20250929" (contra catalog rule) + `https://centralgauge.sshadows.workers.dev` source-level fallback (workers.dev is internal-only; canonical ai.sshadows.dk). **DEDUP with T14.**

### catalog / doctor / compiler / prompts
- [ ] **D6** — `src/prompts/knowledge-loader.ts:117-123` — knowledge-loader keys content by basename → two files with the same basename from different dirs silently overwrite; one file's knowledge dropped, no warning.
- [ ] **D7** — `src/doctor/engine.ts:33-52` — Engine propagates only FAILED deps, not SKIPPED: if net.health fails, auth.probe is SKIPPED, but catalog.bench (requires auth.probe) sees "skipped" ≠ "failed" and still runs a doomed network call. Fails safe, just wasteful.
- [ ] **D8** — `src/doctor/repair.ts:145-158` — Repairer shells `sync-catalog --apply`; 7+ rows hit the ~10 req/min admin 429 mid-batch → reports ok:false (bench aborts, safe) but D1 half-synced with no built-in backoff/resume.
- [ ] **D9** — `src/compiler/al-project.ts:19-20` — loadProject has unguarded JSON.parse → malformed app.json throws a raw SyntaxError instead of the structured ResourceNotFoundError used one line above.
- [ ] **D10** — `src/prompts/injection-resolver.ts:308-310` — validate() pushes an empty-system "Warning:" string into the same errors[] array as real invalid-key errors → a caller treating non-empty errors[] as fatal hard-rejects a merely-empty system prompt.

### cli / dashboard
- [ ] **CLI7** — `cli/commands/bench/container-setup.ts:281-297` — cleanupContainer is NOT best-effort (stop/remove/cleanupCompilerFolders unguarded) and runs inside the main try (parallel-executor:694-705) → a cleanup throw after results are written reports "Benchmark failed" and rethrows. Also on any mid-run throw, endOfRunNuke/cleanup are skipped (inside try, not finally) — mitigated by next-run prenuke. (endOfRunNuke itself is correctly try/caught.)
- [ ] **CLI8** — `cli/commands/bench-command.ts:251-257` — Comment claims benchRootSpan closed in a finally but there is none → on a throw, closeTracer() never runs (mitigated by periodic flush + tracer SIGINT handler); also never closed on the dashboard-alive path.
- [ ] **CLI9** — `cli/dashboard/server.ts:214-242` — cancel() never removes the controller from `clients`; `clients.add(controller)` runs unconditionally even after a failed replay enqueue → dead controllers linger until the next broadcast's enqueue-throw sweep (unbounded only if broadcasts stop).
- [ ] **CLI10** — `cli/commands/bench/event-utils.ts:137-153` — isTransientFailure over-matches: `"failed to"` and bare `"500"` substrings → "Failed to extract code from response" (malformed model output) classifies as transient and is offered for a paid interactive re-run.
- [ ] **CLI11** — `cli/commands/bench/parallel-executor.ts:258-263,447` — Auto-concurrency hint says "floor 3" but computeConcurrencyDefaults floors at containers×2 (`concurrency-defaults.ts:35-42`) — stale operator message; bench-tui total uses `options.llms.length` not `variants.length` (wrong totals when one spec expands to multiple variants).
- [ ] **CLI12 (INFO)** — `cli/dashboard/page.ts:851,1259` — Two escape helpers (`escapeHtml` escapes `'`, `esc` does not); all current sites are double-quoted attrs/text so NO XSS found — the `'`-gap in `esc` is a latent footgun only.

### mcp / sandbox
- [ ] **M8** — `mcp/al-tools-server.ts:139,117` — Unbounded diagnostic logs: sandbox-debug.log + timing.log append every call, no rotation/truncation → grow without bound over long runs. (No API keys logged; rawOutputSample first 2000 chars may include app data.)
- [ ] **M9** — `mcp/al-tools-server.ts:1648,1746` — JSON-RPC parse-error responses hardcode id:0 instead of null (spec) → can collide with a real request whose id is 0.
- [ ] **M10** — `mcp/al-tools-server.ts:1414-1422` — publishedPrereqCache TOCTOU (check-then-await-then-add) → two concurrent verifies for the same task double-publish the prereq. Benign (idempotent) but wasteful.
- [ ] **M11** — `src/sandbox/windows-provider.ts:324-325` — Docker `-v` mount fragile to task.id content (`${hostPath}:C:\workspace`); a task.id with ':' or space misparses the volume spec. Correctness (argv, not shell).
- [ ] **M12** — `src/sandbox/windows-provider.ts:89` — exec timedOut heuristic `duration >= timeout` mislabels a task finishing right at the boundary as timed-out.
- [ ] **M13** — `mcp/al-tools-server.ts:1558,1568` — dispatchToolCall casts params/arguments with no schema validation → malformed tools/call surfaces as generic -32603 rather than -32602 invalid params.

### site
- [ ] **S7** — `site/src/lib/server/leaderboard.ts:126-128` — Builds subquery clauses via string interpolation of `q.set` (`AND ru1.task_set_hash = '${q.set}'`) while the sibling outer WHERE uses a bind param. NOT exploitable today (q.set regex-validated `^[0-9a-f]{64}$` before this branch) — footgun a future validator relaxation opens.

### tests
- [ ] **TEST8** — `tests/unit/utils/clipboard.test.ts:253` `assertEquals(true,true)` inside a swallowing catch{} passes regardless; `tests/unit/example.test.ts:12 assert(true)` scaffolding.

---

## Cross-Cutting Patterns (fix the pattern, not just the instance)

1. **Silent-drop of variant/config through wiring seams** — L1, D5, L9 (NaN). Any config field outside `{provider,model,temperature,maxTokens,apiKey}` risks vanishing with no error.
2. **Guard-on-main-path, hole-on-side-path** — zero-tests guard (legacy C1-yes / SOAP C1-no), infra classification (test-path yes / compile-throw C3-no), signature binding (blob+lifecycle yes / payload S5-no), success detection (executor TEST4 / sandbox M1). When patching a class, sweep every path.
3. **Infra-to-model score leakage** (biggest validity threat) — T2, C1, C3, P5, P9, T11, D4(zero-price).
4. **Test suite structurally can't catch #1/#2** — units tested in isolation, seam logic reimplemented inside tests, catch-worthy integration tests key-gated/skipped. TEST1–TEST8.
5. **Telemetry drift under `--no-dashboard`** — CLI3; health block vanishes exactly in scripted runs (run-xbench.ps1).

---

## Verified-Clean (do NOT re-investigate)

- canonicalJSON: sorted keys, rejects NaN/undefined/cycles (shared/canonical.ts).
- Private-key handling: no logging, 32-byte check (src/ingest/config.ts:190-198).
- GH #13 zero-tests guard present on the LEGACY provider path (bc-container-provider.ts:2025) — provider throws.
- Adapter-pool double-release/acquire: synchronous, no await between check and set — no race.
- OpenRouter per-token→per-1K pricing conversion matches PricingService convention.
- Async-generator return values: all call sites use manual iteration or yield* correctly.
- Anthropic cache-token cost math correct (input_tokens excludes cache tokens).
- Cross-LLM sampling sha256-deterministic (no Math.random).
- cosineSimilarity zero-vector guard correct; decideCluster slug short-circuit correct.
- SEED_NO_PRICING + per-MTok scale guards solid (blocks NaN/undefined/missing; 1000x legacy bug fenced) — EXCEPT zero slips (D4).
- Site: SQLi (bind params everywhere except S7-latent), XSS (DOMPurify allowlist), path traversal (r2-key.ts rejects `..`, content-addressed sha256), leaderboard named-cache + _cv (no caches.default trap), tiers deterministic (seeded xorshift), mig 0011/0012 columns present (no unapplied-column 500).
- cli/: no Cliffy `--no-X`+`{default:false}` recurrence; timer fields use ReturnType<typeof setInterval>; ContainerHealthMonitor single shared instance; drainEvents[]/recoveryEvents[] emission correct; endOfRunNuke best-effort.
- Parallel/health invariants HOLDING: drain idempotent by alertId; quarantine wrap tagged+non-success only, original fields intact, never fed back to monitor; waiver cap 1/alertId; CAS clearAlert; listener exceptions caught, exactly-once; withInfraRetry termination bounded.
