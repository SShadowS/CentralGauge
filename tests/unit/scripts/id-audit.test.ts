import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { AlObject } from "../../../scripts/id-audit.ts";
import { auditObjects, collect, unitOf } from "../../../scripts/id-audit.ts";

function obj(overrides: Partial<AlObject> = {}): AlObject {
  const file = overrides.file ?? "tests/al/medium/CG-AL-M001.Test.al";
  return {
    file,
    unit: overrides.unit ?? unitOf(file),
    kind: overrides.kind ?? "codeunit",
    id: overrides.id ?? 80001,
    name: overrides.name ?? "Some Object",
  };
}

Deno.test("unitOf classifies by compilation unit", async (t) => {
  await t.step("prereq apps are per-task units", () => {
    assertEquals(
      unitOf("tests/al/dependencies/CG-AL-E002/ProductCategory.Table.al"),
      "prereq:CG-AL-E002",
    );
  });

  await t.step("each difficulty folder is one AL project", () => {
    assertEquals(
      unitOf("tests/al/hard/CG-AL-H001.Test.al"),
      "alproject:tests/al/hard",
    );
    assertEquals(
      unitOf("tests/al/medium/CG-AL-M001.Test.al"),
      "alproject:tests/al/medium",
    );
  });

  await t.step("harness and spikes get their own units", () => {
    assertEquals(
      unitOf("infra/cg-test-harness/src/WSTestRunner.Codeunit.al"),
      "app:cg-test-harness",
    );
    assertEquals(
      unitOf("spikes/xrec/src/SpikeLogger.Codeunit.al"),
      "spike:xrec",
    );
  });

  await t.step("anything else is unclassified and unenforced", () => {
    assert(
      unitOf("fixtures/al/simple-codeunit/X.Codeunit.al").startsWith(
        "unclassified:",
      ),
    );
  });
});

Deno.test("auditObjects: range checks", async (t) => {
  await t.step("a clean set produces no problems", () => {
    const { problems } = auditObjects([
      obj({ file: "tests/al/hard/CG-AL-H001.Test.al", id: 80001 }),
      obj({
        file: "tests/al/dependencies/CG-AL-E002/P.Table.al",
        kind: "table",
        id: 69001,
      }),
      obj({
        file: "infra/cg-test-harness/src/R.Codeunit.al",
        id: 50500,
      }),
      obj({ file: "spikes/xrec/src/S.Codeunit.al", id: 90001 }),
    ]);
    assertEquals(problems, []);
  });

  await t.step("an object in the reserved buffer fails", () => {
    const { problems } = auditObjects([
      obj({ file: "tests/al/medium/Bad.Test.al", id: 79500 }),
    ]);
    assertEquals(problems.length, 1);
    assert(problems[0]?.includes("RESERVED"));
    assert(problems[0]?.includes("79500"));
  });

  await t.step("buffer boundaries are inclusive", () => {
    assertEquals(
      auditObjects([obj({ file: "tests/al/medium/A.Test.al", id: 75000 })])
        .problems.length,
      1,
    );
    assertEquals(
      auditObjects([obj({ file: "tests/al/medium/B.Test.al", id: 79999 })])
        .problems.length,
      1,
    );
    // 74999 is the last legal authored id, 80000 the first oracle id.
    assertEquals(
      auditObjects([obj({ file: "tests/al/medium/C.Test.al", id: 74999 })])
        .problems.length,
      0,
    );
    assertEquals(
      auditObjects([obj({ file: "tests/al/medium/D.Test.al", id: 80000 })])
        .problems.length,
      0,
    );
  });

  await t.step("a prereq object outside 69000-69999 fails", () => {
    const { problems } = auditObjects([
      obj({
        file: "tests/al/dependencies/CG-AL-E002/P.Table.al",
        kind: "table",
        id: 71000,
      }),
    ]);
    assertEquals(problems.length, 1);
    assert(problems[0]?.includes("prereq band"));
  });

  await t.step("a harness object outside its band fails", () => {
    const { problems } = auditObjects([
      obj({ file: "infra/cg-test-harness/src/R.Codeunit.al", id: 60000 }),
    ]);
    assertEquals(problems.length, 1);
    assert(problems[0]?.includes("harness band"));
  });

  await t.step("unclassified locations are not range-enforced", () => {
    const { problems } = auditObjects([
      obj({ file: "fixtures/al/simple-codeunit/X.Codeunit.al", id: 70000 }),
    ]);
    assertEquals(problems, []);
  });
});

