/**
 * Draft scaffolding for the task workbench.
 *
 * `scaffoldDraft` turns an allocated id + a human-chosen slug into a
 * `scratch/<id>/` tree ready for hand-authoring: a `task.yml` skeleton that
 * already parses through the real, strict task-manifest schema, an AL test
 * skeleton that CANNOT pass a probe until it is actually filled in, and the
 * `correct/` / `naive/` reference-solution directories the discrimination
 * probe (a later workbench step) expects.
 *
 * Two properties are load-bearing, both straight out of CLAUDE.md's rules
 * for authoring benchmark tasks:
 *
 * - The AL skeleton never contains a placeholder assertion
 *   (`Assert.IsTrue(true, ...)` always passes, which would let an unfinished
 *   oracle look green in a bench run). It instead contains an explicit
 *   `Assert.IsTrue(false, ...)` marker, so an unedited draft cannot pass a
 *   probe. `Assert.Fail` has zero precedent anywhere in `tests/al/` (149
 *   test files); `Assert.IsTrue` is used 550 times, so this is the verified
 *   choice, not an inferred one.
 * - The rendered description never contains a guiding note ("note:",
 *   "remember", "be careful", "do not forget"). The benchmark tests whether
 *   a model knows AL, not whether it can read a warning about the mistake
 *   the task exists to catch.
 */

import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";
import { stringify } from "@std/yaml";

import type { AppJson } from "../al/app-manifest.ts";
import type { IdRoots } from "./ids.ts";
import {
  ensurePrereqDependency,
  ensureTestCodeunitRange,
  ensureTestDependencies,
} from "../al/app-manifest.ts";
import { DRAFT_STARTER_DIRNAME } from "../tasks/starter-code.ts";
import { allocateTaskId, allocateTestCodeunitId, taskIdExists } from "./ids.ts";
import type { SymbolPathResolver } from "./workspace.ts";
import { resolveSymbolPaths, writeWorkspace } from "./workspace.ts";
import type { ImportedFrom } from "./import.ts";

/** Metadata recorded for a scaffolded draft, both returned and written to `.meta.json`. */
export interface DraftMeta {
  id: string;
  slug: string;
  testCodeunitId: number;
  createdAt: string;
  withPrereq: boolean;
  /** Present only for a draft re-imported from a promoted task via `importPromotedTask`. */
  importedFrom?: ImportedFrom;
}

/**
 * All drafts scaffolded by this workbench phase target `hard` - the
 * ado-trap-2026 cohort this tooling exists for is hand-authored trap tasks,
 * which are hard by construction. `expected.testApp` and `metadata.difficulty`
 * both key off this constant.
 */
const DRAFT_DIFFICULTY = "hard";

/**
 * Default BC container the generated workspace's symbol resolution and
 * single-side probe VS Code tasks target when `--container` is not given -
 * the only local container with credentials wired for `trap-probe`.
 * Mirrors `probe.ts`'s own (separately declared) `DEFAULT_CONTAINER`, whose
 * job is the actual probe run rather than the workspace it authors against.
 */
export const DEFAULT_PROBE_CONTAINER = "Cronus28";

/** Lowercase, hyphen-separated segments only - the slug becomes a filename at promote time. */
const KEBAB_CASE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * `X` only, not the manifest schema's `[EMHX]`: `src/workbench/ids.ts`
 * collision-tracks only `CG-AL-X###` (see its `TASK_ID_PATTERN`), so an
 * E/M/H id would sail through here without ever being collision-checked.
 * The workbench exists for the ado-trap-2026 X-series only.
 */
const TASK_ID_PATTERN = /^CG-AL-X[0-9]+$/;

