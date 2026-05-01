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

/** Below this confidence the analyzer entry is staged for human review. */
const CONFIDENCE_THRESHOLD = 0.7;

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
    // The appendix has no `analysis.skipped` or `analysis.dry_run` event
    // type. Return an empty eventType — the orchestrator already
    // short-circuits dispatch in dry-run mode, so this branch is only
    // reached by direct unit-test invocation.
    return {
      success: true,
      eventType: "",
      payload: { dry_run: true, analyzer_model: ctx.analyzerModel },
    };
  }

  if (opts.fixtureJson) {
    await Deno.mkdir(shortcomingsDir, { recursive: true });
    await Deno.writeTextFile(outFile, JSON.stringify(opts.fixtureJson));
  } else {
    // The orchestrator emits analysis.started before invoking this step.
    const cmdArgs = opts.verifyCmd ?? [
      "deno",
      "task",
      "start",
      "verify",
      "debug/",
      "--shortcomings-only",
      "--model",
      ctx.analyzerModel,
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
  const confidences = parsed.shortcomings
    .map((s) => s.confidence ?? 1)
    .filter((c) => Number.isFinite(c));
  const minConfidence = confidences.length > 0 ? Math.min(...confidences) : 1;

  // Identify below-threshold entries for pending_review (Phase F UI).
  const pending = parsed.shortcomings.filter(
    (s) => (s.confidence ?? 1) < CONFIDENCE_THRESHOLD,
  );

  return {
    success: true,
    eventType: "analysis.completed",
    payload: {
      analyzer_model: ctx.analyzerModel,
      entries_count: parsed.shortcomings.length,
      min_confidence: minConfidence,
      payload_hash: payloadHash,
      pending_review_count: pending.length,
      pending_review_entries: pending.map((p) => ({
        concept_slug_proposed: p.concept_slug_proposed ?? p.concept,
        confidence: p.confidence ?? 1,
        payload: p,
      })),
    },
  };
}
