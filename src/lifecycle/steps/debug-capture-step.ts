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

async function fileCountAndSize(
  dir: string,
): Promise<{ file_count: number; total_size_bytes: number }> {
  let file_count = 0;
  let total_size_bytes = 0;
  async function walk(p: string): Promise<void> {
    for await (const entry of Deno.readDir(p)) {
      const full = `${p}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(full);
      } else if (entry.isFile) {
        file_count++;
        const stat = await Deno.stat(full);
        total_size_bytes += stat.size;
      }
    }
  }
  await walk(dir);
  return { file_count, total_size_bytes };
}

/** Run `tar -cf - <session> | zstd -19 -o <out>` from cwd=debugDir */
async function tarAndCompress(
  debugDir: string,
  sessionId: string,
  outPath: string,
): Promise<void> {
  // tar | zstd via shell pipe. On Windows, Git Bash provides both.
  const cmd = new Deno.Command("bash", {
    args: [
      "-c",
      `tar -cf - "${sessionId}" | zstd -19 -o "${outPath}"`,
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
    // The Event types appendix has no `debug.failed`. Step modules NEVER emit
    // non-canonical event types. Return an empty `eventType` and let the
    // orchestrator translate this failure into `cycle.failed{ failed_step:
    // 'debug-capture', error_code, error_message }`.
    return {
      success: false,
      eventType: "",
      payload: {
        error_code: "no_debug_session",
        error_message: `no debug sessions under ${debugDir}`,
      },
    };
  }
  const sessionDir = `${debugDir}/${sessionId}`;
  const { file_count, total_size_bytes } = await fileCountAndSize(sessionDir);

  if (ctx.dryRun) {
    console.log(
      colors.yellow(
        `[DRY] debug-capture: would tar + upload ${sessionDir} (${file_count} files, ${total_size_bytes} bytes)`,
      ),
    );
    // The appendix has no `debug.skipped` event type. Return an empty
    // eventType; the orchestrator already short-circuits dispatch in
    // dry-run mode, so this branch only fires when invoked directly from
    // a unit test.
    return {
      success: true,
      eventType: "",
      payload: {
        dry_run: true,
        session_id: sessionId,
        local_path: sessionDir,
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
    const compress = opts.compressor ?? tarAndCompress;
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
        local_path: sessionDir,
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
