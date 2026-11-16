/**
 * H-106: the qualify work queue. Several `harness qualify --queue` processes
 * on one manifest and one results root claim variants one at a time, instead
 * of each taking a fixed half of the manifest.
 *
 * Layout under `<resultsDir>/qualify/<manifest sha>/queue/`:
 * - `queue.json`: `{v, queue_id, binding, created_at}`, made once. A process
 *   with any other binding (env_fp included) is refused, so one index never
 *   spans two environments.
 * - `claims/<task/variant>.json`: one live claim per variant, holding the
 *   owner (token, pid, host, private root, containers, env_fp). Its mtime is
 *   the heartbeat.
 * - `claims/<...>.json.reclaim-<stale token>`: the marker that lets exactly
 *   one process take over a stale claim.
 *
 * Every file is written in full to a unique tmp name and then hard-linked into
 * place. The link fails if the target exists, so a create is atomic and no
 * reader ever sees a partly written file.
 */
import { join } from "@std/path";
import { ConfigurationError } from "../errors.ts";

/** Heartbeat interval of a held claim. */
export const HEARTBEAT_MS = 30_000;
/**
 * A claim with no heartbeat this long may be stale. The orchestrator ruled
 * 10 min: on 2026-11-12 a PowerShell call stalled 6 min under memory pressure.
 */
export const CLAIM_STALE_MS = 10 * 60_000;

export interface QueueOwner {
  /** One per qualify process; the claim check compares this, never the PID. */
  token: string;
  pid: number;
  host: string;
  private_root: string;
  containers: string[];
  env_fp: string;
}

export interface QueueDeps {
  now(): number;
  host: string;
  /** Whether `pid` runs on this host. Only asked about same-host claims. */
  pidAlive(pid: number): Promise<boolean>;
}

export interface VariantClaim {
  path: string;
  /** Refreshes the claim's mtime. */
  heartbeat(): Promise<void>;
  /** Whether the claim on disk is still this owner's. */
  holds(): Promise<boolean>;
  /** Removes the claim if it is still this owner's. */
  release(): Promise<void>;
}

interface ClaimFile {
  v: 1;
  task: string;
  variant: string;
  owner: QueueOwner;
  claimed_at: string;
}

/** Writes `text` at `path` only if nothing is there; false if something is. */
async function createWhole(path: string, text: string): Promise<boolean> {
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  await Deno.writeTextFile(tmp, text, { createNew: true });
  try {
    await Deno.link(tmp, path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.AlreadyExists) return false;
    throw err;
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch {
    return null;
  }
}

/**
 * Joins (or opens) the queue in `dir` under `binding`. Every member has the
 * same binding; a process with any other is refused, naming the keys.
 */
export async function joinQueue(
  dir: string,
  binding: Record<string, unknown>,
  now: number,
): Promise<{ queue_id: string }> {
  await Deno.mkdir(join(dir, "claims"), { recursive: true });
  const path = join(dir, "queue.json");
  const mine = {
    v: 1,
    queue_id: crypto.randomUUID(),
    binding,
    created_at: new Date(now).toISOString(),
  };
  if (await createWhole(path, JSON.stringify(mine, null, 2) + "\n")) {
    return { queue_id: mine.queue_id };
  }
  const q = await readJson<typeof mine>(path);
  if (!q || q.v !== 1 || typeof q.queue_id !== "string") {
    throw new ConfigurationError(`unreadable qualify queue ${path}`, path);
  }
  const keys = [
    ...new Set([...Object.keys(binding), ...Object.keys(q.binding)]),
  ]
    .filter((k) => JSON.stringify(binding[k]) !== JSON.stringify(q.binding[k]))
    .sort();
  if (keys.length > 0) {
    throw new ConfigurationError(
      `qualify queue ${path} runs under another binding (${
        keys.join(", ")
      } differ): one queue is one environment; use another --results-dir`,
      path,
    );
  }
  return { queue_id: q.queue_id };
}

const claimPath = (dir: string, task: string, variant: string) =>
  join(dir, "claims", `${encodeURIComponent(`${task}/${variant}`)}.json`);

/**
 * Stale: no heartbeat for CLAIM_STALE_MS, and, when the claim is this host's,
 * its PID is gone. The token of an unreadable claim is its mtime.
 */
async function staleToken(
  path: string,
  deps: QueueDeps,
): Promise<string | null> {
  let mtime: number;
  try {
    mtime = (await Deno.stat(path)).mtime?.getTime() ?? 0;
  } catch {
    return null;
  }
  if (deps.now() - mtime < CLAIM_STALE_MS) return null;
  const c = await readJson<ClaimFile>(path);
  if (c?.owner?.host === deps.host && await deps.pidAlive(c.owner.pid)) {
    return null;
  }
  return c?.owner?.token ?? `mtime-${mtime}`;
}

async function tokenOf(path: string): Promise<string | null> {
  return (await readJson<ClaimFile>(path))?.owner?.token ?? null;
}

/**
 * Claims task/variant for `owner`, or null when another process holds it
 * (live, or being reclaimed by someone else).
 */
export async function claimVariant(
  dir: string,
  task: string,
  variant: string,
  owner: QueueOwner,
  deps: QueueDeps,
): Promise<VariantClaim | null> {
  const path = claimPath(dir, task, variant);
  await Deno.mkdir(join(dir, "claims"), { recursive: true });
  const body: ClaimFile = {
    v: 1,
    task,
    variant,
    owner,
    claimed_at: new Date(deps.now()).toISOString(),
  };
  const text = JSON.stringify(body, null, 2) + "\n";
  if (!await createWhole(path, text)) {
    const stale = await staleToken(path, deps);
    if (stale === null) return null;
    // One reclaimer per stale generation: the marker is keyed by its token.
    if (!await createWhole(`${path}.reclaim-${stale}`, text)) return null;
    const now = await tokenOf(path);
    if (now !== stale && !(now === null && stale.startsWith("mtime-"))) {
      return null;
    }
    await Deno.remove(path).catch(() => {});
    if (!await createWhole(path, text)) return null;
  }
  const holds = async () => await tokenOf(path) === owner.token;
  return {
    path,
    heartbeat: async () => {
      if (await holds()) {
        const t = new Date(deps.now());
        await Deno.utime(path, t, t);
      }
    },
    holds,
    release: async () => {
      if (await holds()) await Deno.remove(path).catch(() => {});
    },
  };
}

/** Whether `pid` runs on this host. An unanswerable probe counts as alive. */
export async function pidAlive(pid: number): Promise<boolean> {
  try {
    if (Deno.build.os === "windows") {
      const out = await new Deno.Command("tasklist", {
        args: ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
        stdout: "piped",
        stderr: "null",
      }).output();
      if (!out.success) return true;
      return new TextDecoder().decode(out.stdout).includes(`"${pid}"`);
    }
    const out = await new Deno.Command("kill", {
      args: ["-0", String(pid)],
      stdout: "null",
      stderr: "null",
    }).output();
    return out.success;
  } catch {
    return true;
  }
}

export function defaultQueueDeps(): QueueDeps {
  return { now: () => Date.now(), host: Deno.hostname(), pidAlive };
}
