/**
 * H-35c (design-r5 2.5): the access-denial path table for the two
 * identities, and the agent sandbox's mount check against it. The agent
 * sandbox sees only its bind mounts, so its denial is the mount set: no
 * mount may be, contain or sit inside a denied root. The canary probe
 * (sandbox-probe.ps1, run by lane-ops in the real image) checks the same
 * thing from inside.
 */
import { join, normalize } from "@std/path";

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

const key = (p: string) =>
  normalize(p.replaceAll("/", "\\")).replace(/\\+$/, "").toLowerCase() + "\\";
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
export function mountProblems(args: string[], r: AccessRoots): string[] {
  const own = [
    join(r.privateRoot, "work", r.executionId),
    // createSecretsDir: one fresh dir directly under <private>/secrets
    join(r.privateRoot, "secrets"),
  ];
  const problems: string[] = [];
  for (const m of mounts(args)) {
    const why = (s: string) => problems.push(`${m.src} -> ${m.dst}: ${s}`);
    if (!m.ro && m.dst.toLowerCase() !== "c:\\workspace") {
      why("read-write mount other than the workspace");
      continue;
    }
    const hit = deniedRoots(r).find((d) =>
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
      const inWork = within(m.src, own[0]!);
      const rel = key(m.src).slice(key(own[1]!).length).replace(/\\$/, "");
      const ownSecrets = within(m.src, own[1]!) && rel.length > 0 &&
        !rel.includes("\\");
      if (!inWork && !ownSecrets) {
        why("private root path outside this execution's work and secrets");
      }
    }
  }
  return problems;
}
