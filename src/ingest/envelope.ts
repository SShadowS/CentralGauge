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
  return p;
}
