/**
 * Task identity (spec 1a section 6, spec 1b section 7): each task has a
 * visible-input hash (what the agent sees) and an oracle hash (what judges
 * it). The task-set identity hashes only the sorted (id, visible, oracle)
 * projection, so adding a task never re-keys the others and a new commit
 * with identical content changes nothing.
 */

import { join } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import {
  hashContent,
  hashFile,
  hashJson,
  hashTree,
  isTaskBuildArtifact,
  posixRel,
  type TreeEntry,
} from "./hash.ts";
import type { HarnessTask, LoadedTask } from "./task.ts";

/** Every embedded SHA-256 (identities, component and file hashes): 64 lower-case hex. */
export const Sha256Hex = z.string().regex(
  /^[0-9a-f]{64}$/,
  "lower-case hex sha256",
);

/** Path of the refapp inside the repo; tags and commits resolve against it. */
export const REFAPP_PATH = "harness-tasks/refapp";

export interface RefappRef {
  version: string;
  /** Provenance only; not part of any hash. */
  commit: string;
  /** Hash of the canonical refapp source manifest (see refappSource). */
  source_hash: string;
  files: TreeEntry[];
}

async function git(
  repoRoot: string,
  args: string[],
): Promise<Uint8Array<ArrayBuffer> | null> {
  const out = await new Deno.Command("git", {
    args,
    cwd: repoRoot,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  return out.success ? out.stdout : null;
}

/** Reads lines and exact byte counts off a stream, holding at most a chunk. */
function byteReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  let buf = new Uint8Array(0);
  const fill = async () => {
    const { done, value } = await reader.read();
    if (done) return false;
    const next = new Uint8Array(buf.length + value.length);
    next.set(buf);
    next.set(value, buf.length);
    buf = next;
    return true;
  };
  return {
    async line(): Promise<string | null> {
      let nl;
      while ((nl = buf.indexOf(10)) < 0) if (!(await fill())) return null;
      const line = new TextDecoder().decode(buf.subarray(0, nl));
      buf = buf.subarray(nl + 1);
      return line;
    },
    async bytes(n: number): Promise<Uint8Array<ArrayBuffer> | null> {
      const out = new Uint8Array(n);
      for (let at = 0; at < n;) {
        if (buf.length === 0 && !(await fill())) return null;
        const k = Math.min(n - at, buf.length);
        out.set(buf.subarray(0, k), at);
        at += k;
        buf = buf.subarray(k);
      }
      return out;
    },
    cancel: () => reader.cancel(),
  };
}

const text = (b: Uint8Array) => new TextDecoder().decode(b).trim();

/**
 * Canonical refapp source at a commit: every tracked file under REFAPP_PATH
 * except spec 1b section 7 build artifacts, hashed with the same content
 * rule as `listTree(dir, "task")` (CRLF to LF for text). Symlinks and
 * submodules in the tree are refused. Part 2 staging copies exactly these
 * paths from this commit, so a staged copy re-hashes to the same list.
 */
async function refappSource(
  repoRoot: string,
  commit: string,
): Promise<TreeEntry[]> {
  const ls = await git(repoRoot, [
    "ls-tree",
    "-r",
    "-z",
    commit,
    "--",
    `${REFAPP_PATH}/`,
  ]);
  if (!ls) throw new ValidationError(`git ls-tree failed at ${commit}`, []);
  const blobs: Array<{ rel: string; sha: string }> = [];
  for (const rec of new TextDecoder().decode(ls).split("\0")) {
    if (rec === "") continue;
    // "<mode> <type> <sha>\t<path>": the path itself may contain tabs.
    const tab = rec.indexOf("\t");
    const [mode, , sha] = rec.slice(0, tab).split(" ") as [
      string,
      string,
      string,
    ];
    // Git paths are POSIX: a backslash is a name character, never a separator.
    const rel = posixRel(
      rec.slice(tab + 1 + REFAPP_PATH.length + 1),
      "linux",
    );
    if (mode === "120000" || mode === "160000") {
      throw new ValidationError(`refapp contains a link or submodule: ${rel}`, [
        rel,
      ]);
    }
    if (!isTaskBuildArtifact(rel)) blobs.push({ rel, sha });
  }
  if (blobs.length === 0) return [];
  // Requests are written while results are read: writing them all first
  // deadlocks once git blocks on a full stdout pipe. Each blob is read and
  // hashed on its own, so the whole refapp is never held in memory.
  const child = new Deno.Command("git", {
    args: ["cat-file", "--batch"],
    cwd: repoRoot,
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  const writing = (async () => {
    const w = child.stdin.getWriter();
    await w.write(
      new TextEncoder().encode(blobs.map((b) => b.sha).join("\n") + "\n"),
    );
    await w.close();
  })();
  const rd = byteReader(child.stdout);
  const out: TreeEntry[] = [];
  try {
    for (const b of blobs) {
      // "<sha> blob <size>"; anything else ("<sha> missing") is a broken repo.
      const [, type, len] = ((await rd.line()) ?? "").split(" ");
      const size = Number(len);
      const content = type === "blob" && Number.isInteger(size)
        ? await rd.bytes(size)
        : null;
      if (!content || (await rd.bytes(1))?.[0] !== 10) {
        throw new ValidationError(
          `git cat-file could not read ${REFAPP_PATH}/${b.rel} (${b.sha})`,
          [b.rel],
        );
      }
      out.push({ path: b.rel, sha256: await hashContent(b.rel, content) });
    }
    await writing;
  } finally {
    await rd.cancel().catch(() => {});
    await writing.catch(() => {});
    try {
      child.kill();
    } catch { /* already exited; on success git is at EOF anyway */ }
    await child.status;
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Resolve a refapp tag or commit to an immutable commit and source hash. */
export async function resolveRefapp(
  repoRoot: string,
  version: string,
): Promise<RefappRef> {
  const out = await git(repoRoot, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${version}^{commit}`,
  ]);
  if (!out) {
    throw new ValidationError(`refapp_version ${version} does not resolve`, [
      version,
    ]);
  }
  const commit = text(out);
  const files = await refappSource(repoRoot, commit);
  if (files.length === 0) {
    throw new ValidationError(`${REFAPP_PATH} is empty at ${version}`, [
      version,
    ]);
  }
  return {
    version,
    commit,
    source_hash: await hashJson({ part: "refapp", files }),
    files,
  };
}

/**
 * BC app ids are GUID-shaped but not always RFC 4122 (real Microsoft apps
 * carry non-RFC version/variant nibbles, M1-26). Ids the harness generates
 * keep z.uuid().
 */
export const BcGuid = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "BC GUID (8-4-4-4-12 hex)",
);

const SymbolPackageSchema = z.strictObject({
  app_id: BcGuid,
  name: z.string().min(1),
  publisher: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
  /** File name under the restored `.alpackages`, to locate and verify it. */
  file: z.string().regex(/^[^\\/]+\.app$/),
  sha256: Sha256Hex,
});
export const SymbolsLockSchema = z.strictObject({
  v: z.literal(1),
  packages: z.array(SymbolPackageSchema).min(1),
}).superRefine((l, ctx) => {
  // GUIDs are case-insensitive: A and a name the same app.
  const seen = new Set<string>();
  l.packages.forEach((p, i) => {
    if (seen.has(p.app_id.toLowerCase())) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate app_id ${p.app_id}`,
        path: ["packages", i, "app_id"],
      });
    }
    seen.add(p.app_id.toLowerCase());
  });
});
export type SymbolPackage = z.output<typeof SymbolPackageSchema>;

