# Automatic Inline Infra Retry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Each task has `- [ ]` checkboxes. **Within each task, follow `superpowers:test-driven-development` — write the failing test first, then make it pass.**

> **Revision history**
> - **2026-05-13 v3.1 (current).** Patches from gpt-5.5-pro review. State-machine fixes: `maxRetries: 0` fast-path; global-outage check moved into the infra-error catch; non-infra error mid-retry finalizes the active record before re-throw; `NoEligibleContainersError` after a real infra preserves the original infra as `cause`. Real-data fixes: `enqueue` gains `onRouted` callback so the retry trail records the actual routed container (no more `"(pending)"` placeholder); zero-retry exhaustions now record explicit `infraRetryExhausted` + `infraRetryExhaustionReason` on the attempt so `# Infra Retries` block can count them. Plumbing fixes: `configuredContainers` is in helper options from Task 1; `InfraRetryRecord` lives in `src/tasks/interfaces.ts` alongside `ExecutionAttempt` (correct layering direction); `collectHealthExclusions` filters only active alerts; pseudocode wraps ONLY `compileQueue.enqueue`, not the rest of `executeCompilation`; `infraRetriesPerAttempt` declared optional on options type with use-site default to avoid fixture churn.
> - **2026-05-13 v3.** Inline retry pivot (post-loop pass dropped). Superseded by v3.1; same architecture, fixed state machine + routing observability.
> - **2026-05-13 v2.** Post-loop pass with manifest registry and aggregator merge. Superseded — touched too many ancillary modules.
> - **2026-05-13 v1.** Initial post-loop spec.

**Goal:** When a compile-or-test work item fails with an infrastructure-classified error inside `processTaskForVariant`, automatically retry the **same work item** on a different healthy container — up to N times per model attempt — before reporting failure upward. The model's per-attempt retry budget (the existing `attemptLimit`) is untouched. The retry decision is made the instant the error is caught, using the current health snapshot. If retries exhaust, the existing orchestrator catch-block path fires `synthesizeInfraFailureResult` exactly as today, but with a new `infraRetries[]` trail + `infraRetryExhausted`/`infraRetryExhaustionReason` metadata attached.

**Architecture:** A single new helper `withInfraRetry` wraps ONLY the `compileQueue.enqueue` call inside `executeCompilation` — not the whole method. The compile pool's `enqueue` method gains two optional parameters: `excludeContainers: string[]` (route-time exclusion) and `onRouted: (containerName) => void` (so callers learn which container the pool picked).

```typescript
// processTaskForVariant (simplified)
for (attemptNumber 1..options.attemptLimit) {
  const llm = await executeLLMAttempt(...);
  if (llm.ok) {
    const { compileResult, infraRetries, exhausted, exhaustionReason }
      = await executeCompilation(manifest, variant, context, executionId,
                                  attemptNumber, llm, workItemId);
    const attempt = createAttempt(attemptNumber, llm, compileResult, context);
    if (infraRetries.length > 0) attempt.infraRetries = infraRetries;
    if (exhausted) {
      attempt.infraRetryExhausted = true;
      attempt.infraRetryExhaustionReason = exhaustionReason;
    }
    attempts.push(attempt);
    if (compileResult.success) break;
  }
}
```

And `executeCompilation`:

```typescript
private async executeCompilation(...): Promise<ExecuteCompilationOutcome> {
  const compileItem: CompileWorkItem = { ... }; // built ONCE, outside retry
  this.emit({ type: "compile_queued", ... });   // emitted ONCE

  return await withInfraRetry(
    ({ excludeContainers, onRouted }) => {
      this.emit({ type: "compile_started", ... });
      return this.compileQueue!.enqueue(compileItem, { excludeContainers, onRouted });
    },
    {
      maxRetries: this.config.infraRetriesPerAttempt ?? 1,
      configuredContainers: this.config.containerNames ?? [],
      healthMonitor: this.healthMonitor,
      emit: this.emit.bind(this),
      context: { taskId: manifest.id, variantId: variant.variantId, attemptNumber },
    },
  );
}
```

