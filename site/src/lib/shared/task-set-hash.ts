/**
 * Shared helpers for validating task_set hash values.
 *
 * A task_set hash is a 64-character lowercase hex string (SHA-256).
 * This module is the single source of truth for the regex — previously
 * duplicated across the route validator, leaderboard.ts, and denominator.ts.
 */

export const TASK_SET_HASH_REGEX = /^[0-9a-f]{64}$/;

export function isValidTaskSetHash(s: string): boolean {
  return TASK_SET_HASH_REGEX.test(s);
}
