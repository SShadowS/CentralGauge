import { assertEquals } from "@std/assert";
import { runPublishStep } from "../../../../src/lifecycle/steps/publish-step.ts";
import { cleanupTempDir, createTempDir } from "../../../utils/test-helpers.ts";

async function setupCwd(tmp: string, fileName: string): Promise<void> {
  const fakeKeyAbs = `${tmp}/fake.key`;
  await Deno.writeTextFile(
    `${tmp}/.centralgauge.yml`,
    [
      "ingest:",
      "  url: https://example.test",
      `  key_path: ${fakeKeyAbs}`,
      "  key_id: 1",
      // Lifecycle writes require admin scope — populate the admin keypair
      // even in tests; the publish step throws if it is absent.
      `  admin_key_path: ${fakeKeyAbs}`,
      "  admin_key_id: 1",
      "  machine_id: testmachine",
    ].join("\n"),
  );
  await Deno.writeFile(fakeKeyAbs, new Uint8Array(32));
  await Deno.mkdir(`${tmp}/model-shortcomings`, { recursive: true });
  await Deno.writeTextFile(
    `${tmp}/model-shortcomings/${fileName}`,
    JSON.stringify({
      model: "anthropic/claude-opus-4-7",
      lastUpdated: "2026-04-29T00:00:00Z",
      shortcomings: [
        {
          concept: "x",
          alConcept: "Tables",
          description: "y",
          correctPattern: "ok",
          incorrectPattern: "bad",
          errorCodes: [],
          affectedTasks: ["CG-AL-E001"],
          firstSeen: "2026-04-29T00:00:00Z",
          occurrences: 1,
        },
      ],
    }),
  );
}

