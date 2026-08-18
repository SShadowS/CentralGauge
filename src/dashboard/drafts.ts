/**
 * Draft discovery and model selection for the authoring dashboard.
 * Identifies scaffolded drafts in scratch/ directory and resolves model presets.
 */

import { exists } from "@std/fs";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

export interface DraftSummary {
  id: string;
  dir: string;
  dirName: string;
  slug?: string;
  hasPrereq: boolean;
  testCodeunitId?: number;
}

/**
 * Check if a path exists and is a directory.
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

/**
 * List all draft tasks in the scratch directory.
 * A draft is recognized by having three markers: task.yml, .meta.json, and correct/ directory.
 * Non-drafts (like fable-repro-req.json, fieldref-hunt/, premise-*) are ignored.
 * Malformed JSON or YAML files are handled gracefully - the draft still lists with missing fields.
 */
export async function listDrafts(scratchDir: string): Promise<DraftSummary[]> {
  // Return empty list if scratch dir doesn't exist
  if (!await exists(scratchDir)) {
    return [];
  }

  const drafts: DraftSummary[] = [];

  // Iterate through directories in scratchDir
  for await (const entry of Deno.readDir(scratchDir)) {
    if (!entry.isDirectory) continue;

    const dirName = entry.name;
    const dir = join(scratchDir, dirName);
    const taskYmlPath = join(dir, "task.yml");
    const metaJsonPath = join(dir, ".meta.json");
    const correctPath = join(dir, "correct");

    // Check for all three scaffold markers
    if (
      !await exists(taskYmlPath) ||
      !await exists(metaJsonPath) ||
      !await isDirectory(correctPath)
    ) {
      continue;
    }

    // Read id from task.yml (authoritative), fall back to directory name if missing
    let id = dirName;
    try {
      const taskContent = await Deno.readTextFile(taskYmlPath);
      const taskYaml = parseYaml(taskContent) as Record<string, unknown>;
      if (typeof taskYaml["id"] === "string") {
        id = taskYaml["id"];
      }
    } catch {
      // Malformed task.yml - use directory name as fallback
    }

    // Read slug from .meta.json (optional, handle gracefully if malformed)
    let slug: string | undefined;
    try {
      const metaContent = await Deno.readTextFile(metaJsonPath);
      const metaJson = JSON.parse(metaContent);
      if (typeof metaJson.slug === "string") {
        slug = metaJson.slug;
      }
    } catch {
      // Malformed .meta.json - just skip slug, don't fail the listing
    }

    // Read testCodeunitId from task.yml's expected block (optional, handle gracefully if malformed)
    let testCodeunitId: number | undefined;
    try {
      const taskContent = await Deno.readTextFile(taskYmlPath);
      const taskYaml = parseYaml(taskContent) as Record<string, unknown>;
      const expected = taskYaml["expected"] as Record<string, unknown>;
      if (expected && typeof expected["testCodeunitId"] === "number") {
        testCodeunitId = expected["testCodeunitId"];
      }
    } catch {
      // Malformed task.yml - just skip testCodeunitId, don't fail the listing
    }

    // Check for prereq directory
    const prereqPath = join(dir, "prereq");
    const hasPrereq = await isDirectory(prereqPath);

    // Build the summary object, spreading optional fields only when defined
    const summary: DraftSummary = {
      id,
      dir,
      dirName,
      hasPrereq,
      ...(slug !== undefined ? { slug } : {}),
      ...(testCodeunitId !== undefined ? { testCodeunitId } : {}),
    };

    drafts.push(summary);
  }

  // Sort by id then dirName for deterministic ordering
  drafts.sort((a, b) => {
    const idCmp = a.id.localeCompare(b.id);
    return idCmp !== 0 ? idCmp : a.dirName.localeCompare(b.dirName);
  });

  return drafts;
}

/**
 * Resolve LLM models from a named benchmark preset.
 * Returns empty array if preset not found.
 */
export function resolvePresetModels(
  config: { benchmarkPresets?: Record<string, { llms?: string[] }> },
  presetName: string,
): string[] {
  if (!config.benchmarkPresets || !config.benchmarkPresets[presetName]) {
    return [];
  }
  return config.benchmarkPresets[presetName]?.llms ?? [];
}
