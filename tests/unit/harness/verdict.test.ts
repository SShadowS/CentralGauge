import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { ContainerError, ValidationError } from "../../../src/errors.ts";
import {
  appVersions,
  BcLane,
  buildApps,
  changedApps,
  dirBuildCache,
} from "../../../src/harness/bc-lane.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import { freezeWorkspace, safeCopyTree } from "../../../src/harness/fsutil.ts";
import { oracleHash, resolveRefapp } from "../../../src/harness/identity.ts";
import {
  JudgmentRecordSchema,
  scorerFingerprint,
} from "../../../src/harness/records.ts";
import { applyOverlay, stageRefappTask } from "../../../src/harness/staging.ts";
import { loadTask } from "../../../src/harness/task.ts";
import {
  buildFailureCodes,
  currentScorerFingerprint,
  infraSignature,
  isCascadeDiagnostic,
  isCurrentJudgment,
  judge,
  SCORER_SUITE,
  writeVerdictLog,
} from "../../../src/harness/verdict.ts";
import { deployedSource, FakeBc, result } from "./fake-bc.ts";
import { appJson, IDS, makeRefappRepo, write } from "./refapp-fixture.ts";
import { hashFile, hashJson } from "../../../src/harness/hash.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

/** Shipped test passes unless Rental carries BREAK_P2P; the oracle passes iff Rental returns 10. */
function script() {
  return new FakeBc((cu, deployed) => {
    const rental = deployedSource(deployed, "CGR Rental");
    if (cu === 80010) {
      return result({
        ShippedPasses: rental.includes("BREAK_P2P")
          ? "Assert.IsTrue failed. broken"
          : true,
      });
    }
    if (cu === 85000) {
      return result({
        FixWorks: rental.includes("exit(10)")
          ? true
          : "Assert.AreEqual failed. Expected:<10>",
      });
    }
    if (cu === 81000) return result({ AgentTest: true });
    return result({});
  });
}

/** Stage HX-001, build an artifact (solution overlay + extra edits), freeze it. */
async function setup(
  solution: "correct" | "naive/a" | null,
  edits: Record<string, string> = {},
) {
  const repo = await makeRefappRepo();
  const task = await loadTask(join(repo.tasksDir, "HX-001"));
  const staged = await stageRefappTask({
    repoRoot: repo.root,
    task,
    refapp: await resolveRefapp(repo.root, "refapp-v1"),
    symbols: repo.symbols,
    symbolStore: repo.symbolStore,
    out: join(await Deno.realPath(await testTempDir()), "stage"),
  });
  const ws = await Deno.realPath(await testTempDir());
  await safeCopyTree(staged.pristine, ws);
  if (solution) await applyOverlay(join(task.dir, solution), ws);
  for (const [rel, text] of Object.entries(edits)) await write(ws, rel, text);
  const results = await Deno.realPath(await testTempDir());
  const frozen = await freezeWorkspace({
    resultsRoot: results,
    privateRoot: await Deno.realPath(await testTempDir()),
    workspace: ws,
    secrets: [],
  });
  return {
    results,
    input: {
      executionId: crypto.randomUUID(),
      workspaceHash: frozen.workspace_hash,
      task,
      oracleHash: await oracleHash(task),
      pristine: staged.pristine,
      artifact: join(results, frozen.stored_path),
      symbolIds: new Set([IDS.assert]),
      workDir: await Deno.realPath(await testTempDir()),
      lock: { store: repo.symbolStore, packages: repo.symbols },
      deploy: { ledgerRoot: join(results, "bc-ledger") },
    },
  };
}

Deno.test("judge: the correct solution passes every scorer; the record validates", async () => {
  const bc = script();
  const { input, results } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  JudgmentRecordSchema.parse(judgment);
  assertEquals(judgment.verdict, "pass");
  assertEquals(judgment.scorer_versions, SCORER_SUITE);
  assertEquals(
    judgment.scorer_fingerprint,
    await scorerFingerprint(SCORER_SUITE),
  );
  assert(await isCurrentJudgment(judgment));
  assertEquals(judgment.scorers.map((s) => [s.name, s.passed]), [
    ["build", true],
    ["pass_to_pass", true],
    ["fail_to_pass", true],
  ]);
  assertEquals(judgment.scorers[2]!.tests, [
    {
      codeunit: 85000,
      procedure: "FixWorks",
      target: "candidate",
      outcome: "pass",
      failure: null,
    },
  ]);
  assertEquals(judgment.verdict_container, "C1");
  const cleanup = bc.syncs.at(-1)!;
  assertEquals(cleanup.publish, []);
  assertEquals(cleanup.removeIds[0], IDS.oracle);
  assert(!cleanup.removeIds.includes(IDS.core));
  for (
    const k of [
      "reconstruct_ms",
      "compile_ms",
      "provisioning_ms",
      "candidate_publish_ms",
      "test_ms",
      "total_ms",
    ] as const
  ) {
    assert(log.spans[k] >= 0);
  }
  await writeVerdictLog(results, log);
  const stored = JSON.parse(
    await Deno.readTextFile(join(results, "verdicts", `${judgment.id}.json`)),
  );
  assertEquals(stored.execution_id, input.executionId);
});

Deno.test("judge (H-27): with the shared build cache a second judgment reuses the task's builds and scores the same", async () => {
  const bc = script();
  bc.nondeterministic = true;
  const cache = dirBuildCache(await Deno.makeTempDir());
  const lane = new BcLane(bc, ["C1", "C2"]);
  const strip = (j: { scorers: unknown }) => j.scorers;
  const a = await setup("correct");
  const r1 = await judge(lane, { ...a.input, buildCache: cache });
  const first = r1.log.per_app_compiles;
  const b = await setup("correct");
  const r2 = await judge(lane, { ...b.input, buildCache: cache });
  assertEquals(r2.log.per_app_compiles, 0, "every build is reused");
  assert(first > 0);
  assertEquals(r2.judgment.verdict, r1.judgment.verdict);
  assertEquals(strip(r2.judgment), strip(r1.judgment));
  // And without the cache the same judgment compiles everything and scores the same.
  const c = await setup("correct");
  const r3 = await judge(lane, c.input);
  assertEquals(r3.log.per_app_compiles, first);
  assertEquals(strip(r3.judgment), strip(r1.judgment));
});

