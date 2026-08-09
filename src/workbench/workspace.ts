/**
 * VS Code multi-root workspace + CHECKLIST.md rendering for the task
 * workbench.
 *
 * A hand-authored trap-task draft spans several AL projects
 * (`scratch/<id>/correct/`, `naive/`, optionally `prereq/`) plus a task
 * manifest and notes file that are not themselves AL projects. Opening the
 * draft directory alone gives the AL Language extension one confused
 * "project" spanning two/three conflicting app.json files and no IntelliSense
 * for any of them. A `.code-workspace` file solves that by giving each AL
 * project its own root, and bundles the probe/promote commands as VS Code
 * tasks so authoring never leaves the editor.
 *
 * `renderWorkspace` and `renderChecklist` are pure - they take a
 * `WorkspaceContext` and return a string, so every shape decision below is
 * unit-testable without a container. `resolveSymbolPaths` is the one function
 * that does I/O (a `docker inspect`), and it is the one thing no test may
 * call - see its own doc comment for why a wrong answer there is worse than
 * no answer.
 *
 * Four decisions here are load-bearing enough to repeat close to the code
 * that encodes them - see each function's comments for the "why":
 *
 * 1. `files.exclude` hides known child directories by NAME under the draft
 *    root. It never attempts to narrow a folder down to one visible file -
 *    VS Code's `files.exclude` has no negation (the `"pattern": false`
 *    proposal, microsoft/vscode#86520, was closed unmerged; shipped `false`
 *    disables a pattern, it does not re-include a path) and the setting is
 *    resource-scoped, so one workspace-level value applies to every root.
 * 2. Every task sets `"problemMatcher": []`. See `buildTasks` below for why
 *    an EMPTY matcher, not an omitted key - VS Code prompts the author to
 *    pick a matcher on every run of a shell task that has none at all, and
 *    `[]` is how a task says "I know, there genuinely isn't one."
 * 3. Every task gets an absolute `options.cwd` pointing at `repoRoot`, baked
 *    in at generation time - `deno task start` and `scripts/trap-probe.ts`
 *    both need the repo root, and VS Code otherwise defaults a task's cwd to
 *    the workspace file's FIRST folder, which here is the draft directory.
 * 4. `resolveSymbolPaths` returns `[]` on any failure, never a guess -
 *    `renderWorkspace` then omits `al.packageCachePath` entirely rather than
 *    emit an empty array, because a wrong symbol path produces editor errors
 *    that contradict probe results.
 */

import { join, relative } from "@std/path";

import type { PromoteDifficulty } from "./promote.ts";
import { compilerCacheKey } from "../container/compiler-cache-key.ts";

/** Everything `renderWorkspace`/`renderChecklist`/`resolveSymbolPaths` need, resolved by the caller. */
export interface WorkspaceContext {
  /** e.g. `CG-AL-X053`. */
  id: string;
  /** Kebab-case slug, e.g. `day-close` - used for the promoted task manifest's filename. */
  slug: string;
  /** Absolute path to `scratch/<id>/`. Also where the `.code-workspace` file itself is written. */
  draftDir: string;
  /** Absolute repo root - baked into every task's `options.cwd`. */
  repoRoot: string;
  /** Whether the draft has a `prereq/` project. */
  hasPrereq: boolean;
  /** AL test codeunit id. Only used in draft state's single-side probe tasks' `--test-codeunit-id` - promoted state resolves it from the committed task.yml instead. */
  testCodeunitId: number;
  /** BC container name, baked into the single-side probe tasks' `--container`. */
  container: string;
  /** Resolved symbol-cache directories, or `[]` when none resolved. See {@link resolveSymbolPaths}. */
  symbolPaths: string[];
  /** Whether the draft has been promoted - controls the folder list and adds the taxonomy task. */
  state: "draft" | "promoted";
  /** Only meaningful once promoted; defaults to `"hard"` everywhere it is read. */
  difficulty?: PromoteDifficulty;
}

/** Windows-style symbol cache root every artifact-URL-keyed compiler cache lives under. */
const COMPILER_CACHE_ROOT = "C:\\ProgramData\\BcContainerHelper";

