/**
 * Promote gate for the task workbench.
 *
 * `promoteDraft` is the last checkpoint before a hand-authored trap-task
 * becomes something models are scored against: it moves a `scratch/<id>/`
 * draft's `task.yml`, `<id>.Test.al`, and (when present) `prereq/` into the
 * committed `tasks/` and `tests/al/` trees. Because that move changes
 * `task_sets.hash` (see CLAUDE.md's "Task-set hash scope"), it refuses far
 * more than it accepts - a task that a naive solution also passes tests
 * nothing, and a task promoted on an infra hiccup is worse, because it
 * looks validated when it is not.
 *
 * Load-bearing refusals:
 *
 * - A `"inconclusive"` probe side is refused with a message saying exactly
 *   that, not "failed". `trap-probe` returns exit 3 for infra trouble
 *   (container down, publish timeout), and an operator told "the task
 *   failed the gate" edits a task that may be perfectly good; one told
 *   "inconclusive - re-run" does the right thing instead.
 * - A cached verdict older than the draft's own files (task.yml,
 *   `<id>.Test.al`, or anything under `correct/`/`naive/`) is refused too -
 *   a green probe followed by an edit to the oracle or either reference
 *   solution no longer describes what is about to be promoted. Checked via
 *   mtimes only; never touches a container.
 * - Any destination path that already exists (task manifest, test
 *   codeunit, prereq dir) refuses with NO `--force` override. Unlike a
 *   failed probe gate, silently overwriting a shipped task has no
 *   legitimate use case. This also covers the SAME id landing under a
 *   *different* `--difficulty` than one already shipped - a different
 *   destination path would otherwise sail past the path-based checks while
 *   still shipping two manifests with the same id.
 *
 * The manifest schema is `.strict()` (`src/tasks/interfaces.ts`), so the
 * rewritten YAML (with `expected.testApp` and `metadata.difficulty`
 * rewritten to match the promotion target) is validated through the real
 * `parseTaskManifest` before anything moves - the common failure (a
 * malformed draft) then needs no rollback. The move itself - task write,
 * test-file move, and prereq-dir move when present - runs as one unit: a
 * failure partway through rolls back everything already done, because a
 * half-promoted draft (task in `tasks/`, oracle still in `scratch/`) is
 * worse than one this function simply refused.
 */

import { ensureDir, exists, move, walk } from "@std/fs";
import { dirname, join } from "@std/path";
import { parse, stringify } from "@std/yaml";

import type { IdRoots } from "./ids.ts";
import type { DraftMeta } from "./scaffold.ts";
import type { ProbeVerdict } from "./probe.ts";
import { parseTaskManifest } from "../tasks/interfaces.ts";

export type PromoteDifficulty = "easy" | "medium" | "hard";

/** Result of a successful promotion, reported back to the CLI layer. */
export interface PromoteResult {
  /** Repo-canonical destination, e.g. `tasks/hard/CG-AL-X053-day-close.yml`. */
  movedTask: string;
  /** Repo-canonical destination, e.g. `tests/al/hard/CG-AL-X053.Test.al`. */
  movedTest: string;
  /**
   * Repo-canonical path the prereq app was moved to, when this draft has
   * one (`scratch/<id>/prereq/` -> `tests/al/dependencies/<id>/`).
   */
  movedPrereq?: string;
  /** Always `true` - promoting always changes `task_sets.hash`. */
  hashChanged: true;
  /** Whether `--force` was used to skip the probe gate. */
  forced: boolean;
}

/** Options for {@link promoteDraft}. */
export interface PromoteOptions {
  difficulty: PromoteDifficulty;
  /** Overrides the slug recorded in `.meta.json`. */
  slug?: string;
  /** Skips the probe gate. Does NOT skip the target-exists checks below - those have no override. */
  force?: boolean;
  roots: IdRoots;
  /**
   * The discrimination verdict to gate on. Taken as a parameter, rather
   * than run internally, so `promoteDraft` is testable without a
   * container - the CLI layer decides whether to call `probeDraft` first
   * or hand this straight through from a prior `task probe` run.
   */
  verdict?: ProbeVerdict;
}

