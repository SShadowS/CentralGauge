/**
 * OpenRouter beta batches provider (spec section 5.3).
 *
 * Unlike Anthropic and OpenAI, OpenRouter has no vendor SDK surface for
 * batches - this provider talks directly to `POST/GET
 * https://openrouter.ai/api/beta/batches` over an injected `fetch`-shaped
 * transport, so unit tests can stub it without a real network call.
 * `registry.ts` constructs this provider from the global `fetch` and a
 * resolved API key.
 *
 * OpenRouter's batch create/get responses carry results INLINE on the
 * batch record itself once `status: "completed"` (no separate output/error
 * files the way OpenAI's Batch API works) - see
 * `docs/superpowers/specs/2026-09-06-batch-spikes-findings.md` section 3.
 *
 * @module src/llm/batch/openrouter-batch
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

/** OpenRouter's beta batches endpoint this provider submits requests to. */
export const OPENROUTER_BATCH_URL = "https://openrouter.ai/api/beta/batches";

/** The chat-completions endpoint named in every batch's `endpoint` field (spikes findings, section 3). */
export const OPENROUTER_BATCH_ENDPOINT = "/v1/chat/completions";

/**
 * Half of 4096: the largest item count that both accepted (`202`) AND
 * completed cleanly in the spike run. See
 * `docs/superpowers/specs/2026-09-06-batch-spikes-findings.md` section 3,
 * "initial adapter limits".
 */
export const OPENROUTER_BATCH_MAX_ITEMS = 2_048;

/**
 * Half of ~2048 KiB (2,097,152 bytes): the largest single-item body that
 * both accepted AND completed cleanly - NOT half of the 4096 KiB value,
 * which failed at processing on the target model's own context window
 * rather than surviving. See
 * `docs/superpowers/specs/2026-09-06-batch-spikes-findings.md` section 3,
 * "initial adapter limits".
 */
export const OPENROUTER_BATCH_MAX_BYTES = 1_048_576;

/**
 * OpenRouter rejects batch CREATION with `429 entity-ratelimit` after
 * ~16 creations in a rolling minute (spikes findings, section 3). The
 * provider paces itself to half that ceiling.
 */
const MAX_CREATIONS_PER_WINDOW = 8;
const CREATION_WINDOW_MS = 60_000;

export type OpenRouterBatchStatusValue =
  | "validating"
  | "in_progress"
  | "finalizing"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled";

/** `completed | failed | expired | cancelled` - `poll`'s `processing` is the complement. */
const ENDED_STATUSES = new Set<OpenRouterBatchStatusValue>([
  "completed",
  "failed",
  "expired",
  "cancelled",
]);

export interface OpenRouterBatchRequestCounts {
  total: number;
  completed: number;
  failed: number;
}

/** Batch-level aggregate usage/cost, `null` until `completed` (spikes findings, section 3). */
export interface OpenRouterBatchUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number | null;
  is_byok?: boolean;
}

/** Batch-level error, populated when `status: "failed"`. */
export interface OpenRouterBatchError {
  message: string;
  code?: number;
}

/** One entry of a completed batch's inline `results[]` (spikes findings, section 3). */
export interface OpenRouterBatchResultEntry {
  id?: string;
  custom_id: string;
  response?: { status_code: number; request_id?: string; body: unknown } | null;
  error?: { message?: string; code?: string | number } | null;
}

/** The fields this provider reads off a batch create/get response. */
export interface OpenRouterBatchRecord {
  id: string;
  object?: string;
  endpoint?: string;
  model: string;
  completion_window?: string;
  status: OpenRouterBatchStatusValue;
  created_at: number;
  finalized_at?: number | null;
  request_counts?: OpenRouterBatchRequestCounts;
  usage?: OpenRouterBatchUsage | null;
  error?: OpenRouterBatchError | null;
  results?: OpenRouterBatchResultEntry[] | null;
}

/** The `data`-wrapped list shape `GET /api/beta/batches?created_after=...` returns. */
interface OpenRouterBatchList {
  data?: OpenRouterBatchRecord[];
}

export interface OpenRouterBatchDeps {
  /** `fetch`-shaped transport; production wiring passes the global `fetch`. */
  fetch: typeof fetch;
  apiKey: string;
  /** Override for tests only; defaults to {@link OPENROUTER_BATCH_URL}. */
  baseUrl?: string;
  /** Injectable clock for creation-pacing tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Injectable sleep for creation-pacing tests. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Whether `message` names a size/byte/token-count/item-count limit
 * (spec 5.3's submission-rejection and async `sizeRejected` mapping).
 * Deliberately does NOT match on the bare word "limit" alone, nor on a
 * bare "too many": a 429 ("Rate limit exceeded", "Too many requests")
 * read as a size rejection would halve the chunk and create MORE batches
 * under the very limit being hit. "Too many" counts only when what there
 * are too many of is part of the payload.
 */
function mentionsSizeLimit(message: string): boolean {
  const m = message.toLowerCase();
  if (/too many (items|lines)\b/.test(m)) return true;
  if (/too many requests in\b.*\bbatch/.test(m)) return true;
  return /\b(size|byte|token|item|count)/.test(m) &&
    /(limit|maximum|max\b|exceed)/.test(m);
}

const RETRYABLE_SUBMIT_STATUSES = new Set([408, 409, 429]);

function isRetryableSubmitStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return RETRYABLE_SUBMIT_STATUSES.has(status) ||
    (status >= 500 && status < 600);
}

