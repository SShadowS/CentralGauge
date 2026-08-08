/**
 * Discrimination probe for the task workbench.
 *
 * A trap task is only worth shipping if a *correct* solution passes its
 * oracle and a *plausible-but-wrong* one fails it. `probeDraft` runs
 * `scripts/trap-probe.ts` against both `scratch/<id>/correct/` and
 * `scratch/<id>/naive/` and records whether the task actually discriminates
 * - the verdict `task promote` (a later workbench step) gates on.
 *
 * **The draft is probed by explicit oracle path, never by task id.** A
 * `--task <id>` invocation of `trap-probe` means "a COMMITTED task id": it
 * resolves the oracle to `tests/al/<difficulty>/<id>.Test.al` and the
 * codeunit id to `tasks/<difficulty>/<id>-*.yml`, both of which exist only
 * after `task promote` has run. A draft has neither, so an id-only probe
 * comes back "Test file not found" - a message `classifyProbeOutcome` scores
 * as a genuine `"fail"`, not `"inconclusive"`. That produced
 * `{correct: "fail", naive: "fail"}` for EVERY scaffolded draft, told the
 * operator to fix a reference solution that was never run, and left `--force`
 * (which skips the discrimination gate entirely) as the only way to promote.
 * So `probeDraft` passes `--test-file`, `--test-codeunit-id` and, when the
 * draft has one, `--prereq-dir`, pointing at the scratch-local files. The
 * oracle itself lives at `scratch/<id>/correct/<id>.Test.al` - inside the
 * reference solution's own directory, so the AL Language extension sees one
 * project containing solution + test.
 *
 * **Before any of that, `classifyOracleFiles` runs the layer-1 refusals.**
 * A draft whose `correct/`/`naive/` file layout would fake discrimination
 * (a bare `<id>.al` that would overwrite a model's submission, an
 * `<id>.*.al` in `naive/` that gets silently overwritten by the oracle-side
 * injection, or a missing oracle) is refused with `OracleFileError` before
 * any container work is spawned - such a draft's probe verdict would look
 * green and be meaningless.
 *
 * **The exit-code mapping below is the subtlest thing in this module.**
 * `trap-probe` exits `0` when the *actual* outcome matched the `--expect`
 * it was given, `1` when it did not, and `3` when the run was inconclusive
 * (infra trouble - never a real oracle result). `correct/` is probed with
 * `--expect pass`, so exit `0` there means it passed. `naive/` is probed
 * with `--expect fail`, so exit `0` there means it FAILED - exactly what a
 * discriminating task wants. Invert this and the gate admits precisely the
 * tasks it should reject, and every test of the *outcome* shape alone would
 * still look green - which is why `outcomeFromExitCode` is unit tested
 * directly against exit codes rather than only through `discriminates`.
 */

import { exists } from "@std/fs";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

import type { ProbeOutcome as RawProbeOutcome } from "../../scripts/trap-probe.ts";
import type { DraftMeta } from "./scaffold.ts";
import { classifyOracleFiles } from "./oracle-files.ts";

/**
 * Outcome of probing one side of a draft.
 *
 * `compile_fail` is a workbench-level distinction that `trap-probe` reports
 * via exit code 4 under `--strict-fail-mode`: the side failed, but because
 * it did not COMPILE rather than because its assertions failed.
 *
 * That distinction is the guard no filename rule can provide. A
 * plausible-but-wrong trap solution should compile and fail asserts. A naive
 * side that fails to compile is the signature of a misnamed solution
 * colliding with an injected oracle-side file, an oracle-referenced helper
 * present in correct/ and absent from naive/, or an unresolved symbol - each
 * of which produces a green verdict for a task that discriminates on
 * nothing.
 */
export type ProbeOutcome = RawProbeOutcome | "compile_fail";

/** Verdict recorded for one probe run, both returned and written to `.probe.json`. */
export interface ProbeVerdict {
  correct: ProbeOutcome;
  naive: ProbeOutcome;
  discriminates: boolean;
  at: string;
  /**
   * Set when the operator declared a compile-earned naive failure to be the
   * real trap. Persisted so the promote gate can surface it rather than
   * silently accepting a verdict that would otherwise be refused.
   */
  allowCompileFail?: boolean;
}

