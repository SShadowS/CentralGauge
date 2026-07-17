# Findings Remediation Implementation Plan (2026-07-17, rev 3 — final after two external review rounds)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 108 code-review findings tracked in `Findings.md` (repo root), TDD-first, without weakening any benchmark task, oracle, or test.

**Architecture:** Clusters below are ordered for execution (rev 2 order per GPT 5.6 Sol review round 1): state-isolation prep → variant wiring → concurrency core (incl. P7/P8/P11/C4) → LLM response integrity → infra/scoring pipeline → staged ingest security → sandbox integrity → confidence lifecycle → subsystem batches. Each finding: failing test first → minimal fix → red/green → Findings.md checkbox + SHA + dashboard counts.

**Tech Stack:** Deno 1.44+/TypeScript 5, Cliffy, Zod, SvelteKit Cloudflare Worker (site/), Ed25519 (@noble), bccontainerhelper (not touched).

## Global Constraints

- Scoped `deno check <files>`, `deno lint <dirs>`, `deno fmt <changed-files only>` — CRLF drift; NEVER `deno fmt` on `site/**`.
- Site tests run against the BUILT bundle: `cd site && npm run build` before `npm test` / `npm run test:main`.
- NEVER run `tests/unit/container/` while a bench is live. Final gate: `deno test --allow-all --ignore=tests/unit/container tests/unit/`.
- **This plan deploys nothing** — worker deploy, benches, ingest, push are user-only. ONE new D1 migration is added (V7 nonce table, Cluster 6-SEC); prod deploy order for it: migrations → sync-catalog → `_cv` bump if response shape changed → deploy. All other server changes are schema-neutral.
- Never weaken a benchmark task, oracle, or test to make something pass.
- Commits per cluster with finding IDs. Stage in logical groups. No push.
- Findings.md is the single source of progress truth: tick checkbox + SHA + one-line note + dashboard counts after every finding.
- Deno.Command mocking via `tests/utils/command-mock.ts` (`Object.defineProperty`, Deno 2.8 getter-only).

## Execution order & model tiers (Phase 3)

| # | Cluster | Findings | Model |
|---|---------|----------|-------|
| 0 | Test-state prep | TEST7 | sonnet |
| 1 | Variant wiring | L1, D5, L5, TEST1 | fable |
| 2 | Concurrency core | P1, P2, P3, P4b, P6, P7, P8, P11, C4, TEST2, TEST5 | fable |
| 3 | LLM response integrity | L2+TEST3, T4 | fable |
| 3B | LLM-adapter robustness (RECOVERED — dropped from this table in the rev-3 reorder, added back during Phase-4 reconciliation) | L3, L4, L6, L7, L8, L9, L10, L11 | opus |
| 4 | Infra/scoring pipeline | C1, C2, C3, T11 → P9 → P5 → T2+TEST6, D4 | fable |
| 5 | Ingest security (staged) | S5(+precheck), T13, T3, T5, S3, S1, S4, V7 | fable |
| 6 | Sandbox integrity | M4, M5, M7, M3 → M1 → M2, TEST4, M6, M8–M13 | fable |
| 7 | Confidence lifecycle | V1, V2, V3, V9 | fable |
| 8 | CLI correctness | CLI1–CLI12 | sonnet |
| 9 | Tasks/stats data quality | T6/T12, T7, T8, T9, T14/V11, V4, V5, V6, V8, V10 | sonnet |
| 10 | Container remainder | C5, C6, C7, C8 | sonnet |
| 11 | Health remainder | P10, P12 | sonnet |
| 12 | Catalog/doctor/prompts | D2, D3, D6–D10 | sonnet |
| 13 | Site remainder | S2, S7 | sonnet |
| 14 | Test seams remainder | TEST8 | sonnet |

Dependency edges (hard, do not reorder past them):
- **P1 → P2 → {C1, C3, C4}** — C1/C3 create new infra-throw traffic; C1 can rapidly alert every container (drives the all-alerted path P2 fixes); the throw path leaks a permit until P1.
- **P2 → P4b** — corrected P4b bulk-drains every affected queue into the park/reject machinery; that machinery must be bounded first.
- **Inside Cluster 4: C1/C2/C3/T11 → P9 → P5 → T2/TEST6** — T2's exclusion can only see infra attempts that actually reach TaskExecutionResult; P5/P9 are producers.
- **T2 → T5** — infra exclusion runs before attempt-count validation in the same assembly loop.
- **Inside Cluster 5: server v2 (runs + precheck) → T13 → T3 persistence → CLI v2 + signed finalize → strict flags (user-controlled)**.
- **Inside Cluster 6: M4 + M5 + M7 → M3 → M1 → M2/TEST4** — the verdict channel is only trustworthy once path containment, per-run server/port, and process reaping exist.
- **L5 inside Cluster 1**; **TEST7 before everything** (clusters 4, 8 touch PricingService-adjacent suites).

---

## Cluster 0 — TEST7: PricingService state isolation (prep)

**Files:** `src/` PricingService (locate: grep `class PricingService`), the 8 test files referencing it (grep `PricingService` under `tests/`).
Fix: add/verify a `PricingService.resetForTest()` static (or reuse existing clear); call it **at the start of EACH `Deno.test`/`t.step` that touches pricing state** in the 8 files (a one-time module-scope reset does not isolate later mutations — round-2 review). No behavior change.
**Verify:** run the 8 files individually AND as one batch — identical results. `deno test --allow-all tests/unit/llm/ tests/unit/catalog/` (wherever they live).
Commit: `test: isolate PricingService static state across suites (TEST7)`.

---

## Cluster 1 — Variant/config wiring (L1, D5, L5, TEST1) — CRITICAL

Root cause: `getAdapter()` (`src/parallel/llm-work-pool.ts:320-331`) forwards only `{provider,model,temperature,maxTokens,apiKey}`; `VariantConfig` (`src/llm/variant-types.ts:8-26`) fields `systemPrompt`, `systemPromptName`, `timeout`, `thinkingBudget` vanish. Two seams: `thinkingBudget`/`timeout` travel via `LLMConfig` (adapters read `this.config.thinkingBudget` — anthropic-adapter.ts:397, openai-adapter.ts:131); `systemPrompt` travels via `LLMRequest.systemPrompt`.

### TEST1 (write first) — seam test through the real registry

**Files:** Create `tests/unit/parallel/llm-work-pool-config-seam.test.ts`

```ts
import { assertEquals } from "@std/assert";
import type { LLMConfig } from "../../../src/llm/types.ts";
import { LLMAdapterRegistry } from "../../../src/llm/registry.ts";
import { MockLLMAdapter } from "../../../src/llm/mock-adapter.ts";
import { LLMWorkPool } from "../../../src/parallel/llm-work-pool.ts";
import {
  createMockLLMWorkItem,
  createMockTaskExecutionContext,
} from "../../utils/test-helpers.ts";

Deno.test("LLMWorkPool adapter-config seam", async (t) => {
  const configs: LLMConfig[] = [];
  const requests: { systemPrompt?: string }[] = [];
  LLMAdapterRegistry.register("seamtest", () => {
    const a = new MockLLMAdapter();
    const origConfigure = a.configure.bind(a);
    a.configure = (c: LLMConfig) => { configs.push(structuredClone(c)); origConfigure(c); };
    const origGen = a.generateCode.bind(a);
    a.generateCode = (req, ctx) => { requests.push({ systemPrompt: req.systemPrompt }); return origGen(req, ctx); };
    return a;
  });

  await t.step("thinkingBudget + timeout reach adapter.configure", async () => {
    const item = createMockLLMWorkItem({
      llmProvider: "seamtest",
      context: createMockTaskExecutionContext({
        variantConfig: { thinkingBudget: 50000, timeout: 120000 },
      }),
    });
    const pool = new LLMWorkPool({ maxConcurrent: 1 });
    await pool.submit(item);
    const last = configs.at(-1)!;
    assertEquals(last.thinkingBudget, 50000);
    assertEquals(last.timeout, 120000);
  });

  await t.step("variant systemPrompt reaches LLMRequest", async () => {
    const item = createMockLLMWorkItem({
      llmProvider: "seamtest",
      context: createMockTaskExecutionContext({
        variantConfig: { systemPrompt: "You are a terse AL expert." },
      }),
    });
    const pool = new LLMWorkPool({ maxConcurrent: 1 });
    await pool.submit(item);
    assertEquals(requests.at(-1)!.systemPrompt, "You are a terse AL expert.");
  });
});
```

Adjust factory/pool-constructor args to real signatures (`tests/unit/parallel/llm-work-pool.test.ts:60-84`). Must FAIL before fix.

### L1 — wire variantConfig through both paths (CRITICAL)

**Files:** `src/parallel/llm-work-pool.ts:320-331` (getAdapter), `:533-552` (buildRequest), `src/tasks/executor-v2.ts:88-94`.

getAdapter:

```ts
const vc = item.context.variantConfig;
return LLMAdapterRegistry.create(item.llmProvider, {
  provider: item.llmProvider,
  model: item.llmModel,
  temperature: item.context.temperature,
  maxTokens: item.context.maxTokens,
  apiKey,
  ...(vc?.thinkingBudget !== undefined && { thinkingBudget: vc.thinkingBudget }),
  ...(vc?.timeout !== undefined && { timeout: vc.timeout }),
});
```

