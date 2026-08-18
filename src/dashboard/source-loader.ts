/**
 * Reads a draft's reference AL sources for a quick run.
 *
 * `runQuick` (`src/dashboard/run-manager.ts`) needs `correctSources` and
 * `naiveSources` as raw AL text, not file paths. This reads every `*.al`
 * file directly under `<draftDir>/correct/` and `<draftDir>/naive/` — the
 * two solution directories the workbench draft layout scaffolds (see
 * CLAUDE.md's "Workbench Draft Layout" section) — EXCLUDING oracle-side
 * files.
 *
 * The workbench draft layout puts the oracle test codeunit (`<id>.Test.al`)
 * inside `correct/`, alongside the solution, so the AL Language extension
 * sees one project. `<id>.`-prefixed files (the oracle itself, plus any
 * companion mock/spy/subscriber/helper enum) are oracle-side, per the
 * reserved-namespace convention `src/workbench/oracle-files.ts` owns
 * (`hasTaskPrefix`, reused here rather than re-implemented). They are not
 * reference solution sources: `runQuick` turns `correctSources` into
 * `referenceObjects` and hands them to `buildRowUniverse`, which makes every
 * reference object a matrix row unconditionally — an unfiltered oracle
 * object would show up as a permanent "not written" row for an object no
 * model was ever asked to write.
 *
 * A missing `naive/` is a legitimate authoring state, not an error: an
 * author may still be writing the wrong-answer half of a trap task before
 * ever probing it. It yields `[]` for `naiveSources`, which
 * `deriveTrapSignature` turns into an empty signature with
 * `emptyReason: "no-naive-objects"` — every response then classifies as
 * "cannot-compare" rather than the loader throwing. The same tolerance
 * applies to a missing `correct/`, for the same reason (defense in depth;
 * `listDrafts` already requires `correct/` to exist before a draft is even
 * listed, so this should not be reachable in practice).
 *
 * @module dashboard/source-loader
 */

import { join } from "@std/path";

import { hasTaskPrefix } from "../workbench/oracle-files.ts";

/**
 * Reads every top-level `*.al` file in `dir`, excluding any `<taskId>.`
 * prefixed (oracle-side) file, sorted by filename for deterministic
 * ordering (`deriveTrapSignature` walks sources in order). A missing
 * directory yields `[]` rather than throwing.
 */
async function readAlSources(taskId: string, dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile) continue;
      if (!entry.name.toLowerCase().endsWith(".al")) continue;
      if (hasTaskPrefix(taskId, entry.name)) continue;
      names.push(entry.name);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }

  names.sort();
  return await Promise.all(
    names.map((name) => Deno.readTextFile(join(dir, name))),
  );
}

export interface TrapSources {
  correctSources: string[];
  naiveSources: string[];
}

/**
 * Reads `<draftDir>/correct/*.al` and `<draftDir>/naive/*.al`, excluding
 * any file whose name carries the reserved `<taskId>.` prefix. Applied to
 * both directories: `naive/` should never legitimately hold one either (the
 * same reserved-prefix convention refuses it there), but filtering
 * defensively rather than trusting that invariant costs nothing and covers
 * a mid-edit draft that has not been probed yet.
 */
export async function loadTrapSources(
  taskId: string,
  draftDir: string,
): Promise<TrapSources> {
  const [correctSources, naiveSources] = await Promise.all([
    readAlSources(taskId, join(draftDir, "correct")),
    readAlSources(taskId, join(draftDir, "naive")),
  ]);
  return { correctSources, naiveSources };
}
