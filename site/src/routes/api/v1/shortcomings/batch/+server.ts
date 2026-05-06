import type { RequestHandler } from "./$types";
import { verifySignedRequest } from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { broadcastEvent } from "$lib/server/broadcaster";
import { resolveConcept } from "$lib/server/concept-resolver";
import { invalidateConcept } from "$lib/server/concept-cache";
import { appendEvent } from "$lib/server/lifecycle-event-log";
import { SLUG_REGEX } from "$lib/shared/slug";

interface ShortcomingOccurrence {
  /** Null when the client did not pre-resolve; the handler resolves
   * server-side via `(model_id, task_id) → latest results.id`. */
  result_id: number | null;
  task_id: string;
  error_code: string | null;
}

interface ShortcomingItem {
  al_concept: string;
  concept: string;
  description: string;
  correct_pattern: string;
  incorrect_pattern_sha256: string;
  error_codes: string[];
  occurrences: ShortcomingOccurrence[];
  // D-prompt: registry-shaped fields. Required for new clients; legacy clients
  // (still posting only `concept`) trigger a deprecation warning and the
  // resolver path is skipped — `concept_id` stays NULL until D-data backfill.
  concept_slug_proposed: string | null;
  concept_slug_existing_match: string | null;
  similarity_score: number | null;
}

function validateOccurrence(
  occ: unknown,
  shortIdx: number,
  occIdx: number,
): ShortcomingOccurrence {
  const o = occ as Record<string, unknown>;
  const { result_id, task_id, error_code } = o;
  // result_id is OPTIONAL. When null/missing the handler resolves server-side
  // via (model_id, task_id). When provided it must be a positive integer.
  let resolvedResultId: number | null = null;
  if (result_id !== null && result_id !== undefined) {
    if (!Number.isInteger(result_id) || (result_id as number) <= 0) {
      throw new ApiError(
        400,
        "bad_payload",
        `shortcomings[${shortIdx}].occurrences[${occIdx}].result_id must be a positive integer or null`,
      );
    }
    resolvedResultId = result_id as number;
  }
  if (typeof task_id !== "string" || task_id.length === 0) {
    throw new ApiError(
      400,
      "bad_payload",
      `shortcomings[${shortIdx}].occurrences[${occIdx}].task_id must be a non-empty string`,
    );
  }
  return {
    result_id: resolvedResultId,
    task_id,
    error_code: typeof error_code === "string" ? error_code : null,
  };
}