buildRequest — variant systemPrompt takes precedence over task-level injection (decided: variant is the controlled A/B parameter; `!== undefined` check, NOT truthiness; user prompt untouched):

```ts
if (applied.systemPrompt) request.systemPrompt = applied.systemPrompt;
const vc = item.context.variantConfig;
if (vc?.systemPrompt !== undefined) request.systemPrompt = vc.systemPrompt;
```

Serial path (executor-v2.ts:88-94): same spread + restore the dropped `apiKey`; same systemPrompt precedence where executor-v2 builds its LLMRequest.

**Verify:** seam test green; `deno test --allow-all tests/unit/parallel/ tests/unit/tasks/`.
**Risk:** OpenRouter has no reasoning-param support post-wiring (accepted, documented). Anthropic `validateConfig` (:176-182) may reject budget-vs-maxTokens combos — surface, don't mask.

### L5 — reconfigure pooled adapters on acquire (MEDIUM, moved here)

**Files:** `src/llm/registry.ts:78-113`; `tests/unit/llm/registry.test.ts`.
Test first: acquire with `{thinkingBudget:1000}`, release, acquire same provider/model with `{thinkingBudget:9000}` → adapter config shows 9000.
Fix: `acquire()` pool-hit path calls `adapter.configure(config)` before returning. Pool key stays provider+model.
**Risk:** adapters must tolerate repeated configure (they do — plain assignment).

### D5 — `@prompt=name` miss fails loud (MEDIUM)

**Files:** `src/llm/variant-parser.ts:171-177`; `tests/unit/llm/variant-parser.test.ts`.
Test first: `@prompt=nonexistent` → throws `ConfigurationError` naming the miss + available names.
Fix:

```ts
case "systemPromptName":
  result.systemPromptName = value;
  if (config?.systemPrompts?.[value]) {
    result.systemPrompt = config.systemPrompts[value].content;
  } else {
    const available = Object.keys(config?.systemPrompts ?? {});
    throw new ConfigurationError(
      `Unknown system prompt "${value}" in variant spec. Available: ${available.join(", ") || "(none)"}`,
    );
  }
  break;
```

Unknown-key `continue` (:219): warn, do NOT throw (forward-compat profile keys).

Close-out: scoped check/lint/fmt; commit `fix(llm): wire variant thinkingBudget/systemPrompt/timeout to adapters; fail loud on @prompt miss (L1, D5, L5, TEST1)`.

---

## Cluster 2 — Concurrency core (P1, P2, P3, P4b, P7, P8, P11, C4, TEST2, TEST5) — CRITICAL..LOW

### P1 — compile-semaphore permit leak on throw (CRITICAL)

**Files:** `src/parallel/compile-queue.ts:549-698` (runPipeline); `tests/unit/parallel/compile-queue.test.ts`.

Interleavings today: (1) success → release at :599; (2) temp-project throw → release at :576; (3) executeCompilePhase throws (ContainerError from compileProject/copyFile/loadProject — routine infra) → catch :678 + finally :687 never release → after `compileConcurrency` (3) such throws, `acquire()` at :509 blocks forever while pool keeps feeding (activeItems already decremented at :534-537).

Fix — idempotent release + finally (release-once flag is synchronous JS, no interleaving hazard):

```ts
let released = false;
const releaseOnce = () => { if (!released) { released = true; releaseCompile(); } };
// replace call sites :576 and :599 with releaseOnce();
} finally {
  releaseOnce();               // before any awaited cleanup
  this.recordCompleted(...);
  await this.cleanupTempProject(projectDir);
}
```

Guarantees: exactly-once release on all exits; permit freed even if cleanup throws.

#### TEST2 (write first) — corrected per review

`compileConcurrency: 3` (match the default), three throwing entries, and **race the initial allSettled against a deadline** (pre-fix the third entry hangs at acquire — allSettled alone would never return):

```ts
Deno.test("compile slot released when compileProject throws", async () => {
  const provider = createMockContainerProvider();
  provider.setCompilationConfig({ throwError: new ContainerError("boom", "c1", "compile") });
  const queue = new CompileQueue({ containerName: "c1", containerProvider: provider, compileConcurrency: 3 });
  const settled = await Promise.race([
    Promise.allSettled([
      queue.enqueue(createMockCompileWorkItem({ id: "a" })),
      queue.enqueue(createMockCompileWorkItem({ id: "b" })),
      queue.enqueue(createMockCompileWorkItem({ id: "c" })),
    ]),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("throwing entries never settled: permit leaked")), 5000)),
  ]);
  assertEquals((settled as PromiseSettledResult<unknown>[]).every((r) => r.status === "rejected"), true);
  provider.setCompilationConfig({ success: true });
  const ok = await Promise.race([
    queue.enqueue(createMockCompileWorkItem({ id: "d" })),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("starved: semaphore leaked")), 5000)),
  ]);
  assertExists(ok);
});
```

Match real ctor/enqueue signatures from the same file's existing tests.

### P2 — parked entries deadlock the bench (CRITICAL)

**Files:** `src/parallel/compile-queue-pool.ts` (park :369-390, flush :286-302, cancelParked :499-509, enqueue :216-218), `src/parallel/orchestrator.ts` (wiring); tests: existing pool tests + new TEST5 file.

Interleavings today: parked entries have no timer (drainPending cancelled it) and no flusher besides enqueue()/onContainerRecovered (prober default-off); `Promise.allSettled(taskPromises)` (orchestrator.ts:460) blocks on promises that transitively await parked entries; `cancelParked` in the finally (:506) is downstream of that await → unreachable. 2 suspects on a 2-container pool = permanent hang.

Fix — explicit parked-entry state machine (per review: object identity, single settlement):

1. Park record: `{ entry, parkTimer }` in `parkedEntries`. Transitions, all synchronous within one event-loop turn, all locating the EXACT record by object identity and removing it from the array before acting:
   - **flush** (enqueue/onContainerRecovered): remove record → `clearTimeout(parkTimer)` → re-admit via `admitRebalancedEntry`.
   - **timeout** (parkTimer fires): remove record → reject with `new QueueTimeoutError("parked with no eligible container", poolName, waitMs)` — constructor is `(message, queueName, waitTimeMs)` per `src/errors.ts:145-160`.
   - **cancelParked(reason)**: for each record: clearTimeout FIRST, then reject.
   Timer duration (round-2 corrected): `remaining = queueTimeoutMs - (now - entry.enqueuedAt)`; `remaining <= 0` → reject IMMEDIATELY (no timer); else arm exactly `remaining` (min 1 ms). No 1-second floor — a floor would breach the cumulative bound (this rule is also the P11 fix).
2. Fail-fast when recovery structurally impossible: pool gets `canRecover(alert: HealthAlert) => boolean` predicate (NOT a coarse boolean — per review): orchestrator supplies one returning `false` when the prober is disabled, and `false` for `global_outage` alerts (prober skips those by design — recovery-prober.ts:198-203). **Signature change:** `rebalanceFromContainer(containerName, alert: HealthAlert)` — the full alert object replaces the current `(containerName, alertId, fingerprint?)` params (`compile-queue-pool.ts:336-390`); the predicate needs the alert, and alertId/fingerprint read off it. Update the orchestrator listener call site. In `rebalanceFromContainer`, if `eligible.length === 0 && !canRecover(alert)` → reject drained entries immediately with `ContainerError("all containers alerted and recovery unavailable", origin, "test")` instead of parking.

Post-fix: every parked promise settles in bounded time on all paths; double-settlement impossible (record removed before action); shutdown allSettled returns; cancelParked remains the belt-and-braces escape.

#### TEST5 (write first)

New `tests/unit/parallel/compile-queue-pool-park-bounds.test.ts` — no manual cancelParked anywhere:

```ts
Deno.test("parked entries settle without manual cancelParked", async (t) => {
  await t.step("park rejects with QueueTimeoutError after remaining budget", async () => {
    // 1-container pool, monitor alerts it, canRecover: () => true (prober "on"),
    // queueTimeoutMs: 1000; enqueue at t0 → rebalance parks at ~t+100 → timer armed with
    // EXACTLY the remaining ~900ms → await rejection between 800ms and 1500ms after t0;
    // assert err instanceof QueueTimeoutError
  });
  await t.step("park with already-exhausted budget rejects immediately", async () => {
    // entry whose enqueuedAt is older than queueTimeoutMs at park time → no timer, immediate reject
  });
  await t.step("all-alerted + canRecover false rejects immediately", async () => {
    // canRecover: () => false → rejection < 100ms, ContainerError, message names condition
  });
  await t.step("flush on recovery clears the park timer (no late rejection)", async () => {
    // park, onContainerRecovered → re-admitted; advance past timer window; promise resolves via queue
  });
  await t.step("cancelParked clears timers before rejecting", async () => { /* no double-settle */ });
});
```

Build pool per `compile-queue-pool.test.ts:404-445` patterns.

### P7 — re-admission drops per-call excludeContainers (MEDIUM, part of P2 machine)

**Files:** `src/parallel/compile-queue.ts:199-219` (QueueEntry), `compile-queue-pool.ts:353-390,286-302`.
Test first: entry enqueued with `excludeContainers:["A"]`, drained from B with only A and C healthy → re-admitted ONLY to C.
Fix: add `excludeContainers?: string[]` to QueueEntry (captured at pool enqueue); rebalance + park-flush union it into target filtering.