export const SYMBOLS_LOCK_PATH = "harness-tasks/symbols.lock.json";

/**
 * Read the symbols lock; null when it does not exist yet (identities are
 * then provisional). Packages come back sorted by app_id.
 */
export async function loadSymbolsLock(
  repoRoot: string,
): Promise<SymbolPackage[] | null> {
  const path = join(repoRoot, SYMBOLS_LOCK_PATH);
  let raw: unknown;
  try {
    raw = JSON.parse(await Deno.readTextFile(path));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`${path}: ${msg}`, [msg]);
  }
  const result = SymbolsLockSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues.map((i) =>
      `${i.path.join(".") || "(root)"}: ${i.message}`
    );
    throw new ValidationError(
      `Invalid ${path}:\n  ${errors.join("\n  ")}`,
      errors,
    );
  }
  return [...result.data.packages].sort((a, b) =>
    a.app_id.localeCompare(b.app_id)
  );
}

/**
 * The only task.yml fields the agent may see (written to C:\task by Part 2
 * staging). `kind`, scorers and test lists are oracle-side; `touches`,
 * `coupling`, `contamination` are analysis metadata. If a field is ever
 * added here that is also an oracle input, it is hashed in both identities.
 */
export const AGENT_VISIBLE_FIELDS = ["id", "attachments", "limits"] as const;

