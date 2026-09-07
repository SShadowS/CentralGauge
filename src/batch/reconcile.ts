/**
 * `submit-unknown` reconciliation (spec sections 4.3, 9): decide whether a
 * batch the provider actually created after a crash between `submit` and
 * the handle being persisted (`intent.json` survives, `state.json` does
 * not know about it) can be adopted back into the run.
 *
 * Absence from `provider.listCandidates` is never evidence either way -
 * providers are eventually consistent and clocks differ - so this module
 * only ever moves a run out of `submit-unknown` on POSITIVE, exact
 * identification: OpenAI's nonce round-trips through `metadata` and is
 * trusted outright; Anthropic and OpenRouter require the candidate to have
 * ended and its collected item-id set to equal the intent's exactly (same
 * count, no duplicates, no extras) before adoption. `opts.adopt` runs the
 * identical validation against one named candidate instead of scanning
 * every candidate in the window; `confirmNotSubmitted` is the only path
 * back to `"prepared"`, and only ever fires on an explicit operator
 * statement that the batch does not exist.
 *
 * @module src/batch/reconcile
 */
import type {
  BatchCandidate,
  BatchHandle,
  BatchProvider,
  BatchProviderName,
} from "../llm/batch/types.ts";
import type { BatchRecord, BatchRunState } from "./state.ts";
import { writeState } from "./state.ts";
import type { SubmissionIntent } from "./intent.ts";
import { clearIntent } from "./intent.ts";
import { withTransportBackoff } from "./backoff.ts";

export interface ReconcileReport {
  candidates: BatchCandidate[];
  adopted?: BatchRecord;
  reason: string;
}

/** Ten minutes, spec section 4.3's clock-skew tolerance. */
const WINDOW_SKEW_MS = 10 * 60_000;

type CandidateCheck =
  | { kind: "match" }
  | { kind: "pending" }
  | { kind: "reject"; reason: string };

/**
 * The single per-provider identification rule (spec 4.3), shared by the
 * automatic scan and `opts.adopt`'s explicit validation. OpenAI decides
 * from the trusted nonce alone; Anthropic and OpenRouter narrow by
 * total/model first, then - only once the candidate has ended - require
 * an exact `custom_id` (our `itemId`) set match via `provider.collect`.
 */
async function checkCandidate(
  provider: BatchProvider,
  providerName: BatchProviderName,
  candidate: BatchCandidate,
  intent: SubmissionIntent,
  apiModelId: string,
): Promise<CandidateCheck> {
  if (providerName === "openai") {
    if (candidate.nonce !== intent.nonce) {
      return {
        kind: "reject",
        reason:
          `candidate ${candidate.batchId} nonce does not match this submission's nonce`,
      };
    }
    return { kind: "match" };
  }

  if (providerName === "openrouter" && candidate.model !== apiModelId) {
    return {
      kind: "reject",
      reason: `candidate ${candidate.batchId} model "${
        candidate.model ?? "(unknown)"
      }" does not match "${apiModelId}"`,
    };
  }

  if (candidate.total !== intent.itemIds.length) {
    return {
      kind: "reject",
      reason: `candidate ${candidate.batchId} has ${
        candidate.total ?? "an unknown number of"
      } item(s), expected ${intent.itemIds.length}`,
    };
  }

  if (!candidate.ended) {
    return { kind: "pending" };
  }

  const handle: BatchHandle = {
    provider: providerName,
    batchId: candidate.batchId,
  };
  const results = await withTransportBackoff(() => provider.collect(handle));
  const resultIds = results.map((r) => r.itemId);
  const resultIdSet = new Set(resultIds);
  const intentIdSet = new Set(intent.itemIds);

  if (resultIds.length !== resultIdSet.size) {
    return {
      kind: "reject",
      reason: `candidate ${candidate.batchId} returned duplicate item ids`,
    };
  }

  const extra = resultIds.filter((id) => !intentIdSet.has(id));
  if (extra.length > 0) {
    return {
      kind: "reject",
      reason: `candidate ${candidate.batchId} includes unexpected item id(s): ${
        extra.join(", ")
      }`,
    };
  }

  const missing = intent.itemIds.filter((id) => !resultIdSet.has(id));
  if (missing.length > 0) {
    return {
      kind: "reject",
      reason: `candidate ${candidate.batchId} is missing item id(s): ${
        missing.join(", ")
      }`,
    };
  }

  return { kind: "match" };
}

