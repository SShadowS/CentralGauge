// src/parallel/shared/compile-work-item.ts

import type { LLMResponse } from "../../llm/types.ts";
import type { TaskExecutionContext } from "../../tasks/interfaces.ts";
import type { CompileWorkItem } from "../types.ts";

/**
 * Input to `buildCompileWorkItem` — everything needed to build the
 * compile-queue work item for a single attempt (spec D6). Used by both the
 * sync orchestrator's `executeCompilation` and the future batch runner.
 */
export interface BuildCompileWorkItemInput {
  executionId: string;
  attemptNumber: number;
  workItemId: string;
  context: TaskExecutionContext;
  code: string;
  llmResponse: LLMResponse;
  overlayBase?: string;
  createdAt?: Date;
}

/**
 * Build a `CompileWorkItem` from a successful LLM result. Pure: the id is
 * derived deterministically from `executionId`/`attemptNumber` and the
 * timestamp is injectable so both callers and tests are deterministic.
 */
export function buildCompileWorkItem(
  input: BuildCompileWorkItemInput,
): CompileWorkItem {
  return {
    id: `compile_${input.executionId}_${input.attemptNumber}`,
    llmWorkItemId: input.workItemId,
    code: input.code,
    context: input.context,
    attemptNumber: input.attemptNumber,
    llmResponse: input.llmResponse,
    ...(input.overlayBase !== undefined
      ? { overlayBase: input.overlayBase }
      : {}),
    createdAt: input.createdAt ?? new Date(),
  };
}
