/**
 * H-54: one shared results root. A results dir inside a job worktree under
 * <coord>/jobs dies with the worktree, so the harness refuses to start a new
 * one there (an existing one only warns), and `harness archive` copies a
 * finished root into the shared root, write-once and verified by hash.
 */
import { dirname, isAbsolute, join, relative, resolve } from "@std/path";
import { ConfigurationError } from "../errors.ts";
import { BENCH_LOCK_FILENAME, isBenchRunning } from "../utils/bench-lock.ts";

/** Per-machine state under a results root, never archived. */
const MACHINE_STATE = new Set([
  "symbols",
  "baselines",
  "bc-ledger",
  "egress-host.jsonl",
]);
const RECORD_DIRS = ["campaigns", "executions", "runs"];

const inside = (child: string, parent: string): boolean => {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

function existsSync(p: string): boolean {
  try {
    Deno.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** The registered git worktree under `jobsRoot` that holds `path`, or null. */
export function jobWorktreeOf(path: string, jobsRoot: string): string | null {
  const jobs = resolve(jobsRoot);
  let dir = resolve(path);
  if (!inside(dir, jobs)) return null;
  while (dir !== jobs && inside(dir, jobs)) {
    const git = join(dir, ".git");
    try {
      const st = Deno.statSync(git);
      if (st.isDirectory) return dir;
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(Deno.readTextFileSync(git));
      // a .git file whose gitdir is gone: a removed worktree, not registered
      if (m?.[1] && existsSync(resolve(dir, m[1]))) return dir;
    } catch {
      // no .git here
    }
    dir = dirname(dir);
  }
  return null;
}

const isRecordRoot = (dir: string) =>
  RECORD_DIRS.some((d) => existsSync(join(dir, d)));

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

export interface ArchiveOptions {
  from: string;
  to: string;
  coordRoot: string;
  /** A copy under <coord>/tasks (a proof or pre-rejudge copy) as the source. */
  allowCoordCopy?: boolean;
}

export interface ArchiveReport {
  /** Files copied this run. */
  copied: number;
  /** Files already in the destination with identical content. */
  present: number;
  /** Files whose destination hash matched the source after the copy. */
  verified: number;
  /** Top-level machine-state entries left out. */
  skipped: string[];
}

async function sha256(path: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Every archivable file under `root`, as paths relative to it. */
async function files(root: string, skipped: string[]): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string) => {
    for await (const e of Deno.readDir(join(root, rel))) {
      const r = rel ? join(rel, e.name) : e.name;
      if (e.name === BENCH_LOCK_FILENAME || e.name.includes(".tmp-")) continue;
      if (
        !rel &&
        (MACHINE_STATE.has(e.name) || e.name.startsWith("egress-verified.json"))
      ) {
        skipped.push(e.name);
        continue;
      }
      if (e.isDirectory) await walk(r);
      else if (e.isFile) out.push(r);
      else throw new ConfigurationError(`${join(root, r)}: not a file or dir`);
    }
  };
  await walk("");
  return out.sort();
}

/**
 * Copy the records of `from` into `to`. Idempotent: an identical file is
 * left alone; any same-path file with other content refuses the whole run
 * before anything is copied. Every file is hash-checked after the copy.
 */
export async function archiveResults(
  o: ArchiveOptions,
): Promise<ArchiveReport> {
  const from = resolve(o.from);
  const to = resolve(o.to);
  const jobs = join(o.coordRoot, "jobs");
  if (inside(from, to) || inside(to, from)) {
    throw new ConfigurationError(
      `--from ${from} and --to ${to} overlap (one holds the other)`,
    );
  }
  if (!isRecordRoot(from)) {
    throw new ConfigurationError(
      `${from} is not a harness results root (no ${RECORD_DIRS.join(", ")})`,
    );
  }
  if (inside(from, join(o.coordRoot, "tasks")) && !o.allowCoordCopy) {
    throw new ConfigurationError(
      `${from} is a copy under the coord tasks (proof or pre-rejudge records), not a job root: pass --allow-coord-copy to archive it anyway`,
    );
  }
  const wt = jobWorktreeOf(to, jobs);
  if (wt) {
    throw new ConfigurationError(
      `--to ${to} is inside job worktree ${wt}, which is removed later`,
    );
  }
  // H-49: a run's marker sits in its checkout's results dir (the root's parent).
  if (isBenchRunning(from) || isBenchRunning(dirname(from))) {
    throw new ConfigurationError(
      `${from} belongs to a live run (fresh ${BENCH_LOCK_FILENAME}): archive it after the run ends`,
    );
  }
  const skipped: string[] = [];
  const plan: { rel: string; hash: string; present: boolean }[] = [];
  const conflicts: string[] = [];
  for (const rel of await files(from, skipped)) {
    const hash = await sha256(join(from, rel));
    let present = false;
    try {
      const st = await Deno.stat(join(to, rel));
      if (!st.isFile || await sha256(join(to, rel)) !== hash) {
        conflicts.push(rel);
      }
      present = true;
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    plan.push({ rel, hash, present });
  }
  if (conflicts.length > 0) {
    throw new ConfigurationError(
      `${conflicts.length} file(s) already in ${to} with other content (nothing copied): ${
        conflicts.slice(0, 20).join(", ")
      }`,
    );
  }
  let copied = 0;
  for (const p of plan.filter((p) => !p.present)) {
    const dest = join(to, p.rel);
    await Deno.mkdir(dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-archive-${crypto.randomUUID()}`;
    await Deno.copyFile(join(from, p.rel), tmp);
    try {
      await Deno.link(tmp, dest); // write-once: never replaces a file
      copied++;
    } catch (e) {
      // another writer got there first: the hash check below decides
      if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
    } finally {
      await Deno.remove(tmp);
    }
  }
  const bad: string[] = [];
  for (const p of plan) {
    if (await sha256(join(to, p.rel)) !== p.hash) bad.push(p.rel);
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
    present: plan.length - plan.filter((p) => !p.present).length,
    verified: plan.length,
    skipped: skipped.sort(),
  };
}
