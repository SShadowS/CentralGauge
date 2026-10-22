/**
 * H-41 (design-final 6, 9, 14): the `auto` judging pool and the gated judge
 * queue, in-process over fakes (no container, no Docker).
 */

import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { stub } from "@std/testing/mock";
import { ContainerError } from "../../../src/errors.ts";
import { PoolLostError } from "../../../src/harness/bc-lane.ts";
import { judgeQueue } from "../../../src/harness/campaign.ts";
import type { CellRef, HarnessEnv } from "../../../src/harness/execution.ts";
import type { ExecutionRecord } from "../../../src/harness/records.ts";
import { FakeBc } from "./fake-bc.ts";
import { FP, OTHER_FP, poolWorld, until } from "./pool-fixture.ts";

/** console.log and console.warn lines while `fn` runs. */
async function logged<T>(
  fn: () => Promise<T>,
): Promise<{ out: T; lines: string[] }> {
  const lines: string[] = [];
  const push = (...a: unknown[]) => void lines.push(a.join(" "));
  const l = stub(console, "log", push);
  const w = stub(console, "warn", push);
  try {
    return { out: await fn(), lines };
  } finally {
    l.restore();
    w.restore();
  }
}

const never = <T>() => new Promise<T>(() => {});

/** A promise resolved from outside. */
function gate<T = void>() {
  let open!: (v: T) => void;
  const p = new Promise<T>((r) => (open = r));
  return { p, open };
}

// ---- the pool ----

Deno.test("H-41 (6): the pool is inert until bound; then an allocated, eligible container joins: claim, setup, revalidation (pin), lane add, health register", async () => {
  const bc = new FakeBc();
  const { w, pool } = poolWorld(bc);
  await pool.refresh();
  assertEquals([pool.width(), w.events], [0, []]);
  await pool.bind("camp-1");
  assertEquals(pool.width(), 0, "binding joins nothing by itself");
  await logged(() => pool.refresh());
  assertEquals(w.events, ["claim:C1", "setup:C1", "pin", "register:C1"]);
  assertEquals(pool.lane.members(), ["C1"]);
  assertEquals([pool.width(), w.pin, w.registered], [1, FP, ["C1"]]);
  // A second refresh: C1 is a member already, nothing again.
  await pool.refresh();
  assertEquals(w.events.length, 4);
  await pool.close();
});

Deno.test("H-41 (6, Task 7): the precheck refuses a refused, agent, blocked, stopped, foreign-held, inadmissible or other-fp container before any claim; the env_fp refusal logs both fps; each refusal once", async () => {
  const bc = new FakeBc();
  const { w, pool } = poolWorld(bc, {
    alloc: ["Cronus28", "C1", "C2", "C3", "C4", "C5"],
  });
  w.running.add("C5");
  w.blocked.set("C1", "coord lease C1/001 held by lane-ops");
  w.running.delete("C2");
  w.foreign.set("C3", "C3 (in use by OTHER harness run)");
  w.inadmissible.set("C4", "no instance manifest");
  w.fp.set("C5", OTHER_FP);
  w.pin = FP;
  await pool.bind("camp-1");
  const { lines } = await logged(async () => {
    await pool.refresh();
    await pool.refresh();
  });
  assertEquals(w.events, [], "nothing claimed");
  assertEquals(pool.width(), 0);
  for (
    const [c, why] of [
      ["Cronus28", "refused"],
      ["C1", "coord lease C1/001"],
      ["C2", "not running"],
      ["C3", "in use by OTHER"],
      ["C4", "no instance manifest"],
    ] as [string, string][]
  ) {
    const hit = lines.filter((l) => l.includes(`${c} not admitted`));
    assertEquals(hit.length, 1, `${c}: ${lines.join("\n")}`);
    assertStringIncludes(hit[0]!, why);
  }
  const fp = lines.find((l) => l.includes("C5 not admitted"))!;
  assertStringIncludes(fp, OTHER_FP);
  assertStringIncludes(fp, FP);
  await pool.close();
});

