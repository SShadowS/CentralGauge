/**
 * Knowledge Bank Loader
 * Loads and formats markdown files for injection into prompts
 * @module src/prompts/knowledge-loader
 */

import { extname, join } from "@std/path";

/**
 * Options for loading knowledge files
 */
export interface KnowledgeLoadOptions {
  /** Specific files to load */
  files?: string[] | undefined;
  /** Directory to load all .md files from */
  directory?: string | undefined;
}

/**
 * Format loaded knowledge content with headers
 */
function formatKnowledgeContent(
  filesContent: Map<string, string>,
): string {
  if (filesContent.size === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("# Knowledge Bank");
  lines.push("");
  lines.push("The following guidance should inform your code generation:");
  lines.push("");

  for (const [filePath, content] of filesContent) {
    lines.push("---");
    lines.push(`## ${filePath}`);
    lines.push("");
    lines.push(content.trim());
    lines.push("");
  }

  lines.push("# End Knowledge Bank");
  lines.push("");

  return lines.join("\n");
}

/**
 * Get all .md files from a directory, sorted alphabetically
 */
async function getMarkdownFilesFromDir(dirPath: string): Promise<string[]> {
  const files: string[] = [];

  try {
    for await (const entry of Deno.readDir(dirPath)) {
      if (entry.isFile && extname(entry.name).toLowerCase() === ".md") {
        files.push(join(dirPath, entry.name));
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Knowledge directory not found: ${dirPath}`);
    }
    throw error;
  }

  // Sort alphabetically for consistent ordering
  return files.sort();
}

/**
 * Load content from a single file
 */
async function loadFileContent(filePath: string): Promise<string> {
  try {
    return await Deno.readTextFile(filePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Knowledge file not found: ${filePath}`);
    }
    throw error;
  }
}

/**
 * Load knowledge files from specified paths and/or directory
 *
 * @param options - Files and/or directory to load
 * @returns Formatted knowledge content or undefined if nothing to load
 */
export async function loadKnowledgeFiles(
  options: KnowledgeLoadOptions,
): Promise<string | undefined> {
  const { files, directory } = options;

  // Collect all file paths
  const allFiles: string[] = [];

  // Add explicit files
  if (files && files.length > 0) {
    allFiles.push(...files);
  }

  // Add files from directory
  if (directory) {
    const dirFiles = await getMarkdownFilesFromDir(directory);
    allFiles.push(...dirFiles);
  }

  // Nothing to load
  if (allFiles.length === 0) {
    return undefined;
  }

  // Load all file contents, keyed by the full path passed in (not the
  // basename — two files with the same name in different directories must
  // both load rather than the second silently overwriting the first; D6).
  const filesContent = new Map<string, string>();

  for (const filePath of allFiles) {
    const content = await loadFileContent(filePath);
    filesContent.set(filePath, content);
  }

  // Format and return
  return formatKnowledgeContent(filesContent);
}

/**
 * Check if knowledge options are provided
 */
export function hasKnowledgeOptions(options: KnowledgeLoadOptions): boolean {
  return (options.files && options.files.length > 0) ||
    (options.directory !== undefined && options.directory !== "");
}
