import type {
  LeaderboardQuery,
  LeaderboardResponse,
  LeaderboardRow,
} from "$shared/api-types";
import { getAll } from "./db";
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

  if (q.set === "current") {
    wheres.push(
      `runs.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`,
    );
    taskSetClauseSubA1 = `AND ru1.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`;
    taskSetClauseSubA2 = `AND ru2.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`;
    taskSetClauseSubA2NotExists = `AND ru1b.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`;
  } else if (q.set !== "all" && isValidTaskSetHash(q.set)) {
    // Specific task_set hash — every WHERE and correlated subquery slot
    // must scope to it so cross-hash data does not bleed into per-task
    // best-attempt aggregations (CR-5 invariant).
    wheres.push(`runs.task_set_hash = ?`);
    params.push(q.set);
    taskSetClauseSubA1 = `AND ru1.task_set_hash = '${q.set}'`;
    taskSetClauseSubA2 = `AND ru2.task_set_hash = '${q.set}'`;
    taskSetClauseSubA2NotExists = `AND ru1b.task_set_hash = '${q.set}'`;
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
  if (q.tier !== "all") {
    wheres.push(`runs.tier = ?`);
    params.push(q.tier);
  }
  if (q.family) {
    wheres.push(`mf.slug = ?`);
    params.push(q.family);
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
  //   1. scopeInA1.params  (pass_at_1 / pass_at_n numerator SELECT subqueries)
  //   2. scopeInA2NotExists.params
  //   3. scopeInA2.params
  //   4. params[]          (outer WHERE: task_set, tier, family, since,
  //                         difficulty JOIN, category WHERE)
  //   5. orderBy.extraParams  (scope-IN params for ORDER BY subquery
  //                            expressions + denominator for /N)
  //   6. sqlLimit          (LIMIT clause)
  //
  // The ORDER BY expressions for pass_at_n / pass_at_1 / cost_per_pass_usd /
  // pass_at_n_per_attempted are correlated subqueries that reference m.id from
  // the outer GROUP BY. They duplicate the same scope-IN params used in the
  // SELECT list (those params appear at positions 1-3 above). SQLite textually
  // evaluates ORDER BY after GROUP BY, so the ORDER BY ?s come AFTER the
  // WHERE ?s in bind order.
  // ---------------------------------------------------------------------------

  const LATENCY_WIDE_FETCH = 200;

  /**
   * Build the SQL ORDER BY clause and any extra bind params needed for it.
   *
   * Returns `{ clause, extraParams, sqlLimit }`.
   *   - `clause`       — the full `ORDER BY ... ` string (empty for latency).
   *   - `extraParams`  — bind values for any `?` in the ORDER BY expression.
   *   - `sqlLimit`     — the LIMIT value to pass to SQL (q.limit normally;
   *                      LATENCY_WIDE_FETCH for latency_p95_ms).
   */
  function buildOrderBy(): {
    clause: string;
    extraParams: Array<string | number>;
    sqlLimit: number;
  } {
    const dir = q.direction === "asc" ? "ASC" : "DESC";
    // Final tiebreaker: model.id DESC for deterministic ordering.
    const tie = `, m.id DESC`;

    // Correlated subquery expressions reused from the SELECT list.
    // These must include the same scope-IN clauses so ORDER BY matches the
    // denominator semantics (same scope in SELECT and ORDER BY).
    const P1_EXPR = `(SELECT COUNT(DISTINCT r1.task_id)
       FROM results r1 JOIN runs ru1 ON ru1.id = r1.run_id
       WHERE ru1.model_id = m.id AND r1.attempt = 1 AND r1.passed = 1
         ${taskSetClauseSubA1}
         ${scopeInA1.clause})`;
    const P2_ONLY_EXPR = `(SELECT COUNT(DISTINCT r2.task_id)
       FROM results r2 JOIN runs ru2 ON ru2.id = r2.run_id
       WHERE ru2.model_id = m.id AND r2.attempt = 2 AND r2.passed = 1
         AND NOT EXISTS (
           SELECT 1 FROM results r1b JOIN runs ru1b ON ru1b.id = r1b.run_id
           WHERE ru1b.model_id = m.id AND r1b.task_id = r2.task_id
             AND r1b.attempt = 1 AND r1b.passed = 1
             ${taskSetClauseSubA2NotExists}
             ${scopeInA2NotExists.clause}
         )
         ${taskSetClauseSubA2}
         ${scopeInA2.clause})`;

    switch (q.sort) {
      case "pass_at_n":
        // Strict: (p1 + p2_only) / denominator. Same denominator used in SELECT.
        return {
          clause: `ORDER BY (${P1_EXPR} + ${P2_ONLY_EXPR}) * 1.0 / NULLIF(?, 0) ${dir}${tie}`,
          extraParams: [
            ...scopeInA1.params,
            ...scopeInA2NotExists.params,
            ...scopeInA2.params,
            denominator,
          ],
          sqlLimit: q.limit,
        };

      case "pass_at_1":
        // Strict first-try rate: p1 / denominator.
        return {
          clause: `ORDER BY ${P1_EXPR} * 1.0 / NULLIF(?, 0) ${dir}${tie}`,
          extraParams: [...scopeInA1.params, denominator],
          sqlLimit: q.limit,
        };

      case "avg_score":
        // AVG(r.score) is a plain aggregate — directly referenceable in ORDER BY.
        return {
          clause: `ORDER BY AVG(r.score) ${dir}${tie}`,
          extraParams: [],
          sqlLimit: q.limit,
        };

      case "avg_cost_usd":
        // Repeat the expression (SQLite cannot reference SELECT aliases in ORDER BY).
        return {
          clause: `ORDER BY SUM((r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0) / NULLIF(COUNT(DISTINCT r.task_id), 0) ${dir}${tie}`,
          extraParams: [],
          sqlLimit: q.limit,
        };

      case "cost_per_pass_usd":
        // Total cost / tasks_passed_strict (p1 + p2_only). Nullif prevents /0.
        // The SQL expression contains P1_EXPR + P2_ONLY_EXPR ONCE each, so only
        // ONE set of scope-IN params is required (not two). Duplicating them
        // causes a bind-order bug when category/difficulty filters are active.
        return {
          clause: `ORDER BY (SUM((r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0) / NULLIF(${P1_EXPR} + ${P2_ONLY_EXPR}, 0)) ${dir}${tie}`,
          extraParams: [
            ...scopeInA1.params,
            ...scopeInA2NotExists.params,
            ...scopeInA2.params,
          ],
          sqlLimit: q.limit,
        };

      case "pass_at_n_per_attempted":
        // Legacy per-attempted: (p1 + p2_only) / tasks_attempted_distinct.
        return {
          clause: `ORDER BY (${P1_EXPR} + ${P2_ONLY_EXPR}) * 1.0 / NULLIF(COUNT(DISTINCT r.task_id), 0) ${dir}${tie}`,
          extraParams: [
            ...scopeInA1.params,
            ...scopeInA2NotExists.params,
            ...scopeInA2.params,
          ],
          sqlLimit: q.limit,
        };

      case "latency_p95_ms":
        // SQLite lacks PERCENTILE_CONT; the p95 is computed in TS via
        // computeModelAggregates. Use a wide SQL LIMIT so the TS post-sort
        // operates on a large enough pool; direction is honoured in TS.
        return {
          clause: `ORDER BY avg_score DESC${tie}`,
          extraParams: [],
          sqlLimit: LATENCY_WIDE_FETCH,
        };
    }
  }

  const orderBy = buildOrderBy();

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
         )
         ${taskSetClauseSubA2}
         ${scopeInA2.clause}
      ) AS tasks_passed_attempt_2_only,
      AVG(r.score) AS avg_score,
      -- Per-task cost: total $ spent / distinct task count. Per-task is a
      -- fairer "what does X cost to use" number than per-attempt because a
      -- model that retries more would otherwise look cheaper (each retry
      -- is another data point dragging the per-attempt mean down).
      SUM(
        (r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0
      ) / NULLIF(COUNT(DISTINCT r.task_id), 0) AS avg_cost_usd,
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
    ${orderBy.clause}
    LIMIT ?
  `;

  type Row = {
    model_id: number;
    model_slug: string;
    model_display: string;
    model_api: string;
    family_slug: string;
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
  // execution order. The three scope-IN subqueries appear in the SELECT list
  // (lines for tasks_passed_attempt_1 and tasks_passed_attempt_2_only) which
  // is BEFORE the FROM/JOIN/WHERE clauses, so their `?`s bind first.
  //   1. scopeInA1.params  – task_id IN (...) inside tasks_passed_attempt_1
  //   2. scopeInA2NotExists.params – task_id IN (...) inside the NOT EXISTS
  //   3. scopeInA2.params  – task_id IN (...) for tasks_passed_attempt_2_only
  //   4. params[]          – outer WHERE (task_set, tier, family, since,
  //                          difficulty JOIN, category WHERE)
  //   5. orderBy.extraParams – ORDER BY subquery scope-IN params + denominator
  //                            (A.6: one set per ORDER BY expression)
  //   6. orderBy.sqlLimit  – LIMIT clause
  const allParams = [
    ...scopeInA1.params,
    ...scopeInA2NotExists.params,
    ...scopeInA2.params,
    ...params,
    ...orderBy.extraParams,
    orderBy.sqlLimit,
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

    // Legacy per-attempted formula (deprecated alias, removed in PR2).
    const passAtNPerAttempted =
      attemptedDistinct > 0
        ? (passedA1 + passedA2Only) / attemptedDistinct
        : 0;

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
      run_count: r.run_count,
      tasks_attempted: r.tasks_attempted,
      tasks_passed: r.tasks_passed ?? 0,
      tasks_attempted_distinct: attemptedDistinct,
      tasks_passed_attempt_1: passedA1,
      tasks_passed_attempt_2_only: passedA2Only,
      pass_at_n: Math.round(passAtNStrict * 1e6) / 1e6,
      pass_at_1: Math.round(passAt1Strict * 1e6) / 1e6,
      denominator,
      pass_at_n_per_attempted: Math.round(passAtNPerAttempted * 1e6) / 1e6,
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

  // A.6: TS post-sort for latency_p95_ms only.
  //
  // All other sort fields are now handled in SQL ORDER BY before LIMIT
  // (see buildOrderBy() above). latency_p95_ms is the sole exception because
  // SQLite lacks PERCENTILE_CONT — the p95 is computed in TS from per-result
  // duration rows via computeModelAggregates (latencyPercentilesByModel).
  // To avoid the pre-A.6 LIMIT-then-sort bug, buildOrderBy() widens the SQL
  // LIMIT to LATENCY_WIDE_FETCH (200) for this sort field, giving the TS
  // post-sort a large enough pool to work with. The trimmed slice is returned.
  if (q.sort === "latency_p95_ms") {
    if (q.direction === "asc") {
      // Ascending: lower latency first; 0 (no data) sorts last.
      mapped.sort(
        (a, b) =>
          (a.latency_p95_ms || Infinity) - (b.latency_p95_ms || Infinity) ||
          b.model.slug.localeCompare(a.model.slug),
      );
    } else {
      // Descending: higher latency first; 0 (no data) sorts last.
      mapped.sort(
        (a, b) =>
          (b.latency_p95_ms || -Infinity) - (a.latency_p95_ms || -Infinity) ||
          b.model.slug.localeCompare(a.model.slug),
      );
    }
    // Trim to the requested limit (SQL fetched LATENCY_WIDE_FETCH rows).
    const trimmed = mapped.slice(0, q.limit);
    trimmed.forEach((row, idx) => {
      row.rank = idx + 1;
    });
    return trimmed;
  }

  return mapped;
}
