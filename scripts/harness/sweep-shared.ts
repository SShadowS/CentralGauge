/**
 * H-55: list (and, only with --apply, remove) CentralGauge-owned files that
 * linger on the BcContainerHelper shared folder every BC container mounts:
 * compile outputs under compiler\CentralGauge-<c>\output, our staged copies
 * in Extensions\<c>\my, and BCH's own Publish staging dirs
 * (Extensions\<c>\<guid>) that hold only our apps. Foreign apps and other
 * products' folders are never listed. A container under a live coord lease
 * (or whose lease cannot be read) is skipped; a fresh bench marker refuses
 * the whole sweep. Links are never followed.
 *
 *   deno run --allow-all scripts/harness/sweep-shared.ts \
 *     --container Cronus281 --container Cronus285 [--bench-dir results] [--apply]
 */
import { Command } from "@cliffy/command";
import { join } from "@std/path";
import { DEFAULT_COORD_ROOT } from "../../src/harness/allocation.ts";
import { coordLeaseBlock } from "../../src/harness/coord-lease.ts";
import { isBenchRunning } from "../../src/utils/bench-lock.ts";

export const BCH_ROOT = "C:\\ProgramData\\BcContainerHelper";

export interface SweepItem {
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
}

/** Our staged copy (publishApp, prepareCandidateApp, syncHarnessApps, legacy tests). */
const OUR_MY_APP = /^[0-9a-f]{8}_CentralGauge_.+\.app$/i;
/** The unit tests' fake container: everything staged there is a test leftover. */
const TEST_CONTAINER = "TestContainer";
const TEST_MY_APP = /^[0-9a-f]{8}_.+\.app$/i;
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

function benchRefusal(benchDirs: string[]): string | null {
  const live = benchDirs.find((d) => isBenchRunning(d));
  return live ? `a bench marker in ${live} is fresh` : null;
}

async function itemsOf(bch: string, c: string): Promise<SweepItem[]> {
  const items: SweepItem[] = [];
  const out = join(bch, "compiler", `CentralGauge-${c}`, "output");
  for (const e of await entries(out)) {
    if (e.isSymlink) continue;
    items.push({
      path: join(out, e.name),
      container: c,
      kind: "compiler-output",
    });
  }
  const my = join(bch, "Extensions", c, "my");
  const mine = c === TEST_CONTAINER ? TEST_MY_APP : OUR_MY_APP;
  for (const e of await entries(my)) {
    if (e.isFile && mine.test(e.name)) {
      items.push({ path: join(my, e.name), container: c, kind: "my-app" });
    }
  }
  const ext = join(bch, "Extensions", c);
  for (const e of await entries(ext)) {
    if (!e.isDirectory || !GUID.test(e.name)) continue;
    const inside = await entries(join(ext, e.name));
    // Only a dir holding nothing but our apps; anything else stays.
    if (
      inside.length > 0 && inside.every((f) => f.isFile && OUR_APP.test(f.name))
    ) {
      items.push({
        path: join(ext, e.name),
        container: c,
        kind: "bch-staging",
      });
    }
  }
  return items;
}

const norm = (p: string) =>
  p.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase() + "\\";

/**
 * H-55 (4): every CentralGauge-owned artifact under the BCH root (every
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
  const all: SweepItem[] = [];
  for (const c of names) all.push(...await itemsOf(bchRoot, c));
  return all.filter((i) =>
    mounts.some((m) => norm(i.path).startsWith(norm(m.Source)))
  );
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
    const why = coordLeaseBlock(o.coordRoot, new Map(), c);
    if (why) {
      skipped.push({ container: c, why });
      continue;
    }
    items.push(...await itemsOf(o.bchRoot, c));
  }
  return { refused: null, items, skipped };
}

/** Removes the listed items; the bench marker and each lease are re-checked first. */
export async function applySweep(
  items: SweepItem[],
  o: Pick<SweepOptions, "benchDirs" | "coordRoot">,
): Promise<{ removed: SweepItem[]; skipped: SweepItem[] }> {
  const refused = benchRefusal(o.benchDirs);
  if (refused) throw new Error(`sweep refused: ${refused}`);
  const removed: SweepItem[] = [];
  const skipped: SweepItem[] = [];
  for (const i of items) {
    if (coordLeaseBlock(o.coordRoot, new Map(), i.container)) {
      skipped.push(i);
      continue;
    }
    const st = await Deno.lstat(i.path).catch(() => null);
    if (!st || st.isSymlink) {
      skipped.push(i);
      continue;
    }
    await Deno.remove(i.path, { recursive: true });
    removed.push(i);
  }
  return { removed, skipped };
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
    .option("--apply", "remove what is listed (default: list only)")
    .parse(args);
  const opts: SweepOptions = {
    bchRoot: o.bchRoot,
    coordRoot: Deno.env.get("CG_COORD_ROOT") || DEFAULT_COORD_ROOT,
    benchDirs: o.benchDir ?? ["results"],
    containers: o.container,
  };
  const plan = await planSweep(opts);
  if (plan.refused) {
    console.log(`[FAIL] sweep refused: ${plan.refused}`);
    Deno.exit(1);
  }
  for (const s of plan.skipped) console.log(`[SKIP] ${s.container}: ${s.why}`);
  for (const i of plan.items) console.log(`[LIST] ${i.kind} ${i.path}`);
  console.log(`${plan.items.length} item(s)${o.apply ? "" : " (list only)"}`);
  if (!o.apply) return;
  const done = await applySweep(plan.items, opts);
  for (const i of done.skipped) console.log(`[SKIP] ${i.path}`);
  console.log(`[OK] removed ${done.removed.length}`);
}

if (import.meta.main) await main(Deno.args);
