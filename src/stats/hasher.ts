/**
 * Per-task granular content hashing for benchmark result bookkeeping.
 *
 * NOTE: the CANONICAL task-set content hash (what gates leaderboard
 * `task_sets.hash` grouping, see `RunRecord.taskSetHash`) lives in
 * `src/ingest/catalog/task-set-hash.ts::computeTaskSetHash` /
 * `resolveCurrentTaskSetHash` — that is what `JsonImporter` uses (V5). The
 * functions below serve a different, still-active purpose: per-task
 * manifest+testfile hash breakdowns with warnings, consumed by
 * `cli/commands/report-db-command.ts` and `cli/helpers/task-loader.ts` for
 * diagnostics that need task-level granularity the single combined corpus
 * hash doesn't expose. `generateConfigHash`/`generateTaskSetHash` (the old
 * "hash a bare list of {id, contentHash} pairs" combinators) were removed
 * as dead code once V5 stopped routing through them — the canonical hasher
 * above is now the only combined-hash entry point.
 */

import { expandGlob } from "@std/fs";
import { basename, join, relative } from "@std/path";
import { ValidationError } from "../errors.ts";
import type {
  HashedFileInfo,
  TaskContentHashInfo,
  TaskSetHashResult,
} from "./types.ts";

/**
 * Generate SHA-256 hash of input data
 */
async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate a content hash for a task manifest
 *
 * @param manifestContent The YAML content of the manifest
 * @returns SHA-256 hash (first 16 hex characters)
 */
export async function generateManifestHash(
  manifestContent: string,
): Promise<string> {
  // Normalize whitespace but preserve meaningful content
  const normalized = manifestContent.trim();
  const fullHash = await sha256(normalized);
  return fullHash.slice(0, 16);
}

/**
 * Generate a short hash suitable for display
 *
 * @param fullHash The full SHA-256 hash
 * @param length Number of characters (default 8)
 * @returns Shortened hash
 */
export function shortenHash(fullHash: string, length = 8): string {
  return fullHash.slice(0, length);
}

// =============================================================================
// Comprehensive Task Set Hashing (includes test .al files)
// =============================================================================

/**
 * Hash a single file's content
 * @param filePath Absolute path to file
 * @returns Hash info, or null ONLY if the file doesn't exist (V6). Any other
 *   read error (permissions, I/O failure, encoding) is NOT a "file absent"
 *   condition and must propagate — silently mapping it to null previously
 *   made `hashTaskContent`'s glob loop just skip the file with no warning,
 *   indistinguishable from a task that legitimately has no test files.
 */
