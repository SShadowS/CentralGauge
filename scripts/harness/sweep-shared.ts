/**
 * H-55: list (and, only with --apply, remove) CentralGauge-owned files that
 * linger on the BcContainerHelper shared folder every BC container mounts:
 * files under compiler\CentralGauge-<c>\output, our staged copies in
 * Extensions\<c>\my, and our apps in BCH's own Publish staging dirs
 * (Extensions\<c>\<guid>). Ownership is decided per FILE, by name and place;
 * a foreign file is never listed, and a directory is only ever removed once
 * empty. A link anywhere on the way (an ancestor included) is never followed:
 * the item is dropped. Listing skips a container under someone's live coord
 * lease (or an unreadable one); --apply requires the caller to hold each
 * container's lease (--coord-lease) and holds the bench lock while it deletes,
 * so neither a lease nor a bench can start under it.
 *
 *   deno run --allow-all scripts/harness/sweep-shared.ts \
 *     --container Cronus281 [--bench-dir results] \
 *     [--apply --coord-lease Cronus281=<token>]
 */
import { Command } from "@cliffy/command";
import { dirname, join, relative } from "@std/path";
import { DEFAULT_COORD_ROOT } from "../../src/harness/allocation.ts";
import { coordLeaseBlock } from "../../src/harness/coord-lease.ts";
import {
  benchLockLost,
  isBenchRunning,
  tryAcquireBenchLock,
} from "../../src/utils/bench-lock.ts";

export const BCH_ROOT = "C:\\ProgramData\\BcContainerHelper";

export interface SweepItem {
  /** Always a file. */
  path: string;
  container: string;
  kind: "compiler-output" | "my-app" | "bch-staging";
}

export interface SweepOptions {
  bchRoot: string;
  coordRoot: string;
  /** Bench marker dirs: any fresh `.bench-running.json` refuses. */
  benchDirs: string[];
  /** The containers to sweep, named by the operator (never discovered). */
  containers: string[];
  /** Coord leases this caller holds (container -> token). */
  coordLeases?: ReadonlyMap<string, string>;
}

/** Our staged copy (publishApp, prepareCandidateApp, syncHarnessApps, legacy tests). */
const OUR_MY_APP = /^[0-9a-f]{8}_CentralGauge_.+\.app$/i;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUR_APP = /^CentralGauge_.+\.app$/i;

async function entries(dir: string): Promise<Deno.DirEntry[]> {
  const out: Deno.DirEntry[] = [];
  try {
    for await (const e of Deno.readDir(dir)) out.push(e);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  return out;
}

/**
 * Sol r1 #1: true only when every path segment from the BCH root down to
 * `p` exists and is no link, and `p` resolves inside the canonical root.
 */
async function plainUnder(bch: string, p: string): Promise<boolean> {
  let at = bch;
  for (const seg of relative(bch, p).split(/[\\/]/)) {
    if (!seg || seg === "..") return false;
    at = join(at, seg);
    const st = await Deno.lstat(at).catch(() => null);
    if (!st || st.isSymlink) return false;
  }
  const real = await Deno.realPath(p).catch(() => null);
  const root = await Deno.realPath(bch).catch(() => null);
  return !!real && !!root &&
    real.toLowerCase().startsWith(root.toLowerCase().replace(/\\*$/, "\\"));
}

/** Plain files under `dir`, recursively; a link (file or dir) is skipped, never entered. */
async function plainFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await entries(dir)) {
    if (e.isSymlink) continue;
    const p = join(dir, e.name);
    if (e.isFile) out.push(p);
    else if (e.isDirectory) out.push(...await plainFiles(p));
  }
  return out;
}

