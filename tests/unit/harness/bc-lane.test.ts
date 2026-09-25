import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { basename, join } from "@std/path";
import { ContainerError, ValidationError } from "../../../src/errors.ts";
import {
  BENCH_CANDIDATE_APP_ID,
  loadLedger,
} from "../../../src/harness/bc-apps.ts";
import {
  BcLane,
  buildApps,
  classifyTestFailure,
  deploy,
  deployAndTest,
  type LockedSymbols,
  prepareApps,
  runTests,
  scorerPassed,
} from "../../../src/harness/bc-lane.ts";
import { hashFile } from "../../../src/harness/hash.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import { type FakeApp, FakeBc, result } from "./fake-bc.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";

const tmp = async () => await Deno.realPath(await Deno.makeTempDir());

async function workspace(): Promise<string> {
  const ws = await tmp();
  await write(
    ws,
    "Core/app.json",
    appJson(IDS.core, "CGR Core", [70000, 70099], []),
  );
  await write(ws, "Core/src/C.al", `codeunit 70000 "CGR Core"\n{\n}\n`);
  await write(
    ws,
    "Rental/app.json",
    appJson(IDS.rental, "CGR Rental", [70200, 70299], [{
      id: IDS.core,
      name: "CGR Core",
    }]),
  );
  await write(ws, "Rental/src/R.al", `codeunit 70200 "CGR Rental"\n{\n}\n`);
  await write(
    ws,
    "Test/app.json",
    appJson(IDS.test, "CGR Test", [80000, 84999], [
      { id: IDS.core, name: "CGR Core" },
      { id: IDS.rental, name: "CGR Rental" },
      { id: IDS.assert, name: "Library Assert" },
    ]),
  );
  await write(
    ws,
    "Test/src/T.al",
    `codeunit 80010 "T"\n{\n    Subtype = Test;\n}\n`,
  );
  return ws;
}

async function lock(): Promise<LockedSymbols> {
  const store = await tmp();
  const file = "Microsoft_Library Assert_28.0.0.0.app";
  await Deno.writeTextFile(join(store, "staging.app"), "assert-symbols");
  const sha256 = await hashFile(store, join(store, "staging.app"));
  await Deno.rename(join(store, "staging.app"), join(store, `${sha256}.app`));
  return {
    store,
    packages: [{
      app_id: IDS.assert,
      name: "Library Assert",
      publisher: "Microsoft",
      version: "28.0.0.0",
      file,
      sha256,
    }],
  };
}

const readApp = async (f: string) =>
  JSON.parse(await Deno.readTextFile(f)) as FakeApp;

/** Prepared apps plus the pristine workspace, the trusted root of deploy's allowlist. */
async function prep(_bc: FakeBc, lane: BcLane, changed: string[] = []) {
  const pristine = await workspace();
  const prepared = await prepareApps(lane, {
    pristine,
    pristineApps: await readAppGraph(pristine),
    candidateDir: pristine,
    candidateApps: await readAppGraph(pristine),
    changed,
    workDir: await tmp(),
    lock: await lock(),
  });
  return Object.assign(prepared, { pristine });
}

Deno.test("buildApps: dependency order, versions, workspace and locked symbols", async () => {
  const ws = await workspace();
  const bc = new FakeBc();
  const built = await buildApps(bc, "C1", {
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map([["Core", "1.0.7.7"]]),
    outDir: await tmp(),
    lock: await lock(),
  });
  assertEquals(bc.compiles, ["Core", "Rental", "Test"]);
  assert(built.every((b) => b.ok && b.attempted));
  assertEquals((await readApp(built[0]!.file!)).version, "1.0.7.7");
  assertEquals(
    bc.compileSeen.get("Test"),
    [
      basename(built[0]!.file!),
      basename(built[1]!.file!),
      "Microsoft_Library Assert_28.0.0.0.app",
    ].sort(),
  );
});

