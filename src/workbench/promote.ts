/**
 * Promote gate for the task workbench.
 *
 * `promoteDraft` is the last checkpoint before a hand-authored trap-task
 * becomes something models are scored against: it moves a `scratch/<id>/`
 * draft's `task.yml` and `<id>.Test.al` into the committed `tasks/` and
 * `tests/al/` trees. Because that move changes `task_sets.hash` (see
 * CLAUDE.md's "Task-set hash scope"), it refuses far more than it accepts -
 * a task that a naive solution also passes tests nothing, and a task
 * promoted on an infra hiccup is worse, because it looks validated when it
 * is not.
 *
 * Two refusals are load-bearing:
 *
 * - A `"inconclusive"` probe side is refused with a message saying exactly
 *   that, not "failed". `trap-probe` returns exit 3 for infra trouble
 *   (container down, publish timeout), and an operator told "the task
 *   failed the gate" edits a task that may be perfectly good; one told
 *   "inconclusive - re-run" does the right thing instead.
 * - Any destination path that already exists (task manifest, test
 *   codeunit, or an unexplained prereq dir) refuses with NO `--force`
 *   override. Unlike a failed probe gate, silently overwriting a shipped
 *   task has no legitimate use case.
 *
 * The manifest schema is `.strict()` (`src/tasks/interfaces.ts`), so the
 * rewritten YAML is validated through the real `parseTaskManifest` before
 * anything moves - the common failure (a malformed draft) then needs no
 * rollback. A second, redundant validation pass re-reads the file that now
 * sits at its destination; only that pathological case rolls back, because
 * a half-promoted draft (task in `tasks/`, oracle still in `scratch/`) is
 * worse than one this function simply refused.
 */

import { ensureDir, exists, move } from "@std/fs";
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
   * Repo-canonical path of the prereq app, when this draft has one. NOT a
   * move: `scaffoldDraft` (Task 2) writes a `--with-prereq` app.json
   * directly to its final `tests/al/dependencies/<id>/` location at
   * scaffold time, so by promote time it is already there. This field is
   * purely informational, reported alongside the two real moves.
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
  /** Skips the probe gate. Does NOT skip the target-exists check below - that one has no override. */
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
 * see the module doc for why the distinction matters.
 */
function assertVerdictAllowsPromotion(
  id: string,
  verdict: ProbeVerdict | undefined,
): void {
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
 * Promotes `scratch/<id>/` into the committed suite. See the module doc for
 * the two load-bearing refusal rules. Order: resolve slug -> gate on the
 * probe verdict -> check every destination path is free -> validate the
 * rewritten manifest -> move -> report.
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
    assertVerdictAllowsPromotion(id, opts.verdict);
  }

  // --- check every destination path is free (never overridable) ---
  const taskTargetPath = join(
    roots.tasksDir,
    difficulty,
    `${id}-${slug}.yml`,
  );
  const testTargetPath = join(roots.testsDir, difficulty, `${id}.Test.al`);
  const prereqDirPath = join(roots.testsDir, "dependencies", id);

  await refuseIfExists(taskTargetPath, "task manifest");
  await refuseIfExists(testTargetPath, "test codeunit");

  const prereqAlreadyExists = await exists(prereqDirPath);
  if (prereqAlreadyExists && !meta?.withPrereq) {
    // scaffoldDraft (Task 2) writes a --with-prereq app.json directly to
    // this same path at scaffold time, so its presence is expected and
    // benign for THIS draft's own prereq (see movedPrereq's doc). Finding
    // one here for a draft that was never scaffolded with --with-prereq
    // means something else already occupies the slot - a leftover from a
    // reused id, or manual tampering - not this draft's own resource.
    throw new Error(
      `Refusing to promote ${id}: prereq dir already exists at ` +
        `${prereqDirPath}, but this draft was not scaffolded with ` +
        `--with-prereq - looks like a leftover or conflicting prereq app. ` +
        `There is no --force for this check.`,
    );
  }

  // --- validate before moving ---
  const draftTaskYamlPath = join(draftDir, "task.yml");
  const draftTestAlPath = join(draftDir, `${id}.Test.al`);

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

  const rewritten = {
    ...rawRecord,
    expected: { ...rawExpected, testApp: movedTest },
  };

  // Throws with the manifest's own validation errors when malformed -
  // nothing has been written or moved yet, so refusing here costs nothing
  // to undo.
  parseTaskManifest(rewritten, taskTargetPath);

  const finalYamlText = stringify(rewritten, { lineWidth: -1 });

  // --- move ---
  await ensureDir(dirname(taskTargetPath));
  await ensureDir(dirname(testTargetPath));
  await Deno.writeTextFile(taskTargetPath, finalYamlText);
  await move(draftTestAlPath, testTargetPath);

  // Defensive re-validation of what now sits at the destination. Only a
  // pathological write/read roundtrip issue trips this, since the
  // in-memory object above already validated - but a half-promoted draft
  // (task in tasks/, oracle still in scratch/) is worse than a refused one,
  // so this rolls back rather than trusting the earlier check alone.
  try {
    const onDisk = parse(await Deno.readTextFile(taskTargetPath));
    parseTaskManifest(onDisk, taskTargetPath);
  } catch (error) {
    await Deno.remove(taskTargetPath);
    await move(testTargetPath, draftTestAlPath);
    throw new Error(
      `Promotion of ${id} rolled back: the manifest failed re-validation ` +
        `after being moved (${
          error instanceof Error ? error.message : String(error)
        }).`,
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
    ...(prereqAlreadyExists
      ? { movedPrereq: `tests/al/dependencies/${id}` }
      : {}),
    hashChanged: true,
    forced: force,
  };
}