### P11 — re-admission resets the wait budget (LOW, part of P2 machine)

Covered by the P2 remaining-budget rule: keep original `enqueuedAt`; every re-arm (admitRebalancedEntry `compile-queue.ts:400-417` AND park timer) uses `max(1000, queueTimeoutMs - elapsed)`. Test: entry drained/re-admitted twice → total wall-clock to QueueTimeoutError ≈ one budget, not three.

### P8 — probe abort ineffective; stop() unbounded (MEDIUM, feeds P2's canRecover honesty)

**Files:** `src/container/interface.ts` (provider interface — NOT types.ts, round-2 correction), `src/container/bc-container-provider.ts:2199` (isHealthy), `src/health/recovery-prober.ts:383-410`.
Test first (prober unit, fake deps): probe that resolves `true` AFTER the timeout fired → counted as `probe_timeout`, NOT probe_success; `stop()` returns within 2×probeTimeout even with a wedged probe.
Fix: `isHealthy(name, opts?: { signal?: AbortSignal })` — provider checks `signal.aborted` between phases (full cancellation of Test-BcContainer not attainable; best-effort). Prober: a probe whose timeout fired is recorded timeout regardless of late result (flag set when ctrl.abort() called); `stop()` waits via `Promise.race([currentTick, delay(2 * probeTimeoutMs)])`.

### P3 — flap cap dead across episodes (MEDIUM)

**Files:** `src/health/recovery-prober.ts:113-131, 196-243, 328-353`; `tests/unit/health/recovery-prober.test.ts`.
Today: `recoveriesCompleted` lives in per-episode state; deleted at :201 when no alert; reset at :219-230 on new alertId → cap never trips. Existing test :264-278 enshrines this ("per-episode by design") contradicting `.claude/rules/alert-drain-rebalance.md` ("left excluded (flap_cap_reached)"). Rule doc wins; invert the test.
Fix: prober-lifetime `lifetimeRecoveries: Map<string, number>` keyed by container; **increment immediately after successful `clearAlert()` and BEFORE `onContainerRecovered()`** (per review: if re-admission throws, the recovery still happened and must count); never cleared on episode transitions, only on prober construction/reset. Cap check reads the lifetime map → `disabledReason = "flap_cap"` + `setRecoveryState` exhausted badge.
Test first (rewrite :264-278): cap 1 → one recovery; new alertId → NO second recovery; `flap_cap_reached` event; container stays excluded.
**Risk:** flaky-then-stable containers stay excluded for the run past the cap — documented design. Keep current default cap value.

### P4b — global-outage under-exclusion + no bulk drain (HIGH) — corrected design

**Files:** `src/health/monitor.ts:305-354` (+ `src/health/types.ts` HealthAlert), `src/parallel/orchestrator.ts:299-320` (listener), `src/parallel/compile-queue-pool.ts:336-390` (rebalance); monitor + pool tests.

Review found two holes in rev-1: (a) conditional `if (ch.alert?.fingerprint === fingerprint)` only covers containers that already HAD an alert — an affected container with no prior per-container alert stays eligible; (b) one shared alert raises ONE `alert_raised`, the orchestrator drains only the trigger container, and `drainedAlerts` dedup by bare alertId no-ops any second call → N−1 sick queues keep dispatching their pending/in-flight work.

Fix:
1. `HealthAlert` for `global_outage` gains `affectedContainers: string[]` (the `containersWithThisFp` list).
2. Monitor raise loop: `ch.alert = alert` for EVERY member of `affectedContainers` (unconditional, replacing whatever was there). **P6 lands HERE, not in Cluster 11** (round-2 review — the replacement orphans old dedupe keys without it): extract a `purgeAlertDedupeKeys(containerName, fingerprint)` helper; call it for every REPLACED alert in this loop AND in the plain-overwrite raise path (monitor.ts:386-387). P6's test (fp1 suspect → fp2 overwrite → clear fp2 → fp1 recurrence RAISES) belongs to this cluster.
3. Orchestrator `alert_raised` listener: when `alert.kind === "global_outage"`, call `pool.rebalanceFromContainer(name, alert)` for EACH `affectedContainers` member (new signature).
4. Pool idempotency key becomes `${alertId}:${containerName}` (`drainedAlerts` set) so per-container drains of one global alert all execute, while true duplicates still no-op.
5. With all containers alerted, each drain finds zero eligible → P2 machinery (park-with-timer or fail-fast reject) — this is why P2 precedes P4b.

Interleavings post-fix: bulk drains are sequential-synchronous per listener invocation; drained entries from container 2..N join the same parkedEntries FIFO with timers; cancellation mid-bulk-drain safe (each record independent); no re-admission to any affected source (all alerted → excluded by gate).

Test first (monitor): raise same catastrophic fp on **3 of 4** containers (absolute minimum for global is 3 — a 2-of-3 test cannot trip it) → assert `getState()` shows the global alert on all three affected, gate excludes all three, and (pool test) three drain outcomes recorded with distinct `${alertId}:${container}` keys; fourth container still eligible.
**Verify:** `deno test --allow-all tests/unit/health/ tests/unit/parallel/`.

### C4 — session timeout must taint, reroute, and never fallback (MEDIUM)

**Files:** `src/container/session-slot.ts:141-193`, `src/container/pwsh-session.ts:383-387`, `src/parallel/compile-queue.ts:601-626` (test-mutex release path); pure-unit tests (no real container).

Review upgrade: preventing same-call fallback is not enough — when `executeTestPhase` throws, the test mutex releases and a WAITING test on the same container can acquire it before any alert drains the queue, recreating concurrent mutation with the still-running in-container op.

Fix:
1. session-slot: on timeout (`session_timeout`), do NOT call `fallback`; throw `ContainerError` with the CALLER-SUPPLIED operation (add `operation` to the slot-run options — the slot runs compile/publish/test/health scripts; do not hardcode "test").
2. `session_crashed` keeps its one fresh-session retry.
3. Taint barrier — **decided (round-2): queue-level taint flag**, NOT monitor-record-first (a generic "session timeout" message matches no `catastrophicSingleFailure` signature in `src/health/signatures.ts`, so recording would not reliably close dispatch synchronously). Mechanism: on a session-timeout ContainerError from executeTestPhase, set `this.tainted = true` on the CompileQueue BEFORE releasing the test mutex. Every waiter re-checks `this.tainted` **immediately after acquiring testMutex, before executeTestPhase** (checking only in `processQueue` misses pipelines already blocked on the mutex); tainted → release mutex, throw ContainerError("container tainted by session timeout", name, op) → withInfraRetry reroutes. Taint clears only via container recovery (`onContainerRecovered`) or queue disposal.
Test first: session-slot timeout → ContainerError with correct operation, fallback spy NOT called; queue-level: two queued test items, first times out → second does NOT run on the tainted container (rejects/reroutes).
**Risk:** heavy ops legitimately exceeding 300 s now reroute — correct per SOAP-harness rules (timeout leaves an orphan op in-container; re-running locally is the death spiral).

Close-out: scoped checks; `deno test --allow-all tests/unit/parallel/ tests/unit/health/ tests/unit/container/session-slot*` (pure unit); commit `fix(parallel,health,container): release-once semaphore, bounded park state machine, lifetime flap cap, global-outage bulk drain, timeout taint (P1, P2, P3, P4b, P7, P8, P11, C4, TEST2, TEST5)`.

---

## Cluster 3 — LLM response integrity (L2+TEST3, T4) — CRITICAL (moved up: every bench run collects wrong data until fixed)

### L2 + TEST3 — streaming finishReason hardcoded "stop" (CRITICAL)

**Files:** `src/llm/openai-adapter.ts:311-317` + Codex stream path :330-407, `src/llm/openrouter-adapter.ts:330-336`, `src/llm/mock-adapter.ts:367`; `tests/unit/llm/`.
TEST3 first: MockLLMAdapter gains `simulatedFinishReason` (config-driven; stop hardcoding at :367); adapter stream tests: final chunk `finish_reason:"length"` → `response.finishReason === "length"`; continuation test: `generateWithContinuation` fires under streaming (gate `continuation.ts:59-62,305-308`).
Fix: `processStreamChunks` captures last non-null `chunk.choices[0]?.finish_reason` → finalizeStream (fallback "stop" only when never present). Codex path: `response.status`/`incomplete_details.reason === "max_output_tokens"` → "length". Same in openrouter. Azure/Gemini already correct.
**Risk:** truncated streamed responses now continue (more tokens, correct behavior).

### T4 — greedy fence regex mangles multi-block responses (CRITICAL)

**Files:** `src/llm/code-extractor.ts:75-110`; `tests/unit/llm/code-extractor.test.ts`.
Test first:

```ts
const twoBlocks = "intro\n```al\ntable 50100 A {}\n```\nprose between\n```al\ncodeunit 50101 B {}\n```\nafter";
assertEquals(extractCode(twoBlocks), "table 50100 A {}\n\ncodeunit 50101 B {}");
```

