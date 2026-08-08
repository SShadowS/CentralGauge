/**
 * `centralgauge task <subcommand>` — task workbench CLI surface.
 *
 * Phase 1 of the task workbench is the three-step authoring loop, and
 * nothing reaches the scored suite without passing through all three:
 *
 * - `task new` scaffolds a draft trap-task under `scratch/<id>/` via
 *   `src/workbench/scaffold.ts`'s `scaffoldDraft`. Everything it writes -
 *   including a `--with-prereq` app - stays in `scratch/`, outside the
 *   `task_sets` hash scope.
 * - `task probe` runs the discrimination gate via `src/workbench/probe.ts`'s
 *   `probeDraft`: `correct/` must pass the draft's own oracle and `naive/`
 *   must fail it, and the verdict is cached at `scratch/<id>/.probe.json`.
 * - `task promote` moves the draft into `tasks/` and `tests/al/` via
 *   `src/workbench/promote.ts`'s `promoteDraft`, refusing on a
 *   non-discriminating or stale verdict, and refusing outright (no
 *   `--force`) when any destination path is occupied. Promoting changes
 *   `task_sets.hash`, so the command says so.
 *
 * This module is deliberately thin — all draft-generation, probe and
 * promote logic, INCLUDING `--id` format validation and the
 * already-taken-id check, lives in `src/workbench/` (see `scaffoldDraft`'s
 * own `CG-AL-X<digits>` check), so a later Phase 2 UI panel gets the same
 * guarantees calling those functions directly as it would going through
 * `runTaskNew` / `runTaskProbe` / `runTaskPromote` here. This layer does
 * not duplicate that validation — a second regex here could drift from the
 * workbench's, silently reopening the id-collision hole `scaffoldDraft`
 * closes.
 *
 * @module cli/commands/task
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import { join, relative } from "@std/path";

import type { IdRoots } from "../../src/workbench/ids.ts";
import type { DraftMeta } from "../../src/workbench/scaffold.ts";
import type {
  ProbeOutcome,
  ProbeRunner,
  ProbeVerdict,
} from "../../src/workbench/probe.ts";
import type {
  PromoteDifficulty,
  PromoteResult,
} from "../../src/workbench/promote.ts";
import { scaffoldDraft } from "../../src/workbench/scaffold.ts";
import { probeDraft } from "../../src/workbench/probe.ts";
import { promoteDraft } from "../../src/workbench/promote.ts";

/** Repo-layout roots for the workbench, resolved relative to the process cwd. */
function defaultRoots(): IdRoots {
  const cwd = Deno.cwd();
  return {
    tasksDir: join(cwd, "tasks"),
    testsDir: join(cwd, "tests", "al"),
    scratchDir: join(cwd, "scratch"),
  };
}

export interface TaskNewOptions {
  slug: string;
  id?: string;
  withPrereq?: boolean;
  /** Override for tests; defaults to the real repo tree under `Deno.cwd()`. */
  roots?: IdRoots;
}

/**
 * Scaffolds a new draft and prints the created tree plus the exact next
 * command, so the authoring loop is discoverable from its own output.
 *
 * Exported separately from the Cliffy wiring below so it can be unit
 * tested directly against a temp tree. Driving Cliffy's own argument
 * parsing in a unit test would just be re-testing the framework.
 *
 * Deliberately does NOT re-validate `opts.slug`/`opts.id` itself:
 * `scaffoldDraft` rejects a malformed slug, a non-`CG-AL-X<digits>` id, and
 * an id already taken by a committed task, a committed test codeunit or
 * another draft — all before any side effects (no directories, no
 * allocation), so a second check here would only add a regex that could
 * drift out of sync with the one that actually matters. `meta.id` is the
 * NORMALISED id (`--id CG-AL-X52` scaffolds `CG-AL-X052`), which is why the
 * created path is printed from it rather than from `opts.id`.
 */
export async function runTaskNew(opts: TaskNewOptions): Promise<DraftMeta> {
  const roots = opts.roots ?? defaultRoots();
  const meta = await scaffoldDraft({
    ...(opts.id !== undefined ? { id: opts.id } : {}),
    slug: opts.slug,
    ...(opts.withPrereq !== undefined ? { withPrereq: opts.withPrereq } : {}),
    roots,
  });

  const draftDir = join(roots.scratchDir, meta.id);
  // Repo-relative paths are conventionally forward-slashed throughout this
  // codebase's docs and manifests (e.g. `tests/al/hard/...`) even on
  // Windows, so normalize the display path to match.
  const displayPath = relative(Deno.cwd(), draftDir).replaceAll("\\", "/");

  console.log(
    colors.green("[OK]") +
      ` Created draft ${meta.id} (test codeunit ${meta.testCodeunitId})`,
  );
  console.log(`     ${displayPath}/`);
  console.log(
    "Next: fill in task.yml + the oracle, put a working solution in correct/",
  );
  console.log(
    "      and a plausible-wrong one in naive/, then:",
  );
  console.log(`      centralgauge task probe ${meta.id}`);

  return meta;
}

