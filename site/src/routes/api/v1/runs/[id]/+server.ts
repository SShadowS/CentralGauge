import type { RequestHandler } from './$types';
import { ApiError, errorResponse } from '$lib/server/errors';
import { cachedJson } from '$lib/server/cache';
import { getAll, getFirst } from '$lib/server/db';

interface RunRow {
  id: string;
  task_set_hash: string;
  model_id: number;
  settings_hash: string;
  machine_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  tier: string;
  source: string;
  centralgauge_sha: string | null;
  pricing_version: string;
  reproduction_bundle_r2_key: string | null;
  ingest_signature: string;
  ingest_signed_at: string;
  ingest_public_key_id: number;
  notes: string | null;
}

interface ResultRow {
  id: number;
  task_id: string;
  attempt: number;
  passed: number;
  score: number;
  compile_success: number;
  compile_errors_json: string;
  tests_total: number;
  tests_passed: number;
  tokens_in: number;
  tokens_out: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  llm_duration_ms: number | null;
  compile_duration_ms: number | null;
  test_duration_ms: number | null;
  failure_reasons_json: string | null;
  transcript_r2_key: string | null;
  code_r2_key: string | null;
  cost_usd: number | string | null;
}

export const GET: RequestHandler = async ({ request, params, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;

  try {
    const run = await getFirst<RunRow>(
      db,
      `SELECT id, task_set_hash, model_id, settings_hash, machine_id,
              started_at, completed_at, status, tier, source, centralgauge_sha,
              pricing_version, reproduction_bundle_r2_key,
              ingest_signature, ingest_signed_at, ingest_public_key_id, notes
       FROM runs WHERE id = ?`,
      [params.id],
    );

    if (!run) throw new ApiError(404, 'not_found', `Run ${params.id} not found`);

    const results = await getAll<ResultRow>(
      db,
      `SELECT id, task_id, attempt, passed, score, compile_success, compile_errors_json,
              tests_total, tests_passed,
              tokens_in, tokens_out, tokens_cache_read, tokens_cache_write,
              llm_duration_ms, compile_duration_ms, test_duration_ms,
              failure_reasons_json, transcript_r2_key, code_r2_key,
              cost_usd
       FROM v_results_with_cost
       WHERE run_id = ?
       ORDER BY task_id, attempt`,
      [params.id],
    );

    const body = {
      id: run.id,
      task_set_hash: run.task_set_hash,
      model_id: run.model_id,
      settings_hash: run.settings_hash,
      machine_id: run.machine_id,
      started_at: run.started_at,
      completed_at: run.completed_at,
      status: run.status,
      tier: run.tier,
      source: run.source,
      centralgauge_sha: run.centralgauge_sha,
      pricing_version: run.pricing_version,
      reproduction_bundle_r2_key: run.reproduction_bundle_r2_key,
      ingest_signed_at: run.ingest_signed_at,
      ingest_public_key_id: run.ingest_public_key_id,
      notes: run.notes,
      results: results.map((r) => ({
        id: r.id,
        task_id: r.task_id,
        attempt: r.attempt,
        passed: r.passed === 1,
        score: r.score,
        compile_success: r.compile_success === 1,
        compile_errors_json: r.compile_errors_json,
        tests_total: r.tests_total,
        tests_passed: r.tests_passed,
        tokens_in: r.tokens_in,
        tokens_out: r.tokens_out,
        tokens_cache_read: r.tokens_cache_read,
        tokens_cache_write: r.tokens_cache_write,
        llm_duration_ms: r.llm_duration_ms,
        compile_duration_ms: r.compile_duration_ms,
        test_duration_ms: r.test_duration_ms,
        failure_reasons_json: r.failure_reasons_json,
        transcript_r2_key: r.transcript_r2_key,
        code_r2_key: r.code_r2_key,
        cost_usd: r.cost_usd === null ? null : +r.cost_usd,
      })),
    };

    return cachedJson(request, body, { cacheControl: 'public, s-maxage=30, stale-while-revalidate=300' });
  } catch (err) {
    return errorResponse(err);
  }
};
