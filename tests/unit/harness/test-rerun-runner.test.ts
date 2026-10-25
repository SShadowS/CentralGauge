/**
 * Q-04 phase B: the production TestRerunRunner over buildVerdictWorkspace +
 * prepareApps + lane.exclusive(deployAndTest), against FakeBc (no container).
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import { safeCopyTree } from "../../../src/harness/fsutil.ts";
import { resolveRefapp } from "../../../src/harness/identity.ts";
import { stageRefappTask } from "../../../src/harness/staging.ts";
import { loadTask } from "../../../src/harness/task.ts";
import type { Row } from "../../../scripts/harness/analyze-campaign.ts";
import {
  type TestRerunRequest,
  testRerunStep,
} from "../../../scripts/harness/test-rerun.ts";
import {
  envRunner,
  type RerunEnv,
} from "../../../scripts/harness/test-rerun-runner.ts";
import { testTempDir } from "../../utils/temp-dir.ts";
import { deployedSource, FakeBc, OK_RESET, result } from "./fake-bc.ts";
import { noOnPrem } from "./onprem-fixture.ts";
import { makeRefappRepo, rental, write } from "./refapp-fixture.ts";

const SHIPPED_TEST = (extra = "", marker = "") =>
  `codeunit 80010 "CGR Shipped Tests"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure ShippedPasses()\n    begin\n        ${marker}Assert.AreEqual(10, Rental.Price(), 'shipped');\n    end;\n${extra}}\n`;

const AGENT_TEST =
  `\n    [Test]\n    procedure PriceIsTen()\n    begin\n        Assert.AreEqual(10, Rental.Price(), 'agent');\n    end;\n`;

const TEST_FILE = "Test/src/Shipped.Test.al";
const RENTAL_FILE = "Rental/src/Rental.Codeunit.al";

interface Seen {
  codeunit: number;
  test: string;
  rental: string;
}

/** A scripted FakeBc: `answer` sees the deployed sources of the Test and Rental apps. */
function fake(answer: (s: Seen) => ReturnType<typeof result>) {
  const seen: Seen[] = [];
  const bc = new FakeBc((codeunit, deployed) => {
    const s = {
      codeunit,
      test: deployedSource(deployed, "CGR Test"),
      rental: deployedSource(deployed, "CGR Rental"),
    };
    seen.push(s);
    return answer(s);
  });
  return { bc, seen };
}

/** PriceIsTen exists only in the agent's Test app; a procedure passes when Rental returns 10. */
const byPrice = (s: Seen) => {
  const price = s.rental.includes("exit(10)");
  const verdict = (name: string) =>
    price ? true : `Assert.AreEqual failed. ${name} expected:<10>`;
  return result(
    s.test.includes("PriceIsTen")
      ? {
        ShippedPasses: verdict("ShippedPasses"),
        PriceIsTen: verdict("PriceIsTen"),
      }
      : { ShippedPasses: verdict("ShippedPasses") },
  );
};

async function world(bc: FakeBc, commit: string | null = "c0ffee") {
  const repo = await makeRefappRepo();
  const task = await loadTask(join(repo.tasksDir, "HX-001"));
  const start = (await stageRefappTask({
    repoRoot: repo.root,
    task,
    refapp: await resolveRefapp(repo.root, "refapp-v1"),
    symbols: repo.symbols,
    symbolStore: repo.symbolStore,
    out: join(await Deno.realPath(await testTempDir()), "stage"),
  })).pristine;
  const results = await Deno.realPath(await testTempDir());
  const env: RerunEnv = {
    lane: new BcLane(bc, ["C1"]),
    symbols: repo.symbols,
    symbolStore: repo.symbolStore,
    onPrem: await noOnPrem({ store: repo.symbolStore, packages: repo.symbols }),
    deploy: { ledgerRoot: join(results, "bc-ledger"), reset: OK_RESET },
    harnessCommit: commit,
  };
  const runner = await envRunner(
    env,
    await Deno.realPath(await testTempDir()),
  );
  /** A final tree: a copy of the start tree with these files replaced. */
  const finalTree = async (edits: Record<string, string>, hash = "H1") => {
    const dir = join(results, "workspaces", hash);
    await Deno.mkdir(dir, { recursive: true });
    await safeCopyTree(start, dir);
    for (const [rel, text] of Object.entries(edits)) {
      await write(dir, rel, text);
    }
    return dir;
  };
  const step = (finalHash = "H1") =>
    testRerunStep({
      runner,
      rows: [{
        id: "e1",
        arm: "A",
        task: "HX-001",
        kind: "bugfix",
        repeat: 1,
        verdict: "pass",
        termination: "completed",
      } as unknown as Row],
      results,
      hashOf: new Map([["e1", finalHash]]),
      startOf: () => Promise.resolve({ dir: start, id: "S1" }),
      pairs: [],
      jobs: 1,
      dir: join(results, "..", `out-${crypto.randomUUID().slice(0, 6)}`),
      rev: "R1",
    });
  return {
    start,
    results,
    runner,
    finalTree,
    step,
    [Symbol.asyncDispose]: () => repo[Symbol.asyncDispose](),
  };
}

