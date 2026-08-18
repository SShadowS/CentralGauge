/**
 * Fan-out driver for the authoring dashboard's "quick run".
 *
 * Asks every model the same question, then for each response: resolves it
 * into the code the bench would actually compile (`resolveCandidate`),
 * parses that code into AL objects (`parseAlObjects`), and classifies it
 * against the trap the draft's correct/naive pair establishes
 * (`deriveTrapSignature` / `classifyAgainstSignature`). The responses'
 * objects are merged with the reference objects into the matrix row
 * universe (`buildRowUniverse`) an authoring UI renders one row per object.
 *
 * `call` is injected (`ModelCaller`) so no unit test ever reaches a real
 * provider — the server wires in the real adapter-backed caller.
 *
 * @module dashboard/run-manager
 */

import { ensureDir } from "@std/fs";
import { isAbsolute, relative, resolve } from "@std/path";

import type { AlObject } from "../al/object-parser.ts";
import type { MatrixRow } from "../al/object-identity.ts";
import type {
  TrapClassification,
  TrapSignature,
} from "../al/trap-signature.ts";
import type { CandidateResolution } from "../llm/candidate-resolution.ts";
import type { LLMResponse } from "../llm/types.ts";
import type { DraftSummary } from "./drafts.ts";

import { parseAlObjects } from "../al/object-parser.ts";
import { buildRowUniverse } from "../al/object-identity.ts";
import {
  classifyAgainstSignature,
  deriveTrapSignature,
} from "../al/trap-signature.ts";
import { resolveCandidate } from "../llm/candidate-resolution.ts";

export interface ModelResponse {
  model: string;
  rawResponse: string;
  resolution: CandidateResolution;
  objects: AlObject[];
  classification: TrapClassification;
  error?: string;
}

export interface QuickRun {
  draftId: string;
  startedAt: string;
  responses: ModelResponse[];
  rows: MatrixRow[];
}

export type ModelCaller = (
  model: string,
  prompt: string,
) => Promise<{ content: string; finishReason: LLMResponse["finishReason"] }>;

/**
 * Calls `call` for one model and turns the outcome into a `ModelResponse`.
 *
 * A rejection gets verdict `cannot-compare`, not `different-approach`: a
 * model that threw produced nothing to compare, and a resolved-looking cell
 * would misrepresent that in a UI whose whole point is judging responses at
 * a glance. `objects` is `[]` and the rejection's message lands in `error`,
 * which is what a caller uses to tell "no answer" apart from a genuine
 * empty-signature comparison.
 */
async function runOneModel(
  model: string,
  prompt: string,
  signature: TrapSignature,
  call: ModelCaller,
): Promise<ModelResponse> {
  try {
    const { content, finishReason } = await call(model, prompt);
    const resolution = resolveCandidate(content, finishReason);
    const { objects } = await parseAlObjects(resolution.cleanedCode);
    const classification = await classifyAgainstSignature(
      signature,
      resolution.cleanedCode,
    );
    return {
      model,
      rawResponse: content,
      resolution,
      objects,
      classification,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      model,
      rawResponse: "",
      resolution: resolveCandidate("", "error"),
      objects: [],
      classification: { verdict: "cannot-compare" },
      error: message,
    };
  }
}

/**
 * Runs every model concurrently against the same prompt and trap signature,
 * then builds the matrix row universe from the reference objects (parsed
 * from `correctSources`) plus every response's own objects.
 *
 * Each model call is independently caught inside `runOneModel`, so
 * `Promise.all` here never itself rejects on a single model's failure — one
 * model erroring never aborts, delays, or drops the others' results.
 */
export async function runQuick(opts: {
  draft: DraftSummary;
  models: string[];
  prompt: string;
  correctSources: string[];
  naiveSources: string[];
  call: ModelCaller;
}): Promise<QuickRun> {
  const signature = await deriveTrapSignature(
    opts.correctSources,
    opts.naiveSources,
  );

  const responses = await Promise.all(
    opts.models.map((model) =>
      runOneModel(model, opts.prompt, signature, opts.call)
    ),
  );

  const referenceParses = await Promise.all(
    opts.correctSources.map((source) => parseAlObjects(source)),
  );
  const referenceObjects = referenceParses.flatMap((parsed) => parsed.objects);

  const rows = buildRowUniverse(
    referenceObjects,
    responses.map((r) => ({ model: r.model, objects: r.objects })),
  );

  return {
    draftId: opts.draft.id,
    startedAt: new Date().toISOString(),
    responses,
    rows,
  };
}

/**
 * Characters illegal in a Windows filename, plus ASCII control characters
 * (also illegal on Windows — the `\x00-\x1F` range below is intentional).
 */
// deno-lint-ignore no-control-regex
const WINDOWS_ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

/** Replaces every character illegal in a Windows filename with `-`. */
function sanitizeForFilename(value: string): string {
  return value.replace(WINDOWS_ILLEGAL_FILENAME_CHARS, "-");
}

/**
 * Writes `run` as JSON under `<draftDir>/.runs/`, at
 * `<draftId>-<sanitized-timestamp>.json`.
 *
 * The timestamp is sanitized because `Date#toISOString()` contains `:`,
 * which is illegal in a Windows filename — this repo is developed on
 * Windows, so an unsanitized timestamp would either fail outright or
 * silently create an NTFS alternate data stream.
 *
 * `draftId` is used as-is (not sanitized) so the path guard below has
 * something real to defend against: both the `.runs/` directory and the
 * constructed output path are resolved, and the write is refused unless the
 * resolved output path actually lands inside `.runs/`. This deliberately
 * does not check for a `..` substring in the raw id, which a differently
 * encoded traversal (e.g. mixed separators) would defeat.
 *
 * The written JSON has a top-level `draftId` and no `results` key — that,
 * together with the `.runs/` rooting, is one of the two structural barriers
 * against a stray manual `ingest` replay picking this file up as a
 * `benchmark-results-*.json`.
 */
export async function writeRunArtifact(
  draftDir: string,
  run: QuickRun,
): Promise<string> {
  const runsDir = resolve(draftDir, ".runs");
  const timestamp = sanitizeForFilename(new Date().toISOString());
  const filename = `${run.draftId}-${timestamp}.json`;
  const outputPath = resolve(runsDir, filename);

  const rel = relative(runsDir, outputPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `refusing to write run artifact outside .runs/ (draftId=${run.draftId})`,
    );
  }

  await ensureDir(runsDir);
  const payload = {
    draftId: run.draftId,
    startedAt: run.startedAt,
    responses: run.responses,
    rows: run.rows,
  };
  await Deno.writeTextFile(outputPath, JSON.stringify(payload, null, 2));
  return outputPath;
}
