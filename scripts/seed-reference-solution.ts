/**
 * Seed a missing reference solution from a stored passing bench submission.
 *
 * Why this exists. Three hardening gates - B2 determinism, B4 over-strictness
 * and B7 mutation - all need a program that PASSES the task's oracle:
 *
 * - B2 re-runs the passing path and compares verdicts and assertion counts.
 * - B7 needs a green baseline before it can call a mutant killed or survived.
 * - B4 needs something to compare a second independent solution against.
 *
 * 126 of the 203 promoted hard/medium tasks have no such program on disk. The
 * X055+ workbench era mirrors every reference fix into `reference/solutions/`,
 * but the H series, the M series and the X001-X052 batch predate that, so all
 * three gates are structurally unrunnable for them - not un-run, unrunnable.
 *
 * They are not, however, unrecoverable. Every bench attempt records its
 * `extractedCode`, so for any task some model has ever solved there is already
 * a passing program in `results/benchmark-results-*.json`. 123 of those 126
 * have at least one. This script lifts the newest one into
 * `reference/solutions/<id>/`, reproducing the manifest the bench itself
 * writes (`compile-queue.ts` around line 1049) so the project compiles the
 * same way.
 *
 * IMPORTANT - a seeded solution is a CANDIDATE, not a verified reference.
 * It passed whatever oracle was current when that run happened, and oracles
 * have moved since (the GH #13 fixes to E002/M004/M034 are the obvious case).
 * Nothing here proves it still passes today, so every seeded directory must be
 * re-probed before any gate verdict is recorded against it:
 *
 *   deno run -A scripts/trap-probe.ts --task <id> \
 *     --solution reference/solutions/<id> --expect pass
 *
 * Writes nothing outside `reference/solutions/<id>/`, and refuses to overwrite
 * an existing directory unless --force is passed.
 *
 * Usage:
 *   deno run -A scripts/seed-reference-solution.ts --list
 *   deno run -A scripts/seed-reference-solution.ts CG-AL-H001 [--force]
 *   deno run -A scripts/seed-reference-solution.ts --all [--force]
 */

import { exists } from "@std/fs";
import { join } from "@std/path";

import { DEFAULT_CONTAINER_NAME } from "../src/constants.ts";
import {
  type PlatformVersions,
  resolvePlatformVersions,
} from "../src/container/bc-platform-version.ts";

const REPO = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

/** Mirrors `compile-queue.ts`'s benchmark manifest so the seeded project
 * compiles the way the passing attempt itself compiled. */
const BENCHMARK_APP_ID = "00000000-cafe-0000-0000-be4c00decade";

interface Candidate {
  taskId: string;
  code: string;
  /** Source file the submission came from, for provenance. */
  sourceFile: string;
  /** Mtime of that file - the proxy for "newest". */
  sourceMtime: number;
  model?: string;
  score?: number;
}

interface AttemptShape {
  success?: boolean;
  extractedCode?: string;
  score?: number;
}

interface ResultShape {
  taskId?: string;
  task?: string;
  llmModel?: string;
  model?: string;
  attempts?: AttemptShape[];
}

async function collectCandidates(): Promise<Map<string, Candidate>> {
  const best = new Map<string, Candidate>();
  const resultsDir = join(REPO, "results");

  for await (const entry of Deno.readDir(resultsDir)) {
    if (!entry.isFile) continue;
    if (!entry.name.startsWith("benchmark-results-")) continue;
    if (!entry.name.endsWith(".json")) continue;

    const path = join(resultsDir, entry.name);
    let mtime = 0;
    try {
      mtime = (await Deno.stat(path)).mtime?.getTime() ?? 0;
    } catch { /* ignore */ }

    let parsed: { results?: ResultShape[] };
    try {
      parsed = JSON.parse(await Deno.readTextFile(path));
    } catch {
      continue; // truncated or non-JSON run file
    }

    for (const r of parsed.results ?? []) {
      const taskId = r.taskId ?? r.task;
      if (taskId === undefined) continue;
      for (const a of r.attempts ?? []) {
        if (a.success !== true) continue;
        const code = a.extractedCode;
        if (code === undefined || code.trim() === "") continue;

        const prev = best.get(taskId);
        if (prev !== undefined && prev.sourceMtime >= mtime) continue;
        best.set(taskId, {
          taskId,
          code,
          sourceFile: `results/${entry.name}`,
          sourceMtime: mtime,
          ...(r.llmModel ?? r.model ? { model: r.llmModel ?? r.model } : {}),
          ...(a.score === undefined ? {} : { score: a.score }),
        });
      }
    }
  }
  return best;
}

