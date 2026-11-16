/**
 * H-106: the qualify work queue. Several `harness qualify --queue` processes
 * on one manifest and one results root claim variants one at a time, instead
 * of each taking a fixed half of the manifest.
 *
 * Layout under `<resultsDir>/qualify/<manifest sha>/queue/`:
 * - `queue.json`: `{v, queue_id, binding, created_at}`, made once. A process
 *   with any other binding (env_fp included) is refused, so one index never
 *   spans two environments.
 * - `closed-<queue_id>`: that queue's index is written. The next run reopens
 *   queue.json as a new queue (`queue.json.reopen-<queue_id>`, one winner).
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

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch {
    return null;
  }
}

interface QueueFile {
  v: 1;
  queue_id: string;
  binding: Record<string, unknown>;
  created_at: string;
}

const closedPath = (dir: string, id: string) => join(dir, `closed-${id}`);

/**
 * H-106: marks queue `id` closed (its index is written). Members never touch
 * queue.json, so a late member of an old queue cannot close a newer one.
 */
export async function closeQueue(dir: string, id: string): Promise<void> {
  await createWhole(closedPath(dir, id), "").catch(() => {});
}

/** H-106: whether queue `id` is closed (its index was published). */
export function queueClosed(dir: string, id: string): Promise<boolean> {
  return exists(closedPath(dir, id));
}

/** Attempts at reading or reopening queue.json before giving up. */
const JOIN_ATTEMPTS = 20;

/**
 * Joins (or opens) the queue in `dir` under `binding`. Every member has the
 * same binding; a process with any other is refused, naming the keys. A
 * closed queue is reopened as a new one: one reopener per closed queue id
 * (an exclusive `queue.json.reopen-<id>` marker) replaces queue.json; all
 * others read again.
 */
export async function joinQueue(
  dir: string,
  binding: Record<string, unknown>,
  now: number,
): Promise<{ queue_id: string }> {
  await Deno.mkdir(join(dir, "claims"), { recursive: true });
  const path = join(dir, "queue.json");
  const mine: QueueFile = {
    v: 1,
    queue_id: crypto.randomUUID(),
    binding,
    created_at: new Date(now).toISOString(),
  };
  const text = JSON.stringify(mine, null, 2) + "\n";
  let q: QueueFile | null = null;
  for (let i = 0; i < JOIN_ATTEMPTS && q === null; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 50));
    if (await createWhole(path, text)) return { queue_id: mine.queue_id };
    const cur = await readJson<QueueFile>(path);
    // Absent or unreadable: a reopener is between remove and create.
    if (!cur || cur.v !== 1 || typeof cur.queue_id !== "string") continue;
    if (!await exists(closedPath(dir, cur.queue_id))) {
      q = cur;
      continue;
    }
    if (await createWhole(`${path}.reopen-${cur.queue_id}`, text)) {
      // Only this process replaces queue `cur`: re-read before removing.
      // ponytail: a reopener that dies between winning this marker and the
      // remove leaves queue `cur` un-reopenable; later --queue runs fail
      // ("stayed unreadable or closed") until queue.json is removed by hand
      // (accepted for single-host use, H-106). Upgrade: an interprocess
      // lock around reopen, or a stale rule on the reopen marker.
      if ((await readJson<QueueFile>(path))?.queue_id === cur.queue_id) {
        await Deno.remove(path).catch(() => {});
      }
    }
  }
  if (q === null) {
    throw new ConfigurationError(
      `qualify queue ${path} stayed unreadable or closed after ${JOIN_ATTEMPTS} attempts`,
      path,
    );
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
 * A guard, not a policy: each level of a takeover is one dead taker, and a
 * process dies once, so a chain is as long as the takers that died mid-step.
 */
const MAX_TAKEOVER_DEPTH = 64;

/**
 * Replaces the stale file at `path` with `text`; false when it is not stale or
 * another process is taking it over. One taker per stale generation: the
 * marker `<claim>.reclaim-<stale token>` is created exclusively. A marker left
 * by a taker that died is itself a stale file (the same age and PID rule), so
 * it is taken over the same way, and a dead taker never blocks the variant.
 * Markers sit flat beside the claim (`base`), so names never grow.
 */
async function takeOver(
  path: string,
  text: string,
  deps: QueueDeps,
  base = path,
  depth = 0,
): Promise<boolean> {
  const stale = await staleToken(path, deps);
  if (stale === null) return false;
  const marker = `${base}.reclaim-${stale}`;
  if (
    !await createWhole(marker, text) &&
    !(depth < MAX_TAKEOVER_DEPTH &&
      await takeOver(marker, text, deps, base, depth + 1))
  ) {
    return false;
  }
  // The marker is this taker's now. It is removed when the step ends, won or
  // lost, so only a taker that died mid-step leaves one behind. A late taker
  // that re-creates it then finds the token changed and backs off.
  try {
    const now = await tokenOf(path);
    if (now !== stale && !(now === null && stale.startsWith("mtime-"))) {
      return false;
    }
    await Deno.remove(path).catch(() => {});
    return await createWhole(path, text);
  } finally {
    await Deno.remove(marker).catch(() => {});
  }
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
  if (!await createWhole(path, text) && !await takeOver(path, text, deps)) {
    return null;
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
