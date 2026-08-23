import { join } from "@std/path";

/**
 * Directory name for starter code in draft workspaces
 */
export const DRAFT_STARTER_DIRNAME = "starter";

/**
 * Compute the starter code directory path for a task within a project
 */
export function starterDirForTask(
  projectRoot: string,
  taskId: string,
): string {
  return join(projectRoot, "tasks", "starter", taskId);
}

/**
 * Load starter code from a directory.
 *
 * Reads every .al file directly in the given directory (no recursion),
 * sorts them by filename (case-insensitive ordinal), and concatenates them
 * with "// FILE: <basename>" headers.
 *
 * @param dir - Directory to read from
 * @returns Concatenated starter code, or undefined if dir does not exist or contains no .al files
 * @throws On any I/O error other than directory-not-found (e.g., permission denied, file read errors)
 */
export async function loadStarterCode(
  dir: string,
): Promise<string | undefined> {
  const alFiles: string[] = [];

  try {
    const entries = await Deno.readDir(dir);
    for await (const entry of entries) {
      if (entry.isFile && entry.name.toLowerCase().endsWith(".al")) {
        alFiles.push(entry.name);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }

  if (alFiles.length === 0) {
    return undefined;
  }

  // Sort case-insensitive
  alFiles.sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);

  const blocks: string[] = [];
  for (const filename of alFiles) {
    const content = await Deno.readTextFile(join(dir, filename));
    blocks.push(`// FILE: ${filename}\n${content}`);
  }

  return blocks.join("\n\n");
}