/** Reads `scratch/<id>/.meta.json`, or `undefined` if the draft has none. */
async function readDraftMeta(
  draftDir: string,
): Promise<DraftMeta | undefined> {
  try {
    const raw = await Deno.readTextFile(join(draftDir, ".meta.json"));
    return JSON.parse(raw) as DraftMeta;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Throws unless `verdict` discriminates, distinguishing "inconclusive"
 * (infra trouble - re-run) from a genuine non-discriminating failure (fix
 * the task) in the message. This is the module's central refusal contract;
 * see the module doc for why the distinction matters. Returns the verdict
 * (now known defined) so the caller's freshness check doesn't need a
 * second, redundant undefined check of its own.
 */
function assertVerdictAllowsPromotion(
  id: string,
  verdict: ProbeVerdict | undefined,
): ProbeVerdict {
  if (!verdict) {
    throw new Error(
      `Refusing to promote ${id}: no probe verdict supplied - run ` +
        `"centralgauge task probe ${id}" first, or pass --force to skip ` +
        `the gate.`,
    );
  }

  const inconclusiveSides = [
    verdict.correct === "inconclusive" ? "correct/" : null,
    verdict.naive === "inconclusive" ? "naive/" : null,
  ].filter((side): side is string => side !== null);

  if (inconclusiveSides.length > 0) {
    throw new Error(
      `Refusing to promote ${id}: probe verdict for ${
        inconclusiveSides.join(" and ")
      } is inconclusive - that is infra trouble, not a real result. Re-run ` +
        `"centralgauge task probe ${id}" rather than editing the task, or ` +
        `pass --force to override.`,
    );
  }

  if (!verdict.discriminates) {
    const problems: string[] = [];
    if (verdict.correct !== "pass") {
      problems.push(
        `correct/ did not pass its own oracle (got "${verdict.correct}")`,
      );
    }
    if (verdict.naive !== "fail") {
      problems.push(
        `naive/ passed, so this task tests nothing (got "${verdict.naive}")`,
      );
    }
    throw new Error(
      `Refusing to promote ${id}: probe does not discriminate - ${
        problems.join("; ")
      }. Pass --force to override.`,
    );
  }

  return verdict;
}

/**
 * Refuses when `task.yml`, `<id>.Test.al`, or anything under `correct/` or
 * `naive/` has an mtime later than the cached verdict's timestamp. A green
 * probe followed by an edit to the oracle or either reference solution
 * promotes against a verdict that no longer describes the draft. Compares
 * filesystem mtimes only - never spawns a probe or touches a container.
 */
async function assertVerdictIsFresh(
  id: string,
  draftDir: string,
  verdict: ProbeVerdict,
): Promise<void> {
  const verdictAt = new Date(verdict.at).getTime();
  if (Number.isNaN(verdictAt)) {
    // Malformed timestamp - nothing sound to compare against, so don't
    // block promotion on it.
    return;
  }

  const candidates = [
    join(draftDir, "task.yml"),
    join(draftDir, `${id}.Test.al`),
  ];
  for (const solutionDir of ["correct", "naive"]) {
    const dir = join(draftDir, solutionDir);
    if (!(await exists(dir))) continue;
    for await (const entry of walk(dir, { includeDirs: false })) {
      candidates.push(entry.path);
    }
  }

  for (const path of candidates) {
    if (!(await exists(path))) continue;
    const { mtime } = await Deno.stat(path);
    if (mtime !== null && mtime.getTime() > verdictAt) {
      throw new Error(
        `Refusing to promote ${id}: ${path} was modified after the cached ` +
          `probe verdict (${verdict.at}) - re-run "centralgauge task ` +
          `probe ${id}" before promoting, or pass --force to override.`,
      );
    }
  }
}

/** Throws unless `targetPath` does not yet exist. No `--force` override exists for this check. */
async function refuseIfExists(
  targetPath: string,
  kind: string,
): Promise<void> {
  if (await exists(targetPath)) {
    throw new Error(
      `Refusing to promote: ${kind} already exists at ${targetPath} - ` +
        `overwriting a shipped task silently is never wanted. There is no ` +
        `--force for this check.`,
    );
  }
}

/**
 * True if `id` appears as a whole token in some filename under `dir` (any
 * subdirectory, any difficulty) - i.e. not immediately followed by another
 * digit, so a filename for `CG-AL-X005` cannot false-positive against one
 * for `CG-AL-X0050`. A missing `dir` is not a collision.
 */
function filenameMatchesId(name: string, id: string): boolean {
  const idx = name.indexOf(id);
  if (idx === -1) return false;
  const nextChar = name[idx + id.length];
  return nextChar === undefined || !/[0-9]/.test(nextChar);
}

/**
 * True if some file anywhere under `dir` already carries `id` in its name.
 * Path-based checks alone (exact `tasks/<difficulty>/<id>-<slug>.yml` /
 * `tests/al/<difficulty>/<id>.Test.al`) miss the case where the SAME id is
 * being re-promoted under a *different* `--difficulty` - a different
 * destination path, but still two manifests sharing one id in the suite.
 */
async function idExistsAnywhereUnder(
  dir: string,
  id: string,
): Promise<boolean> {
  if (!(await exists(dir))) return false;
  for await (const entry of walk(dir, { includeDirs: false })) {
    if (filenameMatchesId(entry.name, id)) return true;
  }
  return false;
}

/**
 * Promotes `scratch/<id>/` into the committed suite. See the module doc for
 * the load-bearing refusal rules. Order: resolve slug -> gate on the probe
 * verdict (discriminates + fresh) -> check every destination path is free
 * -> validate the rewritten manifest -> move -> report.
 */
export async function promoteDraft(
  id: string,
  opts: PromoteOptions,
): Promise<PromoteResult> {
  const { difficulty, roots } = opts;
  const force = opts.force ?? false;
  const draftDir = join(roots.scratchDir, id);

  // --- resolve slug: opts.slug overrides, else .meta.json, else refuse ---
  const meta = await readDraftMeta(draftDir);
  const slug = opts.slug ?? meta?.slug;
  if (!slug) {
    throw new Error(
      `Refusing to promote ${id}: no slug given and ${draftDir}/` +
        `.meta.json has none - pass --slug explicitly.`,
    );
  }

  // --- gate on the probe verdict (force skips this entirely) ---
  if (!force) {
    const verdict = assertVerdictAllowsPromotion(id, opts.verdict);
    await assertVerdictIsFresh(id, draftDir, verdict);
  }

  // --- check every destination path is free (never overridable) ---
  const taskTargetPath = join(
    roots.tasksDir,
    difficulty,
    `${id}-${slug}.yml`,
  );
  const testTargetPath = join(roots.testsDir, difficulty, `${id}.Test.al`);
  const prereqTargetDir = join(roots.testsDir, "dependencies", id);

  await refuseIfExists(taskTargetPath, "task manifest");
  await refuseIfExists(testTargetPath, "test codeunit");
  await refuseIfExists(prereqTargetDir, "prereq dir");

  if (await idExistsAnywhereUnder(roots.tasksDir, id)) {
    throw new Error(
      `Refusing to promote ${id}: a task manifest for this id already ` +
        `exists somewhere under ${roots.tasksDir} - promoting under a ` +
        `different --difficulty would ship two manifests with the same ` +
        `id. There is no --force for this check.`,
    );
  }
  if (await idExistsAnywhereUnder(roots.testsDir, id)) {
    throw new Error(
      `Refusing to promote ${id}: a test codeunit for this id already ` +
        `exists somewhere under ${roots.testsDir} - promoting under a ` +
        `different --difficulty would ship two manifests with the same ` +
        `id. There is no --force for this check.`,
    );
  }

  // --- validate before moving ---
  const draftTaskYamlPath = join(draftDir, "task.yml");
  const draftTestAlPath = join(draftDir, `${id}.Test.al`);
  const draftPrereqDir = join(draftDir, "prereq");

  if (!(await exists(draftTaskYamlPath))) {
    throw new Error(
      `Cannot promote ${id}: no task.yml at ${draftTaskYamlPath} - is ` +
        `this a scaffolded draft?`,
    );
  }
  if (!(await exists(draftTestAlPath))) {
    throw new Error(
      `Cannot promote ${id}: no ${id}.Test.al at ${draftTestAlPath} - is ` +
        `this a scaffolded draft?`,
    );
  }
  if (meta?.withPrereq && !(await exists(draftPrereqDir))) {
    throw new Error(
      `Cannot promote ${id}: .meta.json says withPrereq but there is no ` +
        `prereq/ at ${draftPrereqDir} - is this a scaffolded draft?`,
    );
  }

  // Canonical, repo-relative forms - always `tasks/`/`tests/al/`, matching
  // scaffoldDraft's own convention (src/workbench/scaffold.ts) and every
  // downstream reader of expected.testApp, which resolves it via
  // `join(Deno.cwd(), testAppPath)` (e.g. src/tasks/executor-v2.ts,
  // src/parallel/compile-queue.ts). Deliberately NOT derived from `roots` -
  // roots point at a temp tree in tests, but the string written into the
  // manifest and reported to the operator must always be the real
  // repo-relative path.
  const movedTask = `tasks/${difficulty}/${id}-${slug}.yml`;
  const movedTest = `tests/al/${difficulty}/${id}.Test.al`;

  const rawYaml = await Deno.readTextFile(draftTaskYamlPath);
  const parsedRaw = parse(rawYaml);
  if (
    typeof parsedRaw !== "object" || parsedRaw === null ||
    Array.isArray(parsedRaw)
  ) {
    throw new Error(
      `Cannot promote ${id}: ${draftTaskYamlPath} did not parse into an ` +
        `object.`,
    );
  }
  const rawRecord = parsedRaw as Record<string, unknown>;
  const rawExpected = rawRecord["expected"];
  if (
    typeof rawExpected !== "object" || rawExpected === null ||
    Array.isArray(rawExpected)
  ) {
    throw new Error(
      `Cannot promote ${id}: ${draftTaskYamlPath} has no "expected" block.`,
    );
  }

  const rewritten: Record<string, unknown> = {
    ...rawRecord,
    expected: { ...rawExpected, testApp: movedTest },
  };

  // Rewrite metadata.difficulty to match --difficulty too, when metadata is
  // a well-formed object - scaffoldDraft hardcodes "hard" at scaffold time
  // (src/workbench/scaffold.ts's DRAFT_DIFFICULTY), so promoting under any
  // other --difficulty would otherwise ship a manifest whose own metadata
  // contradicts the folder it lives in - and that field feeds the site's
  // difficulty facet.
  const rawMetadata = rawRecord["metadata"];
  if (
    typeof rawMetadata === "object" && rawMetadata !== null &&
    !Array.isArray(rawMetadata)
  ) {
    rewritten["metadata"] = {
      ...(rawMetadata as Record<string, unknown>),
      difficulty,
    };
  }

  // Throws with the manifest's own validation errors when malformed -
  // nothing has been written or moved yet, so refusing here costs nothing
  // to undo.
  parseTaskManifest(rewritten, taskTargetPath);

  const finalYamlText = stringify(rewritten, { lineWidth: -1 });

  // --- move: task write, test-file move, and (if present) prereq-dir move
  // all share ONE rollback. A failure partway through - e.g. the test-file
  // move fails after the task manifest was already written - undoes
  // everything that succeeded so far, because a half-promoted draft (task
  // in tasks/, oracle still in scratch/) is worse than a refused one. ---
  let taskWritten = false;
  let testMoved = false;
  let prereqMoved = false;
  try {
    await ensureDir(dirname(taskTargetPath));
    await ensureDir(dirname(testTargetPath));
    await Deno.writeTextFile(taskTargetPath, finalYamlText);
    taskWritten = true;

    await move(draftTestAlPath, testTargetPath);
    testMoved = true;

    if (meta?.withPrereq) {
      await ensureDir(dirname(prereqTargetDir));
      await move(draftPrereqDir, prereqTargetDir);
      prereqMoved = true;
    }

    // Defensive re-validation of what now sits at the destination. Only a
    // pathological write/read roundtrip issue trips this, since the
    // in-memory object above already validated.
    const onDisk = parse(await Deno.readTextFile(taskTargetPath));
    parseTaskManifest(onDisk, taskTargetPath);
  } catch (error) {
    if (prereqMoved) {
      await move(prereqTargetDir, draftPrereqDir);
    }
    if (testMoved) {
      await move(testTargetPath, draftTestAlPath);
    }
    if (taskWritten) {
      await Deno.remove(taskTargetPath);
    }
    throw new Error(
      `Promotion of ${id} rolled back: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Only remove the draft's task.yml once the promoted copy is confirmed
  // good - keeps scratch/ as the rollback source until that's certain.
  // correct/, naive/, NOTES.md, .meta.json and .probe.json are left in
  // place as the draft's authoring history.
  await Deno.remove(draftTaskYamlPath);

  return {
    movedTask,
    movedTest,
    ...(meta?.withPrereq ? { movedPrereq: `tests/al/dependencies/${id}` } : {}),
    hashChanged: true,
    forced: force,
  };
}
