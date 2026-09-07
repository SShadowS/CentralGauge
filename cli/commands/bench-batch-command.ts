/**
 * `bench batch` commands: submit, status, advance, retry, abandon (spec
 * section 8). Attached to the `bench` command by `registerBenchCommand`
 * (`bench-command.ts`) via `cli.getCommand("bench")?.command("batch",
 * buildBatchCommand())`.
 *
 * Every action loads `.env` (`EnvLoader.loadEnvironment()`) and resolves
 * the run's provider API key the way `LLMWorkPool.getApiKeyForProvider`
 * does (`apiKeyForBatchProvider`), then exits with `Deno.exit(code)` after
 * the underlying action resolves. `status` always exits 0.
 *
 * `submit` is the only command that needs a full preset resolution: it
 * mints new runs. `advance`/`retry`/`status`/`abandon` all operate on an
 * EXISTING run directory and rebuild everything they need (manifests,
 * `TaskExecutionContext`s, the reconstructed `ModelVariant`) from that
 * run's own frozen `state.json`/`prompt-inputs.json`, never from a
 * preset. A run must remain drivable long after the preset that created
 * it has changed or been removed (spec 4.6's whole premise: the run
 * carries its own frozen truth).
 *
 * `buildBody`/`wrap`/`mapRaw` are wired LAZILY through
 * `src/batch/provider-wiring.ts#wireProvider`, which throws until Task 12
 * (Anthropic), Task 14 (OpenAI) and Task 16 (OpenRouter) register real
 * implementations. Laziness matters: a `poll`-only `advance` step never
 * calls any of the three, so `status`/`advance` on a still-processing run
 * keep working today even though `collect`/`evaluate`/`submit` cannot.
 *
 * @module cli/commands/bench-batch-command
 */
import { Command } from "@cliffy/command";
import { dirname, join } from "@std/path";
import * as colors from "@std/fmt/colors";

import type { VariantProbe } from "../../src/doctor/mod.ts";
import type { ModelVariant } from "../../src/llm/variant-types.ts";
import type {
  BatchItem,
  BatchProviderName,
} from "../../src/llm/batch/types.ts";
import type { LLMRequest, LLMResponse } from "../../src/llm/types.ts";
import type { ParallelBenchmarkOptions } from "../../src/parallel/orchestrator.ts";
import type { FrozenPromptInputs } from "../../src/parallel/shared/prompt-inputs.ts";
import type {
  TaskExecutionContext,
  TaskManifest,
} from "../../src/tasks/interfaces.ts";
import type { SubmitDeps } from "../../src/batch/submit.ts";
import type { AdvanceDeps, AdvanceResult } from "../../src/batch/advance.ts";
import type { FinalizeDeps } from "../../src/batch/results.ts";
import type { BatchRunState } from "../../src/batch/state.ts";

import { ConfigManager } from "../../src/config/config.ts";
import { EnvLoader } from "../../src/utils/env-loader.ts";
import { familySlugForModelSlug } from "../../src/catalog/seed/inference.ts";
import { applyRepairs, builtInRepairers } from "../../src/doctor/repair.ts";
import {
  formatReportToTerminal,
  ingestSection,
  runDoctor,
} from "../../src/doctor/mod.ts";
import { todayPricingVersion } from "./bench/ingest-meta.ts";
import { buildEnvironmentManifest } from "../../src/ingest/capture.ts";
import { ModelPresetRegistry } from "../../src/llm/model-presets.ts";
import { PricingService } from "../../src/llm/pricing-service.ts";
import { createBatchProvider } from "../../src/llm/batch/mod.ts";
import { buildAttemptContext } from "../../src/parallel/shared/mod.ts";
import { ContainerRuntime } from "../../src/parallel/container-runtime.ts";
import { loadTaskManifestsWithHashes } from "../helpers/task-loader.ts";
import {
  apiKeyForBatchProvider,
  wireProvider,
} from "../../src/batch/provider-wiring.ts";
import { parseTasksGlobs, submitRuns } from "../../src/batch/submit.ts";
import { formatStatus, runStatus } from "../../src/batch/status.ts";
import { advanceRun } from "../../src/batch/advance.ts";
import { retryRun } from "../../src/batch/retry.ts";
import { abandonRun } from "../../src/batch/abandon.ts";
import { finalizeRun } from "../../src/batch/results.ts";
import { RUN_FILES, runDir } from "../../src/batch/paths.ts";
import { loadState } from "../../src/batch/state.ts";
import { DEFAULT_CONTAINER_NAME } from "../../src/constants.ts";