Deno.test("H-41 (6, Task 7): an env_fp that changes between the precheck and the claim fails the revalidation: refused, the in-use record kept with [WARN], never added or registered, never retried", async () => {
  const bc = new FakeBc();
  const { w, pool } = poolWorld(bc);
  await pool.bind("camp-1");
  // The precheck saw FP; the container changes while it is being claimed.
  w.claimHook = () => w.fp.set("C1", OTHER_FP);
  const { lines } = await logged(async () => {
    await pool.refresh();
    await pool.refresh();
  });
  assertEquals(pool.lane.members(), []);
  assertEquals(w.registered, []);
  assertEquals(w.records.get("C1"), "id-C1", "the record stays");
  assert(!w.events.includes("release:C1"));
  assertEquals(w.events.filter((e) => e === "claim:C1").length, 1);
  assertStringIncludes(w.kept.get("C1")!, OTHER_FP);
  assert(
    lines.some((l) =>
      l.includes("[WARN]") && l.includes("C1") &&
      l.includes("kept")
    ),
    lines.join("\n"),
  );
  assertEquals(w.pin, null, "no pin from a refused join");
  await pool.close();
});

Deno.test("H-41 (6): join failures: a refused claim sets nothing up; a failing setup keeps the record; another provider or container id fails the revalidation; an epoch bump before setup releases, after setup disposes then releases", async () => {
  const bc = new FakeBc();
  // A refused claim (another holder's record appeared at claim time).
  {
    const { w, pool } = poolWorld(bc);
    w.records.set("C1", "theirs");
    await pool.bind("c");
    await logged(() => pool.refresh());
    assertEquals(w.events, ["claim:C1"]);
    assertEquals(pool.width(), 0);
    await pool.close();
  }
  // Setup throws: record kept.
  {
    const { w, pool } = poolWorld(bc);
    w.setup = () => Promise.reject(new Error("Container C1 is not running"));
    await pool.bind("c");
    await logged(() => pool.refresh());
    assertEquals([pool.width(), w.records.get("C1")], [0, "id-C1"]);
    assertStringIncludes(w.kept.get("C1")!, "not running");
    await pool.close();
  }
  // Setup returns another provider than the lane's: revalidation refuses.
  {
    const { w, pool } = poolWorld(bc);
    w.setup = () =>
      Promise.resolve({ bc: new FakeBc(), dispose: () => Promise.resolve() });
    await pool.bind("c");
    await logged(() => pool.refresh());
    assertEquals(pool.width(), 0);
    assertStringIncludes(w.kept.get("C1")!, "provider");
    await pool.close();
  }
  // The container id changed between claim and revalidation.
  {
    const { w, pool, deps } = poolWorld(bc);
    // The claim recorded id-C1; the container was recreated meanwhile.
    deps.containerId = () => Promise.resolve("id-new");
    await pool.bind("c");
    await logged(() => pool.refresh());
    assertEquals(pool.width(), 0);
    assertStringIncludes(w.kept.get("C1")!, "id");
    await pool.close();
  }
  // Epoch bumped while claiming: released before any setup.
  {
    const { w, pool } = poolWorld(bc);
    w.claimHook = () => pool.invalidate();
    await pool.bind("c");
    await logged(() => pool.refresh());
    assertEquals(w.events, ["claim:C1", "release:C1"]);
    assertEquals(w.kept.size, 0);
    await pool.close();
  }
  // Epoch bumped during setup: disposed, then released, never added.
  {
    const { w, pool } = poolWorld(bc);
    const setup = w.setup;
    w.setup = (c) => {
      pool.invalidate();
      return setup(c);
    };
    await pool.bind("c");
    await logged(() => pool.refresh());
    assertEquals(w.events, [
      "claim:C1",
      "setup:C1",
      "dispose:C1",
      "release:C1",
    ]);
    assertEquals(pool.width(), 0);
    await pool.close();
  }
});

