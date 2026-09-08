/**
 * Chunk submission with a write-ahead intent and size re-chunking
 * (spec sections 4.3, 5, 9).
 *
 * {@link journalItems} writes a wave's items to `items.jsonl` and their
 * rendered requests to `requests/<itemId>.json`. Every caller runs it
 * BEFORE persisting the items' `ItemSummary`s and BEFORE
 * {@link submitChunks}, so a submission that is rejected or interrupted
 * always leaves a journal complete enough to resubmit exactly the items
 * that never reached the provider (`src/batch/resubmit.ts`).
 *
 * {@link submitChunks} then submits each chunk behind a fsynced
 * `intent.json`, in order: on
 * success the resulting `BatchRecord` is persisted into `state.json` and
 * the intent cleared; on a synchronous size rejection the chunk is halved
 * and both halves re-enter the same submission loop (same round, same item
 * ids, a fresh chunk number for the new half); on any other rejection the
 * intent is cleared and the run records `lastError`; any other thrown
 * error (a network failure) propagates with the intent left in place for
 * `advance`'s `submit-unknown` reconciliation (Task 9).
 *
 * @module src/batch/submit-wave
 */
import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import type { BatchItem, BatchProvider } from "../llm/batch/types.ts";
import { BatchSubmitRejected } from "../llm/batch/types.ts";
import type { BatchRecord, BatchRunState } from "./state.ts";
import { writeJsonAtomic, writeState } from "./state.ts";
import { requestPath, RUN_FILES } from "./paths.ts";
import { appendEvent, appendJsonl } from "./journal.ts";
import type { ItemLine } from "./journal.ts";
import type { Chunk } from "./chunking.ts";
import { halveChunk } from "./chunking.ts";
import type { RenderedItem } from "./render.ts";
import type { SubmissionIntent } from "./intent.ts";
import { clearIntent, writeIntent } from "./intent.ts";

export interface SubmitWaveDeps {
  provider: BatchProvider;
  model: string;
  wrap: (items: BatchItem[]) => unknown;
  now?: () => Date;
}

export type SubmitOutcome =
  | { kind: "submitted"; records: BatchRecord[] }
  | { kind: "rejected"; lastError: BatchRunState["lastError"] }
  | { kind: "blocked"; itemId: string; reason: string };

/**
 * Journals every item of `chunks` to `items.jsonl` and writes its rendered
 * request to `requests/<itemId>.json`. Callers run this BEFORE persisting
 * the matching `ItemSummary`s and before {@link submitChunks}: the journal
 * is what a later `retry`/`submit-pending` re-reads to resubmit an item
 * whose submission was rejected or interrupted, so an item that exists in
 * `state.json` but not here would be unrecoverable.
 *
 * Appending the same item twice is harmless (`loadJsonl` de-duplicates by
 * `itemId`, keeping the last write), so a resumed step may re-journal.
 */
export async function journalItems(
  dir: string,
  chunks: Chunk[],
  items: RenderedItem[],
  wave: 1 | 2,
  round: 0 | 1,
  now: () => Date = () => new Date(),
): Promise<void> {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const renderedAt = now().toISOString();
  const itemsJsonlPath = join(dir, RUN_FILES.items);
  await ensureDir(dirname(requestPath(dir, "_")));
  for (const chunk of chunks) {
    for (const chunkItem of chunk.items) {
      const rendered = byId.get(chunkItem.itemId);
      if (!rendered) {
        throw new Error(
          `journalItems: chunk ${chunk.chunk} names ${chunkItem.itemId}, which is not among the rendered items`,
        );
      }
      const line: ItemLine = {
        itemId: chunkItem.itemId,
        taskId: rendered.taskId,
        attempt: rendered.attempt,
        round,
        chunk: chunk.chunk,
        wave,
        bodyDigest: rendered.bodyDigest,
        body: chunkItem.body,
        renderedAt,
      };
      await appendJsonl(itemsJsonlPath, line);
      await writeJsonAtomic(
        requestPath(dir, chunkItem.itemId),
        rendered.request,
      );
    }
  }
}

/**
 * Submits `chunks` for `wave`/`round`, mutating `state` in place with every
 * successfully submitted `BatchRecord` (pushed to `state.batches` and
 * `state.activeBatchIds`, persisted via `writeState` per chunk). Every item
 * of every chunk must already be journaled by {@link journalItems}. See the
 * module doc for the full per-chunk protocol.
 */
export async function submitChunks(
  dir: string,
  state: BatchRunState,
  chunks: Chunk[],
  items: RenderedItem[],
  wave: 1 | 2,
  round: 0 | 1,
  deps: SubmitWaveDeps,
): Promise<SubmitOutcome> {
  const now = deps.now ?? (() => new Date());
  const byId = new Map(items.map((item) => [item.itemId, item]));

  const records: BatchRecord[] = [];
  const queue: Chunk[] = [...chunks];
  let nextChunkNumber = queue.reduce((max, c) => Math.max(max, c.chunk), -1) +
    1;
  let index = 0;

  while (index < queue.length) {
    const chunk = queue[index]!;
    const chunkItemIds = chunk.items.map((item) => item.itemId);
    const bodyDigests = chunkItemIds.map((id) => {
      const rendered = byId.get(id);
      if (!rendered) {
        throw new Error(
          `submitChunks: chunk ${chunk.chunk} names ${id}, which is not among the rendered items`,
        );
      }
      return rendered.bodyDigest;
    });
    const nonce = crypto.randomUUID();
    const intent: SubmissionIntent = {
      runId: state.runId,
      wave,
      round,
      chunk: chunk.chunk,
      itemIds: chunkItemIds,
      bodyDigests,
      nonce,
      writtenAt: now().toISOString(),
    };
    await writeIntent(dir, intent);

    try {
      const handle = await deps.provider.submit(
        deps.model,
        chunk.items,
        nonce,
        {
          onInputFile: (inputFileId) =>
            writeIntent(dir, { ...intent, inputFileId }),
        },
      );
      const record: BatchRecord = {
        wave,
        round,
        chunk: chunk.chunk,
        handle,
        submittedAt: now().toISOString(),
        providerStatus: "submitted",
        rawCounts: {},
        state: "processing",
        itemIds: chunkItemIds,
        collected: false,
      };
      state.batches.push(record);
      state.activeBatchIds.push(handle.batchId);
      await writeState(dir, state);
      await clearIntent(dir);
      records.push(record);
      index++;
    } catch (err) {
      if (!(err instanceof BatchSubmitRejected)) {
        // Network/unknown failure: the intent stays for submit-unknown
        // reconciliation (Task 9).
        throw err;
      }
      if (err.sizeLimit) {
        const halved = halveChunk(chunk, nextChunkNumber, deps.wrap);
        if (halved === null) {
          await clearIntent(dir);
          return {
            kind: "blocked",
            itemId: chunkItemIds[0]!,
            reason: err.message,
          };
        }
        const [left, right] = halved;
        nextChunkNumber++;
        await appendEvent(dir, "size_rechunk", {
          wave,
          round,
          fromChunk: chunk.chunk,
          leftChunk: left.chunk,
          rightChunk: right.chunk,
          itemIds: chunkItemIds,
          message: err.message,
        });
        queue.splice(index, 1, left, right);
        continue;
      }
      await clearIntent(dir);
      return {
        kind: "rejected",
        lastError: {
          at: now().toISOString(),
          step: "submit",
          message: err.message,
          retryable: err.retryable,
        },
      };
    }
  }

  return { kind: "submitted", records };
}
