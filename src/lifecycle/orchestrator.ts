/**
 * Cycle orchestrator: resume-aware dispatcher across bench → debug-capture →
 * analyze → publish. The single decision point for skip/retry/run.
 *
 * Lock-token tiebreaker: each `runCycle` invocation generates a UUID
 * `lock_token`, writes `cycle.started{lock_token, ttl_seconds}`, then reads
 * back the most-recent `cycle.started` for `(model_slug, task_set_hash)`
 * without a downstream terminal. The writer whose lock_token survives the
 * read-back is the winner; losers emit `cycle.aborted{reason: 'lost_race'}`
 * and exit 1.
 *
 * TTL: 90 min cycle / 60 min step. When a prior `cycle.started` is older
 * than CYCLE_TTL without a terminal, runCycle emits `cycle.timed_out`
 * before attempting the new lock.
 *
 * @module src/lifecycle/orchestrator
 */

import * as colors from "@std/fmt/colors";
import { appendEvent, queryEvents } from "./event-log.ts";
import { collectEnvelope, collectToolVersions } from "./envelope.ts";
import { computeTaskSetHash } from "../ingest/catalog/task-set-hash.ts";
import { loadIngestConfig, readPrivateKey } from "../ingest/config.ts";
import { runBenchStep } from "./steps/bench-step.ts";
import { runDebugCaptureStep } from "./steps/debug-capture-step.ts";
import { runAnalyzeStep } from "./steps/analyze-step.ts";
import { runPublishStep } from "./steps/publish-step.ts";
import {
  CYCLE_STEPS,
  type CycleOptions,
  type CycleStep,
  type StepContext,
  type StepDecision,
  type StepResult,
} from "./orchestrator-types.ts";
import type { AppendOptions, QueryEventsFilter } from "./event-log.ts";
import type { LifecycleEvent, LifecycleEventType } from "./types.ts";

/** TTL for an in-flight step (started without terminal). */
const STEP_TTL_MS = 60 * 60 * 1000; // 60 min
/** TTL for an in-flight cycle (cycle.started without terminal). */
const CYCLE_TTL_SECONDS = 90 * 60; // 90 min

interface PriorStepEvents {
  /** Most recent terminal pair (completed/captured), if any. */
  completed?: {
    id: number;
    ts: number;
    payload: Record<string, unknown>;
    envelope?: Record<string, unknown> | null;
  };
  failed?: { id: number; ts: number; payload: Record<string, unknown> };
  started?: { id: number; ts: number };
  skipped?: { id: number; ts: number };
}

function envelopeMatches(
  prior: Record<string, unknown> | null | undefined,
  current: Record<string, unknown>,
): boolean {
  if (!prior) return false;
  // The fields below define "envelope identity" for skip-on-success. If any
  // diverges, the step is re-run (settings/tool-version/git-sha sensitivity).
  const fields = [
    "deno",
    "wrangler",
    "claude_code",
    "bc_compiler",
    "git_sha",
    "settings_hash",
  ];
  for (const f of fields) {
    if (
      JSON.stringify((prior as Record<string, unknown>)[f]) !==
        JSON.stringify(current[f])
    ) {
      return false;
    }
  }
  return true;
}

