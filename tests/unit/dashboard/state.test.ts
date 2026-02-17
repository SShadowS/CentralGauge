/**
 * Tests for DashboardStateManager
 */

import { assertEquals, assertExists } from "@std/assert";
import { DashboardStateManager } from "../../../cli/dashboard/state.ts";
import { cellKey } from "../../../cli/dashboard/state.ts";
import type { DashboardConfig } from "../../../cli/dashboard/types.ts";

function createConfig(
  overrides: Partial<DashboardConfig> = {},
): DashboardConfig {
  return {
    models: ["model-a", "model-b"],
    taskIds: ["task-1", "task-2"],
    totalRuns: 1,
    attempts: 2,
    temperature: 0.1,
    containerName: "Cronus27",
    ...overrides,
  };
}

Deno.test("DashboardStateManager", async (t) => {
  await t.step("cellKey generates correct keys", () => {
    assertEquals(cellKey("task-1", "model-a", 1), "task-1|model-a|1");
    assertEquals(cellKey("CG-AL-E001", "sonnet", 3), "CG-AL-E001|sonnet|3");
  });

  await t.step("initializeCells creates pending cells", () => {
    const state = new DashboardStateManager(createConfig());
    state.initializeCells(["task-1", "task-2"], ["model-a", "model-b"], 1);

    const full = state.getFullState();
    assertEquals(Object.keys(full.cells).length, 4);

    const cell = full.cells["task-1|model-a|1"];
    assertExists(cell);
    assertEquals(cell.state, "pending");
    assertEquals(cell.attempt, 0);
    assertEquals(cell.taskId, "task-1");
    assertEquals(cell.model, "model-a");
    assertEquals(cell.run, 1);
  });

  await t.step("updateCell modifies cell state", () => {
    const state = new DashboardStateManager(createConfig());
    state.initializeCells(["task-1"], ["model-a"], 1);

    const result = state.updateCell("task-1|model-a|1", {
      state: "llm",
      attempt: 1,
    });

    assertExists(result);
    assertEquals(result.cell.state, "llm");
    assertEquals(result.cell.attempt, 1);
  });

  await t.step("updateCell returns null for non-existent key", () => {
    const state = new DashboardStateManager(createConfig());
    const result = state.updateCell("nonexistent", { state: "llm" });
    assertEquals(result, null);
  });

  await t.step("getCell retrieves cell by key", () => {
    const state = new DashboardStateManager(createConfig());
    state.initializeCells(["task-1"], ["model-a"], 1);

    const cell = state.getCell("task-1|model-a|1");
    assertExists(cell);
    assertEquals(cell.state, "pending");

    assertEquals(state.getCell("nonexistent"), undefined);
  });

  await t.step("recalculateModelStats computes correctly", () => {
    const state = new DashboardStateManager(createConfig());
    state.initializeCells(["task-1", "task-2"], ["model-a", "model-b"], 1);

    // model-a: 1 pass (attempt 1), 1 fail
    state.updateCell("task-1|model-a|1", {
      state: "pass",
      attempt: 1,
      cost: 0.05,
    });
    state.updateCell("task-2|model-a|1", { state: "fail" });

    // model-b: 2 pass (1st + 2nd attempt)
    state.updateCell("task-1|model-b|1", {
      state: "pass",
      attempt: 1,
      cost: 0.03,
    });
    state.updateCell("task-2|model-b|1", {
      state: "pass",
      attempt: 2,
      cost: 0.04,
    });

    const stats = state.recalculateModelStats();
    assertEquals(stats.length, 2);

    const modelA = stats.find((s) => s.model === "model-a")!;
    assertEquals(modelA.passed, 1);
    assertEquals(modelA.failed, 1);
    assertEquals(modelA.passRate, 0.5);
    assertEquals(modelA.attempt1Passes, 1);
    assertEquals(modelA.attempt2Passes, 0);
    assertEquals(modelA.totalCost, 0.05);

    const modelB = stats.find((s) => s.model === "model-b")!;
    assertEquals(modelB.passed, 2);
    assertEquals(modelB.failed, 0);
    assertEquals(modelB.passRate, 1);
    assertEquals(modelB.attempt1Passes, 1);
    assertEquals(modelB.attempt2Passes, 1);
  });

  await t.step("getProgress computes from cell states", () => {
    const state = new DashboardStateManager(createConfig());
    state.initializeCells(["task-1", "task-2"], ["model-a"], 1);

    // 1 completed, 1 pending
    state.updateCell("task-1|model-a|1", { state: "pass" });

    const progress = state.getProgress();
    assertEquals(progress.totalCells, 2);
    assertEquals(progress.completedCells, 1);
    assertEquals(progress.activeLLMCalls, 0);
  });

  await t.step("getProgress tracks active LLM calls", () => {
    const state = new DashboardStateManager(createConfig());
    state.initializeCells(["task-1", "task-2"], ["model-a"], 1);

    state.updateCell("task-1|model-a|1", { state: "llm", attempt: 1 });

    const progress = state.getProgress();
    assertEquals(progress.activeLLMCalls, 1);
    assertEquals(progress.completedCells, 0);
  });

  await t.step("addCostPoint tracks cumulative cost", () => {
    const state = new DashboardStateManager(createConfig());

    state.addCostPoint({
      timestamp: Date.now(),
      model: "model-a",
      cost: 0.05,
      cumulativeCost: 0.05,
    });
    state.addCostPoint({
      timestamp: Date.now(),
      model: "model-b",
      cost: 0.03,
      cumulativeCost: 0.08,
    });

    const full = state.getFullState();
    assertEquals(full.costHistory.length, 2);
    assertEquals(full.progress.totalCost, 0.08);
  });

  await t.step("markComplete sets isRunning to false", () => {
    const state = new DashboardStateManager(createConfig());
    assertEquals(state.getFullState().isRunning, true);

    state.markComplete();
    assertEquals(state.getFullState().isRunning, false);
  });

  await t.step("getFullState includes config", () => {
    const config = createConfig({ totalRuns: 3 });
    const state = new DashboardStateManager(config);

    const full = state.getFullState();
    assertEquals(full.config.totalRuns, 3);
    assertEquals(full.models, ["model-a", "model-b"]);
    assertEquals(full.taskIds, ["task-1", "task-2"]);
    assertEquals(full.totalRuns, 3);
  });

  await t.step("multi-run: tracks runs separately", () => {
    const config = createConfig({ totalRuns: 2 });
    const state = new DashboardStateManager(config);

    state.initializeCells(["task-1"], ["model-a"], 1);
    state.updateCell("task-1|model-a|1", { state: "pass", attempt: 1 });

    state.initializeCells(["task-1"], ["model-a"], 2);
    state.updateCell("task-1|model-a|2", { state: "fail" });

    const full = state.getFullState();
    assertEquals(full.cells["task-1|model-a|1"]?.state, "pass");
    assertEquals(full.cells["task-1|model-a|2"]?.state, "fail");
    assertEquals(full.currentRun, 2);
  });
});
