/**
 * Cycle step: analyze. Invokes `centralgauge verify --shortcomings-only` and
 * captures + validates the resulting JSON.
 *
 * The verify command's existing `--model <slug>` flag specifies the analyzer
 * LLM (the plan's `--analyzer-model` rename is not yet landed; this step
 * forwards `ctx.analyzerModel` via `--model` to keep parity with the
 * existing CLI surface).
 *
 * @module src/lifecycle/steps/analyze-step
 */

import * as colors from "@std/fmt/colors";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { canonicalJSON } from "../../ingest/canonical.ts";
import {
  type AnalyzerOutput,
  ModelShortcomingsFileSchema,
} from "../analyzer-schema.ts";
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_CROSS_LLM_SAMPLE_RATE,
  scoreShortcomingsFile,
} from "../confidence-gate.ts";
import type { StepContext, StepResult } from "../orchestrator-types.ts";

/** slug → filesystem-safe filename (matches verify's sanitisation rule: '/' → '_'). */
function slugToFile(slug: string): string {
  return slug.replaceAll("/", "_") + ".json";
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return encodeHex(new Uint8Array(digest));
}

export interface AnalyzeOptions {
  verifyCmd?: string[];
  /** Pre-write a fixture JSON instead of running verify; tests use this */
  fixtureJson?: AnalyzerOutput;
}

