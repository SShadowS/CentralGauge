/**
 * Per-task rows (`tasks` table) for a task set, built from `tasks/**\/*.yml`.
 * Shared by `populate-task-set` and bench ingest (`ensureTaskSet`), which
 * POST them to `/api/v1/task-sets`.
 *
 * @module src/ingest/catalog/task-rows
 */

import { walk } from "jsr:@std/fs@^1.0.0/walk";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { parse as parseYaml } from "jsr:@std/yaml@^1.1.0";

export type Difficulty = "easy" | "medium" | "hard";

export interface TaskRow {
  task_id: string;
  content_hash: string;
  difficulty: Difficulty;
  category_slug: string;
  domains: string[];
  manifest: Record<string, unknown>;
}

function difficultyFromPath(relPath: string): Difficulty {
  const head = relPath.split("/")[0];
  if (head === "easy" || head === "medium" || head === "hard") return head;
  throw new Error(
    `cannot infer difficulty from path '${relPath}' (expected easy/, medium/, or hard/)`,
  );
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return encodeHex(new Uint8Array(digest));
}

export async function readTasksFromDir(tasksDir: string): Promise<TaskRow[]> {
  const rows: TaskRow[] = [];
  for await (
    const e of walk(tasksDir, { exts: [".yml"], includeDirs: false })
  ) {
    const rel = e.path.slice(tasksDir.length + 1).replaceAll("\\", "/");
    const bytes = await Deno.readFile(e.path);
    const text = new TextDecoder().decode(bytes);
    const manifest = parseYaml(text) as Record<string, unknown> | null;
    if (!manifest || typeof manifest !== "object") {
      throw new Error(`task ${rel}: manifest is not an object`);
    }
    const taskId = manifest["id"];
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new Error(`task ${rel}: manifest.id is missing or not a string`);
    }
    const md = manifest["metadata"] as Record<string, unknown> | undefined;
    const categorySlug = (md && typeof md["category"] === "string")
      ? (md["category"] as string)
      : "uncategorized";
    const rawDomains = manifest["domains"];
    const domains = Array.isArray(rawDomains)
      ? rawDomains.filter((d): d is string => typeof d === "string")
      : [];
    rows.push({
      task_id: taskId,
      content_hash: await sha256Hex(bytes),
      difficulty: difficultyFromPath(rel),
      category_slug: categorySlug,
      domains,
      manifest,
    });
  }
  rows.sort((
    a,
    b,
  ) => (a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0));
  return rows;
}