Deno.test("buildApps: an unlocked package after compile is refused", async () => {
  const ws = await workspace();
  const bc = new FakeBc();
  bc.onCompile = async (dir) => {
    await Deno.writeTextFile(
      join(dir, ".alpackages", "Microsoft_System Application_28.0.0.0.app"),
      "from compiler cache",
    );
  };
  await assertRejects(
    async () =>
      buildApps(bc, "C1", {
        srcDir: ws,
        apps: await readAppGraph(ws),
        versions: new Map(),
        outDir: await tmp(),
        lock: await lock(),
      }),
    ValidationError,
    "unlocked symbol package",
  );
});

Deno.test("buildApps: a failed dependency stops its dependents", async () => {
  const ws = await workspace();
  await write(ws, "Core/src/C.al", "COMPILE_ERROR");
  const bc = new FakeBc();
  const built = await buildApps(bc, "C1", {
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await tmp(),
    lock: await lock(),
  });
  assertEquals(bc.compiles, ["Core"]);
  assertStringIncludes(built[1]!.diagnostics[0]!.message, "Core did not build");
});

Deno.test("prepareApps: prerequisites bumped above the pristine version, candidates pristine, stamps carried", async () => {
  const bc = new FakeBc();
  const p = await prep(bc, new BcLane(bc, ["C1"]), ["Rental"]);
  const core = p.wanted.find((w) => w.id === IDS.core)!;
  assertEquals(core.role, "prereq");
  assert(Number(core.version.split(".")[2]) >= 1);
  assertEquals(p.wanted.find((w) => w.id === IDS.rental)!.version, "1.0.0.0");
  assertEquals(p.candidateIds, [IDS.rental, IDS.test]);
  assert(p.wanted.every((w) => /^[0-9a-f]{64}$/.test(w.stamp)));
});

Deno.test("deploy: prerequisites stay across calls through the ledger; provisioning is split from candidate publish", async () => {
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const p = await prep(bc, lane);
  const ctx = { ledgerRoot: await tmp(), trustedRoots: [p.pristine] };
  assertEquals((await deploy(bc, "C1", p.wanted, ctx)).published, 3);
  const second = await deploy(bc, "C1", p.wanted, ctx);
  assertEquals(second.published, 1);
  assert(!bc.syncs[1]!.removeIds.includes(IDS.core));
  assertEquals(second.candidate_publish_ms, 5);
  assert(second.provisioning_ms >= 0);
  assertEquals(Object.keys(await loadLedger(ctx.ledgerRoot, "C1")).length, 3);
});

Deno.test("deploy: prerequisite and unknown failures are infra; a model defect is returned", async () => {
  const bc = new FakeBc();
  const p = await prep(bc, new BcLane(bc, ["C1"]), ["Rental"]);
  const ctx = { ledgerRoot: await tmp(), trustedRoots: [p.pristine] };
  bc.publishFailure = (_c, n) => n === "CGR Core" ? "boom" : null;
  await assertRejects(
    () => deploy(bc, "C1", p.wanted, ctx),
    ContainerError,
    "prereq",
  );
  bc.publishFailure = (_c, n) =>
    n === "CGR Rental" ? "something unrecognized" : null;
  await assertRejects(
    () => deploy(bc, "C2", p.wanted, ctx),
    ContainerError,
    "candidate",
  );
  bc.publishFailure = (_c, n) =>
    n === "CGR Rental"
      ? "The schema synchronization failed: destructive changes"
      : null;
  assertEquals(
    (await deploy(bc, "C3", p.wanted, ctx)).candidateFailure!.id,
    IDS.rental,
  );
});

Deno.test("a collision on publish is infra and reroutes", async () => {
  const bc = new FakeBc((cu) =>
    cu === 80010 ? result({ Works: true }) : result({})
  );
  const lane = new BcLane(bc, ["Cronus281", "Cronus282"]);
  const p = await prep(bc, lane);
  bc.publishFailure = (c, n) =>
    c === "Cronus281" && n === "CGR Test"
      ? "Codeunit 80013 is already defined in 'Continia Core'"
      : null;
  const ctx = { ledgerRoot: await tmp(), trustedRoots: [p.pristine] };
  const held = await lane.exclusive(
    { taskId: "HX-001", variantId: "e1", attemptNumber: 1 },
    (c) =>
      deployAndTest(bc, c, {
        wanted: p.wanted,
        tests: [{
          codeunit: 80010,
          procedures: ["Works"],
          target: "candidate",
        }],
        cleanupIds: [IDS.test],
        ctx,
      }),
  );
  assertEquals([held.container, held.retries.length], ["Cronus282", 1]);
  assertEquals(held.result.rows.map((r) => r.outcome), ["pass"]);
});

