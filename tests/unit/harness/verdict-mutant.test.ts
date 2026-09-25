import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import { freezeWorkspace, safeCopyTree } from "../../../src/harness/fsutil.ts";
import { oracleHash, resolveRefapp } from "../../../src/harness/identity.ts";
import { JudgmentRecordSchema } from "../../../src/harness/records.ts";
import { applyOverlay, stageRefappTask } from "../../../src/harness/staging.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { judge, SCORER_SUITE } from "../../../src/harness/verdict.ts";
import { deployedSource, FakeBc, result } from "./fake-bc.ts";
import {
  addTestAuthoringTask,
  IDS,
  makeRefappRepo,
  rental,
  write,
} from "./refapp-fixture.ts";

const suite = (cu: number, procs: string[] = ["PriceIsTen"], extra = "") =>
  `codeunit ${cu} "Suite ${cu}"\n{\n    Subtype = Test;\n${extra}\n${
    procs.map((p) => `    [Test]\n    procedure ${p}()\n    begin\n    end;\n`)
      .join("\n")
  }}\n`;

type Script = (
  cu: number,
  src: string,
  container: string,
) => ReturnType<typeof result> | "throw-infra";

/**
 * 80100 good (assertion unless Rental returns 10); 80101 weak (always passes);
 * 80102 fails everywhere; 80103 runtime error unless 10; 80104 lost ASSERTERROR unless 10.
 */
function bc(extra: Script = () => result({})) {
  return new FakeBc((cu, deployed, container) => {
    const src = deployedSource(deployed, "CGR Rental");
    const ten = src.includes("exit(10);");
    // An agent file planted in the Test app could blank a shipped test (subscriber, install trigger).
    if (cu === 80010) {
      return deployedSource(deployed, "CGR Test").includes("SABOTAGE")
        ? result({})
        : result({ ShippedPasses: true });
    }
    if (cu === 80100) {
      return result({
        PriceIsTen: ten ? true : "Assert.AreEqual failed. Expected:<10>",
      });
    }
    if (cu === 80101) return result({ PriceIsTen: true });
    if (cu === 80102) return result({ PriceIsTen: "Assert.IsTrue failed." });
    if (cu === 80103) {
      return result({ PriceIsTen: ten ? true : "Division by zero" });
    }
    if (cu === 80104) {
      return result({
        PriceIsTen: ten
          ? true
          : "An error was expected inside an ASSERTERROR statement.",
      });
    }
    const x = extra(cu, src, container);
    if (x === "throw-infra") {
      throw new Error(`SOAP request timed out on ${container}`);
    }
    return x;
  });
}

async function setup(
  mutants: Record<string, string>,
  artifact: {
    suite?: string;
    tests?: number[];
    edits?: Record<string, string>;
  },
  opts: { passToPass?: boolean } = {},
) {
  const repo = await makeRefappRepo();
  const task = await loadTask(
    await addTestAuthoringTask(repo, mutants, {
      "reference-tests": suite(80100),
      "naive/weak": suite(80101),
      "naive/crashy": suite(80103),
    }, opts),
  );
  const tmp = async () => await Deno.realPath(await Deno.makeTempDir());
  const staged = await stageRefappTask({
    repoRoot: repo.root,
    task,
    refapp: await resolveRefapp(repo.root, "refapp-v1"),
    symbols: repo.symbols,
    symbolStore: repo.symbolStore,
    out: join(await tmp(), "stage"),
  });
  const ws = await tmp();
  await safeCopyTree(staged.pristine, ws);
  if (artifact.suite) await applyOverlay(join(task.dir, artifact.suite), ws);
  for (const cu of artifact.tests ?? []) {
    await write(ws, `Test/src/Agent${cu}.Test.al`, suite(cu));
  }
  for (const [rel, text] of Object.entries(artifact.edits ?? {})) {
    await write(ws, rel, text);
  }
  const results = await tmp();
  const frozen = await freezeWorkspace({
    resultsRoot: results,
    privateRoot: await tmp(),
    workspace: ws,
    secrets: [],
  });
  return {
    executionId: crypto.randomUUID(),
    workspaceHash: frozen.workspace_hash,
    task,
    oracleHash: await oracleHash(task),
    pristine: staged.pristine,
    artifact: join(results, frozen.stored_path),
    symbolIds: new Set([IDS.assert]),
    workDir: await tmp(),
    lock: { store: repo.symbolStore, packages: repo.symbols },
    deploy: { ledgerRoot: join(results, "bc-ledger") },
  };
}

