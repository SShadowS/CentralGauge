// H-70: gates on a container pool (owner decision
// decisions/2026-11-08-m8-scale-up.md ruling 3; orchestrator answers to
// q-20261108T001616-96dab68a). One worker per admitted container takes the
// next task; each task's gate is unchanged, so its evidence equals a serial
// run's. Exit 3 (infra) sends the task back once for another container, and
// that container leaves the pool. Owner: lane-infra2.

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
 * Why `container` may not join the pool, or null: it must be allocated,
 * running (a stopped one is never started here) and free of a coord lease
 * held by another (lane-ops passes its own with --coord-lease).
 */
export async function admitContainer(
  container: string,
  d: {
    allocated: string[];
    running: (c: string) => Promise<boolean>;
    leaseBlock: (c: string) => string | null;
  },
): Promise<string | null> {
  if (!d.allocated.some((a) => a.toLowerCase() === container.toLowerCase())) {
    return `not allocated (allowed: ${d.allocated.join(", ")})`;
  }
  const lease = d.leaseBlock(container);
  if (lease !== null) return lease;
  return (await d.running(container)) ? null : "not running";
}

export async function runGatePool(o: {
  containers: string[];
  tasks: string[];
  /** One task's gate on one container (gate-task.ts runGate); 3 = infra. */
  gate: (container: string, task: string) => Promise<GateOutcome>;
  /** Why a container may not join (not running, leased by another), or null. */
  admit: (container: string) => Promise<string | null>;
  log: (line: string) => void;
}): Promise<{ code: number; jobs: GateJob[] }> {
  const admitted: string[] = [];
  for (const c of o.containers) {
    const why = await o.admit(c);
    if (why === null) admitted.push(c);
    else o.log(`[WARN] ${c} skipped: ${why}`);
  }
  const queue = o.tasks.map((task) => ({ task, retried: false }));
  const jobs: GateJob[] = [];
  let inFlight = 0;
  let wake: () => void = () => {};
  let changed = new Promise<void>((r) => (wake = r));
  const notify = () => {
    wake();
    changed = new Promise<void>((r) => (wake = r));
  };
  let live = admitted.length;

  const worker = async (container: string) => {
    while (true) {
      const item = queue.shift();
      if (!item) {
        // A running job may still send its task back for another container.
        if (inFlight === 0) return;
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
        return;
      }
      jobs.push({ task: item.task, container, ...out });
      notify();
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