async function itemsOf(bch: string, c: string): Promise<SweepItem[]> {
  const found: SweepItem[] = [];
  // Sol r2 #1: a folder is checked (no link on the way) BEFORE it is read.
  const out = join(bch, "compiler", `CentralGauge-${c}`, "output");
  const files = await plainUnder(bch, out) ? await plainFiles(out) : [];
  for (const p of files) {
    found.push({ path: p, container: c, kind: "compiler-output" });
  }
  const ext = join(bch, "Extensions", c);
  const extOk = await plainUnder(bch, ext);
  const my = extOk && await plainUnder(bch, join(ext, "my"))
    ? await entries(join(ext, "my"))
    : [];
  for (const e of my) {
    if (e.isFile && OUR_MY_APP.test(e.name)) {
      found.push({
        path: join(ext, "my", e.name),
        container: c,
        kind: "my-app",
      });
    }
  }
  for (const e of extOk ? await entries(ext) : []) {
    // A junction is a symlink entry, never a directory one: not entered.
    if (!e.isDirectory || e.isSymlink || !GUID.test(e.name)) continue;
    // Sol r1 #3/#6: our apps by name, also in a mixed dir; the rest stays.
    for (const f of await entries(join(ext, e.name))) {
      if (f.isFile && OUR_APP.test(f.name)) {
        found.push({
          path: join(ext, e.name, f.name),
          container: c,
          kind: "bch-staging",
        });
      }
    }
  }
  const items: SweepItem[] = [];
  for (const i of found) if (await plainUnder(bch, i.path)) items.push(i);
  return items;
}

const norm = (p: string) =>
  p.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase() + "\\";

/**
 * H-55 (4): every CentralGauge-owned .app under the BCH root (every
 * container's, discovered, no lease check) that one of `mounts` shows the
 * container: the finding "judge artifacts on shared mount", separate from
 * whether the mount itself is allowed.
 */
export async function visibleArtifacts(
  mounts: { Source: string; Destination: string }[],
  bchRoot: string,
): Promise<SweepItem[]> {
  const names = new Set<string>();
  for (const e of await entries(join(bchRoot, "compiler"))) {
    const m = /^CentralGauge-(.+)$/i.exec(e.name);
    if (e.isDirectory && m) names.add(m[1]!);
  }
  for (const e of await entries(join(bchRoot, "Extensions"))) {
    if (e.isDirectory) names.add(e.name);
  }
  // Sol r2 #3: both sides by the filesystem's own name (a junction-backed
  // BCH root shows its target as the mount source).
  const real = (p: string) => Deno.realPath(p).catch(() => p);
  const sources = await Promise.all(mounts.map((m) => real(m.Source)));
  const shown: SweepItem[] = [];
  for (const c of names) {
    for (const i of await itemsOf(bchRoot, c)) {
      if (!i.path.toLowerCase().endsWith(".app")) continue;
      const p = norm(await real(i.path));
      if (sources.some((s) => p.startsWith(norm(s)))) shown.push(i);
    }
  }
  return shown;
}

function benchRefusal(benchDirs: string[]): string | null {
  const live = benchDirs.find((d) => isBenchRunning(d));
  return live ? `a bench marker in ${live} is fresh` : null;
}

export async function planSweep(o: SweepOptions): Promise<{
  refused: string | null;
  items: SweepItem[];
  skipped: { container: string; why: string }[];
}> {
  const refused = benchRefusal(o.benchDirs);
  if (refused) return { refused, items: [], skipped: [] };
  const items: SweepItem[] = [];
  const skipped: { container: string; why: string }[] = [];
  for (const c of o.containers) {
    // A container leased by this caller is listed; any other lease (or an
    // unreadable one) skips it.
    const why = o.coordLeases && heldByUs(o.coordRoot, o.coordLeases, c)
      ? null
      : coordLeaseBlock(o.coordRoot, new Map(), c);
    if (why) {
      skipped.push({ container: c, why });
      continue;
    }
    items.push(...await itemsOf(o.bchRoot, c));
  }
  return { refused: null, items, skipped };
}

/**
 * Sol r1 #2: held by THIS caller: someone holds it (refused without our
 * token) and our token is that holder (admitted with it).
 */
const heldByUs = (root: string, own: ReadonlyMap<string, string>, c: string) =>
  own.has(c) && coordLeaseBlock(root, new Map(), c) !== null &&
  coordLeaseBlock(root, own, c) === null;

/**
 * Removes the listed files, one by one, re-checked first (a plain file under
 * the root, its container's lease ours), then each emptied directory up to
 * its container's folder, never a non-empty one. Holds the bench lock of
 * every bench dir throughout.
 */
