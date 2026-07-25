/**
 * Compact single-task result matrix for the trap-task authoring loop.
 *
 * `formatTaskMatrix` in `src/utils/formatters.ts` renders a task x model
 * grid and is gated on `stats.perTask.size > 1` — a one-task authoring run
 * (the loop's entire shape) renders nothing there. This module is the
 * single-task counterpart: a model x attempt grid for exactly one task, in
 * every output format, not just `verbose`. See `results-writer.ts`.
 *
 * @module cli/commands/bench/single-task-matrix
 */

import * as colors from "@std/fmt/colors";
import type {
  ExecutionAttempt,
  TaskExecutionResult,
} from "../../../src/tasks/interfaces.ts";
import { shortModelName } from "../../../src/utils/formatters.ts";
import { Table } from "@cliffy/table";

/**
 * Outcome bucket for a single attempt. Deliberately five buckets, not one
 * per `failureKind` value — see `categorizeAttempt` for how the extra LLM-
 * side failure kinds (`safety_refusal`, `low_confidence`) fold into
 * `COMPILE`.
 */
export type AttemptCategory = "PASS" | "COMPILE" | "TEST" | "EMPTY" | "INFRA";

/**
 * Categorize a single execution attempt for the authoring-loop matrix.
 *
 * Precedence is enforced by construction: each branch below returns
 * immediately once it applies, so a later branch only ever runs after every
 * earlier one has ruled itself out. Two branches are non-obvious enough to
 * need their own comments (see inline) — they are extensions of the same
 * "infra noise is not model behaviour" principle already established by the
 * zero-tests rule, applied to the two other places infra noise can surface
 * on an attempt: an exhausted infra retry, and an alert-drain quarantine.
 *
 * `expectsTests` must come from the owning task's manifest
 * (`result.context.manifest.expected?.testApp`), not from the attempt
 * itself — a compile-only task legitimately has no `testResult` and that is
 * not an infra signal.
 */
export function categorizeAttempt(
  attempt: ExecutionAttempt,
  expectsTests: boolean,
): AttemptCategory {
  // Quarantine (alert-drain) wraps ONLY non-success outcomes on a container
  // an alert fired on mid-flight — see .claude/rules/alert-drain-rebalance.md.
  // The failure underneath is not trustworthy model signal, so it is
  // reported as INFRA regardless of what compilationResult/testResult say.
  if (attempt.quarantined) return "INFRA";

  // An attempt that terminated through the infra-failure synthesis path
  // (src/health/terminal-record.ts) is infra by construction, whether or
  // not a retry budget existed to exhaust. `infraRetryExhausted` is set
  // only when the retry loop actually ran out of budget; `infraSynthesized`
  // is the unconditional marker `synthesizeInfraFailureResult` always
  // stamps, including the `maxRetries <= 0` / infra-retry-disabled path
  // (src/parallel/infra-retry.ts's fast path) where the raw infra error
  // propagates unwrapped and no exhaustion reason is ever computed.
  // Checking both catches every attempt that function can produce. Not
  // called out in the design doc's table (only the recovered case is); see
  // task-9-report.md.
  if (attempt.infraRetryExhausted || attempt.infraSynthesized) {
    return "INFRA";
  }

  // Compiled successfully but zero tests ran on a task that expects a test
  // app: GH #13 — scoring this as a model failure once hid a broken
  // bccontainerhelper version across an entire bench run. This MUST be
  // checked before `attempt.success` below, not after: some providers
  // report `success: true` on a zero-test result (`docker-output-parsers.ts`,
  // `mock-provider.ts` both derive `success` from `failedTests === 0`, which
  // is vacuously true at zero tests), so gating on `attempt.success` first
  // would let a zero-test PASS slip through by luck of a downstream
  // invariant elsewhere — precisely what this check exists to prevent, and
  // the one row with GH #13 history. The container layer is supposed to
  // throw before a zero-test result gets this far
  // (src/container/bc-container-provider.ts), but the matrix must not rely
  // on that either — it must not read a stale or edge-case zero-test result
  // as PASS or TEST.
  if (
    expectsTests &&
    attempt.compilationResult?.success === true &&
    (attempt.testResult?.totalTests ?? 0) === 0
  ) {
    return "INFRA";
  }

  // Genuine pass. `attempt.success` already folds compile + test +
  // mustContain/mustNotContain pattern checks (orchestrator.ts createAttempt,
  // mirroring executor-v2's evaluateAttempt per the benchmark-consistency
  // rule) — reusing it here keeps this function from re-deriving pass/fail
  // logic that can drift out of sync with the real scorer. An infra-retry
  // that DID recover leaves this same attempt holding the retry's final
  // compilationResult/testResult, so a recovered-then-passed attempt lands
  // here with no special-casing needed: it reports its final outcome.
  if (attempt.success) return "PASS";

  // From here attempt.success === false — figure out why.

  if (!attempt.compilationResult) {
    // No compilation was ever attempted: the LLM call itself failed to
    // produce ready-to-compile code. `"empty_response"` carries zero trap
    // signal (see src/parallel/llm-work-pool.ts) and must be reported
    // distinctly from a real compile failure. Every other LLM-side failure
    // (safety refusal, low confidence, or a bare adapter/network error with
    // no failureKind at all) still reads as "the model didn't produce
    // compilable code" — i.e. COMPILE.
    return attempt.failureKind === "empty_response" ? "EMPTY" : "COMPILE";
  }

  if (!attempt.compilationResult.success) return "COMPILE";

  // Compiled, tests ran (or none were expected of this task — including a
  // compile-only task where a required mustContain/mustNotContain pattern
  // still failed, the least-bad of the five buckets for that edge case;
  // pinned by a dedicated test), and something still failed. Genuine model
  // behaviour either way.
  return "TEST";
}

