/**
 * H-35 production-side policy rules (design-r2 6.2, design-r3 4 and 7;
 * rulings R2, R9, Q9): production code must not detect or reach the test
 * framework, read installed-app or object metadata, dispatch to an object by
 * a computed id, or depend on anything but the workspace apps and the five
 * allowlisted Microsoft packages. Mock only.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { safeCopyTree } from "../../../src/harness/fsutil.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import {
  buildVerdictWorkspace,
  PRODUCTION_DEPENDENCY_ALLOWLIST,
  productionPolicyViolations,
} from "../../../src/harness/verdict-workspace.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const SYSTEM_APPLICATION = "63ca2fa4-4f03-4f2b-a480-172fef340d3f";

/** A one-app workspace (Core) with `body` inside a codeunit; extra deps and files. */
async function scan(
  body: string,
  o: {
    deps?: { id: string; name: string }[];
    files?: Record<string, string>;
    allow?: Parameters<typeof productionPolicyViolations>[2];
  } = {},
): Promise<string[]> {
  const d = await Deno.realPath(await testTempDir());
  await write(
    d,
    "Core/app.json",
    appJson(IDS.core, "CGR Core", [70000, 70099], o.deps ?? []),
  );
  await write(
    d,
    "Core/src/Core.Codeunit.al",
    `codeunit 70000 "CGR Core"\n{\n${body}\n}\n`,
  );
  for (const [rel, text] of Object.entries(o.files ?? {})) {
    await write(d, rel, text);
  }
  return await productionPolicyViolations(d, await readAppGraph(d), o.allow);
}

const proc = (decl: string, stmt: string) =>
  `    procedure P()\n    var\n${decl}\n    begin\n        ${stmt}\n    end;`;

const hasRule = (vs: string[], rule: string, what: string) =>
  assert(
    vs.some((v) => v.startsWith(`${rule}: `)),
    `${what}: ${vs.join("; ")}`,
  );

Deno.test("H-35: benign production code, the shipped Codeunit.Run forms included, has no violation", async () => {
  assertEquals(
    await scan(
      proc(
        "        Cust: Record Customer;",
        'Codeunit.Run(Codeunit::"CGR Core", Cust); Codeunit.Run(70000); Cust.TestField(Name); Cust.Get(130450);',
      ),
      { deps: [{ id: SYSTEM_APPLICATION, name: "System Application" }] },
    ),
    [],
  );
  assertEquals(PRODUCTION_DEPENDENCY_ALLOWLIST.size, 5);
});

Deno.test("H-35: a production dependency outside the workspace and the five allowlisted packages is dependency_not_allowed; a grant allows it", async () => {
  const deps = [{ id: IDS.assert, name: "Library Assert" }];
  const vs = await scan("", { deps });
  hasRule(vs, "dependency_not_allowed", "Library Assert");
  assertStringIncludes(vs.join("\n"), IDS.assert);
  assertEquals(
    await scan("", { deps, allow: { dependencies: [IDS.assert] } }),
    [],
  );
});

Deno.test("H-35: a banned object referenced by name (quoted or bare, any object-typed use) is test_detection_ref", async () => {
  for (
    const [decl, stmt] of [
      ['        L: Record "Test Method Line";', "L.FindFirst();"],
      ["        A: Record AllObj;", "A.FindFirst();"],
      ["        X: Integer;", 'X := Database::"Installed Application";'],
      [
        '        R: Codeunit "Test Runner - Mgt";',
        "R.Run();",
      ],
      ["        X: Integer;", "X := Database::AllObjWithCaption;"],
      // H-35 run 004 Sol r1 H1: a namespace-qualified name is its last segment.
      [
        '        R: Codeunit System.TestTools.TestRunner."Test Runner - Mgt";',
        "R.Run();",
      ],
      ["        X: Integer;", "X := Database::System.Reflection.AllObj;"],
      [
        "        X: Integer;",
        'X := Codeunit::System."TestTools".TestRunner."Test Runner - Mgt";',
      ],
    ] as const
  ) {
    hasRule(await scan(proc(decl, stmt)), "test_detection_ref", stmt);
  }
});

