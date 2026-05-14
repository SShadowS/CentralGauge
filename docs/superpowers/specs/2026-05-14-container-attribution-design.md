# Container Attribution Design

**Status:** Draft (v2, post external review)  
**Date:** 2026-05-14  
**Owner:** sshadows  
**External review:** gpt-5.5-pro, 2026-05-14

## Problem

In multi-container parallel bench runs, the dashboard's per-container health card (top-left widget rendered by `cli/dashboard/page.ts:924`) only shows the container passed via `--container` (default `Cronus28`), even when six containers actively run work. The right-side "Containers" panel (`renderPoolSnapshot`, `page.ts:855`) correctly lists all six because it reads the live `CompileQueuePool` snapshot. The two surfaces disagree.

The same misattribution silently affects:

- the score file `# Container Health` block emitted by `cli/commands/bench/results-writer.ts:260-279`,
- any future reader that consumes `result.context.containerName` as ground truth for "which container ran this".

`InfraRetryRecord.retryContainerName` is **correct** today. It is populated via the `onRouted` dispatcher callback. Per-retry routing is captured. Per-attempt health attribution is the gap.

## Root Cause

`TaskExecutionContext.containerName` is set once at task-context creation from `options.containerName` (the single `--container` CLI value). The orchestrator's `createExecutionContext` (`src/parallel/orchestrator.ts:807`) treats it as a constant. In multi-container mode the orchestrator builds a `CompileQueuePool` over `containerNames[]` and routes each work-item to whichever queue is free, but the context never updates. Two propagation gaps make the routed container invisible:

1. **`CompileWorkResult` carries no `containerName`.** `CompileQueue` owns `this.containerName` (`src/parallel/compile-queue.ts:213`) and knows exactly which container ran the work, but the result type omits the field, so the actual container is lost when the result returns up the call stack.

2. **`ExecutionAttempt` carries no `containerName`.** `ParallelOrchestrator.createAttempt` (`src/parallel/orchestrator.ts:828`) has no source for the routed container even if the compile result carried one, and the attempt record has no field to hold it.

Downstream readers reach for `result.context.containerName` because it is the only string available. The bridge then records every outcome against that same single container, so `ContainerHealthMonitor` never sees the other five.

A separate, related gap: `withInfraRetry` (`src/parallel/infra-retry.ts`) emits only `infra_retry_*` events. It does NOT emit a normal `error` event for the original infra failure. The bridge's retry handlers (`bridge.ts:399-499`) only broadcast SSE; they never call `recordContainerOutcome`. Result: recovered infra failures are invisible to the health monitor today, even before the attribution fix.

## Goals

- All outcome readers attribute pass/fail/infra_error to the container that **actually ran** the work.
- Per-attempt routing is preserved.
- Recovered inline infra failures show up in the health monitor against the original failing container.
- The bench dashboard's per-container health card pre-seeds rows for every configured container so it agrees with the queue-pool snapshot from run start, not after first outcomes.
- Type model matches reality: facts about a finished attempt live on the attempt, not on the immutable, pre-routing context.

## Non-Goals

- Removing `context.containerName` entirely. The field stays for routing hints, single-container fallback paths, and the agent/sandbox executor paths that legitimately operate on a fixed container. JSDoc marks it deprecated for **attribution reads only**.
- Per-container cost attribution (separate problem).
- Changing `CompileQueuePool` routing policy.
- Auto-quarantine of misbehaving containers (Phase B).
- Repairing attribution in historical result JSON. New runs only.

## Design

### Type changes

```ts
// src/parallel/types.ts
export interface CompileWorkResult {
  workItemId: string;
  containerName: string;            // NEW: required
  compilationResult: CompilationResult;
  testResult?: TestResult;
  duration: number;
  compileDuration: number;
}

// src/tasks/interfaces.ts
export interface ExecutionAttempt {
  // ... existing fields unchanged
  /**
   * Container that performed, or was selected to perform, this attempt's
   * container-backed work (compile + test, or compile-only for compile
   * failures). Set from `CompileWorkResult.containerName` for normal attempts,
   * from `ContainerError.containerName` for synthesized infra-failure
   * attempts. Undefined when no container-backed phase was reached (LLM-only
   * failure, prompt extraction error) or when the failed container is
   * genuinely unknown. For retries this is the container of the final (retry)
   * execution; the per-retry trail lives in `infraRetries[].retryContainerName`.
   */
  containerName?: string;           // NEW: optional
}

export interface TaskExecutionContext {
  // ... existing fields
  /**
   * @deprecated for outcome attribution. This is a routing hint/default set
   * once at context creation from `--container` and never updated when a
   * queue pool routes work to a different container. For attribution, read
   * `attempt.containerName` instead. Legitimate uses: single-container
   * routing, agent/sandbox executor paths, executor-v2 default container.
   */
  containerName: string;
}

// src/health/types.ts
export interface MonitorOptions {
  // ... existing fields
  /**
   * Configured container names from `--containers`. When provided, the
   * monitor seeds zero-count `ContainerHealth` rows for each name on
   * construction so the dashboard health card lists all configured
   * containers from run start, not after their first outcome. The
   * existing `expectedContainers` (count) stays for the global-outage
   * denominator.
   */
  expectedContainerNames?: string[];   // NEW: optional
}
```

