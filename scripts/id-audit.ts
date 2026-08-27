#!/usr/bin/env -S deno run --allow-read
/**
 * Object-ID range audit for committed AL.
 *
 * Checks two things a human reviewer cannot reliably eyeball:
 *
 *  1. Every AL object declaration sits in the band its LOCATION implies
 *     (prereq / oracle / harness / spike), and nothing has crept into the
 *     reserved buffer that keeps CentralGauge clear of the other product
 *     sharing these containers. See `BENCHMARK_APP_ID_BUFFER` in
 *     `src/constants.ts` for why that buffer exists.
 *  2. No NEW duplicate `(object type, id)` pair appears inside a single
 *     compilation unit. Four such pairs are pre-existing and deliberate; they
 *     are allowlisted below so the check stays green on them while still
 *     failing on a fifth.
 *
 * Bands come from `src/constants.ts` so this can never drift from the
 * documented convention. Change the constant, not this file.
 *
 * Duplicates ACROSS compilation units are fine and are not reported: each
 * difficulty folder is a separate AL project, and the bench compiles exactly
 * one task's app at a time, so `easy/E002` and `hard/H002` can both be 80002.
 * Only same-unit collisions produce a real AL0264.
 *
 * Usage:
 *   deno task id-audit          # exits 1 on any violation or new duplicate
 *   deno task id-audit --list   # also print the full band histogram
 */
import { dirname, fromFileUrl, join, relative } from "@std/path";
import * as colors from "@std/fmt/colors";
import {
  BENCHMARK_APP_ID_BUFFER,
  BENCHMARK_APP_ID_RANGE,
  HARNESS_APP_ID_RANGE,
  PREREQ_APP_ID_RANGE,
  SPIKE_APP_ID_RANGE,
  TEST_CODEUNIT_ID_RANGE,
} from "../src/constants.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");

/** Directories that are gitignored, generated, or not our AL. */
const SKIP_DIRS = new Set([
  ".git",
  ".claude",
  ".svelte-kit",
  "debug",
  "dist",
  "graphify-out",
  "node_modules",
  "results",
  "scratch",
  "site",
  "volotests",
]);

const OBJECT_RE =
  /^\s*(tableextension|pageextension|reportextension|enumextension|permissionsetextension|table|page|report|query|xmlport|codeunit|enum|interface|permissionset|profile|controladdin|entitlement)\s+(\d+)\s+(?:"([^"]+)"|(\S+))/i;

/**
 * Pre-existing same-unit duplicates, deliberately not renumbered: changing a
 * committed test codeunit id edits `tests/al/**` and moves the task-set hash
 * for no benchmark-visible benefit. Documented in
 * `.claude/rules/prereq-apps.md`. A duplicate NOT in this list fails the audit.
 *
 * Keyed by collision, valued by the EXACT set of files allowed to hold it.
 * Matching on the id alone would let a third file quietly join a known pair,
 * so the file set is compared too: anything other than exactly these files at
 * that id is reported.
 *
 * If those pairs are ever renumbered, delete the entry — a stale allowlist
 * entry keeps expecting a collision that no longer exists.
 */
/**
 * Pre-existing prereq co-installation collisions.
 *
 * Found 2026-08-26 by the backfill's seed verification, which publishes many
 * tasks' prereqs onto one container in sequence and hit
 * `The application object of type 'Table' with the ID '69001' is defined in
 * multiple apps`. Allowlisted rather than renumbered because changing a prereq
 * app.json edits `tests/al/**` and moves `task_sets.hash`, which owes a
 * re-bench; the collision is harmless to the bench itself, which installs one
 * task's prereq at a time.
 *
 * Renumber these when a hash move is happening anyway, then delete the entry.
 * A stale allowlist entry keeps expecting a collision that no longer exists.
 */
const KNOWN_COINSTALL_COLLISIONS = new Map<string, string[]>([
  ["table:69001", [
    "prereq:CG-AL-E002",
    "prereq:CG-AL-M001",
    "prereq:CG-AL-X058",
  ]],
  ["table:69225", [
    "prereq:CG-AL-H022",
    "prereq:CG-AL-H023",
    "prereq:CG-AL-H026",
  ]],
]);

