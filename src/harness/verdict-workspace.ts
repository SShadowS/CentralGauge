/**
 * Verdict workspace (spec 1a section 7 items 1-4). Never the agent's
 * workspace as-is: the staged copy, plus permitted source files from the
 * artifact (or the reference, for test-authoring), plus new Test\ sources;
 * app.json rebuilt from the trusted one. Violations fail the build scorer.
 */

import { join } from "@std/path";
import {
  BENCHMARK_APP_ID_BUFFER,
  HARNESS_EXTRACTED_TEST_RANGE,
  HARNESS_FIXTURE_TEST_RANGE,
  HARNESS_FORBIDDEN_IDS,
  HARNESS_ORACLE_RANGE,
} from "../constants.ts";
import { ValidationError } from "../errors.ts";
import { hashTree, isTaskBuildArtifact, listTree } from "./hash.ts";
import {
  exists,
  FREEZE_VIOLATIONS_FILE,
  safeCopyTree,
  validatedDest,
} from "./fsutil.ts";
import { readAppGraph, readAppJsonRaw, type StagedApp } from "./staging.ts";

export const TEST_APP = "Test";
export const SOURCE_EXTENSIONS = [
  ".al",
  ".xlf",
  ".rdl",
  ".rdlc",
  ".docx",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
];

export function isSourceFile(rel: string): boolean {
  const lower = rel.toLowerCase();
  return lower === "app.json" ||
    SOURCE_EXTENSIONS.some((e) => lower.endsWith(e));
}

/** Directories pass; files pass only when they are sources and not build artifacts. */
const sourcesOnly = (rel: string, isDir: boolean) =>
  isTaskBuildArtifact(rel) ||
  (!isDir && !isSourceFile(rel.split("/").pop()!)) ||
  rel.split("/").some((s) => s.startsWith("."));

export interface ReconstructOptions {
  pristine: string;
  artifact: string;
  out: string;
  productionFrom?: string | undefined;
  symbolIds: ReadonlySet<string>;
  /**
   * mutant_kill builds (M4-17a run 002): leave every shipped `Subtype = Test`
   * codeunit out of the Test app, so no dispatch of any kind (a platform
   * codeunit running a computed id, a test runner) can reach a shipped test.
   */
  dropShippedTests?: boolean;
  /**
   * H-35 G and G' builds: the Test app stays the pristine one byte for byte
   * (app.json included); nothing of the agent's Test folder is read.
   */
  rawTest?: boolean;
  /** H-35: the task's reviewed production_allow grant (design-r2 6.2.5). */
  productionAllow?: ProductionAllow | undefined;
}

export interface VerdictWorkspace {
  dir: string;
  apps: StagedApp[];
  changed: string[];
  violations: string[];
  /** Why agent-added test procedures were not extracted or not counted (M4-17a). */
  notes: string[];
  /** Agent test codeunits that must not run (the credit rules could not judge them). */
  excluded: number[];
  /**
   * H-35 (design-r2 3, Sol r1 #8): submitted agent tests the credit rules
   * keep from counting: excluded codeunits plus rejected [Test] procedures.
   */
  creditExcluded: number;
}

const IDENTITY = ["id", "name", "publisher"] as const;

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return await readAppJsonRaw(path) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** An app's identity (an internalsVisibleTo entry names one). */
interface AppIdentity {
  id: string;
  name: string;
  publisher: string;
}

/**
 * An untrusted JSON value as text: a string as is, anything else as JSON
 * (Sol r2: never String(), an object's toString may throw).
 */
const show = (v: unknown): string =>
  typeof v === "string" ? v : JSON.stringify(v) ?? typeof v;

/** The id, name and publisher of an app.json or entry, when all are strings. */
function identityOf(r: Record<string, unknown>): AppIdentity | null {
  const [id, name, publisher] = [r["id"], r["name"], r["publisher"]];
  return typeof id === "string" && typeof name === "string" &&
      typeof publisher === "string"
    ? { id, name, publisher }
    : null;
}

/**
 * H-30: the merged internalsVisibleTo. The shipped entries stay; an entry the
 * agent adds is kept only in a production app and only when it is exactly the
 * pristine Test app's identity (id case aside, no other key), written as that
 * identity. Every other entry is dropped with a note.
 */
function mergeInternalsVisibleTo(
  folder: string,
  trusted: unknown,
  cand: unknown,
  test: AppIdentity | null,
  notes: string[],
): unknown[] {
  const list = (v: unknown) =>
    Array.isArray(v) ? v : v === undefined ? [] : [v];
  const shipped = list(trusted);
  const out = [...shipped];
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  const isTest = (e: unknown) => {
    if (test === null || folder === TEST_APP) return false;
    if (typeof e !== "object" || e === null || Array.isArray(e)) return false;
    const r = e as Record<string, unknown>;
    const i = identityOf(r);
    return Object.keys(r).every((k) =>
      (IDENTITY as readonly string[]).includes(k)
    ) && i !== null && i.id.toLowerCase() === test.id.toLowerCase() &&
      i.name === test.name && i.publisher === test.publisher;
  };
  for (const e of list(cand)) {
    if (shipped.some((s) => same(s, e))) continue;
    if (isTest(e)) {
      if (!out.some(isTest)) {
        out.push({
          id: test!.id,
          name: test!.name,
          publisher: test!.publisher,
        });
        notes.push(
          `${folder}: app.json internalsVisibleTo entry kept: ${test!.name}`,
        );
      }
      continue;
    }
    const r = (typeof e === "object" && e !== null ? e : {}) as Record<
      string,
      unknown
    >;
    notes.push(
      `${folder}: app.json internalsVisibleTo entry dropped: ${
        show(r["id"] ?? e)
      } ${show(r["name"] ?? "")} (${
        folder === TEST_APP
          ? "the Test app grants nothing"
          : "not the shipped Test app"
      })`,
    );
  }
  if (shipped.some((s) => !list(cand).some((e) => same(s, e)))) {
    notes.push(
      `${folder}: app.json internalsVisibleTo: a shipped entry is removed by the agent; it stays`,
    );
  }
  return out;
}

/**
 * Trusted app.json with only `dependencies` from the candidate (and, H-30,
 * internalsVisibleTo naming the Test app); identity changes are violations,
 * every other key the agent changed is dropped with a note.
 */
async function mergeAppJson(
  folder: string,
  trustedPath: string,
  candidatePath: string,
  violations: string[],
  notes: string[],
  test: AppIdentity | null,
) {
  const trusted = (await readJson(trustedPath))!;
  const cand = await readJson(candidatePath);
  if (cand === null) {
    violations.push(`${folder}: app.json missing or unreadable`);
    await Deno.writeTextFile(candidatePath, JSON.stringify(trusted, null, 2));
    return;
  }
  for (const k of IDENTITY) {
    const a = show(trusted[k] ?? "");
    const b = show(cand[k] ?? "");
    if (k === "id" ? a.toLowerCase() !== b.toLowerCase() : a !== b) {
      violations.push(`${folder}: ${k} changed from ${a} to ${b}`);
    }
  }
  if (
    JSON.stringify(trusted["idRanges"] ?? []) !==
      JSON.stringify(cand["idRanges"] ?? [])
  ) {
    violations.push(`${folder}: idRanges changed`);
  }
  const merged: Record<string, unknown> = {
    ...trusted,
    dependencies: Array.isArray(cand["dependencies"])
      ? cand["dependencies"]
      : trusted["dependencies"] ?? [],
  };
  const reported = new Set<string>([
    ...IDENTITY,
    "idRanges",
    "dependencies",
    "internalsVisibleTo",
  ]);
  for (const k of new Set([...Object.keys(trusted), ...Object.keys(cand)])) {
    if (reported.has(k)) continue;
    if (JSON.stringify(trusted[k]) !== JSON.stringify(cand[k])) {
      notes.push(
        `${folder}: app.json ${k} differs from the shipped value; the shipped value is kept`,
      );
    }
  }
  const ivt = mergeInternalsVisibleTo(
    folder,
    trusted["internalsVisibleTo"],
    cand["internalsVisibleTo"],
    test,
    notes,
  );
  if (ivt.length > 0) merged["internalsVisibleTo"] = ivt;
  await Deno.writeTextFile(candidatePath, JSON.stringify(merged, null, 2));
}

/** A freeze violation line naming the Test app or a path under it (`<what>: Test[/<path>]`). */
const TEST_PATH_VIOLATION = /: Test(?:[\\/]|\s*$)/i;

/** A real directory (not a file, link or junction). */
async function isPlainDir(p: string): Promise<boolean> {
  const st = await Deno.lstat(p).catch(() => null);
  return st !== null && st.isDirectory && !st.isSymlink;
}

