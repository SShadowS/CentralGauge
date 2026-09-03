/**
 * Pure per-attempt capture helpers for the ingest envelope (taxonomy v2).
 *
 * Derives run-time signals from an {@link ExecutionAttempt} that the
 * existing `BenchResultItem` mapping does not carry: how the attempt
 * terminated, a stable per-test-case identifier vector, and content digests
 * for the prompt/candidate. No I/O beyond hashing.
 * @module src/ingest/capture
 */
import type { ExecutionAttempt } from "../tasks/interfaces.ts";
import { sha256Hex } from "../../site/src/lib/shared/taxonomy-schema.ts";

/**
 * How a single attempt terminated, in precedence order:
 * an infra-exhausted attempt is reported as such regardless of what the LLM
 * response looks like; otherwise an unrecovered refusal wins over the raw
 * `finishReason`; otherwise `finishReason` decides.
 */
export type TerminationKind =
  | "response"
  | "provider_error"
  | "cap_reached"
  | "refusal"
  | "infra_exhausted"
  | "cancelled";

export function terminationKind(a: ExecutionAttempt): TerminationKind {
  const infra = (a as { infraRetryExhaustionReason?: string })
    .infraRetryExhaustionReason;
  if (infra) return "infra_exhausted";
  const r = a.llmResponse;
  if (r.refusal && !r.refusal.recovered) return "refusal";
  switch (r.finishReason) {
    case "length":
      return "cap_reached";
    case "error":
      return "provider_error";
    case "content_filter":
      return "refusal";
    default:
      return "response";
  }
}

/**
 * Stable per-test-case id vector for one attempt's test results, in oracle
 * order. Each id is the first 16 hex chars of sha256(`${taskId}\n${name}`) -
 * stable across runs of the same task/test-name pair, distinct across tasks.
 */
export async function testVector(
  a: ExecutionAttempt,
  taskId: string,
): Promise<{ id: string; name: string; passed: boolean }[]> {
  const out: { id: string; name: string; passed: boolean }[] = [];
  for (const t of a.testResult?.results ?? []) {
    out.push({
      id: (await sha256Hex(`${taskId}\n${t.name}`)).slice(0, 16),
      name: t.name,
      passed: t.passed,
    });
  }
  return out;
}

export async function optionalSha(
  text: string | undefined,
): Promise<string | undefined> {
  return text === undefined ? undefined : await sha256Hex(text);
}

export { sha256Hex };
