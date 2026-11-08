import { assert, assertEquals } from "@std/assert";
import {
  admitContainer,
  type GateOutcome,
  runGatePool,
} from "../../../scripts/harness/gate-pool.ts";

const POOL = ["Cronus281", "Cronus282", "Cronus283"];
const TASKS = ["HX-101", "HX-102", "HX-103", "HX-104", "HX-105"];
const tick = () => new Promise((r) => setTimeout(r, 5));

/** A fake gate: per-task codes, tracks concurrency per container and overall. */
function fakeGate(
  code: (container: string, task: string, n: number) => number,
) {
  const busy = new Set<string>();
  const calls: string[] = [];
  let live = 0, peak = 0;
  const gate = async (
    container: string,
    task: string,
  ): Promise<GateOutcome> => {
    assert(!busy.has(container), `two jobs at once on ${container}`);
    busy.add(container);
    live++;
    peak = Math.max(peak, live);
    calls.push(`${task}@${container}`);
    await tick();
    busy.delete(container);
    live--;
    const n = calls.filter((c) => c.startsWith(`${task}@`)).length;
    return { code: code(container, task, n), file: `${task}-${n}.json` };
  };
  return { gate, calls, peak: () => peak };
}

const admitAll = () => Promise.resolve(null);
const quiet = (lines: string[]) => (l: string) => lines.push(l);

Deno.test("H-70 gates: one job per container, the three in parallel, every task once, worst exit code", async () => {
  const f = fakeGate((_c, t) => (t === "HX-103" ? 1 : 0));
  const r = await runGatePool({
    containers: POOL,
    tasks: TASKS,
    gate: f.gate,
    admit: admitAll,
    log: () => {},
  });
  assertEquals(r.code, 1);
  assertEquals(f.calls.length, 5);
  assertEquals(f.peak(), 3);
  assertEquals(
    r.jobs.map((j) => [j.task, j.code]).sort(),
    TASKS.map((t) => [t, t === "HX-103" ? 1 : 0]).sort(),
  );
});

Deno.test("H-70 gates: results equal a serial run on one container", async () => {
  const code = (_c: string, t: string) => Number(t.slice(-1)) % 2;
  const par = await runGatePool({
    containers: POOL,
    tasks: TASKS,
    gate: fakeGate(code).gate,
    admit: admitAll,
    log: () => {},
  });
  const ser = await runGatePool({
    containers: ["Cronus281"],
    tasks: TASKS,
    gate: fakeGate(code).gate,
    admit: admitAll,
    log: () => {},
  });
  const view = (j: typeof par.jobs) =>
    j.map((x) => `${x.task}:${x.code}:${x.file}`).sort();
  assertEquals(view(par.jobs), view(ser.jobs));
  assertEquals(par.code, ser.code);
});

Deno.test("H-70 gates: exit 3 retries the task once on another container and that container leaves the pool", async () => {
  const f = fakeGate((c) => (c === "Cronus282" ? 3 : 0));
  const lines: string[] = [];
  const r = await runGatePool({
    containers: POOL,
    tasks: TASKS,
    gate: f.gate,
    admit: admitAll,
    log: quiet(lines),
  });
  assertEquals(r.code, 0);
  // 282 ran exactly one job, then left; its task reran elsewhere.
  const on282 = f.calls.filter((c) => c.endsWith("@Cronus282"));
  assertEquals(on282.length, 1);
  const failed = on282[0]!.split("@")[0]!;
  const reruns = f.calls.filter((c) => c.startsWith(`${failed}@`));
  assertEquals(reruns.length, 2);
  assert(!reruns[1]!.endsWith("@Cronus282"));
  assertEquals(r.jobs.length, 5);
  assert(r.jobs.every((j) => j.code === 0));
  assert(
    lines.some((l) => l.includes("Cronus282 leaves the pool")),
    lines.join("\n"),
  );
});

Deno.test("H-70 gates: a task that is infra on its retry too ends as 3", async () => {
  const f = fakeGate((_c, t) => (t === "HX-101" ? 3 : 0));
  const r = await runGatePool({
    containers: POOL,
    tasks: TASKS,
    gate: f.gate,
    admit: admitAll,
    log: () => {},
  });
  assertEquals(r.code, 3);
  assertEquals(f.calls.filter((c) => c.startsWith("HX-101@")).length, 2);
  assertEquals(r.jobs.find((j) => j.task === "HX-101")!.code, 3);
  assertEquals(r.jobs.filter((j) => j.code === 0).length, 4);
});

Deno.test("H-70 gates: a container that is not admitted (stopped, leased by another) is skipped with a WARN; the pool runs on the rest", async () => {
  const f = fakeGate(() => 0);
  const lines: string[] = [];
  const r = await runGatePool({
    containers: POOL,
    tasks: TASKS,
    gate: f.gate,
    admit: (c) => Promise.resolve(c === "Cronus283" ? "not running" : null),
    log: quiet(lines),
  });
  assertEquals(r.code, 0);
  assert(!f.calls.some((c) => c.endsWith("@Cronus283")));
  assert(
    lines.includes("[WARN] Cronus283 skipped: not running"),
    lines.join("\n"),
  );
});

Deno.test("H-70 gates: when every container is gone, the tasks left end as 3 without hanging", async () => {
  const f = fakeGate(() => 3);
  const r = await runGatePool({
    containers: POOL,
    tasks: TASKS,
    gate: f.gate,
    admit: admitAll,
    log: () => {},
  });
  assertEquals(r.code, 3);
  assertEquals(r.jobs.length, 5);
  assert(r.jobs.every((j) => j.code === 3));
  // Three containers, one job each before leaving.
  assertEquals(f.calls.length, 3);

  const none = await runGatePool({
    containers: POOL,
    tasks: TASKS,
    gate: f.gate,
    admit: () => Promise.resolve("not running"),
    log: () => {},
  });
  assertEquals(none.code, 3);
  assert(none.jobs.every((j) => j.code === 3 && j.container === null));
});

Deno.test("H-70 admitContainer: allocated, not leased by another, running; never starts one", async () => {
  const d = {
    allocated: POOL,
    running: (c: string) => Promise.resolve(c !== "Cronus283"),
    leaseBlock: (c: string) =>
      c === "Cronus282" ? "coord: Cronus282 leased by lane-content" : null,
  };
  assertEquals(await admitContainer("Cronus281", d), null);
  assertEquals(
    await admitContainer("Cronus282", d),
    "coord: Cronus282 leased by lane-content",
  );
  assertEquals(await admitContainer("Cronus283", d), "not running");
  assertEquals(
    await admitContainer("Cronus28", d),
    `not allocated (allowed: ${POOL.join(", ")})`,
  );
});

Deno.test("H-70 gates: a gate that throws is infra for that container", async () => {
  let thrown = false;
  const r = await runGatePool({
    containers: POOL,
    tasks: ["HX-101"],
    gate: (c) => {
      if (!thrown) {
        thrown = true;
        return Promise.reject(new Error(`${c} broke`));
      }
      return Promise.resolve({ code: 0, file: "ok.json" });
    },
    admit: admitAll,
    log: () => {},
  });
  assertEquals(r.code, 0);
  assertEquals(r.jobs, [{
    task: "HX-101",
    container: r.jobs[0]!.container,
    code: 0,
    file: "ok.json",
  }]);
});
