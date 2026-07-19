/**
 * T3 — assembly consumes a persisted run_id instead of minting a fresh
 * UUID per invocation (the documented replay path double-counted runs).
 * T5 — attempts >2 must throw ValidationError instead of silently
 * collapsing to attempt=2 (which violates the D1 UNIQUE(run_id,task_id,
 * attempt) + CHECK attempt IN (1,2) constraints and kills the whole batch).
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "@std/assert";
import { join } from "@std/path";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import type { ExecutionAttempt } from "../../../src/tasks/interfaces.ts";
import { assembleBenchResultsForVariant } from "../../../cli/commands/bench/ingest-assembly.ts";
import { ValidationError } from "../../../src/errors.ts";
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

Deno.test("T3: persisted runId + pricingVersion are reused verbatim across assembles", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-t3a-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E001", [createMockExecutionAttempt({ success: true })]),
    ]);
    const opts = {
      pricingVersion: "2026-07-01",
      runId: "11111111-2222-4333-8444-555555555555",
    };

    const first = await assembleBenchResultsForVariant(path, VARIANT, opts);
    const second = await assembleBenchResultsForVariant(path, VARIANT, opts);
    assertEquals(first.kind, "assembled");
    assertEquals(second.kind, "assembled");
    if (first.kind !== "assembled" || second.kind !== "assembled") return;

    assertEquals(first.benchResults.runId, opts.runId);
    assertEquals(second.benchResults.runId, opts.runId);
    assertEquals(first.benchResults.pricingVersion, "2026-07-01");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("T3: absent runId mints a fresh UUID per assemble (legacy files) with a loud WARN", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-t3b-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E001", [createMockExecutionAttempt({ success: true })]),
    ]);
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const first = await assembleBenchResultsForVariant(path, VARIANT, {
        pricingVersion: "2026-07-01",
      });
      const second = await assembleBenchResultsForVariant(path, VARIANT, {
        pricingVersion: "2026-07-01",
      });
      if (first.kind !== "assembled" || second.kind !== "assembled") {
        throw new Error("expected assembled outcomes");
      }
      assertNotEquals(first.benchResults.runId, second.benchResults.runId);
      assert(
        warnings.some((w) => w.includes("NEW run")),
        `expected a loud no-persisted-run_id warning, got: ${
          warnings.join("|")
        }`,
      );
    } finally {
      console.warn = origWarn;
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("T5: a surviving attempt with attemptNumber > 2 throws ValidationError", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-t5-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E001", [
        createMockExecutionAttempt({ attemptNumber: 1, success: false }),
        createMockExecutionAttempt({ attemptNumber: 2, success: false }),
        createMockExecutionAttempt({ attemptNumber: 3, success: true }),
      ]),
    ]);
    await assertRejects(
      () =>
        assembleBenchResultsForVariant(path, VARIANT, {
          pricingVersion: "2026-07-01",
        }),
      ValidationError,
      "max 2 attempts",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("T5: attemptNumber <= 2 still assembles (attempt 0/1 map to 1)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-t5b-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E001", [
        createMockExecutionAttempt({ attemptNumber: 1, success: false }),
        createMockExecutionAttempt({ attemptNumber: 2, success: true }),
      ]),
    ]);
    const outcome = await assembleBenchResultsForVariant(path, VARIANT, {
      pricingVersion: "2026-07-01",
      runId: "persisted-run",
    });
    assertEquals(outcome.kind, "assembled");
    if (outcome.kind !== "assembled") return;
    assertEquals(outcome.benchResults.results.length, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