export interface TaskProbeOptions {
  id: string;
  container?: string;
  /** Override for tests; defaults to `scratch/` under the real repo tree. */
  scratchDir?: string;
  /** Override for tests; defaults to `probeDraft`'s real subprocess runner. */
  runner?: ProbeRunner;
  /**
   * Declares a compile-earned naive failure to be the real trap. Threaded
   * through to `probeDraft`, which persists it into `.probe.json` so the
   * promote gate can surface it.
   */
  allowCompileFail?: boolean;
}

/** `pass` green, `fail` red, `compile_fail`/`inconclusive` yellow — matches `trap-probe.ts`'s own coloring. */
function formatOutcome(outcome: ProbeOutcome): string {
  switch (outcome) {
    case "pass":
      return colors.green(outcome);
    case "fail":
      return colors.red(outcome);
    case "compile_fail":
      return colors.yellow(outcome);
    case "inconclusive":
      return colors.yellow(outcome);
  }
}

/**
 * Exit code the `probe` action passes to `Deno.exit`:
 * `0` discriminates, `3` inconclusive (re-run, do not edit), `5` a
 * compile-earned naive failure (fix the layout, or re-run with
 * `--allow-compile-fail` if the trap really is a compile error), `1`
 * otherwise.
 *
 * Pure (no `Deno.exit` of its own) so it's unit-testable without process
 * teardown — mirrors `status-command.ts`'s `emitActionError` pattern.
 */
export function probeExitCode(verdict: ProbeVerdict): number {
  if (verdict.discriminates) return 0;
  if (verdict.correct === "inconclusive" || verdict.naive === "inconclusive") {
    return 3;
  }
  if (verdict.naive === "compile_fail") return 5;
  return 1;
}

/**
 * Runs the discrimination probe for `scratch/<id>/` and prints both sides
 * plus, when it does not discriminate, which side failed and what that
 * means — a naive solution that passes is a task that tests nothing.
 *
 * Exported separately from the Cliffy wiring below (mirrors `runTaskNew`)
 * so tests drive it directly instead of Cliffy parsing, and so a later
 * Phase 2 panel can call it without going through Cliffy at all.
 */
export async function runTaskProbe(
  opts: TaskProbeOptions,
): Promise<ProbeVerdict> {
  const scratchDir = opts.scratchDir ?? defaultRoots().scratchDir;
  const verdict = await probeDraft(opts.id, {
    scratchDir,
    ...(opts.container !== undefined ? { container: opts.container } : {}),
    ...(opts.runner !== undefined ? { runner: opts.runner } : {}),
    ...(opts.allowCompileFail !== undefined
      ? { allowCompileFail: opts.allowCompileFail }
      : {}),
  });

  console.log(
    `${opts.id}: correct=${formatOutcome(verdict.correct)} naive=${
      formatOutcome(verdict.naive)
    }`,
  );

  if (verdict.discriminates) {
    console.log(
      colors.green("[OK]") + " Discriminates — correct/ passes, naive/ fails.",
    );
    return verdict;
  }

  if (verdict.correct === "inconclusive" || verdict.naive === "inconclusive") {
    console.log(
      colors.yellow("[INCONCLUSIVE]") +
        " Infra trouble, not a real result — re-run rather than edit the task.",
    );
    return verdict;
  }

  if (verdict.correct !== "pass") {
    console.log(
      colors.red("[FAIL]") +
        " correct/ did not pass its own oracle — fix the reference solution" +
        " or the test it's meant to satisfy.",
    );
  }
  if (verdict.naive === "compile_fail" && !verdict.allowCompileFail) {
    console.log(
      colors.red("[FAIL]") +
        " naive/ failed to COMPILE rather than failing its assertions." +
        " That is not discrimination — it usually means a solution file in" +
        ' correct/ carries the reserved "' + opts.id + '." prefix and was' +
        " injected into the naive run, or that the oracle references a" +
        " helper that only correct/ has. Fix the layout, or re-run with" +
        " --allow-compile-fail if this trap genuinely is about a compile" +
        " error.",
    );
    return verdict;
  }
  if (verdict.naive !== "fail") {
    console.log(
      colors.red("[FAIL]") +
        " naive/ passed — this task does not discriminate and tests" +
        " nothing. Strengthen the oracle, or pick a naive solution that" +
        " actually diverges from correct/.",
    );
  }

  return verdict;
}

export interface TaskPromoteOptions {
  id: string;
  difficulty: PromoteDifficulty;
  slug?: string;
  force?: boolean;
  /** Override for tests; defaults to the real repo tree under `Deno.cwd()`. */
  roots?: IdRoots;
}

/**
 * Reads the verdict a prior `centralgauge task probe` run cached at
 * `scratch/<id>/.probe.json`, or `undefined` if none exists.
 */
