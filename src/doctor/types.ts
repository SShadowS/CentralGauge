/**
 * Doctor schema — see docs/superpowers/specs/2026-04-26-bench-ingest-doctor-design.md
 *
 * Stable, JSON-serializable. Bump `schemaVersion` on breaking shape changes.
 */

export type CheckLevel = "A" | "B" | "C" | "D";
export type CheckStatus = "passed" | "failed" | "warning" | "skipped";

export interface Remediation {
  /** One-line "what to do" summary. */
  summary: string;
  /** Exact copy-paste shell command, when applicable. */
  command?: string;
  /** Whether the auto-repair allowlist will execute it under `--repair`. */
  autoRepairable: boolean;
}

export interface CheckResult {
  /** Stable check id, e.g. "cfg.present", "auth.probe". */
  id: string;
  level: CheckLevel;
  status: CheckStatus;
  /** Single-line human summary shown in terminal output. */
  message: string;
  remediation?: Remediation;
  /** Structured payload for programmatic consumers (e.g. missing_models[]). */
  details?: Record<string, unknown>;
  /** Wall-clock time spent running the check. */
  durationMs: number;
}

export interface DoctorReport {
  schemaVersion: 1;
  section: SectionId;
  /** ISO timestamp set by the engine when the report is finalized. */
  generatedAt: string;
  /** True iff no `failed` checks. Warnings do not flip this. */
  ok: boolean;
  checks: CheckResult[];
  summary: {
    passed: number;
    failed: number;
    warning: number;
    skipped: number;
  };
}

export type SectionId = "ingest" | "containers" | "llm" | "all";

/**
 * Variant identification passed to the bench-aware catalog check.
 * Mirrors the existing `ModelVariant` shape but flattens to wire-format fields.
 */
export interface VariantProbe {
  slug: string; // e.g. "anthropic/claude-opus-4-7"
  api_model_id: string; // e.g. "claude-opus-4-7"
  family_slug: string; // e.g. "claude"
}

export interface DoctorContext {
  /** Repository root (where `site/catalog`, `tasks/`, `.centralgauge.yml` live). */
  cwd: string;
  /** Injected fetch — overridable for testing. */
  fetchFn: typeof fetch;
  /** Bench-aware inputs (only present when called from bench or with `--llms`). */
  variants?: VariantProbe[];
  pricingVersion?: string;
  taskSetHash?: string;
  /**
   * Map from check id to its already-completed CheckResult. The engine
   * populates this as checks finish, so a later check can declare
   * `requires: ["cfg.present"]` and the engine will skip it if the
   * dependency failed.
   */
  previousResults: Map<string, CheckResult>;
}

export interface Check {
  id: string;
  level: CheckLevel;
  /** Other check ids whose `passed` status is required for this check to run. */
  requires?: string[];
  run(ctx: DoctorContext): Promise<CheckResult>;
}

export interface Section {
  id: SectionId;
  /** Checks in matrix order — engine respects this order so dependencies resolve naturally. */
  checks: Check[];
}

export interface RunDoctorOptions {
  section: Section;
  /** Subset of levels to run; default: all in the section. */
  levels?: CheckLevel[];
  variants?: VariantProbe[];
  pricingVersion?: string;
  taskSetHash?: string;
  /** Inject a fetch implementation (tests). */
  fetchFn?: typeof fetch;
  /** When true, runs the repair allowlist for failed checks then re-runs them. */
  repair?: boolean;
  cwd?: string;
}
