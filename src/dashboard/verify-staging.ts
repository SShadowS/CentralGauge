/**
 * Stages one model response as a compilable AL project directory.
 *
 * `handleAlVerify` (`mcp/al-tools-server.ts:1210`) treats `projectDir` and
 * `testFile` as SOURCES: it copies AL source files out of `projectDir`
 * (`copyAlFilesToDir`) and the test file it names (`copyTestFile`) into its
 * OWN throwaway verify directory, then compiles and publishes from there. It
 * never compiles `projectDir` directly. So staging here only needs to
 * produce a directory `handleAlVerify` can read from — the oracle stays
 * wherever the draft already keeps it
 * (`<draftDir>/correct/<taskId>.Test.al`); this module reports that path as
 * `testFile` rather than copying it into `projectDir`.
 *
 * The response's code is written to `<projectDir>/<taskId>.al`, matching
 * what the bench itself writes and compiles
 * (`src/parallel/compile-queue.ts`, `codeFileName =
 * \`${item.context.manifest.id}.al\``) — ONE file holding every object the
 * response contains, not one file per object. A model response for a task
 * with several objects (a table plus a page, say) is exactly what the bench
 * would extract into that single file, so staging anything else would
 * verify against code the bench never actually produces.
 *
 * `prereqDir` is the host-side escape hatch documented in
 * `.claude/rules/prereq-apps.md`: it lets an UNPROMOTED draft compile
 * against the prereq still sitting in `scratch/<id>/prereq/`, which has no
 * committed home under `tests/al/dependencies/` yet. It is deliberately NOT
 * exposed on the `al_verify` MCP tool, because a sandboxed agent must not be
 * able to name a host directory to compile and publish — but this module
 * runs host-side and loopback-only, so surfacing it here is correct.
 *
 * Callers (the dashboard's verify flow, Task 4) typically source `code`
 * from a `ModelResponse.resolution.cleanedCode`
 * (`src/dashboard/run-manager.ts` — "what the bench writes to `<taskId>.al`
 * and compiles") and `draftDir`/`taskId` from a `DraftSummary.dir`/`.id`
 * (`src/dashboard/drafts.ts`).
 *
 * @module dashboard/verify-staging
 */

import { exists } from "@std/fs";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

import type { AppJson } from "../al/app-manifest.ts";
import {
  ensureTestCodeunitRange,
  ensureTestDependencies,
} from "../al/app-manifest.ts";
import { classifyOracleFiles } from "../workbench/oracle-files.ts";

/** Input to `stageResponse`. See the module doc for where callers typically
 *  source each field from. */
export interface StageResponseOptions {
  draftDir: string;
  taskId: string;
  /** The response's code, verbatim — written as-is to `<taskId>.al`. */
  code: string;
}

/** A response staged as a project `handleAlVerify` can compile and test. */
export interface StagedProject {
  /** Temp directory holding the staged `<taskId>.al` and `app.json`. */
  projectDir: string;
  /** The oracle's path, unmoved, inside `draftDir`. */
  testFile: string;
  /** `<draftDir>/prereq`, only when that directory exists. */
  prereqDir?: string;
  /** `task.yml`'s `expected.testCodeunitId`, when present. */
  testCodeunitId?: number;
  /** Removes ONLY `projectDir`. Never touches `draftDir` or its contents. */
  cleanup(): Promise<void>;
}

/**
 * Placeholder app id for the staged project. `handleAlVerify`'s
 * `prepareAppJsonForTesting` overwrites whatever id is here with the fixed
 * `BENCHMARK_APP_ID` regardless (`mcp/al-tools-server.ts`), so this only
 * needs to be a syntactically valid GUID — it is never derived from the
 * task id the way `renderSolutionAppJson` (`src/workbench/scaffold.ts`)
 * derives its per-side ids, which matters because that derivation only
 * accepts `CG-AL-X<NN>` shaped ids.
 */
const STAGED_APP_ID = "a1b2c3d4-5e6e-0000-0000-000000000001";

/**
 * Builds the `app.json` a staged project needs to compile. Shape copied
 * from `renderSolutionAppJson` (`src/workbench/scaffold.ts`, not exported)
 * rather than invented: same platform/application/runtime/idRanges/target/
 * features a `correct`/`naive` solution app.json carries. The
 * `ensureTestDependencies`/`ensureTestCodeunitRange` calls mirror that
 * function too, reusing the actual exported helpers
 * (`src/al/app-manifest.ts`) instead of re-deriving their effect — they are
 * idempotent, so `handleAlVerify`'s own later call to the same helpers
 * (inside `prepareAppJsonForTesting`) is harmless.
 */
