/**
 * Draft discovery and model selection for the authoring dashboard.
 * Identifies scaffolded drafts in scratch/ directory and resolves model presets.
 */

import { exists } from "@std/fs";
import { join, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

import type { PromptInjectionConfig } from "../prompts/types.ts";
import { DRAFT_STARTER_DIRNAME } from "../tasks/starter-code.ts";

export interface DraftSummary {
  id: string;
  dir: string;
  dirName: string;
  slug?: string;
  /**
   * `task.yml`'s `description` — the question the models are actually
   * asked, rendered through the bench's own attempt-1 template by
   * `buildGenerationPrompt`. `""` when absent or malformed, which
   * `validateRunRequest` refuses to start a run against rather than asking
   * every model an empty question.
   */
  description: string;
  /** `task.yml`'s `prompt_template`. Absent falls back to the bench default
   *  (`DEFAULT_PROMPT_TEMPLATE`), which is where that decision belongs. */
  promptTemplate?: string;
  /** `task.yml`'s `max_attempts`, a template variable the bench substitutes. */
  maxAttempts?: number;
  /** `task.yml`'s `prompts` injection block, applied by the bench at
   *  attempt 1. Carried so the dashboard's prompt cannot diverge from the
   *  bench's for a task that declares injections. */
  prompts?: PromptInjectionConfig;
  hasPrereq: boolean;
  /**
   * Filenames directly inside `prereq/`, sorted. `[]` when the directory
   * is absent, empty, or unreadable — never throws. Distinct from
   * `hasPrereq`: an empty `prereq/` directory is `hasPrereq: true` with
   * `prereqFiles: []`, a meaningful state (the author scaffolded it but
   * hasn't populated it yet) that a boolean alone can't tell apart from
   * "no prereq directory at all".
   */
  prereqFiles: string[];
  testCodeunitId?: number;
  /**
   * Absolute path to `scratch/<id>/starter/`, present only when that
   * directory contains at least one `.al` file — the same test
   * `loadStarterCode` applies, so a caller that sees this field can call
   * `loadStarterCode` and trust it will not come back `undefined` (barring a
   * race where the files are deleted between listing and use).
   */
  starterDir?: string;
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
 * Lists the filenames directly inside `dir` (files only, not
 * subdirectories), sorted. A missing, empty, or unreadable directory
 * yields `[]` rather than throwing — the same tolerance this module
 * already applies to malformed `task.yml`/`.meta.json`.
 */
async function listTopLevelFiles(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile) {
        names.push(entry.name);
      }
    }
  } catch {
    return [];
  }
  names.sort();
  return names;
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

    // Read task.yml ONCE. Everything below that comes out of it (the task id,
    // the prompt inputs, the test codeunit id) reads from this single parse:
    // an unreadable or malformed file degrades every field together, which is
    // the honest behaviour, and each extra read was a chance for two blocks to
    // disagree about the same file.
    let taskYaml: Record<string, unknown> = {};
    try {
      const taskContent = await Deno.readTextFile(taskYmlPath);
      taskYaml = (parseYaml(taskContent) ?? {}) as Record<string, unknown>;
    } catch {
      // Malformed task.yml - every field below falls back on its own terms.
    }

    // id from task.yml (authoritative), falling back to the directory name.
    const id = typeof taskYaml["id"] === "string" ? taskYaml["id"] : dirName;

    // The prompt inputs the bench renders its attempt-1 request from.
    const description = typeof taskYaml["description"] === "string"
      ? taskYaml["description"]
      : "";
    const promptTemplate = typeof taskYaml["prompt_template"] === "string"
      ? taskYaml["prompt_template"]
      : undefined;
    const maxAttempts = typeof taskYaml["max_attempts"] === "number"
      ? taskYaml["max_attempts"]
      : undefined;
    // Shape-checked only as far as "an object": PromptInjectionResolver
    // tolerates unknown provider/stage keys, and refusing a draft outright
    // over an injection block it may still be editing would be worse than
    // rendering what it says.
    const prompts = typeof taskYaml["prompts"] === "object" &&
        taskYaml["prompts"] !== null
      ? taskYaml["prompts"] as PromptInjectionConfig
      : undefined;

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

    // testCodeunitId from task.yml's expected block (optional).
    const expected = taskYaml["expected"] as
      | Record<string, unknown>
      | undefined;
    const testCodeunitId = expected &&
        typeof expected["testCodeunitId"] === "number"
      ? expected["testCodeunitId"]
      : undefined;

    // Check for prereq directory, and list its files when present
    const prereqPath = join(dir, "prereq");
    const hasPrereq = await isDirectory(prereqPath);
    const prereqFiles = await listTopLevelFiles(prereqPath);

    // starterDir is present only when scratch/<id>/starter/ actually holds a
    // .al file — the same condition loadStarterCode itself resolves under,
    // so a caller that sees this field can trust a subsequent
    // loadStarterCode(starterDir) call to succeed (barring a delete race).
    const starterPath = resolve(dir, DRAFT_STARTER_DIRNAME);
    const starterFiles = await listTopLevelFiles(starterPath);
    const hasStarterAl = starterFiles.some((name) =>
      name.toLowerCase().endsWith(".al")
    );

    // Build the summary object, spreading optional fields only when defined
    const summary: DraftSummary = {
      id,
      dir,
      dirName,
      description,
      hasPrereq,
      prereqFiles,
      ...(slug !== undefined ? { slug } : {}),
      ...(promptTemplate !== undefined ? { promptTemplate } : {}),
      ...(maxAttempts !== undefined ? { maxAttempts } : {}),
      ...(prompts !== undefined ? { prompts } : {}),
      ...(testCodeunitId !== undefined ? { testCodeunitId } : {}),
      ...(hasStarterAl ? { starterDir: starterPath } : {}),
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
