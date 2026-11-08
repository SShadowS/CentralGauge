/**
 * Container allocation (owner, 2026-09-25): the harness may use only the
 * containers its campaign is allocated in `<coord root>/allocation.json`,
 * keyed by `coord.json`'s `campaign`. Fail closed: a missing or malformed
 * file, or a campaign without an entry, allows nothing.
 */

import { join } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import { inspectContainer } from "../container/docker-inspect.ts";
import { coordLeaseBlock } from "./coord-lease.ts";

export const DEFAULT_COORD_ROOT = "H:\\cg-coord";

/**
 * H-70: the container pool when --containers is absent (owner decision
 * 2026-11-08-m8-scale-up.md ruling 3). Allocation still decides admission.
 */
export const DEFAULT_POOL = ["Cronus281", "Cronus282", "Cronus283"] as const;

/**
 * H-70: why `container` may not join a pool, or null: it must be allocated,
 * running (a stopped one is never started here) and free of a coord lease
 * held by another (lane-ops passes its own with --coord-lease).
 */
export async function admitContainer(
  container: string,
  d: {
    allocated: string[];
    running: (c: string) => Promise<boolean>;
    leaseBlock: (c: string) => string | null;
  },
): Promise<string | null> {
  if (!d.allocated.some((a) => a.toLowerCase() === container.toLowerCase())) {
    return `not allocated (allowed: ${d.allocated.join(", ")})`;
  }
  const lease = d.leaseBlock(container);
  if (lease !== null) return lease;
  return (await d.running(container)) ? null : "not running";
}

/** H-70: admitContainer against allocation.json, docker and the coord leases (`own`: --coord-lease). */
export function poolAdmit(
  own: ReadonlyMap<string, string>,
  coordRoot = defaultRoot(),
): (c: string) => Promise<string | null> {
  // Read on first use: `run --containers X` never calls it.
  let allocated: Promise<string[]> | undefined;
  return async (c) =>
    admitContainer(c, {
      allocated: await (allocated ??= allocatedContainers(coordRoot)),
      running: async (x) => (await inspectContainer(x))?.running === true,
      leaseBlock: (x) => coordLeaseBlock(coordRoot, own, x),
    });
}

/**
 * H-70: `harness run` without --containers runs on the admitted DEFAULT_POOL;
 * with --containers (`flag`), the options are unchanged.
 */
export async function withDefaultPool<T extends { containers: string[] }>(
  opts: T,
  flag: string | undefined,
  admit: (c: string) => Promise<string | null>,
  warn: (line: string) => void,
): Promise<T> {
  if (flag !== undefined) return opts;
  return {
    ...opts,
    containers: await admittedPool([...DEFAULT_POOL], admit, warn),
  };
}

/** H-70: the admitted containers, in order; a `[WARN]` line for each skipped one. */
export async function admittedPool(
  containers: string[],
  admit: (c: string) => Promise<string | null>,
  warn: (line: string) => void,
): Promise<string[]> {
  const out: string[] = [];
  for (const c of containers) {
    // Sol r1: a second worker on one container would break exclusivity.
    const why = out.some((x) => x.toLowerCase() === c.toLowerCase())
      ? "listed twice"
      : await admit(c);
    if (why === null) out.push(c);
    else warn(`[WARN] ${c} skipped: ${why}`);
  }
  return out;
}

const Coord = z.object({ campaign: z.string().min(1) });
const Allocation = z.record(z.string(), z.array(z.string().min(1)));

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`cannot read ${path}: ${msg}`, [path]);
  }
}

const defaultRoot = () => Deno.env.get("CG_COORD_ROOT") || DEFAULT_COORD_ROOT;

/** H-41 (section 6): every container allocated to the campaign now, or a ValidationError. */
export async function allocatedContainers(
  coordRoot = defaultRoot(),
): Promise<string[]> {
  return (await allocation(coordRoot)).allowed;
}

async function allocation(coordRoot: string) {
  const coord = Coord.safeParse(await readJson(join(coordRoot, "coord.json")));
  if (!coord.success) {
    throw new ValidationError(`no campaign in ${coordRoot}\\coord.json`, [
      coordRoot,
    ]);
  }
  const alloc = Allocation.safeParse(
    await readJson(join(coordRoot, "allocation.json")),
  );
  const allowed = alloc.success ? alloc.data[coord.data.campaign] : undefined;
  if (!allowed) {
    throw new ValidationError(
      `no container allocation for campaign ${coord.data.campaign} in ${coordRoot}\\allocation.json`,
      [coord.data.campaign],
    );
  }
  return { campaign: coord.data.campaign, allowed };
}

/** The allocated spelling of `container`, or a ValidationError when it is not allocated. */
export async function allocatedContainer(
  container: string,
  coordRoot = defaultRoot(),
): Promise<string> {
  const { campaign, allowed } = await allocation(coordRoot);
  const hit = allowed.find((c) => c.toLowerCase() === container.toLowerCase());
  if (!hit) {
    throw new ValidationError(
      `${container} is not allocated to ${campaign} (allowed: ${
        allowed.join(", ")
      })`,
      [container],
    );
  }
  return hit;
}
