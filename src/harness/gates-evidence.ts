/**
 * H-76: what lets `harness recover` clear a stale `gates` in-use record
 * without a recreate. Next to the record (quarantine.ts), by the container's
 * Docker id and the hold's token:
 * - `<id>.gates-fs`: the before-capture, one fsDigest(W) taken right after
 *   the claim, with its sha256 (create-new, never rewritten);
 * - `<id>.gates-hb`: the hold's heartbeat, rewritten every 30 s.
 * Neither ends in `.json`, so findRecords never reads them as records.
 * The owner is gone when the heartbeat is missing or 120 s stale (the
 * bench-lock rule); recover then compares the evidence with its post-reset
 * capture and refuses any difference.
 */

import { join } from "@std/path";
import { z } from "zod";
import { findRecords } from "./quarantine.ts";

/** `by` of a gates in-use record: `<host> gate-task gates`. */
export const GATES_BY = "gate-task gates";
export const isGatesRecord = (r: { by: string }) =>
  r.by.endsWith(` ${GATES_BY}`);

export const HEARTBEAT_MS = 30_000;
export const STALE_MS = 120_000;

export const evidencePath = (dir: string, id: string) =>
  join(dir, `${id}.gates-fs`);
export const heartbeatPath = (dir: string, id: string) =>
  join(dir, `${id}.gates-hb`);

const EvidenceSchema = z.strictObject({
  v: z.literal(1),
  token: z.string().uuid(),
  container: z.string().min(1),
  id: z.string().regex(/^[0-9a-f]{64}$/),
  lineage_id: z.string().min(1),
  at: z.string(),
  lines: z.array(z.string()),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

const HeartbeatSchema = z.strictObject({
  v: z.literal(1),
  token: z.string().uuid(),
  at: z.string(),
});

const msg = (err: unknown) => err instanceof Error ? err.message : String(err);

async function sha256(lines: readonly string[]): Promise<string> {
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(lines)),
  );
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Write the hold's before-capture (create-new: throws when one exists). */
export async function writeEvidence(
  dir: string,
  e: Omit<Evidence, "v" | "at" | "sha256">,
): Promise<void> {
  const rec = EvidenceSchema.parse({
    v: 1,
    ...e,
    at: new Date().toISOString(),
    sha256: await sha256(e.lines),
  });
  await Deno.mkdir(dir, { recursive: true });
  const path = evidencePath(dir, e.id);
  const f = await Deno.open(path, { write: true, createNew: true });
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(rec));
    for (let n = 0; n < bytes.length;) n += await f.write(bytes.subarray(n));
    await f.sync();
  } catch (err) {
    f.close();
    await Deno.remove(path).catch(() => {});
    throw err;
  }
  f.close();
}

/** The container's before-capture, verified against its sha256, or why not. */
export async function readEvidence(
  dir: string,
  id: string,
): Promise<Evidence | { why: string }> {
  const path = evidencePath(dir, id);
  let e: Evidence;
  try {
    e = EvidenceSchema.parse(JSON.parse(await Deno.readTextFile(path)));
  } catch (err) {
    return err instanceof Deno.errors.NotFound
      ? { why: `no gates evidence (${path})` }
      : { why: `gates evidence ${path} unreadable: ${msg(err)}` };
  }
  if (e.id !== id) return { why: `gates evidence ${path} names id ${e.id}` };
  if (await sha256(e.lines) !== e.sha256) {
    return { why: `gates evidence ${path}: sha256 does not match its lines` };
  }
  return e;
}

