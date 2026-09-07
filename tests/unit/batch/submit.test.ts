// tests/unit/batch/submit.test.ts
//
// `submitRuns` (spec sections 4.2, 4.3, 8): freezes prompt inputs, mints
// `opts.runs` run directories, renders wave 1 for every task, and submits
// it through a fake `BatchProvider`. Uses the REAL `templates/` dir and two
// REAL easy task manifests (found by Glob rather than hardcoded, since the
// task suite has been renumbered before) so the render path is exercised
// for real; only the provider, the ingest precheck, and the container
// runtime are faked.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { expandGlob } from "@std/fs";
import { join } from "@std/path";
import { submitRuns } from "../../../src/batch/submit.ts";
import type { SubmitDeps, SubmitOptions } from "../../../src/batch/submit.ts";
import { RUN_FILES, runDir } from "../../../src/batch/paths.ts";
import { loadState } from "../../../src/batch/state.ts";
import { loadJsonl } from "../../../src/batch/journal.ts";
import type { ItemLine } from "../../../src/batch/journal.ts";
import { ConfigManager } from "../../../src/config/config.ts";
import { PricingService } from "../../../src/llm/pricing-service.ts";
import { FakeBatchProvider } from "../../utils/fake-batch-provider.ts";
import type {
  BatchItem,
  BatchProvider,
  BatchProviderName,
} from "../../../src/llm/batch/types.ts";
import type { LLMRequest } from "../../../src/llm/types.ts";
import type { ContainerRuntime } from "../../../src/parallel/container-runtime.ts";
import type { ContainerEnvironmentSet } from "../../../src/batch/state.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

const MODEL_SLUG = "claude-batch-submit-fake";
const FULL_SLUG = `anthropic/${MODEL_SLUG}`;
const REPO_ROOT = Deno.cwd();

const ENVIRONMENT: ContainerEnvironmentSet = {
  testRunner: "soap",
  containers: [{ name: "FakeContainer", bcArtifact: null, imageDigest: null }],
};

/** Two real easy task manifests, found by glob (never hardcoded filenames). */
async function findTwoEasyTaskGlobs(): Promise<[string, string]> {
  const found: string[] = [];
  for await (
    const entry of expandGlob(join(REPO_ROOT, "tasks", "easy", "*.yml"))
  ) {
    if (entry.isFile) found.push(entry.path);
  }
  found.sort();
  assert(found.length >= 2, "expected at least two easy task manifests");
  return [found[0]!, found[1]!];
}

function seedBatchPricing(withBatchRates: boolean): void {
  PricingService.clearCatalogPricing();
  PricingService.loadCatalogPricing([
    {
      model_slug: FULL_SLUG,
      effective_from: "2026-01-01",
      input_per_mtoken: 1,
      output_per_mtoken: 5,
      ...(withBatchRates
        ? { batch_input_per_mtoken: 0.5, batch_output_per_mtoken: 2.5 }
        : {}),
      source: "manual",
    },
  ]);
}

interface FakeDeps extends SubmitDeps {
  calls: string[];
}

function makeFakeDeps(
  provider: BatchProvider = new FakeBatchProvider("anthropic", {}),
): FakeDeps {
  const calls: string[] = [];
  return {
    calls,
    providerFor: (name: BatchProviderName, _apiKey: string) => {
      calls.push(`providerFor:${name}`);
      return provider;
    },
    buildBody: (request: LLMRequest) => ({ prompt: request.prompt }),
    wrap: (items: BatchItem[]) => ({ requests: items }),
    precheck: () => {
      calls.push("precheck");
      return Promise.resolve();
    },
    runtimeFactory: () => {
      calls.push("runtimeFactory");
      return Promise.resolve({
        environmentSet: () => Promise.resolve(ENVIRONMENT),
        stop: () => Promise.resolve(),
      } as unknown as ContainerRuntime);
    },
    log: () => {},
  };
}

function baseOptions(
  output: string,
  taskGlobs: string[],
  overrides: Partial<SubmitOptions> = {},
): SubmitOptions {
  return {
    preset: "fixture",
    llms: FULL_SLUG,
    runs: 1,
    output,
    ingest: false,
    tasks: taskGlobs.join(","),
    cwd: REPO_ROOT,
    ...overrides,
  };
}