export async function applySweep(
  items: SweepItem[],
  o: Pick<SweepOptions, "benchDirs" | "coordRoot" | "bchRoot"> & {
    coordLeases: ReadonlyMap<string, string>;
  },
): Promise<{ removed: SweepItem[]; skipped: SweepItem[] }> {
  const releases: (() => Promise<void>)[] = [];
  const lost: (() => boolean)[] = [];
  // Sol r2 #2: a lock reclaimed while we were stalled stops every deletion.
  const stillOurs = () => {
    if (lost.some((l) => l())) {
      throw new Error("sweep aborted: bench lock lost");
    }
  };
  try {
    for (const d of o.benchDirs) {
      const r = tryAcquireBenchLock(d, { command: "sweep-shared --apply" });
      if (!r.acquired) throw new Error(`sweep refused: a bench holds ${d}`);
      releases.push(r.release);
      lost.push(benchLockLost(d, r.token));
    }
    const removed: SweepItem[] = [];
    const skipped: SweepItem[] = [];
    for (const i of items) {
      stillOurs();
      const st = await Deno.lstat(i.path).catch(() => null);
      const ok = st?.isFile && await plainUnder(o.bchRoot, i.path);
      // Sol r3: the synchronous checks sit right before the removal, after
      // every await, so a stall cannot slip a bench or a lease in between.
      stillOurs();
      if (!ok || !heldByUs(o.coordRoot, o.coordLeases, i.container)) {
        skipped.push(i);
        continue;
      }
      await Deno.remove(i.path);
      removed.push(i);
    }
    // Emptied dirs (a compile output dir, a BCH staging dir), never `my`,
    // `output` or a container folder; a non-empty one refuses (no recursion).
    const stop = (i: SweepItem) =>
      i.kind === "compiler-output"
        ? join(o.bchRoot, "compiler", `CentralGauge-${i.container}`, "output")
        : join(
          o.bchRoot,
          "Extensions",
          i.container,
          ...(i.kind === "my-app" ? ["my"] : []),
        );
    for (const i of removed) {
      for (
        let d = dirname(i.path);
        norm(d) !== norm(stop(i)) && norm(d).startsWith(norm(stop(i)));
        d = dirname(d)
      ) {
        if (!(await plainUnder(o.bchRoot, d))) break;
        stillOurs();
        if (!(await Deno.remove(d).then(() => true, () => false))) break;
      }
    }
    return { removed, skipped };
  } finally {
    for (const r of releases) await r();
  }
}

async function main(args: string[]) {
  const { options: o } = await new Command()
    .name("sweep-shared")
    .option("--container <name:string>", "a container to sweep (repeatable)", {
      collect: true,
      required: true,
    })
    .option("--bench-dir <dir:string>", "bench marker dir (repeatable)", {
      collect: true,
    })
    .option("--bch-root <dir:string>", "BcContainerHelper root", {
      default: BCH_ROOT,
    })
    .option(
      "--coord-lease <pair:string>",
      "<container>=<token> (for --apply)",
      {
        collect: true,
      },
    )
    .option("--apply", "remove what is listed (default: list only)")
    .parse(args);
  const opts: SweepOptions = {
    bchRoot: o.bchRoot,
    coordRoot: Deno.env.get("CG_COORD_ROOT") || DEFAULT_COORD_ROOT,
    benchDirs: o.benchDir ?? ["results"],
    containers: o.container,
  };
  const leases = new Map(
    (o.coordLease ?? []).map((p) => {
      const at = p.indexOf("=");
      if (at < 1) {
        throw new Error(`--coord-lease ${p}: want <container>=<token>`);
      }
      return [p.slice(0, at), p.slice(at + 1)] as const;
    }),
  );
  const plan = await planSweep({ ...opts, coordLeases: leases });
  if (plan.refused) {
    console.log(`[FAIL] sweep refused: ${plan.refused}`);
    Deno.exit(1);
  }
  for (const s of plan.skipped) console.log(`[SKIP] ${s.container}: ${s.why}`);
  for (const i of plan.items) console.log(`[LIST] ${i.kind} ${i.path}`);
  console.log(`${plan.items.length} file(s)${o.apply ? "" : " (list only)"}`);
  if (!o.apply) return;
  // Only containers whose lease this caller holds; applySweep re-checks.
  const done = await applySweep(plan.items, { ...opts, coordLeases: leases });
  for (const i of done.skipped) console.log(`[SKIP] ${i.path}`);
  console.log(`[OK] removed ${done.removed.length}`);
}

if (import.meta.main) await main(Deno.args);
