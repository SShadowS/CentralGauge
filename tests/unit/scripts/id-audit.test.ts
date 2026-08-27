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