If `withInfraRetry` exhausts the budget OR can't find an eligible container OR hits global outage, it throws `InfraRetriesExhaustedError(cause, retries, exhaustionReason)`. The orchestrator's existing `processTask` catch unwraps it: `synthesizeInfraFailureResult` gets the trail + reason, attaches them to `attempts[0]`. The prose `failureReasons` block is unchanged (Phase A's downstream parsers untouched).

No CLI flag. Defaults ON with `infraRetriesPerAttempt: 1`. Operator escape hatches:
- `CENTRALGAUGE_BENCH_INFRA_RETRY=0` → forces 0 for this run.
- `.centralgauge.yml` → `bench.infraRetriesPerAttempt: N` to raise the budget.

**Tech Stack:** Deno + TypeScript, existing `classifyInfraError` (`src/health/classify.ts`), existing `isInfraError` (`src/health/is-infra-error.ts`), existing `ContainerHealthMonitor`, no new dependencies.

**Out of scope (defer to Phase C/D):**

- Cross-bench retry memory.
- Auto-quarantining bad containers from `--containers` for the rest of the bench.
- Splitting compile and test into separate retryable work items. Currently compile+test execute atomically inside `CompileQueue.enqueue` (compile-queue.ts:663). A test-only infra failure causes a full compile+test re-run on the next container — wasteful but acceptable for v1 (compile ~10s, tests ~5min, so the relative cost is small).
- Concurrency-aware retry pacing beyond random jitter. v1 uses 10-50ms jitter; a future token bucket per healthy container can replace it if stampedes become a real issue.

---

## File map

**New files:**

| Path                                                    | Purpose                                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/parallel/infra-retry.ts`                           | Pure helper `withInfraRetry`. Stateless. Takes the operation, the budget, configured containers, an optional health monitor, and an event emitter. Returns the successful result + trail + exhaustion-metadata; throws `InfraRetriesExhaustedError` only when the operation never returned. |
| `src/parallel/errors.ts`                                | `NoEligibleContainersError`, `InfraRetriesExhaustedError`. Both extend `CentralGaugeError` from `src/errors.ts`. |
| `tests/unit/parallel/infra-retry.test.ts`               | Helper state-machine tests.                                                                                |
| `tests/unit/parallel/compile-queue-pool-exclude.test.ts` | Pool-level routing tests for `excludeContainers` + `onRouted` callback.                                    |

**Modified files:**

| Path                                                | Change                                                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/parallel/compile-queue.ts`                     | `CompileWorkQueue.enqueue(item, options?: { excludeContainers?: string[]; onRouted?: (containerName: string) => void })`. `CompileQueue` (single-container): throw `NoEligibleContainersError` if its `containerName` is excluded; otherwise call `onRouted(this.containerName)` before doing work. `CompileQueuePool`: filter queues by exclusion; if every queue excluded, throw `NoEligibleContainersError`; advance rotor over eligible subset only; call `onRouted(picked.containerName)` before forwarding. |
| `src/parallel/orchestrator.ts`                      | `executeCompilation` returns `ExecuteCompilationOutcome { compileResult, infraRetries, exhausted, exhaustionReason }`. Internally wraps ONLY the `enqueue` call in `withInfraRetry`. `processTaskForVariant` reads the outcome, attaches retry metadata to the attempt. `processTask` catch unwraps `InfraRetriesExhaustedError` before calling synthesizer. |
| `src/health/terminal-record.ts`                     | `synthesizeInfraFailureResult` accepts optional `infraRetries` + `infraRetryExhaustionReason`, attaches to synthesized `attempts[0]`. Prose `failureReasons` block unchanged. |
| `src/tasks/interfaces.ts`                           | New types `InfraRetryRecord`, `InfraRetryExhaustionReason`. `ExecutionAttempt` gains optional `infraRetries?: InfraRetryRecord[]`, `infraRetryExhausted?: boolean`, `infraRetryExhaustionReason?: InfraRetryExhaustionReason`. |
| `src/parallel/types.ts`                             | Add `infra_retry_*` events to `ParallelExecutionEvent`. `ParallelBenchmarkOptions.infraRetriesPerAttempt?: number` (optional; default 1 at use-site). |
| `src/config/types.ts` + `src/config/loader.ts`      | `.centralgauge.yml` reads `bench.infraRetriesPerAttempt` (default 1). `CENTRALGAUGE_BENCH_INFRA_RETRY=0` overrides to 0.                       |
| `cli/commands/bench/parallel-executor.ts`           | Pass `infraRetriesPerAttempt` from resolved config into `ParallelBenchmarkOptions`. Warn on startup if a single container is configured AND `infraRetriesPerAttempt > 0`. |
| `cli/commands/bench/results-writer.ts`              | Score file: new `# Infra Retries` block. Counts include zero-retry exhaustions via `attempts[].infraRetryExhausted`. `results.json` already serializes the new fields via normal attempt structure. |
| `cli/dashboard/types.ts` + `bridge.ts` + `page.ts`  | SSE event variants for inline retry. Task row gains `↻ N` badge when retry is in flight; toast on exhaustion.                                  |
| `CLAUDE.md`                                         | Note the inline retry behavior + config knob + env-var disable.                                                                                 |

---

## Key invariants

These must hold at every commit; tests enforce them:

1. **Infra retries do NOT consume model attempt budget.** `attemptLimit` (default 2) counts MODEL retries with LLM feedback. Infra retries are a separate counter under `infraRetriesPerAttempt` (default 1).
2. **`maxRetries: 0` is identical to no helper.** The operation runs once; any error (infra or not) propagates unchanged. No `InfraRetriesExhaustedError` wrapping. No retry events emitted.
3. **Original container excluded on retry.** Each retry's `excludeContainers` includes every container that has already failed in this attempt sequence. Verified by `withInfraRetry` tests.
4. **Health-monitor alerts widen exclusion at retry-decision time (not at original-call time).** Active alerts only — resolved alerts are filtered out. Global outage at retry-decision time causes immediate exhaustion.
5. **No eligible containers → exhausted, not infinite loop.** When `excludeContainers` covers every configured container, `CompileQueue`/`CompileQueuePool` throws `NoEligibleContainersError`. The helper unwraps it and throws `InfraRetriesExhaustedError` with `exhaustionReason: "no_eligible_containers"` and `.cause` = the LAST REAL INFRA error (if any), not the `NoEligibleContainersError` itself. This keeps `processTask`'s `isInfraError(err.cause)` check working.
6. **Non-infra errors propagate untouched.** `isInfraError(err)` gate on every catch. If the operation throws a non-infra error mid-retry, the helper finalizes the active retry record as `outcome: "non_infra_failure"`, emits `infra_retry_failed`, and re-throws.
7. **Single-container deployments short-circuit gracefully.** If the union of (failed containers, alerted containers) covers `configuredContainers`, the helper throws `InfraRetriesExhaustedError` with `exhaustionReason: "no_eligible_containers"` without sleeping. A startup warning is logged once per bench when only one container is configured AND retries are enabled.
8. **Existing synthesizer path unchanged on exhaustion.** `synthesizeInfraFailureResult` still produces the same prose `failureReasons` block; the new metadata rides as structured fields on `attempts[0]`.
9. **Retry trail records the ACTUAL routed container.** The `onRouted` callback fires inside the pool before the work runs; `withInfraRetry` captures that and writes it into the active retry record's `retryContainerName`. Never `"(pending)"` in finalized records.
10. **Zero-retry exhaustions are visible.** Single-container short-circuit / immediate global outage / `NoEligibleContainersError` before any retry produces `infraRetries: []` but `infraRetryExhausted: true` + a `infraRetryExhaustionReason`. Score-file counter reads BOTH fields, not just `infraRetries.length > 0`.
11. **Anti-stampede jitter.** Between a failed call and each retry: 10-50ms random sleep. Injectable for tests.
12. **Refuse to retry when failed container is unknown.** If `ContainerError.containerName` is missing AND `onRouted` never fired (operation threw before route), the helper cannot enforce "different container" and throws `InfraRetriesExhaustedError` with `exhaustionReason: "unknown_failed_container"`. Better than silently excluding `"unknown"`.
13. **Recovery is invisible to scoring.** If a retry succeeds, the attempt's `success=true`, `score` is the test score, no penalty. The `infraRetries[]` array is audit metadata only.

---

## Task decomposition

Each task follows TDD: failing test → implementation → green → commit.

### Task 1: Types, errors, and config knob

**Files:**
- Modify: `src/tasks/interfaces.ts`, `src/parallel/types.ts`, `src/errors.ts`, `src/parallel/errors.ts` (new), `src/config/types.ts`, `src/config/loader.ts`
- Test: `tests/unit/config/loader.test.ts`

- [ ] **Step 1: Failing test for config knob.**
  - `.centralgauge.yml` with `bench: { infraRetriesPerAttempt: 3 }` → resolved 3.
  - `CENTRALGAUGE_BENCH_INFRA_RETRY=0` env override → resolved 0 regardless of YAML.
  - YAML absent → default 1.
  - Invalid (negative, non-integer) → throws config validation error.

- [ ] **Step 2: Add types**

```typescript
// src/tasks/interfaces.ts (lives WITH ExecutionAttempt — neutral position)
export type InfraRetryOutcome = "succeeded" | "infra_again" | "non_infra_failure";

export type InfraRetryExhaustionReason =
  | "budget_exhausted"
  | "no_eligible_containers"
  | "global_outage"
  | "unknown_failed_container";

export interface InfraRetryRecord {
  retryNumber: number;             // 1-based, within a single model attempt
  originalContainerName: string;
  retryContainerName: string;       // populated via onRouted callback; never "(pending)" in a finalized record
  fingerprint: string;
  signatureLabel?: string;
  durationMs: number;
  outcome: InfraRetryOutcome;
}

export interface ExecutionAttempt {
  // ... existing fields ...
  infraRetries?: InfraRetryRecord[];
  infraRetryExhausted?: boolean;
  infraRetryExhaustionReason?: InfraRetryExhaustionReason;
}
```

```typescript
// src/parallel/types.ts
import type { InfraRetryRecord, InfraRetryExhaustionReason } from "../tasks/interfaces.ts";

// extend ParallelExecutionEvent union:
| { type: "infra_retry_started"; taskId: string; variantId: string; attemptNumber: number; retryNumber: number; originalContainerName: string; fingerprint: string; signatureLabel?: string }
| { type: "infra_retry_succeeded"; taskId: string; variantId: string; attemptNumber: number; retryNumber: number; retryContainerName: string; durationMs: number }
| { type: "infra_retry_failed"; taskId: string; variantId: string; attemptNumber: number; retryNumber: number; retryContainerName: string; outcome: Exclude<InfraRetryOutcome, "succeeded">; durationMs: number }
| { type: "infra_retry_exhausted"; taskId: string; variantId: string; attemptNumber: number; totalRetries: number; finalContainerName: string; fingerprint?: string; reason: InfraRetryExhaustionReason }

// extend ParallelBenchmarkOptions (OPTIONAL to avoid fixture churn)
infraRetriesPerAttempt?: number;  // default 1 at use-site
```

```typescript
// src/parallel/errors.ts (NEW)
import { CentralGaugeError } from "../errors.ts";
import type { InfraRetryRecord, InfraRetryExhaustionReason } from "../tasks/interfaces.ts";

export class NoEligibleContainersError extends CentralGaugeError {
  constructor(
    public readonly excludedContainers: string[],
    public readonly configuredContainers: string[],
  ) {
    super(
      `No eligible containers for compile/test (excluded: ${excludedContainers.join(", ") || "(none)"}; configured: ${configuredContainers.join(", ")})`,
      "NO_ELIGIBLE_CONTAINERS",
      { excludedContainers, configuredContainers },
    );
  }
}

export class InfraRetriesExhaustedError extends CentralGaugeError {
  constructor(
    public readonly cause: Error,
    public readonly retries: InfraRetryRecord[],
    public readonly reason: InfraRetryExhaustionReason,
  ) {
    super(cause.message, "INFRA_RETRIES_EXHAUSTED", { retries: retries.length, reason });
  }
}
```

> **Layering note.** `InfraRetryRecord` is in `src/tasks/interfaces.ts` (domain types). `src/parallel/types.ts` and `src/parallel/errors.ts` import FROM it. This is the correct direction: parallel/executor depends on domain, not the reverse. Do NOT put `InfraRetryRecord` in `src/parallel/types.ts` — it would force `src/tasks/interfaces.ts` to import from the executor.

- [ ] **Step 3: Implement config loader.** Validate at load: integer ≥ 0. Env var only honors literal `"0"` (any other value leaves YAML in effect).

- [ ] **Step 4: Make config tests pass.**

- [ ] **Step 5: Commit**

```bash
git add src/tasks/interfaces.ts src/parallel/types.ts src/errors.ts src/parallel/errors.ts src/config tests/unit/config
git commit -m "feat(infra-retry): types, errors, config knob (v3.1)"
```

---

### Task 2: Pool routing with `excludeContainers` + `onRouted`

**Files:**
- Modify: `src/parallel/compile-queue.ts`
- Test: `tests/unit/parallel/compile-queue-pool-exclude.test.ts` (new), `tests/unit/parallel/compile-queue.test.ts` (extend)

- [ ] **Step 1: Failing tests**

```typescript
Deno.test("CompileQueue (single) throws NoEligibleContainersError when its container is excluded", async () => {
  const provider = new MockContainerProvider();
  const queue = new CompileQueue(provider, "Cronus28");
  await assertRejects(
    () => queue.enqueue(makeItem(), { excludeContainers: ["Cronus28"] }),
    NoEligibleContainersError,
  );
});

Deno.test("CompileQueue calls onRouted with its containerName BEFORE doing work", async () => {
  const provider = new MockContainerProvider();
  const queue = new CompileQueue(provider, "Cronus28");
  let routed: string | undefined;
  await queue.enqueue(makeItem(), { onRouted: (c) => routed = c });
  assertEquals(routed, "Cronus28");
});

Deno.test("CompileQueuePool routes to non-excluded queues only", async () => {
  const provider = new MockContainerProvider();
  const pool = new CompileQueuePool(provider, ["Cronus28", "Cronus281", "Cronus282"]);
  let routed: string | undefined;
  await pool.enqueue(makeItem(), { excludeContainers: ["Cronus28"], onRouted: (c) => routed = c });
  assertNotEquals(routed, "Cronus28");
  assert(routed === "Cronus281" || routed === "Cronus282");
});

Deno.test("CompileQueuePool throws NoEligibleContainersError when all queues excluded", async () => {
  const pool = new CompileQueuePool(new MockContainerProvider(), ["Cronus28", "Cronus281"]);
  await assertRejects(
    () => pool.enqueue(makeItem(), { excludeContainers: ["Cronus28", "Cronus281"] }),
    NoEligibleContainersError,
  );
});

Deno.test("CompileQueuePool rotor fans out across eligible queues under repeated calls", async () => {
  const pool = new CompileQueuePool(new MockContainerProvider(), ["Cronus28", "Cronus281", "Cronus282"]);
  const routes: string[] = [];
  for (let i = 0; i < 6; i++) {
    await pool.enqueue(makeItem(), { excludeContainers: ["Cronus28"], onRouted: (c) => routes.push(c) });
  }
  // Both eligible containers must appear at least once — proves rotor advances over eligible subset.
  assert(routes.includes("Cronus281"));
  assert(routes.includes("Cronus282"));
});
```

- [ ] **Step 2: Implement.** Both implementations call `onRouted` before doing work. `CompileQueuePool` advances `routingRotor` only across eligible queues (so the spread is fair when the same exclusion repeats).

- [ ] **Step 3: Routing-log integrity test.** The pool's `routingLog` entry must still record the FULL pool's depths at routing time, but `routedTo` must be an eligible queue. Existing pool tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/parallel/compile-queue.ts tests/unit/parallel
git commit -m "feat(pool): per-call excludeContainers + onRouted callback"
```

---

### Task 3: `withInfraRetry` helper — state machine

**Files:**
- Create: `src/parallel/infra-retry.ts`
- Test: `tests/unit/parallel/infra-retry.test.ts`

- [ ] **Step 1: Failing tests** (each one drives a specific state-machine branch)

```typescript
// 1. Disabled fast-path
Deno.test("maxRetries: 0 runs once and propagates any error unchanged", async () => {
  const operation = () => Promise.reject(new ContainerError("PSSession broken", "Cronus28", "compile"));
  const events: any[] = [];
  await assertRejects(
    () => withInfraRetry(() => operation(), {
      maxRetries: 0, configuredContainers: ["Cronus28", "Cronus281"],
      emit: (e) => events.push(e),
      context: { taskId: "t", variantId: "v", attemptNumber: 1 },
    }),
    ContainerError,
  );
  assertEquals(events.length, 0); // no retry events
});

Deno.test("maxRetries: 0 returns result on success", async () => {
  const operation = ({ onRouted }: any) => { onRouted("Cronus28"); return Promise.resolve({ ok: true }); };
  const result = await withInfraRetry(operation, {
    maxRetries: 0, configuredContainers: ["Cronus28"],
    context: { taskId: "t", variantId: "v", attemptNumber: 1 },
  });
  assertEquals(result.retries, []);
});

// 2. Non-infra error
Deno.test("non-infra error propagates immediately, no retry consumed", async () => {
  const err = new Error("AL0001: Identifier 'Foo' is not declared");
  let calls = 0;
  await assertRejects(() => withInfraRetry(() => { calls++; return Promise.reject(err); }, {
    maxRetries: 2, configuredContainers: ["Cronus28", "Cronus281"],
    context: { taskId: "t", variantId: "v", attemptNumber: 1 },
  }), Error, "AL0001");
  assertEquals(calls, 1);
});

// 3. Successful retry
Deno.test("infra error then success records 1-entry trail with actual routed container", async () => {
  let call = 0;
  const operation = ({ excludeContainers, onRouted }: any) => {
    call++;
    if (call === 1) { onRouted("Cronus28"); return Promise.reject(new ContainerError("PSSession broken", "Cronus28", "compile")); }
    assertEquals(excludeContainers, ["Cronus28"]);
    onRouted("Cronus281");
    return Promise.resolve({ ok: true });
  };
  const result = await withInfraRetry(operation, {
    maxRetries: 1, configuredContainers: ["Cronus28", "Cronus281"],
    jitterMs: () => 0,
    context: { taskId: "t", variantId: "v", attemptNumber: 1 },
  });
  assertEquals(result.retries.length, 1);
  assertEquals(result.retries[0].originalContainerName, "Cronus28");
  assertEquals(result.retries[0].retryContainerName, "Cronus281"); // NOT "(pending)"
  assertEquals(result.retries[0].outcome, "succeeded");
});

// 4. Budget exhausted
Deno.test("infra N+1 times with maxRetries N → InfraRetriesExhaustedError with budget_exhausted reason", async () => {
  const op = () => Promise.reject(new ContainerError("PSSession broken", "Cronus28", "compile"));
  const e = await assertRejects(() => withInfraRetry(op, {
    maxRetries: 1, configuredContainers: ["Cronus28", "Cronus281"],
    jitterMs: () => 0,
    context: { taskId: "t", variantId: "v", attemptNumber: 1 },
  }), InfraRetriesExhaustedError) as InfraRetriesExhaustedError;
  assertEquals(e.reason, "budget_exhausted");
  assertEquals(e.retries.length, 1);
  assert(e.cause instanceof ContainerError);
});

// 5. Non-infra mid-retry: trail finalized
Deno.test("non-infra error during retry finalizes active record as non_infra_failure, propagates", async () => {
  let call = 0;
  const op = ({ onRouted }: any) => {
    call++;
    if (call === 1) { onRouted("Cronus28"); return Promise.reject(new ContainerError("PSSession broken", "Cronus28", "compile")); }
    onRouted("Cronus281");
    return Promise.reject(new Error("AL0001: real bug"));
  };
  const events: any[] = [];
  await assertRejects(() => withInfraRetry(op, {
    maxRetries: 1, configuredContainers: ["Cronus28", "Cronus281"],
    jitterMs: () => 0, emit: (e) => events.push(e),
    context: { taskId: "t", variantId: "v", attemptNumber: 1 },
  }), Error, "AL0001");
  const failedEvt = events.find((e) => e.type === "infra_retry_failed");
  assertEquals(failedEvt.outcome, "non_infra_failure");
});

// 6. No eligible containers from pool
Deno.test("NoEligibleContainersError from pool: cause preserves last real infra error", async () => {
  let call = 0;
  const realInfra = new ContainerError("PSSession broken", "Cronus28", "compile");
  const op = ({ onRouted }: any) => {
    call++;
    if (call === 1) { onRouted("Cronus28"); return Promise.reject(realInfra); }
    return Promise.reject(new NoEligibleContainersError(["Cronus28", "Cronus281"], ["Cronus28", "Cronus281"]));
  };
  const e = await assertRejects(() => withInfraRetry(op, {
    maxRetries: 5, configuredContainers: ["Cronus28", "Cronus281"],
    jitterMs: () => 0,
    context: { taskId: "t", variantId: "v", attemptNumber: 1 },
  }), InfraRetriesExhaustedError) as InfraRetriesExhaustedError;
  assertEquals(e.reason, "no_eligible_containers");
  assertEquals(e.cause, realInfra); // NOT the NoEligibleContainersError
});

// 7. Single-container short-circuit
Deno.test("single-container deployment: no retry attempted, no jitter, fast exhaustion", async () => {
  const start = performance.now();
  const op = ({ onRouted }: any) => { onRouted("Cronus28"); return Promise.reject(new ContainerError("PSSession broken", "Cronus28", "compile")); };
  const e = await assertRejects(() => withInfraRetry(op, {
    maxRetries: 1, configuredContainers: ["Cronus28"], // only one!
    jitterMs: () => 9999, // would be obvious if called
    context: { taskId: "t", variantId: "v", attemptNumber: 1 },
  }), InfraRetriesExhaustedError) as InfraRetriesExhaustedError;
  const elapsed = performance.now() - start;
  assertEquals(e.reason, "no_eligible_containers");
  assertEquals(e.retries.length, 0); // empty trail
  assert(elapsed < 50, `Expected fast short-circuit, got ${elapsed}ms`);
});

// 8. Global outage at retry decision
Deno.test("global outage detected at retry decision: exhausted without retry", async () => {
  let call = 0;
  const op = ({ onRouted }: any) => {
    call++;
    if (call === 1) { onRouted("Cronus28"); return Promise.reject(new ContainerError("PSSession broken", "Cronus28", "compile")); }
    throw new Error("should not be reached");
  };
  const monitor = mockHealthMonitor({ globalOutage: true });
  const e = await assertRejects(() => withInfraRetry(op, {
    maxRetries: 1, configuredContainers: ["Cronus28", "Cronus281"],
    healthMonitor: monitor, jitterMs: () => 0,
    context: { taskId: "t", variantId: "v", attemptNumber: 1 },
  }), InfraRetriesExhaustedError) as InfraRetriesExhaustedError;
  assertEquals(e.reason, "global_outage");
  assertEquals(call, 1); // never retried
});

// 9. Active alerts widen exclusion
Deno.test("health monitor active alert: container added to exclusion automatically", async () => {
  let call = 0;
  let secondCallExclude: string[] = [];
  const op = ({ excludeContainers, onRouted }: any) => {
    call++;
    if (call === 1) { onRouted("Cronus28"); return Promise.reject(new ContainerError("PSSession broken", "Cronus28", "compile")); }
    secondCallExclude = [...excludeContainers];
    onRouted("Cronus282");
    return Promise.resolve({ ok: true });
  };
  const monitor = mockHealthMonitor({ activeAlerts: ["Cronus281"] });
  await withInfraRetry(op, {
    maxRetries: 1, configuredContainers: ["Cronus28", "Cronus281", "Cronus282"],
    healthMonitor: monitor, jitterMs: () => 0,
    context: { taskId: "t", variantId: "v", attemptNumber: 1 },
  });
  assert(secondCallExclude.includes("Cronus28"));
  assert(secondCallExclude.includes("Cronus281"));
});

Deno.test("health monitor resolved (no longer active) alert: NOT added to exclusion", async () => {
  // Monitor returns a container with .alert=undefined → must not exclude.
});

// 10. Unknown failed container
Deno.test("infra error without containerName and no onRouted callback: refuse to retry", async () => {
  const op = () => Promise.reject(new Error("Run-TestsInBcContainer failed")); // matches isInfraError but no ContainerError
  const e = await assertRejects(() => withInfraRetry(op, {
    maxRetries: 5, configuredContainers: ["Cronus28", "Cronus281"],
    jitterMs: () => 0,
    context: { taskId: "t", variantId: "v", attemptNumber: 1 },
  }), InfraRetriesExhaustedError) as InfraRetriesExhaustedError;
  assertEquals(e.reason, "unknown_failed_container");
});

// 11. Test-phase infra retries full compile+test
// (covered in orchestrator integration tests, Task 4)

// 12. Emit order
Deno.test("event sequence on successful retry: started, succeeded; no failed/exhausted", async () => {
  // Verify exact event ordering.
});

Deno.test("event sequence on exhaustion: started, failed, exhausted (no succeeded)", async () => { /* ... */ });
```

- [ ] **Step 2: Implement state machine**

```typescript
// src/parallel/infra-retry.ts
import { classifyInfraError } from "../health/classify.ts";
import { isInfraError } from "../health/is-infra-error.ts";
import { ContainerError } from "../errors.ts";
import { NoEligibleContainersError, InfraRetriesExhaustedError } from "./errors.ts";
import type { ContainerHealthMonitor } from "../health/monitor.ts";
import type { InfraRetryRecord, InfraRetryOutcome, InfraRetryExhaustionReason } from "../tasks/interfaces.ts";
import type { ParallelExecutionEvent } from "./types.ts";

export type RetryOperation<T> = (params: {
  excludeContainers: string[];
  onRouted: (containerName: string) => void;
}) => Promise<T>;

export interface WithInfraRetryOptions {
  maxRetries: number;
  configuredContainers: string[];
  healthMonitor?: ContainerHealthMonitor;
  emit?: (event: ParallelExecutionEvent) => void;
  context: { taskId: string; variantId: string; attemptNumber: number };
  jitterMs?: () => number;
}

export interface WithInfraRetryResult<T> {
  result: T;
  retries: InfraRetryRecord[];
}

export async function withInfraRetry<T>(
  operation: RetryOperation<T>,
  options: WithInfraRetryOptions,
): Promise<WithInfraRetryResult<T>> {
  // Fast path: disabled
  if (options.maxRetries <= 0) {
    let _routed: string | undefined;
    const result = await operation({
      excludeContainers: [],
      onRouted: (c) => { _routed = c; },
    });
    return { result, retries: [] };
  }

  const retries: InfraRetryRecord[] = [];
  const excludeContainers: string[] = [];
  const jitter = options.jitterMs ?? (() => 10 + Math.floor(Math.random() * 40));
  let lastInfraError: Error | undefined;

  // Total attempts allowed = 1 original + maxRetries
  for (let attemptIndex = 0; attemptIndex <= options.maxRetries; attemptIndex++) {
    let routedContainer: string | undefined;
    const onRouted = (c: string) => { routedContainer = c; };
    const start = performance.now();

    try {
      const result = await operation({
        excludeContainers: [...excludeContainers],
        onRouted,
      });

      // Success — finalize trail if this was a retry
      if (attemptIndex > 0) {
        const last = retries[retries.length - 1]!;
        last.retryContainerName = routedContainer ?? last.retryContainerName;
        last.outcome = "succeeded";
        last.durationMs = performance.now() - start;
        options.emit?.({
          type: "infra_retry_succeeded",
          ...options.context,
          retryNumber: attemptIndex,
          retryContainerName: last.retryContainerName,
          durationMs: last.durationMs,
        });
      }
      return { result, retries };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const durationMs = performance.now() - start;

      // Finalize the active retry record (if this was a retry attempt)
      const finalizeActive = (outcome: InfraRetryOutcome, container: string) => {
        if (attemptIndex > 0) {
          const last = retries[retries.length - 1]!;
          last.retryContainerName = container;
          last.outcome = outcome;
          last.durationMs = durationMs;
          if (outcome !== "succeeded") {
            options.emit?.({
              type: "infra_retry_failed",
              ...options.context,
              retryNumber: attemptIndex,
              retryContainerName: container,
              outcome,
              durationMs,
            });
          }
        }
      };

      // Pool says no eligible target — terminal exhaustion
      if (error instanceof NoEligibleContainersError) {
        finalizeActive("non_infra_failure", routedContainer ?? "(none)");
        const cause = lastInfraError ?? error;
        throw new InfraRetriesExhaustedError(cause, retries, "no_eligible_containers");
      }

      // Not an infra error — propagate unchanged
      if (!isInfraError(error)) {
        finalizeActive("non_infra_failure", routedContainer ?? "unknown");
        throw error;
      }

      // It IS infra
      lastInfraError = error;
      const failedContainer = (error instanceof ContainerError ? error.containerName : undefined) ?? routedContainer;
      const classification = classifyInfraError(error);

      finalizeActive("infra_again", failedContainer ?? routedContainer ?? "unknown");

      // Out of budget?
      if (attemptIndex >= options.maxRetries) {
        options.emit?.({
          type: "infra_retry_exhausted",
          ...options.context,
          totalRetries: retries.length,
          finalContainerName: failedContainer ?? "unknown",
          fingerprint: classification.fingerprint,
          reason: "budget_exhausted",
        });
        throw new InfraRetriesExhaustedError(error, retries, "budget_exhausted");
      }

      // Cannot enforce "different container" without knowing which one failed
      if (failedContainer === undefined) {
        options.emit?.({
          type: "infra_retry_exhausted",
          ...options.context,
          totalRetries: retries.length,
          finalContainerName: "unknown",
          fingerprint: classification.fingerprint,
          reason: "unknown_failed_container",
        });
        throw new InfraRetriesExhaustedError(error, retries, "unknown_failed_container");
      }

      // Check health monitor AT RETRY DECISION TIME
      const healthExcl = collectHealthExclusions(options.healthMonitor);
      if (healthExcl.globalOutage) {
        options.emit?.({
          type: "infra_retry_exhausted",
          ...options.context,
          totalRetries: retries.length,
          finalContainerName: failedContainer,
          fingerprint: classification.fingerprint,
          reason: "global_outage",
        });
        throw new InfraRetriesExhaustedError(error, retries, "global_outage");
      }

      // Widen exclusion: union of (already-excluded, failed, alerted)
      if (!excludeContainers.includes(failedContainer)) excludeContainers.push(failedContainer);
      for (const alerted of healthExcl.alerted) {
        if (!excludeContainers.includes(alerted)) excludeContainers.push(alerted);
      }

      // Short-circuit if exclusion covers all configured
      const allCovered = options.configuredContainers.every((c) => excludeContainers.includes(c));
      if (allCovered) {
        options.emit?.({
          type: "infra_retry_exhausted",
          ...options.context,
          totalRetries: retries.length,
          finalContainerName: failedContainer,
          fingerprint: classification.fingerprint,
          reason: "no_eligible_containers",
        });
        throw new InfraRetriesExhaustedError(error, retries, "no_eligible_containers");
      }

      // Schedule the next retry
      retries.push({
        retryNumber: attemptIndex + 1,
        originalContainerName: failedContainer,
        retryContainerName: "(pending)", // filled in by next loop's onRouted/finalize
        fingerprint: classification.fingerprint,
        signatureLabel: classification.signature?.label,
        durationMs: 0,
        outcome: "infra_again", // tentative
      });
      options.emit?.({
        type: "infra_retry_started",
        ...options.context,
        retryNumber: attemptIndex + 1,
        originalContainerName: failedContainer,
        fingerprint: classification.fingerprint,
        signatureLabel: classification.signature?.label,
        // retryContainerName intentionally omitted — not known until enqueue routes
      });

      await sleep(jitter());
    }
  }

  // Unreachable — loop exits via return or throw inside catch.
  throw new Error("withInfraRetry: unreachable state-machine exit");
}

function collectHealthExclusions(monitor?: ContainerHealthMonitor) {
  if (!monitor) return { alerted: [] as string[], globalOutage: false };
  const snapshot = monitor.snapshot();
  // Active alerts only (alert defined). A resolved container has alert === undefined.
  const alerted = snapshot.containers
    .filter((c) => c.alert !== undefined)
    .map((c) => c.containerName);
  const globalOutage = (snapshot.alerts ?? []).some((a) => a.kind === "global_outage");
  return { alerted, globalOutage };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
```

> **Two facts the implementer must verify before commit:**
>
> 1. `ContainerHealthMonitor.snapshot()` returns an object shaped as expected. If the real method is named differently (e.g. `getSnapshot()`), update `collectHealthExclusions` accordingly.
> 2. `c.alert !== undefined` is the right "active" check. If the type uses a discriminated `status: "active" | "resolved"` field instead, switch to that.

- [ ] **Step 3: Make tests pass.**

- [ ] **Step 4: Commit**

```bash
git add src/parallel/infra-retry.ts tests/unit/parallel/infra-retry.test.ts
git commit -m "feat(infra-retry): withInfraRetry state machine + tests"
```

---

### Task 4: Wire `withInfraRetry` into `executeCompilation`

**Files:**
- Modify: `src/parallel/orchestrator.ts`, `src/health/terminal-record.ts`
- Test: `tests/unit/parallel/orchestrator.test.ts` (extend), `tests/unit/health/terminal-record.test.ts` (extend)

- [ ] **Step 1: Failing integration tests**

```typescript
// Recovery path
Deno.test("orchestrator: compile infra on Cronus28 → retry succeeds on Cronus281", async () => {
  // Mock provider: Cronus28 throws PSSession-broken on compile; Cronus281 succeeds.
  // Single LLM attempt.
  // Expected: attempt has success=true, infraRetries.length===1,
  //   infraRetries[0].originalContainerName === "Cronus28",
  //   infraRetries[0].retryContainerName === "Cronus281",
  //   infraRetries[0].outcome === "succeeded".
});

// Test-phase infra (proves compile+test atomic retry works)
Deno.test("orchestrator: test infra on Cronus28 → retry succeeds on Cronus281 (full compile+test re-run)", async () => {
  // Mock provider: compile succeeds on both; test on Cronus28 throws PSSession;
  // test on Cronus281 succeeds. Verify recompile happened on Cronus281 by counting compile calls.
});

// Exhaustion path
Deno.test("orchestrator: both containers infra → synthesized result has trail + exhaustion metadata", async () => {
  // Mock provider: both containers throw PSSession-broken.
  // infraRetriesPerAttempt: 1.
  // Expected: modelResults.get(variantId) is a synthesized infra result with:
  //   - attempts[0].failureReasons[0].startsWith("Infra error:") (prose unchanged)
  //   - attempts[0].infraRetries.length === 1
  //   - attempts[0].infraRetryExhausted === true
  //   - attempts[0].infraRetryExhaustionReason === "budget_exhausted"
});

// Zero-retry exhaustion (single container)
Deno.test("orchestrator: single container + infra failure → synthesized result has exhaustion metadata + empty trail", async () => {
  // configuredContainers: ["Cronus28"], infraRetriesPerAttempt: 1.
  // Expected: attempts[0].infraRetries === [] OR undefined,
  //   attempts[0].infraRetryExhausted === true,
  //   attempts[0].infraRetryExhaustionReason === "no_eligible_containers".
});

// attemptLimit not consumed
Deno.test("orchestrator: infra retry success does NOT consume model attemptLimit", async () => {
  // attemptLimit: 2, infraRetriesPerAttempt: 1.
  // First model attempt's compile infras then succeeds via retry.
  // Verify: only 1 LLM call happened (not 2).
});
```

- [ ] **Step 2: Modify `executeCompilation` to return outcome + wrap only `enqueue`**

```typescript
export interface ExecuteCompilationOutcome {
  compileResult: CompileWorkResult;
  infraRetries: InfraRetryRecord[];
  exhausted: boolean;
  exhaustionReason?: InfraRetryExhaustionReason;
}

private async executeCompilation(
  manifest: TaskManifest,
  variant: ModelVariant,
  context: TaskExecutionContext,
  executionId: string,
  attemptNumber: number,
  llmResult: LLMWorkResult,
  workItemId: string,
): Promise<ExecuteCompilationOutcome> {
  // Build work item ONCE; emit compile_queued ONCE.
  const compileItem: CompileWorkItem = { /* ... existing build ... */ };
  this.emit({ type: "compile_queued", taskId: manifest.id, model: variant.variantId, queuePosition: this.compileQueue?.length ?? 0 });

  try {
    const { result, retries } = await withInfraRetry(
      ({ excludeContainers, onRouted }) => {
        this.emit({ type: "compile_started", taskId: manifest.id, model: variant.variantId });
        return this.compileQueue!.enqueue(compileItem, { excludeContainers, onRouted });
      },
      {
        maxRetries: this.config.infraRetriesPerAttempt ?? 1,
        configuredContainers: this.config.containerNames ?? [primaryContainerName],
        healthMonitor: this.healthMonitor,
        emit: this.emit.bind(this),
        context: { taskId: manifest.id, variantId: variant.variantId, attemptNumber },
      },
    );

    this.emit({
      type: "compile_completed",
      taskId: manifest.id,
      model: variant.variantId,
      success: result.compilationResult.success,
    });

    return { compileResult: result, infraRetries: retries, exhausted: false };
  } catch (err) {
    if (err instanceof InfraRetriesExhaustedError) {
      // Don't propagate as exhausted — let the caller's catch handle the cause.
      // But preserve the trail + reason via attach to the cause for the outer catch.
      throw err;
    }
    throw err;
  }
}
```

- [ ] **Step 3: Modify `processTaskForVariant` to attach metadata to the attempt**

```typescript
try {
  const outcome = await this.executeCompilation(...);
  const attempt = this.createAttempt(attemptNumber, llmResult, outcome.compileResult, context);
  if (outcome.infraRetries.length > 0) attempt.infraRetries = outcome.infraRetries;
  attempts.push(attempt);
  if (attempt.success) { /* ... break ... */ }
} catch (err) {
  if (err instanceof InfraRetriesExhaustedError) {
    // Re-throw — the outer catch in processTask synthesizes the infra result
    // and will read .retries + .reason via the wrapper.
    throw err;
  }
  throw err;
}
```

- [ ] **Step 4: `processTask` catch unwraps `InfraRetriesExhaustedError`**

```typescript
} catch (error) {
  let err = error instanceof Error ? error : new Error(String(error));
  let trailingRetries: InfraRetryRecord[] = [];
  let exhaustionReason: InfraRetryExhaustionReason | undefined;
  if (err instanceof InfraRetriesExhaustedError) {
    trailingRetries = err.retries;
    exhaustionReason = err.reason;
    err = err.cause;
  }
  // ... existing classification + dashboard emit ...
  if (isInfraError(err)) {
    try {
      const context = await this.buildContext(manifest, variant, options);
      const synth = synthesizeInfraFailureResult({
        manifestId: manifest.id,
        context: context as unknown as SynthContext,
        error: err,
        classification: cls,
        startTime: new Date(),
        infraRetries: trailingRetries,
        infraRetryExhausted: trailingRetries.length > 0 || exhaustionReason !== undefined,
        infraRetryExhaustionReason: exhaustionReason,
      });
      modelResults.set(variant.variantId, synth);
      this.emit({ type: "result", result: synth });
    } catch (synthErr) { /* ... existing fallthrough ... */ }
  }
}
```

- [ ] **Step 5: Modify `synthesizeInfraFailureResult` to accept retry metadata**

```typescript
interface SynthInput {
  // ... existing fields ...
  infraRetries?: InfraRetryRecord[];
  infraRetryExhausted?: boolean;
  infraRetryExhaustionReason?: InfraRetryExhaustionReason;
}

// in body, when constructing the attempt:
const attempt: ExecutionAttempt = {
  // ... existing fields ...
};
if (input.infraRetries && input.infraRetries.length > 0) attempt.infraRetries = input.infraRetries;
if (input.infraRetryExhausted) attempt.infraRetryExhausted = true;
if (input.infraRetryExhaustionReason) attempt.infraRetryExhaustionReason = input.infraRetryExhaustionReason;
```

Prose `failureReasons[]` block is UNCHANGED (Phase A's downstream parsers untouched).

- [ ] **Step 6: All existing orchestrator/terminal-record tests pass** (no regression in default path).

- [ ] **Step 7: Commit**

```bash
git add src/parallel/orchestrator.ts src/health/terminal-record.ts tests/unit
git commit -m "feat(orchestrator): wire withInfraRetry into compile/test work-item layer"
```

---

### Task 5: Single-container startup warning + config plumbing

**Files:**
- Modify: `cli/commands/bench/parallel-executor.ts`
- Test: `tests/unit/cli/commands/bench/parallel-executor.test.ts` (extend)

- [ ] **Step 1: Failing test.** With `containerNames: ["Cronus28"]` and resolved `bench.infraRetriesPerAttempt: 1`, `parallel-executor` startup logs a warning. Test asserts log output via captured `log.warn` mock.

- [ ] **Step 2: Implement**

```typescript
if (containerNames.length === 1 && (resolvedConfig.bench.infraRetriesPerAttempt ?? 1) > 0) {
  log.warn(
    `[InfraRetry] Single container configured — inline retry has no fallback. ` +
      `Add more containers via --containers or set bench.infraRetriesPerAttempt: 0 to silence this.`,
  );
}
```

- [ ] **Step 3: Pass `infraRetriesPerAttempt` from resolved config into `ParallelBenchmarkOptions`.**

- [ ] **Step 4: Commit**

```bash
git add cli/commands/bench/parallel-executor.ts tests/unit/cli/commands/bench/parallel-executor.test.ts
git commit -m "feat(infra-retry): startup warning + config plumbing for single-container deployments"
```

---

### Task 6: Score-file `# Infra Retries` block

**Files:**
- Modify: `cli/commands/bench/results-writer.ts`
- Test: `tests/unit/cli/commands/bench/results-writer.test.ts`

- [ ] **Step 1: Failing test.** Aggregator with:
  - 1 attempt with `infraRetries.length === 1`, outcome `succeeded` (recovered).
  - 1 attempt with `infraRetries.length === 1`, outcome `infra_again`, `infraRetryExhausted: true`, reason `budget_exhausted` (exhausted-with-trail).
  - 1 attempt with `infraRetries: undefined`, `infraRetryExhausted: true`, reason `no_eligible_containers` (zero-retry exhaustion).
  - 1 attempt with no retry metadata (normal pass).

  Expected score-file `# Infra Retries` block:

```
# Infra Retries
flagged: 3
recovered: 1
exhausted: 2
  budget_exhausted: 1
  no_eligible_containers: 1
by_route:
  Cronus28 → Cronus281: recovered (123ms)
  Cronus281 → Cronus282: exhausted (456ms)
  Cronus28 → (no eligible container): exhausted
```

(Exact whitespace not asserted; key fields are.)

- [ ] **Step 2: Implement.** Walk attempts:

```typescript
type RetryRow = { flagged: number; recovered: number; exhausted: number; reasons: Record<InfraRetryExhaustionReason, number>; routes: string[] };

function buildRetryRow(results: TaskExecutionResult[]): RetryRow | null {
  const row: RetryRow = { flagged: 0, recovered: 0, exhausted: 0, reasons: {} as any, routes: [] };
  for (const r of results) {
    for (const a of r.attempts) {
      const hasTrail = (a.infraRetries?.length ?? 0) > 0;
      const isExhausted = a.infraRetryExhausted === true;
      if (!hasTrail && !isExhausted) continue;
      row.flagged++;
      if (isExhausted) {
        row.exhausted++;
        const reason = a.infraRetryExhaustionReason ?? "budget_exhausted";
        row.reasons[reason] = (row.reasons[reason] ?? 0) + 1;
      } else {
        row.recovered++;
      }
      // Build by_route lines from the trail
      const last = a.infraRetries?.[a.infraRetries.length - 1];
      if (last) {
        const target = isExhausted ? "(no eligible container)" : last.retryContainerName;
        row.routes.push(`${last.originalContainerName} → ${target}: ${isExhausted ? "exhausted" : "recovered"} (${last.durationMs}ms)`);
      } else if (isExhausted) {
        row.routes.push(`(zero-retry exhaustion: ${a.infraRetryExhaustionReason})`);
      }
    }
  }
  return row.flagged === 0 ? null : row;
}
```

- [ ] **Step 3: `results.json` already serializes new attempt fields** — verify schema test.

- [ ] **Step 4: Commit**

```bash
git add cli/commands/bench/results-writer.ts tests/unit/cli/commands/bench/results-writer.test.ts
git commit -m "feat(bench): emit # Infra Retries summary including zero-retry exhaustions"
```

---

### Task 7: Dashboard SSE + badge

**Files:**
- Modify: `cli/dashboard/types.ts`, `cli/dashboard/bridge.ts`, `cli/dashboard/page.ts`
- Test: `tests/unit/cli/dashboard/bridge.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
Deno.test("bridge: infra_retry_started → emits inline-infra-retry SSE with phase=started, no retryContainerName", () => {});
Deno.test("bridge: infra_retry_succeeded → SSE with phase=succeeded, retryContainerName populated", () => {});
Deno.test("bridge: infra_retry_exhausted with zero prior started events still emits exhausted SSE", () => {
  // Single-container short-circuit case: exhausted fires without prior started.
});
```

- [ ] **Step 2: Add SSE event variant**

```typescript
| {
    type: "inline-infra-retry";
    phase: "started" | "succeeded" | "failed" | "exhausted";
    taskId: string;
    variantId: string;
    attemptNumber: number;
    retryNumber?: number; // absent for zero-retry exhaustion
    originalContainerName?: string;
    retryContainerName?: string; // absent during "started"
    fingerprint?: string;
    signatureLabel?: string;
    durationMs?: number;
    reason?: InfraRetryExhaustionReason; // for "exhausted"
  }
```

- [ ] **Step 3: Page JS.** Task row shows `↻N` badge during `started` phase, tooltip shows `original → ?`. On `succeeded`, tooltip updates to `original → retry`. On `exhausted`, red toast with signature label + reason. Badge cleared on terminal events.

- [ ] **Step 4: Commit**

```bash
git add cli/dashboard tests/unit/cli/dashboard
git commit -m "feat(dashboard): live badge + toast for inline infra retries"
```

---

### Task 8: Smoke + docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Memo in `CLAUDE.md`**

```
- Container infra failures (SYSLIB0014, OOM, publish timeout, PSSession loss,
  container offline) are AUTOMATICALLY retried inline on a different healthy
  container during the same model attempt. Budget: `bench.infraRetriesPerAttempt`
  in `.centralgauge.yml` (default 1). Disable with `CENTRALGAUGE_BENCH_INFRA_RETRY=0`.
  - Model's `attemptLimit` (default 2) is NOT consumed by infra retries.
  - Original failing container is excluded from the retry route.
  - `ContainerHealthMonitor` ACTIVE alerts widen the exclusion automatically.
  - Single-container deployments short-circuit with a startup warning.
  - When retries exhaust: existing `synthesizeInfraFailureResult` path fires;
    `attempts[0].infraRetries[]` carries the trail and
    `attempts[0].infraRetryExhaustionReason` records WHY (budget_exhausted /
    no_eligible_containers / global_outage / unknown_failed_container).
  - Score file `# Infra Retries` block summarizes per-run stats including
    zero-retry exhaustions. Dashboard shows ↻N badges live.
```

- [ ] **Step 2: Full suite green**

```bash
deno task test:unit > /tmp/cg-test-infra-retry.log 2>&1
tail -10 /tmp/cg-test-infra-retry.log
```

- [ ] **Step 3: Manual smoke**

2-container bench (Cronus28, Cronus281). Stop BC service on Cronus28 partway through. Run a small task set. Verify:
- Dashboard shows ↻ badges as work redirects.
- Final score file has `# Infra Retries` block with `recovered > 0`.
- `results.json` `attempts[i].infraRetries[]` populated with REAL container names (no `(pending)`).
- No tuples have `failureReasons[0].startsWith("Infra error:")` UNLESS both containers genuinely down.
- Restart Cronus28 → second bench has 0 retries.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): note inline infra-retry behavior + config (v3.1)"
```

---

## Self-review checklist

**Spec coverage:**

- Inline retry on infra failure → Tasks 3, 4.
- Different container on retry → Task 2 (`excludeContainers`) + Task 3 (exclusion accumulation).
- Health-monitor integration at retry decision → Task 3 (`collectHealthExclusions`, active alerts only).
- One retry max per attempt by default → Task 1 config; Task 3 budget enforcement.
- Model attempt budget untouched → Task 4 integration tests.
- Actual routed container in trail (not `(pending)`) → Task 2 (`onRouted`), Task 3 (consumed into record).
- Zero-retry exhaustions visible → Task 1 attempt metadata; Task 6 counter.
- `maxRetries: 0` identical to no helper → Task 3 fast path.
- Non-infra mid-retry finalized + propagated → Task 3.
- `NoEligibleContainersError` preserves real infra cause → Task 3.
- Global outage at retry decision → Task 3.
- Single-container short-circuit + warning → Task 3 + Task 5.
- Score-file + machine-readable visibility → Task 6.
- Dashboard live badge → Task 7.

**Type consistency:** `InfraRetryRecord`, `InfraRetryOutcome`, `InfraRetryExhaustionReason` declared once in `src/tasks/interfaces.ts`. Referenced from `src/parallel/types.ts`, `src/parallel/errors.ts`, `src/parallel/infra-retry.ts`, `src/health/terminal-record.ts`, `cli/commands/bench/results-writer.ts`, `cli/dashboard/types.ts`. Import direction always domain → executor.

**Out-of-scope creep:** Cross-bench memory, auto-quarantine, compile/test split, token-bucket pacing — all deferred.

---

## Design tradeoffs (record for posterity)

**Why inline instead of post-loop?** Three operator outcomes the post-loop pass couldn't deliver: (1) fast recovery — failed tuples unblock seconds after the failure, not at end of run, so downstream tasks for the same model get a healthy fleet sooner. (2) Identity simplicity — no `executionId`-preservation dance, no aggregator merge, no manifest registry, no per-run pass position. (3) Hot-path proximity — the retry decision happens where the error is born.

**Why are infra retries separate from `attemptLimit`?** The model deserves a fair shake. Charging infrastructure failure against the model's budget penalizes it for our problems. Infra retry = "same attempt, different machine" — a do-over on the SAME prompt with the SAME generated code, on a different physical host.

**Why retry compile+test atomically instead of test-only?** `CompileQueue.enqueue` runs compile and then test on the same container as one work item (compile-queue.ts:663). Splitting them so a test-only infra preserves the prior compile artifact requires cross-container artifact transfer (app + symbols + test app state + cleanup) — a much bigger feature. Phase D candidate. v1 accepts the re-compile cost (~10s on ~5min test = small relative overhead).

**Why are zero-retry exhaustions still recorded?** A single-container deployment that infras has no retry to attempt, but operators still need to know the bench attempted recovery and gave up. Score-file would silently report 0 retries otherwise, masking the bench's degraded state. Two metadata fields (`infraRetryExhausted`, `infraRetryExhaustionReason`) close the gap without inventing fake retry records.

**Why preserve the real infra error as `cause` when `NoEligibleContainersError` is thrown?** The orchestrator's `processTask` catch already checks `isInfraError(err)` to decide whether to synthesize a result row. `NoEligibleContainersError` is operational, not infrastructure — `isInfraError` returns false for it. If we set `.cause = NoEligibleContainersError`, the synthesizer would never run and the variant would lose its result row entirely. Preserving the last real infra as `.cause` keeps the existing synthesis pathway working.

**Why `onRouted` callback instead of returning the route from `enqueue`?** The route is known BEFORE the work runs (at routing decision time), but the work's completion happens AFTER. If we waited for `enqueue` to return, retries that succeed would have to wait for the success result before annotating the trail — fine but awkward. Callback fires inline at routing decision, so the trail is annotated even when the call throws.

**Why health monitor consulted only at retry-decision time, not at original-call time?** Original calls go through the existing pool routing, which doesn't currently honor active alerts. Changing original routing to avoid alerted containers is a separate optimization (Phase D candidate). Honoring alerts at retry time is the minimum necessary to make retries useful.

**Why default `infraRetriesPerAttempt: 1` instead of 2 or 0?** 1 covers the dominant case (single transient infra failure on one container) without burning fleet capacity on lost causes. 0 reverts to today's behavior. 2 or higher mostly helps in real fleet-wide degradation where retries are unlikely to help anyway. Operators can tune up if they have data justifying it.

**Why anti-stampede via random jitter, not a token bucket?** Bench parallelism is typically low (4-8 tuples in flight). 10-50ms jitter breaks simultaneity without the complexity of per-container token accounting. If real stampedes become routine, Phase D can swap in a token bucket per healthy container.

**Why does `synthesizeInfraFailureResult` keep the prose `failureReasons` format?** Phase A's downstream parsers (`identifyInfraFailures`-style tools, eyeball scoring, scripts) parse the prose. Changing the format breaks them for zero correctness gain. New structured data goes into new fields on the attempt.

**What we'd reconsider for Phase D:**

- Splitting compile and test into separate retryable work items (saves the recompile cost on test-only infras).
- Routing original calls (not just retries) to avoid alerted containers.
- Cross-bench retry memory (Phase C-7).
- Token bucket per healthy container.
- A "retry-eligible bench" CLI flag that auto-raises `infraRetriesPerAttempt` to `containerCount - 1` for fleet-probing runs.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-05-13-automatic-infra-retry.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
2. **Inline Execution** — batch with checkpoints.

Estimate: 8 tasks, ~600-900 LOC, ~30-35 unit tests. 3-4 hours wall-clock with subagent-driven flow.
