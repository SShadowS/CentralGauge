import { assert, assertEquals, assertRejects } from "@std/assert";
import { attempt2Eligible, renderWave } from "../../../src/batch/render.ts";
import { frozenInputs, minimalState } from "../../utils/batch-fixtures.ts";
import {
  createMockExecutionAttempt,
  createMockTaskExecutionContext,
  createMockTaskManifest,
} from "../../utils/test-helpers.ts";
import type { ExecutionAttempt } from "../../../src/tasks/interfaces.ts";
import type { LLMRequest } from "../../../src/llm/types.ts";

function deps(prior?: Map<string, ExecutionAttempt>) {
  const manifests = new Map([
    [
      "CG-AL-E001",
      createMockTaskManifest({
        id: "CG-AL-E001",
        description: "Create Ping.",
      }),
    ],
  ]);
  const contexts = new Map([
    [
      "CG-AL-E001",
      createMockTaskExecutionContext({
        manifest: manifests.get("CG-AL-E001")!,
        instructions: "Create Ping.",
      }),
    ],
  ]);
  return {
    buildBody: (request: LLMRequest) => ({
      messages: [{ role: "user", content: request.prompt }],
    }),
    inputs: frozenInputs(),
    manifests,
    contexts,
    ...(prior ? { priorAttempts: prior } : {}),
  };
}

Deno.test("renderWave wave 1 renders one item per task with the deterministic id", async () => {
  const state = minimalState({ runId: "run-1" });
  const items = await renderWave(state, 1, 0, ["CG-AL-E001"], deps());
  assertEquals(items.length, 1);
  assertEquals(items[0]?.attempt, 1);
  assert(items[0]?.request.prompt.includes("Create Ping."));
  assertEquals(items[0]?.itemId.length, 32);
  assertEquals(items[0]?.bodyDigest.length, 64);
});

Deno.test("renderWave wave 2 needs a prior attempt and renders the fix prompt", async () => {
  const state = minimalState({ runId: "run-1" });
  await assertRejects(() => renderWave(state, 2, 0, ["CG-AL-E001"], deps()));

  const prior = createMockExecutionAttempt({
    attemptNumber: 1,
    success: false,
    extractedCode: "codeunit 70001 Ping { }",
    failureReasons: ["Tests failed", "  T: nope"],
  });
  const items = await renderWave(
    state,
    2,
    0,
    ["CG-AL-E001"],
    deps(new Map([["CG-AL-E001", prior]])),
  );
  assert(items[0]?.request.prompt.includes("nope"));
  assertEquals(items[0]?.attempt, 2);
});

Deno.test("attempt2Eligible follows D10", () => {
  const tasks = {
    A: {
      attempt1: {
        itemId: "x",
        round: 0 as const,
        ownerRound: 0 as const,
        state: "evaluated" as const,
      },
    },
    B: {
      attempt1: {
        itemId: "y",
        round: 0 as const,
        ownerRound: 0 as const,
        state: "evaluated" as const,
      },
    },
    C: {
      attempt1: {
        itemId: "z",
        round: 0 as const,
        ownerRound: 0 as const,
        state: "evaluated" as const,
      },
    },
  };
  const attempts = new Map([
    ["A", createMockExecutionAttempt({ attemptNumber: 1, success: true })],
    ["B", createMockExecutionAttempt({ attemptNumber: 1, success: false })],
    [
      "C",
      createMockExecutionAttempt({
        attemptNumber: 1,
        success: false,
        infraSynthesized: true,
      }),
    ],
  ]);
  assertEquals(attempt2Eligible(tasks, attempts), ["B"]);
});
