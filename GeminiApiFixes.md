# Gemini API Best Practices Audit

## Current State (2025-02-25)

SDK: `@google/genai@1.41.0`
Adapter: `src/llm/gemini-adapter.ts`

## What We're Doing Well

- **Official SDK** (`@google/genai`) with proper initialization
- **Streaming** via `ai.models.generateContentStream()` with chunk processing and abort signal handling
- **Token usage extraction** from `usageMetadata` with fallback estimation
- **Finish reason mapping** including `SAFETY` and `RECITATION` content filter reasons
- **Model discovery** filtering to `generateContent`-capable models with token limits
- **System prompt** via `systemInstruction` (correct SDK parameter)
- **Lazy client init** via `ensureClient()`
- **Dual env var support** - accepts both `GOOGLE_API_KEY` and `GEMINI_API_KEY`
- **Thinking budget support** via `thinkingConfig` with temperature auto-omission
- **Thinking token tracking** via `thoughtsTokenCount` mapped to shared `reasoningTokens`

## Fixed Issues

### 1. Thinking Budget Support - DONE

Both `callProvider()` (line 171) and `streamProvider()` (line 242) now extract `thinkingBudget` from config and pass it as `thinkingConfig: { thinkingBudget }`. When thinking is enabled, temperature is omitted (Gemini requirement, matching Anthropic's constraint). Only numeric budgets are sent (string values like "low"/"medium"/"high" are filtered out, as those are OpenAI-specific).

Note: `maxOutputTokens > thinkingBudget` validation is not yet enforced in `validateConfig()` - the API will return an error at runtime if violated.

### 4. Thinking Token Tracking - DONE

`GeminiUsageMetadata` interface extended with `thoughtsTokenCount` (line 39). Both non-streaming (`callProvider`, line 200) and streaming (`streamProvider`, line 288) paths extract thinking tokens and map them to the shared `reasoningTokens` field in `TokenUsage`.

### 8. Abort Signal Handling - DONE

`streamProvider()` now checks `options?.abortSignal?.aborted` at the top of the streaming loop (line 265). When aborted, the loop breaks and accumulated content is still finalized properly.

## Remaining Issues

### 2. No Context Caching (HIGH - up to 75% savings on cached tokens)

**Status: Deferred** - Requires cache lifecycle management (creation, TTL, cleanup).

Gemini's context caching lets you cache large prompts (system instructions, task descriptions) and reuse them across requests via `ai.caches.create()`.

### 3. Model Discovery Uses Raw `fetch` with API Key in URL (MEDIUM)

**Status: Deferred** - SDK API uncertain, current implementation works correctly.

`discoverModels()` passes the API key as a URL query parameter (`?key=${apiKey}`), which exposes it in logs and server access logs. The SDK's `ai.models.list()` would handle auth internally.

### 5. No Safety Settings Configuration (MEDIUM)

**Status: Deferred** - Requires new config option with unclear default values.

Code generation prompts can trigger Gemini's safety filters. Configurable `safetySettings` with thresholds like `BLOCK_ONLY_HIGH` would reduce false `content_filter` finish reasons.

### 6. Token Estimation Fallback Is Inaccurate (LOW)

**Status: Deferred** - Using `countTokens` API would add latency per request.

The `length / 4` character-based fallback is imprecise. The SDK's `ai.models.countTokens()` provides accurate counts but requires an extra API call.

### 7. No `responseMimeType` for Structured Output (LOW)

**Status: Deferred** - Would change the prompt format.

Gemini supports `responseMimeType: "application/json"` with `responseSchema` for guaranteed structured output. Could replace regex-based code extraction.

## Priority Order

| # | Issue                   | Status   | Impact                               | Effort |
| - | ----------------------- | -------- | ------------------------------------ | ------ |
| 1 | Thinking budget support | **Done** | Enables Gemini 2.5 thinking          | Low    |
| 4 | Thinking token tracking | **Done** | Accurate cost reporting              | Low    |
| 8 | Abort signal handling   | **Done** | Stream cancellation support          | Low    |
| 2 | Context caching         | Deferred | Up to 75% savings on cached tokens   | Medium |
| 3 | Model discovery via SDK | Deferred | Security (key in URL) + code cleanup | Low    |
| 5 | Safety settings         | Deferred | Reduce false content_filter results  | Low    |
| 6 | Token count fallback    | Deferred | Better metrics accuracy              | Low    |
| 7 | Structured output       | Deferred | More reliable code extraction        | Medium |
