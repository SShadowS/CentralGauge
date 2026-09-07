/**
 * `status`: a read-mostly summary of one batch run directory (spec section
 * 8). No network call unless the run is `submit-unknown`, in which case a
 * supplied `provider.listCandidates` is consulted (spec 4.3's
 * skew-tolerant reconciliation window) so the operator sees the same
 * candidates `retry` would.
 *
 * `nextAction` is derived from `src/batch/transitions.ts`'s `nextStep` -
 * the SAME pure decision table `advance` runs on - collapsed to the five
 * operator-facing strings the spec names: `"advance (processing)"`,
 * `"advance (collect + evaluate)"`, `"retry --adopt <id> |
 * --confirm-not-submitted"`, `"blocked: <reason>"`, `"done"`.
 *
 * @module src/batch/status
 */
import { join } from "@std/path";
import type { BatchCandidate, BatchProvider } from "../llm/batch/types.ts";
import type { ExecutionAttempt } from "../tasks/interfaces.ts";
import type { FrozenPromptInputs } from "../parallel/shared/prompt-inputs.ts";
import type { BatchRunState } from "./state.ts";
import { loadState } from "./state.ts";
import { readIntent } from "./intent.ts";
import { attemptPath, RUN_FILES } from "./paths.ts";
import type { Step } from "./transitions.ts";
import { nextStep } from "./transitions.ts";

export interface RunStatus {
  runId: string;
  model: string;
  phase: string;
  wave: number;
  batches: Array<
    {
      id: string;
      status: string;
      counts: Record<string, number>;
      ageMinutes: number;
      reportedCostUsd: number | null;
    }
  >;
  unresolved: number;
  evaluated: number;
  candidates?: BatchCandidate[];
  lastError?: BatchRunState["lastError"];
  nextAction: string;
}

/** Ten minutes: the same clock-skew tolerance `src/batch/reconcile.ts` uses (spec 4.3). */
const WINDOW_SKEW_MS = 10 * 60_000;

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

/**
 * Every `ExecutionAttempt` already on disk for the run's CURRENT wave,
 * keyed by task id, the same shape `advance.ts`'s private
 * `loadAttemptsForWave` builds, needed here only for `nextStep`'s wave-2
 * eligibility decision (spec D10).
 */
async function loadAttemptsForCurrentWave(
  dir: string,
  state: BatchRunState,
): Promise<Map<string, ExecutionAttempt>> {
  const out = new Map<string, ExecutionAttempt>();
  for (const taskId of Object.keys(state.tasks)) {
    const summary = state.tasks[taskId]!;
    const item = state.wave === 1 ? summary.attempt1 : summary.attempt2;
    if (!item || item.state !== "evaluated") continue;
    try {
      const stored = await readJsonFile<
        { schemaVersion: 1; attempt: ExecutionAttempt }
      >(attemptPath(dir, taskId, state.wave));
      out.set(taskId, stored.attempt);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  return out;
}

/** Collapses a `Step` into one of the five operator-facing next-action strings. */
function nextActionFor(step: Step): string {
  switch (step.kind) {
    case "poll":
      return "advance (processing)";
    case "collect":
    case "evaluate":
    case "resubmit":
    case "submit-wave-2":
    case "finalize":
      return "advance (collect + evaluate)";
    case "reconcile":
      return "retry --adopt <id> | --confirm-not-submitted";
    case "blocked":
      return `blocked: ${step.reason}`;
    case "done":
      return "done";
  }
}

/** Counts every `ItemSummary` across both attempt slots by evaluated vs. not. */
function countItems(
  state: BatchRunState,
): { unresolved: number; evaluated: number } {
  let unresolved = 0;
  let evaluated = 0;
  for (const summary of Object.values(state.tasks)) {
    for (const item of [summary.attempt1, summary.attempt2]) {
      if (!item) continue;
      if (item.state === "evaluated") evaluated++;
      else unresolved++;
    }
  }
  return { unresolved, evaluated };
}

/**
 * `attemptLimit` for `nextStep`, read back from the run's own frozen
 * `prompt-inputs.json` (`settings.max_attempts`) rather than re-resolved
 * from a preset. A `prepared` run with no prompt-inputs.json yet (should
 * not happen in practice; `submit` writes it before `state.json`) defaults
 * to 2, `nextStep`'s only other observed value.
 */
async function attemptLimitFor(dir: string): Promise<1 | 2> {
  try {
    const inputs = await readJsonFile<FrozenPromptInputs>(
      join(dir, RUN_FILES.promptInputs),
    );
    return inputs.settings.max_attempts === 1 ? 1 : 2;
  } catch {
    return 2;
  }
}

/**
 * Builds a `RunStatus` for the run at `dir`. `provider` is only consulted
 * (via `listCandidates`) when the run is `submit-unknown`; every other
 * phase never touches the network.
 */
export async function runStatus(
  dir: string,
  provider?: BatchProvider,
): Promise<RunStatus> {
  const state = await loadState(dir);
  const now = Date.now();

  const batches = state.batches.map((record) => ({
    id: record.handle.batchId,
    status: record.providerStatus,
    counts: record.rawCounts,
    ageMinutes: Math.round(
      (now - Date.parse(record.submittedAt)) / 60_000,
    ),
    reportedCostUsd: record.providerReportedCostUsd ?? null,
  }));

  const { unresolved, evaluated } = countItems(state);

  const intent = await readIntent(dir);
  const hasIntent = intent !== null;

  let candidates: BatchCandidate[] | undefined;
  if (state.phase === "submit-unknown" && provider && intent) {
    const since = new Date(Date.parse(intent.writtenAt) - WINDOW_SKEW_MS);
    candidates = await provider.listCandidates(since);
  }

  const attempts = await loadAttemptsForCurrentWave(dir, state);
  const attemptLimit = await attemptLimitFor(dir);
  const step = nextStep(state, hasIntent, attempts, attemptLimit);

  const result: RunStatus = {
    runId: state.runId,
    model: state.model.slug,
    phase: state.phase,
    wave: state.wave,
    batches,
    unresolved,
    evaluated,
    nextAction: nextActionFor(step),
  };
  if (candidates !== undefined) result.candidates = candidates;
  if (state.lastError !== undefined) result.lastError = state.lastError;
  return result;
}

/** `[Tag]`-prefixed lines: one header per run, one line per batch. */
export function formatStatus(rows: RunStatus[]): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(
      `[batch] ${row.runId} model=${row.model} phase=${row.phase} wave=${row.wave} ` +
        `unresolved=${row.unresolved} evaluated=${row.evaluated} next=${row.nextAction}`,
    );
    for (const b of row.batches) {
      lines.push(
        `  [batch] ${b.id} status=${b.status} age=${b.ageMinutes}m ` +
          `cost=${b.reportedCostUsd ?? "?"} counts=${JSON.stringify(b.counts)}`,
      );
    }
  }
  return lines;
}
