/**
 * H-58 (owner ruling 2026-11-03, item 12): a per-container BcContainerHelper
 * root. BCH 6.1.14 always mounts `hostHelperFolder` into every container it
 * creates (New-NavContainer.ps1:1351), so with one shared root every container
 * sees the others' compile outputs and staged apps. A container listed in
 * `<coord root>\bch-roots.json` (`{"migrated": ["Cronus285"]}`) was created
 * with `hostHelperFolder = C:\ProgramData\BcContainerHelper-<container>` and
 * every BCH call for it must use that root: BCH translates host paths to
 * container paths through the mount, and Invoke-ScriptInBcContainer writes its
 * script file under `hostHelperFolder` on every docker-exec call (silently
 * falling back to a PSSession when that folder is not mounted).
 *
 * The file is read once per process, so one process never uses two roots for
 * one container. No file means nothing is migrated (today's behaviour, and
 * every generated script stays byte for byte as it was); an unreadable or
 * malformed file fails closed.
 * @module container/bch-root
 */

import { join } from "@std/path";
import { z } from "zod";
import { ConfigurationError } from "../errors.ts";

/** BCH's default host helper folder: the root every unmigrated container mounts. */
export const SHARED_BCH_ROOT = "C:\\ProgramData\\BcContainerHelper";
/** The coord file listing the migrated containers. */
export const BCH_ROOTS_FILE = "bch-roots.json";
/** Env var a spawned script receives with the root this process resolved (infra/harness-reset/reset-lib.ps1 checks it). */
export const BCH_ROOT_ENV = "CG_BCH_ROOT";

const DEFAULT_COORD_ROOT = "H:\\cg-coord";
// Safe in a Windows path and inside a PowerShell single-quoted string.
const Name = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const Roots = z.object({ migrated: z.array(Name) }).strict();

/** lower-case container name -> its root; loaded once per process. */
let migrated: Map<string, string> | null = null;

function load(): Map<string, string> {
  if (migrated) return migrated;
  const coord = Deno.env.get("CG_COORD_ROOT") || DEFAULT_COORD_ROOT;
  const path = join(coord, BCH_ROOTS_FILE);
  let text: string | null;
  try {
    text = Deno.readTextFileSync(path);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw new ConfigurationError(`cannot read ${path}: ${err}`, path);
    }
    text = null;
  }
  const map = new Map<string, string>();
  if (text !== null) {
    let parsed;
    try {
      parsed = Roots.safeParse(JSON.parse(text));
    } catch (err) {
      throw new ConfigurationError(`${path} is not JSON: ${err}`, path);
    }
    if (!parsed.success) {
      throw new ConfigurationError(
        `${path} must be {"migrated": [container names]}: ${parsed.error.message}`,
        path,
      );
    }
    for (const c of parsed.data.migrated) {
      if (map.has(c.toLowerCase())) {
        throw new ConfigurationError(`${path} lists ${c} twice`, path);
      }
      map.set(c.toLowerCase(), `${SHARED_BCH_ROOT}-${c}`);
    }
  }
  migrated = map;
  return map;
}

/** Test seam: forget the loaded file so the next call reads it again. */
export function _resetBchRootsForTest(): void {
  migrated = null;
}

/** The BCH host helper folder `container` uses. */
export function bchRootFor(container: string): string {
  return load().get(container.toLowerCase()) ?? SHARED_BCH_ROOT;
}

/** The shared root and every migrated root (for maintenance that spans all of them). */
export function allBchRoots(): string[] {
  return [SHARED_BCH_ROOT, ...load().values()];
}

/** `sharedPath` (a path under the shared root) moved onto `container`'s root. */
export function bchPath(container: string, sharedPath: string): string {
  const lower = sharedPath.toLowerCase();
  const root = SHARED_BCH_ROOT.toLowerCase();
  if (lower !== root && !lower.startsWith(`${root}\\`)) {
    throw new ConfigurationError(
      `${sharedPath} is not under ${SHARED_BCH_ROOT}`,
      sharedPath,
    );
  }
  return bchRootFor(container) + sharedPath.slice(SHARED_BCH_ROOT.length);
}

/**
 * PowerShell lines that point BCH at `container`'s root, run right after the
 * module import. Empty for an unmigrated container (or `null`, a script that
 * touches no container), so those scripts are unchanged. For a migrated one
 * the script throws unless the root is mounted in that container, so a wrong
 * root never silently falls back to a PSSession or a shared-root path.
 */
export function bchRootLines(container: string | null): string {
  if (container === null) return "";
  const root = bchRootFor(container);
  if (root === SHARED_BCH_ROOT) return "";
  const c = load().has(container.toLowerCase())
    ? root.slice(SHARED_BCH_ROOT.length + 1)
    : container;
  return [
    `$bcContainerHelperConfig.hostHelperFolder = '${root}'`,
    `if ("$(Get-BcContainerPath -containerName '${c}' -path '${root}')" -eq '') { throw "[CG-BCH-ROOT] ${root} is not mounted in ${c}" }`,
  ].join("\n");
}

/** The env a spawned BCH script gets so it can check it resolved the same root. */
export function bchRootEnv(container: string): Record<string, string> {
  return { [BCH_ROOT_ENV]: bchRootFor(container) };
}