/** Pure decision: given prior events for a step, what should we do now? */
export function decideStep(
  step: CycleStep,
  prior: PriorStepEvents,
  forceRerun: boolean,
  currentEnvelope: Record<string, unknown>,
  now: number = Date.now(),
): StepDecision {
  void step; // step is in the signature for symmetry; current logic is uniform
  if (forceRerun) {
    return { kind: "run", reason: "force_rerun_flag" };
  }
  // Ordering matters: when the most-recent terminal is a failure
  // (`prior.failed.id > prior.completed.id`), the operator's expectation is
  // 'retry' regardless of any older completed run. Pre-I2 this branch
  // checked completed first and silently skipped a step the operator had
  // just seen fail. classifyEvents records the most-recent of each kind
  // independently — comparing ids restores ordering.
  const completedId = prior.completed?.id ?? 0;
  const failedId = prior.failed?.id ?? 0;
  if (prior.failed && failedId > completedId) {
    return {
      kind: "retry",
      reason: "prior_failure",
      priorEventId: prior.failed.id,
    };
  }
  if (prior.completed) {
    if (envelopeMatches(prior.completed.envelope, currentEnvelope)) {
      return {
        kind: "skip",
        reason: "envelope_unchanged",
        priorEventId: prior.completed.id,
      };
    }
    return {
      kind: "run",
      reason: "envelope_changed_since_last_completed",
    };
  }
  if (prior.failed) {
    return {
      kind: "retry",
      reason: "prior_failure",
      priorEventId: prior.failed.id,
    };
  }
  if (prior.started) {
    // Started but never terminated → either in-flight or crashed. Within TTL
    // we skip (avoid clobber); outside TTL we treat the prior worker as dead
    // and retry. Genuine concurrent runs are caught by the cycle.started
    // lock-token tiebreaker upstream of this function.
    const age = now - prior.started.ts;
    if (age > STEP_TTL_MS) {
      return {
        kind: "retry",
        reason: "started_event_ttl_expired",
        priorEventId: prior.started.id,
      };
    }
    return {
      kind: "skip",
      reason: "started_within_ttl",
      priorEventId: prior.started.id,
    };
  }
  return { kind: "run", reason: "no_prior_events" };
}

function classifyEvents(
  step: CycleStep,
  events: LifecycleEvent[],
): PriorStepEvents {
  // Map step → prefix used by event_type.
  const prefix = step === "debug-capture"
    ? "debug"
    : step === "analyze"
    ? "analysis"
    : step; // 'bench' or 'publish'
  const out: PriorStepEvents = {};
  // Walk in reverse (events come oldest-first from the worker; we want newest
  // first for "most recent of each kind").
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (!e.event_type.startsWith(`${prefix}.`)) continue;
    const suffix = e.event_type.slice(prefix.length + 1);
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    const env = e.envelope ?? null;
    const id = e.id ?? 0;
    if (suffix === "completed" || suffix === "captured") {
      out.completed ??= {
        id,
        ts: e.ts,
        payload,
        envelope: env as Record<string, unknown> | null,
      };
    } else if (suffix === "failed") {
      out.failed ??= { id, ts: e.ts, payload };
    } else if (suffix === "started") {
      out.started ??= { id, ts: e.ts };
    } else if (suffix === "skipped") {
      out.skipped ??= { id, ts: e.ts };
    }
  }
  return out;
}

/** Lock-token tiebreaker per the Phase C rationale box. */
async function acquireLock(
  modelSlug: string,
  taskSetHash: string,
  envelope: Record<string, unknown>,
  toolVersions: Record<string, unknown>,
  fromStep: CycleStep,
  toStep: CycleStep,
  forceRerun: CycleStep[],
  actorId: string | null,
  ingestOpts: AppendOptions,
): Promise<{ lockToken: string; cycleStartedEventId: number }> {
  const lockToken = crypto.randomUUID();
  const startedEvent = await appendEvent({
    ts: Date.now(),
    model_slug: modelSlug,
    task_set_hash: taskSetHash,
    event_type: "cycle.started",
    tool_versions: toolVersions,
    envelope,
    payload: {
      from_step: fromStep,
      to_step: toStep,
      force_rerun_steps: forceRerun,
      lock_token: lockToken,
      ttl_seconds: CYCLE_TTL_SECONDS,
    },
    actor: "operator",
    actor_id: actorId,
  }, ingestOpts);

  // Read back the most-recent active cycle.started for (model, task_set).
  // A `cycle.started` is *active* iff no `cycle.{completed,failed,aborted,
  // timed_out}` event with id > started.id exists. The most-recent active
  // one wins; losers emit cycle.aborted{reason:'lost_race'} and exit.
  const recent = await queryEvents({
    model_slug: modelSlug,
    task_set_hash: taskSetHash,
    event_type_prefix: "cycle.",
    limit: 50,
  }, ingestOpts);

  // Walk newest-first.
  let winner: { id: number; lockToken: string | null } | null = null;
  for (let i = recent.length - 1; i >= 0; i--) {
    const e = recent[i]!;
    if (e.event_type !== "cycle.started") continue;
    const id = e.id ?? 0;
    const hasTerminalAfter = recent.some(
      (x) =>
        (x.id ?? 0) > id &&
        /^cycle\.(completed|failed|aborted|timed_out)$/.test(x.event_type),
    );
    if (hasTerminalAfter) continue;
    const payload = (e.payload ?? {}) as { lock_token?: string };
    winner = { id, lockToken: payload.lock_token ?? null };
    break;
  }

  if (!winner || winner.lockToken !== lockToken) {
    await appendEvent({
      ts: Date.now(),
      model_slug: modelSlug,
      task_set_hash: taskSetHash,
      event_type: "cycle.aborted",
      tool_versions: toolVersions,
      envelope,
      payload: {
        prior_event_id: startedEvent.id,
        reason: "lost_race",
        actor_id: actorId,
        winner_lock_token: winner?.lockToken ?? null,
      },
      actor: "operator",
      actor_id: actorId,
    }, ingestOpts);
    throw new Error(
      `cycle: lost lock race for ${modelSlug} (winner token: ${
        winner?.lockToken ?? "unknown"
      })`,
    );
  }
  return { lockToken, cycleStartedEventId: startedEvent.id };
}

