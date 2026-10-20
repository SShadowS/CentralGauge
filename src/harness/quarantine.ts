/**
 * H-35 run 004 #3, Sol r1 H4/H5: durable container records under the coord
 * root (every worktree sees them). "Dirty unless proven clean": an
 * environment claims each container with an `in_use` record before using it
 * and deletes it after a clean close; a quarantine turns it into
 * `quarantined`. Any record refuses its container in later environments
 * until `harness recover` verifies and clears it. One file per physical
 * container, named by its Docker container id; the name is kept for
 * diagnostics and matched too (a renamed container keeps its id; a
 * replacement under an old name stays refused, fail closed).
 *
 * H-35 run 004 Sol r2 N1: a claim is an atomic create-new carrying the
 * claimant's token; only the token's holder rewrites or releases it.
 * `harness recover` claims `<id>.recover.json` the same way.
 */

import { join } from "@std/path";
import { z } from "zod";

const RecordSchema = z.strictObject({
  v: z.literal(3),
  state: z.enum(["in_use", "quarantined"]),
  container: z.string().min(1),
  id: z.string().regex(/^[0-9a-f]{64}$/),
  /** Sol r2 N1: the claimant's token (one per environment or recover run). */
  token: z.string().uuid(),
  by: z.string(),
  pid: z.number().int(),
  host: z.string(),
  at: z.string(),
  reason: z.string().optional(),
  /** H-35 run 004 Sol r1 H6: the L4 differences behind the quarantine. */
  fs_diff: z.array(z.strictObject({
    path: z.string(),
    before: z.string().nullable(),
    after: z.string().nullable(),
  })).optional(),
  /**
   * Sol r2 N4: fs_diff comes from error-free L4 after-captures (an empty one
   * then means "captured, clean", not "not captured").
   */
  fs_captured: z.boolean().optional(),
});
export type ContainerRecord = z.infer<typeof RecordSchema>;
export type NewRecord = Omit<ContainerRecord, "v" | "at">;

/** A record file; `record` null when unreadable (it still refuses). */
export interface FoundRecord {
  file: string;
  record: ContainerRecord | null;
  why: string;
  /** Sol r2 N2: the file's content when read (recover deletes it only unchanged). */
  text: string | null;
}

/** The container's record file; `recover`: the recover run's claim. */
export const recordFile = (dir: string, id: string, recover = false) =>
  join(dir, `${id}${recover ? ".recover" : ""}.json`);

function describe(r: ContainerRecord): string {
  return r.state === "quarantined"
    ? `quarantined (${r.reason ?? "no reason"})`
    : `in use by ${r.by} (pid ${r.pid}, host ${r.host}, since ${r.at}, token ${r.token}; a running or crashed environment)`;
}

const parse = (text: string) => RecordSchema.parse(JSON.parse(text));

