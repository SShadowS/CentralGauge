/**
 * OpenAI Batch API provider (spec section 5.2).
 *
 * Wraps the subset of `@openai/openai`'s `client.files` and `client.batches`
 * surface this provider needs. The SDK client is injected through
 * {@link OpenAIBatchClient} so unit tests can stub it without a real network
 * call; `registry.ts` constructs the real `OpenAI` client from an API key
 * and hands it straight to this constructor. The method parameter/return
 * shapes below are a deliberately looser structural subset of the SDK's own
 * types (mostly optional fields where the SDK's are required), so a real
 * `OpenAI` instance satisfies this interface without a cast.
 *
 * Unlike Anthropic's Message Batches API, OpenAI's Batch API is a two-step
 * flow: upload a JSONL file of requests (`files.create`), then create a
 * batch pointing at that file (`batches.create`). Results come back as two
 * files - `output_file_id` for succeeded lines, `error_file_id` for failed
 * ones - fetched via `files.content`. `metadata.nonce` round-trips through
 * `batches.list`, which is what lets `listCandidates` (and reconciliation,
 * spec 4.3) identify a submission with certainty instead of Anthropic's
 * weaker total/id-set matching.
 *
 * @module src/llm/batch/openai-batch
 */
import type {
  BatchCandidate,
  BatchErrorKind,
  BatchHandle,
  BatchItem,
  BatchItemResult,
  BatchPoll,
  BatchProvider,
  SubmitHooks,
} from "./types.ts";
import { BatchSubmitRejected } from "./types.ts";

/** The OpenAI Batch API endpoint this provider submits requests to (spikes findings, section 2). */
export const OPENAI_BATCH_ENDPOINT = "/v1/chat/completions";

/** Set of key-value string pairs OpenAI stores on a batch (spec 5.2). */
export type OpenAIBatchMetadata = Record<string, string>;

/** `batch.request_counts` (spec 5.2 `poll`/`listCandidates`); absent before validation starts. */
export interface OpenAIBatchRequestCounts {
  total: number;
  completed: number;
  failed: number;
}

/** One entry in a failed batch's `errors.data[]`. */
export interface OpenAIBatchErrorEntry {
  code?: string;
  message?: string;
  param?: string | null;
  line?: number | null;
}

export type OpenAIBatchStatusValue =
  | "validating"
  | "in_progress"
  | "finalizing"
  | "completed"
  | "failed"
  | "expired"
  | "cancelling"
  | "cancelled";

/** The fields this provider reads off a `Batch` record. */
export interface OpenAIBatchStatus {
  id: string;
  status: OpenAIBatchStatusValue;
  created_at: number;
  request_counts?: OpenAIBatchRequestCounts;
  output_file_id?: string | null;
  error_file_id?: string | null;
  errors?: { data?: OpenAIBatchErrorEntry[] } | null;
  metadata?: OpenAIBatchMetadata | null;
}

/** The fields this provider reads off a `FileObject` returned by `files.create`/`files.list`. */
export interface OpenAIBatchFile {
  id: string;
  filename?: string;
}

/** One line of an output or error file: both use the same shape (spec 5.2). */
export interface OpenAIBatchResultLine {
  custom_id: string;
  response?: { status_code: number; body: unknown } | null;
  error?: { code?: string; message?: string } | null;
}

/** A `Response`-shaped file-content result: only `.text()` is read. */
export interface OpenAIBatchFileContent {
  text(): Promise<string>;
}

/**
 * A collection this provider only ever consumes via `for await`. The real
 * SDK returns a `PagePromise` (async-iterable without pre-awaiting, same as
 * Anthropic's own list surface); a plain array (a synchronous `Iterable`)
 * works equally well with `for await` and is what unit tests use to stub
 * these methods.
 */
export type OpenAIBatchAsyncOrSyncIterable<T> = AsyncIterable<T> | Iterable<T>;