/**
 * Resolves `al.packageCachePath` entries for a draft: the container's
 * artifact-URL-keyed BCH compiler cache, plus `<draftDir>/.symbols` when the
 * draft has a prereq (Task 7's `--stage-symbols-dir` deposits compiled prereq
 * `.app` files there for the AL extension to pick up).
 *
 * Any failure - container not found, `docker inspect` unavailable, no
 * `artifactUrl` on the container - returns `[]`. This is deliberate, not
 * best-effort: a WRONG symbol path produces editor errors ("could not find
 * symbol X") that directly contradict a green probe result, which is a worse
 * authoring experience than no IntelliSense at all. `renderWorkspace` reads
 * this as "omit `al.packageCachePath` entirely", never as "point at nothing".
 *
 * `inspectContainer` is imported dynamically (not at module top level)
 * because it is reached from CLI code that loads eagerly - see the module
 * doc. It is imported from `../container/docker-inspect.ts`, the actual
 * exported seam, rather than through `BcContainerProvider`: that class only
 * wraps the same call behind a *private* `dockerInspectSeam` method and does
 * not re-export it, so `docker-inspect.ts` is the one module that can answer
 * this without spinning up the much heavier container provider.
 * `compilerCacheKey` is a small pure helper (SHA-256 of a string) with no
 * container dependency of its own, so it is imported normally at the top of
 * this file.
 */
export async function resolveSymbolPaths(
  opts: { container: string; draftDir: string; hasPrereq: boolean },
): Promise<string[]> {
  try {
    const { inspectContainer } = await import(
      "../container/docker-inspect.ts"
    );
    const inspection = await inspectContainer(opts.container);
    if (!inspection?.artifactUrl) return [];

    const key = await compilerCacheKey(inspection.artifactUrl);
    const paths = [`${COMPILER_CACHE_ROOT}\\compiler-cache-${key}\\symbols`];
    if (opts.hasPrereq) {
      paths.push(join(opts.draftDir, ".symbols"));
    }
    return paths;
  } catch {
    // Any failure - docker not installed, container gone, inspect() thrown -
    // is "cannot resolve", never a guess. See the doc comment above.
    return [];
  }
}

/** Repo-relative segments (e.g. `["tasks", "hard"]`) resolved to a path relative to the draft dir, forward-slashed. */
function relFromDraft(
  ctx: WorkspaceContext,
  ...repoRelParts: string[]
): string {
  const absolute = join(ctx.repoRoot, ...repoRelParts);
  return relative(ctx.draftDir, absolute).replaceAll("\\", "/");
}

interface WorkspaceFolder {
  path: string;
  name: string;
}

/**
 * Draft-state folders: the draft root itself (for `task.yml`/`NOTES.md`),
 * then each AL project the draft owns. Paths are plain relative names - the
 * workspace file lives in `draftDir` itself, so no `relative()` computation
 * is needed here (contrast {@link promotedFolders}).
 */
function draftFolders(ctx: WorkspaceContext): WorkspaceFolder[] {
  const folders: WorkspaceFolder[] = [
    { path: ".", name: `${ctx.id} (draft)` },
    { path: "correct", name: "correct (oracle solution)" },
    { path: "naive", name: "naive (plausible-wrong)" },
  ];
  if (ctx.hasPrereq) {
    folders.push({ path: "prereq", name: "prereq" });
  }
  return folders;
}

/**
 * Promoted-state folders: the committed destinations plus the draft root
 * (still needed for `NOTES.md`/`CHECKLIST.md` - `promoteDraft` leaves those
 * behind as authoring history). Drops `correct`/`naive`: the oracle has moved
 * out of `correct/tests`, so that AL project no longer compiles as a
 * benchmark artifact. `correct/` and `naive/` still exist on disk (they hold
 * the solutions themselves, which never move), which is why the single-side
 * probe tasks below still run after promotion - see `buildProbeCommand` for
 * how they resolve the oracle without the file this folder list just dropped.
 *
 * Every path is repo-relative-from-the-draft-dir - the workspace file's own
 * directory never moves at promote time, only the files it points at do.
 */