Plus regressions: single block unchanged; ```json ignored when ```al present; unfenced fallback unchanged.
Fix (decided with reviewer): match all blocks with global non-greedy regexes; concatenate ALL `al`-tagged blocks in order with `\n\n`. For untagged generic fences, concatenate only blocks passing a minimal AL-likeness check (contains `/\b(table|page|codeunit|report|query|xmlport|enum|interface|procedure|trigger)\b/i`) — never append fenced JSON/shell examples. cleanCode stays as final scrub.
**Semantics change:** attempts previously failed by mangled extraction may now compile — historical multi-block responders' strict-compile stats suspect (Findings note; re-bench is user's call).
**Risk:** model echoing duplicate objects across blocks → duplicate-object compile error — that IS a model defect, correctly charged.

Commit: `fix(llm): capture real streaming finishReason; extract all AL fence blocks non-greedily (L2, T4, TEST3)`.

---

## Cluster 4 — Infra/scoring pipeline (C1, C2, C3, T11, P9, P5, T2+TEST6, D4) — CRITICAL/HIGH

**Leaderboard semantics change (explicit):** infra-invalidated attempts (exhausted retries, quarantine, zero-tests, compile-phase infra throws, failed prereq compiles) become EXCLUDED from ingest instead of `passed=false`. Local scores already exclude (`result-aggregator.ts:388-393`). Prod runs benched during outages are suspect — identify via `results.failure_reasons_json LIKE '%Infra error:%'`. Re-bench decisions are the user's; nothing here runs benches or ingest.

Internal order: C1/C2/C3/T11 (producers of infra classification) → P9 → P5 (routing of exhaustion) → T2/TEST6 (consumer) → D4.

### C1 — SOAP zero-tests guard (HIGH)

**Files:** `src/container/bc-container-provider.ts:1808-1827`; pure-unit test stubbing `runTestsViaSoap`.
Test first: stubbed SOAP returns `{success:false,totalTests:0,passedTests:0,failedTests:0}` post-publish → `runTests` throws ContainerError operation "test", message EXACTLY "Zero tests detected after successful publish (infra)" (must match the `zero_tests` signature regex in `src/health/signatures.ts` — verify the regex first).
Fix: in SOAP branch before return:

```ts
if (soapResult.totalTests === 0) {
  contextLog.warn("Zero tests detected after successful publish (infra, SOAP path)");
  throw this.buildPwshError({ containerName, operation: "test",
    message: "Zero tests detected after successful publish (infra)",
    output: JSON.stringify(soapResult) });
}
```

