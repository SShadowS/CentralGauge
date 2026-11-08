// H-70: gates on a container pool (owner decision
// decisions/2026-11-08-m8-scale-up.md ruling 3; orchestrator answers to
// q-20261108T001616-96dab68a). One worker per admitted container takes the
// next task; each task's gate is unchanged, so its evidence equals a serial
// run's. Exit 3 (infra) sends the task back once for another container, and
// that container leaves the pool. Owner: lane-infra2.
import { admittedPool } from "../../src/harness/allocation.ts";

export interface GateOutcome {
  code: number;
  file: string | null;
  /**
   * H-74 Sol r1/r2: false when the gate touched the container and then
   * ended infra or its final cleanup (prenuke, dispose) failed; absent or
   * true otherwise (e.g. the container was never touched).
   */
  clean?: boolean;
}

export interface GateJob extends GateOutcome {
  task: string;
  /** The container of the final attempt; null when no container ran it. */
  container: string | null;
}

export const INFRA = 3;

/**
 * `f`, one call at a time in call order (a rejection does not stop the
 * chain). Sol r1: each job's containerBc runs ensureTestHarness, which builds
 * in one shared directory, so concurrent jobs open their container in turn.
 */
export function serialized<A extends unknown[], R>(
  f: (...a: A) => Promise<R>,
): (...a: A) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return (...a) => {
    const run = tail.then(() => f(...a));
    tail = run.catch(() => {});
    return run;
  };
}

/** H-74: a container this run holds (its in-use record); `clean` false keeps the record. */
export interface Hold {
  release(clean: boolean): Promise<void>;
  /** H-76: the record still carries this hold's token (absent: not checked). */
  owned?(): Promise<boolean>;
  /** H-76: the record is no longer ours: stop (heartbeat), release nothing. */
  lost?(): Promise<void>;
}

/**
 * H-74: holds through the in-use records (quarantine.ts claimExclusive),
 * the claim every harness environment honours. A busy container (another
 * run's in-use record, e.g. a campaign pool releasing a lent judge after its
 * hold) is polled every `pollMs` for up to `waitMs` (--wait-free); any other
 * refusal is final at once. Sol r1: a hold is released exactly when every
 * gate on it ended with a clean final cleanup (an environment releases its
 * claims after a clean teardown the same way); a dirty one keeps the in-use
 * record. H-76: `afterClaim` (heartbeat, before-capture evidence) runs once
 * the record is ours; when it throws, the untouched claim is released and the
 * container refused. `done` follows every release or keep. `owned` is the
 * token check runGatePool makes before each job and before the release.
 */
export function recordHolds(o: {
  claim: (
    c: string,
  ) => Promise<{ id: string } | { why: string; busy: boolean }>;
  release: (c: string, id: string) => Promise<void>;
  afterClaim?: (c: string, id: string) => Promise<void>;
  done?: (c: string, id: string, released: boolean) => Promise<void>;
  owned?: (c: string, id: string) => Promise<boolean>;
  waitMs: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log: (line: string) => void;
}): (c: string) => Promise<Hold | { why: string }> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const poll = o.pollMs ?? 10_000;
  return async (c) => {
    const end = now() + o.waitMs;
    let waited = false;
    for (;;) {
      const r = await o.claim(c);
      if ("id" in r) {
        const id = r.id;
        const done = (released: boolean) =>
          o.done?.(c, id, released) ?? Promise.resolve();
        try {
          await o.afterClaim?.(c, id);
        } catch (err) {
          // Nothing touched the container yet: the claim goes at once.
          await o.release(c, id);
          await done(true);
          return {
            why: `hold setup failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          };
        }
        const owned = o.owned;
        return {
          ...(owned ? { owned: () => owned(c, id) } : {}),
          lost: () => done(false),
          release: async (clean) => {
            if (!clean) {
              o.log(
                `[WARN] ${c}: in-use record ${id} kept (a gate on it ended infra, its final cleanup failed or it threw); it refuses ${c} in every harness run. harness recover clears it once this run is gone (heartbeat 120 s stale) only with this hold's --lineage before-capture and an identical post-reset capture; otherwise recreate ${c}`,
              );
              await done(false);
              return;
            }
            await o.release(c, id);
            await done(true);
          },
        };
      }
      if (!r.busy || now() >= end) {
        return {
          why: waited
            ? `${r.why} (waited ${Math.round(o.waitMs / 60_000)} min)`
            : r.why,
        };
      }
      if (!waited) {
        o.log(
          `[WAIT] ${c}: ${r.why}; waiting up to ${
            Math.round(o.waitMs / 60_000)
          } min for it to be released`,
        );
      }
      waited = true;
      await sleep(poll);
    }
  };
}