const KNOWN_DUPLICATES = new Map<string, string[]>([
  ["alproject:tests/al/hard|codeunit:80015", [
    "tests/al/hard/CG-AL-H014.Test.al",
    "tests/al/hard/CG-AL-H015.Test.al",
  ]],
  ["alproject:tests/al/hard|codeunit:80021", [
    "tests/al/hard/CG-AL-H020.Test.al",
    "tests/al/hard/CG-AL-H021.Test.al",
  ]],
  ["alproject:tests/al/medium|codeunit:80012", [
    "tests/al/medium/CG-AL-M002.Test.al",
    "tests/al/medium/CG-AL-M112.Test.al",
  ]],
  ["alproject:tests/al/medium|codeunit:80020", [
    "tests/al/medium/CG-AL-M010.Test.al",
    "tests/al/medium/CG-AL-M020.Test.al",
  ]],
]);

export interface AlObject {
  file: string;
  unit: string;
  kind: string;
  id: number;
  name: string;
}

interface Band {
  label: string;
  start: number;
  end: number;
}

/** The compilation unit a file belongs to: what actually compiles together. */
export function unitOf(file: string): string {
  const prereq = /^tests\/al\/dependencies\/([^/]+)\//.exec(file);
  if (prereq) return `prereq:${prereq[1]}`;

  const project = /^tests\/al\/(easy|medium|hard)\//.exec(file);
  if (project) return `alproject:tests/al/${project[1]}`;

  const spike = /^spikes\/([^/]+)\//.exec(file);
  if (spike) return `spike:${spike[1]}`;

  if (file.startsWith("infra/cg-test-harness/")) return "app:cg-test-harness";

  return `unclassified:${file}`;
}

/** Expected band for a unit, or null when the unit has no enforced band. */
function bandOf(unit: string): Band | null {
  if (unit.startsWith("prereq:")) {
    return { label: "prereq", ...PREREQ_APP_ID_RANGE };
  }
  if (unit.startsWith("alproject:")) {
    // Oracles live in the test band; a few committed companion objects
    // (an enum an oracle references) legitimately sit in the generated band.
    return {
      label: "oracle + companions",
      start: BENCHMARK_APP_ID_RANGE.start,
      end: TEST_CODEUNIT_ID_RANGE.end,
    };
  }
  if (unit.startsWith("spike:")) {
    return { label: "spike", ...SPIKE_APP_ID_RANGE };
  }
  if (unit === "app:cg-test-harness") {
    return { label: "harness", ...HARNESS_APP_ID_RANGE };
  }
  return null;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(path);
    } else if (entry.name.endsWith(".al")) {
      yield path;
    }
  }
}

export async function collect(): Promise<AlObject[]> {
  const objects: AlObject[] = [];
  for await (const path of walk(REPO_ROOT)) {
    const file = relative(REPO_ROOT, path).replace(/\\/g, "/");
    const text = await Deno.readTextFile(path);
    for (const line of text.split(/\r?\n/)) {
      const match = OBJECT_RE.exec(line);
      if (!match) continue;
      objects.push({
        file,
        unit: unitOf(file),
        kind: String(match[1]).toLowerCase(),
        id: Number(match[2]),
        name: match[3] ?? match[4] ?? "",
      });
    }
  }
  return objects;
}

export interface AuditResult {
  /** Human-readable violations. Empty means clean. */
  problems: string[];
  /** How many allowlisted pre-existing duplicate pairs were matched exactly. */
  knownSeen: number;
  /**
   * How many allowlisted pre-existing prereq CO-INSTALLATION collisions were
   * matched exactly. Separate from `knownSeen`: these are a different failure
   * surface with a different allowlist.
   */
  knownCoinstallSeen: number;
}

/**
 * The whole check, as a pure function over already-collected objects.
 * Separated from IO so it can be tested without a filesystem.
 */