### Population path

```
CompileQueue.execute(workItem)
  -> result.containerName = this.containerName

CompileQueuePool.execute(workItem)
  -> delegates to a selected CompileQueue, returns its CompileWorkResult
     (already stamped, no extra work)

ParallelOrchestrator.createAttempt(llmResult, compileResult, context)
  -> attempt.containerName = compileResult.containerName

synthesizeInfraFailureResult(err, context, ...) [src/health/terminal-record.ts]
  -> if (err instanceof ContainerError) attempt.containerName = err.containerName
     else attempt.containerName = undefined  // do NOT fall back to context

Bridge.onResult(result)
  -> for each attempt:
       if didContainerWork(attempt):           // see helper below
         state.recordContainerOutcome({
           containerName: attempt.containerName ?? context.containerName,
           result: deriveAttemptOutcome(attempt),
           ...
         })
       // else: LLM-only failure, skip

Bridge.onInfraRetryStarted(event)
  -> state.recordContainerOutcome({
       containerName: event.originalContainerName,
       result: "infra_error",
       fingerprint: event.fingerprint,
       signatureLabel: event.signatureLabel,
       timestamp: Date.now(),
     })
  -> broadcast inline-infra-retry SSE (existing behaviour)

Bridge.onInfraRetryFailed(event) when event.outcome === "infra_again"
  -> NOT recorded directly. The next `infra_retry_started` (if any) records
     the new originalContainerName. Exhaustion path goes through the
     existing error-event handler via synthesizeInfraFailureResult.
```

### Attribution helpers

Two helpers, distinct purposes. Do NOT collapse them.

```ts
// src/tasks/attribution.ts (new file)
import type { CompilationResult, TestResult } from "./interfaces.ts";
import type { ExecutionAttempt, TaskExecutionContext } from "./interfaces.ts";

/**
 * True when an attempt reached container-backed work (compile or test).
 * Used by health attribution to skip LLM-only failures.
 */
export function didContainerWork(attempt: ExecutionAttempt): boolean {
  return attempt.compilationResult !== undefined ||
    attempt.testResult !== undefined;
}

/**
 * Actual container that ran this attempt, with NO fallback to context.
 * Returns undefined when no container is known. Use for health attribution
 * and any reader that must not silently misattribute to the routing hint.
 */
export function getActualAttemptContainerName(
  attempt: ExecutionAttempt,
): string | undefined {
  return attempt.containerName;
}

/**
 * Attempt container with legacy fallback to context.containerName. Use ONLY
 * for paths that historically read context.containerName and need to stay
 * working on old result JSON or in single-container mode. Never use in the
 * live bridge health-attribution path.
 */
export function getAttemptContainerNameWithLegacyFallback(
  attempt: ExecutionAttempt,
  context: TaskExecutionContext,
): string {
  return attempt.containerName ?? context.containerName;
}
```

### Pre-seed health rows

`ContainerHealthMonitor` constructor accepts `expectedContainerNames?: string[]`. On construction, seed a zero-count `ContainerHealth` row per name. `record()` continues to upsert; an outcome on an unseeded container still creates a row (no regression for unknown containers). `getState().containers` returns rows in **configured order first**, then any unseeded containers in insertion order, then sorted by name within each group. Score file and dashboard read the same sorted snapshot, so output is deterministic.

The orchestrator passes `expectedContainerNames` from `config.containerNames` (multi-container mode) or `[options.containerName]` (single-container mode).

### Reader migration

