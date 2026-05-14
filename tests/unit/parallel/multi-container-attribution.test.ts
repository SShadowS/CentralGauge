/**
 * Regression test: multi-container health attribution
 *
 * Verifies that outcomes from a 3-container, 6-task run are correctly
 * attributed to the container that actually performed the work, not
 * the --container default. If the bug were reintroduced (bridge recording
 * against result.context.containerName instead of per-attempt containerName),
 * only one container would show non-zero counts and the per-container
 * assertion below would fail.
 */

import { assertEquals, assertExists } from "@std/assert";
import { ParallelBenchmarkOrchestrator } from "../../../src/parallel/orchestrator.ts";
import type { LLMWorkPool } from "../../../src/parallel/llm-work-pool.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import { DashboardStateManager } from "../../../cli/dashboard/state.ts";
import { DashboardEventBridge } from "../../../cli/dashboard/bridge.ts";
import type { DashboardConfig } from "../../../cli/dashboard/types.ts";
import { createMockTaskManifest } from "../../utils/test-helpers.ts";
import { MockLLMWorkPool } from "../../utils/mock-llm-work-pool.ts";
import { MultiContainerMockCompileQueue } from "../../utils/multi-container-mock-compile-queue.ts";
import { createMockContainerProvider } from "../../utils/mock-container-provider.ts";

const CONTAINERS = ["Cronus28", "Cronus281", "Cronus282"] as const;
const TASK_IDS = [
  "CG-ATTR-01",
  "CG-ATTR-02",
  "CG-ATTR-03",
  "CG-ATTR-04",
  "CG-ATTR-05",
  "CG-ATTR-06",
];

/** Wire up the LLM mock so every task immediately produces compilable code. */
function buildLLMPool(): MockLLMWorkPool {
  const pool = new MockLLMWorkPool();
  pool.submitBatch = (items) => {
    const results = new Map();
    for (const item of items) {
      results.set(item.llmModel, {
        workItemId: item.id,
        success: true,
        code: `codeunit 50100 "Attr Test" { trigger OnRun() begin end; }`,
        llmResponse: {
          content: "test",
          model: item.llmModel,
          duration: 50,
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        duration: 50,
        readyForCompile: true,
      });
    }
    return Promise.resolve(results);
  };
  return pool;
}

/** One model variant used in every run. */
function buildVariants(): ModelVariant[] {
  return [
    {
      originalSpec: "mock/mock-gpt-4",
      baseModel: "mock-gpt-4",
      provider: "mock",
      model: "mock-gpt-4",
      variantId: "mock/mock-gpt-4",
      hasVariant: false,
      config: {},
    },
  ];
}

Deno.test(
  "multi-container attribution: all 3 containers pre-seeded and each receives >= 1 outcome",
  async () => {
    // Build mocks
    const llmPool = buildLLMPool();
    const mockContainerProvider = createMockContainerProvider();
    const mockQueue = new MultiContainerMockCompileQueue([...CONTAINERS]);
    // All containers left at default success behavior (no faults injected).

    // Build DashboardStateManager with all 3 containers listed.
    const config: DashboardConfig = {
      models: ["mock/mock-gpt-4"],
      taskIds: TASK_IDS,
      totalRuns: 1,
      attempts: 2,
      temperature: 0.1,
      containerName: CONTAINERS[0],
      containerNames: [...CONTAINERS],
    };
    const dashboardState = new DashboardStateManager(config);
    // Bridge uses a no-op broadcast; we only need state mutations.
    const bridge = new DashboardEventBridge(dashboardState, () => {});

    // Step 1: pre-seed assertion. All 3 containers must appear in the health
    // snapshot before any tasks run — that is the fix from Task 5.
    const preSeed = dashboardState.getHealthSnapshot();
    assertEquals(
      preSeed.containers.length,
      3,
      `Expected 3 containers pre-seeded, got ${preSeed.containers.length}: ${
        JSON.stringify(preSeed.containers.map((c) => c.containerName))
      }`,
    );
    for (const name of CONTAINERS) {
      const found = preSeed.containers.find((c) => c.containerName === name);
      assertExists(
        found,
        `Container "${name}" missing from pre-seed snapshot`,
      );
    }

    // Wire orchestrator so bridge receives events.
    const orchestrator = new ParallelBenchmarkOrchestrator(
      { containerNames: [...CONTAINERS] },
      {
        llmPool: llmPool as unknown as LLMWorkPool,
        containerProviderFactory: () => mockContainerProvider,
        compileWorkQueueFactory: () => mockQueue,
      },
    );
    orchestrator.on((event) => bridge.handleEvent(event));

    // Run 6 tasks across 3 containers.
    const manifests = TASK_IDS.map((id) => createMockTaskManifest({ id }));
    await orchestrator.runParallel(
      manifests,
      buildVariants(),
      {
        containerProvider: "mock",
        containerName: CONTAINERS[0],
        attemptLimit: 2,
        temperature: 0.1,
        maxTokens: 4000,
        outputDir: "/tmp/test-output",
        debugMode: false,
        infraRetriesPerAttempt: 0,
      },
    );

    // Step 2: post-run assertions.
    const snapshot = dashboardState.getHealthSnapshot();

    // All 3 containers still listed.
    assertEquals(
      snapshot.containers.length,
      3,
      `Expected 3 containers after run, got ${snapshot.containers.length}: ${
        JSON.stringify(snapshot.containers.map((c) => c.containerName))
      }`,
    );

    // Each container received at least one outcome. If the old bug were
    // reintroduced, only CONTAINERS[0] would have non-zero counts.
    for (const name of CONTAINERS) {
      const health = snapshot.containers.find((c) => c.containerName === name);
      assertExists(
        health,
        `Container "${name}" missing from post-run snapshot`,
      );
      const totalOutcomes = health.passCount + health.failCount +
        health.errorCount;
      assertEquals(
        totalOutcomes > 0,
        true,
        `Container "${name}" has 0 outcomes (passCount=${health.passCount} failCount=${health.failCount} errorCount=${health.errorCount}) — attribution is broken`,
      );
    }
  },
);
