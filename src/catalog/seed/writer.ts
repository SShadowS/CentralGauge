/**
 * Atomic YAML appenders for catalog seeding.
 * Reads existing files, appends new rows, writes via temp + rename.
 * @module catalog/seed/writer
 */

import { parse as parseYaml, stringify } from "@std/yaml";
import type { FamilyRow, ModelRow, PricingRow } from "./types.ts";
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

function modelExists(content: string, slug: string): boolean {
  const pattern = new RegExp(`^- slug:\\s+${escapeRegex(slug)}\\s*$`, "m");
  return pattern.test(content);
}

function modelRowToYaml(row: ModelRow): string {
  // Use a single-element array so output is sequence-of-mapping form ("- slug: ...").
  // stringify auto-quotes values containing YAML metacharacters (colons, hashes, etc.).
  return stringify([row], { lineWidth: -1 });
}

export async function appendModel(
  path: string,
  row: ModelRow,
): Promise<AppendResult> {
  const existing = await readTextSafe(path);
  if (modelExists(existing, row.slug)) {
    return { added: false };
  }
  const trailingNewline = existing.endsWith("\n") || existing.length === 0
    ? ""
    : "\n";
  const next = existing + trailingNewline + modelRowToYaml(row);
  await writeAtomic(path, next);
  return { added: true };
}

function pricingRowToYaml(row: PricingRow): string {
  return stringify([row], { lineWidth: -1 });
}

function findLatestPricing(
  content: string,
  slug: string,
): { input: number; output: number } | null {
  if (content.trim().length === 0) return null;
  const parsed = parseYaml(content) as PricingRow[] | null;
  if (!parsed || !Array.isArray(parsed)) return null;
  const matches = parsed.filter((r) => r.model_slug === slug);
  if (matches.length === 0) return null;
  // Latest by pricing_version (lexicographic ISO date sort, descending).
  matches.sort((a, b) =>
    a.pricing_version < b.pricing_version
      ? 1
      : a.pricing_version > b.pricing_version
      ? -1
      : 0
  );
  const latest = matches[0]!;
  return {
    input: latest.input_per_mtoken,
    output: latest.output_per_mtoken,
  };
}

export async function appendPricingIfChanged(
  path: string,
  row: PricingRow,
): Promise<AppendResult> {
  const existing = await readTextSafe(path);
  const latest = findLatestPricing(existing, row.model_slug);
  if (
    latest !== null &&
    latest.input === row.input_per_mtoken &&
    latest.output === row.output_per_mtoken
  ) {
    return { added: false };
  }
  const trailingNewline = existing.endsWith("\n") || existing.length === 0
    ? ""
    : "\n";
  const next = existing + trailingNewline + pricingRowToYaml(row);
  await writeAtomic(path, next);
  return { added: true };
}
