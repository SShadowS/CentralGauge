/**
 * Anthropic Message Batches provider (spec section 5.1).
 *
 * Wraps the subset of `@anthropic-ai/sdk`'s `client.messages.batches`
 * surface this provider needs. The SDK client is injected through
 * {@link AnthropicBatchClient} so unit tests can stub it without a real
 * network call; `registry.ts` constructs the real `Anthropic` client from
 * an API key and hands it straight to this constructor. The method
 * parameter/return shapes below are a deliberately looser structural
 * subset of the SDK's own types (mostly optional fields where the SDK's
 * are required), so a real `Anthropic` instance satisfies this interface
 * without a cast.
 *
 * @module src/llm/batch/anthropic-batch
 */
import type {
  BatchCandidate,
  BatchErrorKind,
  BatchHandle,
  BatchItem,
  BatchItemResult,
  BatchPoll,
  BatchProvider,
} from "./types.ts";
import { BatchSubmitRejected } from "./types.ts";

/** Anthropic's per-status request tallies (spec 5.1 `poll`/`listCandidates`). */
export interface AnthropicBatchRequestCounts {
  processing: number;
  succeeded: number;
  errored: number;
  canceled: number;
  expired: number;
}

/** The fields this provider reads off a `MessageBatch` record. */
export interface AnthropicBatchStatus {
  id: string;
  processing_status: "in_progress" | "canceling" | "ended";
  request_counts: AnthropicBatchRequestCounts;
  created_at: string;
}

/**
 * A single content block on a batch-succeeded message. Only text blocks
 * matter to `mapRaw` (spec D6); every other block type still structurally
 * satisfies this shape (`text` is optional).
 */
export interface AnthropicBatchContentBlock {
  type: string;
  text?: string;
}

/**
 * The fields this provider (and the batch runner's `mapRaw`, spec 5.1) read
 * off a succeeded batch item's `result.message`. A structural subset of the
 * SDK's `Anthropic.Message`, loose enough that a real message satisfies it.
 */
export interface AnthropicBatchMessage {
  model: string;
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  content: AnthropicBatchContentBlock[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    iterations?: ReadonlyArray<{ type?: string }>;
  };
}

/** The nested error object inside an `errored` result line's `error.error`. */
export interface AnthropicBatchErrorObject {
  type: string;
  message: string;
}

/** One line of `batches.results(id)`'s async iterable. */
export type AnthropicBatchResultLine = {
  custom_id: string;
  result:
    | { type: "succeeded"; message: AnthropicBatchMessage }
    | { type: "errored"; error: { error: AnthropicBatchErrorObject } }
    | { type: "expired" }
    | { type: "canceled" };
};

/**
 * A collection this provider only ever consumes via `for await`. The real
 * SDK returns an `AsyncIterable` (`JSONLDecoder`, `PagePromise`); a plain
 * array (a synchronous `Iterable`) works equally well with `for await` and
 * is what unit tests use to stub these two methods.
 */
export type AnthropicBatchAsyncOrSyncIterable<T> =
  | AsyncIterable<T>
  | Iterable<T>;

/** The subset of `client.messages.batches` this provider calls. */
export interface AnthropicBatchClient {
  messages: {
    batches: {
      create(
        params: { requests: Array<{ custom_id: string; params: unknown }> },
      ): Promise<AnthropicBatchStatus>;
      retrieve(id: string): Promise<AnthropicBatchStatus>;
      results(
        id: string,
      ): Promise<AnthropicBatchAsyncOrSyncIterable<AnthropicBatchResultLine>>;
      list(): AnthropicBatchAsyncOrSyncIterable<AnthropicBatchStatus>;
      cancel(id: string): Promise<AnthropicBatchStatus>;
    };
  };
}

const RETRYABLE_STATUSES = new Set([408, 409, 429, 529]);

function statusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

function messageOf(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(err);
}

function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return RETRYABLE_STATUSES.has(status) || (status >= 500 && status < 600);
}

function mentionsSizeLimit(message: string): boolean {
  return /limit/i.test(message) &&
    (/\bsize\b/i.test(message) || /request[ -]?count/i.test(message));
}

/**
 * Fails a submission the way the caller must see it. ONLY an error the API
 * actually answered with (an SDK `APIError`, which carries an HTTP
 * `status`) is a `BatchSubmitRejected`: `submitChunks` treats that as a
 * decided rejection and clears the write-ahead intent. A transport failure
 * (connection reset, timeout, abort, unparseable body) carries no status
 * and is rethrown unchanged, because the batch may well exist server-side
 * - that is exactly the case `intent.json` and spec 4.3's reconciliation
 * were built for.
 */