Deno.test("classification matches the M4 gate", async () => {
  // The accepted M4-16 P5 texts, verbatim (decision accept-M4-16).
  const P5 = JSON.parse(
    await Deno.readTextFile("tests/fixtures/harness/p5-messages.json"),
  ) as Record<string, string>;
  const AREEQUAL = P5["assert_areequal"]!;
  const EXPECTEDERROR = P5["assert_expectederror"]!;
  const LOST_ASSERTERROR = P5["lost_asserterror"]!;
  const RUNTIME = P5["runtime_error"]!;
  assertEquals(classifyTestFailure(AREEQUAL), "assertion");
  assertEquals(classifyTestFailure(EXPECTEDERROR), "assertion");
  assertEquals(classifyTestFailure(LOST_ASSERTERROR), "assertion");
  assertEquals(classifyTestFailure(RUNTIME), "runtime_error");
  const bc = new FakeBc((cu) =>
    cu === 80010
      ? result({ A: true, B: LOST_ASSERTERROR, C: RUNTIME })
      : result({})
  );
  const r = await runTests(bc, "C1", [{
    codeunit: 80010,
    procedures: ["A", "b", "C", "Missing"],
    target: "candidate",
  }]);
  assertEquals(r.rows.map((x) => [x.procedure, x.outcome, x.failure]), [
    ["A", "pass", null],
    ["b", "fail", "assertion"],
    ["C", "fail", "runtime_error"],
    ["Missing", "not_run", "infra"],
  ]);
  assertEquals(
    scorerPassed(r.rows),
    null,
    "mixed assertion and infra is infra",
  );
  await assertRejects(
    () =>
      runTests(bc, "C1", [{
        codeunit: 80011,
        procedures: ["X"],
        target: "candidate",
      }]),
    ContainerError,
    "zero tests",
  );
  // No escape: zero results are infra for agent-authored suites too.
  await assertRejects(
    () =>
      runTests(bc, "C1", [{
        codeunit: 80011,
        procedures: null,
        target: "candidate",
      }]),
    ContainerError,
    "zero tests",
  );
});

Deno.test("deployAndTest: candidates are cleaned up even when tests throw", async () => {
  const bc = new FakeBc(() => {
    throw new ContainerError("soap down", "C1", "test");
  });
  const p = await prep(bc, new BcLane(bc, ["C1"]));
  const ledgerRoot = await tmp();
  await assertRejects(() =>
    deployAndTest(bc, "C1", {
      wanted: p.wanted,
      tests: [{
        codeunit: 80010,
        procedures: null,
        target: "candidate",
      }],
      cleanupIds: [IDS.test],
      ctx: { ledgerRoot, trustedRoots: [p.pristine] },
    })
  );
  assertEquals(bc.syncs.at(-1)!.removeIds, [IDS.test]);
});

Deno.test("deploy: the ledger drops touched ids before the sync; an interrupted sync leaves no stale claim", async () => {
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const p = await prep(bc, lane, ["Rental"]);
  const ctx = { ledgerRoot: await tmp(), trustedRoots: [p.pristine] };
  await deploy(bc, "C1", p.wanted, ctx);
  const before = await loadLedger(ctx.ledgerRoot, "C1");
  const seen: { ledger: Record<string, unknown> } = { ledger: {} };
  const sync = bc.syncHarnessApps.bind(bc);
  bc.syncHarnessApps = async (c) => {
    seen.ledger = await loadLedger(ctx.ledgerRoot, c);
    throw new ContainerError("pwsh session died", c, "publish");
  };
  const q = await prep(bc, lane, ["Core"]);
  await assertRejects(() => deploy(bc, "C1", q.wanted, ctx), ContainerError);
  assert(Object.keys(before).length > 0);
  for (const w of q.wanted) {
    assert(!(w.id in seen.ledger), `${w.name} still claimed during the sync`);
  }
  bc.syncHarnessApps = sync;
});

