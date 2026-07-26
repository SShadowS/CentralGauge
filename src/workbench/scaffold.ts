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

import type { IdRoots } from "./ids.ts";
import { allocateTaskId, allocateTestCodeunitId } from "./ids.ts";

/** Metadata recorded for a scaffolded draft, both returned and written to `.meta.json`. */
export interface DraftMeta {
  id: string;
  slug: string;
  testCodeunitId: number;
  createdAt: string;
  withPrereq: boolean;
}

/**
 * All drafts scaffolded by this workbench phase target `hard` - the
 * ado-trap-2026 cohort this tooling exists for is hand-authored trap tasks,
 * which are hard by construction. `expected.testApp` and `metadata.difficulty`
 * both key off this constant.
 */
const DRAFT_DIFFICULTY = "hard";

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
 * Scaffolds a new trap-task draft under `roots.scratchDir/<id>/`.
 *
 * Refuses rather than overwrites when the target draft directory already
 * exists - that path is someone's in-progress work.
 */
export async function scaffoldDraft(opts: {
  id?: string;
  slug: string;
  withPrereq?: boolean;
  roots: IdRoots;
}): Promise<DraftMeta> {
  const { slug, roots } = opts;
  const withPrereq = opts.withPrereq ?? false;

  if (!KEBAB_CASE_PATTERN.test(slug)) {
    throw new Error(
      `Invalid slug "${slug}": must be kebab-case (lowercase letters, ` +
        `digits, and single hyphens, e.g. "day-close") - it becomes a filename.`,
    );
  }

  const id = opts.id ?? await allocateTaskId(roots);

  if (!TASK_ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid id "${id}": must match CG-AL-X<digits> - this workbench ` +
        `only collision-tracks the X-series (see src/workbench/ids.ts).`,
    );
  }

  const draftDir = join(roots.scratchDir, id);

  if (await exists(draftDir)) {
    throw new Error(
      `Draft already exists at ${draftDir} - refusing to overwrite ` +
        `in-progress work.`,
    );
  }

  const testCodeunitId = await allocateTestCodeunitId(roots);
  const createdAt = new Date().toISOString();

  await ensureDir(join(draftDir, "correct"));
  await ensureDir(join(draftDir, "naive"));

  await Deno.writeTextFile(
    join(draftDir, "task.yml"),
    renderTaskYaml(id, testCodeunitId),
  );
  await Deno.writeTextFile(
    join(draftDir, `${id}.Test.al`),
    renderAlSkeleton(id, testCodeunitId),
  );
  await Deno.writeTextFile(join(draftDir, "NOTES.md"), renderNotes(id, slug));

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
    await Deno.writeTextFile(
      join(prereqDir, "app.json"),
      renderPrereqAppJson(id),
    );
  }

  const meta: DraftMeta = { id, slug, testCodeunitId, createdAt, withPrereq };
  await Deno.writeTextFile(
    join(draftDir, ".meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
  );

  return meta;
}

/**
 * Renders `task.yml` via `@std/yaml` `stringify` against a plain object
 * matching `TaskManifestSchema` exactly - the schema is `.strict()`, so a
 * stray key would fail to parse just as loudly as a missing one.
 */
function renderTaskYaml(id: string, testCodeunitId: number): string {
  const manifest = {
    id,
    prompt_template: "code-gen.md",
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
`;
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
