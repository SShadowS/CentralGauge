/**
 * Object-omission detection for diagnose-format tasks.
 *
 * `templates/diagnose.md` rule 2 requires the model to return EVERY object of
 * the corrected application. When it drops one, the AL compiler reports
 * `AL0185` ("Table 'X' is missing") or `AL0132` ("'X' does not contain a
 * definition for 'Y'") and the attempt fails without ever reaching the
 * oracle's assertions. That is transcription fidelity, not diagnostic
 * ability, and on the seven-model panel of 2026-08-30 it accounted for 37% of
 * all failures (49% upper bound) - rising to 52% for the weakest models.
 *
 * We report it rather than forgive it. SWE-bench published the equivalent
 * (`% Apply`, Table 5 of the original paper) and then deleted it from the
 * leaderboard; Aider forgives the malformed edit but publishes
 * `percent_cases_well_formed` as an orthogonal column; IFEval publishes
 * strict AND loose accuracy, calling loose "a complement to the original
 * criterion". Emitting `omission_rate` beside the pass rate keeps the
 * headline uncontaminated while saying how much of a model's gap is retyping
 * rather than reasoning - strictly more information than an overlay that
 * silently repaired the submission would leave behind.
 *
 * See docs/reasoning-suite/hardening-levers-evidence.md.
 */

import type {
  CompilationError,
  CompilationResult,
} from "../container/types.ts";

/** AL diagnostics a dropped object or field produces. */
export const OMISSION_CODES: ReadonlySet<string> = new Set([
  "AL0185",
  "AL0132",
]);

/**
 * `AL0000` ("App generation failed") is a downstream cascade of whatever else
 * went wrong, so it never classifies an attempt on its own.
 */
export const CASCADE_CODES: ReadonlySet<string> = new Set(["AL0000"]);

export type CompileFailureKind =
  /** Every non-cascade diagnostic is an omission code. */
  | "omission"
  /**
   * An omission diagnostic alongside a real one. Held out rather than
   * claimed: an `AL0185` can itself be a cascade of a syntax error, because a
   * file that fails to parse takes its objects with it and the table then
   * legitimately reads as missing. Counting these as omission inflates the
   * artifact share from 33% to 53% on the three-model panel.
   */
  | "mixed"
  /** Syntax, property misuse, bad signature - a real AL capability failure. */
  | "al_knowledge";

/**
 * Classify a FAILED compilation. Callers must only pass results where
 * `success === false`; a successful compile has no failure kind.
 */
export function classifyCompileFailure(
  errors: readonly CompilationError[],
): CompileFailureKind {
  const real = errors
    .map((e) => e.code)
    .filter((code) => !CASCADE_CODES.has(code));
  if (real.length > 0 && real.every((code) => OMISSION_CODES.has(code))) {
    return "omission";
  }
  if (real.some((code) => OMISSION_CODES.has(code))) return "mixed";
  return "al_knowledge";
}

export interface OmissionStats {
  /** Attempts whose compile failed with only omission diagnostics. */
  omissionAttempts: number;
  /** Attempts whose compile failed with omission plus a real diagnostic. */
  mixedAttempts: number;
  /** Attempts that reached the compiler at all (success or failure). */
  compiledAttempts: number;
  /**
   * Tasks that failed overall AND whose LAST attempt was a confirmed
   * omission - the cases where the scored verdict is an artifact.
   */
  omissionFailedTasks: number;
  /** Tasks that failed overall, the denominator for `failureShare`. */
  failedTasks: number;
  /**
   * Tasks whose first attempt failed the graded assertions and whose repair
   * attempt was then lost to a confirmed omission. The sharpest form of the
   * defect: the model diagnosed the bug and still scored zero.
   */
  lostRepairs: number;
  /** Tasks whose first attempt failed behaviourally (denominator above). */
  behaviouralFirstAttempts: number;
}

/** A single attempt, reduced to what omission accounting needs. */
export interface OmissionAttemptView {
  compilationResult?: CompilationResult | undefined;
  /** True when the attempt compiled, ran tests, and failed assertions. */
  failedAssertions: boolean;
}

export interface OmissionTaskView {
  success: boolean;
  attempts: readonly OmissionAttemptView[];
  /**
   * True when no attempt produced any model output - a 402/401/hard-429 from
   * the provider. Such a task lands as `success: false` and is otherwise
   * indistinguishable from a capability failure, so it must be excluded from
   * every rate here: an exhausted OpenRouter balance silently reported two
   * models at 0/18 during the 2026-08-30 A/B. It is not an omission any more
   * than it is a wrong answer.
   */
  providerFailure?: boolean;
}

export function computeOmissionStats(
  tasks: readonly OmissionTaskView[],
): OmissionStats {
  const stats: OmissionStats = {
    omissionAttempts: 0,
    mixedAttempts: 0,
    compiledAttempts: 0,
    omissionFailedTasks: 0,
    failedTasks: 0,
    lostRepairs: 0,
    behaviouralFirstAttempts: 0,
  };

  for (const task of tasks) {
    if (task.providerFailure) continue;
    const kinds: Array<CompileFailureKind | "pass" | "behavioural" | "none"> =
      [];
    for (const attempt of task.attempts) {
      const comp = attempt.compilationResult;
      if (!comp) {
        kinds.push("none");
        continue;
      }
      stats.compiledAttempts++;
      if (comp.success) {
        kinds.push(attempt.failedAssertions ? "behavioural" : "pass");
        continue;
      }
      const kind = classifyCompileFailure(comp.errors);
      if (kind === "omission") stats.omissionAttempts++;
      if (kind === "mixed") stats.mixedAttempts++;
      kinds.push(kind);
    }

    if (kinds[0] === "behavioural") {
      stats.behaviouralFirstAttempts++;
      if (kinds[1] === "omission") stats.lostRepairs++;
    }
    if (!task.success) {
      stats.failedTasks++;
      if (kinds[kinds.length - 1] === "omission") stats.omissionFailedTasks++;
    }
  }

  return stats;
}

/**
 * Render the `# Omission` scores-file block. Returns `[]` when nothing was
 * omitted, matching the conditional-emit gate used by `# Fallbacks` /
 * `# Drain Events` / `# Recovery Events`.
 */
export function renderOmissionBlock(stats: OmissionStats): string[] {
  if (stats.omissionAttempts === 0 && stats.mixedAttempts === 0) return [];
  const pct = (n: number, d: number) =>
    d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "n/a";
  return [
    `# Omission`,
    `# Attempts that dropped an AL object or field while re-emitting the app`,
    `# (AL0185/AL0132). Transcription fidelity, not diagnostic ability.`,
    `omission_attempts: ${stats.omissionAttempts}/${stats.compiledAttempts} (${
      pct(stats.omissionAttempts, stats.compiledAttempts)
    })`,
    `mixed_attempts: ${stats.mixedAttempts} (held out - may be a cascade)`,
    `omission_rate: ${
      pct(stats.omissionFailedTasks, stats.failedTasks)
    } of ${stats.failedTasks} failed tasks`,
    `lost_repairs: ${stats.lostRepairs}/${stats.behaviouralFirstAttempts} (${
      pct(stats.lostRepairs, stats.behaviouralFirstAttempts)
    }) diagnosed on attempt 1, lost attempt 2 to omission`,
  ];
}
