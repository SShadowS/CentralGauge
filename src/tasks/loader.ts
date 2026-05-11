import { exists } from "@std/fs";
import { parse } from "@std/yaml";
import { ResourceNotFoundError } from "../errors.ts";
import { parseTaskManifest, type TaskManifest } from "./interfaces.ts";

/**
 * Load a task manifest from a YAML file
 */
export async function loadTaskManifest(
  manifestPath: string,
): Promise<TaskManifest> {
  if (!await exists(manifestPath)) {
    throw new ResourceNotFoundError(
      `Task manifest not found: ${manifestPath}`,
      "task-manifest",
      manifestPath,
    );
  }

  const content = await Deno.readTextFile(manifestPath);
  const raw = parse(content);

  return parseTaskManifest(raw, manifestPath);
}