Deno.test("prepareApps: a changed compiler identity republishes every prerequisite", async () => {
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const first = await prep(bc, lane);
  const ctx = { ledgerRoot: await tmp(), trustedRoots: [first.pristine] };
  await deploy(bc, "C1", first.wanted, ctx);
  bc.compilerId = "other-artifact|bccontainerhelper 6.1.14";
  const again = await deploy(bc, "C1", (await prep(bc, lane)).wanted, ctx);
  assertEquals(again.published, 3);
});

Deno.test("deployAndTest: a failed cleanup empties the ledger, is returned, and the caller quarantines the container", async () => {
  const bc = new FakeBc((cu) =>
    cu === 80010 ? result({ Works: true }) : result({})
  );
  const lane = new BcLane(bc, ["C1", "C2"]);
  const p = await prep(bc, lane);
  const ctx = { ledgerRoot: await tmp(), trustedRoots: [p.pristine] };
  bc.cleanupFails.add("C1");
  const held = await lane.exclusive(
    { taskId: "t", variantId: "v", attemptNumber: 1 },
    (c) =>
      deployAndTest(bc, c, {
        wanted: p.wanted,
        tests: [{
          codeunit: 80010,
          procedures: ["Works"],
          target: "candidate",
        }],
        cleanupIds: [IDS.test],
        ctx,
      }),
  );
  assertEquals(held.container, "C1");
  assertStringIncludes(held.result.cleanupError!, "incomplete");
  assertEquals(await loadLedger(ctx.ledgerRoot, "C1"), {});
  assert(lane.quarantined.has("C1"), "quarantined inside the held region");
  assertEquals(
    (await lane.exclusive(
      { taskId: "t", variantId: "v", attemptNumber: 1 },
      (c) => Promise.resolve(c),
    )).container,
    "C2",
  );
  assertEquals(await lane.compile((c) => Promise.resolve(c)), "C2");
});

Deno.test("deployAndTest: tests throwing together with a cleanup failure quarantine the container before release", async () => {
  const bc = new FakeBc(() => {
    throw new ContainerError("soap down", "C1", "test");
  });
  const lane = new BcLane(bc, ["C1", "C2"], { maxInfraRetries: 0 });
  const p = await prep(bc, lane);
  bc.cleanupFails.add("C1");
  await assertRejects(() =>
    lane.exclusive(
      { taskId: "t", variantId: "v", attemptNumber: 1 },
      (c) =>
        deployAndTest(bc, c, {
          wanted: p.wanted,
          tests: [{
            codeunit: 80010,
            procedures: null,
            target: "candidate",
          }],
          cleanupIds: [IDS.test],
          ctx: {
            ledgerRoot: Deno.makeTempDirSync(),
            trustedRoots: [p.pristine],
          },
        }),
    )
  );
  assert(lane.quarantined.has("C1"));
});

Deno.test("BcLane: queued work is refused after its container is quarantined; a cancelled signal is never admitted", async () => {
  const lane = new BcLane(new FakeBc(), ["C1"], { compileSlots: 1 });
  let release!: () => void;
  let started!: () => void;
  const holding = new Promise<void>((r) => (started = r));
  // Wait until the first job really holds the slot (acquire resolves in a
  // later microtask); only then queue the second one and quarantine.
  const first = lane.compileOn(
    "C1",
    () =>
      new Promise<void>((r) => {
        release = r;
        started();
      }),
  );
  await holding;
  let ran = false;
  const queued = lane.compileOn("C1", () => Promise.resolve(void (ran = true)));
  lane.quarantine("C1", "cleanup failed");
  // Attach the expectation before the slot is released: the queued job
  // rejects in the next microtask, before a later await could observe it.
  const refused = assertRejects(() => queued, ContainerError, "ineligible");
  release();
  await first;
  await refused;
  assertEquals(ran, false);
  const l2 = new BcLane(new FakeBc(), ["C1"]);
  const stop = new AbortController();
  stop.abort(new Error("grant revoked"));
  let called = false;
  await assertRejects(() =>
    l2.exclusive(
      { taskId: "t", variantId: "v", attemptNumber: 1 },
      () => Promise.resolve(void (called = true)),
      stop.signal,
    )
  );
  await assertRejects(() =>
    l2.compile(() => Promise.resolve(void (called = true)), stop.signal)
  );
  assertEquals(called, false);
});

