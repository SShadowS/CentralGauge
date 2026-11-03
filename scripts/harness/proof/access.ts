/**
 * H-35c (design-r5 2.5): the access-denial path table for the two
 * identities, and the agent sandbox's mount check against it. The agent
 * sandbox sees only its bind mounts, so its denial is the mount set: no
 * mount may be, contain or sit inside a denied root. The canary probe
 * (sandbox-probe.ps1, run by lane-ops in the real image) checks the same
 * thing from inside.
 */
import { join, normalize, resolve } from "@std/path";

export type Expect = "denied" | "not_present";

/** design-r5 2.5, one row per target; `server` is the NST service identity. */
export const ACCESS_TABLE: readonly {
  target: string;
  sandbox: Expect;
  server: Expect;
}[] = [
  { target: "results", sandbox: "denied", server: "denied" },
  { target: "private_root", sandbox: "denied", server: "denied" },
  { target: "logs", sandbox: "denied", server: "denied" },
  {
    target: "symbols_and_compiler_caches",
    sandbox: "denied",
    server: "denied",
  },
  { target: "appinfo", sandbox: "denied", server: "denied" },
  {
    target: "judge_app_after_publish",
    sandbox: "not_present",
    server: "not_present",
  },
];

export interface AccessRoots {
  /** results/harness: judgments, verdicts (the verdict logs), executions. */
  resultsRoot: string;
  privateRoot: string;
  symbolStore: string;
  /** H-44 `--key-custody`, when the run has one. */
  keyCustody?: string | null;
  /** The execution whose own work dir and secrets dir the sandbox mounts. */
  executionId: string;
  /** Its own secrets dir (createSecretsDir); no other is accepted. */
  secretsDir?: string;
}

/** Private root folders no sandbox mounts (execution.ts privatePaths, caches). */
const PRIVATE_DENIED = [
  "build-cache-judge",
  "build-cache-agent",
  "custody",
  "redaction",
  "quarantine",
  "intents",
  "pending",
  "taskcopy",
  "broken",
];

/** BCH's host folders: compiler folders and their caches, per-container `my`. */
const BCH_ROOT = "C:\\ProgramData\\BcContainerHelper";

export function deniedRoots(
  r: AccessRoots,
): { target: string; path: string }[] {
  return [
    { target: "results", path: r.resultsRoot },
    // The verdict logs live under results/harness/verdicts; the raw, stderr
    // and host logs under the private root's quarantine.
    { target: "logs", path: join(r.resultsRoot, "verdicts") },
    { target: "logs", path: join(r.privateRoot, "quarantine") },
    ...PRIVATE_DENIED.map((d) => ({
      target: "private_root",
      path: join(r.privateRoot, d),
    })),
    ...(r.keyCustody ? [{ target: "private_root", path: r.keyCustody }] : []),
    { target: "symbols_and_compiler_caches", path: r.symbolStore },
    { target: "symbols_and_compiler_caches", path: BCH_ROOT },
    { target: "appinfo", path: join(r.symbolStore, "appinfo") },
  ];
}

// Sol r1 #3: absolute (a relative root is the cwd's), separators and case
// folded. Links and short names are the callers' job: canonicalPath first.
const key = (p: string) =>
  normalize(resolve(p.replaceAll("/", "\\"))).replace(/\\+$/, "")
    .toLowerCase() + "\\";

/** Sol r2 #1: every denied path, not just the roots, by the filesystem's own name. */
export async function canonicalDenied(
  r: AccessRoots,
): Promise<{ target: string; path: string }[]> {
  return await Promise.all(
    deniedRoots(r).map(async (d) => ({
      ...d,
      path: await canonicalPath(d.path),
    })),
  );
}

/**
 * Sol r2 #2: where a host path shows inside the sandbox: through every bind
 * mount whose source holds it, as destination + the rest of the path.
 */
export function containerPaths(hostPath: string, args: string[]): string[] {
  return mounts(args).filter((m) => within(hostPath, m.src)).map((m) => {
    const rest = key(hostPath).slice(key(m.src).length).replace(/\\$/, "");
    const dst = m.dst.replace(/[\\/]+$/, "");
    return rest
      ? `${dst}\\${hostPath.slice(hostPath.length - rest.length)}`
      : dst;
  });
}

/**
 * The filesystem's own name for `p`: junctions, symlinks and 8.3 short names
 * resolved (realPath), or the absolute path when it does not exist.
 */
export async function canonicalPath(p: string): Promise<string> {
  try {
    return await Deno.realPath(p);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return resolve(p);
    throw err;
  }
}
const within = (inner: string, outer: string) =>
  key(inner).startsWith(key(outer));

/** The docker run args' bind mounts: source, target, read-only. */
function mounts(args: string[]) {
  const out: { src: string; dst: string; ro: boolean }[] = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] !== "--mount") continue;
    const f = new Map(
      args[i + 1]!.split(",").map((kv) => {
        const at = kv.indexOf("=");
        return at < 0 ? [kv, "true"] : [kv.slice(0, at), kv.slice(at + 1)];
      }),
    );
    out.push({
      src: f.get("source") ?? f.get("src") ?? "",
      dst: f.get("target") ?? f.get("dst") ?? f.get("destination") ?? "",
      ro: f.has("readonly") || f.has("ro"),
    });
  }
  return out;
}