/**
 * Built-in step dispatcher. Exhaustive at compile time, with a defensive
 * `default:` branch that throws on a future `CycleStep` union expansion
 * that didn't update this switch. Without it the missing case would
 * silently return `undefined`; downstream `.payload` reads would then
 * throw a confusing TypeError far from the root cause.
 *
 * Exported for the canonicity smoke test in
 * `tests/unit/lifecycle/orchestrator.test.ts` — production callers use
 * the module-level `dispatcher` indirection.
 */
export async function defaultDispatchStep(
  step: CycleStep,
  ctx: StepContext,
): Promise<StepResult> {
  switch (step) {
    case "bench":
      return await runBenchStep(ctx);
    case "debug-capture":
      return await runDebugCaptureStep(ctx);
    case "analyze":
      return await runAnalyzeStep(ctx);
    case "publish":
      return await runPublishStep(ctx);
    default: {
      // Compile-time exhaustiveness witness. If a new CycleStep is added
      // and forgotten here, the cast below becomes a type error and this
      // line stops compiling — forcing the developer to update the switch.
      const _exhaustive: never = step;
      void _exhaustive;
      throw new Error(`unhandled step ${String(step)}`);
    }
  }
}

/**
 * Override the default step dispatcher. Test-only — production code MUST
 * use the default dispatcher. The integration suite injects a mock so it
 * can avoid spawning real `centralgauge bench` / `verify` subprocesses.
 */
export type StepDispatcher = (
  step: CycleStep,
  ctx: StepContext,
) => Promise<StepResult>;

let dispatcher: StepDispatcher = defaultDispatchStep;

export function setStepDispatcher(d: StepDispatcher | null): void {
  dispatcher = d ?? defaultDispatchStep;
}

function stepsBetween(from: CycleStep, to: CycleStep): CycleStep[] {
  const fromIdx = CYCLE_STEPS.indexOf(from);
  const toIdx = CYCLE_STEPS.indexOf(to);
  if (fromIdx === -1 || toIdx === -1 || toIdx < fromIdx) {
    throw new Error(`invalid step range: from=${from} to=${to}`);
  }
  return CYCLE_STEPS.slice(fromIdx, toIdx + 1);
}

/**
 * Synthesize a canonical event type for `(step, kind)`.
 *
 * Exported for the canonicity smoke test in `tests/unit/lifecycle/
 * orchestrator.test.ts`, which iterates every (step, kind) pair and asserts
 * the result is a member of `CANONICAL_EVENT_TYPES`. Production callers
 * remain only the orchestrator itself.
 */