const sc = (
  j: {
    scorers: {
      name: string;
      passed: boolean | null;
      tests: {
        target: string;
        outcome: string;
        failure: string | null;
        procedure: string;
      }[];
    }[];
  },
  n: string,
) => j.scorers.find((s) => s.name === n)!;

Deno.test("mutant_kill: reference-tests is the positive artifact; the real HX-002 scorer list, pass_to_pass included, all pass", async () => {
  const { judgment } = await judge(
    new BcLane(bc(), ["C1"]),
    await setup({ "off-by-one": "exit(9);" }, { suite: "reference-tests" }),
  );
  JudgmentRecordSchema.parse(judgment);
  assertEquals(judgment.scorers.map((s) => [s.name, s.passed]), [
    ["build", true],
    ["pass_to_pass", true],
    ["mutant_kill", true],
  ]);
  assertEquals(judgment.verdict, "pass");
  assertEquals(
    sc(judgment, "mutant_kill").tests.map((
      t,
    ) => [t.target, t.procedure, t.outcome, t.failure]),
    [
      ["reference", "PriceIsTen", "pass", null],
      ["mutant:0", "PriceIsTen", "fail", "assertion"],
      ["mutant:off-by-one", "PriceIsTen", "fail", "assertion"],
    ],
  );
});

Deno.test("mutant_kill: each named naive suite fails (weak survives, runtime errors are not kills)", async () => {
  for (const naive of ["naive/weak", "naive/crashy"]) {
    const { judgment } = await judge(
      new BcLane(bc(), ["C1"]),
      await setup({ "off-by-one": "exit(9);" }, { suite: naive }),
    );
    assertEquals(judgment.verdict, "fail", naive);
  }
});

Deno.test("mutant_kill: a lost ASSERTERROR is an assertion and kills", async () => {
  const { judgment } = await judge(
    new BcLane(bc(), ["C1"]),
    await setup({ "off-by-one": "exit(9);" }, { tests: [80104] }),
  );
  assertEquals(judgment.verdict, "pass");
});

Deno.test("mutant_kill: tests failing on the reference fail and mutants are not run", async () => {
  const fake = bc();
  const { judgment } = await judge(
    new BcLane(fake, ["C1"]),
    await setup({ "off-by-one": "exit(9);" }, { tests: [80102] }),
  );
  assertEquals(judgment.verdict, "fail");
  assertEquals(
    fake.tests.filter((x) => x.codeunit === 80102).length,
    1,
    "only the reference run",
  );
});

Deno.test("mutant_kill: a mutant that does not compile is not a kill", async () => {
  const { judgment } = await judge(
    new BcLane(bc(), ["C1"]),
    await setup({ broken: "COMPILE_ERROR" }, { suite: "reference-tests" }),
  );
  assertEquals(judgment.verdict, "fail");
});

Deno.test("mutant_kill: the conformance fixture's infra rule is for trusted suites; in an agent suite, a missing B is the agent's, A's assertion still kills", async () => {
  const fx = JSON.parse(
    await Deno.readTextFile(
      "tests/fixtures/harness/conformance/mixed-assertion-missing.json",
    ),
  );
  const reported = new Map<string, true | string>(
    fx.run.tests.filter((t: { codeunit: number }) => t.codeunit === 85000)
      .map((
        t: { procedure: string; passed: boolean; message?: string },
      ) => [t.procedure, t.passed ? true : t.message!]),
  );
  const procs = fx.task.fail_to_pass.tests[0].procedures as string[]; // ["A", "B"]: B never reports
  const fake = bc((cu, src) => {
    if (cu !== 80105) return result({});
    if (src.includes("exit(10);")) {
      return result(Object.fromEntries(procs.map((p) => [p, true])));
    }
    return result(Object.fromEntries(reported));
  });
  const input = await setup({ "off-by-one": "exit(9);" }, {
    edits: { "Test/src/Agent80105.Test.al": suite(80105, procs) },
  });
  const { judgment } = await judge(new BcLane(fake, ["C1"]), input);
  // The fixture (an oracle suite) stays infra: decision 2026-09-25-agent-suite-infra scopes it to trusted suites.
  assertEquals(fx.expected, { infra: true, kill: false });
  const mk = sc(judgment, "mutant_kill");
  assertEquals(mk.passed, true, "A's assertion kills every mutant");
  assert(
    mk.tests.some((t) =>
      t.target === "mutant:off-by-one" && t.procedure === "B" &&
      t.outcome === "not_run" && t.failure === "runtime_error"
    ),
    "B never reported: the agent's, not infra",
  );
});

