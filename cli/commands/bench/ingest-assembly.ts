/**
 * Convert a saved benchmark-results JSON file into the BenchResults shape
 * expected by ingestRun(). One BenchResults per (results file × variant).
 * @module cli/commands/bench/ingest-assembly
 */

import type { BenchResultItem, BenchResults } from "../../../src/ingest/mod.ts";
import type {
  ExecutionAttempt,
  TaskExecutionResult,
} from "../../../src/tasks/interfaces.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import { isInfraInvalidatedAttempt } from "../../../src/health/infra-invalidation.ts";
import { ValidationError } from "../../../src/errors.ts";
import * as colors from "@std/fmt/colors";

interface SavedResultsFile {
  results: TaskExecutionResult[];
}

export interface AssembleOptions {
  pricingVersion: string;
  centralgaugeSha?: string;
  /**
   * Persisted run identity from the results file's `ingest` key (T3).
   * When absent, a fresh UUID is minted WITH a loud warning — the server
   * will see a NEW run, so a replay after a transient failure would
   * double-count unless the persisted id is supplied.
   */
  runId?: string;
  /**
   * Persisted bench-time task_set hash from the results file's `ingest` key.
   * Threaded onto {@link BenchResults.taskSetHash} so ingest files the run
   * under the hash it was benched against instead of recomputing from the
   * (possibly-drifted) working tree. Absent on legacy schema-1 files.
   */
  taskSetHash?: string;
}

/**
 * Outcome of assembling one (results file × variant) ingest payload.
 *
 * - `assembled` — payload built; `infraExcludedAttempts` counts attempts
 *   dropped because they were infra-invalidated (see
 *   {@link isInfraInvalidatedAttempt}). Guaranteed non-empty `results[]`.
 * - `no_results` — the file carries no results for this variant.
 * - `no_items` — results exist for the variant but produced zero attempts
 *   (empty `attempts[]` arrays). No payload is built: an empty run must
 *   never be POSTed.
 * - `all_infra` — EVERY attempt for this variant was infra-invalidated.
 *   No payload is built: an empty run must never be POSTed to the
 *   leaderboard. Callers must log loudly and treat the variant as
 *   non-success (fix infra, re-bench).
 */
export type AssembleOutcome =
  | {
    kind: "assembled";
    benchResults: BenchResults;
    infraExcludedAttempts: number;
  }
  | { kind: "no_results" }
  | { kind: "no_items" }
  | { kind: "all_infra"; infraExcludedAttempts: number };

/**
 * Decide whether an immediate-ingest run must be reported as NON-SUCCESS.
 * Returns the failure message to throw, or undefined for a clean run.
 * Pure + exported for testing.
 *
 * Rules:
 * - 100% transient with nothing landed → the user must not believe the run
 *   was ingested; replay required.
 * - ANY (file × variant) pair fully infra-invalidated → non-success, even
 *   when other pairs ingested fine (T2: "log loudly + non-success" —
 *   a partially-poisoned run still needs operator action + re-bench).
 */
export function decideIngestRunFailure(counts: {
  attempted: number;
  succeeded: number;
  transient: number;
  infraInvalidated: number;
}): string | undefined {
  if (
    counts.attempted > 0 && counts.succeeded === 0 &&
    counts.transient === counts.attempted
  ) {
    return `ingest failed: all ${counts.attempted} (file × variant) pair(s) hit transient errors; replay required`;
  }
  if (counts.infraInvalidated > 0) {
    return `ingest incomplete: ${counts.infraInvalidated} (file × variant) pair(s) were fully infra-invalidated and NOT ingested — fix infra and re-bench`;
  }
  return undefined;
}

