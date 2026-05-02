/**
 * SQLite implementation of StatsStorage interface
 */

// Type-only import — runtime load deferred to `open()` so the FFI-backed
// SQLite npm dep doesn't require `--unstable-ffi` (and Linux Deno CI's npm
// init quirks) until stats storage is actually opened. CLI entry points
// that don't touch stats (doctor, lifecycle digest) skip the load entirely.
import type { Database } from "@db/sqlite";
import { StateError } from "../errors.ts";
import type { StatsStorage } from "./interfaces.ts";
import {
  CREATE_SCHEMA,
  CREATE_VIEWS,
  MIGRATIONS,
  SCHEMA_VERSION,
} from "./schema.ts";
import type {
  CostBreakdown,
  CostOptions,
  GetResultsOptions,
  ListRunsOptions,
  ModelComparison,
  Regression,
  RegressionOptions,
  ResultRecord,
  RunRecord,
  TaskComparisonDetail,
  TaskSetSummary,
  TrendOptions,
  TrendPoint,
  VariantRunGroup,
} from "./types.ts";

/**
 * SQLite-based storage for benchmark statistics
 */
export class SqliteStorage implements StatsStorage {
  private db: Database | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  // ============ Lifecycle ============

  async open(): Promise<void> {
    if (this.db) {
      return; // Already open
    }

    // Ensure directory exists
    const dir = this.dbPath.substring(0, this.dbPath.lastIndexOf("/"));
    if (dir) {
      try {
        await Deno.mkdir(dir, { recursive: true });
      } catch (e) {
        if (!(e instanceof Deno.errors.AlreadyExists)) {
          throw e;
        }
      }
    }

    const { Database: DatabaseCtor } = await import("@db/sqlite");
    this.db = new DatabaseCtor(this.dbPath);

    // Enable foreign keys
    this.db.exec("PRAGMA foreign_keys = ON");

    // Create schema
    await this.initSchema();
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    await Promise.resolve();
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  private getDb(): Database {
    if (!this.db) {
      throw new StateError(
        "Database not open. Call open() first.",
        "closed",
        "open",
      );
    }
    return this.db;
  }

  private async initSchema(): Promise<void> {
    const db = this.getDb();

    // Check current schema version
    const versionTable = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
    ).value<[string]>();

    let currentVersion = 0;
    if (versionTable) {
      const row = db.prepare(
        "SELECT MAX(version) FROM schema_version",
      ).value<[number]>();
      currentVersion = row?.[0] ?? 0;
    }

    if (currentVersion === 0) {
      // Fresh install - create schema
      db.exec(CREATE_SCHEMA);
      db.exec(CREATE_VIEWS);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
        SCHEMA_VERSION,
      );
    } else if (currentVersion < SCHEMA_VERSION) {
      // Apply migrations
      for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
        const migration = MIGRATIONS[v];
        if (migration) {
          db.exec(migration);
          db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(v);
        }
      }
    }

    await Promise.resolve();
  }

  // ============ Runs ============

  async persistRun(run: RunRecord): Promise<void> {
    const db = this.getDb();

    db.prepare(`
      INSERT INTO runs (
        run_id, executed_at, config_hash, task_set_hash,
        total_tasks, total_models, total_cost, total_tokens,
        total_duration_ms, pass_rate_1, pass_rate_2,
        overall_pass_rate, average_score, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.runId,
      run.executedAt.toISOString(),
      run.configHash,
      run.taskSetHash,
      run.totalTasks,
      run.totalModels,
      run.totalCost,
      run.totalTokens,
      run.totalDurationMs,
      run.passRate1,
      run.passRate2,
      run.overallPassRate,
      run.averageScore,
      run.metadata ? JSON.stringify(run.metadata) : null,
    );

    await Promise.resolve();
  }

  getRun(runId: string): Promise<RunRecord | null> {
    const db = this.getDb();

    const row = db.prepare(`
      SELECT run_id, executed_at, config_hash, task_set_hash,
             total_tasks, total_models, total_cost, total_tokens,
             total_duration_ms, pass_rate_1, pass_rate_2,
             overall_pass_rate, average_score, metadata_json
      FROM runs WHERE run_id = ?
    `).value<[
      string,
      string,
      string,
      string,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      string | null,
    ]>(runId);

    if (!row) {
      return Promise.resolve(null);
    }

    return Promise.resolve(this.rowToRunRecord(row));
  }

  listRuns(options: ListRunsOptions = {}): Promise<RunRecord[]> {
    const db = this.getDb();

    let sql = `
      SELECT run_id, executed_at, config_hash, task_set_hash,
             total_tasks, total_models, total_cost, total_tokens,
             total_duration_ms, pass_rate_1, pass_rate_2,
             overall_pass_rate, average_score, metadata_json
      FROM runs WHERE 1=1
    `;
    const params: (string | number | null)[] = [];

    if (options.configHash) {
      sql += " AND config_hash = ?";
      params.push(options.configHash);
    }
    if (options.taskSetHash) {
      sql += " AND task_set_hash = ?";
      params.push(options.taskSetHash);
    }
    if (options.since) {
      sql += " AND executed_at >= ?";
      params.push(options.since.toISOString());
    }
    if (options.until) {
      sql += " AND executed_at <= ?";
      params.push(options.until.toISOString());
    }

    sql += " ORDER BY executed_at DESC";

    if (options.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }
    if (options.offset) {
      sql += " OFFSET ?";
      params.push(options.offset);
    }

    const stmt = db.prepare(sql);
    const rows = stmt.values<[
      string,
      string,
      string,
      string,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      string | null,
    ]>(...params);

    return Promise.resolve(rows.map((row) => this.rowToRunRecord(row)));
  }

  hasRun(runId: string): Promise<boolean> {
    const db = this.getDb();
    const row = db.prepare(
      "SELECT 1 FROM runs WHERE run_id = ?",
    ).value<[number]>(runId);
    return Promise.resolve(row !== undefined);
  }

  deleteRun(runId: string): Promise<boolean> {
    const db = this.getDb();
    const result = db.prepare("DELETE FROM runs WHERE run_id = ?").run(runId);
    return Promise.resolve(result > 0);
  }

  private rowToRunRecord(
    row: [
      string,
      string,
      string,
      string,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      string | null,
    ],
  ): RunRecord {
    return {
      runId: row[0],
      executedAt: new Date(row[1]),
      configHash: row[2],
      taskSetHash: row[3],
      totalTasks: row[4],
      totalModels: row[5],
      totalCost: row[6],
      totalTokens: row[7],
      totalDurationMs: row[8],
      passRate1: row[9],
      passRate2: row[10],
      overallPassRate: row[11],
      averageScore: row[12],
      metadata: row[13] ? JSON.parse(row[13]) : undefined,
    };
  }

  // ============ Results ============

  async persistResults(runId: string, results: ResultRecord[]): Promise<void> {
    const db = this.getDb();

    const stmt = db.prepare(`
      INSERT INTO results (
        run_id, task_id, variant_id, model, provider,
        success, final_score, passed_attempt,
        total_tokens, prompt_tokens, completion_tokens,
        total_cost, total_duration_ms,
        variant_config_json, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec("BEGIN TRANSACTION");
    try {
      for (const r of results) {
        stmt.run(
          runId,
          r.taskId,
          r.variantId,
          r.model,
          r.provider,
          r.success ? 1 : 0,
          r.finalScore,
          r.passedAttempt,
          r.totalTokens,
          r.promptTokens,
          r.completionTokens,
          r.totalCost,
          r.totalDurationMs,
          r.variantConfig ? JSON.stringify(r.variantConfig) : null,
          r.resultJson ?? null,
        );
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }

    await Promise.resolve();
  }

  getResults(options: GetResultsOptions): Promise<ResultRecord[]> {
    const db = this.getDb();

    let sql = `
      SELECT run_id, task_id, variant_id, model, provider,
             success, final_score, passed_attempt,
             total_tokens, prompt_tokens, completion_tokens,
             total_cost, total_duration_ms,
             variant_config_json, result_json
      FROM results WHERE 1=1
    `;
    const params: (string | number | null)[] = [];

    if (options.runId) {
      sql += " AND run_id = ?";
      params.push(options.runId);
    }
    if (options.taskId) {
      sql += " AND task_id = ?";
      params.push(options.taskId);
    }
    if (options.variantId) {
      sql += " AND variant_id = ?";
      params.push(options.variantId);
    }
    if (options.provider) {
      sql += " AND provider = ?";
      params.push(options.provider);
    }
    if (options.success !== undefined) {
      sql += " AND success = ?";
      params.push(options.success ? 1 : 0);
    }

    sql += " ORDER BY created_at DESC";

    if (options.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }
    if (options.offset) {
      sql += " OFFSET ?";
      params.push(options.offset);
    }

    const rows = db.prepare(sql).values<[
      string,
      string,
      string,
      string,
      string,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      string | null,
      string | null,
    ]>(...params);

    return Promise.resolve(rows.map((row) => this.rowToResultRecord(row)));
  }

  getVariantIds(): Promise<string[]> {
    const db = this.getDb();
    const rows = db.prepare(
      "SELECT DISTINCT variant_id FROM results ORDER BY variant_id",
    ).values<[string]>();
    return Promise.resolve(rows.map((row) => row[0]));
  }

  getTaskIds(): Promise<string[]> {
    const db = this.getDb();
    const rows = db.prepare(
      "SELECT DISTINCT task_id FROM results ORDER BY task_id",
    ).values<[string]>();
    return Promise.resolve(rows.map((row) => row[0]));
  }

  private rowToResultRecord(
    row: [
      string,
      string,
      string,
      string,
      string,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      string | null,
      string | null,
    ],
  ): ResultRecord {
    return {
      taskId: row[1],
      variantId: row[2],
      model: row[3],
      provider: row[4],
      success: row[5] === 1,
      finalScore: row[6],
      passedAttempt: row[7],
      totalTokens: row[8],
      promptTokens: row[9],
      completionTokens: row[10],
      totalCost: row[11],
      totalDurationMs: row[12],
      variantConfig: row[13] ? JSON.parse(row[13]) : undefined,
      resultJson: row[14] ?? undefined,
    };
  }

  // ============ Analytics Queries ============

  getModelTrend(
    variantId: string,
    options: TrendOptions = {},
  ): Promise<TrendPoint[]> {
    const db = this.getDb();

    let sql = `
      SELECT
        r.run_id,
        runs.executed_at,
        SUM(r.success) as passed,
        COUNT(*) as total,
        AVG(r.final_score) as avg_score,
        SUM(r.total_cost) as cost
      FROM results r
      JOIN runs ON r.run_id = runs.run_id
      WHERE r.variant_id = ?
    `;
    const params: (string | number | null)[] = [variantId];

    if (options.taskId) {
      sql += " AND r.task_id = ?";
      params.push(options.taskId);
    }
    if (options.since) {
      sql += " AND runs.executed_at >= ?";
      params.push(options.since.toISOString());
    }

    sql += " GROUP BY r.run_id ORDER BY runs.executed_at DESC";

    if (options.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = db.prepare(sql).values<
      [string, string, number, number, number, number]
    >(...params);

    return Promise.resolve(
      rows.map((row) => ({
        runId: row[0],
        executedAt: new Date(row[1]),
        passed: row[2],
        total: row[3],
        avgScore: row[4],
        cost: row[5],
      })),
    );
  }

  compareModels(
    variant1: string,
    variant2: string,
  ): Promise<ModelComparison> {
    const db = this.getDb();

    // Get per-task comparison from latest results
    const sql = `
      WITH latest AS (
        SELECT task_id, variant_id, final_score,
               ROW_NUMBER() OVER (PARTITION BY task_id, variant_id ORDER BY created_at DESC) as rn
        FROM results
        WHERE variant_id IN (?, ?)
      )
      SELECT
        l1.task_id,
        l1.final_score as score1,
        l2.final_score as score2
      FROM latest l1
      JOIN latest l2 ON l1.task_id = l2.task_id
      WHERE l1.variant_id = ? AND l2.variant_id = ?
        AND l1.rn = 1 AND l2.rn = 1
      ORDER BY l1.task_id
    `;

    const rows = db.prepare(sql).values<[string, number, number]>(
      variant1,
      variant2,
      variant1,
      variant2,
    );

    let variant1Wins = 0;
    let variant2Wins = 0;
    let ties = 0;
    let variant1Total = 0;
    let variant2Total = 0;

    const perTask: TaskComparisonDetail[] = rows.map((row) => {
      const score1 = row[1];
      const score2 = row[2];
      variant1Total += score1;
      variant2Total += score2;

      let winner: "variant1" | "variant2" | "tie";
      if (score1 > score2) {
        winner = "variant1";
        variant1Wins++;
      } else if (score2 > score1) {
        winner = "variant2";
        variant2Wins++;
      } else {
        winner = "tie";
        ties++;
      }

      return {
        taskId: row[0],
        variant1Score: score1,
        variant2Score: score2,
        winner,
      };
    });

    const taskCount = perTask.length || 1;

    // Get total costs
    const costSql = `
      SELECT variant_id, SUM(total_cost) as cost
      FROM results
      WHERE variant_id IN (?, ?)
      GROUP BY variant_id
    `;
    const costRows = db.prepare(costSql).values<[string, number]>(
      variant1,
      variant2,
    );
    const costs = new Map(costRows.map((r) => [r[0], r[1]]));

    return Promise.resolve({
      variant1,
      variant2,
      variant1Wins,
      variant2Wins,
      ties,
      variant1AvgScore: variant1Total / taskCount,
      variant2AvgScore: variant2Total / taskCount,
      variant1Cost: costs.get(variant1) ?? 0,
      variant2Cost: costs.get(variant2) ?? 0,
      perTask,
    });
  }

  detectRegressions(options: RegressionOptions): Promise<Regression[]> {
    const db = this.getDb();

    const recentWindow = options.recentWindow ?? 3;
    const baselineWindow = options.baselineWindow ?? 7;

    let variantFilter = "";
    const params: (string | number | null)[] = [
      recentWindow,
      recentWindow,
      baselineWindow,
    ];

    if (options.variantId) {
      variantFilter = "AND variant_id = ?";
      params.push(options.variantId);
    }

    params.push(options.threshold);

    const sql = `
      WITH recent_runs AS (
        SELECT run_id FROM runs ORDER BY executed_at DESC LIMIT ?
      ),
      baseline_runs AS (
        SELECT run_id FROM runs ORDER BY executed_at DESC LIMIT ? OFFSET ?
      ),
      recent AS (
        SELECT task_id, variant_id, AVG(final_score) as recent_score
        FROM results
        WHERE run_id IN (SELECT run_id FROM recent_runs)
        ${variantFilter}
        GROUP BY task_id, variant_id
      ),
      baseline AS (
        SELECT task_id, variant_id, AVG(final_score) as baseline_score
        FROM results
        WHERE run_id IN (SELECT run_id FROM baseline_runs)
        ${variantFilter}
        GROUP BY task_id, variant_id
      )
      SELECT
        r.task_id,
        r.variant_id,
        b.baseline_score,
        r.recent_score,
        (r.recent_score - b.baseline_score) / NULLIF(b.baseline_score, 0) as change_pct
      FROM recent r
      JOIN baseline b ON r.task_id = b.task_id AND r.variant_id = b.variant_id
      WHERE b.baseline_score > 0
        AND (r.recent_score - b.baseline_score) / b.baseline_score < -?
      ORDER BY change_pct ASC
    `;

    const rows = db.prepare(sql).values<
      [string, string, number, number, number]
    >(...params);

    return Promise.resolve(
      rows.map((row) => ({
        taskId: row[0],
        variantId: row[1],
        baselineScore: row[2],
        currentScore: row[3],
        changePct: row[4] * 100,
      })),
    );
  }

  getCostBreakdown(options: CostOptions): Promise<CostBreakdown[]> {
    const db = this.getDb();

    let groupExpr: string;
    switch (options.groupBy) {
      case "model":
        groupExpr = "r.variant_id";
        break;
      case "task":
        groupExpr = "r.task_id";
        break;
      case "day":
        groupExpr = "date(runs.executed_at)";
        break;
      case "week":
        groupExpr = "strftime('%Y-%W', runs.executed_at)";
        break;
    }

    let whereClause = "";
    const params: (string | number | null)[] = [];

    if (options.since) {
      whereClause += " AND runs.executed_at >= ?";
      params.push(options.since.toISOString());
    }
    if (options.variantId) {
      whereClause += " AND r.variant_id = ?";
      params.push(options.variantId);
    }

    const sql = `
      SELECT
        ${groupExpr} as group_key,
        SUM(r.total_cost) as total_cost,
        SUM(r.total_tokens) as total_tokens,
        COUNT(*) as execution_count,
        AVG(r.total_cost) as avg_cost,
        CASE
          WHEN SUM(r.success) > 0
          THEN SUM(r.total_cost) / SUM(r.success)
          ELSE NULL
        END as cost_per_success
      FROM results r
      JOIN runs ON r.run_id = runs.run_id
      WHERE 1=1 ${whereClause}
      GROUP BY ${groupExpr}
      ORDER BY total_cost DESC
    `;

    const rows = db.prepare(sql).values<
      [string, number, number, number, number, number | null]
    >(...params);

    return Promise.resolve(
      rows.map((row) => ({
        groupKey: row[0],
        totalCost: row[1],
        totalTokens: row[2],
        executionCount: row[3],
        avgCostPerExecution: row[4],
        costPerSuccess: row[5],
      })),
    );
  }

  // ============ Task Set Queries ============

  getTaskSetSummaries(): Promise<TaskSetSummary[]> {
    const db = this.getDb();

    const sql = `
      SELECT
        runs.task_set_hash,
        MIN(runs.executed_at) as first_run,
        MAX(runs.executed_at) as last_run,
        COUNT(DISTINCT runs.run_id) as run_count,
        COUNT(DISTINCT r.variant_id) as model_count,
        AVG(runs.overall_pass_rate) as avg_pass_rate,
        AVG(runs.average_score) as avg_score
      FROM runs
      LEFT JOIN results r ON runs.run_id = r.run_id
      GROUP BY runs.task_set_hash
      ORDER BY last_run DESC
    `;

    const rows = db.prepare(sql).values<
      [string, string, string, number, number, number, number]
    >();

    return Promise.resolve(
      rows.map((row) => ({
        taskSetHash: row[0],
        firstRun: new Date(row[1]),
        lastRun: new Date(row[2]),
        runCount: row[3],
        modelCount: row[4],
        avgPassRate: row[5],
        avgScore: row[6],
      })),
    );
  }

  getRunsByVariantForTaskSet(taskSetHash: string): Promise<VariantRunGroup[]> {
    const db = this.getDb();

    // Get all runs for this task set hash
    const runsSql = `
      SELECT run_id, executed_at, config_hash, task_set_hash,
             total_tasks, total_models, total_cost, total_tokens,
             total_duration_ms, pass_rate_1, pass_rate_2,
             overall_pass_rate, average_score, metadata_json
      FROM runs
      WHERE task_set_hash = ?
      ORDER BY executed_at DESC
    `;
    const runs = db.prepare(runsSql).values<[
      string,
      string,
      string,
      string,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      string | null,
    ]>(taskSetHash);

    const runRecords = runs.map((row) => this.rowToRunRecord(row));

    // Get distinct variants from these runs
    const variantsSql = `
      SELECT DISTINCT r.variant_id, r.provider
      FROM results r
      JOIN runs ON r.run_id = runs.run_id
      WHERE runs.task_set_hash = ?
      ORDER BY r.variant_id
    `;
    const variants = db.prepare(variantsSql).values<[string, string]>(
      taskSetHash,
    );

    // Build groups - for each variant, find which runs have results for it
    const groups: VariantRunGroup[] = [];
    for (const [variantId, provider] of variants) {
      // Get run IDs that have this variant
      const runIdsSql = `
        SELECT DISTINCT r.run_id
        FROM results r
        JOIN runs ON r.run_id = runs.run_id
        WHERE runs.task_set_hash = ? AND r.variant_id = ?
      `;
      const runIds = new Set(
        db.prepare(runIdsSql).values<[string]>(taskSetHash, variantId)
          .map((r) => r[0]),
      );

      // Filter runRecords to only those that have this variant
      const variantRuns = runRecords.filter((run) => runIds.has(run.runId));

      groups.push({
        variantId,
        provider,
        runs: variantRuns,
      });
    }

    return Promise.resolve(groups);
  }
}