Deno.test("auditObjects: duplicate detection", async (t) => {
  const allowlist = new Map<string, string[]>([
    ["alproject:tests/al/medium|codeunit:80012", [
      "tests/al/medium/A.Test.al",
      "tests/al/medium/B.Test.al",
    ]],
  ]);

  await t.step("same id in DIFFERENT units is benign", () => {
    const { problems } = auditObjects([
      obj({ file: "tests/al/easy/CG-AL-E002.Test.al", id: 80002 }),
      obj({ file: "tests/al/hard/CG-AL-H002.Test.al", id: 80002 }),
    ]);
    assertEquals(problems, []);
  });

  await t.step("same id, different object TYPE, same unit is benign", () => {
    const { problems } = auditObjects([
      obj({ file: "tests/al/hard/A.Test.al", kind: "codeunit", id: 80500 }),
      obj({ file: "tests/al/hard/B.Table.al", kind: "table", id: 80500 }),
    ]);
    assertEquals(problems, []);
  });

  await t.step("an unlisted same-unit duplicate fails", () => {
    const { problems } = auditObjects([
      obj({ file: "tests/al/hard/A.Test.al", id: 80700 }),
      obj({ file: "tests/al/hard/B.Test.al", id: 80700 }),
    ], allowlist);
    assertEquals(problems.length, 1);
    assert(problems[0]?.includes("AL0264"));
  });

  await t.step("an allowlisted pair passes and is counted", () => {
    const { problems, knownSeen } = auditObjects([
      obj({ file: "tests/al/medium/A.Test.al", id: 80012 }),
      obj({ file: "tests/al/medium/B.Test.al", id: 80012 }),
    ], allowlist);
    assertEquals(problems, []);
    assertEquals(knownSeen, 1);
  });

  // Regression: the first implementation keyed the allowlist on the id alone,
  // so a THIRD file joining a known pair was silently accepted. Caught only by
  // a manual injection test, which is why this one is committed.
  await t.step("a third file joining an allowlisted pair still fails", () => {
    const { problems, knownSeen } = auditObjects([
      obj({ file: "tests/al/medium/A.Test.al", id: 80012 }),
      obj({ file: "tests/al/medium/B.Test.al", id: 80012 }),
      obj({ file: "tests/al/medium/C.Test.al", id: 80012 }),
    ], allowlist);
    assertEquals(problems.length, 1);
    assert(problems[0]?.includes("this set differs"));
    assertEquals(knownSeen, 0);
  });

  await t.step("the same id in a DIFFERENT file than allowlisted fails", () => {
    const { problems } = auditObjects([
      obj({ file: "tests/al/medium/A.Test.al", id: 80012 }),
      obj({ file: "tests/al/medium/Z.Test.al", id: 80012 }),
    ], allowlist);
    assertEquals(problems.length, 1);
    assert(problems[0]?.includes("this set differs"));
  });
});

Deno.test("auditObjects: the real repo is clean", async () => {
  // Guards the live convention, not just the logic: if someone adds an object
  // in the buffer or a new same-unit duplicate, this fails in `test:unit`
  // rather than waiting for someone to remember to run `deno task id-audit`.
  const objects = await collect();
  const { problems } = auditObjects(objects);
  assertEquals(
    problems,
    [],
    `Object-id violations in committed AL:\n${problems.join("\n")}`,
  );
});