Deno.test("H-35: a banned object id in an object-id position is test_detection_ref; the same number in arithmetic is not", async () => {
  for (
    const [decl, stmt] of [
      ["        X: Integer;", "X := Database::130450;"],
      ["        X: Integer;", "Codeunit.Run(130451);"],
      ["        R: RecordRef;", "R.Open(2000000038);"],
      ["        X: Integer;", "X := Codeunit::130454;"],
    ] as const
  ) {
    hasRule(await scan(proc(decl, stmt)), "test_detection_ref", stmt);
  }
  assertEquals(
    await scan(proc("        X: Integer;", "X := 130450 + 1;")),
    [],
  );
});

Deno.test("H-35: dispatch by a computed object id is dynamic_object_access; literals and Type::name are not", async () => {
  for (
    const [decl, stmt] of [
      ["        Id: Integer;", "Codeunit.Run(Id);"],
      ["        Id: Integer;", "Page.RunModal(Id + 1);"],
      ["        Id: Integer;", "Report.Run(Id);"],
      ["        R: RecordRef;\n        Id: Integer;", "R.Open(Id);"],
      [
        '        "My Ref": RecordRef;\n        Id: Integer;',
        '"My Ref".Open(Id);',
      ],
    ] as const
  ) {
    hasRule(await scan(proc(decl, stmt)), "dynamic_object_access", stmt);
  }
  assertEquals(
    await scan(
      proc(
        "        R: RecordRef;",
        'R.Open(Database::Customer); Page.Run(Page::"Customer Card");',
      ),
    ),
    [],
  );
  assertEquals(
    await scan(proc("        Id: Integer;", "Codeunit.Run(Id);"), {
      allow: { dynamic: ["Codeunit.Run"] },
    }),
    [],
  );
});

Deno.test("H-35: test-only types, a test subtype and the call-stack and app-identity members in production are test_detection_ref", async () => {
  for (
    const [decl, stmt] of [
      ['        P: TestPage "Customer Card";', "P.OpenView();"],
      ["        H: TestHttpRequestMessage;", "exit;"],
      ["        X: Text;", "X := SessionInformation.Callstack();"],
      ["        X: Text;", "X := GetLastErrorCallStack();"],
      ["        M: ModuleInfo;", "NavApp.GetCurrentModuleInfo(M);"],
      ["        E: ErrorInfo;\n        X: Text;", "X := E.Callstack();"],
    ] as const
  ) {
    hasRule(await scan(proc(decl, stmt)), "test_detection_ref", stmt);
  }
  hasRule(
    await scan("    Subtype = Test;"),
    "test_detection_ref",
    "Subtype = Test",
  );
});

Deno.test("H-35: the rules read code: names, ids and calls in comments and strings are ignored", async () => {
  assertEquals(
    await scan(
      proc(
        "        X: Text;",
        "// Record \"Test Method Line\"; Codeunit.Run(Id); ModuleInfo\n        X := 'Database::130450 NavApp.GetCurrentModuleInfo';",
      ),
    ),
    [],
  );
});

Deno.test("H-35 (ruling R9): unreadable production text is an unreadable violation, before any other rule", async () => {
  for (const eol of ["\r", " ", " ", "\u0085"]) {
    const vs = await scan(
      proc(
        "        X: Integer;",
        `// x${eol}X := Database::"Test Method Line";`,
      ),
    );
    assertEquals(vs.length, 1, JSON.stringify(eol));
    assertStringIncludes(vs[0]!, "unreadable: Core/src/Core.Codeunit.al: ");
  }
  const multi = await scan(
    proc("        X: Text;", "X := @'\n'; X := Format(Database::AllObj);"),
  );
  assertStringIncludes(multi.join("\n"), "unreadable: ");
});

Deno.test("H-35 (Q9): an object grant is kind-qualified: table:130450 allows the table, not codeunit 130450", async () => {
  const table = proc('        L: Record "Test Method Line";', "L.FindFirst();");
  assertEquals(await scan(table, { allow: { objects: ["table:130450"] } }), []);
  hasRule(
    await scan(table, { allow: { objects: ["codeunit:130450"] } }),
    "test_detection_ref",
    "codeunit grant",
  );
});

