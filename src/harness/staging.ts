/**
 * Task staging (spec 1a section 5 item 1, D16). A task source turns a task
 * into a workspace plus its app list in dependency order. `refapp` is the
 * only source in 1a; `git` (BC-Bench style) plugs in through TASK_SOURCES.
 */

import { isAbsolute, join } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import { isTaskBuildArtifact, listTree } from "./hash.ts";
import {
  agentVisibleMetadata,
  REFAPP_PATH,
  type RefappRef,
  type SymbolPackage,
} from "./identity.ts";
import { exists, safeCopyTree, validatedDest, validatedDir } from "./fsutil.ts";
import { restoreSymbols } from "./symbols.ts";
import type { HarnessTask, LoadedTask } from "./task.ts";

const GUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const AppJsonSchema = z.object({
  id: z.string().regex(GUID),
  name: z.string().min(1),
  publisher: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
  idRanges: z.array(z.object({ from: z.number().int(), to: z.number().int() }))
    .default([]),
  dependencies: z.array(z.object({ id: z.string().regex(GUID) })).default([]),
});
export type AppJson = z.output<typeof AppJsonSchema>;

export interface StagedApp {
  folder: string;
  id: string;
  name: string;
  publisher: string;
  version: string;
  idRanges: { from: number; to: number }[];
  /** Workspace folders this app depends on. */
  depends: string[];
  /** Lower-case dependency ids outside the workspace (symbols). */
  external: string[];
}

export async function readAppJson(path: string): Promise<AppJson> {
  let raw: unknown;
  try {
    raw = JSON.parse(await Deno.readTextFile(path));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`${path}: ${msg}`, [msg]);
  }
  const r = AppJsonSchema.safeParse(raw);
  if (!r.success) {
    const errors = r.error.issues.map((i) =>
      `${i.path.join(".")}: ${i.message}`
    );
    throw new ValidationError(
      `Invalid app.json at ${path}: ${errors.join("; ")}`,
      errors,
    );
  }
  return r.data;
}

/** Every top-level folder with an app.json, in dependency order. */
export async function readAppGraph(workspace: string): Promise<StagedApp[]> {
  const found: { app: StagedApp; deps: string[] }[] = [];
  for await (const e of Deno.readDir(workspace)) {
    if (!e.isDirectory || e.name.startsWith(".")) continue;
    let a: AppJson;
    try {
      a = await readAppJson(join(workspace, e.name, "app.json"));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) continue;
      throw err;
    }
    found.push({
      app: {
        folder: e.name,
        id: a.id.toLowerCase(),
        name: a.name,
        publisher: a.publisher,
        version: a.version,
        idRanges: a.idRanges,
        depends: [],
        external: [],
      },
      deps: a.dependencies.map((d) => d.id.toLowerCase()),
    });
  }
  const byId = new Map<string, StagedApp>();
  for (const f of found) {
    const other = byId.get(f.app.id);
    if (other) {
      throw new ValidationError(
        `${other.folder} and ${f.app.folder} have the same app id ${f.app.id}`,
        [other.folder, f.app.folder],
      );
    }
    byId.set(f.app.id, f.app);
  }
  for (const f of found) {
    for (const id of f.deps) {
      const t = byId.get(id);
      if (t) f.app.depends.push(t.folder);
      else f.app.external.push(id);
    }
    f.app.depends.sort();
    f.app.external.sort();
  }
  return topoSort(found.map((f) => f.app));
}

function topoSort(apps: StagedApp[]): StagedApp[] {
  const out: StagedApp[] = [];
  const done = new Set<string>();
  let rest = [...apps].sort((a, b) => a.folder.localeCompare(b.folder));
  while (rest.length > 0) {
    const next = rest.find((a) => a.depends.every((d) => done.has(d)));
    if (!next) {
      throw new ValidationError(
        `dependency cycle among: ${rest.map((a) => a.folder).join(", ")}`,
        rest.map((a) => a.folder),
      );
    }
    out.push(next);
    done.add(next.folder);
    rest = rest.filter((a) => a !== next);
  }
  return out;
}

/** `folders` plus every app that depends on one of them, transitively. */
export function dependentsClosure(
  apps: StagedApp[],
  folders: Iterable<string>,
): Set<string> {
  const set = new Set(folders);
  for (const a of apps) { // dependency order: one pass is enough
    if (a.depends.some((d) => set.has(d))) set.add(a.folder);
  }
  return set;
}

