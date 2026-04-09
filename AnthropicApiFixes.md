# Anthropic API Best Practices Audit

## Current State (2025-02-25)

SDK: `@anthropic-ai/sdk@0.75.0`
Adapter: `src/llm/anthropic-adapter.ts`

## What We're Doing Well

- **Official SDK** with proper auth, types, and timeout configuration
- **Extended thinking** with temperature=1 constraint and budget validation
- **Streaming** via `client.messages.stream()`, abort signals, and `finalMessage()`
- **Retry logic** with exponential backoff, retryable error detection, `retry-after` parsing
- **Rate limiting** with token bucket (concurrent/RPM/TPM per provider)
- **Structured errors** via `LLMProviderError` with retryability context
- **System prompt** passed as separate `system` field (not in messages array)
- **Lazy client init** via `ensureClient()` to avoid unnecessary initialization
- **Prompt caching** via `cache_control: { type: "ephemeral" }` on system prompt content blocks
- **Cache token tracking** in both streaming and non-streaming paths (`cacheCreationTokens`, `cacheReadTokens`)
- **Minimal health check** using `maxTokens: 1` to reduce token waste

## Fixed Issues

### 1. Prompt Caching - DONE

System prompt is now sent as a content block array with `cache_control` for server-side caching (`anthropic-adapter.ts:331-340`):

```typescript
system: [{
  type: "text" as const,
  text: request.systemPrompt,
  cache_control: { type: "ephemeral" as const },
}],
```

### 4. Cache Token Tracking - DONE

`TokenUsage` extended with `cacheCreationTokens` and `cacheReadTokens` (`types.ts:60-61`). Both non-streaming (`callProvider`, line 186) and streaming (`buildUsageFromMessage`, line 394) paths extract cache metrics from the API response.

### 5. Cheaper Health Check - DONE

`base-adapter.ts:311-314` now uses `prompt: "OK"` with `maxTokens: 1` instead of the previous `"Say 'OK' if you can respond."` with `maxTokens: 5`.

## Fixed Issues (continued)

### 7. Cache-Aware Cost Estimation - DONE

`PricingService.estimateCostWithCacheSync()` added (`pricing-service.ts:260`) with cache-aware pricing. Cache creation tokens are billed at `input_price * 1.25` (25% surcharge), cache read tokens at `input_price * 0.10` (90% discount). Both `callProvider()` (line 188) and `buildUsageFromMessage()` (line 397) in the Anthropic adapter now call this method directly, passing `cache_creation_input_tokens` and `cache_read_input_tokens` from the API response.

## Remaining Issues

### 2. No Batch API (HIGH - 50% cost savings for benchmarks)

**Status: Deferred** - Major architectural change requiring async submission/polling model.

The Message Batches API is ideal for a benchmarking tool that runs many tasks across many models. Submit all tasks at once, get results asynchronously, pay 50% less. The parallel orchestrator could batch non-interactive tasks.

**Files to change:**

- `src/llm/anthropic-adapter.ts` - add batch submission method
- `src/parallel/` - integrate batch mode into orchestrator
- `src/llm/types.ts` - add batch-related types

### 3. Model Discovery Uses Raw `fetch` Instead of SDK (LOW)

**Status: Deferred** - Low priority, current fetch-based implementation works correctly.

`discoverModels()` at `anthropic-adapter.ts:109` manually constructs a `fetch()` call with headers instead of using the SDK's `client.models.list()`.

### 6. No `anthropic-beta` Header for Newer Features (LOW)

**Status: Deferred** - Unclear which beta features to enable.

Newer features like the token counting API (pre-flight validation of prompt sizes) require beta headers. The SDK supports this via the `betas` parameter on requests.

## Priority Order

| # | Issue                       | Status   | Impact                             | Effort |
| - | --------------------------- | -------- | ---------------------------------- | ------ |
| 1 | Prompt caching              | **Done** | Up to 90% savings on cached tokens | Low    |
| 4 | Cache token tracking        | **Done** | Accurate cost reporting            | Low    |
| 5 | Cheaper health check        | **Done** | Minor token savings                | Low    |
| 7 | Cache-aware cost estimation | **Done** | Accurate cost with cache pricing   | Low    |
| 2 | Batch API                   | Deferred | 50% cost savings for benchmarks    | High   |
| 3 | Model discovery via SDK     | Deferred | Code cleanup                       | Low    |
| 6 | Beta header support         | Deferred | Enables new features               | Low    |