async function readCachedVerdict(
  scratchDir: string,
  id: string,
): Promise<ProbeVerdict | undefined> {
  try {
    const raw = await Deno.readTextFile(
      join(scratchDir, id, ".probe.json"),
    );
    return JSON.parse(raw) as ProbeVerdict;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Promotes `scratch/<id>/` into the committed suite.
 *
 * Deliberately does NOT run a fresh probe itself: it reads the verdict a
 * prior `task probe` cached at `scratch/<id>/.probe.json`, so `task
 * promote` never silently spawns a multi-minute container operation.
 * Missing that cache, `promoteDraft` refuses on its own (naming `task
 * probe`) unless `--force` is given — this function does not paper over
 * that refusal.
 *
 * Exported separately from the Cliffy wiring below (mirrors `runTaskNew` /
 * `runTaskProbe`) so tests drive it directly instead of Cliffy parsing, and
 * so a later Phase 2 panel can call it without going through Cliffy at all.
 */
export async function runTaskPromote(
  opts: TaskPromoteOptions,
): Promise<PromoteResult> {
  const roots = opts.roots ?? defaultRoots();
  const verdict = await readCachedVerdict(roots.scratchDir, opts.id);

  const result = await promoteDraft(opts.id, {
    difficulty: opts.difficulty,
    roots,
    ...(opts.slug !== undefined ? { slug: opts.slug } : {}),
    ...(opts.force !== undefined ? { force: opts.force } : {}),
    ...(verdict !== undefined ? { verdict } : {}),
  });

  if (result.forced) {
    console.log(
      colors.yellow("[FORCED]") +
        ` Promoted ${opts.id} despite the probe gate — verify the` +
        " result by hand.",
    );
  }

  const okPrefix = `[OK] Promoted ${opts.id} -> `;
  const okIndent = " ".repeat(okPrefix.length);
  console.log(
    colors.green("[OK]") + okPrefix.slice("[OK]".length) + result.movedTask,
  );
  console.log(okIndent + result.movedTest);
  if (result.movedPrereq) {
    console.log(okIndent + result.movedPrereq);
  }

  const bangIndent = " ".repeat("[!]  ".length);
  console.log(
    colors.yellow("[!]") +
      "  task_sets hash changed. Models benched under the previous hash" +
      " are not",
  );
  console.log(
    bangIndent +
      "comparable until re-benched. See CLAUDE.md's \"Task-set hash" +
      ' scope" note,',
  );
  console.log(bangIndent + "or run the /rebench-after-task-change skill.");

  return result;
}

export function registerTaskCommand(cli: Command): void {
  const parent = new Command().description(
    "Author new benchmark trap-tasks (workbench).",
  );

  parent
    .command("new", "Scaffold a new draft trap-task under scratch/<id>/")
    .option("--slug <slug:string>", "Kebab-case slug for the draft", {
      required: true,
    })
    .option(
      "--id <id:string>",
      "Explicit CG-AL-X### id to use instead of the next free one " +
        "(refused if already taken; padded to 3 digits)",
    )
    .option(
      "--with-prereq",
      "Also scaffold a scratch/<id>/prereq/ app — promote moves it to " +
        "tests/al/dependencies/<id>/",
      { default: false },
    )
    .action(async (opts) => {
      await runTaskNew({
        slug: opts.slug,
        ...(opts.id !== undefined ? { id: opts.id } : {}),
        withPrereq: opts.withPrereq,
      });
    });

  parent
    .command(
      "probe",
      "Run the discrimination probe: correct/ must pass, naive/ must fail",
    )
    .arguments("<id:string>")
    .option(
      "--container <container:string>",
      "BC container to probe against (default: Cronus28 — the only one " +
        "with credentials wired for trap-probe)",
    )
    .option(
      "--allow-compile-fail",
      "Accept a naive/ that fails to COMPILE (rather than failing its " +
        "assertions) as real discrimination",
      { default: false },
    )
    .action(async (opts, id) => {
      const verdict = await runTaskProbe({
        id,
        ...(opts.container !== undefined ? { container: opts.container } : {}),
        allowCompileFail: opts.allowCompileFail,
      });
      Deno.exit(probeExitCode(verdict));
    });

  parent
    .command(
      "promote",
      "Promote a discriminating draft from scratch/<id>/ into the suite",
    )
    .arguments("<id:string>")
    .option(
      "--difficulty <difficulty:string>",
      "Target difficulty: easy, medium, or hard",
      { required: true },
    )
    .option(
      "--slug <slug:string>",
      "Override the slug recorded in scratch/<id>/.meta.json",
    )
    .option(
      "--force",
      "Skip the probe gate — cannot skip the target-already-exists check",
      { default: false },
    )
    .action(async (opts, id) => {
      const { difficulty } = opts;
      if (
        difficulty !== "easy" && difficulty !== "medium" &&
        difficulty !== "hard"
      ) {
        console.error(
          colors.red("[FAIL]") +
            ` --difficulty must be easy, medium, or hard (got "${difficulty}")`,
        );
        Deno.exit(1);
      }
      await runTaskPromote({
        id,
        difficulty,
        ...(opts.slug !== undefined ? { slug: opts.slug } : {}),
        force: opts.force,
      });
    });

  // deno-lint-ignore no-explicit-any
  (cli as any).command("task", parent);
}
