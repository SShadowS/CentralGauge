import { assertEquals } from "@std/assert";
import { ParallelBenchmarkOrchestrator } from "../../../src/parallel/orchestrator.ts";
import type { UpstreamVerification } from "../../../src/llm/upstream-verification.ts";
import type { ExecutionAttempt } from "../../../src/tasks/interfaces.ts";
import { createMockExecutionAttempt } from "../../utils/test-helpers.ts";

function attemptWith(v: UpstreamVerification | undefined): ExecutionAttempt {
  const attempt = createMockExecutionAttempt();
  if (v !== undefined) attempt.upstreamVerification = v;
  return attempt;
}

Deno.test("the sync loop stops on a compromised attempt and records the terminal reason", () => {
  const orchestrator = new ParallelBenchmarkOrchestrator();
  for (const v of ["mismatch", "unverified"] as const) {
    const attempt = attemptWith(v);
    assertEquals(orchestrator.markTerminalIfCompromised(attempt), true);
    assertEquals(attempt.terminal, "upstream_compromised");
  }
});

Deno.test("the sync loop keeps going for every non-compromised verdict", () => {
  const orchestrator = new ParallelBenchmarkOrchestrator();
  const verdicts: (UpstreamVerification | undefined)[] = [
    "not_applicable",
    "unpinned",
    "verified",
    "not_served",
    undefined,
  ];
  for (const v of verdicts) {
    const attempt = attemptWith(v);
    assertEquals(orchestrator.markTerminalIfCompromised(attempt), false);
    assertEquals(attempt.terminal, undefined);
  }
});
