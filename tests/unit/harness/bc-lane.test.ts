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
  saveLedger,
} from "../../../src/harness/bc-apps.ts";
import {
  ResetFailedError,
  type ResetMechanism,
  type ResetRecord,
  type VerifyRecord,
} from "../../../src/harness/reset.ts";
import {
  BcLane,
  buildApps,
  buildCacheReport,
  classifyTestFailure,
  CleanupFailedError,
  CLOUD_POLICY,
  DECLARED_POLICY,
  deploy,
  deployAndTest,
  dirBuildCache,
  type LockedSymbols,
  prepareApps,
  productionManifest,
  runTests,
  scorerPassed,
} from "../../../src/harness/bc-lane.ts";
import { hashFile } from "../../../src/harness/hash.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import { type FakeApp, FakeBc, result } from "./fake-bc.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";
import { testTempDir, trackTempDir } from "../../utils/temp-dir.ts";

const tmp = async () => await Deno.realPath(await testTempDir());

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
    versionPlan: "backend",
    policy: DECLARED_POLICY,
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
    policy: DECLARED_POLICY,
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
        policy: DECLARED_POLICY,
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
    policy: DECLARED_POLICY,
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
            ledgerRoot: trackTempDir(Deno.makeTempDirSync()),
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
    [1, 2, 3].map(() =>
      lane.compile(async (c) =>
        buildApps(bc, c, {
          policy: DECLARED_POLICY,
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
    policy: DECLARED_POLICY,
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
  const err = await assertRejects(() =>
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
    policy: DECLARED_POLICY,
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
        policy: DECLARED_POLICY,
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

/** A BCH stand-in: after each compile, the app info cache lists every package in .alpackages. */
function appInfoWriter(bc: FakeBc, seen: Map<string, string[] | null>) {
  bc.onCompile = async (dir) => {
    const pk = join(dir, ".alpackages");
    const file = join(pk, "cache_AppInfo.json");
    const before = await Deno.readTextFile(file).then(
      (t) => Object.keys(JSON.parse(t)).sort(),
      () => null,
    );
    seen.set(basename(dir), before);
    const cache: Record<string, unknown> = {};
    for await (const e of Deno.readDir(pk)) {
      if (e.name.endsWith(".app")) cache[`.\\${e.name}`] = { name: e.name };
    }
    await Deno.writeTextFile(file, JSON.stringify(cache));
  };
}

Deno.test("buildApps: the locked packages' app info cache is harvested once and seeded into later compiles, never a workspace app", async () => {
  const ws = await workspace();
  const lk = await lock();
  const bc = new FakeBc();
  const first = new Map<string, string[] | null>();
  appInfoWriter(bc, first);
  const o = async () => ({
    policy: DECLARED_POLICY,
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await tmp(),
    lock: lk,
  });
  await buildApps(bc, "C1", await o());
  assertEquals(
    first.get("Core"),
    null,
    "nothing harvested before the first compile",
  );
  const second = new Map<string, string[] | null>();
  appInfoWriter(bc, second);
  await buildApps(bc, "C1", await o());
  const locked = [".\\Microsoft_Library Assert_28.0.0.0.app"];
  assertEquals(second.get("Core"), locked);
  assertEquals(
    second.get("Test"),
    locked,
    "the workspace-built Core and Rental are never seeded",
  );
});

Deno.test("buildApps: a build cache reuses an unchanged app; a changed source rebuilds it and its dependents", async () => {
  const ws = await workspace();
  const lk = await lock();
  const cache = dirBuildCache(await tmp());
  const bc = new FakeBc();
  const o = async () => ({
    policy: DECLARED_POLICY,
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await tmp(),
    lock: lk,
    cache,
  });
  await buildApps(bc, "C1", await o());
  assertEquals(bc.compiles, ["Core", "Rental", "Test"]);
  const again = await buildApps(bc, "C1", await o());
  assertEquals(bc.compiles.length, 3, "an unchanged build is reused");
  assert(again.every((b) => b.ok && !b.attempted && b.file !== null));
  for (const b of again) await Deno.stat(b.file!);
  await write(
    ws,
    "Rental/src/R.al",
    `codeunit 70200 "CGR Rental"\n{\n    // changed\n}\n`,
  );
  await buildApps(bc, "C1", await o());
  assertEquals(bc.compiles.slice(3), ["Rental", "Test"]);
});

/** The lock plus a second package that the workspace's Core collides with. */
async function lockWith(
  extra: { app_id: string; file: string },
): Promise<LockedSymbols> {
  const lk = await lock();
  await Deno.writeTextFile(join(lk.store, "staging.app"), "microsoft-symbols");
  const sha256 = await hashFile(lk.store, join(lk.store, "staging.app"));
  await Deno.rename(
    join(lk.store, "staging.app"),
    join(lk.store, `${sha256}.app`),
  );
  lk.packages.push({
    ...extra,
    name: "Base Application",
    publisher: "Microsoft",
    version: "28.0.0.0",
    sha256,
  });
  return lk;
}

const BASE_ID = "437dbf0e-84ff-417a-965d-ed2bb9650972";

for (
  const file of [
    "CentralGauge_CGR Core_1.0.7.7.app",
    "centralgauge_cgr core_1.0.7.7.APP",
  ]
) {
  Deno.test(`buildApps: a workspace app whose output file is a locked package's (${file}) is the app's build failure; the locked package is never overwritten`, async () => {
    const ws = await workspace();
    const lk = await lockWith({ app_id: BASE_ID, file });
    const bc = new FakeBc();
    const outDir = await tmp();
    const built = await buildApps(bc, "C1", {
      policy: DECLARED_POLICY,
      srcDir: ws,
      apps: await readAppGraph(ws),
      versions: new Map([["Core", "1.0.7.7"]]),
      outDir,
      lock: lk,
    });
    assertEquals(bc.compiles, ["Core"], "no dependent compiles against it");
    const core = built.find((b) => b.folder === "Core")!;
    assertEquals([core.ok, core.attempted, core.file], [false, true, null]);
    const msg = core.diagnostics.map((d) => d.message).join("\n");
    assertStringIncludes(msg, "CentralGauge_CGR Core_1.0.7.7.app");
    assertStringIncludes(msg, file);
    assert(built.every((b) => !b.ok));
    const kept: string[] = [];
    for await (const e of Deno.readDir(join(outDir, ".apps"))) {
      kept.push(e.name);
    }
    assertEquals(kept, [], "the colliding build is not kept");
  });
}

Deno.test("buildApps: a workspace app whose id is a locked package's is the app's build failure, never compiled", async () => {
  const ws = await workspace();
  const lk = await lockWith({
    app_id: IDS.core.toUpperCase(),
    file: "Microsoft_Base Application_28.0.0.0.app",
  });
  const bc = new FakeBc();
  const built = await buildApps(bc, "C1", {
    policy: DECLARED_POLICY,
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await tmp(),
    lock: lk,
  });
  assertEquals(bc.compiles, []);
  const core = built.find((b) => b.folder === "Core")!;
  assertEquals([core.ok, core.attempted], [false, false]);
  assertStringIncludes(core.diagnostics[0]!.message, IDS.core);
  assertStringIncludes(
    core.diagnostics[0]!.message,
    "Microsoft_Base Application_28.0.0.0.app",
  );
});

Deno.test("buildApps: a reused build is refused on an id or file name collision, never reused past the check", async () => {
  const ws = await workspace();
  const stash = await tmp();
  const colliding = join(stash, "Microsoft_Base Application_28.0.0.0.app");
  await Deno.writeTextFile(colliding, "agent build");
  const cache = {
    get: () => Promise.resolve(colliding),
    put: () => Promise.resolve(),
  };
  const bc = new FakeBc();
  const byName = await buildApps(bc, "C1", {
    policy: DECLARED_POLICY,
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await tmp(),
    lock: await lockWith({
      app_id: BASE_ID,
      file: "microsoft_base application_28.0.0.0.app",
    }),
    cache,
  });
  const core = byName.find((b) => b.folder === "Core")!;
  assertEquals([core.ok, core.file], [false, null]);
  assertStringIncludes(
    core.diagnostics[0]!.message,
    "microsoft_base application_28.0.0.0.app",
  );
  assert(byName.every((b) => !b.ok));
  const byId = await buildApps(bc, "C1", {
    policy: DECLARED_POLICY,
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await tmp(),
    lock: await lockWith({ app_id: IDS.core, file: "Other.app" }),
    cache,
  });
  assertEquals(byId.find((b) => b.folder === "Core")!.ok, false);
  assertStringIncludes(byId[0]!.diagnostics[0]!.message, IDS.core);
  assertEquals(bc.compiles, []);
});

Deno.test("buildApps: a prebuilt workspace file named as a locked package is refused, never copied over it", async () => {
  const ws = await workspace();
  const stash = await tmp();
  const pre = join(stash, "Microsoft_Library Assert_28.0.0.0.app");
  await Deno.writeTextFile(pre, "agent build");
  const bc = new FakeBc();
  const apps = (await readAppGraph(ws)).filter((a) => a.folder === "Rental");
  await assertRejects(
    async () =>
      buildApps(bc, "C1", {
        policy: DECLARED_POLICY,
        srcDir: ws,
        apps,
        versions: new Map(),
        outDir: stash,
        lock: await lock(),
        prebuilt: new Map([["Core", pre]]),
      }),
    ValidationError,
    "Microsoft_Library Assert_28.0.0.0.app",
  );
  assertEquals(bc.compiles, []);
});

const ASSERT_FILE = "Microsoft_Library Assert_28.0.0.0.app";
const appInfoStore = async (lk: LockedSymbols) => {
  const dir = join(lk.store, "appinfo");
  const out: Record<string, unknown> = {};
  try {
    for await (const e of Deno.readDir(dir)) {
      Object.assign(
        out,
        JSON.parse(await Deno.readTextFile(join(dir, e.name))),
      );
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  return out;
};

Deno.test("buildApps: an agent-planted .ALPACKAGES app info cache (any case) is dropped and never harvested", async () => {
  const ws = await workspace();
  const lk = await lock();
  for (const folder of [".ALPACKAGES", ".alpackages"]) {
    await write(
      ws,
      `Core/${folder}/cache_AppInfo.json`,
      JSON.stringify({ [`.\\${ASSERT_FILE}`]: { name: "FORGED" } }),
    );
  }
  const bc = new FakeBc();
  const seen = new Map<string, string[] | null>();
  bc.onCompile = async (dir) => {
    seen.set(
      basename(dir),
      await Deno.readTextFile(join(dir, ".alpackages", "cache_AppInfo.json"))
        .then((t) => Object.keys(JSON.parse(t)), () => null),
    );
  };
  await buildApps(bc, "C1", {
    policy: DECLARED_POLICY,
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await tmp(),
    lock: lk,
  });
  assertEquals(seen.get("Core"), null, "no planted cache reaches the compile");
  assertEquals(await appInfoStore(lk), {}, "nothing forged is harvested");
});

Deno.test("buildApps: a harvest keeps only locked packages that hash-verified in this build", async () => {
  const ws = await workspace();
  const lk = await lock();
  const bc = new FakeBc();
  let n = 0;
  bc.onCompile = async (dir) => {
    const pk = join(dir, ".alpackages");
    const entries: Record<string, unknown> = {
      [`.\\${ASSERT_FILE}`]: { name: "assert" },
      ".\\Not_Locked_1.0.0.0.app": { name: "other" },
    };
    // First compile: the locked package is gone from the folder (not verified).
    if (++n === 1) await Deno.remove(join(pk, ASSERT_FILE));
    await Deno.writeTextFile(
      join(pk, "cache_AppInfo.json"),
      JSON.stringify(entries),
    );
  };
  const o = async () => ({
    policy: DECLARED_POLICY,
    srcDir: ws,
    apps: (await readAppGraph(ws)).filter((a) => a.folder === "Core"),
    versions: new Map(),
    outDir: await tmp(),
    lock: lk,
  });
  await buildApps(bc, "C1", await o());
  assertEquals(
    await appInfoStore(lk),
    {},
    "an unverified locked entry is not kept",
  );
  await buildApps(bc, "C1", await o());
  assertEquals(Object.keys(await appInfoStore(lk)), [`.\\${ASSERT_FILE}`]);
});

Deno.test("buildApps: the build cache key holds the compiler identity, not only the container name", async () => {
  const ws = await workspace();
  const lk = await lock();
  const cache = dirBuildCache(await tmp());
  const bc = new FakeBc();
  const o = async () => ({
    policy: DECLARED_POLICY,
    srcDir: ws,
    apps: (await readAppGraph(ws)).filter((a) => a.folder === "Core"),
    versions: new Map(),
    outDir: await tmp(),
    lock: lk,
    cache,
  });
  await buildApps(bc, "C1", await o());
  await buildApps(bc, "C1", await o());
  assertEquals(bc.compiles, ["Core"]);
  bc.compilerId = "fake-artifact-29|bccontainerhelper 6.1.14";
  await buildApps(bc, "C1", await o());
  assertEquals(
    bc.compiles,
    ["Core", "Core"],
    "another artifact or BCH version (an upgraded container) misses",
  );
});

// ---- H-27: one shared build cache (agent backend and judge) ----

const cached = async (
  bc: FakeBc,
  container: string,
  ws: string,
  lk: LockedSymbols,
  cache: ReturnType<typeof dirBuildCache>,
  extra: Partial<Parameters<typeof buildApps>[2]> = {},
) =>
  await buildApps(bc, container, {
    policy: DECLARED_POLICY,
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await tmp(),
    lock: lk,
    cache,
    ...extra,
  });

Deno.test("buildApps (H-27): with non-deterministic output, the whole chain is reused on another container and in another build, through the dependencies' cache keys", async () => {
  const ws = await workspace();
  const lk = await lock();
  const cache = dirBuildCache(await tmp());
  const bc = new FakeBc();
  bc.nondeterministic = true;
  const first = await cached(bc, "C1", ws, lk, cache);
  assertEquals(bc.compiles, ["Core", "Rental", "Test"]);
  // The container name is not in the key: the compiler identity is the artifact.
  const second = await cached(bc, "C2", ws, lk, cache);
  assertEquals(bc.compiles.length, 3, "nothing recompiled");
  assert(second.every((b) => b.ok && !b.attempted));
  // The dependents got the cached dependency files, so the chain is consistent.
  for (const f of ["Core", "Rental", "Test"]) {
    const a = first.find((b) => b.folder === f)!;
    const b = second.find((x) => x.folder === f)!;
    assertEquals(
      await Deno.readTextFile(b.file!),
      await Deno.readTextFile(a.file!),
    );
    assertEquals(a.key, b.key);
  }
});

Deno.test("buildApps (H-27): a prebuilt dependency is keyed by its cache key; one without a key (a fresh build) is keyed by its file, so dependents rebuild", async () => {
  const ws = await workspace();
  const lk = await lock();
  const cache = dirBuildCache(await tmp());
  const bc = new FakeBc();
  bc.nondeterministic = true;
  const all = await readAppGraph(ws);
  const core = await buildApps(bc, "C1", {
    policy: DECLARED_POLICY,
    srcDir: ws,
    apps: all.filter((a) => a.folder === "Core"),
    versions: new Map(),
    outDir: await tmp(),
    lock: lk,
    cache,
  });
  const rest = all.filter((a) => a.folder !== "Core");
  const onTop = (keys?: Map<string, string>) =>
    buildApps(bc, "C1", {
      policy: DECLARED_POLICY,
      srcDir: ws,
      apps: rest,
      versions: new Map(),
      outDir: join(ws, "..", crypto.randomUUID()),
      lock: lk,
      cache,
      graph: all,
      prebuilt: new Map([["Core", core[0]!.file!]]),
      ...(keys ? { prebuiltKeys: keys } : {}),
    });
  await onTop(new Map([["Core", core[0]!.key!]]));
  assertEquals(bc.compiles, ["Core", "Rental", "Test"]);
  await onTop(new Map([["Core", core[0]!.key!]]));
  assertEquals(bc.compiles.length, 3, "same dependency key: reused");
  await onTop();
  assertEquals(
    bc.compiles.slice(3),
    ["Rental", "Test"],
    "a dependency without a cache key is its file",
  );
});

Deno.test("buildApps (H-27): a failed build is never cached; its dependents are not attempted", async () => {
  const ws = await workspace();
  const lk = await lock();
  const cache = dirBuildCache(await tmp());
  const bc = new FakeBc();
  await write(
    ws,
    "Rental/src/R.al",
    `codeunit 70200 "CGR Rental"\n{\n    // COMPILE_ERROR\n}\n`,
  );
  await cached(bc, "C1", ws, lk, cache);
  await cached(bc, "C1", ws, lk, cache);
  assertEquals(bc.compiles, ["Core", "Rental", "Rental"]);
});

Deno.test("buildApps (H-27): concurrent builds of the same apps leave one entry per key, and both builds succeed", async () => {
  const ws = await workspace();
  const lk = await lock();
  const dir = await tmp();
  const cache = dirBuildCache(dir);
  const bc = new FakeBc();
  bc.nondeterministic = true;
  const [a, b] = await Promise.all([
    cached(bc, "C1", ws, lk, cache),
    cached(bc, "C2", ws, lk, cache),
  ]);
  assert([...a, ...b].every((x) => x.ok));
  const entries: string[] = [];
  for await (const e of Deno.readDir(dir)) entries.push(e.name);
  assertEquals(entries.filter((e) => !e.startsWith(".tmp-")).length, 3);
  assertEquals(entries.filter((e) => e.startsWith(".tmp-")), []);
  const n = bc.compiles.length;
  await cached(bc, "C3", ws, lk, cache);
  assertEquals(bc.compiles.length, n, "a later build reuses them");
  assertEquals(await buildCacheReport(dir), {
    entries: 3,
    bytes: (await Promise.all(
      entries.map(async (e) => {
        let s = 0;
        for await (const f of Deno.readDir(join(dir, e))) {
          s += (await Deno.stat(join(dir, e, f.name))).size;
        }
        return s;
      }),
    )).reduce((x, y) => x + y, 0),
  });
});

Deno.test("prepareApps (H-27): a second prepare of the same task reuses the prerequisites and candidates from the shared cache", async () => {
  const ws = await workspace();
  const lk = await lock();
  const cache = dirBuildCache(await tmp());
  const bc = new FakeBc();
  bc.nondeterministic = true;
  const lane = new BcLane(bc, ["C1", "C2"]);
  const prep = async () =>
    await prepareApps(lane, {
      versionPlan: "backend",
      policy: DECLARED_POLICY,
      pristine: ws,
      pristineApps: await readAppGraph(ws),
      candidateDir: ws,
      candidateApps: await readAppGraph(ws),
      changed: ["Rental"],
      workDir: await tmp(),
      lock: lk,
      cache,
    });
  const p1 = await prep();
  assertEquals(p1.per_app_compiles, 3);
  const p2 = await prep();
  assertEquals(p2.per_app_compiles, 0);
  assertEquals([...p2.keys.keys()].sort(), ["Core", "Rental", "Test"]);
  assertEquals(p1.keys, p2.keys);
});

// ---- M1-40b: restore only each app's declared dependency closure ----

const SYSTEM_ID = "8874ed3a-0643-4247-9ced-7a7002f7135d";
const APPLICATION_ID = "c1335042-3002-4257-bf8a-75c898ccb1b8";
const UNRELATED_ID = "11111111-2222-4333-8444-555555555555";

/** A lock of five Microsoft packages with their app info (as BCH reports it). */
async function closureLock() {
  const store = await tmp();
  const pkgs: Array<[string, string, string, string[]]> = [
    [SYSTEM_ID, "System", "Microsoft_System_28.0.0.0.app", []],
    [BASE_ID, "Base Application", "Microsoft_Base Application_28.0.0.0.app", [
      SYSTEM_ID,
    ]],
    [APPLICATION_ID, "Application", "Microsoft_Application_28.0.0.0.app", [
      BASE_ID,
    ]],
    [IDS.assert, "Library Assert", "Microsoft_Library Assert_28.0.0.0.app", [
      SYSTEM_ID,
    ]],
    [UNRELATED_ID, "Unrelated", "Microsoft_Unrelated_28.0.0.0.app", [
      SYSTEM_ID,
    ]],
  ];
  const packages = [];
  const info: Record<string, { appId: string; deps: string[] }> = {};
  for (const [id, name, file, deps] of pkgs) {
    await Deno.writeTextFile(join(store, "staging.app"), `symbols of ${name}`);
    const sha256 = await hashFile(store, join(store, "staging.app"));
    await Deno.rename(join(store, "staging.app"), join(store, `${sha256}.app`));
    packages.push({
      app_id: id,
      name,
      publisher: "Microsoft",
      version: "28.0.0.0",
      file,
      sha256,
    });
    info[file] = { appId: id, deps };
  }
  return { lock: { store, packages } as LockedSymbols, info };
}

/** A BCH stand-in writing its app info cache (appId and dependencies) for every package present. */
function bchAppInfo(
  bc: FakeBc,
  info: Record<string, { appId: string; deps: string[] }>,
) {
  bc.onCompile = async (dir) => {
    const pk = join(dir, ".alpackages");
    const cache: Record<string, unknown> = {};
    for await (const e of Deno.readDir(pk)) {
      const i = info[e.name];
      if (!i) continue;
      cache[`.\\${e.name}`] = {
        appId: i.appId,
        publisher: "Microsoft",
        name: e.name,
        version: "28.0.0.0",
        application: "",
        platform: "28.0.0.0",
        propagateDependencies: false,
        dependencies: i.deps.map((id) => ({
          id,
          name: id,
          publisher: "Microsoft",
          version: "28.0.0.0",
        })),
      };
    }
    await Deno.writeTextFile(
      join(pk, "cache_AppInfo.json"),
      JSON.stringify(cache),
    );
  };
}

Deno.test("buildApps: once the app info is harvested, the restore holds exactly the declared dependency closure", async () => {
  const ws = await workspace();
  const { lock: lk, info } = await closureLock();
  const bc = new FakeBc();
  bchAppInfo(bc, info);
  const o = async () => ({
    policy: DECLARED_POLICY,
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await tmp(),
    lock: lk,
  });
  // First build: no harvest yet, so the whole lock is restored (and harvested).
  await buildApps(bc, "C1", await o());
  assertEquals(
    bc.compileSeen.get("Core")!.filter((f) => f.startsWith("Microsoft_"))
      .length,
    5,
  );
  const second = await buildApps(bc, "C1", await o());
  assert(second.every((b) => b.ok));
  const ms = (folder: string) =>
    bc.compileSeen.get(folder)!.filter((f) => f.startsWith("Microsoft_"));
  // Core: application and platform only (Application -> Base -> System).
  assertEquals(ms("Core"), [
    "Microsoft_Application_28.0.0.0.app",
    "Microsoft_Base Application_28.0.0.0.app",
    "Microsoft_System_28.0.0.0.app",
  ]);
  // Test also declares Library Assert; nothing unrelated is ever restored.
  assertEquals(ms("Test"), [
    "Microsoft_Application_28.0.0.0.app",
    "Microsoft_Base Application_28.0.0.0.app",
    "Microsoft_Library Assert_28.0.0.0.app",
    "Microsoft_System_28.0.0.0.app",
  ]);
});

Deno.test("buildApps: a package the app uses but does not declare fails its compile", async () => {
  const ws = await workspace();
  await write(
    ws,
    "Core/src/C.al",
    `codeunit 70000 "CGR Core"\n{\n    // needs Microsoft_Library Assert_28.0.0.0.app\n}\n`,
  );
  const { lock: lk, info } = await closureLock();
  const bc = new FakeBc();
  bchAppInfo(bc, info);
  const o = async () => ({
    policy: DECLARED_POLICY,
    srcDir: ws,
    apps: (await readAppGraph(ws)).filter((a) => a.folder === "Core"),
    versions: new Map(),
    outDir: await tmp(),
    lock: lk,
  });
  await buildApps(bc, "C1", await o()); // harvest (full restore)
  const [core] = await buildApps(bc, "C1", await o());
  assertEquals(core!.ok, false, "Core does not declare Library Assert");
});

// ---- H-27 run 002 (Sol r1) ----

Deno.test("buildApps (H-27 r2 #1): the restored symbol set is in the key: a cold full-lock success is never reused once the closure is harvested", async () => {
  const ws = await workspace();
  await write(
    ws,
    "Core/src/C.al",
    `codeunit 70000 "CGR Core"\n{\n    // needs Microsoft_Library Assert_28.0.0.0.app\n}\n`,
  );
  const { lock: lk, info } = await closureLock();
  const bc = new FakeBc();
  bchAppInfo(bc, info);
  const cache = dirBuildCache(await tmp());
  const o = async () => ({
    policy: DECLARED_POLICY,
    srcDir: ws,
    apps: (await readAppGraph(ws)).filter((a) => a.folder === "Core"),
    versions: new Map(),
    outDir: await tmp(),
    lock: lk,
    cache,
  });
  const [cold] = await buildApps(bc, "C1", await o()); // full restore: succeeds
  assertEquals(cold!.ok, true);
  const [warm] = await buildApps(bc, "C1", await o());
  assertEquals(bc.compiles, ["Core", "Core"], "a different restore set misses");
  assertEquals(warm!.ok, false, "the cached cold success is not reused");
});

Deno.test("buildApps (H-27 r2 #2): a concurrent loser adopts the cache's winning file before building dependents", async () => {
  const ws = await workspace();
  const lk = await lock();
  const dir = await tmp();
  const cache = dirBuildCache(dir);
  const bc = new FakeBc();
  bc.nondeterministic = true;
  // Each compile records the package id of the Core it was built against.
  const against: string[] = [];
  bc.onCompile = async (project) => {
    const f = join(project, ".alpackages", "CentralGauge_CGR Core_1.0.0.0.app");
    try {
      against.push(
        (JSON.parse(await Deno.readTextFile(f)) as {
          packageId: string;
        }).packageId,
      );
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  };
  const runs = await Promise.all([
    cached(bc, "C1", ws, lk, cache),
    cached(bc, "C2", ws, lk, cache),
  ]);
  const coreKey = runs[0]!.find((b) => b.folder === "Core")!.key!;
  const winner =
    (JSON.parse(await Deno.readTextFile((await cache.get(coreKey))!)) as {
      packageId: string;
    }).packageId;
  for (const r of runs) {
    const core = r.find((b) => b.folder === "Core")!;
    assertEquals(
      (JSON.parse(await Deno.readTextFile(core.file!)) as { packageId: string })
        .packageId,
      winner,
      "both builds hold the winning Core",
    );
  }
  assert(against.length > 0);
  assert(
    against.every((id) => id === winner),
    "every dependent compiled against the winning Core",
  );
});

/** A build cache whose reads or writes fail (disk full, permissions). */
function failingCache(fail: "get" | "put"): ReturnType<typeof dirBuildCache> {
  return {
    get: () =>
      fail === "get"
        ? Promise.reject(new Error("read failed"))
        : Promise.resolve(null),
    put: () =>
      fail === "put"
        ? Promise.reject(new Error("disk full"))
        : Promise.resolve(),
  };
}

Deno.test("buildApps (H-27 r2 #3): the cache is best-effort: a failing read is a miss and a failing write leaves the app unkeyed; the build itself succeeds", async () => {
  const ws = await workspace();
  const lk = await lock();
  for (const fail of ["get", "put"] as const) {
    const bc = new FakeBc();
    const built = await cached(bc, "C1", ws, lk, failingCache(fail));
    assert(built.every((b) => b.ok), fail);
    assertEquals(bc.compiles, ["Core", "Rental", "Test"], fail);
    if (fail === "put") {
      assert(
        built.every((b) => b.key === undefined),
        "an artifact the cache did not take carries no key",
      );
    }
  }
});

Deno.test("buildApps (H-27 r3): an unreadable cache hit (copy fails) is compiled normally; the build and its dependents succeed", async () => {
  const ws = await workspace();
  const lk = await lock();
  const bc = new FakeBc();
  // get names a file that cannot be read (gone, locked, no permission).
  const missing = join(await tmp(), "CentralGauge_CGR Core_1.0.0.0.app");
  const cache = {
    get: () => Promise.resolve(missing),
    put: () => Promise.resolve(),
  };
  const built = await cached(bc, "C1", ws, lk, cache);
  assert(built.every((b) => b.ok));
  assertEquals(bc.compiles, ["Core", "Rental", "Test"]);
  for (const b of built) {
    assert(
      (await readApp(b.file!)).folder === b.folder,
      "a complete own build",
    );
  }
});

Deno.test("buildApps (H-27 r3): a failed winner adoption keeps the untouched fresh build, unkeyed; dependents compile against it", async () => {
  const ws = await workspace();
  const lk = await lock();
  const bc = new FakeBc();
  // The write succeeds but the read-back names an unreadable winner.
  const missing = join(await tmp(), "CentralGauge_CGR Core_1.0.0.0.app");
  let puts = 0;
  const cache = {
    get: () => Promise.resolve(puts > 0 ? missing : null),
    put: () => (puts++, Promise.resolve()),
  };
  const built = await cached(bc, "C1", ws, lk, cache);
  assert(built.every((b) => b.ok));
  assertEquals(bc.compiles, ["Core", "Rental", "Test"]);
  assert(built.every((b) => b.key === undefined), "nothing adopted is keyed");
  for (const b of built) {
    assert(
      (await readApp(b.file!)).folder === b.folder,
      "the fresh build is intact",
    );
  }
});

Deno.test("dirBuildCache (H-27 r2 #3): a put onto an existing complete entry keeps the winner; onto an incomplete one it fails", async () => {
  const dir = await tmp();
  const cache = dirBuildCache(dir);
  const src = join(await tmp(), "CentralGauge_CGR Core_1.0.0.0.app");
  await Deno.writeTextFile(src, "mine");
  await Deno.mkdir(join(dir, "won"));
  await Deno.writeTextFile(
    join(dir, "won", "CentralGauge_CGR Core_1.0.0.0.app"),
    "theirs",
  );
  await cache.put("won", src);
  assertEquals(await Deno.readTextFile((await cache.get("won"))!), "theirs");
  // An incomplete entry (no .app) blocks the rename: that is no winner.
  await Deno.mkdir(join(dir, "broken"));
  await Deno.writeTextFile(join(dir, "broken", "partial.tmp"), "");
  await assertRejects(() => cache.put("broken", src));
  assertEquals(await cache.get("broken"), null);
  for await (const e of Deno.readDir(dir)) {
    assert(!e.name.startsWith(".tmp-"), "no staging folder is left behind");
  }
});

Deno.test("buildApps (H-27 r2): another effective version or another lock is a miss", async () => {
  const ws = await workspace();
  const lk = await lock();
  const cache = dirBuildCache(await tmp());
  const bc = new FakeBc();
  const core = async (versions: Map<string, string>, l: LockedSymbols) =>
    await buildApps(bc, "C1", {
      policy: DECLARED_POLICY,
      srcDir: ws,
      apps: (await readAppGraph(ws)).filter((a) => a.folder === "Core"),
      versions,
      outDir: await tmp(),
      lock: l,
      cache,
    });
  await core(new Map(), lk);
  await core(new Map(), lk);
  assertEquals(bc.compiles.length, 1);
  await core(new Map([["Core", "1.0.7.7"]]), lk);
  assertEquals(bc.compiles.length, 2, "another stamped version misses");
  await core(
    new Map(),
    await lockWith({ app_id: UNRELATED_ID, file: "X.app" }),
  );
  assertEquals(bc.compiles.length, 3, "another lock misses");
});

Deno.test("buildApps (H-27 r2 #4): an analysis compile with a cache is refused", async () => {
  const ws = await workspace();
  await assertRejects(
    () =>
      buildApps(new FakeBc(), "C1", {
        policy: DECLARED_POLICY,
        srcDir: ws,
        apps: [],
        versions: new Map(),
        outDir: ws,
        lock: { store: ws, packages: [] },
        cache: dirBuildCache(ws),
        analysis: { codeCop: true, uiCop: true } as never,
      }),
    Error,
    "never with a build cache",
  );
});

Deno.test("buildApps: a BOM app.json builds like one without", async () => {
  const ws = await workspace();
  const p = join(ws, "Core", "app.json");
  await Deno.writeTextFile(p, "\uFEFF" + await Deno.readTextFile(p));
  const bc = new FakeBc();
  const built = await buildApps(bc, "C1", {
    policy: DECLARED_POLICY,
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map([["Core", "1.0.7.7"]]),
    outDir: await tmp(),
    lock: await lock(),
  });
  assert(built.every((b) => b.ok));
  assertEquals((await readApp(built[0]!.file!)).version, "1.0.7.7");
});

// ---- H-35 (design-r5 2.1, 3.3; rulings r5): build policy and version plans ----

Deno.test("H-35: the Cloud policy compiles every app with target Cloud in the effective app.json; the declared policy keeps the workspace's target", async () => {
  const ws = await workspace();
  const bc = new FakeBc();
  const cloud = await buildApps(bc, "C1", {
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await tmp(),
    lock: await lock(),
    policy: CLOUD_POLICY,
  });
  for (const b of cloud) assertEquals((await readApp(b.file!)).target, "Cloud");
  const declared = await buildApps(bc, "C1", {
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await tmp(),
    lock: await lock(),
    policy: DECLARED_POLICY,
  });
  for (const b of declared) {
    assertEquals((await readApp(b.file!)).target, undefined);
  }
});

Deno.test("H-35: the build policy is in the cache key: the same source under another policy is a miss", async () => {
  const ws = await workspace();
  const lk = await lock();
  const cache = dirBuildCache(await tmp());
  const bc = new FakeBc();
  const o = async (policy: typeof CLOUD_POLICY) => ({
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await tmp(),
    lock: lk,
    cache,
    policy,
  });
  const a = await buildApps(bc, "C1", await o(CLOUD_POLICY));
  const b = await buildApps(bc, "C1", await o(DECLARED_POLICY));
  assertEquals(bc.compiles.length, 6, "no reuse across policies");
  assert(a.every((x, i) => x.key !== b[i]!.key));
  await buildApps(bc, "C1", await o(CLOUD_POLICY));
  assertEquals(bc.compiles.length, 6, "the same policy reuses");
});

Deno.test("H-35: a cached package whose target is not the policy's is refused and rebuilt; it is never reused (cached-OnPrem fixture)", async () => {
  const ws = await workspace();
  const lk = await lock();
  const cacheDir = await tmp();
  const cache = dirBuildCache(cacheDir);
  const bc = new FakeBc();
  const o = async () => ({
    srcDir: ws,
    apps: await readAppGraph(ws),
    versions: new Map(),
    outDir: await tmp(),
    lock: lk,
    cache,
    policy: CLOUD_POLICY,
  });
  const first = await buildApps(bc, "C1", await o());
  // Tamper: the cached Core package is replaced by an OnPrem build under its Cloud key.
  const hit = (await cache.get(first[0]!.key!))!;
  const app = await readApp(hit);
  await Deno.writeTextFile(hit, JSON.stringify({ ...app, target: "OnPrem" }));
  const again = await buildApps(bc, "C1", await o());
  // Core is rebuilt; its fresh build is unkeyed, so its dependents rebuild too (fail closed).
  assertEquals(bc.compiles.slice(3), ["Core", "Rental", "Test"]);
  const core = again.find((b) => b.folder === "Core")!;
  assert(core.ok && core.attempted);
  assertEquals((await readApp(core.file!)).target, "Cloud");
  assertEquals(
    core.key,
    undefined,
    "the fresh build is unkeyed: the bad entry stays unused",
  );
});

Deno.test("H-35: prepareApps versionPlan judge publishes every app as a candidate at its pristine version; backend keeps stamped prerequisites", async () => {
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const pristine = await workspace();
  const base = async () => ({
    pristine,
    pristineApps: await readAppGraph(pristine),
    candidateDir: pristine,
    candidateApps: await readAppGraph(pristine),
    changed: ["Rental"],
    workDir: await tmp(),
    lock: await lock(),
    policy: CLOUD_POLICY,
  });
  const judge = await prepareApps(lane, {
    ...await base(),
    versionPlan: "judge",
  });
  assertEquals(
    judge.wanted.map((w) => [w.role, w.version]),
    [["candidate", "1.0.0.0"], ["candidate", "1.0.0.0"], [
      "candidate",
      "1.0.0.0",
    ]],
  );
  assertEquals(judge.candidateIds, [IDS.core, IDS.rental, IDS.test]);
  const backend = await prepareApps(lane, {
    ...await base(),
    versionPlan: "backend",
  });
  const core = backend.wanted.find((w) => w.id === IDS.core)!;
  assertEquals(core.role, "prereq");
  assert(
    core.version !== "1.0.0.0",
    "the backend plan still stamps prerequisites",
  );
});

// ---- H-35 S1.7b (design-r3 3.2, 3.3): one production build for G and A ----

/** G's prepare (judge plan, Cloud) of a workspace; A is a copy whose Test differs. */
async function gAndA() {
  const bc = new FakeBc();
  const lane = new BcLane(bc, ["C1"]);
  const pristine = await workspace();
  const g = await workspace();
  const a = await workspace();
  await write(
    a,
    "Test/src/Agent.al",
    `codeunit 81000 "Agent"\n{\n    Subtype = Test;\n}\n`,
  );
  const l = await lock();
  const prepare = async (dir: string, changed: string[], extra = {}) =>
    await prepareApps(lane, {
      pristine,
      pristineApps: await readAppGraph(pristine),
      candidateDir: dir,
      candidateApps: await readAppGraph(dir),
      changed,
      workDir: await tmp(),
      lock: l,
      versionPlan: "judge",
      policy: CLOUD_POLICY,
      ...extra,
    });
  const gp = await prepare(g, []);
  const manifest = await productionManifest(gp, g);
  return { bc, lane, pristine, a, gp, manifest, prepare };
}

Deno.test("H-35: A publishes G's production files (the manifest), compiling only its Test app, without any build cache", async () => {
  const { bc, a, gp, manifest, prepare } = await gAndA();
  assertEquals([...manifest.apps.keys()].sort(), ["Core", "Rental"]);
  assert(/^[0-9a-f]{64}$/.test(manifest.digest));
  const before = bc.compiles.length;
  const ap = await prepare(a, ["Test"], { production: manifest });
  assertEquals(bc.compiles.slice(before), ["Test"]);
  for (const id of [IDS.core, IDS.rental]) {
    assertEquals(
      ap.wanted.find((w) => w.id === id)!.file,
      gp.wanted.find((w) => w.id === id)!.file,
    );
  }
  const core = ap.wanted.find((w) => w.id === IDS.core)!;
  assertEquals(core.sha256, manifest.apps.get("Core")!.sha256);
  assertEquals(core.role, "candidate");
});

Deno.test("H-35: a production source in A that differs from G's manifest is a harness bug: the prepare throws", async () => {
  const { a, manifest, prepare } = await gAndA();
  await write(
    a,
    "Rental/src/R.al",
    `codeunit 70200 "CGR Rental"\n{\n    // drift\n}\n`,
  );
  await assertRejects(
    () => prepare(a, ["Rental", "Test"], { production: manifest }),
    Error,
    "production manifest",
  );
});

Deno.test("H-35: deploy refuses a package whose bytes no longer match its manifest sha256, before touching the container", async () => {
  const { bc, gp } = await gAndA();
  const w = gp.wanted.map((x) => ({ ...x, sha256: "0".repeat(64) }));
  const syncs = bc.syncs.length;
  const ledgerRoot = join(await tmp(), "ledger");
  await assertRejects(
    () => deploy(bc, "C1", w, { ledgerRoot, trustedRoots: [] }),
    Error,
    "sha256",
  );
  assertEquals(bc.syncs.length, syncs);
});

// ---- H-35 Sol r1 ----

Deno.test("H-35 Sol r1 #5: every package a prepare built carries its sha256; deploy refuses one replaced after the prepare", async () => {
  const { bc, gp } = await gAndA();
  assert(gp.wanted.every((w) => /^[0-9a-f]{64}$/.test(w.sha256 ?? "")));
  const core = gp.wanted.find((w) => w.id === IDS.core)!;
  await Deno.writeTextFile(core.file, "replaced");
  const syncs = bc.syncs.length;
  const ledgerRoot = join(await tmp(), "ledger");
  await assertRejects(
    () => deploy(bc, "C1", gp.wanted, { ledgerRoot, trustedRoots: [] }),
    Error,
    "sha256",
  );
  assertEquals(bc.syncs.length, syncs);
});

Deno.test("H-35 Sol r1 #6: a cache entry that wins the write is target-checked too: an OnPrem winner is never adopted", async () => {
  const bc = new FakeBc();
  const ws = await workspace();
  const onprem = join(await tmp(), "onprem.app");
  const winners = new Map<string, string>();
  const cache = {
    get: (key: string) => Promise.resolve(winners.get(key) ?? null),
    put: async (key: string, _file: string) => {
      // A concurrent writer won the key with an OnPrem package.
      await Deno.writeTextFile(onprem, JSON.stringify({ target: "OnPrem" }));
      winners.set(key, onprem);
    },
  };
  const built = await buildApps(bc, "C1", {
    srcDir: ws,
    apps: (await readAppGraph(ws)).filter((a) => a.folder === "Core"),
    versions: new Map(),
    outDir: await tmp(),
    lock: await lock(),
    cache,
    policy: CLOUD_POLICY,
  });
  const core = built[0]!;
  assert(core.ok);
  assertEquals(core.key, undefined, "the OnPrem winner is not adopted");
  assertEquals(await bc.packageTarget(core.file!), "Cloud");
});

// ---- H-35 orchestrator Sol r1 (S1 run 001 rejection) ----

Deno.test("H-35 orch r1 #3: a build has its key without any build cache, and the production manifest records it", async () => {
  const { gp, manifest } = await gAndA();
  for (const id of [IDS.core, IDS.rental]) {
    const folder = id === IDS.core ? "Core" : "Rental";
    assert(/^[0-9a-f]{64}$/.test(gp.keys.get(folder) ?? ""), folder);
    assertEquals(manifest.apps.get(folder)!.key, gp.keys.get(folder));
  }
});

Deno.test("H-35 orch r1 #4: the effective app.json (version, Cloud target) is staged before the cache is consulted", async () => {
  const bc = new FakeBc();
  const ws = await workspace();
  const outDir = await tmp();
  const seen: (string | null)[] = [];
  const cache = {
    get: async (_key: string) => {
      const aj = JSON.parse(
        await Deno.readTextFile(join(outDir, "Core", "app.json")).catch(() =>
          "{}"
        ),
      );
      seen.push(aj.target ?? null);
      return null;
    },
    put: () => Promise.resolve(),
  };
  await buildApps(bc, "C1", {
    srcDir: ws,
    apps: (await readAppGraph(ws)).filter((a) => a.folder === "Core"),
    versions: new Map([["Core", "1.0.0.0"]]),
    outDir,
    lock: await lock(),
    cache,
    policy: CLOUD_POLICY,
  });
  assertEquals(seen[0], "Cloud");
});

// ---- H-35 S3: the reset before every judge deployment ----

/** A reset mechanism that logs each reset; `fail` names containers it fails on. */
function fakeReset(bc: FakeBc, fail = new Set<string>()) {
  const log: string[] = [];
  const records: ResetRecord[] = [];
  const mechanism: ResetMechanism = {
    id: "fake",
    policyVersion: 1,
    reset: (c) => {
      // Ordered against the deployments: how many syncs preceded it.
      log.push(`${c}@${bc.syncs.length}`);
      return Promise.resolve({
        container: c,
        mechanism: "fake",
        policy_version: 1,
        ok: !fail.has(c),
        failed_step: fail.has(c) ? "snapshot_guard" : null,
        error: fail.has(c) ? "snapshot exists" : null,
        phases_ms: {},
      });
    },
  };
  return {
    log,
    records,
    mechanism,
    onReset: (r: ResetRecord) => records.push(r),
  };
}

Deno.test("H-35 S3 deployAndTest: the reset runs before the deployment, is recorded and returned, and the ledger is the baseline (empty) after it", async () => {
  const bc = new FakeBc((cu) =>
    cu === 80010 ? result({ Works: true }) : result({})
  );
  const p = await prep(bc, new BcLane(bc, ["C1"]));
  const ledgerRoot = await tmp();
  await saveLedger(
    ledgerRoot,
    "C1",
    {
      stale: { id: "stale", version: "1.0.0.0", stamp: "x" },
    } as unknown as Parameters<typeof saveLedger>[2],
  );
  const r = fakeReset(bc);
  const before = bc.syncs.length;
  const out = await deployAndTest(bc, "C1", {
    wanted: p.wanted,
    tests: [{ codeunit: 80010, procedures: ["Works"], target: "candidate" }],
    cleanupIds: [IDS.test],
    ctx: {
      ledgerRoot,
      trustedRoots: [p.pristine],
      reset: r.mechanism,
      onReset: r.onReset,
    },
  });
  assertEquals(r.log, [`C1@${before}`]);
  assertEquals(out.reset?.ok, true);
  assertEquals(r.records.map((x) => x.container), ["C1"]);
  assert(!("stale" in await loadLedger(ledgerRoot, "C1")));
});

Deno.test("H-35 S3 deployAndTest: a failed reset throws ResetFailedError before any deployment; the lane quarantines that container and reroutes, and the retry gets its own reset", async () => {
  const bc = new FakeBc((cu) =>
    cu === 80010 ? result({ Works: true }) : result({})
  );
  const lane = new BcLane(bc, ["C1", "C2"]);
  const p = await prep(bc, lane);
  const r = fakeReset(bc, new Set(["C1"]));
  const ctx = {
    ledgerRoot: await tmp(),
    trustedRoots: [p.pristine],
    reset: r.mechanism,
    onReset: r.onReset,
  };
  const call = (c: string) =>
    deployAndTest(bc, c, {
      wanted: p.wanted,
      tests: [{ codeunit: 80010, procedures: ["Works"], target: "candidate" }],
      cleanupIds: [IDS.test],
      ctx,
    });
  const syncs = bc.syncs.length;
  await assertRejects(() => call("C1"), ResetFailedError, "snapshot_guard");
  assertEquals(bc.syncs.length, syncs, "nothing deployed after a failed reset");
  // Through the lane: C1 (least recently routed first) fails its reset.
  const held = await lane.exclusive(
    { taskId: "HX-001", variantId: "e1", attemptNumber: 1 },
    call,
  );
  assertEquals(held.container, "C2");
  assert(lane.quarantined.get("C1")?.includes("snapshot_guard"));
  assertEquals(
    r.records.map((x) => [x.container, x.ok]),
    [["C1", false], ["C1", false], ["C2", true]],
  );
});

Deno.test("H-35 Sol r2 #3: a reset mechanism that throws is recorded as a failed reset and quarantines the container; the retry gets its own reset", async () => {
  const bc = new FakeBc((cu) =>
    cu === 80010 ? result({ Works: true }) : result({})
  );
  const lane = new BcLane(bc, ["C1", "C2"]);
  const p = await prep(bc, lane);
  const records: ResetRecord[] = [];
  const ok = fakeReset(bc).mechanism;
  const ctx = {
    ledgerRoot: await tmp(),
    trustedRoots: [p.pristine],
    reset: {
      id: "fake",
      policyVersion: 1,
      reset: (c: string) =>
        c === "C1"
          ? Promise.reject(new ContainerError("session died", c, "setup"))
          : ok.reset(c),
    },
    onReset: (r: ResetRecord) => records.push(r),
  };
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
  assertEquals(held.container, "C2");
  assert(lane.quarantined.has("C1"));
  assertEquals(
    records.map((r) => [r.container, r.ok, r.failed_step]),
    [["C1", false, "threw"], ["C2", true, null]],
  );
});

Deno.test("H-35 Sol r3 #2: a reset mechanism that throws synchronously is recorded and quarantines too", async () => {
  const bc = new FakeBc((cu) =>
    cu === 80010 ? result({ Works: true }) : result({})
  );
  const lane = new BcLane(bc, ["C1", "C2"]);
  const p = await prep(bc, lane);
  const records: ResetRecord[] = [];
  const ok = fakeReset(bc).mechanism;
  const reset: ResetMechanism = {
    id: "fake",
    policyVersion: 1,
    reset(c: string): Promise<ResetRecord> {
      if (c === "C1") throw new ContainerError("session died", c, "setup");
      return ok.reset(c);
    },
  };
  const ledgerRoot = await tmp();
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
        ctx: {
          ledgerRoot,
          trustedRoots: [p.pristine],
          reset,
          onReset: (r) => records.push(r),
        },
      }),
  );
  assertEquals(held.container, "C2");
  assert(lane.quarantined.has("C1"));
  assertEquals(records.map((r) => [r.container, r.failed_step]), [
    ["C1", "threw"],
    ["C2", null],
  ]);
});

// ---- H-35 S3: the post-cleanup inventory check (design-r4 2) ----

/** fakeReset plus a verifyClean that is dirty on the `dirty` containers (or throws on `throws`). */
function verifyingReset(
  bc: FakeBc,
  o: { dirty?: Set<string>; throws?: Set<string> } = {},
) {
  const base = fakeReset(bc);
  const verifies: VerifyRecord[] = [];
  const mechanism: ResetMechanism = {
    ...base.mechanism,
    verifyClean: (c) => {
      base.log.push(`verify ${c}@${bc.syncs.length}`);
      if (o.throws?.has(c)) {
        return Promise.reject(new ContainerError("exec died", c, "setup"));
      }
      const dirty = o.dirty?.has(c) ?? false;
      return Promise.resolve({
        container: c,
        ok: !dirty,
        diff: dirty ? ["+ P|leftover-app"] : [],
        error: dirty ? "inventory differs from the baseline (1 line)" : null,
      });
    },
  };
  return {
    ...base,
    mechanism,
    verifies,
    onVerify: (v: VerifyRecord) => verifies.push(v),
  };
}

Deno.test("H-35 S3 deployAndTest: the post-cleanup inventory check runs after the cleanup and is recorded; clean means no cleanupError", async () => {
  const bc = new FakeBc((cu) =>
    cu === 80010 ? result({ Works: true }) : result({})
  );
  const p = await prep(bc, new BcLane(bc, ["C1"]));
  const r = verifyingReset(bc);
  const out = await deployAndTest(bc, "C1", {
    wanted: p.wanted,
    tests: [{ codeunit: 80010, procedures: ["Works"], target: "candidate" }],
    cleanupIds: [IDS.test],
    ctx: {
      ledgerRoot: await tmp(),
      trustedRoots: [p.pristine],
      reset: r.mechanism,
      onReset: r.onReset,
      onVerify: r.onVerify,
    },
  });
  // after the cleanup sync, the last one
  assertEquals(r.log.at(-1), `verify C1@${bc.syncs.length}`);
  assertEquals(bc.syncs.at(-1)?.publish, []);
  assertEquals(out.cleanupError, null);
  assertEquals(out.verify?.ok, true);
  assertEquals(r.verifies.map((v) => v.container), ["C1"]);
});

Deno.test("H-35 S3 deployAndTest: a dirty post-cleanup inventory is a cleanupError (the lane quarantines; the measurement stands) and is recorded with its diff", async () => {
  const bc = new FakeBc((cu) =>
    cu === 80010 ? result({ Works: true }) : result({})
  );
  const lane = new BcLane(bc, ["C1"]);
  const p = await prep(bc, lane);
  const r = verifyingReset(bc, { dirty: new Set(["C1"]) });
  const ledgerRoot = await tmp();
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
        ctx: {
          ledgerRoot,
          trustedRoots: [p.pristine],
          reset: r.mechanism,
          onVerify: r.onVerify,
        },
      }),
  );
  assertStringIncludes(held.result.cleanupError!, "inventory differs");
  assert(lane.quarantined.get("C1")?.includes("inventory differs"));
  assertEquals(held.result.rows.map((x) => x.outcome), ["pass"]);
  assertEquals(r.verifies.map((v) => v.diff), [["+ P|leftover-app"]]);
});

Deno.test("H-35 S3 deployAndTest: a deployment that throws, then a dirty or throwing check, is a CleanupFailedError (quarantine); a throwing check is recorded as a failed check", async () => {
  for (const kind of ["dirty", "throws"] as const) {
    const bc = new FakeBc((cu) =>
      cu === 80010 ? result({ Works: true }) : result({})
    );
    const p = await prep(bc, new BcLane(bc, ["C1"]));
    bc.publishFailure = () => "Could not connect to the server";
    const r = verifyingReset(bc, { [kind]: new Set(["C1"]) });
    const ledgerRoot = await tmp();
    await assertRejects(
      () =>
        deployAndTest(bc, "C1", {
          wanted: p.wanted,
          tests: [{
            codeunit: 80010,
            procedures: ["Works"],
            target: "candidate",
          }],
          cleanupIds: [IDS.test],
          ctx: {
            ledgerRoot,
            trustedRoots: [p.pristine],
            reset: r.mechanism,
            onVerify: r.onVerify,
          },
        }),
      CleanupFailedError,
      kind === "dirty" ? "inventory differs" : "exec died",
    );
    assertEquals(r.verifies.map((v) => v.ok), [false]);
  }
});

Deno.test("H-35 S3 deployAndTest: no inventory check after a failed cleanup (already quarantined) or without a reset mechanism", async () => {
  const bc = new FakeBc((cu) =>
    cu === 80010 ? result({ Works: true }) : result({})
  );
  const p = await prep(bc, new BcLane(bc, ["C1"]));
  bc.cleanupFails.add("C1");
  const r = verifyingReset(bc);
  const out = await deployAndTest(bc, "C1", {
    wanted: p.wanted,
    tests: [{ codeunit: 80010, procedures: ["Works"], target: "candidate" }],
    cleanupIds: [IDS.test],
    ctx: {
      ledgerRoot: await tmp(),
      trustedRoots: [p.pristine],
      reset: r.mechanism,
      onVerify: r.onVerify,
    },
  });
  assertStringIncludes(out.cleanupError!, "incomplete");
  assertEquals(r.verifies, []);
  assertEquals(out.verify, null);
});
