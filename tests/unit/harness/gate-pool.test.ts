import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  admitContainer,
  admittedPool,
  DEFAULT_POOL,
} from "../../../src/harness/allocation.ts";
import {
  type GateOutcome,
  INFRA,
  recordHolds,
  runGatePool,
  serialized,
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
  const clashes: string[] = [];
  let live = 0, peak = 0;
  const gate = async (
    container: string,
    task: string,
  ): Promise<GateOutcome> => {
    if (busy.has(container)) clashes.push(container);
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
  return { gate, calls, peak: () => peak, clashes };
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
  assertEquals(f.clashes, []);
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

Deno.test("H-70 admittedPool: keeps the admitted containers in order and warns for each skipped one", async () => {
  const lines: string[] = [];
  const pool = await admittedPool(
    [...DEFAULT_POOL],
    (c) => Promise.resolve(c === "Cronus282" ? "not running" : null),
    quiet(lines),
  );
  assertEquals(pool, ["Cronus281", "Cronus283"]);
  assertEquals(lines, ["[WARN] Cronus282 skipped: not running"]);
  assertEquals([...DEFAULT_POOL], POOL);
});

Deno.test("H-70 Sol r1: a container named twice (any case) gets one worker; its retry never lands on it again", async () => {
  const lines: string[] = [];
  assertEquals(
    await admittedPool(
      ["Cronus281", "cronus281", "Cronus282"],
      () => Promise.resolve(null),
      quiet(lines),
    ),
    ["Cronus281", "Cronus282"],
  );
  assertEquals(lines, ["[WARN] cronus281 skipped: listed twice"]);
  const f = fakeGate((c) => (c === "Cronus281" ? 3 : 0));
  const r = await runGatePool({
    containers: ["Cronus281", "Cronus281"],
    tasks: ["HX-101", "HX-102"],
    gate: f.gate,
    admit: admitAll,
    log: () => {},
  });
  assertEquals(f.calls.filter((c) => c.endsWith("@Cronus281")).length, 1);
  assertEquals(f.clashes, []);
  assertEquals(r.code, 3);
});

Deno.test("H-70 Sol r1 LOW: a task listed twice is gated once", async () => {
  const f = fakeGate(() => 0);
  const lines: string[] = [];
  const r = await runGatePool({
    containers: POOL,
    tasks: ["HX-101", "HX-101", "HX-102"],
    gate: f.gate,
    admit: admitAll,
    log: quiet(lines),
  });
  assertEquals(f.calls.length, 2);
  assertEquals(r.jobs.map((j) => j.task).sort(), ["HX-101", "HX-102"]);
  assert(
    lines.includes("[WARN] HX-101 listed twice; gated once"),
    lines.join("\n"),
  );
});

Deno.test("H-70 Sol r1: serialized() runs its calls one at a time, in order, and survives a rejection", async () => {
  let live = 0, peak = 0;
  const order: number[] = [];
  const one = serialized(async (n: number) => {
    live++;
    peak = Math.max(peak, live);
    await tick();
    order.push(n);
    live--;
    if (n === 2) throw new Error("boom");
    return n;
  });
  const r = await Promise.allSettled([one(1), one(2), one(3)]);
  assertEquals(peak, 1);
  assertEquals(order, [1, 2, 3]);
  assertEquals(r.map((x) => x.status), ["fulfilled", "rejected", "fulfilled"]);
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

// ---- H-74: in-use records (shared pool across processes) ----

/** A fake record store: container -> holder; `refuse` = records that refuse for good. */
function fakeRecords(refuse: Record<string, string> = {}) {
  const held = new Map<string, string>();
  const events: string[] = [];
  let n = 0;
  return {
    held,
    events,
    claim: (who: string) => (c: string) => {
      if (refuse[c]) {
        return Promise.resolve({ why: refuse[c]!, busy: false });
      }
      const h = held.get(c);
      if (h !== undefined) {
        return Promise.resolve({ why: `in use by ${h}`, busy: true });
      }
      held.set(c, who);
      events.push(`claim:${c}:${who}`);
      return Promise.resolve({ id: `id-${c}-${++n}` });
    },
    release: (c: string, id: string) => {
      held.delete(c);
      events.push(`release:${c}:${id}`);
      return Promise.resolve();
    },
  };
}

Deno.test("H-74 Sol r1 gates: a hold is released exactly when every gate on it cleaned up: an infra end with a clean cleanup releases, a failed cleanup keeps the record and takes the container out of the pool, a thrown gate keeps it", async () => {
  const recs = fakeRecords();
  const lines: string[] = [];
  const ran: string[] = [];
  const r = await runGatePool({
    containers: POOL,
    tasks: ["HX-101", "HX-102", "HX-103", "HX-104", "HX-105"],
    gate: async (c, t) => {
      ran.push(`${t}@${c}`);
      await tick();
      if (c === "Cronus281") return { code: INFRA, file: null, clean: true };
      if (c === "Cronus282") {
        return { code: 0, file: `${t}.json`, clean: false };
      }
      throw new Error("lost the session");
    },
    admit: admitAll,
    hold: recordHolds({
      claim: recs.claim("gates"),
      release: recs.release,
      waitMs: 0,
      log: quiet(lines),
    }),
    log: quiet(lines),
  });
  assertEquals(recs.held.has("Cronus281"), false, "infra, clean: released");
  assertEquals(recs.held.get("Cronus282"), "gates", "dirty: kept");
  assertEquals(recs.held.get("Cronus283"), "gates", "thrown: kept");
  for (const c of ["Cronus282", "Cronus283"]) {
    assertEquals(ran.filter((x) => x.endsWith(`@${c}`)).length, 1, c);
    assert(
      lines.some((l) =>
        l.includes(`${c}: in-use record`) && l.includes("kept") &&
        l.includes("recreate")
      ),
      lines.join("\n"),
    );
  }
  // the dirty gate's verdict stands; nothing left runs on a container
  const j = r.jobs.find((x) => x.container === "Cronus282")!;
  assertEquals([j.code, j.file], [0, `${j.task}.json`]);
  assertEquals(Object.keys(j).sort(), ["code", "container", "file", "task"]);
});

Deno.test("H-74 Sol r1 gates: admission is rechecked once a container is held; a lease taken meanwhile releases the hold untouched", async () => {
  const recs = fakeRecords();
  const lines: string[] = [];
  let leased = false;
  const r = await runGatePool({
    containers: ["Cronus281", "Cronus282"],
    tasks: ["HX-101"],
    gate: (c) => Promise.resolve({ code: 0, file: c }),
    admit: (c) =>
      Promise.resolve(
        c === "Cronus281" && leased ? "coord lease held by lane-x" : null,
      ),
    hold: (c) => {
      if (c === "Cronus281") leased = true; // taken while the hold waited
      return recordHolds({
        claim: recs.claim("gates"),
        release: recs.release,
        waitMs: 0,
        log: () => {},
      })(c);
    },
    log: quiet(lines),
  });
  assertEquals(r.jobs.map((j) => j.container), ["Cronus282"]);
  assertEquals(recs.held.size, 0);
  assert(
    recs.events.includes("release:Cronus281:id-Cronus281-1"),
    recs.events.join(","),
  );
  assert(
    lines.some((l) =>
      l.startsWith("[WARN] Cronus281 skipped: coord lease") &&
      l.includes("rechecked")
    ),
    lines.join("\n"),
  );
});

Deno.test("H-74 gates: a container whose record refuses it is skipped with a WARN; each admitted container is held before its first job and released after its last", async () => {
  const recs = fakeRecords({ Cronus283: "Cronus283 (quarantined (L4))" });
  const lines: string[] = [];
  const order: string[] = [];
  const hold = recordHolds({
    claim: recs.claim("gates"),
    release: recs.release,
    waitMs: 0,
    log: quiet(lines),
  });
  const r = await runGatePool({
    containers: POOL,
    tasks: ["HX-101", "HX-102", "HX-103"],
    gate: (c, t) => {
      order.push(`gate:${t}@${c}`);
      assert(recs.held.get(c) === "gates", `${t} ran on ${c} unheld`);
      return Promise.resolve({
        code: c === "Cronus282" ? INFRA : 0,
        file: `${t}.json`,
      });
    },
    admit: admitAll,
    hold,
    log: quiet(lines),
  });
  assert(
    lines.some((l) =>
      l.startsWith("[WARN] Cronus283 skipped: ") && l.includes("L4")
    ),
    lines.join("\n"),
  );
  assert(!order.some((o) => o.endsWith("@Cronus283")), "283 never ran");
  // both held containers cleaned up (282's infra end included): released
  assertEquals(recs.held.size, 0);
  assertEquals(r.jobs.filter((j) => j.code === 0).length, 3);
  assertEquals(
    recs.events.filter((e) => e.startsWith("release:")).map((e) =>
      e.split(":")[1]
    ).sort(),
    ["Cronus281", "Cronus282"],
  );
});

Deno.test("H-74 gates: two gates runs never share a container (the record is the cross-process claim)", async () => {
  const recs = fakeRecords();
  const busy = new Set<string>();
  const clashes: string[] = [];
  const run = (who: string, tasks: string[]) =>
    runGatePool({
      containers: POOL,
      tasks,
      gate: async (c) => {
        if (busy.has(c)) clashes.push(c);
        busy.add(c);
        await tick();
        busy.delete(c);
        return { code: 0, file: null };
      },
      admit: admitAll,
      hold: recordHolds({
        claim: recs.claim(who),
        release: recs.release,
        waitMs: 0,
        log: () => {},
      }),
      log: () => {},
    });
  const [a, b] = await Promise.all([
    run("A", ["HX-101", "HX-102"]),
    run("B", ["HX-103", "HX-104"]),
  ]);
  assertEquals(clashes, []);
  const used = (r: typeof a) => new Set(r.jobs.map((j) => j.container));
  for (const c of used(a)) assert(!used(b).has(c), `${c} in both`);
  assertEquals(recs.held.size, 0, "every record released");
});

Deno.test("H-74 recordHolds --wait-free: a busy container (another run's in-use record) is polled until free, then held; past the bound it is refused; a refusal for good never waits", async () => {
  const recs = fakeRecords({ Cronus283: "quarantined" });
  recs.held.set("Cronus281", "campaign");
  let t = 0;
  const slept: number[] = [];
  const lines: string[] = [];
  const hold = recordHolds({
    claim: recs.claim("gates"),
    release: recs.release,
    waitMs: 60_000,
    pollMs: 10_000,
    now: () => t,
    sleep: (ms) => {
      slept.push(ms);
      t += ms;
      // the campaign's pool releases 281 on the third poll
      if (slept.length === 3) recs.held.delete("Cronus281");
      return Promise.resolve();
    },
    log: quiet(lines),
  });
  const h = await hold("Cronus281");
  assert("release" in h, JSON.stringify(h));
  assertEquals(slept, [10_000, 10_000, 10_000]);
  assertEquals(
    lines.filter((l) => l.startsWith("[WAIT] Cronus281")).length,
    1,
    lines.join("\n"),
  );
  await h.release(true);
  assertEquals(recs.held.has("Cronus281"), false);
  // never freed: refused once the bound passes
  recs.held.set("Cronus282", "campaign");
  slept.length = 0;
  const late = await hold("Cronus282");
  assert("why" in late);
  assertStringIncludes(late.why, "in use by campaign");
  assertStringIncludes(late.why, "waited 1 min");
  assertEquals(slept.length, 6);
  // a quarantine: no wait at all
  slept.length = 0;
  const q = await hold("Cronus283");
  assert("why" in q);
  assertEquals([q.why, slept.length], ["quarantined", 0]);
});

Deno.test("H-74 recordHolds: --wait-free 0 refuses a busy container at once", async () => {
  const recs = fakeRecords();
  recs.held.set("Cronus281", "campaign");
  const hold = recordHolds({
    claim: recs.claim("gates"),
    release: recs.release,
    waitMs: 0,
    sleep: () => Promise.reject(new Error("never sleeps")),
    log: () => {},
  });
  const h = await hold("Cronus281");
  assert("why" in h);
  assertStringIncludes(h.why, "in use by campaign");
});

// ---- H-76: evidence, heartbeat and the token check ----

Deno.test("H-76 recordHolds: afterClaim runs once the record is ours; when it throws (no heartbeat) the untouched claim is released and the container refused; done reports released or kept", async () => {
  const recs = fakeRecords();
  const ends: string[] = [];
  const hold = recordHolds({
    claim: recs.claim("gates"),
    release: recs.release,
    waitMs: 0,
    afterClaim: (c, id) => {
      recs.events.push(`after:${c}:${id}`);
      return c === "Cronus283"
        ? Promise.reject(new Error("heartbeat not written"))
        : Promise.resolve();
    },
    done: (c, _id, released) => {
      ends.push(`${c}:${released}`);
      return Promise.resolve();
    },
    log: () => {},
  });
  const bad = await hold("Cronus283");
  assert("why" in bad);
  assertStringIncludes(bad.why, "heartbeat not written");
  assertEquals(recs.held.has("Cronus283"), false, "released untouched");
  const a = await hold("Cronus281"), b = await hold("Cronus282");
  assert("release" in a && "release" in b);
  assert(recs.events.includes("after:Cronus281:id-Cronus281-2"));
  await a.release(true);
  await b.release(false);
  assertEquals(ends, ["Cronus283:true", "Cronus281:true", "Cronus282:false"]);
  assertEquals(recs.held.get("Cronus282"), "gates");
});

Deno.test("H-76 gates: the record is rechecked before every job; once it is no longer this run's, no further job runs there, the task goes elsewhere and nothing is released", async () => {
  const recs = fakeRecords();
  const lines: string[] = [];
  const ran: string[] = [];
  const ends: string[] = [];
  const r = await runGatePool({
    containers: ["Cronus281", "Cronus282"],
    tasks: ["HX-101", "HX-102", "HX-103"],
    gate: async (c, t) => {
      ran.push(`${t}@${c}`);
      // recover takes 281 over after its first job
      if (c === "Cronus281") recs.held.set(c, "recover");
      await tick();
      return { code: 0, file: t };
    },
    admit: admitAll,
    hold: recordHolds({
      claim: recs.claim("gates"),
      release: recs.release,
      waitMs: 0,
      owned: (c) => Promise.resolve(recs.held.get(c) === "gates"),
      done: (c, _id, released) => {
        ends.push(`${c}:${released}`);
        return Promise.resolve();
      },
      log: quiet(lines),
    }),
    log: quiet(lines),
  });
  // the lost hold is stopped (heartbeat) without a release
  assertEquals(ends.sort(), ["Cronus281:false", "Cronus282:true"]);
  assertEquals(ran.filter((x) => x.endsWith("@Cronus281")).length, 1);
  assertEquals(r.jobs.map((j) => j.task).sort(), [
    "HX-101",
    "HX-102",
    "HX-103",
  ]);
  assert(r.jobs.every((j) => j.code === 0));
  assertEquals(recs.held.get("Cronus281"), "recover", "never released");
  assert(
    !recs.events.some((e) => e.startsWith("release:Cronus281")),
    recs.events.join(","),
  );
  assert(
    lines.some((l) =>
      l.startsWith("[FAIL] Cronus281") && l.includes("no longer this run's")
    ),
    lines.join("\n"),
  );
});
