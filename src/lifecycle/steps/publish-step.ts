/**
 * Cycle step: publish. Reads model-shortcomings JSON, builds the batch
 * payload, signed-POSTs to /api/v1/shortcomings/batch, emits publish.*.
 *
 * Idempotency: when the prior `analysis.completed.payload_hash` matches the
 * canonical hash of the freshly-built batch payload AND a prior
 * `publish.completed` exists, the step emits `publish.skipped{
 * reason: 'payload_unchanged' }` instead of re-POSTing.
 *
 * @module src/lifecycle/steps/publish-step
 */

import * as colors from "@std/fmt/colors";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { canonicalJSON } from "../../ingest/canonical.ts";
import { loadIngestConfig, readPrivateKey } from "../../ingest/config.ts";
import { signPayload } from "../../ingest/sign.ts";
import { postWithRetry } from "../../ingest/client.ts";
import {
  type AnalyzerOutput,
  ModelShortcomingsFileSchema,
} from "../analyzer-schema.ts";
import type { StepContext, StepResult } from "../orchestrator-types.ts";

function slugToFile(slug: string): string {
  return slug.replaceAll("/", "_") + ".json";
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return encodeHex(new Uint8Array(digest));
}

interface BatchPayload {
  model_slug: string;
  shortcomings: Array<{
    al_concept: string;
    concept: string;
    concept_slug_proposed?: string;
    description: string;
    correct_pattern: string;
    incorrect_pattern_sha256: string;
    error_codes: string[];
    occurrences: Array<{
      result_id: number;
      task_id: string;
      error_code: string | null;
    }>;
  }>;
}

async function buildPayload(file: AnalyzerOutput): Promise<BatchPayload> {
  const out: BatchPayload = {
    model_slug: file.model,
    shortcomings: [],
  };
  for (const entry of file.shortcomings) {
    if (!entry.correctPattern || !entry.incorrectPattern) continue;
    const sc: BatchPayload["shortcomings"][number] = {
      al_concept: entry.alConcept,
      concept: entry.concept,
      description: entry.description,
      correct_pattern: entry.correctPattern,
      incorrect_pattern_sha256: await sha256Hex(entry.incorrectPattern),
      error_codes: entry.errorCodes,
      // Occurrences resolved server-side from result_id JOIN; cycle does not
      // pre-resolve them. The endpoint accepts empty arrays per Plan D-prompt.
      occurrences: [],
    };
    if (entry.concept_slug_proposed) {
      sc.concept_slug_proposed = entry.concept_slug_proposed;
    }
    out.shortcomings.push(sc);
  }
  return out;
}

export interface PublishOptions {
  /** Inject for tests */
  fetchFn?: typeof fetch;
  /** Pass the prior analysis.completed payload_hash for idempotency */
  priorAnalysisPayloadHash?: string;
  /** Pass the prior publish.completed event id (for skipped event) */
  priorPublishEventId?: number;
}

export async function runPublishStep(
  ctx: StepContext,
  opts: PublishOptions = {},
): Promise<StepResult> {
  const shortcomingsDir = `${ctx.cwd}/model-shortcomings`;
  const inFile = `${shortcomingsDir}/${slugToFile(ctx.modelSlug)}`;

  let parsed: AnalyzerOutput;
  try {
    const text = await Deno.readTextFile(inFile);
    parsed = ModelShortcomingsFileSchema.parse(JSON.parse(text));
  } catch (e) {
    return {
      success: false,
      eventType: "publish.failed",
      payload: {
        error_code: "input_unreadable",
        http_status: 0,
        error_message: e instanceof Error ? e.message : String(e),
      },
    };
  }

  const payload = await buildPayload(parsed);
  const canonical = canonicalJSON(
    payload as unknown as Record<string, unknown>,
  );
  const payloadHash = await sha256Hex(canonical);

  // Idempotency: prefer explicit `opts.*` (test injection) over `ctx.*`
  // (set by the orchestrator from prior lifecycle events). Production
  // cycles always populate via ctx — opts is the test-only escape hatch.
  const priorAnalysisHash = opts.priorAnalysisPayloadHash ??
    ctx.priorAnalysisPayloadHash;
  const priorPublishEvId = opts.priorPublishEventId ??
    ctx.priorPublishEventId;

  if (
    priorAnalysisHash &&
    priorAnalysisHash === payloadHash &&
    priorPublishEvId
  ) {
    return {
      success: true,
      eventType: "publish.skipped",
      payload: {
        reason: "payload_unchanged",
        prior_event_id: priorPublishEvId,
        payload_hash: payloadHash,
      },
    };
  }

  if (ctx.dryRun) {
    console.log(
      colors.yellow(
        `[DRY] publish: would POST ${payload.shortcomings.length} shortcomings (hash ${payloadHash}) to /api/v1/shortcomings/batch`,
      ),
    );
    return {
      success: true,
      eventType: "publish.skipped",
      payload: {
        reason: "dry_run",
        payload_hash: payloadHash,
        entries_count: payload.shortcomings.length,
      },
    };
  }

  const config = await loadIngestConfig(ctx.cwd, {});
  // Lifecycle publish writes lifecycle events; signature must be verified
  // against an admin keypair. No fallback to verifier-scope ingest keys.
  if (!config.adminKeyPath || config.adminKeyId == null) {
    throw new Error(
      "admin_key_path required for cycle command — configure ~/.centralgauge.yml",
    );
  }
  const keyPath = config.adminKeyPath;
  const keyId = config.adminKeyId;
  const privKey = await readPrivateKey(keyPath);
  const signature = await signPayload(
    payload as unknown as Record<string, unknown>,
    privKey,
    keyId,
  );
  const body = { payload, signature };

  const resp = await postWithRetry(
    `${config.url}/api/v1/shortcomings/batch`,
    body,
    {
      maxAttempts: 3,
      ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
    },
  );
  const respText = await resp.text();
  let respJson: unknown = null;
  try {
    respJson = JSON.parse(respText);
  } catch { /* keep raw */ }

  if (!resp.ok) {
    return {
      success: false,
      eventType: "publish.failed",
      payload: {
        error_code: "http_non_2xx",
        http_status: resp.status,
        error_message: respText.slice(0, 500),
      },
    };
  }
  const okJson = (respJson ?? {}) as {
    upserted?: number;
    occurrences?: number;
  };
  return {
    success: true,
    eventType: "publish.completed",
    payload: {
      upserted: okJson.upserted ?? 0,
      occurrences: okJson.occurrences ?? 0,
      payload_hash: payloadHash,
      entries_count: payload.shortcomings.length,
    },
  };
}
