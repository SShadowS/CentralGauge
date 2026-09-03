import type { ResultInput } from "../../site/src/lib/shared/types.ts";

export interface BuildPayloadInput {
  runId: string;
  taskSetHash: string;
  model: { slug: string; api_model_id: string; family_slug: string };
  settings: Record<string, unknown>;
  machineId: string;
  startedAt: string;
  completedAt: string;
  pricingVersion: string;
  centralgaugeSha?: string;
  reproductionBundleSha256?: string;
  results: ResultInput[];
  /** SHA-256 of the harness inputs (taxonomy v2). See `src/utils/harness-fingerprint.ts`. */
  harnessFingerprint?: string;
  /** Retry-path overlay version in effect for this run. See `RETRY_PATH_VERSION`. */
  retryPathVersion?: string;
  /** SHA-256 of the uploaded environment manifest blob. */
  environmentSha256?: string;
  /**
   * Headline environment facts, duplicated onto the payload for querying
   * without dereferencing the `environmentSha256` blob. A subset of the full
   * `EnvironmentManifest` — see `src/ingest/capture.ts`.
   */
  environment?: {
    bc_artifact: string | null;
    container_image_digest: string | null;
    bcch_version: string;
    test_runner: "soap" | "legacy";
    prompt_template_digest: string;
  };
  /** Redacted LLM invocation snapshot. See `invocationSnapshot`. */
  invocation?: Record<string, unknown>;
}

export function buildPayload(
  input: BuildPayloadInput,
): Record<string, unknown> {
  const p: Record<string, unknown> = {
    task_set_hash: input.taskSetHash,
    model: input.model,
    settings: input.settings,
    machine_id: input.machineId,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    pricing_version: input.pricingVersion,
    results: input.results,
  };
  if (input.centralgaugeSha) p["centralgauge_sha"] = input.centralgaugeSha;
  if (input.reproductionBundleSha256) {
    p["reproduction_bundle_sha256"] = input.reproductionBundleSha256;
  }
  if (input.harnessFingerprint) {
    p["harness_fingerprint"] = input.harnessFingerprint;
  }
  if (input.retryPathVersion) p["retry_path_version"] = input.retryPathVersion;
  if (input.environmentSha256) {
    p["environment_sha256"] = input.environmentSha256;
  }
  if (input.environment) {
    p["bc_artifact"] = input.environment.bc_artifact;
    p["container_image_digest"] = input.environment.container_image_digest;
    p["bcch_version"] = input.environment.bcch_version;
    p["test_runner"] = input.environment.test_runner;
    p["prompt_template_digest"] = input.environment.prompt_template_digest;
  }
  if (input.invocation) p["invocation"] = input.invocation;
  return p;
}
