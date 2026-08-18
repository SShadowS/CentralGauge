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

/**
 * The identity used when {@link objectKey} misses: kind + normalized name
 * (+ extends target), ignoring the numeric id entirely. This is the merge
 * rule for "the same object under a different id", and it is deliberately
 * shared between {@link buildRowUniverse} (which creates rows) and
 * {@link assignObjectsToRows} (which fills them), so the two cannot drift.
 */
export function nameFallbackKey(
  o: { kind: string; name: string; extendsTarget?: string },
): string {
  const parts: string[] = [o.kind, normalizeName(o.name)];
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
  /**
   * True when this row's identity was first established by a `reference`
   * object (i.e. it is something the task's `correct/` solution actually
   * contains). False when the row was first established by a response —
   * an object no reference solution asked for.
   *
   * Set once, at row creation, from whichever side (`reference` or a
   * response) first introduces this identity, and never overwritten:
   * `buildRowUniverse` processes every `reference` object before any
   * response object, so a row a response later matches against an
   * already-existing reference row stays `true`. This is what lets a
   * consumer (the matrix UI) render "Wrote extra object" exactly, from
   * `!row.inReference`, instead of guessing from indirect evidence.
   */
  inReference: boolean;
}

/**
 * Builds a unified row universe from reference objects and response objects.
 *
 * Starts with reference objects in order, then appends each response's
 * objects that are not already present. Presence is tested by objectKey
 * first; if that misses, falls back to matching by kind + normalized name
 * (the merge rule for the same object under different ids).
 *
 * Rows keep the first-seen id and name. An id that does not line up for the
 * same object is a presentation concern, not this function's: spec §3 asks
 * for it as an in-cell badge per response, which plan 1 does NOT build. The
 * data is there (`row.id` vs the assigned object's `id` — see
 * {@link assignObjectsToRows}); nothing renders it yet.
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
   * Adds an object to the universe if not already present. `isReference`
   * is only consulted on first creation of a row — see `MatrixRow.inReference`.
   * Returns the index of the row (new or existing).
   */
  function addObject(obj: AlObject, isReference: boolean): number {
    const key = objectKey(obj);

    // Check if already present by key
    if (keyToIndex.has(key)) {
      return keyToIndex.get(key)!;
    }

    // Fall back to name-based matching (merge rule)
    const nameKey = nameFallbackKey(obj);
    if (nameToIndex.has(nameKey)) {
      return nameToIndex.get(nameKey)!;
    }

    // New object: add to rows
    const index = rows.length;
    const row: MatrixRow = {
      key,
      kind: obj.kind,
      name: obj.name,
      inReference: isReference,
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
    addObject(obj, true);
  }

  // Add objects from each response that aren't already present
  for (const response of responses) {
    for (const obj of response.objects) {
      addObject(obj, false);
    }
  }

  return rows;
}

/**
 * Which of `objects` fills each row, as `row.key` -> index into `objects`.
 * A row no object fills is simply absent from the result.
 *
 * This is the matrix's cell placement, computed once on the server. The UI
 * used to re-derive it in `src/dashboard/ui/app.js` from its own copies of
 * `normalizeName` and `objectKey`, with a comment asking a future editor to
 * keep the two in sync and no test able to notice when they stopped being
 * so: changing a rule here left the suite green and quietly moved every
 * cell. The server already holds both sides, so it answers the question
 * instead of asking the client to.
 *
 * Matching is the same two-step rule {@link buildRowUniverse} uses, in the
 * same order: an exact {@link objectKey} pass over every object first, then
 * a {@link nameFallbackKey} pass. Per row rather than per object, so an
 * exact match always outranks a name-only one no matter what order the
 * objects arrived in.
 */
export function assignObjectsToRows(
  rows: ReadonlyArray<MatrixRow>,
  objects: ReadonlyArray<AlObject>,
): Record<string, number> {
  const assignments: Record<string, number> = {};

  for (const row of rows) {
    let index = objects.findIndex((obj) => objectKey(obj) === row.key);
    if (index === -1) {
      const rowKey = nameFallbackKey(row);
      index = objects.findIndex((obj) => nameFallbackKey(obj) === rowKey);
    }
    if (index !== -1) {
      assignments[row.key] = index;
    }
  }

  return assignments;
}
