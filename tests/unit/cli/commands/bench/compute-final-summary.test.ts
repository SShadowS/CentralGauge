/**
 * Tests for `computeFinalSummary` (CLI2).
 *
 * The bench retry loop in `executeParallelBenchmark` only re-runs the
 * transiently-failed subset of (task, model) pairs. Before this fix, the
 * displayed/saved stats came from the orchestrator's `summary` for that
 * LAST `runParallel()` call only, covering just the retried subset, not
 * the full accumulated result set. `computeFinalSummary` recomputes stats
 * + comparisons from the complete merged results array instead.
 *
 * @module tests/unit/cli/commands/bench/compute-final-summary
 */

import { assertEquals } from "@std/assert";
import { computeFinalSummary } from "../../../../../cli/commands/bench/parallel-executor.ts";
import type { TaskExecutionResult } from "../../../../../src/tasks/interfaces.ts";
import { createMockTaskExecutionContext } from "../../../../utils/test-helpers.ts";

function makeResult(
  taskId: string,
  variantId: string,
  success: boolean,
): TaskExecutionResult {
  return {
    taskId,
    executionId: `${taskId}-${variantId}-exec`,
    context: createMockTaskExecutionContext({ variantId }),
    attempts: [],
    success,
    finalScore: success ? 100 : 0,
    totalTokensUsed: 100,
    totalCost: 0.01,
    totalDuration: 1000,
    passedAttemptNumber: success ? 1 : 0,
    successRate: success ? 1 : 0,
    executedAt: new Date(),
    executedBy: "centralgauge",
    environment: {},
  };
}

Deno.test("computeFinalSummary", async (t) => {
  await t.step(
    "CLI2: stats cover the FULL accumulated set, not just a retried subset",
    () => {
      // 10 results total (8 pass, 2 fail), simulating a run where the
      // last runParallel() call in the retry loop only covers the 2
      // retried (previously-transient) results.
      const allResults: TaskExecutionResult[] = [];
      for (let i = 1; i <= 8; i++) {
        allResults.push(makeResult(`CG-AL-T${i}`, "mock/mock-gpt-4", true));
      }
      allResults.push(makeResult("CG-AL-T09", "mock/mock-gpt-4", false));
      allResults.push(makeResult("CG-AL-T10", "mock/mock-gpt-4", false));

      const summary = computeFinalSummary(allResults);

      // Stats must reflect all 10 results, not just the 2 that were retried.
      assertEquals(summary.results.length, 10);
      assertEquals(summary.stats.passNum1, 8);
      assertEquals(summary.stats.overallPassRate, 0.8);

      const modelStat = summary.stats.perModel.get("mock/mock-gpt-4");
      assertEquals(modelStat?.tasksPassed, 8);
      assertEquals(modelStat?.tasksFailed, 2);
    },
  );

  await t.step("produces one comparison per distinct task", () => {
    const allResults: TaskExecutionResult[] = [
      makeResult("CG-AL-T01", "mock/mock-gpt-4", true),
      makeResult("CG-AL-T01", "mock/mock-claude", false),
      makeResult("CG-AL-T02", "mock/mock-gpt-4", true),
    ];

    const summary = computeFinalSummary(allResults);

    assertEquals(summary.comparisons.length, 2);
    const t01 = summary.comparisons.find((c) => c.taskId === "CG-AL-T01");
    assertEquals(t01?.passingModels, ["mock/mock-gpt-4"]);
    assertEquals(t01?.failingModels, ["mock/mock-claude"]);
  });

  await t.step("handles an empty result set", () => {
    const summary = computeFinalSummary([]);
    assertEquals(summary.results.length, 0);
    assertEquals(summary.comparisons.length, 0);
    assertEquals(summary.stats.overallPassRate, 0);
  });

  await t.step(
    "retried entries replace the stale pre-retry entry for the same (task, variant) pair",
    () => {
      // Simulates the merge the caller performs before calling
      // computeFinalSummary: the retried (now-passing) result has already
      // replaced the original failure for the same task+variant key.
      const allResults: TaskExecutionResult[] = [
        makeResult("CG-AL-T01", "mock/mock-gpt-4", true), // retried: now passes
        makeResult("CG-AL-T02", "mock/mock-gpt-4", true),
      ];

      const summary = computeFinalSummary(allResults);

      assertEquals(summary.results.length, 2);
      assertEquals(summary.stats.passNum1, 2);
      assertEquals(summary.stats.overallPassRate, 1);
    },
  );
});