Deno.test("H-35: every production app is scanned, the Test app never", async () => {
  const vs = await scan("", {
    files: {
      "Rental/app.json": appJson(IDS.rental, "CGR Rental", [70200, 70299], [{
        id: IDS.core,
        name: "CGR Core",
      }]),
      "Rental/src/R.Codeunit.al": `codeunit 70200 "CGR Rental"\n{\n${
        proc("        M: ModuleInfo;", "NavApp.GetCurrentModuleInfo(M);")
      }\n}\n`,
      "Test/app.json": appJson(IDS.test, "CGR Test", [80000, 84999], [
        { id: IDS.core, name: "CGR Core" },
        { id: IDS.assert, name: "Library Assert" },
      ]),
      "Test/src/T.Test.al": `codeunit 80010 "T"\n{\n    Subtype = Test;\n${
        proc('        P: TestPage "Customer Card";', "P.OpenView();")
      }\n}\n`,
    },
  });
  assertEquals(vs.length, 1, vs.join("; "));
  assertStringIncludes(vs[0]!, "Rental/src/R.Codeunit.al");
});

Deno.test("H-35: the workspace builder reports production violations, in G (rawTest) too, so they fail every scorer", async () => {
  const p = await Deno.realPath(await testTempDir());
  await write(
    p,
    "Core/app.json",
    appJson(IDS.core, "CGR Core", [70000, 70099], []),
  );
  await write(
    p,
    "Core/src/Core.Codeunit.al",
    `codeunit 70000 "CGR Core"\n{\n}\n`,
  );
  await write(
    p,
    "Test/app.json",
    appJson(IDS.test, "CGR Test", [80000, 84999], [{
      id: IDS.core,
      name: "CGR Core",
    }]),
  );
  const a = await Deno.realPath(await testTempDir());
  await safeCopyTree(p, a);
  await write(
    a,
    "Core/src/Core.Codeunit.al",
    `codeunit 70000 "CGR Core"\n{\n${
      proc("        M: ModuleInfo;", "NavApp.GetCurrentModuleInfo(M);")
    }\n}\n`,
  );
  for (const rawTest of [true, false]) {
    const v = await buildVerdictWorkspace({
      pristine: p,
      artifact: a,
      out: join(await Deno.realPath(await testTempDir()), "v"),
      symbolIds: new Set([IDS.assert]),
      rawTest,
    });
    hasRule(v.violations, "test_detection_ref", `rawTest ${rawTest}`);
  }
});

Deno.test("H-35 Sol r1 #2: a RecordRef declared in a comma list is still checked for dynamic access", async () => {
  hasRule(
    await scan(
      proc(
        "        A, B: RecordRef;\n        Id: Integer;",
        "Id := 2000000000 + 38; A.Open(Id);",
      ),
    ),
    "dynamic_object_access",
    "A, B: RecordRef",
  );
});

Deno.test("H-35 Sol r1 #7: an id literal counts only in an object-id position of its kind; a method's integer argument does not", async () => {
  assertEquals(
    await scan(
      proc('        Worker: Codeunit "CGR Core";', "Worker.Run(130450);"),
    ),
    [],
  );
  const table = proc("        R: Record 130450;", "R.FindFirst();");
  assertEquals(await scan(table, { allow: { objects: ["table:130450"] } }), []);
  hasRule(
    await scan(proc("        X: Integer;", "X := Codeunit::130450;"), {
      allow: { objects: ["table:130450"] },
    }),
    "test_detection_ref",
    "codeunit 130450 under a table grant",
  );
});

Deno.test("H-35 Sol r2 #1: a quoted reference to a RecordRef variable is checked like a bare one", async () => {
  hasRule(
    await scan(proc("        R: RecordRef;", '"R".Open(2000000038);')),
    "test_detection_ref",
    '"R".Open(2000000038)',
  );
  hasRule(
    await scan(
      proc("        R: RecordRef;\n        Id: Integer;", '"R".Open(Id);'),
    ),
    "dynamic_object_access",
    '"R".Open(Id)',
  );
});