Deno.test("judge (H-27 r2 #4): builds the agent's compile path wrote to the shared cache are reused by the judge, and it scores as without them", async () => {
  const bc = script();
  bc.nondeterministic = true;
  const lane = new BcLane(bc, ["C1", "C2"]);
  const cache = dirBuildCache(await Deno.makeTempDir());
  const { input } = await setup("correct");
  // The backend's compile op: the snapshot's apps with the test path's versions.
  const pristineApps = await readAppGraph(input.pristine);
  const apps = await readAppGraph(input.artifact);
  const changed = await changedApps(
    input.pristine,
    pristineApps,
    input.artifact,
  );
  const { versions } = await appVersions(bc, "C1", {
    pristine: input.pristine,
    pristineApps,
    candidateDir: input.artifact,
    candidateApps: apps,
    changed,
    lock: input.lock,
  });
  const agent = await buildApps(bc, "C1", {
    srcDir: input.artifact,
    apps,
    versions,
    outDir: await Deno.makeTempDir(),
    lock: input.lock,
    cache,
    graph: apps,
  });
  assert(agent.every((b) => b.ok && b.key));
  const cold = await judge(lane, (await setup("correct")).input);
  const warm = await judge(lane, { ...input, buildCache: cache });
  assert(
    warm.log.per_app_compiles < cold.log.per_app_compiles,
    `${warm.log.per_app_compiles} < ${cold.log.per_app_compiles}`,
  );
  assertEquals(warm.judgment.verdict, cold.judgment.verdict);
  assertEquals(warm.judgment.scorers, cold.judgment.scorers);
});

Deno.test("judge: a naive solution fails fail_to_pass by an assertion", async () => {
  const { input } = await setup("naive/a");
  const { judgment, log } = await judge(new BcLane(script(), ["C1"]), input);
  assertEquals(judgment.verdict, "fail");
  assertEquals(judgment.scorers[2]!.tests[0]!.failure, "assertion");
  assertStringIncludes(log.test_messages[0]!.message, "Expected:<10>");
});