const DEFAULT_QUEUE = {
  maxQueueSize: 100,
  timeout: 300_000,
  compileConcurrency: 3,
};
const DEFAULT_TASK_CONCURRENCY = 3;

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

/** `<output>` root, two levels up from `<output>/batch/<runId>`. */
function outputRootFor(dir: string): string {
  return dirname(dirname(dir));
}

/**
 * The same single-slug ingest precheck the sync bench runs at startup
 * (`doctor ingest`, auto-repairing a missing catalog row when possible).
 * Throws on failure so `SubmitDeps.precheck` can surface it as an exit-4
 * refusal without ever calling the provider.
 */
async function runIngestPrecheck(variant: ModelVariant): Promise<void> {
  const probe: VariantProbe = {
    slug: `${variant.provider}/${variant.model}`,
    api_model_id: variant.model,
    family_slug: familySlugForModelSlug(`${variant.provider}/${variant.model}`),
  };
  const pricingVersion = todayPricingVersion();

  const report = await runDoctor({
    section: ingestSection,
    variants: [probe],
    pricingVersion,
  });
  if (report.ok) return;

  const repairOutcome = await applyRepairs(report, builtInRepairers);
  const allRepairsOk = repairOutcome.attempted.length > 0 &&
    repairOutcome.attempted.every((a) => a.ok);
  if (allRepairsOk) {
    const retry = await runDoctor({
      section: ingestSection,
      variants: [probe],
      pricingVersion,
    });
    if (retry.ok) return;
    throw new Error(formatReportToTerminal(retry));
  }
  throw new Error(formatReportToTerminal(report));
}

/** Reconstructs a `ModelVariant` from a run's own frozen state, never re-resolved from a preset. */
function reconstructVariant(
  state: BatchRunState,
  inputs: FrozenPromptInputs,
): ModelVariant {
  const slug = `${state.model.provider}/${state.model.apiModelId}`;
  return {
    originalSpec: slug,
    baseModel: slug,
    provider: state.model.provider,
    model: state.model.apiModelId,
    config: inputs.variantConfig ?? {},
    variantId: slug,
    hasVariant: inputs.variantConfig !== null,
  };
}

function parallelOptionsFrom(
  inputs: FrozenPromptInputs,
  state: BatchRunState,
  containerProvider: string,
  outputDir: string,
): ParallelBenchmarkOptions {
  const containerName = state.frozen.environment.containers[0]?.name ??
    DEFAULT_CONTAINER_NAME;
  return {
    containerName,
    containerProvider,
    attemptLimit: inputs.settings.max_attempts ?? 2,
    temperature: inputs.settings.temperature ?? 0.1,
    maxTokens: inputs.settings.max_tokens ?? 4000,
    outputDir,
    debugMode: false,
  };
}

async function loadManifestsAndContexts(
  state: BatchRunState,
  outputDir: string,
  variant: ModelVariant,
  parallelOptions: ParallelBenchmarkOptions,
): Promise<
  {
    manifests: Map<string, TaskManifest>;
    contexts: Map<string, TaskExecutionContext>;
  }
> {
  const patterns = parseTasksGlobs(state.frozen.tasksGlob);
  const { manifests: manifestList } = await loadTaskManifestsWithHashes(
    patterns,
    outputDir,
    false,
  );
  const manifests = new Map<string, TaskManifest>(
    manifestList.map((m) => [m.id, m]),
  );
  const contexts = new Map<string, TaskExecutionContext>();
  for (const taskId of Object.keys(state.tasks)) {
    const manifest = manifests.get(taskId);
    if (!manifest) continue;
    contexts.set(
      taskId,
      await buildAttemptContext(manifest, variant, parallelOptions),
    );
  }
  return { manifests, contexts };
}

/**
 * Builds the `FinalizeDeps` for `state`'s finalize step. Extracted as its
 * own function (rather than inlined into `buildAdvanceDeps`'s `finalize`
 * closure) so `state.ingest` -> `FinalizeDeps.ingest` wiring is testable in
 * isolation, with mock manifests/contexts/variant, WITHOUT needing a
 * working `createBatchProvider` (every provider still throws today -
 * Task 12/14/16 territory, unrelated to this wiring).
 */
