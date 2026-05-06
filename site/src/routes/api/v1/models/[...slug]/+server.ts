import type { RequestHandler } from "./$types";
import type {
  FailureMode,
  ModelDetail,
  ModelHistoryPoint,
} from "$shared/api-types";
import { cachedJson } from "$lib/server/cache";
import { getAll, getFirst } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";
import { computeModelAggregates } from "$lib/server/model-aggregates";
import { ServerTimer } from "$lib/server/server-timing";

interface ModelRow {
  id: number;
  slug: string;
  display_name: string;
  api_model_id: string;
  generation: number | null;
  released_at: string | null;
  family_id: number;
  family_slug: string;
}

interface RunRow {
  run_id: string;
  ts: string;
  score: number | string | null;
  cost_usd: number | string | null;
  tier: string;
}

interface CompileErrorRow {
  compile_errors_json: string;
}

interface CompileError {
  code?: string;
  message?: string;
}

const HISTORY_LIMIT = 30;
const RECENT_RUNS_LIMIT = 20;
const FAILURE_MODES_LIMIT = 10;

export const GET: RequestHandler = async ({ request, params, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const env = platform.env;

  try {
    const model = await getFirst<ModelRow>(
      env.DB,
      `SELECT m.id, m.slug, m.display_name, m.api_model_id, m.generation, m.released_at,
              m.family_id, mf.slug AS family_slug
       FROM models m JOIN model_families mf ON mf.id = m.family_id
       WHERE m.slug = ?`,
      [params.slug!],
    );
    if (!model) {
      throw new ApiError(404, "model_not_found", `No model '${params.slug}'`);
    }

    // 1. Aggregates (run_count, verified_runs, avg_score, avg_cost_usd,
    //    latency_p50_ms, tasks_*, pass_at_n, settings_suffix). Helper now
    //    supplies all per-task counts, so the legacy per-attempt SELECT below
    //    is no longer needed.
    const timer = new ServerTimer();

    const currentSetRow = await env.DB
      .prepare(`SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`)
      .first<{ hash: string }>();
    const taskSetHash = currentSetRow?.hash ?? null;

    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [model.id],
      taskSetHash,
      includeLatencyP50: true,
      includePassHatAtN: true,
      timer,
    });
    const agg = aggMap.get(model.id) ?? null;

    // 3. History — last N runs with per-run avg score + summed cost. We group
    //    by run_id over `v_results_with_cost` so cost lines up with the
    //    leaderboard formula (token counts × pricing_version rates).
    const historyRows = await getAll<RunRow>(
      env.DB,
      `SELECT runs.id AS run_id,
              runs.started_at AS ts,
              AVG(v.score) AS score,
              SUM(v.cost_usd) AS cost_usd,
              runs.tier AS tier
       FROM runs
       LEFT JOIN v_results_with_cost v ON v.run_id = runs.id
       WHERE runs.model_id = ?
       GROUP BY runs.id
       ORDER BY runs.started_at DESC
       LIMIT ?`,
      [model.id, HISTORY_LIMIT],
    );
    const history: ModelHistoryPoint[] = historyRows.map(toHistoryPoint);

    // 4. Recent runs — same shape as history, but capped at RECENT_RUNS_LIMIT.
    //    History already covers up to HISTORY_LIMIT (≥ RECENT_RUNS_LIMIT) so we
    //    can re-build from the same source rows. We map over `historyRows`
    //    again (rather than slicing `history`) so the response is a distinct
    //    object graph — `canonicalJSON` rejects shared sub-objects as cycles.
    const recentRuns: ModelHistoryPoint[] = historyRows
      .slice(0, RECENT_RUNS_LIMIT)
      .map(toHistoryPoint);

    // 5. Failure modes — fetch compile_errors_json from this model's results
    //    (parsing in TS rather than via D1 JSON1 keeps message extraction
    //    straightforward and avoids brittle SQL string-glue). Aggregate by
    //    error code, sorted by count desc, top FAILURE_MODES_LIMIT.
    const failureRows = await getAll<CompileErrorRow>(
      env.DB,
      `SELECT r.compile_errors_json
       FROM runs JOIN results r ON r.run_id = runs.id
       WHERE runs.model_id = ?
         AND r.compile_errors_json IS NOT NULL
         AND r.compile_errors_json != '[]'
         AND r.compile_errors_json != ''`,
      [model.id],
    );
    const failureModes = aggregateFailureModes(
      failureRows,
      FAILURE_MODES_LIMIT,
    );

    // 6. Predecessor — prior generation in the same family, if one exists.
    let predecessor: NonNullable<ModelDetail["predecessor"]> | undefined;
    if (model.generation !== null && model.generation > 1) {
      const prior = await getFirst<
        { id: number; slug: string; display_name: string }
      >(
        env.DB,
        `SELECT id, slug, display_name FROM models
         WHERE family_id = ? AND generation = ?
         ORDER BY id LIMIT 1`,
        [model.family_id, model.generation - 1],
      );
      if (prior) {
        const priorAgg = await computeModelAggregates(env.DB, {
          modelIds: [prior.id],
          taskSetHash,
        });
        const a = priorAgg.get(prior.id);
        if (a && a.run_count > 0) {
          predecessor = {
            slug: prior.slug,
            display_name: prior.display_name,
            avg_score: a.avg_score ?? 0,
            avg_cost_usd: a.avg_cost_usd ?? 0,
          };
        }
      }
    }

    // 7. added_at — there is no `models.added_at` column. Use released_at
    //    when present; otherwise fall back to MIN(runs.started_at) for this
    //    model so the page always has something to render.
    let addedAt = model.released_at ?? "";
    if (!addedAt) {
      const firstRun = await getFirst<{ first_seen: string | null }>(
        env.DB,
        `SELECT MIN(started_at) AS first_seen FROM runs WHERE model_id = ?`,
        [model.id],
      );
      addedAt = firstRun?.first_seen ?? "";
    }

    const runCount = agg?.run_count ?? 0;
    const tasksAttempted = agg?.tasks_attempted ?? 0;
    const tasksPassed = agg?.tasks_passed ?? 0;
    const tasksAttemptedDistinct = agg?.tasks_attempted_distinct ?? 0;
    const tasksPassedAttempt1 = agg?.tasks_passed_attempt_1 ?? 0;
    const tasksPassedAttempt2Only = agg?.tasks_passed_attempt_2_only ?? 0;
    const passAtN = agg?.pass_at_n ?? 0;
    const settingsSuffix = agg?.settings_suffix ?? "";

    const body: ModelDetail = {
      model: {
        slug: model.slug,
        display_name: model.display_name,
        api_model_id: model.api_model_id,
        family_slug: model.family_slug,
        added_at: addedAt,
        settings_suffix: settingsSuffix,
      },
      aggregates: {
        avg_score: agg?.avg_score ?? 0,
        tasks_attempted: tasksAttempted,
        tasks_passed: tasksPassed,
        tasks_attempted_distinct: tasksAttemptedDistinct,
        tasks_passed_attempt_1: tasksPassedAttempt1,
        tasks_passed_attempt_2_only: tasksPassedAttempt2Only,
        pass_at_n: passAtN,
        avg_cost_usd: agg?.avg_cost_usd ?? 0,
        latency_p50_ms: agg?.latency_p50_ms ?? 0,
        latency_p95_ms: agg?.latency_p95_ms ?? 0,
        pass_rate_ci: agg?.pass_rate_ci ?? { lower: 0, upper: 1 },
        pass_hat_at_n: agg?.pass_hat_at_n ?? 0,
        cost_per_pass_usd: agg?.cost_per_pass_usd ?? null,
        run_count: runCount,
        verified_runs: agg?.verified_runs ?? 0,
      },
      settings: {
        temperature: agg?.temperature ?? null,
        thinking_budget: agg?.thinking_budget ?? null,
        tokens_avg_per_run: agg?.tokens_avg_per_run ?? 0,
        consistency_pct: agg?.consistency_pct ?? 0,
      },
      history,
      failure_modes: failureModes,
      recent_runs: recentRuns,
      // Conditional spread: canonicalJSON rejects undefined, so omit the key
      // entirely when there is no predecessor.
      ...(predecessor ? { predecessor } : {}),
    };

    return cachedJson(request, body, {
      extraHeaders: { "server-timing": timer.header() },
    });
  } catch (err) {
    return errorResponse(err);
  }
};