Deno.test("judge: a compile error fails build and runs no tests", async () => {
  const bc = script();
  const { input } = await setup("correct", {
    "Rental/src/Broken.al": "COMPILE_ERROR",
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.scorers.map((s) => s.passed), [false, false, false]);
  assertEquals(bc.tests, []);
  assert(log.diagnostics.length > 0);
});

Deno.test("judge: a validation violation fails build before any compile", async () => {
  const bc = script();
  const { input } = await setup("correct", {
    "Rental/src/Reserved.al": `codeunit 75001 "Nope"\n{\n}\n`,
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.verdict, "fail");
  assertEquals(bc.compiles, []);
  assertStringIncludes(log.violations.join("\n"), "reserved band");
});

Deno.test("judge: a pass_to_pass regression fails the verdict", async () => {
  const { input } = await setup("correct", {
    "Rental/src/Break.al": `codeunit 70210 "Break"\n{\n    // BREAK_P2P\n}\n`,
  });
  const { judgment } = await judge(new BcLane(script(), ["C1"]), input);
  assertEquals(judgment.scorers[1]!.passed, false);
  assertEquals(judgment.verdict, "fail");
});

Deno.test("judge: agent-added tests run under pass_to_pass; a TestPage test fails with a reason", async () => {
  const added =
    `codeunit 81000 "Agent"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure AgentTest()\n    begin\n    end;\n}\n`;
  const ok = await setup("correct", { "Test/src/Agent.Test.al": added });
  const r1 = await judge(new BcLane(script(), ["C1"]), ok.input);
  assertEquals(r1.judgment.verdict, "pass");
  assert(
    r1.judgment.scorers[1]!.tests.some((t) =>
      t.codeunit === 81000 && t.outcome === "pass"
    ),
  );
  const page = await setup("correct", {
    "Test/src/Agent.Test.al": added,
    "Test/src/Page.Test.al":
      `codeunit 81001 "Page"\n{\n    Subtype = Test;\n    var P: TestPage "Customer Card";\n}\n`,
  });
  const r2 = await judge(new BcLane(script(), ["C1"]), page.input);
  assertEquals(r2.judgment.verdict, "fail");
  assertStringIncludes(
    r2.log.test_messages.map((m) => m.message).join("\n"),
    "TestPage tests are not supported",
  );
  assert(
    r2.judgment.scorers[1]!.tests.some((t) =>
      t.codeunit === 81001 && t.outcome === "not_run" &&
      t.failure === "runtime_error"
    ),
  );
});

Deno.test("scorer suite: every scorer, one fingerprint for every task kind", () => {
  assertEquals(Object.keys(SCORER_SUITE).sort(), [
    "build",
    "fail_to_pass",
    "mutant_kill",
    "pass_to_pass",
  ]);
});

Deno.test("scorer suite (H-26): pass_to_pass is 4 (agent-added test reruns); the others are unchanged", () => {
  assertEquals(SCORER_SUITE, {
    build: "2",
    pass_to_pass: "4",
    fail_to_pass: "2",
    mutant_kill: "4",
  });
});

Deno.test("scorer suite: the fingerprint does not depend on key order", async () => {
  const reversed = Object.fromEntries(Object.entries(SCORER_SUITE).reverse());
  assertEquals(
    await currentScorerFingerprint(),
    await scorerFingerprint(reversed),
  );
  assert(/^[0-9a-f]{64}$/.test(await currentScorerFingerprint()));
});

Deno.test("judge: an infra fault on one container rejudges on another", async () => {
  const bc = script();
  bc.broken.add("C1");
  const { input } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(judgment.verdict, "pass");
  assertEquals(judgment.verdict_container, "C2");
  assertEquals(log.infra_retries.length, 1);
});

Deno.test("judge: infra on every container is unscored, never a fail", async () => {
  const bc = script();
  const { input } = await setup("correct");
  const lane = new BcLane(bc, ["C1", "C2"]);
  bc.broken.add("C1");
  bc.broken.add("C2");
  const { judgment, log } = await judge(lane, input);
  assertEquals(judgment.verdict, "unscored");
  assertEquals(judgment.scorers.map((s) => s.passed), [null, null, null]);
  assert(log.error !== null);
});

Deno.test("judge: a candidate install defect is the agent's failure", async () => {
  const bc = script();
  bc.publishFailure = (_c, name) =>
    name === "CGR Rental"
      ? "The schema synchronization failed: destructive changes"
      : null;
  const { input } = await setup("correct");
  const { judgment } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.verdict, "fail");
  assertEquals(judgment.scorers[2]!.tests[0]!.failure, "runtime_error");
});

// Deviations from the plan text (defects found while implementing M1-17).

Deno.test("judge: no eligible container at all is unscored, never a crash or a fail", async () => {
  const bc = script();
  const { input } = await setup("correct");
  const lane = new BcLane(bc, ["C1"]);
  lane.quarantine("C1", "cleanup failed earlier");
  const { judgment, log } = await judge(lane, input);
  assertEquals(judgment.verdict, "unscored");
  assertEquals(judgment.scorers.map((s) => s.passed), [null, null, null]);
  assertStringIncludes(log.error!, "No eligible containers");
});

Deno.test("judge: an added test codeunit without [Test] procedures is not run and is noted", async () => {
  const bc = script();
  const { input } = await setup("correct", {
    "Test/src/Empty.Test.al":
      `codeunit 81002 "Empty"\n{\n    Subtype = Test;\n}\n`,
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.verdict, "pass");
  assert(!bc.tests.some((t) => t.codeunit === 81002));
  assertStringIncludes(log.notes.join("\n"), "81002");
});

Deno.test("buildFailureCodes: the AL0000 trailer is ignored next to other codes, kept alone", () => {
  assertEquals(buildFailureCodes(["AL0118", "AL0000", "AL0118"]), ["AL0118"]);
  assertEquals(buildFailureCodes(["AL0000"]), ["AL0000"]);
  assertEquals(buildFailureCodes([]), []);
});

Deno.test("judge: a failed build notes its codes", async () => {
  const { input } = await setup("correct", {
    "Rental/src/Broken.al": "COMPILE_ERROR",
  });
  const { log } = await judge(new BcLane(script(), ["C1"]), input);
  assertStringIncludes(log.notes.join("\n"), "build failed: Rental AL0001");
});

// Review M1-17 (coordinator): agent-added tests cannot push the verdict to infra; the oracle is trusted.
// H-26 (decision 2026-09-25-agent-suite-infra item 3, now also for pass_to_pass): a thrown or
// timed-out agent-added run is ambiguous. It is rerun once on another container behind the trusted
// pass_to_pass control; only a second throw with the control passing is the agent's failure.

const AGENT_81000 = `codeunit 81000 "Agent"
{
    Subtype = Test;

    [Test]
    procedure AgentTest()
    begin
    end;
}
`;

/**
 * The script, with codeunit 81000 timing out: on every container ("always")
 * or only on the first one it runs on ("first"). The lane picks containers,
 * so tests read the agent runs' containers from `agentRuns`.
 */
function hangs(mode: "first" | "always") {
  const bc = script();
  const inner = bc.script;
  const agentRuns: string[] = [];
  bc.script = (cu, deployed, container) => {
    if (cu === 81000) {
      agentRuns.push(container);
      if (mode === "always" || agentRuns.length === 1) {
        throw new ContainerError(
          `harness SOAP call timed out after 120000ms`,
          container,
          "test",
        );
      }
    }
    return inner(cu, deployed, container);
  };
  return { bc, agentRuns };
}

Deno.test("judge (H-26): an agent-added test that hangs on two containers, the trusted control passing on the second, fails pass_to_pass with a clear note; the oracle still decides", async () => {
  const { bc, agentRuns } = hangs("always");
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_81000,
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(log.error, null);
  assertEquals(judgment.verdict, "fail");
  assertEquals(judgment.scorers.map((s) => s.passed), [true, false, true]);
  assertEquals(judgment.scorers[2]!.tests[0]!.outcome, "pass");
  assert(
    judgment.scorers[1]!.tests.some((t) =>
      t.codeunit === 81000 && t.procedure === "AgentTest" &&
      t.outcome === "not_run" && t.failure === "runtime_error"
    ),
  );
  assert(
    judgment.scorers[1]!.tests.some((t) =>
      t.codeunit === 80010 && t.outcome === "pass"
    ),
  );
  // The oracle and the visible tests ran before any agent-added codeunit.
  const order = bc.tests.map((t) => t.codeunit);
  assert(order.indexOf(85000) < order.indexOf(81000));
  assert(order.indexOf(80010) < order.indexOf(81000));
  // Two agent runs on two containers; the control ran right before the rerun.
  assertEquals(agentRuns.length, 2);
  const [first, second] = agentRuns as [string, string];
  assert(first !== second);
  const onSecond = bc.tests.filter((t) => t.container === second).map((t) =>
    t.codeunit
  );
  assertEquals(onSecond.slice(-2), [80010, 81000]);
  const notes = log.notes.join("\n");
  assertStringIncludes(
    notes,
    `rerun on ${second} after a passing trusted control`,
  );
  assertStringIncludes(
    notes,
    `agent-added test codeunit 81000 did not complete on ${first} and on ${second} (the trusted control passed on ${second}): the agent's failure`,
  );
});

Deno.test("judge (H-26): an agent-added test that times out on one container and passes on another passes pass_to_pass", async () => {
  const { bc, agentRuns } = hangs("first");
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_81000,
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(judgment.verdict, "pass");
  assertEquals(judgment.scorers.map((s) => s.passed), [true, true, true]);
  assert(
    judgment.scorers[1]!.tests.some((t) =>
      t.codeunit === 81000 && t.outcome === "pass"
    ),
  );
  assertEquals(agentRuns.length, 2);
  assertStringIncludes(
    log.notes.join("\n"),
    `rerun on ${agentRuns[1]} after a passing trusted control`,
  );
  assert(agentRuns[0] !== agentRuns[1]);
});

Deno.test("judge (H-26): an agent-added test that times out with no other container is unscored, never a fail", async () => {
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_81000,
  });
  const { judgment, log } = await judge(
    new BcLane(hangs("first").bc, ["C1"]),
    input,
  );
  assertEquals(judgment.scorers.map((s) => s.passed), [true, null, true]);
  assertEquals(judgment.verdict, "unscored");
  assert(
    judgment.scorers[1]!.tests.some((t) =>
      t.codeunit === 81000 && t.failure === "infra"
    ),
  );
  assertStringIncludes(log.notes.join("\n"), "agent-added test rerun infra");
  // No rerun was dispatched, so none is recorded as a retry.
  assertEquals(
    log.infra_retries.filter((r) => r.fingerprint === "h26-agent-test-rerun"),
    [],
  );
});