Deno.test("H-41 (6): a drain marker on a member: retired at once, released (dispose, then the record) only once its held call ends; with the marker gone it rejoins by a full join", async () => {
  const bc = new FakeBc();
  const { w, pool } = poolWorld(bc);
  await pool.bind("c");
  await logged(() => pool.refresh());
  const held = gate();
  let entered = false;
  const call = pool.lane.compile(async () => {
    entered = true;
    await held.p;
  });
  await until(() => entered, 2_000, "the compile on C1");
  w.blocked.set("C1", "drain marker drain-C1");
  await logged(() => pool.refresh());
  assertEquals(pool.lane.members(), [], "retired");
  await new Promise((r) => setTimeout(r, 50));
  assert(!w.events.includes("release:C1"), "released while still in use");
  assertEquals(w.records.get("C1"), "id-C1");
  held.open();
  await call;
  await until(() => w.events.includes("release:C1"), 2_000, "the release");
  assertEquals(w.events.slice(-2), ["dispose:C1", "release:C1"]);
  assertEquals(w.records.has("C1"), false);
  // The marker removed: a full join again (claim, setup, pin, register).
  w.blocked.delete("C1");
  await logged(() => pool.refresh());
  assertEquals(pool.lane.members(), ["C1"]);
  assertEquals(w.events.filter((e) => e === "setup:C1").length, 2);
  await pool.close();
});

Deno.test("H-41 (6): a quarantined member keeps its record: never released, never rejoined; it no longer counts in the width", async () => {
  const bc = new FakeBc();
  const { w, pool } = poolWorld(bc);
  await pool.bind("c");
  await logged(() => pool.refresh());
  pool.lane.quarantined.set("C1", "cleanup failed");
  w.alloc = [];
  await logged(() => pool.refresh());
  await new Promise((r) => setTimeout(r, 30));
  assertEquals(pool.width(), 0);
  assert(!w.events.includes("release:C1"));
  w.alloc = ["C1"];
  await logged(() => pool.refresh());
  assertEquals(w.events.filter((e) => e === "claim:C1").length, 1);
  await pool.close();
});

Deno.test("H-41 (5, 14): reconcile answers each container from three checks, each bounded: not running, not allocated or blocked is departed; a failing or hung check is unanswered", async () => {
  const bc = new FakeBc();
  const { w, pool } = poolWorld(bc, {
    alloc: ["C1", "C2", "C3", "C4", "C5"],
    bounds: { stepMs: 100 },
  });
  w.running.delete("C2");
  w.alloc = ["C1", "C2", "C4", "C5", "C6"];
  w.blocked.set("C4", "drain marker drain-C4");
  w.isRunning = (c) =>
    c === "C5"
      ? Promise.reject(new Error("docker inspect failed"))
      : c === "C6"
      ? never()
      : Promise.resolve(w.running.has(c));
  const t0 = Date.now();
  const r = await pool.reconcile(["C1", "C2", "C3", "C4", "C5", "C6"]);
  assert(Date.now() - t0 < 1_000, "the hung check was not bounded");
  const says = (c: string) => JSON.stringify(r[c]);
  assertEquals(r["C1"], { state: "ok" });
  for (
    const [c, state, text] of [
      ["C2", "departed", "not running"],
      ["C3", "departed", "allocated"],
      ["C4", "departed", "drain-C4"],
      ["C5", "unanswered", "docker inspect"],
      ["C6", "unanswered", "timed out"],
    ]
  ) {
    assertEquals(r[c!]?.state, state, says(c!));
    assertStringIncludes(says(c!), text!);
  }
  await pool.close();
});

