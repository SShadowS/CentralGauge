/**
 * Load a raw `benchmark-results-*.json` file with the FULL forensic shape
 * (attempts, infraRetries, failureReasons, per-step timing) — unlike the
 * report pipeline's lean normalized loader, which drops those fields.
 *
 * @module cli/commands/analyze/loader
 */

import type { TaskExecutionResult } from "../../../src/tasks/interfaces.ts";

export interface RawResultsFile {
  results: TaskExecutionResult[];
  drainEvents: unknown[];
}

/** Read + parse a results file. Dates remain ISO strings (analyzers ignore them). */
export async function loadRawResults(path: string): Promise<RawResultsFile> {
  const text = await Deno.readTextFile(path);
  const parsed = JSON.parse(text) as {
    results?: TaskExecutionResult[];
    drainEvents?: unknown[];
  };
  return {
    results: parsed.results ?? [],
    drainEvents: parsed.drainEvents ?? [],
  };
}
