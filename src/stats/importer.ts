/**
 * Import existing JSON benchmark results into stats storage
 */

import { join } from "@std/path";
import type { StatsImporter, StatsStorage } from "./interfaces.ts";
import type { ImportResult, ResultRecord, RunRecord } from "./types.ts";
import { resolveCurrentTaskSetHash } from "../ingest/catalog/task-set-hash.ts";

/**
 * Structure of benchmark result JSON files
 */
interface BenchmarkResultFile {
  results: TaskExecutionResult[];
  stats: AggregateStats;
  comparisons?: unknown[];
}

/**
 * Subset of TaskExecutionResult needed for import
 */
interface TaskExecutionResult {
  taskId: string;
  executionId?: string;
  context: {
    llmProvider: string;
    llmModel: string;
    variantId?: string;
    variantConfig?: Record<string, unknown>;
  };
  attempts: ExecutionAttempt[];
  success: boolean;
  finalScore: number;
  totalTokensUsed: number;
  totalCost: number;
  totalDuration: number;
  passedAttemptNumber?: number;
  successRate: number;
  executedAt?: string;
}

/**
 * Subset of ExecutionAttempt needed for import
 */
interface ExecutionAttempt {
  attemptNumber: number;
  success: boolean;
  score: number;
  tokensUsed: number;
  cost: number;
  duration: number;
  llmResponse?: {
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
  compilationResult?: {
    success: boolean;
  };
  testResult?: {
    success: boolean;
  };
  failureReasons?: string[];
}

/**
 * Subset of AggregateStats needed for import
 */
interface AggregateStats {
  totalTokens: number;
  totalCost: number;
  totalDuration: number;
  overallPassRate: number;
  averageScore: number;
  passRate1?: number;
  passRate2?: number;
  perModel: Record<string, unknown>;
  perTask: Record<string, unknown>;
}

/**
 * JSON file importer for benchmark results
 */
export class JsonImporter implements StatsImporter {
  /**
   * @param projectRoot Root used to resolve the CURRENT on-disk task-set
   * hash for imported runs (V5). Defaults to `Deno.cwd()` — the same
   * default `resolveCurrentTaskSetHash` and the lifecycle orchestrator use.
   * Overridable for tests so they don't have to `Deno.chdir()`.
   */
  constructor(private readonly projectRoot: string = Deno.cwd()) {}

  /**
   * Import a single JSON result file
   */
  async importFile(filePath: string, storage: StatsStorage): Promise<boolean> {
    const runId = this.extractRunId(filePath);

    // Check if already imported
    if (await storage.hasRun(runId)) {
      return false; // Already imported
    }

    // Read and parse file
    const content = await Deno.readTextFile(filePath);
    const data = JSON.parse(content) as BenchmarkResultFile;

    // Build run record
    const run = await this.buildRunRecord(runId, data);
    await storage.persistRun(run);

    // Build result records
    const results = this.buildResultRecords(data.results);
    await storage.persistResults(runId, results);

    return true;
  }