Deno.test("judge (H-26): a trusted control that fails on the rerun container leaves pass_to_pass unscored, never a fail", async () => {
  const { bc } = hangs("always");
  const inner = bc.script;
  // The shipped test passes in the trusted run, then fails: the rerun
  // container cannot vouch for the agent rerun.
  let shipped = 0;
  bc.script = (cu, deployed, container) =>
    cu === 80010 && ++shipped > 1
      ? result({ ShippedPasses: "Assert.IsTrue failed. degraded" })
      : inner(cu, deployed, container);
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_81000,
  });
  const { judgment } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(judgment.scorers.map((s) => s.passed), [true, null, true]);
  assertEquals(judgment.verdict, "unscored");
});

Deno.test("judge (H-26): with the trusted pass_to_pass already failing, a hanging agent-added test cannot unscore the fail", async () => {
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_81000,
    "Rental/src/Break.al": `codeunit 70210 "Break"\n{\n    // BREAK_P2P\n}\n`,
  });
  const { judgment } = await judge(
    new BcLane(hangs("always").bc, ["C1", "C2"]),
    input,
  );
  assertEquals(judgment.scorers[1]!.passed, false);
  assertEquals(judgment.verdict, "fail");
});

// H-26 Sol review r2: per codeunit, a completed result stays decided.

const AGENT_81001 = AGENT_81000.replace("81000", "81001").replace(
  '"Agent"',
  '"Agent B"',
);

Deno.test("judge (H-26 review): a completed agent-added failure decides pass_to_pass: another codeunit's hang is not rerun and cannot unscore it, even with no other container", async () => {
  for (const containers of [["C1"], ["C1", "C2"]]) {
    const { bc, agentRuns } = hangs("first");
    const inner = bc.script;
    const runsB: string[] = [];
    bc.script = (cu, deployed, container) => {
      if (cu === 81001) {
        runsB.push(container);
        return result({ AgentTest: "Assert.AreEqual failed. agent bug" });
      }
      return inner(cu, deployed, container);
    };
    const { input } = await setup("correct", {
      "Test/src/Agent.Test.al": AGENT_81000,
      "Test/src/AgentB.Test.al": AGENT_81001,
    });
    const { judgment, log } = await judge(new BcLane(bc, containers), input);
    const tag = containers.join(",");
    assertEquals(judgment.scorers[1]!.passed, false, tag);
    assertEquals(judgment.verdict, "fail", tag);
    assertEquals([runsB.length, agentRuns.length], [1, 1], tag);
    assertEquals(
      judgment.scorers[1]!.tests.filter((t) => t.codeunit >= 81000).map((t) => [
        t.codeunit,
        t.outcome,
        t.failure,
      ]),
      [[81000, "not_run", "runtime_error"], [81001, "fail", "assertion"]],
      tag,
    );
    assert(!log.notes.join("\n").includes("rerun on"), tag);
  }
});

Deno.test("judge (H-26 review): the rerun repeats the agent suite in order; a codeunit that hangs again in the same context is the agent's failure", async () => {
  // 81001 hangs whenever 81000 ran before it on the same container.
  const bc = script();
  const inner = bc.script;
  const ranA = new Set<string>();
  const runsB: string[] = [];
  bc.script = (cu, deployed, container) => {
    if (cu === 81000) ranA.add(container);
    if (cu === 81001) {
      runsB.push(container);
      if (ranA.has(container)) {
        throw new ContainerError(
          `harness SOAP call timed out after 120000ms`,
          container,
          "test",
        );
      }
      return result({ AgentTest: true });
    }
    return inner(cu, deployed, container);
  };
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_81000,
    "Test/src/AgentB.Test.al": AGENT_81001,
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(judgment.verdict, "fail");
  assertEquals(runsB.length, 2);
  assert(runsB[0] !== runsB[1]);
  assert(
    judgment.scorers[1]!.tests.some((t) =>
      t.codeunit === 81001 && t.outcome === "not_run" &&
      t.failure === "runtime_error"
    ),
  );
  assertStringIncludes(
    log.notes.join("\n"),
    `agent-added test codeunit 81001 did not complete on ${runsB[0]} and on ${
      runsB[1]
    }`,
  );
  assertEquals(
    log.infra_retries.filter((r) => r.fingerprint === "h26-agent-test-rerun")
      .map((r) => [r.originalContainerName, r.retryContainerName, r.outcome]),
    [[runsB[0], runsB[1], "succeeded"]],
  );
});

Deno.test("judge (H-26 review): two codeunits hang on the first run; on the rerun one recovers and one hangs again: only that one is the agent's failure", async () => {
  const bc = script();
  const inner = bc.script;
  const seen = new Map<number, number>();
  bc.script = (cu, deployed, container) => {
    if (cu === 81000 || cu === 81001) {
      const n = (seen.get(cu) ?? 0) + 1;
      seen.set(cu, n);
      // 81000 hangs only on its first run; 81001 hangs on every run.
      if (cu === 81001 || n === 1) {
        throw new ContainerError(
          `harness SOAP call timed out after 120000ms`,
          container,
          "test",
        );
      }
      return result({ AgentTest: true });
    }
    return inner(cu, deployed, container);
  };
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_81000,
    "Test/src/AgentB.Test.al": AGENT_81001,
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(judgment.verdict, "fail");
  assertEquals(
    judgment.scorers[1]!.tests.filter((t) => t.codeunit >= 81000).map((t) => [
      t.codeunit,
      t.outcome,
      t.failure,
    ]),
    [[81000, "pass", null], [81001, "not_run", "runtime_error"]],
  );
  const notes = log.notes.join("\n");
  assertStringIncludes(
    notes,
    "agent-added test codeunit 81001 did not complete on",
  );
  assert(
    !notes.includes(
      "agent-added test codeunit 81000 did not complete on C1 and",
    ),
  );
  assert(
    !notes.includes(
      "agent-added test codeunit 81000 did not complete on C2 and",
    ),
  );
});

