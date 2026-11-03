/**
 * H-54: one shared results root. A results dir inside a job worktree under
 * <coord>/jobs dies with the worktree, so the harness refuses to start a new
 * one there (an existing one only warns), and `harness archive` copies a
 * finished root into the shared root, write-once and verified by hash.
 */
import * as colors from "@std/fmt/colors";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "@std/path";
import { ConfigurationError } from "../errors.ts";
import { DEFAULT_COORD_ROOT } from "./allocation.ts";
import {
  BENCH_LOCK_FILENAME,
  DEFAULT_STALE_AFTER_MS,
  isBenchRunning,
} from "../utils/bench-lock.ts";

/** Per-machine state of a results root (any nested root too), never archived. */
const MACHINE_STATE = new Set([
  "symbols",
  "baselines",
  "bc-ledger",
  "egress-host.jsonl",
]);
const RECORD_DIRS = ["campaigns", "executions", "runs"];
/** Frozen content (agent files): copied byte for byte, never filtered. */
const FROZEN = new Set(["workspaces", "artifacts"]);
/**
 * Publish temps: `<name>.tmp-<uuid>[-<uuid>]`, `.tmp-<uuid>`,
 * `.tmp-<execution>-<hex>`, and this archive's own `.tmp-archive-<uuid>`.
 */
const TEMP = /\.tmp-(archive-)?[0-9a-f][0-9a-f-]*$/i;

const inside = (child: string, parent: string): boolean => {
  const r = relative(parent, child);
  return r === "" || (r.split(/[\\/]/)[0] !== ".." && !isAbsolute(r));
};

const isDirSync = (p: string): boolean => {
  try {
    return Deno.statSync(p).isDirectory;
  } catch {
    return false;
  }
};

/** `p` with every existing ancestor resolved through links and junctions. */
export function canonical(p: string): string {
  let head = resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return join(Deno.realPathSync(head), ...rest.reverse());
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
      const up = dirname(head);
      if (up === head) return resolve(p);
      rest.push(basename(head));
      head = up;
    }
  }
}

/** The registered git worktree under `jobsRoot` that holds `path`, or null. */
export function jobWorktreeOf(path: string, jobsRoot: string): string | null {
  const jobs = canonical(jobsRoot);
  let dir = canonical(path);
  if (!inside(dir, jobs)) return null;
  while (relative(jobs, dir) !== "") {
    const git = join(dir, ".git");
    try {
      const st = Deno.statSync(git);
      if (st.isDirectory) return dir;
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(Deno.readTextFileSync(git));
      // a .git file whose gitdir is gone: a removed worktree, not registered
      if (m?.[1] && isDirSync(resolve(dir, m[1]))) return dir;
    } catch {
      // no .git here
    }
    dir = dirname(dir);
  }
  return null;
}

const isRecordRoot = (dir: string) =>
  RECORD_DIRS.some((d) => isDirSync(join(dir, d)));

/**
 * The guard for a --results-dir: inside a registered job worktree a new root
 * is refused and an existing one warns (archive it before the worktree goes).
 */
export function resultsDirCheck(
  resultsDir: string,
  jobsRoot: string,
): { refuse?: string; warn?: string } | null {
  const wt = jobWorktreeOf(resultsDir, jobsRoot);
  if (!wt) return null;
  const shared = join(dirname(resolve(jobsRoot)), "results", "harness");
  return isRecordRoot(resultsDir)
    ? {
      warn:
        `results dir ${resultsDir} is inside job worktree ${wt}: run \`harness archive --from ${resultsDir} --to ${shared}\` before the worktree is removed`,
    }
    : {
      refuse:
        `results dir ${resultsDir} is inside job worktree ${wt} and would be removed with it: pass --results-dir ${shared} (the shared results root)`,
    };
}

/**
 * Recovery publishes into the root its attempt began in (write-once), so a
 * job-worktree root (a pre-H-54 attempt) is never refused there, only named.
 */
export function warnJobRoot(
  dir: string,
  coordRoot = Deno.env.get("CG_COORD_ROOT") || DEFAULT_COORD_ROOT,
): void {
  const c = resultsDirCheck(dir, join(coordRoot, "jobs"));
  const why = c?.warn ?? c?.refuse;
  if (why) {
    console.warn(
      colors.yellow(`[WARN] recovery publishes into its own root: ${why}`),
    );
  }
}

/** {@link resultsDirCheck}, enforced: a refusal throws, a warning prints. */
export function guardResultsDir(resultsDir: string, jobsRoot: string): void {
  const c = resultsDirCheck(resultsDir, jobsRoot);
  if (c?.refuse) throw new ConfigurationError(c.refuse);
  if (c?.warn) console.warn(colors.yellow(`[WARN] ${c.warn}`));
}