export function auditObjects(
  objects: AlObject[],
  knownDuplicates: Map<string, string[]> = KNOWN_DUPLICATES,
  knownCoinstall: Map<string, string[]> = KNOWN_COINSTALL_COLLISIONS,
): AuditResult {
  const problems: string[] = [];

  // 1. Range checks.
  for (const obj of objects) {
    const band = bandOf(obj.unit);
    if (band && (obj.id < band.start || obj.id > band.end)) {
      problems.push(
        `${obj.file}: ${obj.kind} ${obj.id} "${obj.name}" is outside the ` +
          `${band.label} band ${band.start}-${band.end}`,
      );
    }
    if (
      obj.id >= BENCHMARK_APP_ID_BUFFER.start &&
      obj.id <= BENCHMARK_APP_ID_BUFFER.end
    ) {
      problems.push(
        `${obj.file}: ${obj.kind} ${obj.id} "${obj.name}" is in the RESERVED ` +
          `buffer ${BENCHMARK_APP_ID_BUFFER.start}-${BENCHMARK_APP_ID_BUFFER.end} ` +
          `(see BENCHMARK_APP_ID_BUFFER in src/constants.ts)`,
      );
    }
  }

  // 2. Same-unit duplicates.
  const byUnit = new Map<string, AlObject[]>();
  for (const obj of objects) {
    const key = `${obj.unit}|${obj.kind}:${obj.id}`;
    const bucket = byUnit.get(key);
    if (bucket) bucket.push(obj);
    else byUnit.set(key, [obj]);
  }

  let knownSeen = 0;
  for (const [key, group] of byUnit) {
    if (group.length < 2) continue;
    const files = group.map((g) => g.file).sort();
    const allowed = knownDuplicates.get(key);
    if (allowed && allowed.slice().sort().join("|") === files.join("|")) {
      knownSeen++;
      continue;
    }
    const note = allowed
      ? ` (allowlisted for exactly ${allowed.join(", ")} — this set differs)`
      : "";
    problems.push(
      `duplicate ${key} in one compilation unit (AL0264): ` +
        files.join(", ") + note,
    );
  }

  // 3. Prereq CO-INSTALLATION collisions.
  //
  // A separate failure surface from check 2, and the reason it needs its own
  // check: two prereq apps are two compilation units, so a shared object id can
  // never produce AL0264 and check 2 is right to ignore it. But prereq apps can
  // be INSTALLED on one tenant at the same time, and then BC rejects the second
  // with "defined in multiple apps" - a publish/install error, not a compile
  // error. The bench installs one task's prereq at a time so it never sees this;
  // anything that co-installs them does.
  const byPrereqObject = new Map<string, Set<string>>();
  for (const obj of objects) {
    if (!obj.unit.startsWith("prereq:")) continue;
    const key = `${obj.kind}:${obj.id}`;
    const bucket = byPrereqObject.get(key);
    if (bucket) bucket.add(obj.unit);
    else byPrereqObject.set(key, new Set([obj.unit]));
  }

  let knownCoinstallSeen = 0;
  for (const [key, unitSet] of byPrereqObject) {
    if (unitSet.size < 2) continue;
    const units = [...unitSet].sort();
    const allowed = knownCoinstall.get(key);
    if (allowed && allowed.slice().sort().join("|") === units.join("|")) {
      knownCoinstallSeen++;
      continue;
    }
    const note = allowed
      ? ` (allowlisted for exactly ${allowed.join(", ")} — this set differs)`
      : "";
    problems.push(
      `prereq co-installation collision: ${key} is declared by ` +
        `${
          units.join(", ")
        } — installing two of these on one tenant fails with ` +
        `"defined in multiple apps"` + note,
    );
  }

  return { problems, knownSeen, knownCoinstallSeen };
}

function main(objects: AlObject[], showList: boolean): number {
  const { problems, knownSeen, knownCoinstallSeen } = auditObjects(objects);

  // Report.
  if (showList) {
    const histogram = new Map<string, number>();
    for (const obj of objects) {
      const band = bandOf(obj.unit);
      const label = band ? band.label : "unclassified";
      histogram.set(label, (histogram.get(label) ?? 0) + 1);
    }
    console.log(colors.bold("Objects by band:"));
    for (const [label, count] of [...histogram].sort()) {
      console.log(`  ${label.padEnd(24)} ${count}`);
    }
    console.log("");
  }

  console.log(
    `Scanned ${objects.length} AL object declarations across ` +
      `${new Set(objects.map((o) => o.unit)).size} compilation units.`,
  );
  if (knownSeen > 0) {
    console.log(
      colors.dim(
        `${knownSeen} allowlisted pre-existing duplicate pair(s) ignored.`,
      ),
    );
  }
  if (knownCoinstallSeen > 0) {
    console.log(
      colors.dim(
        `${knownCoinstallSeen} allowlisted pre-existing prereq ` +
          `co-installation collision(s) ignored.`,
      ),
    );
  }

  if (problems.length === 0) {
    console.log(colors.green("[OK] no object-id violations"));
    return 0;
  }
  console.log(colors.red(`[FAIL] ${problems.length} violation(s):`));
  for (const problem of problems) console.log(`  ${problem}`);
  return 1;
}

if (import.meta.main) {
  const objects = await collect();
  Deno.exit(main(objects, Deno.args.includes("--list")));
}