/** The subset of the `OpenAI` client this provider calls. */
export interface OpenAIBatchClient {
  files: {
    create(
      params: { file: File; purpose: "batch" },
    ): Promise<OpenAIBatchFile>;
    content(id: string): Promise<OpenAIBatchFileContent>;
    delete(id: string): Promise<unknown>;
    list(): OpenAIBatchAsyncOrSyncIterable<OpenAIBatchFile>;
  };
  batches: {
    create(params: {
      input_file_id: string;
      endpoint: typeof OPENAI_BATCH_ENDPOINT;
      completion_window: "24h";
      metadata?: OpenAIBatchMetadata;
    }): Promise<OpenAIBatchStatus>;
    retrieve(id: string): Promise<OpenAIBatchStatus>;
    list(): OpenAIBatchAsyncOrSyncIterable<OpenAIBatchStatus>;
    cancel(id: string): Promise<OpenAIBatchStatus>;
  };
}

/** `validating | in_progress | finalizing | cancelling` (spec 5.2's `poll` status mapping). */
const PROCESSING_STATUSES = new Set<OpenAIBatchStatusValue>([
  "validating",
  "in_progress",
  "finalizing",
  "cancelling",
]);

/** `completed | failed | expired | cancelled` - the complement of {@link PROCESSING_STATUSES}. */
const ENDED_STATUSES = new Set<OpenAIBatchStatusValue>([
  "completed",
  "failed",
  "expired",
  "cancelled",
]);

const RETRYABLE_SUBMIT_STATUSES = new Set([408, 409, 429]);

function statusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

function messageOf(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(err);
}

function isRetryableSubmitStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return RETRYABLE_SUBMIT_STATUSES.has(status) ||
    (status >= 500 && status < 600);
}

/**
 * Whether `text` names a size, byte, or file-size limit (spec 5.2's
 * submission-rejection and 5.3's async-rejection mapping). `code` fields
 * like `file_size_limit_exceeded` are snake_case, and `_` is a word
 * character to `\b`, so the underscore-separated words never form a
 * boundary on their own; normalizing separators to spaces first gives every
 * `\b` a real boundary to match against.
 */
function mentionsSizeLimit(text: string): boolean {
  const normalized = text.replace(/[_-]/g, " ");
  return /\blimit\b/i.test(normalized) &&
    (/\bsize\b/i.test(normalized) || /\bbyte/i.test(normalized) ||
      /file size/i.test(normalized));
}

/**
 * Fails a submission the way the caller must see it. ONLY an error the API
 * actually answered with (an SDK `APIError`, which carries an HTTP
 * `status`) is a `BatchSubmitRejected`: `submitChunks` treats that as a
 * decided rejection and clears the write-ahead intent. A transport failure
 * (connection reset, timeout, abort) carries no status and is rethrown
 * unchanged, because the batch may well exist server-side - that is
 * exactly the case `intent.json` and spec 4.3's reconciliation were built
 * for.
 */
function throwSubmitFailure(err: unknown): never {
  const status = statusOf(err);
  if (status === undefined) throw err;
  const message = messageOf(err);
  throw new BatchSubmitRejected(
    message,
    status,
    isRetryableSubmitStatus(status),
    mentionsSizeLimit(message),
  );
}

/** Whether a failed batch's `errors.data[]` names a size/byte limit (spec 5.3's async rejection). */
function batchErrorsMentionSizeLimit(
  errors: OpenAIBatchStatus["errors"],
): boolean {
  const entries = errors?.data ?? [];
  return entries.some((entry) =>
    mentionsSizeLimit(entry.code ?? "") ||
    mentionsSizeLimit(entry.message ?? "")
  );
}

/** Maps an output/error line's HTTP status to a `BatchItemResult` error kind (spec 5.2). */
function classifyStatusCode(
  status: number,
): { kind: BatchErrorKind; retryable: boolean } {
  if (status === 429) return { kind: "rate_limited", retryable: true };
  if (status === 500 || status === 502 || status === 503) {
    return { kind: "server", retryable: true };
  }
  if (status === 529) return { kind: "overloaded", retryable: true };
  if (status >= 400 && status < 500) {
    return { kind: "invalid_request", retryable: false };
  }
  return { kind: "unknown", retryable: false };
}

