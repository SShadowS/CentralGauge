// tests/unit/batch/status.test.ts
//
// `runStatus`/`formatStatus` (spec section 8): a read-mostly summary of a
// run directory. No network unless a live `intent.json` is on disk (the
// real submit-unknown condition), in which case `provider.listCandidates`
// is consulted (spec 4.3's reconciliation window). `nextAction` is derived from `src/batch/transitions.ts`'s
// `nextStep`, the same pure decision table `advance` runs on.
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { formatStatus, runStatus } from "../../../src/batch/status.ts";
import { RUN_FILES, runDir } from "../../../src/batch/paths.ts";
import { writeJsonAtomic, writeState } from "../../../src/batch/state.ts";
import { writeIntent } from "../../../src/batch/intent.ts";
import type { SubmissionIntent } from "../../../src/batch/intent.ts";
import { buildCanonicalSettings } from "../../../shared/settings-hash.ts";
import {
  frozenInputs,
  minimalState,
  record,
  task,
} from "../../utils/batch-fixtures.ts";
import type {
  BatchCandidate,
  BatchHandle,
  BatchItemResult,
  BatchPoll,
  BatchProvider,
} from "../../../src/llm/batch/types.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

function fakeListingProvider(candidates: BatchCandidate[]): BatchProvider {
  return {
    provider: "anthropic",
    limits: { maxItems: 1000, maxBytes: 1_000_000 },
    submit(): Promise<BatchHandle> {
      throw new Error("not used in this test");
    },
    poll(): Promise<BatchPoll> {
      throw new Error("not used in this test");
    },
    collect(): Promise<BatchItemResult[]> {
      throw new Error("not used in this test");
    },
    listCandidates(_since: Date): Promise<BatchCandidate[]> {
      return Promise.resolve(candidates);
    },
  };
}