/**
 * Folds every digit-width spelling of one id onto the 3-digit form
 * `allocateTaskId` hands out: `CG-AL-X52` and `CG-AL-X0052` both become
 * `CG-AL-X052`.
 *
 * Not cosmetic. `ids.ts` compares ids NUMERICALLY, so it already sees
 * `X52` and `X052` as the same task - but `promote.ts`'s `filenameMatchesId`
 * compares them as SUBSTRINGS, and "CG-AL-X52" does not occur in
 * "CG-AL-X052-day-close.yml". Left unnormalised, the two spellings collide
 * for allocation yet slip past the promote gate, shipping two manifests for
 * one task. Normalising at the only place an id enters the workbench closes
 * that gap at the source.
 */
function normalizeTaskId(id: string): string {
  const digits = /^CG-AL-X([0-9]+)$/.exec(id)?.[1];
  if (digits === undefined) {
    // Unreachable: callers validate against TASK_ID_PATTERN first.
    throw new Error(`Cannot normalize task id "${id}".`);
  }
  return `CG-AL-X${String(Number(digits)).padStart(3, "0")}`;
}

/**
 * Scaffolds a new trap-task draft under `roots.scratchDir/<id>/`.
 *
 * Refuses rather than overwrites when the target draft directory already
 * exists - that path is someone's in-progress work - and refuses an explicit
 * `--id` that any of the three roots has already spoken for.
 */