/**
 * Maps one output- or error-file line to a `BatchItemResult`. Callers decide
 * the `integrity` case (an id present in both files) before falling back to
 * this function.
 */
function mapResultLine(line: OpenAIBatchResultLine): BatchItemResult {
  const itemId = line.custom_id;
  const status = line.response?.status_code;

  if (status === 200) {
    return { itemId, ok: true, raw: line.response!.body, httpStatus: 200 };
  }

  if (status !== undefined) {
    const { kind, retryable } = classifyStatusCode(status);
    return {
      itemId,
      ok: false,
      raw: line.response?.body,
      error: {
        kind,
        ...(line.error?.code !== undefined ? { code: line.error.code } : {}),
        message: line.error?.message ?? `http ${status}`,
        retryable,
      },
    };
  }

  return {
    itemId,
    ok: false,
    error: {
      kind: "unknown",
      ...(line.error?.code !== undefined ? { code: line.error.code } : {}),
      message: line.error?.message ?? "unknown batch error",
      retryable: false,
    },
  };
}

/** Builds one JSONL line for `item` (spec 5.2's submission envelope). */
function jsonlLine(item: BatchItem): string {
  return JSON.stringify({
    custom_id: item.itemId,
    method: "POST",
    url: OPENAI_BATCH_ENDPOINT,
    body: item.body,
  });
}

/** Parses a downloaded output/error file's JSONL text into result lines. */
function parseJsonl(text: string): OpenAIBatchResultLine[] {
  return text.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as OpenAIBatchResultLine);
}

/** OpenAI Batch API provider (spec 5.2). */
export class OpenAIBatchProvider implements BatchProvider {
  readonly provider = "openai" as const;
  readonly limits: { maxItems: number; maxBytes: number };

  constructor(
    private readonly client: OpenAIBatchClient,
    limits?: Partial<{ maxItems: number; maxBytes: number }>,
  ) {
    this.limits = {
      maxItems: limits?.maxItems ?? 50_000,
      maxBytes: limits?.maxBytes ?? 200 * 1024 * 1024,
    };
  }

  async submit(
    _model: string,
    items: BatchItem[],
    nonce: string,
    hooks?: SubmitHooks,
  ): Promise<BatchHandle> {
    const jsonl = items.map(jsonlLine).join("\n");
    const filename = `batch-${nonce}.jsonl`;

    let inputFileId: string;
    try {
      const file = await this.client.files.create({
        file: new File([jsonl], filename, { type: "application/jsonl" }),
        purpose: "batch",
      });
      inputFileId = file.id;
    } catch (err) {
      throwSubmitFailure(err);
    }

    await hooks?.onInputFile?.(inputFileId);

    try {
      const batch = await this.client.batches.create({
        input_file_id: inputFileId,
        endpoint: OPENAI_BATCH_ENDPOINT,
        completion_window: "24h",
        metadata: { nonce },
      });
      return {
        provider: "openai",
        batchId: batch.id,
        extra: { inputFileId, nonce },
      };
    } catch (err) {
      if (statusOf(err) === undefined) {
        // Transport failure: the create request may have reached the API,
        // so a batch referencing this file may exist. Delete nothing and
        // rethrow, leaving `intent.json` (with its `inputFileId`) to drive
        // reconciliation.
        throw err;
      }
      try {
        await this.client.files.delete(inputFileId);
      } catch {
        // best effort: the upload already exists remotely, but the batch
        // never started, so nothing else depends on this cleanup succeeding.
      }
      throwSubmitFailure(err);
    }
  }

  async poll(handle: BatchHandle): Promise<BatchPoll> {
    const batch = await this.client.batches.retrieve(handle.batchId);
    const counts = batch.request_counts ??
      { total: 0, completed: 0, failed: 0 };
    const extra: Record<string, string> = {};
    if (batch.output_file_id) extra["outputFileId"] = batch.output_file_id;
    if (batch.error_file_id) extra["errorFileId"] = batch.error_file_id;
    const sizeRejected = batch.status === "failed" &&
      batchErrorsMentionSizeLimit(batch.errors);

    return {
      processing: PROCESSING_STATUSES.has(batch.status),
      providerStatus: batch.status,
      rawCounts: {
        total: counts.total,
        completed: counts.completed,
        failed: counts.failed,
      },
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
      ...(sizeRejected ? { sizeRejected: true } : {}),
    };
  }

