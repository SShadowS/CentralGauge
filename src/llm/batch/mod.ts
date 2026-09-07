/**
 * Batch mode module
 *
 * Provider-agnostic contract for submitting LLM requests as an asynchronous
 * batch job, plus the registry that resolves a vendor name to a
 * {@link BatchProvider} implementation.
 */

export type {
  BatchCandidate,
  BatchErrorKind,
  BatchHandle,
  BatchItem,
  BatchItemResult,
  BatchPoll,
  BatchProvider,
  BatchProviderName,
  SubmitHooks,
} from "./types.ts";
export { BatchSubmitRejected } from "./types.ts";

export { createBatchProvider } from "./registry.ts";
