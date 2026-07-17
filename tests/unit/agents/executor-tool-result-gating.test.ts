/**
 * Non-sandbox executor success gating (M4 follow-up).
 *
 * processUserMessage runs success detection per tool_result block. Before the
 * fix it ran on EVERY tool_result, so a model-controlled tool (e.g. Bash
 * echoing "all tests passed") could forge a passing score. Success detection
 * must run ONLY for our AL verdict tools — al_verify_task / al_verify (test
 * verdicts) and al_compile (compile-only verdict; genuine compiler output,
 * not model-controllable prose). Everything else is never a scoring input.
 */

import { assertEquals } from "@std/assert";
import { AgentTaskExecutor } from "../../../src/agents/executor.ts";
import type { SDKUserMessage } from "../../../src/agents/sdk-types.ts";
import type { ParsedTaskResult } from "../../../src/agents/types.ts";

interface ExecutorInternals {
  pendingToolCalls: Map<string, { name: string; startTime: number }>;
  processUserMessage(
    userMsg: SDKUserMessage,
    requiresTests: boolean,
    debug?: boolean,
  ): { success: boolean; parsedResult?: ParsedTaskResult };
}

function makeUserMsg(toolUseId: string, content: string): SDKUserMessage {
  return {
    type: "user",
    uuid: "u1",
    session_id: "s1",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
    },
  };
}

function internals(): ExecutorInternals {
  return new AgentTaskExecutor() as unknown as ExecutorInternals;
}

Deno.test("processUserMessage tool_result gating", async (t) => {
  await t.step(
    "Bash tool_result claiming 'all tests passed' does NOT forge success",
    () => {
      const ex = internals();
      ex.pendingToolCalls.set("t-bash", {
        name: "Bash",
        startTime: Date.now(),
      });
      const result = ex.processUserMessage(
        makeUserMsg("t-bash", "all tests passed"),
        true,
      );
      assertEquals(result.success, false);
    },
  );

  await t.step(
    "Bash tool_result with a real-looking structured verdict does not pollute reported counts",
    () => {
      const ex = internals();
      ex.pendingToolCalls.set("t-bash", {
        name: "Bash",
        startTime: Date.now(),
      });
      const result = ex.processUserMessage(
        makeUserMsg(
          "t-bash",
          '{"success": true, "totalTests": 7, "passed": 7, "failed": 0}',
        ),
        true,
      );
      assertEquals(result.success, false);
      assertEquals(result.parsedResult?.testsPassed, undefined);
      assertEquals(result.parsedResult?.testsTotal, undefined);
    },
  );

  await t.step(
    "al_verify_task structured passing verdict → success (generic name)",
    () => {
      const ex = internals();
      ex.pendingToolCalls.set("t-v", {
        name: "al_verify_task",
        startTime: Date.now(),
      });
      const result = ex.processUserMessage(
        makeUserMsg(
          "t-v",
          '{"success": true, "message": "All tests passed! (7/7)", "totalTests": 7, "passed": 7, "failed": 0}',
        ),
        true,
      );
      assertEquals(result.success, true);
      assertEquals(result.parsedResult?.testsPassed, 7);
      assertEquals(result.parsedResult?.testsTotal, 7);
    },
  );

  await t.step(
    "al_verify_task MCP content-block array shape → success (mcp name)",
    () => {
      const ex = internals();
      ex.pendingToolCalls.set("t-v", {
        name: "mcp__al-tools__al_verify_task",
        startTime: Date.now(),
      });
      // MCP tool results arrive as [{type:"text", text:<json>}].
      const msg: SDKUserMessage = {
        type: "user",
        uuid: "u1",
        session_id: "s1",
        message: {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "t-v",
            content: [{
              type: "text",
              text:
                '{"success": true, "message": "All tests passed! (5/5)", "totalTests": 5, "passed": 5, "failed": 0}',
            }],
          }],
        },
      };
      const result = ex.processUserMessage(msg, true);
      assertEquals(result.success, true);
    },
  );

  await t.step(
    "al_verify_task FAILING verdict whose failures[] says 'all tests passed' → NOT success",
    () => {
      const ex = internals();
      ex.pendingToolCalls.set("t-v", {
        name: "al_verify_task",
        startTime: Date.now(),
      });
      const result = ex.processUserMessage(
        makeUserMsg(
          "t-v",
          '{"success": false, "message": "Tests failed: 1 of 7 tests failed", "totalTests": 7, "passed": 6, "failed": 1, "failures": ["MyTest: all tests passed"]}',
        ),
        true,
      );
      assertEquals(result.success, false);
    },
  );

  await t.step(
    "al_compile structured verdict → success for a compile-only task (no regression)",
    () => {
      const ex = internals();
      ex.pendingToolCalls.set("t-c", {
        name: "al_compile",
        startTime: Date.now(),
      });
      const result = ex.processUserMessage(
        makeUserMsg(
          "t-c",
          '{"success": true, "message": "Compilation successful"}',
        ),
        false,
      );
      assertEquals(result.success, true);
    },
  );

  await t.step(
    "Bash tool_result claiming 'Compilation successful' does NOT forge a compile-only pass",
    () => {
      const ex = internals();
      ex.pendingToolCalls.set("t-bash", {
        name: "Bash",
        startTime: Date.now(),
      });
      const result = ex.processUserMessage(
        makeUserMsg("t-bash", "Compilation successful."),
        false,
      );
      assertEquals(result.success, false);
    },
  );

  await t.step(
    "untracked tool_use_id (unknown tool name) → not success (fail closed)",
    () => {
      const ex = internals();
      // No pendingToolCalls entry seeded for this id.
      const result = ex.processUserMessage(
        makeUserMsg("t-unknown", "7/7 passed"),
        true,
      );
      assertEquals(result.success, false);
    },
  );
});