Deno.test("judge (H-26 review): a codeunit that passed on the first run and throws only on the rerun keeps its first result", async () => {
  const { bc, agentRuns } = hangs("first");
  const inner = bc.script;
  const runsB: string[] = [];
  bc.script = (cu, deployed, container) => {
    if (cu === 81001) {
      runsB.push(container);
      if (runsB.length === 2) {
        throw new ContainerError(
          `harness SOAP call timed out after 120000ms`,
          container,
          "test",
        );
      }
      return result({ AgentTest: true });
    }
    return inner(cu, deployed, container);
  };
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_81000,
    "Test/src/AgentB.Test.al": AGENT_81001,
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(judgment.verdict, "pass");
  assertEquals([agentRuns.length, runsB.length], [2, 2]);
  assert(!log.notes.join("\n").includes("81001 did not complete on C1 and"));
  assert(!log.notes.join("\n").includes("81001 did not complete on C2 and"));
});

Deno.test("judge (H-26 review): only the codeunit that hung takes the rerun's results; one that completed keeps its first rows", async () => {
  const { bc, agentRuns } = hangs("first");
  const inner = bc.script;
  const runsB: string[] = [];
  // 81001 passes the first time and fails on the rerun: the first result stands.
  bc.script = (cu, deployed, container) => {
    if (cu === 81001) {
      runsB.push(container);
      return result({
        AgentTest: runsB.length === 1 ? true : "Assert.IsTrue failed. rerun",
      });
    }
    return inner(cu, deployed, container);
  };
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_81000,
    "Test/src/AgentB.Test.al": AGENT_81001,
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(judgment.verdict, "pass");
  assertEquals(runsB.length, 2);
  assertEquals(agentRuns.length, 2);
  assertEquals(
    log.infra_retries.filter((r) => r.fingerprint === "h26-agent-test-rerun")
      .map((r) => [r.originalContainerName, r.retryContainerName, r.outcome]),
    [[agentRuns[0], agentRuns[1], "succeeded"]],
  );
  assertEquals(
    judgment.scorers[1]!.tests.filter((t) => t.codeunit >= 81000).map((t) => [
      t.codeunit,
      t.outcome,
    ]),
    [[81000, "pass"], [81001, "pass"]],
  );
});

Deno.test("judge (H-26 review): with pass_to_pass already failing, an infra fault of the agent-added run cannot unscore the fail", async () => {
  const bc = script();
  const lane = new BcLane(bc, ["C1"]);
  const inner = bc.script;
  // The trusted run's last codeunit takes the only container out of routing:
  // the agent-added run then has no eligible container.
  bc.script = (cu, deployed, container) => {
    if (cu === 85000) lane.quarantine("C1", "degraded after the trusted run");
    return inner(cu, deployed, container);
  };
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_81000,
    "Rental/src/Break.al": `codeunit 70210 "Break"\n{\n    // BREAK_P2P\n}\n`,
  });
  const { judgment, log } = await judge(lane, input);
  assertEquals(judgment.scorers[1]!.passed, false);
  assertEquals(judgment.verdict, "fail");
  assert(!bc.tests.some((t) => t.codeunit === 81000));
  assertStringIncludes(log.notes.join("\n"), "agent-added tests infra");
});

Deno.test("judge: an agent-added test reporting no result for a discovered procedure is runtime_error, not infra", async () => {
  const added = `codeunit 81000 "Agent"
{
    Subtype = Test;

    [Test]
    procedure AgentTest()
    begin
    end;

    [Test]
    procedure Other()
    begin
    end;
}
`;
  const { input } = await setup("correct", { "Test/src/Agent.Test.al": added });
  const { judgment } = await judge(new BcLane(script(), ["C1"]), input);
  assertEquals(judgment.verdict, "fail");
  const row = judgment.scorers[1]!.tests.find((t) => t.procedure === "Other")!;
  assertEquals([row.outcome, row.failure], ["not_run", "runtime_error"]);
  assertEquals(judgment.scorers[2]!.passed, true);
});

Deno.test("judge: an oracle publish failure is infra, never the agent's failure", async () => {
  const bc = script();
  bc.publishFailure = (_c, name) =>
    name === "CGR Oracle HX-001"
      ? "The schema synchronization failed: destructive changes"
      : null;
  const { input } = await setup("correct");
  const { judgment } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.verdict, "unscored");
  assertEquals(judgment.scorers.map((s) => s.passed), [true, null, null]);
});

Deno.test("judge: an oracle publish failure on one container rejudges on another", async () => {
  const bc = script();
  bc.publishFailure = (c, name) =>
    c === "C1" && name === "CGR Oracle HX-001"
      ? "The schema synchronization failed: destructive changes"
      : null;
  const { input } = await setup("correct");
  const { judgment } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(judgment.verdict, "pass");
  assertEquals(judgment.verdict_container, "C2");
});

// Decision 2026-09-25-verdict-fail-wins: a false scorer makes the verdict fail; null scorers stay null.

/** 80010 reports a result without ShippedPasses (a missing listed procedure: infra row). */
function missingShipped() {
  const bc = script();
  const inner = bc.script;
  bc.script = (cu, deployed, container) =>
    cu === 80010 ? result({ Other: true }) : inner(cu, deployed, container);
  return bc;
}

Deno.test("judge: an oracle compile failure with pass_to_pass infra is a fail", async () => {
  const bc = missingShipped();
  bc.onCompile = async (dir) => {
    if (dir.replaceAll("\\", "/").endsWith("/oracle")) {
      await Deno.writeTextFile(join(dir, "Broken.al"), "COMPILE_ERROR");
    }
  };
  const { input } = await setup("correct");
  const { judgment } = await judge(new BcLane(bc, ["C1"]), input);
  JudgmentRecordSchema.parse(judgment);
  assertEquals(judgment.scorers.map((s) => s.passed), [true, null, false]);
  assertEquals(judgment.scorers[2]!.tests[0]!.failure, "compile");
  assertEquals(judgment.verdict, "fail");
});

