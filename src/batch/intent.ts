/**
 * Write-ahead submission intent (`intent.json`, spec section 4.3).
 *
 * `writeIntent` is called and fsynced BEFORE `provider.submit` runs, so a
 * crash between submit and the handle being persisted into `state.json`
 * leaves `intent.json` behind. `advance` reads that leftover file to drive
 * reconciliation (the `submit-unknown` phase): the intent alone proves an
 * attempt was made, and its `itemIds`/`bodyDigests`/`writtenAt` are what a
 * candidate batch is validated against. `clearIntent` removes the file once
 * either the handle has been persisted (success) or the provider rejected
 * the submission synchronously (nothing to reconcile).
 *
 * @module src/batch/intent
 */
import { join } from "@std/path";
import { RUN_FILES } from "./paths.ts";
import { writeJsonAtomic } from "./state.ts";

export interface SubmissionIntent {
  runId: string;
  wave: 1 | 2;
  round: 0 | 1;
  chunk: number;
  itemIds: string[];
  bodyDigests: string[];
  nonce: string;
  writtenAt: string;
  /** OpenAI only: the uploaded input file id, persisted before batch creation. */
  inputFileId?: string;
}

function intentPath(dir: string): string {
  return join(dir, RUN_FILES.intent);
}

/** Writes `intent.json` atomically (fsynced) before a submission is attempted. */
export async function writeIntent(
  dir: string,
  intent: SubmissionIntent,
): Promise<void> {
  await writeJsonAtomic(intentPath(dir), intent);
}

/** Reads `intent.json`, or `null` when no intent is currently written. */
export async function readIntent(
  dir: string,
): Promise<SubmissionIntent | null> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(intentPath(dir));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  return JSON.parse(raw) as SubmissionIntent;
}

/** Removes `intent.json`. A no-op when the file is already gone. */
export async function clearIntent(dir: string): Promise<void> {
  try {
    await Deno.remove(intentPath(dir));
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}