Deno.test("mutant_kill: infra on a later mutant keeps an earlier survivor (definite fail)", async () => {
  const fake = bc((cu, src) =>
    cu === 80106
      ? (src.includes("exit(8);")
        ? "throw-infra"
        : result({ PriceIsTen: true }))
      : result({})
  );
  const input = await setup({ same: "exit(10);  ", flaky: "exit(8);" }, {
    edits: { "Test/src/Agent80106.Test.al": suite(80106) },
  });
  const { judgment } = await judge(new BcLane(fake, ["C1"]), input);
  assertEquals(sc(judgment, "mutant_kill").passed, false);
  assert(
    sc(judgment, "mutant_kill").tests.some((t) =>
      t.target === "mutant:flaky" && t.failure === "infra"
    ),
  );
});

Deno.test("mutant_kill: a submitted TestPage codeunit is rejected with the reason; no agent test is a fail", async () => {
  const page = await judge(
    new BcLane(bc(), ["C1"]),
    await setup({ "off-by-one": "exit(9);" }, {
      suite: "reference-tests",
      edits: {
        "Test/src/Page.Test.al": suite(
          80107,
          ["UsesPage"],
          '    var P: TestPage "Customer Card";',
        ),
      },
    }),
  );
  assertEquals(page.judgment.verdict, "fail");
  assertStringIncludes(
    page.log.test_messages.map((m) => m.message).join("\n"),
    "TestPage tests are not supported",
  );
  const none = await judge(
    new BcLane(bc(), ["C1"]),
    await setup({ "off-by-one": "exit(9);" }, {}),
  );
  assertEquals(none.judgment.verdict, "fail");
  assertStringIncludes(none.log.notes.join("\n"), "no agent test");
});

Deno.test("mutant_kill: agent production edits are reset to the reference", async () => {
  const { judgment } = await judge(
    new BcLane(bc(), ["C1"]),
    await setup({ "off-by-one": "exit(9);" }, {
      suite: "reference-tests",
      edits: { "Rental/src/Rental.Codeunit.al": rental("exit(12);") },
    }),
  );
  assertEquals(judgment.verdict, "pass");
});

Deno.test("mutant_kill: agent test code cannot unscore pass_to_pass (trusted suite runs in its own hold, first)", async () => {
  const fake = bc((cu) => cu === 80108 ? "throw-infra" : result({}));
  const input = await setup({ "off-by-one": "exit(9);" }, {
    edits: { "Test/src/Agent80108.Test.al": suite(80108) },
  });
  const { judgment } = await judge(new BcLane(fake, ["C1", "C2"]), input);
  assertEquals(sc(judgment, "pass_to_pass").passed, true);
  assert(sc(judgment, "pass_to_pass").tests.length > 0);
});

Deno.test("mutant_kill: a TestPage or empty submission still has pass_to_pass decided by a real run", async () => {
  const page = await judge(
    new BcLane(bc(), ["C1"]),
    await setup({ "off-by-one": "exit(9);" }, {
      edits: {
        "Test/src/Page.Test.al": suite(
          80107,
          ["UsesPage"],
          '    var P: TestPage "Customer Card";',
        ),
      },
    }),
  );
  assertEquals(sc(page.judgment, "pass_to_pass").passed, true);
  assertEquals(sc(page.judgment, "mutant_kill").passed, false);
  const none = await judge(
    new BcLane(bc(), ["C1"]),
    await setup({ "off-by-one": "exit(9);" }, {}),
  );
  assertEquals(sc(none.judgment, "pass_to_pass").passed, true);
  assert(sc(none.judgment, "pass_to_pass").tests.length > 0);
});

Deno.test("mutant_kill: the pass_to_pass hold deploys the shipped tests only; an agent file cannot sabotage it", async () => {
  const input = await setup({ "off-by-one": "exit(9);" }, {
    suite: "reference-tests",
    edits: {
      "Test/src/Sabotage.Test.al":
        `codeunit 80120 "Sabotage"\n{\n    // SABOTAGE: an install trigger or subscriber in agent code\n}\n`,
    },
  });
  const { judgment } = await judge(new BcLane(bc(), ["C1"]), input);
  assertEquals(sc(judgment, "pass_to_pass").passed, true);
});

Deno.test("mutant_kill: a completed agent run with a missing or zero-result procedure is the agent's failure, not unscored", async () => {
  const fake = bc((cu) => cu === 80109 ? result({}) : result({}));
  const input = await setup({ "off-by-one": "exit(9);" }, {
    edits: { "Test/src/Agent80109.Test.al": suite(80109) },
  });
  const { judgment } = await judge(new BcLane(fake, ["C1", "C2"]), input);
  assertEquals(sc(judgment, "mutant_kill").passed, false);
  assertEquals(judgment.verdict, "fail");
});

