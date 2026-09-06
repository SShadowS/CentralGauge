/**
 * T3 — assembly consumes a persisted run_id instead of minting a fresh
 * UUID per invocation (the documented replay path double-counted runs).
 * T5 — attempts >2 must throw ValidationError instead of silently
 * collapsing to attempt=2 (which violates the D1 UNIQUE(run_id,task_id,
 * attempt) + CHECK attempt IN (1,2) constraints and kills the whole batch).
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "@std/assert";
import { join } from "@std/path";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import type { ExecutionAttempt } from "../../../src/tasks/interfaces.ts";
import { assembleBenchResultsForVariant } from "../../../cli/commands/bench/ingest-assembly.ts";
import type { EnvironmentManifest } from "../../../src/ingest/capture.ts";
import { invocationSnapshot } from "../../../src/ingest/capture.ts";
import { ValidationError } from "../../../src/errors.ts";
import {
  createMockExecutionAttempt,
  createMockLLMResponse,
  createMockTaskExecutionContext,
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
): Promise<string> {
  const path = join(dir, "benchmark-results-test.json");
  await Deno.writeTextFile(path, JSON.stringify({ results }));
  return path;
}

Deno.test("T3: persisted runId + pricingVersion are reused verbatim across assembles", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-t3a-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E001", [createMockExecutionAttempt({ success: true })]),
    ]);
    const opts = {
      pricingVersion: "2026-07-01",
      runId: "11111111-2222-4333-8444-555555555555",
    };

    const first = await assembleBenchResultsForVariant(path, VARIANT, opts);
    const second = await assembleBenchResultsForVariant(path, VARIANT, opts);
    assertEquals(first.kind, "assembled");
    assertEquals(second.kind, "assembled");
    if (first.kind !== "assembled" || second.kind !== "assembled") return;

    assertEquals(first.benchResults.runId, opts.runId);
    assertEquals(second.benchResults.runId, opts.runId);
    assertEquals(first.benchResults.pricingVersion, "2026-07-01");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("T3: absent runId mints a fresh UUID per assemble (legacy files) with a loud WARN", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-t3b-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E001", [createMockExecutionAttempt({ success: true })]),
    ]);
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const first = await assembleBenchResultsForVariant(path, VARIANT, {
        pricingVersion: "2026-07-01",
      });
      const second = await assembleBenchResultsForVariant(path, VARIANT, {
        pricingVersion: "2026-07-01",
      });
      if (first.kind !== "assembled" || second.kind !== "assembled") {
        throw new Error("expected assembled outcomes");
      }
      assertNotEquals(first.benchResults.runId, second.benchResults.runId);
      assert(
        warnings.some((w) => w.includes("NEW run")),
        `expected a loud no-persisted-run_id warning, got: ${
          warnings.join("|")
        }`,
      );
    } finally {
      console.warn = origWarn;
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("T5: a surviving attempt with attemptNumber > 2 throws ValidationError", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-t5-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E001", [
        createMockExecutionAttempt({ attemptNumber: 1, success: false }),
        createMockExecutionAttempt({ attemptNumber: 2, success: false }),
        createMockExecutionAttempt({ attemptNumber: 3, success: true }),
      ]),
    ]);
    await assertRejects(
      () =>
        assembleBenchResultsForVariant(path, VARIANT, {
          pricingVersion: "2026-07-01",
        }),
      ValidationError,
      "max 2 attempts",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("T5: attemptNumber <= 2 still assembles (attempt 0/1 map to 1)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-t5b-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E001", [
        createMockExecutionAttempt({ attemptNumber: 1, success: false }),
        createMockExecutionAttempt({ attemptNumber: 2, success: true }),
      ]),
    ]);
    const outcome = await assembleBenchResultsForVariant(path, VARIANT, {
      pricingVersion: "2026-07-01",
      runId: "persisted-run",
    });
    assertEquals(outcome.kind, "assembled");
    if (outcome.kind !== "assembled") return;
    assertEquals(outcome.benchResults.results.length, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("T5 ingest: served_model + refusal_category carry through from llmResponse", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-t5-refusal-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-X063", [
        createMockExecutionAttempt({
          attemptNumber: 1,
          llmResponse: createMockLLMResponse({
            servedModel: "claude-opus-4-8",
          }),
        }),
        createMockExecutionAttempt({
          attemptNumber: 2,
          llmResponse: createMockLLMResponse({
            refusal: { category: "cyber", recovered: false },
          }),
        }),
      ]),
      makeResult("CG-AL-X001", [
        createMockExecutionAttempt({ attemptNumber: 1 }),
      ]),
    ]);
    const outcome = await assembleBenchResultsForVariant(path, VARIANT, {
      pricingVersion: "2026-07-01",
      runId: "persisted-run",
    });
    assertEquals(outcome.kind, "assembled");
    if (outcome.kind !== "assembled") return;

    assertEquals(outcome.benchResults.results.length, 3);
    const [served, refused, plain] = outcome.benchResults.results;
    if (!served || !refused || !plain) {
      throw new Error("expected 3 assembled result items");
    }
    assertEquals(served.served_model, "claude-opus-4-8");
    assertEquals(served.refusal_category, null);
    assertEquals(refused.served_model, null);
    assertEquals(refused.refusal_category, "cyber");
    assertEquals(plain.served_model, null);
    assertEquals(plain.refusal_category, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Task 11: assembled item carries termination_kind, test_vector and prompt_sha256", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-t11-capture-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E001", [
        createMockExecutionAttempt({
          attemptNumber: 1,
          testResult: {
            success: true,
            totalTests: 2,
            passedTests: 2,
            failedTests: 0,
            duration: 1,
            output: "",
            results: [
              { name: "TestA", passed: true, duration: 1 },
              { name: "TestB", passed: true, duration: 1 },
            ],
          },
        }),
      ]),
    ]);
    const outcome = await assembleBenchResultsForVariant(path, VARIANT, {
      pricingVersion: "2026-07-01",
      runId: "persisted-run",
    });
    assertEquals(outcome.kind, "assembled");
    if (outcome.kind !== "assembled") return;

    const [item] = outcome.benchResults.results;
    if (!item) throw new Error("expected 1 assembled result item");
    assertEquals(item.termination_kind, "response");
    assertEquals(item.test_vector?.length, 2);
    assertEquals(item.prompt_sha256?.length, 64);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Task 12: environment + invocation thread through AssembleOptions onto BenchResults", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-t12-capture-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E001", [createMockExecutionAttempt({ success: true })]),
    ]);
    const environment: EnvironmentManifest = {
      bc_artifact: "https://bcartifacts/onprem/28.4/w1",
      container_image_digest: "sha256:abc",
      bcch_version: "6.1.14",
      test_runner: "soap",
      host_os: "windows-x86_64",
      centralgauge_sha: "deadbeef",
      dirty_tree: false,
      harness_fingerprint: "a".repeat(64),
      retry_path_version: "rp2-overlay-2026-09-01",
      prompt_policy_version: "pp1-diagnose-2026-08-23",
      prompt_template_digest: "b".repeat(64),
      culture: null,
      tenant: "default",
      company: "My Company",
      bcch_use_pssession_bc28: false,
      bcch_use_pwsh_bc24: true,
    };
    const outcome = await assembleBenchResultsForVariant(path, VARIANT, {
      pricingVersion: "2026-07-01",
      runId: "persisted-run",
      environment,
      invocation: { provider: "mock", requested_model: "mock-gpt-4" },
    });
    assertEquals(outcome.kind, "assembled");
    if (outcome.kind !== "assembled") return;

    assertEquals(outcome.benchResults.environment, environment);
    assertEquals(outcome.benchResults.invocation, {
      provider: "mock",
      requested_model: "mock-gpt-4",
    });
    assertEquals(outcome.benchResults.harnessFingerprint, "a".repeat(64));
    assertEquals(
      outcome.benchResults.retryPathVersion,
      "rp2-overlay-2026-09-01",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Task 12: environment/invocation are absent from BenchResults when not supplied", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-t12-capture-absent-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E001", [createMockExecutionAttempt({ success: true })]),
    ]);
    const outcome = await assembleBenchResultsForVariant(path, VARIANT, {
      pricingVersion: "2026-07-01",
      runId: "persisted-run",
    });
    assertEquals(outcome.kind, "assembled");
    if (outcome.kind !== "assembled") return;

    assertEquals(outcome.benchResults.environment, undefined);
    assertEquals(outcome.benchResults.invocation, undefined);
    assertEquals(outcome.benchResults.harnessFingerprint, undefined);
    assertEquals(outcome.benchResults.retryPathVersion, undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Task 11: assembly builds canonical settings from a typed invocation and legacy settings otherwise", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-t11-canonical-settings-" });
  try {
    const path = await writeResultsFile(dir, [
      makeResult("CG-AL-E001", [createMockExecutionAttempt({ success: true })]),
    ]);
    const invocation = invocationSnapshot({
      provider: "anthropic",
      model: "claude-opus-5",
      apiModelId: "claude-opus-5",
      maxTokens: 64000,
      temperature: 0,
      mode: "batch",
      fallbackPolicy: "unavailable",
      continuation: { enabled: false, maxContinuations: 0 },
      emptyRetry: {
        enabled: false,
        maxRetries: 0,
        baseDelayMs: 0,
        jitterMs: 0,
      },
      infraRetriesPerAttempt: 1,
      maxAttempts: 2,
      promptProfileDigest: "d".repeat(64),
    });
    const typed = await assembleBenchResultsForVariant(path, VARIANT, {
      pricingVersion: "2026-09-06",
      invocation: { ...invocation },
    });
    assert(typed.kind === "assembled");
    assertEquals(
      Object.keys(typed.benchResults.settings).sort(),
      [
        "bc_version",
        "extra_json",
        "max_attempts",
        "max_tokens",
        "prompt_version",
        "temperature",
      ],
    );
    assertEquals(typed.benchResults.settings["max_attempts"], 2);
    assertEquals(typed.benchResults.invocationMode, "batch");
    const extras = JSON.parse(
      typed.benchResults.settings["extra_json"] as string,
    );
    assertEquals(extras.invocation_mode, "batch");
    assertEquals(extras.thinking_budget, null);

    const legacy = await assembleBenchResultsForVariant(path, VARIANT, {
      pricingVersion: "2026-09-06",
      invocation: { provider: "anthropic" },
    });
    assert(legacy.kind === "assembled");
    assertEquals("extra_json" in legacy.benchResults.settings, false);
    assertEquals(legacy.benchResults.invocationMode, "sync");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
