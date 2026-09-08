/**
 * Wave rendering: turn a set of task ids into {@link RenderedItem}s for wave
 * 1 or wave 2 through Plan A's `renderLLMRequest` (spec sections 4.1, D6,
 * D13), plus the attempt-2 eligibility rule (spec D10).
 *
 * @module src/batch/render
 */
import type { LLMRequest } from "../llm/types.ts";
import type { FrozenPromptInputs } from "../parallel/shared/prompt-inputs.ts";
import type {
  ExecutionAttempt,
  TaskExecutionContext,
  TaskManifest,
} from "../tasks/interfaces.ts";
import type { BatchRunState, TaskSummary } from "./state.ts";
import { renderLLMRequest } from "../parallel/shared/render-request.ts";
import { bodyDigest, itemIdFor } from "./items.ts";

export interface RenderedItem {
  itemId: string;
  taskId: string;
  attempt: 1 | 2;
  round: 0 | 1;
  request: LLMRequest;
  body: unknown;
  bodyDigest: string;
}

export interface WaveRenderDeps {
  /** Provider-specific: `adapter.buildRequestParams(...)` wrapped per Tasks 13/15/16. */
  buildBody: (request: LLMRequest) => unknown;
  /** From `prompt-inputs.json`. */
  inputs: FrozenPromptInputs;
  manifests: Map<string, TaskManifest>;
  /** From `buildAttemptContext` per task at submit. */
  contexts: Map<string, TaskExecutionContext>;
  /** Attempt 1 records, for wave 2. */
  priorAttempts?: Map<string, ExecutionAttempt>;
}

/**
 * Renders one item per task id for `wave`. Wave 1 renders the generation
 * prompt (`renderLLMRequest({ context, attemptNumber: 1, inputs })`); wave 2
 * renders the fix prompt from the task's attempt-1 record and throws if
 * that prior is missing: a caller must already have filtered to
 * {@link attempt2Eligible} task ids before calling this for wave 2.
 */
export async function renderWave(
  state: BatchRunState,
  wave: 1 | 2,
  round: 0 | 1,
  taskIds: string[],
  deps: WaveRenderDeps,
): Promise<RenderedItem[]> {
  const out: RenderedItem[] = [];
  for (const taskId of taskIds) {
    const context = deps.contexts.get(taskId);
    if (!context) {
      throw new Error(`renderWave: no context for ${taskId}`);
    }
    const attempt: 1 | 2 = wave === 1 ? 1 : 2;
    const prior = wave === 2 ? deps.priorAttempts?.get(taskId) : undefined;
    if (wave === 2 && !prior) {
      throw new Error(`renderWave: wave 2 needs attempt 1 of ${taskId}`);
    }

    const request = await renderLLMRequest({
      context,
      attemptNumber: attempt,
      ...(prior ? { prior } : {}),
      inputs: deps.inputs,
    });
    const body = deps.buildBody(request);

    out.push({
      itemId: await itemIdFor(state.runId, taskId, attempt, round),
      taskId,
      attempt,
      round,
      request,
      body,
      bodyDigest: await bodyDigest(body),
    });
  }
  return out;
}

/**
 * D10: a task is eligible for attempt 2 exactly when attempt 1 ran, did not
 * pass, and was not infra-synthesized (an infra-synthesized failure gets a
 * fresh attempt-1 retry instead of consuming the model's fix attempt).
 * Sorted for a deterministic wave-2 item order.
 */
export function attempt2Eligible(
  tasks: Record<string, TaskSummary>,
  attempts: Map<string, ExecutionAttempt>,
): string[] {
  return Object.keys(tasks).filter((taskId) => {
    const a1 = attempts.get(taskId);
    return a1 !== undefined && !a1.success && !a1.infraSynthesized;
  }).sort();
}