Deno.test("auditObjects: prereq co-installation collisions", async (t) => {
  const prereqObj = (unit: string, id: number, name: string) => ({
    file: `tests/al/dependencies/${unit}/${name}.Table.al`,
    unit: `prereq:${unit}`,
    kind: "table",
    id,
    name,
  });

  await t.step("flags the same table id declared by two prereq apps", () => {
    // Two prereq apps are two compilation units, so this can never be AL0264
    // and the same-unit check is right to ignore it. It still fails at INSTALL
    // time with "defined in multiple apps" the moment both are on one tenant.
    const { problems } = auditObjects(
      [
        prereqObj("CG-AL-A001", 69500, "Shared"),
        prereqObj("CG-AL-A002", 69500, "Shared"),
      ],
      new Map(),
      new Map(),
    );
    assertEquals(problems.length, 1);
    assertStringIncludes(problems[0]!, "prereq co-installation collision");
    assertStringIncludes(problems[0]!, "table:69500");
    assertStringIncludes(problems[0]!, "prereq:CG-AL-A001");
    assertStringIncludes(problems[0]!, "prereq:CG-AL-A002");
  });

  await t.step("stays silent when an allowlist covers exactly that set", () => {
    const { problems, knownCoinstallSeen } = auditObjects(
      [
        prereqObj("CG-AL-A001", 69500, "Shared"),
        prereqObj("CG-AL-A002", 69500, "Shared"),
      ],
      new Map(),
      new Map([["table:69500", ["prereq:CG-AL-A001", "prereq:CG-AL-A002"]]]),
    );
    assertEquals(problems, []);
    assertEquals(knownCoinstallSeen, 1);
  });

  await t.step("still flags when a THIRD app joins an allowlisted pair", () => {
    // The allowlist pins an exact set, so growth is reported rather than
    // absorbed - the same rule the same-unit allowlist uses.
    const { problems } = auditObjects(
      [
        prereqObj("CG-AL-A001", 69500, "Shared"),
        prereqObj("CG-AL-A002", 69500, "Shared"),
        prereqObj("CG-AL-A003", 69500, "Shared"),
      ],
      new Map(),
      new Map([["table:69500", ["prereq:CG-AL-A001", "prereq:CG-AL-A002"]]]),
    );
    assertEquals(problems.length, 1);
    assertStringIncludes(problems[0]!, "this set differs");
  });

  await t.step("ignores a shared id across DIFFERENT object kinds", () => {
    // BC keys the conflict on (object type, id), so a table and a codeunit at
    // the same number co-install fine.
    const { problems } = auditObjects(
      [
        prereqObj("CG-AL-A001", 69500, "Shared"),
        {
          file: "tests/al/dependencies/CG-AL-A002/Shared.Codeunit.al",
          unit: "prereq:CG-AL-A002",
          kind: "codeunit",
          id: 69500,
          name: "Shared",
        },
      ],
      new Map(),
      new Map(),
    );
    assertEquals(problems, []);
  });

  await t.step("ignores non-prereq units entirely", () => {
    const { problems } = auditObjects(
      [
        {
          file: "tests/al/hard/CG-AL-H001.Test.al",
          unit: "alproject:tests/al/hard",
          kind: "codeunit",
          id: 80001,
          name: "A",
        },
        {
          file: "tests/al/medium/CG-AL-M001.Test.al",
          unit: "alproject:tests/al/medium",
          kind: "codeunit",
          id: 80001,
          name: "B",
        },
      ],
      new Map(),
      new Map(),
    );
    assertEquals(problems, []);
  });
});