Deno.test("judge (H-26): an oracle that does not compile against the candidate names why in test_messages", async () => {
  const bc = script();
  bc.onCompile = async (dir) => {
    if (dir.replaceAll("\\", "/").endsWith("/oracle")) {
      await Deno.writeTextFile(join(dir, "Broken.al"), "COMPILE_ERROR");
    }
  };
  const { input } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.scorers[2]!.passed, false);
  const m = log.test_messages.filter((x) => x.codeunit === 85000);
  assertEquals(m.length, 1);
  assertEquals([m[0]!.procedure, m[0]!.target], [
    "(oracle build)",
    "candidate",
  ]);
  assertStringIncludes(
    m[0]!.message,
    "oracle does not compile against the candidate: AL0001",
  );
});

Deno.test("judge: a fail_to_pass assertion with a missing pass_to_pass procedure is a fail", async () => {
  const { input } = await setup("naive/a");
  const { judgment } = await judge(new BcLane(missingShipped(), ["C1"]), input);
  JudgmentRecordSchema.parse(judgment);
  assertEquals(judgment.scorers.map((s) => s.passed), [true, null, false]);
  assert(
    judgment.scorers[1]!.tests.some((t) =>
      t.procedure === "ShippedPasses" && t.failure === "infra"
    ),
  );
  assertEquals(judgment.scorers[2]!.tests[0]!.failure, "assertion");
  assertEquals(judgment.verdict, "fail");
});

Deno.test("judge: an agent-added failing test written as [ Test ] is discovered and fails pass_to_pass", async () => {
  const bc = script();
  const inner = bc.script;
  bc.script = (cu, deployed, container) =>
    cu === 81003
      ? result({ Fails: "Assert.IsTrue failed. agent" })
      : inner(cu, deployed, container);
  const { input } = await setup("correct", {
    "Test/src/Spaced.Test.al":
      `codeunit 81003 "Spaced"\n{\n    Subtype = Test;\n\n    [ Test ]\n    procedure Fails()\n    begin\n    end;\n}\n`,
  });
  const { judgment } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.verdict, "fail");
  assertEquals(judgment.scorers[1]!.passed, false);
  assert(
    judgment.scorers[1]!.tests.some((t) =>
      t.codeunit === 81003 && t.procedure === "Fails" &&
      t.failure === "assertion"
    ),
  );
});

/**
 * A lock of System, Base Application, Application and Library Assert, with
 * this lock's app info already harvested (M1-40b): builds restore only the
 * declared dependency closure.
 */
async function harvestedLock() {
  const store = await Deno.realPath(await testTempDir());
  const SYSTEM = "8874ed3a-0643-4247-9ced-7a7002f7135d";
  const APPLICATION = "c1335042-3002-4257-bf8a-75c898ccb1b8";
  const BASE = "437dbf0e-84ff-417a-965d-ed2bb9650972";
  const pkgs: Array<[string, string, string[]]> = [
    [SYSTEM, "System", []],
    [BASE, "Base Application", [SYSTEM]],
    [APPLICATION, "Application", [BASE]],
    [IDS.assert, "Library Assert", [SYSTEM]],
  ];
  const packages = [];
  const info: Record<string, unknown> = {};
  for (const [id, name, deps] of pkgs) {
    const file = `Microsoft_${name}_28.0.0.0.app`;
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
    info[`.\\${file}`] = {
      appId: id,
      name,
      publisher: "Microsoft",
      version: "28.0.0.0",
      application: "",
      platform: "28.0.0.0",
      propagateDependencies: false,
      dependencies: deps.map((d) => ({
        id: d,
        name: d,
        publisher: "Microsoft",
        version: "28.0.0.0",
      })),
    };
  }
  const digest = await hashJson({
    lock: packages.map((p) => [p.file, p.sha256]),
  });
  await Deno.mkdir(join(store, "appinfo"), { recursive: true });
  await Deno.writeTextFile(
    join(store, "appinfo", `${digest}.json`),
    JSON.stringify(info),
  );
  return { store, packages };
}

Deno.test("judge: the oracle build gets its workspace dependencies' declared symbols in the closure (M1-40b)", async () => {
  const bc = script();
  // Rental (a workspace dependency of the oracle) declares Library Assert; the
  // oracle itself does not, yet uses it through Rental's surface.
  const { input } = await setup("correct", {
    "Rental/app.json": appJson(IDS.rental, "CGR Rental", [70200, 70299], [
      { id: IDS.core, name: "CGR Core" },
      { id: IDS.assert, name: "Library Assert" },
    ]),
  });
  const oracle = join(input.task.dir, "oracle");
  const aj = JSON.parse(await Deno.readTextFile(join(oracle, "app.json")));
  aj.dependencies = aj.dependencies.filter((d: { id: string }) =>
    d.id.toLowerCase() !== IDS.assert
  );
  await Deno.writeTextFile(join(oracle, "app.json"), JSON.stringify(aj));
  const src = join(oracle, "src", "Oracle.Test.al");
  await Deno.writeTextFile(
    src,
    (await Deno.readTextFile(src)) +
      "\n// needs Microsoft_Library Assert_28.0.0.0.app\n",
  );
  const { judgment } = await judge(new BcLane(bc, ["C1"]), {
    ...input,
    lock: await harvestedLock(),
  });
  assertEquals(
    judgment.scorers.find((x) => x.name === "fail_to_pass")!.passed,
    true,
  );
  assertEquals(judgment.verdict, "pass");
});