export async function runAnalyzeStep(
  ctx: StepContext,
  opts: AnalyzeOptions = {},
): Promise<StepResult> {
  const shortcomingsDir = `${ctx.cwd}/model-shortcomings`;
  const outFile = `${shortcomingsDir}/${slugToFile(ctx.modelSlug)}`;

  if (ctx.dryRun) {
    console.log(
      colors.yellow(
        `[DRY] analyze: would run \`centralgauge verify --shortcomings-only --model ${ctx.analyzerModel}\``,
      ),
    );
    // Dry-run: no LLM call, no file write. The orchestrator short-circuits
    // dispatch in dry-run mode; this branch only runs when the step is
    // invoked directly from a unit test. Return `analysis.skipped` so
    // callers that DO write the event get a canonical type.
    return {
      success: true,
      eventType: "analysis.skipped",
      payload: { reason: "dry_run", analyzer_model: ctx.analyzerModel },
    };
  }

  // Skip verify when a recent slug-form JSON file already exists. This is the
  // recovery path for an earlier analyze run that produced valid JSON but
  // crashed downstream (publish failed, file path mismatch, etc.) — re-running
  // verify costs analyzer-LLM tokens for no new signal. Tests pass via
  // `opts.fixtureJson`; this branch only fires for production reruns.
  let skipVerify = false;
  if (!opts.fixtureJson) {
    try {
      await Deno.stat(outFile);
      skipVerify = true;
    } catch { /* file missing — fall through and run verify */ }
  }

  if (opts.fixtureJson) {
    await Deno.mkdir(shortcomingsDir, { recursive: true });
    await Deno.writeTextFile(outFile, JSON.stringify(opts.fixtureJson));
  } else if (skipVerify) {
    console.log(
      colors.gray(
        `[SKIP] verify: ${outFile} already present (reusing prior analyze output)`,
      ),
    );
  } else {
    // The orchestrator emits analysis.started before invoking this step.
    // Pass through ctx.debugDir so the analyzer reads the SAME bundle the
    // debug-capture step uploaded — otherwise verify falls back to <cwd>/debug
    // and crunches whatever stale sessions happen to be there.
    const debugDirArg = ctx.debugDir ?? "debug/";
    // Pass --session when the orchestrator pinned a specific session id —
    // otherwise verify falls back to `findLatestSession` and may analyze a
    // session unrelated to the bench model under cycle (e.g., a concurrent
    // bench against a different provider produced a newer sessionId).
    const sessionArgs = ctx.sessionId ? ["--session", ctx.sessionId] : [];
    const cmdArgs = opts.verifyCmd ?? [
      "deno",
      "task",
      "start",
      "verify",
      debugDirArg,
      "--shortcomings-only",
      "--model",
      ctx.analyzerModel,
      ...sessionArgs,
    ];
    const cmd = new Deno.Command(cmdArgs[0]!, {
      args: cmdArgs.slice(1),
      cwd: ctx.cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await cmd.output();
    const so = new TextDecoder().decode(stdout);
    const se = new TextDecoder().decode(stderr);
    if (so) console.log(so);
    if (se) console.error(se);
    if (code !== 0) {
      return {
        success: false,
        eventType: "analysis.failed",
        payload: {
          error_code: "verify_nonzero_exit",
          error_message: `verify exited with code ${code}`,
        },
      };
    }
  }

  // Verify writes the JSON keyed on the failure record's `model` field, which
  // is the bare api_model_id (e.g. `claude-opus-4-6.json`) for direct
  // providers — NOT the vendor-prefixed slug (`anthropic_claude-opus-4-6.json`)
  // the cycle uses everywhere else. If the slug-form file is missing but a
  // bare-api-id file exists (slug minus `<vendor>/`), rename to the slug-form
  // so this step + publish read a single canonical name.
  try {
    await Deno.stat(outFile);
  } catch {
    const slashIdx = ctx.modelSlug.indexOf("/");
    if (slashIdx >= 0) {
      const bareId = ctx.modelSlug.slice(slashIdx + 1).replaceAll("/", "_");
      const fallback = `${shortcomingsDir}/${bareId}.json`;
      try {
        await Deno.stat(fallback);
        await Deno.rename(fallback, outFile);
      } catch { /* fallback also missing — let the next read throw */ }
    }
  }

  let parsed: AnalyzerOutput;
  try {
    const text = await Deno.readTextFile(outFile);
    const json = JSON.parse(text);
    parsed = ModelShortcomingsFileSchema.parse(json);
  } catch (e) {
    return {
      success: false,
      eventType: "analysis.failed",
      payload: {
        error_code: "schema_validation_failed",
        error_message: e instanceof Error ? e.message : String(e),
      },
    };
  }

  const normalized = canonicalJSON(
    parsed as unknown as Record<string, unknown>,
  );
  const payloadHash = await sha256Hex(normalized);

  // Confidence gate (finding V1). `finalConfidence = min(mappedAnalyzer
  // confidence, persisted-entry score)` per entry. The threshold is read from
  // ctx config (default 0.7) — the hardcoded const that floored the gate is
  // gone. The persisted-entry scorer's cluster check uses the file's own
  // proposed slugs as the "known" set (this analysis batch is internally
  // consistent); no cross-LLM runner is wired here, so its vote stays neutral.
  const threshold = ctx.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const crossLlmSampleRate = ctx.crossLlmSampleRate ??
    DEFAULT_CROSS_LLM_SAMPLE_RATE;
  const scored = await scoreShortcomingsFile(parsed.shortcomings, {
    threshold,
    crossLlmSampleRate,
  });

  // Legacy files predating finding V2 omit numeric confidence. We keep the
  // `?? 1` auto-publish behavior (so a re-run doesn't suddenly hold every old
  // entry for review) but LOG + COUNT them so an operator can force
  // re-analysis.
  const legacyNoConfidenceCount = scored.filter((s) => s.isLegacy).length;
  if (legacyNoConfidenceCount > 0) {
    console.warn(
      colors.yellow(
        `[WARN] analyze: ${legacyNoConfidenceCount} shortcoming(s) have no numeric confidence (legacy pre-V2 file) — treated as auto-publish (1.0). Force re-analysis to gate them.`,
      ),
    );
  }

  const minConfidence = scored.length > 0
    ? Math.min(...scored.map((s) => s.finalConfidence))
    : 1;
  const pending = scored.filter((s) => s.finalConfidence < threshold);
  const parseFailures = parsed.parse_failures ?? 0;

  return {
    success: true,
    eventType: "analysis.completed",
    payload: {
      analyzer_model: ctx.analyzerModel,
      entries_count: parsed.shortcomings.length,
      min_confidence: minConfidence,
      confidence_threshold: threshold,
      parse_failures: parseFailures,
      legacy_no_confidence_count: legacyNoConfidenceCount,
      payload_hash: payloadHash,
      pending_review_count: pending.length,
      // Canonical pending-review payload shape (`{ entry, confidence }`, see
      // src/lifecycle/pending-review.ts) so the orchestrator can forward each
      // verbatim to the enqueue endpoint — and re-read + re-POST them on a
      // resume where analyze is skipped.
      pending_review_entries: pending.map((p) => ({
        concept_slug_proposed: p.entry.concept_slug_proposed,
        confidence: p.confidenceResult,
        entry: p.entry,
      })),
    },
  };
}