function setFixturePreset(taskGlobs: string[]): void {
  ConfigManager.reset();
  ConfigManager.setConfig({
    benchmarkPresets: {
      fixture: {
        tasks: taskGlobs,
        containers: ["FakeContainer"],
      },
    },
  });
}

Deno.test("submitRuns", async (t) => {
  const [task1, task2] = await findTwoEasyTaskGlobs();

  await t.step(
    "creates one run directory per `runs`, each attempt-1-submitted with identical per-task body digests",
    async () => {
      const output = await createTempDir("batch-submit");
      try {
        setFixturePreset([task1, task2]);
        seedBatchPricing(true);
        const deps = makeFakeDeps();

        const result = await submitRuns(
          baseOptions(output, [task1, task2], { runs: 2 }),
          deps,
        );

        assertEquals(result.exit, 0);
        assertEquals(result.runIds.length, 2);
        assertNotEquals(result.runIds[0], result.runIds[1]);

        const perRunDigests: Array<Record<string, string>> = [];
        for (const runId of result.runIds) {
          const dir = runDir(output, runId);
          const state = await loadState(dir);
          assertEquals(state.phase, "attempt-1-submitted");
          assertEquals(Object.keys(state.tasks).length, 2);

          // prompt-inputs.json exists.
          await Deno.stat(join(dir, RUN_FILES.promptInputs));

          // items.jsonl has one item per task.
          const items = await loadJsonl<ItemLine>(
            join(dir, RUN_FILES.items),
            (l) => l.itemId,
          );
          assertEquals(items.length, 2);

          // requests/ carries one rendered request per item.
          for (const item of items) {
            await Deno.stat(join(dir, "requests", `${item.itemId}.json`));
          }

          // no intent.json left behind after a successful submit.
          let intentExists = true;
          try {
            await Deno.stat(join(dir, RUN_FILES.intent));
          } catch (err) {
            if (err instanceof Deno.errors.NotFound) intentExists = false;
            else throw err;
          }
          assertEquals(intentExists, false);

          const byTask: Record<string, string> = {};
          for (const item of items) byTask[item.taskId] = item.bodyDigest;
          perRunDigests.push(byTask);

          assertEquals(state.frozen.environment, ENVIRONMENT);
          // `baseOptions` submits with `ingest: false`; the choice must be
          // persisted onto the run, not just consulted at submit time.
          assertEquals(state.ingest, false);
        }

        // Same tasks render to identical bodies across runs.
        assertEquals(perRunDigests[0], perRunDigests[1]);
      } finally {
        await cleanupTempDir(output);
      }
    },
  );

  await t.step(
    "persists ingest: true onto the run when requested",
    async () => {
      const output = await createTempDir("batch-submit-ingest-true");
      try {
        setFixturePreset([task1, task2]);
        seedBatchPricing(true);
        const deps = makeFakeDeps();

        const result = await submitRuns(
          baseOptions(output, [task1, task2], { ingest: true }),
          deps,
        );

        assertEquals(result.exit, 0);
        const state = await loadState(runDir(output, result.runIds[0]!));
        assertEquals(state.ingest, true);
      } finally {
        await cleanupTempDir(output);
      }
    },
  );

  await t.step("refuses a slug with two models (exit 4)", async () => {
    const output = await createTempDir("batch-submit-two-models");
    try {
      setFixturePreset([task1, task2]);
      seedBatchPricing(true);
      const deps = makeFakeDeps();

      const result = await submitRuns(
        baseOptions(output, [task1, task2], {
          llms: `${FULL_SLUG},openai/some-other-fake-model`,
        }),
        deps,
      );

      assertEquals(result.exit, 4);
      assertEquals(result.runIds.length, 0);
    } finally {
      await cleanupTempDir(output);
    }
  });

  await t.step(
    "refuses a model without batch pricing before any provider call (exit 4)",
    async () => {
      const output = await createTempDir("batch-submit-no-pricing");
      try {
        setFixturePreset([task1, task2]);
        seedBatchPricing(false);
        const deps = makeFakeDeps();

        const result = await submitRuns(
          baseOptions(output, [task1, task2]),
          deps,
        );

        assertEquals(result.exit, 4);
        assertEquals(result.runIds.length, 0);
        assertEquals(deps.calls, ["precheck"]);
      } finally {
        await cleanupTempDir(output);
      }
    },
  );
});
