# OpenAI API Best Practices Audit

## Current State (2025-02-25)

SDK: `@openai/openai@6.22.0`
Main adapter: `src/llm/openai-adapter.ts`
Azure adapter: `src/llm/azure-openai-adapter.ts`

## What We're Doing Well

- **Official SDK** (`@openai/openai`) with proper auth, types, and timeout
- **Dual API support** - Chat Completions for standard models, Responses API for Codex
- **Reasoning model handling** - correct `max_completion_tokens` for o1/o3/GPT-5, no temperature for reasoning models, `reasoning_effort` parameter
- **Streaming with usage tracking** - `stream_options: { include_usage: true }` captures actual tokens
- **Model discovery** via SDK's `client.models.list()`
- **Retry logic** with exponential backoff, retryable error detection
- **Rate limiting** with token bucket (concurrent 10, RPM 3500, TPM 200000 for OpenAI)
- **Lazy client init** via `ensureClient()`
- **`store: false`** on all API paths (Chat Completions, Responses API streaming and non-streaming)
- **Reasoning token tracking** from `completion_tokens_details` (Chat Completions) and `output_tokens_details` (Responses API)
- **Dynamic finish reason** from Responses API `response.status` instead of hardcoded "stop"
- **Word-boundary codex detection** via `/\bcodex\b/` regex across all codex-checking methods

## Fixed Issues

### 1. Responses API Finish Reason - DONE

Both non-streaming (`callProviderResponses`, line 249) and streaming (`streamProviderResponses`, line 366) now read `response.status` and map `"incomplete"` to `"length"`, `"failed"` to `"error"`, and `"completed"` to `"stop"`. Truncated responses now correctly trigger the continuation logic.

### 3. `store: false` on Chat Completions - DONE

Added `store: false` to `buildRequestParams()` (line 462). All three API paths (Chat Completions, Responses API non-streaming, Responses API streaming) now set `store: false`.

### 4. Reasoning Token Tracking - DONE

`TokenUsage` extended with `reasoningTokens` field (`types.ts:62`). Extracted in:

- Chat Completions: `buildUsageFromCompletion()` (line 503) via `completion_tokens_details.reasoning_tokens`
- Responses API non-streaming: `callProviderResponses()` (line 243) via `output_tokens_details.reasoning_tokens`
- Responses API streaming: `streamProviderResponses()` (line 349) via `output_tokens_details.reasoning_tokens`

### 7. Azure Streaming Token Usage - DONE

Azure adapter now sends `stream_options: { include_usage: true }` in streaming payload (`azure-openai-adapter.ts:383`). `processStreamEvents()` captures usage from the final chunk (line 478) and returns it alongside the finish reason. `streamProvider()` uses actual API usage when available, falling back to character-based estimation only when the API doesn't return usage data.

### 8. Azure API Version Updated - DONE

Default API version updated from `2024-02-15-preview` to `2024-10-21` (GA stable) in both `getEndpointUrl()` and `discoverModels()`.

### 9. Codex Model Detection - DONE

All three codex-checking methods now use word-boundary regex `/\bcodex\b/.test(model)`:

- `isResponsesOnlyModel()` (line 87)
- `isReasoningOnlyModel()` (line 107)
- `getReasoningEffort()` (line 125)

## Remaining Issues

### 2. No Batch API (HIGH - 50% cost savings for benchmarks)

**Status: Deferred** - Major architectural change requiring async submission/polling over up to 24 hours.

OpenAI's Batch API allows submitting up to 50,000 requests at once with 50% cost reduction and a 24-hour completion window.

### 5. No Predicted Outputs (MEDIUM - faster fix generation)

**Status: Deferred** - Requires changes to the base adapter interface to pass original code through.

For second-attempt fix generation, the output is mostly similar to the first attempt. OpenAI's predicted outputs feature (`prediction` parameter) can speed up these responses.

### 6. Azure Adapter Uses Raw `fetch` Instead of SDK (MEDIUM)

**Status: Deferred** - ~200 line rewrite required.

`azure-openai-adapter.ts` builds all HTTP requests manually with `fetch()`. The OpenAI SDK supports Azure natively via `AzureOpenAI` class, which would eliminate manual HTTP handling, SSE parsing, and error mapping.

### 10. No Structured Outputs for Code Extraction (LOW)

**Status: Deferred** - Would change the prompt format.

OpenAI supports `response_format: { type: "json_schema", ... }` for guaranteed structured output. This could replace the regex-based `CodeExtractor` for more reliable code extraction.

## Priority Order

| #  | Issue                              | Status   | Impact                                  | Effort |
| -- | ---------------------------------- | -------- | --------------------------------------- | ------ |
| 1  | Responses API finish reason        | **Done** | Fixes truncation detection              | Low    |
| 3  | `store: false` on Chat Completions | **Done** | Data retention/privacy                  | Low    |
| 4  | Reasoning token tracking           | **Done** | Accurate cost reporting for o1/o3/codex | Low    |
| 7  | Azure streaming token usage        | **Done** | Accurate metrics                        | Low    |
| 8  | Azure API version update           | **Done** | Access newer features                   | Low    |
| 9  | Codex model detection              | **Done** | Future-proofing                         | Low    |
| 2  | Batch API                          | Deferred | 50% cost savings for benchmarks         | High   |
| 5  | Predicted outputs                  | Deferred | Faster second attempts                  | Medium |
| 6  | Azure adapter to SDK               | Deferred | Eliminate ~200 lines of manual HTTP     | Medium |
| 10 | Structured outputs                 | Deferred | More reliable code extraction           | Medium |