Deno.test("BcLane: outcomes are recorded into the health view; compileOn takes that container's slot", async () => {
  const recorded: { containerName: string; result: string }[] = [];
  const health = {
    getState: () => ({ containers: [] }),
    record: (o: { containerName: string; result: string }) => recorded.push(o),
  };
  const bc = new FakeBc();
  bc.broken.add("C1");
  const lane = new BcLane(bc, ["C1", "C2"], { health, compileSlots: 1 });
  const held = await lane.exclusive({
    taskId: "t",
    variantId: "v",
    attemptNumber: 1,
  }, async (c) => {
    await bc.listHarnessApps(c);
    return c;
  });
  assertEquals(held.container, "C2");
  assertEquals(recorded.map((r) => [r.containerName, r.result]), [[
    "C1",
    "infra_error",
  ], ["C2", "pass"]]);
  let inside = 0;
  let max = 0;
  await Promise.all([1, 2].map(() =>
    lane.compileOn("C2", async () => {
      max = Math.max(max, ++inside);
      await new Promise((r) => setTimeout(r, 10));
      inside--;
    })
  ));
  assertEquals(max, 1);
});

Deno.test("BcLane: one container serializes; queue time sums over retries; alerted containers are skipped", async () => {
  const lane = new BcLane(new FakeBc(), ["C1"]);
  const ctx = { taskId: "t", variantId: "v", attemptNumber: 1 };
  const order: string[] = [];
  const slow = lane.exclusive(ctx, async () => {
    order.push("a");
    await new Promise((r) => setTimeout(r, 30));
    order.push("a-end");
  });
  const fast = lane.exclusive(ctx, () => Promise.resolve(void order.push("b")));
  const [, b] = await Promise.all([slow, fast]);
  assertEquals(order, ["a", "a-end", "b"]);
  assert(b.queue_ms >= 20);
  const health = {
    getState: () => ({
      containers: [{ containerName: "C1", alert: { alertId: "alert-1" } }, {
        containerName: "C2",
      }],
    }),
    record: () => {},
  };
  const l2 = new BcLane(new FakeBc(), ["C1", "C2"], { health });
  assertEquals(
    (await l2.exclusive(ctx, (c) => Promise.resolve(c))).container,
    "C2",
  );
  assertEquals(await l2.compile((c) => Promise.resolve(c)), "C2");
});

Deno.test("BcLane: compiles are admitted at most compileSlots at a time per container", async () => {
  const ws = await workspace();
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"], { compileSlots: 1 });
  const lk = await lock();
  await Promise.all(
    [1, 2, 3].map(async () =>
      lane.compile(async (c) =>
        buildApps(bc, c, {
          srcDir: ws,
          apps: await readAppGraph(ws),
          versions: new Map(),
          outDir: await tmp(),
          lock: lk,
        })
      )
    ),
  );
  assertEquals(bc.maxConcurrentCompiles, 1);
});

Deno.test("deploy: removal ids come only from the trusted staging output; the bench candidate is never removed", async () => {
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const p = await prep(bc, lane);
  bc.state("C1").set(BENCH_CANDIDATE_APP_ID, {
    id: BENCH_CANDIDATE_APP_ID,
    name: "CentralGauge_CG-AL-E001_1",
    version: "1.0.0.0",
    folder: "bench",
    source: "",
  });
  await deploy(bc, "C1", p.wanted, {
    ledgerRoot: await tmp(),
    trustedRoots: [p.pristine],
  });
  assert(!bc.syncs[0]!.removeIds.includes(BENCH_CANDIDATE_APP_ID));
  assert(bc.state("C1").has(BENCH_CANDIDATE_APP_ID));
  // A root that is not the trusted staging output trusts nothing: every removal is refused.
  const empty = await tmp();
  await assertRejects(
    async () =>
      deploy(bc, "C1", p.wanted, {
        ledgerRoot: await tmp(),
        trustedRoots: [empty],
      }),
    Error,
    "not on the removal allowlist",
  );
});

