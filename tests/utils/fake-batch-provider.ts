import type {
  BatchCandidate,
  BatchHandle,
  BatchItem,
  BatchItemResult,
  BatchPoll,
  BatchProvider,
  BatchProviderName,
  BatchSubmitRejected,
} from "../../src/llm/batch/types.ts";

/** One entry per `submit` call; consumed in order. */
interface FakeSubmitEntry {
  throws?: BatchSubmitRejected;
  handleId?: string;
}

export interface FakeScript {
  /** Consumed per `submit` call, in order. */
  submit?: FakeSubmitEntry[];
  /** Per batchId, consumed per `poll` call; the last entry repeats. */
  poll?: Record<string, BatchPoll[]>;
  collect?: Record<string, BatchItemResult[]>;
  candidates?: BatchCandidate[];
  /** For adoption validation. */
  collectByCandidate?: Record<string, BatchItemResult[]>;
}

export class FakeBatchProvider implements BatchProvider {
  readonly provider: BatchProviderName;
  readonly limits: { maxItems: number; maxBytes: number };
  readonly calls: Array<{ op: string; args: unknown[] }> = [];

  private readonly script: FakeScript;
  private readonly submittedByBatch = new Map<string, BatchItem[]>();
  private readonly pollQueues = new Map<string, BatchPoll[]>();
  private nextHandleId = 1;

  constructor(
    provider: BatchProviderName,
    script: FakeScript,
    limits: { maxItems: number; maxBytes: number } = {
      maxItems: 1000,
      maxBytes: 1_000_000,
    },
  ) {
    this.provider = provider;
    this.script = script;
    this.limits = limits;
  }

  submit(
    model: string,
    items: BatchItem[],
    nonce: string,
  ): Promise<BatchHandle> {
    this.calls.push({ op: "submit", args: [model, items, nonce] });
    const entry = this.script.submit?.shift();
    if (entry?.throws) {
      return Promise.reject(entry.throws);
    }
    const batchId = entry?.handleId ?? `fake-${this.nextHandleId++}`;
    this.submittedByBatch.set(batchId, items);
    return Promise.resolve({ provider: this.provider, batchId });
  }

  poll(handle: BatchHandle): Promise<BatchPoll> {
    this.calls.push({ op: "poll", args: [handle] });
    let queue = this.pollQueues.get(handle.batchId);
    if (queue === undefined) {
      const scripted = this.script.poll?.[handle.batchId];
      queue = scripted ? [...scripted] : [];
      this.pollQueues.set(handle.batchId, queue);
    }
    if (queue.length > 1) {
      return Promise.resolve(queue.shift()!);
    }
    if (queue.length === 1) {
      return Promise.resolve(queue[0]!);
    }
    const succeeded = this.submittedByBatch.get(handle.batchId)?.length ?? 0;
    return Promise.resolve({
      processing: false,
      providerStatus: "ended",
      rawCounts: { succeeded },
    });
  }

  collect(handle: BatchHandle): Promise<BatchItemResult[]> {
    this.calls.push({ op: "collect", args: [handle] });
    const scripted = this.script.collect?.[handle.batchId];
    if (scripted) {
      return Promise.resolve(scripted);
    }
    const items = this.submittedByBatch.get(handle.batchId) ?? [];
    return Promise.resolve(
      items.map((item): BatchItemResult => ({
        itemId: item.itemId,
        ok: true,
        raw: { itemId: item.itemId },
        httpStatus: 200,
      })),
    );
  }

  listCandidates(since: Date): Promise<BatchCandidate[]> {
    this.calls.push({ op: "listCandidates", args: [since] });
    const candidates = this.script.candidates ?? [];
    return Promise.resolve(candidates.filter((c) => c.createdAt >= since));
  }

  cancel(handle: BatchHandle): Promise<void> {
    this.calls.push({ op: "cancel", args: [handle] });
    return Promise.resolve();
  }

  cleanup(handle: BatchHandle): Promise<void> {
    this.calls.push({ op: "cleanup", args: [handle] });
    return Promise.resolve();
  }

  submittedItems(batchId: string): BatchItem[] {
    return this.submittedByBatch.get(batchId) ?? [];
  }
}
