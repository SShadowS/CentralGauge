/**
 * `submit`: resolve one model, freeze its inputs, mint `opts.runs` run
 * directories, and submit wave 1 for each (spec sections 4.2, 4.3, 8).
 *
 * Order matters: the preset and the single model slug are resolved first
 * (a slug naming more than one model, or an unsupported provider, refuses
 * before anything else runs); then the ingest precheck and the batch
 * pricing gate run, in that order, BEFORE `deps.providerFor` is ever
 * called: a model with no batch pricing in the catalog is refused
 * without touching the provider at all. Only then are task manifests
 * loaded, the run's `TaskExecutionContext`s built, the wave-1 container
 * environment captured (once, shared by every minted run), and the frozen
 * inputs written per run: `state.json` (phase `prepared`) is fsynced to
 * disk before wave 1 is ever rendered or submitted, so a crash between
 * minting a run and submitting it always leaves a resumable `prepared`
 * run behind rather than a half-written directory.
 *
 * @module src/batch/submit
 */
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import * as colors from "@std/fmt/colors";
import type {
  BatchItem,
  BatchProvider,
  BatchProviderName,
} from "../llm/batch/types.ts";
import type { LLMRequest } from "../llm/types.ts";
import type {
  TaskExecutionContext,
  TaskManifest,
} from "../tasks/interfaces.ts";
import type { ContainerRuntime } from "../parallel/container-runtime.ts";
import type { ParallelBenchmarkOptions } from "../parallel/orchestrator.ts";
import { buildAttemptContext } from "../parallel/shared/mod.ts";
import type { FrozenPromptInputs } from "../parallel/shared/prompt-inputs.ts";
import { endpointFor, providerRouteFor } from "../llm/endpoint.ts";
import {
  buildCanonicalSettings,
  type CanonicalSettingsExtras,
  promptProfileDigest,
} from "../../shared/settings-hash.ts";
import { PricingService } from "../llm/pricing-service.ts";
import {
  BatchPricingUnavailableError,
  priceUsage,
} from "../parallel/shared/price-usage.ts";
import { ConfigManager } from "../config/config.ts";
import { ModelPresetRegistry } from "../llm/model-presets.ts";
import { loadTaskManifestsWithHashes } from "../../cli/helpers/task-loader.ts";
import { DEFAULT_CONTAINER_NAME } from "../constants.ts";
import { apiKeyForBatchProvider } from "./provider-wiring.ts";
import { itemIdFor } from "./items.ts";
import { chunkItems } from "./chunking.ts";
import { renderWave } from "./render.ts";
import { submitChunks } from "./submit-wave.ts";
import { freezeInputs } from "./drift.ts";
import { RUN_FILES, runDir } from "./paths.ts";
import type { BatchRunState, TaskSummary } from "./state.ts";
import { STATE_SCHEMA_VERSION, writeJsonAtomic, writeState } from "./state.ts";

const SUPPORTED_PROVIDERS: readonly BatchProviderName[] = [
  "anthropic",
  "openai",
  "openrouter",
];

function isSupportedProvider(value: string): value is BatchProviderName {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

export interface SubmitOptions {
  preset: string;
  /** A single model slug. Comma-separated multiple slugs are refused. */
  llms: string;
  runs: number;
  output: string;
  ingest: boolean;
  /**
   * Overrides the preset's `tasks` glob(s): a comma-separated list of
   * patterns. Mainly for tests; the CLI surface does not expose it.
   */
  tasks?: string;
  containers?: string[];
  cwd: string;
}

/**
 * Dependencies `submitRuns` needs beyond `SubmitOptions`. `buildBody`/`wrap`
 * are the provider-specific rendering functions (spec section 6,
 * `src/batch/provider-wiring.ts`'s `ProviderWiring`); `providerFor` mints
 * the transport-only `BatchProvider` used for the actual submission.
 * Neither is called until after the precheck and batch-pricing gate pass.
 */
export interface SubmitDeps {
  providerFor: (name: BatchProviderName, apiKey: string) => BatchProvider;
  buildBody: (request: LLMRequest) => unknown;
  wrap: (items: BatchItem[]) => unknown;
  precheck: () => Promise<void>;
  runtimeFactory: () => Promise<ContainerRuntime>;
  log: (line: string) => void;
}

export interface SubmitResult {
  runIds: string[];
  exit: 0 | 4;
}

function splitCsv(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

function parseTasksGlobs(value: string): string[] {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === "string")) {
    throw new Error(`invalid tasksGlob: ${value}`);
  }
  return parsed as string[];
}