Deno.test("H-41 (6): refresh is single-flight: overlapping calls share one pass", async () => {
  const bc = new FakeBc();
  const { w, pool } = poolWorld(bc);
  let reads = 0;
  const g = gate<string[]>();
  w.allocated = () => (reads++, g.p);
  await pool.bind("c");
  const a = pool.refresh();
  const b = pool.refresh();
  assertEquals(reads, 1, "a second pass started");
  g.open(["C1"]);
  await logged(() => Promise.all([a, b]));
  assertEquals(pool.width(), 1);
  assertEquals(w.events.filter((e) => e === "claim:C1").length, 1);
  await pool.close();
});

Deno.test("H-41 (9, F7): a setup hung past the close bound keeps its record and claimed entry with [WARN]; close returns at its bound and a late completion adds no member", async () => {
  const bc = new FakeBc();
  const { w, pool } = poolWorld(bc, {
    bounds: { closeMs: 150, setupMs: 10_000 },
  });
  const hung = gate<{ bc: FakeBc; dispose(): Promise<void> }>();
  w.setup = () => hung.p;
  await pool.bind("c");
  const refreshing = pool.refresh();
  await until(() => w.events.includes("setup:C1"), 2_000, "the setup");
  const t0 = Date.now();
  const { lines } = await logged(() => pool.close());
  const took = Date.now() - t0;
  assert(took >= 140 && took < 1_000, `close took ${took} ms`);
  assertEquals(w.records.get("C1"), "id-C1");
  assertStringIncludes(w.kept.get("C1")!, "close");
  assert(
    lines.some((l) => l.includes("[WARN]") && l.includes("C1")),
    lines.join("\n"),
  );
  hung.open({ bc, dispose: () => Promise.resolve() });
  await refreshing;
  assertEquals(pool.lane.members(), []);
  assertEquals(w.registered, []);
  assert(!w.events.includes("release:C1"), "a kept record was released");
  // Closed: no refresh joins again.
  w.setup = () => Promise.resolve({ bc, dispose: () => Promise.resolve() });
  await pool.refresh();
  assertEquals(pool.width(), 0);
});

// ---- the gated judge queue (section 9) ----

const qEnv = {} as HarnessEnv;
const qCell = {} as CellRef;
const qExec = (id: string) => ({ id }) as ExecutionRecord;

Deno.test("H-41 (9): drain() waits for a pending pump: a job pushed onto an empty pool runs once a container joins on the poll; then drain resolves", async () => {
  const bc = new FakeBc();
  const { w, pool } = poolWorld(bc, { alloc: [], bounds: { pollMs: 20 } });
  await pool.bind("c");
  const ran: string[] = [];
  const q = judgeQueue(qEnv, pool, (_e, _c, e) => {
    ran.push(`${e.id}@${pool.lane.members().join(",")}`);
    return Promise.resolve();
  });
  q.push(qCell, qExec("e1"));
  let drained = false;
  const d = q.drain().then(() => (drained = true));
  await new Promise((r) => setTimeout(r, 80));
  assertFalse(drained, "drain resolved with the job still queued");
  w.alloc = ["C1"];
  await logged(() => d);
  assertEquals(ran, ["e1@C1"]);
  assertFalse(q.starved());
  await pool.close();
});

Deno.test("H-41 (9): starvation: no member for the wait bound marks the queue starved and stopped; drain resolves within the bound plus 1 s; a pending refresh never holds it", async () => {
  const bc = new FakeBc();
  const { pool } = poolWorld(bc, {
    alloc: [],
    bounds: { pollMs: 20, waitMs: 200 },
  });
  await pool.bind("c");
  let ran = 0;
  const q = judgeQueue(qEnv, pool, () => (ran++, Promise.resolve()));
  q.push(qCell, qExec("e1"));
  q.push(qCell, qExec("e2"));
  const t0 = Date.now();
  const { lines } = await logged(() => q.drain());
  const took = Date.now() - t0;
  assert(took >= 190 && took < 1_200, `drain took ${took} ms`);
  assert(q.starved());
  assertEquals(ran, 0);
  assert(lines.some((l) => l.includes("[STOP]") && l.includes("2 stay owed")));
  await pool.close();
});

