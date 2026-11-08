/**
 * H-77: what lets `harness recover <c> --recreated <evidence-dir>` clear the
 * records an owner-approved recreate (H-57 procedure) left behind. The old
 * container's records (another Docker id, same name) are cleared only when:
 * - every one of them is readable, is not the current container's, and is
 *   older than the container's creation time (docker inspect Created);
 * - the container is listed in bch-roots.json and its mounts show its own
 *   BCH root and no other BCH root (the shared one or another container's);
 * - a baseline of the current lineage was created after the recreate (the
 *   instance manifest; recover's env check proves its env_fp separately).
 * Pure: the caller reads Docker, the records and the manifest.
 */

import type { ContainerRecord } from "./quarantine.ts";
import { dockerContextEnv } from "../container/docker-context.ts";

/**
 * Sol r2: whether a container with this Docker id still exists (a renamed
 * old container is not gone). Throws when Docker cannot tell.
 */
export async function containerIdExists(id: string): Promise<boolean> {
  const out = await new Deno.Command("docker", {
    args: ["inspect", "--type", "container", "-f", "{{.Id}}", id],
    env: dockerContextEnv(),
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (out.code === 0) return true;
  const err = new TextDecoder().decode(out.stderr);
  if (/no such (container|object)/i.test(err)) return false;
  throw new Error(
    `docker inspect ${id} (exit ${out.code}): ${err.trim().slice(0, 300)}`,
  );
}

/** `docker inspect <c>` under the pinned context; throws when absent or unreadable. */
export async function inspectContainerFacts(
  container: string,
): Promise<ContainerFacts> {
  const out = await new Deno.Command("docker", {
    args: ["inspect", "--type", "container", container],
    env: dockerContextEnv(),
    stdout: "piped",
    stderr: "piped",
  }).output();
  const facts = out.code === 0
    ? parseContainerFacts(new TextDecoder().decode(out.stdout))
    : null;
  if (!facts) {
    throw new Error(
      `docker inspect ${container} failed (exit ${out.code}): ${
        new TextDecoder().decode(out.stderr).trim().slice(0, 300)
      }`,
    );
  }
  return facts;
}

/** Docker's RFC 3339 time (nanoseconds) in ms since the epoch; NaN when not a time. */
export function dockerTime(s: string): number {
  const m = s.match(/^(.*T\d\d:\d\d:\d\d)(\.\d+)?(Z|[+-]\d\d:\d\d)$/);
  if (!m) return NaN;
  const frac = m[2] ? m[2].slice(0, 4).padEnd(4, "0") : "";
  return Date.parse(`${m[1]}${frac}${m[3]}`);
}

export interface ContainerFacts {
  id: string;
  created: string;
  /** Every mount's host source. */
  mounts: string[];
}

/** The id, creation time and mount sources from `docker inspect <c>`; null when absent or malformed. */
export function parseContainerFacts(raw: string): ContainerFacts | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const e = Array.isArray(parsed) ? parsed[0] : null;
  if (
    !e || typeof e.Id !== "string" || typeof e.Created !== "string" ||
    !Array.isArray(e.Mounts)
  ) return null;
  return {
    id: e.Id,
    created: e.Created,
    mounts: (e.Mounts as { Source?: unknown }[]).flatMap((m) =>
      typeof m?.Source === "string" ? [m.Source] : []
    ),
  };
}

export interface RecreatedInput {
  container: string;
  /** The container's current Docker id. */
  currentId: string;
  /** Every record matching the container (findRecords). */
  found: { file: string; record: ContainerRecord | null }[];
  /** docker inspect Created. */
  created: string;
  mounts: readonly string[];
  /** The container's root from bch-roots.json; null when not listed. */
  ownRoot: string | null;
  /** BCH's shared root (C:\ProgramData\BcContainerHelper). */
  sharedRoot: string;
  /** The instance manifest's lineage and creation time; null when none. */
  manifest: { lineage_id: string; created_at: string } | null;
  lineageId: string;
  /** Sol r1: `--abandon <token>`, the one in-use record (of the old container) attested gone. */
  abandon?: string | null;
  /** Sol r2: the old Docker ids that still exist as containers (a renamed old container). */
  liveOldIds?: readonly string[];
  /**
   * Sol r4: every other BCH root (the shared one and each other migrated
   * container's), as named AND as resolved on the host; a mount related to
   * any of them (equal, inside, or containing it) is foreign, and so is an
   * own root that resolves onto one of them.
   */
  otherRoots?: readonly string[];
  /** Sol r4: the mount sources as Docker reported them (before resolving). */
  rawMounts?: readonly string[];
  /** Sol r5: the own root as named in bch-roots.json (`ownRoot` is resolved). */
  ownRootRaw?: string | null;
}

/**
 * Sol r1/r3: one spelling for a Windows path: backslashes, no \\?\ prefix,
 * `.` and `..` resolved, each component's trailing dots and spaces dropped
 * (Win32 ignores them), no trailing separator, lower case. The caller also
 * resolves each source on the host (realPath: junctions, 8.3 names).
 */
export function normWinPath(p: string): string {
  const s = p.trim().replace(/\//g, "\\").replace(/^\\\\\?\\/, "");
  const parts: string[] = [];
  for (const raw of s.split("\\")) {
    const c = raw === "." || raw === ".." ? raw : raw.replace(/[. ]+$/, "");
    if (c === "" || c === ".") continue;
    if (c === "..") {
      if (parts.length > 1) parts.pop();
      continue;
    }
    parts.push(c);
  }
  return parts.join("\\").toLowerCase();
}
const norm = normWinPath;
const under = (p: string, root: string) =>
  p === root || p.startsWith(`${root}\\`);

/** Why the recreate does not prove the records stale ([] when it does). */
export function recreatedProblems(o: RecreatedInput): string[] {
  const out: string[] = [];
  const created = dockerTime(o.created);
  if (o.found.length === 0) out.push(`no record of ${o.container} to clear`);
  if (Number.isNaN(created)) {
    out.push(`container creation time ${o.created} unreadable`);
  }
  for (const f of o.found) {
    const r = f.record;
    if (!r) {
      out.push(`${f.file}: unreadable record (its time is unknown)`);
      continue;
    }
    if (r.id.toLowerCase() === o.currentId.toLowerCase()) {
      out.push(
        `${f.file} is a record of the current container (id ${r.id}): not a recreate; use harness recover without --recreated`,
      );
      continue;
    }
    // Sol r2: a different id is no proof the old container is gone
    if (o.liveOldIds?.some((x) => x.toLowerCase() === r.id.toLowerCase())) {
      out.push(
        `${f.file}: its container (id ${r.id}) still exists (renamed?): remove it first`,
      );
    }
    // Sol r1: an in-use claim (a run or a recover) may belong to a live
    // owner still addressing the container by name: only an attested one
    if (r.state === "in_use" && r.token !== o.abandon) {
      out.push(
        `${f.file}: in use by ${r.by} (pid ${r.pid}, token ${r.token}): a live run may hold it; if it is gone, pass --abandon ${r.token}`,
      );
    }
    const at = Date.parse(r.at);
    if (!(at < created)) {
      out.push(
        `${f.file} (at ${r.at}): the container was not created after it (Created ${o.created})`,
      );
    }
  }
  if (o.ownRoot === null) {
    out.push(
      `${o.container} is not listed in bch-roots.json (no own BCH root)`,
    );
  } else {
    const own = norm(o.ownRoot), shared = norm(o.sharedRoot);
    const mounts = o.mounts.map(norm);
    // Sol r4: related = equal, inside, or containing
    const related = (a: string, b: string) => under(a, b) || under(b, a);
    // the shared root and every other root always count, even one equal to
    // the own root (a junction sharing its storage: Sol r5); the caller
    // leaves out only the own root as named
    const others = [shared, ...(o.otherRoots ?? []).map(norm)];
    // Sol r5: a mount is the own root as named or as resolved
    const ownNames = [own, ...(o.ownRootRaw ? [norm(o.ownRootRaw)] : [])];
    const isOwn = (n: string) => ownNames.some((x) => under(n, x));
    const overlap = others.filter((r) => related(own, r));
    if (overlap.length > 0) {
      out.push(
        `its own root ${o.ownRoot} overlaps another BCH root: ${
          overlap.join(", ")
        }`,
      );
    }
    const foreign = [...o.mounts, ...(o.rawMounts ?? [])].filter((m) => {
      const n = norm(m);
      // named under the BCH naming (inside a root, a sibling root, or an
      // ancestor of them all: Sol r1), or related to any other known root
      // as named or resolved (Sol r4)
      const named = under(n, shared) || n.startsWith(`${shared}-`) ||
        shared.startsWith(`${n}\\`);
      return (named && !isOwn(n)) || others.some((r) => related(n, r));
    });
    if (foreign.length > 0) {
      out.push(
        `mounts another BCH root than its own ${o.ownRoot}: ${
          [...new Set(foreign)].join(", ")
        }`,
      );
    }
    if (!mounts.includes(own)) {
      out.push(`its own root ${o.ownRoot} is not mounted`);
    }
  }
  const m = o.manifest;
  if (!m) {
    out.push(
      `no baseline of ${o.container} (run harness baseline create after the recreate)`,
    );
  } else {
    if (m.lineage_id !== o.lineageId) {
      out.push(
        `the baseline is of lineage ${m.lineage_id}, not ${o.lineageId}`,
      );
    }
    if (!(Date.parse(m.created_at) > created)) {
      out.push(
        `the baseline (${m.created_at}) was created before the recreate (${o.created})`,
      );
    }
  }
  return out;
}