Deno.test("judge: a BOM app.json in the artifact judges the same as one without", async () => {
  const bc = script();
  const { input } = await setup("correct", {
    "Rental/app.json": "\uFEFF" +
      appJson(IDS.rental, "CGR Rental", [70200, 70299], [{
        id: IDS.core,
        name: "CGR Core",
      }]),
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(log.violations, []);
  assertEquals(judgment.verdict, "pass");
});

Deno.test("infraSignature (C-03 run 002): judge error, or build failed with 0 diagnostics and 0 tests; nothing else", () => {
  const id = "00000000-0000-4000-a000-00000000c030";
  const eid = "00000000-0000-4000-9000-00000000c030";
  const j = JudgmentRecordSchema.parse({
    v: 1,
    id,
    execution_id: eid,
    workspace_hash: "0".repeat(64),
    task_id: "HX-001",
    task_oracle_hash: "a".repeat(64),
    scorer_versions: { build: "1" },
    scorer_fingerprint: "b".repeat(64),
    scorers: [
      { name: "build", passed: false, tests: [] },
      { name: "fail_to_pass", passed: false, tests: [] },
    ],
    verdict: "fail",
    verdict_container: null,
    started_at: "2026-09-28T11:38:35.000Z",
    ended_at: "2026-09-28T11:39:06.426Z",
  });
  const log = {
    v: 1,
    judgment_id: id,
    execution_id: eid,
    violations: [],
    diagnostics: [],
    test_messages: [],
    notes: ["build failed: Test (no diagnostics)"],
    error: null,
  };
  assertEquals(
    infraSignature(j, log),
    "build_failed_no_diagnostics_no_tests",
  );
  assertEquals(
    infraSignature(j, { ...log, notes: [], error: "NoEligibleContainers" }),
    "judge_error",
  );
  const test = {
    codeunit: 50100,
    procedure: "T",
    target: "candidate",
    outcome: "fail",
    failure: "assertion",
  };
  const none: [string, unknown][] = [
    ["no log", null],
    ["not an object", "build failed: x"],
    ["other judgment", { ...log, judgment_id: eid }],
    ["other execution", { ...log, execution_id: id }],
    ["a diagnostic", {
      ...log,
      diagnostics: [{ app: "c/Test", code: "AL0118", message: "m" }],
    }],
    ["no build note", { ...log, notes: [] }],
    ["oracle build note", { ...log, notes: ["oracle build failed: x"] }],
    ["blank error", { ...log, notes: [], error: "" }],
    ["malformed notes", { ...log, notes: "build failed: x" }],
    ["malformed diagnostics", { ...log, diagnostics: undefined }],
  ];
  for (const [what, l] of none) {
    assertEquals(infraSignature(j, l), null, what);
  }
  // A test result recorded: the build did not simply starve.
  const withTest = JudgmentRecordSchema.parse({
    ...j,
    scorers: [j.scorers[0], { ...j.scorers[1]!, tests: [test] }],
  });
  assertEquals(infraSignature(withTest, log), null);
});

Deno.test("infraSignature (C-03 run 003): a judge error after real oracle rows is no signature (a genuine FAIL)", () => {
  const id = "00000000-0000-4000-a000-00000000c031";
  const eid = "00000000-0000-4000-9000-00000000c031";
  const j = JudgmentRecordSchema.parse({
    v: 1,
    id,
    execution_id: eid,
    workspace_hash: "0".repeat(64),
    task_id: "HX-001",
    task_oracle_hash: "a".repeat(64),
    scorer_versions: { build: "1" },
    scorer_fingerprint: "b".repeat(64),
    scorers: [
      { name: "build", passed: true, tests: [] },
      {
        name: "fail_to_pass",
        passed: false,
        tests: [{
          codeunit: 50100,
          procedure: "T",
          target: "candidate",
          outcome: "fail",
          failure: "assertion",
        }],
      },
      { name: "pass_to_pass", passed: null, tests: [] },
    ],
    verdict: "fail",
    verdict_container: null,
    started_at: "2026-09-28T11:38:35.000Z",
    ended_at: "2026-09-28T11:39:06.426Z",
  });
  const log = {
    v: 1,
    judgment_id: id,
    execution_id: eid,
    diagnostics: [],
    notes: [],
    error: "held container lost",
  };
  assertEquals(infraSignature(j, log), null);
  // The same error with no test result anywhere stays a signature.
  const bare = JudgmentRecordSchema.parse({
    ...j,
    scorers: j.scorers.map((s) => ({ ...s, tests: [] })),
  });
  assertEquals(infraSignature(bare, log), "judge_error");
});

// ---- H-04: a crashed build is infrastructure, never a scored model failure ----

const CASCADE = {
  app: "candidate/Test",
  code: "CG0001",
  message: "dependency Rental did not build",
};

Deno.test("judge (H-04): a candidate build crash in a multi-app workspace (no diagnostic, dependents cascade) is unscored, never a fail", async () => {
  const bc = script();
  bc.crashFor = (p) =>
    /\/apps\/.*\/Rental$/.test(p) || p.endsWith("/apps/Rental");
  const { input } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  // The fixture is multi-app: the dependent Test failed too (its cascade
  // diagnostic was ignored). H-04b: thrown inside the build, before the log.
  assertStringIncludes(log.error ?? "", "Rental, Test");
  assertEquals(judgment.verdict, "unscored");
  assertEquals(judgment.scorers.map((s) => s.passed), [null, null, null]);
  assertEquals(bc.tests, []);
  assertStringIncludes(log.error ?? "", "no compiler diagnostic");
});

Deno.test("judge (H-04): an oracle build crash is unscored, never a fail_to_pass failure", async () => {
  const bc = script();
  bc.crashFor = (p) => p.endsWith("/oracle");
  const { input } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.verdict, "unscored");
  assertEquals(
    judgment.scorers.find((s) => s.name === "fail_to_pass")!.passed,
    null,
  );
  assertEquals(
    judgment.scorers.flatMap((s) => s.tests).filter((t) =>
      t.failure === "compile"
    ),
    [],
  );
  assertStringIncludes(log.error ?? "", "oracle");
});

Deno.test("judge (H-04): a genuine compile error with the same cascade stays the model's failure", async () => {
  const bc = script();
  const { input } = await setup("correct", {
    "Rental/src/Broken.al": "COMPILE_ERROR",
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  assert(log.diagnostics.some((d) => d.code === "CG0001"));
  assertEquals(judgment.verdict, "fail");
  assertEquals(judgment.scorers.map((s) => s.passed), [false, false, false]);
  assertEquals(log.error, null);
});

Deno.test("judge (H-04): a genuine oracle compile error stays a fail_to_pass failure", async () => {
  const bc = script();
  bc.errorsFor = (folder) =>
    folder === "oracle"
      ? [{
        code: "AL0118",
        message: "oracle broke",
        file: "O.al",
        line: 1,
        column: 1,
        severity: "error",
      }]
      : [];
  const { input } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.verdict, "fail");
  assertEquals(judgment.scorers[2]!.tests[0]!.failure, "compile");
  assertEquals(log.error, null);
});

Deno.test("infraSignature (H-04): only the dependency cascade is no diagnostic; any genuine one still is", () => {
  const id = "00000000-0000-4000-a000-00000000c040";
  const eid = "00000000-0000-4000-9000-00000000c040";
  const j = JudgmentRecordSchema.parse({
    v: 1,
    id,
    execution_id: eid,
    workspace_hash: "0".repeat(64),
    task_id: "HX-001",
    task_oracle_hash: "a".repeat(64),
    scorer_versions: { build: "1" },
    scorer_fingerprint: "b".repeat(64),
    scorers: [
      { name: "build", passed: false, tests: [] },
      { name: "fail_to_pass", passed: false, tests: [] },
    ],
    verdict: "fail",
    verdict_container: null,
    started_at: "2026-10-13T11:38:35.000Z",
    ended_at: "2026-10-13T11:39:06.426Z",
  });
  const log = {
    v: 1,
    judgment_id: id,
    execution_id: eid,
    violations: [],
    diagnostics: [CASCADE],
    test_messages: [],
    notes: ["build failed: Rental (no diagnostics); Test CG0001"],
    error: null,
  };
  assertEquals(infraSignature(j, log), "build_failed_no_diagnostics_no_tests");
  for (
    const d of [
      { app: "candidate/Rental", code: "AL0118", message: "m" },
      // Other synthetic CG0001 refusals are the agent's own build failure.
      {
        app: "candidate/Test",
        code: "CG0001",
        message: "dependency x is not in the symbols lock or the workspace",
      },
    ]
  ) {
    assertEquals(
      infraSignature(j, { ...log, diagnostics: [CASCADE, d] }),
      null,
      d.message,
    );
  }
});

Deno.test("isCascadeDiagnostic (H-04): exactly the dependency-did-not-build entry", () => {
  assertEquals(isCascadeDiagnostic(CASCADE), true);
  assertEquals(isCascadeDiagnostic({ ...CASCADE, code: "AL0001" }), false);
  assertEquals(
    isCascadeDiagnostic({
      ...CASCADE,
      message: "dependency x is not in the symbols lock or the workspace",
    }),
    false,
  );
});

// ---- H-04b: a crashed build reroutes inside the judgment; a crashed prerequisite is infra ----

/** Crash the first compile matching `match`, on whatever container it lands. */
function crashOnce(bc: FakeBc, match: (p: string) => boolean) {
  /** Containers of every matching compile, in order: the first one crashed. */
  const seen: string[] = [];
  bc.crashFor = (p, c) => {
    if (!match(p)) return false;
    seen.push(c);
    return seen.length === 1;
  };
  return seen;
}

/** The first matching compile crashed and the retry ran on another container. */
function assertRerouted(seen: string[]) {
  assert(seen.length >= 2 && seen[1] !== seen[0], JSON.stringify(seen));
}

Deno.test("judge (H-04b): a candidate build that crashes once reroutes to another container and is scored", async () => {
  const bc = script();
  const crashed = crashOnce(
    bc,
    (p) => p.includes("/candidate/") && p.endsWith("/Rental"),
  );
  const { input } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertRerouted(crashed);
  assertEquals(judgment.verdict, "pass", JSON.stringify(log.notes));
  assertEquals(log.error, null);
});

Deno.test("judge (H-04b): an oracle build that crashes once reroutes to another container and is scored", async () => {
  const bc = script();
  const crashed = crashOnce(bc, (p) => p.endsWith("/oracle"));
  const { input } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertRerouted(crashed);
  assertEquals(judgment.verdict, "pass", JSON.stringify(log.notes));
});

Deno.test("judge (H-04b): a staged prerequisite build that crashes once reroutes and is scored", async () => {
  const bc = script();
  const crashed = crashOnce(bc, (p) => p.includes("/prereq/"));
  const { input } = await setup("correct");
  const { judgment } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertRerouted(crashed);
  assertEquals(judgment.verdict, "pass");
});

Deno.test("judge (H-04b): a staged prerequisite that crashes on every container is unscored, not a task error", async () => {
  const bc = script();
  bc.crashFor = (p) => p.includes("/prereq/");
  const { input } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(judgment.verdict, "unscored");
  assertStringIncludes(log.error ?? "", "no compiler diagnostic");
});

Deno.test("judge (H-04b): a staged prerequisite with a genuine compile error is still a task error", async () => {
  const bc = script();
  bc.errorsFor = (folder) =>
    folder === "Core"
      ? [{
        code: "AL0118",
        message: "core broke",
        file: "C.al",
        line: 1,
        column: 1,
        severity: "error",
      }]
      : [];
  const { input } = await setup("correct");
  await assertRejects(
    () => judge(new BcLane(bc, ["C1"]), input),
    ValidationError,
    "staged prerequisite Core does not compile",
  );
});

Deno.test("judge (M4-17a): a test added to a shipped test codeunit runs under pass_to_pass from the generated codeunit; a failing one fails it", async () => {
  const shipped = (body: string) =>
    `codeunit 80010 "CGR Shipped Tests"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure ShippedPasses()\n    begin\n    end;\n\n    [Test]\n    procedure AgentAdded()\n    begin\n        ${body}\n    end;\n}\n`;
  for (
    const [body, verdict] of [["Message('ok');", "pass"], [
      "Error('no');",
      "fail",
    ]] as const
  ) {
    const bc = script();
    const inner = bc.script;
    bc.script = (cu, deployed, container) =>
      cu === 84990
        ? result({
          AgentAdded:
            deployedSource(deployed, "CGR Test").includes("Error('no')")
              ? "Assert.IsTrue failed. agent"
              : true,
        })
        : inner(cu, deployed, container);
    const { input } = await setup("correct", {
      "Test/src/Shipped.Test.al": shipped(body),
    });
    const { judgment } = await judge(new BcLane(bc, ["C1"]), input);
    assertEquals(judgment.verdict, verdict, body);
    assert(
      judgment.scorers[1]!.tests.some((t) =>
        t.codeunit === 84990 && t.procedure === "AgentAdded"
      ),
    );
  }
});