/**
 * Builds the adopted `BatchRecord` from `intent` (wave/round/chunk/item
 * ids) and the candidate's handle, pushes it onto `state.batches` and
 * `state.activeBatchIds`, flips `phase` to `attempt-<wave>-submitted`, then
 * clears the intent and persists.
 */
async function applyAdoption(
  dir: string,
  state: BatchRunState,
  intent: SubmissionIntent,
  providerName: BatchProviderName,
  candidate: BatchCandidate,
): Promise<BatchRecord> {
  const record: BatchRecord = {
    wave: intent.wave,
    round: intent.round,
    chunk: intent.chunk,
    handle: { provider: providerName, batchId: candidate.batchId },
    submittedAt: intent.writtenAt,
    providerStatus: candidate.ended ? "ended" : "processing",
    rawCounts: candidate.total !== undefined ? { total: candidate.total } : {},
    state: candidate.ended ? "ended" : "processing",
    itemIds: intent.itemIds,
    collected: false,
  };
  state.batches.push(record);
  state.activeBatchIds.push(candidate.batchId);
  state.phase = intent.wave === 1
    ? "attempt-1-submitted"
    : "attempt-2-submitted";
  state.wave = intent.wave;
  await clearIntent(dir);
  await writeState(dir, state);
  return record;
}

/**
 * Reconciles a `submit-unknown` run against `provider.listCandidates`.
 * With no `opts.adopt`, scans every candidate in the skew-tolerant window
 * and adopts the first exact match (spec 4.3); with `opts.adopt`, validates
 * only the named candidate (refusing outright when it falls outside the
 * window) and never looks at any other candidate.
 */
export async function reconcileSubmitUnknown(
  dir: string,
  state: BatchRunState,
  provider: BatchProvider,
  intent: SubmissionIntent,
  opts: { adopt?: string } = {},
): Promise<ReconcileReport> {
  const since = new Date(Date.parse(intent.writtenAt) - WINDOW_SKEW_MS);
  const candidates = await withTransportBackoff(() =>
    provider.listCandidates(since)
  );
  const providerName = state.model.provider;
  const apiModelId = state.model.apiModelId;

  if (opts.adopt !== undefined) {
    const candidate = candidates.find((c) => c.batchId === opts.adopt);
    if (!candidate) {
      return {
        candidates,
        reason: `candidate ${opts.adopt} was not found within the ` +
          `reconciliation window (since ${since.toISOString()})`,
      };
    }
    const check = await checkCandidate(
      provider,
      providerName,
      candidate,
      intent,
      apiModelId,
    );
    if (check.kind === "match") {
      const adopted = await applyAdoption(
        dir,
        state,
        intent,
        providerName,
        candidate,
      );
      return {
        candidates,
        adopted,
        reason: `adopted candidate ${candidate.batchId}`,
      };
    }
    const reason = check.kind === "pending"
      ? `candidate ${candidate.batchId} has not ended yet`
      : check.reason;
    return { candidates, reason };
  }

  let fallbackReason =
    "no candidate in the reconciliation window matched this submission";
  for (const candidate of candidates) {
    const check = await checkCandidate(
      provider,
      providerName,
      candidate,
      intent,
      apiModelId,
    );
    if (check.kind === "match") {
      const adopted = await applyAdoption(
        dir,
        state,
        intent,
        providerName,
        candidate,
      );
      return {
        candidates,
        adopted,
        reason: `adopted candidate ${candidate.batchId}`,
      };
    }
    if (check.kind === "pending") {
      fallbackReason = `candidate ${candidate.batchId} has not ended yet`;
    } else {
      fallbackReason = check.reason;
    }
  }
  return { candidates, reason: fallbackReason };
}

/**
 * The operator's explicit statement that the intent's batch was never
 * actually created: returns the run to `"prepared"` and clears the
 * intent. For OpenAI, best-effort deletes the leftover input file the
 * intent recorded (`intent.inputFileId`) - an orphan from a crash between
 * upload and batch creation.
 */
export async function confirmNotSubmitted(
  dir: string,
  state: BatchRunState,
  provider: BatchProvider,
  intent: SubmissionIntent,
): Promise<BatchRunState> {
  if (
    state.model.provider === "openai" && intent.inputFileId !== undefined &&
    provider.cleanup
  ) {
    try {
      await provider.cleanup({
        provider: "openai",
        batchId: "",
        extra: { inputFileId: intent.inputFileId },
      });
    } catch {
      // best effort: an already-deleted or never-uploaded file is not
      // worth failing the operator's confirmation over.
    }
  }
  state.phase = "prepared";
  await clearIntent(dir);
  await writeState(dir, state);
  return state;
}