export async function buildVerdictWorkspace(
  o: ReconstructOptions,
): Promise<VerdictWorkspace> {
  const violations: string[] = [];
  const appNotes: string[] = [];
  const pristineApps = await readAppGraph(o.pristine);
  const tj = await readJson(join(o.pristine, TEST_APP, "app.json"));
  const testIdentity = tj ? identityOf(tj) : null;
  const copy = await safeCopyTree(o.pristine, o.out);
  const out = copy.dst;

  const marker = join(o.artifact, FREEZE_VIOLATIONS_FILE);
  if (await exists(marker)) {
    for (const line of (await Deno.readTextFile(marker)).split(/\r?\n/)) {
      // H-35 Sol r1 #3: a freeze violation that names a Test path is Test-side;
      // G reads no agent Test file, so it is not G's (every other line is).
      if (o.rawTest && TEST_PATH_VIOLATION.test(line)) continue;
      if (line.trim()) violations.push(`workspace ${line.trim()}`);
    }
  }

  const production = o.productionFrom ?? o.artifact;
  for (const app of pristineApps) {
    if (app.folder === TEST_APP) continue;
    const src = join(production, app.folder);
    if (!await isPlainDir(src)) {
      violations.push(`app folder ${app.folder} is missing`);
      continue;
    }
    await Deno.remove(join(out, app.folder), { recursive: true });
    const r = await safeCopyTree(src, join(out, app.folder), {
      skip: sourcesOnly,
    });
    violations.push(
      ...r.refused.map((p) => `link refused: ${app.folder}/${p}`),
    );
    violations.push(
      ...r.ambiguous.map((p) => `case-ambiguous name: ${app.folder}/${p}`),
    );
    await mergeAppJson(
      app.folder,
      join(o.pristine, app.folder, "app.json"),
      join(out, app.folder, "app.json"),
      violations,
      appNotes,
      testIdentity,
    );
  }

  const testSrc = join(o.artifact, TEST_APP);
  const editedShipped = new Map<string, string>();
  const newTestFiles: string[] = [];
  /** H-35 (ruling Q4): edited shipped files without a test codeunit, as written. */
  const asWritten: string[] = [];
  if (o.rawTest) {
    // G: the pristine Test app copied above stays.
  } else if (await exists(testSrc) && !await isPlainDir(testSrc)) {
    violations.push(`app folder ${TEST_APP} is missing`);
  } else if (await exists(testSrc)) {
    const shipped = new Map(
      (await listTree(join(o.pristine, TEST_APP), "task")).map((
        e,
      ) => [e.path.toLowerCase(), e.path]),
    );
    const scratch = join(out, ".cg-test-incoming");
    const r = await safeCopyTree(testSrc, scratch, { skip: sourcesOnly });
    violations.push(...r.refused.map((p) => `link refused: ${TEST_APP}/${p}`));
    violations.push(
      ...r.ambiguous.map((p) => `case-ambiguous name: ${TEST_APP}/${p}`),
    );
    for (const e of await listTree(scratch, "task")) {
      const known = shipped.get(e.path.toLowerCase());
      if (e.path === "app.json") continue;
      if (known !== undefined && known !== e.path) {
        violations.push(
          `case alias of a shipped test file: ${TEST_APP}/${e.path}`,
        );
        continue;
      }
      if (known !== undefined) {
        // Shipped: the pristine copy stays; an edited .al is kept aside for
        // extracting the procedures the agent added (M4-17a). H-35: an edited
        // shipped file without a test codeunit (the helper) is the agent's.
        const text = await Deno.readTextFile(
          join(scratch, ...e.path.split("/")),
        );
        const shippedText = await Deno.readTextFile(
          join(o.pristine, TEST_APP, ...known.split("/")),
        );
        if (e.path.toLowerCase().endsWith(".al") && text !== shippedText) {
          if (declarations(shippedText).some(isTestCodeunit)) {
            editedShipped.set(known, text);
          } else {
            await Deno.writeTextFile(
              join(out, TEST_APP, ...known.split("/")),
              text,
            );
            asWritten.push(known);
          }
        }
        continue;
      }
      const dest = join(out, TEST_APP, ...e.path.split("/"));
      if (e.path.toLowerCase().endsWith(".al")) newTestFiles.push(e.path);
      await validatedDest(join(dest, ".."));
      await Deno.writeFile(
        dest,
        await Deno.readFile(join(scratch, ...e.path.split("/"))),
      );
    }
    if (await exists(join(scratch, "app.json"))) {
      await Deno.copyFile(
        join(scratch, "app.json"),
        join(out, TEST_APP, "app.json"),
      );
    }
    await Deno.remove(scratch, { recursive: true });
    await mergeAppJson(
      TEST_APP,
      join(o.pristine, TEST_APP, "app.json"),
      join(out, TEST_APP, "app.json"),
      violations,
      appNotes,
      testIdentity,
    );
  }

  let apps = pristineApps;
  try {
    apps = await readAppGraph(out);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    violations.push(err.message);
  }
  violations.push(...await validateApps(out, pristineApps, apps, o.symbolIds));
  violations.push(
    ...await productionPolicyViolations(out, apps, o.productionAllow),
  );
  violations.push(
    ...await shippedCollisions(
      join(o.pristine, TEST_APP),
      out,
      newTestFiles,
      asWritten,
    ),
  );
  const agentText = async (rel: string) =>
    [
      rel,
      await Deno.readTextFile(join(out, TEST_APP, ...rel.split("/"))),
    ] as const;
  violations.push(...testPolicyViolations([
    ...await Promise.all([...newTestFiles, ...asWritten].map(agentText)),
    ...editedShipped,
  ]));
  const { notes, excluded, rejected } = violations.length === 0 &&
      (editedShipped.size + newTestFiles.length + asWritten.length) > 0
    ? await applyCreditRules(
      o.pristine,
      out,
      pristineApps,
      editedShipped,
      newTestFiles,
      asWritten,
    )
    : { notes: [], excluded: [], rejected: new Set<string>() };
  // Sol r2 #4: every test of an excluded codeunit, with the rejected ones, once.
  for (const t of await testCodeunits(join(out, TEST_APP))) {
    if (!excluded.includes(t.codeunit)) continue;
    for (const p of t.procedures) {
      rejected.add(`${t.codeunit}:${p.toLowerCase()}`);
    }
  }

  if (o.dropShippedTests && violations.length === 0) {
    await dropShippedTestCodeunits(o.pristine, out);
  }

  const changed: string[] = [];
  for (const app of pristineApps) {
    if (
      await hashTree(join(o.pristine, app.folder), "task") !==
        await hashTree(join(out, app.folder), "task")
    ) {
      changed.push(app.folder);
    }
  }
  return {
    dir: out,
    apps,
    changed,
    violations,
    notes: [...appNotes, ...notes],
    excluded,
    creditExcluded: rejected.size,
  };
}

/**
 * Blank comments and string literals (quoted identifiers kept) with
 * same-length whitespace, newlines kept.
 */
export function stripAlNoise(src: string): string {
  const n = src.length;
  let out = "";
  let i = 0;
  // Comments and string literals become whitespace of the same length
  // (newlines kept): nothing is deleted, so "codeunit/* c */80013" still
  // separates its tokens and offsets and line numbers stay put.
  const blank = (to: number) => {
    out += src.slice(i, to).replace(/[^\n]/g, " ");
    i = to;
  };
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const end = src.indexOf("\n", i);
      blank(end === -1 ? n : end);
    } else if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      blank(end === -1 ? n : end + 2);
    } else if (c === "'") {
      // AL string literals never span lines: an unterminated quote cannot
      // swallow the next declaration.
      let j = i + 1;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "'" && src[j + 1] === "'") j += 2;
        else if (src[j] === "'") {
          j++;
          break;
        } else j++;
      }
      blank(j);
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"' && src[j] !== "\n") j++;
      if (src[j] === '"') j++;
      out += src.slice(i, j);
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const OBJECT_KINDS =
  "tableextension|pageextension|reportextension|enumextension|permissionsetextension|table|page|report|query|xmlport|codeunit|enum|permissionset|entitlement";
// A declaration header anywhere at object level: keyword, whitespace (newlines
// included), id. Not anchored to a line start: "} codeunit 75005 X {" is legal.
const DECL_RE = new RegExp(
  `(?:^|[^A-Za-z0-9_])(${OBJECT_KINDS})\\s+(\\d+)(?![A-Za-z0-9_])`,
  "gi",
);

interface AlDecl {
  kind: string;
  id: number;
  /** Object body (between its braces) from the noise-stripped source. */
  body: string;
  /** Offsets of that body in the source (same in the stripped text). */
  start: number;
  end: number;
}

/**
 * Object declarations of one file. Only object level (brace depth 0) is
 * searched, so a variable typed by id (`P: Page 21`) is not a declaration;
 * quoted identifiers are blanked (same length) so a name cannot fake one or
 * shift the brace depth. Every header match counts, also one without a body.
 */
function declarations(src: string): AlDecl[] {
  const text = stripAlNoise(src);
  const flat = text.replace(/"[^"\n]*"/g, (q) => " ".repeat(q.length));
  const out: AlDecl[] = [];
  const headerDecls = (header: string) =>
    [...header.matchAll(DECL_RE)].map((m) => ({
      kind: m[1]!.toLowerCase(),
      id: Number(m[2]),
      body: "",
      start: 0,
      end: 0,
    }));
  let depth = 0;
  let header = "";
  let open: AlDecl | null = null;
  let bodyStart = 0;
  for (let i = 0; i < flat.length; i++) {
    const c = flat[i]!;
    if (c === "{") {
      if (depth === 0) {
        const found = headerDecls(header);
        header = "";
        out.push(...found);
        open = found.at(-1) ?? null;
        bodyStart = i + 1;
      }
      depth++;
    } else if (c === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && open) {
        open.body = text.slice(bodyStart, i);
        open.start = bodyStart;
        open.end = i;
        open = null;
      }
    } else if (depth === 0) header += c;
  }
  out.push(...headerDecls(header));
  return out;
}

export interface AlObjectRef {
  file: string;
  kind: string;
  id: number;
}

export async function alObjects(dir: string): Promise<AlObjectRef[]> {
  const out: AlObjectRef[] = [];
  for (const e of await listTree(dir, "task", { optional: true })) {
    if (!e.path.toLowerCase().endsWith(".al")) continue;
    const src = await Deno.readTextFile(join(dir, e.path));
    for (const d of declarations(src)) {
      out.push({ file: e.path, kind: d.kind, id: d.id });
    }
  }
  return out;
}

/** `#if`, `#elif`, `#else`, `#endif`: inactive regions could hide source from the scanner. */
const CONDITIONAL_DIRECTIVE = /^[ \t]*#(if|elif|else|endif)\b/im;

/** .al files under dir that use preprocessor conditionals (refused: fail closed). */
export async function conditionalSources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await listTree(dir, "task", { optional: true })) {
    if (!e.path.toLowerCase().endsWith(".al")) continue;
    if (
      CONDITIONAL_DIRECTIVE.test(await Deno.readTextFile(join(dir, e.path)))
    ) {
      out.push(e.path);
    }
  }
  return out;
}

const inRange = (id: number, r: { start: number; end: number }) =>
  id >= r.start && id <= r.end;

export async function validateApps(
  dir: string,
  pristine: StagedApp[],
  apps: StagedApp[],
  symbolIds: ReadonlySet<string>,
): Promise<string[]> {
  const v: string[] = [];
  const now = new Map(apps.map((a) => [a.folder, a]));
  for (const p of pristine) {
    for (const f of await conditionalSources(join(dir, p.folder))) {
      v.push(
        `${p.folder}/${f}: preprocessor conditional directives are not allowed (they can hide source from the id checks)`,
      );
    }
    const a = now.get(p.folder);
    if (!a) {
      v.push(`${p.folder}: app.json missing or unreadable`);
      continue;
    }
    for (const ext of a.external) {
      if (!symbolIds.has(ext)) {
        v.push(
          `${p.folder}: dependency ${ext} is neither a workspace app nor a locked symbol package`,
        );
      }
    }
    for (const o of await alObjects(join(dir, p.folder))) {
      const where = `${p.folder}/${o.file}: ${o.kind} ${o.id}`;
      if (!p.idRanges.some((r) => o.id >= r.from && o.id <= r.to)) {
        v.push(`${where} is outside the app's idRanges`);
      }
      if (inRange(o.id, BENCHMARK_APP_ID_BUFFER)) {
        v.push(`${where} is in the reserved band`);
      }
      if (inRange(o.id, HARNESS_ORACLE_RANGE)) {
        v.push(`${where} is in the hidden-oracle band`);
      }
      if (p.folder === TEST_APP) {
        if ((HARNESS_FORBIDDEN_IDS as readonly number[]).includes(o.id)) {
          v.push(`${where} is forbidden (foreign app collision)`);
        }
        if (inRange(o.id, HARNESS_FIXTURE_TEST_RANGE)) {
          v.push(`${where} is in the harness fixture band`);
        }
      }
    }
  }
  return v;
}

export interface TestCodeunit {
  codeunit: number;
  file: string;
  testPage: boolean;
  /** Procedures carrying [Test] (other attributes may sit between), from comment- and string-stripped source. */
  procedures: string[];
}