Deno.test("H-35 Sol r3 #1: every .Open with an object argument must name its object, whatever the receiver (a RecordRef array element included)", async () => {
  hasRule(
    await scan(
      proc("        R: array[1] of RecordRef;", "R[1].Open(2000000038);"),
    ),
    "test_detection_ref",
    "R[1].Open(2000000038)",
  );
  hasRule(
    await scan(
      proc(
        "        R: array[1] of RecordRef;\n        Id: Integer;",
        "R[1].Open(Id);",
      ),
    ),
    "dynamic_object_access",
    "R[1].Open(Id)",
  );
  assertEquals(
    await scan(proc("        R: RecordRef;", "R.Open(Database::Customer);")),
    [],
  );
});

Deno.test("H-35 Sol r4 #1: text inside a quoted object or variable name is never read as code", async () => {
  assertEquals(
    await scan("", {
      files: {
        "Core/src/W.Codeunit.al":
          `codeunit 70001 "Worker.Open(Id)"\n{\n}\n\ncodeunit 70002 "Record AllObj Helper"\n{\n    var\n        "Codeunit.Run(Id) Name": Integer;\n}\n`,
      },
    }),
    [],
  );
  // A quoted receiver is still a receiver.
  hasRule(
    await scan(
      proc(
        '        "My Ref": RecordRef;\n        Id: Integer;',
        '"My Ref".Open(Id);',
      ),
    ),
    "dynamic_object_access",
    '"My Ref".Open(Id)',
  );
});

Deno.test("H-35 Sol r5 #1: a quoted plain identifier is that identifier: a quoted banned call or type is still caught", async () => {
  for (
    const [decl, stmt] of [
      ["        X: Text;", 'X := "GetLastErrorCallStack"();'],
      ['        M: "ModuleInfo";', '"NavApp".GetCurrentModuleInfo(M);'],
      ['        A: Record "AllObj";', "A.FindFirst();"],
    ] as const
  ) {
    hasRule(await scan(proc(decl, stmt)), "test_detection_ref", stmt);
  }
});

Deno.test('H-35 Sol r6: an instance Open on a variable named like an object type ("Query") is still checked', async () => {
  hasRule(
    await scan(
      proc('        "Query": RecordRef;', '"Query".Open(2000000038);'),
    ),
    "test_detection_ref",
    '"Query".Open(2000000038)',
  );
  hasRule(
    await scan(
      proc(
        '        "Page": RecordRef;\n        Id: Integer;',
        '"Page".Open(Id);',
      ),
    ),
    "dynamic_object_access",
    '"Page".Open(Id)',
  );
});

Deno.test("H-35 Sol r7 #1: a quoted receiver named like an object type is an instance, not a static call: no false rejection, and a RecordRef.Open grant applies", async () => {
  assertEquals(
    await scan(
      proc(
        '        "Query": Query "CGR Core";',
        '"Query".Open(); "Query".Close();',
      ),
    ),
    [],
  );
  assertEquals(
    await scan(
      proc(
        '        "Query": RecordRef;\n        Id: Integer;',
        'Id := 18; "Query".Open(Id);',
      ),
      { allow: { dynamic: ["RecordRef.Open"] } },
    ),
    [],
  );
  // A real static call is still checked.
  hasRule(
    await scan(proc("        Id: Integer;", "Codeunit.Run(Id);")),
    "dynamic_object_access",
    "Codeunit.Run(Id)",
  );
});

Deno.test("H-35 orch r1 #2: a banned table in a CalcFormula, by name or by id, is test_detection_ref", async () => {
  for (
    const calc of [
      'count("NAV App Installed App")',
      'lookup("Published Application".Name where("Package ID" = field("No.")))',
      'exist(AllObj where("Object ID" = const(1)))',
      "count(2000000153)",
    ]
  ) {
    const table =
      `table 70010 "CGR Probe"\n{\n    fields\n    {\n        field(1; Hits; Integer)\n        {\n            FieldClass = FlowField;\n            CalcFormula = ${calc};\n        }\n    }\n}\n`;
    hasRule(
      await scan("", { files: { "Core/src/Probe.Table.al": table } }),
      "test_detection_ref",
      calc,
    );
  }
});