export function stepEventName(
  step: CycleStep,
  kind: string,
): LifecycleEventType {
  if (step === "debug-capture") {
    return (kind === "completed"
      ? "debug.captured"
      : `debug.${kind}`) as LifecycleEventType;
  }
  if (step === "analyze") return `analysis.${kind}` as LifecycleEventType;
  return `${step}.${kind}` as LifecycleEventType;
}

/**
 * Look for an in-flight `cycle.started` older than CYCLE_TTL_SECONDS without a
 * terminal. When found, emit `cycle.timed_out` so a subsequent `acquireLock`
 * isn't blocked by the stale started event.
 */
async function detectAndEmitTimeout(
  modelSlug: string,
  taskSetHash: string,
  envelope: Record<string, unknown>,
  toolVersions: Record<string, unknown>,
  actorId: string | null,
  ingestOpts: AppendOptions,
): Promise<boolean> {
  const recent = await queryEvents({
    model_slug: modelSlug,
    task_set_hash: taskSetHash,
    event_type_prefix: "cycle.",
    limit: 50,
  }, ingestOpts);
  // Walk newest-first.
  let lastStarted: LifecycleEvent | undefined;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i]!.event_type === "cycle.started") {
      lastStarted = recent[i];
      break;
    }
  }
  if (!lastStarted) return false;
  const lastStartedId = lastStarted.id ?? 0;
  // Has any terminal id > lastStarted.id?
  const hasTerminalAfter = recent.some(
    (x) =>
      (x.id ?? 0) > lastStartedId &&
      /^cycle\.(completed|failed|aborted|timed_out)$/.test(x.event_type),
  );
  if (hasTerminalAfter) return false;
  if (Date.now() - lastStarted.ts <= CYCLE_TTL_SECONDS * 1000) return false;

  // The most recent step-level event that ran under this started is the
  // "last_progress_event_type" — find the latest event with id < lastStarted.id
  // OR a *.completed/captured event. We look at events overall, not just
  // cycle.* — re-query.
  const all = await queryEvents({
    model_slug: modelSlug,
    task_set_hash: taskSetHash,
    limit: 100,
  }, ingestOpts);
  let lastProgress: LifecycleEvent | undefined;
  for (let i = all.length - 1; i >= 0; i--) {
    const e = all[i]!;
    if ((e.id ?? 0) <= lastStartedId) break;
    if (
      e.event_type.endsWith(".completed") ||
      e.event_type.endsWith(".captured")
    ) {
      lastProgress = e;
      break;
    }
  }
  await appendEvent({
    ts: Date.now(),
    model_slug: modelSlug,
    task_set_hash: taskSetHash,
    event_type: "cycle.timed_out",
    tool_versions: toolVersions,
    envelope,
    payload: {
      prior_event_id: lastStartedId,
      ttl_seconds: CYCLE_TTL_SECONDS,
      last_progress_event_type: lastProgress?.event_type ?? null,
    },
    actor: "operator",
    actor_id: actorId,
  }, ingestOpts);
  console.log(
    colors.yellow(
      `[INFO] prior cycle.started id=${lastStartedId} exceeded TTL — emitted cycle.timed_out`,
    ),
  );
  return true;
}

