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
}

export interface VerdictWorkspace {
  dir: string;
  apps: StagedApp[];
  changed: string[];
  violations: string[];
  /** Why agent-added test procedures were not extracted or not counted (M4-17a). */
  notes: string[];
}

const IDENTITY = ["id", "name", "publisher"] as const;

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return await readAppJsonRaw(path) as Record<string, unknown>;
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
  const editedShipped = new Map<string, string>();
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
      if (known !== undefined) {
        // Shipped: the pristine copy stays; an edited .al is kept aside for
        // extracting the procedures the agent added (M4-17a).
        const text = await Deno.readTextFile(
          join(scratch, ...e.path.split("/")),
        );
        if (
          e.path.toLowerCase().endsWith(".al") &&
          text !==
            await Deno.readTextFile(
              join(o.pristine, TEST_APP, ...known.split("/")),
            )
        ) {
          editedShipped.set(known, text);
        }
        continue;
      }
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
  const notes = violations.length === 0 && editedShipped.size > 0
    ? await extractAddedTests(o.pristine, out, pristineApps, editedShipped)
    : [];

  const changed: string[] = [];
  for (const app of pristineApps) {
    if (
      await hashTree(join(o.pristine, app.folder), "task") !==
        await hashTree(join(out, app.folder), "task")
    ) {
      changed.push(app.folder);
    }
  }
  return { dir: out, apps, changed, violations, notes };
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
): Promise<TestCodeunit[]> {
  const shipped = new Set(
    (await listTree(pristineTest, "task")).map((e) => e.path.toLowerCase()),
  );
  return (await testCodeunits(test)).filter((t) =>
    !shipped.has(t.file.toLowerCase())
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
  const re = /"([^"\n]*)"|([A-Za-z_][A-Za-z0-9_]*)|([0-9][A-Za-z0-9_.]*)|(\S)/g;
  const out: Tok[] = [];
  for (const m of text.slice(from, to).matchAll(re)) {
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
  kind: "procedure" | "trigger" | "var" | "property";
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

interface ShippedTests {
  /** Lowercased [Test] name -> "<codeunit> <name>". */
  names: Map<string, string>;
  /** Normalized body -> "<codeunit> <name>". */
  bodies: Map<string, string>;
  /** Lowercased test codeunit name -> "<id> <name>". */
  units: Map<string, string>;
}

/** Every [Test] of the pristine Test app; null when one cannot be parsed. */
async function shippedTests(testDir: string): Promise<ShippedTests | null> {
  const names = new Map<string, string>();
  const bodies = new Map<string, string>();
  const units = new Map<string, string>();
  for (const e of await listTree(testDir, "task", { optional: true })) {
    if (!e.path.toLowerCase().endsWith(".al")) continue;
    const src = await Deno.readTextFile(join(testDir, e.path));
    const text = stripAlNoise(src);
    for (const d of declarations(src).filter(isTestCodeunit)) {
      const ms = codeunitMembers(text, d);
      if (ms === null) return null;
      const unit = new RegExp(
        `codeunit\\s+${d.id}\\s+(?:"([^"\\n]+)"|([A-Za-z_][A-Za-z0-9_]*))`,
        "i",
      ).exec(text);
      if (unit) {
        const n = unit[1] ?? unit[2]!;
        units.set(n.toLowerCase(), `${d.id} ${n}`);
      }
      for (const m of ms.filter((x) => x.test)) {
        const label = `${d.id} ${m.displays[0]}`;
        names.set(m.names[0]!, label);
        bodies.set(normalizeAlBody(src.slice(m.bodyStart, m.end)), label);
      }
    }
  }
  return { names, bodies, units };
}

interface Extracted {
  from: number;
  tests: string[];
  text: (id: number) => string;
}

/**
 * One shipped test codeunit: its added [Test] procedures that count, with the
 * added procedures and globals they reach and the shipped globals they use
 * (pristine declarations). A test does not count, with a note, when it (or
 * an added procedure it reaches) is a normalized copy of a shipped [Test],
 * uses the name of a shipped [Test] (any codeunit, qualified or not: a call)
 * or of a shipped test codeunit (a variable or Codeunit.Run could run it
 * whole; shipped non-test library codeunits stay allowed), needs a shipped
 * procedure of this codeunit (never carried: shipped code is
 * not the agent's, and an edited one must not run), or needs a shipped
 * global the shipped OnRun trigger uses (its state is not carried).
 */
function extractFrom(
  rel: string,
  d: AlDecl,
  pSrc: string,
  pm: Member[],
  aSrc: string,
  am: Member[],
  shipped: ShippedTests,
  notes: string[],
): Extracted | null {
  const aText = stripAlNoise(aSrc);
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
  const added = new Map<string, Member>();
  for (const m of am.filter(isCode)) {
    if (shippedCode.has(m.names[0]!)) continue;
    if (m.kind === "trigger") {
      notes.push(
        `${where}: added trigger ${
          m.displays[0]
        } is not carried (shipped codeunit state is not extracted)`,
      );
    } else if (!added.has(m.names[0]!)) added.set(m.names[0]!, m);
  }
  const addedGlobals = new Map<string, Member>();
  const mixed = new Set<string>();
  for (const g of am.filter((m) => m.kind === "var")) {
    const fresh = g.names.filter((n) => !shippedGlobals.has(n));
    if (fresh.length === g.names.length) {
      for (const n of fresh) addedGlobals.set(n, g);
    } else for (const n of fresh) mixed.add(n);
  }

  const reason = new Map<Member, string | null>();
  const deps = new Map<Member, { procs: Member[]; globals: Member[] }>();
  const evaluate = (m: Member): string | null => {
    if (reason.has(m)) return reason.get(m)!;
    reason.set(m, null); // a cycle is decided by the members on it
    const dep = { procs: [] as Member[], globals: [] as Member[] };
    deps.set(m, dep);
    const why = ((): string | null => {
      const copy = shipped.bodies.get(
        normalizeAlBody(aSrc.slice(m.bodyStart, m.end)),
      );
      if (copy) return `copy of shipped [Test] ${copy}`;
      const refs = memberRefs(aSrc, aText, m);
      for (const r of refs) {
        const test = shipped.names.get(r.v);
        if (test) return `calls shipped [Test] ${test}`;
      }
      for (const r of refs) {
        // A variable or Codeunit.Run of a shipped test codeunit could run it whole.
        const unit = shipped.units.get(r.v);
        if (unit) return `uses shipped test codeunit ${unit}`;
        if (r.dotted) continue;
        const p = added.get(r.v);
        if (p) {
          if (p === m) continue;
          const inner = evaluate(p);
          if (inner) return `${inner} (via ${p.displays[0]})`;
          dep.procs.push(p);
          continue;
        }
        const code = shippedCode.get(r.v);
        if (code) return `needs shipped procedure ${code}`;
        if (mixed.has(r.v)) {
          return `needs global ${r.v}, declared together with a shipped global`;
        }
        const ag = addedGlobals.get(r.v);
        if (ag) {
          dep.globals.push(ag);
          continue;
        }
        const sg = shippedGlobals.get(r.v);
        if (sg) {
          if (onRun.has(r.v)) {
            return `needs shipped global ${
              sg.displays[sg.names.indexOf(r.v)]
            }, which the shipped OnRun trigger uses`;
          }
          dep.globals.push(sg);
        }
      }
      return null;
    })();
    reason.set(m, why);
    return why;
  };

  const tests: Member[] = [];
  for (const m of added.values()) {
    if (!m.test) continue;
    const why = evaluate(m);
    if (why) {
      notes.push(`${where}: added test ${m.displays[0]}: ${why}; not counted`);
    } else tests.push(m);
  }
  if (tests.length === 0) return null;
  const procs = new Set<Member>();
  const globals = new Set<Member>();
  const reach = (m: Member) => {
    if (procs.has(m)) return;
    procs.add(m);
    for (const p of deps.get(m)!.procs) reach(p);
    for (const g of deps.get(m)!.globals) globals.add(g);
  };
  tests.forEach(reach);
  const props = pm.filter((m) =>
    m.kind === "property" && m.names[0] !== "subtype"
  );
  return {
    from: d.id,
    tests: tests.map((m) => m.displays[0]!),
    text: (id) =>
      [
        `// Generated by the verdict (M4-17a): the [Test] procedures an agent added to shipped test codeunit ${d.id} (${TEST_APP}/${rel}).`,
        `codeunit ${id} "CG Extracted Tests ${id}"`,
        "{",
        "    Subtype = Test;",
        ...props.map((m) => `    ${pSrc.slice(m.start, m.end)}`),
        ...(globals.size > 0
          ? [
            "",
            "    var",
            ...pm.filter((m) => globals.has(m)).map((m) =>
              `        ${pSrc.slice(m.start, m.end)}`
            ),
            ...am.filter((m) => globals.has(m)).map((m) =>
              `        ${aSrc.slice(m.start, m.end)}`
            ),
          ]
          : []),
        ...am.filter((m) => procs.has(m)).flatMap((m) => [
          "",
          `    ${aSrc.slice(m.start, m.end)}`,
        ]),
        "}",
        "",
      ].join("\n"),
  };
}

/**
 * Item A of M4-17a: from the artifact's edited shipped Test files, the
 * [Test] procedures the agent added (names the shipped codeunit lacks,
 * case-insensitive, quoted or not) go to a generated test codeunit in
 * Test/CGExtracted/, ids from HARNESS_EXTRACTED_TEST_RANGE in order of the
 * shipped codeunit id. Codeunit-level properties are the PRISTINE codeunit's
 * (TestPermissions and the like), Subtype = Test always; the agent's edits to
 * properties, triggers and shipped procedures are never carried. Fails closed
 * (nothing generated, a note) when a workspace object is in the range or a
 * shipped test codeunit cannot be parsed; an edited file with preprocessor
 * conditionals or an unparseable agent codeunit is skipped with a note.
 * Returns the notes.
 */
async function extractAddedTests(
  pristine: string,
  out: string,
  apps: StagedApp[],
  edited: ReadonlyMap<string, string>,
): Promise<string[]> {
  const notes: string[] = [];
  const range = HARNESS_EXTRACTED_TEST_RANGE;
  const shipped = await shippedTests(join(pristine, TEST_APP));
  if (shipped === null) {
    return [
      "extraction: a shipped test codeunit could not be parsed; no added test procedure is extracted",
    ];
  }
  const found: Extracted[] = [];
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
      const x = extractFrom(rel, p, pSrc, pm, aSrc, am, shipped, notes);
      if (x) found.push(x);
    }
  }
  if (found.length === 0) return notes;
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
    return notes;
  }
  found.sort((a, b) => a.from - b.from);
  for (const [i, x] of found.entries()) {
    const id = range.start + i;
    const dest = join(
      out,
      TEST_APP,
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
  }
  return notes;
}
