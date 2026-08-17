/**
 * Object identity and the matrix row universe.
 *
 * Four model columns share rows. Without a defined row universe and merge rule,
 * the same object under two spellings produces phantom "missing" and "extra"
 * rows. This module provides identity functions to normalize object references
 * and merge them into a unified set of rows.
 *
 * @module al/object-identity
 */

import type { AlObject } from "./object-parser.ts";

/**
 * Normalizes a name by stripping quotes, collapsing whitespace, trimming,
 * and lowercasing.
 *
 * @example
 * normalizeName('"CG  X054   Agent"') // "cg x054 agent"
 * normalizeName("CG X054 Agent") // "cg x054 agent"
 */
export function normalizeName(name: string): string {
  // Strip leading and trailing quotes if both are present
  let text = name;
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1);
  }

  // Collapse runs of whitespace to single space, trim, lowercase
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Creates a unique key for an object based on kind, id (or name), and
 * extends target.
 *
 * Key precedence:
 * - kind (required)
 * - id when present, else name (normalized)
 * - extendsTarget (normalized) when present
 */
export function objectKey(o: AlObject): string {
  const parts: string[] = [o.kind];

  if (o.id !== undefined) {
    parts.push(`${o.id}`);
  } else {
    parts.push(`name:${normalizeName(o.name)}`);
  }

  if (o.extendsTarget !== undefined) {
    parts.push(normalizeName(o.extendsTarget));
  }

  return parts.join("|");
}

export interface MatrixRow {
  key: string;
  kind: string;
  id?: number;
  name: string;
  extendsTarget?: string;
}

/**
 * Builds a unified row universe from reference objects and response objects.
 *
 * Starts with reference objects in order, then appends each response's
 * objects that are not already present. Presence is tested by objectKey
 * first; if that misses, falls back to matching by kind + normalized name
 * (the merge rule for the same object under different ids).
 *
 * Rows keep the first-seen id and name; mismatches between ids for the same
 * object are rendered as badges by the UI, not by this function.
 */
export function buildRowUniverse(
  reference: AlObject[],
  responses: ReadonlyArray<{ model: string; objects: AlObject[] }>,
): MatrixRow[] {
  // Map from objectKey to index for fast lookup
  const keyToIndex = new Map<string, number>();
  // Map from (kind, normalizedName) to index for fallback name-based matching
  const nameToIndex = new Map<string, number>();
  // The accumulated rows
  const rows: MatrixRow[] = [];

  /**
   * Adds an object to the universe if not already present.
   * Returns the index of the row (new or existing).
   */
  function addObject(obj: AlObject): number {
    const key = objectKey(obj);

    // Check if already present by key
    if (keyToIndex.has(key)) {
      return keyToIndex.get(key)!;
    }

    // Fall back to name-based matching (merge rule)
    const normalizedName = normalizeName(obj.name);
    const nameKeyParts: string[] = [obj.kind, normalizedName];
    if (obj.extendsTarget !== undefined) {
      nameKeyParts.push(normalizeName(obj.extendsTarget));
    }
    const nameKey = nameKeyParts.join("|");
    if (nameToIndex.has(nameKey)) {
      return nameToIndex.get(nameKey)!;
    }

    // New object: add to rows
    const index = rows.length;
    const row: MatrixRow = {
      key,
      kind: obj.kind,
      name: obj.name,
      ...(obj.id !== undefined ? { id: obj.id } : {}),
      ...(obj.extendsTarget !== undefined
        ? { extendsTarget: obj.extendsTarget }
        : {}),
    };
    rows.push(row);

    // Track this row
    keyToIndex.set(key, index);
    nameToIndex.set(nameKey, index);

    return index;
  }

  // Start with reference objects
  for (const obj of reference) {
    addObject(obj);
  }

  // Add objects from each response that aren't already present
  for (const response of responses) {
    for (const obj of response.objects) {
      addObject(obj);
    }
  }

  return rows;
}