function promotedFolders(ctx: WorkspaceContext): WorkspaceFolder[] {
  const difficulty = ctx.difficulty ?? "hard";
  const folders: WorkspaceFolder[] = [
    {
      path: relFromDraft(ctx, "tasks", difficulty),
      name: `tasks/${difficulty}`,
    },
    {
      path: relFromDraft(ctx, "tests", "al", difficulty),
      name: `tests/al/${difficulty}`,
    },
  ];
  if (ctx.hasPrereq) {
    folders.push({
      path: relFromDraft(ctx, "tests", "al", "dependencies", ctx.id),
      name: `tests/al/dependencies/${ctx.id}`,
    });
  }
  folders.push({
    path: relFromDraft(ctx, "site", "catalog"),
    name: "site/catalog",
  });
  folders.push({ path: ".", name: `${ctx.id} (notes)` });
  return folders;
}

interface WorkspaceTask {
  label: string;
  type: "shell";
  command: string;
  options: { cwd: string };
  /** Always `[]` - see `buildTasks`'s doc comment for why an empty array, not an omitted key. */
  problemMatcher: never[];
  group?: { kind: "build"; isDefault: boolean };
}

/**
 * Two entirely different argument shapes, branched on `ctx.state` - NOT a
 * cosmetic choice, and NOT interchangeable:
 *
 * - **Draft**: `--test-file scratch/<id>/correct/<id>.Test.al` plus
 *   `--test-codeunit-id`/`--prereq-dir`/`--stage-symbols-dir`, matching
 *   `probeDraft` (`src/workbench/probe.ts`) exactly - `promoteDraft` has not
 *   run yet, so none of a promoted task's committed files exist, and the
 *   oracle must be pointed at explicitly.
 * - **Promoted**: none of those four flags. `promoteDraft` MOVES
 *   `correct/<id>.Test.al` out to `tests/al/<difficulty>/<id>.Test.al`, so a
 *   draft-shaped command here would point `--test-file` at a file that no
 *   longer exists. The fix is not to recompute a new `--test-file` - it is to
 *   drop the flag entirely and fall back to `trap-probe`'s ORIGINAL
 *   `--task`-alone contract (`planProbe`'s `via: "task-id"` branch in
 *   `scripts/trap-probe.ts`): given just `--task <id>`, it resolves the
 *   oracle from `tests/al/<difficulty>/<id>.Test.al`, the codeunit id from
 *   `tasks/<difficulty>/<id>-*.yml`, and the prereq from
 *   `tests/al/dependencies/<id>/` by convention - exactly where promotion
 *   just put everything. `--solution scratch/<id>/<side>` still applies:
 *   those directories, and the solutions inside them, survive promotion.
 *
 * The four flags must be dropped TOGETHER, never individually: `planProbe`
 * explicitly REFUSES `--test-codeunit-id`/`--prereq-dir`/`--stage-symbols-dir`
 * without `--test-file` (`trap-probe.ts`'s `planProbe`, the `a.testFile ===
 * undefined` branch) rather than silently ignoring them - keeping any one in
 * a promoted command fails argument validation before a container is ever
 * touched.
 *
 * `--strict-fail-mode` is naive-only in both shapes, appended last.
 *
 * Everything is folded into one `command` string (not a separate `args[]`)
 * because every value here - the id, repo-relative paths, the container name
 * - is space-free, so there is no quoting to get wrong and a single string is
 * simplest to read straight out of `tasks.json`.
 */
function buildProbeCommand(
  ctx: WorkspaceContext,
  side: "correct" | "naive",
): string {
  const parts = [
    "deno run -A scripts/trap-probe.ts",
    `--task ${ctx.id}`,
    `--solution scratch/${ctx.id}/${side}`,
    `--expect ${side === "correct" ? "pass" : "fail"}`,
    `--container ${ctx.container}`,
  ];
  if (ctx.state === "draft") {
    const testFile = `scratch/${ctx.id}/correct/${ctx.id}.Test.al`;
    parts.push(`--test-file ${testFile}`);
    parts.push(`--test-codeunit-id ${ctx.testCodeunitId}`);
    if (ctx.hasPrereq) {
      parts.push(`--prereq-dir scratch/${ctx.id}/prereq`);
      parts.push(`--stage-symbols-dir scratch/${ctx.id}/.symbols`);
    }
  }
  if (side === "naive") {
    parts.push("--strict-fail-mode");
  }
  return parts.join(" ");
}