Deno.test("harness-tasks: units, bands, reserved subranges, 80013", async (t) => {
  const f = (file: string, id: number) => obj({ file, unit: unitOf(file), id });
  const shipped = "harness-tasks/refapp/Test/src/RentalTests.Codeunit.al";
  const core = "harness-tasks/refapp/Core/src/A.Codeunit.al";
  const oracle = "harness-tasks/tasks/HX-001/oracle/src/O.Codeunit.al";
  const refTests =
    "harness-tasks/tasks/HX-002/reference-tests/Test/src/L.Codeunit.al";
  const naiveTests =
    "harness-tasks/tasks/HX-002/naive/near-complete/Test/src/N.Codeunit.al";
  const mutant =
    "harness-tasks/tasks/HX-002/mutants/off-by-one/Leasing/src/M.Codeunit.al";
  const fixture = "tests/fixtures/harness/probe/Test/src/H.Codeunit.al";
  // Hostile fixtures stand in for agent output: the agent band (ruling 2026-09-26).
  const hostile =
    "tests/fixtures/harness/hostile/leave-state/Test/src/H.Codeunit.al";

  await t.step("unitOf", () => {
    assertEquals(unitOf(shipped), "refapp:Test");
    assertEquals(unitOf(oracle), "harness-oracle:HX-001");
    assertEquals(unitOf(refTests), "harness-reference-tests:HX-002:Test");
    assertEquals(unitOf(naiveTests), "harness-naive:HX-002:near-complete:Test");
    assertEquals(unitOf(mutant), "harness-mutants:HX-002:off-by-one:Leasing");
    assertEquals(unitOf(fixture), "harness-fixture:Test");
    assertEquals(unitOf(hostile), "harness-hostile:Test");
  });

  await t.step("in-band objects pass", () => {
    assertEquals(
      auditObjects([
        f(core, 70001),
        f(shipped, 80010),
        f(oracle, 85001),
        f(refTests, 80100),
        f(naiveTests, 80101),
        f(mutant, 70310),
        f(fixture, 84998),
        f(hostile, 84890),
        f(hostile, 80000),
      ]).problems,
      [],
    );
  });

  await t.step("out-of-band objects fail", () => {
    const p = auditObjects([
      f(core, 80001),
      f(shipped, 80150),
      f(oracle, 80001),
      f(refTests, 80050),
      f(fixture, 80098),
      f(mutant, 85001),
    ]).problems;
    assertEquals(p.length, 6);
    assertStringIncludes(p[1]!, "shipped visible test band");
    assertStringIncludes(p[3]!, "task test suite band");
    assertStringIncludes(p[4]!, "harness fixture band");
  });

  await t.step(
    "hostile fixtures: the agent band, never the fixture band",
    () => {
      const p = auditObjects([
        f(hostile, 84990),
        f(hostile, 85001),
        f(hostile, 79999),
      ]).problems.filter((x) => x.includes("hostile fixture (agent) band"));
      assertEquals(
        p.map((x) => /codeunit (\d+)/.exec(x)![1]),
        ["84990", "85001", "79999"],
      );
      assertEquals(
        auditObjects([f(hostile, 80013)]).problems.filter((x) =>
          x.includes("80013 is forbidden in harness content")
        ).length,
        1,
      );
    },
  );

  await t.step("80013 is refused everywhere in harness content", () => {
    const p = auditObjects([f(shipped, 80013), f(refTests, 80013)]).problems;
    assertEquals(
      p.filter((x) => x.includes("80013 is forbidden in harness content"))
        .length,
      2,
    );
  });
});

Deno.test("harness-tasks: per-task oracle band, fail-closed paths", async (t) => {
  const f = (file: string, id: number) => obj({ file, unit: unitOf(file), id });
  const o1 = "harness-tasks/tasks/HX-001/oracle/src/O.Codeunit.al";
  const o2 = "harness-tasks/tasks/HX-002/oracle/src/O.Codeunit.al";

  await t.step("each task owns 85000+(N-1)*100..+99", () => {
    const p = auditObjects([f(o1, 85100), f(o2, 85000), f(o2, 85100)])
      .problems;
    assertEquals(p.length, 2);
    assertStringIncludes(p[0]!, "HX-001");
    assertStringIncludes(p[0]!, "85000-85099");
    assertStringIncludes(p[1]!, "HX-002");
    assertStringIncludes(p[1]!, "85100-85199");
  });

  await t.step("only HX-NNN task ids get an oracle band", () => {
    const at = (id: string) =>
      `harness-tasks/tasks/${id}/oracle/src/O.Codeunit.al`;
    for (const id of ["ZZ-001", "HX-1", "HX-0001", "hx-001", "HX-001x"]) {
      const p = auditObjects([f(at(id), 85000)]).problems;
      assertEquals(p.length, 1, id);
      assertStringIncludes(p[0]!, "no band");
    }
  });

  await t.step("unclassified harness-tasks paths are problems", () => {
    const stray = "harness-tasks/tasks/HX-001/stray/x.al";
    const p = auditObjects([f(stray, 70001)]).problems;
    assertEquals(p.length, 1);
    assertStringIncludes(p[0]!, "unclassified harness path");
  });

  await t.step(
    "80013 is banned on unclassified harness-tasks paths too",
    () => {
      const p = auditObjects([f("harness-tasks/stray.al", 80013)]).problems;
      assert(
        p.some((x) => x.includes("80013 is forbidden in harness content")),
      );
    },
  );
});