| Site | File:line | Before | After |
|---|---|---|---|
| Dashboard health feed (terminal) | `cli/dashboard/bridge.ts:262-281` | one `recordContainerOutcome` per result, attributed to `result.context.containerName` | iterate `result.attempts`, skip via `didContainerWork`, record per attempt with `getActualAttemptContainerName` (no fallback) |
| Dashboard inline infra retry | `cli/dashboard/bridge.ts:405-423` | only broadcasts SSE | also record `infra_error` against `event.originalContainerName` with fingerprint/signatureLabel |
| Terminal health record (synth infra) | `src/health/terminal-record.ts:68-70` | `input.context.containerName ?? "unknown"` for the failure-reason string | unchanged for prose; new: also stamp `attempt.containerName` from `ContainerError.containerName` when available |
| Score file Container Health block | `cli/commands/bench/results-writer.ts:260-279` | reads pre-aggregated `input.containerHealth` from `dashboard.getHealthSnapshot()` (parallel-executor.ts:549) | no direct change; correctness flows from bridge to monitor pipeline; ordering now deterministic via monitor sort |
| Ingest payload | `src/ingest/*` | no per-container attribution today (`grep containerName src/ingest/` empty) | no migration required; revisit when ingest adds per-container fields |
| Agent failure parser | `src/agents/failure-parser.ts:463,507` | uses `options.containerName` (agent path is single-container) | unchanged |
| Executor v2 single-container path | `src/tasks/executor-v2.ts` | uses `context.containerName` for `isHealthy`, publish, etc. | unchanged. Legitimate "routing hint" use. |

Repo-wide audit step at PR review time:

```
rg "result\.context\.containerName|context\.containerName" src cli tests
```

Each match classified as one of:

- routing/config hint (allowed),
- legacy fallback (allowed; must use `getAttemptContainerNameWithLegacyFallback`),
- outcome attribution (must migrate to `getActualAttemptContainerName`).

### Edge cases

- **Compile-only failure (no test phase):** `CompileWorkResult.containerName` populated, `attempt.containerName` set, `didContainerWork` true, attribution works.
- **LLM-only failure (no compile, e.g. prompt extraction error):** `attempt.containerName` undefined, `didContainerWork` false, bridge skips. No misattribution to stale context.
- **Inline infra retry that exhausts:** `synthesizeInfraFailureResult` builds the synthetic result with `attempt.containerName = err.containerName` when err is a `ContainerError`. The error-event path records the outcome correctly. `infra_retry_started` for retries within the chain already recorded the intermediate failures.
- **Inline infra retry that succeeds:** `infra_retry_started` records `infra_error` against `originalContainerName`. Final pass attempt records `pass` against retry container (from `compileResult.containerName`). Monitor sees: 1 infra_error on original, 1 pass on retry container.
- **Inline infra retry with `infra_again` (retry container also infra-failed):** the loop fires another `infra_retry_started` whose `originalContainerName` is the newly failed retry container. That records the new container's `infra_error`. No special handling needed in `onInfraRetryFailed`.
- **`infra_retry_started` followed by no further event (cancel/abort):** edge case, will record one `infra_error` on original. Acceptable.
- **Synthetic infra result with no `ContainerError`:** `attempt.containerName` undefined. Bridge already skips synthesized infra results (first failureReason starts with `"Infra error:"`), so no health record fires from this path. The error-event handler that preceded it (which DOES have container info) is the authoritative recording.

## Semantics changes (must document for users)

1. **Attempt-level health, not result-level.** A task that fails attempt 1 on container A and passes attempt 2 on container B now increments fail on A AND pass on B. Today, only one outcome is recorded per final result. Score file Container Health counts will be larger than before for tasks that retry. Document in the bench docs page.

2. **Window aging.** `ContainerHealthMonitor` rolls fingerprint history on every outcome. Attempt-level recording rolls the window faster, ages out infra fingerprints sooner on busy containers. Persistent-alert sensitivity decreases slightly. Acceptable trade; document.

3. **Old result JSON.** Old serialized results have no `attempt.containerName`. Tools that re-process them via `getActualAttemptContainerName` will get undefined and skip. Tools that need historical attribution must use the legacy-fallback helper. Spec is explicit that historical repair is out of scope.

## Testing Strategy

### Unit tests

1. `tests/unit/parallel/compile-queue.test.ts`: assert `CompileQueue.execute(...)` returns a result whose `containerName` matches the queue's container.
2. `tests/unit/parallel/compile-queue-pool.test.ts`: assert pool-routed results carry the routed container, not always the first container in the array.
3. `tests/unit/parallel/orchestrator.test.ts`: multi-container run, assert `result.attempts[i].containerName` equals the actual queue's name. Use the existing `compileWorkQueueFactory` injection point to stamp known containers deterministically.
4. `tests/unit/tasks/attribution.test.ts`: cover `didContainerWork`, `getActualAttemptContainerName`, `getAttemptContainerNameWithLegacyFallback`. Cases: compile-only attempt, test-completed attempt, LLM-only attempt, undefined attempt.containerName + context set, both set.
5. `tests/unit/dashboard/bridge.test.ts`: new tests.
   - Per-attempt recording: result with attempt-1-fail-on-A + attempt-2-pass-on-B, assert A gets `fail`, B gets `pass`.
   - LLM-only skip: attempt with no compile/test, assert no outcome recorded (no context fallback).
   - Synthesized infra skip: `Infra error:` failureReason, assert no outcome recorded (error-event path does it).
   - Inline retry recording: `onInfraRetryStarted` records `infra_error` against `originalContainerName` with fingerprint.
