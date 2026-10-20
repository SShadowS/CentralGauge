/**
 * H-35 run 004 #3, Sol r1 H4/H5: durable container records under the coord
 * root (every worktree sees them). "Dirty unless proven clean": an
 * environment writes an `in_use` record for each container before using it
 * and deletes it on a normal close; a quarantine turns it into
 * `quarantined`. Any record refuses its container in later environments
 * until `harness recover` verifies and clears it. One file per physical
 * container, named by its Docker container id; the name is kept for
 * diagnostics and matched too (a renamed container keeps its id; a
 * replacement under an old name stays refused, fail closed).
 */

import { join } from "@std/path";
import { z } from "zod";

const RecordSchema = z.strictObject({
  v: z.literal(2),
  state: z.enum(["in_use", "quarantined"]),
  container: z.string().min(1),
  id: z.string().regex(/^[0-9a-f]{64}$/),
  by: z.string(),
  pid: z.number().int(),
  at: z.string(),
  reason: z.string().optional(),
  /** H-35 run 004 Sol r1 H6: the L4 differences behind the quarantine. */
  fs_diff: z.array(z.strictObject({
    path: z.string(),
    before: z.string().nullable(),
    after: z.string().nullable(),
  })).optional(),
});
export type ContainerRecord = z.infer<typeof RecordSchema>;

/** A record file; `record` null when unreadable (it still refuses). */
export interface FoundRecord {
  file: string;
  record: ContainerRecord | null;
  why: string;
}

const fileOf = (dir: string, id: string) => join(dir, `${id}.json`);

function describe(r: ContainerRecord): string {
  return r.state === "quarantined"
    ? `quarantined (${r.reason ?? "no reason"})`
    : `in use by ${r.by} (pid ${r.pid}, since ${r.at}; a running or crashed environment)`;
}

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
    try {
      const r = RecordSchema.parse(JSON.parse(await Deno.readTextFile(file)));
      if (
        stem === id || r.id === id || stem === name ||
        r.container.toLowerCase() === name
      ) out.push({ file, record: r, why: describe(r) });
    } catch (err) {
      if (stem !== id && stem !== name) continue;
      out.push({
        file,
        record: null,
        why: `unreadable record ${file}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }
  return out;
}

/** Write (or replace) the container's record atomically (tmp + rename). */
export async function writeRecord(
  dir: string,
  r: Omit<ContainerRecord, "v" | "at">,
): Promise<void> {
  const rec = RecordSchema.parse({ v: 2, ...r, at: new Date().toISOString() });
  await Deno.mkdir(dir, { recursive: true });
  const path = fileOf(dir, rec.id);
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    await Deno.writeTextFile(tmp, JSON.stringify(rec, null, 2));
    await Deno.rename(tmp, path);
  } catch (err) {
    await Deno.remove(tmp).catch(() => {});
    throw err;
  }
}

/**
 * A normal close: delete the in-use record this writer (by, pid) made.
 * Anything else (a quarantine, another writer's record) stays. True when removed.
 */
export async function releaseInUse(
  dir: string,
  id: string,
  by: string,
  pid: number,
): Promise<boolean> {
  const file = fileOf(dir, id);
  let r: ContainerRecord;
  try {
    r = RecordSchema.parse(JSON.parse(await Deno.readTextFile(file)));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
  if (r.state !== "in_use" || r.by !== by || r.pid !== pid) return false;
  await Deno.remove(file);
  return true;
}

/** Remove found records (gone already is fine). Only `harness recover` calls it. */
export async function removeRecords(found: FoundRecord[]): Promise<void> {
  for (const f of found) {
    try {
      await Deno.remove(f.file);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
}
