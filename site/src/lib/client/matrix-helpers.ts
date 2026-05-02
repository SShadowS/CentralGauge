/**
 * Pure helpers for the Task Results Matrix widget. Lives on the client side
 * so the Svelte component can import without a server-only module barrier;
 * the server-side `matrix.ts` re-exports the same function so SQL aggregation
 * and tooltip rendering share one classification.
 *
 * Why ratio buckets and not raw count: with N attempts per task variable
 * across runs, a fixed "3/3 = pass-all" rule breaks for any model that
 * attempted a task 1× or 4×. Ratios scale.
 */

export type CellBucket =
  | "pass-all"
  | "pass-most"
  | "pass-some"
  | "fail-all"
  | "no-data";

export function cellColorBucket(passed: number, attempted: number): CellBucket {
  if (attempted === 0) return "no-data";
  const ratio = passed / attempted;
  if (ratio === 1) return "pass-all";
  if (ratio >= 0.5) return "pass-most";
  if (ratio > 0) return "pass-some";
  return "fail-all";
}
