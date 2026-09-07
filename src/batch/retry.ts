/**
 * `retry`: resubmit identical bodies after a rejected submission, or drive
 * `submit-unknown` reconciliation by hand (spec sections 4.3, 4.5, 9).
 *
 * The resubmission branch is deliberately wider than the spec table's
 * literal "`prepared` with `lastError`" row: a rejected single-resubmission
 * round or wave-2 submission (`runResubmit`/`runSubmitWave2` in
 * `advance.ts`) leaves the affected task summaries `"pending"` with no
 * `BatchRecord` ever created for them, while `state.phase` stays whatever
 * it was before that submission attempt ran. `findUnsubmittedItems` finds
 * exactly those orphaned items - `"pending"` AND not named by any
 * `BatchRecord.itemIds` - regardless of phase, which is what lets `retry`
 * recover a resubmission or wave-2 rejection the same way it recovers an
 * initial-submission rejection.
 *
 * @module src/batch/retry
 */
import { join } from "@std/path";
import type { AdvanceDeps } from "./advance.ts";
import { chunkItems } from "./chunking.ts";
import { readIntent } from "./intent.ts";
import { loadJsonl } from "./journal.ts";
import type { ItemLine } from "./journal.ts";
import { withMutateLock } from "./mutate-lock.ts";
import { requestPath, RUN_FILES } from "./paths.ts";
import type { RenderedItem } from "./render.ts";
import { confirmNotSubmitted, reconcileSubmitUnknown } from "./reconcile.ts";
import type { BatchRunState } from "./state.ts";
import { loadState, writeState } from "./state.ts";
import { submitChunks } from "./submit-wave.ts";
import type { LLMRequest } from "../llm/types.ts";

export type RetryDeps = AdvanceDeps & {
  force?: boolean;
  adopt?: string;
  confirmNotSubmitted?: boolean;
};

export interface RetryOutcome {
  exit: 0 | 4;
  message: string;
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

interface PendingItem {
  taskId: string;
  attempt: 1 | 2;
  itemId: string;
}

/**
 * Every item whose `ItemSummary.state` is still `"pending"` AND that is
 * not named by any `BatchRecord.itemIds` - i.e. it was journaled
 * (`items.jsonl`/`requests/<itemId>.json`) but the submission that would
 * have carried it never produced a batch. A `"pending"` item that IS named
 * by a batch record is legitimately in flight and must never be
 * resubmitted here.
 */
function findUnsubmittedItems(state: BatchRunState): PendingItem[] {
  const submitted = new Set<string>();
  for (const record of state.batches) {
    for (const id of record.itemIds) submitted.add(id);
  }

  const out: PendingItem[] = [];
  for (const [taskId, summary] of Object.entries(state.tasks)) {
    for (const key of ["attempt1", "attempt2"] as const) {
      const item = summary[key];
      if (!item) continue;
      if (item.state === "pending" && !submitted.has(item.itemId)) {
        out.push({
          taskId,
          attempt: key === "attempt1" ? 1 : 2,
          itemId: item.itemId,
        });
      }
    }
  }
  return out;
}

/**
 * Re-reads each pending item's exact body and request from disk
 * (`items.jsonl`, `requests/<itemId>.json` - never re-rendered, so a
 * retry can never drift from what was originally journaled), groups by
 * the wave/round it was journaled under, and resubmits each group via
 * {@link submitChunks}. Clears `state.lastError` on full success.
 *
 * On full success, when `state.phase` was still `"prepared"` (the
 * `--confirm-not-submitted` return state, or a run that never got past
 * its very first submission attempt), advances it to
 * `"attempt-1-submitted"` or `"attempt-2-submitted"` per the wave that
 * was resubmitted - mirroring what `submit.ts` sets after its own
 * `submitChunks` call. A run already past `prepared` (e.g. a rejected
 * resubmission or wave-2 round) keeps whatever phase it was in;
 * `resubmitPending` only ever recovers orphaned items, never drives the
 * phase backwards or sideways on its own.
 */
async function resubmitPending(
  dir: string,
  state: BatchRunState,
  deps: AdvanceDeps,
): Promise<RetryOutcome> {
  const pending = findUnsubmittedItems(state);
  if (pending.length === 0) {
    delete state.lastError;
    await writeState(dir, state);
    return { exit: 0, message: "nothing pending to resubmit" };
  }

  const itemLines = await loadJsonl<ItemLine>(
    join(dir, RUN_FILES.items),
    (l) => l.itemId,
  );
  const byId = new Map(itemLines.map((l) => [l.itemId, l]));

  const groups = new Map<
    string,
    { wave: 1 | 2; round: 0 | 1; items: PendingItem[] }
  >();
  for (const p of pending) {
    const line = byId.get(p.itemId);
    if (!line) {
      throw new Error(`retryRun: no items.jsonl entry for ${p.itemId}`);
    }
    const key = `${line.wave}:${line.round}`;
    let group = groups.get(key);
    if (!group) {
      group = { wave: line.wave, round: line.round, items: [] };
      groups.set(key, group);
    }
    group.items.push(p);
  }

  let resubmitted = 0;
  let resubmittedWave: 1 | 2 = 1;
  for (const group of groups.values()) {
    const renderedItems: RenderedItem[] = [];
    for (const p of group.items) {
      const line = byId.get(p.itemId)!;
      const request = await readJsonFile<LLMRequest>(
        requestPath(dir, p.itemId),
      );
      renderedItems.push({
        itemId: p.itemId,
        taskId: line.taskId,
        attempt: line.attempt,
        round: line.round,
        request,
        body: line.body,
        bodyDigest: line.bodyDigest,
      });
    }

    const chunks = chunkItems(
      renderedItems.map((r) => ({ itemId: r.itemId, body: r.body })),
      deps.provider.limits,
      deps.wrap,
    );

    const outcome = await submitChunks(
      dir,
      state,
      chunks,
      renderedItems,
      group.wave,
      group.round,
      {
        provider: deps.provider,
        model: state.model.apiModelId,
        wrap: deps.wrap,
      },
    );

    if (outcome.kind !== "submitted") {
      const reason = outcome.kind === "rejected"
        ? outcome.lastError?.message ?? "resubmission rejected"
        : outcome.reason;
      state.lastError = outcome.kind === "rejected" ? outcome.lastError : {
        at: new Date().toISOString(),
        step: "retry",
        message: reason,
        retryable: false,
      };
      await writeState(dir, state);
      return { exit: 4, message: reason };
    }
    resubmitted += renderedItems.length;
    if (group.wave === 2) {
      resubmittedWave = 2;
    }
  }

  if (state.phase === "prepared") {
    state.phase = resubmittedWave === 2
      ? "attempt-2-submitted"
      : "attempt-1-submitted";
  }
  delete state.lastError;
  await writeState(dir, state);
  return { exit: 0, message: `resubmitted ${resubmitted} item(s)` };
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