Deno.test("buildApps: a dependency outside the workspace and the symbols lock is the app's build failure, not infra", async () => {
  const ws = await workspace();
  await write(
    ws,
    "Rental/app.json",
    appJson(IDS.rental, "CGR Rental", [70200, 70299], [
      { id: IDS.core, name: "CGR Core" },
      { id: "437dbf0e-84ff-417a-965d-ed2bb9650972", name: "Base Application" },
    ]),
  );
  const bc = new FakeBc();
  const built = await buildApps(bc, "C1", {
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await tmp(),
    lock: await lock(),
  });
  assertEquals(bc.compiles, ["Core"]);
  const rental = built.find((b) => b.folder === "Rental")!;
  assertEquals([rental.ok, rental.attempted], [false, false]);
  assertStringIncludes(
    rental.diagnostics[0]!.message,
    "not in the symbols lock",
  );
});

Deno.test("BcLane.compile: a retry never lands on the container that just failed", async () => {
  const lane = new BcLane(new FakeBc(), ["A", "B"]);
  const job = async (c: string) => {
    await new Promise((r) => setTimeout(r, 5));
    if (c === "A") throw new ContainerError("A is broken", "A", "compile");
    return c;
  };
  assertEquals(await Promise.all([lane.compile(job), lane.compile(job)]), [
    "B",
    "B",
  ]);
});

Deno.test("BcLane.exclusive: a cancellation (even a timeout) is never infra: no reroute, nothing recorded", async () => {
  const recorded: string[] = [];
  const health = {
    getState: () => ({ containers: [] }),
    record: (o: { containerName: string; result: string }) =>
      recorded.push(`${o.containerName}:${o.result}`),
  };
  const lane = new BcLane(new FakeBc(), ["C1", "C2"], { health });
  const stop = new AbortController();
  const tried: string[] = [];
  const err = await assertRejects(() =>
    lane.exclusive({ taskId: "t", variantId: "v", attemptNumber: 1 }, (c) => {
      tried.push(c);
      stop.abort(
        new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        ),
      );
      return Promise.reject(stop.signal.reason);
    }, stop.signal)
  );
  assert(!(err instanceof ContainerError));
  assertEquals(tried.length, 1);
  assertEquals(recorded, []);
});

Deno.test("deployAndTest: a cleanup refused before any change is loud and quarantines nothing", async () => {
  const bc = new FakeBc((cu) =>
    cu === 80010 ? result({ Works: true }) : result({})
  );
  const lane = new BcLane(bc, ["C1", "C2"]);
  const p = await prep(bc, lane);
  const untrusted = "00000000-0000-4000-8000-00000000eeee";
  const err = await assertRejects(async () =>
    lane.exclusive(
      { taskId: "t", variantId: "v", attemptNumber: 1 },
      async (c) =>
        deployAndTest(bc, c, {
          wanted: p.wanted,
          tests: [{
            codeunit: 80010,
            procedures: ["Works"],
            target: "candidate",
          }],
          cleanupIds: [IDS.test, untrusted],
          ctx: { ledgerRoot: await tmp(), trustedRoots: [p.pristine] },
        }),
    )
  );
  assert(
    !(err instanceof ContainerError),
    "a refusal is a harness bug, not infra",
  );
  assertStringIncludes((err as Error).message, "not on the removal allowlist");
  assertEquals(lane.quarantined.size, 0);
});

Deno.test("BcLane.exclusive: queued work refused as ineligible is not recorded as a container fault", async () => {
  const recorded: string[] = [];
  const health = {
    getState: () => ({ containers: [] }),
    record: (o: { containerName: string; result: string }) =>
      recorded.push(`${o.containerName}:${o.result}`),
  };
  const lane = new BcLane(new FakeBc(), ["C1"], { health, maxInfraRetries: 0 });
  const ctx = { taskId: "t", variantId: "v", attemptNumber: 1 };
  let release!: () => void;
  let started!: () => void;
  const holding = new Promise<void>((r) => (started = r));
  const first = lane.exclusive(ctx, () =>
    new Promise<void>((r) => {
      release = r;
      started();
    }));
  await holding;
  const queued = lane.exclusive(ctx, () => Promise.resolve());
  lane.quarantine("C1", "cleanup failed");
  const refused = assertRejects(() => queued, ContainerError, "ineligible");
  release();
  await first;
  await refused;
  assertEquals(recorded, ["C1:pass"]);
});