function toBatchSubmitRejected(
  status: number | undefined,
  message: string,
): BatchSubmitRejected {
  return new BatchSubmitRejected(
    message,
    status,
    isRetryableSubmitStatus(status),
    status === 413 || mentionsSizeLimit(message),
  );
}

/** Reads `{"error":{"message": "..."}}` off a non-2xx response body, best effort. */
async function errorMessageFrom(response: Response): Promise<string> {
  try {
    const data = await response.json() as { error?: { message?: string } };
    if (typeof data?.error?.message === "string") return data.error.message;
  } catch {
    // fall through to a generic message
  }
  return `http ${response.status}`;
}

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
 * Maps one inline result entry to a `BatchItemResult` (spikes findings,
 * section 3).
 *
 * Classification order: an entry carrying `response.status_code` classifies
 * by that HTTP status (`classifyStatusCode`); an entry with no status but
 * with `error.code` classifies by that code instead, numeric or string
 * (OpenRouter emits both shapes); an entry with neither falls to `unknown`,
 * non-retryable.
 *
 * The live spike behind this classifier (Task 1, design doc section 4, D3)
 * pinned a one-item batch to a dead upstream via `allow_fallbacks: false`.
 * It did NOT fail fast: both spike batches sat `status: "in_progress"` with
 * `request_counts {"total":1,"completed":0,"failed":0}` for the full 50
 * minutes observed and never produced a result entry, so the outage case
 * never surfaced a `status_code` or `error.code` to classify. Of the D3
 * candidate rows only "prolonged in_progress" is confirmed for a dead pin;
 * the 429/500, 404, error-only, and batch-level failed/expired rows below
 * remain unconfirmed against a real dead-upstream pin and are exercised
 * here only via constructed fixtures. A pinned outage is therefore this
 * function's business only once the provider eventually produces a result
 * line - detecting a batch that never finishes at all is the poll/deadline
 * layer's job, not this classifier's.
 */
