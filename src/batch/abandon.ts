/**
 * `abandon`: mark a non-finalized run abandoned (spec sections 4.5, 5, 9).
 *
 * Cancels every batch still active (`provider.cancel`, when the provider
 * defines one) and best-effort cleans it up (`provider.cleanup`, when
 * defined), then flips `state.phase` to `"abandoned"` and empties
 * `activeBatchIds`. Never finalizes or ingests: an abandoned run has no
 * `resultsFile`/`ingestedRunId` (spec 4.5's transition table). A provider
 * with no `cancel` operation (OpenRouter today, spec 5.3) still marks the
 * run abandoned locally; the abandon just logs that nothing was cancelled
 * remotely instead of failing.
 *
 * @module src/batch/abandon
 */
import type { BatchProvider } from "../llm/batch/types.ts";
import type { BatchRecord, BatchRunState } from "./state.ts";
import { isTerminal, loadState, toBatchHandle, writeState } from "./state.ts";
import { withMutateLock } from "./mutate-lock.ts";
import { appendEvent } from "./journal.ts";
import { withTransportBackoff } from "./backoff.ts";

/**
 * Marks the run at `dir` `"abandoned"`. A no-op returning the state
 * unchanged when the run has already reached a terminal phase.
 */
export async function abandonRun(
  dir: string,
  provider: BatchProvider,
): Promise<BatchRunState> {
  return await withMutateLock(dir, async () => {
    const state = await loadState(dir);
    if (isTerminal(state.phase)) return state;

    const byBatchId = new Map(
      state.batches.map((b) => [b.handle.batchId, b] as const),
    );
    const activeRecords = state.activeBatchIds
      .map((id) => byBatchId.get(id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined);

    const cancel = provider.cancel?.bind(provider);
    if (cancel) {
      for (const record of activeRecords) {
        const handle = toBatchHandle(record.handle);
        try {
          await withTransportBackoff(() => cancel(handle));
        } catch {
          // best effort: an already-ended or already-cancelled batch is
          // not worth failing the abandon over.
        }
      }
    } else {
      console.log(
        `[batch] ${provider.provider} has no cancel operation; ` +
          `${activeRecords.length} active batch(es) will keep running on the provider side`,
      );
    }

    const cleanup = provider.cleanup?.bind(provider);
    if (cleanup) {
      for (const record of activeRecords) {
        const handle = toBatchHandle(record.handle);
        try {
          await withTransportBackoff(() => cleanup(handle));
        } catch {
          // best effort
        }
      }
    }

    state.phase = "abandoned";
    state.activeBatchIds = [];
    await writeState(dir, state);
    await appendEvent(dir, "abandoned", {
      activeBatchCount: activeRecords.length,
      hadCancel: provider.cancel !== undefined,
      batchIds: activeRecords.map((r: BatchRecord) => r.handle.batchId),
    });
    return state;
  });
}