type W = { start: string };
const agentReq = (
  w: W,
  finalDir: string,
  procedures = ["PriceIsTen"],
): TestRerunRequest => ({
  executionId: "e1",
  start: w.start,
  production: w.start,
  test: finalDir,
  specs: [{ codeunit: 80010, procedures }],
});

const shippedReq = (w: W, finalDir: string): TestRerunRequest => ({
  executionId: "e1",
  start: w.start,
  production: finalDir,
  test: w.start,
  specs: [{ codeunit: 80010, procedures: null }],
});

Deno.test("agent run: start production + final Test; only the selected procedures are scored", async () => {
  const f = fake(byPrice);
  await using w = await world(f.bc);
  const finalDir = await w.finalTree({ [TEST_FILE]: SHIPPED_TEST(AGENT_TEST) });
  const r = await w.runner.run(agentReq(w, finalDir));
  assert(r.compile.ok, r.compile.diagnostics.join());
  // ShippedPasses fails too (start production returns 11) but is not selected.
  assertEquals(r.rows.map((x) => [x.procedure, x.outcome, x.failure]), [
    ["PriceIsTen", "fail", "assertion"],
  ]);
  assert(r.rows[0]!.message?.includes("PriceIsTen expected"));
  // the START production and the agent's test app were deployed
  const run = f.seen.at(-1)!;
  assert(run.rental.includes("exit(11)"), "start production");
  assert(run.test.includes("'agent'"), "agent's Test app");
});

Deno.test("agent run: a selected procedure that passes is a pass even when a sibling fails", async () => {
  const f = fake((s) =>
    result({
      ShippedPasses: "Assert.AreEqual failed. sibling",
      PriceIsTen: s.rental.includes("exit(11)") ? true : "Assert.IsTrue failed",
    })
  );
  await using w = await world(f.bc);
  const finalDir = await w.finalTree({ [TEST_FILE]: SHIPPED_TEST(AGENT_TEST) });
  const r = await w.runner.run(agentReq(w, finalDir));
  assertEquals(r.rows.map((x) => [x.procedure, x.outcome]), [[
    "PriceIsTen",
    "pass",
  ]]);
});

Deno.test("a final Test app that does not compile against the start production: compile.ok false, nothing deployed, step says not_applicable compile", async () => {
  const f = fake(byPrice);
  await using w = await world(f.bc);
  const broken = SHIPPED_TEST(AGENT_TEST + "    // COMPILE_ERROR\n");
  const finalDir = await w.finalTree({ [TEST_FILE]: broken });
  const r = await w.runner.run(agentReq(w, finalDir));
  assertEquals(r.compile.ok, false);
  assert(r.compile.diagnostics.some((d) => d.includes("AL0001")));
  assertEquals(r.rows, []);
  assertEquals(f.bc.syncs, []);
  assertEquals(f.bc.tests, []);
  // end to end through the step
  const out = await w.step();
  assertEquals(out.failed, []);
  assertEquals(out.done[0]!.agent_vs_start.outcome, "not_applicable");
  assertEquals(out.done[0]!.agent_vs_start.reason, "compile");
});

Deno.test("shipped run publishes the PRISTINE start Test app against the final production", async () => {
  const f = fake(byPrice);
  await using w = await world(f.bc);
  const finalDir = await w.finalTree({
    [TEST_FILE]: SHIPPED_TEST(AGENT_TEST, "// AGENT_EDIT\n        "),
    [RENTAL_FILE]: rental("exit(10); // FIXED"),
  });
  const r = await w.runner.run(shippedReq(w, finalDir));
  assert(r.compile.ok, r.compile.diagnostics.join());
  const run = f.seen.at(-1)!;
  assert(!run.test.includes("AGENT_EDIT"), "the agent-edited test file");
  assert(!run.test.includes("PriceIsTen"), "the agent's added procedure");
  assert(run.test.includes("'shipped'"), "the original test file");
  assert(run.rental.includes("exit(10)"), "the final production");
  assertEquals(r.rows.map((x) => [x.procedure, x.outcome]), [[
    "ShippedPasses",
    "pass",
  ]]);
});

Deno.test("identity: production app hashes by name, test app hash, container and BC version", async () => {
  const f = fake(byPrice);
  await using w = await world(f.bc);
  const finalDir = await w.finalTree({ [TEST_FILE]: SHIPPED_TEST(AGENT_TEST) });
  const a = await w.runner.run(agentReq(w, finalDir));
  const hex = /^[0-9a-f]{64}$/;
  assertEquals(Object.keys(a.identity.production_apps).sort(), [
    "CGR Core",
    "CGR Rental",
  ]);
  for (const h of Object.values(a.identity.production_apps)) {
    assert(hex.test(h));
  }
  assert(hex.test(a.identity.test_app));
  assertEquals(a.identity.container, "C1");
  assertEquals(a.identity.bc_version, f.bc.compilerId);
  // the shipped run's Test app is the pristine one: not the agent's
  const s = await w.runner.run(shippedReq(w, finalDir));
  assert(s.identity.test_app !== a.identity.test_app);
  assertEquals(s.identity.production_apps, a.identity.production_apps);
  // the same inputs give the same identity
  assertEquals(
    (await w.runner.run(agentReq(w, finalDir))).identity,
    a.identity,
  );
});

