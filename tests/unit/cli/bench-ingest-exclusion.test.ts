// tests/unit/cli/bench-ingest-exclusion.test.ts
//
// A compromised upstream makes the assembly send `BenchResults.excluded`, so
// the scoreboard stores the run already excluded. The SYNC bench path has to
// mark its local results file too, or `src/stats/importer.ts` re-admits the
// same numbers to the local score tables from the file on disk.
//
// Fakes only: the ingest call and the environment manifest are both injected,
// so nothing here reaches the network or `docker inspect`.
import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import type { EnvironmentManifest } from "../../../src/ingest/capture.ts";
import type { BenchResults } from "../../../src/ingest/mod.ts";
import type { IngestOutcome } from "../../../src/ingest/types.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import type { ExecutionAttempt } from "../../../src/tasks/interfaces.ts";
import { ingestBenchResults } from "../../../cli/commands/bench-command.ts";
import {
  cleanupTempDir,
  createMockExecutionAttempt,
  createMockTaskExecutionContext,
  createTempDir,
} from "../../utils/test-helpers.ts";

const RUN_ID = "run-bench-excl-1";

const VARIANT: ModelVariant = {
  originalSpec: "mock/mock-gpt-4",
  baseModel: "mock-gpt-4",
  provider: "mock",
  model: "mock-gpt-4",
  variantId: "mock/mock-gpt-4",
  hasVariant: false,
  config: {},
};

function mockEnvironment(): EnvironmentManifest {
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

async function writeResultsFile(
  dir: string,
  attempts: ExecutionAttempt[],
): Promise<string> {
  const path = join(dir, "benchmark-results-test.json");
  await Deno.writeTextFile(
    path,
    JSON.stringify({
      results: [{
        taskId: "CG-AL-E001",
        executionId: "CG-AL-E001-exec",
        context: createMockTaskExecutionContext(),
        attempts,
        success: attempts.some((a) => a.success),
        finalScore: 0,
        totalTokensUsed: 0,
        totalCost: 0,
        totalDuration: 0,
        passedAttemptNumber: 0,
      }],
      ingest: {
        schema: 2,
        pricing_version: "2026-09-12",
        task_set_hash: "t".repeat(64),
        run_ids: { [VARIANT.variantId]: RUN_ID },
      },
    }),
  );
  return path;
}

function stubDeps() {
  const seen: BenchResults[] = [];
  return {
    seen,
    deps: {
      ingestRun: (br: BenchResults): Promise<IngestOutcome> => {
        seen.push(br);
        return Promise.resolve({
          kind: "success",
          runId: RUN_ID,
          bytesUploaded: 0,
          referencedBytes: 0,
        });
      },
      buildEnvironmentManifest: () => Promise.resolve(mockEnvironment()),
    },
  };
}

Deno.test("the bench ingest path stamps a results file whose run was excluded", async () => {
  const dir = await createTempDir("bench-ingest-excl");
  try {
    const path = await writeResultsFile(dir, [
      createMockExecutionAttempt({
        success: true,
        score: 100,
        requestedUpstream: "novita/fp8",
        servedUpstream: "Together",
        servedUpstreamModel: "v1",
        upstreamIdentitySource: "both",
        upstreamVerification: "mismatch",
      }),
    ]);
    const { seen, deps } = stubDeps();
    await ingestBenchResults([path], [VARIANT], true, "Cronus28", deps);

    assertEquals(seen.length, 1);
    assertExists(seen[0]!.excluded);
    const doc = JSON.parse(await Deno.readTextFile(path)) as {
      excluded?: { at: string; reason: string; run_ids: string[] };
    };
    assertExists(doc.excluded);
    assertEquals(doc.excluded!.run_ids, [RUN_ID]);
    assertEquals(doc.excluded!.reason, seen[0]!.excluded!.reason);
    assertEquals(doc.excluded!.at.length > 0, true);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("the bench ingest path leaves a clean run's results file unstamped", async () => {
  const dir = await createTempDir("bench-ingest-clean");
  try {
    const path = await writeResultsFile(dir, [
      createMockExecutionAttempt({
        success: true,
        score: 100,
        requestedUpstream: "novita/fp8",
        servedUpstream: "Novita",
        servedUpstreamModel: "v1",
        upstreamIdentitySource: "both",
        upstreamVerification: "verified",
      }),
    ]);
    const { seen, deps } = stubDeps();
    await ingestBenchResults([path], [VARIANT], true, "Cronus28", deps);

    assertEquals(seen.length, 1);
    assertEquals(seen[0]!.excluded, undefined);
    const doc = JSON.parse(await Deno.readTextFile(path)) as {
      excluded?: unknown;
    };
    assertEquals(doc.excluded, undefined);
  } finally {
    await cleanupTempDir(dir);
  }
});