function validateShortcomingItem(
  item: unknown,
  index: number,
): ShortcomingItem {
  const it = item as Record<string, unknown>;

  if (typeof it.al_concept !== "string" || it.al_concept.length === 0) {
    throw new ApiError(
      400,
      "bad_payload",
      `shortcomings[${index}].al_concept must be a non-empty string`,
    );
  }
  if (typeof it.concept !== "string" || it.concept.length === 0) {
    throw new ApiError(
      400,
      "bad_payload",
      `shortcomings[${index}].concept must be a non-empty string`,
    );
  }
  if (typeof it.description !== "string" || it.description.length === 0) {
    throw new ApiError(
      400,
      "bad_payload",
      `shortcomings[${index}].description must be a non-empty string`,
    );
  }
  if (
    typeof it.correct_pattern !== "string" || it.correct_pattern.length === 0
  ) {
    throw new ApiError(
      400,
      "bad_payload",
      `shortcomings[${index}].correct_pattern must be a non-empty string`,
    );
  }
  if (
    typeof it.incorrect_pattern_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(it.incorrect_pattern_sha256)
  ) {
    throw new ApiError(
      400,
      "bad_payload",
      `shortcomings[${index}].incorrect_pattern_sha256 must be a 64-char hex string`,
    );
  }

  const rawErrorCodes = it.error_codes;
  if (rawErrorCodes !== undefined && !Array.isArray(rawErrorCodes)) {
    throw new ApiError(
      400,
      "bad_payload",
      `shortcomings[${index}].error_codes must be an array of strings or absent`,
    );
  }
  if (
    Array.isArray(rawErrorCodes) &&
    !rawErrorCodes.every((e) => typeof e === "string")
  ) {
    throw new ApiError(
      400,
      "bad_payload",
      `shortcomings[${index}].error_codes must be an array of strings`,
    );
  }

  const rawOccurrences = it.occurrences;
  if (rawOccurrences !== undefined && !Array.isArray(rawOccurrences)) {
    throw new ApiError(
      400,
      "bad_payload",
      `shortcomings[${index}].occurrences must be an array or absent`,
    );
  }

  const occurrences: ShortcomingOccurrence[] = Array.isArray(rawOccurrences)
    ? rawOccurrences.map((occ, occIdx) =>
      validateOccurrence(occ, index, occIdx)
    )
    : [];

  // D-prompt: validate the new registry-shaped fields. All three are
  // optional/nullable for legacy clients; new clients post all three.
  const proposed = it.concept_slug_proposed;
  if (proposed !== undefined && proposed !== null) {
    if (typeof proposed !== "string" || !SLUG_REGEX.test(proposed)) {
      throw new ApiError(
        400,
        "bad_payload",
        `shortcomings[${index}].concept_slug_proposed must be kebab-case`,
      );
    }
  }
  const existingMatch = it.concept_slug_existing_match;
  if (existingMatch !== undefined && existingMatch !== null) {
    if (typeof existingMatch !== "string" || !SLUG_REGEX.test(existingMatch)) {
      throw new ApiError(
        400,
        "bad_payload",
        `shortcomings[${index}].concept_slug_existing_match must be kebab-case or null`,
      );
    }
  }
  const sim = it.similarity_score;
  if (sim !== undefined && sim !== null) {
    if (typeof sim !== "number" || sim < 0 || sim > 1) {
      throw new ApiError(
        400,
        "bad_payload",
        `shortcomings[${index}].similarity_score must be in [0,1] or null`,
      );
    }
  }
  if (proposed === undefined || proposed === null) {
    // Legacy client path: log a one-line deprecation warning. concept_id stays
    // NULL until D-data clusters legacy entries server-side.
    console.warn(
      `[deprecation] shortcomings[${index}] missing concept_slug_proposed; ` +
        `falling back to legacy 'concept' field. Will be required in v2.`,
    );
  }

  return {
    al_concept: it.al_concept,
    concept: it.concept,
    description: it.description,
    correct_pattern: it.correct_pattern,
    incorrect_pattern_sha256: it.incorrect_pattern_sha256,
    error_codes: Array.isArray(rawErrorCodes)
      ? (rawErrorCodes as string[])
      : [],
    occurrences,
    concept_slug_proposed: typeof proposed === "string" ? proposed : null,
    concept_slug_existing_match: typeof existingMatch === "string"
      ? existingMatch
      : null,
    similarity_score: typeof sim === "number" ? sim : null,
  };
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "Cloudflare platform not available"),
    );
  }
  const db = platform.env.DB;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "bad_request", "request body must be valid JSON");
    }

    const envelope = body as {
      payload: Record<string, unknown>;
      signature: {
        alg: "Ed25519";
        key_id: number;
        signed_at: string;
        value: string;
      };
    };
    if (!envelope.signature) {
      throw new ApiError(400, "missing_signature", "signature block required");
    }
    if (!envelope.payload || typeof envelope.payload !== "object") {
      throw new ApiError(400, "bad_payload", "payload object required");
    }

    const payload = envelope.payload;
    if (!payload.model_slug || typeof payload.model_slug !== "string") {
      throw new ApiError(
        400,
        "bad_payload",
        "model_slug is required and must be a string",
      );
    }
    if (!Array.isArray(payload.shortcomings)) {
      throw new ApiError(400, "bad_payload", "shortcomings must be an array");
    }

    // Validate all items BEFORE signature verification to avoid timing leaks
    const shortcomings: ShortcomingItem[] = (payload.shortcomings as unknown[])
      .map((item, idx) => validateShortcomingItem(item, idx));

    await verifySignedRequest(db, envelope, "verifier");

    const modelSlug = payload.model_slug as string;

    // Look up model by slug
    const modelRow = await db
      .prepare(`SELECT id FROM models WHERE slug = ?`)
      .bind(modelSlug)
      .first<{ id: number }>();
    if (!modelRow) {
      throw new ApiError(
        404,
        "model_not_found",
        `model '${modelSlug}' not found`,
      );
    }

    const modelId = modelRow.id;
    const now = new Date().toISOString();

    let upserted = 0;
    let occurrences = 0;

    // STEP 1 (D-prompt): write `analysis.completed` FIRST so every downstream
    // shortcoming + pending_review row has a real `analysis_event_id` to FK.
    // ONE event per batch (not per item) — matches the strategic appendix
    // payload `{entries_count, min_confidence, payload_hash}`. The captured
    // id is reused for both shortcomings.analysis_event_id AND
    // pending_review.analysis_event_id.
    const taskSetHash = typeof payload.task_set_hash === "string"
      ? payload.task_set_hash
      : "unknown";
    const analyzerModel = typeof payload.analyzer_model === "string"
      ? payload.analyzer_model
      : modelSlug;
    const writeNowMs = Date.now();
    const invalidationSlugs: string[] = [];

    // Skip the analysis.completed event entirely on empty batches — the event
    // is meaningless when nothing changed (matches the existing SSE skip).
    let analysisEventId: number | null = null;
    if (shortcomings.length > 0) {
      const analysisEvt = await appendEvent(db, {
        event_type: "analysis.completed",
        model_slug: modelSlug,
        task_set_hash: taskSetHash,
        actor: "operator",
        actor_id: null,
        payload: {
          analyzer_model: analyzerModel,
          entries_count: shortcomings.length,
          payload_hash: await sha256Hex(JSON.stringify(shortcomings)),
        },
      });
      analysisEventId = analysisEvt.id;
    }

    for (const item of shortcomings) {
      const r2Key = `shortcomings/${item.incorrect_pattern_sha256}.al.zst`;
      const errorCodesJson = JSON.stringify(item.error_codes);

      let conceptId: number | null = null;

      if (item.concept_slug_proposed) {
        // STEP 2: resolveConcept emits concept.aliased OR concept.created OR
        // returns 'pending'. It calls `appendEvent` directly with object
        // payloads — the helper serializes + hashes internally.
        const resolved = await resolveConcept(
          db,
          {
            proposed_slug: item.concept_slug_proposed,
            existing_match: item.concept_slug_existing_match,
            similarity_score: item.similarity_score,
            display_name: item.concept,
            al_concept: item.al_concept,
            description: item.description,
            correct_pattern: item.correct_pattern,
            analyzer_model: analyzerModel,
          },
          writeNowMs,
          (input) => appendEvent(db, input),
          modelSlug,
          taskSetHash,
        );

        if (resolved.action === "pending") {
          // STEP 4: pending_review row references the real analysis_event_id
          // from STEP 1. No `0` placeholder — the FK NOT NULL REFERENCES
          // lifecycle_events(id) holds because we wrote a real row upstream.
          //
          // CANONICAL payload_json shape (also used by Plan D-data's
          // enqueueReviewTx and read by Plan F's /decide endpoint):
          //   `{ entry, confidence }`
          // Cluster metadata (when present) nests under `entry._cluster`.
          // The /decide endpoint reads only top-level `entry` + `confidence`;
          // nested cluster data is opaque to it.
          const pendingPayload = {
            entry: item,
            confidence: item.similarity_score ?? 0,
          };
          await db
            .prepare(
              `INSERT INTO pending_review (analysis_event_id, model_slug, concept_slug_proposed,
                                           payload_json, confidence, created_at, status)
               VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            )
            .bind(
              analysisEventId, // real event id from STEP 1
              modelSlug,
              item.concept_slug_proposed,
              JSON.stringify(pendingPayload),
              item.similarity_score ?? 0,
              writeNowMs,
            )
            .run();
          // Skip writing this row to shortcomings — reviewer decision creates
          // it via Plan F's /decide endpoint when the operator approves.
          continue;
        }

        conceptId = resolved.concept_id;
        if (resolved.action === "created" || resolved.action === "aliased") {
          // Cache invalidation needed for both bands — a freshly-aliased slug
          // shouldn't serve stale 5-min results from
          // /api/v1/concepts/<aliased-slug>.
          invalidationSlugs.push(item.concept_slug_proposed);
        }
      }

      // STEP 3: Upsert shortcoming with concept_id (when resolved) AND
      // analysis_event_id (when present — empty batches skip step 1).
      const row = await db
        .prepare(
          `INSERT INTO shortcomings(model_id, al_concept, concept, description, correct_pattern,
                                    incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen,
                                    concept_id, analysis_event_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(model_id, al_concept) DO UPDATE SET
             concept = excluded.concept,
             description = excluded.description,
             correct_pattern = excluded.correct_pattern,
             incorrect_pattern_r2_key = excluded.incorrect_pattern_r2_key,
             error_codes_json = excluded.error_codes_json,
             last_seen = excluded.last_seen,
             concept_id = COALESCE(excluded.concept_id, concept_id),
             analysis_event_id = COALESCE(excluded.analysis_event_id, analysis_event_id)
           RETURNING id`,
        )
        .bind(
          modelId,
          item.al_concept,
          item.concept,
          item.description,
          item.correct_pattern,
          r2Key,
          errorCodesJson,
          now,
          now,
          conceptId,
          analysisEventId,
        )
        .first<{ id: number }>();

      if (!row) {
        throw new ApiError(500, "db_error", "failed to upsert shortcoming");
      }
      upserted++;

      // Batch occurrence inserts per shortcoming for efficiency. Each
      // occurrence may carry a null `result_id` — resolve it server-side
      // by picking the most recent `results.id` for (model_id, task_id).
      // Drop occurrences where no matching result exists; this is the
      // expected case when the cycle's analyze step references a task that
      // wasn't part of the most-recent bench (rare, e.g. task removed).
      if (item.occurrences.length > 0) {
        const resolved: Array<
          { result_id: number; task_id: string; error_code: string | null }
        > = [];
        for (const occ of item.occurrences) {
          let rid: number | null = occ.result_id;
          if (rid === null) {
            const r = await db.prepare(
              `SELECT r.id AS id FROM results r
                 JOIN runs ON runs.id = r.run_id
                WHERE runs.model_id = ? AND r.task_id = ?
                ORDER BY runs.started_at DESC, r.id DESC
                LIMIT 1`,
            ).bind(modelId, occ.task_id).first<{ id: number }>();
            rid = r?.id ?? null;
          }
          if (rid === null) continue;
          resolved.push({
            result_id: rid,
            task_id: occ.task_id,
            error_code: occ.error_code,
          });
        }
        if (resolved.length > 0) {
          const occStmts = resolved.map((occ) =>
            db
              .prepare(
                `INSERT OR IGNORE INTO shortcoming_occurrences(shortcoming_id, result_id, task_id, error_code)
                 VALUES (?, ?, ?, ?)`,
              )
              .bind(row.id, occ.result_id, occ.task_id, occ.error_code)
          );
          // Chunk at 500 to stay within D1 batch limits
          for (let i = 0; i < occStmts.length; i += 500) {
            const chunk = occStmts.slice(i, i + 500);
            const results = await db.batch(chunk);
            for (const r of results) {
              occurrences += r.meta?.changes ?? 0;
            }
          }
        }
      }
    }

    // Inline cache invalidation — NOT ctx.waitUntil — so subsequent reads see
    // fresh data deterministically (CLAUDE.md guidance).
    for (const slug of invalidationSlugs) {
      await invalidateConcept(slug);
    }

    // Best-effort SSE broadcast: surfaces newly recorded shortcomings on the
    // live dashboard. Skip on empty batches — the event is meaningless when
    // nothing changed. Wrapped in try/catch so a DO outage cannot fail a
    // committed write.
    if (upserted > 0) {
      try {
        await broadcastEvent(platform.env, {
          type: "shortcoming_added",
          model_slug: modelSlug,
          count: upserted,
          ts: new Date().toISOString(),
        });
      } catch { /* swallow */ }
    }

    return jsonResponse({ upserted, occurrences }, 200, {
      "Cache-Control": "no-store",
    });
  } catch (err) {
    return errorResponse(err);
  }
};
