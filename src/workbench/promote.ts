/**
 * Promote gate for the task workbench.
 *
 * `promoteDraft` is the last checkpoint before a hand-authored trap-task
 * becomes something models are scored against: it moves a `scratch/<id>/`
 * draft's `task.yml`, the oracle-side file set in `correct/` (the `<id>.Test.al`
 * oracle itself plus any `<id>.*.al` companions - mocks, spies, helper
 * enums), and (when present) `prereq/` into the committed `tasks/` and
 * `tests/al/` trees. Because that move changes
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
 *   `<id>.Test.al`, or anything under `correct/`/`naive/`/`prereq/`) is
 *   refused too - a green probe followed by an edit to the oracle, either
 *   reference solution, or the prereq no longer describes what is about to
 *   be promoted. Checked via mtimes only; never touches a container.
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
 * test-file move, companion moves, and prereq-dir move when present - runs
 * as one unit: a failure partway through rolls back everything already
 * done, in reverse order, because a half-promoted draft (task in `tasks/`,
 * oracle still in `scratch/`) is worse than one this function simply
 * refused.
 */

import { ensureDir, exists, move, walk } from "@std/fs";
import { basename, dirname, join, relative } from "@std/path";
import { parse, stringify } from "@std/yaml";

import type { IdRoots } from "./ids.ts";
import type { DraftMeta } from "./scaffold.ts";
import type { ImportedFrom } from "./import.ts";
import type { ProbeVerdict } from "./probe.ts";
import { classifyOracleFiles } from "./oracle-files.ts";
import { DEFAULT_PROBE_CONTAINER } from "./scaffold.ts";
import { parseTaskManifest } from "../tasks/interfaces.ts";
import { writeWorkspace } from "./workspace.ts";

export type PromoteDifficulty = "easy" | "medium" | "hard";

/** Result of a successful promotion, reported back to the CLI layer. */
export interface PromoteResult {
  /** Repo-canonical destination, e.g. `tasks/hard/CG-AL-X053-day-close.yml`. */
  movedTask: string;
  /** Repo-canonical destination, e.g. `tests/al/hard/CG-AL-X053.Test.al`. */
  movedTest: string;
  /**
   * Repo-canonical destinations for the oracle's companion files (mocks,
   * spies, helper enums) that lived alongside it in `correct/` under the
   * reserved `<id>.` prefix. `compile-queue.ts` copies every
   * `${taskId}.`-prefixed `.al` out of `tests/al/<difficulty>/` at bench
   * time, so a companion left behind in the draft would fail the promoted
   * task's compile for every model despite a green probe.
   */
  movedCompanions: string[];
  /**
   * Repo-canonical path the prereq app was moved to, when this draft has
   * one (`scratch/<id>/prereq/` -> `tests/al/dependencies/<id>/`).
   */
  movedPrereq?: string;
  /** Always `true` - promoting always changes `task_sets.hash`. */
  hashChanged: true;
  /** Whether `--force` was used to skip the probe gate. */
  forced: boolean;
  /**
   * Non-fatal failures from the post-commit tidy-up (removing the draft's
   * `task.yml`, rewriting the workspace) - steps that run AFTER the move has
   * committed and therefore must not turn a successful promotion into a
   * thrown error. Omitted entirely when everything succeeded. The CLI prints
   * these; see the "post-commit tidy-up" block in {@link promoteDraft}.
   */
  postCommitWarnings?: string[];
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

  if (verdict.naive === "compile_fail" && !verdict.allowCompileFail) {
    throw new Error(
      `Refusing to promote ${id}: the naive side failed to COMPILE rather ` +
        `than failing its assertions. That is not discrimination - it ` +
        `usually means a solution file in correct/ carries the reserved ` +
        `"${id}." prefix and was injected into the naive run, or that the ` +
        `oracle references a helper only correct/ has. Fix the layout and ` +
        `re-probe, or re-run the probe with --allow-compile-fail if this ` +
        `trap genuinely is about a compile error.`,
    );
  }