/** Rewrite the hold's heartbeat (tmp + rename: never torn). */
export async function writeHeartbeat(
  dir: string,
  id: string,
  token: string,
  at = new Date(),
): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });
  const path = heartbeatPath(dir, id);
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    await Deno.writeTextFile(
      tmp,
      JSON.stringify({ v: 1, token, at: at.toISOString() }),
    );
    await Deno.rename(tmp, path);
  } catch (err) {
    await Deno.remove(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Whether the hold `token` is provably gone: no heartbeat, or its own
 * heartbeat at least `staleMs` old. A fresh, unreadable or other token's
 * heartbeat is no proof.
 */
export async function ownerGone(
  dir: string,
  id: string,
  token: string,
  now = Date.now(),
  staleMs = STALE_MS,
): Promise<{ gone: true } | { gone: false; why: string }> {
  const path = heartbeatPath(dir, id);
  let hb: z.infer<typeof HeartbeatSchema>;
  try {
    hb = HeartbeatSchema.parse(JSON.parse(await Deno.readTextFile(path)));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return { gone: true };
    return { gone: false, why: `heartbeat ${path} unreadable: ${msg(err)}` };
  }
  if (hb.token !== token) {
    return {
      gone: false,
      why: `heartbeat ${path} is another hold's (token ${hb.token})`,
    };
  }
  const age = now - Date.parse(hb.at);
  if (!(age >= staleMs)) {
    return {
      gone: false,
      why: `heartbeat ${path} is ${Math.round(age / 1000)} s old (stale at ${
        staleMs / 1000
      } s)`,
    };
  }
  return { gone: true };
}

/**
 * H-76 Sol r1/r2: the live processes of `pid`'s tree on this host: `pid`
 * itself and every live process reachable through parent links from it. A
 * dead parent's orphans keep its pid as their parent id (Windows), so the
 * gates process's leftover pwsh workers are found after it died. A reused
 * pid reads as alive, which only refuses more.
 */
export function liveTree(
  table: readonly { pid: number; ppid: number }[],
  pid: number,
): number[] {
  const out = new Set<number>();
  if (table.some((p) => p.pid === pid)) out.add(pid);
  const seen = new Set<number>([pid]);
  const todo = [pid];
  while (todo.length > 0) {
    const parent = todo.pop()!;
    for (const p of table) {
      if (p.ppid !== parent || seen.has(p.pid)) continue;
      seen.add(p.pid);
      out.add(p.pid);
      todo.push(p.pid);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The live process tree of `pid` on this host (liveTree over the process
 * table: Win32_Process on Windows, `ps -A` elsewhere). Throws when the table
 * cannot be read (Sol r2: an unknown result is never "gone").
 */
export async function processTree(pid: number): Promise<number[]> {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`bad pid ${pid}`);
  const windows = Deno.build.os === "windows";
  const out = await new Deno.Command(windows ? "pwsh" : "ps", {
    args: windows
      ? [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.ParentProcessId }",
      ]
      : ["-A", "-o", "pid=,ppid="],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (out.code !== 0) {
    throw new Error(`process table: exit ${out.code}`);
  }
  const table = new TextDecoder().decode(out.stdout).split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isInteger))
    .map(([p, pp]) => ({ pid: p!, ppid: pp! }));
  // this very process must be listed, or the table is not trustworthy
  if (!table.some((p) => p.pid === Deno.pid)) {
    throw new Error(`process table incomplete (${table.length} rows)`);
  }
  return liveTree(table, pid);
}

/** Remove this token's evidence and heartbeat (gone already is fine). */
export async function removeGatesFiles(
  dir: string,
  id: string,
  token: string,
): Promise<void> {
  for (const path of [evidencePath(dir, id), heartbeatPath(dir, id)]) {
    let t: unknown;
    try {
      t = JSON.parse(await Deno.readTextFile(path))?.token;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) continue;
      throw err;
    }
    if (t === token) {
      await Deno.remove(path).catch((err) => {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
      });
    }
  }
}

/**
 * The gates hold hooks (gate-pool.ts recordHolds). afterClaim: the heartbeat
 * first (a failure throws: the hold is refused, since a missing heartbeat
 * reads as "owner gone"), kept fresh every `heartbeatMs`; then, with
 * `evidence` (--lineage), one before-capture. A capture that fails or has
 * errors keeps no evidence (a dirty end then needs a recreate); the hold
 * goes on. done: the heartbeat stops; a release also removes the files.
 * owned: this run's in-use record is the container's only record.
 */
export function gatesHooks(o: {
  dir: string;
  token: string;
  heartbeatMs?: number;
  evidence?: {
    lineageId: string;
    capture: (container: string) => Promise<string[]>;
    /** The capture is complete (no error lines): recover's own test. */
    clean: (lines: readonly string[]) => boolean;
  };
  log: (line: string) => void;
}) {
  // Sol r1: each heartbeat's timer and its write in flight, drained on stop
  // so no late write lands after the files are gone or another hold's.
  const beats = new Map<
    string,
    { timer: ReturnType<typeof setInterval>; pending: Promise<void> }
  >();
  const stop = async (id: string) => {
    const b = beats.get(id);
    if (!b) return;
    clearInterval(b.timer);
    beats.delete(id);
    await b.pending;
  };
  const none = (c: string, why: string) =>
    o.log(
      `[WARN] ${c}: no before-capture (${why}); a dirty end on it needs a recreate`,
    );
  return {
    afterClaim: async (c: string, id: string): Promise<void> => {
      await writeHeartbeat(o.dir, id, o.token);
      const b = {
        pending: Promise.resolve(),
        timer: setInterval(() => {
          b.pending = b.pending.then(() =>
            writeHeartbeat(o.dir, id, o.token).catch((err) =>
              o.log(`[WARN] ${c}: heartbeat not written: ${msg(err)}`)
            )
          );
        }, o.heartbeatMs ?? HEARTBEAT_MS),
      };
      beats.set(id, b);
      const ev = o.evidence;
      if (!ev) return;
      let lines: string[];
      try {
        lines = await ev.capture(c);
      } catch (err) {
        return none(c, `capture failed: ${msg(err)}`);
      }
      if (!ev.clean(lines)) return none(c, "the capture has errors");
      try {
        await writeEvidence(o.dir, {
          token: o.token,
          container: c,
          id,
          lineage_id: ev.lineageId,
          lines,
        });
      } catch (err) {
        none(c, `not written: ${msg(err)}`);
      }
    },
    /**
     * Sol r1: runs BEFORE a release (the record is still ours, so no other
     * hold's files exist yet): the heartbeat stops and drains, then a
     * release removes this hold's files.
     */
    done: async (_c: string, id: string, released: boolean): Promise<void> => {
      await stop(id);
      if (released) await removeGatesFiles(o.dir, id, o.token);
    },
    /**
     * Sol r1: ours only while our in-use record is the container's ONLY
     * record: a recover claim (`<id>.recover.json`) or any other record
     * means a recovery is under way or done.
     */
    owned: async (c: string, id: string): Promise<boolean> => {
      const found = await findRecords(o.dir, { name: c, id });
      return found.length === 1 && found[0]!.record?.token === o.token &&
        found[0]!.record.state === "in_use";
    },
    /** Every heartbeat stops and drains (the run's end, whatever happened). */
    stopAll: async () => {
      for (const id of [...beats.keys()]) await stop(id);
    },
  };
}