/**
 * The four always-present tasks, plus `sync taxonomy` once promoted.
 *
 * Every task sets `"problemMatcher": []`, never an omitted key. VS Code
 * prompts "Select for which kind of errors and warnings to scan the task
 * output" on every run of a shell task that carries no `problemMatcher` at
 * all - which would put a modal in front of the author on every single probe
 * run and defeat the one-keystroke workflow this workspace exists to give.
 * `[]` tells VS Code "I know, there genuinely is no matcher" and suppresses
 * that prompt. It is still functionally a no-op matcher: the probe reformats
 * compiler errors as `file(line,col): CODE - message` (no `error`/`warning`
 * keyword) against paths inside a staging directory deleted before the task
 * exits, so no PATTERN could ever match real output here - `[]` only
 * suppresses the prompt, it does not (and could not) add real problem
 * annotations.
 */
function buildTasks(ctx: WorkspaceContext): WorkspaceTask[] {
  const cwd = ctx.repoRoot;
  const tasks: WorkspaceTask[] = [
    {
      label: "probe",
      type: "shell",
      command: `deno task start task probe ${ctx.id}`,
      options: { cwd },
      problemMatcher: [],
      group: { kind: "build", isDefault: true },
    },
    {
      label: "probe: correct only",
      type: "shell",
      command: buildProbeCommand(ctx, "correct"),
      options: { cwd },
      problemMatcher: [],
    },
    {
      label: "probe: naive only",
      type: "shell",
      command: buildProbeCommand(ctx, "naive"),
      options: { cwd },
      problemMatcher: [],
    },
    {
      label: "promote",
      type: "shell",
      command: `deno task start task promote ${ctx.id} --difficulty ${
        ctx.difficulty ?? "hard"
      }`,
      options: { cwd },
      problemMatcher: [],
    },
  ];
  if (ctx.state === "promoted") {
    tasks.push({
      label: "sync taxonomy",
      type: "shell",
      command: "deno task start sync-taxonomy --apply",
      options: { cwd },
      problemMatcher: [],
    });
  }
  return tasks;
}

/**
 * Renders the `.code-workspace` JSON: folders (state-dependent), settings,
 * and the four-or-five VS Code tasks.
 */
export function renderWorkspace(ctx: WorkspaceContext): string {
  const folders = ctx.state === "draft"
    ? draftFolders(ctx)
    : promotedFolders(ctx);

  const settings: Record<string, unknown> = {
    // Hides the KNOWN CHILD DIRECTORIES under the draft root by name, so the
    // draft's own "." folder shows just task.yml/NOTES.md. This is NOT an
    // attempt to narrow any folder down to a single visible file - see the
    // module doc for why that is impossible (`files.exclude` has no
    // negation and is resource-scoped, so this one value applies to every
    // folder in the workspace, including correct/naive/prereq themselves,
    // where it is a harmless no-op since none of those directories contain
    // a same-named child).
    "files.exclude": {
      "correct": true,
      "naive": true,
      "prereq": true,
      ".symbols": true,
      ".meta.json": true,
      ".probe.json": true,
    },
    // Compiled/staged output, never source - keeps search results and the
    // file watcher from churning on generated .app artifacts.
    "search.exclude": { "**/.alpackages": true, "**/output": true },
    "files.watcherExclude": { "**/.alpackages": true, "**/output": true },
    // No al.codeAnalyzers: trap tasks deliberately contain unusual
    // constructs (that is the point of a trap), so CodeCop/UICop warnings
    // here would be noise, not signal.
    //
    // al.packageCachePath is added below, conditionally - see resolveSymbolPaths.
  };
  if (ctx.symbolPaths.length > 0) {
    settings["al.packageCachePath"] = ctx.symbolPaths;
  }

  const workspace = {
    folders,
    settings,
    tasks: { version: "2.0.0", tasks: buildTasks(ctx) },
  };

  return JSON.stringify(workspace, null, 2) + "\n";
}

/**
 * Renders `CHECKLIST.md`: every file the draft (or, once promoted, the
 * committed task) spans, the reserved `<id>.` prefix rule, the prereq
 * chicken-and-egg note when there is a prereq, and the two single-side-task
 * caveats.
 */
