/**
 * Reads a draft's reference AL sources for a quick run.
 *
 * `runQuick` (`src/dashboard/run-manager.ts`) needs `correctSources` and
 * `naiveSources` as raw AL text, not file paths. This reads every `*.al`
 * file directly under `<draftDir>/correct/` and `<draftDir>/naive/` — the
 * two solution directories the workbench draft layout scaffolds (see
 * CLAUDE.md's "Workbench Draft Layout" section).
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

/**
 * Reads every top-level `*.al` file in `dir`, sorted by filename for
 * deterministic ordering (`deriveTrapSignature` walks sources in order).
 * A missing directory yields `[]` rather than throwing.
 */
async function readAlSources(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.toLowerCase().endsWith(".al")) {
        names.push(entry.name);
      }
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
 * Reads `<draftDir>/correct/*.al` and `<draftDir>/naive/*.al`.
 *
 * Reads every `.al` file present, including a reference oracle test
 * codeunit if the draft's `correct/` carries one alongside the solution
 * (per the workbench draft layout). `deriveTrapSignature` matches objects
 * by `objectKey` across both sides and silently skips anything unmatched,
 * so an oracle-only object present in `correct/` but not `naive/` is inert
 * rather than corrupting the derived signature.
 */
export async function loadTrapSources(draftDir: string): Promise<TrapSources> {
  const [correctSources, naiveSources] = await Promise.all([
    readAlSources(join(draftDir, "correct")),
    readAlSources(join(draftDir, "naive")),
  ]);
  return { correctSources, naiveSources };
}