Deno.test("runTests: a short response (totalTests above the rows returned) is infra, never a pass", async () => {
  const bc = new FakeBc(() => ({ ...result({ A: true }), totalTests: 3 }));
  const r = await runTests(bc, "C1", [{
    codeunit: 80010,
    procedures: null,
    target: "candidate",
  }]);
  assert(r.rows.some((x) => x.failure === "infra"));
  assertEquals(scorerPassed(r.rows), null);
});

Deno.test("deploy and cleanup: an incomplete sync result is a failure, not a success", async () => {
  const incomplete = (
    s: import("../../../src/container/types.ts").HarnessSyncResult,
  ) => ({
    ...s,
    done: false,
    failed: null,
    removeIncomplete: ["x"],
  });
  // deploy
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const p = await prep(bc, lane);
  const ctx = { ledgerRoot: await tmp(), trustedRoots: [p.pristine] };
  const sync = bc.syncHarnessApps.bind(bc);
  bc.syncHarnessApps = async (c, plan) => incomplete(await sync(c, plan));
  await assertRejects(
    () => deploy(bc, "C1", p.wanted, ctx),
    ContainerError,
    "incomplete",
  );
  assertEquals(await loadLedger(ctx.ledgerRoot, "C1"), {});
  // cleanup: a complete deploy, then an incomplete cleanup quarantines and claims nothing
  const bc2 = new FakeBc((cu) =>
    cu === 80010 ? result({ Works: true }) : result({})
  );
  const lane2 = new BcLane(bc2, ["C1", "C2"]);
  const p2 = await prep(bc2, lane2);
  const ctx2 = { ledgerRoot: await tmp(), trustedRoots: [p2.pristine] };
  const sync2 = bc2.syncHarnessApps.bind(bc2);
  bc2.syncHarnessApps = async (c, plan) => {
    const r = await sync2(c, plan);
    return plan.publish.length === 0 ? incomplete(r) : r;
  };
  const held = await lane2.exclusive({
    taskId: "t",
    variantId: "v",
    attemptNumber: 1,
  }, (c) =>
    deployAndTest(bc2, c, {
      wanted: p2.wanted,
      tests: [{ codeunit: 80010, procedures: ["Works"], target: "candidate" }],
      cleanupIds: [IDS.test],
      ctx: ctx2,
    }));
  assertStringIncludes(held.result.cleanupError!, "incomplete");
  assert(lane2.quarantined.has(held.container));
  assertEquals(await loadLedger(ctx2.ledgerRoot, held.container), {});
});

Deno.test("BcLane: an abort while fn is pending yields LaneCancelledError, no success, no pass recorded", async () => {
  const recorded: string[] = [];
  const health = {
    getState: () => ({ containers: [] }),
    record: (o: { containerName: string; result: string }) =>
      recorded.push(`${o.containerName}:${o.result}`),
  };
  const lane = new BcLane(new FakeBc(), ["C1"], { health });
  const pending = (stop: AbortController) => (c: string) =>
    new Promise<string>((r) =>
      setTimeout(() => {
        stop.abort(new Error("grant revoked"));
        r(c);
      }, 5)
    );
  for (
    const run of [
      (s: AbortController) => lane.compile(pending(s), s.signal),
      (s: AbortController) => lane.compileOn("C1", pending(s), s.signal),
      (s: AbortController) =>
        lane.exclusive(
          { taskId: "t", variantId: "v", attemptNumber: 1 },
          pending(s),
          s.signal,
        ),
    ]
  ) {
    const stop = new AbortController();
    const err = await assertRejects(() => run(stop));
    assertEquals((err as Error).name, "LaneCancelledError");
  }
  assertEquals(recorded, []);
});

Deno.test("BcLane.exclusive: ties among idle healthy containers rotate", async () => {
  const lane = new BcLane(new FakeBc(), ["C1", "C2", "C3"]);
  const ctx = { taskId: "t", variantId: "v", attemptNumber: 1 };
  const used: string[] = [];
  for (let i = 0; i < 6; i++) {
    used.push((await lane.exclusive(ctx, (c) => Promise.resolve(c))).container);
  }
  assertEquals(used, ["C1", "C2", "C3", "C1", "C2", "C3"]);
});

