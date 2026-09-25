/**
 * Container allocation (owner, 2026-09-25): the harness may use only the
 * containers its campaign is allocated in `<coord root>/allocation.json`,
 * keyed by `coord.json`'s `campaign`. Fail closed: a missing or malformed
 * file, or a campaign without an entry, allows nothing.
 */

import { join } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";

export const DEFAULT_COORD_ROOT = "H:\\cg-coord";

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

/** The allocated spelling of `container`, or a ValidationError when it is not allocated. */
export async function allocatedContainer(
  container: string,
  coordRoot = Deno.env.get("CG_COORD_ROOT") || DEFAULT_COORD_ROOT,
): Promise<string> {
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
  const hit = allowed.find((c) => c.toLowerCase() === container.toLowerCase());
  if (!hit) {
    throw new ValidationError(
      `${container} is not allocated to ${coord.data.campaign} (allowed: ${
        allowed.join(", ")
      })`,
      [container],
    );
  }
  return hit;
}
