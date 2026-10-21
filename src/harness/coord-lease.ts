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
 * Why `container` is not admitted under the coord lease rules, or null when
 * it is free or held by this run (an exact `--coord-lease <container>=<token>`
 * pair in `own`; a matching lane alone never authorizes).
 */
export function coordLeaseBlock(
  coordRoot: string,
  own: ReadonlyMap<string, string>,
  container: string,
): string | null {
  if (!NAME_RE.test(container)) {
    return `coord: bad container name ${container}`;
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
    return `coord: ${join(coordRoot, "coord.json")} unreadable: ${why(err)}`;
  }
  const leases = join(machine, "leases");
  try {
    if (!Deno.statSync(leases).isDirectory) {
      return `coord: ${leases} is not a directory`;
    }
  } catch (err) {
    return `coord: leases root ${leases} unreadable: ${why(err)}`;
  }
  const dir = join(leases, container);
  const attempts: string[] = [];
  try {
    for (const e of Deno.readDirSync(dir)) {
      if (RUN_RE.test(e.name)) attempts.push(e.name);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null; // never leased
    return `coord: ${dir} unreadable: ${why(err)}`;
  }
  const last = attempts.sort().at(-1);
  if (last === undefined) return null;
  let rec: { lane?: unknown; token?: unknown };
  try {
    rec = JSON.parse(Deno.readTextFileSync(join(dir, last, "lease.json")));
  } catch (err) {
    return `coord: lease ${container}/${last} unreadable (unknown holder): ${
      why(err)
    }`;
  }
  try {
    Deno.statSync(join(dir, last, "release.json"));
    return null;
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      return `coord: release of ${container}/${last} unreadable: ${why(err)}`;
    }
  }
  const token = own.get(container);
  if (token !== undefined && rec.token === token) return null;
  return `coord lease ${container}/${last} held by ${String(rec.lane)}`;
}

/** A pooled lane's drain marker `<resultsDir>/drain-<container>` (any case), or null. */
export function drainBlock(
  resultsDir: string,
  container: string,
): string | null {
  const want = `drain-${container}`.toLowerCase();
  try {
    for (const e of Deno.readDirSync(resultsDir)) {
      if (e.name.toLowerCase() === want) return `drain marker ${e.name}`;
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      return `drain markers in ${resultsDir} unreadable: ${why(err)}`;
    }
  }
  return null;
}

/**
 * The lane's `blocked` predicate: coord leases for both list kinds; drain
 * markers only when `drainDir` is given (pooled lanes).
 */
export function laneBlocked(o: {
  coordRoot: string;
  own: ReadonlyMap<string, string>;
  drainDir?: string;
}): (container: string) => string | null {
  return (c) =>
    coordLeaseBlock(o.coordRoot, o.own, c) ??
      (o.drainDir === undefined ? null : drainBlock(o.drainDir, c));
}