export interface ArchiveOptions {
  from: string;
  to: string;
  coordRoot: string;
  /** A copy under <coord>/tasks (a proof or pre-rejudge copy) as the source. */
  allowCoordCopy?: boolean;
  /** A source outside <coord>/jobs (e.g. a lane worktree's root). */
  allowNonJobSource?: boolean;
  /** Refuse a source with any file modified this recently (default 10 min). */
  quietMs?: number;
  /** Test seam: runs after the copy, before the source is re-read. */
  afterCopy?: () => Promise<void>;
}

export interface ArchiveReport {
  /** Files copied this run. */
  copied: number;
  /** Files already in the destination with identical content. */
  present: number;
  /** Files whose destination hash matched the source after the copy. */
  verified: number;
  /** Machine-state entries left out, relative to --from. */
  skipped: string[];
}

async function lstatOrNull(p: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(p);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

async function sha256(path: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface Inventory {
  /** relative path -> sha256 */
  files: Map<string, string>;
  dirs: string[];
  skipped: string[];
  newest: number;
}

/** Every archivable file and dir under `root`, hashed. */
async function inventory(root: string): Promise<Inventory> {
  const inv: Inventory = { files: new Map(), dirs: [], skipped: [], newest: 0 };
  // mode 0: a records tree; 1: a store (workspaces/, artifacts/), whose
  // publish temps are still skipped; 2: frozen content below a store entry.
  const walk = async (rel: string, mode: 0 | 1 | 2) => {
    const abs = join(root, rel);
    const frozen = mode === 2;
    const recordRoot = mode === 0 && isRecordRoot(abs);
    for await (const e of Deno.readDir(abs)) {
      const r = rel ? join(rel, e.name) : e.name;
      if (!frozen) {
        const lower = e.name.toLowerCase();
        if (lower === BENCH_LOCK_FILENAME) {
          const m = (await Deno.stat(join(root, r))).mtime?.getTime() ?? 0;
          if (Date.now() - m <= DEFAULT_STALE_AFTER_MS) {
            throw new ConfigurationError(
              `${
                join(root, r)
              } is a live bench marker: archive after the run ends`,
            );
          }
          continue;
        }
        if (lower.startsWith(BENCH_LOCK_FILENAME) || TEMP.test(e.name)) {
          continue;
        }
        if (
          recordRoot &&
          (MACHINE_STATE.has(lower) || lower.startsWith("egress-verified.json"))
        ) {
          inv.skipped.push(r);
          continue;
        }
      }
      if (e.isSymlink) {
        throw new ConfigurationError(
          `${
            join(root, r)
          } is a link or junction: refusing to archive through it`,
        );
      }
      if (e.isDirectory) {
        inv.dirs.push(r);
        await walk(
          r,
          // any workspaces/ or artifacts/ store, fixtures/workspaces included
          mode > 0 ? 2 : FROZEN.has(e.name.toLowerCase()) ? 1 : 0,
        );
      } else if (e.isFile) {
        const p = join(root, r);
        inv.newest = Math.max(
          inv.newest,
          (await Deno.stat(p)).mtime?.getTime() ?? 0,
        );
        inv.files.set(r, await sha256(p));
      } else {
        throw new ConfigurationError(`${join(root, r)}: not a file or dir`);
      }
    }
  };
  await walk("", 0);
  return inv;
}

/**
 * Copy the records of `from` into `to`. Idempotent: an identical file is
 * left alone; any same-path file with other content refuses the whole run
 * before anything is copied. Each copy is hash-checked before it is linked
 * into place, and the source is re-read after the copy: any change refuses.
 */
export async function archiveResults(
  o: ArchiveOptions,
): Promise<ArchiveReport> {
  const from = canonical(o.from);
  const to = canonical(o.to);
  const coord = canonical(o.coordRoot);
  const jobs = canonical(join(coord, "jobs"));
  const tasks = canonical(join(coord, "tasks"));
  if (inside(from, to) || inside(to, from)) {
    throw new ConfigurationError(
      `--from ${from} and --to ${to} overlap (one holds the other)`,
    );
  }
  if (!isRecordRoot(from)) {
    throw new ConfigurationError(
      `${from} is not a harness results root (no ${
        RECORD_DIRS.join(", ")
      } dir)`,
    );
  }
  if (inside(from, tasks)) {
    if (!o.allowCoordCopy) {
      throw new ConfigurationError(
        `${from} is a copy under the coord tasks (proof or pre-rejudge records), not a job root: pass --allow-coord-copy to archive it anyway`,
      );
    }
  } else if (!inside(from, jobs) && !o.allowNonJobSource) {
    throw new ConfigurationError(
      `${from} is not under ${jobs} (archive sources are job roots): pass --allow-non-job-source to archive it anyway`,
    );
  }
  const wt = jobWorktreeOf(to, jobs);
  if (wt) {
    throw new ConfigurationError(
      `--to ${to} is inside job worktree ${wt}, which is removed later`,
    );
  }
  // H-49: a run's marker sits in its checkout's results dir, above the root.
  for (let d = from;; d = dirname(d)) {
    if (isBenchRunning(d)) {
      throw new ConfigurationError(
        `${from} is under a live run (fresh ${
          join(d, BENCH_LOCK_FILENAME)
        }): archive it after the run ends`,
      );
    }
    if (dirname(d) === d) break;
  }
  const inv = await inventory(from);
  const quietMs = o.quietMs ?? 10 * 60_000;
  if (Date.now() - inv.newest < quietMs) {
    throw new ConfigurationError(
      `${from} changed in the last ${
        Math.round(quietMs / 60_000)
      } min (a run may still write it): archive it once it is quiet`,
    );
  }
  const conflicts: string[] = [];
  const todo: string[] = [];
  // Dirs first: a link or junction anywhere below --to would redirect writes.
  for (const rel of inv.dirs) {
    const st = await lstatOrNull(join(to, rel));
    if (st && (st.isSymlink || !st.isDirectory)) conflicts.push(rel);
  }
  for (const [rel, hash] of inv.files) {
    const st = await lstatOrNull(join(to, rel));
    if (!st) todo.push(rel);
    else if (
      st.isSymlink || !st.isFile || await sha256(join(to, rel)) !== hash
    ) conflicts.push(rel);
  }
  if (conflicts.length > 0) {
    throw new ConfigurationError(
      `${conflicts.length} path(s) already in ${to} with other content (nothing copied): ${
        conflicts.slice(0, 20).join(", ")
      }`,
    );
  }
  // The destination must still be where it was planned (no link or junction
  // swapped in since): checked after each mkdir, before each copy and right
  // before each link. ponytail: a swap inside those gaps is not caught; it
  // needs a hostile local process (no openat-style API in Deno).
  const unmoved = (p: string) => {
    if (relative(canonical(p), p) !== "") {
      throw new ConfigurationError(
        `${p} now resolves to ${
          canonical(p)
        } (a link or junction appeared): stopped`,
      );
    }
  };
  await Deno.mkdir(to, { recursive: true });
  unmoved(to);
  for (const rel of inv.dirs) {
    await Deno.mkdir(join(to, rel), { recursive: true });
    unmoved(join(to, rel));
  }
  let copied = 0;
  for (const rel of todo) {
    const dest = join(to, rel);
    await Deno.mkdir(dirname(dest), { recursive: true });
    unmoved(dirname(dest));
    const tmp = `${dest}.tmp-archive-${crypto.randomUUID()}`;
    try {
      await Deno.copyFile(join(from, rel), tmp);
      if (await sha256(tmp) !== inv.files.get(rel)) {
        throw new ConfigurationError(
          `copy of ${rel} does not match its source hash (source changed?)`,
        );
      }
      // durable before it is published (as records.ts publishOnce)
      using f = await Deno.open(tmp, { read: true, write: true });
      await f.sync();
      unmoved(dirname(dest)); // again, right before the publish
      await Deno.link(tmp, dest); // write-once: never replaces a file
      copied++;
    } catch (e) {
      // another writer got there first: the hash check below decides
      if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
    } finally {
      await Deno.remove(tmp).catch(() => {});
    }
  }
  await o.afterCopy?.();
  const again = await inventory(from);
  const changed = [...new Set([...inv.files.keys(), ...again.files.keys()])]
    .filter((r) => inv.files.get(r) !== again.files.get(r));
  const dirsNow = new Set(again.dirs);
  changed.push(
    ...inv.dirs.filter((d) => !dirsNow.has(d)),
    ...again.dirs.filter((d) => !inv.dirs.includes(d)),
  );
  if (changed.length > 0) {
    throw new ConfigurationError(
      `${from} changed during the archive (${changed.length} file(s), e.g. ${
        changed.slice(0, 5).join(", ")
      }): not clean; archive it again once it is quiet`,
    );
  }
  const bad: string[] = [];
  if (relative(canonical(to), to) !== "") bad.push(to);
  for (const rel of inv.dirs) {
    const st = await lstatOrNull(join(to, rel));
    if (!st || st.isSymlink || !st.isDirectory) bad.push(rel);
  }
  for (const [rel, hash] of inv.files) {
    const st = await lstatOrNull(join(to, rel));
    if (!st?.isFile || st.isSymlink || await sha256(join(to, rel)) !== hash) {
      bad.push(rel);
    }
  }
  if (bad.length > 0) {
    throw new ConfigurationError(
      `hash check failed for ${bad.length} file(s) in ${to}: ${
        bad.slice(0, 20).join(", ")
      }`,
    );
  }
  return {
    copied,
    present: inv.files.size - todo.length,
    verified: inv.files.size,
    skipped: inv.skipped.sort(),
  };
}