export async function runCycle(opts: CycleOptions): Promise<void> {
  const cwd = Deno.cwd();
  const envelope = await collectEnvelope({}) as Record<string, unknown>;
  const toolVersions = await collectToolVersions() as Record<string, unknown>;
  // Merge tool-version fields into the envelope so envelopeMatches can compare
  // in one shape (mirrors the strategic plan's "envelope identity" set).
  const fullEnvelope: Record<string, unknown> = {
    ...toolVersions,
    ...envelope,
  };

  // Lifecycle event writes require ADMIN scope. The ingest verifier key is
  // not sufficient — fail fast if admin_key_path isn't configured.
  const config = await loadIngestConfig(cwd, {});
  if (!config.adminKeyPath || config.adminKeyId == null) {
    throw new Error(
      "admin_key_path required for cycle command — configure ~/.centralgauge.yml",
    );
  }
  const privateKey = await readPrivateKey(config.adminKeyPath);
  const ingestOpts: AppendOptions = {
    url: config.url,
    privateKey,
    keyId: config.adminKeyId,
  };
  const actorId = config.machineId ?? null;

  for (const modelSlug of opts.llms) {
    let taskSetHash: string;
    if (opts.taskSet === "current") {
      try {
        taskSetHash = await computeTaskSetHash(`${cwd}/tasks`);
      } catch {
        // No tasks/ dir (e.g. inside an integration-test temp dir) — fall
        // back to the literal sentinel so events are still attributable.
        taskSetHash = "current";
      }
    } else {
      taskSetHash = opts.taskSet;
    }

    // Force-unlock path is one-shot per model: write cycle.aborted, return.
    if (opts.forceUnlock) {
      if (!opts.yes) {
        console.error(
          colors.red(
            `[ERROR] --force-unlock requires --yes (it will abort an apparently-active cycle for ${modelSlug})`,
          ),
        );
        Deno.exit(2);
      }
      await appendEvent({
        ts: Date.now(),
        model_slug: modelSlug,
        task_set_hash: taskSetHash,
        event_type: "cycle.aborted",
        tool_versions: toolVersions,
        envelope: fullEnvelope,
        payload: {
          reason: "manual_unlock",
          actor_id: actorId,
        },
        actor: "operator",
        actor_id: actorId,
      }, ingestOpts);
      console.log(
        colors.green(`[OK] cycle.aborted (manual_unlock) for ${modelSlug}`),
      );
      continue;
    }

    console.log(
      colors.cyan(
        `\n=== cycle ${modelSlug} @ task_set=${taskSetHash} (${opts.fromStep} → ${opts.toStep}) ===`,
      ),
    );

    // 1. TTL detection — emit cycle.timed_out for any stale cycle.started
    // before attempting to acquire a fresh lock.
    if (!opts.dryRun) {
      await detectAndEmitTimeout(
        modelSlug,
        taskSetHash,
        fullEnvelope,
        toolVersions,
        actorId,
        ingestOpts,
      );
    }

    // 2. Lock acquisition (skipped on dry-run — no writes).
    let lockToken = "dry-run-token";
    let cycleStartedEventId = 0;
    if (!opts.dryRun) {
      const lock = await acquireLock(
        modelSlug,
        taskSetHash,
        fullEnvelope,
        toolVersions,
        opts.fromStep,
        opts.toStep,
        opts.forceRerun,
        actorId,
        ingestOpts,
      );
      lockToken = lock.lockToken;
      cycleStartedEventId = lock.cycleStartedEventId;
    }

    // 3. Per-step decision + dispatch.
    const stepsToConsider = stepsBetween(opts.fromStep, opts.toStep);
    const ctx: StepContext = {
      modelSlug,
      taskSetHash,
      lockToken,
      envelope: fullEnvelope,
      toolVersions,
      analyzerModel: opts.analyzerModel,
      dryRun: opts.dryRun,
      cwd,
    };
    const stepsRun: CycleStep[] = [];
    const stepsSkipped: CycleStep[] = [];
    let cycleFailed = false;
    let failedStep: CycleStep | null = null;
    let lastFailureMessage = "";
    let lastFailureCode = "step_failed";

    // Cache the analyze step's payload_hash so the publish step can detect
    // unchanged payloads and emit publish.skipped without round-tripping the
    // batch endpoint. `priorPublishEventId` is the most-recent
    // `publish.completed` event id (looked up at publish-dispatch time so we
    // capture events emitted earlier in this same cycle as well).
    let priorAnalysisPayloadHash: string | undefined;
    let priorPublishEventId: number | undefined;

    /**
     * The per-step loop's `appendEvent` calls (Wave 1 admin endpoint) can
     * fail — D1 500, network blip, the Wave 3 / C1 canonicalization gap
     * before it lands. If that happens here, the lock-token tiebreaker
     * upstream of `runCycle` would treat the surviving `cycle.started` as
     * winner-active for 90 minutes (CYCLE_TTL_SECONDS), wedging the
     * (model, task_set) until manual `--force-unlock`. Wrap the loop and
     * emit `cycle.failed{error_code:'orchestrator_crash'}` BEFORE
     * re-throwing, so subsequent invocations see a terminal and the lock
     * unwinds immediately.
     */
    let crashError: Error | null = null;
    let currentStep: CycleStep | null = null;
    try {
      for (const step of stepsToConsider) {
        currentStep = step;
        const events = opts.dryRun
          ? ([] as LifecycleEvent[])
          : await queryEvents(
            {
              model_slug: modelSlug,
              task_set_hash: taskSetHash,
              limit: 100,
            } satisfies QueryEventsFilter,
            ingestOpts,
          );
        const prior = classifyEvents(step, events);
        const decision = decideStep(
          step,
          prior,
          opts.forceRerun.includes(step),
          fullEnvelope,
        );

        if (opts.dryRun) {
          console.log(
            colors.yellow(
              `[DRY] step ${step}: would ${decision.kind} (${decision.reason})`,
            ),
          );
          stepsRun.push(step);
          continue;
        }

        if (decision.kind === "skip") {
          const priorId = decision.priorEventId;
          console.log(
            colors.gray(
              `[SKIP] ${step}: ${decision.reason} (prior id=${priorId})`,
            ),
          );
          await appendEvent({
            ts: Date.now(),
            model_slug: modelSlug,
            task_set_hash: taskSetHash,
            event_type: stepEventName(step, "skipped"),
            tool_versions: toolVersions,
            envelope: fullEnvelope,
            payload: {
              reason: decision.reason,
              prior_event_id: priorId,
            },
            actor: "operator",
            actor_id: actorId,
          }, ingestOpts);
          stepsSkipped.push(step);
          // Even when analyze is skipped, surface the prior payload_hash so
          // publish can chain idempotency from the prior completed run.
          if (step === "analyze" && prior.completed) {
            const ph = (prior.completed.payload as { payload_hash?: string })
              .payload_hash;
            if (typeof ph === "string") priorAnalysisPayloadHash = ph;
          }
          continue;
        }

        // run | retry → emit *.started, dispatch, emit terminal event.
        await appendEvent({
          ts: Date.now(),
          model_slug: modelSlug,
          task_set_hash: taskSetHash,
          event_type: stepEventName(step, "started"),
          tool_versions: toolVersions,
          envelope: fullEnvelope,
          payload: {
            decision: decision.kind,
            reason: decision.reason,
          },
          actor: "operator",
          actor_id: actorId,
        }, ingestOpts);
        // For the publish step: seed `priorAnalysisPayloadHash` +
        // `priorPublishEventId` from the prior event log so the publish
        // step can short-circuit a re-POST when the analyze payload is
        // unchanged AND a prior publish.completed exists. This was
        // previously dead code (`PublishOptions.priorAnalysisPayloadHash`
        // was test-only) — production cycles always re-POSTed the batch.
        // Look up these values from the events list, falling back to the
        // in-loop cache populated by the analyze branch above.
        let dispatchCtx: StepContext = ctx;
        if (step === "publish") {
          // priorAnalysisPayloadHash: prefer the cache (set by the analyze
          // step earlier in THIS cycle's loop, including the skip path);
          // fall back to the most recent analysis.completed in the event
          // log (captures cross-cycle continuity).
          let analysisHash: string | undefined = priorAnalysisPayloadHash;
          if (!analysisHash) {
            const priorAnalyze = classifyEvents("analyze", events);
            if (priorAnalyze.completed) {
              const ph = (priorAnalyze.completed.payload as {
                payload_hash?: string;
              }).payload_hash;
              if (typeof ph === "string") analysisHash = ph;
            }
          }
          // priorPublishEventId: most recent publish.completed.
          let publishEvId: number | undefined = priorPublishEventId;
          if (!publishEvId) {
            const priorPublish = classifyEvents("publish", events);
            if (priorPublish.completed) publishEvId = priorPublish.completed.id;
          }
          dispatchCtx = {
            ...ctx,
            ...(analysisHash !== undefined
              ? { priorAnalysisPayloadHash: analysisHash }
              : {}),
            ...(publishEvId !== undefined
              ? { priorPublishEventId: publishEvId }
              : {}),
          };
        }
        const result = await dispatcher(step, dispatchCtx);
        // The empty-string sentinel means "no step-level event for this
        // outcome" — the orchestrator records the failure via `cycle.failed`
        // only. After this guard `result.eventType` narrows to
        // `LifecycleEventType` (the strict union), so no cast is needed.
        if (result.eventType !== "") {
          await appendEvent({
            ts: Date.now(),
            model_slug: modelSlug,
            task_set_hash: taskSetHash,
            event_type: result.eventType,
            tool_versions: toolVersions,
            envelope: fullEnvelope,
            payload: result.payload,
            actor: "operator",
            actor_id: actorId,
          }, ingestOpts);
        }
        // Cache analyze hash for downstream publish idempotency.
        if (
          step === "analyze" &&
          result.success &&
          typeof result.payload["payload_hash"] === "string"
        ) {
          priorAnalysisPayloadHash = result.payload["payload_hash"] as string;
        }
        if (!result.success) {
          cycleFailed = true;
          failedStep = step;
          lastFailureMessage = String(result.payload["error_message"] ?? "");
          lastFailureCode = String(
            result.payload["error_code"] ?? "step_failed",
          );
          console.error(
            colors.red(`[FAIL] step ${step}: ${lastFailureMessage}`),
          );
          break;
        }
        console.log(colors.green(`[OK] step ${step}: ${result.eventType}`));
        stepsRun.push(step);
      }
    } catch (e) {
      // Mid-cycle event-write throw (D1 500, network blip, …). Capture and
      // emit `cycle.failed{orchestrator_crash}` outside the per-step loop
      // so the lock-token tiebreaker sees a terminal and unwinds the
      // (model, task_set) immediately instead of waiting CYCLE_TTL.
      crashError = e instanceof Error ? e : new Error(String(e));
      cycleFailed = true;
      failedStep = currentStep;
      lastFailureCode = "orchestrator_crash";
      lastFailureMessage = crashError.message;
      console.error(
        colors.red(
          `[FAIL] orchestrator crash at step ${
            currentStep ?? "<pre-loop>"
          }: ${crashError.message}`,
        ),
      );
    }

    // 4. Terminal cycle event.
    if (!opts.dryRun) {
      const terminal: LifecycleEventType = cycleFailed
        ? "cycle.failed"
        : "cycle.completed";
      // Wrap the terminal event-write itself: if D1 is *still* down, we
      // shouldn't mask the original crash error with the terminal-write
      // error. Best-effort: log and continue to re-throw the original.
      try {
        await appendEvent({
          ts: Date.now(),
          model_slug: modelSlug,
          task_set_hash: taskSetHash,
          event_type: terminal,
          tool_versions: toolVersions,
          envelope: fullEnvelope,
          payload: cycleFailed
            ? {
              failed_step: failedStep,
              error_code: lastFailureCode,
              error_message: lastFailureMessage,
              prior_event_id: cycleStartedEventId,
            }
            : { steps_run: stepsRun, steps_skipped: stepsSkipped },
          actor: "operator",
          actor_id: actorId,
        }, ingestOpts);
      } catch (terminalWriteErr) {
        // Worst case: the terminal write also failed. Surface the
        // *original* crash error if we have one; otherwise re-throw the
        // terminal failure.
        if (crashError) {
          console.error(
            colors.red(
              `[ERROR] failed to write cycle.failed terminal: ${
                (terminalWriteErr as Error).message
              } — re-throwing original crash`,
            ),
          );
        } else {
          throw terminalWriteErr;
        }
      }
      if (crashError) {
        // Re-throw outside the catch so the caller (CLI) sees the
        // original error message and exit code.
        throw crashError;
      }
      if (cycleFailed) {
        console.error(
          colors.red(`[FAIL] cycle ${modelSlug}: failed at step ${failedStep}`),
        );
        Deno.exit(1);
      }
      console.log(colors.green(`[OK] cycle ${modelSlug}: completed`));
    } else {
      console.log(
        colors.yellow(`[DRY] cycle ${modelSlug}: plan printed; no writes.`),
      );
    }
  }
}