  async collect(handle: BatchHandle): Promise<BatchItemResult[]> {
    // Self-sufficient: a real handle carries only `inputFileId`/`nonce`
    // (`submit`'s own extras) unless a caller has already merged `poll`'s
    // extras onto it, so re-retrieve the batch here rather than trust
    // `handle.extra` to already hold the output/error file ids.
    const batch = await this.client.batches.retrieve(handle.batchId);
    let outputFileId = batch.output_file_id ?? undefined;
    let errorFileId = batch.error_file_id ?? undefined;
    if (outputFileId === undefined && errorFileId === undefined) {
      outputFileId = handle.extra?.["outputFileId"];
      errorFileId = handle.extra?.["errorFileId"];
    }

    const outputLines = outputFileId
      ? parseJsonl(
        await (await this.client.files.content(outputFileId)).text(),
      )
      : [];
    const errorLines = errorFileId
      ? parseJsonl(
        await (await this.client.files.content(errorFileId)).text(),
      )
      : [];

    const errorIds = new Set(errorLines.map((line) => line.custom_id));
    const results: BatchItemResult[] = [];
    const seen = new Set<string>();

    for (const line of outputLines) {
      seen.add(line.custom_id);
      if (errorIds.has(line.custom_id)) {
        results.push({
          itemId: line.custom_id,
          ok: false,
          error: {
            kind: "integrity",
            retryable: false,
            message:
              `item ${line.custom_id} appears in both the output and error files`,
          },
        });
        continue;
      }
      results.push(mapResultLine(line));
    }

    for (const line of errorLines) {
      if (seen.has(line.custom_id)) continue;
      results.push(mapResultLine(line));
    }

    return results;
  }

  async listCandidates(since: Date): Promise<BatchCandidate[]> {
    const candidates: BatchCandidate[] = [];
    const sinceMs = since.getTime();
    for await (const batch of this.client.batches.list()) {
      const createdAtMs = batch.created_at * 1000;
      if (createdAtMs < sinceMs) continue;
      const total = batch.request_counts?.total;
      const nonce = batch.metadata?.["nonce"];
      const model = batch.metadata?.["model"];
      candidates.push({
        batchId: batch.id,
        createdAt: new Date(createdAtMs),
        ...(total !== undefined ? { total } : {}),
        ...(nonce !== undefined ? { nonce } : {}),
        ...(model !== undefined ? { model } : {}),
        ended: ENDED_STATUSES.has(batch.status),
      });
    }
    return candidates;
  }

  async cancel(handle: BatchHandle): Promise<void> {
    await this.client.batches.cancel(handle.batchId);
  }

  /**
   * Deletes the input file this handle uploaded, then best-effort sweeps
   * any other file whose filename carries this run's nonce (an orphan left
   * behind by a re-chunked or abandoned submission). `extra.inputFileId` is
   * absent on a handle adopted through reconciliation, which has no direct
   * record of its own upload; the nonce sweep alone still finds it.
   */
  async cleanup(handle: BatchHandle): Promise<void> {
    const inputFileId = handle.extra?.["inputFileId"];
    const nonce = handle.extra?.["nonce"];

    if (inputFileId) {
      try {
        await this.client.files.delete(inputFileId);
      } catch {
        // best effort
      }
    }

    if (!nonce) return;
    try {
      for await (const file of this.client.files.list()) {
        if (file.id === inputFileId) continue;
        if (file.filename?.includes(nonce)) {
          try {
            await this.client.files.delete(file.id);
          } catch {
            // best effort
          }
        }
      }
    } catch {
      // best effort: listing files failed; nothing more to clean up here.
    }
  }
}