Throw → catch → decideSoapFailureAction → isInfraError → reroute_infra (collision gate needs operation "publish", can't misroute).
**Risk:** legitimately-zero-test tasks reroute → exhaust → synthesized infra failure (excluded) — GH #13 semantics. Note: this multiplies all-alerted scenarios; P2 must already be merged (dependency edge).

### C2 — infra precedence in decideSoapFailureAction (MEDIUM)

**Files:** `src/container/bc-container-provider.ts:220-234`.
Test first: ContainerError(publish) + output carrying BOTH "wait operation timed out" and "already defined in" → `"reroute_infra"`.
Fix:

```ts
const isPublish = error instanceof ContainerError && error.operation === "publish";
if (isPublish && classifyPublishFailure(publishOut) === "infra") return "reroute_infra";
if (isInfraError(error)) return "reroute_infra";
if (isPublish && isCollisionPublishFailure(publishOut)) return "fallback_legacy";
if (isPublish && classifyPublishFailure(publishOut) === "model") return "score_model";
return "fallback_legacy";
```

Four-branch tests (infra-only / both → infra / collision-only / model).

### C3 — compile catch-all rethrows infra (MEDIUM) — after P1

**Files:** `src/container/bc-container-provider.ts:1360-1379`.
Test first: stub `getOrCreateCompilerFolder` to throw ContainerError → `compileProject` THROWS it (today: returns success:false code SYSTEM).
Fix: `if (isInfraError(error)) throw error;` at catch top; SYSTEM synthesis only for non-infra unknowns. Rethrow reaches compile-queue catch :678 → withInfraRetry → reroute + health record (orchestrator classifyInfraError at :605).
**Verify:** unit + TEST2 (throw path through the queue).

### T11 — prereq compile failure is infra (LOW)

**Files:** `src/tasks/executor-v2.ts:573-591`.
Test first: mock provider fails PREREQ compile → attempt errors as ContainerError("setup"), not scored model failure.
Fix: replace "Continue without prereq" with

```ts
throw new ContainerError(
  `Prereq compilation failed for ${prereq.appJson["name"]}: ${prereqCompileResult.errors.map((e) => e.message).join("; ")}`,
  context.containerName, "setup",
);
```

### P9 — maxRetries<=0 skips classifyResult (LOW)

**Files:** `src/parallel/infra-retry.ts:142-148`; `tests/unit/parallel/infra-retry.test.ts`.
Test first: maxRetries 0 + classifyResult returning quarantined → THROWS ContainerError (upstream synthesizes infra).
Fix:

```ts
if (options.maxRetries <= 0) {
  const result = await operation({ excludeContainers: [], onRouted: () => {} });
  const cls = options.classifyResult?.(result);
  if (cls?.kind === "quarantined") {
    throw new ContainerError(
      `Result quarantined by alert ${cls.alertId} with infra retries disabled`,
      cls.originContainer ?? "unknown", "test");
  }
  return { result, retries: [] };
}
```

Update the module contract comment (classifyResult is explicit opt-in) in the same commit.

### P5 — exhaustion evades infra classification (HIGH)

**Files:** `src/parallel/orchestrator.ts:577-581,641`.
Test first: withInfraRetry throws `InfraRetriesExhaustedError(new Error("Quarantined on X"), [...], "no_eligible_containers")` → orchestrator synthesizes infra result (modelResults entry with `Infra error:` reason).
Fix:

```ts
let wasInfraExhaustion = false;
if (err instanceof InfraRetriesExhaustedError) {
  trailingRetries = err.retries; exhaustionReason = err.reason;
  wasInfraExhaustion = true; err = err.cause;
}
...
if (wasInfraExhaustion || isInfraError(err)) { /* synthesize */ }
```

### T2 + TEST6 — exclude infra-invalidated attempts from ingest (CRITICAL)

**Files:** Create `src/health/infra-invalidation.ts`; modify `cli/commands/bench/ingest-assembly.ts:39-105`, `src/parallel/result-aggregator.ts:386-393` (use shared predicate); create `tests/unit/ingest/ingest-assembly-infra.test.ts`.

Shared predicate (replaces the duplicated prefix checks):

```ts
export function isInfraInvalidatedAttempt(a: {
  failureReasons?: string[];
  infraRetryExhausted?: boolean;
  quarantined?: unknown;
}): boolean {
  if (a.infraRetryExhausted) return true;
  if (a.quarantined) return true;
  return (a.failureReasons?.[0] ?? "").startsWith("Infra error:");
}
```

TEST6 first: (a) synthesized infra attempt → no BenchResultItem, assembly meta reports `infraExcludedAttempts: 1`; (b) mixed task: real attempt-1 kept, infra attempt-2 dropped; (c) normal failure still ingested `passed=false`; (d) **all-infra variant → assembly returns a sentinel (`{ skip: "all_infra" }`-shaped result), NO payload built** — decided (review): never POST an empty run; the bench/ingest summary reports the variant as infra-invalidated and the ingest command exits non-success for it (actionable, not silent).

Fix: assembly loop `if (isInfraInvalidatedAttempt(a)) { infraExcluded++; continue; }`; after loop, `if (items.length === 0 && infraExcluded > 0) return { skipped: "all_infra", infraExcluded }` (adjust caller in bench-command + ingest-command to log loudly and mark non-success); aggregator swaps its inline check to the shared predicate.
**Verify:** `deno test --allow-all tests/unit/ingest/ tests/unit/parallel/`.

### D4 — zero price accepted as free (MEDIUM)

**Files:** `src/catalog/seed/inference.ts:286-305`, `src/catalog/seed/sources.ts:113-134`; seed tests.
Test first: `{input:0,output:0}` without explicit free marker → throws SEED_NO_PRICING-class error; OpenRouter slug `foo/bar:free` with 0 → accepted.
Fix (decided): source passes `sourceMarksFree` — for OpenRouter, `slug.endsWith(":free")` (OpenRouter's own explicit free convention); everything else false. Zero without the marker → throw with remedy text ("pre-seed site/catalog/pricing.yml manually for genuinely free models"). Manual pricing.yml entries remain the deliberate override path.

Close-out: scoped checks; suites: ingest, parallel, health, catalog, tasks; commit `fix(scoring): stop infra→model leakage — SOAP zero-tests guard, infra-first triage, compile rethrow, exhaustion classification, ingest exclusion (C1, C2, C3, T11, P9, P5, T2, D4, TEST6)`.

---

## Cluster 5 — Ingest security, staged (S5+precheck, T13, T3, T5, S3, S1, S4, V7) — HIGH

**Staged rollout (review-corrected). All code lands now; flags default to tolerant; the USER flips flags/deploys:**

- Stage A (server, this repo): `/runs` AND `/runs/precheck` accept envelope v1+v2; finalize verifies signature WHEN present (unsigned accepted + logged while `FLAG_REQUIRE_SIGNED_FINALIZE` ≠ "on"); machine_id mismatch → 400 with actionable message; nonce table migration lands (verification WHEN nonce present).
- Stage B (CLI, this repo, later commits in the same cluster): persist run_ids/pricing_version (T3), emit v2, sign finalize (with retry), emit lifecycle nonce, refuse attempts>2 (T5).
- Stage C (user, post-deploy, out of scope): set `FLAG_REQUIRE_SIGNED_FINALIZE=on`, `FLAG_REQUIRE_ENVELOPE_V2=on`, later nonce-required — after confirming no v1/unsigned traffic in logs.

Compat matrix honored: old-CLI+new-server works fully (v1 + unsigned finalize tolerated until Stage C); new-CLI+old-server fails at precheck with bad_version — document "deploy worker before next ingest-bearing bench" in commit + `docs/site/lifecycle.md`.

### S5 — sign run_id + signed_at (HIGH)

**Files:** `src/ingest/sign.ts:12-27`, `src/ingest/mod.ts:159-233` (buildSigned used by BOTH precheck and POST — cover both), `site/src/lib/server/signature.ts:83-107`, `site/src/routes/api/v1/runs/+server.ts:184-203`, **`site/src/routes/api/v1/runs/precheck/+server.ts:14-25`** (review: was missed), `site/wrangler.toml` (FLAG_REQUIRE_ENVELOPE_V2 = "off"); tests both sides.

v2 signed message: `canonicalJSON({ payload, run_id, signed_at })` where `run_id` = envelope run_id, `signed_at` = signature.signed_at. **No payload.run_id cross-check** — review verified `buildPayload()` (src/ingest/envelope.ts:3-35) never serializes runId; binding the envelope value is sufficient and correct.

Server verify: `version===2` → v2 message; `version===1` → legacy message, ONLY while `FLAG_REQUIRE_ENVELOPE_V2 !== "on"`; v1 acceptance logged (`console.warn("v1 envelope from key ...")`) for traffic telemetry. Skew check unchanged (now authenticated under v2).

Tests first: server (a) v2 tampered signed_at → 401; (b) v2 tampered run_id → 401; (c) v1 accepted w/ flag off, rejected w/ flag on; (d) replayed v2 body w/ fresh run_id → 401; precheck same matrix. CLI: v2 output round-trips; mutation of run_id breaks verification.

**Residual:** same-run_id replay within skew window → server idempotency answers "exists" (harmless).

### T13 — machine_id binding (LOW, moved here per review)

**Files:** `site/src/routes/api/v1/runs/+server.ts` POST; site test.
Fix: after key verification, `payload.machine_id !== verified.machineId` → 400 `machine_id_mismatch` with message naming both values (precheck already exposes `machine_id_match` — operators see it before enforcement bites).

### T3 — persist run identity for idempotent replay (HIGH)

**Files:** `cli/commands/bench/parallel-executor.ts:513-648` (generation + save call), `cli/commands/bench/results-writer.ts` (saveResultsJson), `cli/commands/bench/ingest-assembly.ts:59-67`, `cli/commands/bench-command.ts:820-870`, `cli/commands/ingest-command.ts:99-127`; tests `tests/unit/ingest/`.

Exact data flow (round-2 corrected — `ingestBenchResults()` lives in bench-command.ts and receives only file paths + variants, so a parallel-executor local can't reach it; the FILE is the single source of truth for both paths):
1. Export `todayPricingVersion()` from a shared module (it is currently private in bench-command.ts — move to `cli/commands/bench/ingest-assembly.ts` or a small `ingest-meta.ts`).
2. In parallel-executor, immediately before `saveResultsJson` (:616-624), build `const ingestMeta = { schema: 1 as const, pricing_version: todayPricingVersion(), run_ids: Object.fromEntries(variants.map((v) => [v.variantId, crypto.randomUUID()])) };` — one UUID per variant, minted ONCE per bench run. `saveResultsJson(..., ingestMeta)` writes it as top-level `ingest` key.
3. Immediate ingest (`ingestBenchResults` in bench-command :689-836): for each results file, PARSE the saved file's `ingest` key (same read path as replay — DRY) and pass `{ pricingVersion, runId }` into `assembleBenchResultsForVariant`; assembly mints ONLY when absent (with `[WARN] no persisted run_id — this ingest will create a NEW run`).
4. Replay (ingest-command :99-127): identical read of `parsed.ingest`; legacy files without the key → warn + mint (backward compat).

Tests first: assemble twice with persisted meta → identical runId/pricing_version; save→load round-trip; legacy file → warn+mint.

### T5 — refuse attempts>2 at ingest (MEDIUM, moved here — same assembly boundary, AFTER T2 exclusion)

**Files:** `cli/commands/bench/ingest-assembly.ts:79`, `cli/commands/bench-command.ts` (startup validation).
Fix (decided): after infra exclusion, if any remaining attempt has `attemptNumber > 2` → throw `ValidationError("leaderboard schema supports max 2 attempts; run used N — bench with --attempts <=2 for ingested runs")`. Bench startup: `--attempts > 2` WITH ingest enabled → hard startup error (not a warning); allowed with `--no-ingest`.
Test: attempts=3 + ingest → assembly throws; attempts=3 + --no-ingest → runs.

### S3 — finalize auth with ownership (HIGH)

**Files:** `site/src/routes/api/v1/runs/[id]/finalize/+server.ts`, `src/ingest/mod.ts:192-206`, `src/ingest/sign.ts` (reuse signBlobUpload-style header signing), `site/wrangler.toml` (FLAG_REQUIRE_SIGNED_FINALIZE = "off"); site tests.

Server: when signature headers present → verify (blob-auth style: method+path+body_sha256+signed_at) AND **ownership: authenticated key_id must equal `runs.ingest_public_key_id`** — round-2 review confirmed the column EXISTS (`site/migrations/0001_core.sql:105-119`) and POST /runs already stores `verified.key_id` there (`runs/+server.ts:270-313`); finalize SELECTs and compares it. No migration needed. Unsigned → allowed + logged while flag off; 401 when on.
Client: sign the finalize call; move from bare fetch to `postWithRetry`.
Tests: unsigned w/ flag off → 200+log; w/ flag on → 401; signed wrong-key → 403 ownership; signed right-key → 200; replay outside skew → 401.

### S1 — /admin SSR auth in hooks (HIGH)

**Files:** `site/src/hooks.server.ts`, `site/src/lib/server/cf-access.ts`; site tests.
Fix: `handle` gates `pathname.startsWith("/admin")` via `verifyCfAccessJwt`. **Fail closed ALWAYS** (round-2: missing `CF_ACCESS_AUD` must NOT be a production bypass — a dropped secret would silently open /admin). Local dev + vitest get the binding configured explicitly (test bindings / `.dev.vars`); document the dev setup line in the commit body.
Tests: /admin/lifecycle no JWT → 403; valid → 200. Check `site/tests/e2e/` for admin flows needing the test JWT header BEFORE landing.

### S4 — env-gate SSE test routes (HIGH)

**Files:** `site/src/routes/api/v1/__test__/events/reset/+server.ts`, `.../recent/+server.ts`, `site/src/do/leaderboard-broadcaster.ts:174-182`.
Fix: copy the double gate from `__test_only__/broadcast/+server.ts:20-28` (env `ALLOW_TEST_BROADCAST === "on"` AND `x-test-only: 1`); enforce in the DO handler too (env flag through binding). Confirm CI test bindings set the var so existing SSE tests stay green.
Test: mirror `__test_only__-blocked-in-prod.test.ts` for reset + recent.

### V7 — lifecycle nonce with real replay prevention (LOW, moved here per review)

**Files:** NEW migration `site/migrations/00XX_lifecycle_nonce.sql` (`lifecycle_nonces(nonce TEXT PRIMARY KEY, seen_at INTEGER)` + cleanup of rows older than 2×skew on insert), `src/lifecycle/event-log.ts:188-231` (client adds `nonce: crypto.randomUUID()` to signed fields), `site/src/lib/server/lifecycle-auth.ts:144-158` (server: fold nonce into verified fields WHEN header present; INSERT-or-409; nonce-less requests accepted while tolerant).
Staged: server tolerant-verify first; client emits; enforcement is a later user flip (documented). New-client+old-server lifecycle calls FAIL (signed bytes change) — same deploy-worker-first note as S5.
Tests: replayed nonce → 409/401; nonce-less accepted (tolerant); site migration applies cleanly on fresh DB.

Close-out: `deno test --allow-all tests/unit/ingest/ tests/unit/lifecycle/`; `cd site && npm run build && npm run test:main`; two commits: `feat(site): v2 envelope on runs+precheck, tolerant signed finalize w/ ownership, admin SSR gate, SSE env gate, machine_id bind, nonce table (S5, S3, S1, S4, T13, V7)` then `fix(ingest): persist run identity, emit v2 + signed finalize, refuse attempts>2 (S5, T3, T5, V7)`.

---

## Cluster 6 — Sandbox integrity (M4, M5, M7, M3 → M1 → M2, TEST4, M6, M8–M13) — CRITICAL/HIGH

Order matters (review): trusted verdict channel requires path containment (M4), per-run server/workspace (M5), process reaping (M7), and auth (M3) FIRST — otherwise the M1 verdict can be forged or cross-wired.

### M4 — path-translation containment (HIGH)

**Files:** factor `translatePath` into `mcp/path-translation.ts` (exported, testable); modify `mcp/al-tools-server.ts:91-108` (delegate), `:1301-1306` (verifyDir); create `tests/unit/mcp/translate-path.test.ts`.
Tests first:

```ts
// mapping C:\workspace → U:\host\ws
assertEquals(translatePath("C:\\workspace\\app.al"), "U:\\host\\ws\\app.al");
assertThrows(() => translatePath("C:\\workspace\\..\\..\\Windows\\x"));   // traversal
assertThrows(() => translatePath("C:\\workspacefoo\\x"));                 // segment confusion
assertThrows(() => translatePath("D:\\other\\abs\\path"));                // host-absolute passthrough
```

Fix: segment-aware prefix (append `\` before compare, case-insensitive); after concat, `resolve()` + containment (`resolved === hostRoot || resolved.startsWith(hostRoot + "\\")`) else throw; unmatched prefix THROWS when a workspaceMapping exists (identity behavior only when no mapping — non-sandbox mode). verifyDir — **CORRECTED during implementation review (TOCTOU):** the original "inside the project" placement put verify staging in the agent-writable mount, letting a container-side watcher swap the copied benchmark test/.app mid-al_verify_task and forge an authoritative verdict (and read the hidden test mid-call). Verify staging goes in a HOST temp dir outside any mount (Deno.makeTempDir, server-chosen path — never derived from a model argument, so M4 containment unaffected); `.cg-*` source-collection exclusion + finally deletion retained as belt-and-braces.

### M5 — per-run MCP port + no silent server reuse (MEDIUM)

**Files:** `src/agents/mcp-manager.ts:38-83`, `src/agents/sandbox-executor.ts:112-113`.
Fix: free-port allocation (`Deno.listen({port:0})` → capture `addr.port` → close → pass; retry once on bind race); `start()` with an existing process → `stop()` it first (never reuse a server whose workspace-map may differ); health probe unchanged. sandbox-executor consumes the manager-reported port.
Test: two managers started concurrently → distinct ports; second start() on one manager replaces the process.

### M7 — reap the MCP child (MEDIUM)

**Files:** `src/agents/mcp-manager.ts:105-113`.
Fix: `stop()` → SIGTERM → `await Promise.race([child.status, delay(5000)])` → `kill("SIGKILL")` fallback → null out. Test with a stub child.

### M3 — MCP auth token + body cap + CORS removal (HIGH)

**Files:** `mcp/al-tools-server.ts:1667-1759` (factor `authorize(request, token)` + `readBodyCapped(request, max)` as exported helpers), `src/agents/mcp-manager.ts` (generate + pass `--auth-token`), `src/agents/sandbox-executor.ts` (env MCP_AUTH_TOKEN), `docker/agent-sandbox/entrypoint.ps1` (.mcp.json `"headers": {"Authorization": "Bearer ..."}`).
Fix: per-run `crypto.randomUUID()` token; 401 without it (except /health); remove `Access-Control-Allow-Origin: *` trio; cap bodies at 10 MB (Content-Length + capped read) → JSON-RPC error. Bind: `--hostname` flag; default 0.0.0.0 ONLY with token, else 127.0.0.1.
Tests: helper-level (401 matrix, oversize, health open).
**Risk:** entrypoint.ps1 changed → sandbox image REBUILD required before next agent bench (note in commit); update `.claude/rules/docker-sandbox.md` manual-testing section.

### M1 — trusted verdict channel (CRITICAL) — review-corrected design

Rev-1's workspace sidecar was INVALID (model-writable — the container mounts the workspace RW and could forge `.cg-verify-result.json`). Corrected:

**Files:** `mcp/al-tools-server.ts` (write verdict), `src/agents/mcp-manager.ts` (own the verdict dir), `src/agents/sandbox-executor.ts:200-268` (consume); `tests/unit/agents/sandbox-verdict.test.ts`.

Design:
1. mcp-manager creates a per-run host temp dir OUTSIDE any mounted path (scratchpad-style `Deno.makeTempDir`), passes `--verdict-dir <dir>` + `--run-nonce <uuid>` to the server. The container never sees this dir (only `C:\workspace` is mounted); M4 containment stops al_* tools writing into it via traversal.
2. Server: after every verify-tool completion, append verdict JSON `{ nonce, tool, taskId, success, compileSuccess, totalTests, passed, failed, timestamp }` to `<verdict-dir>/verdicts.jsonl`, where `tool` is `"al_verify_task"` or `"al_verify"`.
3. sandbox-executor: pre-launch, dir is fresh (per-run). Post-run, read verdicts.jsonl; **authoritative success = last verdict with `tool === "al_verify_task"` AND `taskId === expected task` AND `nonce` match AND `success === true` AND (requiresTests → `totalTests > 0`)**. Round-2 hardening: direct `al_verify` verdicts are DIAGNOSTIC ONLY and can never satisfy M1 — `al_verify` takes a model-chosen testFile, so the model could stage a fake workspace test named for the expected task and get a matching derived taskId (`al-tools-server.ts:1070-1225`); `al_verify_task` resolves the REAL benchmark test from the task YAML, which the model cannot substitute. No matching verdict → failure, `failureDetails.phase = "agent_execution"`, reason "no verified tool result". `detectSuccess` demoted to a diagnostic string only.
Tests first: (a) passing al_verify_task verdict for expected task → success; (b) prose "All tests passed", empty verdict dir → FALSE; (c) verdict for a DIFFERENT taskId → FALSE; (d) verdict `{success:true,totalTests:0}` + requiresTests → FALSE; (e) verdict success:false + prose success → FALSE; (f) passing verdict with `tool: "al_verify"` (not al_verify_task) → FALSE.
**Semantics:** sandbox agent-bench runs previously passing on prose now fail unless verified — intended; historical sandbox data suspect (Findings note).

### M2 — success-detector hardening (CRITICAL)

**Files:** `src/agents/success-detector.ts`; REWRITE `tests/unit/agents/sandbox-success-detection.test.ts` to import the real module (it re-declares local copies today); extend `success-detector.test.ts`.
Tests first (red): `"0 tests passed"` → false; requiresTests + compile-only output → false (delete line 82 shortcut); bare `'"success": true'` fragment → false; `"3/7 passed"` stays false.
Fix: `/(\d+) tests passed/` requires count > 0; remove `hasCompileSuccess && !failed` pass; remove bare success-substring triggers (:28-32); `detectStructuredResult` demoted below tool-result evidence (kept for non-sandbox diagnostics only).

### TEST4 — unify executor detection (MEDIUM)

**Files:** `src/agents/executor.ts:183-193`.
Fix: replace inline 2-substring check with `detectSuccess(resultText, requiresTests)` applied PER tool_result block (per-block structure preserved — that's what makes this path sound). Tests: tool_result "0 tests passed" → not success; JSON `{passed:5,totalTests:5}` → success via result-parser.

### M6 — API key off the docker argv (MEDIUM) — review-adjusted

**Files:** `src/sandbox/windows-provider.ts:307-346`, `src/agents/sandbox-executor.ts:185-194`, `docker/agent-sandbox/entrypoint.ps1`.
Fix: write the key to a file in a SECOND read-only mount OUTSIDE the workspace (`-v <hostSecretsDir>:C:\cg-secrets:ro`, hostSecretsDir = per-run temp dir); entrypoint reads `C:\cg-secrets\api-key` into `$env:ANTHROPIC_API_KEY` for the Claude process. `docker inspect` shows only the mount path. (In-container the agent can still read its own env/file — unavoidable, the agent needs the key; the finding is host-side argv/inspect exposure.) Never under `C:\workspace` (model-writable, review). Cleanup: delete hostSecretsDir in the executor's finally.

### M8–M13 (LOW batch)

- **M8:** rotate sandbox-debug.log + timing.log at 10 MB (size check → rename `.1` → fresh).
- **M9:** JSON-RPC parse-error `id: null` (spec).
- **M10:** publishedPrereqCache stores the in-flight Promise (single-flight).
- **M11 (review-adjusted):** switch `-v` to `--mount type=bind,src=...,dst=C:\workspace` (comma/equals-safe form); validate only genuinely illegal path chars — do NOT reject spaces (valid in Windows paths).
- **M12:** timedOut from an actually-fired timer flag, not `duration >= timeout`.
- **M13:** dispatchToolCall validates params shape → -32602.

Close-out: `deno test --allow-all tests/unit/agents/ tests/unit/mcp/`; commit `fix(sandbox,mcp): containment, per-run server+token, trusted verdict channel, hardened detection, secret mount (M1-M13, TEST4)`.

---

## Cluster 7 — Confidence review gate (V1, V2, V3, V9) — HIGH — review-corrected design

Review found rev-1 unimplementable as written: (a) `scoreEntry` validates the ANALYZER shape; persisted `ModelShortcomingEntry` (incorrectPattern/errorCodes[]/no outcome) fails its schema → every entry scores 0; (b) `pending_review.analysis_event_id` is a non-null FK (enqueue rejects id<1, `pending-review.ts:95-134`) and the `analysis.completed` event is appended only AFTER runAnalyzeStep returns (`lifecycle/orchestrator.ts:688-716`); (c) tracker-ignored `analysis_failed` records can't be counted by analyze-step from the shortcomings file; (d) the decide endpoint ALREADY inserts a shortcoming on accept (`review/[id]/decide/+server.ts:151-245`) — the promotion path exists and must be reconciled, not deferred.

Design rev 2:

1. **V2 bridge:** `ModelShortcomingEntry` gains `confidence?: number`; tracker maps enum at write (`CONFIDENCE_LEVEL_TO_SCORE = { high: 0.9, medium: 0.6, low: 0.3 }` exported from `src/verify/schema.ts`); merge branch keeps MIN of existing/incoming.
2. **Persisted-entry scorer:** new `scorePersistedEntry(entry: ModelShortcomingEntry, ctx)` in `src/lifecycle/confidence.ts` — reuses the cluster-consistency and cross-LLM sub-scorers; replaces the analyzer-schema-validity component with persisted-shape checks (non-empty correctPattern AND incorrectPattern; every errorCodes[i] matches `/^AL\d{4}$/`; else component 0). `scoreEntry` stays for true analyzer-shaped inputs (its only current caller is tests); do NOT feed persisted entries to it.
3. **V3 veto (inside both scorers' composition):** `crossScore = (clamped - 0.5) * 0.6` → range −0.3..+0.3; unsampled stays neutral 0. Full disagreement on a 0.7 entry → 0.4 → queued. Update `confidence.test.ts` snapshot expectations (oracle correction, not weakening).
4. **V1 wiring with correct event-ID ordering:** `runAnalyzeStep` computes `finalConfidence = min(mappedConfidence, scorePersistedEntry(...).score)` per entry, threshold from `ctx` config (`lifecycle.confidence_threshold` — plumb like `cross_llm_sample_rate`; delete the hardcoded `:40` const). It RETURNS the pending list in the analysis.completed payload (as today). THEN the lifecycle orchestrator (`lifecycle/orchestrator.ts:688-716`), after appending the event and capturing the server-returned event id, POSTs each pending entry to the NEW signed endpoint `POST /api/v1/admin/lifecycle/review/enqueue`. **Wire shape (round-2, canonical = the existing `enqueue()` signature, `pending-review.ts:70-143`):** body `{ analysis_event_id, model_slug, entry, confidence }` where `confidence` is the ConfidenceResult with `score` set to `finalConfidence`; the server derives concept_slug itself as enqueue() already does. **Auth (round-2):** `signLifecycleHeaders`/`buildHeaderSignedFields` (`event-log.ts:188-231`) currently support only GET/PUT — extend to POST, sign the raw enqueue body (body_sha256), and include the `X-CG-Nonce` header per V7. Verify the events POST returns the inserted id — read `admin/lifecycle/events/+server.ts` first; if it doesn't return it, add it to the response (additive).
   **Idempotency/replay safety (round-2):** a network failure after a partial enqueue leaves a completed analysis event with missing queue rows, and blind retry could duplicate. Therefore: (a) new migration adds `UNIQUE(analysis_event_id, concept_slug_proposed)` on `pending_review` (ride the same migration file as the V7 nonce table or its own — either way migrations-first deploy order); (b) server enqueue is upsert/return-existing on conflict; (c) orchestrator reconciliation: when the analyze step is SKIPPED on resume (already completed), re-read the prior `analysis.completed.pending_review_entries` payload and re-POST them (safe under (a)+(b)).
5. **Publish gate + promotion reconciliation:** publish-step skips entries with `finalConfidence < threshold` (logged "N held for review"). Accepted reviews: decide endpoint already inserts the shortcoming server-side on accept — so an accepted entry must ALSO be excluded from later publish-step runs to avoid duplicates: publish-step's existing payload-hash idempotency skip (`publish-step.ts:141-155`) covers identical payloads — write a test proving decide-accept + later publish run does NOT duplicate (if hashes differ because decide inserts a transformed shape, add a slug-level existence check to the skip logic).
6. **V9:** `parseFallback` → `outcome: "analysis_failed"` (new union member); tracker ignores it for entries but INCREMENTS a `parse_failures` counter persisted in the shortcomings FILE (add optional `parse_failures: number` to the file schema in BOTH `src/verify/` writer and `src/lifecycle/analyzer-schema.ts`); analyze-step surfaces it in the analysis.completed payload. Compiler exhaustiveness flags all outcome switch sites.

Tests first: tracker numeric mapping + MIN-merge; analyze-step with tracker-produced JSON (no injected numeric — the current fixture masks V1) → pending_review_count from mapped 0.3 entry; threshold read from config; scorePersistedEntry component tests incl. disagreement veto 0.4; analyzer garbled JSON → analysis_failed + parse_failures increments; site: enqueue endpoint 401 unsigned / 200 signed / row present; decide-accept-then-publish no-duplicate.

Legacy files without confidence: keep `?? 1` (auto-publish as before), but LOG a warning and COUNT legacy no-confidence entries in the analyze output so the operator can force re-analysis (round-2 decision).

**Files:** `src/verify/{types,schema,shortcomings-tracker,analyzer}.ts`, `src/lifecycle/{confidence,analyzer-schema}.ts`, `src/lifecycle/steps/{analyze-step,publish-step}.ts`, `src/lifecycle/orchestrator.ts`, site: `admin/lifecycle/review/enqueue/+server.ts` (new), `admin/lifecycle/events/+server.ts` (return event id if absent).
**Verify:** `deno test --allow-all tests/unit/verify/ tests/unit/lifecycle/`; site build + test:main.
Commit: `fix(lifecycle,verify): numeric confidence end-to-end, persisted-entry scorer, cross-LLM veto, review-queue wiring, analysis_failed outcome (V1, V2, V3, V9)`.

---

## Cluster 8 — CLI correctness (CLI1–CLI12) — HIGH..LOW

### CLI1 — presets never take effect (HIGH)

**Files:** `cli/commands/bench-command.ts:749-799`; new `tests/unit/cli/preset-merge.test.ts`.
Test first: preset `{attempts:1}` + CLI without `--attempts` → merged 1.
Fix: extend the existing `cliHasValue("containers")` argv-inspection to ALL preset-mergeable fields (attempts, temperature, maxTokens, runs, stream, debug, format, output, container, maxConcurrency, taskConcurrency).

### CLI2 — post-retry stats cover only the retried subset (HIGH)

**Files:** `cli/commands/bench/parallel-executor.ts:513-648`.
Test first: factor `computeFinalSummary(allResults)`; 10 results (8 pass) + retry of 2 → stats over all 10.
Fix: recompute stats/comparisons from `finalResults` via the ResultAggregator after the retry loop; same for `--retry <file>` mode.

### CLI4 — zero matched tasks exits 0 (HIGH)

**Files:** `cli/helpers/task-loader.ts:101-107` (+ audit loader callers).
Test first: no-match glob → throws ValidationError.
Fix: throw at the loader choke point; bench exits ≠ 0; list-style callers that tolerate empty catch explicitly.

### CLI3 — health block vanishes under --no-dashboard (MEDIUM)

**Files:** `cli/commands/bench/parallel-executor.ts:629-640`, `cli/commands/bench/results-writer.ts:296-311`.
Test first: writer fed monitor-derived snapshot, dashboard absent → `# Container Health` + `infra_invalidated:` present.
Fix: `dashboard?.getHealthSnapshot() ?? adaptMonitorState(healthMonitor.getState())` (small adapter); move `infra_invalidated` out of the containerHealth-present branch.

### CLI5 — SSE full-state dropped when initial fetch failed (MEDIUM)

**Files:** `cli/dashboard/page.ts:648`.
Fix: per-event-type guard — full-state/health-snapshot/pool-snapshot replay events process with `state === null`. Manual-verify note (no dashboard JS harness); keep change minimal.

### CLI6 — replay exits 0 on 100% transient failure; first fatal aborts loop (MEDIUM)

**Files:** `cli/commands/ingest-command.ts:144-186`.
Test first: two variants both transient-fail → exit ≠ 0 (mirror bench-command.ts:908-912); fatal on variant 1 → variant 2 still attempted, summary prints, exit ≠ 0.

### CLI7–CLI12 (LOW batch)

- **CLI7:** cleanupContainer steps individually try/caught (best-effort); cleanup + endOfRunNuke into `finally`.
- **CLI8:** add the missing finally closing benchRootSpan + closeTracer (incl. dashboard-alive path).
- **CLI9:** SSE server `cancel()` removes controller from `clients`; add only after successful replay enqueue.
- **CLI10:** `isTransientFailure` drops bare `"failed to"`/`"500"`; require provider-error shapes (rate limit/429/timeout/ECONNRESET/`\b50[023]\b`). Test: "Failed to extract code from response" → false.
- **CLI11:** fix floor-hint string to `containers×2`; bench-tui totals use `variants.length`.
- **CLI12:** `esc` escapes `'` (parity with escapeHtml).

Commit: `fix(cli): preset merge, full-set retry stats, zero-task guard, no-dashboard health block, replay exit codes + low batch (CLI1-CLI12)`.

---

## Cluster 9 — Tasks/stats data quality (T6/T12, T7, T8, T9, T14/V11, V4, V5, V6, V8, V10) — MEDIUM/LOW

### T6 + T12 — hash CRLF-sensitivity + absolute-path skip (MEDIUM)

**Files:** `src/ingest/catalog/task-set-hash.ts:90-125`; `tests/unit/ingest/task-set-hash.test.ts`.
Test first: (a) same content CRLF vs LF → same hash (text extensions); (b) binary (.docx/.app bytes incl. 0x0D0A pairs) hashed RAW — never normalized; (c) checkout under `C:\tmp\output\repo` → files not skipped (relative-path matching).
Fix: normalize `\r\n`→`\n` ONLY for text extensions (exported const: `.yml .yaml .al .json .xml .rdlc .md .txt`); binaries raw. SKIP_DIR_RE matched against walk-root-RELATIVE paths.
**Decided (review):** land now, NO feature flag. Consequence: next bench mints a NEW task_sets hash (identical in kind to a task edit); user coordinates re-bench + `set_current` flip — prominent commit-body note.

### T7 — transformer ignores manifest expected (MEDIUM)

**Files:** `src/tasks/transformer.ts:87-91,296-317`.
Test first: manifest with `expected.mustContain/mustNotContain` → context validation carries exactly those; description-scrape ONLY when manifest omits `expected` patterns.
Fix: manifest-first; scrape as fallback only.

### T8 — parallel-path testSuccess defaults true (MEDIUM)

**Files:** `src/parallel/orchestrator.ts:1064` + evaluation block.
Test first: testApp task with missing testResult → NOT passed.
Fix: `manifest.expected?.testApp ? (compileResult.testResult?.success ?? false) : (compileResult.testResult?.success ?? true)`; align mustContain/mustNotContain pass/fail semantics with executor-v2 evaluateAttempt (:412-444) — read it and mirror exactly (benchmark-consistency rule).

### T9 — Zod passthrough swallows typos (MEDIUM)

**Files:** `src/tasks/interfaces.ts:16-52`.
Test first: manifest with a typo'd `expected` key → load FAILS naming the key. Corpus test: run ALL `tasks/**/*.yml` through the loader — zero failures required before commit (fix any drifted manifest in the same commit; do NOT loosen).
Fix: `.strict()` on `expected` + root; `metadata` stays passthrough; `prompts` typed if trivial.

### LOW batch

- **T14≡V11:** replace hardcoded `claude-sonnet-4-5-20250929` (`src/rules/generator.ts:287`, `src/verify/analyzer.ts:44`) with `lifecycle.analyzer_model` config chain; replace workers.dev fallback (`analyzer.ts:47`) with `https://ai.sshadows.dk`.
- **V4:** event-log reducer skips non-finite ts (`Number.isFinite` gate; log + ignore). Test: first event NaN-ts, second valid → valid wins.
- **V5+V10:** stats importer — contentHash from actual task content (reuse task-set-hash helpers), never `id`; nullish (not falsy) pass-rate guard.
- **V6:** delete `src/stats/hasher.ts` in favor of `task-set-hash.ts` (thin re-export if imports wide); read errors THROW (no silent drop).
- **V8:** embedder failure/zero-vector → throw (analysis.failed) instead of cosine-0 orphan concept.

Commit: `fix(tasks,stats,ingest): hash normalization + strict schemas + manifest-driven validation + low batch (T6, T7, T8, T9, T12, T14, V4, V5, V6, V8, V10, V11)`.

---

## Cluster 10 — Container remainder (C5, C6, C7, C8) — LOW

- **C5:** add `bcchConfigInit()` to `executeCommand` + `isHealthy` script sites (bc-container-provider.ts:2190-2205); parameterize executeCommand's raw interpolation (escapeForPS).
- **C6:** rewrite stale soap-test-client comments (:26-28,205-207) to the reroute invariant. Doc-only.
- **C7:** escape credentials via `escapeForPS` (bc-script-builders.ts:244-245 + grep siblings).
- **C8:** `Number.isFinite` guard on SOAP per-test durations (:139-142).

Commit: `fix(container): config-init coverage, credential escaping, stale comments, NaN guard (C5, C6, C7, C8)`.

---

## Cluster 11 — Health remainder (P10, P12) — LOW

(P6 moved INTO Cluster 2/P4b — round-2 review: the global-alert replacement loop needs the dedupe purge or it orphans keys.)

- **P10 (LOW):** finalize the pending retry record (fill retryContainerName) before the exhaustion throw.
- **P12 (LOW):** clear recoveryEvents in reset() + runParallel start.

Commit: `fix(health): exhaustion record finalization, event reset (P10, P12)`.

---

## Cluster 12 — Catalog/doctor/prompts (D2, D3, D6–D10) — MEDIUM/LOW

- **D2 (MEDIUM):** appendPricingIfChanged REPLACES the same-(slug,version) row when values differ; findPricingAtVersion → last match until then. Test: same-day double seed → one row, latest values.
- **D3 (MEDIUM):** single exported family-slug fn in `src/catalog/seed/inference.ts`; used from bench-command.ts:550-558. Canonical algorithm = whichever matches EXISTING `site/catalog/model-families.yml` rows for openrouter (check the file; encode answer in the test).
- **D6:** knowledge-loader keyed by relative path (duplicate basenames both load).
- **D7:** doctor engine: skipped dep → dependent skipped.
- **D8 (review-adjusted):** honor `Retry-After` header with ONE bounded retry; preserve resumable failure report. No blanket 60 s sleep.
- **D9:** guard JSON.parse in al-project loadProject → structured error.
- **D10:** empty-system note moves from errors[] to a warnings[] field; adjust caller(s).

Commit: `fix(catalog,doctor,prompts): pricing replace, unified family slug, loader keys + low batch (D2, D3, D6-D10)`.

---

## Cluster 13 — Site remainder (S2, S7) — MEDIUM/LOW

- **S2 (review-corrected — exp check alone does NOT close S2):** require `exp` claim AND add a configurable in-code allowlist: `CF_ACCESS_ALLOWED_EMAILS` env (comma-separated); when set, `claims.email` must be in it (fail-closed when configured; unset = current behavior, CF Access policy remains primary + documented). Tests: exp-less → 401; allowlist set + non-member → 403; member → 200.
- **S7:** bind the task-set hash in leaderboard subqueries (thread params through the builder; drop `'${q.set}'` interpolation).

Site build + test:main. Commit: `fix(site): JWT exp + email allowlist, bind task-set hash params (S2, S7)`.

---

## Cluster 14 — Test seams remainder (TEST8) — LOW

- `tests/unit/utils/clipboard.test.ts:245-260`: remove the swallowing catch; assert real behavior behind a capability `ignore:` gate.
- `tests/unit/example.test.ts`: delete (scaffolding).

Commit: `test: remove placeholder assertions (TEST8)`.

---

## Final verification gate (Phase 4)

1. Per-cluster targeted suites at each close-out (above).
2. Container-safe full unit run: `deno test --allow-all --ignore=tests/unit/container tests/unit/` — real output shown.
3. Site: `cd site && npm run build && npm run test:main` + `npm run test:build`.
4. `deno check` all changed files; `deno lint` changed dirs; scoped `deno fmt`.
5. Findings.md dashboard all-ticked with SHAs, or honest remainder with reasons.
6. NO benches/ingest/deploy/push. Handoff notes for the user:
   - Worker deploy required before next ingest-bearing bench (S5/S3/S1/S4/T13/V7); ONE new migration file lands (V7 nonce table + Cluster-7 `UNIQUE(analysis_event_id, concept_slug_proposed)` on pending_review) → migrations-first order applies.
   - Stage-C flags (`FLAG_REQUIRE_ENVELOPE_V2`, `FLAG_REQUIRE_SIGNED_FINALIZE`, nonce enforcement) are user flips after traffic checks.
   - T6 hash change → next bench mints a new task_sets row; coordinate re-bench + `set_current`.
   - Sandbox image rebuild required (entrypoint.ps1 changed) before next agent bench.
   - Historical-data suspects: prod runs with `failure_reasons_json LIKE '%Infra error:%'` (T2), multi-block responders (T4), streamed truncations (L2), sandbox agent benches (M1/M2).

## Resolved design decisions (were Open Questions, settled in review round 1)

1. T6: land now, no flag; cutover is a normal task-set-hash event.
2. L1: variant systemPrompt wins over task-level injection; `!== undefined` semantics.
3. T4: concat all `al`-tagged blocks; AL-likeness filter for untagged.
4. T5: hard startup error for `--attempts > 2` with ingest enabled; assembly throws post-T2-exclusion.
5. D4: `:free` suffix = OpenRouter's explicit marker; manual pricing.yml = deliberate override; zero without either → SEED_NO_PRICING.
6. Cluster 6: full event-ID ordering + promotion reconciliation IN scope (decide endpoint already inserts on accept — tested, not deferred).
7. S2: allowlist env var, fail-closed when configured.
8. V7: D1 nonce table migration, staged enforcement.

## Open questions — ALL RESOLVED in round 2

1. S3 ownership: `runs.ingest_public_key_id` exists (0001_core.sql:105-119), POST /runs stores `verified.key_id` — finalize compares it. No migration.
2. Legacy shortcomings files without confidence: keep `?? 1` (backward compat) but LOG + COUNT legacy entries in analyze output; force-reanalyze remains a user option.
3. C4 taint barrier: queue-level tainted flag (generic timeout message matches no catastrophic signature, so monitor-record-first can't close dispatch synchronously); re-check taint after each mutex acquire.

No unresolved disagreements with the external reviewer after two rounds.
