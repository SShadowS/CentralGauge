import type { RequestHandler } from "./$types";
import { bumpDataEpochStmt } from "$lib/server/data-epoch";
import {
  assertSupportedEnvelopeVersion,
  envelopeSignedMessage,
  type SignedRunEnvelope,
  verifySignedRequest,
} from "$lib/server/signature";
import {
  findMissingBlobs,
  payloadBlobHashes,
  settingsHash,
} from "$lib/server/ingest";
import { canonicalJSON } from "$lib/shared/canonical";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import type { IngestResponse, SignedRunPayload } from "$lib/shared/types";
import { cachedJson, decodeCursor, encodeCursor } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { appendAuditStmt } from "$lib/server/audit";
import {
  claimProfileStmt,
  conflictingRunIds,
  guardedRunInsertSql,
  profileKeyOf,
  readProfile,
} from "$lib/server/upstream-profile";

const TERMINATION_KINDS = new Set([
  "response",
  "provider_error",
  "cap_reached",
  "refusal",
  "infra_exhausted",
  "cancelled",
]);

// OpenRouter upstream lock (spec 2026-09-11). `not_applicable` is what a
// non-OpenRouter provider stamps explicitly; a NULL column means the row
// predates capture entirely and is honestly unknown.
const UPSTREAM_VERIFICATIONS = new Set([
  "not_applicable",
  "unpinned",
  "verified",
  "mismatch",
  "unverified",
  "not_served",
]);
const UPSTREAM_SOURCES = new Set([
  "provider_field",
  "router_metadata",
  "both",
]);
const EXCLUSION_CODES = new Set(["upstream_mismatch", "upstream_unverified"]);

/** The four verdicts that only make sense when the request carried a pin. */
const PINNED_VERIFICATIONS = new Set([
  "verified",
  "mismatch",
  "unverified",
  "not_served",
]);

interface ValidatedExclusion {
  code: string;
  reason: string;
  attempts: Array<{ task_id: string; attempt: 1 | 2 }>;
}

/**
 * Validate the CLI's own verdict that a run is compromised. Returns null when
 * the payload carries no `excluded` block at all (the normal case, and every
 * CLI predating the lock). Every named attempt must be present in the payload
 * AND carry a compromised verdict, so an exclusion can never be asserted
 * without the evidence that justifies it travelling alongside it.
 */
function validateExclusion(
  payload: SignedRunPayload["payload"],
): ValidatedExclusion | null {
  const raw = payload.excluded as unknown;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiError(
      400,
      "invalid_exclusion",
      "excluded must be a plain object or absent",
    );
  }
  const e = raw as { code?: unknown; reason?: unknown; attempts?: unknown };
  if (typeof e.code !== "string" || !EXCLUSION_CODES.has(e.code)) {
    throw new ApiError(
      400,
      "invalid_exclusion",
      `excluded.code must be one of ${[...EXCLUSION_CODES].join(", ")}`,
    );
  }
  if (
    typeof e.reason !== "string" ||
    e.reason.length === 0 ||
    e.reason.length > 500
  ) {
    throw new ApiError(
      400,
      "invalid_exclusion",
      "excluded.reason must be a non-empty string of at most 500 characters",
    );
  }
  if (!Array.isArray(e.attempts) || e.attempts.length === 0) {
    throw new ApiError(
      400,
      "invalid_exclusion",
      "excluded.attempts must be a non-empty array of { task_id, attempt }",
    );
  }
  const attempts: Array<{ task_id: string; attempt: 1 | 2 }> = [];
  for (const a of e.attempts) {
    const entry = a as { task_id?: unknown; attempt?: unknown };
    if (
      a === null ||
      typeof a !== "object" ||
      Array.isArray(a) ||
      typeof entry.task_id !== "string" ||
      (entry.attempt !== 1 && entry.attempt !== 2)
    ) {
      throw new ApiError(
        400,
        "invalid_exclusion",
        "excluded.attempts entries must be { task_id: string, attempt: 1 | 2 }",
      );
    }
    const taskId = entry.task_id;
    const attempt = entry.attempt as 1 | 2;
    const match = payload.results.find(
      (r) => r.task_id === taskId && r.attempt === attempt,
    );
    if (
      !match ||
      (match.upstream_verification !== "mismatch" &&
        match.upstream_verification !== "unverified")
    ) {
      throw new ApiError(
        400,
        "invalid_exclusion",
        `excluded names task ${taskId} attempt ${attempt}, which is not compromised in this payload: its upstream_verification must be mismatch or unverified`,
      );
    }
    attempts.push({ task_id: taskId, attempt });
  }
  return { code: e.code, reason: e.reason, attempts };
}

