// src/health/classify.ts
import { ContainerError } from "../errors.ts";
import { fingerprintInfraError } from "./fingerprint.ts";
import { matchSignature } from "./signatures.ts";
import type { ClassifyResult } from "./types.ts";

/**
 * Always returns a fingerprint. Optionally returns a named signature
 * when the raw output (or error message) matches a known pattern.
 */
export function classifyInfraError(err: unknown): ClassifyResult {
  if (err instanceof ContainerError) {
    const rawOutput = err.rawOutput ?? "";
    const fingerprint = fingerprintInfraError({
      operation: err.operation,
      rawOutput,
      errorMessage: err.message,
    });
    const combined = [rawOutput, err.message]
      .filter((s) => s.trim().length > 0)
      .join("\n");
    const signature = matchSignature(combined);
    return signature ? { fingerprint, signature } : { fingerprint };
  }
  const message = err instanceof Error ? err.message : String(err);
  const fingerprint = fingerprintInfraError({
    operation: "unknown",
    errorMessage: message,
  });
  const signature = matchSignature(message);
  return signature ? { fingerprint, signature } : { fingerprint };
}
