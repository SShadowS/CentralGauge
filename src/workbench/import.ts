/**
 * Reimports a promoted (committed) benchmark task back into `scratch/` as an
 * editable draft.
 *
 * `scaffoldDraft` (`src/workbench/scaffold.ts`) builds a brand-new draft from
 * an allocated id. This module is the inverse: given the id of a task that
 * has already been promoted into `tasks/<difficulty>/` + `tests/al/**`, it
 * reconstructs the same `scratch/<id>/` layout - `task.yml`, `correct/`
 * (oracle + companions + a freshly rendered `app.json`), `naive/` (a fresh
 * `app.json` only - there is no committed naive solution to restore), and
 * `prereq/` when the task has one - so the task can be edited and re-probed
 * exactly like a fresh draft.
 *
 * `correct/app.json` and `naive/app.json` are never committed anywhere
 * (`promoteDraft` only moves `task.yml`, the oracle, companions and the
 * prereq into the committed tree - see `.claude/rules/prereq-apps.md`), so
 * they are regenerated here via `renderSolutionAppJson`, the exact renderer
 * `scaffoldDraft` uses, rather than duplicated.
 */

import { copy, ensureDir, exists, walk } from "@std/fs";
import { basename, dirname, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

import type { AppJson } from "../al/app-manifest.ts";
import type { DraftMeta } from "./scaffold.ts";
import type { SymbolPathResolver } from "./workspace.ts";
import { DEFAULT_PROBE_CONTAINER, renderSolutionAppJson } from "./scaffold.ts";
import { resolveSymbolPaths, writeWorkspace } from "./workspace.ts";
import { companionPredicateMatches } from "./oracle-files.ts";

/** Difficulties tasks are organized under - the three `tasks/<difficulty>/` and `tests/al/<difficulty>/` folders. */
type Difficulty = "easy" | "medium" | "hard";
const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

/** `<id>-<slug>.yml` filename shape, e.g. `CG-AL-X052-day-close.yml`. */
const TASK_FILENAME_PATTERN = /^(CG-AL-[A-Z]\d{3})-(.+)\.yml$/;

/**
 * The workbench (scaffold, ids, probe, promote) only ever operates on the
 * `CG-AL-X###` ado-trap-2026 cohort - see `scaffold.ts`'s own
 * `TASK_ID_PATTERN` and `ids.ts`'s collision tracking, both X-only by
 * design. Import must match that scoping: `renderSolutionAppJson` (reused
 * below to regenerate `correct/`/`naive/` app.json) can only derive a
 * solution app id for `CG-AL-X*`, so an E/M/H id would reach it and throw a
 * renderer-internal message that has nothing to do with why the import
 * actually failed.
 */
const X_SERIES_ID_PATTERN = /^CG-AL-X\d{2,3}$/;

/**
 * Throws before any filesystem access when `id` is not an X-series id -
 * the workbench has nothing to import an E/M/H task INTO (there is no
 * `correct/`/`naive/` app id scheme for them), so the earliest possible
 * refusal is also the clearest one.
 */
function assertXSeriesId(id: string): void {
  if (!X_SERIES_ID_PATTERN.test(id)) {
    throw new Error(
      `Only X-series tasks (CG-AL-Xnn) can be imported into the workbench; ` +
        `${id} is a legacy task - edit it directly under tests/al/.`,
    );
  }
}

/** Repo-relative paths a re-imported draft's `promote` may later overwrite. */
export interface ImportedFrom {
  /** Repo-relative, forward-slash paths this draft's promote may overwrite. */
  taskYml: string;
  testFile: string;
  companions: string[];
  prereqDir: string | null;
  difficulty: Difficulty;
}

/** Result of {@link importPromotedTask}. */
export interface ImportResult {
  id: string;
  draftDir: string;
  importedFrom: ImportedFrom;
}

/** Forward-slash repo-relative path, regardless of the host path separator. */
function toRepoRelative(repoRoot: string, absPath: string): string {
  const rel = absPath.slice(repoRoot.length).replace(/^[\\/]+/, "");
  return rel.replaceAll("\\", "/");
}

function isDifficulty(value: string): value is Difficulty {
  return (DIFFICULTIES as readonly string[]).includes(value);
}

/**
 * Locates the single committed `tasks/<difficulty>/<id>-*.yml` for `id`,
 * searching all three difficulty folders. Throws (naming `id`) when none or
 * more than one match is found - a second match would mean the id was
 * promoted twice, which import must refuse rather than guess between.
 */
async function findTaskYml(
  repoRoot: string,
  id: string,
): Promise<{ path: string; difficulty: Difficulty }> {
  const tasksDir = join(repoRoot, "tasks");
  const matches: string[] = [];

  if (await exists(tasksDir)) {
    for await (
      const entry of walk(tasksDir, {
        exts: [".yml"],
        includeDirs: false,
        maxDepth: 2,
      })
    ) {
      if (entry.name.startsWith(`${id}-`)) {
        matches.push(entry.path);
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(
      `No promoted task manifest found for ${id} under ${tasksDir} ` +
        `(expected tasks/<difficulty>/${id}-*.yml).`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous task manifest for ${id}: found ${matches.length} matches ` +
        `- ${matches.join(", ")}.`,
    );
  }

  const path = matches[0]!;
  const difficultyDir = basename(dirname(path));
  if (!isDifficulty(difficultyDir)) {
    throw new Error(
      `Task manifest ${path} is not under a known difficulty folder ` +
        `(easy/medium/hard) - found "${difficultyDir}".`,
    );
  }
  return { path, difficulty: difficultyDir };
}

/**
 * Copies a promoted (committed) task with id `id` back into `scratch/<id>/`
 * as an editable draft. Refuses if that draft directory already exists -
 * this never overwrites in-progress work.
 */
export async function importPromotedTask(
  id: string,
  opts?: {
    repoRoot?: string;
    scratchRoot?: string;
    /** BC container the regenerated workspace targets. Defaults to `DEFAULT_PROBE_CONTAINER`. */
    container?: string;
    /**
     * Override for tests; defaults to the real `docker inspect` resolver.
     * Forwarded to `writeWorkspace` — see `SymbolPathResolver`.
     */
    resolveSymbols?: SymbolPathResolver;
  },
): Promise<ImportResult> {
  assertXSeriesId(id);

  const repoRoot = opts?.repoRoot ?? Deno.cwd();
  const scratchRoot = opts?.scratchRoot ?? join(repoRoot, "scratch");

  const { path: taskYmlPath, difficulty } = await findTaskYml(repoRoot, id);

  const testFilePath = join(
    repoRoot,
    "tests",
    "al",
    difficulty,
    `${id}.Test.al`,
  );
  if (!await exists(testFilePath)) {
    throw new Error(
      `Task manifest ${taskYmlPath} was found, but its test codeunit ` +
        `${testFilePath} is missing.`,
    );
  }

  const testDir = dirname(testFilePath);
  const companionNames: string[] = [];
  for await (const entry of Deno.readDir(testDir)) {
    if (entry.isFile && companionPredicateMatches(id, entry.name)) {
      companionNames.push(entry.name);
    }
  }
  companionNames.sort();

  const prereqDirAbs = join(repoRoot, "tests", "al", "dependencies", id);
  const hasPrereq = await exists(prereqDirAbs);

  const draftDir = join(scratchRoot, id);
  if (await exists(draftDir)) {
    throw new Error(
      `Draft already exists at ${draftDir} - refusing to overwrite ` +
        `in-progress work.`,
    );
  }

  const taskYmlText = await Deno.readTextFile(taskYmlPath);
  const manifest = parseYaml(taskYmlText) as {
    expected?: { testCodeunitId?: number };
  };
  const testCodeunitId = manifest.expected?.testCodeunitId;
  if (typeof testCodeunitId !== "number") {
    throw new Error(
      `Task manifest ${taskYmlPath} has no numeric expected.testCodeunitId.`,
    );
  }

  const filenameMatch = TASK_FILENAME_PATTERN.exec(basename(taskYmlPath));
  if (!filenameMatch) {
    throw new Error(
      `Task manifest filename "${basename(taskYmlPath)}" does not match ` +
        `<id>-<slug>.yml.`,
    );
  }
  const slug = filenameMatch[2]!;

  await ensureDir(join(draftDir, "correct"));
  await ensureDir(join(draftDir, "naive"));

  await Deno.copyFile(taskYmlPath, join(draftDir, "task.yml"));
  await Deno.copyFile(testFilePath, join(draftDir, "correct", `${id}.Test.al`));
  for (const companionName of companionNames) {
    await Deno.copyFile(
      join(testDir, companionName),
      join(draftDir, "correct", companionName),
    );
  }

  let prereqAppJson: AppJson | undefined;
  if (hasPrereq) {
    await copy(prereqDirAbs, join(draftDir, "prereq"));
    const prereqAppJsonPath = join(prereqDirAbs, "app.json");
    if (await exists(prereqAppJsonPath)) {
      prereqAppJson = JSON.parse(
        await Deno.readTextFile(prereqAppJsonPath),
      ) as AppJson;
    }
  }

  await Deno.writeTextFile(
    join(draftDir, "correct", "app.json"),
    renderSolutionAppJson(id, "correct", prereqAppJson),
  );
  await Deno.writeTextFile(
    join(draftDir, "naive", "app.json"),
    renderSolutionAppJson(id, "naive", prereqAppJson),
  );

  const importedFrom: ImportedFrom = {
    taskYml: toRepoRelative(repoRoot, taskYmlPath),
    testFile: toRepoRelative(repoRoot, testFilePath),
    companions: companionNames.map((name) =>
      toRepoRelative(repoRoot, join(testDir, name))
    ),
    prereqDir: hasPrereq ? toRepoRelative(repoRoot, prereqDirAbs) : null,
    difficulty,
  };

  const meta: DraftMeta = {
    id,
    slug,
    testCodeunitId,
    createdAt: new Date().toISOString(),
    withPrereq: hasPrereq,
    importedFrom,
  };
  await Deno.writeTextFile(
    join(draftDir, ".meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
  );

  // Same context construction as scaffoldDraft's own writeWorkspace call
  // (src/workbench/scaffold.ts) - state is "draft" because that is what
  // scratch/<id>/ now holds, even though it was reconstructed from a
  // promoted task. Symbol resolution is best-effort for the same reason it
  // is there: a container that is down at import time must not block
  // authoring.
  const symbolPaths = await (opts?.resolveSymbols ?? resolveSymbolPaths)({
    container: opts?.container ?? DEFAULT_PROBE_CONTAINER,
    draftDir,
    hasPrereq,
  });
  await writeWorkspace({
    id,
    slug,
    draftDir,
    repoRoot,
    hasPrereq,
    testCodeunitId,
    container: opts?.container ?? DEFAULT_PROBE_CONTAINER,
    symbolPaths,
    state: "draft",
  });

  return { id, draftDir, importedFrom };
}

/**
 * Lists every promoted task under `tasks/<difficulty>/<id>-<slug>.yml`,
 * across all three difficulty folders - the candidate set `import` can act
 * on.
 */
export async function listPromotedTasks(
  repoRoot?: string,
): Promise<Array<{ id: string; slug: string; difficulty: string }>> {
  const root = repoRoot ?? Deno.cwd();
  const tasksDir = join(root, "tasks");
  const results: Array<{ id: string; slug: string; difficulty: string }> = [];

  if (!await exists(tasksDir)) {
    return results;
  }

  for await (
    const entry of walk(tasksDir, {
      exts: [".yml"],
      includeDirs: false,
      maxDepth: 2,
    })
  ) {
    const match = TASK_FILENAME_PATTERN.exec(entry.name);
    if (!match) continue;
    // Legacy (E/M/H) tasks are filtered out, not surfaced-then-refused: the
    // dashboard's Import list (Task 4/5) must never offer a row that would
    // reject on click. See X_SERIES_ID_PATTERN / assertXSeriesId above.
    if (!X_SERIES_ID_PATTERN.test(match[1]!)) continue;
    results.push({
      id: match[1]!,
      slug: match[2]!,
      difficulty: basename(dirname(entry.path)),
    });
  }

  results.sort((a, b) => a.id.localeCompare(b.id));
  return results;
}
