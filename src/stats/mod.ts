/**
 * Stats persistence module for CentralGauge benchmark results
 *
 * This module provides historical tracking and analytics for benchmark runs.
 *
 * @example
 * ```typescript
 * import { openStorage, createImporter } from "./stats/mod.ts";
 *
 * // Open storage (SQLite by default)
 * const storage = await openStorage();
 *
 * // Import existing results
 * const importer = createImporter();
 * const result = await importer.importDirectory("results/", storage);
 * console.log(`Imported ${result.imported} runs`);
 *
 * // Query model trends
 * const trend = await storage.getModelTrend("anthropic/claude-opus-4-5");
 * console.log(trend);
 *
 * // Close when done
 * await storage.close();
 * ```
 */

// Types
export type {
  AttemptRecord,
  CostBreakdown,
  CostOptions,
  GetResultsOptions,
  ImportResult,
  ListRunsOptions,
  ModelComparison,
  Regression,
  RegressionOptions,
  ResultRecord,
  RunRecord,
  TaskComparisonDetail,
  TrendOptions,
  TrendPoint,
} from "./types.ts";

// Interfaces
export type {
  StatsImporter,
  StatsStorage,
  StorageConfig,
} from "./interfaces.ts";
export { DEFAULT_STORAGE_CONFIG } from "./interfaces.ts";

// Hash generation
export { generateManifestHash, shortenHash } from "./hasher.ts";

// Storage implementations
export { SqliteStorage } from "./sqlite-storage.ts";
export { InMemoryStorage } from "./factory.ts";

// Factory functions
export { createStorage, openStorage } from "./factory.ts";

// Importer
export { createImporter, JsonImporter } from "./importer.ts";

// Schema (for advanced use)
export {
  CREATE_SCHEMA,
  CREATE_VIEWS,
  DROP_SCHEMA,
  SCHEMA_VERSION,
} from "./schema.ts";
