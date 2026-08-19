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
import type { BinderResult } from "../al/prereq-binder.ts";
import type { PrereqIndex } from "../al/prereq-index.ts";
import type {
  TrapClassification,
  TrapSignature,
} from "../al/trap-signature.ts";
import type { CandidateResolution } from "../llm/candidate-resolution.ts";
import type { PromptTemplateRenderer } from "../llm/prompt-building.ts";
import type { LLMResponse } from "../llm/types.ts";
import type { DraftSummary } from "./drafts.ts";

import { parseAlObjects } from "../al/object-parser.ts";
import {
  assignObjectsToRows,
  buildRowUniverse,
  normalizeName,
} from "../al/object-identity.ts";
import { bindResponseToPrereqs } from "../al/prereq-binder.ts";
import { buildPrereqIndex } from "../al/prereq-index.ts";
import {
  classifyAgainstSignature,
  deriveTrapSignature,
} from "../al/trap-signature.ts";
import { resolveCandidate } from "../llm/candidate-resolution.ts";
import {
  buildGenerationPrompt,
  DEFAULT_TEMPLATE_DIR,
} from "../llm/prompt-building.ts";
import { TemplateRenderer } from "../templates/renderer.ts";
import { providerOfModelSlug } from "./model-caller.ts";

/**
 * One row's genuine identity disagreement for one response — the server's
 * full, ready-to-render answer, so the UI derives nothing. Two objects can
 * share a matrix row via EITHER an exact id match (`objectKey`, name
 * ignored) or a normalized-name match (`nameFallbackKey`, id ignored —
 * `buildRowUniverse`'s merge rule), so the field the merge did NOT decide on
 * can still disagree between the row's first-seen identity and this
 * response's actual object. Present in `ModelResponse.rowIdentityConflicts`
 * ONLY when that disagreement is real: the ids differ, or the NORMALIZED
 * names differ (`normalizeName`, object-identity.ts — a case or whitespace
 * difference alone is not a conflict, since AL identifiers are
 * case-insensitive and `normalizeName` already erases both).
 *
 * `expectedId`/`actualId` are absent for id-less kinds
 * (interface/controladdin, `AlObject.id`'s own doc comment). `kind` and
 * `extendsTarget` are never carried here because they cannot disagree: both
 * `objectKey` and `nameFallbackKey` include them in the identity itself, so
 * anything assigned to a row already shares the row's `kind`/`extendsTarget`
 * exactly — a caller renders this alongside `row.kind`/`row.extendsTarget`.
 */
export interface RowIdentityConflict {
  expectedId?: number;
  expectedName: string;
  actualId?: number;
  actualName: string;
}

export interface ModelResponse {
  model: string;
  /**
   * The prompt this model was actually sent, rendered from the draft's
   * `task.yml` through the bench's own attempt-1 path
   * (`buildGenerationPrompt`). Recorded per model because prompt injections
   * are provider-scoped, so two models in one run can legitimately be asked
   * different things. `""` only when the render itself threw, in which case
   * `error` says why.
   */
  prompt: string;
  rawResponse: string;
  resolution: CandidateResolution;
  objects: AlObject[];
  /**
   * `ParsedAl.hasError`: the candidate resolved to code the bench would have
   * written to `<taskId>.al`, but the AL grammar could not parse it.
   * `parseAlObjects` returns `{objects: [], hasError: true}` for a syntax
   * error ANYWHERE in the candidate, so without this flag an unparseable
   * response is indistinguishable from one that wrote no objects — every
   * cell reads "not written" for a model that plainly wrote the object. An
   * ordinary prose-wrapped answer reaches this state: the extractor returns
   * the whole response at confidence 0.7 (faithful to the bench), so
   * `isReadyForCompile` is true and the parse then fails on the prose.
   */
  hasParseError: boolean;
  /**
   * Which of this response's `objects` fills each matrix row, as
   * `row.key` -> index into `objects` (`assignObjectsToRows`). Computed here
   * because the server holds both sides; the UI used to re-derive it from
   * its own copy of the identity rules, which nothing could keep in sync.
   */
  rowAssignments: Record<string, number>;
  /**
   * Which of `rowAssignments`' rows carry a genuine identity conflict
   * worth badging in the UI (spec §3) — `row.key` -> {@link RowIdentityConflict}.
   * Absent for a row this response has no assignment for, or where the
   * assigned object's id and normalized name both agree with the row's.
   */
  rowIdentityConflicts: Record<string, RowIdentityConflict>;
  classification: TrapClassification;
  error?: string;
  /**
   * Tiered prereq-reference findings for this response, from
   * `bindResponseToPrereqs`. Genuinely ABSENT — not present with an empty
   * `findings` array — when the draft has no prereq/ sources to check
   * against, or when this response errored before producing any code to
   * analyse (`runOneModel`'s catch path). Present means analysis actually
   * ran, even when `findings` came back empty.
   */
  prereqBinding?: BinderResult;
}

