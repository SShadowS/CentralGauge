/**
 * Oracle-side file classification for a workbench draft.
 *
 * The draft's oracle lives in `correct/` so the AL Language extension sees
 * one project containing solution + test — the same app the probe compiles.
 * That placement has a consequence: `copyCompanionTestFiles`
 * (`mcp/al-tools-server.ts:582-612`) copies every `<id>.*.al` from the
 * ORACLE'S directory into BOTH verify directories. For a mock the oracle
 * needs, that is right. For a solution file it is contamination that makes a
 * non-discriminating task look discriminating.
 *
 * So the `<id>.` prefix inside `correct/` is a reserved namespace for
 * oracle-side files. This module is the single place that decides what is in
 * it — used by `probeDraft` to refuse before any container work, and by
 * `promoteDraft` to decide what moves into `tests/al/<difficulty>/`. One
 * matcher, two callers, no drift.
 *
 * NOTE: no filename or id-range rule can tell a legitimate companion from a
 * misnamed solution. `tests/al/hard/CG-AL-H001.ProductType.al` is `enum
 * 70098` — inside the GENERATED-CODE range — and its oracle genuinely
 * references it. The real guard against a misnamed solution is the
 * compile-failure verdict in `probe.ts`, not this module. This module only
 * refuses what is unambiguously wrong.
 */

import { join } from "@std/path";

import { DRAFT_STARTER_DIRNAME } from "../tasks/starter-code.ts";

/** Basenames of the oracle-side files in a draft's `correct/` directory. */
export interface OracleFileSet {
  /** Always `<id>.Test.al`. */
  oracle: string;
  /** Other `<id>.*.al` files: mocks, spies, subscribers, helper enums. */
  companions: string[];
}

/** Thrown for every layer-1 refusal. Named so callers can catch it precisely. */
export class OracleFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OracleFileError";
  }
}

/**
 * Faithful re-implementation of `copyCompanionTestFiles`' matcher
 * (`mcp/al-tools-server.ts:596-601`): `.al` extension, case-SENSITIVE
 * `startsWith(taskPrefix + ".")`, excluding the exact test filename.
 *
 * Exists only so the anti-drift test can compare the two matchers directly.
 * Production code must not branch on it — the copier is the authority on what
 * gets copied, and this module is the authority on what is allowed to exist.
 */
export function companionPredicateMatches(
  taskId: string,
  fileName: string,
): boolean {
  if (!fileName.endsWith(".al")) return false;
  if (fileName === `${taskId}.Test.al`) return false;
  return fileName.startsWith(`${taskId}.`);
}

/**
 * Case-insensitive prefix test. The copiers are case-sensitive, but NTFS is
 * not: `cg-al-x053.Mock.al` is the same file to the filesystem while evading
 * their `startsWith`. Detecting case-insensitively is what lets both
 * directories refuse such a file rather than let it behave differently from
 * its canonical spelling - in `naive/` because it would be silently
 * overwritten by the oracle-side injection, in `correct/` because it would be
 * promoted and then never injected at all (Refusal 4).
 *
 * Pair with {@link companionPredicateMatches}, which is the case-SENSITIVE
 * copier-faithful matcher: a name that satisfies this one but not that one is
 * exactly the mis-cased case.
 *
 * Exported so any other reader of a draft's `correct/`/`naive/` directories
 * (e.g. `src/dashboard/source-loader.ts`, which needs to leave oracle-side
 * files out of the reference sources it hands to `runQuick`) can identify
 * oracle-side files the same way this module does, rather than growing a
 * second copy that drifts from this one.
 */
export function hasTaskPrefix(taskId: string, fileName: string): boolean {
  return fileName.toLowerCase().startsWith(`${taskId.toLowerCase()}.`);
}

async function listAlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.toLowerCase().endsWith(".al")) {
        out.push(entry.name);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return out;
    throw error;
  }
  return out.sort();
}

/**
 * Classifies `correct/`, and refuses on any of the three layer-1 violations.
 * Purely filesystem reads — never spawns a container operation, so it is safe
 * to call as a pre-flight check.
 */
