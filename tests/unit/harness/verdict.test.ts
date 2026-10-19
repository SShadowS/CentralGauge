import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import {
  ConfigurationError,
  ContainerError,
  ValidationError,
} from "../../../src/errors.ts";
import { UNCONFIGURED_RESET } from "../../../src/harness/reset.ts";
import {
  appVersions,
  BcLane,
  buildApps,
  changedApps,
  CLOUD_POLICY,
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
  assertSameProduction,
  buildFailureCodes,
  currentScorerFingerprint,
  effectiveScorers,
  infraSignature,
  isCascadeDiagnostic,
  isCurrentJudgment,
  judge,
  SCORER_SUITE,
  writeVerdictLog,
} from "../../../src/harness/verdict.ts";
import {
  deployedSource,
  type FakeApp,
  FakeBc,
  OK_RESET,
  result,
} from "./fake-bc.ts";
import { appJson, IDS, makeRefappRepo, write } from "./refapp-fixture.ts";
import { hashFile, hashJson, hashTree } from "../../../src/harness/hash.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

/** Shipped test passes unless Rental carries BREAK_P2P; the oracle passes iff Rental returns 10. */
function scripted(cu: number, deployed: Map<string, FakeApp>) {
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
}

function script() {
  return new FakeBc(scripted);
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
      deploy: { ledgerRoot: join(results, "bc-ledger"), reset: OK_RESET },
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
    ["agent_tests", true],
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
  // H-35 (versionPlan "judge"): every production app is a candidate, so the
  // cleanup removes Core too (it was a kept prerequisite before).
  assert(cleanup.removeIds.includes(IDS.core));
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

// H-35 supersedes H-27 r2 #4 (rulings r5: separate judge and agent caches,
// against PackageId prelearning): the judge reuses none of the agent's builds.
Deno.test("judge (H-35, was H-27 r2 #4): builds the agent's compile path wrote are not reused by the judge, and it scores as without them", async () => {
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
    versionPlan: "backend",
  });
  const agent = await buildApps(bc, "C1", {
    srcDir: input.artifact,
    apps,
    versions,
    outDir: await Deno.makeTempDir(),
    lock: input.lock,
    cache,
    graph: apps,
    policy: CLOUD_POLICY,
  });
  assert(agent.every((b) => b.ok && b.key));
  const cold = await judge(lane, (await setup("correct")).input);
  const warm = await judge(lane, { ...input, buildCache: cache });
  assertEquals(warm.log.per_app_compiles, cold.log.per_app_compiles);
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
  assertEquals(judgment.scorers.map((s) => s.passed), [
    false,
    false,
    false,
    false,
  ]);
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

Deno.test("judge: agent-added tests run under agent_tests; a TestPage test fails with a reason", async () => {
  const added =
    `codeunit 81000 "Agent"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure AgentTest()\n    begin\n    end;\n}\n`;
  const ok = await setup("correct", { "Test/src/Agent.Test.al": added });
  const r1 = await judge(new BcLane(script(), ["C1"]), ok.input);
  assertEquals(r1.judgment.verdict, "pass");
  assert(
    r1.judgment.scorers[3]!.tests.some((t) =>
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
    r2.judgment.scorers[3]!.tests.some((t) =>
      t.codeunit === 81001 && t.outcome === "not_run" &&
      t.failure === "runtime_error"
    ),
  );
});

Deno.test("scorer suite: every scorer, one fingerprint for every task kind", () => {
  assertEquals(Object.keys(SCORER_SUITE).sort(), [
    "agent_tests",
    "build",
    "fail_to_pass",
    "mutant_kill",
    "pass_to_pass",
  ]);
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
  assertEquals(judgment.scorers.map((s) => s.passed), [null, null, null, null]);
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
  assertEquals(judgment.scorers.map((s) => s.passed), [null, null, null, null]);
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

Deno.test("judge (H-26): an agent-added test that hangs on two containers, the trusted control passing on the second, fails agent_tests with a clear note; the oracle still decides", async () => {
  const { bc, agentRuns } = hangs("always");
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_81000,
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(log.error, null);
  assertEquals(judgment.verdict, "fail");
  assertEquals(judgment.scorers.map((s) => s.passed), [
    true,
    true,
    true,
    false,
  ]);
  assertEquals(judgment.scorers[2]!.tests[0]!.outcome, "pass");
  assert(
    judgment.scorers[3]!.tests.some((t) =>
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

Deno.test("judge (H-26): an agent-added test that times out on one container and passes on another passes agent_tests", async () => {
  const { bc, agentRuns } = hangs("first");
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_81000,
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(judgment.verdict, "pass");
  assertEquals(judgment.scorers.map((s) => s.passed), [true, true, true, true]);
  assert(
    judgment.scorers[3]!.tests.some((t) =>
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
  assertEquals(judgment.scorers.map((s) => s.passed), [true, true, true, null]);
  assertEquals(judgment.verdict, "unscored");
  assert(
    judgment.scorers[3]!.tests.some((t) =>
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

Deno.test("judge (H-26): a trusted control that fails on the rerun container leaves agent_tests unscored, never a fail", async () => {
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
  assertEquals(judgment.scorers.map((s) => s.passed), [true, true, true, null]);
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

Deno.test("judge (H-26 review): a completed agent-added failure decides agent_tests: another codeunit's hang is not rerun and cannot unscore it, even with no other container", async () => {
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
    assertEquals(judgment.scorers[3]!.passed, false, tag);
    assertEquals(judgment.verdict, "fail", tag);
    assertEquals([runsB.length, agentRuns.length], [1, 1], tag);
    assertEquals(
      judgment.scorers[3]!.tests.filter((t) => t.codeunit >= 81000).map((t) => [
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
    judgment.scorers[3]!.tests.some((t) =>
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
    judgment.scorers[3]!.tests.filter((t) => t.codeunit >= 81000).map((t) => [
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
    judgment.scorers[3]!.tests.filter((t) => t.codeunit >= 81000).map((t) => [
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
  const row = judgment.scorers[3]!.tests.find((t) => t.procedure === "Other")!;
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
  assertEquals(judgment.scorers.map((s) => s.passed), [true, null, null, null]);
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
  assertEquals(judgment.scorers.map((s) => s.passed), [
    true,
    null,
    false,
    true,
  ]);
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
  assertEquals(judgment.scorers.map((s) => s.passed), [
    true,
    null,
    false,
    true,
  ]);
  assert(
    judgment.scorers[1]!.tests.some((t) =>
      t.procedure === "ShippedPasses" && t.failure === "infra"
    ),
  );
  assertEquals(judgment.scorers[2]!.tests[0]!.failure, "assertion");
  assertEquals(judgment.verdict, "fail");
});

Deno.test("judge: an agent-added failing test written as [ Test ] is discovered and fails agent_tests", async () => {
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
  assertEquals(judgment.scorers[3]!.passed, false);
  assert(
    judgment.scorers[3]!.tests.some((t) =>
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
  // H-35 (R2, Q9): a production dependency on a test framework needs the
  // task's reviewed grant; the closure is what this test is about.
  const task = {
    ...input.task,
    task: {
      ...input.task.task,
      production_allow: { dependencies: [IDS.assert] },
    },
  };
  const { judgment } = await judge(new BcLane(bc, ["C1"]), {
    ...input,
    task,
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
  assertEquals(judgment.scorers.map((s) => s.passed), [null, null, null, null]);
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
  assertEquals(judgment.scorers.map((s) => s.passed), [
    false,
    false,
    false,
    false,
  ]);
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

Deno.test("judge (M4-17a): a test added to a shipped test codeunit runs under agent_tests from the generated codeunit; a failing one fails it", async () => {
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
      judgment.scorers[3]!.tests.some((t) =>
        t.codeunit === 84990 && t.procedure === "AgentAdded"
      ),
    );
  }
});

// ---- H-35 S1.3 (design-r2 1, 3, 4.1, 5): graded build G and agent build A ----

const AGENT_TESTS =
  `codeunit 81000 "Agent"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure AgentTest()\n    begin\n    end;\n}\n`;

/** script(), recording what each test run saw: the Test app's source and the oracle. */
function watched() {
  const runs: { codeunit: number; test: string; oracle: boolean }[] = [];
  const bc = new FakeBc((cu, deployed) => {
    runs.push({
      codeunit: cu,
      test: deployedSource(deployed, "CGR Test"),
      oracle: [...deployed.values()].some((a) =>
        a.name === "CGR Oracle HX-001"
      ),
    });
    return scripted(cu, deployed);
  });
  return { bc, runs };
}

Deno.test("H-35: a change judgment runs the shipped and oracle tests on G (pristine Test + oracle) and the agent's tests on A (agent Test, no oracle, no shipped tests); agent rows are agent_tests", async () => {
  const { bc, runs } = watched();
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_TESTS,
  });
  const { judgment } = await judge(new BcLane(bc, ["C1"]), input);
  JudgmentRecordSchema.parse(judgment);
  assertEquals(judgment.scorers.map((s) => [s.name, s.passed]), [
    ["build", true],
    ["pass_to_pass", true],
    ["fail_to_pass", true],
    ["agent_tests", true],
  ]);
  assertEquals(judgment.verdict, "pass");
  const g = runs.filter((r) => r.codeunit !== 81000);
  const a = runs.filter((r) => r.codeunit === 81000);
  assertEquals(g.map((r) => r.codeunit).sort(), [80010, 85000]);
  assert(g.every((r) => r.oracle && !r.test.includes("codeunit 81000")));
  assertEquals(a.length, 1);
  assert(
    !a[0]!.oracle && a[0]!.test.includes("codeunit 81000") &&
      !a[0]!.test.includes("codeunit 80010"),
  );
  assertEquals(judgment.scorers[1]!.tests.map((t) => t.codeunit), [80010]);
  assertEquals(
    judgment.scorers[3]!.tests.map((t) => [t.codeunit, t.outcome]),
    [[81000, "pass"]],
  );
});

Deno.test("H-35: an agent Test that does not compile fails only agent_tests (rows not_run/compile); G is built from the pristine Test and measured", async () => {
  const { bc, runs } = watched();
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_TESTS,
    "Test/src/Broken.Test.al": "COMPILE_ERROR",
  });
  const { judgment } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.scorers.map((s) => [s.name, s.passed]), [
    ["build", true],
    ["pass_to_pass", true],
    ["fail_to_pass", true],
    ["agent_tests", false],
  ]);
  assertEquals(judgment.verdict, "fail");
  assertEquals(judgment.scorers[3]!.tests, [{
    codeunit: 81000,
    procedure: "AgentTest",
    target: "candidate",
    outcome: "not_run",
    failure: "compile",
  }]);
  assertEquals(runs.map((r) => r.codeunit).sort(), [80010, 85000]);
});

Deno.test("H-35: a Test-side violation leaves G measured and fails agent_tests without running A", async () => {
  const { bc, runs } = watched();
  const { input } = await setup("correct", {
    "Test/src/Dup.Test.al": `codeunit 80010 "Dup"\n{\n    Subtype = Test;\n}\n`,
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.scorers.map((s) => [s.name, s.passed]), [
    ["build", true],
    ["pass_to_pass", true],
    ["fail_to_pass", true],
    ["agent_tests", null],
  ]);
  assertEquals(judgment.verdict, "fail");
  assertStringIncludes(log.violations.join("\n"), "collides with shipped");
  assertEquals(runs.map((r) => r.codeunit).sort(), [80010, 85000]);
});

Deno.test("H-35: a production-side violation fails every scorer, agent_tests included, and runs nothing", async () => {
  const bc = script();
  const { input } = await setup("correct", {
    "Rental/app.json": appJson(IDS.rental, "CGR Rental Renamed", [
      70200,
      70299,
    ], [{ id: IDS.core, name: "CGR Core" }]),
    "Test/src/Agent.Test.al": AGENT_TESTS,
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.scorers.map((s) => [s.name, s.passed]), [
    ["build", null],
    ["pass_to_pass", null],
    ["fail_to_pass", null],
    ["agent_tests", null],
  ]);
  assertStringIncludes(log.violations.join("\n"), "name changed");
  assertEquals(bc.tests, []);
});

Deno.test("H-35: no agent test submitted: agent_tests passes with no rows and a not_submitted note", async () => {
  const { input } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(script(), ["C1"]), input);
  assertEquals(judgment.scorers[3]!.name, "agent_tests");
  assertEquals(judgment.scorers[3]!.passed, true);
  assertEquals(judgment.scorers[3]!.tests, []);
  assert(
    log.notes.includes("agent_tests: not_submitted"),
    log.notes.join("\n"),
  );
});

Deno.test("H-35: agent_tests is harness-defined: added to every non-test-authoring task's scorers, never to test-authoring", () => {
  assertEquals(
    effectiveScorers({
      kind: "bugfix",
      scorers: ["build", "pass_to_pass", "fail_to_pass"],
    }),
    ["build", "pass_to_pass", "fail_to_pass", "agent_tests"],
  );
  assertEquals(
    effectiveScorers({
      kind: "test-authoring",
      scorers: ["build", "pass_to_pass", "mutant_kill"],
    }),
    ["build", "pass_to_pass", "mutant_kill"],
  );
});

Deno.test("H-35: scorer versions bumped (build 4, pass_to_pass 6, fail_to_pass 4, mutant_kill 6, agent_tests 1)", () => {
  assertEquals(SCORER_SUITE, {
    build: "4",
    pass_to_pass: "6",
    fail_to_pass: "4",
    mutant_kill: "6",
    agent_tests: "1",
  });
});

Deno.test("H-35 (design-r3 3.2): without a build cache, a change judgment compiles each production app once (G) and A publishes those packages", async () => {
  const bc = script();
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_TESTS,
  });
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.verdict, "pass");
  for (const app of ["Core", "Rental"]) {
    assertEquals(bc.compiles.filter((f) => f === app).length, 1, app);
  }
  assertEquals(bc.compiles.filter((f) => f === "Test").length, 2);
  assert(log.notes.some((n) => /^production manifest: [0-9a-f]{64}$/.test(n)));
});

// ---- H-35 Sol r1 ----

Deno.test("H-35 Sol r1 #3: a freeze violation on a Test path is Test-side: G is still measured", async () => {
  const { bc, runs } = watched();
  const { input } = await setup("correct");
  await Deno.writeTextFile(
    join(input.artifact, ".cg-freeze-violations.txt"),
    "link, reparse point or special file: Test/src/Bad.al\n",
  );
  const { judgment, log } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.scorers.map((s) => [s.name, s.passed]), [
    ["build", true],
    ["pass_to_pass", true],
    ["fail_to_pass", true],
    ["agent_tests", null],
  ]);
  assertStringIncludes(log.violations.join("\n"), "Test/src/Bad.al");
  assertEquals(runs.map((r) => r.codeunit).sort(), [80010, 85000]);
  // A production path stays production-side.
  const p = await setup("correct");
  await Deno.writeTextFile(
    join(p.input.artifact, ".cg-freeze-violations.txt"),
    "link, reparse point or special file: Rental/src/Bad.al\n",
  );
  const r2 = await judge(new BcLane(script(), ["C1"]), p.input);
  assertEquals(r2.judgment.scorers.map((s) => s.passed), [
    null,
    null,
    null,
    null,
  ]);
});

Deno.test("H-35 Sol r1 #4: a Test-side violation fails agent_tests even when G is unscored by infra", async () => {
  const bc = script();
  bc.crashFor = (p) => p.includes("/apps/");
  const { input } = await setup("correct", {
    "Test/src/Install.Codeunit.al":
      `codeunit 81050 "Agent Install"\n{\n    Subtype = Install;\n}\n`,
  });
  const { judgment } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(
    judgment.scorers.find((s) => s.name === "agent_tests")!.passed,
    null,
  );
  assertEquals(judgment.verdict, "fail");
});

Deno.test("H-35 Sol r1 #8: a submitted test the credit rules removed is credit_excluded, not not_submitted", async () => {
  const sneaky =
    `codeunit 81000 "Agent"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure AgentTest()\n    begin\n        Codeunit.Run(80010);\n    end;\n}\n`;
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": sneaky,
  });
  const { log } = await judge(new BcLane(script(), ["C1"]), input);
  assert(
    log.notes.includes("agent_tests: credit_excluded: 1"),
    log.notes.join("\n"),
  );
  assert(!log.notes.includes("agent_tests: not_submitted"));
});

Deno.test("H-35 Sol r2 #3: a freeze violation naming the Test root itself is Test-side", async () => {
  const { input } = await setup("correct");
  await Deno.writeTextFile(
    join(input.artifact, ".cg-freeze-violations.txt"),
    "link, reparse point or special file: Test\n",
  );
  const { judgment } = await judge(new BcLane(script(), ["C1"]), input);
  assertEquals(judgment.scorers.map((s) => s.passed), [
    true,
    true,
    true,
    null,
  ]);
});

// ---- H-35 orchestrator Sol r1 ----

Deno.test("H-35 orch r1 #1: an agent Test app that does not compile fails agent_tests even when no agent test is discovered", async () => {
  const { bc, runs } = watched();
  const { input } = await setup("correct", {
    "Test/src/Broken.al": "COMPILE_ERROR",
  });
  const { judgment } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.scorers.map((s) => [s.name, s.passed]), [
    ["build", true],
    ["pass_to_pass", true],
    ["fail_to_pass", true],
    ["agent_tests", false],
  ]);
  assertEquals(judgment.verdict, "fail");
  assertEquals(runs.map((r) => r.codeunit).sort(), [80010, 85000]);
});

// ---- H-35 S2.1 (design-r2 3 and 5): v2 judgments, the policy gate ----

Deno.test("H-35 S2.1: a clean change judgment is v2: a passed gate, measured scorers, the production manifest in provenance", async () => {
  const { input } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(script(), ["C1"]), input);
  JudgmentRecordSchema.parse(judgment);
  assertEquals(judgment.v, 2);
  assertEquals(judgment.policy, { passed: true, violations: [] });
  assert(judgment.scorers.every((s) => s.state === "measured"));
  const note = log.notes.find((n) => n.startsWith("production manifest: "))!;
  assertEquals(
    judgment.provenance!.production_manifest,
    note.slice("production manifest: ".length),
  );
  assertEquals(judgment.provenance!.env_fp, null);
});

Deno.test("H-35 S2.1: a production-side violation fails the gate and leaves every scorer not_measured", async () => {
  const { input } = await setup("correct", {
    "Rental/app.json": appJson(IDS.rental, "CGR Rental Renamed", [
      70200,
      70299,
    ], [{ id: IDS.core, name: "CGR Core" }]),
  });
  const { judgment } = await judge(new BcLane(script(), ["C1"]), input);
  assertEquals(judgment.verdict, "fail");
  assertEquals(judgment.policy!.passed, false);
  assertEquals(
    judgment.policy!.violations.map((v) => [v.side, v.rule]),
    [["production", "identity_changed"]],
  );
  assert(
    judgment.scorers.every((s) =>
      s.passed === null && s.state === "not_measured"
    ),
  );
});

Deno.test("H-35 S2.1: a Test-side violation fails the gate, G stays measured, agent_tests is not_measured", async () => {
  const { input } = await setup("correct", {
    "Test/src/Install.Codeunit.al":
      `codeunit 81050 "Agent Install"\n{\n    Subtype = Install;\n}\n`,
  });
  const { judgment } = await judge(new BcLane(script(), ["C1"]), input);
  assertEquals(judgment.verdict, "fail");
  assertEquals(
    judgment.policy!.violations.map((v) => [v.side, v.rule]),
    [["test", "test_lifecycle"]],
  );
  assertEquals(
    judgment.scorers.map((s) => [s.name, s.passed, s.state]),
    [
      ["build", true, "measured"],
      ["pass_to_pass", true, "measured"],
      ["fail_to_pass", true, "measured"],
      ["agent_tests", null, "not_measured"],
    ],
  );
});

Deno.test("H-35 S2.1: infra on every container is unscored (state unscored), the gate passed", async () => {
  const bc = script();
  bc.broken.add("C1");
  const { input } = await setup("correct");
  const { judgment } = await judge(new BcLane(bc, ["C1"]), input);
  assertEquals(judgment.verdict, "unscored");
  assertEquals(judgment.policy!.passed, true);
  assert(judgment.scorers.some((s) => s.state === "unscored"));
});

// ---- H-35 S2.4 (design-r2 4.2, design-r3 3.3): deployment records ----

Deno.test("H-35 S2.4: every hold is recorded: G (pristine Test + oracle) and A, each app with its digest, build key and source; G's and A's production entries are equal", async () => {
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_TESTS,
  });
  const { log } = await judge(new BcLane(script(), ["C1"]), input);
  assertEquals(log.deployments!.map((d) => [d.hold, d.container]), [
    ["G", "C1"],
    ["A", "C1"],
  ]);
  type Dep = NonNullable<typeof log.deployments>[0];
  const [g, a] = log.deployments! as [Dep, Dep];
  for (const d of [g, a]) {
    for (const app of d.apps) {
      assert(/^[0-9a-f]{64}$/.test(app.file_sha256), app.name);
      assert(/^[0-9a-f]{64}$/.test(app.build_key ?? ""), app.name);
    }
  }
  const test = g.apps.find((x) => x.name === "CGR Test")!;
  assertEquals(
    test.source_tree_hash,
    await hashTree(join(input.pristine, "Test"), "task"),
  );
  assert(g.apps.some((x) => x.name === "CGR Oracle HX-001"));
  assert(!a.apps.some((x) => x.name === "CGR Oracle HX-001"));
  const production = (d: typeof g) =>
    d.apps.filter((x) => x.role === "candidate" && x.name !== "CGR Test")
      .map((x) => [x.id, x.build_key, x.file_sha256]);
  assertEquals(production(g), production(a));
});

Deno.test("H-35 S2.4: an agent rerun records its trusted control and the rerun as holds", async () => {
  const { bc } = hangs("first");
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_81000,
  });
  const { log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(log.deployments!.map((d) => d.hold), [
    "G",
    "A",
    "control",
    "A",
  ]);
});

Deno.test("H-35 S2.4: G's Test key is recomputed from the pristine Test app: a compiler identity that changes mid-judgment is a harness bug", async () => {
  class Drifting extends FakeBc {
    n = 0;
    override harnessCompilerIdentity(_c: string): Promise<string> {
      return Promise.resolve(`compiler-${this.n++}`);
    }
  }
  const { input } = await setup("correct");
  await assertRejects(
    () => judge(new BcLane(new Drifting(scripted), ["C1"]), input),
    Error,
    "harness bug: G's Test build key",
  );
});

Deno.test("H-35 S2.4: G's Test package must be its key's build cache entry: another file there is a harness bug", async () => {
  const dir = await Deno.makeTempDir();
  const inner = dirBuildCache(dir);
  const other = join(dir, "other.app");
  await Deno.writeTextFile(other, "not the deployed package");
  // A build reads its key (miss) and, after its put, the winner; any later
  // read of that key (the identity check) finds another file.
  const reads = new Map<string, number>();
  const cache = {
    get: (k: string) => {
      reads.set(k, (reads.get(k) ?? 0) + 1);
      return reads.get(k)! > 2 ? Promise.resolve(other) : inner.get(k);
    },
    put: (k: string, f: string) => inner.put(k, f),
  };
  const { input } = await setup("correct");
  await assertRejects(
    () => judge(new BcLane(script(), ["C1"]), { ...input, buildCache: cache }),
    Error,
    "harness bug: G's Test cached package",
  );
});

Deno.test("H-35 S2.4: A's production packages must equal G's (id, build key, digest)", () => {
  const app = (id: string, key: string, sha: string) => ({
    id,
    name: id,
    publisher: "p",
    version: "1.0.0.0",
    stamp: sha,
    file: `${id}.app`,
    role: "candidate" as const,
    depends: [],
    sha256: sha,
    build_key: key,
  });
  const g = [
    app("prod", "k1", "s1"),
    app("test", "kg", "sg"),
    app("oracle", "ko", "so"),
  ];
  const production = new Set(["prod"]);
  // A's own Test app differs from G's, and A has no oracle: fine.
  assertSameProduction(
    g,
    [app("prod", "k1", "s1"), app("test", "ka", "sa")],
    production,
  );
  for (const bad of [app("prod", "k2", "s1"), app("prod", "k1", "s2")]) {
    assertThrows(
      () => assertSameProduction(g, [bad, app("test", "ka", "sa")], production),
      Error,
      "harness bug: A's production package prod",
    );
  }
  assertThrows(
    () => assertSameProduction(g, [app("test", "ka", "sa")], production),
    Error,
    "harness bug: A's production package prod",
  );
});

// ---- H-35 S3: the reset before every judge deployment ----

Deno.test("H-35 S3: every change-task deployment (G, A, the rerun's control and rerun) is preceded by its own reset on its container", async () => {
  const { bc } = hangs("first");
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_81000,
  });
  const { log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(log.deployments!.map((d) => d.hold), [
    "G",
    "A",
    "control",
    "A",
  ]);
  assertEquals(
    log.resets!.map((r) => [r.container, r.ok]),
    log.deployments!.map((d) => [d.container, true]),
  );
});

Deno.test("H-35 S3: judging with no reset lineage refuses loudly (a configuration error), never deploys and quarantines nothing", async () => {
  const { input } = await setup("correct");
  const bc = script();
  const lane = new BcLane(bc, ["C1"]);
  await assertRejects(
    () =>
      judge(lane, {
        ...input,
        deploy: { ...input.deploy, reset: UNCONFIGURED_RESET },
      }),
    ConfigurationError,
    "reset lineage",
  );
  assertEquals(bc.syncs.length, 0);
  assertEquals(lane.quarantined.size, 0);
});

// ---- H-35 run 002 Sol r1 ----

Deno.test("H-35 Sol r1 #2: a build cache whose writes fail is best-effort: the judgment still scores, every app keeps its build identity, and nothing is adopted", async () => {
  const inner = dirBuildCache(await Deno.makeTempDir());
  const cache = {
    get: (k: string) => inner.get(k),
    put: (_k: string, _f: string) => Promise.reject(new Error("disk full")),
  };
  const { input } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(script(), ["C1"]), {
    ...input,
    buildCache: cache,
  });
  assertEquals(judgment.verdict, "pass");
  for (const d of log.deployments!) {
    for (const app of d.apps) {
      assert(
        /^[0-9a-f]{64}$/.test(app.build_key ?? ""),
        `${d.hold} ${app.name}`,
      );
    }
  }
});

Deno.test("H-35 Sol r1 #3: an infra-failed attempt's deployment is recorded too, then the retry's, each after its own reset", async () => {
  let calls = 0;
  const bc = new FakeBc((cu, deployed, container) => {
    if (cu === 80010 && calls++ === 0) {
      throw new ContainerError("soap down", container, "test");
    }
    return scripted(cu, deployed);
  });
  const { input } = await setup("correct");
  const { judgment, log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(judgment.verdict, "pass");
  const g = log.deployments!.filter((d) => d.hold === "G");
  assertEquals(g.length, 2);
  assert(g[0]!.container !== g[1]!.container);
  assertEquals(
    log.resets!.map((r) => r.container),
    log.deployments!.map((d) => d.container),
  );
});

// ---- H-35 run 002 Sol r2 ----

Deno.test("H-35 Sol r2 #2: a refused (OnPrem) cache entry under G's Test key, or a cache whose reads fail, is no claim on the fresh build: the judgment scores", async () => {
  const dir = await Deno.makeTempDir();
  const onprem = join(dir, "onprem.app");
  await Deno.writeTextFile(
    onprem,
    JSON.stringify({ id: "x", name: "x", version: "1", target: "OnPrem" }),
  );
  for (
    const cache of [
      // Every entry is an OnPrem package: refused, rebuilt unkeyed.
      { get: () => Promise.resolve(onprem), put: () => Promise.resolve() },
      // Every read fails (best-effort: a miss).
      {
        get: () => Promise.reject(new Error("io")),
        put: () => Promise.resolve(),
      },
    ]
  ) {
    const { input } = await setup("correct");
    const { judgment } = await judge(new BcLane(script(), ["C1"]), {
      ...input,
      buildCache: cache,
    });
    assertEquals(judgment.verdict, "pass");
  }
});

// ---- H-35 run 002 orchestrator Sol r1 ----

Deno.test("H-35 orch Sol r1 #5: G's pristine-Test check covers a Test app built as an unaffected prerequisite (an unchanged workspace)", async () => {
  class Drifting extends FakeBc {
    n = 0;
    override harnessCompilerIdentity(_c: string): Promise<string> {
      return Promise.resolve(`compiler-${this.n++}`);
    }
  }
  const { input } = await setup(null);
  await assertRejects(
    () => judge(new BcLane(new Drifting(scripted), ["C1"]), input),
    Error,
    "harness bug: G's Test build key",
  );
});

// ---- H-35 S3.3: the environment fingerprint ----

/** A reset that succeeds and carries a lineage's compatibility identity. */
const LINEAGE_RESET = {
  ...OK_RESET,
  compat: { lineage: { id: "golden-test", golden_sha256: "a".repeat(64) } },
};

Deno.test("H-35 S3.3: every deployment records env_fp (compat + symbols lock + the container's compiler identity), and the judgment's provenance carries the one they share", async () => {
  const { input } = await setup("correct", {
    "Test/src/Agent.Test.al": AGENT_TESTS,
  });
  const { judgment, log } = await judge(new BcLane(script(), ["C1"]), {
    ...input,
    deploy: { ...input.deploy, reset: LINEAGE_RESET },
  });
  const fps = new Set(log.deployments!.map((d) => d.env_fp));
  assertEquals(fps.size, 1);
  const [fp] = [...fps];
  assert(/^[0-9a-f]{64}$/.test(fp ?? ""), String(fp));
  assertEquals(judgment.provenance!.env_fp, fp);
  // Without a lineage (a mechanism with no compat) there is no env_fp.
  const again = await setup("correct");
  const bare = await judge(new BcLane(script(), ["C1"]), again.input);
  assertEquals(bare.judgment.provenance!.env_fp, null);
});

Deno.test("H-35 S3.3: deployments on containers of different environments in one judgment are a harness bug", async () => {
  class PerContainer extends FakeBc {
    override harnessCompilerIdentity(c: string): Promise<string> {
      return Promise.resolve(`compiler-of-${c}`);
    }
  }
  // G passes on C1 after one infra failure on C2 or the other way round:
  // two G attempts on two containers.
  let calls = 0;
  const bc = new PerContainer((cu, deployed, container) => {
    if (cu === 80010 && calls++ === 0) {
      throw new ContainerError("soap down", container, "test");
    }
    return scripted(cu, deployed);
  });
  const { input } = await setup("correct");
  await assertRejects(
    () =>
      judge(new BcLane(bc, ["C1", "C2"]), {
        ...input,
        deploy: { ...input.deploy, reset: LINEAGE_RESET },
      }),
    Error,
    "harness bug: deployments of one judgment span environments",
  );
});