Deno.test("publish posts and returns publish.completed with response counts", async () => {
  const tmp = await createTempDir("cycle-publish");
  try {
    await setupCwd(tmp, "anthropic_claude-opus-4-7.json");
    const fakeFetch: typeof fetch = (_url, _init) =>
      Promise.resolve(
        new Response(
          JSON.stringify({ upserted: 1, occurrences: 0 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const result = await runPublishStep(
      {
        modelSlug: "anthropic/claude-opus-4-7",
        taskSetHash: "current",
        lockToken: "tok-1",
        envelope: {},
        toolVersions: {},
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        cwd: tmp,
      },
      { fetchFn: fakeFetch },
    );
    assertEquals(result.success, true);
    assertEquals(result.eventType, "publish.completed");
    assertEquals(result.payload["upserted"], 1);
    assertEquals(result.payload["occurrences"], 0);
  } finally {
    await cleanupTempDir(tmp);
  }
});

Deno.test("publish skips when prior payload_hash matches", async () => {
  const tmp = await createTempDir("cycle-publish-skip");
  try {
    await setupCwd(tmp, "anthropic_claude-opus-4-7.json");
    // First call to discover the canonical hash.
    const probe: typeof fetch = (_u, _init) =>
      Promise.resolve(
        new Response(JSON.stringify({ upserted: 0, occurrences: 0 }), {
          status: 200,
        }),
      );
    const first = await runPublishStep(
      {
        modelSlug: "anthropic/claude-opus-4-7",
        taskSetHash: "current",
        lockToken: "tok-1",
        envelope: {},
        toolVersions: {},
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        cwd: tmp,
      },
      { fetchFn: probe },
    );
    assertEquals(first.success, true);
    const hash = first.payload["payload_hash"] as string;
    // Second call with the same hash + a prior event id → skipped.
    const result = await runPublishStep(
      {
        modelSlug: "anthropic/claude-opus-4-7",
        taskSetHash: "current",
        lockToken: "tok-1",
        envelope: {},
        toolVersions: {},
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        cwd: tmp,
      },
      {
        priorAnalysisPayloadHash: hash,
        priorPublishEventId: 99,
      },
    );
    assertEquals(result.eventType, "publish.skipped");
    assertEquals(result.payload["reason"], "payload_unchanged");
    assertEquals(result.payload["prior_event_id"], 99);
  } finally {
    await cleanupTempDir(tmp);
  }
});

Deno.test("publish dry-run returns publish.skipped{reason:'dry_run'}", async () => {
  const tmp = await createTempDir("cycle-publish-dry");
  try {
    await setupCwd(tmp, "anthropic_claude-opus-4-7.json");
    const result = await runPublishStep({
      modelSlug: "anthropic/claude-opus-4-7",
      taskSetHash: "current",
      lockToken: "tok-1",
      envelope: {},
      toolVersions: {},
      analyzerModel: "anthropic/claude-opus-4-6",
      dryRun: true,
      cwd: tmp,
    });
    assertEquals(result.success, true);
    assertEquals(result.eventType, "publish.skipped");
    assertEquals(result.payload["reason"], "dry_run");
    assertEquals(result.payload["entries_count"], 1);
  } finally {
    await cleanupTempDir(tmp);
  }
});

Deno.test("publish returns publish.failed on non-2xx", async () => {
  const tmp = await createTempDir("cycle-publish-500");
  try {
    await setupCwd(tmp, "anthropic_claude-opus-4-7.json");
    const fakeFetch: typeof fetch = (_url, _init) =>
      Promise.resolve(
        new Response("internal error", {
          status: 500,
        }),
      );
    const result = await runPublishStep(
      {
        modelSlug: "anthropic/claude-opus-4-7",
        taskSetHash: "current",
        lockToken: "tok-1",
        envelope: {},
        toolVersions: {},
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        cwd: tmp,
      },
      { fetchFn: fakeFetch },
    );
    assertEquals(result.success, false);
    assertEquals(result.eventType, "publish.failed");
    assertEquals(result.payload["http_status"], 500);
    assertEquals(result.payload["error_code"], "http_non_2xx");
  } finally {
    await cleanupTempDir(tmp);
  }
});

async function setupCwdWithEntries(
  tmp: string,
  entries: unknown[],
): Promise<void> {
  const fakeKeyAbs = `${tmp}/fake.key`;
  await Deno.writeTextFile(
    `${tmp}/.centralgauge.yml`,
    [
      "ingest:",
      "  url: https://example.test",
      `  key_path: ${fakeKeyAbs}`,
      "  key_id: 1",
      `  admin_key_path: ${fakeKeyAbs}`,
      "  admin_key_id: 1",
      "  machine_id: testmachine",
    ].join("\n"),
  );
  await Deno.writeFile(fakeKeyAbs, new Uint8Array(32));
  await Deno.mkdir(`${tmp}/model-shortcomings`, { recursive: true });
  await Deno.writeTextFile(
    `${tmp}/model-shortcomings/anthropic_claude-opus-4-7.json`,
    JSON.stringify({
      model: "anthropic/claude-opus-4-7",
      lastUpdated: "2026-04-29T00:00:00Z",
      shortcomings: entries,
    }),
  );
}

function mkEntry(alConcept: string, confidence: number) {
  return {
    concept: alConcept,
    alConcept,
    description: "d",
    correctPattern: "ok",
    incorrectPattern: "bad",
    errorCodes: [],
    affectedTasks: ["CG-AL-E001"],
    firstSeen: "2026-04-29T00:00:00Z",
    occurrences: 1,
    confidence,
    concept_slug_proposed: alConcept,
    concept_slug_existing_match: null,
    similarity_score: null,
  };
}

Deno.test("publish holds sub-threshold entries out of the batch (V1 gate)", async () => {
  const tmp = await createTempDir("cycle-publish-gate");
  try {
    // high 0.9 → final min(0.9,0.7)=0.7 (publish); low 0.3 → 0.3 (held).
    await setupCwdWithEntries(tmp, [
      mkEntry("high-concept", 0.9),
      mkEntry("low-concept", 0.3),
    ]);
    const postedConcepts: string[] = [];
    const fakeFetch: typeof fetch = (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        payload: { shortcomings: Array<{ al_concept: string }> };
      };
      for (const s of body.payload.shortcomings) {
        postedConcepts.push(s.al_concept);
      }
      return Promise.resolve(
        new Response(JSON.stringify({ upserted: 1, occurrences: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };
    const result = await runPublishStep(
      {
        modelSlug: "anthropic/claude-opus-4-7",
        taskSetHash: "current",
        lockToken: "tok-1",
        envelope: {},
        toolVersions: {},
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        cwd: tmp,
        confidenceThreshold: 0.7,
        crossLlmSampleRate: 0,
      },
      { fetchFn: fakeFetch },
    );
    assertEquals(result.success, true);
    assertEquals(result.payload["entries_count"], 1);
    // Only the above-threshold concept was posted; the held one never was.
    assertEquals(postedConcepts, ["high-concept"]);
  } finally {
    await cleanupTempDir(tmp);
  }
});

// V1 / decide reconciliation: an accepted (held) entry that the decide
// endpoint inserts server-side must NOT be re-posted by a later publish run.
// Because held entries are excluded from every publish batch, the decide
// insert is never duplicated.
Deno.test("publish never re-posts a held-then-accepted entry (no duplicate)", async () => {
  const tmp = await createTempDir("cycle-publish-nodup");
  try {
    await setupCwdWithEntries(tmp, [
      mkEntry("published-concept", 0.9),
      mkEntry("accepted-concept", 0.3), // held, later accepted via decide
    ]);
    const postedConcepts: string[] = [];
    const fakeFetch: typeof fetch = (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        payload: { shortcomings: Array<{ al_concept: string }> };
      };
      for (const s of body.payload.shortcomings) {
        postedConcepts.push(s.al_concept);
      }
      return Promise.resolve(
        new Response(JSON.stringify({ upserted: 1, occurrences: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };
    const ctx = {
      modelSlug: "anthropic/claude-opus-4-7",
      taskSetHash: "current",
      lockToken: "tok-1",
      envelope: {},
      toolVersions: {},
      analyzerModel: "anthropic/claude-opus-4-6",
      dryRun: false,
      cwd: tmp,
      confidenceThreshold: 0.7,
      crossLlmSampleRate: 0,
    };
    // Two publish runs (e.g. before + after the operator accepts the held
    // entry). The held concept must never be posted by either run.
    await runPublishStep(ctx, { fetchFn: fakeFetch });
    await runPublishStep(ctx, { fetchFn: fakeFetch });
    assertEquals(postedConcepts.includes("accepted-concept"), false);
    assertEquals(postedConcepts, ["published-concept", "published-concept"]);
  } finally {
    await cleanupTempDir(tmp);
  }
});

Deno.test("publish returns publish.failed when input file is missing", async () => {
  const tmp = await createTempDir("cycle-publish-noin");
  try {
    const result = await runPublishStep({
      modelSlug: "anthropic/claude-opus-4-7",
      taskSetHash: "current",
      lockToken: "tok-1",
      envelope: {},
      toolVersions: {},
      analyzerModel: "anthropic/claude-opus-4-6",
      dryRun: false,
      cwd: tmp,
    });
    assertEquals(result.success, false);
    assertEquals(result.eventType, "publish.failed");
    assertEquals(result.payload["error_code"], "input_unreadable");
  } finally {
    await cleanupTempDir(tmp);
  }
});