const TEST_PROC =
  /\[\s*Test\s*\]\s*(?:\[[^\]]*\]\s*)*(?:local\s+|internal\s+)?procedure\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*\(/gi;

export async function testCodeunits(dir: string): Promise<TestCodeunit[]> {
  const out: TestCodeunit[] = [];
  for (const e of await listTree(dir, "task", { optional: true })) {
    if (!e.path.toLowerCase().endsWith(".al")) continue;
    const src = await Deno.readTextFile(join(dir, e.path));
    // Each codeunit is judged on its own body, not on the file.
    for (const d of declarations(src)) {
      if (d.kind !== "codeunit" || !/\bSubtype\s*=\s*Test\s*;/i.test(d.body)) {
        continue;
      }
      out.push({
        codeunit: d.id,
        file: e.path,
        testPage: /\bTestPage\b/i.test(d.body),
        procedures: [...d.body.matchAll(TEST_PROC)].map((p) => p[1] ?? p[2]!),
      });
    }
  }
  return out.sort((a, b) => a.codeunit - b.codeunit);
}

/**
 * Test codeunits in files the shipped Test app does not have (case-insensitive
 * paths): the agent's new files and, in a verdict workspace, the generated
 * codeunits of tests the agent added to shipped codeunits (M4-17a). Shipped
 * test codeunits are never returned, so they never run as agent tests.
 */
export async function addedTestCodeunits(
  pristineTest: string,
  test: string,
  /** VerdictWorkspace.excluded: codeunits the credit rules could not judge. */
  exclude: ReadonlySet<number> = new Set(),
): Promise<TestCodeunit[]> {
  // H-35 Sol r1 #1: by shipped test codeunit id, not by file: a test
  // codeunit the agent adds to a shipped file (the helper) is the agent's.
  const shipped = new Set(
    (await testCodeunits(pristineTest)).map((t) => t.codeunit),
  );
  return (await testCodeunits(test)).filter((t) =>
    !shipped.has(t.codeunit) && !exclude.has(t.codeunit)
  );
}

// ---- M4-17a: [Test] procedures an agent added to a SHIPPED test codeunit ----

/** Folder (under Test\) of the generated codeunits; one file per shipped codeunit. */
export const EXTRACTED_TEST_DIR = "CGExtracted";

/**
 * The body normalization of the credit rule (M4-17a item B). Input: a
 * procedure's text from its first `var` or `begin` after the parameter list
 * and return type, through its final `end;` (so attributes, modifiers, the
 * name, parameters and return type are removed). Then, left to right:
 * - comments are removed: `//` to the end of the line and slash-star to
 *   star-slash. Braces are not comments in AL (they delimit objects and
 *   sections), as in stripAlNoise;
 * - a string literal `'...'` (a doubled `''` inside) is kept verbatim, case
 *   included;
 * - an identifier, bare (`[A-Za-z_][A-Za-z0-9_]*`, keywords included) or
 *   quoted (`"..."`), becomes `"` + its content lowercased + `"`: `Price`,
 *   `PRICE` and `"Price"` are one token, `"My Proc"` is `"my proc"`;
 * - a token starting with a digit (`[0-9][A-Za-z0-9_.]*`: numbers, date and
 *   time literals) is lowercased;
 * - any other non-whitespace character is one token;
 * - the tokens are joined by one space (all whitespace collapses, and
 *   `x:=1` equals `x := 1`).
 */
export function normalizeAlBody(src: string): string {
  const out: string[] = [];
  const re =
    /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|('(?:[^'\n]|'')*'?)|"([^"\n]*)"?|([A-Za-z_][A-Za-z0-9_]*)|([0-9][A-Za-z0-9_.]*)|(\S)/g;
  for (const m of src.matchAll(re)) {
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined) out.push(`"${m[2].toLowerCase()}"`);
    else if (m[3] !== undefined) out.push(`"${m[3].toLowerCase()}"`);
    else if (m[4] !== undefined) out.push(m[4].toLowerCase());
    else if (m[5] !== undefined) out.push(m[5]);
  }
  return out.join(" ");
}

interface Tok {
  /** Identifier content lowercased (quotes removed), or the token text. */
  v: string;
  raw: string;
  id: boolean;
  /** An unquoted identifier: only these are keywords. */
  bare: boolean;
  start: number;
  end: number;
}

/** Tokens of the noise-stripped text (comments and strings already blank). */
function tokenize(text: string, from: number, to: number): Tok[] {
  // A directive line (#region, #pragma) is skipped; conditionals are refused elsewhere.
  const re =
    /^[ \t]*#[^\n]*|"([^"\n]*)"|([A-Za-z_][A-Za-z0-9_]*)|([0-9][A-Za-z0-9_.]*)|(\S)/gm;
  const out: Tok[] = [];
  for (const m of text.slice(from, to).matchAll(re)) {
    if (m[0].trimStart().startsWith("#")) continue;
    const start = from + m.index!;
    const raw = m[1] ?? m[0];
    const id = m[1] !== undefined || m[2] !== undefined;
    out.push({
      v: id ? raw.toLowerCase() : m[0],
      raw,
      id,
      bare: m[2] !== undefined,
      start,
      end: start + m[0].length,
    });
  }
  return out;
}

interface Member {
  /** "object": a whole object the parser does not read (credit rules only). */
  kind: "procedure" | "trigger" | "var" | "property" | "object";
  /** Lowercased names (a var statement can declare several). */
  names: string[];
  displays: string[];
  /** Source range, attributes included. */
  start: number;
  end: number;
  /** procedure/trigger: where the normalized body starts. */
  bodyStart: number;
  test: boolean;
  /** Attribute source ranges. */
  attrs: [number, number][];
  /** var: where its section's `var` (or `protected var`) keyword starts. */
  section?: number;
}

/**
 * Object-level members of a codeunit body: properties, global var
 * statements, procedures and triggers (a procedure ends at the `end` that
 * closes its first `begin`, counting `begin`/`case` against `end`). null on
 * anything else: the caller fails closed.
 */
function codeunitMembers(text: string, d: AlDecl): Member[] | null {
  const t = tokenize(text, d.start, d.end);
  const kw = (i: number, v: string) => t[i]?.bare === true && t[i]!.v === v;
  const punct = (i: number, v: string) => t[i]?.id === false && t[i]!.v === v;
  const starts = ["procedure", "trigger", "local", "internal", "protected"];
  const out: Member[] = [];
  let k = 0;
  const skipTo = (v: string) => {
    while (k < t.length && !punct(k, v)) k++;
    return k < t.length;
  };
  while (k < t.length) {
    if (kw(k, "var") || (kw(k, "protected") && kw(k + 1, "var"))) {
      const section = t[k]!.start;
      k += kw(k, "var") ? 1 : 2;
      while (
        k < t.length && !punct(k, "[") && !kw(k, "var") &&
        !starts.some((s) => kw(k, s))
      ) {
        const s = k;
        if (!skipTo(";")) return null;
        const names: Tok[] = [];
        let j = s;
        for (; j < k && !punct(j, ":"); j++) {
          if (t[j]!.id) names.push(t[j]!);
          else if (!punct(j, ",")) return null;
        }
        if (j === k || names.length === 0) return null;
        out.push({
          kind: "var",
          names: names.map((n) => n.v),
          displays: names.map((n) => n.raw),
          start: t[s]!.start,
          end: t[k]!.end,
          bodyStart: 0,
          test: false,
          attrs: [],
          section,
        });
        k++;
      }
      continue;
    }
    const first = k;
    const attrs: [number, number][] = [];
    while (punct(k, "[")) {
      const a = k;
      if (!skipTo("]")) return null;
      attrs.push([a, k]);
      k++;
    }
    while (["local", "internal", "protected"].some((s) => kw(k, s))) k++;
    if (kw(k, "procedure") || kw(k, "trigger")) {
      const kind = t[k]!.v as "procedure" | "trigger";
      const name = t[++k];
      if (!name?.id || !punct(++k, "(")) return null;
      if (!skipTo(")")) return null;
      while (k < t.length && !kw(k, "var") && !kw(k, "begin")) {
        if (starts.some((s) => kw(k, s))) return null;
        k++;
      }
      if (k >= t.length) return null;
      const bodyStart = t[k]!.start;
      let depth = 0;
      for (; k < t.length; k++) {
        if (kw(k, "begin") || kw(k, "case")) depth++;
        else if (kw(k, "end") && --depth === 0) break;
      }
      if (k >= t.length) return null;
      k++;
      if (punct(k, ";")) k++;
      out.push({
        kind,
        names: [name.v],
        displays: [name.raw],
        start: t[first]!.start,
        end: t[k - 1]!.end,
        bodyStart,
        test: attrs.some(([a, b]) => b - a === 2 && kw(a + 1, "test")),
        attrs: attrs.map(([a, b]) => [t[a]!.start, t[b]!.end]),
      });
      continue;
    }
    if (attrs.length > 0 || k !== first) return null;
    if (t[k]!.id && punct(k + 1, "=")) {
      if (!skipTo(";")) return null;
      out.push({
        kind: "property",
        names: [t[first]!.v],
        displays: [t[first]!.raw],
        start: t[first]!.start,
        end: t[k]!.end,
        bodyStart: 0,
        test: false,
        attrs: [],
      });
      k++;
      continue;
    }
    return null;
  }
  return out;
}

interface Ref {
  v: string;
  /** Member access (`X.Name`), except `this.Name`. */
  dotted: boolean;
}

/** Identifiers a procedure's body uses, plus handler names in its attributes' strings. */
function memberRefs(src: string, text: string, m: Member): Ref[] {
  const t = tokenize(text, m.bodyStart, m.end);
  const refs: Ref[] = t.flatMap((x, i) =>
    x.id
      ? [{
        v: x.v,
        dotted: t[i - 1]?.v === "." &&
          !(t[i - 2]?.bare === true && t[i - 2]!.v === "this"),
      }]
      : []
  );
  for (const [a, b] of m.attrs) {
    for (const s of src.slice(a, b).matchAll(/'([^'\n]*)'/g)) {
      for (const n of s[1]!.split(",")) {
        if (n.trim()) refs.push({ v: n.trim().toLowerCase(), dotted: false });
      }
    }
  }
  return refs;
}

const isCode = (m: Member) => m.kind === "procedure" || m.kind === "trigger";
const isTestCodeunit = (d: AlDecl) =>
  d.kind === "codeunit" && /\bSubtype\s*=\s*Test\s*;/i.test(d.body);

/**
 * Quoted identifiers with their contents blanked (same length), so text
 * inside a name is never read as code; offsets stay those of the source.
 * A quoted plain identifier ("GetLastErrorCallStack") is that identifier
 * (Sol r5 #1): its quotes become spaces and it stays readable code.
 */
const maskQuoted = (s: string) =>
  s.replace(
    /"[^"\n]*"/g,
    (q) =>
      /^"[A-Za-z_][A-Za-z0-9_]*"$/.test(q)
        ? ` ${q.slice(1, -1)} `
        : `"${"_".repeat(q.length - 2)}"`,
  );

/**
 * The declared name of an object (quoted or bare), from the noise-stripped
 * text: its own header, the last one before its body (Sol r4 #2: never a
 * header-like text inside another object's quoted name).
 */
function objectName(text: string, d: AlDecl): string {
  const re = new RegExp(
    // Sol r5 #2: the id as written may carry leading zeros (080100).
    `\\b${d.kind}\\s+0*${d.id}\\s+(?:"([^"\\n]*)"|([A-Za-z_][A-Za-z0-9_]*))`,
    "gid",
  );
  let last: RegExpExecArray | null = null;
  for (const m of maskQuoted(text.slice(0, d.start)).matchAll(re)) last = m;
  const at = last?.indices?.[1] ?? last?.indices?.[2];
  return at ? text.slice(at[0], at[1]) : `${d.kind} ${d.id}`;
}

