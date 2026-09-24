---
paths:
  - "src/parallel/**"
  - "src/batch/**"
  - "src/llm/**"
  - "src/utils/harness-fingerprint.ts"
  - "scripts/gold-ci.ts"
---

# Shared execution units and attempt fields

Moved from `CLAUDE.md` by /doctor on 2026-09-24 so it loads only when working on matching files.

- **Shared execution units (`src/parallel/shared/`, spec D6).** `evaluateAttempt`, `createFailedAttempt`, `finalizeTaskResult`, `buildCompileWorkItem`, `runCompileWorkItem`, `buildAttemptContext`, `renderLLMRequest` (explicit `RenderInputs`, no cwd reads), `priceUsage` (the ONLY cost computation; batch mode throws `BatchPricingUnavailableError` without `batch_*_per_mtoken` catalog rates), `synthesizeInfraAttempt` (attempt-level infra record that keeps prior attempts; the task then terminates in both modes). The orchestrator and pool are thin callers; edit the unit, not the caller. The directory is in `HARNESS_INPUTS` (gold-ci re-baselines via `scripts/gold-ci.ts --adopt-harness` only when no previously tracked file changed).
- **Attempt prompt and provider fields.** `ExecutionAttempt.prompt` is the rendered request on success AND failure (transcripts carry it); `providerFinishReason` (raw stop reason) and `providerErrorCode` (`http_<status>[:<type>]`) flow to D1 `results.provider_finish_reason` / `provider_error_code`.
