/**
 * Promotes a model's response into a draft's `naive/` directory.
 *
 * Writing a convincing wrong answer is the hard part of authoring a trap
 * task. A model's genuine mistake is a more authentic `naive/` than an
 * invented one — this is the promotion path an author uses to turn a real
 * response into the draft's wrong-answer half, one file per top-level AL
 * object.
 *
 * `naive/` feeds the probe that decides whether a task discriminates. A
 * silent overwrite or a stale leftover object changes the next probe verdict
 * for a reason nobody can see, so this module refuses rather than
 * best-effort-merges: two objects sanitising to the same filename, a name
 * colliding with the reserved `<taskId>.` prefix, or nothing extractable at
 * all. Promotion always REPLACES the existing `*.al` files in `naive/`
 * rather than merging with them.
 *
 * @module dashboard/promote-naive
 */

import { join } from "@std/path";

import { parseAlObjects } from "../al/object-parser.ts";
import { hasTaskPrefix } from "../workbench/oracle-files.ts";

export interface PromoteResult {
  /** Filenames written into naive/, in write order. */
  written: string[];
  /** Files deleted because promotion REPLACES rather than merges. */
  removed: string[];
}

/** Thrown for every promotion refusal. Named so callers can catch it precisely. */
export class PromoteRefusal extends Error {}

/**
 * AL's own object-name-to-filename convention is not a pure capitalisation
 * of the keyword: `tableextension` files use `TableExt`, not
 * `Tableextension`. Only the compound kinds need an explicit entry — every
 * other kind (the 100-of-103 simple case, and any kind the grammar gains
 * later) falls back to capitalising the first letter.
 */
const COMPOUND_KIND_SUFFIX: Record<string, string> = {
  tableextension: "TableExt",
  pageextension: "PageExt",
  enumextension: "EnumExt",
};

function capitalize(text: string): string {
  const first = text.charAt(0);
  return first === "" ? text : first.toUpperCase() + text.slice(1);
}

function suffixForKind(kind: string): string {
  return COMPOUND_KIND_SUFFIX[kind] ?? capitalize(kind);
}

/**
 * Strips surrounding quotes, replaces every character invalid in a Windows
 * filename (`< > : " / \ | ? *` and control characters) with `-`, then
 * collapses runs of `-`. This is cosmetic to the compiler — which reads
 * content and ignores filenames — but the author browses `naive/` beside
 * `correct/` and `prereq/`, so an odd name there reads as a bug in the tool.
 */
function sanitizeName(rawName: string): string {
  let name = rawName;
  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) {
    name = name.slice(1, -1);
  }
  // deno-lint-ignore no-control-regex
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
  name = name.replace(/-+/g, "-");
  return name;
}

/**
 * Deletes every existing `*.al` file directly under `dir`, leaving
 * `app.json` and any non-AL file untouched. Returns the deleted filenames,
 * sorted for a deterministic result.
 */
async function removeExistingAlFiles(dir: string): Promise<string[]> {
  const removed: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile) continue;
    if (!entry.name.toLowerCase().endsWith(".al")) continue;
    await Deno.remove(join(dir, entry.name));
    removed.push(entry.name);
  }
  removed.sort();
  return removed;
}

/**
 * Parses `code`, refuses on any of the layer-1 violations, then replaces
 * `naive/`'s AL files with one file per top-level object — refusing before
 * anything is written, so a refusal leaves `naive/` exactly as it was.
 */
export async function promoteAsNaive(opts: {
  draftDir: string;
  taskId: string;
  /** resolveCandidate's cleanedCode — never the raw response. */
  code: string;
  model: string;
  attempt: number;
  timestamp: string;
}): Promise<PromoteResult> {
  const { draftDir, taskId, code, model, attempt, timestamp } = opts;

  const { objects } = await parseAlObjects(code);
  if (objects.length === 0) {
    throw new PromoteRefusal(
      `Nothing extractable was produced for ${taskId}: the response ` +
        `contains no parseable AL object.`,
    );
  }

  const byFileName = new Map<string, string>(); // filename -> object name (for the collision message)
  const files: { fileName: string; source: string }[] = [];
  for (const object of objects) {
    const sanitized = sanitizeName(object.name);
    const fileName = `${sanitized}.${suffixForKind(object.kind)}.al`;

    if (hasTaskPrefix(taskId, fileName)) {
      throw new PromoteRefusal(
        `Promoting ${taskId}: object "${object.name}" sanitises to ` +
          `"${fileName}", which uses the reserved "${taskId}." prefix. ` +
          `That prefix is oracle-side and would be injected into both ` +
          `probe runs — rename the object.`,
      );
    }

    const existingName = byFileName.get(fileName);
    if (existingName !== undefined) {
      throw new PromoteRefusal(
        `Promoting ${taskId}: objects "${existingName}" and ` +
          `"${object.name}" collide on the same filename "${fileName}" ` +
          `after sanitising — refusing rather than silently overwrite one.`,
      );
    }
    byFileName.set(fileName, object.name);

    files.push({ fileName, source: object.source });
  }

  const naiveDir = join(draftDir, "naive");
  const removed = await removeExistingAlFiles(naiveDir);

  const header =
    `// Promoted from ${model}, attempt ${attempt}, ${timestamp}\n`;
  const written: string[] = [];
  for (const { fileName, source } of files) {
    await Deno.writeTextFile(join(naiveDir, fileName), header + source);
    written.push(fileName);
  }

  return { written, removed };
}