export async function scaffoldDraft(opts: {
  id?: string;
  slug: string;
  withPrereq?: boolean;
  /**
   * Scaffold a diagnose-task draft instead of a trap-task one: creates
   * `scratch/<id>/starter/` (the buggy starter application the model must
   * fix) instead of `naive/`, and points `task.yml` at `diagnose.md`. The
   * starter IS the naive side for this task shape - there is nothing else
   * to author into a separate directory.
   */
  diagnose?: boolean;
  /** BC container the generated workspace targets. Defaults to `DEFAULT_PROBE_CONTAINER`. */
  container?: string;
  roots: IdRoots;
  /**
   * Override for tests; defaults to the real `docker inspect` resolver. See
   * {@link SymbolPathResolver} - without this the unit suite would spawn one
   * `docker inspect` per scaffolded draft.
   */
  resolveSymbols?: SymbolPathResolver;
}): Promise<DraftMeta> {
  const { slug, roots } = opts;
  const withPrereq = opts.withPrereq ?? false;
  const diagnose = opts.diagnose ?? false;

  if (!KEBAB_CASE_PATTERN.test(slug)) {
    throw new Error(
      `Invalid slug "${slug}": must be kebab-case (lowercase letters, ` +
        `digits, and single hyphens, e.g. "day-close") - it becomes a filename.`,
    );
  }

  let id: string;
  if (opts.id === undefined) {
    // Already padded, and allocated as highest + 1 across all three roots,
    // so it is free by construction - no existence check needed.
    id = await allocateTaskId(roots);
  } else {
    if (!TASK_ID_PATTERN.test(opts.id)) {
      throw new Error(
        `Invalid id "${opts.id}": must match CG-AL-X<digits> - this ` +
          `workbench only collision-tracks the X-series (see ` +
          `src/workbench/ids.ts).`,
      );
    }
    id = normalizeTaskId(opts.id);
  }

  const draftDir = join(roots.scratchDir, id);

  if (await exists(draftDir)) {
    throw new Error(
      `Draft already exists at ${draftDir} - refusing to overwrite ` +
        `in-progress work.`,
    );
  }

  // Only for an explicit --id: an id already spoken for by a committed task,
  // a committed test codeunit, or another draft would otherwise scaffold
  // happily, burn a test-codeunit-id allocation, and only be caught at
  // promote - after the draft has been authored against it.
  if (opts.id !== undefined && await taskIdExists(id, roots)) {
    throw new Error(
      `Task id ${id} is already in use (a task manifest, test codeunit or ` +
        `draft for it exists under ${roots.tasksDir}, ${roots.testsDir} or ` +
        `${roots.scratchDir}) - omit --id to allocate the next free one.`,
    );
  }

  const testCodeunitId = await allocateTestCodeunitId(roots);
  const createdAt = new Date().toISOString();

  await ensureDir(join(draftDir, "correct"));
  if (diagnose) {
    await ensureDir(join(draftDir, DRAFT_STARTER_DIRNAME));
  } else {
    await ensureDir(join(draftDir, "naive"));
  }

  let prereqAppJson: AppJson | undefined;
  if (withPrereq) {
    // Scratch-local (scratch/<id>/prereq/), NOT roots.testsDir/dependencies/
    // - src/ingest/catalog/task-set-hash.ts hashes every file under
    // tests/al/** with no .gitignore awareness, so writing directly into
    // the committed tree here would stamp a fresh task_sets hash for every
    // subsequent bench on this machine before the task is ever promoted,
    // silently splitting unrelated runs (any model, any task) onto a hash
    // no clean checkout can reproduce. promoteDraft (src/workbench/
    // promote.ts) moves this directory to its final
    // tests/al/dependencies/<id>/ location at promote time.
    const prereqDir = join(draftDir, "prereq");
    await ensureDir(prereqDir);
    const prereqText = renderPrereqAppJson(id);
    await Deno.writeTextFile(join(prereqDir, "app.json"), prereqText);
    prereqAppJson = JSON.parse(prereqText) as AppJson;
  }

  await Deno.writeTextFile(
    join(draftDir, "task.yml"),
    renderTaskYaml(id, testCodeunitId, diagnose),
  );
  await Deno.writeTextFile(
    join(draftDir, "correct", `${id}.Test.al`),
    renderAlSkeleton(id, testCodeunitId),
  );
  await Deno.writeTextFile(
    join(draftDir, "correct", "app.json"),
    renderSolutionAppJson(id, "correct", prereqAppJson),
  );
  if (!diagnose) {
    await Deno.writeTextFile(
      join(draftDir, "naive", "app.json"),
      renderSolutionAppJson(id, "naive", prereqAppJson),
    );
  }
  await Deno.writeTextFile(join(draftDir, "NOTES.md"), renderNotes(id, slug));

  const meta: DraftMeta = { id, slug, testCodeunitId, createdAt, withPrereq };
  await Deno.writeTextFile(
    join(draftDir, ".meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
  );

  // Symbol resolution is best-effort. A container that is down at scaffold
  // time must not block authoring - the workspace is written without
  // al.packageCachePath and `task probe` refreshes it on the next run.
  const symbolPaths = await (opts.resolveSymbols ?? resolveSymbolPaths)({
    container: opts.container ?? DEFAULT_PROBE_CONTAINER,
    draftDir,
    hasPrereq: withPrereq,
  });
  await writeWorkspace({
    id,
    slug,
    draftDir,
    repoRoot: Deno.cwd(),
    hasPrereq: withPrereq,
    diagnose,
    testCodeunitId,
    container: opts.container ?? DEFAULT_PROBE_CONTAINER,
    symbolPaths,
    state: "draft",
  });

  return meta;
}

/**
 * Renders `task.yml` via `@std/yaml` `stringify` against a plain object
 * matching `TaskManifestSchema` exactly - the schema is `.strict()`, so a
 * stray key would fail to parse just as loudly as a missing one.
 */
function renderTaskYaml(
  id: string,
  testCodeunitId: number,
  diagnose: boolean,
): string {
  const manifest = {
    id,
    prompt_template: diagnose ? "diagnose.md" : "code-gen.md",
    fix_template: "bugfix.md",
    max_attempts: 2,
    description: "TODO: state what to build. Describe WHAT, never HOW, " +
      "and never warn about the mistake this task exists to catch.",
    domains: ["codeunits"],
    metrics: [] as string[],
    metadata: {
      category: "TODO",
      tags: [] as string[],
      difficulty: DRAFT_DIFFICULTY,
      cohort: "ado-trap-2026",
      origin: "hand-authored",
    },
    expected: {
      compile: true,
      testApp: `tests/al/${DRAFT_DIFFICULTY}/${id}.Test.al`,
      testCodeunitId,
    },
  };
  // lineWidth: -1 means "no wrap limit" in js-yaml's stringifier. 0 is NOT
  // "unlimited" - it means "wrap after zero characters", which forces every
  // scalar (including short ones like the id) into folded block style.
  // Omitting the option entirely (default ~80) would also dodge the 0 bug
  // and only fold the long description - -1 is a deliberate choice to
  // unfold every field instead, so short values like `id` stay plain.
  return stringify(manifest, { lineWidth: -1 });
}

/**
 * Renders the AL test skeleton. Deliberately fails until edited: the only
 * assertion is `Assert.IsTrue(false, ...)`, which always fails without ever
 * writing the placeholder-tautology shape (`Assert.IsTrue(true, ...)`) that
 * would let an unfinished oracle pass. `Assert.IsTrue` is used 550 times
 * across `tests/al/`; `Assert.Fail` has zero precedent there, so `IsTrue`
 * is the verified choice for a marker this load-bearing.
 */
function renderAlSkeleton(id: string, testCodeunitId: number): string {
  return `codeunit ${testCodeunitId} "${id} Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestTrap()
    begin
        // TODO: seed the state that exposes the trap, invoke the object
        // under test, and assert the specific value a naive-but-plausible
        // implementation gets wrong.
        Assert.IsTrue(false, 'TODO: assert the trap - this draft has not been filled in yet.');
    end;
}
`;
}

/** Prompts for the three things a reviewer needs to judge a trap task. */
function renderNotes(id: string, slug: string): string {
  return `# ${id} - ${slug}

## What is the trap?

TODO: describe the exact AL/BC runtime behavior a naive-but-plausible
implementation gets wrong.

## Why would a competent model plausibly miss it?

TODO: explain what about the platform's behavior is genuinely non-obvious -
not a typo, a real semantic gap.

## What does the naive solution do wrong?

TODO: describe the plausible-wrong implementation that will sit in \`naive/\`,
and the specific way it diverges from \`correct/\`.

## File naming

Files in \`correct/\` starting with \`${id}.\` are ORACLE-SIDE: the probe
injects them into both the correct and the naive run, and \`task promote\`
moves them to \`tests/al/<difficulty>/\`. Use that prefix for mocks, spies and
helper objects the test needs.

Your solution files must NOT start with \`${id}.\`. A solution that does gets
copied into the naive run too, collides there, and makes a task that tests
nothing look like it discriminates.
`;
}

/**
 * Fixed hex segments distinguishing the two solution projects' app ids.
 * `derivePrereqSuffix` already owns `0a<NN>`; these must not collide with it
 * or with each other, and both must be valid hex - an invalid GUID in
 * app.json fails to compile.
 */
const CORRECT_APP_SEGMENT = "0c";
const NAIVE_APP_SEGMENT = "0e";

/**
 * Renders the `app.json` for one solution directory.
 *
 * `al_verify` REQUIRES this file (`prepareAppJsonForTesting` is fatal at
 * `mcp/al-tools-server.ts:1323`), so its absence is why a freshly scaffolded
 * draft could not be probed at all before this existed. It also makes the
 * directory an AL project, which is what gives the author IntelliSense.
 *
 * The dependency and id-range shape comes from the same helpers the probe
 * applies at verify time, so the editor and the compiler agree. The `id` is
 * overwritten with `BENCHMARK_APP_ID` by the probe regardless - it only needs
 * to be stable and distinct per side.
 */
export function renderSolutionAppJson(
  id: string,
  side: "correct" | "naive",
  prereqAppJson?: AppJson,
): string {
  // `0c<NN>` / `0e<NN>` never collide with derivePrereqSuffix's `0a<NN>`,
  // and both are valid hex - `x` is not, which is why the task letter cannot
  // be used directly (see derivePrereqSuffix's own note).
  const segment = side === "correct" ? CORRECT_APP_SEGMENT : NAIVE_APP_SEGMENT;
  const digits = /^CG-AL-X(\d+)$/.exec(id)?.[1];
  if (digits === undefined) {
    throw new Error(`Cannot derive a solution app id from "${id}".`);
  }
  const value = Number(digits);
  if (value > 99) {
    // Same two-digit ceiling as derivePrereqSuffix, and for the same reason:
    // `segment` + the numeric part must total exactly 4 hex chars. Fail
    // loudly rather than emit a mis-sized GUID segment.
    throw new Error(
      `Solution app id derivation only supports two-digit X-ids (00-99); ` +
        `got "${id}". Extend the convention before scaffolding X100+.`,
    );
  }
  const twoDigit = String(value).padStart(2, "0");
  const tail = String(value).padStart(12, "0");

  const appJson: AppJson = {
    id: `a1b2c3d4-${segment}${twoDigit}-0000-0000-${tail}`,
    name: `${id} ${side}`,
    publisher: "CentralGauge",
    version: "1.0.0.0",
    platform: "28.0.0.0",
    application: "28.0.0.0",
    idRanges: [{ from: 70000, to: 79999 }],
    runtime: "17.0",
    target: "OnPrem",
    features: ["NoImplicitWith"],
  };

  ensureTestCodeunitRange(appJson);
  ensureTestDependencies(appJson);
  if (prereqAppJson) {
    ensurePrereqDependency(appJson, prereqAppJson);
  }

  return JSON.stringify(appJson, null, 2) + "\n";
}

/**
 * `CG-AL-X053` -> `0a53`, matching every committed X-series prereq
 * `app.json` (verified against all 30 committed files, e.g.
 * `tests/al/dependencies/CG-AL-X052/app.json`). NOT the literal lowercased
 * task letter - `x` is not a hex digit, so `a1b2c3d4-x053-...` (the
 * originally-briefed example) is not a valid GUID and would fail to
 * compile. `0a` is a fixed hex-safe stand-in; only the two-digit numeric
 * suffix varies.
 */
function derivePrereqSuffix(id: string): string {
  const match = /^CG-AL-X(\d+)$/.exec(id);
  const digits = match?.[1];
  if (!digits) {
    throw new Error(
      `Cannot derive a prereq GUID suffix from id "${id}" - expected ` +
        `CG-AL-X<digits>.`,
    );
  }
  // Task ids are zero-padded to (at least) 3 digits by allocateTaskId
  // (X001, X053, ... X100), so the captured digit string's LENGTH is not
  // the thing to bound - its numeric VALUE is. Every committed precedent
  // is a two-digit value (X001..X052 -> 0a01..0a52).
  const value = Number(digits);
  if (value > 99) {
    // A three-digit value would overflow the GUID's 4-hex-char segment
    // (`0a` + digits must stay at 4 chars total) - fail loudly rather than
    // silently emit a GUID with the wrong segment length.
    throw new Error(
      `Prereq GUID suffix derivation only supports two-digit X-ids ` +
        `(00-99); got "${id}" whose numeric suffix would overflow the ` +
        `GUID segment. Extend the convention before scaffolding X100+.`,
    );
  }
  return `0a${String(value).padStart(2, "0")}`;
}

function renderPrereqAppJson(id: string): string {
  const appJson = {
    id: `a1b2c3d4-${derivePrereqSuffix(id)}-0000-0000-000000000001`,
    name: `${id} Prereq`,
    publisher: "CentralGauge",
    version: "1.0.0.0",
    platform: "28.0.0.0",
    application: "28.0.0.0",
    idRanges: [{ from: 69000, to: 69099 }],
    runtime: "17.0",
    features: ["NoImplicitWith"],
  };
  return JSON.stringify(appJson, null, 2) + "\n";
}