export async function assembleBenchResultsForVariant(
  resultFilePath: string,
  variant: ModelVariant,
  opts: AssembleOptions,
): Promise<AssembleOutcome> {
  const raw = await Deno.readTextFile(resultFilePath);
  const data = JSON.parse(raw) as SavedResultsFile;

  const variantResults = data.results.filter((r) =>
    (r.context?.variantId ?? r.context?.llmModel) === variant.variantId
  );
  if (variantResults.length === 0) return { kind: "no_results" };

  const { startedAt, completedAt } = computeRunTimeRange(variantResults);
  const encoder = new TextEncoder();

  const items: BenchResultItem[] = [];
  let infraExcludedAttempts = 0;
  for (const r of variantResults) {
    for (const a of r.attempts) {
      // Infra-invalidated attempts (synthesized infra failures, exhausted
      // retries, quarantined outcomes) never got a fair model attempt —
      // exclude them from the leaderboard payload instead of ingesting
      // `passed=false`.
      if (isInfraInvalidatedAttempt(a)) {
        infraExcludedAttempts++;
        continue;
      }
      // T5: the leaderboard schema caps attempts at 2 (D1 CHECK attempt IN
      // (1,2) + UNIQUE(run_id,task_id,attempt)). Collapsing 3+ to attempt=2
      // would produce duplicate rows and kill the whole batch insert —
      // refuse loudly instead.
      if (a.attemptNumber > 2) {
        throw new ValidationError(
          `leaderboard schema supports max 2 attempts; run used ${a.attemptNumber} (task ${r.taskId}) — bench with --attempts <=2 for ingested runs`,
          [`task ${r.taskId}: attemptNumber ${a.attemptNumber} exceeds 2`],
        );
      }
      items.push(attemptToItem(r.taskId, a, encoder));
    }
  }

  // Never build an empty payload. All-infra gets its dedicated loud
  // sentinel; a variant whose results carry zero attempts (e.g. aborted
  // before any attempt persisted) is skipped as no_items.
  if (items.length === 0) {
    return infraExcludedAttempts > 0
      ? { kind: "all_infra", infraExcludedAttempts }
      : { kind: "no_items" };
  }

  const slug = `${variant.provider}/${variant.model}`;
  const family_slug = inferFamilyFromProvider(variant.provider, variant.model);
  const settings: Record<string, unknown> = {};
  if (variant.config.temperature !== undefined) {
    settings["temperature"] = variant.config.temperature;
  }
  if (variant.config.maxTokens !== undefined) {
    settings["max_tokens"] = variant.config.maxTokens;
  }
  if (variant.config.thinkingBudget !== undefined) {
    settings["thinking_budget"] = variant.config.thinkingBudget;
  }

  // T3: reuse the run identity persisted in the results file so replays
  // are idempotent server-side. Minting here means the server will create
  // a NEW run — legitimate only for legacy files predating the `ingest` key.
  let runId = opts.runId;
  if (!runId) {
    runId = crypto.randomUUID();
    console.warn(
      colors.yellow(
        `[WARN] no persisted run_id for variant ${variant.variantId} — this ingest will create a NEW run (replay of this file will NOT be idempotent)`,
      ),
    );
  }

  const br: BenchResults = {
    runId,
    model: { slug, api_model_id: variant.model, family_slug },
    settings,
    startedAt,
    completedAt,
    pricingVersion: opts.pricingVersion,
    results: items,
  };
  if (opts.centralgaugeSha) br.centralgaugeSha = opts.centralgaugeSha;
  if (opts.taskSetHash) br.taskSetHash = opts.taskSetHash;
  return { kind: "assembled", benchResults: br, infraExcludedAttempts };
}

function attemptToItem(
  taskId: string,
  a: ExecutionAttempt,
  encoder: TextEncoder,
): BenchResultItem {
  const transcriptText =
    `=== PROMPT ===\n${a.prompt}\n=== RESPONSE ===\n${a.llmResponse.content}\n`;
  const attemptNumber = a.attemptNumber <= 1 ? 1 : 2;
  const compileErrors = a.compilationResult?.errors ?? [];
  const durations_ms: BenchResultItem["durations_ms"] = {};
  if (a.llmDuration !== undefined) durations_ms.llm = a.llmDuration;
  if (a.compileDuration !== undefined) durations_ms.compile = a.compileDuration;
  if (a.testDuration !== undefined) durations_ms.test = a.testDuration;

  return {
    task_id: taskId,
    attempt: attemptNumber,
    passed: a.success,
    score: a.score,
    compile_success: a.compilationResult?.success ?? false,
    compile_errors: compileErrors as unknown[],
    tests_total: a.testResult?.totalTests ?? 0,
    tests_passed: a.testResult?.passedTests ?? 0,
    tokens_in: a.llmResponse.usage.promptTokens,
    tokens_out: a.llmResponse.usage.completionTokens,
    tokens_reasoning: a.llmResponse.usage.reasoningTokens ?? 0,
    tokens_cache_read: a.llmResponse.usage.cacheReadTokens ?? 0,
    tokens_cache_write: a.llmResponse.usage.cacheCreationTokens ?? 0,
    durations_ms,
    failure_reasons: a.failureReasons,
    transcript_bytes: encoder.encode(transcriptText),
    code_bytes: encoder.encode(a.extractedCode ?? ""),
  };
}

function computeRunTimeRange(
  results: TaskExecutionResult[],
): { startedAt: string; completedAt: string } {
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const r of results) {
    for (const a of r.attempts) {
      const s = new Date(a.startTime).getTime();
      const e = new Date(a.endTime).getTime();
      if (!isNaN(s) && s < minStart) minStart = s;
      if (!isNaN(e) && e > maxEnd) maxEnd = e;
    }
  }
  if (!isFinite(minStart) || !isFinite(maxEnd)) {
    const now = new Date().toISOString();
    return { startedAt: now, completedAt: now };
  }
  return {
    startedAt: new Date(minStart).toISOString(),
    completedAt: new Date(maxEnd).toISOString(),
  };
}

function inferFamilyFromProvider(provider: string, model: string): string {
  if (provider === "anthropic") return "claude";
  if (provider === "openai") return "gpt";
  if (provider === "google" || provider === "gemini") return "gemini";
  // openrouter routes to the underlying vendor (model = "<vendor>/<id>", e.g.
  // "deepseek/deepseek-v4-pro" → family "deepseek").
  if (provider === "openrouter") {
    const vendor = model.split("/")[0];
    if (vendor) return vendor;
  }
  return provider;
}

export async function readGitSha(cwd: string): Promise<string | undefined> {
  try {
    const cmd = new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      cwd,
      stdout: "piped",
      stderr: "null",
    });
    const { code, stdout } = await cmd.output();
    if (code !== 0) return undefined;
    const sha = new TextDecoder().decode(stdout).trim();
    return sha.length > 0 ? sha : undefined;
  } catch {
    return undefined;
  }
}
