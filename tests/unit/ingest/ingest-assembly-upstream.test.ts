/**
 * Task 11: the five upstream fields ride on every ingested result item, a
 * compromised run is marked `excluded` naming the attempts that caused it,
 * and the settings a run hashed under are sent verbatim when the results
 * file froze them (schema 5) instead of being rebuilt.
 *
 * Helpers mirror `ingest-assembly-infra.test.ts` (same VARIANT / makeResult
 * / writeResultsFile shapes), copied in rather than shared so a change to
 * one file's fixtures cannot silently move the other's assertions.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import type { ExecutionAttempt } from "../../../src/tasks/interfaces.ts";
import { assembleBenchResultsForVariant } from "../../../cli/commands/bench/ingest-assembly.ts";
import { parseIngestMeta } from "../../../cli/commands/bench/ingest-meta.ts";
import type { CanonicalSettings } from "../../../shared/settings-hash.ts";
import { settingsHashOf } from "../../../shared/settings-hash.ts";
import { copyPreUpstreamFixture } from "../../utils/batch-fixture.ts";
import {
  cleanupTempDir,
  createMockExecutionAttempt,
  createMockTaskExecutionContext,
  createTempDir,
} from "../../utils/test-helpers.ts";

const VARIANT: ModelVariant = {
  originalSpec: "mock/mock-gpt-4",
  baseModel: "mock-gpt-4",
  provider: "mock",
  model: "mock-gpt-4",
  variantId: "mock/mock-gpt-4",
  hasVariant: false,
  config: {},
};

const ASSEMBLE_OPTS = { pricingVersion: "2026-09-12" };

function makeResult(taskId: string, attempts: ExecutionAttempt[]) {
  return {
    taskId,
    executionId: `${taskId}-exec`,
    context: createMockTaskExecutionContext(),
    attempts,
    success: attempts.some((a) => a.success),
    finalScore: 0,
    totalTokensUsed: 0,
    totalCost: 0,
    totalDuration: 0,
    passedAttemptNumber: 0,
  };
}

async function writeResultsFile(
  dir: string,
  results: unknown[],
  extra?: Record<string, unknown>,
): Promise<string> {
  const path = join(dir, "benchmark-results-test.json");
  await Deno.writeTextFile(path, JSON.stringify({ results, ...extra }));
  return path;
}

/**
 * The fixture run's variant, rebuilt from its `state.json` model block plus
 * the temperature/max-tokens its `prompt-inputs.json` froze.
 *
 * Assembly reads the base settings (temperature, max_tokens,
 * thinking_budget) off `variant.config`, not off the invocation record, so
 * a variant with an empty config would rebuild a DIFFERENT six-key object
 * than the run was ingested under. A real replay does not have that
 * problem: `centralgauge ingest <file>` resolves its variants from the
 * model spec or preset, which carries exactly these values.
 */
async function reconstructVariantFromFixture(
  f: { dir: string },
): Promise<ModelVariant> {
  const state = JSON.parse(
    await Deno.readTextFile(join(f.dir, "state.json")),
  ) as { model: { slug: string; provider: string; apiModelId: string } };
  const frozen = JSON.parse(
    await Deno.readTextFile(join(f.dir, "prompt-inputs.json")),
  ) as { settings: { temperature: number | null; max_tokens: number | null } };
  return {
    originalSpec: state.model.slug,
    baseModel: state.model.slug,
    provider: state.model.provider,
    model: state.model.apiModelId,
    variantId: state.model.slug,
    hasVariant: false,
    config: {
      ...(frozen.settings.temperature !== null
        ? { temperature: frozen.settings.temperature }
        : {}),
      ...(frozen.settings.max_tokens !== null
        ? { maxTokens: frozen.settings.max_tokens }
        : {}),
    },
  };
}