export async function runGatePool(o: {
  containers: string[];
  tasks: string[];
  /** One task's gate on one container (gate-task.ts runGate); 3 = infra. */
  gate: (container: string, task: string) => Promise<GateOutcome>;
  /** Why a container may not join (not running, leased by another), or null. */
  admit: (container: string) => Promise<string | null>;
  /** H-74: hold an admitted container for this run (recordHolds), or why not. */
  hold?: (container: string) => Promise<Hold | { why: string }>;
  log: (line: string) => void;
}): Promise<{ code: number; jobs: GateJob[] }> {
  const holds = new Map<string, Hold>();
  const admitted: string[] = [];
  const hold = o.hold;
  const listed = await admittedPool(o.containers, o.admit, o.log);
  if (!hold) admitted.push(...listed);
  else {
    // A hold that throws (an unwritable record dir) refuses that container only.
    const got = await Promise.all(
      listed.map((c) =>
        hold(c).catch((err) => ({
          why: `in-use record: ${
            err instanceof Error ? err.message : String(err)
          }`,
        }))
      ),
    );
    for (const [k, c] of listed.entries()) {
      const h = got[k]!;
      if ("why" in h) {
        o.log(`[WARN] ${c} skipped: ${h.why}`);
        continue;
      }
      // Sol r1: the lease may have changed hands while the hold waited;
      // nothing touched the container yet, so a refused one is released.
      let again: string | null;
      try {
        again = await o.admit(c);
      } catch (err) {
        again = err instanceof Error ? err.message : String(err);
      }
      if (again !== null) {
        o.log(`[WARN] ${c} skipped: ${again} (rechecked once held)`);
        await h.release(true).catch((err) =>
          o.log(
            `[WARN] ${c}: in-use record not released (it refuses ${c}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          )
        );
        continue;
      }
      holds.set(c, h);
      admitted.push(c);
    }
  }
  const tasks = [...new Set(o.tasks)];
  for (const t of tasks) {
    if (o.tasks.filter((x) => x === t).length > 1) {
      o.log(`[WARN] ${t} listed twice; gated once`);
    }
  }
  const queue = tasks.map((task) => ({ task, retried: false }));
  const jobs: GateJob[] = [];
  let inFlight = 0;
  let wake: () => void = () => {};
  let changed = new Promise<void>((r) => (wake = r));
  const notify = () => {
    wake();
    changed = new Promise<void>((r) => (wake = r));
  };
  let live = admitted.length;

  /**
   * H-76: the record still carries this run's token (a hold without the
   * check: true). An unreadable check counts as lost (fail closed).
   */
  const ours = async (container: string): Promise<boolean> => {
    const h = holds.get(container);
    if (!h?.owned) return true;
    try {
      return await h.owned();
    } catch {
      return false;
    }
  };
  const lost = async (container: string) => {
    o.log(
      `[FAIL] ${container}: its in-use record is no longer this run's (recovered or replaced); no further BC step on it, ${container} leaves the pool`,
    );
    await holds.get(container)?.lost?.().catch(() => {});
  };
  /**
   * `clean`: every gate on `container` ended with a clean final cleanup (its
   * hold is released); `dirty`: kept; `lost`: H-76, the record is no longer
   * this run's (nothing released, nothing more run).
   */
  const work = async (
    container: string,
  ): Promise<"clean" | "dirty" | "lost"> => {
    while (true) {
      const item = queue.shift();
      if (!item) {
        // A running job may still send its task back for another container.
        if (inFlight === 0) return "clean";
        await changed;
        continue;
      }
      // In flight from here: an idle worker waits for it instead of ending.
      inFlight++;
      if (!await ours(container)) {
        inFlight--;
        queue.unshift(item); // not run here: it goes to another container
        await lost(container);
        live--;
        notify();
        return "lost";
      }
      let out: GateOutcome;
      try {
        out = await o.gate(container, item.task);
      } catch (err) {
        o.log(
          `[INFRA] ${item.task} on ${container}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        // Thrown: what it did to the container is unknown (dirty).
        out = { code: INFRA, file: null, clean: false };
      }
      inFlight--;
      const clean = out.clean !== false;
      const job = {
        task: item.task,
        container,
        code: out.code,
        file: out.file,
      };
      if (out.code === INFRA) {
        o.log(
          `[INFRA] ${item.task} on ${container}; ${container} leaves the pool`,
        );
        live--;
        if (!item.retried && live > 0) {
          queue.push({ task: item.task, retried: true });
        } else {
          jobs.push(job);
        }
        notify();
        return clean ? "clean" : "dirty";
      }
      jobs.push(job);
      if (!clean) {
        // Sol r1: a failed final cleanup: no further job on it
        o.log(
          `[WARN] ${item.task} on ${container}: cleanup failed; ${container} leaves the pool`,
        );
        live--;
        notify();
        return "dirty";
      }
      notify();
    }
  };
  const worker = async (container: string) => {
    const end = await work(container);
    if (end === "lost") return;
    if (!await ours(container)) return await lost(container);
    try {
      await holds.get(container)?.release(end === "clean");
    } catch (err) {
      o.log(
        `[WARN] ${container}: in-use record not released (it refuses ${container}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  await Promise.all(admitted.map(worker));
  for (const item of queue) {
    o.log(`[INFRA] ${item.task}: no container left in the pool`);
    jobs.push({ task: item.task, container: null, code: INFRA, file: null });
  }
  return {
    code: jobs.reduce((worst, j) => Math.max(worst, j.code), 0),
    jobs,
  };
}
