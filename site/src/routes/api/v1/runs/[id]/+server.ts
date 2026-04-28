import type { RequestHandler } from './$types';
import { ApiError, errorResponse } from '$lib/server/errors';
import { cachedJson } from '$lib/server/cache';
import { getAll, getFirst } from '$lib/server/db';

interface RunRow {
  id: string;
  task_set_hash: string;
  settings_hash: string;
  machine_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  tier: string;
  centralgauge_sha: string | null;
  pricing_version: string;
  reproduction_bundle_r2_key: string | null;
  ingest_public_key_id: number;
  model_slug: string;
  model_display: string;
  model_api_id: string;
  family_slug: string;
  // settings_profiles columns
  temperature: number | null;
  max_attempts: number | null;
  max_tokens: number | null;
  prompt_version: string | null;
  bc_version: string | null;
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
  llm_duration_ms: number | null;
  compile_duration_ms: number | null;
  test_duration_ms: number | null;
  failure_reasons_json: string | null;
  transcript_r2_key: string | null;
  code_r2_key: string | null;
  cost_usd: number | string | null;
  difficulty: 'easy' | 'medium' | 'hard';
}

interface AttemptOut {
  attempt: number;
  passed: boolean;
  score: number;
  compile_success: boolean;
  compile_errors: Array<{ code: string; message: string; file?: string; line?: number; column?: number }>;
  tests_total: number;
  tests_passed: number;
  duration_ms: number;
  transcript_key: string;
  code_key?: string;
  failure_reasons: string[];
}