Deno.test("assembly emits the five upstream fields per item", async () => {
  const dir = await createTempDir("asm-up");
  try {
    const a = createMockExecutionAttempt({
      success: true,
      score: 100,
      requestedUpstream: "novita/fp8",
      servedUpstream: "Novita",
      servedUpstreamModel: "v",
      upstreamIdentitySource: "both",
      upstreamVerification: "verified",
    });
    const path = await writeResultsFile(dir, [makeResult("t1", [a])]);
    const out = await assembleBenchResultsForVariant(
      path,
      VARIANT,
      ASSEMBLE_OPTS,
    );
    assert(out.kind === "assembled");
    const item = out.benchResults.results[0]!;
    assertEquals(item.requested_upstream, "novita/fp8");
    assertEquals(item.served_upstream, "Novita");
    assertEquals(item.served_upstream_model, "v");
    assertEquals(item.upstream_identity_source, "both");
    assertEquals(item.upstream_verification, "verified");
    assertEquals(out.benchResults.excluded, undefined);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("assembly nulls the upstream fields on an attempt predating the capture", async () => {
  const dir = await createTempDir("asm-up-legacy");
  try {
    const path = await writeResultsFile(dir, [
      makeResult("t1", [createMockExecutionAttempt({ success: true })]),
    ]);
    const out = await assembleBenchResultsForVariant(
      path,
      VARIANT,
      ASSEMBLE_OPTS,
    );
    assert(out.kind === "assembled");
    const item = out.benchResults.results[0]!;
    assertEquals(item.requested_upstream, null);
    assertEquals(item.served_upstream, null);
    assertEquals(item.served_upstream_model, null);
    assertEquals(item.upstream_identity_source, null);
    // A non-OpenRouter attempt was never in scope for the lock at all.
    assertEquals(item.upstream_verification, "not_applicable");
    assertEquals(out.benchResults.excluded, undefined);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("assembly marks the run excluded when any attempt is compromised, naming the attempts", async () => {
  const dir = await createTempDir("asm-up2");
  try {
    const good = createMockExecutionAttempt({
      success: true,
      score: 100,
      attemptNumber: 1,
      requestedUpstream: "novita/fp8",
      servedUpstream: "Novita",
      upstreamVerification: "verified",
      upstreamIdentitySource: "provider_field",
    });
    const bad = createMockExecutionAttempt({
      success: false,
      score: 0,
      attemptNumber: 1,
      requestedUpstream: "novita/fp8",
      servedUpstream: "Together",
      upstreamVerification: "mismatch",
      upstreamIdentitySource: "provider_field",
      terminal: "upstream_compromised",
    });
    const path = await writeResultsFile(dir, [
      makeResult("t1", [good]),
      makeResult("t2", [bad]),
    ]);
    const out = await assembleBenchResultsForVariant(
      path,
      VARIANT,
      ASSEMBLE_OPTS,
    );
    assert(out.kind === "assembled");
    assertEquals(out.benchResults.excluded, {
      code: "upstream_mismatch",
      reason:
        "upstream mismatch on 1 attempt: pinned novita/fp8, served Together (t2 a1)",
      attempts: [{ task_id: "t2", attempt: 1 }],
    });
    // The compromised attempt is still in the payload with its real outcome.
    assertEquals(out.benchResults.results.length, 2);
    const compromised = out.benchResults.results.find((r) =>
      r.task_id === "t2"
    )!;
    assertEquals(compromised.passed, false);
    assertEquals(compromised.upstream_verification, "mismatch");
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("assembly reports upstream_unverified when that is the only compromise, mismatch when both occur", async (t) => {
  await t.step("unverified only", async () => {
    const dir = await createTempDir("asm-up3a");
    try {
      const unverified = createMockExecutionAttempt({
        success: false,
        score: 0,
        attemptNumber: 1,
        requestedUpstream: "novita/fp8",
        servedUpstream: null,
        upstreamVerification: "unverified",
        upstreamIdentitySource: null,
        terminal: "upstream_compromised",
      });
      const path = await writeResultsFile(dir, [
        makeResult("t1", [unverified]),
      ]);
      const out = await assembleBenchResultsForVariant(
        path,
        VARIANT,
        ASSEMBLE_OPTS,
      );
      assert(out.kind === "assembled");
      assertEquals(out.benchResults.excluded, {
        code: "upstream_unverified",
        reason:
          "upstream unverified on 1 attempt: pinned novita/fp8, no identity in the response (t1 a1)",
        attempts: [{ task_id: "t1", attempt: 1 }],
      });
    } finally {
      await cleanupTempDir(dir);
    }
  });

  await t.step("unverified and mismatch together report mismatch", async () => {
    const dir = await createTempDir("asm-up3b");
    try {
      const unverified = createMockExecutionAttempt({
        success: false,
        score: 0,
        attemptNumber: 1,
        requestedUpstream: "novita/fp8",
        servedUpstream: null,
        upstreamVerification: "unverified",
        upstreamIdentitySource: null,
      });
      const mismatch = createMockExecutionAttempt({
        success: false,
        score: 0,
        attemptNumber: 2,
        requestedUpstream: "novita/fp8",
        servedUpstream: "Together",
        upstreamVerification: "mismatch",
        upstreamIdentitySource: "router_metadata",
      });
      const path = await writeResultsFile(dir, [
        makeResult("t1", [unverified]),
        makeResult("t2", [mismatch]),
      ]);
      const out = await assembleBenchResultsForVariant(
        path,
        VARIANT,
        ASSEMBLE_OPTS,
      );
      assert(out.kind === "assembled");
      const excluded = out.benchResults.excluded!;
      assertEquals(excluded.code, "upstream_mismatch");
      assertEquals(excluded.attempts, [
        { task_id: "t1", attempt: 1 },
        { task_id: "t2", attempt: 2 },
      ]);
      assertEquals(
        excluded.reason,
        "upstream mismatch on 2 attempts: pinned novita/fp8, served Together (t1 a1, t2 a2)",
      );
    } finally {
      await cleanupTempDir(dir);
    }
  });

  await t.step("not_served never marks the run excluded", async () => {
    const dir = await createTempDir("asm-up3c");
    try {
      const notServed = createMockExecutionAttempt({
        success: false,
        score: 0,
        attemptNumber: 1,
        requestedUpstream: "novita/fp8",
        servedUpstream: null,
        upstreamVerification: "not_served",
        upstreamIdentitySource: null,
      });
      const path = await writeResultsFile(dir, [makeResult("t1", [notServed])]);
      const out = await assembleBenchResultsForVariant(
        path,
        VARIANT,
        ASSEMBLE_OPTS,
      );
      assert(out.kind === "assembled");
      assertEquals(out.benchResults.excluded, undefined);
      assertEquals(
        out.benchResults.results[0]!.upstream_verification,
        "not_served",
      );
    } finally {
      await cleanupTempDir(dir);
    }
  });
});

Deno.test("assembly prefers persisted canonical_settings verbatim and never rebuilds them", async () => {
  const dir = await createTempDir("asm-up4");
  try {
    const frozen: CanonicalSettings = {
      temperature: 0.25,
      max_attempts: 2,
      max_tokens: 4096,
      prompt_version: null,
      bc_version: null,
      extra_json: '{"frozen":"exactly this"}',
    };
    const path = await writeResultsFile(
      dir,
      [makeResult("t1", [createMockExecutionAttempt({ success: true })])],
      {
        ingest: {
          schema: 5,
          pricing_version: "2026-09-12",
          run_ids: { [VARIANT.variantId]: crypto.randomUUID() },
          canonical_settings: { [VARIANT.variantId]: frozen },
          settings_hashes: { [VARIANT.variantId]: "deadbeef" },
        },
      },
    );
    const meta = parseIngestMeta(JSON.parse(await Deno.readTextFile(path)))!;
    assertEquals(meta.schema, 5);
    assertEquals(meta.canonical_settings?.[VARIANT.variantId], frozen);
    assertEquals(meta.settings_hashes?.[VARIANT.variantId], "deadbeef");

    const out = await assembleBenchResultsForVariant(path, VARIANT, {
      pricingVersion: meta.pricing_version,
      runId: meta.run_ids[VARIANT.variantId]!,
      canonicalSettings: meta.canonical_settings![VARIANT.variantId]!,
      settingsHash: meta.settings_hashes![VARIANT.variantId]!,
    });
    assert(out.kind === "assembled");
    assertEquals(out.benchResults.settings, { ...frozen });
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("assembly rebuilds a schema-4 file through the legacy builder", async () => {
  const f = await copyPreUpstreamFixture();
  try {
    const meta = parseIngestMeta(
      JSON.parse(await Deno.readTextFile(f.resultsFile)),
    )!;
    const variantId = Object.keys(meta.run_ids)[0]!;
    const inv = meta.invocations![variantId]!;
    const out = await assembleBenchResultsForVariant(
      f.resultsFile,
      await reconstructVariantFromFixture(f),
      {
        pricingVersion: meta.pricing_version,
        runId: meta.run_ids[variantId]!,
        invocation: inv,
      },
    );
    assert(out.kind === "assembled");
    // The legacy hash: recompute from the fixture's frozen prompt-inputs.json
    // settings and compare.
    const frozen = JSON.parse(
      await Deno.readTextFile(join(f.dir, "prompt-inputs.json")),
    ) as { settings: Record<string, unknown> };
    assertEquals(
      await settingsHashOf(out.benchResults.settings as never),
      await settingsHashOf(frozen.settings as never),
    );
    assertEquals(
      "settings_extras_schema" in
        JSON.parse(String(out.benchResults.settings["extra_json"])),
      false,
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("the exclusion reason stays within 500 characters, with the full list still on attempts", async () => {
  const dir = await createTempDir("asm-up5");
  try {
    const results = Array.from(
      { length: 60 },
      (_, i) =>
        makeResult(`CG-AL-X${String(i).padStart(3, "0")}`, [
          createMockExecutionAttempt({
            success: false,
            score: 0,
            attemptNumber: 1,
            requestedUpstream: "novita/fp8",
            servedUpstream: "Together",
            upstreamVerification: "mismatch",
            upstreamIdentitySource: "provider_field",
          }),
        ]),
    );
    const path = await writeResultsFile(dir, results);
    const out = await assembleBenchResultsForVariant(
      path,
      VARIANT,
      ASSEMBLE_OPTS,
    );
    assert(out.kind === "assembled");
    const excluded = out.benchResults.excluded!;
    assert(
      excluded.reason.length <= 500,
      `reason was ${excluded.reason.length} chars: ${excluded.reason}`,
    );
    assert(excluded.reason.endsWith(", ...)"), excluded.reason);
    assert(excluded.reason.startsWith("upstream mismatch on 60 attempts:"));
    // Truncating the prose never loses an attempt: the structured list is
    // what a reviewer actually reads back.
    assertEquals(excluded.attempts.length, 60);
  } finally {
    await cleanupTempDir(dir);
  }
});
