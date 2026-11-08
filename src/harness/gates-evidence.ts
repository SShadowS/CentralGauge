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
 * owned: the container's in-use record still carries this run's token.
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
  const beats = new Map<string, ReturnType<typeof setInterval>>();
  const stop = (id: string) => {
    clearInterval(beats.get(id));
    beats.delete(id);
  };
  const none = (c: string, why: string) =>
    o.log(
      `[WARN] ${c}: no before-capture (${why}); a dirty end on it needs a recreate`,
    );
  return {
    afterClaim: async (c: string, id: string): Promise<void> => {
      await writeHeartbeat(o.dir, id, o.token);
      beats.set(
        id,
        setInterval(
          () =>
            void writeHeartbeat(o.dir, id, o.token).catch((err) =>
              o.log(`[WARN] ${c}: heartbeat not written: ${msg(err)}`)
            ),
          o.heartbeatMs ?? HEARTBEAT_MS,
        ),
      );
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
    done: async (_c: string, id: string, released: boolean): Promise<void> => {
      stop(id);
      if (released) await removeGatesFiles(o.dir, id, o.token);
    },
    owned: async (c: string, id: string): Promise<boolean> =>
      (await findRecords(o.dir, { name: c, id })).some((f) =>
        f.record?.token === o.token && f.record.state === "in_use"
      ),
    /** Every heartbeat stops (the run's end, whatever happened). */
    stopAll: () => {
      for (const id of [...beats.keys()]) stop(id);
    },
  };
}
