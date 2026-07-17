/**
 * T2 + TEST6 — infra-invalidated attempts must be EXCLUDED from ingest
 * payloads, never sent to the leaderboard as `passed=false`.
 *
 * Covers the four decided variants:
 *  (a) synthesized infra attempt → no BenchResultItem, meta counts it;
 *  (b) mixed task → real attempt kept, infra attempt dropped;
 *  (c) normal failure → still ingested as passed=false;
 *  (d) ALL attempts infra → `all_infra` sentinel, NO payload built.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import type { ExecutionAttempt } from "../../../src/tasks/interfaces.ts";
import { assembleBenchResultsForVariant } from "../../../cli/commands/bench/ingest-assembly.ts";
import {
  createMockExecutionAttempt,
  createMockTaskExecutionContext,
} from "../../utils/test-helpers.ts";

const VARIANT: ModelVariant = {
  originalSpec: "mock/mock-gpt-4",
  baseModel: "mock-gpt-4",
  provider: "mock",
  model: "mock-gpt-4",
  variantId: "mock/mock-gpt-4",
  hasVariant: false,
  config: {},
};

const ASSEMBLE_OPTS = { pricingVersion: "2026-07-17" };

function makeResult(taskId: string, attempts: ExecutionAttempt[]) {
  return {
    taskId,
    executionId: `${taskId}-exec`,
    context: createMockTaskExecutionContext(),
    attempts,
    success: attempts.some((a) => a.success),
    finalScore: 0,
    totalTokensUsed: 0,
    totalCost: 0,
    totalDuration: 0,
    passedAttemptNumber: 0,
  };
}

async function writeResultsFile(
  dir: string,
  results: unknown[],
): Promise<string> {
  const path = join(dir, "benchmark-results-test.json");
  await Deno.writeTextFile(path, JSON.stringify({ results }));
  return path;
}

function infraAttempt(overrides?: Partial<ExecutionAttempt>): ExecutionAttempt {
  return createMockExecutionAttempt({
    success: false,
    score: 0,
    failureReasons: [
      "Infra error: Zero tests detected after successful publish (infra)",
    ],
    ...overrides,
  });
}

Deno.test("TEST6a: synthesized infra attempt produces no BenchResultItem and is counted in meta", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-test6a-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E001", [createMockExecutionAttempt({ success: true })]),
      makeResult("CG-AL-E002", [infraAttempt()]),
    ]);

    const outcome = await assembleBenchResultsForVariant(
      path,
      VARIANT,
      ASSEMBLE_OPTS,
    );
    assertEquals(outcome.kind, "assembled");
    if (outcome.kind !== "assembled") return;
    assertEquals(outcome.infraExcludedAttempts, 1);
    assertEquals(outcome.benchResults.results.length, 1);
    assertEquals(outcome.benchResults.results[0]!.task_id, "CG-AL-E001");
    assert(
      !outcome.benchResults.results.some((r) => r.task_id === "CG-AL-E002"),
      "infra-invalidated attempt must not be ingested",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TEST6b: mixed task keeps the real attempt and drops the infra attempt", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-test6b-" });
  try {
    const realAttempt = createMockExecutionAttempt({
      attemptNumber: 1,
      success: false,
      score: 50,
      failureReasons: ["Tests failed: 1/3"],
    });
    // Attempt 2 died to exhausted infra retries — flag-based invalidation.
    const exhaustedAttempt = createMockExecutionAttempt({
      attemptNumber: 2,
      success: false,
      score: 0,
      failureReasons: ["Infra error: PSSession lost"],
      infraRetryExhausted: true,
      infraRetryExhaustionReason: "budget_exhausted",
    });
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-M010", [realAttempt, exhaustedAttempt]),
    ]);

    const outcome = await assembleBenchResultsForVariant(
      path,
      VARIANT,
      ASSEMBLE_OPTS,
    );
    assertEquals(outcome.kind, "assembled");
    if (outcome.kind !== "assembled") return;
    assertEquals(outcome.infraExcludedAttempts, 1);
    assertEquals(outcome.benchResults.results.length, 1);
    assertEquals(outcome.benchResults.results[0]!.attempt, 1);
    assertEquals(outcome.benchResults.results[0]!.passed, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TEST6c: a normal (model-attributable) failure is still ingested as passed=false", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-test6c-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E003", [
        createMockExecutionAttempt({
          success: false,
          score: 0,
          failureReasons: ["Compilation failed: AL0118 identifier not found"],
        }),
      ]),
    ]);

    const outcome = await assembleBenchResultsForVariant(
      path,
      VARIANT,
      ASSEMBLE_OPTS,
    );
    assertEquals(outcome.kind, "assembled");
    if (outcome.kind !== "assembled") return;
    assertEquals(outcome.infraExcludedAttempts, 0);
    assertEquals(outcome.benchResults.results.length, 1);
    assertEquals(outcome.benchResults.results[0]!.passed, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TEST6d: ALL attempts infra-invalidated → all_infra sentinel, no payload built", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-test6d-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E004", [infraAttempt({ attemptNumber: 1 })]),
      makeResult("CG-AL-E005", [
        // Quarantined marker — third invalidation signal.
        createMockExecutionAttempt({
          success: false,
          score: 0,
          failureReasons: ["Tests failed on quarantined container"],
          quarantined: {
            quarantined: true,
            forcedByAlertId: "alert-3",
            originContainer: "Cronus28",
            classificationReason: "container_quarantined",
          },
        }),
      ]),
    ]);

    const outcome = await assembleBenchResultsForVariant(
      path,
      VARIANT,
      ASSEMBLE_OPTS,
    );
    assertEquals(outcome.kind, "all_infra");
    if (outcome.kind !== "all_infra") return;
    assertEquals(outcome.infraExcludedAttempts, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TEST6: variant with no matching results → no_results sentinel", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-test6e-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E006", [createMockExecutionAttempt({ success: true })]),
    ]);
    const otherVariant: ModelVariant = {
      ...VARIANT,
      model: "other-model",
      baseModel: "other-model",
      variantId: "mock/other-model",
    };
    const outcome = await assembleBenchResultsForVariant(
      path,
      otherVariant,
      ASSEMBLE_OPTS,
    );
    assertEquals(outcome.kind, "no_results");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
