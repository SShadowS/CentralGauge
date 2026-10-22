/**
 * H-41 (design-final 6, 7): read-only admission checks for the BC lane's
 * `blocked` predicate. Synchronous (admit() reads a few small files); every
 * unreadable state refuses. Matches coord.ts's on-disk layout without
 * importing it: <machineRoot>/leases/<container>/<NNN>/lease.json
 * ({lane, token, at}) and release.json.
 */

import { join } from "@std/path";

const RUN_RE = /^[0-9]{3}$/;
const NAME_RE = /^[A-Za-z][A-Za-z0-9-]{0,40}$/;

const why = (err: unknown) => err instanceof Error ? err.message : String(err);

/**
 * H-41 (7, 14): what the reader found. null: free or this run's. `blocked`:
 * answered (another holder, a drain marker, a bad name). `unread`: the state
 * could not be read (coord.json, the leases root, a lease or marker dir).
 * Admission refuses both; a terminal reconcile counts `unread` unanswered.
 */
export type CoordOutcome = { blocked: string } | { unread: string } | null;

const unread = (s: string) => ({ unread: s });

/**
 * The coord lease outcome of `container`: null when it is free or held by
 * this run (an exact `--coord-lease <container>=<token>` pair in `own`; a
 * matching lane alone never authorizes).
 */
export function coordLease(
  coordRoot: string,
  own: ReadonlyMap<string, string>,
  container: string,
): CoordOutcome {
  if (!NAME_RE.test(container)) {
    return { blocked: `coord: bad container name ${container}` };
  }
  let machine: string;
  try {
    const meta = JSON.parse(
      Deno.readTextFileSync(join(coordRoot, "coord.json")),
    ) as { machineRoot?: unknown };
    machine = typeof meta.machineRoot === "string"
      ? meta.machineRoot
      : coordRoot;
  } catch (err) {
    return unread(
      `coord: ${join(coordRoot, "coord.json")} unreadable: ${why(err)}`,
    );
  }
  const leases = join(machine, "leases");
  try {
    if (!Deno.statSync(leases).isDirectory) {
      return unread(`coord: ${leases} is not a directory`);
    }
  } catch (err) {
    return unread(`coord: leases root ${leases} unreadable: ${why(err)}`);
  }
  const dir = join(leases, container);
  const attempts: string[] = [];
  try {
    for (const e of Deno.readDirSync(dir)) {
      if (RUN_RE.test(e.name)) attempts.push(e.name);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null; // never leased
    return unread(`coord: ${dir} unreadable: ${why(err)}`);
  }
  const last = attempts.sort().at(-1);
  if (last === undefined) return null;
  let rec: { lane?: unknown; token?: unknown };
  try {
    rec = JSON.parse(Deno.readTextFileSync(join(dir, last, "lease.json")));
  } catch (err) {
    return unread(
      `coord: lease ${container}/${last} unreadable (unknown holder): ${
        why(err)
      }`,
    );
  }
  try {
    Deno.statSync(join(dir, last, "release.json"));
    return null;
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      return unread(
        `coord: release of ${container}/${last} unreadable: ${why(err)}`,
      );
    }
  }
  const token = own.get(container);
  if (token !== undefined && rec.token === token) return null;
  return {
    blocked: `coord lease ${container}/${last} held by ${String(rec.lane)}`,
  };
}

const reason = (o: CoordOutcome) =>
  o === null ? null : "blocked" in o ? o.blocked : o.unread;

/**
 * Why `container` is not admitted under the coord lease rules (held by
 * another, or unreadable), or null when it is free or this run's.
 */
export function coordLeaseBlock(
  coordRoot: string,
  own: ReadonlyMap<string, string>,
  container: string,
): string | null {
  return reason(coordLease(coordRoot, own, container));
}

function drainOutcome(resultsDir: string, container: string): CoordOutcome {
  const want = `drain-${container}`.toLowerCase();
  try {
    for (const e of Deno.readDirSync(resultsDir)) {
      if (e.name.toLowerCase() === want) {
        return { blocked: `drain marker ${e.name}` };
      }
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      return unread(`drain markers in ${resultsDir} unreadable: ${why(err)}`);
    }
  }
  return null;
}

/** A pooled lane's drain marker `<resultsDir>/drain-<container>` (any case), or null. */
export function drainBlock(
  resultsDir: string,
  container: string,
): string | null {
  return reason(drainOutcome(resultsDir, container));
}

interface LaneCoord {
  coordRoot: string;
  own: ReadonlyMap<string, string>;
  drainDir?: string;
}

/** Coord leases for both list kinds; drain markers only when `drainDir` is given (pooled lanes). */
export function laneOutcome(o: LaneCoord): (container: string) => CoordOutcome {
  return (c) =>
    coordLease(o.coordRoot, o.own, c) ??
      (o.drainDir === undefined ? null : drainOutcome(o.drainDir, c));
}

/** The lane's `blocked` predicate: a reason for either refusal, never a throw. */
export function laneBlocked(
  o: LaneCoord,
): (container: string) => string | null {
  const read = laneOutcome(o);
  return (c) => reason(read(c));
}

/**
 * H-41 (14): the judging pool's `blocked` dep. An answered block is its
 * reason; a state the reader could not read throws, which the pool's
 * admission refuses (fail closed) and its terminal reconcile counts as
 * `unanswered`, never as a departure.
 */
export function poolBlocked(
  o: LaneCoord,
): (container: string) => string | null {
  const read = laneOutcome(o);
  return (c) => {
    const r = read(c);
    if (r !== null && "unread" in r) throw new Error(r.unread);
    return r?.blocked ?? null;
  };
}