export async function buildFinalizeDeps(
  state: BatchRunState,
  variant: ModelVariant,
  manifests: Map<string, TaskManifest>,
  contexts: Map<string, TaskExecutionContext>,
  containerName: string,
): Promise<FinalizeDeps> {
  return {
    manifests,
    contexts,
    variant,
    environment: await buildEnvironmentManifest({
      containerName,
      cwd: Deno.cwd(),
    }),
    taskSetHash: state.frozen.taskSetHash,
    ingest: state.ingest,
    cwd: Deno.cwd(),
    ingestFlags: {},
  };
}

/**
 * Builds `AdvanceDeps` (also used by `retry`, which extends it) for the run
 * at `dir` from that run's own frozen state alone.
 */
export async function buildAdvanceDeps(dir: string): Promise<AdvanceDeps> {
  // `evaluateResponded` prices every responded item via `priceUsage(mode:
  // "batch")`, which reads `PricingService`'s in-memory catalog map -
  // never populated in this process unless something calls `initialize()`
  // first. `submit` does (via its own `PricingService.initialize()` before
  // the submit-time pricing gate), but `advance`/`retry`/`advance --all`
  // all route through this one function and none of them did, so the
  // evaluate step of a fresh `advance` process threw
  // `BatchPricingUnavailableError` against an empty map even though the
  // catalog row on disk was fine. `initialize()` is idempotent (no-ops
  // once `this.config` is set), so calling it here is free on every tick.
  await PricingService.initialize();
  const state = await loadState(dir);
  const inputs = await readJsonFile<FrozenPromptInputs>(
    join(dir, RUN_FILES.promptInputs),
  );
  const variant = reconstructVariant(state, inputs);
  const providerName = state.model.provider;
  const apiKey = apiKeyForBatchProvider(providerName) ?? "";
  const batchProvider = createBatchProvider(providerName, { apiKey });

  const config = await ConfigManager.loadConfig();
  const outputDir = outputRootFor(dir);
  const parallelOptions = parallelOptionsFrom(
    inputs,
    state,
    config.container?.provider ?? "auto",
    outputDir,
  );
  const { manifests, contexts } = await loadManifestsAndContexts(
    state,
    outputDir,
    variant,
    parallelOptions,
  );

  const wiringModel = {
    apiModelId: variant.model,
    variantConfig: inputs.variantConfig,
  };
  const containerNames = state.frozen.environment.containers.map((c) => c.name);

  // Built lazily, only on the `finalize` step itself: every other step
  // (poll, collect, evaluate, resubmit) never needs it, and building it
  // eagerly here would pay for a container inspect on every single
  // `advance` tick regardless of how close the run is to finishing.
  const finalize = async (d: string, s: BatchRunState) => {
    const finalizeDeps = await buildFinalizeDeps(
      s,
      variant,
      manifests,
      contexts,
      parallelOptions.containerName,
    );
    return await finalizeRun(d, s, finalizeDeps);
  };

  return {
    provider: batchProvider,
    buildBody: (r: LLMRequest) =>
      wireProvider(providerName, wiringModel, apiKey).buildBody(r),
    wrap: (items: BatchItem[]) =>
      wireProvider(providerName, wiringModel, apiKey).wrap(items),
    mapRaw: (raw: unknown, itemId: string): LLMResponse =>
      wireProvider(providerName, wiringModel, apiKey).mapRaw(raw, itemId),
    runtimeFactory: () =>
      ContainerRuntime.start({
        containers: containerNames,
        containerConfig: config.container ?? {},
        queue: DEFAULT_QUEUE,
      }),
    cwd: Deno.cwd(),
    taskConcurrency: DEFAULT_TASK_CONCURRENCY,
    infraRetriesPerAttempt: config.bench?.infraRetriesPerAttempt ?? 1,
    attemptLimit: inputs.settings.max_attempts === 1 ? 1 : 2,
    finalize,
    log: (line: string) => console.log(line),
    manifests,
    contexts,
  };
}