Deno.test("runner id: harness commit plus the oracle runner identity", async () => {
  await using w = await world(fake(byPrice).bc);
  assert(w.runner.id.startsWith("c0ffee-"), w.runner.id);
  assert(w.runner.id.length > "c0ffee-".length);
});

Deno.test("runner id: a dirty or missing harness commit gets a private id, never shared", async () => {
  const bc = fake(byPrice).bc;
  await using a = await world(bc, "c0ffee+dirty");
  await using b = await world(bc, "c0ffee+dirty");
  await using c = await world(bc, null);
  for (const r of [a.runner, b.runner, c.runner]) {
    assert(r.id.startsWith("uncommitted-"), r.id);
  }
  assert(a.runner.id !== b.runner.id);
});

Deno.test("env(): the lane containers with their BC build (query stripped) and a sha256 of the symbol lock", async () => {
  const f = fake(byPrice);
  f.bc.compilerId = "fake-artifact?sv=secret|bccontainerhelper 6.1.14";
  await using w = await world(f.bc);
  const e = await w.runner.env();
  assertEquals(e.containers, [{
    name: "C1",
    bc_version: "fake-artifact|bccontainerhelper 6.1.14",
  }]);
  assert(/^[0-9a-f]{64}$/.test(e.symbols), e.symbols);
  assertEquals(await w.runner.env(), e);
});

const VARIANT_TEST =
  `\n    [Test]\n    procedure PriceIsTen()\n    var\n        V: Variant;\n    begin\n        V := 10;\n        Assert.AreEqual(10, V, 'variant');\n    end;\n`;

Deno.test("agent run: the agent's Test app is published as written (a procedure using Variant is deployed and scored)", async () => {
  const f = fake(byPrice);
  await using w = await world(f.bc);
  const finalDir = await w.finalTree({
    [TEST_FILE]: SHIPPED_TEST(VARIANT_TEST),
  });
  const r = await w.runner.run(agentReq(w, finalDir));
  assert(r.compile.ok, r.compile.diagnostics.join());
  assert(f.seen.at(-1)!.test.includes("V: Variant"), "deployed Variant test");
  assertEquals(r.rows.map((x) => [x.procedure, x.outcome]), [[
    "PriceIsTen",
    "fail",
  ]]);
});

Deno.test("shipped run: the start Test app is deployed verbatim (a shipped Variant test included)", async () => {
  const f = fake(byPrice);
  await using w = await world(f.bc);
  const src = SHIPPED_TEST(VARIANT_TEST);
  await write(w.start, TEST_FILE, src);
  const finalDir = await w.finalTree({ [RENTAL_FILE]: rental("exit(10);") });
  const r = await w.runner.run(shippedReq(w, finalDir));
  assert(r.compile.ok, r.compile.diagnostics.join());
  assert(f.seen.at(-1)!.test.includes("V: Variant"), "deployed Variant test");
});

Deno.test("a lane fault: run rejects and the step lists the execution as failed, no row written", async () => {
  const f = fake(byPrice);
  f.bc.broken.add("C1");
  await using w = await world(f.bc);
  const finalDir = await w.finalTree({ [TEST_FILE]: SHIPPED_TEST(AGENT_TEST) });
  await assertRejects(() => w.runner.run(agentReq(w, finalDir)));
  const out = await w.step();
  assertEquals(out.failed.map((x) => x.id), ["e1"]);
  assertEquals(out.done, []);
});

Deno.test("an infra row (selected procedure missing from the BC result): the step lists a failure, no row", async () => {
  const f = fake(() => result({ ShippedPasses: true }));
  await using w = await world(f.bc);
  await w.finalTree({ [TEST_FILE]: SHIPPED_TEST(AGENT_TEST) });
  const out = await w.step();
  assertEquals(out.failed.map((x) => x.id), ["e1"]);
  assertEquals(out.done, []);
});

Deno.test("a workspace violation (production app folder missing in the final tree) throws, nothing is deployed", async () => {
  const f = fake(byPrice);
  await using w = await world(f.bc);
  const finalDir = await w.finalTree({ [TEST_FILE]: SHIPPED_TEST(AGENT_TEST) });
  await Deno.remove(join(finalDir, "Rental"), { recursive: true });
  await assertRejects(() => w.runner.run(shippedReq(w, finalDir)));
  assertEquals(f.bc.tests, []);
});