/** Every record matching the container's current id or its name (case-insensitive). */
export async function findRecords(
  dir: string,
  c: { name: string; id: string },
): Promise<FoundRecord[]> {
  const files: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.endsWith(".json")) files.push(e.name);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  const id = c.id.toLowerCase(), name = c.name.toLowerCase();
  const out: FoundRecord[] = [];
  for (const f of files.sort()) {
    const file = join(dir, f);
    const stem = f.slice(0, -".json".length).toLowerCase();
    const mine = stem === id || stem === `${id}.recover` || stem === name;
    let text: string | null = null;
    try {
      text = await Deno.readTextFile(file);
      const r = parse(text);
      if (mine || r.id === id || r.container.toLowerCase() === name) {
        out.push({ file, record: r, why: describe(r), text });
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound || !mine) continue;
      out.push({
        file,
        record: null,
        why: `unreadable record ${file}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        text,
      });
    }
  }
  return out;
}

/**
 * Sol r2 N1: claim a record file by atomic create-new; false when it exists
 * (someone else's claim). A half-written file of ours is removed.
 */
export async function claimRecord(
  dir: string,
  r: NewRecord,
  o: { recover?: boolean } = {},
): Promise<boolean> {
  const rec = RecordSchema.parse({ v: 3, ...r, at: new Date().toISOString() });
  await Deno.mkdir(dir, { recursive: true });
  const path = recordFile(dir, rec.id, o.recover);
  let f: Deno.FsFile;
  try {
    f = await Deno.open(path, { write: true, createNew: true });
  } catch (err) {
    if (err instanceof Deno.errors.AlreadyExists) return false;
    throw err;
  }
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(rec, null, 2));
    for (let n = 0; n < bytes.length;) n += await f.write(bytes.subarray(n));
    await f.sync();
  } catch (err) {
    f.close();
    await Deno.remove(path).catch(() => {});
    throw err;
  }
  f.close();
  return true;
}

/**
 * Sol r2 N1: rewrite this claimant's record (tmp + rename) only while it
 * still carries `r.token`. Gone: created anew (never over anything);
 * another token or unreadable: untouched ("foreign").
 */
export async function rewriteOwned(
  dir: string,
  r: NewRecord,
): Promise<"written" | "created" | "foreign"> {
  const path = recordFile(dir, r.id);
  let cur: ContainerRecord;
  try {
    cur = parse(await Deno.readTextFile(path));
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) return "foreign";
    return await claimRecord(dir, r) ? "created" : "foreign";
  }
  if (cur.token !== r.token) return "foreign";
  // H-35 run 004 Sol r2 N1: ponytail: read-compare-rename is not atomic; a
  // claim replacing ours inside that window is overwritten (no
  // cross-process file lock here)
  const rec = RecordSchema.parse({ v: 3, ...r, at: new Date().toISOString() });
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    await Deno.writeTextFile(tmp, JSON.stringify(rec, null, 2));
    await Deno.rename(tmp, path);
  } catch (err) {
    await Deno.remove(tmp).catch(() => {});
    throw err;
  }
  return "written";
}

/** Delete this claimant's in-use record (by token); anything else stays. True when removed. */
export async function releaseOwned(
  dir: string,
  id: string,
  token: string,
  o: { recover?: boolean } = {},
): Promise<boolean> {
  const file = recordFile(dir, id, o.recover);
  let r: ContainerRecord;
  try {
    r = parse(await Deno.readTextFile(file));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
  if (r.state !== "in_use" || r.token !== token) return false;
  await Deno.remove(file);
  return true;
}

/**
 * Sol r2 N2: remove found records whose file still holds exactly what was
 * read (gone already is fine). Returns the files that changed (kept).
 * Only `harness recover` calls it.
 */
export async function removeUnchanged(found: FoundRecord[]): Promise<string[]> {
  const changed: string[] = [];
  for (const f of found) {
    let now: string;
    try {
      now = await Deno.readTextFile(f.file);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) continue;
      throw err;
    }
    if (f.text === null || now !== f.text) {
      changed.push(f.file);
      continue;
    }
    try {
      await Deno.remove(f.file);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  return changed;
}

/**
 * Sol r2 N4: a quarantine reason's cause. Reasons are joined with "; ";
 * any filesystem cause anywhere in it wins.
 */
export function reasonKind(
  reason: string,
): "filesystem" | "non_filesystem" | "unknown" {
  if (/(^|; )(L4 on |cleanup on \S+ failed: )/.test(reason)) {
    return "filesystem";
  }
  return /^(reset of \S+ failed at |HttpClient block of |post-cleanup check on \S+ failed: )/
      .test(reason)
    ? "non_filesystem"
    : "unknown";
}

/**
 * Sol r2 N4 (orchestrator ruling): why a record gives `harness recover` no
 * trustworthy filesystem evidence (null: it does). Trustworthy: a
 * quarantine whose fs_diff came from error-free L4 after-captures, and
 * which is non-empty, or empty with a non-filesystem reason. Anything else
 * (unreadable, legacy, crash-left in-use, no capture) is not.
 */
export function evidenceProblem(r: ContainerRecord | null): string | null {
  if (r === null) return "unreadable or legacy record";
  if (r.state === "in_use") {
    return "in-use record: what its environment did is unknown";
  }
  const reason = (r.reason ?? "").slice(0, 200);
  if (r.fs_captured !== true || !r.fs_diff) {
    return `no complete L4 after-capture recorded (${reason})`;
  }
  if (r.fs_diff.length > 0) return null;
  const k = reasonKind(r.reason ?? "");
  return k === "non_filesystem"
    ? null
    : `${k} cause with an empty diff (${reason})`;
}
