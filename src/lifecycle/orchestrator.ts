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

async function defaultDispatchStep(
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

function stepEventName(step: CycleStep, kind: string): LifecycleEventType {
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
    // batch endpoint.
    let priorAnalysisPayloadHash: string | undefined;

    for (const step of stepsToConsider) {
      const events = opts.dryRun ? ([] as LifecycleEvent[]) : await queryEvents(
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
      const result = await dispatcher(step, ctx);
      // Some steps (e.g. debug-capture pre-flight no_debug_session) cannot
      // emit a step-level terminal because no canonical event type exists
      // (`debug.failed` is not in the appendix). They return an empty
      // eventType — the orchestrator records the failure via cycle.failed
      // only.
      if (result.eventType) {
        await appendEvent({
          ts: Date.now(),
          model_slug: modelSlug,
          task_set_hash: taskSetHash,
          event_type: result.eventType as LifecycleEventType,
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
        lastFailureCode = String(result.payload["error_code"] ?? "step_failed");
        console.error(
          colors.red(`[FAIL] step ${step}: ${lastFailureMessage}`),
        );
        break;
      }
      console.log(colors.green(`[OK] step ${step}: ${result.eventType}`));
      stepsRun.push(step);
    }

    // 4. Terminal cycle event.
    if (!opts.dryRun) {
      const terminal: LifecycleEventType = cycleFailed
        ? "cycle.failed"
        : "cycle.completed";
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
      if (cycleFailed) {
        console.error(
          colors.red(`[FAIL] cycle ${modelSlug}: failed at step ${failedStep}`),
        );
        Deno.exit(1);
      }
      console.log(colors.green(`[OK] cycle ${modelSlug}: completed`));
    } else {
      // priorAnalysisPayloadHash is intentionally only used in non-dry-run
      // dispatch; cite the var here so the compiler doesn't flag it as
      // unused when we add a dry-run-aware branch later.
      void priorAnalysisPayloadHash;
      console.log(
        colors.yellow(`[DRY] cycle ${modelSlug}: plan printed; no writes.`),
      );
    }
  }
}