function throwSubmitFailure(err: unknown): never {
  const status = statusOf(err);
  if (status === undefined) throw err;
  const message = messageOf(err);
  throw new BatchSubmitRejected(
    message,
    status,
    isRetryableStatus(status),
    status === 413 || mentionsSizeLimit(message),
  );
}

function errorKindFromType(type: string): BatchErrorKind {
  switch (type) {
    case "overloaded_error":
      return "overloaded";
    case "rate_limit_error":
      return "rate_limited";
    case "api_error":
      return "server";
    case "invalid_request_error":
    case "authentication_error":
    case "permission_error":
    case "not_found_error":
      return "invalid_request";
    default:
      return "unknown";
  }
}

function isRetryableKind(kind: BatchErrorKind): boolean {
  return kind === "overloaded" || kind === "rate_limited" || kind === "server";
}

function sumRequestCounts(counts: AnthropicBatchRequestCounts): number {
  return counts.processing + counts.succeeded + counts.errored +
    counts.canceled + counts.expired;
}

function mapResultLine(entry: AnthropicBatchResultLine): BatchItemResult {
  const itemId = entry.custom_id;
  const { result } = entry;
  switch (result.type) {
    case "succeeded":
      return { itemId, ok: true, raw: result.message, httpStatus: 200 };
    case "errored": {
      const errorObject = result.error.error;
      const kind = errorKindFromType(errorObject.type);
      return {
        itemId,
        ok: false,
        raw: result.error,
        error: {
          kind,
          code: errorObject.type,
          message: errorObject.message,
          retryable: isRetryableKind(kind),
        },
      };
    }
    case "expired":
      return {
        itemId,
        ok: false,
        error: {
          kind: "expired",
          message: "batch item expired before it was processed",
          retryable: true,
        },
      };
    case "canceled":
      return {
        itemId,
        ok: false,
        error: {
          kind: "cancelled",
          message: "batch item was canceled",
          retryable: true,
        },
      };
    default: {
      const exhaustive: never = result;
      throw new Error(
        `unknown batch result type: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

/** Anthropic Message Batches provider (spec 5.1). */
export class AnthropicBatchProvider implements BatchProvider {
  readonly provider = "anthropic" as const;
  readonly limits: { maxItems: number; maxBytes: number };

  constructor(
    private readonly client: AnthropicBatchClient,
    limits?: Partial<{ maxItems: number; maxBytes: number }>,
  ) {
    this.limits = {
      maxItems: limits?.maxItems ?? 100_000,
      maxBytes: limits?.maxBytes ?? 256 * 1024 * 1024,
    };
  }

  async submit(
    _model: string,
    items: BatchItem[],
    _nonce: string,
  ): Promise<BatchHandle> {
    // Anthropic's Message Batches API has no metadata field, so `_nonce`
    // (unlike OpenAI's `metadata.nonce`) is never carried on the request,
    // and `listCandidates` below never returns one for this provider either.
    try {
      const batch = await this.client.messages.batches.create({
        requests: items.map((item) => ({
          custom_id: item.itemId,
          params: item.body,
        })),
      });
      return { provider: "anthropic", batchId: batch.id };
    } catch (err) {
      throwSubmitFailure(err);
    }
  }

  async poll(handle: BatchHandle): Promise<BatchPoll> {
    const batch = await this.client.messages.batches.retrieve(handle.batchId);
    return {
      processing: batch.processing_status !== "ended",
      providerStatus: batch.processing_status,
      rawCounts: {
        processing: batch.request_counts.processing,
        succeeded: batch.request_counts.succeeded,
        errored: batch.request_counts.errored,
        canceled: batch.request_counts.canceled,
        expired: batch.request_counts.expired,
      },
    };
  }

  async collect(handle: BatchHandle): Promise<BatchItemResult[]> {
    const results: BatchItemResult[] = [];
    const lines = await this.client.messages.batches.results(handle.batchId);
    for await (const entry of lines) {
      results.push(mapResultLine(entry));
    }
    return results;
  }

  async listCandidates(since: Date): Promise<BatchCandidate[]> {
    const candidates: BatchCandidate[] = [];
    for await (const batch of this.client.messages.batches.list()) {
      const createdAt = new Date(batch.created_at);
      if (createdAt < since) break;
      candidates.push({
        batchId: batch.id,
        createdAt,
        total: sumRequestCounts(batch.request_counts),
        ended: batch.processing_status === "ended",
      });
    }
    return candidates;
  }

  async cancel(handle: BatchHandle): Promise<void> {
    await this.client.messages.batches.cancel(handle.batchId);
  }
}
