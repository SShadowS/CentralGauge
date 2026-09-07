// tests/unit/batch/reconcile.test.ts
//
// One case per line of spec 4.3, driven directly against
// `reconcileSubmitUnknown`/`confirmNotSubmitted` with the fake provider's
// `candidates`/`collectByCandidate` scripts.
import { assert, assertEquals } from "@std/assert";
import {
  confirmNotSubmitted,
  reconcileSubmitUnknown,
} from "../../../src/batch/reconcile.ts";
import { readIntent, writeIntent } from "../../../src/batch/intent.ts";
import type { SubmissionIntent } from "../../../src/batch/intent.ts";
import { minimalState } from "../../utils/batch-fixtures.ts";
import { FakeBatchProvider } from "../../utils/fake-batch-provider.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

function makeIntent(
  overrides: Partial<SubmissionIntent> = {},
): SubmissionIntent {
  return {
    runId: "run-fixture",
    wave: 1,
    round: 0,
    chunk: 0,
    itemIds: ["item-a", "item-b"],
    bodyDigests: ["digest-a", "digest-b"],
    nonce: "nonce-1",
    writtenAt: "2026-09-06T00:10:00.000Z",
    ...overrides,
  };
}

Deno.test("reconcileSubmitUnknown: OpenAI adopts on exact nonce match, not on a mismatch", async () => {
  const dir = await createTempDir("reconcile-openai");
  try {
    const state = minimalState({
      model: { slug: "openai/gpt-6", provider: "openai", apiModelId: "gpt-6" },
      phase: "submit-unknown",
    });
    const intent = makeIntent({ nonce: "the-real-nonce" });
    await writeIntent(dir, intent);

    const mismatch = new FakeBatchProvider("openai", {
      candidates: [{
        batchId: "cand-wrong",
        createdAt: new Date(intent.writtenAt),
        nonce: "some-other-nonce",
        ended: false,
      }],
    });
    const missReport = await reconcileSubmitUnknown(
      dir,
      state,
      mismatch,
      intent,
    );
    assertEquals(missReport.adopted, undefined);
    assertEquals(missReport.candidates.length, 1);
    // A synchronous nonce comparison never needs to call collect().
    assertEquals(
      mismatch.calls.filter((c) => c.op === "collect").length,
      0,
    );
    assertEquals(await readIntent(dir), intent);

    const match = new FakeBatchProvider("openai", {
      candidates: [{
        batchId: "cand-right",
        createdAt: new Date(intent.writtenAt),
        nonce: "the-real-nonce",
        ended: false,
      }],
    });
    const hitReport = await reconcileSubmitUnknown(dir, state, match, intent);
    assert(hitReport.adopted !== undefined);
    assertEquals(hitReport.adopted?.handle.batchId, "cand-right");
    assertEquals(hitReport.adopted?.itemIds, intent.itemIds);
    assertEquals(hitReport.adopted?.state, "processing");
    assertEquals(state.activeBatchIds, ["cand-right"]);
    assertEquals(state.phase, "attempt-1-submitted");
    assertEquals(await readIntent(dir), null);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("reconcileSubmitUnknown: Anthropic candidate with matching total but not ended is listed and not adopted", async () => {
  const dir = await createTempDir("reconcile-anthropic-pending");
  try {
    const state = minimalState({ phase: "submit-unknown" });
    const intent = makeIntent();
    await writeIntent(dir, intent);

    const fake = new FakeBatchProvider("anthropic", {
      candidates: [{
        batchId: "cand-pending",
        createdAt: new Date(intent.writtenAt),
        total: intent.itemIds.length,
        ended: false,
      }],
    });

    const report = await reconcileSubmitUnknown(dir, state, fake, intent);
    assertEquals(report.adopted, undefined);
    assertEquals(report.candidates.length, 1);
    assertEquals(report.candidates[0]?.batchId, "cand-pending");
    assert(report.reason.includes("cand-pending"));
    assertEquals(fake.calls.filter((c) => c.op === "collect").length, 0);
    assertEquals(await readIntent(dir), intent);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("reconcileSubmitUnknown: Anthropic adopts once ended with an exact item-id match", async () => {
  const dir = await createTempDir("reconcile-anthropic-exact");
  try {
    const state = minimalState({ phase: "submit-unknown" });
    const intent = makeIntent();
    await writeIntent(dir, intent);

    const fake = new FakeBatchProvider("anthropic", {
      candidates: [{
        batchId: "cand-exact",
        createdAt: new Date(intent.writtenAt),
        total: intent.itemIds.length,
        ended: true,
      }],
      collectByCandidate: {
        "cand-exact": [
          { itemId: "item-a", ok: true, raw: {}, httpStatus: 200 },
          { itemId: "item-b", ok: true, raw: {}, httpStatus: 200 },
        ],
      },
    });

    const report = await reconcileSubmitUnknown(dir, state, fake, intent);
    assert(report.adopted !== undefined);
    assertEquals(report.adopted?.handle.batchId, "cand-exact");
    assertEquals(report.adopted?.state, "ended");
    assertEquals(state.activeBatchIds, ["cand-exact"]);
    assertEquals(state.batches.length, 1);
    assertEquals(await readIntent(dir), null);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("reconcileSubmitUnknown: Anthropic refuses a superset, naming the extra item id", async () => {
  const dir = await createTempDir("reconcile-anthropic-superset");
  try {
    const state = minimalState({ phase: "submit-unknown" });
    const intent = makeIntent();
    await writeIntent(dir, intent);

    const fake = new FakeBatchProvider("anthropic", {
      candidates: [{
        batchId: "cand-super",
        createdAt: new Date(intent.writtenAt),
        total: intent.itemIds.length,
        ended: true,
      }],
      collectByCandidate: {
        "cand-super": [
          { itemId: "item-a", ok: true, raw: {}, httpStatus: 200 },
          { itemId: "item-b", ok: true, raw: {}, httpStatus: 200 },
          { itemId: "item-extra", ok: true, raw: {}, httpStatus: 200 },
        ],
      },
    });

    const report = await reconcileSubmitUnknown(dir, state, fake, intent);
    assertEquals(report.adopted, undefined);
    assert(report.reason.includes("item-extra"));
    assertEquals(await readIntent(dir), intent);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("reconcileSubmitUnknown: Anthropic refuses a subset, naming the missing item id", async () => {
  const dir = await createTempDir("reconcile-anthropic-subset");
  try {
    const state = minimalState({ phase: "submit-unknown" });
    const intent = makeIntent();
    await writeIntent(dir, intent);

    const fake = new FakeBatchProvider("anthropic", {
      candidates: [{
        batchId: "cand-sub",
        createdAt: new Date(intent.writtenAt),
        total: intent.itemIds.length,
        ended: true,
      }],
      collectByCandidate: {
        "cand-sub": [
          { itemId: "item-a", ok: true, raw: {}, httpStatus: 200 },
        ],
      },
    });

    const report = await reconcileSubmitUnknown(dir, state, fake, intent);
    assertEquals(report.adopted, undefined);
    assert(report.reason.includes("item-b"));
    assertEquals(await readIntent(dir), intent);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("reconcileSubmitUnknown: opts.adopt on a candidate outside the window is refused", async () => {
  const dir = await createTempDir("reconcile-outside-window");
  try {
    const state = minimalState({ phase: "submit-unknown" });
    const intent = makeIntent({ writtenAt: "2026-09-06T00:20:00.000Z" });
    await writeIntent(dir, intent);
    const since = new Date(Date.parse(intent.writtenAt) - 10 * 60_000);

    const fake = new FakeBatchProvider("anthropic", {
      candidates: [{
        batchId: "cand-stale",
        // Just outside the skew-tolerant window: listCandidates(since)
        // itself filters it out.
        createdAt: new Date(since.getTime() - 60_000),
        total: intent.itemIds.length,
        ended: true,
      }],
    });

    const report = await reconcileSubmitUnknown(dir, state, fake, intent, {
      adopt: "cand-stale",
    });
    assertEquals(report.adopted, undefined);
    assertEquals(report.candidates.length, 0);
    assert(report.reason.includes("cand-stale"));
    assert(report.reason.toLowerCase().includes("window"));
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("reconcileSubmitUnknown: OpenRouter requires the model to match", async () => {
  const dir = await createTempDir("reconcile-openrouter-model");
  try {
    const state = minimalState({
      model: {
        slug: "openrouter/google/gemini-3.8-flash",
        provider: "openrouter",
        apiModelId: "google/gemini-3.8-flash",
      },
      phase: "submit-unknown",
    });
    const intent = makeIntent();
    await writeIntent(dir, intent);

    const fake = new FakeBatchProvider("openrouter", {
      candidates: [{
        batchId: "cand-wrong-model",
        createdAt: new Date(intent.writtenAt),
        total: intent.itemIds.length,
        model: "some/other-model",
        ended: true,
      }],
    });

    const report = await reconcileSubmitUnknown(dir, state, fake, intent);
    assertEquals(report.adopted, undefined);
    assert(report.reason.includes("model"));
    assertEquals(fake.calls.filter((c) => c.op === "collect").length, 0);
    assertEquals(await readIntent(dir), intent);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("reconcileSubmitUnknown: OpenRouter adopts on a matching model and exact item-id set once completed", async () => {
  const dir = await createTempDir("reconcile-openrouter-match");
  try {
    const state = minimalState({
      model: {
        slug: "openrouter/google/gemini-3.8-flash",
        provider: "openrouter",
        apiModelId: "google/gemini-3.8-flash",
      },
      phase: "submit-unknown",
    });
    const intent = makeIntent();
    await writeIntent(dir, intent);

    const fake = new FakeBatchProvider("openrouter", {
      candidates: [{
        batchId: "cand-or",
        createdAt: new Date(intent.writtenAt),
        total: intent.itemIds.length,
        model: "google/gemini-3.8-flash",
        ended: true,
      }],
      collectByCandidate: {
        "cand-or": [
          { itemId: "item-a", ok: true, raw: {}, httpStatus: 200 },
          { itemId: "item-b", ok: true, raw: {}, httpStatus: 200 },
        ],
      },
    });

    const report = await reconcileSubmitUnknown(dir, state, fake, intent);
    assertEquals(report.adopted?.handle.batchId, "cand-or");
    assertEquals(state.activeBatchIds, ["cand-or"]);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("confirmNotSubmitted: returns the run to prepared, clears the intent, and best-effort deletes an OpenAI input file", async () => {
  const dir = await createTempDir("reconcile-confirm-not-submitted");
  try {
    const state = minimalState({
      model: { slug: "openai/gpt-6", provider: "openai", apiModelId: "gpt-6" },
      phase: "submit-unknown",
    });
    const intent = makeIntent({ inputFileId: "file-abc" });
    await writeIntent(dir, intent);

    const fake = new FakeBatchProvider("openai", {});
    const next = await confirmNotSubmitted(dir, state, fake, intent);

    assertEquals(next.phase, "prepared");
    assertEquals(await readIntent(dir), null);
    const cleanupCalls = fake.calls.filter((c) => c.op === "cleanup");
    assertEquals(cleanupCalls.length, 1);
    const handle = cleanupCalls[0]?.args[0] as
      | { extra?: Record<string, string> }
      | undefined;
    assertEquals(handle?.extra?.["inputFileId"], "file-abc");
  } finally {
    await cleanupTempDir(dir);
  }
});
