// Staging from a git revision and static checks for the M4 authoring gate.
// No container. Owner: lane-ops.
import { walk } from "@std/fs";
import { dirname, join, relative, resolve } from "@std/path";
import type { Layer, TestRef } from "./gate-core.ts";
import type { LoadedTask } from "../../src/harness/task.ts";
import { hashTree } from "../../src/harness/hash.ts";
import {
  alObjects,
  BUILD_ORDER,
  isTestObject,
  RANGES,
  stripAl,
  testManifests,
} from "./gate-core.ts";

export async function exists(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

export async function git(
  cwd: string,
  args: string[],
  env?: Record<string, string>,
): Promise<{ ok: boolean; out: string }> {
  const r = await new Deno.Command("git", {
    args,
    cwd,
    // refs/replace must never swap the bytes of the commit we report.
    env: { GIT_NO_REPLACE_OBJECTS: "1", ...env },
    stdout: "piped",
    stderr: "null",
  }).output();
  return { ok: r.success, out: new TextDecoder().decode(r.stdout) };
}

const posix = (p: string) => p.replaceAll("\\", "/");

/** The only root the gate writes under (launch contract: authorized outputs). */
export const GATE_TMP = resolve(
  Deno.env.get("CG_GATE_TMP") ?? "H:\\Temp3\\harness-spike\\M4\\tmp",
);

/**
 * Output dirs must sit under GATE_TMP and be new or empty: a reused dir
 * would stage stale files.
 */
async function requireEmpty(outArg: string): Promise<string> {
  const out = resolve(outArg);
  const norm = (p: string) =>
    Deno.build.os === "windows" ? posix(p).toLowerCase() : posix(p);
  // Compare real paths: a junction or symlink inside GATE_TMP may point out.
  const real = async (p: string): Promise<string> => {
    let base = p;
    const tail: string[] = [];
    while (!(await exists(base))) {
      if (dirname(base) === base) return p;
      tail.unshift(base.slice(dirname(base).length).replace(/^[\\/]/, ""));
      base = dirname(base);
    }
    return join(await Deno.realPath(base), ...tail);
  };
  if (!norm(await real(out)).startsWith(norm(await real(GATE_TMP)) + "/")) {
    throw new Error(`output dir ${out} is outside ${GATE_TMP}`);
  }
  if (!(await exists(out))) return out;
  for await (const _ of Deno.readDir(out)) {
    throw new Error(`output dir is not empty: ${out}`);
  }
  return out;
}

export interface Source {
  commit: string;
  root: string;
  refappDir: string;
  refappTree: string;
  taskDir: string;
  taskTree: string;
}

const SEP = Deno.build.os === "windows" ? "\\" : "/";
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
/** A git path part that is not a plain, portable file or folder name. */
const unsafePart = (p: string) =>
  p === "" || p === "." || p === ".." || /[\\:<>"|?*\x00-\x1f]/.test(p) ||
  /[. ]$/.test(p) || DEVICE.test(p);

/** Reads git's `cat-file --batch` output: `<sha> <type> <size>\n<bytes>\n`. */
function batchReader(bytes: Uint8Array) {
  let at = 0;
  return () => {
    const nl = bytes.indexOf(10, at);
    if (nl < 0) return null;
    const [, type, len] = new TextDecoder().decode(bytes.subarray(at, nl))
      .split(" ");
    const size = Number(len);
    if (type !== "blob" || !Number.isInteger(size)) return null;
    const body = bytes.slice(nl + 1, nl + 1 + size);
    at = nl + 1 + size + 1;
    return body.length === size ? body : null;
  };
}

/**
 * Write `harness-tasks` of `rev` into `out` as the committed blob bytes
 * (`ls-tree` + `cat-file`), so no working tree, index, eol rule, filter or
 * encoding attribute can change what is staged. Links, submodules and paths
 * that collide on a case-insensitive filesystem are refused.
 */
export async function exportSource(
  repo: string,
  rev: string,
  taskId: string,
  outArg: string,
): Promise<Source> {
  const out = await requireEmpty(outArg);
  const c = await git(repo, ["rev-parse", "--verify", "-q", `${rev}^{commit}`]);
  if (!c.ok) throw new Error(`${rev} does not resolve to a commit`);
  const commit = c.out.trim();
  const ls = await git(repo, [
    "-c",
    "core.quotePath=false",
    "ls-tree",
    "-r",
    "-z",
    commit,
    "--",
    "harness-tasks/",
  ]);
  if (!ls.ok) throw new Error(`ls-tree ${commit} failed`);
  const blobs: { path: string; sha: string }[] = [];
  const seen = new Map<string, string>();
  for (const rec of ls.out.split("\0")) {
    if (rec === "") continue;
    const tab = rec.indexOf("\t");
    const [mode, , sha] = rec.slice(0, tab).split(" ") as [
      string,
      string,
      string,
    ];
    const path = rec.slice(tab + 1);
    if (mode === "120000" || mode === "160000") {
      throw new Error(`${path}: link or submodule refused`);
    }
    const parts = path.split("/");
    if (parts.some(unsafePart)) throw new Error(`${path}: unsafe path`);
    // Every folder prefix too: NTFS merges case-variant folders.
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join("/");
      const other = seen.get(prefix.toLowerCase());
      if (other !== undefined && other !== prefix) {
        throw new Error(`${prefix} and ${other} differ only in case`);
      }
      seen.set(prefix.toLowerCase(), prefix);
    }
    const target = resolve(join(out, path));
    if (!target.startsWith(out + SEP)) throw new Error(`${path}: unsafe path`);
    blobs.push({ path, sha });
  }
  const child = new Deno.Command("git", {
    args: ["cat-file", "--batch"],
    cwd: repo,
    env: { GIT_NO_REPLACE_OBJECTS: "1" },
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  // Written while stdout drains, so a full pipe cannot deadlock.
  const writing = (async () => {
    const w = child.stdin.getWriter();
    await w.write(
      new TextEncoder().encode(blobs.map((b) => b.sha).join("\n") + "\n"),
    );
    await w.close();
  })();
  const [res] = await Promise.all([child.output(), writing]);
  if (!res.success) throw new Error("git cat-file failed");
  const next = batchReader(res.stdout);
  for (const b of blobs) {
    const body = next();
    if (!body) throw new Error(`git cat-file could not read ${b.path}`);
    await Deno.mkdir(dirname(join(out, b.path)), { recursive: true });
    await Deno.writeFile(join(out, b.path), body);
  }
  const tree = async (p: string) => {
    const r = await git(repo, [
      "rev-parse",
      "--verify",
      "-q",
      `${commit}:${p}`,
    ]);
    if (!r.ok) throw new Error(`${p} not in ${commit}`);
    return r.out.trim();
  };
  return {
    commit,
    root: out,
    refappDir: join(out, "harness-tasks", "refapp"),
    refappTree: await tree("harness-tasks/refapp"),
    taskDir: join(out, "harness-tasks", "tasks", taskId),
    taskTree: await tree(`harness-tasks/tasks/${taskId}`),
  };
}

function isBuildOutput(rel: string): boolean {
  const lower = rel.toLowerCase();
  const parts = lower.split("/");
  return parts.includes(".alpackages") || parts.includes("output") ||
    lower.endsWith(".app");
}

async function* files(
  root: string,
): AsyncGenerator<{ path: string; rel: string }> {
  for await (const e of walk(root, { followSymlinks: false })) {
    if (e.isSymlink) throw new Error(`link refused: ${e.path}`);
    if (e.isFile) yield { path: e.path, rel: posix(relative(root, e.path)) };
  }
}

/** Zero bytes, or an .al file with nothing but whitespace and comments. */
async function noContent(path: string): Promise<boolean> {
  if ((await Deno.stat(path)).size === 0) return true;
  if (!path.toLowerCase().endsWith(".al")) return false;
  const text = decodeAl(await Deno.readFile(path));
  return text !== null && stripAl(text, true).trim() === "";
}

/** UTF-8 AL source, or null for anything else (UTF-16, NUL bytes, bad UTF-8). */
function decodeAl(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      bytes,
    );
  } catch {
    return null;
  }
}

async function put(src: string, out: string, rel: string) {
  await Deno.mkdir(dirname(join(out, rel)), { recursive: true });
  await Deno.copyFile(src, join(out, rel));
}

/** Refapp modules (all seven required), then each layer (spec 1b section 5). */
export async function stageWorkspace(
  refappDir: string,
  ls: Layer[],
  outArg: string,
): Promise<void> {
  const out = await requireEmpty(outArg);
  // Shipped tests: the refapp's Test/ plus whatever the overlay ships there.
  // Paths compare lowercased (NTFS is case-insensitive).
  const shipped = new Set<string>();
  for (const m of BUILD_ORDER) {
    if (!(await exists(join(refappDir, m, "app.json")))) {
      throw new Error(`refapp module missing: ${m}`);
    }
    for await (const f of files(join(refappDir, m))) {
      if (isBuildOutput(f.rel)) continue;
      await put(f.path, join(out, m), f.rel);
      if (m === "Test") shipped.add(`test/${f.rel.toLowerCase()}`);
    }
  }
  for (const l of ls) {
    if (!(await exists(l.path))) {
      if (l.optional) continue;
      throw new Error(`layer folder missing: ${l.path}`);
    }
    for await (const f of files(l.path)) {
      const top = f.rel.split("/")[0]!;
      if (isBuildOutput(f.rel)) continue;
      if (l.mode === "task") {
        if (!BUILD_ORDER.includes(top)) {
          throw new Error(
            `${f.path}: layer files must sit under a module folder`,
          );
        }
        if (await noContent(f.path)) {
          throw new Error(`${f.path}: deletion is not supported`);
        }
        const key = f.rel.toLowerCase();
        if (posix(l.path).split("/").pop() === "overlay") {
          if (top === "Test") shipped.add(key);
        } else if (shipped.has(key)) {
          throw new Error(
            `${f.path}: a task layer cannot replace a shipped test`,
          );
        }
        await put(f.path, out, f.rel);
        continue;
      }
      // Agent workspace: sources and manifests only; shipped tests are restored (spec 1a section 7).
      if (!BUILD_ORDER.includes(top)) continue;
      if (!f.rel.endsWith(".al") && f.rel !== `${top}/app.json`) continue;
      if (await noContent(f.path)) {
        throw new Error(`${f.path}: deletion is not supported`);
      }
      if (top === "Test" && (await exists(join(out, f.rel)))) continue;
      if (l.mode === "candidate-tests" && top !== "Test") continue;
      await put(f.path, out, f.rel);
    }
  }
}

export const stagedHash = (dir: string) => hashTree(dir, "task");

export async function testManifestIn(dir: string): Promise<TestRef[]> {
  const out: TestRef[] = [];
  if (!(await exists(dir))) return out;
  for await (const f of files(dir)) {
    if (!f.rel.endsWith(".al")) continue;
    out.push(...testManifests(decodeAl(await Deno.readFile(f.path)) ?? ""));
  }
  return out.sort((a, b) => a.codeunit - b.codeunit);
}

async function subdirs(p: string): Promise<string[]> {
  if (!(await exists(p))) return [];
  const out: string[] = [];
  for await (const e of Deno.readDir(p)) if (e.isDirectory) out.push(e.name);
  return out.sort();
}

interface AlFile {
  source: string; // "refapp" | layer folder, e.g. "correct", "naive/x", "oracle"
  rel: string; // module-rooted posix path, e.g. "Fleet/src/X.al"
  module: string;
  text: string;
}

const LITERAL = String.raw`'(?:[^']|'')*'|-?\d+(?:\.\d+)?|true|false`;
const CONSTANT_ASSERT = new RegExp(
  String
    .raw`Assert\s*\.\s*(?:(IsTrue)\s*\(\s*true\b|(IsFalse)\s*\(\s*false\b|(AreEqual)\s*\(\s*(${LITERAL})\s*,\s*(${LITERAL})\s*[,)])`,
  "gi",
);

/**
 * Assertions that cannot fail: IsTrue(true), IsFalse(false), or AreEqual on
 * two identical literals. Comments are ignored; string contents are kept.
 */
function placeholderAssertions(al: string): string[] {
  return [...stripAl(al, true).matchAll(CONSTANT_ASSERT)]
    .filter((m) =>
      !m[3] || m[4]!.toLowerCase() === m[5]!.toLowerCase() &&
        (m[4]!.startsWith("'") ? m[4] === m[5] : true)
    )
    .map((m) => m[0].replace(/\s+/g, " "));
}

/** Static rules. Problems block; warnings do not. */
export async function checkTask(
  loaded: LoadedTask,
  refappDir: string,
  repoRoot: string,
  opts: { drift?: boolean; rev?: string } = {},
): Promise<{ problems: string[]; warnings: string[] }> {
  const { task, dir } = loaded;
  const problems: string[] = [];
  const warnings: string[] = [];
  const testAuthoring = task.kind === "test-authoring";
  const naive = await subdirs(join(dir, "naive"));
  if (naive.length < 2) {
    problems.push("naive/ needs at least two variants (spec 1b section 8)");
  }
  if (task.mutants.includes("m0")) {
    problems.push("mutant name m0 is reserved for the staged state");
  }
  if (testAuthoring && !(await exists(join(dir, "reference-tests")))) {
    problems.push("test-authoring needs reference-tests/");
  }

  const layerRoots = [
    "overlay",
    "correct",
    "reference-tests",
    ...naive.map((n) => `naive/${n}`),
    ...task.mutants.map((m) => `mutants/${m}`),
  ];
  const alText = async (path: string, where: string) => {
    const t = decodeAl(await Deno.readFile(path));
    if (t === null) problems.push(`${where}: not UTF-8 text`);
    return t ?? "";
  };
  const all: AlFile[] = [];
  const layerFiles: { source: string; rel: string; size: number }[] = [];
  for (const m of BUILD_ORDER) {
    const root = join(refappDir, m);
    if (!(await exists(root))) continue;
    for await (const f of files(root)) {
      if (f.rel.endsWith(".al")) {
        all.push({
          source: "refapp",
          rel: `${m}/${f.rel}`,
          module: m,
          text: await alText(f.path, `refapp/${m}/${f.rel}`),
        });
      }
    }
  }
  if (await exists(join(dir, "oracle"))) {
    for await (const f of files(join(dir, "oracle"))) {
      if (f.rel.endsWith(".al")) {
        all.push({
          source: "oracle",
          rel: f.rel,
          module: "Oracle",
          text: await alText(f.path, `oracle/${f.rel}`),
        });
      }
    }
  }
  for (const lr of layerRoots) {
    const root = join(dir, lr);
    if (!(await exists(root))) continue;
    for await (const f of files(root)) {
      layerFiles.push({
        source: lr,
        rel: f.rel,
        size: (await Deno.stat(f.path)).size,
      });
      if (f.rel.endsWith(".al")) {
        const text = await alText(f.path, `${lr}/${f.rel}`);
        if (text !== "" && stripAl(text, true).trim() === "") {
          problems.push(
            `${lr}/${f.rel}: no AL content; deletion is not supported`,
          );
        }
        all.push({
          source: lr,
          rel: f.rel,
          module: f.rel.split("/")[0]!,
          text,
        });
      }
    }
  }

  // Each task owns the oracle band 85000 + (N - 1) * 100 .. + 99.
  const taskNo = Number(task.id.slice(3));
  const oracleBand: readonly [number, number] = [
    85000 + (taskNo - 1) * 100,
    85000 + (taskNo - 1) * 100 + 99,
  ];
  if (!Number.isInteger(taskNo) || taskNo < 1 || oracleBand[1] > 89999) {
    problems.push(`${task.id}: no oracle band inside 85000-89999`);
  }
  for (const f of all) {
    const where = `${f.source}/${f.rel}`;
    const range = f.module === "Oracle" ? oracleBand : RANGES[f.module];
    if (!range) {
      problems.push(`${where}: not under a module folder`);
      continue;
    }
    for (const o of alObjects(f.text)) {
      if (o.id < range[0] || o.id > range[1]) {
        problems.push(
          `${where}: object id ${o.id} outside ${f.module} range ${range[0]}-${
            range[1]
          }`,
        );
      }
      if (f.module === "Test" && o.id === 80013) {
        problems.push(`${where}: 80013 collides on Cronus28`);
      }
      if (!isTestObject(o)) continue;
      if (!/\bTestPermissions\s*=\s*Disabled\s*;/i.test(o.body)) {
        problems.push(
          `${where}: codeunit ${o.id} without TestPermissions = Disabled`,
        );
      }
    }
    for (const m of testManifests(f.text)) {
      if (m.procedures.length === 0) {
        problems.push(
          `${where}: test codeunit ${m.codeunit} with no [Test] procedure`,
        );
      }
    }
    for (const a of placeholderAssertions(f.text)) {
      problems.push(`${where}: placeholder assertion ${a}`);
    }
  }

  // Every shipped Test/ file is protected, not only .al (Test/app.json included).
  const shippedTests = new Set<string>();
  for (const root of [join(refappDir, "Test"), join(dir, "overlay", "Test")]) {
    if (!(await exists(root))) continue;
    for await (const f of files(root)) {
      shippedTests.add(`test/${f.rel.toLowerCase()}`);
    }
  }
  for (const f of layerFiles) {
    const where = `${f.source}/${f.rel}`;
    if (f.size === 0) {
      problems.push(`${where}: zero-byte file; deletion is not supported`);
    }
    const inTest = f.rel.startsWith("Test/");
    const suite = testAuthoring &&
      (f.source === "reference-tests" || f.source.startsWith("naive/"));
    if (suite && !inTest) {
      problems.push(`${where}: test suites add files under Test/ only`);
    }
    if (suite && shippedTests.has(f.rel.toLowerCase())) {
      problems.push(`${where}: replaces a shipped test`);
    }
    if (!suite && f.source !== "overlay" && inTest) {
      problems.push(
        `${where}: correct/, naive/ and mutants/ must not touch Test/`,
      );
    }
  }

  const declares = (pool: AlFile[], codeunit: number, proc: string) =>
    pool.some((f) =>
      testManifests(f.text).some((m) =>
        m.codeunit === codeunit && m.procedures.includes(proc)
      )
    );
  const visible = all.filter((f) =>
    f.module === "Test" && (f.source === "refapp" || f.source === "overlay")
  );
  for (const r of task.pass_to_pass) {
    for (const p of r.procedures) {
      if (!declares(visible, r.codeunit, p)) {
        problems.push(
          `pass_to_pass ${r.codeunit}.${p} not found in shipped tests`,
        );
      }
    }
  }
  const hidden: string[] = [...task.mutants];
  if (task.fail_to_pass) {
    const oracle = all.filter((f) => f.module === "Oracle");
    for (const f of oracle) {
      for (const o of alObjects(f.text)) if (o.name) hidden.push(o.name);
    }
    for (const r of task.fail_to_pass.tests) {
      hidden.push(String(r.codeunit), ...r.procedures);
      for (const p of r.procedures) {
        if (!declares(oracle, r.codeunit, p)) {
          problems.push(`fail_to_pass ${r.codeunit}.${p} not found in oracle/`);
        }
      }
    }
    const appPath = join(dir, "oracle", "app.json");
    if (!(await exists(appPath))) problems.push("oracle/app.json: missing");
    const app = (await exists(appPath)
      ? JSON.parse(await Deno.readTextFile(appPath))
      : {}) as {
        id?: string;
        name?: string;
        publisher?: string;
        idRanges?: { from: number; to: number }[];
        dependencies?: { name: string }[];
      };
    const n = task.id.slice(3);
    if (app.id !== `c6a1e000-0000-4000-8001-000000000${n}`) {
      problems.push(
        `oracle/app.json: id must be c6a1e000-0000-4000-8001-000000000${n}`,
      );
    }
    if (app.name !== `CGR Oracle ${task.id}`) {
      problems.push(`oracle/app.json: name must be CGR Oracle ${task.id}`);
    }
    if (app.publisher !== "CentralGauge") {
      problems.push("oracle/app.json: publisher must be CentralGauge");
    }
    const allowed = new Set([
      ...task.fail_to_pass.depends_on.map((m) =>
        `CGR ${m}`
      ),
      "Library Assert",
    ]);
    allowed.delete("CGR Test");
    for (const d of app.dependencies ?? []) {
      if (!allowed.has(d.name)) {
        problems.push(`oracle/app.json: dependency ${d.name} not allowed`);
      }
    }
    if (!app.idRanges?.length) {
      problems.push("oracle/app.json: idRanges missing");
    }
    for (const r of app.idRanges ?? []) {
      if (
        !Number.isInteger(r.from) || !Number.isInteger(r.to) || r.from > r.to
      ) {
        problems.push(
          "oracle/app.json: idRanges entry needs integer from <= to",
        );
        continue;
      }
      if (r.from < oracleBand[0] || r.to > oracleBand[1]) {
        problems.push(
          `oracle/app.json: idRanges outside ${oracleBand[0]}-${oracleBand[1]}`,
        );
      }
    }
  }
  const prompt = await Deno.readTextFile(join(dir, task.prompt));
  for (const h of hidden) {
    const lit = h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<!\\w)${lit}(?!\\w)`, "i").test(prompt)) {
      problems.push(`prompt.md mentions hidden name ${h}`);
    }
  }
  if (/\b(oracle|mutants?)\b/i.test(prompt)) {
    problems.push("prompt.md mentions the oracle or mutants");
  }

  if (opts.drift !== false) {
    const tag = task.refapp_version;
    if (
      !(await git(repoRoot, [
        "rev-parse",
        "-q",
        "--verify",
        `refs/tags/${tag}`,
      ])).ok
    ) {
      warnings.push(
        `refapp_version ${tag} does not resolve yet (tagged on acceptance)`,
      );
    } else {
      const prefix = "harness-tasks/refapp/";
      // With opts.rev: the gated commit against the tag. Without: the working
      // tree (authoring), including untracked files. Renames count as a
      // delete plus an add so a replaced file's old path is never missed.
      const lines = async (args: string[]) => {
        const r = await git(repoRoot, ["-c", "core.quotePath=false", ...args]);
        if (!r.ok) throw new Error(`git ${args.join(" ")} failed`);
        return r.out.split(/\r?\n/);
      };
      const diff = ["diff", "--no-renames", "--name-only", tag];
      const changed = [
        ...(await lines(
          opts.rev
            ? [...diff, opts.rev, "--", prefix]
            : [...diff, "--", prefix],
        )),
        ...(opts.rev ? [] : await lines([
          "ls-files",
          "--others",
          "--exclude-standard",
          "--",
          prefix,
        ])),
      ].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
      const replaced = new Set(layerFiles.map((f) => f.rel.toLowerCase()));
      for (const c of changed) {
        if (replaced.has(c.toLowerCase())) {
          problems.push(
            `${c}: refapp changed since ${tag} under a file this task replaces`,
          );
        }
      }
      if (changed.length > 0) {
        warnings.push(
          `refapp changed since ${tag} (${changed.length} files): re-gate before freeze`,
        );
      }
    }
  }
  return { problems, warnings };
}