/**
 * Injection seam so nothing below the workbench's Phase-1 subcommands spawns
 * a real process. Every test in this file supplies a stub; only
 * {@link defaultRunner} (used when `opts.runner` is omitted) actually shells
 * out, and that path is exercised by the gated container smoke test, not by
 * unit tests.
 */
export type ProbeRunner = (args: string[]) => Promise<number>;

/**
 * The spec records Cronus28 as the only local container with credentials
 * wired for `trap-probe` (the others return 401 on the web-service port).
 */
const DEFAULT_CONTAINER = "Cronus28";

/**
 * Maps one `trap-probe` invocation's exit code, given the `--expect` value it
 * was called with, to the outcome of the solution actually probed.
 *
 * - `3` -> `"inconclusive"`, regardless of `expect` - infra trouble, not a
 *   real result, and must never be compared against the expectation.
 * - `4` -> `"compile_fail"` - only emitted under `--strict-fail-mode`, which
 *   this module passes on the naive run only.
 * - `0` -> the run matched `--expect`, so the actual outcome IS `expect`.
 * - anything else -> the actual outcome is the opposite of `expect`.
 */
function outcomeFromExitCode(
  expect: "pass" | "fail",
  exitCode: number,
): ProbeOutcome {
  if (exitCode === 3) return "inconclusive";
  if (exitCode === 4) return "compile_fail";
  if (exitCode === 0) return expect;
  return expect === "pass" ? "fail" : "pass";
}

/**
 * Default `ProbeRunner`: spawns `deno run -A scripts/trap-probe.ts <args>`
 * and returns its exit code. `args` already carries `--task`/`--solution`/
 * `--expect`/`--container` - this function only knows how to invoke the
 * script, never what to pass it.
 */