function toHistoryPoint(row: RunRow): ModelHistoryPoint {
  // tier is constrained to 'verified' | 'claimed' on output (per ModelHistoryPoint).
  // The runs table also allows 'trusted' — bucket it under 'verified' for the
  // chart's two-tone color encoding.
  const tier: "verified" | "claimed" =
    row.tier === "verified" || row.tier === "trusted" ? "verified" : "claimed";
  return {
    run_id: row.run_id,
    ts: row.ts,
    score: row.score === null ? 0 : Number(Number(row.score).toFixed(6)),
    cost_usd: row.cost_usd === null
      ? 0
      : Number(Number(row.cost_usd).toFixed(6)),
    tier,
  };
}

function aggregateFailureModes(
  rows: CompileErrorRow[],
  limit: number,
): FailureMode[] {
  // Tally codes; remember the first message seen for each so the UI has an
  // example to show.
  const counts = new Map<string, { count: number; example: string }>();
  let total = 0;
  for (const row of rows) {
    let parsed: CompileError[];
    try {
      parsed = JSON.parse(row.compile_errors_json) as CompileError[];
    } catch {
      // Corrupt rows shouldn't sink the whole endpoint; skip.
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const err of parsed) {
      const code = err.code?.trim();
      if (!code) continue;
      total += 1;
      const entry = counts.get(code);
      if (entry) {
        entry.count += 1;
      } else {
        counts.set(code, { count: 1, example: err.message ?? "" });
      }
    }
  }
  if (total === 0) return [];
  const modes: FailureMode[] = [];
  for (const [code, { count, example }] of counts.entries()) {
    modes.push({
      code,
      count,
      pct: Math.round((count / total) * 1e6) / 1e6,
      example_message: example,
    });
  }
  modes.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return modes.slice(0, limit);
}
