/**
 * Controlled vocabulary of AL/BC domains a benchmark task exercises.
 *
 * A task's `domains` array is the validated, multi-select dimension that
 * powers per-domain leaderboard scores (P2-U1). It is distinct from
 * `metadata.category` (one of 7 broad themes) and `metadata.tags`
 * (free-form, unvalidated).
 *
 * Adding a value here is a schema change: once any task file uses the new
 * value the task-set hash changes and a re-bench is required. Batch
 * vocabulary changes deliberately — do not dribble.
 */

import { z } from "zod";

export const DOMAINS = [
  // structural data
  "tables",
  "table-relations",
  "flowfields",
  "enums",
  // UI / output objects
  "pages",
  "reports",
  "xmlports",
  "queries",
  // logic objects
  "codeunits",
  "interfaces",
  "events",
  // platform / cross-cutting
  "permissions",
  "install-upgrade",
  "posting",
  "dimensions",
  "testability",
  "integration",
  "performance",
] as const;

export type Domain = typeof DOMAINS[number];

export const DomainSchema = z.enum(DOMAINS);

/** Runtime type guard for an unknown value being a valid `Domain`. */
export function isDomain(value: unknown): value is Domain {
  return typeof value === "string" &&
    (DOMAINS as readonly string[]).includes(value);
}