export const DELETE_LIST = ".delete";

/**
 * Resolve one `.delete` line to its workspace-relative path, or refuse it.
 * Lexical: no absolute or drive path, no "..", not the root. On disk: the
 * parent is canonical (validatedDir: no link, junction or case alias above
 * the entry) and the entry itself is a plain file or directory with its exact
 * on-disk spelling. So exclude() sees the real path and nothing is removed
 * through a link.
 */
function deleteSegments(list: string, line: string): string[] {
  const segs = line.replaceAll("\\", "/").split("/").filter((x) =>
    x !== "" && x !== "."
  );
  if (
    isAbsolute(line) || /^[A-Za-z]:/.test(line) || segs.length === 0 ||
    segs.includes("..")
  ) {
    throw new ValidationError(
      `${list}: .delete entry escapes the workspace: ${line}`,
      [line],
    );
  }
  return segs;
}

async function deleteTarget(
  root: string,
  list: string,
  line: string,
  segs: string[],
): Promise<string> {
  const refuse = (why: string) =>
    new ValidationError(`${list}: .delete entry ${why}: ${line}`, [line]);
  const p = join(root, ...segs);
  const st = await Deno.lstat(p).catch(() => null);
  if (!st) throw refuse("not found");
  try {
    await validatedDir(join(root, ...segs.slice(0, -1)));
  } catch {
    throw refuse("is under a link, a junction or a case alias");
  }
  const real = (await Deno.realPath(p)).replace(
    /^[a-z]:/,
    (d) => d.toUpperCase(),
  );
  if (st.isSymlink || (!st.isFile && !st.isDirectory) || real !== p) {
    throw refuse("is a link, a special file or a case alias");
  }
  return p;
}

/** Copy an overlay onto target, then apply its `.delete` list. */
export async function applyOverlay(
  overlayDir: string,
  target: string,
  opts: { exclude?: (rel: string) => boolean } = {},
): Promise<void> {
  if (!await exists(overlayDir)) return;
  const root = await validatedDir(target);
  // 1. Hostile copy into fresh private scratch (the strict new-or-empty API is unchanged).
  const tmp = await Deno.makeTempDir({ prefix: "cg-overlay-" });
  try {
    const r = await safeCopyTree(overlayDir, join(tmp, "o"), {
      skip: (rel) => rel === DELETE_LIST || (opts.exclude?.(rel) ?? false),
    });
    if (r.refused.length + r.ambiguous.length > 0) {
      const bad = [...r.refused, ...r.ambiguous];
      throw new ValidationError(
        `links or case-ambiguous names in ${overlayDir}: ${bad.join(", ")}`,
        bad,
      );
    }
    // 2. Validated merge into the populated workspace.
    const files: string[] = [];
    const walk = async (d: string, rel: string): Promise<void> => {
      for await (const e of Deno.readDir(d)) {
        const r1 = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory) await walk(join(d, e.name), r1);
        else files.push(r1);
      }
    };
    await walk(r.dst, "");
    for (const rel of files.sort()) {
      const parts = rel.split("/");
      const dir = await validatedDest(join(root, ...parts.slice(0, -1)));
      const dest = join(dir, parts.at(-1)!);
      const st = await Deno.lstat(dest).catch(() => null);
      if (st) {
        if (st.isSymlink || !st.isFile) {
          throw new ValidationError(
            `overlay destination is not a plain file: ${rel}`,
            [rel],
          );
        }
        if (await Deno.realPath(dest) !== dest) {
          throw new ValidationError(
            `overlay destination is a case alias: ${rel}`,
            [rel],
          );
        }
      } else {
        const alias = [...Deno.readDirSync(dir)].find((e) =>
          e.name.toLowerCase() === parts.at(-1)!.toLowerCase()
        );
        if (alias) {
          throw new ValidationError(
            `overlay destination is a case alias of ${alias.name}: ${rel}`,
            [rel],
          );
        }
      }
      await Deno.copyFile(join(r.dst, ...parts), dest);
    }
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
  const list = join(overlayDir, DELETE_LIST);
  if (!await exists(list)) return;
  for (const raw of (await Deno.readTextFile(list)).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const segs = deleteSegments(list, line);
    // A wrong-case spelling of an excluded path is not excluded here, and
    // deleteTarget then refuses it as a case alias.
    if (opts.exclude?.(segs.join("/"))) continue;
    await Deno.remove(await deleteTarget(root, list, line, segs), {
      recursive: true,
    });
  }
}

