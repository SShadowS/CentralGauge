import { assertEquals } from "@std/assert";
import { buildCompileWorkItem } from "../../../../src/parallel/shared/compile-work-item.ts";
import {
  createMockLLMResponse,
  createMockTaskExecutionContext,
} from "../../../utils/test-helpers.ts";

Deno.test("buildCompileWorkItem derives the id and carries overlayBase only when given", () => {
  const context = createMockTaskExecutionContext();
  const response = createMockLLMResponse();
  const createdAt = new Date("2026-09-06T00:00:00Z");
  const item = buildCompileWorkItem({
    executionId: "ex",
    attemptNumber: 2,
    workItemId: "w",
    context,
    code: "code",
    llmResponse: response,
    createdAt,
  });
  assertEquals(item.id, "compile_ex_2");
  assertEquals(item.llmWorkItemId, "w");
  assertEquals(item.attemptNumber, 2);
  assertEquals(item.code, "code");
  assertEquals(item.createdAt, createdAt);
  assertEquals("overlayBase" in item, false);
  const withOverlay = buildCompileWorkItem({
    executionId: "ex",
    attemptNumber: 2,
    workItemId: "w",
    context,
    code: "code",
    llmResponse: response,
    overlayBase: "base",
  });
  assertEquals(withOverlay.overlayBase, "base");
});