interface RunRow {
  id: string;
  excluded_at: string | null;
  excluded_reason: string | null;
  task_set_hash: string;
  settings_hash: string;
  machine_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  tier: string;
  model_slug: string;
  model_display: string;
  family_slug: string;
  tasks_attempted: number | null;
  tasks_passed: number | null;
  avg_score: number | null;
  cost_usd: number | string | null;
  duration_ms: number | null;
}

interface CursorState {
  started_at: string;
  id: string;
}

export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;

  try {
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      throw new ApiError(
        400,
        "invalid_limit",
        "limit must be between 1 and 100",
      );
    }
    const modelSlug = url.searchParams.get("model");
    const tier = url.searchParams.get("tier");
    const taskSet = url.searchParams.get("task_set");
    const since = url.searchParams.get("since");
    if (
      since !== null &&
      (since.trim() === "" || Number.isNaN(Date.parse(since)))
    ) {
      throw new ApiError(
        400,
        "invalid_since",
        "`since` must be an ISO-8601 timestamp",
      );
    }
    const cursor = decodeCursor<CursorState>(url.searchParams.get("cursor"));

    const wheres: string[] = [];
    const params: (string | number | null)[] = [];

    if (modelSlug) {
      wheres.push(`m.slug = ?`);
      params.push(modelSlug);
    }
    if (tier) {
      wheres.push(`runs.tier = ?`);
      params.push(tier);
    }
    if (taskSet) {
      wheres.push(`runs.task_set_hash = ?`);
      params.push(taskSet);
    }
    if (since) {
      wheres.push(`runs.started_at >= ?`);
      params.push(since);
    }
    if (cursor) {
      wheres.push(
        `(runs.started_at < ? OR (runs.started_at = ? AND runs.id < ?))`,
      );
      params.push(cursor.started_at, cursor.started_at, cursor.id);
    }

    const where = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";
    // Aggregate subquery: per run, totals over v_results_with_cost rows.
    //   - tasks_attempted = distinct task_id count
    //   - tasks_passed    = distinct task_id where ANY attempt passed (simplification;
    //     a stricter "last-attempt-passed" definition would require a window function
    //     or correlated subquery — this aggregate is sufficient for list summaries)
    //   - avg_score, cost_usd, duration_ms = sums/averages across all attempts
    const sql = `
      SELECT runs.id, runs.task_set_hash, runs.settings_hash, runs.machine_id,
             runs.started_at, runs.completed_at, runs.status, runs.tier,
             -- Soft run exclusion (0022): excluded runs are NOT filtered out
             -- here. This is the record, not a statistic. The list carries
             -- the marks so a reader can see which runs left the numbers.
             runs.excluded_at, runs.excluded_reason,
             m.slug AS model_slug, m.display_name AS model_display,
             mf.slug AS family_slug,
             COALESCE(agg.tasks_attempted, 0) AS tasks_attempted,
             COALESCE(agg.tasks_passed, 0)    AS tasks_passed,
             COALESCE(agg.avg_score, 0)       AS avg_score,
             COALESCE(agg.cost_usd, 0)        AS cost_usd,
             COALESCE(agg.duration_ms, 0)     AS duration_ms
      FROM runs
      JOIN models m ON m.id = runs.model_id
      JOIN model_families mf ON mf.id = m.family_id
      LEFT JOIN (
        SELECT run_id,
               COUNT(DISTINCT task_id)                                   AS tasks_attempted,
               COUNT(DISTINCT CASE WHEN passed = 1 THEN task_id END)     AS tasks_passed,
               AVG(score)                                                AS avg_score,
               SUM(cost_usd)                                             AS cost_usd,
               SUM(COALESCE(llm_duration_ms, 0)
                 + COALESCE(compile_duration_ms, 0)
                 + COALESCE(test_duration_ms, 0))                        AS duration_ms
        FROM v_results_with_cost
        GROUP BY run_id
      ) agg ON agg.run_id = runs.id
      ${where}
      ORDER BY runs.started_at DESC, runs.id DESC
      LIMIT ?
    `;
    params.push(limit + 1);

    const page = await getAll<RunRow>(db, sql, params);

    let next_cursor: string | null = null;
    if (page.length > limit) {
      page.pop();
      const last = page[page.length - 1];
      next_cursor = encodeCursor({ started_at: last.started_at, id: last.id });
    }

    const body = {
      data: page.map((r) => ({
        id: r.id,
        model: {
          slug: r.model_slug,
          display_name: r.model_display,
          family_slug: r.family_slug,
        },
        tier: r.tier,
        status: r.status,
        tasks_attempted: r.tasks_attempted ?? 0,
        tasks_passed: r.tasks_passed ?? 0,
        avg_score: r.avg_score ?? 0,
        cost_usd: r.cost_usd === null ? 0 : +r.cost_usd,
        duration_ms: r.duration_ms ?? 0,
        started_at: r.started_at,
        excluded_at: r.excluded_at ?? null,
        excluded_reason: r.excluded_reason ?? null,
        ...(r.completed_at ? { completed_at: r.completed_at } : {}),
      })),
      next_cursor,
      generated_at: new Date().toISOString(),
    };
    return cachedJson(request, body, {
      cacheControl: "public, s-maxage=10, stale-while-revalidate=60",
    });
  } catch (err) {
    return errorResponse(err);
  }
};

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  const blobs = platform.env.BLOBS;

  try {
    const signed = (await request.json()) as SignedRunPayload;
    const requireV2 =
      (platform.env as { FLAG_REQUIRE_ENVELOPE_V2?: string })
        .FLAG_REQUIRE_ENVELOPE_V2 === "on";
    assertSupportedEnvelopeVersion(signed.version, requireV2);
    if (!signed.run_id) {
      throw new ApiError(400, "missing_run_id", "run_id required");
    }

    const envelope = signed as unknown as SignedRunEnvelope;
    const verified = await verifySignedRequest(
      db,
      envelope,
      "ingest",
      envelopeSignedMessage(envelope),
    );
    if (signed.version === 1) {
      // Traffic telemetry for the staged v2 cutover: once no v1 lines appear
      // in the logs, the operator flips FLAG_REQUIRE_ENVELOPE_V2=on.
      console.warn(
        `[ingest] v1 envelope from key ${verified.key_id} (machine ${verified.machine_id}) — upgrade CLI before FLAG_REQUIRE_ENVELOPE_V2 is enforced`,
      );
    }
    const payload = signed.payload;

    // T13: bind the payload's claimed machine_id to the verified key's
    // machine_id — any valid ingest key could otherwise attribute runs to
    // another machine. Precheck already exposes machine_id_match so
    // operators see a mismatch before enforcement bites.
    if (payload.machine_id !== verified.machine_id) {
      throw new ApiError(
        400,
        "machine_id_mismatch",
        `payload machine_id "${payload.machine_id}" does not match the verified key's machine_id "${verified.machine_id}"`,
      );
    }

    // Validate task_set_hash exists
    const taskSet = await db
      .prepare(`SELECT hash FROM task_sets WHERE hash = ?`)
      .bind(payload.task_set_hash)
      .first();
    if (!taskSet) {
      throw new ApiError(
        400,
        "unknown_task_set",
        `task_set_hash ${payload.task_set_hash} not registered`,
      );
    }

    // Resolve model id from api_model_id + slug
    const model = await db
      .prepare(`SELECT id FROM models WHERE api_model_id = ? AND slug = ?`)
      .bind(payload.model.api_model_id, payload.model.slug)
      .first<{ id: number }>();
    if (!model) {
      throw new ApiError(
        400,
        "unknown_model",
        `model ${payload.model.api_model_id} not registered`,
      );
    }

    // Validate pricing_version exists for this model
    const pricing = await db
      .prepare(
        `SELECT id FROM cost_snapshots WHERE pricing_version = ? AND model_id = ?`,
      )
      .bind(payload.pricing_version, model.id)
      .first();
    if (!pricing) {
      throw new ApiError(
        400,
        "unknown_pricing",
        `pricing_version ${payload.pricing_version} not registered for this model`,
      );
    }

    // Run-time capture (2026-09): test_runner is optional but constrained.
    if (
      payload.test_runner !== undefined &&
      payload.test_runner !== "soap" &&
      payload.test_runner !== "legacy"
    ) {
      throw new ApiError(
        400,
        "invalid_test_runner",
        `test_runner must be "soap", "legacy", or absent`,
      );
    }
    if (
      payload.invocation !== undefined &&
      (typeof payload.invocation !== "object" ||
        payload.invocation === null ||
        Array.isArray(payload.invocation))
    ) {
      throw new ApiError(
        400,
        "invalid_capture_field",
        `invocation must be a plain object or absent`,
      );
    }

    // Invocation profile (D4): defaults to "sync" for CLIs predating the
    // field. Validated explicitly because payload is a signed-but-untyped
    // JSON body — the SignedRunPayload type is a compile-time contract, not
    // a runtime guarantee.
    const invocationMode = payload.invocation_mode ?? "sync";
    if (invocationMode !== "sync" && invocationMode !== "batch") {
      throw new ApiError(
        400,
        "invalid_invocation_mode",
        "invocation_mode must be sync or batch",
      );
    }

    // Upstream lock (spec 2026-09-11): the run's pin decides which upstream
    // profile it claims for its (model, task set, mode) triple. A run with no
    // pin claims `<unpinned>`, which conflicts with a pinned cohort exactly
    // the way two different pins conflict with each other.
    const runPin =
      typeof (payload.invocation as Record<string, unknown> | undefined)
          ?.["upstream_pin"] === "string"
        ? ((payload.invocation as Record<string, unknown>)[
          "upstream_pin"
        ] as string)
        : null;
    const profileKey = profileKeyOf(runPin);
    const triple = {
      modelId: model.id,
      taskSetHash: payload.task_set_hash,
      mode: invocationMode,
    };

    // Idempotency: check if run_id already exists
    const existing = await db
      .prepare(`SELECT id, status FROM runs WHERE id = ?`)
      .bind(signed.run_id)
      .first<{ id: string; status: string }>();
    const missingBlobs = await findMissingBlobs(
      blobs,
      payloadBlobHashes(payload),
    );
    if (existing) {
      return jsonResponse(
        {
          run_id: signed.run_id,
          missing_blobs: missingBlobs,
          accepted_at: new Date().toISOString(),
          status: "exists",
        } satisfies IngestResponse & { status: string },
        200,
      );
    }

    // Compute + insert settings profile
    const setHash = await settingsHash(payload.settings);
    const canonical = canonicalJSON(
      payload as unknown as Record<string, unknown>,
    );
    const signedPayloadBytes = new TextEncoder().encode(canonical);

    const now = new Date().toISOString();

    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `
        INSERT OR IGNORE INTO settings_profiles(hash, temperature, max_attempts, max_tokens, prompt_version, bc_version, extra_json)
        VALUES (?,?,?,?,?,?,?)
      `,
        )
        .bind(
          setHash,
          payload.settings.temperature ?? null,
          payload.settings.max_attempts ?? null,
          payload.settings.max_tokens ?? null,
          payload.settings.prompt_version ?? null,
          payload.settings.bc_version ?? null,
          payload.settings.extra_json ?? null,
        ),
    ];

    // Result inserts are built here but pushed after the run insert, because
    // each one is guarded on the run row having actually landed. A run whose
    // profile claim lost the race inserts nothing at all.
    const resultStatements: D1PreparedStatement[] = [];

    for (const r of payload.results) {
      // Boundary validation: score is contractually 0-100. Reject invalid
      // values at ingest so the registry's "0-100" claim isn't silently
      // corrupted by a misbehaving client. Legacy 0-1 fixtures still pass.
      if (
        typeof r.score !== "number" ||
        !Number.isFinite(r.score) ||
        r.score < 0 ||
        r.score > 100
      ) {
        throw new ApiError(
          400,
          "invalid_score",
          `score must be a finite 0-100 value (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
      // Boundary validation for token counts. Even though ingest is Ed25519-signed
      // by trusted machine keys, a buggy/stale client could otherwise corrupt the
      // cost-bearing columns. Reject non-integer/negative counts, and enforce the
      // documented invariant that reasoning tokens are a SUBSET of total output.
      const tokensReasoning = r.tokens_reasoning ?? 0;
      const tokenFields: ReadonlyArray<[string, number]> = [
        ["tokens_in", r.tokens_in],
        ["tokens_out", r.tokens_out],
        ["tokens_reasoning", tokensReasoning],
        ["tokens_cache_read", r.tokens_cache_read],
        ["tokens_cache_write", r.tokens_cache_write],
      ];
      for (const [name, value] of tokenFields) {
        if (!Number.isInteger(value) || value < 0) {
          throw new ApiError(
            400,
            "invalid_tokens",
            `${name} must be a non-negative integer (task ${r.task_id} attempt ${r.attempt})`,
          );
        }
      }
      if (tokensReasoning > r.tokens_out) {
        throw new ApiError(
          400,
          "invalid_tokens_reasoning",
          `tokens_reasoning must be <= tokens_out (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
      // Refusal-fallback fields (Task 5/6): optional on the wire, absent/null
      // means no fallback occurred. Bound served_model's length so a
      // misbehaving client can't stuff arbitrary data into the column.
      const servedModel =
        typeof r.served_model === "string" && r.served_model.length > 0
          ? r.served_model
          : null;
      if (servedModel !== null && servedModel.length > 128) {
        throw new ApiError(
          400,
          "invalid_served_model",
          `served_model must be <= 128 characters (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
      const refusalCategory =
        typeof r.refusal_category === "string" && r.refusal_category.length > 0
          ? r.refusal_category
          : null;
      // Run-time capture (2026-09): termination_kind is optional but constrained.
      if (
        r.termination_kind !== undefined &&
        !TERMINATION_KINDS.has(r.termination_kind)
      ) {
        throw new ApiError(
          400,
          "invalid_termination_kind",
          `termination_kind must be one of ${[...TERMINATION_KINDS].join(
            ", ",
          )} (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
      // Run-time capture (2026-09): remaining optional per-result fields —
      // shape-validated so a buggy/stale client can't corrupt the columns.
      if (
        r.test_vector !== undefined &&
        (!Array.isArray(r.test_vector) ||
          !r.test_vector.every(
            (v) =>
              v !== null &&
              typeof v === "object" &&
              typeof v.id === "string" &&
              typeof v.name === "string" &&
              typeof v.passed === "boolean",
          ))
      ) {
        throw new ApiError(
          400,
          "invalid_capture_field",
          `test_vector must be an array of { id: string, name: string, passed: boolean } (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
      if (
        r.fallback_chain !== undefined &&
        (!Array.isArray(r.fallback_chain) ||
          !r.fallback_chain.every((s) => typeof s === "string"))
      ) {
        throw new ApiError(
          400,
          "invalid_capture_field",
          `fallback_chain must be an array of strings (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
      if (
        r.infra_retries !== undefined &&
        (!Number.isInteger(r.infra_retries) || r.infra_retries < 0)
      ) {
        throw new ApiError(
          400,
          "invalid_capture_field",
          `infra_retries must be a non-negative integer (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
      if (r.cap_reached !== undefined && typeof r.cap_reached !== "boolean") {
        throw new ApiError(
          400,
          "invalid_capture_field",
          `cap_reached must be a boolean (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
      if (
        r.provider_error_code !== undefined &&
        r.provider_error_code !== null &&
        typeof r.provider_error_code !== "string"
      ) {
        throw new ApiError(
          400,
          "invalid_capture_field",
          `provider_error_code must be a string or null (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
      // Upstream lock (spec 2026-09-11 D1). Every field is optional on the
      // wire: a CLI predating the lock sends none of them and the columns
      // stay NULL.
      const str = (v: unknown, name: string): string | null => {
        if (v === undefined || v === null) return null;
        if (typeof v !== "string" || v.length === 0 || v.length > 128) {
          throw new ApiError(
            400,
            "invalid_upstream",
            `${name} must be a non-empty string of at most 128 characters or null (task ${r.task_id} attempt ${r.attempt})`,
          );
        }
        return v;
      };
      const requestedUpstream = str(r.requested_upstream, "requested_upstream");
      const servedUpstream = str(r.served_upstream, "served_upstream");
      const servedUpstreamModel = str(
        r.served_upstream_model,
        "served_upstream_model",
      );
      const identitySource = str(
        r.upstream_identity_source,
        "upstream_identity_source",
      );
      if (identitySource !== null && !UPSTREAM_SOURCES.has(identitySource)) {
        throw new ApiError(
          400,
          "invalid_upstream",
          `upstream_identity_source must be one of ${
            [...UPSTREAM_SOURCES].join(", ")
          } (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
      const verification = r.upstream_verification === undefined
        ? null
        : r.upstream_verification;
      if (verification !== null && !UPSTREAM_VERIFICATIONS.has(verification)) {
        throw new ApiError(
          400,
          "invalid_upstream",
          `upstream_verification must be one of ${
            [...UPSTREAM_VERIFICATIONS].join(", ")
          } (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
      // Relational rules (spec D1).
      if (
        verification !== null &&
        PINNED_VERIFICATIONS.has(verification) &&
        requestedUpstream === null
      ) {
        throw new ApiError(
          400,
          "invalid_upstream",
          `${verification} requires a requested_upstream (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
      if (
        (verification === "unpinned" || verification === "not_applicable") &&
        requestedUpstream !== null
      ) {
        throw new ApiError(
          400,
          "invalid_upstream",
          `${verification} requires a null requested_upstream (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
      if (
        (verification === "verified" || verification === "mismatch") &&
        (servedUpstream === null || identitySource === null)
      ) {
        throw new ApiError(
          400,
          "invalid_upstream",
          `${verification} requires a served_upstream and an identity source (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
      if (requestedUpstream !== null && requestedUpstream !== runPin) {
        throw new ApiError(
          400,
          "invalid_upstream",
          `requested_upstream ${requestedUpstream} must equal the run's upstream_pin ${
            runPin ?? "(none)"
          } (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
      resultStatements.push(
        db
          .prepare(
            `
          INSERT INTO results(
            run_id, task_id, attempt, passed, score, compile_success, compile_errors_json,
            tests_total, tests_passed,
            tokens_in, tokens_out, tokens_reasoning, tokens_cache_read, tokens_cache_write,
            llm_duration_ms, compile_duration_ms, test_duration_ms,
            failure_reasons_json, transcript_r2_key, code_r2_key,
            served_model, refusal_category,
            test_vector_json, termination_kind, provider_finish_reason, provider_error_code,
            cap_reached, infra_retries, infra_exhaustion_reason, fallback_chain_json,
            prompt_digest, candidate_digest,
            requested_upstream, served_upstream, served_upstream_model, upstream_identity_source, upstream_verification,
            overlay_base_digest, failure_class, failure_class_version
          ) SELECT ?,?,?,?,?,?,?, ?,?, ?,?,?,?,?, ?,?,?, ?,?,?, ?,?, ?,?,?,?, ?,?,?,?, ?,?, ?,?,?,?,?, ?,?,?
            WHERE EXISTS (SELECT 1 FROM runs WHERE id = ?)
        `,
          )
          .bind(
            signed.run_id,
            r.task_id,
            r.attempt,
            r.passed ? 1 : 0,
            r.score,
            r.compile_success ? 1 : 0,
            JSON.stringify(r.compile_errors),
            r.tests_total,
            r.tests_passed,
            r.tokens_in,
            r.tokens_out,
            tokensReasoning,
            r.tokens_cache_read,
            r.tokens_cache_write,
            r.durations_ms.llm ?? null,
            r.durations_ms.compile ?? null,
            r.durations_ms.test ?? null,
            JSON.stringify(r.failure_reasons),
            r.transcript_sha256 ? `blobs/${r.transcript_sha256}` : null,
            r.code_sha256 ? `blobs/${r.code_sha256}` : null,
            servedModel,
            refusalCategory,
            r.test_vector ? JSON.stringify(r.test_vector) : null,
            r.termination_kind ?? null,
            r.provider_finish_reason ?? null,
            r.provider_error_code ?? null,
            r.cap_reached === undefined ? null : r.cap_reached ? 1 : 0,
            r.infra_retries ?? null,
            r.infra_exhaustion_reason ?? null,
            r.fallback_chain ? JSON.stringify(r.fallback_chain) : null,
            r.prompt_sha256 ?? null,
            r.candidate_sha256 ?? null,
            requestedUpstream,
            servedUpstream,
            servedUpstreamModel,
            identitySource,
            verification,
            null, // overlay_base_digest: not yet produced by any client
            null, // failure_class: not yet produced by any client
            null, // failure_class_version: not yet produced by any client
            signed.run_id, // guard: only insert when the run row landed
          ),
      );
    }

    // The CLI's own verdict that this run is compromised (spec D1). Validated
    // after the results so a malformed upstream field is reported as such
    // rather than as a phantom exclusion error.
    const excluded = validateExclusion(payload);

    // Run insert. Columns and placeholders are derived from one list so the
    // two can never drift, and the exclusion columns are appended only when
    // the CLI actually declared the run compromised.
    const runColumns = [
      "id",
      "task_set_hash",
      "model_id",
      "settings_hash",
      "machine_id",
      "started_at",
      "completed_at",
      "status",
      "tier",
      "source",
      "centralgauge_sha",
      "pricing_version",
      "reproduction_bundle_r2_key",
      "ingest_signature",
      "ingest_signed_at",
      "ingest_public_key_id",
      "ingest_signed_payload",
      "harness_fingerprint",
      "retry_path_version",
      "environment_digest",
      "bc_artifact",
      "container_image_digest",
      "bcch_version",
      "test_runner",
      "prompt_template_digest",
      "invocation_json",
      "invocation_mode",
    ];
    const runValues: unknown[] = [
      signed.run_id,
      payload.task_set_hash,
      model.id,
      setHash,
      payload.machine_id,
      payload.started_at,
      null,
      "running",
      "claimed",
      "bench",
      payload.centralgauge_sha ?? null,
      payload.pricing_version,
      payload.reproduction_bundle_sha256
        ? `blobs/${payload.reproduction_bundle_sha256}`
        : null,
      signed.signature.value,
      signed.signature.signed_at,
      verified.key_id,
      signedPayloadBytes,
      payload.harness_fingerprint ?? null,
      payload.retry_path_version ?? null,
      payload.environment_sha256 ? `blobs/${payload.environment_sha256}` : null,
      payload.bc_artifact ?? null,
      payload.container_image_digest ?? null,
      payload.bcch_version ?? null,
      payload.test_runner ?? null,
      payload.prompt_template_digest ?? null,
      payload.invocation ? JSON.stringify(payload.invocation) : null,
      invocationMode,
    ];
    if (excluded) {
      runColumns.push("excluded_at", "excluded_code", "excluded_reason");
      runValues.push(now, excluded.code, excluded.reason);
    }
    const baseRunSql = `INSERT INTO runs(${runColumns.join(", ")}) VALUES (${
      runColumns.map(() => "?").join(",")
    })`;

    if (excluded) {
      // A compromised run never holds the profile: it is stored for the
      // record, counts towards nothing, and must not block a clean re-run of
      // the same cohort. So no claim, and no claim guard on the insert.
      statements.push(
        db.prepare(guardedRunInsertSql(baseRunSql, "1 = 1")).bind(...runValues),
      );
    } else {
      statements.push(
        claimProfileStmt(db, { ...triple, key: profileKey, now }),
        db
          .prepare(guardedRunInsertSql(baseRunSql))
          .bind(
            ...runValues,
            triple.modelId,
            triple.taskSetHash,
            triple.mode,
            profileKey,
          ),
      );
    }

    statements.push(...resultStatements);

    statements.push(
      db
        .prepare(
          `INSERT INTO ingest_events(run_id, event, machine_id, ts, details_json) VALUES (?,?,?,?,?)`,
        )
        .bind(
          signed.run_id,
          "signature_verified",
          payload.machine_id,
          new Date().toISOString(),
          JSON.stringify({ missing_blob_count: missingBlobs.length }),
        ),
    );

    if (excluded) {
      statements.push(
        appendAuditStmt(db, {
          event: "run.auto_excluded",
          actor: verified,
          taskSetHash: payload.task_set_hash,
          details: {
            run_id: signed.run_id,
            code: excluded.code,
            reason: excluded.reason,
            attempts: excluded.attempts,
          },
        }),
      );
    }

    // Ingest changes leaderboard-visible data, so retire every cached
    // aggregate. In-batch (not after) so a committed ingest can never be
    // paired with a failed bump. See src/lib/server/data-epoch.ts.
    statements.push(bumpDataEpochStmt(db));

    await db.batch(statements);

    // The run insert is guarded on the stored profile key being ours, so an
    // absent run row means a concurrent first ingest claimed the triple with
    // a different upstream. Nothing of this run was written.
    const landed = await db
      .prepare(`SELECT id FROM runs WHERE id = ?`)
      .bind(signed.run_id)
      .first();
    if (!landed) {
      const stored = await readProfile(db, triple);
      const holders = await conflictingRunIds(db, triple, signed.run_id);
      throw new ApiError(
        409,
        "upstream_profile_conflict",
        `model ${payload.model.slug} on this task set and mode already has upstream profile ${
          stored?.key ?? "?"
        } (runs: ${
          holders.join(", ") || "none"
        }); this run carries ${profileKey}. Exclude the stored cohort first, or re-ingest with the same pin.`,
      );
    }

    const resp: IngestResponse = {
      run_id: signed.run_id,
      missing_blobs: missingBlobs,
      accepted_at: new Date().toISOString(),
    };
    return jsonResponse(resp, 202);
  } catch (err) {
    return errorResponse(err);
  }
};
