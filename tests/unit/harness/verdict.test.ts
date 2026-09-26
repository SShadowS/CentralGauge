import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ContainerError } from "../../../src/errors.ts";
import { BcLane } from "../../../src/harness/bc-lane.ts";
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
  isCurrentJudgment,
  judge,
  SCORER_SUITE,
  writeVerdictLog,
} from "../../../src/harness/verdict.ts";
import { deployedSource, FakeBc, result } from "./fake-bc.ts";
import { appJson, IDS, makeRefappRepo, write } from "./refapp-fixture.ts";
import { hashFile, hashJson } from "../../../src/harness/hash.ts";

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
    out: join(await Deno.realPath(await Deno.makeTempDir()), "stage"),
  });
  const ws = await Deno.realPath(await Deno.makeTempDir());
  await safeCopyTree(staged.pristine, ws);
  if (solution) await applyOverlay(join(task.dir, solution), ws);
  for (const [rel, text] of Object.entries(edits)) await write(ws, rel, text);
  const results = await Deno.realPath(await Deno.makeTempDir());
  const frozen = await freezeWorkspace({
    resultsRoot: results,
    privateRoot: await Deno.realPath(await Deno.makeTempDir()),
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
      workDir: await Deno.realPath(await Deno.makeTempDir()),
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

Deno.test("judge: an agent-added test that hangs on every container fails pass_to_pass; the oracle still decides", async () => {
  const added = `codeunit 81000 "Agent"
{
    Subtype = Test;

    [Test]
    procedure AgentTest()
    begin
    end;
}
`;
  const bc = script();
  const inner = bc.script;
  bc.script = (cu, deployed, container) => {
    if (cu === 81000) {
      throw new ContainerError(
        `SOAP run of 81000 timed out on ${container}`,
        container,
        "test",
      );
    }
    return inner(cu, deployed, container);
  };
  const { input } = await setup("correct", { "Test/src/Agent.Test.al": added });
  const { judgment, log } = await judge(new BcLane(bc, ["C1", "C2"]), input);
  assertEquals(log.error, null);
  assertEquals(judgment.verdict, "fail");
  assertEquals(judgment.scorers.map((s) => s.passed), [true, false, true]);
  assertEquals(judgment.scorers[2]!.tests[0]!.outcome, "pass");
  assert(
    judgment.scorers[1]!.tests.some((t) =>
      t.codeunit === 81000 && t.procedure === "AgentTest" &&
      t.failure === "runtime_error"
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
  assertStringIncludes(log.notes.join("\n"), "81000");
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
  const store = await Deno.realPath(await Deno.makeTempDir());
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
