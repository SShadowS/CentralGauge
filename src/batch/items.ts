/**
 * Deterministic item ids and body digests for batch mode (spec section 4.1).
 *
 * An item id is computed purely from `(runId, taskId, attempt, round)`,
 * never from a random value, so an aborted-and-resumed prepare/submit cycle
 * produces the SAME id for the same logical item. That is what lets a crash
 * recovery re-derive item ids instead of tracking a second identity scheme,
 * and what lets the provider-side response (keyed by our item id) be
 * matched back to a task deterministically.
 *
 * @module src/batch/items
 */
import { sha256Hex } from "../../shared/settings-hash.ts";
import { canonicalJSON } from "../../shared/canonical.ts";

/**
 * `"b"` + the first 31 hex characters of
 * `sha256(`${runId}|${taskId}|${attempt}|${round}`)`, 32 characters total.
 * The leading `"b"` guarantees an alphanumeric first character (some
 * providers reject a custom/item id that starts with a digit).
 */
export async function itemIdFor(
  runId: string,
  taskId: string,
  attempt: 1 | 2,
  round: 0 | 1,
): Promise<string> {
  const digest = await sha256Hex(`${runId}|${taskId}|${attempt}|${round}`);
  return `b${digest.slice(0, 31)}`;
}

/** sha256 of the canonical JSON serialization of a request body. */
export async function bodyDigest(body: unknown): Promise<string> {
  return await sha256Hex(canonicalJSON(body));
}
