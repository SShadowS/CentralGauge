/**
 * Cycle step: debug-capture. Tars + zstd-compresses the most recent
 * debug/<session>/ that contains failures for the model under test, uploads
 * to R2, emits debug.captured.
 *
 * @module src/lifecycle/steps/debug-capture-step
 */

import * as colors from "@std/fmt/colors";
import { findLatestSession } from "../../verify/debug-parser.ts";
import { uploadLifecycleBlob } from "../../ingest/r2.ts";
import { loadIngestConfig, readPrivateKey } from "../../ingest/config.ts";
import type { StepContext, StepResult } from "../orchestrator-types.ts";

/**
 * `findSessions` (src/verify/debug-parser.ts) treats sessions as FILES
 * directly under `debugDir` matching `*-session-{sessionId}.jsonl`. List
 * those files for the given session id and return their names.
 */
async function listSessionFiles(
  debugDir: string,
  sessionId: string,
): Promise<string[]> {
  const matches: string[] = [];
  for await (const entry of Deno.readDir(debugDir)) {
    if (!entry.isFile) continue;
    if (!entry.name.endsWith(`-session-${sessionId}.jsonl`)) continue;
    matches.push(entry.name);
  }
  return matches;
}

async function fileCountAndSize(
  debugDir: string,
  sessionFiles: string[],
): Promise<{ file_count: number; total_size_bytes: number }> {
  let total_size_bytes = 0;
  for (const name of sessionFiles) {
    const stat = await Deno.stat(`${debugDir}/${name}`);
    total_size_bytes += stat.size;
  }
  return { file_count: sessionFiles.length, total_size_bytes };
}

/**
 * Run `tar -cf - <files…> | zstd -19 -o <out>` from `cwd=debugDir`. The
 * file list is the set of `*-session-{sessionId}.jsonl` files (sessions
 * are file-per-record in the debug-parser's layout, NOT a subdir).
 */
async function tarAndCompress(
  debugDir: string,
  sessionId: string,
  outPath: string,
  files?: string[],
): Promise<void> {
  const sessionFiles = files ?? await listSessionFiles(debugDir, sessionId);
  if (sessionFiles.length === 0) {
    throw new Error(
      `no session files found for session ${sessionId} under ${debugDir}`,
    );
  }
  // Quote each file individually for the shell. tar | zstd via Git Bash on
  // Windows; native bash on POSIX.
  const fileArgs = sessionFiles.map((f) => `"${f}"`).join(" ");
  const cmd = new Deno.Command("bash", {
    args: [
      "-c",
      `tar -cf - ${fileArgs} | zstd -19 -o "${outPath}"`,
    ],
    cwd: debugDir,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(
      `tar|zstd failed (code ${code}): ${new TextDecoder().decode(stderr)}`,
    );
  }
}

export interface DebugCaptureOptions {
  /** Override session-id selection for tests */
  sessionIdOverride?: string;
  /** Inject a mock upload function for tests */
  uploader?: typeof uploadLifecycleBlob;
  /** Inject a mock compressor for tests */
  compressor?: (
    debugDir: string,
    sessionId: string,
    outPath: string,
  ) => Promise<void>;
}

export async function runDebugCaptureStep(
  ctx: StepContext,
  opts: DebugCaptureOptions = {},
): Promise<StepResult> {
  const debugDir = `${ctx.cwd}/debug`;

  const sessionId = opts.sessionIdOverride ??
    await findLatestSession(debugDir);
  if (!sessionId) {
    // Pre-flight failure: emit `debug.failed` so the failure is visible at the
    // step granularity. The orchestrator additionally records `cycle.failed`
    // with `failed_step: 'debug-capture'`.
    return {
      success: false,
      eventType: "debug.failed",
      payload: {
        error_code: "no_debug_session",
        error_message: `no debug sessions under ${debugDir}`,
      },
    };
  }
  // Sessions are FILES directly under `debugDir` matching
  // `*-session-${sessionId}.jsonl` (per src/verify/debug-parser.ts —
  // `findSessions` regex `session-(\d+)\.jsonl$`). Treating the path
  // as a subdirectory was a layout mismatch that ENOENT'd in production
  // (issue I4). The local_path field on emitted events therefore
  // references `debugDir` (the directory containing the session files),
  // not a synthetic `${debugDir}/${sessionId}` subdir that doesn't exist.
  const sessionFiles = await listSessionFiles(debugDir, sessionId);
  if (sessionFiles.length === 0) {
    return {
      success: false,
      eventType: "debug.failed",
      payload: {
        error_code: "no_debug_session",
        error_message:
          `no session files matching *-session-${sessionId}.jsonl under ${debugDir}`,
      },
    };
  }
  const localPath = debugDir;
  const { file_count, total_size_bytes } = await fileCountAndSize(
    debugDir,
    sessionFiles,
  );

  if (ctx.dryRun) {
    console.log(
      colors.yellow(
        `[DRY] debug-capture: would tar + upload ${file_count} session files for ${sessionId} (${total_size_bytes} bytes) under ${debugDir}`,
      ),
    );
    // Dry-run: no upload, no event write. The orchestrator short-circuits
    // dispatch in dry-run mode; this branch only runs when the step is
    // invoked directly from a unit test. We return `debug.skipped` so
    // callers that DO write the event get a canonical type.
    return {
      success: true,
      eventType: "debug.skipped",
      payload: {
        reason: "dry_run",
        session_id: sessionId,
        local_path: localPath,
        file_count,
        total_size_bytes,
        r2_key: `lifecycle/debug/${ctx.modelSlug}/${sessionId}.tar.zst`,
        r2_prefix: `lifecycle/debug/${ctx.modelSlug}`,
      },
    };
  }

  const tmpFile = await Deno.makeTempFile({
    prefix: `lifecycle-debug-${sessionId}-`,
    suffix: ".tar.zst",
  });
  try {
    const compress = opts.compressor ??
      ((d, s, o) => tarAndCompress(d, s, o, sessionFiles));
    await compress(debugDir, sessionId, tmpFile);
    const body = await Deno.readFile(tmpFile);

    const config = await loadIngestConfig(ctx.cwd, {});
    // Lifecycle blob writes target an admin endpoint
    // (/api/v1/admin/lifecycle/r2/<key>); the verifier-scope ingest key
    // CANNOT satisfy admin signature verification. No fallback — fail fast.
    if (!config.adminKeyPath || config.adminKeyId == null) {
      throw new Error(
        "admin_key_path required for cycle command — configure ~/.centralgauge.yml",
      );
    }
    const keyPath = config.adminKeyPath;
    const keyId = config.adminKeyId;
    const privKey = await readPrivateKey(keyPath);

    const r2Key = `lifecycle/debug/${ctx.modelSlug}/${sessionId}.tar.zst`;
    const upload = opts.uploader ?? uploadLifecycleBlob;
    const result = await upload(
      config.url,
      r2Key,
      body,
      privKey,
      keyId,
    );
    return {
      success: true,
      eventType: "debug.captured",
      payload: {
        session_id: sessionId,
        local_path: localPath,
        file_count,
        total_size_bytes,
        r2_key: result.r2_key,
        r2_prefix: result.r2_prefix,
        compressed_size_bytes: result.compressed_size_bytes,
      },
    };
  } finally {
    try {
      await Deno.remove(tmpFile);
    } catch { /* ignore */ }
  }
}
