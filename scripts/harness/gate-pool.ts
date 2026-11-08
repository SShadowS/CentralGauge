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
}

/**
 * H-74: holds through the in-use records (quarantine.ts claimExclusive),
 * the claim every harness environment honours. A busy container (another
 * run's in-use record, e.g. a campaign pool releasing a lent judge after its
 * hold) is polled every `pollMs` for up to `waitMs` (--wait-free); any other
 * refusal is final at once. A hold whose container saw an infra end keeps
 * its record (dirty unless proven clean): harness recover clears it.
 */
export function recordHolds(o: {
  claim: (
    c: string,
  ) => Promise<{ id: string } | { why: string; busy: boolean }>;
  release: (c: string, id: string) => Promise<void>;
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
        return {
          release: async (clean) => {
            if (!clean) {
              o.log(
                `[WARN] ${c}: in-use record ${id} kept (a gate on it ended infra); it refuses ${c} until harness recover`,
              );
              return;
            }
            await o.release(c, id);
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
      if ("why" in h) o.log(`[WARN] ${c} skipped: ${h.why}`);
      else {
        holds.set(c, h);
        admitted.push(c);
      }
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

  /** True when no job on `container` ended infra (its hold is released clean). */
  const work = async (container: string): Promise<boolean> => {
    while (true) {
      const item = queue.shift();
      if (!item) {
        // A running job may still send its task back for another container.
        if (inFlight === 0) return true;
        await changed;
        continue;
      }
      inFlight++;
      let out: GateOutcome;
      try {
        out = await o.gate(container, item.task);
      } catch (err) {
        o.log(
          `[INFRA] ${item.task} on ${container}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        out = { code: INFRA, file: null };
      }
      inFlight--;
      if (out.code === INFRA) {
        o.log(
          `[INFRA] ${item.task} on ${container}; ${container} leaves the pool`,
        );
        live--;
        if (!item.retried && live > 0) {
          queue.push({ task: item.task, retried: true });
        } else {
          jobs.push({ task: item.task, container, ...out });
        }
        notify();
        return false;
      }
      jobs.push({ task: item.task, container, ...out });
      notify();
    }
  };
  const worker = async (container: string) => {
    const clean = await work(container);
    try {
      await holds.get(container)?.release(clean);
    } catch (err) {
      o.log(
        `[WARN] ${container}: in-use record not released (it refuses ${container} until harness recover): ${
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
