/**
 * H-35 run 004 #3: persisted container quarantine. A container the lane
 * quarantines stays out of every later environment (the records live under
 * the coord root, so every worktree sees them) until `harness recover`
 * restores and verifies it. One file per container, keyed by its name
 * lower-cased: the lane has no Docker container id without a container call,
 * so a container recreated under the same name stays quarantined (fail
 * closed).
 */

import { join } from "@std/path";
import { z } from "zod";

const RecordSchema = z.strictObject({
  v: z.literal(1),
  container: z.string().min(1),
  reason: z.string(),
  at: z.string(),
  by: z.string(),
});
export type QuarantineRecord = z.infer<typeof RecordSchema>;

const fileOf = (dir: string, container: string) =>
  join(dir, `${container.toLowerCase()}.json`);

/** Every record, by lower-cased container name. An unreadable record still quarantines its container. */
export async function readQuarantine(
  dir: string,
): Promise<Map<string, QuarantineRecord>> {
  const out = new Map<string, QuarantineRecord>();
  const names: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.endsWith(".json")) names.push(e.name);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return out;
    throw err;
  }
  for (const name of names) {
    const key = name.slice(0, -".json".length).toLowerCase();
    try {
      out.set(
        key,
        RecordSchema.parse(
          JSON.parse(await Deno.readTextFile(join(dir, name))),
        ),
      );
    } catch (err) {
      out.set(key, {
        v: 1,
        container: key,
        reason: `unreadable quarantine record ${join(dir, name)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        at: "",
        by: "",
      });
    }
  }
  return out;
}

/** Write (or replace) the container's record atomically (tmp + rename). */
export async function writeQuarantine(
  dir: string,
  r: Omit<QuarantineRecord, "v" | "at">,
): Promise<void> {
  const rec: QuarantineRecord = { v: 1, ...r, at: new Date().toISOString() };
  await Deno.mkdir(dir, { recursive: true });
  const path = fileOf(dir, r.container);
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  await Deno.writeTextFile(tmp, JSON.stringify(rec, null, 2));
  await Deno.rename(tmp, path);
}

/** Remove the container's record (none is fine). Only `harness recover` calls it. */
export async function clearQuarantine(
  dir: string,
  container: string,
): Promise<void> {
  try {
    await Deno.remove(fileOf(dir, container));
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}