/** Why the sandbox's mounts break the access table; empty when they do not. */
export function mountProblems(
  args: string[],
  r: AccessRoots,
  /** Sol r2 #1: canonicalDenied(r) in the runners; default the lexical list. */
  denied = deniedRoots(r),
): string[] {
  const own = join(r.privateRoot, "work", r.executionId);
  const problems: string[] = [];
  for (const m of mounts(args)) {
    const why = (s: string) => problems.push(`${m.src} -> ${m.dst}: ${s}`);
    if (!m.ro && m.dst.toLowerCase() !== "c:\\workspace") {
      why("read-write mount other than the workspace");
      continue;
    }
    const hit = denied.find((d) =>
      within(m.src, d.path) || within(d.path, m.src)
    );
    if (hit) {
      why(`${hit.target}: ${hit.path}`);
      continue;
    }
    if (within(r.privateRoot, m.src)) {
      why("contains the private root");
      continue;
    }
    if (within(m.src, r.privateRoot)) {
      const inWork = within(m.src, own);
      // Sol r1 #2: exactly this execution's secrets dir, no sibling's.
      const ownSecrets = !!r.secretsDir && key(m.src) === key(r.secretsDir);
      if (!inWork && !ownSecrets) {
        why("private root path outside this execution's work and secrets");
      }
    }
  }
  return problems;
}

/**
 * The NST identity's half without AL (design-r5 2.5, server column): the BC
 * container sees the host only through its bind mounts (docker inspect
 * .Mounts). Only BCH's own per-container folder (C:\Run\my and its kin) may
 * be mounted; anything of, in or above a denied root, BCH's root or another
 * container's folder is refused. A judge .app left in C:\Run\my after a
 * publish is an L4 difference already (the lineage's C:\Run `^my$` entry
 * tolerates no file inside).
 */
export function serverMountProblems(
  mounts: { Source: string; Destination: string; RW: boolean }[],
  r: AccessRoots,
  container: string,
  denied = deniedRoots(r),
): string[] {
  const own = join(BCH_ROOT, "Extensions", container);
  const problems: string[] = [];
  for (const m of mounts) {
    const why = (s: string) =>
      problems.push(`${m.Source} -> ${m.Destination}: ${s}`);
    if (within(m.Source, own)) continue;
    const hit = denied.find((d) =>
      within(m.Source, d.path) || within(d.path, m.Source)
    );
    if (hit) why(`${hit.target}: ${hit.path}`);
    else if (
      within(r.privateRoot, m.Source) || within(m.Source, r.privateRoot)
    ) why("private root");
  }
  return problems;
}

// ---- the sandbox canary probe (lane-ops runs sandbox-probe.ps1 in the image) ----

export const canaryName = (token: string) => `cg-canary-${token}.txt`;

export interface Canary {
  path: string;
  /** The own workspace's: the probe must find it (its search works). */
  positive: boolean;
}

/**
 * One canary in every denied root that exists and the harness owns (never
 * BCH's host folder: the mount check covers it), plus the positive control
 * in the execution's own workspace.
 */
export async function plantCanaries(
  r: AccessRoots,
  workspace: string,
  token: string,
): Promise<Canary[]> {
  const ours = [r.resultsRoot, r.privateRoot, r.symbolStore, r.keyCustody]
    .filter((p): p is string => !!p);
  const dirs = [
    ...new Set(
      deniedRoots(r).map((d) => d.path).filter((p) =>
        ours.some((o) => within(p, o))
      ),
    ),
  ];
  const planted: Canary[] = [];
  for (
    const [dir, positive] of [
      ...dirs.map((d) => [d, false] as const),
      [workspace, true] as const,
    ]
  ) {
    if (!(await Deno.stat(dir).catch(() => null))?.isDirectory) continue;
    const path = join(dir, canaryName(token));
    await Deno.writeTextFile(path, `CGCANARY-${token}\n`, { createNew: true });
    planted.push({ path, positive });
  }
  return planted;
}

export async function removeCanaries(planted: Canary[]): Promise<void> {
  for (const c of planted) await Deno.remove(c.path).catch(() => {});
}

/** `found`: the probe's hits (container paths) for canary names. */
export function judgeProbe(found: string[], token: string) {
  const name = canaryName(token).toLowerCase();
  const mine = found.filter((f) => f.toLowerCase().endsWith(`\\${name}`));
  const positive = mine.some((f) =>
    f.toLowerCase() === `c:\\workspace\\${name}`
  );
  const leaks = mine.filter((f) =>
    f.toLowerCase() !== `c:\\workspace\\${name}`
  );
  return { pass: positive && leaks.length === 0, positive, leaks };
}
