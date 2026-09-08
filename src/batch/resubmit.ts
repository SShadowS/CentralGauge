/**
 * The one place a journaled-but-unsubmitted item is (re)submitted, shared
 * by `retry`, by `advance`'s `submit-pending`, `submit-wave-2` and
 * `resubmit` steps (spec sections 4.3, 4.4, 4.5, 9).
 *
 * The persisted state, never the in-flight call, is the source of truth: a
 * caller that mints new items (a wave-2 fix wave, the single resubmission
 * round) journals them to `items.jsonl`/`requests/` and persists their
 * `ItemSummary`s as `"pending"` BEFORE any provider call, then hands the
 * submission to {@link resubmitPending}. Because an item counts as
 * submitted only once a `BatchRecord` names it, a partial rejection or a
 * crash leaves exactly the un-submitted items pending, and the next call
 * submits exactly those: no item is ever submitted (and billed) twice, and
 * no minted item is ever forgotten.
 *
 * @module src/batch/resubmit
 */
import { join } from "@std/path";
import type { LLMRequest } from "../llm/types.ts";
import type { AdvanceDeps } from "./advance.ts";
import type { ItemLine } from "./journal.ts";
import type { RenderedItem } from "./render.ts";
import type { BatchRunState } from "./state.ts";
import { chunkItems } from "./chunking.ts";
import { loadJsonl } from "./journal.ts";
import { requestPath, RUN_FILES } from "./paths.ts";
import { writeState } from "./state.ts";
import { submitChunks } from "./submit-wave.ts";
import { liveBatchItemIds } from "./transitions.ts";

/** What {@link resubmitPending} needs from `AdvanceDeps`. */
export type ResubmitDeps = Pick<AdvanceDeps, "provider" | "wrap">;

export interface ResubmitOutcome {
  exit: 0 | 4;
  message: string;
  /** How many items reached the provider on this call. */
  resubmitted: number;
}

export interface PendingItem {
  taskId: string;
  attempt: 1 | 2;
  itemId: string;
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

/**
 * Every item whose `ItemSummary.state` is still `"pending"` AND that is
 * not named by any `BatchRecord.itemIds` - i.e. it was journaled
 * (`items.jsonl`/`requests/<itemId>.json`) but the submission that would
 * have carried it never produced a batch. A `"pending"` item that IS named
 * by a batch record is legitimately in flight and must never be
 * resubmitted here.
 */
export function findUnsubmittedItems(state: BatchRunState): PendingItem[] {
  const submitted = liveBatchItemIds(state);

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
 * The phase a fully successful resubmission of `wave` leaves behind.
 * `prepared` (a first submission that was rejected, or a run just returned
 * by `--confirm-not-submitted`) and any `*-collected` phase (the wave-2
 * fix wave, the single resubmission round, or either of those recovered
 * after a partial rejection) all move to `attempt-<wave>-submitted`; a run
 * already in a `*-submitted` phase keeps it, since some of its chunks are
 * still in flight under that same phase.
 */
function phaseAfterResubmit(
  phase: BatchRunState["phase"],
  wave: 1 | 2,
): BatchRunState["phase"] {
  if (
    phase !== "prepared" && phase !== "attempt-1-collected" &&
    phase !== "attempt-2-collected"
  ) {
    return phase;
  }
  return wave === 2 ? "attempt-2-submitted" : "attempt-1-submitted";
}

/**
 * Re-reads each pending item's exact body and request from disk
 * (`items.jsonl`, `requests/<itemId>.json` - never re-rendered, so a
 * resubmission can never drift from what was originally journaled), groups
 * by the wave/round it was journaled under, and submits each group via
 * {@link submitChunks}. Clears `state.lastError` and advances the phase per
 * {@link phaseAfterResubmit} on full success; records `lastError` and
 * returns exit 4 on the first group the provider refuses, leaving that
 * group's items pending and unsubmitted for the next call.
 */
export async function resubmitPending(
  dir: string,
  state: BatchRunState,
  deps: ResubmitDeps,
): Promise<ResubmitOutcome> {
  const pending = findUnsubmittedItems(state);
  if (pending.length === 0) {
    delete state.lastError;
    await writeState(dir, state);
    return { exit: 0, message: "nothing pending to resubmit", resubmitted: 0 };
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
      throw new Error(`resubmitPending: no items.jsonl entry for ${p.itemId}`);
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
      state.lastError = outcome.kind === "rejected" && outcome.lastError
        ? outcome.lastError
        : {
          at: new Date().toISOString(),
          step: "resubmit",
          message: reason,
          retryable: false,
        };
      await writeState(dir, state);
      return { exit: 4, message: reason, resubmitted };
    }
    resubmitted += renderedItems.length;
    if (group.wave === 2) {
      resubmittedWave = 2;
    }
  }

  state.phase = phaseAfterResubmit(state.phase, resubmittedWave);
  delete state.lastError;
  await writeState(dir, state);
  return {
    exit: 0,
    message: `resubmitted ${resubmitted} item(s)`,
    resubmitted,
  };
}
