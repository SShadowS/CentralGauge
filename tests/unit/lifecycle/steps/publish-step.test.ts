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