export async function classifyOracleFiles(
  opts: { id: string; draftDir: string },
): Promise<OracleFileSet> {
  const { id, draftDir } = opts;
  const correctDir = join(draftDir, "correct");
  const naiveDir = join(draftDir, "naive");
  const starterDir = join(draftDir, DRAFT_STARTER_DIRNAME);
  const oracleName = `${id}.Test.al`;

  // --- Refusal 1: a bare <id>.al would overwrite every model's submission.
  // compile-queue.ts:1081-1082 writes the model's generated code to
  // `${taskId}.al`, then :1093-1103 copies every `${taskId}.`-prefixed file
  // from tests/al/<difficulty>/ on top of it. Same filename, copy wins.
  for (const name of await listAlFiles(correctDir)) {
    if (name.toLowerCase() === `${id.toLowerCase()}.al`) {
      throw new OracleFileError(
        `Draft ${id}: correct/${name} uses the bare task id as its ` +
          `filename. If promoted, that file would overwrite every model's ` +
          `generated code at bench time (the bench writes the candidate to ` +
          `"${id}.al" and then copies "${id}."-prefixed files over it). ` +
          `Rename it — solution files must not start with "${id}".`,
      );
    }
  }

  // --- Refusal 2: no <id>.*.al may live in the naive-side solution dir -
  // naive/ for a trap-task draft, starter/ for a diagnose-task draft (Task 5's
  // scaffoldDraft `diagnose` option; Task 6 wires starter/ into probeDraft as
  // a live `--solution` dir). `copyAlFilesToDir` writes it into that dir's
  // verify staging copy, then `copyCompanionTestFiles` overwrites it from
  // correct/ (later write wins - both calls are solution-dir-agnostic in
  // mcp/al-tools-server.ts), so that side's verdict would stop reflecting its
  // actual content. Oracle-side files are injected from correct/ on BOTH
  // runs, so neither naive/ nor starter/ ever legitimately needs one. Checked
  // unconditionally on both directories - a missing one (e.g. starter/ on a
  // trap-task draft) is simply empty per `listAlFiles`, so this is a no-op
  // for the shape that doesn't apply.
  for (
    const [label, dir] of [
      ["naive", naiveDir],
      [DRAFT_STARTER_DIRNAME, starterDir],
    ] as const
  ) {
    for (const name of await listAlFiles(dir)) {
      if (hasTaskPrefix(id, name)) {
        throw new OracleFileError(
          `Draft ${id}: ${label}/${name} uses the reserved "${id}." prefix. ` +
            `Oracle-side files are injected into the ${label} run from ` +
            `correct/, and a same-named file in ${label}/ is silently ` +
            `overwritten by that injection — so the ${label} verdict would ` +
            `not reflect what is actually in ${label}/. Move it to correct/ ` +
            `or rename it.`,
        );
      }
    }
  }

  // --- Refusal 3: the oracle must exist.
  const correctFiles = await listAlFiles(correctDir);
  if (!correctFiles.includes(oracleName)) {
    throw new OracleFileError(
      `Draft ${id}: no oracle at correct/${oracleName}. The probe runs that ` +
        `test file against both solutions, so there is nothing to ` +
        `discriminate with until it exists.`,
    );
  }

  // --- Refusal 4: a companion whose prefix matches only case-INSENSITIVELY.
  // This module classifies case-insensitively (NTFS does not distinguish
  // `cg-al-x053.Mock.al` from `CG-AL-X053.Mock.al`), but BOTH copiers that
  // act on the classification are case-SENSITIVE: `copyCompanionTestFiles`
  // (`mcp/al-tools-server.ts`) at probe time, and the bench copier in
  // `src/parallel/compile-queue.ts` at score time. A mis-cased companion is
  // therefore classified here, promoted by `promoteDraft` into
  // `tests/al/<difficulty>/`, and then never injected by either copier - so
  // a promoted oracle that references it fails to compile for every model,
  // despite a green probe that never exercised the mismatch.
  //
  // Refusing is symmetric with what `naive/` already does above, and the
  // author's fix is the same one line: match the id's canonical casing.
  for (const name of correctFiles) {
    if (name === oracleName) continue;
    if (!hasTaskPrefix(id, name)) continue;
    if (companionPredicateMatches(id, name)) continue;
    throw new OracleFileError(
      `Draft ${id}: correct/${name} carries the reserved "${id}." prefix ` +
        `in the wrong CASE. The copiers that inject oracle-side files are ` +
        `case-sensitive (mcp/al-tools-server.ts at probe time, ` +
        `src/parallel/compile-queue.ts at bench time), so this file would ` +
        `be promoted but never injected - the promoted oracle would fail ` +
        `to compile for every model despite a green probe. Rename it to ` +
        `the exact prefix "${id}.".`,
    );
  }

  const companions = correctFiles.filter(
    (name) => name !== oracleName && hasTaskPrefix(id, name),
  );

  return { oracle: oracleName, companions };
}
