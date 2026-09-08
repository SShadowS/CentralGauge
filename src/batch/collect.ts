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
 * After the provider's results are applied, any id still named in
 * `record.itemIds` with no response file (a provider that strands work -
 * an OpenRouter batch that failed async validation and returned no inline
 * results, or an OpenAI batch that expired mid-flight - never reports a
 * result for every item it accepted) is synthesized as an unresolved
 * error (`expired`/`cancelled`/`unknown`, from `record.providerStatus`)
 * and logged once as a `batch_unresolved_items` event, so a provider gap
 * can never leave an item stuck `"submitted"` forever.
 *
 * @module src/batch/collect
 */
import { ensureDir, exists } from "@std/fs";
import { dirname } from "@std/path";
import type {
  BatchErrorKind,
  BatchItemResult,
  BatchProvider,
} from "../llm/batch/types.ts";
import type { LLMResponse } from "../llm/types.ts";
import type { BatchRecord, BatchRunState, ItemSummary } from "./state.ts";
import { toBatchHandle, writeJsonAtomic, writeState } from "./state.ts";
import { responsePath } from "./paths.ts";
import { appendEvent } from "./journal.ts";
import { withTransportBackoff } from "./backoff.ts";

export interface PollOutcome {
  anyProcessing: boolean;
  records: BatchRecord[];
}

/**
 * Polls every batch named in `state.activeBatchIds` (an id with no
 * matching `BatchRecord` is skipped) and updates that record in place: on
 * a normal poll, `providerStatus`, `rawCounts`, `lastPolledAt`, and
 * `providerReportedCostUsd` when the provider reports one, plus `state`
 * flips to `"ended"` once `!processing`. The first poll that observes a
 * record ending (either `!processing` or `sizeRejected`) also stamps
 * `record.endedAt` from that same `lastPolledAt` timestamp, once and only
 * once - a later re-poll of an already-ended record advances
 * `lastPolledAt` but never touches `endedAt`, so a report built from
 * `endedAt` reflects the first observed end rather than however late the
 * batch happened to be re-polled. Whenever `poll.extra` is present
 * it is merged onto `record.handle.extra` (provider-neutral; OpenAI uses
 * it to carry `outputFileId`/`errorFileId`), so the persisted handle stays
 * complete for `cleanup` and for audit even though `collect` itself no
 * longer depends on it. On `sizeRejected`, the record is
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
    // A re-chunked (size-rejected) record's items live in its halves now;
    // polling it again would report on work nothing is waiting for.
    if (record.superseded) continue;

    const handle = toBatchHandle(record.handle);
    const poll = await withTransportBackoff(() => provider.poll(handle));
    record.lastPolledAt = new Date().toISOString();
    if (poll.providerReportedCostUsd !== undefined) {
      record.providerReportedCostUsd = poll.providerReportedCostUsd;
    }
    if (poll.extra) {
      record.handle.extra = { ...record.handle.extra, ...poll.extra };
    }

    if (poll.sizeRejected) {
      record.providerStatus = poll.providerStatus;
      record.rawCounts = { sizeRejected: 1 };
      record.state = "ended";
      if (record.endedAt === undefined) record.endedAt = record.lastPolledAt;
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
      if (!poll.processing && record.endedAt === undefined) {
        record.endedAt = record.lastPolledAt;
      }
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

/** The immutable, on-disk shape of `responses/<itemId>.json`. */
interface StoredResponse {
  result: BatchItemResult;
  response?: LLMResponse;
}

/**
 * Drops a collected batch from `activeBatchIds`. `pollActive` iterates that
 * list, so leaving a collected id there means re-polling an ended batch on
 * every tick for the rest of the run - and on OpenRouter a poll of a
 * completed batch re-downloads its whole inline `results[]`. The record
 * itself stays in `state.batches` for the results block and the audit
 * trail.
 */