Deno.test("mutant_kill: a thrown agent run is rerun once on another container behind a trusted control", async () => {
  // The first agent attempt throws (wherever it lands); the rerun completes
  // with a missing procedure -> the agent's failure.
  let calls = 0;
  const once = bc((cu) =>
    cu === 80110 ? (calls++ === 0 ? "throw-infra" : result({})) : result({})
  );
  const a = await judge(
    new BcLane(once, ["C1", "C2"]),
    await setup({ "off-by-one": "exit(9);" }, {
      edits: { "Test/src/Agent80110.Test.al": suite(80110) },
    }),
  );
  assertEquals(sc(a.judgment, "mutant_kill").passed, false);
  const [first, second] = once.tests.filter((t) => t.codeunit === 80110).map((
    t,
  ) => t.container);
  assert(
    first && second && first !== second,
    "the rerun is on another container",
  );
  const controlBefore = once.tests.findIndex((t) =>
    t.container === second && t.codeunit === 80010
  );
  const agentRerun = once.tests.findIndex((t) =>
    t.container === second && t.codeunit === 80110
  );
  assert(
    controlBefore >= 0 && controlBefore < agentRerun,
    "the trusted control runs right before, on that container",
  );
  // Throws everywhere: the single rerun is exhausted -> unscored.
  const always = bc((cu) => cu === 80110 ? "throw-infra" : result({}));
  const b = await judge(
    new BcLane(always, ["C1", "C2", "C3"]),
    await setup({ "off-by-one": "exit(9);" }, {
      edits: { "Test/src/Agent80110.Test.al": suite(80110) },
    }),
  );
  assertEquals(sc(b.judgment, "mutant_kill").passed, null);
  assertEquals(
    always.tests.filter((t) => t.codeunit === 80110).length,
    2,
    "one rerun only",
  );
});

Deno.test("mutant_kill: a trusted control that does not pass on the rerun container makes the run unscored", async () => {
  // The first agent attempt throws; afterwards every shipped run reports nothing: the rerun's control fails.
  let thrown = false;
  const fake = bc((cu) => {
    if (cu !== 80111) return result({});
    if (!thrown) {
      thrown = true;
      return "throw-infra";
    }
    return result({});
  });
  const control = new FakeBc((cu, deployed, c) =>
    cu === 80010 && thrown ? result({}) : fake.script(cu, deployed, c)
  );
  const { judgment } = await judge(
    new BcLane(control, ["C1", "C2"]),
    await setup({ "off-by-one": "exit(9);" }, {
      edits: { "Test/src/Agent80111.Test.al": suite(80111) },
    }),
  );
  assertEquals(sc(judgment, "mutant_kill").passed, null);
});

Deno.test("mutant_kill: the rerun control is the shipped build; an agent file cannot blank it", async () => {
  let calls = 0;
  const fake = bc((cu) =>
    cu === 80112 ? (calls++ === 0 ? "throw-infra" : result({})) : result({})
  );
  const { judgment } = await judge(
    new BcLane(fake, ["C1", "C2"]),
    await setup({ "off-by-one": "exit(9);" }, {
      edits: {
        "Test/src/Agent80112.Test.al": suite(80112),
        "Test/src/Sabotage.Test.al": `codeunit 80121 "Sabotage"
{
    // SABOTAGE
}
`,
      },
    }),
  );
  // The control on the shipped build passes, so the rerun's missing procedure is the agent's.
  assertEquals(sc(judgment, "mutant_kill").passed, false);
});

Deno.test("mutant_kill: no pass_to_pass means no trusted control: a thrown agent run stays unscored, no rerun", async () => {
  const fake = bc((cu) => cu === 80113 ? "throw-infra" : result({}));
  const { judgment } = await judge(
    new BcLane(fake, ["C1", "C2"]),
    await setup({ "off-by-one": "exit(9);" }, {
      edits: { "Test/src/Agent80113.Test.al": suite(80113) },
    }, {
      passToPass: false,
    }),
  );
  assertEquals(sc(judgment, "mutant_kill").passed, null);
  assertEquals(
    fake.tests.filter((t) => t.codeunit === 80113).length,
    1,
    "no rerun without a control",
  );
});

Deno.test("mutant_kill: the scorer version is bumped for the agent-suite rules", () => {
  assertEquals(SCORER_SUITE["mutant_kill"], "2");
});