export async function hashFile(
  filePath: string,
): Promise<HashedFileInfo | null> {
  let content: string;
  try {
    content = await Deno.readTextFile(filePath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  const hash = await sha256(content.trim());
  const stat = await Deno.stat(filePath);
  return {
    path: filePath,
    hash: hash.slice(0, 16),
    size: stat.size,
  };
}

/**
 * Extract task ID from manifest path
 * @example "tasks/easy/CG-AL-E008-basic-interface.yml" -> "CG-AL-E008"
 */
export function extractTaskId(manifestPath: string): string {
  const filename = basename(manifestPath);
  // Match pattern: CG-AL-{letter}{number(s)}
  const match = filename.match(/^(CG-AL-[A-Z]\d+)/);
  if (!match || !match[1]) {
    throw new ValidationError(
      `Cannot extract task ID from: ${manifestPath}`,
      ["Invalid task manifest filename format"],
      [],
      { manifestPath, filename },
    );
  }
  return match[1];
}

/**
 * Determine difficulty level from manifest path
 */
export function extractDifficulty(
  manifestPath: string,
): "easy" | "medium" | "hard" {
  // Normalize path separators for cross-platform support
  const normalized = manifestPath.replace(/\\/g, "/");
  if (normalized.includes("/easy/")) {
    return "easy";
  }
  if (normalized.includes("/medium/")) {
    return "medium";
  }
  if (normalized.includes("/hard/")) {
    return "hard";
  }
  throw new ValidationError(
    `Cannot determine difficulty from: ${manifestPath}`,
    ["Manifest path must contain /easy/, /medium/, or /hard/"],
    [],
    { manifestPath },
  );
}

/**
 * Discover and hash all files for a single task
 * @param manifestPath Path to the YAML manifest
 * @param projectRoot Project root directory (default: cwd)
 * @param testsAlDir Path to tests/al directory relative to project root
 * @returns Task content hash info with warnings
 */
export async function hashTaskContent(
  manifestPath: string,
  projectRoot: string = Deno.cwd(),
  testsAlDir: string = "tests/al",
): Promise<TaskContentHashInfo & { warnings: string[] }> {
  const warnings: string[] = [];

  // Extract task info
  const taskId = extractTaskId(manifestPath);
  const difficulty = extractDifficulty(manifestPath);

  // Hash manifest
  const manifestContent = await Deno.readTextFile(manifestPath);
  const manifestHash = await generateManifestHash(manifestContent);

  // Find and hash test files
  const testDir = join(projectRoot, testsAlDir, difficulty);
  const testFilePattern = join(testDir, `${taskId}*.al`);
  const testFiles: HashedFileInfo[] = [];

  try {
    for await (const entry of expandGlob(testFilePattern)) {
      if (entry.isFile) {
        const hashInfo = await hashFile(entry.path);
        if (hashInfo) {
          // Store relative path for portability
          hashInfo.path = relative(projectRoot, entry.path).replace(/\\/g, "/");
          testFiles.push(hashInfo);
        }
      }
    }
  } catch (error) {
    warnings.push(`Error scanning test files for ${taskId}: ${error}`);
  }

  // Sort test files by path for determinism
  testFiles.sort((a, b) => a.path.localeCompare(b.path));

  // Warn if no test files found (might be intentional for some tasks)
  if (testFiles.length === 0) {
    warnings.push(`No test files found for ${taskId} in ${testDir}`);
  }

  // Compute combined hash (deterministic order)
  const combinedData = {
    manifest: manifestHash,
    testFiles: testFiles.map((f) => ({ path: f.path, hash: f.hash })),
  };
  const combinedHash = (await sha256(JSON.stringify(combinedData))).slice(
    0,
    16,
  );

  return {
    taskId,
    manifestHash,
    manifestPath: relative(projectRoot, manifestPath).replace(/\\/g, "/"),
    testFiles,
    combinedHash,
    warnings,
  };
}

/**
 * Generate comprehensive task set hash including all test files
 *
 * This hashes:
 * - All YAML manifest files
 * - All test .al files matching {taskId}*.al pattern
 * - The tests/al/app.json manifest
 *
 * @param manifestPaths Absolute paths to YAML manifest files
 * @param projectRoot Project root directory
 * @param testsAlDir Path to tests/al directory relative to project root
 * @returns Complete hash result with per-task details
 */
export async function generateComprehensiveTaskSetHash(
  manifestPaths: string[],
  projectRoot: string = Deno.cwd(),
  testsAlDir: string = "tests/al",
): Promise<TaskSetHashResult> {
  const tasks: TaskContentHashInfo[] = [];
  const allWarnings: string[] = [];
  const missingFiles: string[] = [];

  // Hash each task
  for (const manifestPath of manifestPaths) {
    try {
      const { warnings, ...taskInfo } = await hashTaskContent(
        manifestPath,
        projectRoot,
        testsAlDir,
      );
      tasks.push(taskInfo);
      allWarnings.push(...warnings);
    } catch (error) {
      allWarnings.push(`Failed to hash ${manifestPath}: ${error}`);
    }
  }

  // Hash tests/al/app.json
  const appJsonPath = join(projectRoot, testsAlDir, "app.json");
  let testAppManifestHash = "missing";
  try {
    const appJsonContent = await Deno.readTextFile(appJsonPath);
    testAppManifestHash = (await sha256(appJsonContent.trim())).slice(0, 16);
  } catch {
    allWarnings.push(`Test app manifest not found: ${appJsonPath}`);
    missingFiles.push(appJsonPath);
  }

  // Sort tasks by ID for determinism
  tasks.sort((a, b) => a.taskId.localeCompare(b.taskId));

  // Compute final hash
  const hashData = {
    testAppManifest: testAppManifestHash,
    tasks: tasks.map((t) => ({
      id: t.taskId,
      combined: t.combinedHash,
    })),
  };
  const finalHash = (await sha256(JSON.stringify(hashData))).slice(0, 16);

  // Count total files hashed
  const totalFilesHashed = tasks.reduce(
    (sum, t) => sum + t.testFiles.length + 1, // +1 for manifest
    testAppManifestHash !== "missing" ? 1 : 0, // +1 for app.json if exists
  );

  return {
    hash: finalHash,
    testAppManifestHash,
    computedAt: new Date(),
    taskCount: tasks.length,
    totalFilesHashed,
    tasks,
    missingFiles,
    warnings: allWarnings,
  };
}
