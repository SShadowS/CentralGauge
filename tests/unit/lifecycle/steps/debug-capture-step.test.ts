import { assertEquals } from "@std/assert";
import { runDebugCaptureStep } from "../../../../src/lifecycle/steps/debug-capture-step.ts";
import { cleanupTempDir, createTempDir } from "../../../utils/test-helpers.ts";

Deno.test("debug-capture dry-run reports session metadata without upload", async () => {
  const tmp = await createTempDir("cycle-debug-capture-dry");
  try {
    // I4 — sessions are FILES directly under debug/, NOT subdirectories.
    // Filenames: `${kind}-${provider}-${ts}-session-${sessionId}.jsonl`
    // where `kind` is `compilation` or `tests` (matches findSessions in
    // src/verify/debug-parser.ts).
    const sessionId = "1765986258980";
    await Deno.mkdir(`${tmp}/debug`, { recursive: true });
    await Deno.writeTextFile(
      `${tmp}/debug/compilation-anthropic-2026-04-29T00-00-00-000Z-session-${sessionId}.jsonl`,
      '{"type":"compilation_result","success":false,"taskId":"x","model":"y","attempt":1,"errors":[]}\n',
    );
    await Deno.writeTextFile(
      `${tmp}/debug/tests-anthropic-2026-04-29T00-00-00-000Z-session-${sessionId}.jsonl`,
      '{"type":"test_result","success":false,"taskId":"x","model":"y","attempt":1,"results":[]}\n',
    );

    const result = await runDebugCaptureStep(
      {
        modelSlug: "anthropic/claude-opus-4-7",
        taskSetHash: "current",
        lockToken: "tok-1",
        envelope: {},
        toolVersions: {},
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: true,
        cwd: tmp,
      },
      { sessionIdOverride: sessionId },
    );
    assertEquals(result.success, true);
    // Dry-run path returns canonical `debug.skipped` (added in C1).
    assertEquals(result.eventType, "debug.skipped");
    assertEquals(result.payload["reason"], "dry_run");
    assertEquals(result.payload["session_id"], sessionId);
    // Two session files (compilation + tests) should be detected.
    assertEquals(result.payload["file_count"], 2);
    assertEquals(
      result.payload["r2_key"],
      `lifecycle/debug/anthropic/claude-opus-4-7/${sessionId}.tar.zst`,
    );
  } finally {
    await cleanupTempDir(tmp);
  }
});

Deno.test("debug-capture invokes injected uploader with expected r2_key", async () => {
  const tmp = await createTempDir("cycle-debug-capture-up");
  try {
    // Sessions are FILES directly under debug/ (matches findSessions).
    const sessionId = "1765986258980";
    await Deno.mkdir(`${tmp}/debug`, { recursive: true });
    await Deno.writeTextFile(
      `${tmp}/debug/compilation-anthropic-2026-04-29T00-00-00-000Z-session-${sessionId}.jsonl`,
      "hi",
    );
    // Stand up minimal .centralgauge.yml with admin keypair so
    // loadIngestConfig satisfies the lifecycle admin-scope requirement.
    // Use absolute key paths because loadIngestConfig resolves relative
    // paths against the *process* cwd, not the cwd we pass in.
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
    let capturedKey = "";
    const result = await runDebugCaptureStep(
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
        sessionIdOverride: sessionId,
        compressor: async (_d, _s, out) => {
          await Deno.writeFile(
            out,
            new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]),
          );
        },
        uploader: (_url, key, body, _pk, _kid) => {
          capturedKey = key;
          return Promise.resolve({
            r2_key: key,
            r2_prefix: key.substring(0, key.lastIndexOf("/")),
            compressed_size_bytes: body.byteLength,
          });
        },
      },
    );
    assertEquals(result.success, true);
    assertEquals(
      capturedKey,
      `lifecycle/debug/anthropic/claude-opus-4-7/${sessionId}.tar.zst`,
    );
    assertEquals(result.payload["compressed_size_bytes"], 4);
  } finally {
    await cleanupTempDir(tmp);
  }
});

Deno.test("debug-capture honors ctx.debugDir override (off-cwd path)", async () => {
  const cwdTmp = await createTempDir("cycle-debug-capture-cwd");
  const externalTmp = await createTempDir("cycle-debug-capture-external");
  try {
    const sessionId = "1700000000001";
    // Sessions live under externalTmp, NOT cwdTmp/debug. The override must
    // route the step at externalTmp directly.
    await Deno.writeTextFile(
      `${externalTmp}/compilation-anthropic-2026-05-05T00-00-00-000Z-session-${sessionId}.jsonl`,
      '{"type":"compilation_result","success":false,"taskId":"x","model":"y","attempt":1,"errors":[]}\n',
    );

    const result = await runDebugCaptureStep(
      {
        modelSlug: "anthropic/claude-opus-4-7",
        taskSetHash: "current",
        lockToken: "tok-1",
        envelope: {},
        toolVersions: {},
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: true,
        cwd: cwdTmp,
        debugDir: externalTmp,
      },
      { sessionIdOverride: sessionId },
    );
    assertEquals(result.success, true);
    assertEquals(result.eventType, "debug.skipped");
    assertEquals(result.payload["session_id"], sessionId);
    assertEquals(result.payload["file_count"], 1);
  } finally {
    await cleanupTempDir(cwdTmp);
    await cleanupTempDir(externalTmp);
  }
});

Deno.test("debug-capture returns no_debug_session when debug dir empty", async () => {
  const tmp = await createTempDir("cycle-debug-capture-empty");
  try {
    await Deno.mkdir(`${tmp}/debug`, { recursive: true });
    const result = await runDebugCaptureStep({
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
    // Pre-flight failure now emits canonical `debug.failed` (added in C1).
    assertEquals(result.eventType, "debug.failed");
    assertEquals(result.payload["error_code"], "no_debug_session");
  } finally {
    await cleanupTempDir(tmp);
  }
});
