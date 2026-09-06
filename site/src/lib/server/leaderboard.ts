import type {
  LeaderboardQuery,
  LeaderboardResponse,
  LeaderboardRow,
} from "$shared/api-types";
import { getAll } from "./db";
import { rowCostUsd } from "./cost-sql";
import { computeModelAggregates, type Aggregate } from "./model-aggregates";
import {
  formatSettingsSuffix,
  type SettingsProfileLike,
} from "./settings-suffix";
import type { ServerTimer } from "./server-timing";
import { computeDenominator } from "./denominator";
import { ApiError } from "./errors";
import { isValidTaskSetHash } from "../shared/task-set-hash";

export type { LeaderboardQuery, LeaderboardResponse, LeaderboardRow };

export async function computeLeaderboard(
  db: D1Database,
  q: LeaderboardQuery,
  timer?: ServerTimer,
): Promise<LeaderboardRow[]> {
  // ---------------------------------------------------------------------------
  // Resolve the task_set_hash for denominator computation.
  // Must happen BEFORE the main aggregate query so we can early-exit when
  // no current set exists (prevents an empty leaderboard from masking errors).
  // ---------------------------------------------------------------------------
  let resolvedHash: string | null = null;
  // Cached task_count from the set=current lookup (unfiltered path only).
  // When set, computeDenominator short-circuits and returns this value directly.
  let precomputedTaskCount: number | undefined;

  if (q.set === "current") {
    const noTaskFilter = !q.category && !q.difficulty;
    if (noTaskFilter) {
      // Merge hash + task_count into one query to avoid a second round trip
      // in computeDenominator (which would SELECT task_count by hash again).
      const row = await (timer
        ? timer.measure("task_set_resolve", () =>
            db
              .prepare(
                `SELECT hash, task_count FROM task_sets WHERE is_current = 1 LIMIT 1`,
              )
              .first<{ hash: string; task_count: number }>(),
          )
        : db
            .prepare(
              `SELECT hash, task_count FROM task_sets WHERE is_current = 1 LIMIT 1`,
            )
            .first<{ hash: string; task_count: number }>());
      resolvedHash = row?.hash ?? null;
      if (!resolvedHash) {
        // No current task set — nothing to display.
        return [];
      }
      precomputedTaskCount = row?.task_count ?? 0;
    } else {
      const row = await db
        .prepare(`SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`)
        .first<{ hash: string }>();
      resolvedHash = row?.hash ?? null;
      if (!resolvedHash) {
        return [];
      }
    }
  } else {
    // Explicit hash or invalid value — validate before proceeding.
    // Note: set='all' is rejected by the route before computeLeaderboard is called.
    if (!isValidTaskSetHash(q.set)) {
      throw new ApiError(
        400,
        "invalid_set",
        "set must be current or a 64-char hex task_set hash",
      );
    }
    resolvedHash = q.set;
  }

  // Compute the strict denominator: count of tasks in active scope.
  // Task-scope filters (category, difficulty) change the denominator.
  // Run-scope filters (tier, since, family) do NOT change the denominator.
  const denominator = resolvedHash
    ? await computeDenominator(
        db,
        {
          taskSetHash: resolvedHash,
          category: q.category,
          difficulty: q.difficulty,
          precomputedTaskCount,
        },
        timer,
      )
    : 0;

  // Empty scope — no tasks match the filter combination. Return early.
  if (resolvedHash && denominator === 0) {
    return [];
  }

  const wheres: string[] = [];
  const params: (string | number)[] = [];

  // Subquery interpolation slots — must mirror the OUTER WHERE clauses for
  // task_set / category / difficulty filters. Without these, correlated
  // subqueries that aggregate across `runs` would bleed in cross-task-set or
  // cross-category data (CR-5: Phase B critical fix).
  let taskSetClauseSubA1 = "";
  let taskSetClauseSubA2 = "";
  let taskSetClauseSubA2NotExists = "";
  // S7: bind params for the `?` placeholders in the three slots above.
  // q.set is already regex-validated (isValidTaskSetHash) before the
  // specific-hash branch below runs, so the prior string interpolation was
  // not exploitable — but it was a footgun inconsistent with the sibling
  // outer WHERE (`runs.task_set_hash = ?` two lines below), which DOES
  // bind. Empty when q.set === "current" (that branch uses a subselect,
  // not a literal value, so it needs no param).
  let taskSetParamsA1: string[] = [];
  let taskSetParamsA2: string[] = [];
  let taskSetParamsA2NotExists: string[] = [];

  // The outer WHERE's task-set predicate, captured verbatim so the
  // fallback_count merge query further down can reuse the SAME clause text
  // and bind values instead of maintaining a second, drift-prone copy. Both
  // queries alias the table as `runs`, so the text is portable as-is.
  let taskSetWhere = "";
  let taskSetWhereParams: string[] = [];

  if (q.set === "current") {
    taskSetWhere =
      `runs.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`;
    wheres.push(taskSetWhere);
    taskSetClauseSubA1 = `AND ru1.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`;
    taskSetClauseSubA2 = `AND ru2.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`;
    taskSetClauseSubA2NotExists = `AND ru1b.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`;
  } else if (q.set !== "all" && isValidTaskSetHash(q.set)) {
    // Specific task_set hash — every WHERE and correlated subquery slot
    // must scope to it so cross-hash data does not bleed into per-task
    // best-attempt aggregations (CR-5 invariant).
    taskSetWhere = `runs.task_set_hash = ?`;
    taskSetWhereParams = [q.set];
    wheres.push(taskSetWhere);
    params.push(q.set);
    taskSetClauseSubA1 = `AND ru1.task_set_hash = ?`;
    taskSetClauseSubA2 = `AND ru2.task_set_hash = ?`;
    taskSetClauseSubA2NotExists = `AND ru1b.task_set_hash = ?`;
    taskSetParamsA1 = [q.set];
    taskSetParamsA2 = [q.set];
    taskSetParamsA2NotExists = [q.set];
  }

  // A.5: Scope-aware IN-clause for numerator correlated subqueries.
  // When category or difficulty filters are active, p1 / p2_only must count
  // only tasks that belong to the active scope — otherwise a model that passed
  // easy tasks would show inflated numerators on a hard-filtered leaderboard.
  //
  // Three slots are needed because each correlated subquery uses a different
  // run/result alias (r1/ru1, r2/ru2, r1b/ru1b for the NOT EXISTS inner query).
  function buildScopeInClause(
    rAlias: string,
    ruAlias: string,
  ): { clause: string; params: Array<string | number> } {
    if (!q.category && !q.difficulty) return { clause: "", params: [] };
    const tc = q.category
      ? `JOIN task_categories tc_sub ON tc_sub.id = t_sub.category_id`
      : "";
    const tcWhere = q.category ? `AND tc_sub.slug = ?` : "";
    const diffWhere = q.difficulty ? `AND t_sub.difficulty = ?` : "";
    const clause = `AND ${rAlias}.task_id IN (
      SELECT t_sub.task_id FROM tasks t_sub ${tc}
      WHERE t_sub.task_set_hash = ${ruAlias}.task_set_hash ${diffWhere} ${tcWhere}
    )`;
    const bindParams: Array<string | number> = [];
    if (q.difficulty) bindParams.push(q.difficulty);
    if (q.category) bindParams.push(q.category);
    return { clause, params: bindParams };
  }

  const scopeInA1 = buildScopeInClause("r1", "ru1");
  const scopeInA2 = buildScopeInClause("r2", "ru2");
  const scopeInA2NotExists = buildScopeInClause("r1b", "ru1b");

  /**
   * Run-level filters mirrored into the correlated P1/P2 subqueries.
   *
   * `tier` and `since` restrict which RUNS are in scope, but the subqueries
   * join their own `runs` alias and were scoped only by model, task set,
   * category and difficulty. So a model that had one recent verified run
   * appeared in the outer result with pass numerators counted across ALL its
   * runs, including older and out-of-tier ones — a filtered leaderboard could
   * report a pass_at_1 that no in-scope run achieved.
   *
   * This is unlike `family` / `openness`, which are model-level: the outer
   * WHERE already decides which model_ids exist, and the subqueries correlate
   * on m.id, so those need no mirroring (see the comment above).
   *
   * Fixing this became urgent with epoch-keyed caching: a wrong number now
   * persists as the canonical answer served by every colo until the next
   * publish, rather than being recomputed within a minute.
   */
  function buildRunScopeClause(
    ruAlias: string,
  ): { clause: string; params: Array<string | number> } {
    const parts: string[] = [];
    const bind: Array<string | number> = [];
    if (q.tier !== "all") {
      parts.push(`AND ${ruAlias}.tier = ?`);
      bind.push(q.tier);
    }
    if (q.since) {
      parts.push(`AND ${ruAlias}.started_at >= ?`);
      bind.push(q.since);
    }
    return { clause: parts.join(" "), params: bind };
  }
  const runScopeA1 = buildRunScopeClause("ru1");
  const runScopeA2 = buildRunScopeClause("ru2");
  const runScopeA2NotExists = buildRunScopeClause("ru1b");
  if (q.tier !== "all") {
    wheres.push(`runs.tier = ?`);
    params.push(q.tier);
  }
  if (q.family) {
    wheres.push(`mf.slug = ?`);
    params.push(q.family);
  }
  // Phase 3 Task 4: openness filter. NULL-open_weight rows are excluded from
  // BOTH buckets — unknown openness should not claim either side. `mf` is
  // already JOIN'd in the main query (JOIN model_families mf ON mf.id = m.family_id).
  // This is a model-level (family-level) attribute that restricts which MODELS
  // appear; it does NOT need subquery mirroring in p1/p2 correlated subqueries
  // because those subqueries correlate on model_id (not family) and the outer
  // WHERE already restricts which model_ids are in scope.
  if (q.openness === 'open') {
    wheres.push('mf.open_weight = 1');
  } else if (q.openness === 'proprietary') {
    wheres.push('mf.open_weight = 0');
  }
  if (q.since) {
    wheres.push(`runs.started_at >= ?`);
    params.push(q.since);
  }

  // Difficulty filter operates at result level (filters which tasks contribute).
  // tasks.difficulty holds difficulty; no difficulty column on task_categories.
  const difficultyJoin = q.difficulty
    ? `JOIN tasks t ON t.task_id = r.task_id AND t.task_set_hash = runs.task_set_hash AND t.difficulty = ?`
    : "";
  if (q.difficulty) params.push(q.difficulty);

  // Category filter (P7 Phase C1) — JOINs tasks→task_categories scoped to the
  // run's task_set_hash so the filter respects the active set. Uses alias
  // `t_cat` to avoid colliding with the `t` alias used by difficulty.
  const categoryJoin = q.category
    ? `JOIN tasks t_cat ON t_cat.task_id = r.task_id AND t_cat.task_set_hash = runs.task_set_hash
       JOIN task_categories tc ON tc.id = t_cat.category_id`
    : "";
  if (q.category) {
    wheres.push(`tc.slug = ?`);
    params.push(q.category);
  }

  const whereClause = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";

  // ---------------------------------------------------------------------------
  // A.6: Build SQL ORDER BY expression for the requested sort field.
  //
  // All whitelisted sort fields (except latency_p95_ms) are sorted in SQL
  // BEFORE LIMIT so the correct top-N is fetched. Pre-A.6, the SQL always
  // used ORDER BY avg_score DESC and TS post-sorted pass_at_n / pass_at_1 /
  // cost_per_pass_usd / latency_p95_ms AFTER LIMIT — which dropped rows that
  // would have been promoted by the TS re-sort when limit < total models.
  //
  // latency_p95_ms: SQLite lacks PERCENTILE_CONT; the p95 is computed in TS
  // via computeModelAggregates after the SQL query. We widen the LIMIT to
  // LATENCY_WIDE_FETCH so the TS post-sort operates on enough rows, then trim
  // to q.limit. Direction is honoured in the TS sort.
  //
  // Bind order for the ORDER BY expressions that contain ? placeholders:
  //   1. taskSetParamsA1 + scopeInA1.params  (pass_at_1 / pass_at_n numerator
  //                                           SELECT subqueries)
  //   2. taskSetParamsA2NotExists + scopeInA2NotExists.params
  //   3. taskSetParamsA2 + scopeInA2.params
  //   4. params[]          (outer WHERE: task_set, tier, family, since,
  //                         difficulty JOIN, category WHERE)
  //   5. orderBy.extraParams  (task-set + scope-IN params for ORDER BY
  //                            subquery expressions + denominator for /N)
  //   6. sqlLimit          (LIMIT clause)
  //
  // The ORDER BY expressions for pass_at_n / pass_at_1 / cost_per_pass_usd are
  // correlated subqueries that reference m.id from the outer GROUP BY. They
  // duplicate the same task-set + scope-IN params used in the SELECT list
  // (those params appear at positions 1-3 above). SQLite textually evaluates
  // ORDER BY after GROUP BY, so the ORDER BY ?s come AFTER the WHERE ?s in
  // bind order. Within each P1_EXPR/P2_ONLY_EXPR occurrence, taskSetClauseSub*
  // textually precedes scopeIn*.clause (S7), so its param(s) must be spread
  // first.
  // ---------------------------------------------------------------------------

  // Sorting moved out of SQL entirely — see the TS sort near the end of this
  // function. WIDE_FETCH caps the unordered fetch; the trim to q.limit happens
  // after the sort, so no row that belongs in the top-N is dropped early.
  const WIDE_FETCH = 500;



  // Pass@1 / Pass@2 use correlated subqueries scoped to model_id (NOT run_id),
  // so multi-run "best across runs per task" semantics hold (cf. plan B1 design
  // rationale). The settings_profile_json CASE emits NULL when the model's
  // runs span multiple settings_hash values (suffix is ambiguous → omit).
  const sql = `
    SELECT
      m.id AS model_id,
      m.slug AS model_slug,
      m.display_name AS model_display,
      m.api_model_id AS model_api,
      mf.slug AS family_slug,
      mf.open_weight AS open_weight,
      -- Settings hash + ambiguity flag. The actual settings_profiles join
      -- happens in TS to sidestep SQLite "misuse of aggregate function MAX()"
      -- inside scalar subqueries that reference outer aggregates.
      CASE WHEN COUNT(DISTINCT runs.settings_hash) = 1 THEN MAX(runs.settings_hash) ELSE NULL END
        AS settings_hash_unique,
      COUNT(DISTINCT runs.id) AS run_count,
      COUNT(*) AS tasks_attempted,
      SUM(r.passed) AS tasks_passed,
      COUNT(DISTINCT r.task_id) AS tasks_attempted_distinct,
      (SELECT COUNT(DISTINCT r1.task_id)
       FROM results r1 JOIN runs ru1 ON ru1.id = r1.run_id
       WHERE ru1.model_id = m.id AND r1.attempt = 1 AND r1.passed = 1
         ${taskSetClauseSubA1}
         ${scopeInA1.clause}
         ${runScopeA1.clause}
      ) AS tasks_passed_attempt_1,
      (SELECT COUNT(DISTINCT r2.task_id)
       FROM results r2 JOIN runs ru2 ON ru2.id = r2.run_id
       WHERE ru2.model_id = m.id AND r2.attempt = 2 AND r2.passed = 1
         AND NOT EXISTS (
           SELECT 1 FROM results r1b JOIN runs ru1b ON ru1b.id = r1b.run_id
           WHERE ru1b.model_id = m.id AND r1b.task_id = r2.task_id
             AND r1b.attempt = 1 AND r1b.passed = 1
             ${taskSetClauseSubA2NotExists}
             ${scopeInA2NotExists.clause}
             ${runScopeA2NotExists.clause}
         )
         ${taskSetClauseSubA2}
         ${scopeInA2.clause}
         ${runScopeA2.clause}
      ) AS tasks_passed_attempt_2_only,
      AVG(r.score) AS avg_score,
      -- Per-task cost: total $ spent / distinct task count. Per-task is a
      -- fairer "what does X cost to use" number than per-attempt because a
      -- model that retries more would otherwise look cheaper (each retry
      -- is another data point dragging the per-attempt mean down).
      SUM(${rowCostUsd('r', 'cs', 'runs')}) / NULLIF(COUNT(DISTINCT r.task_id), 0) AS avg_cost_usd,
      MAX(runs.started_at) AS last_run_at
    FROM runs
    JOIN models m ON m.id = runs.model_id
    JOIN model_families mf ON mf.id = m.family_id
    JOIN results r ON r.run_id = runs.id
    ${difficultyJoin}
    ${categoryJoin}
    JOIN cost_snapshots cs ON cs.model_id = runs.model_id AND cs.pricing_version = runs.pricing_version
    ${whereClause}
    GROUP BY m.id
    LIMIT ?
  `;

  type Row = {
    model_id: number;
    model_slug: string;
    model_display: string;
    model_api: string;
    family_slug: string;
    open_weight: number | null;
    settings_hash_unique: string | null;
    run_count: number;
    tasks_attempted: number;
    tasks_passed: number;
    tasks_attempted_distinct: number;
    tasks_passed_attempt_1: number | string | null;
    tasks_passed_attempt_2_only: number | string | null;
    avg_score: number;
    avg_cost_usd: number;
    last_run_at: string;
  };

  // Bind order MUST follow textual `?` position in the SQL string, not
  // execution order. The three task-set + scope-IN subquery pairs appear in
  // the SELECT list (lines for tasks_passed_attempt_1 and
  // tasks_passed_attempt_2_only) which is BEFORE the FROM/JOIN/WHERE
  // clauses, so their `?`s bind first. Within each pair, taskSetClauseSub*
  // (S7: bound task_set_hash) textually precedes scopeIn*.clause.
  //   1. taskSetParamsA1 + scopeInA1.params  – inside tasks_passed_attempt_1
  //   2. taskSetParamsA2NotExists + scopeInA2NotExists.params – inside the
  //      NOT EXISTS
  //   3. taskSetParamsA2 + scopeInA2.params  – for tasks_passed_attempt_2_only
  //   4. params[]          – outer WHERE (task_set, tier, family, since,
  //                          difficulty JOIN, category WHERE)
  //   5. WIDE_FETCH        – LIMIT clause
  //
  // There are no ORDER BY params any more: sorting is done in TS, which is
  // what retired the fragile "one param set per textual occurrence of
  // P1_EXPR/P2_ONLY_EXPR" rule this comment used to have to describe.
  const allParams = [
    ...taskSetParamsA1,
    ...scopeInA1.params,
    ...runScopeA1.params,
    ...taskSetParamsA2NotExists,
    ...scopeInA2NotExists.params,
    ...runScopeA2NotExists.params,
    ...taskSetParamsA2,
    ...scopeInA2.params,
    ...runScopeA2.params,
    ...params,
    WIDE_FETCH,
  ];

  const rows = await (timer
    ? timer.measure("leaderboard_main", () => getAll<Row>(db, sql, allParams))
    : getAll<Row>(db, sql, allParams));

  // Resolve settings profiles in a separate batch lookup (only for rows with
  // a unique settings_hash). Sidesteps the SQLite "misuse of aggregate"
  // restriction on MAX() inside the main aggregate's scalar subquery.
  const uniqueHashes = Array.from(
    new Set(
      rows.map((r) => r.settings_hash_unique).filter((h): h is string => !!h),
    ),
  );
  const profileByHash = new Map<string, SettingsProfileLike>();
  if (uniqueHashes.length > 0) {
    const ph = uniqueHashes.map(() => "?").join(",");
    const profileRows = await getAll<{
      hash: string;
      temperature: number | null;
      max_tokens: number | null;
    }>(
      db,
      `SELECT hash, temperature, max_tokens FROM settings_profiles WHERE hash IN (${ph})`,
      uniqueHashes,
    );
    for (const p of profileRows) {
      profileByHash.set(p.hash, {
        temperature: typeof p.temperature === "number" ? p.temperature : null,
        max_tokens: typeof p.max_tokens === "number" ? p.max_tokens : null,
      });
    }
  }

  // Verified run count: delegate to computeModelAggregates so all callers
  // (this function, /api/v1/models, /api/v1/models/[slug]) compute it the
  // same way. B.3: pass the full filter scope (taskSetHash, category,
  // difficulty, tier, since) so that pass_rate_ci, cost_per_pass_usd, and
  // latency_p95_ms are computed against the same task/run subset as the
  // headline pass_at_n. Prior to B.3 these aggregates were unscoped
  // (taskSetCurrent=true only), producing inconsistent visible numbers when
  // category/difficulty/tier/since filters were active.
  const modelIds = rows.map((r) => r.model_id);
  const aggMap =
    modelIds.length === 0
      ? new Map<number, Aggregate>()
      : await computeModelAggregates(db, {
          modelIds,
          taskSetHash: resolvedHash,
          category: q.category,
          difficulty: q.difficulty,
          tier: q.tier === "all" ? undefined : q.tier,
          since: q.since,
          includeLatencyP50: true,
          includePassHatAtN: true,
          timer,
        });

  // ---------------------------------------------------------------------------
  // fallback_count: how many result rows a FALLBACK model served because the
  // requested model refused (`results.served_model IS NOT NULL`, migration
  // 0015).
  //
  // Deliberately a SEPARATE query rather than another correlated subquery in
  // the ranked SQL above. That statement's SELECT/ORDER BY bind order is
  // positional and hand-maintained (see the allParams comment); adding a
  // fourth subquery site would mean threading yet another param group through
  // it for a number that has no bearing on ranking.
  //
  // Scope: the ranked query's task-set predicate, reused verbatim via
  // `taskSetWhere`, plus the model ids that actually made the page. The row's
  // OTHER filters (tier / family / since / category / difficulty) are NOT
  // applied — this is a per-model caveat count, not a filtered metric, and
  // api-types.ts documents it as such.
  const fallbackByModel = new Map<number, number>();
  if (modelIds.length > 0) {
    const fallbackWheres = ["results.served_model IS NOT NULL"];
    const fallbackParams: Array<string | number> = [];
    if (taskSetWhere) {
      fallbackWheres.push(taskSetWhere);
      fallbackParams.push(...taskSetWhereParams);
    }
    fallbackWheres.push(
      `runs.model_id IN (${modelIds.map(() => "?").join(",")})`,
    );
    fallbackParams.push(...modelIds);

    const fallbackSql = `
      SELECT runs.model_id AS model_id, COUNT(*) AS n
      FROM results
      JOIN runs ON runs.id = results.run_id
      WHERE ${fallbackWheres.join(" AND ")}
      GROUP BY runs.model_id
    `;
    const fallbackRows = await (timer
      ? timer.measure("leaderboard_fallback", () =>
          getAll<{ model_id: number; n: number }>(
            db,
            fallbackSql,
            fallbackParams,
          ),
        )
      : getAll<{ model_id: number; n: number }>(
          db,
          fallbackSql,
          fallbackParams,
        ));
    for (const fr of fallbackRows) {
      fallbackByModel.set(Number(fr.model_id), Number(fr.n ?? 0));
    }
  }

  const mapped: LeaderboardRow[] = rows.map((r, idx) => {
    const passedA1 = Number(r.tasks_passed_attempt_1 ?? 0);
    const passedA2Only = Number(r.tasks_passed_attempt_2_only ?? 0);
    const attemptedDistinct = Number(r.tasks_attempted_distinct ?? 0);

    // Strict pass rates: denominator = task_count of the active scope.
    // Numerators (p1, p2_only) are scope-filtered by category/difficulty (A.5)
    // so numerator and denominator always reflect the same task subset.
    const passAtNStrict =
      denominator > 0 ? (passedA1 + passedA2Only) / denominator : 0;
    const passAt1Strict = denominator > 0 ? passedA1 / denominator : 0;

    // Solve AUC@2 — single-numerator form: (2·p1 + p2_only) / (2·d).
    // Using one division instead of two keeps the result bit-identical to
    // what the client recomputes from auc_2Display, avoiding float drift.
    const aucStrict =
      denominator > 0 ? (2 * passedA1 + passedA2Only) / (2 * denominator) : 0;
    // Conditional repair rate; 0 when nothing failed first try.
    const repairRate =
      passAt1Strict < 1 ? (passAtNStrict - passAt1Strict) / (1 - passAt1Strict) : 0;

    const profile = r.settings_hash_unique
      ? (profileByHash.get(r.settings_hash_unique) ?? null)
      : null;
    const settingsSuffix = formatSettingsSuffix(profile);

    return {
      rank: idx + 1,
      model: {
        slug: r.model_slug,
        display_name: r.model_display,
        api_model_id: r.model_api,
        settings_suffix: settingsSuffix,
      },
      family_slug: r.family_slug,
      open_weight: r.open_weight === null || r.open_weight === undefined ? null : r.open_weight === 1,
      run_count: r.run_count,
      tasks_attempted: r.tasks_attempted,
      tasks_passed: r.tasks_passed ?? 0,
      tasks_attempted_distinct: attemptedDistinct,
      tasks_passed_attempt_1: passedA1,
      tasks_passed_attempt_2_only: passedA2Only,
      pass_at_n: Math.round(passAtNStrict * 1e6) / 1e6,
      pass_at_1: Math.round(passAt1Strict * 1e6) / 1e6,
      auc_2: Math.round(aucStrict * 1e6) / 1e6,
      repair_rate: Math.round(repairRate * 1e6) / 1e6,
      denominator,
      fallback_count: fallbackByModel.get(r.model_id) ?? 0,
      avg_score: Math.round(+(r.avg_score ?? 0) * 1e6) / 1e6,
      avg_cost_usd: Math.round(+(r.avg_cost_usd ?? 0) * 1e6) / 1e6,
      verified_runs: aggMap.get(r.model_id)?.verified_runs ?? 0,
      last_run_at: r.last_run_at,
      latency_p95_ms: aggMap.get(r.model_id)?.latency_p95_ms ?? 0,
      pass_rate_ci: aggMap.get(r.model_id)?.pass_rate_ci ?? {
        lower: 0,
        upper: 1,
      },
      pass_hat_at_n: aggMap.get(r.model_id)?.pass_hat_at_n ?? 0,
      cost_per_pass_usd: aggMap.get(r.model_id)?.cost_per_pass_usd ?? null,
    };
  });

  // ---------------------------------------------------------------------------
  // Sorting. All of it, in TypeScript.
  //
  // This used to be a SQL ORDER BY. For auc_2 / pass_at_n / pass_at_1 /
  // cost_per_pass_usd that clause repeated the P1/P2 correlated subqueries, and
  // SQLite re-evaluates them to build the sort key instead of reusing the
  // SELECT-list columns it just computed. Measured against production D1 on the
  // default auc_2 sort:
  //
  //     full query, with ORDER BY .................. 117,015 rows read
  //     identical query, ORDER BY removed ..........  12,605 rows read
  //     ORDER BY rewritten to reference aliases .... 117,015 (no help)
  //     MATERIALIZED CTE + outer ORDER BY ..........  61,495 (partial)
  //
  // So ~90% of the cost of the most expensive query in the system was spent
  // ordering ~22 rows. Every sort key is already computed above from the same
  // integers, so doing it here is both free and exact.
  //
  // It also retires buildOrderBy()'s bind-order plumbing, which had to
  // interleave one set of task-set + scope-IN params per *textual occurrence*
  // of P1_EXPR/P2_ONLY_EXPR and had already caused a bind-order bug under
  // category/difficulty filters.
  //
  // The pre-A.6 "LIMIT then re-sort" bug does not come back: SQL now fetches up
  // to WIDE_FETCH rows unordered, and the trim to q.limit happens after this
  // sort, so nothing that belongs in the top-N can be dropped beforehand.
  // ---------------------------------------------------------------------------
  const sortable = mapped.map((row, i) => ({ row, modelId: rows[i].model_id }));

  if (q.sort === "latency_p95_ms") {
    // Preserved verbatim. 0 means "no data" and must sort LAST in both
    // directions, which the generic null-is-lowest rule below would get wrong.
    if (q.direction === "asc") {
      sortable.sort(
        (a, b) =>
          (a.row.latency_p95_ms || Infinity) - (b.row.latency_p95_ms || Infinity) ||
          b.row.model.slug.localeCompare(a.row.model.slug),
      );
    } else {
      sortable.sort(
        (a, b) =>
          (b.row.latency_p95_ms || -Infinity) - (a.row.latency_p95_ms || -Infinity) ||
          b.row.model.slug.localeCompare(a.row.model.slug),
      );
    }
  } else {
    const dirMul = q.direction === "asc" ? 1 : -1;
    // Comparison rather than subtraction: -Infinity minus -Infinity is NaN,
    // which would corrupt the sort when two rows both have a null key.
    const cmp = (x: number, y: number) => (x < y ? -1 : x > y ? 1 : 0);
    // SQLite orders NULL below every value, so DESC puts nulls last and ASC
    // puts them first. -Infinity reproduces that ordering exactly.
    const nz = (v: number | null | undefined) =>
      v === null || v === undefined ? -Infinity : v;

    // nz() on every key: several of these fields are optional on
    // LeaderboardRow (auc_2 and pass_at_1 were added in later cache versions),
    // and an absent key must order like SQL NULL rather than crash or become
    // NaN.
    const aucKey = (r: LeaderboardRow) => nz(r.auc_2);
    const keyOf: Record<string, (r: LeaderboardRow) => number> = {
      auc_2: aucKey,
      pass_at_n: (r) => nz(r.pass_at_n),
      pass_at_1: (r) => nz(r.pass_at_1),
      avg_score: (r) => nz(r.avg_score),
      avg_cost_usd: (r) => nz(r.avg_cost_usd),
      cost_per_pass_usd: (r) => nz(r.cost_per_pass_usd),
    };
    const key = keyOf[q.sort] ?? aucKey;
    // auc_2 and pass_at_n tie-break on pass_at_1 in the SAME direction before
    // falling through to model id, mirroring the old ORDER BY chains. Without
    // that middle tier, models tied on the headline metric collapse to newest-
    // model-wins regardless of first-try quality.
    const passAt1Tiebreak = q.sort === "auc_2" || q.sort === "pass_at_n";

    sortable.sort((a, b) => {
      const d = cmp(key(a.row), key(b.row)) * dirMul;
      if (d !== 0) return d;
      if (passAt1Tiebreak) {
        const t = cmp(nz(a.row.pass_at_1), nz(b.row.pass_at_1)) * dirMul;
        if (t !== 0) return t;
      }
      return b.modelId - a.modelId; // m.id DESC, as the SQL tiebreaker was
    });
  }

  const trimmed = sortable.slice(0, q.limit).map((e) => e.row);
  trimmed.forEach((row, idx) => {
    row.rank = idx + 1;
  });
  return trimmed;
}
