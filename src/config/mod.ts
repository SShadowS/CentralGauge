/**
 * Config Module
 *
 * Provides configuration loading and management for CentralGauge.
 */

// Types
export type {
  BenchConfig,
  BenchmarkPreset,
  CentralGaugeConfig,
} from "./config.ts";

// Manager + helpers
export { BENCH_DEFAULTS, ConfigManager, mergeBenchDefaults } from "./config.ts";