function renderStagedAppJson(taskId: string): AppJson {
  const appJson: AppJson = {
    id: STAGED_APP_ID,
    name: `${taskId} staged response`,
    publisher: "CentralGauge",
    version: "1.0.0.0",
    platform: "28.0.0.0",
    application: "28.0.0.0",
    idRanges: [{ from: 70000, to: 79999 }],
    runtime: "17.0",
    target: "OnPrem",
    features: ["NoImplicitWith"],
  };
  ensureTestDependencies(appJson);
  ensureTestCodeunitRange(appJson);
  return appJson;
}

/**
 * Reads `task.yml`'s `expected.testCodeunitId`, tolerating a missing or
 * malformed file the same way `listDrafts` (`src/dashboard/drafts.ts`)
 * does: a draft still in progress should stage, just without this field.
 */
async function readTestCodeunitId(
  draftDir: string,
): Promise<number | undefined> {
  try {
    const content = await Deno.readTextFile(join(draftDir, "task.yml"));
    const parsed = (parseYaml(content) ?? {}) as Record<string, unknown>;
    const expected = parsed["expected"] as Record<string, unknown> | undefined;
    if (expected && typeof expected["testCodeunitId"] === "number") {
      return expected["testCodeunitId"];
    }
  } catch {
    // Missing or malformed task.yml - fall through to undefined.
  }
  return undefined;
}

/**
 * Stages `code` as a compilable AL project under a fresh temp directory,
 * resolving the draft's oracle and (when present) its prereq alongside it.
 *
 * Throws when `<draftDir>/correct/<taskId>.Test.al` does not exist: with no
 * oracle there is nothing to verify against, so staging a project for it
 * would be staging work no caller could ever score.
 *
 * Also throws `OracleFileError` when the draft's layout violates the
 * reserved-prefix rules `classifyOracleFiles`
 * (`src/workbench/oracle-files.ts`) enforces. That check is not optional
 * housekeeping here — it is what stops this module reporting a verdict
 * about code it never compiled. `handleAlVerify` copies `projectDir`'s AL
 * files into its own verify directory FIRST (`copyAlFilesToDir`) and then
 * copies every `<taskId>.`-prefixed `.al` file out of the ORACLE'S
 * directory on top of them (`copyCompanionTestFiles`, later write wins).
 * `stageResponse` writes the response to `<projectDir>/<taskId>.al`, and
 * `"CG-AL-X053.al".startsWith("CG-AL-X053.")` is `true` — so a draft
 * carrying `correct/<taskId>.al` (the author's own reference solution under
 * the bare task id) would overwrite the model's candidate in the verify
 * directory, and every response in the batch would be scored against the
 * author's correct answer and report "Passed first try" without the
 * model's code ever being compiled.
 *
 * `probeDraft` and `promoteDraft` both call `classifyOracleFiles` before
 * doing anything for exactly this reason; this module is the third
 * consumer of the same draft layout, and it serves the population that has
 * neither probed nor promoted yet. A legitimate companion
 * (`correct/<taskId>.Mock.al`) still stages — the classifier refuses only
 * what is unambiguously wrong.
 */
export async function stageResponse(
  opts: StageResponseOptions,
): Promise<StagedProject> {
  const testFile = join(opts.draftDir, "correct", `${opts.taskId}.Test.al`);
  if (!await exists(testFile)) {
    throw new Error(
      `No oracle for ${opts.taskId}: expected ${testFile} to exist`,
    );
  }

  // Filesystem reads only — never spawns container work, so it is safe as a
  // pre-flight check and cheap enough to repeat per attempt. Deliberately
  // NOT caught: `attemptOnce` (`verify-run.ts`) turns a throw into
  // `{state: "errored", message}`, which surfaces the refusal verbatim in
  // the author's column, which is the whole point.
  await classifyOracleFiles({ id: opts.taskId, draftDir: opts.draftDir });

  const projectDir = await Deno.makeTempDir({ prefix: "cg-stage-" });

  await Deno.writeTextFile(join(projectDir, `${opts.taskId}.al`), opts.code);
  await Deno.writeTextFile(
    join(projectDir, "app.json"),
    JSON.stringify(renderStagedAppJson(opts.taskId), null, 2) + "\n",
  );

  const prereqCandidate = join(opts.draftDir, "prereq");
  const prereqDir = await exists(prereqCandidate) ? prereqCandidate : undefined;
  const testCodeunitId = await readTestCodeunitId(opts.draftDir);

  // Idempotent: Task 5 stages twice (an attempt-1 project, then a second for
  // the fix attempt), so two cleanups run per verify with error paths
  // between them. A second call finding `projectDir` already gone must be a
  // no-op, not a `Deno.errors.NotFound` thrown out of a `finally` that would
  // mask whatever real error sent the caller there. Only `NotFound` is
  // swallowed - a permission or busy-file error still surfaces.
  const cleanup = async (): Promise<void> => {
    try {
      await Deno.remove(projectDir, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  };

  return {
    projectDir,
    testFile,
    ...(prereqDir !== undefined ? { prereqDir } : {}),
    ...(testCodeunitId !== undefined ? { testCodeunitId } : {}),
    cleanup,
  };
}
