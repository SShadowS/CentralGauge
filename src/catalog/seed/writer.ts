/**
 * Atomic YAML appenders for catalog seeding.
 * Reads existing files, appends new rows, writes via temp + rename.
 * @module catalog/seed/writer
 */

import { stringify } from "@std/yaml";
import type { FamilyRow } from "./types.ts";
import { CatalogSeedError } from "../../errors.ts";

export interface AppendResult {
  added: boolean;
}

async function readTextSafe(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return "";
    throw e;
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tempPath = `${path}.tmp.${crypto.randomUUID()}`;
  try {
    await Deno.writeTextFile(tempPath, content);
    await Deno.rename(tempPath, path);
  } catch (e) {
    try {
      await Deno.remove(tempPath);
    } catch {
      // ignore cleanup failure
    }
    throw new CatalogSeedError(
      `failed to write ${path}: ${e instanceof Error ? e.message : String(e)}`,
      "SEED_YAML_WRITE",
      { path },
    );
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function familyExists(content: string, slug: string): boolean {
  const pattern = new RegExp(`^- slug:\\s+${escapeRegex(slug)}\\s*$`, "m");
  return pattern.test(content);
}

function familyRowToYaml(row: FamilyRow): string {
  // Use a single-element array so output is sequence-of-mapping form ("- slug: ...").
  // stringify auto-quotes values containing YAML metacharacters (colons, hashes, etc.).
  return stringify([row], { lineWidth: -1 });
}

export async function ensureFamily(
  path: string,
  row: FamilyRow,
): Promise<AppendResult> {
  const existing = await readTextSafe(path);
  if (familyExists(existing, row.slug)) {
    return { added: false };
  }
  const trailingNewline = existing.endsWith("\n") || existing.length === 0
    ? ""
    : "\n";
  const next = existing + trailingNewline + familyRowToYaml(row);
  await writeAtomic(path, next);
  return { added: true };
}