/** Inverse of {@link parseTasksGlobs}: how `submit` persists the patterns it used. */
export function encodeTasksGlob(patterns: string[]): string {
  return JSON.stringify(patterns);
}

export { parseTasksGlobs };

/**
 * Resolves `submitRuns`' one model spec: split by comma into a variant per
 * entry, refusing when the count is not exactly 1 or the provider is not
 * one batch mode supports.
 */
function resolveSingleVariant(
  llms: string,
  config: Awaited<ReturnType<typeof ConfigManager.loadConfig>>,
): {
  ok: true;
  variant: ReturnType<typeof ModelPresetRegistry.resolveWithVariants>[number];
} | {
  ok: false;
  message: string;
} {
  const specs = splitCsv(llms);
  if (specs.length === 0) {
    return { ok: false, message: "batch submit: --llms is required" };
  }
  const variants = ModelPresetRegistry.resolveWithVariants(specs, config);
  if (variants.length !== 1) {
    return {
      ok: false,
      message:
        `batch submit requires exactly one model, got ${variants.length} (${
          variants.map((v) => `${v.provider}/${v.model}`).join(", ")
        })`,
    };
  }
  const variant = variants[0]!;
  if (!isSupportedProvider(variant.provider)) {
    return {
      ok: false,
      message:
        `batch submit does not support provider "${variant.provider}"; supported: ${
          SUPPORTED_PROVIDERS.join(", ")
        }`,
    };
  }
  return { ok: true, variant };
}

/**
 * Submits wave 1 for `opts.runs` fresh run directories against exactly one
 * model (spec section 8's `submit` command).
 */
