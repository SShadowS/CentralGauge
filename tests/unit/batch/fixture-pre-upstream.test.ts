import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import type { EnvironmentManifest } from "../../../src/ingest/capture.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import type {
  TaskExecutionContext,
  TaskManifest,
} from "../../../src/tasks/interfaces.ts";
import { loadState } from "../../../src/batch/state.ts";
import { finalizeRun } from "../../../src/batch/results.ts";
import { buildAdvanceDeps } from "../../../cli/commands/bench-batch-command.ts";
import {
  buildLegacyCanonicalSettings,
  settingsHashOf,
} from "../../../shared/settings-hash.ts";
import { copyPreUpstreamFixture } from "../../utils/batch-fixture.ts";
import {
  createMockTaskExecutionContext,
  createMockTaskManifest,
} from "../../utils/test-helpers.ts";

Deno.test("pre-upstream fixture parses as a finalized schema-4 run with no routing", async () => {
  const f = await copyPreUpstreamFixture();
  try {
    const state = await loadState(f.dir);
    assertEquals(state.phase, "finalized");
    assertEquals(Object.keys(state.tasks).length, 2);
    const inputs = JSON.parse(
      await Deno.readTextFile(join(f.dir, "prompt-inputs.json")),
    ) as Record<string, unknown>;
    assertEquals("routing" in inputs, false);
    const results = JSON.parse(await Deno.readTextFile(f.resultsFile)) as {
      ingest: { schema: number };
    };
    assertEquals(results.ingest.schema, 4);
    assertExists(inputs["settings"]);
  } finally {
    await f.cleanup();
  }
});

Deno.test("buildAdvanceDeps on a pre-upstream run wires no routing", async () => {
  const f = await copyPreUpstreamFixture();
  try {
    const deps = await buildAdvanceDeps(f.dir);
    const body = deps.buildBody(
      { prompt: "hi", taskId: "t", attempt: 1 } as never,
    ) as Record<string, unknown>;
    assertEquals("provider" in body, false);
  } finally {
    await f.cleanup();
  }
});

const FIXTURE_VARIANT_ID = "openrouter/google/gemini-3.8-flash";

function fixtureVariant(): ModelVariant {
  return {
    originalSpec: FIXTURE_VARIANT_ID,
    baseModel: FIXTURE_VARIANT_ID,
    provider: "openrouter",
    model: "google/gemini-3.8-flash",
    config: {},
    variantId: FIXTURE_VARIANT_ID,
    hasVariant: false,
  };
}

function fixtureEnvironment(): EnvironmentManifest {
  return {
    bc_artifact: null,
    container_image_digest: null,
    bcch_version: "6.1.14",
    test_runner: "soap",
    host_os: "windows-x86_64",
    centralgauge_sha: null,
    dirty_tree: false,
    harness_fingerprint: "h".repeat(64),
    retry_path_version: "v1",
    prompt_policy_version: "v1",
    prompt_template_digest: "d".repeat(64),
    culture: null,
    tenant: "default",
    company: "My Company",
    bcch_use_pssession_bc28: false,
    bcch_use_pwsh_bc24: true,
  };
}

Deno.test("the pre-upstream run's frozen extras are schema 1 and rebuild its frozen settings hash", async () => {
  const f = await copyPreUpstreamFixture();
  try {
    const inputs = JSON.parse(
      await Deno.readTextFile(join(f.dir, "prompt-inputs.json")),
    ) as { settings: Record<string, unknown> };
    const extras = JSON.parse(inputs.settings["extra_json"] as string);
    assertEquals("settings_extras_schema" in extras, false);

    const state = await loadState(f.dir);
    const rebuilt = buildLegacyCanonicalSettings(
      {
        temperature: inputs.settings["temperature"] as number,
        max_attempts: inputs.settings["max_attempts"] as number,
        max_tokens: inputs.settings["max_tokens"] as number,
        prompt_version: null,
        bc_version: null,
      },
      extras,
    );
    assertEquals(rebuilt.extra_json, inputs.settings["extra_json"]);
    assertEquals(await settingsHashOf(rebuilt), state.frozen.settingsHash);
  } finally {
    await f.cleanup();
  }
});

Deno.test("finalizeRun on a pre-upstream run keeps the frozen settings hash and emits a schema-1 invocation", async () => {
  const f = await copyPreUpstreamFixture();
  try {
    const state = await loadState(f.dir);
    // Force a rebuild of the results file through the current finalize code.
    await Deno.remove(f.resultsFile);

    const manifests = new Map<string, TaskManifest>();
    const contexts = new Map<string, TaskExecutionContext>();
    for (const taskId of Object.keys(state.tasks)) {
      const manifest = createMockTaskManifest({ id: taskId });
      manifests.set(taskId, manifest);
      contexts.set(
        taskId,
        createMockTaskExecutionContext({
          manifest,
          variantId: FIXTURE_VARIANT_ID,
          llmProvider: "openrouter",
          llmModel: "google/gemini-3.8-flash",
          attemptLimit: 2,
        }),
      );
    }

    await finalizeRun(f.dir, { ...state, resultsFile: f.resultsFile }, {
      manifests,
      contexts,
      variant: fixtureVariant(),
      environment: fixtureEnvironment(),
      taskSetHash: state.frozen.taskSetHash,
      ingest: false,
      cwd: Deno.cwd(),
      ingestFlags: {},
    });

    const results = JSON.parse(await Deno.readTextFile(f.resultsFile)) as {
      ingest: {
        schema: number;
        invocations: Record<string, Record<string, unknown>>;
      };
    };
    const inv = Object.values(results.ingest.invocations)[0];
    assertExists(inv);
    assertEquals("invocation_schema" in inv, false);
    assertEquals("upstream_pin" in inv, false);
    assertEquals("upstream_resolved" in inv, false);
    // Schema 5 lands in Task 11; today's finalize still stamps schema 4.
    assertEquals(results.ingest.schema, 4);
  } finally {
    await f.cleanup();
  }
});
