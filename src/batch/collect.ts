/**
 * Poll active batches and collect ended ones into per-item response files
 * (spec sections 4.4, 5, 9).
 *
 * `pollActive` refreshes every record named in `state.activeBatchIds` from
 * the provider, flipping a record to `"ended"` once the provider reports
 * it is no longer processing, or immediately when the provider's
 * asynchronous validation rejects it for size (`sizeRejected`) - Task 8's
 * `advance` re-chunks a `sizeRejected` record rather than collecting it.
 *
 * `collectEnded` turns an ended, uncollected record's raw provider results
 * into one immutable `responses/<itemId>.json` file per item (skipping an
 * id already collected, and skipping a record already marked
 * `collected`), and updates that item's `ItemSummary.state`. Two
 * conditions are logged as `events.jsonl` integrity events and never
 * applied: an id the record never actually submitted
 * (`integrity_unknown_item`), and an id whose task has since moved on to a
 * later round while this record is a stale result for its own round
 * (`integrity_stale_round`, spec 4.4). Both provider operations run behind
 * {@link withTransportBackoff}.
 *
 * @module src/batch/collect
 */
import { ensureDir, exists } from "@std/fs";
import { dirname } from "@std/path";
import type {
  BatchHandle,
  BatchItemResult,
  BatchProvider,
} from "../llm/batch/types.ts";
import type { LLMResponse } from "../llm/types.ts";
import type { BatchRecord, BatchRunState, ItemSummary } from "./state.ts";
import { writeJsonAtomic, writeState } from "./state.ts";
import { responsePath } from "./paths.ts";
import { appendEvent } from "./journal.ts";
import { withTransportBackoff } from "./backoff.ts";

/**
 * Rebuilds a plain {@link BatchHandle} from a `BatchRecord.handle`. The
 * zod-inferred type of the latter types `extra` as
 * `Record<string, string> | undefined` even when present (zod's
 * `.optional()`), which `exactOptionalPropertyTypes` rejects against the
 * interface's `extra?: Record<string, string>` unless the key is omitted
 * outright when absent.
 */
function toHandle(handle: BatchRecord["handle"]): BatchHandle {
  return handle.extra !== undefined
    ? {
      provider: handle.provider,
      batchId: handle.batchId,
      extra: handle.extra,
    }
    : { provider: handle.provider, batchId: handle.batchId };
}

export interface PollOutcome {
  anyProcessing: boolean;
  records: BatchRecord[];
}

/**
 * Polls every batch named in `state.activeBatchIds` (an id with no
 * matching `BatchRecord` is skipped) and updates that record in place: on
 * a normal poll, `providerStatus`, `rawCounts`, `lastPolledAt`, and
 * `providerReportedCostUsd` when the provider reports one, plus `state`
 * flips to `"ended"` once `!processing`. On `sizeRejected`, the record is
 * marked `"ended"` with `rawCounts` collapsed to `{ sizeRejected: 1 }` and
 * a `size_rejected_async` event is appended. Persists `state.json` once at
 * the end.
 */
export async function pollActive(
  dir: string,
  state: BatchRunState,
  provider: BatchProvider,
): Promise<PollOutcome> {
  const byBatchId = new Map(state.batches.map((r) => [r.handle.batchId, r]));
  const records: BatchRecord[] = [];
  let anyProcessing = false;

  for (const batchId of state.activeBatchIds) {
    const record = byBatchId.get(batchId);
    if (!record) continue;

    const handle = toHandle(record.handle);
    const poll = await withTransportBackoff(() => provider.poll(handle));
    record.lastPolledAt = new Date().toISOString();
    if (poll.providerReportedCostUsd !== undefined) {
      record.providerReportedCostUsd = poll.providerReportedCostUsd;
    }

    if (poll.sizeRejected) {
      record.providerStatus = poll.providerStatus;
      record.rawCounts = { sizeRejected: 1 };
      record.state = "ended";
      await appendEvent(dir, "size_rejected_async", {
        batchId,
        wave: record.wave,
        round: record.round,
        chunk: record.chunk,
        itemIds: record.itemIds,
      });
    } else {
      record.providerStatus = poll.providerStatus;
      record.rawCounts = poll.rawCounts;
      record.state = poll.processing ? "processing" : "ended";
    }

    if (record.state === "processing") anyProcessing = true;
    records.push(record);
  }

  await writeState(dir, state);
  return { anyProcessing, records };
}

export interface CollectedItem {
  itemId: string;
  result: BatchItemResult;
  response?: LLMResponse;
}

/** Finds the `ItemSummary` (attempt 1 or 2) for `itemId` across every task. */
function findItemSummary(
  state: BatchRunState,
  itemId: string,
): ItemSummary | undefined {
  for (const summary of Object.values(state.tasks)) {
    if (summary.attempt1.itemId === itemId) return summary.attempt1;
    if (summary.attempt2?.itemId === itemId) return summary.attempt2;
  }
  return undefined;
}

/**
 * Collects every ended, uncollected `BatchRecord` in `state.batches`,
 * writing one immutable `responses/<itemId>.json` per item (skipping an id
 * whose response file already exists) and returning the items actually
 * written this call. An `ok` result is mapped through `mapRaw` and its
 * task's `ItemSummary.state` moves to `"responded"`; an error result moves
 * it to `"expired"` (error kind `"expired"`) or `"errored"` (any other
 * kind). An id not in the record's `itemIds`, or whose task's `ownerRound`
 * no longer matches the record's `round` (spec 4.4 - the item has since
 * been resubmitted for a later round and this is a stale result for the
 * round this record belongs to), is logged to `events.jsonl` and skipped
 * rather than applied. Every processed record is marked `collected = true`
 * regardless of how many of its items were skipped, so a record is never
 * collected from twice; `state.json` is persisted once at the end.
 */
export async function collectEnded(
  dir: string,
  state: BatchRunState,
  provider: BatchProvider,
  mapRaw: (raw: unknown, itemId: string) => LLMResponse,
): Promise<CollectedItem[]> {
  const collected: CollectedItem[] = [];
  await ensureDir(dirname(responsePath(dir, "_")));

  for (const record of state.batches) {
    if (record.state !== "ended" || record.collected) continue;

    const itemIdSet = new Set(record.itemIds);
    const handle = toHandle(record.handle);
    const results = await withTransportBackoff(() => provider.collect(handle));

    for (const result of results) {
      if (!itemIdSet.has(result.itemId)) {
        await appendEvent(dir, "integrity_unknown_item", {
          batchId: record.handle.batchId,
          itemId: result.itemId,
        });
        continue;
      }

      const path = responsePath(dir, result.itemId);
      if (await exists(path)) continue;

      const item = findItemSummary(state, result.itemId);
      if (!item) continue;

      if (item.ownerRound !== record.round) {
        await appendEvent(dir, "integrity_stale_round", {
          batchId: record.handle.batchId,
          itemId: result.itemId,
          recordRound: record.round,
          ownerRound: item.ownerRound,
        });
        continue;
      }

      let response: LLMResponse | undefined;
      if (result.ok) {
        response = mapRaw(result.raw, result.itemId);
        item.state = "responded";
      } else if (result.error.kind === "expired") {
        item.state = "expired";
      } else {
        item.state = "errored";
      }

      await writeJsonAtomic(
        path,
        response !== undefined ? { result, response } : { result },
      );
      collected.push(
        response !== undefined
          ? { itemId: result.itemId, result, response }
          : { itemId: result.itemId, result },
      );
    }

    record.collected = true;
  }

  await writeState(dir, state);
  return collected;
}