export interface QuickRun {
  draftId: string;
  startedAt: string;
  /**
   * The trap the whole run was classified against. Carried out so the UI can
   * name the deciding statements, and — when `sites` is empty — say WHY the
   * comparison could not happen. "Couldn't compare yet" with no reason leaves
   * an author unable to tell "fix your malformed naive/" from "this trap does
   * not discriminate", which need opposite actions.
   */
  signature: TrapSignature;
  responses: ModelResponse[];
  rows: MatrixRow[];
}

/** What a model is asked. Mirrors the `LLMRequest` fields the bench's
 *  attempt-1 path produces (`AppliedPromptInjection`). */
export interface ModelRequest {
  prompt: string;
  systemPrompt?: string;
}

export type ModelCaller = (
  model: string,
  request: ModelRequest,
) => Promise<{ content: string; finishReason: LLMResponse["finishReason"] }>;

/**
 * Renders the prompt for one model and calls `call` with it, turning the
 * outcome into a `ModelResponse`.
 *
 * The prompt is rendered HERE, per model, rather than once for the run: the
 * bench resolves prompt injections against the model's provider
 * (`PromptInjectionResolver.resolve`'s `provider` argument), so two models
 * in one run can legitimately be sent different text. Rendering it per model
 * is what makes the dashboard's prompt equal to the bench's for every model,
 * which is the whole point of spec §2b.
 *
 * A rejection — from the render or the provider — gets verdict
 * `cannot-compare`, not `different-approach`: a model that threw produced
 * nothing to compare, and a resolved-looking cell would misrepresent that in
 * a UI whose whole point is judging responses at a glance. `objects` is `[]`
 * and the rejection's message lands in `error`, which is what a caller uses
 * to tell "no answer" apart from a genuine empty-signature comparison.
 */
async function runOneModel(
  model: string,
  draft: DraftSummary,
  renderer: PromptTemplateRenderer,
  signature: TrapSignature,
  call: ModelCaller,
): Promise<Omit<ModelResponse, "rowAssignments" | "rowIdentityConflicts">> {
  let prompt = "";
  try {
    const applied = await buildGenerationPrompt({
      renderer,
      promptTemplate: draft.promptTemplate,
      description: draft.description,
      taskId: draft.id,
      maxAttempts: draft.maxAttempts,
      taskPrompts: draft.prompts,
      provider: providerOfModelSlug(model),
    });
    prompt = applied.prompt;

    const { content, finishReason } = await call(model, {
      prompt: applied.prompt,
      ...(applied.systemPrompt !== undefined
        ? { systemPrompt: applied.systemPrompt }
        : {}),
    });
    const resolution = resolveCandidate(content, finishReason);
    const { objects, hasError } = await parseAlObjects(resolution.cleanedCode);
    const classification = await classifyAgainstSignature(
      signature,
      resolution.cleanedCode,
    );
    return {
      model,
      prompt,
      rawResponse: content,
      resolution,
      objects,
      hasParseError: hasError,
      classification,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      model,
      prompt,
      rawResponse: "",
      resolution: resolveCandidate("", "error"),
      objects: [],
      hasParseError: false,
      classification: { verdict: "cannot-compare" },
      error: message,
    };
  }
}

/**
 * `ModelResponse.rowIdentityConflicts`: for each row `assignments` places an
 * object on, the full {@link RowIdentityConflict} when the id or the
 * NORMALIZED name (`normalizeName`, object-identity.ts, reused unmodified —
 * never re-derived here, and never in the UI) genuinely disagrees between
 * the row and the assigned object; absent from the result otherwise. Split
 * out from `assignObjectsToRows` itself (which stays untouched) because this
 * is presentation information about an already-decided assignment, not part
 * of deciding the assignment. The UI renders this record as-is — it performs
 * no comparison of its own, id or name, raw or normalized.
 */
function computeRowIdentityConflicts(
  rows: ReadonlyArray<MatrixRow>,
  objects: ReadonlyArray<AlObject>,
  assignments: Record<string, number>,
): Record<string, RowIdentityConflict> {
  const conflicts: Record<string, RowIdentityConflict> = {};
  for (const row of rows) {
    const index = assignments[row.key];
    if (index === undefined) continue;
    const obj = objects[index];
    if (!obj) continue;

    const idConflict = row.id !== undefined && obj.id !== undefined &&
      row.id !== obj.id;
    const nameConflict = normalizeName(row.name) !== normalizeName(obj.name);
    if (!idConflict && !nameConflict) continue;

    conflicts[row.key] = {
      expectedName: row.name,
      actualName: obj.name,
      ...(row.id !== undefined ? { expectedId: row.id } : {}),
      ...(obj.id !== undefined ? { actualId: obj.id } : {}),
    };
  }
  return conflicts;
}