interface PerTaskOut {
  task_id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  attempts: AttemptOut[];
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

function sha256FromKey(key: string): string {
  // `blobs/<sha>` → use sha; otherwise use the path stem (basename without extension)
  if (key.startsWith('blobs/')) {
    const tail = key.slice('blobs/'.length);
    if (SHA256_HEX.test(tail)) return tail;
    return tail;
  }
  // Take basename (last path segment), strip first extension.
  const base = key.split('/').pop() ?? key;
  const dot = base.indexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
}

export const GET: RequestHandler = async ({ request, params, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  const blobs = platform.env.BLOBS;

  try {
    const run = await getFirst<RunRow>(
      db,
      `SELECT runs.id, runs.task_set_hash, runs.settings_hash, runs.machine_id,
              runs.started_at, runs.completed_at, runs.status, runs.tier,
              runs.centralgauge_sha, runs.pricing_version, runs.reproduction_bundle_r2_key,
              runs.ingest_public_key_id,
              m.slug AS model_slug, m.display_name AS model_display, m.api_model_id AS model_api_id,
              mf.slug AS family_slug,
              sp.temperature, sp.max_attempts, sp.max_tokens, sp.prompt_version, sp.bc_version
       FROM runs
       JOIN models m ON m.id = runs.model_id
       JOIN model_families mf ON mf.id = m.family_id
       JOIN settings_profiles sp ON sp.hash = runs.settings_hash
       WHERE runs.id = ?`,
      [params.id!],
    );

    if (!run) throw new ApiError(404, 'not_found', `Run ${params.id} not found`);

    const results = await getAll<ResultRow>(
      db,
      `SELECT v.id, v.task_id, v.attempt, v.passed, v.score, v.compile_success, v.compile_errors_json,
              v.tests_total, v.tests_passed,
              v.llm_duration_ms, v.compile_duration_ms, v.test_duration_ms,
              v.failure_reasons_json, v.transcript_r2_key, v.code_r2_key,
              v.cost_usd,
              t.difficulty
       FROM v_results_with_cost v
       LEFT JOIN tasks t ON t.task_set_hash = ? AND t.task_id = v.task_id
       WHERE v.run_id = ?
       ORDER BY v.task_id, v.attempt`,
      [run.task_set_hash, params.id!],
    );

    // Group results by task_id, sorted by attempt number.
    const byTask = new Map<string, PerTaskOut>();
    let totalDurationMs = 0;
    let totalCostUsd = 0;

    for (const r of results) {
      let compileErrors: AttemptOut['compile_errors'];
      try {
        compileErrors = JSON.parse(r.compile_errors_json) as AttemptOut['compile_errors'];
      } catch {
        throw new ApiError(500, 'result_corrupt', `compile_errors_json corrupt for result ${r.id}`);
      }
      let failureReasons: string[] = [];
      if (r.failure_reasons_json) {
        try {
          failureReasons = JSON.parse(r.failure_reasons_json) as string[];
        } catch {
          throw new ApiError(500, 'result_corrupt', `failure_reasons_json corrupt for result ${r.id}`);
        }
      }
      const durationMs =
        (r.llm_duration_ms ?? 0) +
        (r.compile_duration_ms ?? 0) +
        (r.test_duration_ms ?? 0);
      totalDurationMs += durationMs;
      if (r.cost_usd !== null) totalCostUsd += +r.cost_usd;

      const attempt: AttemptOut = {
        attempt: r.attempt,
        passed: r.passed === 1,
        score: r.score,
        compile_success: r.compile_success === 1,
        compile_errors: compileErrors,
        tests_total: r.tests_total,
        tests_passed: r.tests_passed,
        duration_ms: durationMs,
        transcript_key: r.transcript_r2_key ?? '',
        failure_reasons: failureReasons,
      };
      if (r.code_r2_key) attempt.code_key = r.code_r2_key;

      let task = byTask.get(r.task_id);
      if (!task) {
        task = {
          task_id: r.task_id,
          // tasks row may be missing for legacy/imported runs; default to 'easy' as a safe fallback.
          difficulty: r.difficulty ?? 'easy',
          attempts: [],
        };
        byTask.set(r.task_id, task);
      }
      task.attempts.push(attempt);
    }

    // Ensure attempts sorted ascending (SQL ORDER BY already enforces this, but be defensive).
    const groupedResults = Array.from(byTask.values()).map((t) => ({
      ...t,
      attempts: [...t.attempts].sort((a, b) => a.attempt - b.attempt),
    }));

    // Totals: avg_score and tasks_passed are based on the LAST attempt per task.
    const tasksAttempted = groupedResults.length;
    let lastAttemptScoreSum = 0;
    let tasksPassed = 0;
    for (const t of groupedResults) {
      const last = t.attempts.at(-1);
      if (!last) continue;
      lastAttemptScoreSum += last.score;
      if (last.passed) tasksPassed += 1;
    }
    const avgScore = tasksAttempted > 0 ? lastAttemptScoreSum / tasksAttempted : 0;

    // Reproduction bundle metadata via R2 head() — try/catch so a missing/erroring blob just omits the field.
    let reproductionBundle: { sha256: string; size_bytes: number } | undefined;
    if (run.reproduction_bundle_r2_key) {
      try {
        const head = await blobs.head(run.reproduction_bundle_r2_key);
        if (head) {
          reproductionBundle = {
            sha256: sha256FromKey(run.reproduction_bundle_r2_key),
            size_bytes: head.size,
          };
        }
      } catch {
        // omit field on head() error
      }
    }

    const body = {
      id: run.id,
      model: {
        slug: run.model_slug,
        display_name: run.model_display,
        api_model_id: run.model_api_id,
        family_slug: run.family_slug,
      },
      tier: run.tier,
      status: run.status,
      machine_id: run.machine_id,
      task_set_hash: run.task_set_hash,
      pricing_version: run.pricing_version,
      ...(run.centralgauge_sha ? { centralgauge_sha: run.centralgauge_sha } : {}),
      started_at: run.started_at,
      completed_at: run.completed_at ?? '',
      settings: {
        temperature: run.temperature ?? 0,
        max_attempts: run.max_attempts ?? 0,
        max_tokens: run.max_tokens ?? 0,
        prompt_version: run.prompt_version ?? '',
        bc_version: run.bc_version ?? '',
      },
      totals: {
        avg_score: avgScore,
        cost_usd: totalCostUsd,
        duration_ms: totalDurationMs,
        tasks_attempted: tasksAttempted,
        tasks_passed: tasksPassed,
      },
      results: groupedResults,
      ...(reproductionBundle ? { reproduction_bundle: reproductionBundle } : {}),
    };

    return cachedJson(request, body, { cacheControl: 'public, s-maxage=30, stale-while-revalidate=300' });
  } catch (err) {
    return errorResponse(err);
  }
};
