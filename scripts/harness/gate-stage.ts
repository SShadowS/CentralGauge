// Staging from a git revision and static checks for the M4 authoring gate.
// No container. Owner: lane-ops.
import { walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import type { Layer, TestRef } from "./gate-core.ts";
import type { LoadedTask } from "../../src/harness/task.ts";
import { hashTree } from "../../src/harness/hash.ts";
import {
  BUILD_ORDER,
  isTestCodeunit,
  objectIds,
  parseTestManifest,
  RANGES,
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
    ...(env ? { env } : {}),
    stdout: "piped",
    stderr: "null",
  }).output();
  return { ok: r.success, out: new TextDecoder().decode(r.stdout) };
}

const posix = (p: string) => p.replaceAll("\\", "/");

export interface Source {
  commit: string;
  root: string;
  refappDir: string;
  refappTree: string;
  taskDir: string;
  taskTree: string;
}

/**
 * Write `harness-tasks` of `rev` into `out` from git objects, through a
 * private index, so the working tree and the repo index are never read or
 * touched. The gate stages exactly the commit it reports.
 */
export async function exportSource(
  repo: string,
  rev: string,
  taskId: string,
  out: string,
): Promise<Source> {
  const c = await git(repo, ["rev-parse", "--verify", "-q", `${rev}^{commit}`]);
  if (!c.ok) throw new Error(`${rev} does not resolve to a commit`);
  const commit = c.out.trim();
  const env = { GIT_INDEX_FILE: join(out, ".gate-index") };
  if (
    !(await git(repo, [
      "read-tree",
      `--prefix=harness-tasks/`,
      `${commit}:harness-tasks`,
    ], env)).ok
  ) {
    throw new Error(`read-tree ${commit}:harness-tasks failed`);
  }
  if (
    !(await git(
      repo,
      ["checkout-index", "-a", "-f", `--prefix=${posix(out)}/`],
      env,
    )).ok
  ) {
    throw new Error("checkout-index failed");
  }
  await Deno.remove(env.GIT_INDEX_FILE);
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
  const parts = rel.split("/");
  return parts.includes(".alpackages") || parts.includes("output") ||
    rel.toLowerCase().endsWith(".app");
}

async function* files(
  root: string,
): AsyncGenerator<{ path: string; rel: string }> {
  for await (const e of walk(root, { followSymlinks: false })) {
    if (e.isSymlink) throw new Error(`link refused: ${e.path}`);
    if (e.isFile) yield { path: e.path, rel: posix(relative(root, e.path)) };
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
  out: string,
): Promise<void> {
  for (const m of BUILD_ORDER) {
    if (!(await exists(join(refappDir, m, "app.json")))) {
      throw new Error(`refapp module missing: ${m}`);
    }
    for await (const f of files(join(refappDir, m))) {
      if (!isBuildOutput(f.rel)) await put(f.path, join(out, m), f.rel);
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
        if ((await Deno.stat(f.path)).size === 0) {
          throw new Error(`${f.path}: deletion is not supported`);
        }
        await put(f.path, out, f.rel);
        continue;
      }
      // Agent workspace: sources and manifests only; shipped tests are restored (spec 1a section 7).
      if (!BUILD_ORDER.includes(top)) continue;
      if (!f.rel.endsWith(".al") && f.rel !== `${top}/app.json`) continue;
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
    const m = parseTestManifest(await Deno.readTextFile(f.path));
    if (m) out.push(m);
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

/** Static rules. Problems block; warnings do not. */
export async function checkTask(
  loaded: LoadedTask,
  refappDir: string,
  repoRoot: string,
  opts: { drift?: boolean } = {},
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
          text: await Deno.readTextFile(f.path),
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
          text: await Deno.readTextFile(f.path),
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
        all.push({
          source: lr,
          rel: f.rel,
          module: f.rel.split("/")[0]!,
          text: await Deno.readTextFile(f.path),
        });
      }
    }
  }

  for (const f of all) {
    const where = `${f.source}/${f.rel}`;
    const range = RANGES[f.module];
    if (!range) {
      problems.push(`${where}: not under a module folder`);
      continue;
    }
    for (const id of objectIds(f.text)) {
      if (id < range[0] || id > range[1]) {
        problems.push(
          `${where}: object id ${id} outside ${f.module} range ${range[0]}-${
            range[1]
          }`,
        );
      }
      if (f.module === "Test" && id === 80013) {
        problems.push(`${where}: 80013 collides on Cronus28`);
      }
    }
    if (isTestCodeunit(f.text)) {
      if (!/TestPermissions\s*=\s*Disabled\s*;/i.test(f.text)) {
        problems.push(
          `${where}: test codeunit without TestPermissions = Disabled`,
        );
      }
      if ((parseTestManifest(f.text)?.procedures.length ?? 0) === 0) {
        problems.push(`${where}: test codeunit with no [Test] procedure`);
      }
    }
    if (/Assert\.(IsTrue\(\s*true|IsFalse\(\s*false)\b/i.test(f.text)) {
      problems.push(`${where}: placeholder assertion`);
    }
  }

  // Every shipped Test/ file is protected, not only .al (Test/app.json included).
  const shippedTests = new Set<string>();
  for (const root of [join(refappDir, "Test"), join(dir, "overlay", "Test")]) {
    if (!(await exists(root))) continue;
    for await (const f of files(root)) shippedTests.add(`Test/${f.rel}`);
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
    if (suite && shippedTests.has(f.rel)) {
      problems.push(`${where}: replaces a shipped test`);
    }
    if (!suite && f.source !== "overlay" && inTest) {
      problems.push(
        `${where}: correct/, naive/ and mutants/ must not touch Test/`,
      );
    }
  }

  const declares = (pool: AlFile[], codeunit: number, proc: string) =>
    pool.some((f) => {
      const m = parseTestManifest(f.text);
      return m?.codeunit === codeunit && m.procedures.includes(proc);
    });
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
    for (const r of task.fail_to_pass.tests) {
      hidden.push(String(r.codeunit), ...r.procedures);
      for (const p of r.procedures) {
        if (!declares(oracle, r.codeunit, p)) {
          problems.push(`fail_to_pass ${r.codeunit}.${p} not found in oracle/`);
        }
      }
    }
    const app = JSON.parse(
      await Deno.readTextFile(join(dir, "oracle", "app.json")),
    ) as {
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
      ...task.fail_to_pass.depends_on.map((m) => `CGR ${m}`),
      "Library Assert",
    ]);
    allowed.delete("CGR Test");
    for (const d of app.dependencies ?? []) {
      if (!allowed.has(d.name)) {
        problems.push(`oracle/app.json: dependency ${d.name} not allowed`);
      }
    }
    for (const r of app.idRanges ?? []) {
      if (r.from < 85000 || r.to > 89999) {
        problems.push("oracle/app.json: idRanges outside 85000-89999");
      }
    }
  }
  const prompt = await Deno.readTextFile(join(dir, task.prompt));
  for (const h of hidden) {
    if (new RegExp(`\\b${h}\\b`).test(prompt)) {
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
      const changed = [
        ...(await git(repoRoot, ["diff", "--name-only", tag, "--", prefix])).out
          .split(/\r?\n/),
        ...(await git(repoRoot, [
          "ls-files",
          "--others",
          "--exclude-standard",
          "--",
          prefix,
        ])).out.split(/\r?\n/),
      ].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
      const replaced = new Set(layerFiles.map((f) => f.rel));
      for (const c of changed) {
        if (replaced.has(c)) {
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