function dropActiveBatchId(state: BatchRunState, batchId: string): void {
  const idx = state.activeBatchIds.indexOf(batchId);
  if (idx !== -1) state.activeBatchIds.splice(idx, 1);
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

/** `"responded"` for an ok result, `"expired"`/`"errored"` for an error result. */
function deriveItemState(result: BatchItemResult): ItemSummary["state"] {
  if (result.ok) return "responded";
  return result.error.kind === "expired" ? "expired" : "errored";
}

/**
 * Moves `item` to the state `result` implies and records the provider's
 * `retryable` flag with it, so `nextStep` can keep a terminal error out of
 * the resubmission round without reading the response file back.
 */
function applyResultToItem(item: ItemSummary, result: BatchItemResult): void {
  item.state = deriveItemState(result);
  if (result.ok) {
    delete item.retryable;
  } else {
    item.retryable = result.error.retryable;
  }
}

/** Maps a record's terminal `providerStatus` to the synthesized error kind. */
function unresolvedErrorKind(providerStatus: string): BatchErrorKind {
  if (providerStatus === "expired") return "expired";
  if (providerStatus === "cancelled") return "cancelled";
  return "unknown";
}

/**
 * For every id in `record.itemIds` that still has no response file after
 * the provider's own results were applied (and whose task is still owned
 * by this record's round - a stale-round id is left for the record that
 * actually owns it), synthesizes a not-ok `BatchItemResult`, writes its
 * response file, and moves `ItemSummary.state` accordingly. A provider
 * that returns fewer results than items it accepted (spec 5.3's async
 * `sizeRejected` collapse, an expired batch, or any other partial/short
 * result set) would otherwise leave those items stuck `"submitted"`
 * forever. Appends exactly one `batch_unresolved_items` event naming every
 * synthesized id, only when at least one was found - never when the
 * provider fully accounted for the record.
 */
async function synthesizeUnresolvedItems(
  dir: string,
  state: BatchRunState,
  record: BatchRecord,
): Promise<void> {
  const missing: string[] = [];
  for (const itemId of record.itemIds) {
    if (await exists(responsePath(dir, itemId))) continue;
    const item = findItemSummary(state, itemId);
    if (!item || item.ownerRound !== record.round) continue;
    missing.push(itemId);
  }
  if (missing.length === 0) return;

  const kind = unresolvedErrorKind(record.providerStatus);
  for (const itemId of missing) {
    const result: BatchItemResult = {
      itemId,
      ok: false,
      error: {
        kind,
        retryable: true,
        message:
          `no result returned for batch ${record.handle.batchId} (provider status: ${record.providerStatus})`,
      },
    };
    const item = findItemSummary(state, itemId)!;
    applyResultToItem(item, result);
    await writeJsonAtomic(responsePath(dir, itemId), { result });
  }

  await appendEvent(dir, "batch_unresolved_items", {
    provider: record.handle.provider,
    batchId: record.handle.batchId,
    providerStatus: record.providerStatus,
    itemIds: missing,
  });
}

/** Reads back a previously written `responses/<itemId>.json`. */
async function readStoredResponse(path: string): Promise<StoredResponse> {
  const raw = await Deno.readTextFile(path);
  return JSON.parse(raw) as StoredResponse;
}

/**
 * Repairs `item.state` from an already-written response file. Used both
 * when a resumed run finds a file it wrote before a crash (the file was
 * already validated - round-ownership and unknown-id checks passed - when
 * it was first written, so it is trusted without re-checking).
 */
async function repairFromExistingFile(
  state: BatchRunState,
  itemId: string,
  path: string,
): Promise<void> {
  const item = findItemSummary(state, itemId);
  if (!item) return;
  const stored = await readStoredResponse(path);
  applyResultToItem(item, stored.result);
}

/**
 * Collects every ended, uncollected `BatchRecord` in `state.batches`,
 * writing one immutable `responses/<itemId>.json` per item and returning
 * the items actually written this call. An `ok` result is mapped through
 * `mapRaw` and its task's `ItemSummary.state` moves to `"responded"`; an
 * error result moves it to `"expired"` (error kind `"expired"`) or
 * `"errored"` (any other kind). An id not in the record's `itemIds`, or
 * whose task's `ownerRound` no longer matches the record's `round` (spec
 * 4.4 - the item has since been resubmitted for a later round and this is
 * a stale result for the round this record belongs to), is logged to
 * `events.jsonl` and skipped rather than applied.
 *
 * Crash resumption: when every item in a record already has a response
 * file on disk (the process crashed after writing them but before
 * `collected`/`state.json` were persisted), the record is repaired purely
 * from those files without calling `provider.collect` again. When only
 * some items already have files, `provider.collect` runs as normal and any
 * result whose file already exists has its `ItemSummary.state` re-derived
 * from that file instead of being silently skipped. Either way, each
 * record's `collected = true` and the `ItemSummary` repairs are persisted
 * with `writeState` before moving to the next record, so a crash mid-run
 * never leaves an earlier record's state stale.
 *
 * After a record is collected via `provider.collect` (not the pure-repair
 * path above), `provider.cleanup` runs once for it, best-effort - a
 * provider that defines one (OpenAI, spec 5.2) uses it to delete the
 * uploaded input file now that its results are safely on disk. A throwing
 * `cleanup` never fails the collect.
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

    const missingItemIds: string[] = [];
    for (const itemId of record.itemIds) {
      if (!(await exists(responsePath(dir, itemId)))) {
        missingItemIds.push(itemId);
      }
    }

    if (missingItemIds.length === 0) {
      // Every item already has a response file: a prior call wrote them
      // all but crashed before this record was marked collected. Repair
      // in place, never re-invoking the provider.
      for (const itemId of record.itemIds) {
        await repairFromExistingFile(state, itemId, responsePath(dir, itemId));
      }
      record.collected = true;
      dropActiveBatchId(state, record.handle.batchId);
      await writeState(dir, state);
      continue;
    }

    const itemIdSet = new Set(record.itemIds);
    const handle = toBatchHandle(record.handle);
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
      if (await exists(path)) {
        await repairFromExistingFile(state, result.itemId, path);
        continue;
      }

      const item = findItemSummary(state, result.itemId);
      if (!item) continue;

      if (item.ownerRound !== record.round) {
        // Spec 4.4: the item has moved on to a later round, so this result
        // must not touch its summary - but it was paid for and is evidence
        // of what the provider did, so it is written (never overwriting an
        // existing file) and logged rather than dropped.
        const response = result.ok
          ? mapRaw(result.raw, result.itemId)
          : undefined;
        await writeJsonAtomic(
          path,
          response !== undefined ? { result, response } : { result },
        );
        await appendEvent(dir, "integrity_stale_round", {
          batchId: record.handle.batchId,
          itemId: result.itemId,
          recordRound: record.round,
          ownerRound: item.ownerRound,
        });
        continue;
      }

      const response = result.ok
        ? mapRaw(result.raw, result.itemId)
        : undefined;
      applyResultToItem(item, result);

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

    await synthesizeUnresolvedItems(dir, state, record);

    record.collected = true;
    dropActiveBatchId(state, record.handle.batchId);
    await writeState(dir, state);

    if (provider.cleanup) {
      try {
        await provider.cleanup(handle);
      } catch {
        // best effort: a provider-side cleanup failure (e.g. an already
        // deleted input file) must never fail the collect itself.
      }
    }
  }

  return collected;
}
