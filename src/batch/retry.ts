/**
 * `retry`: resubmit identical bodies after a rejected submission, or drive
 * `submit-unknown` reconciliation by hand (spec sections 4.3, 4.5, 9).
 *
 * The resubmission branch is deliberately wider than the spec table's
 * literal "`prepared` with `lastError`" row: a rejected single-resubmission
 * round or wave-2 submission (`runResubmit`/`runSubmitWave2` in
 * `advance.ts`) leaves the affected task summaries `"pending"` with no
 * `BatchRecord` ever created for them, while `state.phase` stays whatever
 * it was before that submission attempt ran. `findUnsubmittedItems`
 * (`src/batch/resubmit.ts`) finds exactly those orphaned items -
 * `"pending"` AND not named by any `BatchRecord.itemIds` - regardless of
 * phase, which is what lets `retry` recover a resubmission or wave-2
 * rejection the same way it recovers an initial-submission rejection.
 *
 * The submission itself lives in `src/batch/resubmit.ts`, shared with
 * `advance`'s `submit-pending` step, so a hand-driven `retry` and a
 * scheduled `advance` recover an interrupted submission identically.
 *
 * @module src/batch/retry
 */
import type { AdvanceDeps } from "./advance.ts";
import { readIntent } from "./intent.ts";
import { withMutateLock } from "./mutate-lock.ts";
import { confirmNotSubmitted, reconcileSubmitUnknown } from "./reconcile.ts";
import { findUnsubmittedItems, resubmitPending } from "./resubmit.ts";
import type { BatchRunState } from "./state.ts";
import { loadState } from "./state.ts";

export type RetryDeps = AdvanceDeps & {
  force?: boolean;
  adopt?: string;
  confirmNotSubmitted?: boolean;
};

export interface RetryOutcome {
  exit: 0 | 4;
  message: string;
}

/**
 * Handles a `submit-unknown` run: `opts.adopt` validates and adopts the
 * named candidate; `opts.confirmNotSubmitted` is the operator's statement
 * that the batch was never created; with neither, reconciliation is
 * attempted once more (harmless when nothing new can be decided) and, on
 * no adoption, the run's candidates are listed for the operator to choose
 * from.
 */
async function retrySubmitUnknown(
  dir: string,
  state: BatchRunState,
  deps: RetryDeps,
): Promise<RetryOutcome> {
  const intent = await readIntent(dir);
  if (!intent) {
    return {
      exit: 4,
      message: "run is submit-unknown but intent.json is missing",
    };
  }

  if (deps.adopt !== undefined) {
    const report = await reconcileSubmitUnknown(
      dir,
      state,
      deps.provider,
      intent,
      {
        adopt: deps.adopt,
      },
    );
    if (report.adopted) {
      return {
        exit: 0,
        message: `adopted candidate ${report.adopted.handle.batchId}`,
      };
    }
    return { exit: 4, message: report.reason };
  }

  if (deps.confirmNotSubmitted) {
    await confirmNotSubmitted(dir, state, deps.provider, intent);
    return {
      exit: 0,
      message: "confirmed not submitted; run returned to prepared",
    };
  }

  const report = await reconcileSubmitUnknown(
    dir,
    state,
    deps.provider,
    intent,
  );
  if (report.adopted) {
    return {
      exit: 0,
      message: `adopted candidate ${report.adopted.handle.batchId}`,
    };
  }
  const ids = report.candidates.map((c) => c.batchId).join(", ") || "(none)";
  return { exit: 4, message: `${report.reason}; candidates: ${ids}` };
}

/**
 * Runs the `retry` command for the run at `dir` (spec 4.5). A
 * `submit-unknown` run is handled entirely by {@link retrySubmitUnknown}
 * - routed to it not only on `state.phase === "submit-unknown"` but also
 * whenever a live `intent.json` is on disk, mirroring `nextStep`'s own
 * priority rule in `transitions.ts` ("a live intent is stronger evidence
 * than a possibly-stale phase"). Nothing in this codebase ever persists
 * `phase = "submit-unknown"` - `nextStep` derives that condition purely
 * from intent presence - so a crash between the OpenAI upload and batch
 * creation on a run's very FIRST submission leaves `state.phase` still
 * `"prepared"` with an orphan intent; without this check
 * `--confirm-not-submitted`/`--adopt` would be unreachable for exactly
 * that crash. Otherwise, a non-retryable `lastError` blocks (exit 4)
 * unless `deps.force` overrides it - the classification was wrong, per
 * spec 9 - after which the same resubmission runs as the retryable case.
 * A `prepared` run with no `lastError` at all (notably one
 * `--confirm-not-submitted` just returned to `prepared`, which sets no
 * `lastError`) still resubmits when it has orphaned pending items; only a
 * `prepared` run with nothing pending falls through to the "nothing to
 * retry" exit 4.
 */
export async function retryRun(
  dir: string,
  deps: RetryDeps,
): Promise<RetryOutcome> {
  return await withMutateLock(dir, async () => {
    const state = await loadState(dir);

    if (state.phase === "submit-unknown" || (await readIntent(dir)) !== null) {
      return await retrySubmitUnknown(dir, state, deps);
    }

    if (!state.lastError) {
      // A `prepared` run with orphaned pending items (e.g. one just
      // returned from `--confirm-not-submitted`, spec 4.5) has nothing
      // to say in `lastError` but still needs resubmitting.
      if (
        state.phase === "prepared" && findUnsubmittedItems(state).length > 0
      ) {
        return await resubmitPending(dir, state, deps);
      }
      return {
        exit: 4,
        message: "nothing to retry: no lastError and run is not submit-unknown",
      };
    }

    if (!state.lastError.retryable && !deps.force) {
      return { exit: 4, message: state.lastError.message };
    }

    return await resubmitPending(dir, state, deps);
  });
}
