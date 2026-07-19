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

/**
 * Last match wins: a prior bug let appendPricingIfChanged accumulate
 * duplicate (slug, pricing_version) rows (D2). Reading the LAST occurrence
 * makes the "did it already change?" comparison reflect the most recently
 * written row instead of a stale earlier one, for files that still carry
 * leftover duplicates from before the write-side fix below.
 */
function findPricingAtVersion(
  content: string,
  slug: string,
  pricingVersion: string,
): { input: number; output: number } | null {
  if (content.trim().length === 0) return null;
  const parsed = parseYaml(content) as PricingRow[] | null;
  if (!parsed || !Array.isArray(parsed)) return null;
  let match: PricingRow | undefined;
  for (const r of parsed) {
    if (r.model_slug === slug && r.pricing_version === pricingVersion) {
      match = r;
    }
  }
  if (!match) return null;
  return {
    input: match.input_per_mtoken,
    output: match.output_per_mtoken,
  };
}

/** Leading `#`/blank lines, preserved when a replace-path rewrite regenerates the file body. */
function extractLeadingComments(content: string): string {
  const lines = content.split("\n");
  let i = 0;
  while (
    i < lines.length &&
    (lines[i]!.trim() === "" || lines[i]!.trim().startsWith("#"))
  ) {
    i++;
  }
  if (i === 0) return "";
  const header = lines.slice(0, i).join("\n");
  return header.endsWith("\n") ? header : header + "\n";
}

export async function appendPricingIfChanged(
  path: string,
  row: PricingRow,
): Promise<AppendResult> {
  const existing = await readTextSafe(path);
  const latest = findPricingAtVersion(
    existing,
    row.model_slug,
    row.pricing_version,
  );

  const needsWrite = latest === null ||
    latest.input !== row.input_per_mtoken ||
    latest.output !== row.output_per_mtoken;
  if (!needsWrite) {
    return { added: false };
  }

  const parsed = existing.trim().length === 0
    ? []
    : ((parseYaml(existing) as PricingRow[] | null) ?? []);
  const matches = parsed.filter(
    (r) =>
      r.model_slug === row.model_slug &&
      r.pricing_version === row.pricing_version,
  );

  if (matches.length === 0) {
    // Fast path: no existing row for this (slug, version) — a pure append
    // preserves header comments + formatting of the rest of the file.
    const trailingNewline = existing.endsWith("\n") || existing.length === 0
      ? ""
      : "\n";
    const next = existing + trailingNewline + pricingRowToYaml(row);
    await writeAtomic(path, next);
    return { added: true };
  }

  // Replace path: a same-(slug, version) row already exists and differs.
  // Drop every existing row for the pair (folding away any pre-existing
  // duplicates from before this fix) and append the fresh one — REPLACE,
  // not accumulate.
  const withoutSameVersion = parsed.filter(
    (r) =>
      !(r.model_slug === row.model_slug &&
        r.pricing_version === row.pricing_version),
  );
  const header = extractLeadingComments(existing);
  const body = stringify([...withoutSameVersion, row], { lineWidth: -1 });
  await writeAtomic(path, header + body);
  return { added: true };
}
