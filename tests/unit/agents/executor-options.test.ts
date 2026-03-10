import { assertEquals } from "@std/assert";
import type { QueryOptions } from "../../../src/agents/sdk-types.ts";
import type {
  AgentExecutionResult,
  AgentLimits,
  TerminationReason,
} from "../../../src/agents/types.ts";

Deno.test("QueryOptions", async (t) => {
  await t.step("settingSources is included in type", () => {
    const opts: QueryOptions = {
      model: "test",
      cwd: "/tmp",
      maxTurns: 10,
      systemPrompt: "test",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["project"],
    };
    assertEquals(opts.settingSources, ["project"]);
  });

  await t.step("settingSources accepts user and project", () => {
    const opts: QueryOptions = {
      model: "test",
      cwd: "/tmp",
      maxTurns: 10,
      systemPrompt: "test",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["user", "project"],
    };
    assertEquals(opts.settingSources, ["user", "project"]);
  });
});

Deno.test("maxBudgetUsd", async (t) => {
  await t.step("QueryOptions accepts maxBudgetUsd", () => {
    const opts: QueryOptions = {
      model: "test",
      cwd: "/tmp",
      maxTurns: 10,
      systemPrompt: "test",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxBudgetUsd: 0.50,
    };
    assertEquals(opts.maxBudgetUsd, 0.50);
  });

  await t.step("AgentLimits accepts maxBudgetUsd", () => {
    const limits: AgentLimits = {
      maxCompileAttempts: 15,
      timeoutMs: 300000,
      maxBudgetUsd: 1.00,
    };
    assertEquals(limits.maxBudgetUsd, 1.00);
  });

  await t.step("max_budget is a valid TerminationReason", () => {
    const reason: TerminationReason = "max_budget";
    assertEquals(reason, "max_budget");
  });
});

Deno.test("AgentExecutionResult SDK cost fields", async (t) => {
  await t.step("sdkCostUsd field exists on type", () => {
    const result: Partial<AgentExecutionResult> = {
      sdkCostUsd: 0.42,
    };
    assertEquals(result.sdkCostUsd, 0.42);
  });

  await t.step("sdkDurationMs field exists on type", () => {
    const result: Partial<AgentExecutionResult> = {
      sdkDurationMs: 12345,
    };
    assertEquals(result.sdkDurationMs, 12345);
  });

  await t.step("toolCallCounts field exists on type", () => {
    const result: Partial<AgentExecutionResult> = {
      toolCallCounts: { Read: 5, Write: 2 },
    };
    assertEquals(result.toolCallCounts?.["Read"], 5);
  });
});

Deno.test("AgentExecutionResult sessionId field", async (t) => {
  await t.step("sessionId field exists on type", () => {
    const result: Partial<AgentExecutionResult> = {
      sessionId: "abc-123-session",
    };
    assertEquals(result.sessionId, "abc-123-session");
  });

  await t.step("sessionId is optional", () => {
    const result: Partial<AgentExecutionResult> = {
      success: true,
    };
    assertEquals(result.sessionId, undefined);
  });
});