async function defaultRunner(args: string[]): Promise<number> {
  const command = new Deno.Command("deno", {
    args: ["run", "-A", "scripts/trap-probe.ts", ...args],
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await command.output();
  return code;
}

/**
 * The AL test codeunit id to filter the probe's test run by, resolved the
 * same way the bench will resolve it AFTER promotion.
 *
 * `task.yml`'s `expected.testCodeunitId` is preferred over `.meta.json`'s
 * copy on purpose: `loadTestCodeunitId` in `mcp/al-tools-server.ts` reads
 * exactly that field once the draft is promoted, and `task.yml` is the file
 * the operator is told to fill in - `.meta.json` is scaffold-time
 * bookkeeping they never touch. Probing the value the bench will not use
 * would let a hand-edited codeunit id pass the gate and then run zero tests
 * in a real bench.
 *
 * Returns `undefined` rather than throwing when neither file yields a usable
 * number; `trap-probe` then runs every test in the candidate app, which for a
 * single-codeunit draft is the same set.
 */
async function resolveDraftTestCodeunitId(
  draftDir: string,
): Promise<number | undefined> {
  try {
    const raw = await Deno.readTextFile(join(draftDir, "task.yml"));
    const parsed = parseYaml(raw) as
      | { expected?: { testCodeunitId?: unknown } }
      | undefined;
    const fromYaml = parsed?.expected?.testCodeunitId;
    if (typeof fromYaml === "number" && Number.isInteger(fromYaml)) {
      return fromYaml;
    }
  } catch {
    // Missing or unparseable task.yml - fall through to .meta.json.
  }

  try {
    const raw = await Deno.readTextFile(join(draftDir, ".meta.json"));
    const meta = JSON.parse(raw) as Partial<DraftMeta>;
    if (
      typeof meta.testCodeunitId === "number" &&
      Number.isInteger(meta.testCodeunitId)
    ) {
      return meta.testCodeunitId;
    }
  } catch {
    // No .meta.json either - the probe runs unfiltered.
  }

  return undefined;
}

/**
 * Runs the discrimination probe for `scratch/<id>/`: `correct/` against
 * `--expect pass`, `naive/` against `--expect fail`. Writes the verdict to
 * `scratch/<id>/.probe.json` (Task 5's promote gate and the Phase 2 panel
 * both read it without re-running the probe) and returns it.
 *
 * Throws, naming which, when `correct/` or `naive/` does not exist yet, and
 * throws `OracleFileError` (via `classifyOracleFiles`) when the
 * `correct/<id>.Test.al` oracle is missing or the draft's file layout would
 * fake discrimination - a draft that has not been filled in, or filled in
 * unsafely, is a different situation from one that genuinely does not
 * discriminate, and must not be silently scored as a failure.
 */
export async function probeDraft(
  id: string,
  opts: {
    scratchDir: string;
    container?: string;
    runner?: ProbeRunner;
    allowCompileFail?: boolean;
  },
): Promise<ProbeVerdict> {
  const draftDir = join(opts.scratchDir, id);
  const correctDir = join(draftDir, "correct");
  const naiveDir = join(draftDir, "naive");

  if (!(await exists(correctDir))) {
    throw new Error(
      `Draft ${id} is missing correct/ at ${correctDir} - the probe needs ` +
        `a reference solution that should pass before it can run.`,
    );
  }
  if (!(await exists(naiveDir))) {
    throw new Error(
      `Draft ${id} is missing naive/ at ${naiveDir} - the probe needs a ` +
        `plausible-wrong solution that should fail before it can run.`,
    );
  }

  // Layer-1 refusals. Runs BEFORE any container work: a draft whose file
  // layout would fake discrimination must never reach a probe run, because
  // its verdict would come back green and be meaningless.
  await classifyOracleFiles({ id, draftDir });

  const testFile = join(correctDir, `${id}.Test.al`);

  const container = opts.container ?? DEFAULT_CONTAINER;
  const runner = opts.runner ?? defaultRunner;

  const testCodeunitId = await resolveDraftTestCodeunitId(draftDir);
  const prereqDir = join(draftDir, "prereq");
  const hasPrereq = await exists(join(prereqDir, "app.json"));

  /**
   * Args common to both sides. `--test-file` (plus what would otherwise be
   * read out of the committed trees) is what makes this work on an
   * unpromoted draft at all - see the module doc.
   */
  const oracleArgs = [
    "--test-file",
    testFile,
    ...(testCodeunitId !== undefined
      ? ["--test-codeunit-id", String(testCodeunitId)]
      : []),
    ...(hasPrereq ? ["--prereq-dir", prereqDir] : []),
    // Both sides compile the prereq independently, so staging from either
    // invocation is valid; the flag just needs to be on both.
    ...(hasPrereq ? ["--stage-symbols-dir", join(draftDir, ".symbols")] : []),
  ];

  const correctExitCode = await runner([
    "--task",
    id,
    "--solution",
    correctDir,
    "--expect",
    "pass",
    "--container",
    container,
    ...oracleArgs,
  ]);
  const naiveExitCode = await runner([
    "--task",
    id,
    "--solution",
    naiveDir,
    "--expect",
    "fail",
    "--container",
    container,
    ...oracleArgs,
    // Naive only: a naive side must fail by not satisfying the oracle's
    // assertions, not by failing to compile - see the module doc.
    "--strict-fail-mode",
  ]);

  const correct = outcomeFromExitCode("pass", correctExitCode);
  const naive = outcomeFromExitCode("fail", naiveExitCode);

  const allowCompileFail = opts.allowCompileFail ?? false;
  const naiveDiscriminates = naive === "fail" ||
    (naive === "compile_fail" && allowCompileFail);

  const verdict: ProbeVerdict = {
    correct,
    naive,
    discriminates: correct === "pass" && naiveDiscriminates,
    at: new Date().toISOString(),
    ...(allowCompileFail ? { allowCompileFail: true } : {}),
  };

  await Deno.writeTextFile(
    join(draftDir, ".probe.json"),
    JSON.stringify(verdict, null, 2) + "\n",
  );

  return verdict;
}