Deno.test("H-41 (9, F7): a refresh hung past starvation, and separately a setup hung past it: drain returns within the deadline plus 1 s; the late completion adds no member", async () => {
  for (const hangAt of ["refresh", "setup"] as const) {
    const bc = new FakeBc();
    const { w, pool } = poolWorld(bc, {
      alloc: hangAt === "setup" ? ["C1"] : [],
      bounds: { pollMs: 20, waitMs: 200, stepMs: 10_000, setupMs: 10_000 },
    });
    const late = gate();
    if (hangAt === "refresh") {
      w.allocated = async () => (await late.p, ["C1"]);
    } else {
      const setup = w.setup;
      w.setup = async (c) => (await late.p, await setup(c));
    }
    await pool.bind("c");
    const q = judgeQueue(qEnv, pool, () => Promise.resolve());
    q.push(qCell, qExec("e1"));
    const t0 = Date.now();
    await logged(() => q.drain());
    const took = Date.now() - t0;
    assert(took < 1_200, `${hangAt}: drain took ${took} ms`);
    assert(q.starved(), hangAt);
    late.open();
    await logged(() => pool.refresh());
    await new Promise((r) => setTimeout(r, 30));
    assertEquals(pool.lane.members(), [], `${hangAt}: a late member`);
    if (hangAt === "setup") {
      // Its lease was tracked from the claim: disposed, then released.
      assertEquals(w.events.slice(-2), ["dispose:C1", "release:C1"]);
    }
    await pool.close();
  }
});

Deno.test("H-41 (9): close during a refresh: no join after close", async () => {
  const bc = new FakeBc();
  const { w, pool } = poolWorld(bc);
  const g = gate<string[]>();
  w.allocated = () => g.p;
  await pool.bind("c");
  const r = pool.refresh();
  const closing = pool.close();
  g.open(["C1"]);
  await r;
  await closing;
  assertEquals(w.events, []);
  assertEquals(pool.width(), 0);
});

Deno.test("H-41 (14): an unanswered-only pool loss requeues W at most 3 times; the 4th stops the queue ([STOP], W stays owed); a confirmed departure does not count", async () => {
  const bc = new FakeBc();
  const { pool } = poolWorld(bc, { bounds: { pollMs: 20 } });
  await pool.bind("c");
  await logged(() => pool.refresh());
  const unanswered = () =>
    new PoolLostError(
      new ContainerError("x", "C1", "test"),
      ["C1"],
      { C1: { state: "unanswered", check: "running", error: "hung" } },
      true,
    );
  const departed = () =>
    new PoolLostError(
      new ContainerError("x", "C1", "test"),
      ["C1"],
      { C1: { state: "departed", reason: "not running" } },
      false,
    );
  // Control: five departures, then it succeeds; never stopped.
  {
    let n = 0;
    const q = judgeQueue(
      qEnv,
      pool,
      () => ++n <= 5 ? Promise.reject(departed()) : Promise.resolve(),
    );
    q.push(qCell, qExec("e1"));
    await q.drain();
    assertEquals([n, q.starved()], [6, false]);
  }
  let n = 0;
  const q = judgeQueue(qEnv, pool, (_e, _c, e) => {
    if (e.id === "e1") n++;
    return e.id === "e1" ? Promise.reject(unanswered()) : Promise.resolve();
  });
  q.push(qCell, qExec("e1"));
  const { lines } = await logged(() => q.drain());
  assertEquals(n, 4, "W ran once and was requeued 3 times");
  assert(q.starved(), "the uncertainty stop is the starved exit");
  q.push(qCell, qExec("e2"));
  await q.drain();
  const stop = lines.filter((l) => l.includes("[STOP]"));
  assertEquals(stop.length, 1, lines.join("\n"));
  assertStringIncludes(stop[0]!, "e1: 4 unanswered container checks");
  assertStringIncludes(stop[0]!, "1 stay owed");
  await pool.close();
});