export async function submitRuns(
  opts: SubmitOptions,
  deps: SubmitDeps,
): Promise<SubmitResult> {
  const config = await ConfigManager.loadConfig();
  const preset = config.benchmarkPresets?.[opts.preset];
  if (!preset) {
    deps.log(
      `${colors.red("[FAIL]")} batch submit: preset "${opts.preset}" not found`,
    );
    return { runIds: [], exit: 4 };
  }

  const resolved = resolveSingleVariant(opts.llms, config);
  if (!resolved.ok) {
    deps.log(`${colors.red("[FAIL]")} ${resolved.message}`);
    return { runIds: [], exit: 4 };
  }
  const variant = resolved.variant;
  const provider = variant.provider as BatchProviderName;

  try {
    await deps.precheck();
  } catch (err) {
    deps.log(
      `${colors.red("[FAIL]")} batch submit: precheck failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { runIds: [], exit: 4 };
  }

  await PricingService.initialize();
  try {
    priceUsage({
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      provider,
      requestedModel: variant.model,
      mode: "batch",
    });
  } catch (err) {
    if (err instanceof BatchPricingUnavailableError) {
      deps.log(`${colors.red("[FAIL]")} ${err.message}`);
      return { runIds: [], exit: 4 };
    }
    throw err;
  }

  const patterns = opts.tasks
    ? splitCsv(opts.tasks)
    : (preset.tasks && preset.tasks.length > 0
      ? preset.tasks
      : ["tasks/**/*.yml"]);

  const { manifests: manifestList } = await loadTaskManifestsWithHashes(
    patterns,
    opts.output,
    false,
  );
  const manifestsMap = new Map<string, TaskManifest>(
    manifestList.map((m) => [m.id, m]),
  );
  const taskIds = [...manifestsMap.keys()].sort();

  const containers = opts.containers ?? preset.containers ??
    (preset.container ? [preset.container] : [DEFAULT_CONTAINER_NAME]);
  const parallelOptions: ParallelBenchmarkOptions = {
    containerName: containers[0] ?? DEFAULT_CONTAINER_NAME,
    containerProvider: config.container?.provider ?? "auto",
    attemptLimit: preset.attempts ?? 2,
    temperature: preset.temperature ?? 0.1,
    maxTokens: preset.maxTokens ?? 4000,
    outputDir: opts.output,
    debugMode: false,
  };

  const contexts = new Map<string, TaskExecutionContext>();
  for (const taskId of taskIds) {
    const manifest = manifestsMap.get(taskId)!;
    contexts.set(
      taskId,
      await buildAttemptContext(manifest, variant, parallelOptions),
    );
  }

  const apiKey = apiKeyForBatchProvider(provider) ?? "";
  const batchProvider = deps.providerFor(provider, apiKey);

  const runtime = await deps.runtimeFactory();
  let environment;
  try {
    environment = await runtime.environmentSet();
  } finally {
    await runtime.stop();
  }

  const templateDir = config.benchmark?.templateDir || "templates";
  const variantSystemPrompt = variant.config.systemPrompt ?? null;
  const infraRetriesPerAttempt = config.bench?.infraRetriesPerAttempt ?? 1;

  const digest = await promptProfileDigest({
    overrides: null,
    knowledge: null,
    variantSystemPrompt,
  });

  const extras: CanonicalSettingsExtras = {
    invocation_mode: "batch",
    continuation: { enabled: false, max: 0 },
    empty_retry: { enabled: false, max: 0 },
    fallback_policy: "unavailable",
    provider_route: providerRouteFor(provider, variant.model),
    endpoint: endpointFor(provider, variant.model),
    thinking_budget: variant.config.thinkingBudget ?? null,
    prompt_profile_digest: digest,
    infra_retries_per_attempt: infraRetriesPerAttempt,
  };

  const settings = buildCanonicalSettings(
    {
      temperature: parallelOptions.temperature,
      max_attempts: parallelOptions.attemptLimit,
      max_tokens: parallelOptions.maxTokens,
      prompt_version: null,
      bc_version: null,
    },
    extras,
  );

  const inputs: FrozenPromptInputs = {
    provider,
    apiModelId: variant.model,
    variantConfig: variant.hasVariant ? variant.config : null,
    variantSystemPrompt,
    promptOverrides: null,
    knowledge: null,
    templateDir,
    starterRoot: opts.cwd,
    settings,
  };

  const runIds: string[] = [];
  let overallExit: 0 | 4 = 0;

  for (let i = 0; i < opts.runs; i++) {
    const runId = crypto.randomUUID();
    const dir = runDir(opts.output, runId);
    await ensureDir(dir);

    const promptInputsPath = join(dir, RUN_FILES.promptInputs);
    await writeJsonAtomic(promptInputsPath, inputs);

    const frozenBase = await freezeInputs(
      opts.cwd,
      taskIds,
      manifestsMap,
      promptInputsPath,
      environment,
    );
    const frozen = { ...frozenBase, tasksGlob: encodeTasksGlob(patterns) };

    const tasks: Record<string, TaskSummary> = {};
    for (const taskId of taskIds) {
      tasks[taskId] = {
        attempt1: {
          itemId: await itemIdFor(runId, taskId, 1, 0),
          round: 0,
          ownerRound: 0,
          state: "pending",
        },
      };
    }

    const state: BatchRunState = {
      schemaVersion: STATE_SCHEMA_VERSION,
      runId,
      createdAt: new Date().toISOString(),
      model: {
        slug: `${provider}/${variant.model}`,
        provider,
        apiModelId: variant.model,
      },
      frozen,
      phase: "prepared",
      wave: 1,
      batches: [],
      activeBatchIds: [],
      tasks,
      ingest: opts.ingest,
    };
    await writeState(dir, state);

    const rendered = await renderWave(state, 1, 0, taskIds, {
      buildBody: deps.buildBody,
      inputs,
      manifests: manifestsMap,
      contexts,
    });

    const chunks = chunkItems(
      rendered.map((r) => ({ itemId: r.itemId, body: r.body })),
      batchProvider.limits,
      deps.wrap,
    );

    const outcome = await submitChunks(dir, state, chunks, rendered, 1, 0, {
      provider: batchProvider,
      model: variant.model,
      wrap: deps.wrap,
    });

    if (outcome.kind === "submitted") {
      state.phase = "attempt-1-submitted";
      await writeState(dir, state);
      const batchIds = outcome.records.map((r) => r.handle.batchId).join(",");
      deps.log(
        `[batch] submitted ${runId} items=${rendered.length} chunks=${chunks.length} batches=${batchIds}`,
      );
    } else {
      const reason = outcome.kind === "rejected"
        ? (outcome.lastError?.message ?? "rejected")
        : outcome.reason;
      state.lastError = outcome.kind === "rejected" && outcome.lastError
        ? outcome.lastError
        : {
          at: new Date().toISOString(),
          step: "submit",
          message: reason,
          retryable: false,
        };
      await writeState(dir, state);
      deps.log(`${colors.red("[FAIL]")} batch submit: ${runId}: ${reason}`);
      overallExit = 4;
    }

    runIds.push(runId);
  }

  return { runIds, exit: overallExit };
}
