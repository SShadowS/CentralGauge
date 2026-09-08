/**
 * Batch mode types
 *
 * Provider-agnostic contract for submitting LLM requests as an asynchronous
 * batch job (Anthropic Message Batches, OpenAI Batch API, OpenRouter batch
 * beta) rather than one synchronous call per item.
 */

export type BatchProviderName = "anthropic" | "openai" | "openrouter";

export interface BatchItem {
  itemId: string;
  body: unknown;
}

export interface BatchHandle {
  provider: BatchProviderName;
  batchId: string;
  extra?: Record<string, string>;
}

export interface BatchPoll {
  processing: boolean;
  providerStatus: string;
  rawCounts: Record<string, number>;
  extra?: Record<string, string>;
  providerReportedCostUsd?: number;
  /** Asynchronous validation failed on size (spec section 5.3). */
  sizeRejected?: boolean;
}

export type BatchItemResult =
  | { itemId: string; ok: true; raw: unknown; httpStatus: number }
  | {
    itemId: string;
    ok: false;
    raw?: unknown;
    error: {
      kind: BatchErrorKind;
      code?: string;
      message: string;
      retryable: boolean;
    };
  };

export type BatchErrorKind =
  | "expired"
  | "cancelled"
  | "overloaded"
  | "rate_limited"
  | "server"
  | "invalid_request"
  | "integrity"
  | "unknown";

export interface BatchCandidate {
  batchId: string;
  createdAt: Date;
  total?: number;
  nonce?: string;
  model?: string;
  ended: boolean;
}

export class BatchSubmitRejected extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly retryable: boolean,
    public readonly sizeLimit: boolean,
  ) {
    super(message);
    this.name = "BatchSubmitRejected";
  }
}

/**
 * Optional per-submission callbacks a `BatchProvider.submit` implementation
 * may invoke. Only OpenAI's provider calls `onInputFile` today (it uploads
 * an input file before creating the batch, and the caller needs that file
 * id persisted into the write-ahead intent before the batch is created in
 * case the process crashes in between); every other provider ignores it.
 */
export interface SubmitHooks {
  onInputFile?: (inputFileId: string) => Promise<void>;
}

export interface BatchProvider {
  readonly provider: BatchProviderName;
  /** Throws {@link BatchSubmitRejected} on a synchronous submission rejection. */
  submit(
    model: string,
    items: BatchItem[],
    nonce: string,
    hooks?: SubmitHooks,
  ): Promise<BatchHandle>;
  poll(handle: BatchHandle): Promise<BatchPoll>;
  /** Only called after {@link poll} reported `processing: false`. */
  collect(handle: BatchHandle): Promise<BatchItemResult[]>;
  listCandidates(since: Date): Promise<BatchCandidate[]>;
  cancel?(handle: BatchHandle): Promise<void>;
  cleanup?(handle: BatchHandle): Promise<void>;
  /** Conservative, configurable. */
  readonly limits: { maxItems: number; maxBytes: number };
}