export function renderChecklist(ctx: WorkspaceContext): string {
  const lines: string[] = [`# Checklist - ${ctx.id}`, ""];

  lines.push("## Files this draft spans", "");
  lines.push(`- [task.yml](task.yml) - description, metadata, expected block.`);
  lines.push(
    `- [correct/${ctx.id}.Test.al](correct/${ctx.id}.Test.al) - the oracle test codeunit.`,
  );
  lines.push(
    `- [correct/app.json](correct/app.json) - the correct-side AL project manifest.`,
  );
  lines.push(`- naive/*.al - the plausible-wrong reference solution.`);
  lines.push(
    `- [naive/app.json](naive/app.json) - the naive-side AL project manifest.`,
  );
  if (ctx.hasPrereq) {
    lines.push(
      `- [prereq/app.json](prereq/app.json) - the prereq object definitions.`,
    );
  }
  lines.push(`- [NOTES.md](NOTES.md) - the trap rationale.`);
  lines.push("");

  lines.push(
    `**Reserved prefix.** Inside \`correct/\`, files starting with ` +
      `\`${ctx.id}.\` are ORACLE-SIDE: the probe injects them into both the ` +
      `correct and the naive run. Solution files must not use the ` +
      `\`${ctx.id}.\` prefix - one that does gets copied into the naive run ` +
      `too and makes a task that tests nothing look like it discriminates.`,
  );
  lines.push("");

  if (ctx.hasPrereq) {
    lines.push(
      `**Prereq symbols.** Before the first probe, prereq references are ` +
        `unresolved - there is nothing yet for the AL extension to resolve ` +
        `them against. Run one probe (pass or fail, either discriminates ` +
        `the point) to compile the prereq and light up symbols for the editor.`,
    );
    lines.push("");
  }

  if (ctx.state === "draft") {
    lines.push(
      `**Single-side task limits.** \`probe: correct only\` and ` +
        `\`probe: naive only\` bake in \`--test-codeunit-id\`, \`--container\` ` +
        `and prereq presence at generation time - re-run \`new\`/regenerate ` +
        `this workspace if any of those change. They also never write ` +
        `\`.probe.json\`, so only the full \`probe\` task produces a verdict ` +
        `that can satisfy the promote gate.`,
    );
  } else {
    lines.push(
      `**Single-side task limits.** Once promoted, \`probe: correct only\` ` +
        `and \`probe: naive only\` drop \`--test-file\`, \`--test-codeunit-id\`, ` +
        `\`--prereq-dir\` and \`--stage-symbols-dir\` entirely and resolve the ` +
        `oracle, codeunit id and prereq from the committed \`tasks/\`/` +
        `\`tests/al/\` tree via \`--task\` alone - only \`--container\` stays ` +
        `baked in. They still never write \`.probe.json\`, so only the full ` +
        `\`probe\` task produces a verdict that can satisfy the promote gate.`,
    );
  }

  if (ctx.state === "promoted") {
    const difficulty = ctx.difficulty ?? "hard";
    lines.push("", "## Files this task spans (committed)", "");
    lines.push(
      `- [../../tasks/${difficulty}/${ctx.id}-${ctx.slug}.yml](../../tasks/${difficulty}/${ctx.id}-${ctx.slug}.yml) - the committed task manifest.`,
    );
    lines.push(
      `- [../../tests/al/${difficulty}/${ctx.id}.Test.al](../../tests/al/${difficulty}/${ctx.id}.Test.al) - the committed oracle test codeunit.`,
    );
    if (ctx.hasPrereq) {
      lines.push(
        `- [../../tests/al/dependencies/${ctx.id}/app.json](../../tests/al/dependencies/${ctx.id}/app.json) - the committed prereq.`,
      );
    }
    lines.push(
      `- [../../site/catalog/task-categories.yml](../../site/catalog/task-categories.yml) - ` +
        `run the \`sync taxonomy\` task after adding a group/tags for this task.`,
    );
    lines.push(
      "",
      `\`correct/\`, \`naive/\`, \`NOTES.md\`, \`.meta.json\` and \`.probe.json\` ` +
        `remain under \`scratch/${ctx.id}/\` as authoring history - they are ` +
        `no longer part of the benchmark suite.`,
    );
  }

  return lines.join("\n") + "\n";
}

/** Writes both `<id>.code-workspace` and `CHECKLIST.md` into `ctx.draftDir`. */
export async function writeWorkspace(ctx: WorkspaceContext): Promise<void> {
  await Deno.writeTextFile(
    join(ctx.draftDir, `${ctx.id}.code-workspace`),
    renderWorkspace(ctx),
  );
  await Deno.writeTextFile(
    join(ctx.draftDir, "CHECKLIST.md"),
    renderChecklist(ctx),
  );
}
