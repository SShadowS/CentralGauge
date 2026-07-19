/**
 * CLI task loading helpers
 * @module cli/helpers/task-loader
 */

import { expandGlob } from "@std/fs";
import { loadTaskManifest } from "../../src/tasks/loader.ts";
import type { TaskManifest } from "../../src/tasks/interfaces.ts";
import { generateComprehensiveTaskSetHash } from "../../src/stats/hasher.ts";
import type { TaskSetHashResult } from "../../src/stats/types.ts";
import { ValidationError } from "../../src/errors.ts";
import { log } from "./logging.ts";

/**
 * Load task manifests from glob patterns.
 * Creates the output directory if it doesn't exist.
 *
 * @param patterns - Glob patterns for task YAML files
 * @param outputDir - Output directory to create
 * @param verbose - Whether to log each loaded task
 * @returns Array of loaded task manifests
 */
export async function loadTaskManifests(
  patterns: string[],
  outputDir: string,
  verbose = true,
): Promise<TaskManifest[]> {
  // Ensure output directory exists
  await Deno.mkdir(outputDir, { recursive: true });

  const manifests: TaskManifest[] = [];

  for (const taskPattern of patterns) {
    for await (const entry of expandGlob(taskPattern)) {
      if (entry.isFile && entry.name.endsWith(".yml")) {
        if (verbose) {
          log.task(`Loading: ${entry.path}`);
        }
        const manifest = await loadTaskManifest(entry.path);
        manifests.push(manifest);
      }
    }
  }

  if (manifests.length === 0) {
    // CLI4: a zero-match glob must not exit 0. Callers that legitimately
    // tolerate an empty result (list-style commands) must catch
    // `ValidationError` explicitly rather than relying on an empty array.
    const message = `No task manifests found matching patterns: ${
      patterns.join(", ")
    }`;
    log.fail(message);
    throw new ValidationError(message, [message]);
  } else if (verbose) {
    log.task(`Loaded ${manifests.length} task(s)`);
  }

  return manifests;
}

/**
 * Result of loading task manifests with comprehensive hashes
 */
export interface TaskManifestsWithHashResult {
  /** Loaded task manifests */
  manifests: TaskManifest[];
  /** Manifest file paths */
  manifestPaths: string[];
  /** Comprehensive hash result including all test files */
  hashResult: TaskSetHashResult;
}

/**
 * Load task manifests from glob patterns with comprehensive hashing.
 * Creates the output directory if it doesn't exist.
 * Computes hashes of all task-related files (manifests, test files, app.json).
 *
 * @param patterns - Glob patterns for task YAML files
 * @param outputDir - Output directory to create
 * @param verbose - Whether to log each loaded task and hash info
 * @returns Object containing manifests, paths, and hash result
 */
export async function loadTaskManifestsWithHashes(
  patterns: string[],
  outputDir: string,
  verbose = true,
): Promise<TaskManifestsWithHashResult> {
  // Ensure output directory exists
  await Deno.mkdir(outputDir, { recursive: true });

  const manifests: TaskManifest[] = [];
  const manifestPaths: string[] = [];

  for (const taskPattern of patterns) {
    for await (const entry of expandGlob(taskPattern)) {
      if (entry.isFile && entry.name.endsWith(".yml")) {
        if (verbose) {
          log.task(`Loading: ${entry.path}`);
        }
        const manifest = await loadTaskManifest(entry.path);
        manifests.push(manifest);
        manifestPaths.push(entry.path);
      }
    }
  }

  if (manifests.length === 0) {
    // CLI4: previously this only logged and returned an empty manifest
    // list; the bench caller then silently `return`ed `{}` and the process
    // exited 0, so a misconfigured --tasks glob looked identical to a clean
    // run. Throw at this loader choke point so it propagates as a non-zero
    // exit. Callers that legitimately tolerate zero matches must catch
    // `ValidationError` explicitly.
    const message = `No task manifests found matching patterns: ${
      patterns.join(", ")
    }`;
    log.fail(message);
    throw new ValidationError(message, [message]);
  } else if (verbose) {
    log.task(`Loaded ${manifests.length} task(s)`);
  }

  // Compute comprehensive hash
  const hashResult = await generateComprehensiveTaskSetHash(manifestPaths);

  if (verbose && hashResult.warnings.length > 0) {
    for (const warning of hashResult.warnings) {
      log.warn(warning);
    }
  }

  if (verbose) {
    log.info(
      `Task set hash: ${hashResult.hash} (${hashResult.totalFilesHashed} files)`,
    );
  }

  return { manifests, manifestPaths, hashResult };
}

/**
 * Find all JSON files in a directory recursively.
 *
 * @param directory - Directory to search
 * @returns Array of file paths
 */
export async function findJsonFiles(directory: string): Promise<string[]> {
  const jsonFiles: string[] = [];

  for await (const entry of expandGlob(`${directory}/**/*.json`)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      jsonFiles.push(entry.path);
    }
  }

  return jsonFiles;
}