/**
 * The message to print for a failed (`exit === 4`) `advanceRun` result, or
 * `undefined` when the result carries none. `step.kind === "blocked"` is
 * the only `Step` with a reason (a non-retryable `lastError`, a size-blocked
 * item, drift, or the bench lock); `step.kind === "reconcile"` also exits 4
 * (an intent.json means `retry` owns this run now, spec 4.3) but has
 * nothing to say - `advance` prints nothing for it, same as before this
 * helper existed.
 */
export function advanceFailureMessage(
  result: AdvanceResult,
): string | undefined {
  return result.step.kind === "blocked" ? result.step.reason : undefined;
}

/**
 * The pure driver behind `advance --all` (spec section 8): every run
 * directory under `<output>/batch/`, in name order, advanced ONE step each
 * (serially), returning the highest exit code seen. `0` when there are no
 * run directories at all.
 */
export async function advanceAllRuns(
  outputDir: string,
  buildDeps: (dir: string) => Promise<AdvanceDeps>,
  advanceRunFn: typeof advanceRun = advanceRun,
): Promise<number> {
  const batchDir = join(outputDir, "batch");
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(batchDir)) {
      if (entry.isDirectory) names.push(entry.name);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return 0;
    throw err;
  }
  names.sort();

  let maxExit = 0;
  for (const name of names) {
    const dir = join(batchDir, name);
    const deps = await buildDeps(dir);
    const result: AdvanceResult = await advanceRunFn(dir, deps);
    if (result.exit > maxExit) maxExit = result.exit;
  }
  return maxExit;
}

/**
 * Builds the `bench batch` command tree: `submit`, `status`, `advance`,
 * `retry`, `abandon`. Attach with `cli.getCommand("bench")?.command("batch",
 * buildBatchCommand())`; see `registerBenchCommand` in `bench-command.ts`.
 */
