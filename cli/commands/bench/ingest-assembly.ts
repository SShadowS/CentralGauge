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

interface SavedResultsFile {
  results: TaskExecutionResult[];
}

export interface AssembleOptions {
  pricingVersion: string;
  centralgaugeSha?: string;
}

export async function assembleBenchResultsForVariant(
  resultFilePath: string,
  variant: ModelVariant,
  opts: AssembleOptions,
): Promise<BenchResults | null> {
  const raw = await Deno.readTextFile(resultFilePath);
  const data = JSON.parse(raw) as SavedResultsFile;

  const variantResults = data.results.filter((r) =>
    (r.context?.variantId ?? r.context?.llmModel) === variant.variantId
  );
  if (variantResults.length === 0) return null;

  const { startedAt, completedAt } = computeRunTimeRange(variantResults);
  const encoder = new TextEncoder();

  const items: BenchResultItem[] = [];
  for (const r of variantResults) {
    for (const a of r.attempts) {
      items.push(attemptToItem(r.taskId, a, encoder));
    }
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

  const br: BenchResults = {
    runId: crypto.randomUUID(),
    model: { slug, api_model_id: variant.model, family_slug },
    settings,
    startedAt,
    completedAt,
    pricingVersion: opts.pricingVersion,
    results: items,
  };
  if (opts.centralgaugeSha) br.centralgaugeSha = opts.centralgaugeSha;
  return br;
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
