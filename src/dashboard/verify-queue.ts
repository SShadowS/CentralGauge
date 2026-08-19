/**
 * Serialises escalation verifies against a real Business Central container.
 *
 * Candidates share publish state on a container (see `verify-run.ts` and
 * `docker-sandbox.md`), so two verifies in flight at once are unsafe, not
 * merely slow. `VerifyQueue` is the single place that enforces "one job in
 * flight at a time, FIFO order" for the escalation feature, and the single
 * place that re-checks the bench-liveness gate on every job rather than
 * once per batch: a bench can start while a batch of four is halfway
 * through, and jobs already queued must then refuse rather than run.
 *
 * `gate` and `verify` are both injected, so this module is testable with no
 * marker file and no container:
 * - `gate` mirrors `checkBenchGate`'s shape (Task 2) but takes no
 *   arguments — the caller closes over whatever directory/options it needs.
 * - `verify` maps one `VerifyQueueJob` to a `Promise<VerifyOutcome>`. It is
 *   NOT `verifyResponse` (`verify-run.ts`) itself — Task 7 wires an adapter
 *   that calls `verifyResponse` with the real container verifier and model
 *   caller. Keeping that seam here, instead of importing `verifyResponse`
 *   directly, is what lets this queue be unit-tested with neither.
 *
 * A thrown `verify` call becomes `{state: "errored", message}` and the
 * queue keeps going — one bad response must not take down every job queued
 * behind it.
 *
 * @module dashboard/verify-queue
 */

import * as colors from "@std/fmt/colors";

import type { GateDecision } from "./bench-gate.ts";
import type { VerifyOutcome } from "./verify-types.ts";

/** One unit of escalation work. */
export interface VerifyQueueJob {
  /**
   * The draft's directory on disk, NOT a draft id. Two drafts under
   * `scratch/` can share a task id, so a job keyed on an id could dispatch
   * a verify against the wrong draft's oracle.
   */
  draftDir: string;
  /** Names the staged `<taskId>.al` (see `verify-run.ts`'s `stageResponse`). */
  taskId: string;
  /** The model slug the response came from. Carried through for display. */
  model: string;
  /** The response's code, verbatim. */
  code: string;
  containerName?: string;
}

/** A queued job's current id, payload, and outcome, as returned by `snapshot()`. */
export interface JobView {
  id: string;
  job: VerifyQueueJob;
  outcome: VerifyOutcome;
  /** `Date.now()` at the moment `enqueue()` accepted this job. */
  enqueuedAt: number;
}

/** Emitted on every outcome transition: `queued` first, a terminal state last. */
export interface VerifyQueueEvent {
  id: string;
  job: VerifyQueueJob;
  outcome: VerifyOutcome;
}

export type VerifyQueueListener = (event: VerifyQueueEvent) => void;

/** Mirrors `checkBenchGate`'s decision shape, but takes no arguments. */
export type VerifyQueueGateFn = () => GateDecision;

/**
 * Maps one job to its outcome. Production (Task 7) wires this to
 * `verifyResponse` plus the real container verifier and model caller; every
 * test in this module wires it to a fake. A thrown call is caught by the
 * queue and turned into an `errored` outcome — this function is free to
 * throw.
 */
export type VerifyQueueVerifyFn = (
  job: VerifyQueueJob,
) => Promise<VerifyOutcome>;

export interface VerifyQueueOptions {
  gate: VerifyQueueGateFn;
  verify: VerifyQueueVerifyFn;
}

/**
 * Serial FIFO queue for escalation verifies.
 *
 * Two structures do the work: `queue`, a FIFO array of job ids waiting for
 * their turn, and `pump`, a single in-flight promise chain. `enqueue()`
 * pushes the new id onto the BACK of `queue` and appends `() => this.runNext()`
 * onto `pump`, so the Nth job's dispatch is attached before the Nth job's
 * `verify()` call can possibly resolve — that ordering is what makes "never
 * overlapping" and "FIFO" hold regardless of how long any individual
 * `verify()` takes. Each `runNext()` shifts exactly one id off the FRONT of
 * `queue`, so dispatch order is enqueue order. `drain()` returns whatever
 * `pump` currently references, so it only resolves once every job enqueued
 * so far — not jobs enqueued after `drain()` was called — has settled.
 */