interface ShippedTests {
  /** Lowercased [Test] name -> "<codeunit> <name>". */
  names: Map<string, string>;
  /** Normalized body -> "<codeunit> <name>". */
  bodies: Map<string, string>;
  /** Lowercased test codeunit name -> "<id> <name>". */
  units: Map<string, string>;
  /** Test codeunit id -> "<id> <name>". */
  ids: Map<number, string>;
}

/** Every [Test] of the pristine Test app; null when one cannot be parsed. */
async function shippedTests(testDir: string): Promise<ShippedTests | null> {
  const s: ShippedTests = {
    names: new Map(),
    bodies: new Map(),
    units: new Map(),
    ids: new Map(),
  };
  for (const e of await listTree(testDir, "task", { optional: true })) {
    if (!e.path.toLowerCase().endsWith(".al")) continue;
    const src = await Deno.readTextFile(join(testDir, e.path));
    const text = stripAlNoise(src);
    for (const d of declarations(src).filter(isTestCodeunit)) {
      const ms = codeunitMembers(text, d);
      if (ms === null) return null;
      const n = objectName(text, d);
      s.units.set(n.toLowerCase(), `${d.id} ${n}`);
      s.ids.set(d.id, `${d.id} ${n}`);
      for (const m of ms.filter((x) => x.test)) {
        const label = `${d.id} ${m.displays[0]}`;
        s.names.set(m.names[0]!, label);
        s.bodies.set(normalizeAlBody(src.slice(m.bodyStart, m.end)), label);
      }
    }
  }
  return s;
}

/**
 * The shipped test codeunit a noise-stripped range names or numbers, or null.
 * A number is any integer literal equal to a shipped test codeunit id
 * (`Codeunit.Run(80010)`, `Codeunit 80010`, `Id := 80010`). Ids that are not
 * literals (arithmetic, Evaluate, a variable, an AllObj lookup) are rejected
 * outright by dynamicDispatch.
 */
function shippedUnitRef(
  text: string,
  from: number,
  to: number,
  shipped: ShippedTests,
): string | null {
  for (const t of tokenize(text, from, to)) {
    const u = t.id
      ? shipped.units.get(t.v)
      : /^\d+$/.test(t.v)
      ? shipped.ids.get(Number(t.v))
      : undefined;
    if (u) return u;
  }
  return null;
}

/**
 * Identifiers that can reach a codeunit chosen at run time, or run tests:
 * object metadata, RecordRef/Variant dispatch, sessions and tasks, test
 * runners and the test tool. Any use rejects the member (over-rejects on
 * purpose: fail closed; e.g. Variant also rejects LibraryVariableStorage
 * patterns, accepted). Defence in depth: mutant_kill builds carry no shipped
 * test codeunit at all (dropShippedTests), which closes dispatch through
 * trusted platform code (a Job Queue Entry's computed "Object ID to Run").
 */
export const DISPATCH_IDS: ReadonlySet<string> = new Set([
  "allobj",
  "allobjwithcaption",
  "codeunit metadata",
  "recordref",
  "variant",
  "startsession",
  "createtask",
  "enqueuebackgroundtask",
  "runcodeunit",
  "testrunner",
  "test method line",
  "al test suite",
]);

/**
 * Why a noise-stripped range could run a codeunit by a non-literal id, or
 * null: a DISPATCH_IDS identifier, or `Codeunit.Run(` whose first argument is
 * not exactly an integer literal or `Codeunit::<name or literal>` (so
 * `Codeunit.Run(80000 + 10)`, `Codeunit.Run(Id)` after an Evaluate, any
 * computed argument). Literal ids and names are judged by shippedUnitRef.
 */
function dynamicDispatch(
  text: string,
  from: number,
  to: number,
): string | null {
  const t = tokenize(text, from, to);
  for (const [i, x] of t.entries()) {
    if (x.id && DISPATCH_IDS.has(x.v)) {
      return `may reach a codeunit dynamically (${x.raw})`;
    }
    if (
      !(x.bare && x.v === "codeunit" && t[i + 1]?.v === "." &&
        t[i + 2]?.v === "run" && t[i + 3]?.v === "(")
    ) continue;
    const arg: Tok[] = [];
    let depth = 0;
    for (let j = i + 4; j < t.length; j++) {
      const v = t[j]!.id ? "" : t[j]!.v;
      if (v === "(") depth++;
      else if ((v === ")" && depth-- === 0) || (v === "," && depth === 0)) {
        break;
      }
      arg.push(t[j]!);
    }
    const literal = (a: Tok | undefined) =>
      a !== undefined && (a.id || /^\d+$/.test(a.v));
    const ok = (arg.length === 1 && /^\d+$/.test(arg[0]!.v)) ||
      (arg.length === 4 && arg[0]!.bare && arg[0]!.v === "codeunit" &&
        arg[1]!.v === ":" && arg[2]!.v === ":" && literal(arg[3]));
    if (!ok) return "runs a codeunit by a non-literal id";
  }
  return null;
}

/** Agent code judged by the credit rules. */
interface Judged {
  src: string;
  text: string;
  /** Candidates: procedures and triggers, or one pseudo member per unparsed object. */
  code: Member[];
  /** Globals the candidates can use (checked for shipped test codeunit types). */
  vars: Member[];
  /** Further direct violations (extraction: shipped procedures, OnRun state). */
  extra?: (m: Member, refs: Ref[]) => string | null;
}

/**
 * The credit rules (M4-17a item B) over every piece of agent test code at
 * once. First each member's own violations: its body is a normalized copy of
 * a shipped [Test] body (normalizeAlBody); it uses the name of a shipped
 * [Test] (a call, qualified or not); its text (attributes, parameters,
 * locals and body) names or numbers a shipped test codeunit
 * (shippedUnitRef: a variable or Codeunit.Run could run it whole); it uses a
 * global declared with such a type; or `extra`. Then over the call graph, by
 * name and across codeunits (member access included, all overloads): a member
 * that uses the name of a violator is one. Names over-approximate calls, so a
 * doubtful member is a violator (fail closed). Shipped library codeunits that
 * are not test codeunits stay allowed.
 */