export function buildBatchCommand(): Command {
  const parent = new Command()
    .description("Batch-mode bench: submit, advance, retry, abandon");

  parent
    .command("submit", "Submit a new batch run")
    .option("--preset <name:string>", "Benchmark preset to load", {
      required: true,
    })
    .option("--llms <slug:string>", "Exactly one model slug", {
      required: true,
    })
    .option("--runs <n:number>", "Number of independent run directories", {
      default: 1,
    })
    .option("--output <dir:string>", "Output directory", {
      default: "results/",
    })
    .option("--no-ingest", "Skip ingest at finalize time")
    .action(async (opts) => {
      await EnvLoader.loadEnvironment();
      const config = await ConfigManager.loadConfig();
      const preset = config.benchmarkPresets?.[opts.preset];

      // A best-effort resolution to build the wiring closures below.
      // `submitRuns` re-resolves and validates the slug itself (the single
      // source of truth for the exit-4 refusals) before ever calling
      // `precheck`/`buildBody`/`wrap`, so a bad slug here simply means
      // those closures are never invoked.
      const specs = opts.llms.split(",").map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);
      const variants = ModelPresetRegistry.resolveWithVariants(specs, config);
      const variant = variants.length === 1 ? variants[0]! : undefined;
      const providerName: BatchProviderName =
        (variant?.provider as BatchProviderName | undefined) ?? "anthropic";
      const apiKey = apiKeyForBatchProvider(providerName) ?? "";
      const wiringModel = {
        apiModelId: variant?.model ?? "",
        variantConfig: variant?.hasVariant ? variant.config : null,
      };
      const containers = preset?.containers ??
        (preset?.container ? [preset.container] : [DEFAULT_CONTAINER_NAME]);

      const deps: SubmitDeps = {
        providerFor: (name, key) => createBatchProvider(name, { apiKey: key }),
        buildBody: (r) =>
          wireProvider(providerName, wiringModel, apiKey).buildBody(r),
        wrap: (items) =>
          wireProvider(providerName, wiringModel, apiKey).wrap(items),
        precheck: async () => {
          if (variant) await runIngestPrecheck(variant);
        },
        runtimeFactory: () =>
          ContainerRuntime.start({
            containers,
            containerConfig: config.container ?? {},
            queue: DEFAULT_QUEUE,
          }),
        log: (line: string) => console.log(line),
      };

      const result = await submitRuns(
        {
          preset: opts.preset,
          llms: opts.llms,
          runs: opts.runs,
          output: opts.output,
          ingest: opts.ingest !== false,
          cwd: Deno.cwd(),
        },
        deps,
      );
      for (const runId of result.runIds) {
        console.log(`${colors.green("[batch]")} ${runId}`);
      }
      Deno.exit(result.exit);
    });

  parent
    .command("status", "Show batch run status")
    .arguments("[runId:string]")
    .option("--output <dir:string>", "Output directory", {
      default: "results/",
    })
    .option("--json", "Print JSON instead of formatted lines")
    .action(async (opts, runId) => {
      await EnvLoader.loadEnvironment();
      const batchRoot = join(opts.output, "batch");
      const runIds: string[] = [];
      if (runId) {
        runIds.push(runId);
      } else {
        try {
          for await (const entry of Deno.readDir(batchRoot)) {
            if (entry.isDirectory) runIds.push(entry.name);
          }
        } catch (err) {
          if (!(err instanceof Deno.errors.NotFound)) throw err;
        }
        runIds.sort();
      }

      const rows = [];
      for (const id of runIds) {
        const dir = runDir(opts.output, id);
        const state = await loadState(dir);
        let provider;
        if (state.phase === "submit-unknown") {
          const apiKey = apiKeyForBatchProvider(state.model.provider) ?? "";
          provider = createBatchProvider(state.model.provider, { apiKey });
        }
        rows.push(await runStatus(dir, provider));
      }

      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        for (const line of formatStatus(rows)) console.log(line);
      }
      Deno.exit(0);
    });

  parent
    .command("advance", "Advance a run (or every run) one step")
    .arguments("[runId:string]")
    .option("--all", "Advance every run under the output directory")
    .option("--output <dir:string>", "Output directory", {
      default: "results/",
    })
    .action(async (opts, runId) => {
      await EnvLoader.loadEnvironment();
      if (opts.all) {
        const exit = await advanceAllRuns(
          opts.output,
          (dir) => buildAdvanceDeps(dir),
        );
        Deno.exit(exit);
      }
      if (!runId) {
        console.error(
          colors.red("[FAIL]") + " advance requires <runId> or --all",
        );
        Deno.exit(4);
      }
      const dir = runDir(opts.output, runId);
      const deps = await buildAdvanceDeps(dir);
      const result = await advanceRun(dir, deps);
      if (result.exit === 4) {
        const message = advanceFailureMessage(result);
        if (message) {
          console.error(`${colors.red("[FAIL]")} ${message}`);
        }
      }
      Deno.exit(result.exit);
    });

  parent
    .command("retry", "Resubmit or reconcile a run")
    .arguments("<runId:string>")
    .option("--force", "Resubmit despite a non-retryable lastError")
    .option(
      "--adopt <batchId:string>",
      "Adopt a specific submit-unknown candidate",
    )
    .option(
      "--confirm-not-submitted",
      "Confirm the submit-unknown batch was never created",
    )
    .option("--output <dir:string>", "Output directory", {
      default: "results/",
    })
    .action(async (opts, runId) => {
      await EnvLoader.loadEnvironment();
      const dir = runDir(opts.output, runId);
      const advanceDeps = await buildAdvanceDeps(dir);
      const outcome = await retryRun(dir, {
        ...advanceDeps,
        ...(opts.force !== undefined ? { force: opts.force } : {}),
        ...(opts.adopt !== undefined ? { adopt: opts.adopt } : {}),
        ...(opts.confirmNotSubmitted !== undefined
          ? { confirmNotSubmitted: opts.confirmNotSubmitted }
          : {}),
      });
      if (outcome.exit === 0) {
        console.log(outcome.message);
      } else {
        console.error(`${colors.red("[FAIL]")} ${outcome.message}`);
      }
      Deno.exit(outcome.exit);
    });

  parent
    .command("abandon", "Mark a run abandoned")
    .arguments("<runId:string>")
    .option("--output <dir:string>", "Output directory", {
      default: "results/",
    })
    .action(async (opts, runId) => {
      await EnvLoader.loadEnvironment();
      const dir = runDir(opts.output, runId);
      const state = await loadState(dir);
      const apiKey = apiKeyForBatchProvider(state.model.provider) ?? "";
      const provider = createBatchProvider(state.model.provider, { apiKey });
      await abandonRun(dir, provider);
      Deno.exit(0);
    });

  return parent;
}