export function agentVisibleMetadata(task: HarnessTask) {
  return {
    id: task.id,
    attachments: [...task.attachments].sort(),
    limits: task.limits,
  };
}

/**
 * Visible-input hash: prompt, attachments, canonical refapp source (includes
 * shipped Test\ sources), overlay/, symbols lock, agent-visible metadata.
 * `symbols: null` means no lock yet; the result is provisional.
 */
export async function visibleInputHash(
  t: LoadedTask,
  refapp: RefappRef,
  symbols: SymbolPackage[] | null,
): Promise<string> {
  const { task, dir } = t;
  const attachments = [];
  for (const a of [...task.attachments].sort()) {
    attachments.push({ path: a, sha256: await hashFile(dir, join(dir, a)) });
  }
  return hashJson({
    part: "visible",
    source: task.source,
    refapp: refapp.source_hash,
    prompt: await hashFile(dir, join(dir, task.prompt)),
    attachments,
    overlay: await hashTree(join(dir, "overlay"), "task", { optional: true }),
    symbols,
    metadata: agentVisibleMetadata(task),
  });
}

/**
 * Oracle hash: oracle/, mutants/, correct/ (a runtime input for
 * mutant_kill), and the scorer fields of task.yml. naive/ is in neither hash.
 */
export async function oracleHash(t: LoadedTask): Promise<string> {
  const { task, dir } = t;
  const tree = (d: string) =>
    hashTree(join(dir, d), "task", { optional: true });
  return hashJson({
    part: "oracle",
    id: task.id,
    kind: task.kind,
    scorers: task.scorers,
    pass_to_pass: task.pass_to_pass,
    fail_to_pass: task.fail_to_pass,
    mutants: task.mutants,
    oracle: await tree("oracle"),
    mutants_tree: await tree("mutants"),
    correct: await tree("correct"),
  });
}

export const TaskIdentitySchema = z.strictObject({
  id: z.string(),
  /** Provenance only; not hashed into the task-set identity. */
  refapp_commit: z.string(),
  visible: Sha256Hex,
  oracle: Sha256Hex,
});
export type TaskIdentity = z.output<typeof TaskIdentitySchema>;

export const TaskSetIdentitySchema = z.strictObject({
  identity: Sha256Hex,
  /** True while no symbols lock exists; campaigns refuse it (M1-07). */
  provisional: z.boolean(),
  tasks: z.array(TaskIdentitySchema),
});
export type TaskSetIdentity = z.output<typeof TaskSetIdentitySchema>;

/** Identity over the sorted (id, visible, oracle) projection only. */
export function taskSetHash(tasks: TaskIdentity[]): Promise<string> {
  const projection = [...tasks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, visible, oracle }) => ({ id, visible, oracle }));
  return hashJson({ part: "task-set", tasks: projection });
}

/** Hash every task and build the sorted task-set manifest. */
export async function taskSetIdentity(
  repoRoot: string,
  tasks: LoadedTask[],
  symbols: SymbolPackage[] | null,
): Promise<TaskSetIdentity> {
  const refs = new Map<string, RefappRef>();
  const entries: TaskIdentity[] = [];
  for (const t of tasks) {
    const v = t.task.refapp_version;
    if (!refs.has(v)) refs.set(v, await resolveRefapp(repoRoot, v));
    const refapp = refs.get(v)!;
    entries.push({
      id: t.task.id,
      refapp_commit: refapp.commit,
      visible: await visibleInputHash(t, refapp, symbols),
      oracle: await oracleHash(t),
    });
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return {
    identity: await taskSetHash(entries),
    provisional: symbols === null,
    tasks: entries,
  };
}