Deno.test("runStatus", async (t) => {
  await t.step("a processing run: advance (processing)", async () => {
    const output = await createTempDir("batch-status-processing");
    try {
      const dir = runDir(output, "run-processing");
      await ensureDir(dir);

      const state = minimalState({
        runId: "run-processing",
        phase: "attempt-1-submitted",
        wave: 1,
        batches: [
          record({
            state: "processing",
            providerStatus: "in_progress",
            itemIds: ["item-1", "item-2"],
            rawCounts: { processing: 2 },
          }),
        ],
        activeBatchIds: ["b1"],
        tasks: {
          "CG-AL-E001": task("submitted"),
          "CG-AL-E002": task("submitted"),
        },
      });
      await writeState(dir, state);

      const status = await runStatus(dir);

      assertEquals(status.runId, "run-processing");
      assertEquals(status.model, "anthropic/claude-haiku-4-5");
      assertEquals(status.phase, "attempt-1-submitted");
      assertEquals(status.wave, 1);
      assertEquals(status.batches.length, 1);
      assertEquals(status.batches[0]!.id, "b1");
      assertEquals(status.batches[0]!.status, "in_progress");
      assertEquals(status.evaluated, 0);
      assertEquals(status.unresolved, 2);
      assertEquals(status.nextAction, "advance (processing)");
      assertEquals(status.candidates, undefined);

      const lines = formatStatus([status]);
      assertEquals(lines.length, 1 + status.batches.length);
    } finally {
      await cleanupTempDir(output);
    }
  });

  await t.step(
    "a collected run with attemptLimit 1: advance (collect + evaluate)",
    async () => {
      const output = await createTempDir("batch-status-collected");
      try {
        const dir = runDir(output, "run-collected");
        await ensureDir(dir);

        const inputs = frozenInputs({
          settings: buildCanonicalSettings(
            {
              temperature: null,
              max_attempts: 1,
              max_tokens: null,
              prompt_version: null,
              bc_version: null,
            },
            {
              settings_extras_schema: 2,
              upstream_pin: null,
              invocation_mode: "batch",
              continuation: { enabled: false, max: 0 },
              empty_retry: { enabled: false, max: 0 },
              fallback_policy: "unavailable",
              provider_route: "anthropic",
              endpoint: "/v1/messages",
              thinking_budget: null,
              prompt_profile_digest: "a".repeat(64),
              infra_retries_per_attempt: 1,
            },
          ),
        });
        await writeJsonAtomic(join(dir, RUN_FILES.promptInputs), inputs);

        const state = minimalState({
          runId: "run-collected",
          phase: "attempt-1-collected",
          wave: 1,
          batches: [
            record({
              state: "ended",
              providerStatus: "ended",
              collected: true,
              itemIds: ["item-1", "item-2"],
              rawCounts: { succeeded: 2 },
              providerReportedCostUsd: 0.05,
            }),
          ],
          activeBatchIds: [],
          tasks: {
            "CG-AL-E001": task("evaluated"),
            "CG-AL-E002": task("evaluated"),
          },
        });
        await writeState(dir, state);

        const status = await runStatus(dir);

        assertEquals(status.phase, "attempt-1-collected");
        assertEquals(status.evaluated, 2);
        assertEquals(status.unresolved, 0);
        assertEquals(status.batches[0]!.reportedCostUsd, 0.05);
        assertEquals(status.nextAction, "advance (collect + evaluate)");

        const lines = formatStatus([status]);
        assertEquals(lines.length, 1 + status.batches.length);
      } finally {
        await cleanupTempDir(output);
      }
    },
  );

  await t.step(
    "a run with a live intent: lists candidates and asks for retry --adopt | --confirm-not-submitted",
    async () => {
      const output = await createTempDir("batch-status-submit-unknown");
      try {
        const dir = runDir(output, "run-unknown");
        await ensureDir(dir);

        // Nothing ever persists `phase: "submit-unknown"` - the live
        // `intent.json` below is the whole condition, so `status` must key
        // the candidate lookup off that and not off the phase.
        const state = minimalState({
          runId: "run-unknown",
          phase: "attempt-1-submitted",
          wave: 1,
          batches: [],
          activeBatchIds: [],
          tasks: {
            "CG-AL-E001": task("pending"),
            "CG-AL-E002": task("pending"),
          },
        });
        await writeState(dir, state);

        const intent: SubmissionIntent = {
          runId: "run-unknown",
          wave: 1,
          round: 0,
          chunk: 0,
          itemIds: ["item-1", "item-2"],
          bodyDigests: ["d1", "d2"],
          nonce: "nonce-1",
          writtenAt: new Date().toISOString(),
        };
        await writeIntent(dir, intent);

        const candidate: BatchCandidate = {
          batchId: "candidate-1",
          createdAt: new Date(),
          total: 2,
          ended: false,
        };
        const provider = fakeListingProvider([candidate]);

        const status = await runStatus(dir, provider);

        assertEquals(status.phase, "attempt-1-submitted");
        assertEquals(status.candidates?.length, 1);
        assertEquals(status.candidates?.[0]?.batchId, "candidate-1");
        assertEquals(
          status.nextAction,
          "retry --adopt <id> | --confirm-not-submitted",
        );
      } finally {
        await cleanupTempDir(output);
      }
    },
  );
});

Deno.test("formatStatus prints one header line and one line per batch", () => {
  const lines = formatStatus([
    {
      runId: "run-a",
      model: "anthropic/claude-haiku-4-5",
      phase: "attempt-1-submitted",
      wave: 1,
      batches: [
        {
          id: "b1",
          status: "in_progress",
          counts: { processing: 1 },
          ageMinutes: 5,
          reportedCostUsd: null,
        },
        {
          id: "b2",
          status: "ended",
          counts: { succeeded: 1 },
          ageMinutes: 10,
          reportedCostUsd: 0.1,
        },
      ],
      unresolved: 1,
      evaluated: 1,
      nextAction: "advance (processing)",
    },
  ]);
  assertEquals(lines.length, 3);
});