export class VerifyQueue {
  private readonly gate: VerifyQueueGateFn;
  private readonly verify: VerifyQueueVerifyFn;
  private readonly listeners = new Set<VerifyQueueListener>();
  private readonly jobs = new Map<string, JobView>();
  /** FIFO: ids waiting for their turn, oldest first. */
  private readonly queue: string[] = [];
  /** The single in-flight promise chain that serialises dispatch. */
  private pump: Promise<void> = Promise.resolve();
  private nextId = 1;
  private aborted = false;
  private abortReason: string | undefined;

  constructor(opts: VerifyQueueOptions) {
    this.gate = opts.gate;
    this.verify = opts.verify;
  }

  /** Accepts a job, emits its initial `queued` outcome, and returns its id. */
  enqueue(job: VerifyQueueJob): string {
    const id = `verify-${this.nextId++}`;
    const view: JobView = {
      id,
      job,
      outcome: { state: "queued" },
      enqueuedAt: Date.now(),
    };
    this.jobs.set(id, view);
    this.queue.push(id);
    this.emit(view);

    // Attach unconditionally, in enqueue order, BEFORE any await happens.
    // The gate re-check and abort check both live inside `runNext()`,
    // evaluated when THIS job's turn actually comes up — not here — so a
    // bench that starts (or a `shutdown()`) after this line still refuses
    // this job rather than letting it slip through on a stale decision.
    this.pump = this.pump.then(() => this.runNext());
    return id;
  }

  /** Subscribes to every outcome transition. Returns an unsubscribe function. */
  on(listener: VerifyQueueListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A point-in-time copy of every job this queue has ever accepted. */
  snapshot(): JobView[] {
    return [...this.jobs.values()].map((view) => ({ ...view }));
  }

  /**
   * Resolves once every job enqueued so far has reached a terminal outcome.
   * Exists for tests and for shutdown; production consumes the event
   * stream from `on()` instead, since a live dashboard wants results as
   * they land, not all at once at the end.
   */
  async drain(): Promise<void> {
    await this.pump;
  }

  /**
   * Stops the queue for server shutdown. This is PERMANENT and ONE-WAY, not
   * a batch cancel: every job still `queued` right now is refused
   * immediately, and — because the latch never clears — every job
   * `enqueue()`d after this call is also refused on its turn, for the rest
   * of this queue's lifetime. A job already in flight when this is called
   * is not cancelled — its `verify()` call is left to settle normally,
   * since there is no cooperative cancellation seam here.
   *
   * Do NOT wire this to a "cancel this batch" UI action: a user expecting
   * to clear the current queue and keep working would instead get a queue
   * that silently refuses every job from then on, with no obvious cause. A
   * batch-cancel feature needs its own, non-latching method.
   */
  shutdown(reason: string): void {
    this.aborted = true;
    this.abortReason = reason;
    for (const view of this.jobs.values()) {
      if (view.outcome.state === "queued") {
        this.setOutcome(view.id, { state: "refused", reason });
      }
    }
  }

  /** Dispatches exactly the job at the FRONT of `queue` — enqueue order, not insertion timing. */
  private async runNext(): Promise<void> {
    const id = this.queue.shift();
    if (id === undefined) return;

    const view = this.jobs.get(id);
    if (!view) return;

    // shutdown() may already have resolved this job (it was still `queued`
    // when shutdown ran, marked `refused` there, and only reaches this
    // shift() later because the pump had earlier jobs ahead of it). Don't
    // re-run or re-emit a job that already has a terminal outcome.
    if (view.outcome.state !== "queued") return;

    if (this.aborted) {
      this.setOutcome(id, {
        state: "refused",
        reason: this.abortReason ?? "queue aborted",
      });
      return;
    }

    // Re-checked here, per job, deliberately not hoisted above enqueue's
    // loop-of-callers: a bench can start while several jobs still sit
    // ahead of this one in the queue.
    const decision = this.gate();
    if (!decision.allowed) {
      this.setOutcome(id, { state: "refused", reason: decision.reason });
      return;
    }

    try {
      const outcome = await this.verify(view.job);
      this.setOutcome(id, outcome);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setOutcome(id, { state: "errored", message });
    }
  }

  private setOutcome(id: string, outcome: VerifyOutcome): void {
    const view = this.jobs.get(id);
    if (!view) return;
    view.outcome = outcome;
    this.emit(view);
  }

  private emit(view: JobView): void {
    const event: VerifyQueueEvent = {
      id: view.id,
      job: view.job,
      outcome: view.outcome,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // A bad subscriber must not break queue state or other
        // subscribers - mirrors ContainerHealthMonitor's `on()` contract
        // (see .claude/rules/alert-drain-rebalance.md).
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          colors.yellow(`[verify-queue] listener threw: ${message}`),
        );
      }
    }
  }
}