export interface StageOptions {
  repoRoot: string;
  task: LoadedTask;
  refapp: RefappRef;
  symbols: SymbolPackage[];
  symbolStore: string;
  out: string;
}

export interface StagedWorkspace {
  /** Mounted read-write into the sandbox as C:\workspace. */
  workspace: string;
  /** Untouched copy of the staged workspace: the trusted verdict input. */
  pristine: string;
  /** Mounted read-only as C:\task. */
  taskDir: string;
  apps: StagedApp[];
}

export type TaskSource = (o: StageOptions) => Promise<StagedWorkspace>;

async function run(cmd: string, args: string[], cwd?: string): Promise<void> {
  const out = await new Deno.Command(cmd, {
    args,
    ...(cwd ? { cwd } : {}),
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!out.success) {
    const err = new TextDecoder().decode(out.stderr).trim();
    throw new ValidationError(`${cmd} ${args.join(" ")} failed: ${err}`, [err]);
  }
}

export async function stageRefappTask(
  o: StageOptions,
): Promise<StagedWorkspace> {
  const out = await validatedDest(o.out);
  const made = ["workspace", "pristine", "task", "refapp-extract", "refapp.tar"]
    .map((n) => join(out, n));
  try {
    return await stageInto(o, out);
  } catch (err) {
    // A failed staging leaves nothing behind, so a retry into `out` works.
    for (const m of made) {
      await Deno.remove(m, { recursive: true }).catch(() => {});
    }
    throw err;
  }
}

async function stageInto(
  o: StageOptions,
  out: string,
): Promise<StagedWorkspace> {
  const workspace = await validatedDest(join(out, "workspace"));
  const pristine = join(out, "pristine");
  const taskDir = await validatedDest(join(out, "task"));
  const extract = await validatedDest(join(out, "refapp-extract"));
  // 1. The refapp source at the resolved commit, build artifacts dropped:
  //    exactly the files resolveRefapp hashed (Part 1 contract). No autocrlf:
  //    resolveRefapp hashes the raw blobs, and the listTree check below fails
  //    loudly if an attribute still converts a file.
  const tar = join(out, "refapp.tar");
  await run("git", [
    "-c",
    "core.autocrlf=false",
    "archive",
    "--format=tar",
    "-o",
    tar,
    o.refapp.commit,
    REFAPP_PATH,
  ], o.repoRoot);
  // Relative archive path from inside the extract dir: GNU tar (Git Bash's,
  // often first on PATH) reads "C:\..." as a remote host:path.
  await run("tar", ["-xf", "../refapp.tar", "--strip-components=2"], extract);
  await safeCopyTree(extract, workspace, { skip: isTaskBuildArtifact });
  await Deno.remove(extract, { recursive: true });
  await Deno.remove(tar);
  const got = await listTree(workspace, "task");
  if (JSON.stringify(got) !== JSON.stringify(o.refapp.files)) {
    throw new ValidationError(
      `staged refapp does not match ${o.refapp.version} (${o.refapp.commit})`,
      [o.refapp.commit],
    );
  }
  // 2. Task overlay (injected bug, stub, removed feature).
  await applyOverlay(join(o.task.dir, "overlay"), workspace);
  // 3. Pre-seeded symbols, verified against the lock.
  await restoreSymbols(
    o.symbolStore,
    o.symbols,
    join(workspace, ".alpackages"),
  );
  // 4. C:\task: prompt, attachments, agent-visible metadata only.
  const t = o.task.task;
  await Deno.writeFile(
    join(taskDir, "prompt.md"),
    await Deno.readFile(join(o.task.dir, t.prompt)),
  );
  for (const a of t.attachments) {
    await Deno.mkdir(join(taskDir, a, ".."), { recursive: true });
    await Deno.copyFile(join(o.task.dir, a), join(taskDir, a));
  }
  await Deno.writeTextFile(
    join(taskDir, "task.json"),
    JSON.stringify(agentVisibleMetadata(t), null, 2) + "\n",
  );
  await safeCopyTree(workspace, pristine);
  return { workspace, pristine, taskDir, apps: await readAppGraph(workspace) };
}

export const TASK_SOURCES: Record<HarnessTask["source"], TaskSource> = {
  refapp: stageRefappTask,
};
