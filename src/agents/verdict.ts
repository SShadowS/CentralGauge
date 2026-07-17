/**
 * Trusted verdict channel for sandbox agent execution (finding M1).
 *
 * The MCP server appends a verdict record to verdicts.jsonl in a per-run
 * host temp dir OUTSIDE any container mount after every verify-tool call.
 * The sandbox executor scores success EXCLUSIVELY from these records —
 * model-controlled prose ("All tests passed") can never grant success.
 *
 * Only `al_verify_task` verdicts are authoritative: it resolves the REAL
 * benchmark test from the task YAML. `al_verify` takes a model-chosen
 * testFile, so a model could stage a fake workspace test named for the
 * expected task — its verdicts are diagnostic only.
 *
 * @module src/agents/verdict
 */

import { join } from "@std/path";

/** Name of the append-only verdict log inside the verdict dir. */
export const VERDICT_FILE = "verdicts.jsonl";

/** One verify-tool completion, as recorded by the MCP server. */
export interface VerifyVerdict {
  /** Per-run nonce — rejects records from a stale or foreign server run */
  nonce: string;
  /** "al_verify_task" (authoritative) or "al_verify" (diagnostic) */
  tool: string;
  /** Task the verification ran against (null if underivable) */
  taskId: string | null;
  /** Overall verify outcome (compile + tests) */
  success: boolean;
  /** Whether compilation succeeded */
  compileSuccess: boolean;
  /** Total tests executed (absent for compile-stage failures) */
  totalTests?: number;
  /** Tests passed */
  passed?: number;
  /** Tests failed */
  failed?: number;
  /** ISO timestamp of the verdict */
  timestamp: string;
}

/** What the executor expects a verdict to prove. */
export interface VerdictExpectation {
  taskId: string;
  nonce: string;
  requiresTests: boolean;
}

/** Result of scoring the verdict log against an expectation. */
export interface VerdictEvaluation {
  /** Authoritative success — true only with a qualifying verdict */
  success: boolean;
  /** The passing verdict that granted success (null when success=false) */
  authoritative: VerifyVerdict | null;
  /** Last al_verify_task verdict matching task+nonce, any outcome */
  lastMatching: VerifyVerdict | null;
  /** Human-readable scoring reason */
  reason: string;
}

/** Append one verdict record to the run's verdicts.jsonl. */
export async function appendVerdict(
  verdictDir: string,
  verdict: VerifyVerdict,
): Promise<void> {
  await Deno.writeTextFile(
    join(verdictDir, VERDICT_FILE),
    JSON.stringify(verdict) + "\n",
    { append: true },
  );
}

/**
 * Read all verdict records for a run. A missing file yields an empty list
 * (which scores as failure — the channel fails closed); malformed lines are
 * skipped.
 */
export async function readVerdicts(
  verdictDir: string,
): Promise<VerifyVerdict[]> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(join(verdictDir, VERDICT_FILE));
  } catch {
    return [];
  }

  const verdicts: VerifyVerdict[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null) {
        verdicts.push(parsed as VerifyVerdict);
      }
    } catch {
      // Skip malformed lines — never let one bad record break scoring
    }
  }
  return verdicts;
}

/**
 * Score the verdict log. Authoritative success requires a verdict with
 * tool === "al_verify_task", matching taskId and nonce, success === true,
 * and (when the task requires tests) totalTests > 0. Anything else —
 * including prose claims, al_verify verdicts, and zero-test passes — is a
 * failure.
 */
export function evaluateVerdicts(
  verdicts: VerifyVerdict[],
  expectation: VerdictExpectation,
): VerdictEvaluation {
  const matching = verdicts.filter(
    (v) =>
      v.tool === "al_verify_task" &&
      v.taskId === expectation.taskId &&
      v.nonce === expectation.nonce,
  );
  const lastMatching = matching.at(-1) ?? null;

  const qualifying = matching.filter(
    (v) =>
      v.success === true &&
      (!expectation.requiresTests || (v.totalTests ?? 0) > 0),
  );
  const authoritative = qualifying.at(-1) ?? null;

  if (authoritative) {
    return {
      success: true,
      authoritative,
      lastMatching,
      reason: "verified al_verify_task success",
    };
  }

  let reason: string;
  if (matching.length === 0) {
    reason = "no verified tool result";
  } else if (
    expectation.requiresTests &&
    lastMatching?.success === true &&
    (lastMatching.totalTests ?? 0) === 0
  ) {
    reason = "verified result ran zero tests";
  } else {
    reason = "last verified al_verify_task result was a failure";
  }
  return { success: false, authoritative: null, lastMatching, reason };
}