function mapResultLine(entry: OpenRouterBatchResultEntry): BatchItemResult {
  const itemId = entry.custom_id;
  const status = entry.response?.status_code;

  if (status === 200) {
    return { itemId, ok: true, raw: entry.response!.body, httpStatus: 200 };
  }

  if (status !== undefined) {
    const { kind, retryable } = classifyStatusCode(status);
    return {
      itemId,
      ok: false,
      raw: entry.response?.body,
      error: {
        kind,
        message: entry.error?.message ?? `http ${status}`,
        retryable,
      },
    };
  }

  // Error-only entry: no HTTP status on the entry, but OpenRouter still
  // names the failure in `error.code`, numeric or string (spec D3 table).
  // Collapsing these to `unknown` used to make a rate-limited pinned
  // upstream non-retryable.
  const rawCode = entry.error?.code;
  const numericCode = typeof rawCode === "number"
    ? rawCode
    : typeof rawCode === "string" && /^\d{3}$/.test(rawCode)
    ? Number(rawCode)
    : undefined;
  if (numericCode !== undefined) {
    const { kind, retryable } = classifyStatusCode(numericCode);
    return {
      itemId,
      ok: false,
      error: {
        kind,
        message: entry.error?.message ?? `error ${numericCode}`,
        retryable,
      },
    };
  }
  return {
    itemId,
    ok: false,
    error: {
      kind: "unknown",
      message: entry.error?.message ?? "unknown batch error",
      retryable: false,
    },
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** OpenRouter beta batches provider (spec 5.3). */
export class OpenRouterBatchProvider implements BatchProvider {
  readonly provider = "openrouter" as const;
  readonly limits: { maxItems: number; maxBytes: number };

  private readonly fetchFn: typeof fetch;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  /** Timestamps (ms, via `now()`) of this instance's own creation calls, oldest first. */
  private readonly creationTimestamps: number[] = [];

  constructor(
    deps: OpenRouterBatchDeps,
    limits?: Partial<{ maxItems: number; maxBytes: number }>,
  ) {
    this.fetchFn = deps.fetch;
    this.apiKey = deps.apiKey;
    this.baseUrl = deps.baseUrl ?? OPENROUTER_BATCH_URL;
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? defaultSleep;
    this.limits = {
      maxItems: limits?.maxItems ?? OPENROUTER_BATCH_MAX_ITEMS,
      maxBytes: limits?.maxBytes ?? OPENROUTER_BATCH_MAX_BYTES,
    };
  }

  private headers(): HeadersInit {
    return {
      "Authorization": `Bearer ${this.apiKey}`,
      "HTTP-Referer": "https://github.com/centralgauge",
      "X-Title": "CentralGauge",
      "Content-Type": "application/json",
    };
  }

  /**
   * Blocks until fewer than {@link MAX_CREATIONS_PER_WINDOW} of this
   * instance's own creation calls fall inside the last
   * {@link CREATION_WINDOW_MS} - OpenRouter's per-account creation rate
   * limit is shared across every submitter, so this is a conservative
   * self-imposed pace, not a guarantee against a 429 from other traffic.
   */
  private async waitForCreationSlot(): Promise<void> {
    for (;;) {
      const cutoff = this.now() - CREATION_WINDOW_MS;
      while (
        this.creationTimestamps.length > 0 &&
        this.creationTimestamps[0]! <= cutoff
      ) {
        this.creationTimestamps.shift();
      }
      if (this.creationTimestamps.length < MAX_CREATIONS_PER_WINDOW) {
        return;
      }
      const waitMs = this.creationTimestamps[0]! + CREATION_WINDOW_MS -
        this.now();
      await this.sleep(Math.max(waitMs, 0));
    }
  }

  async submit(
    model: string,
    items: BatchItem[],
    _nonce: string,
    _hooks?: SubmitHooks,
  ): Promise<BatchHandle> {
    // OpenRouter's batch API has no metadata field, so `_nonce` (unlike
    // OpenAI's `metadata.nonce`) is never carried on the request, and
    // `listCandidates` below never returns one for this provider either.
    await this.waitForCreationSlot();
    this.creationTimestamps.push(this.now());

    const body = JSON.stringify({
      endpoint: OPENROUTER_BATCH_ENDPOINT,
      model,
      requests: items.map((item) => ({
        custom_id: item.itemId,
        body: item.body,
      })),
    });

    let response: Response;
    try {
      response = await this.fetchFn(this.baseUrl, {
        method: "POST",
        headers: this.headers(),
        body,
      });
    } catch (err) {
      // A fetch that never produced a response is a transport failure: the
      // request may still have created the batch, so it is rethrown
      // unchanged and `intent.json` stays for reconciliation (spec 4.3).
      // Only the non-2xx response below is a decided rejection.
      throw err;
    }

    if (!response.ok) {
      throw toBatchSubmitRejected(
        response.status,
        await errorMessageFrom(response),
      );
    }

    const created = await response.json() as OpenRouterBatchRecord;
    return { provider: "openrouter", batchId: created.id };
  }

  async poll(handle: BatchHandle): Promise<BatchPoll> {
    const response = await this.fetchFn(`${this.baseUrl}/${handle.batchId}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(
        `openrouter batch poll failed: http ${response.status}`,
      );
    }
    const batch = await response.json() as OpenRouterBatchRecord;
    const counts = batch.request_counts ??
      { total: 0, completed: 0, failed: 0 };
    const cost = batch.usage?.cost;
    const sizeRejected = batch.status === "failed" &&
      batch.error?.message !== undefined &&
      mentionsSizeLimit(batch.error.message);

    return {
      processing: !ENDED_STATUSES.has(batch.status),
      providerStatus: batch.status,
      rawCounts: {
        total: counts.total,
        completed: counts.completed,
        failed: counts.failed,
      },
      ...(cost !== undefined && cost !== null
        ? { providerReportedCostUsd: cost }
        : {}),
      ...(sizeRejected ? { sizeRejected: true } : {}),
    };
  }

  async collect(handle: BatchHandle): Promise<BatchItemResult[]> {
    const response = await this.fetchFn(`${this.baseUrl}/${handle.batchId}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(
        `openrouter batch collect failed: http ${response.status}`,
      );
    }
    const batch = await response.json() as OpenRouterBatchRecord;
    if (batch.status !== "completed") return [];
    return (batch.results ?? []).map(mapResultLine);
  }

  async listCandidates(since: Date): Promise<BatchCandidate[]> {
    const url = `${this.baseUrl}?created_after=${
      encodeURIComponent(since.toISOString())
    }`;
    const response = await this.fetchFn(url, {
      method: "GET",
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(
        `openrouter batch list failed: http ${response.status}`,
      );
    }
    const parsed = await response.json() as OpenRouterBatchList;
    return (parsed.data ?? []).map((batch) => ({
      batchId: batch.id,
      createdAt: new Date(batch.created_at * 1000),
      ...(batch.request_counts?.total !== undefined
        ? { total: batch.request_counts.total }
        : {}),
      ...(batch.model !== undefined ? { model: batch.model } : {}),
      ended: ENDED_STATUSES.has(batch.status),
    }));
  }

  // No `cancel`: OpenRouter's beta batches API has no documented cancel
  // operation (spec 5.3). `src/batch/abandon.ts` already handles a
  // provider with no `cancel` gracefully - it logs that nothing was
  // cancelled remotely and still marks the run abandoned locally.
}