/**
 * Runs every model concurrently against the same draft and trap signature,
 * then builds the matrix row universe from the reference objects (parsed
 * from `correctSources`) plus every response's own objects.
 *
 * There is deliberately NO `prompt` parameter. The question every model is
 * asked is rendered from the draft's own `task.yml` through the bench's
 * attempt-1 path (see `runOneModel`) — accepting a prompt from the caller is
 * how the dashboard came to ask every model the empty string, and accepting
 * one from a browser would also mean the author was calibrating against a
 * prompt the bench never sends (spec §2b).
 *
 * Each model call is independently caught inside `runOneModel`, so
 * `Promise.all` here never itself rejects on a single model's failure — one
 * model erroring never aborts, delays, or drops the others' results.
 */
export async function runQuick(opts: {
  draft: DraftSummary;
  models: string[];
  correctSources: string[];
  naiveSources: string[];
  /**
   * Raw AL source of the draft's `prereq/` app plus its chained
   * dependencies (`loadPrereqSources`'s `sources`). Built into a
   * `PrereqIndex` ONCE per run, not once per model — every model in a run
   * must be judged against the identical prereq, and rebuilding per
   * response would both waste parsing and let the columns drift apart.
   * Omitted or empty means the draft has no prereq to check: binding is
   * skipped entirely and every response's `prereqBinding` stays absent.
   */
  prereqSources?: string[];
  /**
   * `PrereqSources.hasError` — the loader could not read part of what it
   * was asked for, so `prereqSources` is INCOMPLETE rather than merely
   * small. Forwarded to `bindResponseToPrereqs`, which degrades instead of
   * reporting every member that never reached the index as invented.
   */
  prereqSourcesIncomplete?: boolean;
  call: ModelCaller;
  /** Overridable so a test can pin the rendered text without reading the
   *  repo's real `templates/`. Production passes nothing. */
  renderer?: PromptTemplateRenderer;
}): Promise<QuickRun> {
  const signature = await deriveTrapSignature(
    opts.correctSources,
    opts.naiveSources,
  );
  // A FRESH renderer per run, not one shared for the server's lifetime.
  // `TemplateRenderer` caches template text per instance, so a long-lived one
  // would read `templates/code-gen.md` once per process while the bench
  // re-reads it every run: an author editing the template would see the
  // dashboard keep showing the old prompt. That is precisely the fidelity
  // claim this tool exists to make. One instance per run, so every model in
  // a run is still asked from the same text.
  const renderer = opts.renderer ?? new TemplateRenderer(DEFAULT_TEMPLATE_DIR);

  const responses = await Promise.all(
    opts.models.map((model) =>
      runOneModel(model, opts.draft, renderer, signature, opts.call)
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

  // Deliberately built HERE, once for the whole run, and passed into every
  // response's binding call below — NOT moved inside the `responses.map`
  // loop that follows, even though nothing about correctness would change
  // if it were: `buildPrereqIndex` is pure given the same `prereqSources`,
  // so a per-response rebuild would produce identical `PrereqIndex` content
  // every time, just re-parsed N times over. The reason to keep it hoisted
  // is efficiency (no repeated parsing of the same prereq AL) and to keep
  // every model in a run provably judged against one identical index rather
  // than N independently-rebuilt ones that could in principle drift if this
  // function is ever made non-deterministic. `undefined` (rather than an
  // index built from `[]`) is what makes "no prereq to check" and "checked,
  // found nothing" two distinguishable states below.
  const prereqIndex: PrereqIndex | undefined =
    opts.prereqSources && opts.prereqSources.length > 0
      ? await buildPrereqIndex(opts.prereqSources)
      : undefined;

  const boundResponses = await Promise.all(
    responses.map(async (response) => {
      const rowAssignments = assignObjectsToRows(rows, response.objects);
      const rowIdentityConflicts = computeRowIdentityConflicts(
        rows,
        response.objects,
        rowAssignments,
      );
      // No index to check against, or this response errored before
      // producing any code to analyse (`runOneModel`'s catch path) — either
      // way there is nothing to bind, so `prereqBinding` stays genuinely
      // absent rather than present-and-empty (`exactOptionalPropertyTypes`
      // is why this is a conditional spread, not `prereqBinding: undefined`).
      if (!prereqIndex || response.error !== undefined) {
        return { ...response, rowAssignments, rowIdentityConflicts };
      }
      const prereqBinding = await bindResponseToPrereqs(
        response.resolution.cleanedCode,
        prereqIndex,
        { sourcesIncomplete: opts.prereqSourcesIncomplete === true },
      );
      return {
        ...response,
        rowAssignments,
        rowIdentityConflicts,
        prereqBinding,
      };
    }),
  );

  return {
    draftId: opts.draft.id,
    startedAt: new Date().toISOString(),
    signature,
    // Cell placement is decided here, where both sides are in hand, rather
    // than re-derived by the UI from a copy of the identity rules.
    responses: boundResponses,
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
    signature: run.signature,
    responses: run.responses,
    rows: run.rows,
  };
  await Deno.writeTextFile(outputPath, JSON.stringify(payload, null, 2));
  return outputPath;
}
