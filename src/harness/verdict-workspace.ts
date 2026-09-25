/**
 * Verdict workspace (spec 1a section 7 items 1-4). Never the agent's
 * workspace as-is: the staged copy, plus permitted source files from the
 * artifact (or the reference, for test-authoring), plus new Test\ sources;
 * app.json rebuilt from the trusted one. Violations fail the build scorer.
 */

import { join } from "@std/path";
import {
  BENCHMARK_APP_ID_BUFFER,
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
import { readAppGraph, type StagedApp } from "./staging.ts";

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
}

export interface VerdictWorkspace {
  dir: string;
  apps: StagedApp[];
  changed: string[];
  violations: string[];
}

const IDENTITY = ["id", "name", "publisher"] as const;

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Trusted app.json with only `dependencies` from the candidate; identity changes are violations. */
async function mergeAppJson(
  folder: string,
  trustedPath: string,
  candidatePath: string,
  violations: string[],
) {
  const trusted = (await readJson(trustedPath))!;
  const cand = await readJson(candidatePath);
  if (cand === null) {
    violations.push(`${folder}: app.json missing or unreadable`);
    await Deno.writeTextFile(candidatePath, JSON.stringify(trusted, null, 2));
    return;
  }
  for (const k of IDENTITY) {
    const a = String(trusted[k] ?? "");
    const b = String(cand[k] ?? "");
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
  const merged = {
    ...trusted,
    dependencies: Array.isArray(cand["dependencies"])
      ? cand["dependencies"]
      : trusted["dependencies"] ?? [],
  };
  await Deno.writeTextFile(candidatePath, JSON.stringify(merged, null, 2));
}

/** A real directory (not a file, link or junction). */
async function isPlainDir(p: string): Promise<boolean> {
  const st = await Deno.lstat(p).catch(() => null);
  return st !== null && st.isDirectory && !st.isSymlink;
}

export async function buildVerdictWorkspace(
  o: ReconstructOptions,
): Promise<VerdictWorkspace> {
  const violations: string[] = [];
  const pristineApps = await readAppGraph(o.pristine);
  const copy = await safeCopyTree(o.pristine, o.out);
  const out = copy.dst;

  const marker = join(o.artifact, FREEZE_VIOLATIONS_FILE);
  if (await exists(marker)) {
    for (const line of (await Deno.readTextFile(marker)).split(/\r?\n/)) {
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
    );
  }

  const testSrc = join(o.artifact, TEST_APP);
  if (await exists(testSrc) && !await isPlainDir(testSrc)) {
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
      if (known !== undefined) continue; // shipped: the pristine copy stays
      const dest = join(out, TEST_APP, ...e.path.split("/"));
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

  const changed: string[] = [];
  for (const app of pristineApps) {
    if (
      await hashTree(join(o.pristine, app.folder), "task") !==
        await hashTree(join(out, app.folder), "task")
    ) {
      changed.push(app.folder);
    }
  }
  return { dir: out, apps, changed, violations };
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

/** Test codeunits in files the shipped Test app does not have (case-insensitive paths). */
export async function addedTestCodeunits(
  pristineTest: string,
  test: string,
): Promise<TestCodeunit[]> {
  const shipped = new Set(
    (await listTree(pristineTest, "task")).map((e) => e.path.toLowerCase()),
  );
  return (await testCodeunits(test)).filter((t) =>
    !shipped.has(t.file.toLowerCase())
  );
}