6. `tests/unit/health/monitor.test.ts`: pre-seed test. Construct monitor with `expectedContainerNames: ["A", "B", "C"]`, assert `getState().containers.length === 3` with zero counts before any `record()` call. Add an outcome on `D`, assert sort order: A, B, C, D.
7. `tests/unit/health/terminal-record.test.ts`: synthesized infra with `ContainerError("A")`, assert `attempt.containerName === "A"`. Synthesized infra with generic Error, assert `attempt.containerName === undefined`.

### Regression test

`tests/unit/parallel/multi-container-attribution.test.ts`: orchestrator with three injected container queues, six tasks routed across them. Wire `orchestrator.on(bridge.handleEvent)`. Assert:

- `dashboardState.getHealthSnapshot().containers` lists all three configured containers from the moment the orchestrator constructs the monitor (pre-seed),
- each container's `passCount + failCount + errorCount` matches the number of attempts routed to it,
- snapshot ordering is deterministic.

### Integration / manual

Restart the failing bench run from the original screenshot (six containers, 440 tasks). Verify at run start:

- top-left container-health grid lists all six containers with zero counts,
- score file written after run has six rows in `# Container Health` block, deterministically ordered.

Force an inline infra retry (manually kill a container mid-run on a non-prod fork). Verify the original failed container shows `errorCount > 0` in the health card and the retry container shows the recovery `pass`.

## Rollout

Single PR, single feature branch. Steps, each gated by `deno task test:unit` green:

1. Add `containerName` to `CompileWorkResult`; populate in `CompileQueue.execute`. Update tests + mocks.
2. Add `containerName` to `ExecutionAttempt`; populate in `ParallelOrchestrator.createAttempt`. Update tests.
3. Add `src/tasks/attribution.ts` (`didContainerWork`, `getActualAttemptContainerName`, `getAttemptContainerNameWithLegacyFallback`) + unit tests.
4. Add `expectedContainerNames` to `MonitorOptions`; seed zero-count rows; sort `getState().containers`. Update health-monitor tests.
5. Orchestrator passes `expectedContainerNames` from `config.containerNames` (or `[options.containerName]` for single-container).
6. Migrate `cli/dashboard/bridge.ts`:
   - replace `onResult` health recording with per-attempt iteration using `didContainerWork` + `getActualAttemptContainerName`,
   - add `recordContainerOutcome` call in `onInfraRetryStarted` for `infra_error` against `originalContainerName`.
   Add bridge unit tests.
7. Migrate `src/health/terminal-record.ts`: stamp `attempt.containerName` from `ContainerError.containerName` when available; do not fall back to context.
8. JSDoc `@deprecated` marker on `TaskExecutionContext.containerName` for attribution reads.
9. Repo-wide audit: `rg "result\.context\.containerName|context\.containerName"` and classify every match.
10. Add regression test `multi-container-attribution.test.ts`.
11. Run `deno task test:unit`, `deno check`, `deno lint`, `deno fmt`.
12. Manual smoke against six-container bench. Verify pre-seed + retry recording.

No feature flag. The change is invariant-preserving for type compatibility (`attempt.containerName` is optional, `expectedContainerNames` is optional). Bridge behaviour DOES change: it now records per attempt and per retry rather than per result. Document in CHANGELOG.

## Out of Scope

- Removing `context.containerName` entirely. Cascades through agent/sandbox executor paths and executor-v2 single-container compile/test logic; tracked separately if ever wanted.
- Per-container cost attribution.
- Changing `CompileQueuePool` routing policy.
- Auto-quarantine of misbehaving containers (Phase B).
- Repairing historical result JSON attribution.

## Open Questions

None outstanding. Decisions made during external review:

- Inline retry health: record in `onInfraRetryStarted` (option 1 of three considered).
- Health card pre-seed: yes, via `expectedContainerNames` on `MonitorOptions`.
- `context.containerName` removal: defer (deprecate only).