Deno.test("buildApps: BCH's cache_AppInfo.json index is not a symbol package; an unlocked .APP still is", async () => {
  const ws = await workspace();
  const bc = new FakeBc();
  bc.onCompile = async (dir) => {
    await Deno.writeTextFile(
      join(dir, ".alpackages", "cache_AppInfo.json"),
      "[]",
    );
  };
  const built = await buildApps(bc, "C1", {
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await tmp(),
    lock: await lock(),
  });
  assert(built.every((b) => b.ok));
  bc.onCompile = async (dir) => {
    await Deno.writeTextFile(
      join(dir, ".alpackages", "Microsoft_System Application_28.0.0.0.APP"),
      "cache",
    );
  };
  await assertRejects(
    async () =>
      buildApps(bc, "C1", {
        srcDir: ws,
        apps: await readAppGraph(ws),
        versions: new Map(),
        outDir: await tmp(),
        lock: await lock(),
      }),
    ValidationError,
    "unlocked symbol package",
  );
});

Deno.test("runTests: result procedures that were not requested are surfaced as unexpected, never passed", async () => {
  const bc = new FakeBc(() =>
    result({ A: true, Extra: true, Other: "Assert.AreEqual failed." })
  );
  const r = await runTests(bc, "C1", [{
    codeunit: 80010,
    procedures: ["A"],
    target: "candidate",
  }]);
  assertEquals(r.rows.map((x) => [x.procedure, x.outcome]), [["A", "pass"]]);
  assertEquals(r.unexpected, [
    { codeunit: 80010, procedure: "Extra", target: "candidate" },
    { codeunit: 80010, procedure: "Other", target: "candidate" },
  ]);
  const all = await runTests(bc, "C1", [{
    codeunit: 80010,
    procedures: null,
    target: "candidate",
  }]);
  assertEquals(all.unexpected, []);
});

Deno.test("BcLane.compileOn: an infra fault moves to another allocated container; other failures do not", async () => {
  const lane = new BcLane(new FakeBc(), ["C1", "C2", "C3"]);
  const tried: string[] = [];
  const got = await lane.compileOn("C2", (c) => {
    tried.push(c);
    if (c === "C2") {
      return Promise.reject(
        new ContainerError("compiler folder gone", c, "compile"),
      );
    }
    return Promise.resolve(c);
  });
  assertEquals([got, tried[0]], [tried[1], "C2"]);
  assert(got !== "C2");
  const notInfra: string[] = [];
  await assertRejects(
    () =>
      lane.compileOn("C1", (c) => {
        notInfra.push(c);
        return Promise.reject(
          new ValidationError("unlocked symbol package", []),
        );
      }),
    ValidationError,
  );
  assertEquals(notInfra, ["C1"]);
  const all: string[] = [];
  await assertRejects(
    () =>
      lane.compileOn("C1", (c) => {
        all.push(c);
        return Promise.reject(new ContainerError("down", c, "compile"));
      }),
    ContainerError,
  );
  assertEquals(
    all.sort(),
    ["C1", "C2", "C3"],
    "bounded: each allocated container once",
  );
});

Deno.test("deploy: owned apps with kept tenant data at a higher version are cleaned before provisioning; foreign data is left alone", async () => {
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const p = await prep(bc, lane);
  // After a bench prenuke: our apps are gone, their data stays (Cronus281, M1-27).
  bc.keptData.set(
    "C1",
    new Map([["CGR Core", "1.0.60000.1"], ["Continia Core", "9.0.0.0"]]),
  );
  const ctx = { ledgerRoot: await tmp(), trustedRoots: [p.pristine] };
  const d = await deploy(bc, "C1", p.wanted, ctx);
  assertEquals(d.published, 3);
  assertEquals(bc.cleaned.at(-1), ["CGR Core"]);
  assertEquals(
    [...bc.keptData.get("C1")!.keys()],
    ["Continia Core"],
    "a foreign app's data is never touched",
  );
});