interface TaskMeta {
  id: string;
  tier: string;
  target?: string;
  hasTestApp: boolean;
}

async function taskMeta(id: string): Promise<TaskMeta | undefined> {
  for (const tier of ["hard", "medium", "easy"]) {
    const dir = join(REPO, "tasks", tier);
    let found: string | undefined;
    try {
      for await (const e of Deno.readDir(dir)) {
        if (
          e.isFile && e.name.startsWith(`${id}-`) && e.name.endsWith(".yml")
        ) {
          found = join(dir, e.name);
          break;
        }
        if (e.isFile && e.name === `${id}.yml`) {
          found = join(dir, e.name);
          break;
        }
      }
    } catch { /* no such tier */ }
    if (found === undefined) continue;

    const text = await Deno.readTextFile(found);
    const target = text.match(/^\s*target:\s*["']?([A-Za-z]+)/m)?.[1];
    return {
      id,
      tier,
      ...(target === undefined ? {} : { target }),
      hasTestApp: /testApp:/.test(text),
    };
  }
  return undefined;
}

async function seed(
  cand: Candidate,
  meta: TaskMeta,
  force: boolean,
  versions: PlatformVersions,
): Promise<string> {
  const dir = join(REPO, "reference", "solutions", cand.taskId);
  if (await exists(dir)) {
    if (!force) return `skipped (exists): ${cand.taskId}`;
  }
  await Deno.mkdir(dir, { recursive: true });

  // Platform/runtime/application are read from the CONTAINER the seed will be
  // verified against, exactly as the bench does it. Two earlier revisions of
  // this got it wrong in the same way from opposite directions: first a
  // hardcoded runtime "16.0" (M031/M032 failed with AL0666 because their
  // solutions need 17.0+), then the src/constants.ts values, which are equally
  // frozen and would be wrong the moment the containers move to BC29. The
  // manifest has to describe the container that will actually compile it.
  const appJson: Record<string, unknown> = {
    id: BENCHMARK_APP_ID,
    name: `CentralGauge_${cand.taskId}_seeded`,
    publisher: "CentralGauge",
    version: "1.0.0.0",
    platform: versions.platform,
    runtime: versions.runtime,
    application: versions.application,
    idRanges: [{ from: 70000, to: 89999 }],
    features: ["NoImplicitWith"],
    dependencies: [],
  };
  if (meta.target !== undefined) appJson["target"] = meta.target;

  await Deno.writeTextFile(
    join(dir, "app.json"),
    JSON.stringify(appJson, null, 2),
  );
  // The bench writes the candidate to `<taskId>.al`; keep the same name so the
  // seeded project is byte-comparable with what actually passed.
  await Deno.writeTextFile(join(dir, `${cand.taskId}.al`), cand.code);

  await Deno.writeTextFile(
    join(dir, "PROVENANCE.md"),
    [
      `# ${cand.taskId} - seeded reference solution`,
      "",
      "**Not verified.** This was lifted from a stored bench submission that",
      "passed the oracle AS IT STOOD AT THE TIME OF THAT RUN. Oracles have",
      "changed since. Re-probe before recording any gate verdict against it:",
      "",
      "```",
      `deno run -A scripts/trap-probe.ts --task ${cand.taskId} \\`,
      `  --solution reference/solutions/${cand.taskId} --expect pass`,
      "```",
      "",
      `- source run: \`${cand.sourceFile}\``,
      `- model: ${cand.model ?? "(not recorded)"}`,
      `- attempt score: ${cand.score ?? "(not recorded)"}`,
      `- seeded by: \`scripts/seed-reference-solution.ts\``,
      `- manifest versions: platform ${versions.platform}, runtime ${versions.runtime} ` +
      `(${versions.source}${
        versions.evidence === undefined ? "" : `: ${versions.evidence}`
      })`,
      "",
    ].join("\n"),
  );

  return `seeded ${cand.taskId} (${meta.tier}) from ${cand.sourceFile}`;
}

async function main(): Promise<void> {
  const args = Deno.args;
  const force = args.includes("--force");
  const listOnly = args.includes("--list");
  const all = args.includes("--all");
  const ids = args.filter((a) => a.startsWith("CG-AL-"));

  console.log("[seed] scanning stored bench results...");
  const candidates = await collectCandidates();
  console.log(
    `[seed] tasks with a stored PASSING submission: ${candidates.size}`,
  );

  // Which in-scope tasks are missing a reference solution?
  const missing: string[] = [];
  for (const tier of ["hard", "medium"]) {
    for await (const e of Deno.readDir(join(REPO, "tasks", tier))) {
      if (!e.isFile || !e.name.endsWith(".yml")) continue;
      const id = e.name.match(/^(CG-AL-[A-Z0-9]+)/)?.[1];
      if (id === undefined) continue;
      if (!(await exists(join(REPO, "reference", "solutions", id)))) {
        missing.push(id);
      }
    }
  }
  missing.sort();

  let versions: PlatformVersions | undefined;
  const seedable = missing.filter((id) => candidates.has(id));
  const unseedable = missing.filter((id) => !candidates.has(id));

  console.log(
    `[seed] in-scope missing a reference solution: ${missing.length}`,
  );
  console.log(
    `[seed]   seedable from a stored submission:   ${seedable.length}`,
  );
  console.log(
    `[seed]   nothing stored:                     ${unseedable.length}`,
  );
  if (unseedable.length > 0) {
    console.log(`[seed]   (${unseedable.join(", ")})`);
  }

  if (listOnly) return;

  const targets = ids.length > 0 ? ids : all ? seedable : [];
  if (targets.length > 0) {
    // Resolve once: every seed in a run targets the same container pool, and
    // the resolver memoizes per container anyway.
    const container = args.find((a) => a.startsWith("--container="))
      ?.slice("--container=".length) ?? DEFAULT_CONTAINER_NAME;
    versions = await resolvePlatformVersions(container);
    console.log(
      `[seed] manifest versions from ${container}: platform ${versions.platform}, ` +
        `runtime ${versions.runtime} [${versions.source}]`,
    );
    if (versions.source !== "symbols") {
      console.log(
        `[seed] WARNING versions are not fully container-derived: ${
          versions.evidence ?? ""
        }`,
      );
    }
  }
  if (targets.length === 0) {
    console.log(
      "[seed] nothing to do. Pass task ids, or --all, or --list. Add --force to overwrite.",
    );
    return;
  }

  for (const id of targets) {
    const cand = candidates.get(id);
    if (cand === undefined) {
      console.log(`[seed] ${id}: no stored passing submission`);
      continue;
    }
    const meta = await taskMeta(id);
    if (meta === undefined) {
      console.log(`[seed] ${id}: no task YAML found`);
      continue;
    }
    if (versions === undefined) throw new Error("versions unresolved");
    console.log(`[seed] ${await seed(cand, meta, force, versions)}`);
  }
  console.log(
    "[seed] REMINDER: every seeded directory is unverified until trap-probe confirms it still passes.",
  );
}

if (import.meta.main) await main();