  if (!verdict.discriminates) {
    const problems: string[] = [];
    if (verdict.correct !== "pass") {
      problems.push(
        `correct/ did not pass its own oracle (got "${verdict.correct}")`,
      );
    }
    if (verdict.naive === "pass") {
      problems.push("naive/ passed the oracle, so this task tests nothing");
    } else if (verdict.naive !== "fail") {
      // "passed" would be a lie for compile_fail/inconclusive - state the
      // actual outcome instead of asserting the one case it is not.
      problems.push(
        `naive/ did not fail its assertions (got "${verdict.naive}")`,
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
 * Refuses when `task.yml`, `<id>.Test.al`, or anything under `correct/`,
 * `naive/` or `prereq/` has an mtime later than the cached verdict's
 * timestamp. A green probe followed by an edit to the oracle, either
 * reference solution, or the prereq promotes against a verdict that no longer
 * describes the draft. Compares filesystem mtimes only - never spawns a probe
 * or touches a container.
 *
 * `prereq/` is walked for the same reason the other two are, and the reason is
 * not symmetry: `promoteDraft` MOVES it to `tests/al/dependencies/<id>/`,
 * which IS inside the task-set hash scope (`isEditorOnlyAppJson` deliberately
 * excludes prereq manifests from the editor carve-out). So a prereq edited
 * after a green probe changes both what compiles against the oracle and what
 * the benchmark hashes, while the verdict still claims the task was proven to
 * discriminate.
 */
async function assertVerdictIsFresh(
  id: string,
  draftDir: string,
  verdict: ProbeVerdict,
): Promise<void> {
  const verdictAt = new Date(verdict.at).getTime();
  if (Number.isNaN(verdictAt)) {
    // Fail CLOSED, not open: an unparseable timestamp means this gate
    // cannot establish that promotion is safe, and a corrupt .probe.json
    // is less trustworthy than a merely stale one, not more. Skipping the
    // check here would let a garbled verdict file sail through with no
    // freshness protection at all.
    throw new Error(
      `Refusing to promote ${id}: the cached probe verdict has an ` +
        `unreadable timestamp ("${verdict.at}") - re-run "centralgauge ` +
        `task probe ${id}" to get a valid one, or pass --force to override.`,
    );
  }

  const candidates = [join(draftDir, "task.yml")];

  // Only source files, and never editor state. Once correct/, naive/ and
  // prereq/ are live AL projects, the AL extension and AL Test Runner write
  // .altestrunner/, rad.json, .vscode/ and .alpackages/ into them; treating
  // those as draft edits would force a spurious multi-minute re-probe after
  // every session.
  for (const solutionDir of ["correct", "naive", "prereq"]) {
    const dir = join(draftDir, solutionDir);
    if (!(await exists(dir))) continue;
    for await (const entry of walk(dir, { includeDirs: false })) {
      const rel = relative(dir, entry.path).replaceAll("\\", "/");
      if (rel.split("/").some((seg) => seg.startsWith("."))) continue;
      const name = entry.name.toLowerCase();
      if (!name.endsWith(".al") && name !== "app.json") continue;
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

/**
 * Repo-relative, forward-slash destination paths this promote may overwrite
 * without refusing - exactly the file set `meta.importedFrom` (Task 1) says
 * this draft came from, via `importPromotedTask`. A draft with no
 * `importedFrom` (never imported, or hand-scaffolded) gets the empty set,
 * so every destination still refuses unconditionally - the pre-Task-2
 * behavior is the default, not a special case.
 */
function buildAllowedOverwrites(
  importedFrom: ImportedFrom | undefined,
): Set<string> {
  if (!importedFrom) return new Set();
  const allowed = new Set<string>([
    importedFrom.taskYml,
    importedFrom.testFile,
    ...importedFrom.companions,
  ]);
  if (importedFrom.prereqDir !== null) {
    allowed.add(importedFrom.prereqDir);
  }
  return allowed;
}

/**
 * `undefined` unless `target` is under `root`, in which case the forward-slash
 * path of `target` relative to `root`. `relative()` returning exactly `".."`
 * or anything starting with `"../"`/`"..\\"` means `target` escaped `root`
 * entirely - both are "not within", not "within at the parent".
 */
function relIfWithin(root: string, target: string): string | undefined {
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\")) {
    return undefined;
  }
  return rel.replaceAll("\\", "/");
}

/**
 * Converts an absolute destination path under `roots.tasksDir` or
 * `roots.testsDir` back to the canonical repo-relative, forward-slash form
 * `ImportedFrom` stores (`tasks/hard/...`, `tests/al/hard/...`,
 * `tests/al/dependencies/<id>`) - the shape every entry in
 * `allowedOverwrites` is compared against, and the same shape `movedTask`/
 * `movedTest` below are built in directly (deliberately not derived from
 * this function - see their own comment). `undefined` for a path under
 * neither root; callers treat that as "not overwrite-eligible", never as an
 * error.
 */
function toCanonicalRel(roots: IdRoots, absPath: string): string | undefined {
  const underTasks = relIfWithin(roots.tasksDir, absPath);
  if (underTasks !== undefined) return `tasks/${underTasks}`;
  const underTests = relIfWithin(roots.testsDir, absPath);
  if (underTests !== undefined) return `tests/al/${underTests}`;
  return undefined;
}

/**
 * Inverse of {@link toCanonicalRel}: resolves a canonical repo-relative path
 * (as `ImportedFrom` stores it) back to an absolute path under `roots`.
 */
function resolveCanonicalRel(roots: IdRoots, rel: string): string {
  if (rel.startsWith("tasks/")) {
    return join(roots.tasksDir, rel.slice("tasks/".length));
  }
  if (rel.startsWith("tests/al/")) {
    return join(roots.testsDir, rel.slice("tests/al/".length));
  }
  throw new Error(
    `Cannot resolve "${rel}" to a path under tasksDir/testsDir - expected ` +
      `it to start with "tasks/" or "tests/al/".`,
  );
}

/**
 * Throws unless `targetPath` does not yet exist - UNLESS its canonical
 * repo-relative form is listed in `allowedOverwrites` (Task 2), in which
 * case the existing file is exactly the one this draft was imported from and
 * re-promoting over it is the whole point. There is still no `--force`
 * override: a path not in `allowedOverwrites` refuses unconditionally, same
 * as before Task 2.
 */
async function refuseIfExists(
  targetPath: string,
  kind: string,
  roots: IdRoots,
  allowedOverwrites: Set<string>,
): Promise<void> {
  if (!(await exists(targetPath))) return;
  const rel = toCanonicalRel(roots, targetPath);
  if (rel !== undefined && allowedOverwrites.has(rel)) return;
  throw new Error(
    `Refusing to promote: ${kind} already exists at ${targetPath} - ` +
      `overwriting a shipped task silently is never wanted. There is no ` +
      `--force for this check.`,
  );
}

/**
 * Deletes the OLD file a re-imported draft's promote no longer targets -
 * relevant only when `oldRel` (an entry from `meta.importedFrom`) differs
 * from `newRel` (the destination this promote just wrote). That happens
 * when the caller passes a `--slug` different from the one the task manifest
 * was imported under (only the manifest's filename carries the slug; the
 * test file, companions and prereq dir are named from `id` alone) or a
 * `--difficulty` different from `importedFrom.difficulty` (moves all four).
 * Without this, a renamed re-promote would leave a stale duplicate at the
 * old path alongside the new one. Runs after the move has committed, so a
 * failure here is collected into `postCommitWarnings` rather than thrown -
 * same non-fatal contract as the rest of that block, since the promotion
 * itself already succeeded.
 */
async function removeStaleImportedFile(
  roots: IdRoots,
  oldRel: string,
  newRel: string,
  postCommitWarnings: string[],
): Promise<void> {
  if (oldRel === newRel) return;
  const oldAbs = resolveCanonicalRel(roots, oldRel);
  try {
    if (await exists(oldAbs)) {
      await Deno.remove(oldAbs);
    }
  } catch (error) {
    postCommitWarnings.push(
      `could not remove the stale re-imported file at ${oldAbs} (now at ` +
        `${newRel}): ${
          error instanceof Error ? error.message : String(error)
        } - delete it by hand.`,
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
 * True if some file anywhere under `dir` already carries `id` in its name,
 * OTHER than a match whose canonical repo-relative form is listed in
 * `allowedOverwrites` (Task 2) - the exact files this draft was imported
 * from. Path-based checks alone (exact `tasks/<difficulty>/<id>-<slug>.yml`
 * / `tests/al/<difficulty>/<id>.Test.al`) miss the case where the SAME id is
 * being re-promoted under a *different* `--difficulty` - a different
 * destination path, but still two manifests sharing one id in the suite.
 * Without the allow-list exception, re-promoting an imported draft over its
 * own files would always trip this check first, since the very file being
 * legitimately overwritten also "already carries id in its name".
 */
async function idExistsAnywhereUnder(
  dir: string,
  id: string,
  roots: IdRoots,
  allowedOverwrites: Set<string>,
): Promise<boolean> {
  if (!(await exists(dir))) return false;
  for await (const entry of walk(dir, { includeDirs: false })) {
    if (!filenameMatchesId(entry.name, id)) continue;
    const rel = toCanonicalRel(roots, entry.path);
    if (rel !== undefined && allowedOverwrites.has(rel)) continue;
    return true;
  }
  return false;
}

/**
 * Promotes `scratch/<id>/` into the committed suite. See the module doc for
 * the load-bearing refusal rules. Order: resolve slug -> gate on the probe
 * verdict (discriminates + fresh) -> resolve the oracle-side file set ->
 * check every destination path is free -> validate the rewritten manifest
 * -> move -> report.
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

  // --- resolve the oracle-side file set (Task 2's single source of truth
  // for what lives under the reserved "<id>." prefix in correct/) - needed
  // below for the per-companion destination refusals, and again further
  // down for the move itself. ---
  const oracleSet = await classifyOracleFiles({ id, draftDir });
  const draftTestAlPath = join(draftDir, "correct", oracleSet.oracle);
  const draftCompanionPaths = oracleSet.companions.map((name) =>
    join(draftDir, "correct", name)
  );

  // --- Task 2: the set of destination paths this draft is allowed to
  // overwrite - exactly the files `meta.importedFrom` says it came from.
  // Empty for a draft that was never imported, so every check below refuses
  // unconditionally in that case, exactly as before Task 2. ---
  const allowedOverwrites = buildAllowedOverwrites(meta?.importedFrom);

  // --- check every destination path is free (never overridable, except for
  // the importedFrom allow-list above) ---
  const taskTargetPath = join(
    roots.tasksDir,
    difficulty,
    `${id}-${slug}.yml`,
  );
  const testTargetPath = join(roots.testsDir, difficulty, `${id}.Test.al`);
  const prereqTargetDir = join(roots.testsDir, "dependencies", id);

  await refuseIfExists(
    taskTargetPath,
    "task manifest",
    roots,
    allowedOverwrites,
  );
  await refuseIfExists(
    testTargetPath,
    "test codeunit",
    roots,
    allowedOverwrites,
  );
  await refuseIfExists(prereqTargetDir, "prereq dir", roots, allowedOverwrites);
  for (const name of oracleSet.companions) {
    await refuseIfExists(
      join(roots.testsDir, difficulty, name),
      `companion file ${name}`,
      roots,
      allowedOverwrites,
    );
  }

  if (
    await idExistsAnywhereUnder(roots.tasksDir, id, roots, allowedOverwrites)
  ) {
    throw new Error(
      `Refusing to promote ${id}: a task manifest for this id already ` +
        `exists somewhere under ${roots.tasksDir} - promoting under a ` +
        `different --difficulty would ship two manifests with the same ` +
        `id. There is no --force for this check.`,
    );
  }
  if (
    await idExistsAnywhereUnder(roots.testsDir, id, roots, allowedOverwrites)
  ) {
    throw new Error(
      `Refusing to promote ${id}: a test codeunit for this id already ` +
        `exists somewhere under ${roots.testsDir} - promoting under a ` +
        `different --difficulty would ship two manifests with the same ` +
        `id. There is no --force for this check.`,
    );
  }

  // --- validate before moving ---
  // The oracle's own existence was already established by classifyOracleFiles
  // above (its Refusal 3) - draftTestAlPath is guaranteed to exist here.
  const draftTaskYamlPath = join(draftDir, "task.yml");
  const draftPrereqDir = join(draftDir, "prereq");

  if (!(await exists(draftTaskYamlPath))) {
    throw new Error(
      `Cannot promote ${id}: no task.yml at ${draftTaskYamlPath} - is ` +
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

  // --- move: task write, test-file move, companion moves, and (if present)
  // prereq-dir move all share ONE rollback. A failure partway through -
  // e.g. a companion move fails after the task manifest and test file were
  // already moved - undoes everything that succeeded so far, because a
  // half-promoted draft (task in tasks/, oracle still in scratch/) is worse
  // than a refused one. ---
  const movedPairs: Array<{ from: string; to: string }> = [];
  let taskWritten = false;
  let prereqMoved = false;
  try {
    await ensureDir(dirname(taskTargetPath));
    await ensureDir(dirname(testTargetPath));
    await Deno.writeTextFile(taskTargetPath, finalYamlText);
    taskWritten = true;

    // `overwrite` is keyed off whether the destination CURRENTLY exists,
    // not passed unconditionally: by this point every destination has
    // already passed refuseIfExists (task manifest, test codeunit, prereq
    // dir, each companion) above, so one that still exists here is
    // guaranteed to be an importedFrom-allow-listed overwrite (Task 2).
    // Passing `overwrite: true` unconditionally would be equivalent in
    // that case, but NOT in the common (non-overwrite) one - @std/fs's
    // move() calls `Deno.remove(dest, ...)` up front whenever `overwrite`
    // is true, even when `dest` doesn't exist (it just swallows the
    // resulting NotFound). That extra call is harmless in production, but
    // it changes which mocked `Deno.*` call fires first in the rollback
    // tests below - keying `overwrite` off `exists()` keeps the
    // non-overwrite path byte-for-byte the same as before Task 2.
    await move(draftTestAlPath, testTargetPath, {
      overwrite: await exists(testTargetPath),
    });
    movedPairs.push({ from: draftTestAlPath, to: testTargetPath });

    for (const from of draftCompanionPaths) {
      const to = join(roots.testsDir, difficulty, basename(from));
      await move(from, to, { overwrite: await exists(to) });
      movedPairs.push({ from, to });
    }

    if (meta?.withPrereq) {
      await ensureDir(dirname(prereqTargetDir));
      // Recursive replace, not a merge - move()'s overwrite path removes
      // the whole existing prereqTargetDir before renaming the draft's
      // prereq/ into place, so a file dropped from the draft's prereq/
      // since the earlier import doesn't survive as an orphan.
      await move(draftPrereqDir, prereqTargetDir, {
        overwrite: await exists(prereqTargetDir),
      });
      prereqMoved = true;
    }

    // Defensive re-validation of what now sits at the destination. Only a
    // pathological write/read roundtrip issue trips this, since the
    // in-memory object above already validated.
    const onDisk = parse(await Deno.readTextFile(taskTargetPath));
    parseTaskManifest(onDisk, taskTargetPath);
  } catch (error) {
    // Each rollback step is individually guarded: a failure here must
    // never mask the ORIGINAL error by throwing in its place - the
    // operator needs to know what actually went wrong, not just that
    // cleanup also failed. Rollback failures are collected and appended
    // instead of replacing the primary message.
    const rollbackErrors: string[] = [];
    if (prereqMoved) {
      try {
        await move(prereqTargetDir, draftPrereqDir);
      } catch (rollbackError) {
        rollbackErrors.push(
          `restoring ${prereqTargetDir} -> ${draftPrereqDir}: ${
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          }`,
        );
      }
    }
    // Undo the most recent move first - this list holds the test-file move
    // followed by any companion moves, in the order they landed.
    for (const pair of movedPairs.slice().reverse()) {
      try {
        await move(pair.to, pair.from);
      } catch (rollbackError) {
        rollbackErrors.push(
          `restoring ${pair.to} -> ${pair.from}: ${
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          }`,
        );
      }
    }
    if (taskWritten) {
      try {
        await Deno.remove(taskTargetPath);
      } catch (rollbackError) {
        rollbackErrors.push(
          `removing ${taskTargetPath}: ${
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          }`,
        );
      }
    }

    const originalMessage = error instanceof Error
      ? error.message
      : String(error);
    const rollbackSuffix = rollbackErrors.length > 0
      ? ` ROLLBACK ALSO FAILED (${
        rollbackErrors.join("; ")
      }) - scratch/${id}/ and the destination may both hold partial ` +
        `state now; check by hand.`
      : "";
    throw new Error(
      `Promotion of ${id} rolled back: ${originalMessage}${rollbackSuffix}`,
    );
  }

  // --- post-commit tidy-up: NON-FATAL by construction. ---
  //
  // Everything below runs AFTER the rollback window has closed: the manifest,
  // the oracle, the companions and the prereq are all at their destinations
  // and re-validated. Letting either step throw would report a FAILURE for a
  // promotion that fully succeeded, and the operator's natural retry would
  // then hit `refuseIfExists` ("already exists ... there is no --force for
  // this check") on work that was already done correctly - the worst
  // combination available. Rolling back instead is not an option either: the
  // move is committed and undoing a good promotion over a failed `unlink` is
  // strictly worse than leaving one stale file behind.
  //
  // So each is guarded and its failure is REPORTED, never swallowed, via
  // `postCommitWarnings` - the CLI prints them under a `[!]` line.
  const postCommitWarnings: string[] = [];

  // Task 2: a re-imported draft whose --slug or --difficulty differs from
  // what it was imported under just wrote to a NEW destination above,
  // leaving the OLD file (the one `refuseIfExists`/`idExistsAnywhereUnder`
  // allow-listed via importedFrom) still sitting at its original path.
  // Clean it up so a renamed re-promote doesn't ship a stale duplicate
  // alongside the new file. No-op for the common case (same slug, same
  // difficulty), where oldRel === newRel for every one of these.
  if (meta?.importedFrom) {
    await removeStaleImportedFile(
      roots,
      meta.importedFrom.taskYml,
      movedTask,
      postCommitWarnings,
    );
    await removeStaleImportedFile(
      roots,
      meta.importedFrom.testFile,
      movedTest,
      postCommitWarnings,
    );
    for (const name of oracleSet.companions) {
      const oldCompanionRel = meta.importedFrom.companions.find(
        (c) => c.split("/").pop() === name,
      );
      if (oldCompanionRel !== undefined) {
        await removeStaleImportedFile(
          roots,
          oldCompanionRel,
          `tests/al/${difficulty}/${name}`,
          postCommitWarnings,
        );
      }
    }
  }

  // Only remove the draft's task.yml once the promoted copy is confirmed
  // good - keeps scratch/ as the rollback source until that's certain.
  // correct/, naive/, NOTES.md, .meta.json and .probe.json are left in
  // place as the draft's authoring history.
  try {
    await Deno.remove(draftTaskYamlPath);
  } catch (error) {
    postCommitWarnings.push(
      `could not remove the promoted draft's ${draftTaskYamlPath} (${
        error instanceof Error ? error.message : String(error)
      }) - the promotion itself succeeded; delete the leftover by hand.`,
    );
  }

  // Rewrite the workspace to the promoted paths only now, after the move
  // has fully committed - everything above that can still roll back (the
  // try/catch) never reaches this line, so a refused or rolled-back
  // promotion always leaves the workspace pointing at the draft, never at
  // destination paths that were never created. No fresh docker inspect
  // here (unlike scaffoldDraft/probeDraft): promoteDraft never talks to a
  // container, and none of the promoted folders is an AL project root any
  // more (see promotedFolders' own doc comment), so there is nothing left
  // for al.packageCachePath to serve.
  try {
    await writeWorkspace({
      id,
      slug,
      draftDir,
      repoRoot: Deno.cwd(),
      hasPrereq: meta?.withPrereq ?? false,
      // .meta.json is written once at scaffold time and never touched again
      // before promotion, so it is the reliable source here - unlike
      // task.yml's copy, whose schema deliberately allows an operator to omit
      // it. 0 only fires when .meta.json is gone AND opts.slug was given
      // explicitly (the one path that reaches this line without it) - a
      // placeholder, not a guess, exactly like resolveSymbolPaths returning
      // [] rather than a wrong-but-plausible answer.
      testCodeunitId: meta?.testCodeunitId ?? 0,
      container: DEFAULT_PROBE_CONTAINER,
      symbolPaths: [],
      state: "promoted",
      difficulty,
    });
  } catch (error) {
    postCommitWarnings.push(
      `could not rewrite ${id}.code-workspace/CHECKLIST.md for the promoted ` +
        `paths (${error instanceof Error ? error.message : String(error)}) - ` +
        `the promotion itself succeeded; the workspace still points at the ` +
        `draft layout. Re-run "centralgauge task promote ${id}" is NOT the ` +
        `fix (the destinations are taken); regenerate or edit it by hand.`,
    );
  }

  return {
    movedTask,
    movedTest,
    movedCompanions: oracleSet.companions.map((n) =>
      `tests/al/${difficulty}/${n}`
    ),
    ...(meta?.withPrereq ? { movedPrereq: `tests/al/dependencies/${id}` } : {}),
    hashChanged: true,
    forced: force,
    ...(postCommitWarnings.length > 0 ? { postCommitWarnings } : {}),
  };
}
