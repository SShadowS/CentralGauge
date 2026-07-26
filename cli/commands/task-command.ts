/**
 * `centralgauge task <subcommand>` — task workbench CLI surface.
 *
 * Phase 1 of the task workbench: `task new` scaffolds a draft trap-task
 * under `scratch/<id>/` by wiring the Cliffy CLI directly to
 * `src/workbench/scaffold.ts`'s `scaffoldDraft`, and `task probe` runs the
 * discrimination probe via `src/workbench/probe.ts`'s `probeDraft`. This
 * module is deliberately thin — all draft-generation and probe logic,
 * INCLUDING `--id` format validation, lives in `src/workbench/` (see
 * `scaffoldDraft`'s own `CG-AL-X<digits>` check), so a later Phase 2 UI
 * panel gets the same guarantees calling `scaffoldDraft` / `probeDraft`
 * directly as it would going through `runTaskNew` / `runTaskProbe` here.
 * This layer does not duplicate that validation — a second regex here
 * could drift from the workbench's, silently reopening the id-collision
 * hole `scaffoldDraft` closes.
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
import { scaffoldDraft } from "../../src/workbench/scaffold.ts";
import { probeDraft } from "../../src/workbench/probe.ts";

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
 * `scaffoldDraft` rejects a malformed slug or a non-`CG-AL-X<digits>` id
 * before any side effects (no directories, no allocation), so a second
 * check here would only add a regex that could drift out of sync with the
 * one that actually matters.
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
}

/** `pass` green, `fail` red, `inconclusive` yellow — matches `trap-probe.ts`'s own coloring. */
function formatOutcome(outcome: ProbeOutcome): string {
  switch (outcome) {
    case "pass":
      return colors.green(outcome);
    case "fail":
      return colors.red(outcome);
    case "inconclusive":
      return colors.yellow(outcome);
  }
}

/**
 * Exit code the `probe` action passes to `Deno.exit`, mirroring the verdict:
 * `0` discriminates, `3` when either side is inconclusive (distinct from a
 * hard failure — `trap-probe` returns 3 for infra trouble, and an operator
 * seeing "inconclusive" needs to re-run, not edit the task), `1` otherwise.
 *
 * Pure (no `Deno.exit` of its own) so it's unit-testable without process
 * teardown — mirrors `status-command.ts`'s `emitActionError` pattern.
 */
export function probeExitCode(verdict: ProbeVerdict): number {
  if (verdict.discriminates) return 0;
  if (verdict.correct === "inconclusive" || verdict.naive === "inconclusive") {
    return 3;
  }
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
      "Explicit CG-AL-X### id to use instead of the next free one",
    )
    .option(
      "--with-prereq",
      "Also scaffold a tests/al/dependencies/<id>/ prereq app",
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
    .action(async (opts, id) => {
      const verdict = await runTaskProbe({
        id,
        ...(opts.container !== undefined ? { container: opts.container } : {}),
      });
      Deno.exit(probeExitCode(verdict));
    });

  // deno-lint-ignore no-explicit-any
  (cli as any).command("task", parent);
}