  /**
   * Import all JSON files from a directory
   */
  async importDirectory(
    dirPath: string,
    storage: StatsStorage,
  ): Promise<ImportResult> {
    const result: ImportResult = {
      imported: 0,
      skipped: 0,
      errors: [],
    };

    // Find all benchmark result files
    const files: string[] = [];
    for await (const entry of Deno.readDir(dirPath)) {
      if (
        entry.isFile &&
        entry.name.startsWith("benchmark-results-") &&
        entry.name.endsWith(".json")
      ) {
        files.push(join(dirPath, entry.name));
      }
    }

    // Sort by timestamp (older first)
    files.sort((a, b) => {
      const tsA = this.extractTimestamp(a);
      const tsB = this.extractTimestamp(b);
      return tsA - tsB;
    });

    // Import each file
    for (const file of files) {
      try {
        const imported = await this.importFile(file, storage);
        if (imported) {
          result.imported++;
        } else {
          result.skipped++;
        }
      } catch (error) {
        result.errors.push({
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  /**
   * Extract run ID from filename
   */
  private extractRunId(filePath: string): string {
    const match = filePath.match(/benchmark-results-(\d+)\.json$/);
    return match?.[1] ?? String(Date.now());
  }

  /**
   * Extract timestamp from filename
   */
  private extractTimestamp(filePath: string): number {
    const match = filePath.match(/benchmark-results-(\d+)\.json$/);
    return match?.[1] ? parseInt(match[1], 10) : 0;
  }

  /**
   * Build a RunRecord from parsed data
   */
  private async buildRunRecord(
    runId: string,
    data: BenchmarkResultFile,
  ): Promise<RunRecord> {
    const stats = data.stats;
    const results = data.results;

    // Count unique models
    const models = new Set<string>();
    const tasks = new Set<string>();
    for (const r of results) {
      const variantId = r.context.variantId ||
        `${r.context.llmProvider}/${r.context.llmModel}`;
      models.add(variantId);
      tasks.add(r.taskId);
    }

    // V5: taskSetHash must be derived from actual task content (via the
    // canonical ingest hasher), never fabricated from bare task IDs — the
    // old `contentHash: id` here meant an imported run's taskSetHash could
    // NEVER match the real hash `centralgauge ingest`/bench compute for the
    // same checkout, silently breaking `factory.ts`'s `taskSetHash` grouping
    // filter. `tasks`/`models` above are still used for totalTasks/totalModels.
    const taskSetHash = await resolveCurrentTaskSetHash(this.projectRoot);

    // Derive execution date from run ID (timestamp)
    const executedAt = new Date(parseInt(runId, 10));

    // Calculate pass rates from results if not in stats. V10: nullish, not
    // falsy — a genuinely-computed 0 (e.g. a real 0% first-try pass rate)
    // must be trusted as-is, not silently overwritten by a recompute that
    // may disagree with the persisted aggregate.
    let passRate1 = stats.passRate1 ?? 0;
    let passRate2 = stats.passRate2 ?? 0;
    if (stats.passRate1 === undefined && stats.passRate2 === undefined) {
      let pass1 = 0;
      let pass2 = 0;
      for (const r of results) {
        if (r.passedAttemptNumber === 1) pass1++;
        else if (r.passedAttemptNumber === 2) pass2++;
      }
      const total = results.length || 1;
      passRate1 = pass1 / total;
      passRate2 = (pass1 + pass2) / total;
    }

    return {
      runId,
      executedAt,
      configHash: runId, // Use run ID as config hash for imported files
      taskSetHash,
      totalTasks: tasks.size,
      totalModels: models.size,
      totalCost: stats.totalCost,
      totalTokens: stats.totalTokens,
      totalDurationMs: stats.totalDuration,
      passRate1,
      passRate2,
      overallPassRate: stats.overallPassRate,
      averageScore: stats.averageScore,
      metadata: {
        imported: true,
        importedAt: new Date().toISOString(),
        originalStats: {
          perModel: Object.keys(stats.perModel),
          perTask: Object.keys(stats.perTask),
        },
      },
    };
  }

  /**
   * Build ResultRecords from task execution results
   */
  private buildResultRecords(
    results: TaskExecutionResult[],
  ): ResultRecord[] {
    return results.map((r) => {
      const variantId = r.context.variantId ||
        `${r.context.llmProvider}/${r.context.llmModel}`;

      // Sum up tokens from attempts
      let promptTokens = 0;
      let completionTokens = 0;
      for (const a of r.attempts) {
        if (a.llmResponse?.usage) {
          promptTokens += a.llmResponse.usage.promptTokens ?? 0;
          completionTokens += a.llmResponse.usage.completionTokens ?? 0;
        }
      }

      return {
        taskId: r.taskId,
        variantId,
        model: r.context.llmModel,
        provider: r.context.llmProvider,
        success: r.success,
        finalScore: r.finalScore,
        passedAttempt: r.passedAttemptNumber ?? 0,
        totalTokens: r.totalTokensUsed,
        promptTokens,
        completionTokens,
        totalCost: r.totalCost,
        totalDurationMs: r.totalDuration,
        variantConfig: r.context.variantConfig as
          | import("../llm/variant-types.ts").VariantConfig
          | undefined,
        resultJson: JSON.stringify(r),
      };
    });
  }
}

/**
 * Create a new importer instance
 * @param projectRoot Passed through to `JsonImporter` — see its constructor.
 */
export function createImporter(projectRoot?: string): StatsImporter {
  return new JsonImporter(projectRoot);
}
