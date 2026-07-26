/**
 * Id allocation for the task workbench.
 *
 * Authoring a trap task by hand means picking a `CG-AL-X###` task id and an
 * AL test codeunit id (80000-89999) that must not collide with anything
 * already in the tree. A collision is not caught until compile. This module
 * scans the filesystem instead of trusting a human to eyeball the highest
 * existing number.
 */

import { walk } from "@std/fs";

/**
 * Filesystem roots that id allocation scans for collisions. Every function
 * in this module takes `IdRoots` explicitly, rather than pointing at a fixed
 * path, so tests can run against a `Deno.makeTempDir()` fixture instead of
 * the real `tasks/`, `tests/al/` and `scratch/` trees.
 */
export interface IdRoots {
  /** Committed task manifests, e.g. `tasks/hard/CG-AL-X052-slug.yml`. */
  tasksDir: string;
  /** Committed test codeunits, e.g. `tests/al/hard/CG-AL-X052.Test.al`. */
  testsDir: string;
  /** In-progress drafts, one directory per id: `scratch/CG-AL-X053/`. */
  scratchDir: string;
}

const TASK_ID_PATTERN = /CG-AL-X(\d+)/;
const CODEUNIT_ID_PATTERN = /^codeunit\s+(\d+)/m;
const CODEUNIT_RANGE_START = 80000;
const CODEUNIT_RANGE_END = 89999;

/**
 * Runs `fn`, swallowing a missing directory. A fresh checkout has no
 * `scratch/`, and that must not be treated as an error - it just means the
 * root contributes no ids to the scan.
 */
async function ifExists(dir: string, fn: () => Promise<void>): Promise<void> {
  try {
    await Deno.stat(dir);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return;
    }
    throw error;
  }
  await fn();
}

function collectTaskIdFrom(ids: Set<number>, text: string): void {
  const match = TASK_ID_PATTERN.exec(text);
  if (match) {
    ids.add(Number(match[1]));
  }
}

/**
 * Union of every `CG-AL-X###` id already spoken for, across the committed
 * `tasks/` tree, the committed `tests/al/` tree, and in-progress `scratch/`
 * drafts.
 *
 * All three roots are scanned together deliberately: an id free in the
 * committed tree but already claimed by an uncommitted draft is the
 * realistic collision - it's exactly the one a human comparing only
 * `tasks/` would miss.
 */
async function collectTaskIds(roots: IdRoots): Promise<Set<number>> {
  const ids = new Set<number>();

  await ifExists(roots.tasksDir, async () => {
    for await (
      const entry of walk(roots.tasksDir, {
        exts: [".yml"],
        includeDirs: false,
      })
    ) {
      collectTaskIdFrom(ids, entry.name);
    }
  });

  await ifExists(roots.testsDir, async () => {
    for await (
      const entry of walk(roots.testsDir, {
        exts: [".al"],
        includeDirs: false,
      })
    ) {
      collectTaskIdFrom(ids, entry.name);
    }
  });

  // scratch/<id>/ - the directory name IS the id. Drafts are one level
  // deep and don't need their contents opened to be counted.
  await ifExists(roots.scratchDir, async () => {
    for await (const entry of Deno.readDir(roots.scratchDir)) {
      if (entry.isDirectory) {
        collectTaskIdFrom(ids, entry.name);
      }
    }
  });

  return ids;
}

/**
 * Next free `CG-AL-X###` id, zero-padded to 3 digits (`CG-AL-X001` ..
 * `CG-AL-X099` .. `CG-AL-X100` - never `CG-AL-X0100`; `padStart` only pads,
 * it never truncates, so ids at or past 100 come out the right width for
 * free).
 *
 * Deliberately does NOT gap-fill: with `X050` and `X052` present this
 * returns `X053`, not `X051`. A gap is usually a deleted draft whose id may
 * still appear in saved `results/benchmark-results-*.json` files, so
 * reusing it would make that history ambiguous. Always allocate
 * highest + 1, never the lowest free slot.
 */
export async function allocateTaskId(roots: IdRoots): Promise<string> {
  const ids = await collectTaskIds(roots);
  const highest = ids.size > 0 ? Math.max(...ids) : 0;
  return `CG-AL-X${String(highest + 1).padStart(3, "0")}`;
}

/**
 * True if `id`'s numeric suffix is already used in any of the three roots.
 * A malformed `id` (no `CG-AL-X<digits>` suffix) is reported as not
 * existing rather than throwing.
 */
export async function taskIdExists(
  id: string,
  roots: IdRoots,
): Promise<boolean> {
  const match = TASK_ID_PATTERN.exec(id);
  if (!match) {
    return false;
  }
  const ids = await collectTaskIds(roots);
  return ids.has(Number(match[1]));
}

/**
 * Scans `codeunit <id> "..."` declarations at line start across every
 * `.al` file under `dir`, folding the highest into `current`. A shared
 * helper because `allocateTestCodeunitId` must scan two independent roots
 * (`testsDir` and `scratchDir`) and fold both into one running maximum.
 */
async function highestCodeunitIdIn(
  dir: string,
  current: number,
): Promise<number> {
  let highest = current;
  await ifExists(dir, async () => {
    for await (
      const entry of walk(dir, { exts: [".al"], includeDirs: false })
    ) {
      const content = await Deno.readTextFile(entry.path);
      const match = CODEUNIT_ID_PATTERN.exec(content);
      if (match) {
        highest = Math.max(highest, Number(match[1]));
      }
    }
  });
  return highest;
}

/**
 * Next free AL test codeunit id in the reserved 80000-89999 range (see
 * `.claude/rules/prereq-apps.md` for the full id-range convention), scanned
 * from `codeunit <id> "..."` declarations at line start across
 * `tests/al/**\/*.al` AND `scratch/**\/*.al`. Throws rather than returning a
 * colliding id once the range is exhausted.
 *
 * Also scans `scratch/`: a single scaffold call has nothing there to
 * collide with yet, but a SECOND draft scaffolded before the first one
 * promotes does - the first draft's `.al` file already declares the id this
 * function handed out. Scanning only `testsDir` re-scans an empty set and
 * hands out the same id twice, a silent collision in the exact range this
 * module exists to protect.
 */
export async function allocateTestCodeunitId(roots: IdRoots): Promise<number> {
  // Empty tree allocates 80001, not 80000: the range start itself is
  // treated as the floor (equivalent to task ids defaulting to 0 before
  // the +1), not as a valid standalone allocation.
  let highest = CODEUNIT_RANGE_START;
  highest = await highestCodeunitIdIn(roots.testsDir, highest);
  highest = await highestCodeunitIdIn(roots.scratchDir, highest);

  const next = highest + 1;
  if (next > CODEUNIT_RANGE_END) {
    throw new Error(
      `No free test codeunit id left in range ${CODEUNIT_RANGE_START}-` +
        `${CODEUNIT_RANGE_END} (highest in use: ${highest}).`,
    );
  }
  return next;
}
