import type { RequestHandler } from './$types';
import { verifySignedRequest } from '$lib/server/signature';
import { settingsHash, payloadBlobHashes, findMissingBlobs } from '$lib/server/ingest';
import { canonicalJSON } from '$lib/shared/canonical';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import type { SignedRunPayload, IngestResponse } from '$lib/shared/types';
import { cachedJson, encodeCursor, decodeCursor } from '$lib/server/cache';
import { getAll } from '$lib/server/db';

interface RunRow {
  id: string;
  task_set_hash: string;
  settings_hash: string;
  machine_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  tier: string;
  model_slug: string;
  model_display: string;
}

interface CursorState {
  started_at: string;
  id: string;
}

export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;

  try {
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      throw new ApiError(400, 'invalid_limit', 'limit must be between 1 and 100');
    }
    const modelSlug = url.searchParams.get('model');
    const tier = url.searchParams.get('tier');
    const taskSet = url.searchParams.get('task_set');
    const since = url.searchParams.get('since');
    const cursor = decodeCursor<CursorState>(url.searchParams.get('cursor'));

    const wheres: string[] = [];
    const params: (string | number | null)[] = [];

    if (modelSlug) { wheres.push(`m.slug = ?`);              params.push(modelSlug); }
    if (tier)      { wheres.push(`runs.tier = ?`);            params.push(tier); }
    if (taskSet)   { wheres.push(`runs.task_set_hash = ?`);   params.push(taskSet); }
    if (since)     { wheres.push(`runs.started_at >= ?`);     params.push(since); }
    if (cursor) {
      wheres.push(`(runs.started_at < ? OR (runs.started_at = ? AND runs.id < ?))`);
      params.push(cursor.started_at, cursor.started_at, cursor.id);
    }

    const where = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '';
    const sql = `
      SELECT runs.id, runs.task_set_hash, runs.settings_hash, runs.machine_id,
             runs.started_at, runs.completed_at, runs.status, runs.tier,
             m.slug AS model_slug, m.display_name AS model_display
      FROM runs
      JOIN models m ON m.id = runs.model_id
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
        task_set_hash: r.task_set_hash,
        settings_hash: r.settings_hash,
        machine_id: r.machine_id,
        started_at: r.started_at,
        completed_at: r.completed_at,
        status: r.status,
        tier: r.tier,
        model: { slug: r.model_slug, display_name: r.model_display },
      })),
      next_cursor,
    };
    return cachedJson(request, body, { cacheControl: 'public, s-maxage=10, stale-while-revalidate=60' });
  } catch (err) {
    return errorResponse(err);
  }
};

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  const blobs = platform.env.BLOBS;

  try {
    const signed = await request.json() as SignedRunPayload;
    if (signed.version !== 1) throw new ApiError(400, 'bad_version', 'only version 1 supported');
    if (!signed.run_id) throw new ApiError(400, 'missing_run_id', 'run_id required');

    const verified = await verifySignedRequest(db, signed as unknown as { signature: { alg: 'Ed25519'; key_id: number; signed_at: string; value: string }; payload: Record<string, unknown> }, 'ingest');
    const payload = signed.payload;

    // Validate task_set_hash exists
    const taskSet = await db.prepare(`SELECT hash FROM task_sets WHERE hash = ?`)
      .bind(payload.task_set_hash).first();
    if (!taskSet) throw new ApiError(400, 'unknown_task_set', `task_set_hash ${payload.task_set_hash} not registered`);

    // Resolve model id from api_model_id + slug
    const model = await db.prepare(
      `SELECT id FROM models WHERE api_model_id = ? AND slug = ?`
    ).bind(payload.model.api_model_id, payload.model.slug).first<{ id: number }>();
    if (!model) throw new ApiError(400, 'unknown_model', `model ${payload.model.api_model_id} not registered`);

    // Validate pricing_version exists for this model
    const pricing = await db.prepare(
      `SELECT id FROM cost_snapshots WHERE pricing_version = ? AND model_id = ?`
    ).bind(payload.pricing_version, model.id).first();
    if (!pricing) throw new ApiError(400, 'unknown_pricing', `pricing_version ${payload.pricing_version} not registered for this model`);

    // Idempotency: check if run_id already exists
    const existing = await db.prepare(`SELECT id, status FROM runs WHERE id = ?`).bind(signed.run_id).first<{ id: string; status: string }>();
    const missingBlobs = await findMissingBlobs(blobs, payloadBlobHashes(payload));
    if (existing) {
      return jsonResponse({
        run_id: signed.run_id,
        missing_blobs: missingBlobs,
        accepted_at: new Date().toISOString(),
        status: 'exists'
      } satisfies IngestResponse & { status: string }, 200);
    }

    // Compute + insert settings profile
    const setHash = await settingsHash(payload.settings);
    const canonical = canonicalJSON(payload as unknown as Record<string, unknown>);
    const signedPayloadBytes = new TextEncoder().encode(canonical);

    const statements: D1PreparedStatement[] = [
      db.prepare(`
        INSERT OR IGNORE INTO settings_profiles(hash, temperature, max_attempts, max_tokens, prompt_version, bc_version, extra_json)
        VALUES (?,?,?,?,?,?,?)
      `).bind(
        setHash,
        payload.settings.temperature ?? null,
        payload.settings.max_attempts ?? null,
        payload.settings.max_tokens ?? null,
        payload.settings.prompt_version ?? null,
        payload.settings.bc_version ?? null,
        payload.settings.extra_json ?? null
      ),
      db.prepare(`
        INSERT INTO runs(
          id, task_set_hash, model_id, settings_hash, machine_id,
          started_at, completed_at, status, tier, source,
          centralgauge_sha, pricing_version, reproduction_bundle_r2_key,
          ingest_signature, ingest_signed_at, ingest_public_key_id, ingest_signed_payload
        ) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?,?)
      `).bind(
        signed.run_id,
        payload.task_set_hash, model.id, setHash, payload.machine_id,
        payload.started_at, null, 'running', 'claimed', 'bench',
        payload.centralgauge_sha ?? null,
        payload.pricing_version,
        payload.reproduction_bundle_sha256 ? `blobs/${payload.reproduction_bundle_sha256}` : null,
        signed.signature.value,
        signed.signature.signed_at,
        verified.key_id,
        signedPayloadBytes
      )
    ];

    for (const r of payload.results) {
      statements.push(
        db.prepare(`
          INSERT INTO results(
            run_id, task_id, attempt, passed, score, compile_success, compile_errors_json,
            tests_total, tests_passed,
            tokens_in, tokens_out, tokens_cache_read, tokens_cache_write,
            llm_duration_ms, compile_duration_ms, test_duration_ms,
            failure_reasons_json, transcript_r2_key, code_r2_key
          ) VALUES (?,?,?,?,?,?,?, ?,?, ?,?,?,?, ?,?,?, ?,?,?)
        `).bind(
          signed.run_id, r.task_id, r.attempt, r.passed ? 1 : 0, r.score, r.compile_success ? 1 : 0,
          JSON.stringify(r.compile_errors),
          r.tests_total, r.tests_passed,
          r.tokens_in, r.tokens_out, r.tokens_cache_read, r.tokens_cache_write,
          r.durations_ms.llm ?? null, r.durations_ms.compile ?? null, r.durations_ms.test ?? null,
          JSON.stringify(r.failure_reasons),
          r.transcript_sha256 ? `blobs/${r.transcript_sha256}` : null,
          r.code_sha256 ? `blobs/${r.code_sha256}` : null
        )
      );
    }

    statements.push(
      db.prepare(`INSERT INTO ingest_events(run_id, event, machine_id, ts, details_json) VALUES (?,?,?,?,?)`)
        .bind(signed.run_id, 'signature_verified', payload.machine_id, new Date().toISOString(),
              JSON.stringify({ missing_blob_count: missingBlobs.length }))
    );

    await db.batch(statements);

    const resp: IngestResponse = {
      run_id: signed.run_id,
      missing_blobs: missingBlobs,
      accepted_at: new Date().toISOString()
    };
    return jsonResponse(resp, 202);
  } catch (err) {
    return errorResponse(err);
  }
};