function creditViolations(
  units: Judged[],
  shipped: ShippedTests,
): Map<Member, string> {
  const why = new Map<Member, string>();
  const all: { m: Member; refs: Ref[] }[] = [];
  for (const u of units) {
    const tainted = new Map<string, string>();
    for (const g of u.vars) {
      const unit = shippedUnitRef(u.text, g.start, g.end, shipped);
      if (unit) {
        g.names.forEach((n, i) =>
          tainted.set(
            n,
            `uses global ${g.displays[i]} of shipped test codeunit ${unit}`,
          )
        );
      }
    }
    for (const m of u.code) {
      const refs = memberRefs(u.src, u.text, m);
      all.push({ m, refs });
      const direct = ((): string | null => {
        if (m.kind !== "object") {
          const copy = shipped.bodies.get(
            normalizeAlBody(u.src.slice(m.bodyStart, m.end)),
          );
          if (copy) return `copy of shipped [Test] ${copy}`;
        }
        for (const r of refs) {
          const test = shipped.names.get(r.v);
          if (test) return `calls shipped [Test] ${test}`;
        }
        const unit = shippedUnitRef(u.text, m.start, m.end, shipped);
        if (unit) return `uses shipped test codeunit ${unit}`;
        const dyn = dynamicDispatch(u.text, m.start, m.end);
        if (dyn) return dyn;
        for (const r of refs) {
          const t = r.dotted ? undefined : tainted.get(r.v);
          if (t) return t;
        }
        return u.extra?.(m, refs) ?? null;
      })();
      if (direct) why.set(m, direct);
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    const byName = new Map<string, Member>();
    for (const v of why.keys()) {
      for (const n of v.names) if (!byName.has(n)) byName.set(n, v);
    }
    for (const { m, refs } of all) {
      if (why.has(m)) continue;
      const v = refs.map((r) => byName.get(r.v)).find((x) => x && x !== m);
      if (v) {
        why.set(m, `${why.get(v)} (via ${v.displays[0]})`);
        changed = true;
      }
    }
  }
  return why;
}

/** One shipped test codeunit the agent edited, prepared for the credit rules. */
interface Edited {
  rel: string;
  d: AlDecl;
  pSrc: string;
  pm: Member[];
  aSrc: string;
  am: Member[];
  judged: Judged;
  /** Added procedures (all overloads) and globals, by lowercased name. */
  added: Map<string, Member[]>;
  addedGlobals: Map<string, Member>;
  shippedGlobals: Map<string, Member>;
}

/**
 * Added members of one edited shipped codeunit: procedures and globals whose
 * names the shipped codeunit lacks. A use of a shipped procedure of this
 * codeunit (never carried: shipped code is not the agent's, and an edited one
 * must not run), of a shipped global the shipped OnRun trigger uses (its
 * state is not carried) or of a global declared together with a shipped one
 * makes a member uncarriable.
 */
function prepareEdited(
  rel: string,
  d: AlDecl,
  pSrc: string,
  pm: Member[],
  aSrc: string,
  am: Member[],
  notes: string[],
): Edited {
  const where = `${TEST_APP}/${rel} codeunit ${d.id}`;
  const shippedCode = new Map(
    pm.filter(isCode).map((m) => [m.names[0]!, m.displays[0]!]),
  );
  const shippedGlobals = new Map<string, Member>();
  for (const g of pm.filter((m) => m.kind === "var")) {
    for (const n of g.names) shippedGlobals.set(n, g);
  }
  const pText = stripAlNoise(pSrc);
  const onRun = new Set(
    pm.filter((m) => m.kind === "trigger").flatMap((m) =>
      memberRefs(pSrc, pText, m).map((r) => r.v)
    ),
  );
  const added = new Map<string, Member[]>();
  for (const m of am.filter(isCode)) {
    if (shippedCode.has(m.names[0]!)) continue;
    if (m.kind === "trigger") {
      notes.push(
        `${where}: added trigger ${
          m.displays[0]
        } is not carried (shipped codeunit state is not extracted)`,
      );
    } else added.set(m.names[0]!, [...added.get(m.names[0]!) ?? [], m]);
  }
  const addedGlobals = new Map<string, Member>();
  const mixed = new Set<string>();
  for (const g of am.filter((m) => m.kind === "var")) {
    const fresh = g.names.filter((n) => !shippedGlobals.has(n));
    if (fresh.length === g.names.length) {
      for (const n of fresh) addedGlobals.set(n, g);
    } else for (const n of fresh) mixed.add(n);
  }
  const extra = (_m: Member, refs: Ref[]): string | null => {
    for (const r of refs) {
      if (r.dotted || added.has(r.v)) continue;
      const code = shippedCode.get(r.v);
      if (code) return `needs shipped procedure ${code}`;
      if (mixed.has(r.v)) {
        return `needs global ${r.v}, declared together with a shipped global`;
      }
      if (!addedGlobals.has(r.v) && onRun.has(r.v)) {
        const sg = shippedGlobals.get(r.v);
        if (sg) {
          return `needs shipped global ${
            sg.displays[sg.names.indexOf(r.v)]
          }, which the shipped OnRun trigger uses`;
        }
      }
    }
    return null;
  };
  return {
    rel,
    d,
    pSrc,
    pm,
    aSrc,
    am,
    judged: {
      src: aSrc,
      text: stripAlNoise(aSrc),
      code: [...added.values()].flat(),
      vars: am.filter((m) => m.kind === "var"),
      extra,
    },
    added,
    addedGlobals,
    shippedGlobals,
  };
}

interface Extracted {
  from: number;
  tests: string[];
  text: (id: number) => string;
}

/**
 * The generated codeunit of one edited shipped codeunit: its added [Test]
 * procedures that are not violators, with every added procedure (all
 * overloads) and global they reach and the shipped globals they use
 * (pristine declarations). Codeunit properties are the pristine codeunit's,
 * Subtype = Test always.
 */
function extractFrom(
  e: Edited,
  why: ReadonlyMap<Member, string>,
  notes: string[],
): Extracted | null {
  const where = `${TEST_APP}/${e.rel} codeunit ${e.d.id}`;
  const tests: Member[] = [];
  for (const m of e.judged.code.filter((x) => x.test)) {
    const w = why.get(m);
    if (w) {
      notes.push(`${where}: added test ${m.displays[0]}: ${w}; not counted`);
    } else tests.push(m);
  }
  if (tests.length === 0) return null;
  const procs = new Set<Member>();
  const globals = new Set<Member>();
  const reach = (m: Member) => {
    if (procs.has(m)) return;
    procs.add(m);
    for (const r of memberRefs(e.aSrc, e.judged.text, m)) {
      if (r.dotted) continue;
      // A reached violator would have made m one: only clean members here.
      for (const p of e.added.get(r.v) ?? []) reach(p);
      const g = e.addedGlobals.get(r.v) ?? e.shippedGlobals.get(r.v);
      if (g) globals.add(g);
    }
  };
  tests.forEach(reach);
  const props = e.pm.filter((m) =>
    m.kind === "property" && m.names[0] !== "subtype"
  );
  return {
    from: e.d.id,
    tests: tests.map((m) => m.displays[0]!),
    text: (id) =>
      [
        `// Generated by the verdict (M4-17a): the [Test] procedures an agent added to shipped test codeunit ${e.d.id} (${TEST_APP}/${e.rel}).`,
        `codeunit ${id} "CG Extracted Tests ${id}"`,
        "{",
        "    Subtype = Test;",
        ...props.map((m) => `    ${e.pSrc.slice(m.start, m.end)}`),
        ...(globals.size > 0
          ? [
            "",
            "    var",
            ...e.pm.filter((m) => globals.has(m)).map((m) =>
              `        ${e.pSrc.slice(m.start, m.end)}`
            ),
            ...e.am.filter((m) => globals.has(m)).map((m) =>
              `        ${e.aSrc.slice(m.start, m.end)}`
            ),
          ]
          : []),
        ...e.am.filter((m) => procs.has(m)).flatMap((m) => [
          "",
          `    ${e.aSrc.slice(m.start, m.end)}`,
        ]),
        "}",
        "",
      ].join("\n"),
  };
}

// ---- H-30 run 002: agent text the lexer cannot read as the compiler does ----

/**
 * H-30 run 002: AL also ends a line at a bare CR and the Unicode line
 * separators, where stripAlNoise does not end a `//` comment, so the parser
 * would not see code the compiler does. Agent Test text with one fails closed.
 */
const ODD_EOL = /\r(?!\n)|[\u2028\u2029\u0085]/;

/**
 * Why this lexer could read agent AL text differently from the compiler, or
 * null: an ODD_EOL line end, or a multiline string literal `@'...'` (BC 26+),
 * which stripAlNoise ends at the first LF (Sol, H-30 run 002).
 */
function unreadable(src: string): string | null {
  if (ODD_EOL.test(src)) return "a line terminator other than LF or CRLF";
  if (/@\s*'/.test(src)) return "a multiline string (@'...')";
  return null;
}

/** Any install or upgrade trigger declaration (design-r2 6.1, ruling R5; Sol r7 #2). */
const LIFECYCLE_TRIGGER =
  /\btrigger\s+On(?:InstallAppPer|UpgradePer|ValidateUpgradePer|CheckPreconditionsPer)(?:Company|Database)\b/i;
const LIFECYCLE_SUBTYPE = /\bSubtype\s*=\s*(?:Install|Upgrade)\b/i;
const ISOLATION_DISABLED = /\bRequiredTestIsolation\s*=\s*Disabled\b/i;

/**
 * H-35 Test-side policy rules over the agent's Test text (new files, the
 * helper as written, edited shipped files): `unreadable_test` first (ruling
 * R9: the other rules cannot trust the lexer on such text), then, on
 * noise-stripped code, `test_lifecycle` (ruling R5) and `isolation_disabled`
 * (ruling R1), and `persistence_ref` (H-35 run 004 #1, r5 2.3:
 * persistenceRefs). Each violation reads `<rule>: Test/<path>: <detail>`.
 */
export function testPolicyViolations(
  files: Iterable<readonly [string, string]>,
): string[] {
  const out: string[] = [];
  for (const [rel, src] of [...files].sort(([a], [b]) => a < b ? -1 : 1)) {
    const where = `${TEST_APP}/${rel}`;
    const why = unreadable(src);
    if (why) {
      out.push(`unreadable_test: ${where}: ${why}`);
      continue;
    }
    // Properties are written bare: matched on the stripped code, where a
    // quoted local ("Subtype" = "Install") keeps its quotes (Sol r8). The
    // trigger declaration is matched with quoted-name text masked (Sol r7 #2).
    const code = stripAlNoise(src);
    const life = LIFECYCLE_SUBTYPE.exec(code) ??
      LIFECYCLE_TRIGGER.exec(maskQuoted(code));
    if (life) out.push(`test_lifecycle: ${where}: ${life[0]}`);
    const iso = ISOLATION_DISABLED.exec(code);
    if (iso) out.push(`isolation_disabled: ${where}: ${iso[0]}`);
    // H-35 run 004 #1 (r5 2.3): the persistence bans apply to Test text too.
    for (const d of persistenceRefs(src)) {
      out.push(`persistence_ref: ${where}: ${d}`);
    }
  }
  return out;
}

// ---- H-35 production-side policy rules (design-r2 6.2, design-r3 4; R2, R9, Q9) ----

/** A task's reviewed exceptions to the production rules (task.yml production_allow). */
export interface ProductionAllow {
  /** App ids a production app may depend on beyond the workspace and the allowlist. */
  dependencies?: readonly string[] | undefined;
  /** Banned objects allowed, kind-qualified: "table:130450", "codeunit:130450". */
  objects?: readonly string[] | undefined;
  /** Dynamic dispatch allowed by call: "Codeunit.Run", "RecordRef.Open", ... */
  dynamic?: readonly string[] | undefined;
}

/** The five Microsoft packages production may depend on (design-r2 6.2.1). */
export const PRODUCTION_DEPENDENCY_ALLOWLIST: ReadonlySet<string> = new Set([
  "8874ed3a-0643-4247-9ced-7a7002f7135d", // System
  "63ca2fa4-4f03-4f2b-a480-172fef340d3f", // System Application
  "f3552374-a1f2-4356-848e-196002525837", // Business Foundation
  "437dbf0e-84ff-417a-965d-ed2bb9650972", // Base Application
  "c1335042-3002-4257-bf8a-75c898ccb1b8", // Application
]);

/** Test-framework, metadata and installed-app objects (design-r2 6.2.2, ids from the locked symbols). */
const BANNED_OBJECTS: readonly (readonly [string, number, string])[] = [
  ["table", 130451, "AL Test Suite"],
  ["table", 130450, "Test Method Line"],
  ["codeunit", 130450, "Test Runner - Isol. Codeunit"],
  ["codeunit", 130451, "Test Runner - Isol. Disabled"],
  ["codeunit", 130454, "Test Runner - Mgt"],
  ["codeunit", 130456, "Test Suite Mgt."],
  ["table", 2000000137, "CodeUnit Metadata"],
  ["table", 2000000038, "AllObj"],
  ["table", 2000000058, "AllObjWithCaption"],
  ["table", 2000000071, "Object Metadata"],
  ["table", 2000000207, "Application Object Metadata"],
  ["table", 2000000153, "NAV App Installed App"],
  ["table", 2000000206, "Published Application"],
  ["table", 2000000212, "Installed Application"],
];

const OBJECT_TYPE =
  "Record|Codeunit|Page|Report|Query|XmlPort|Database|Table|Interface";
/** A CalcFormula function's table argument position (r2 6.2.2; orch Sol r1 #2). */
const CALC_FORMULA = "count|lookup|exist|sum|average|min|max";
/**
 * A banned object by name in an object-typed position: after an object type
 * keyword (`Record "X"`, `Codeunit "X"`), after `Type::`, as a TableNo,
 * SourceTable or TableRelation value, or as a CalcFormula table
 * (`count("X" where ...)`). Quoted or bare, case-insensitive.
 * H-35 run 004 Sol r1 H1: a dotted name (`System.IO."File Management"`) is
 * read whole; nameRefs gives the names it may denote.
 */
const NAME_SEG = `(?:"[^"\\n]+"|[A-Za-z_][A-Za-z0-9_]*)`;
const NAME_CHAIN = `(${NAME_SEG}(?:\\s*\\.\\s*${NAME_SEG})*)`;
const NAME_REF = new RegExp(
  `(?:\\b(?:${OBJECT_TYPE})\\s*::\\s*|\\b(?:${OBJECT_TYPE})\\s+)${NAME_CHAIN}|(?:\\b(?:TableNo|SourceTable|TableRelation)\\s*=\\s*|\\b(?:${CALC_FORMULA})\\s*\\(\\s*)${NAME_CHAIN}`,
  "gi",
);
/**
 * H-35 run 004 Sol r1 H1: the object names a NAME_REF match may denote
 * (lowercase, unquoted). After an object type or `Type::` the last segment
 * (namespaces precede it); in a table property or CalcFormula every segment
 * (a field may follow the table, a namespace precede it: fail closed).
 */
function nameRefs(at: (i: number) => string): string[] {
  const segs = (s: string) =>
    [...s.matchAll(/"[^"\n]*"|[A-Za-z_]\w*/g)].map((n) => unquote(n[0]));
  return at(1) ? segs(at(1)).slice(-1) : segs(at(2));
}
/**
 * A number in an object-id position, with the object kind it names (Sol r1
 * #7: a method's integer argument is not one, and a grant is per kind): a
 * table by `Database::<n>`, `Record <n>`, `Table <n>` or a TableNo-style
 * property; a codeunit by `Codeunit::<n>`, `Codeunit <n>` or the static
 * `Codeunit.Run(<n>)`. RecordRef.Open(<n>) is a table (below).
 */
const ID_REFS: readonly (readonly [RegExp, string])[] = [
  [
    new RegExp(
      `\\b(?:Database\\s*::\\s*|Record\\s+|Table\\s+|(?:TableNo|SourceTable|TableRelation)\\s*=\\s*|(?:${CALC_FORMULA})\\s*\\(\\s*)(\\d+)\\b`,
      "gi",
    ),
    "table",
  ],
  [
    /\b(?:Codeunit\s*::\s*|Codeunit\s+|Codeunit\s*\.\s*(?:Run|RunModal)\s*\(\s*)(\d+)\b/gi,
    "codeunit",
  ],
];
/** A static object call and its first argument. */
const STATIC_CALL =
  /\b(Codeunit|Page|Report|Xmlport|Query)\s*\.\s*(Run|RunModal|Execute|SaveAs|SaveAsCsv|SaveAsPdf|SaveAsXml|Print|Open)\s*\(\s*([^,)]*)/gi;
/**
 * Every Open call with its first argument, whatever the receiver (a RecordRef
 * bare, quoted, an array element, or a variable named like an object type,
 * Sol r6). An Open with no argument (Query.Open()) is skipped; a static call
 * matched here and by STATIC_CALL is reported by both, never by neither.
 */
const OPEN_CALL = /\.\s*Open\s*\(\s*([^,)]*)/gi;
/** An argument that names its object: an integer literal or `Type::<name or literal>`. */
const LITERAL_OBJECT =
  /^(?:\d+|(?:Codeunit|Page|Report|Xmlport|Query|Database)\s*::\s*(?:"[^"\n]+"|[A-Za-z_][A-Za-z0-9_]*|\d+))\s*$/i;
const TEST_ONLY_TYPE =
  /:\s*(TestPage|TestRequestPage|TestAction|TestField|TestFilter|TestPart|TestHttpRequestMessage|TestHttpResponseMessage)\b/i;
const TEST_SUBTYPE = /\bSubtype\s*=\s*(Test|TestRunner)\b/i;
const DETECTION_MEMBER =
  /\.\s*Callstack\b|\bGetLastErrorCallStack\b|\bNavApp\s*\.|\bModuleInfo\b/i;

const unquote = (n: string) => n.replace(/^"|"$/g, "").toLowerCase();

/**
 * Matches of `re` on `masked` (maskQuoted of `code`), read back from `code` at
 * the same offsets (Sol r4 #1: text inside a name is never code).
 */
function scanner(code: string, masked: string) {
  return function* (re: RegExp) {
    for (const m of masked.matchAll(new RegExp(re.source, re.flags + "d"))) {
      const at = (i: number) => {
        const r = m.indices![i];
        return r ? code.slice(r[0], r[1]) : "";
      };
      yield {
        all: code.slice(m.index!, m.index! + m[0].length),
        at,
        index: m.index!,
        end: m.index! + m[0].length,
      };
    }
  };
}

// ---- H-35 run 004 #1 (r5 2.3): layer 3 persistence bans, production and Test ----

/**
 * Objects only reachable OnPrem (r5 2.3; ids not in the repo's symbol data,
 * Base App and System Application as published): resolved like
 * BANNED_OBJECTS, by name in object position and by id in id position.
 * Environment Information is banned whole (its OnPrem members are not
 * listed). No production_allow grant applies.
 */
const PERSISTENCE_OBJECTS: readonly (readonly [string, number, string])[] = [
  ["codeunit", 419, "File Management"],
  ["codeunit", 457, "Environment Information"],
  ["table", 2000000022, "File"],
];
const PERSISTENCE_TYPES =
  "File|FileUpload|DotNet|HttpClient|HttpRequestMessage|HttpResponseMessage|HttpContent|HttpHeaders|WebServiceActionContext";
/**
 * A banned type in type position: after a single `:` (never `::` or `:=`),
 * through `array[..] of`, or as a `List of [..]` / `Dictionary of [..]` argument.
 */
const PERSISTENCE_TYPE = new RegExp(
  `(?:(?<!:):(?![:=])\\s*(?:array\\s*\\[[^\\]]*\\]\\s*of\\s+)?|\\bof\\s*\\[[^\\]]*?)\\b(${PERSISTENCE_TYPES})\\b`,
  "gi",
);
/** Banned by name wherever it is code (r5 2.3 .NET, file and network classes). */
const PERSISTENCE_NAMES: readonly RegExp[] = [
  /\bDotNet\b/gi,
  /\bassembly\s*\(/gi,
  // A static File method (File.Create, File.Download, ...), never a member.
  /(?<!\.\s*)(?<!\w)File\s*\.\s*[A-Za-z_]\w*/gi,
  // A global method bare or with its system receiver, never another member.
  /(?:(?<!\.\s*)(?<!\w)|\b(?:System|Session|File)\s*\.\s*)(?:UploadIntoStream|DownloadFromStream|TemporaryPath|ApplicationPath|Hyperlink|StartSession)\b/gi,
  /\bTaskScheduler\s*\.\s*CreateTask\b/gi,
];
/**
 * A report or query export call, with its receiver. Argument shape: the call
 * is a file export unless one of its arguments is a bare name declared in
 * scope as InStream/OutStream (Report.SaveAs(Id, Params, Format, OutS) and
 * the Query stream overloads are allowed; SaveAsPdf(Id, 'C:\x.pdf') and any
 * path expression are not). H-35 run 004 Sol r1 M1: a receiver declared in
 * scope as a Codeunit is a user method, not an export.
 */
const SAVE_AS_CALL =
  /(?:([A-Za-z_]\w*|"[^"\n]*")\s*)?\.\s*SaveAs(?:Pdf|Excel|Word|Html|Xml|Csv)?\s*\(/gi;
/** H-35 run 004 Sol r1 H2: `A, "B": Type`, with the type's first word. */
const VAR_DECL =
  /(?<![\w"])((?:"[^"\n]*"|[A-Za-z_]\w*)(?:\s*,\s*(?:"[^"\n]*"|[A-Za-z_]\w*))*)\s*:\s*([A-Za-z_]\w*)/gi;

/**
 * H-35 run 004 Sol r1 H2: procedure and trigger ranges of `flat` (the code
 * with every quoted name blank): header keyword, its body's `begin`, and the
 * `end` closing it (begin/case counted against end). A header with no body
 * before the next header (an interface method) is skipped.
 */
function routineRanges(
  flat: string,
): { start: number; begin: number; end: number }[] {
  const heads = [...flat.matchAll(/\b(?:procedure|trigger)\b/gi)].map((m) =>
    m.index
  );
  const out: { start: number; begin: number; end: number }[] = [];
  heads.forEach((start, i) => {
    const re = /\b(begin|case|end)\b/gi;
    re.lastIndex = start;
    let m = re.exec(flat);
    if (
      !m || m[1]!.toLowerCase() !== "begin" ||
      m.index > (heads[i + 1] ?? Infinity)
    ) return;
    const begin = m.index;
    let depth = 0;
    let end = flat.length;
    for (; m; m = re.exec(flat)) {
      if (m[1]!.toLowerCase() !== "end") depth++;
      else if (--depth === 0) {
        end = m.index + 3;
        break;
      }
    }
    out.push({ start, begin, end });
  });
  return out;
}
/** A static Xmlport.Import/Export: allowed only with a declared stream argument. */
const XMLPORT_CALL = /\bXmlport\s*\.\s*(?:Import|Export)\s*\(/gi;
/** A member access with its receiver (for Filename on an Xmlport variable). */
const FILENAME_ACCESS = /("[^"\n]*"|[A-Za-z_]\w*)\s*\.\s*Filename\b/gi;
/** A procedure scope attribute; its argument is read from the source. */
const SCOPE_ATTR = /\[\s*Scope\s*\(([^)\]]*)\)\s*\]/gi;

/**
 * Names (lowercase, unquoted) this file declares with a type matching `type`:
 * `A, "B": OutStream`, parameters included. Structure is read on the masked
 * text, so a quoted name cannot fake a declaration.
 */
function declaredNames(
  scan: ReturnType<typeof scanner>,
  type: string,
): Set<string> {
  const re = new RegExp(
    `(?<![\\w"])((?:"[^"\\n]*"|[A-Za-z_]\\w*)(?:\\s*,\\s*(?:"[^"\\n]*"|[A-Za-z_]\\w*))*)\\s*:\\s*(?:${type})\\b`,
    "gi",
  );
  const out = new Set<string>();
  for (const m of scan(re)) {
    for (const n of m.at(1).matchAll(/"[^"\n]*"|[A-Za-z_]\w*/g)) {
      out.add(unquote(n[0]));
    }
  }
  return out;
}

/** The top-level arguments (code text) of a call whose `(` ends at `from`, and its end. */
function callArgs(
  code: string,
  masked: string,
  from: number,
): { args: string[]; end: number } {
  const args: string[] = [];
  let depth = 0;
  let start = from;
  let i = from;
  for (; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (c === ")" || (c === "," && depth === 0)) {
      args.push(code.slice(start, i).trim());
      start = i + 1;
      if (c === ")") return { args, end: i + 1 };
    }
  }
  args.push(code.slice(start, i).trim());
  return { args, end: i };
}

/**
 * H-35 run 004 #1 (r5 2.3): the persistence bans in one readable AL file, as
 * details: banned types in type position, DotNet and assembly declarations,
 * static File methods, the global file, link and session methods,
 * TaskScheduler.CreateTask, file exports by argument shape (SAVE_AS_CALL,
 * XMLPORT_CALL, Filename on an Xmlport variable), PERSISTENCE_OBJECTS by name
 * and id, and any `[Scope('OnPrem')]` declaration. Matched on the
 * noise-stripped code with quoted identifiers masked; details from the source.
 * Scope (owner, l4-scope addendum 4): OnPrem-scoped members of the Base and
 * System Application called by name are not covered by L3; the L1 Cloud
 * compile covers them (a symbol-derived list is follow-up H-38).
 */
function persistenceRefs(src: string): string[] {
  const code = stripAlNoise(src);
  const masked = maskQuoted(code);
  const scan = scanner(code, masked);
  const found = new Set<string>();
  for (const m of scan(PERSISTENCE_TYPE)) found.add(`type ${m.at(1)}`);
  for (const re of PERSISTENCE_NAMES) {
    for (const m of scan(re)) found.add(m.all.trim());
  }
  // H-35 run 004 Sol r1 H2: a name's type in scope at `at`: the enclosing
  // routine's parameters and locals, else its object's globals (outside any
  // routine). Outside a routine body or an object: unknown (fail closed).
  const routines = routineRanges(
    code.replace(/"[^"\n]*"/g, (q) => " ".repeat(q.length)),
  );
  const objects = declarations(src);
  const decls = [...scan(VAR_DECL)].map((m) => ({
    index: m.index,
    names: [...m.at(1).matchAll(/"[^"\n]*"|[A-Za-z_]\w*/g)].map((n) =>
      unquote(n[0])
    ),
    type: m.at(2).toLowerCase(),
  }));
  const typeOf = (name: string, at: number): string | undefined => {
    const r = routines.find((x) => x.begin < at && at < x.end);
    const o = objects.find((x) => x.start <= at && at <= x.end);
    if (!r || !o) return undefined;
    const local = decls.find((d) =>
      d.index >= r.start && d.index < r.begin && d.names.includes(name)
    );
    return (local ??
      decls.find((d) =>
        d.index >= o.start && d.index < o.end && d.names.includes(name) &&
        !routines.some((x) => d.index >= x.start && d.index < x.end)
      ))?.type;
  };
  const BARE = /^(?:"[^"\n]*"|[A-Za-z_]\w*)$/;
  const fileCall = (m: { index: number; end: number }) => {
    const { args, end } = callArgs(code, masked, m.end);
    const stream = (a: string) =>
      BARE.test(a) &&
      /^(?:instream|outstream)$/.test(typeOf(unquote(a), m.end) ?? "");
    if (!args.some(stream)) {
      found.add(`${src.slice(m.index, end).trim()} (no stream argument)`);
    }
  };
  for (const m of scan(SAVE_AS_CALL)) {
    // H-35 run 004 Sol r1 M1: a bare receiver (not a member) declared in
    // scope as a Codeunit is a user method named SaveAs*.
    const recv = m.at(1);
    if (
      recv && !masked.slice(0, m.index).trimEnd().endsWith(".") &&
      typeOf(unquote(recv), m.end) === "codeunit"
    ) continue;
    fileCall(m);
  }
  for (const m of scan(XMLPORT_CALL)) {
    // Sol r7 #1: a quoted receiver ("Xmlport") is a variable, not the static.
    if (code[m.index - 1] !== '"') fileCall(m);
  }
  const xmlports = declaredNames(scan, "Xmlport");
  for (const m of scan(FILENAME_ACCESS)) {
    if (xmlports.has(unquote(m.at(1)))) found.add(m.all.trim());
  }
  const byName = new Map(
    PERSISTENCE_OBJECTS.map(([k, id, n]) => [n.toLowerCase(), `${k} ${id}`]),
  );
  for (const m of scan(NAME_REF)) {
    for (const n of nameRefs(m.at)) {
      const hit = byName.get(n);
      if (hit) found.add(`${m.all.trim()} (${hit})`);
    }
  }
  const byId = (text: string, kind: string, id: number) => {
    if (PERSISTENCE_OBJECTS.some(([k, b]) => k === kind && b === id)) {
      found.add(`${text.trim()} (${kind} ${id})`);
    }
  };
  for (const [re, kind] of ID_REFS) {
    for (const m of scan(re)) byId(m.all, kind, Number(m.at(1)));
  }
  for (const m of scan(OPEN_CALL)) {
    if (/^\d+$/.test(m.at(1).trim())) byId(m.all, "table", Number(m.at(1)));
  }
  // The scope is a string literal, blanked in the code: read from the source.
  for (const m of masked.matchAll(SCOPE_ATTR)) {
    const text = src.slice(m.index, m.index + m[0].length);
    if (/'\s*OnPrem\s*'/i.test(text)) found.add(text);
  }
  return [...found];
}

/**
 * H-35 production-side rules over every production app of a workspace (the
 * Test app never): `dependency_not_allowed` (app.json), then per .al file
 * `unreadable` first (ruling R9), then on noise-stripped code
 * `test_detection_ref` (banned objects by name and id, test-only types, a
 * test subtype, call-stack and app-identity members) and
 * `dynamic_object_access`, and `persistence_ref` (H-35 run 004 #1, r5 2.3:
 * persistenceRefs, no grant). `allow` is the task's reviewed grant. Each reads
 * `<rule>: <app>/<path>: <detail>`. Shipped production has no occurrence
 * (design-r2 6.2.5), so the rules apply to every occurrence.
 */
export async function productionPolicyViolations(
  dir: string,
  apps: readonly StagedApp[],
  allow: ProductionAllow = {},
): Promise<string[]> {
  const out: string[] = [];
  const allowedDeps = new Set(
    [...PRODUCTION_DEPENDENCY_ALLOWLIST, ...allow.dependencies ?? []].map((
      id,
    ) => id.toLowerCase()),
  );
  const allowedObjects = new Set(
    (allow.objects ?? []).map((o) => o.toLowerCase()),
  );
  const allowedDynamic = new Set(
    (allow.dynamic ?? []).map((d) => d.toLowerCase()),
  );
  const banned = BANNED_OBJECTS.filter(([kind, id]) =>
    !allowedObjects.has(`${kind}:${id}`)
  );
  const bannedByName = new Map(
    banned.map(([kind, id, name]) => [name.toLowerCase(), `${kind} ${id}`]),
  );
  for (const app of apps) {
    if (app.folder === TEST_APP) continue;
    for (const id of app.external) {
      if (!allowedDeps.has(id.toLowerCase())) {
        out.push(`dependency_not_allowed: ${app.folder}/app.json: ${id}`);
      }
    }
    for (const e of await listTree(join(dir, app.folder), "task")) {
      if (!e.path.toLowerCase().endsWith(".al")) continue;
      const where = `${app.folder}/${e.path}`;
      const src = await Deno.readTextFile(
        join(dir, app.folder, ...e.path.split("/")),
      );
      const why = unreadable(src);
      if (why) {
        out.push(`unreadable: ${where}: ${why}`);
        continue;
      }
      const code = stripAlNoise(src);
      const masked = maskQuoted(code);
      const scan = scanner(code, masked);
      const found = new Set<string>();
      const ref = (detail: string) =>
        found.add(`test_detection_ref: ${where}: ${detail}`);
      for (const m of scan(NAME_REF)) {
        for (const n of nameRefs(m.at)) {
          const hit = bannedByName.get(n);
          if (hit) ref(`${m.all.trim()} (${hit})`);
        }
      }
      const bannedId = (text: string, kind: string, id: number) => {
        if (banned.some(([k, b]) => k === kind && b === id)) {
          ref(`${text.trim()} (${kind} ${id})`);
        }
      };
      for (const [re, kind] of ID_REFS) {
        for (const m of scan(re)) bannedId(m.all, kind, Number(m.at(1)));
      }
      for (const re of [TEST_ONLY_TYPE, TEST_SUBTYPE, DETECTION_MEMBER]) {
        const m = re.exec(masked);
        if (m) ref(code.slice(m.index, m.index + m[0].length).trim());
      }
      const dynamic = (call: string, arg: string) => {
        if (allowedDynamic.has(call.toLowerCase())) return;
        // No argument names no object (Query.Open()).
        if (arg.trim() === "" || LITERAL_OBJECT.test(arg.trim())) return;
        found.add(
          `dynamic_object_access: ${where}: ${call}(${arg.trim() || "..."})`,
        );
      };
      for (const m of scan(STATIC_CALL)) {
        // Sol r7 #1: a receiver quoted in the source ("Query") is a variable,
        // an instance call that OPEN_CALL checks, never a static one.
        if (code[m.index - 1] === '"') continue;
        dynamic(`${m.at(1)}.${m.at(2)}`, m.at(3));
      }
      // Sol r3 #1: any receiver (a RecordRef bare, quoted, an array element
      // or anything else): an Open with an object argument names its object.
      for (const m of scan(OPEN_CALL)) {
        const arg = m.at(1).trim();
        if (arg === "") continue;
        dynamic("RecordRef.Open", arg);
        if (/^\d+$/.test(arg)) bannedId(m.all, "table", Number(arg));
      }
      for (const d of persistenceRefs(src)) {
        found.add(`persistence_ref: ${where}: ${d}`);
      }
      out.push(...found);
    }
  }
  return out;
}

/** One member standing for a whole object the parser does not read (names taint its users). */
const pseudoMember = (text: string, d: AlDecl): Member => {
  const n = objectName(text, d);
  return {
    kind: "object",
    names: [n.toLowerCase()],
    displays: [n],
    start: d.start,
    end: d.end,
    bodyStart: d.start,
    test: false,
    attrs: [],
  };
};

/** A new Test file's objects, prepared for the credit rules. */
interface NewFile {
  rel: string;
  src: string;
  judged: Judged;
  /** Parsed codeunits (their violators are removed). */
  codeunits: { d: AlDecl; code: Member[]; vars: Member[] }[];
}

/**
 * M4-17a items A and B. New Test files: every procedure or trigger the credit
 * rules reject is REMOVED from the verdict copy (never run, never counted);
 * a file whose structure would change by the removal keeps its text and its
 * test codeunits are excluded instead; an unparseable test codeunit is
 * excluded (not run, not counted); a file without violators stays byte for
 * byte. Edited shipped files: the [Test] procedures the agent added (names
 * the shipped codeunit lacks, case-insensitive, quoted or not) that are not
 * violators go to a generated test codeunit in Test/CGExtracted/, ids from
 * HARNESS_EXTRACTED_TEST_RANGE in order of the shipped codeunit id; the
 * agent's edits to properties, triggers and shipped procedures are never
 * carried. Fails closed (nothing generated, a note) when a workspace object
 * is in the range, or (all agent tests excluded) when a shipped test
 * codeunit cannot be parsed. H-35 (ruling Q4): an edited shipped file without
 * a test codeunit (`asWritten`, the helper) is agent code like a new file.
 * Returns the notes and the excluded codeunit ids.
 */
async function applyCreditRules(
  pristine: string,
  out: string,
  apps: StagedApp[],
  edited: ReadonlyMap<string, string>,
  newFiles: readonly string[],
  asWritten: readonly string[],
): Promise<{ notes: string[]; excluded: number[]; rejected: Set<string> }> {
  const notes: string[] = [];
  const excluded: number[] = [];
  /**
   * Submitted [Test] procedures the credit rules keep from counting (Sol r1
   * #8, r2 #4), as `<codeunit>:<procedure>` (lower case; `s<id>:` for a
   * procedure added to shipped codeunit <id>), so none is counted twice.
   */
  const rejected = new Set<string>();
  const testOut = join(out, TEST_APP);
  // Sol r3 #3: every [Test] procedure added to a shipped test codeunit, read
  // by declaration (no member parse, so no path can skip it). The ones never
  // extracted are credit-excluded, whatever kept them out.
  const addedShipped = new Set<string>();
  const extracted = new Set<string>();
  const procName = (n: string) => n.replace(/^"|"$/g, "").toLowerCase();
  for (const [rel, aSrc] of edited) {
    const pDecls = declarations(
      await Deno.readTextFile(join(pristine, TEST_APP, ...rel.split("/"))),
    );
    for (const a of declarations(aSrc)) {
      const p = pDecls.find((x) => x.kind === a.kind && x.id === a.id);
      if (!p || !isTestCodeunit(p)) continue;
      const had = new Set(
        [...p.body.matchAll(TEST_PROC)].map((m) => procName(m[1] ?? m[2]!)),
      );
      for (const m of a.body.matchAll(TEST_PROC)) {
        const n = procName(m[1] ?? m[2]!);
        if (!had.has(n)) addedShipped.add(`s${a.id}:${n}`);
      }
    }
  }
  const finish = () => {
    for (const k of addedShipped) if (!extracted.has(k)) rejected.add(k);
    return { notes, excluded, rejected };
  };
  const shipped = await shippedTests(join(pristine, TEST_APP));
  if (shipped === null) {
    for (
      const t of await addedTestCodeunits(join(pristine, TEST_APP), testOut)
    ) {
      excluded.push(t.codeunit);
    }
    notes.push(
      "credit rules: a shipped test codeunit could not be parsed; no agent test is run or counted",
    );
    return finish();
  }

  // Unreadable agent text never gets here: it is an unreadable_test
  // violation (testPolicyViolations, H-35 ruling R9).
  const agentFiles = [...newFiles, ...asWritten].sort();

  const fresh: NewFile[] = [];
  for (const rel of agentFiles) {
    const src = await Deno.readTextFile(join(testOut, ...rel.split("/")));
    const text = stripAlNoise(src);
    const f: NewFile = {
      rel,
      src,
      judged: { src, text, code: [], vars: [] },
      codeunits: [],
    };
    for (const d of declarations(src)) {
      if (d.end === 0) continue; // a header without a body
      // A TestRunner codeunit is not parsed: its pseudo member is rejected
      // (DISPATCH_IDS) and cannot be removed, so no agent test runs.
      const ms = d.kind === "codeunit" &&
          !/\bSubtype\s*=\s*TestRunner\b/i.test(d.body)
        ? codeunitMembers(text, d)
        : null;
      if (ms === null) {
        f.judged.code.push(pseudoMember(text, d));
        if (isTestCodeunit(d)) {
          excluded.push(d.id);
          notes.push(
            `${TEST_APP}/${rel} codeunit ${d.id}: could not be parsed for the credit rules; its tests are not run or counted`,
          );
        }
        continue;
      }
      const code = ms.filter(isCode);
      const vars = ms.filter((m) => m.kind === "var");
      f.judged.code.push(...code);
      f.judged.vars.push(...vars);
      f.codeunits.push({ d, code, vars });
    }
    fresh.push(f);
  }

  const shippedEdits: Edited[] = [];
  for (const [rel, aSrc] of [...edited].sort(([a], [b]) => a < b ? -1 : 1)) {
    const where = `${TEST_APP}/${rel}`;
    if (CONDITIONAL_DIRECTIVE.test(aSrc)) {
      notes.push(
        `${where}: preprocessor conditionals; added procedures not extracted`,
      );
      continue;
    }
    const pSrc = await Deno.readTextFile(
      join(pristine, TEST_APP, ...rel.split("/")),
    );
    const pDecls = declarations(pSrc);
    const aDecls = declarations(aSrc);
    for (const a of aDecls) {
      if (!pDecls.some((p) => p.kind === a.kind && p.id === a.id)) {
        notes.push(
          `${where}: ${a.kind} ${a.id} is not in the shipped file and is not carried (a new object belongs in a new file)`,
        );
      }
    }
    for (const p of pDecls.filter(isTestCodeunit)) {
      const a = aDecls.find((x) => x.kind === "codeunit" && x.id === p.id);
      if (!a) continue;
      // Parsed by shippedTests already.
      const pm = codeunitMembers(stripAlNoise(pSrc), p)!;
      const am = codeunitMembers(stripAlNoise(aSrc), a);
      if (am === null) {
        notes.push(
          `${where} codeunit ${p.id}: the agent's version could not be parsed; added procedures not extracted`,
        );
        continue;
      }
      shippedEdits.push(prepareEdited(rel, p, pSrc, pm, aSrc, am, notes));
    }
  }

  const why = creditViolations(
    [
      ...fresh.map((f) => f.judged),
      ...shippedEdits.map((e) => e.judged),
    ],
    shipped,
  );
  // A rejected member that cannot be removed (a table or extension trigger,
  // an unparsed codeunit) can fire from any test (an Insert(true), a
  // RecordRef): fail closed, no agent test runs or counts.
  const stuck = [...why].filter(([m]) => m.kind === "object");
  if (stuck.length > 0) {
    for (const f of fresh) {
      for (const d of declarations(f.src).filter(isTestCodeunit)) {
        if (!excluded.includes(d.id)) excluded.push(d.id);
      }
    }
    notes.push(
      `credit rules: ${
        stuck.map(([m, w]) => `${m.displays[0]}: ${w}`).join("; ")
      }; it cannot be removed, so no agent test is run or counted`,
    );
    return finish();
  }

  for (const f of fresh) {
    const cuts: { start: number; end: number }[] = [];
    for (const { d, code, vars } of f.codeunits) {
      for (const m of code) {
        const w = why.get(m);
        if (!w) continue;
        cuts.push(m);
        if (m.test) rejected.add(`${d.id}:${m.names[0]}`);
        notes.push(
          `${TEST_APP}/${f.rel} codeunit ${d.id}: ${
            m.displays[0]
          }: ${w}; removed (not run, not counted)`,
        );
      }
      // A global typed as a shipped test codeunit: every member using it was
      // just removed (creditViolations), and it would dangle in a build
      // without the shipped tests. Cut it; an emptied section loses `var`.
      const tainted = vars.filter((g) =>
        shippedUnitRef(f.judged.text, g.start, g.end, shipped) !== null
      );
      for (const g of tainted) {
        notes.push(
          `${TEST_APP}/${f.rel} codeunit ${d.id}: global ${
            g.displays.join(", ")
          }: typed as a shipped test codeunit; removed`,
        );
      }
      const sections = new Map<number, Member[]>();
      for (const g of vars) {
        sections.set(g.section!, [...sections.get(g.section!) ?? [], g]);
      }
      for (const [start, gs] of sections) {
        if (gs.every((g) => tainted.includes(g))) {
          cuts.push({ start, end: gs.at(-1)!.end });
        } else cuts.push(...gs.filter((g) => tainted.includes(g)));
      }
    }
    if (cuts.length === 0) continue;
    let text = f.src;
    for (const m of cuts.sort((a, b) => b.start - a.start)) {
      text = text.slice(0, m.start) + text.slice(m.end);
    }
    const shape = (s: string) =>
      declarations(s).map((d) => `${d.kind} ${d.id}`).join(",");
    if (shape(text) !== shape(f.src)) {
      // Removal would change the file's objects (unbalanced braces): keep it, run none of its tests.
      for (const { d } of f.codeunits) {
        if (isTestCodeunit(d)) excluded.push(d.id);
      }
      notes.push(
        `${TEST_APP}/${f.rel}: removing the rejected procedures would change its objects; its tests are not run or counted`,
      );
      continue;
    }
    await Deno.writeTextFile(join(testOut, ...f.rel.split("/")), text);
  }

  const found = shippedEdits.map((e) => extractFrom(e, why, notes))
    .filter((x): x is Extracted => x !== null);
  if (found.length === 0) return finish();
  const range = HARNESS_EXTRACTED_TEST_RANGE;
  const taken: string[] = [];
  for (const app of apps) {
    for (const o of await alObjects(join(out, app.folder))) {
      if (o.kind === "codeunit" && inRange(o.id, range)) {
        taken.push(`${app.folder}/${o.file}: codeunit ${o.id}`);
      }
    }
  }
  if (taken.length > 0) {
    notes.push(
      `extraction: the reserved extraction range ${range.start}-${range.end} is used (${
        taken.join("; ")
      }); no added test procedure is extracted`,
    );
    return finish();
  }
  found.sort((a, b) => a.from - b.from);
  for (const [i, x] of found.entries()) {
    const id = range.start + i;
    const dest = join(
      testOut,
      EXTRACTED_TEST_DIR,
      `Extracted${id}.Codeunit.al`,
    );
    if (id > range.end || await exists(dest)) {
      notes.push(
        `extraction: no free generated codeunit for shipped codeunit ${x.from}; its added tests (${
          x.tests.join(", ")
        }) are not extracted`,
      );
      continue;
    }
    const text = x.text(id);
    // The generated file is not id-validated like agent files: it must
    // declare exactly its own codeunit (carried text cannot smuggle an object).
    const decls = declarations(text);
    if (decls.length !== 1 || decls[0]!.id !== id) {
      notes.push(
        `extraction: the added tests of shipped codeunit ${x.from} would not form one codeunit (unbalanced braces); not extracted`,
      );
      continue;
    }
    await validatedDest(join(dest, ".."));
    await Deno.writeTextFile(dest, text);
    for (const t of x.tests) extracted.add(`s${x.from}:${procName(t)}`);
  }
  return finish();
}

/**
 * Removes every shipped test codeunit from the verdict copy's Test app
 * (dropShippedTests). Throws ValidationError (a task defect, never the
 * agent's) when a shipped test codeunit shares its file with another object
 * or a kept shipped object references a removed one (the build would break).
 */
async function dropShippedTestCodeunits(
  pristine: string,
  out: string,
): Promise<void> {
  const testDir = join(pristine, TEST_APP);
  const shipped = await shippedTests(testDir);
  if (shipped === null) {
    throw new ValidationError(
      "a shipped test codeunit could not be parsed; mutant_kill cannot leave the shipped tests out",
      [TEST_APP],
    );
  }
  const drop: string[] = [];
  const kept: string[] = [];
  for (const e of await listTree(testDir, "task", { optional: true })) {
    if (!e.path.toLowerCase().endsWith(".al")) continue;
    const decls = declarations(await Deno.readTextFile(join(testDir, e.path)));
    const tests = decls.filter(isTestCodeunit).length;
    if (tests === 0) kept.push(e.path);
    else if (tests === decls.length) drop.push(e.path);
    else {
      throw new ValidationError(
        `${TEST_APP}/${e.path}: a shipped test codeunit shares its file with other objects; mutant_kill cannot leave it out`,
        [e.path],
      );
    }
  }
  for (const rel of kept) {
    const text = stripAlNoise(
      await Deno.readTextFile(join(testDir, ...rel.split("/"))),
    );
    const unit = shippedUnitRef(text, 0, text.length, shipped);
    if (unit) {
      throw new ValidationError(
        `${TEST_APP}/${rel} references shipped test codeunit ${unit}; mutant_kill cannot leave the shipped tests out`,
        [rel],
      );
    }
  }
  for (const rel of drop) {
    await Deno.remove(join(out, TEST_APP, ...rel.split("/")));
  }
}

/**
 * An agent Test object with the kind and id or name of a shipped Test object
 * (M4-17a run 002 F2): the agent's own workspace could not compile it, and a
 * mutant_kill build that leaves the shipped tests out must not either.
 */
async function shippedCollisions(
  pristineTest: string,
  out: string,
  newFiles: readonly string[],
  /** H-35 Sol r2 #2: the helper as written; its own shipped objects are not collisions. */
  asWritten: readonly string[] = [],
): Promise<string[]> {
  /** kind#id -> label, and kind:name -> the kind#id of the shipped object of that name. */
  const shipped = new Map<string, string>();
  const named = new Map<string, string>();
  for (const e of await listTree(pristineTest, "task", { optional: true })) {
    if (!e.path.toLowerCase().endsWith(".al")) continue;
    const src = await Deno.readTextFile(join(pristineTest, e.path));
    const text = stripAlNoise(src);
    for (const d of declarations(src)) {
      shipped.set(
        `${d.kind}#${d.id}`,
        `${d.kind} ${d.id} ${objectName(text, d)}`,
      );
      named.set(
        `${d.kind}:${objectName(text, d).toLowerCase()}`,
        `${d.kind}#${d.id}`,
      );
    }
  }
  const v: string[] = [];
  for (const rel of [...newFiles, ...asWritten]) {
    const src = await Deno.readTextFile(join(out, TEST_APP, ...rel.split("/")));
    const text = stripAlNoise(src);
    const own = asWritten.includes(rel)
      ? new Set(
        declarations(
          await Deno.readTextFile(join(pristineTest, ...rel.split("/"))),
        ).map((d) => `${d.kind}#${d.id}`),
      )
      : new Set<string>();
    for (const d of declarations(src)) {
      // Sol r3 #2: the helper's own shipped object keeps its id, but its name
      // must still not be another shipped object's.
      const self = `${d.kind}#${d.id}`;
      const byName = named.get(
        `${d.kind}:${objectName(text, d).toLowerCase()}`,
      );
      const hit = (own.has(self) ? undefined : shipped.get(self)) ??
        (byName && byName !== self ? shipped.get(byName) : undefined);
      if (hit) {
        v.push(
          `${TEST_APP}/${rel}: ${d.kind} ${d.id} collides with shipped ${hit}`,
        );
      }
    }
  }
  return v;
}