/** Color a category label for terminal output. No emojis (project style). */
function colorCategory(category: AttemptCategory): string {
  switch (category) {
    case "PASS":
      return colors.green(category);
    case "COMPILE":
      return colors.red(category);
    case "TEST":
      return colors.yellow(category);
    case "INFRA":
      return colors.cyan(category);
    case "EMPTY":
      return colors.gray(category);
  }
}

/** Render one attempt cell: colored category plus a short detail suffix. */
function formatAttemptCell(
  attempt: ExecutionAttempt,
  category: AttemptCategory,
): string {
  const label = colorCategory(category);
  if (category === "PASS") {
    return `${label} (${attempt.score.toFixed(0)})`;
  }
  if (category === "TEST" && attempt.testResult) {
    return `${label} (${attempt.testResult.passedTests}/${attempt.testResult.totalTests})`;
  }
  return label;
}

/**
 * Input for {@link formatSingleTaskMatrix}. Mirrors `TaskMatrixInput` in
 * `src/utils/formatters.ts` (just `results`, since there is exactly one
 * task and no cross-model winner to compute).
 */
export interface SingleTaskMatrixInput {
  results: TaskExecutionResult[];
}

/**
 * Render a compact model x attempt matrix for a single-task run. Renders
 * unconditionally — this is the counterpart to `formatTaskMatrix`'s
 * `taskCount > 1` gate, so callers must NOT gate this on output format
 * (see results-writer.ts `displayFormattedOutput`, which renders it on both
 * the verbose and non-verbose branches).
 */
export function formatSingleTaskMatrix(input: SingleTaskMatrixInput): string {
  const { results } = input;
  if (results.length === 0) return "";

  const maxAttempts = Math.max(1, ...results.map((r) => r.attempts.length));
  const header = [
    "Model",
    ...Array.from({ length: maxAttempts }, (_, i) => `Attempt ${i + 1}`),
    "Result",
  ];
  const table = new Table().header(header).border(true);

  for (const result of results) {
    table.push(buildModelRow(result, maxAttempts));
  }

  return "\n=== TASK RESULT ===\n" + table.toString();
}

/** Build a single model row: one cell per attempt slot, plus overall result. */
function buildModelRow(
  result: TaskExecutionResult,
  maxAttempts: number,
): string[] {
  const expectsTests = !!result.context.manifest.expected?.testApp;
  const modelName = shortModelName(
    result.context.llmModel,
    result.context.variantConfig,
  );

  const row: string[] = [modelName];
  for (let i = 0; i < maxAttempts; i++) {
    const attempt = result.attempts[i];
    row.push(
      attempt
        ? formatAttemptCell(attempt, categorizeAttempt(attempt, expectsTests))
        : "-",
    );
  }
  row.push(result.success ? colors.green("PASS") : colors.red("FAIL"));
  return row;
}
