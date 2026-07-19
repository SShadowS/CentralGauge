/**
 * Session selection and verify command helpers
 * @module cli/helpers/session-selection
 */

import { Select } from "@cliffy/prompt";
import * as colors from "@std/fmt/colors";
import {
  findSessions,
  isFixableResult,
  isModelShortcomingResult,
  type SessionInfo,
  type VerifyEvent,
} from "../../src/verify/mod.ts";

export interface VerifyCommandOptions {
  shortcomingsOnly: boolean;
  fixesOnly: boolean;
  shortcomingsDir: string;
}

export type VerifyMode = "shortcomings-only" | "fixes-only" | "all";

/**
 * Validates mutually exclusive task filter options.
 * Exits with error if both shortcomings-only and fixes-only are set.
 */
export function validateTaskFilterOptions(
  options: Pick<VerifyCommandOptions, "shortcomingsOnly" | "fixesOnly">,
): void {
  if (options.shortcomingsOnly && options.fixesOnly) {
    console.error(
      colors.red(
        "[ERROR] --shortcomings-only and --fixes-only are mutually exclusive",
      ),
    );
    Deno.exit(1);
  }
}

/**
 * Determines verify mode from command options.
 */
export function determineModeFromOptions(
  options: Pick<VerifyCommandOptions, "shortcomingsOnly" | "fixesOnly">,
): VerifyMode {
  if (options.shortcomingsOnly) return "shortcomings-only";
  if (options.fixesOnly) return "fixes-only";
  return "all";
}

/**
 * Builds formatted choices for session selection prompt.
 */
function buildSessionChoices(
  sessions: SessionInfo[],
): Array<{ name: string; value: string }> {
  return sessions.map((s) => {
    const date = new Date(parseInt(s.sessionId));
    const hasCompilation = s.compilationLogPath ? "compile" : "";
    const hasTests = s.testLogPath ? "test" : "";
    const logs = [hasCompilation, hasTests].filter(Boolean).join(", ");
    return {
      name: `${s.sessionId} (${date.toLocaleString()}) [${logs}]`,
      value: s.sessionId,
    };
  });
}

/**
 * Finds and selects a session from the debug directory.
 * Returns the session ID - either from options, or interactively selected.
 */
export async function selectSession(
  dir: string,
  sessionOption?: string,
): Promise<string> {
  if (sessionOption) {
    return sessionOption;
  }

  const sessions = await findSessions(dir);

  if (sessions.length === 0) {
    console.error(colors.red("[ERROR] No sessions found in debug directory"));
    Deno.exit(1);
  }

  if (sessions.length === 1) {
    return sessions[0]!.sessionId;
  }

  // Sort by session ID (timestamp) descending - most recent first
  sessions.sort((a, b) => parseInt(b.sessionId) - parseInt(a.sessionId));

  const choices = buildSessionChoices(sessions);

  return await Select.prompt({
    message: "Select session to analyze:",
    options: choices,
  });
}

/**
 * Formats a verify event for console output.
 * Returns undefined if the event doesn't need console output.
 */
export function formatEventForConsole(
  event: VerifyEvent,
  shortcomingsDir: string,
): void {
  switch (event.type) {
    case "tasks_filtered":
      console.log(
        colors.gray(
          `[FILTER] Skipped ${event.skipped} tasks: ${event.reason}`,
        ),
      );
      console.log(
        colors.gray(`[FILTER] Analyzing ${event.kept} task(s)`),
      );
      break;

    case "analyzing":
      console.log(
        colors.cyan(`[ANALYZE] ${event.taskId} (${event.model})`),
      );
      break;

    case "analysis_complete":
      if (isFixableResult(event.result)) {
        console.log(
          colors.yellow(
            `[FIXABLE] ${event.result.category} in ${event.result.fix.filePath}`,
          ),
        );
        console.log(`  ${event.result.description}`);
      } else if (isModelShortcomingResult(event.result)) {
        console.log(
          colors.blue(
            `[MODEL GAP] ${event.result.concept}`,
          ),
        );
        console.log(`  ${event.result.description.slice(0, 100)}...`);
      } else {
        // analysis_failed (V9): analyzer output couldn't be parsed.
        console.log(
          colors.red(`[ANALYSIS FAILED] ${event.result.reason}`),
        );
      }
      break;

    case "fix_applied":
      if (event.success) {
        console.log(colors.green(`[OK] Applied fix to ${event.taskId}`));
      } else {
        console.log(
          colors.red(`[FAIL] Could not apply fix to ${event.taskId}`),
        );
      }
      break;

    case "fix_skipped":
      console.log(colors.gray(`[SKIP] Skipped fix for ${event.taskId}`));
      break;

    case "shortcoming_logged":
      console.log(
        colors.gray(
          `  Logged to: ${shortcomingsDir}/${event.model}.json`,
        ),
      );
      break;

    case "analysis_failed":
      console.error(
        colors.red(
          `[ANALYSIS FAILED] ${event.taskId} (${event.model}): ${event.reason}`,
        ),
      );
      break;

    case "error":
      console.error(colors.red(`[ERROR] ${event.taskId}: ${event.error}`));
      break;
  }
}
