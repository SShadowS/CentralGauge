/**
 * H-21: NEW plain procedures an agent adds to a SHIPPED non-test helper
 * codeunit of the Test app ("CGR Test Library") survive judging, appended to
 * the shipped text. Anything else in the file (a changed member, a new
 * global, trigger, property or attributed procedure, a name the shipped
 * codeunit has) restores the whole shipped file, as before. Mock only.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { safeCopyTree } from "../../../src/harness/fsutil.ts";
import {
  addedTestCodeunits,
  buildVerdictWorkspace,
} from "../../../src/harness/verdict-workspace.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const tmp = async () => await Deno.realPath(await testTempDir());

const LIB_REL = "Test/src/TestLibrary.Codeunit.al";
const LIB = `codeunit 80090 "CGR Test Library"
{
    var
        Counter: Integer;

    procedure Seed(): Integer
    begin
        Counter += 1;
        exit(7);
    end;
}
`;
const SHIPPED_TESTS = `codeunit 80010 "CGR Shipped Tests"
{
    Subtype = Test;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure ShippedPasses()
    begin
        Assert.AreEqual(7, Lib.Seed(), 'seed');
    end;
}
`;
/** The agent's new test file: its test calls the added helper. */
const NEW_TESTS = `codeunit 80030 "CGR Agent Tests"
{
    Subtype = Test;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure UsesAddedHelper()
    begin
        Assert.AreEqual(2, Lib.MakeTwo(), 'two');
    end;
}
`;
const MAKE_TWO = `
    procedure MakeTwo(): Integer
    begin
        exit(Seed() - 5);
    end;
`;

/** The shipped library with text inserted before its closing brace. */
const libWith = (add: string, lib = LIB) => lib.replace(/}\n$/, `${add}}\n`);

async function pristineDir(lib = LIB): Promise<string> {
  const d = await tmp();
  await write(
    d,
    "Core/app.json",
    appJson(IDS.core, "CGR Core", [70000, 70099], []),
  );
  await write(
    d,
    "Core/src/Core.Codeunit.al",
    `codeunit 70000 "CGR Core"\n{\n}\n`,
  );
  await write(
    d,
    "Test/app.json",
    appJson(IDS.test, "CGR Test", [80000, 84999], [
      { id: IDS.core, name: "CGR Core" },
      { id: IDS.assert, name: "Library Assert" },
    ]),
  );
  await write(d, "Test/src/Shipped.Test.al", SHIPPED_TESTS);
  await write(d, LIB_REL, lib);
  return d;
}

async function rebuild(
  edits: Record<string, string>,
  o: { lib?: string; dropShippedTests?: boolean } = {},
) {
  const p = await pristineDir(o.lib);
  const a = await tmp();
  await safeCopyTree(p, a);
  for (const [rel, text] of Object.entries(edits)) await write(a, rel, text);
  const v = await buildVerdictWorkspace({
    pristine: p,
    artifact: a,
    out: join(await tmp(), "verdict"),
    symbolIds: new Set([IDS.assert]),
    dropShippedTests: o.dropShippedTests === true,
  });
  return {
    v,
    lib: await Deno.readTextFile(join(v.dir, ...LIB_REL.split("/"))),
    notes: v.notes.join("\n"),
    added: await addedTestCodeunits(
      join(p, "Test"),
      join(v.dir, "Test"),
      new Set(v.excluded),
    ),
  };
}

/** The agent's library edit is refused: the shipped text comes back and a note says why. */
async function assertRestored(libText: string, why: string, lib = LIB) {
  const r = await rebuild({
    [LIB_REL]: libText,
    "Test/src/Agent.Test.al": NEW_TESTS,
  }, {
    lib,
  });
  assertEquals(r.v.violations, []);
  assertEquals(r.lib, lib, "the shipped library is restored byte for byte");
  assertStringIncludes(r.notes, "the shipped file is restored");
  assertStringIncludes(r.notes, why);
}

Deno.test("H-21: a new plain procedure added to the shipped helper codeunit is kept, appended to the shipped text; the agent test that calls it is counted", async () => {
  const r = await rebuild({
    [LIB_REL]: libWith(MAKE_TWO),
    "Test/src/Agent.Test.al": NEW_TESTS,
  });
  assertEquals(r.v.violations, []);
  assertEquals(r.lib, libWith(MAKE_TWO));
  assert(r.v.changed.includes("Test"));
  assertStringIncludes(r.notes, "added procedures kept: MakeTwo");
  assertEquals(
    r.added.map((t) => [t.codeunit, t.procedures]),
    [[80030, ["UsesAddedHelper"]]],
  );
});

Deno.test("H-21: local and internal procedures are kept; added ones in the middle of the codeunit are appended after the shipped members", async () => {
  const mid = `    local procedure Helper1(): Integer
    begin
        exit(1);
    end;

    internal procedure Helper2(): Integer
    begin
        exit(Helper1() + 1);
    end;

`;
  const agent = LIB.replace(
    "    procedure Seed()",
    `${mid}    procedure Seed()`,
  );
  const r = await rebuild({ [LIB_REL]: agent });
  assertEquals(r.v.violations, []);
  assertEquals(
    r.lib,
    libWith(`
    local procedure Helper1(): Integer
    begin
        exit(1);
    end;

    internal procedure Helper2(): Integer
    begin
        exit(Helper1() + 1);
    end;
`),
  );
  assertStringIncludes(r.notes, "added procedures kept: Helper1, Helper2");
});

Deno.test("H-21: a changed existing procedure restores the whole file, the added procedure included", async () => {
  await assertRestored(
    libWith(MAKE_TWO).replace("exit(7);", "exit(8);"),
    "Seed",
  );
});

Deno.test("H-21: a removed or moved shipped member restores the file", async () => {
  await assertRestored(
    libWith(MAKE_TWO).replace("    var\n        Counter: Integer;\n\n", ""),
    "shipped member",
  );
  const two = LIB.replace(
    /}\n$/,
    "\n    procedure Other()\n    begin\n    end;\n}\n",
  );
  const swapped = LIB.replace(
    "    procedure Seed()",
    "    procedure Other()\n    begin\n    end;\n\n    procedure Seed()",
  );
  await assertRestored(swapped, "shipped member", two);
});

Deno.test("H-21: an added attributed procedure (event subscriber, test, handler, NonDebuggable, event publisher) restores the file", async () => {
  for (
    const attr of [
      "[EventSubscriber(ObjectType::Table, Database::Customer, 'OnAfterInsertEvent', '', false, false)]",
      "[Test]",
      "[ConfirmHandler]",
      "[NonDebuggable]",
      "[IntegrationEvent(false, false)]",
    ]
  ) {
    await assertRestored(
      libWith(`${MAKE_TWO}
    ${attr}
    procedure Hooked()
    begin
    end;
`),
      "Hooked",
    );
  }
});

Deno.test("H-21: a new global variable restores the file", async () => {
  await assertRestored(
    libWith(MAKE_TWO).replace(
      "        Counter: Integer;\n",
      "        Counter: Integer;\n        Extra: Integer;\n",
    ),
    "Extra",
  );
  await assertRestored(
    libWith(`
    var
        Late: Integer;
${MAKE_TWO}`),
    "Late",
  );
});

Deno.test("H-21: a new trigger restores the file", async () => {
  await assertRestored(
    libWith(`${MAKE_TWO}
    trigger OnRun()
    begin
        Counter := 99;
    end;
`),
    "OnRun",
  );
});

Deno.test("H-21: a new codeunit property restores the file", async () => {
  await assertRestored(
    libWith(MAKE_TWO).replace(
      "{\n    var",
      "{\n    SingleInstance = true;\n\n    var",
    ),
    "SingleInstance",
  );
});

Deno.test("H-21: a new procedure whose name collides case-insensitively with a shipped member (an overload) restores the file", async () => {
  await assertRestored(
    libWith(`
    procedure SEED(Offset: Integer): Integer
    begin
        exit(7 + Offset);
    end;
`),
    "SEED",
  );
  await assertRestored(
    libWith(`
    procedure "counter"(): Integer
    begin
        exit(0);
    end;
`),
    "counter",
  );
});

Deno.test("H-21: a changed object header or text outside the codeunit restores the file", async () => {
  await assertRestored(
    libWith(MAKE_TWO).replace(
      '"CGR Test Library"',
      '"CGR Test Library" implements "Some Interface"',
    ),
    "outside",
  );
  await assertRestored(
    `${libWith(MAKE_TWO)}\ncodeunit 80091 "CGR Smuggled"\n{\n}\n`,
    "objects",
  );
});

Deno.test("H-21: an added procedure the credit rules reject (calls a shipped [Test], runs a shipped test codeunit, dynamic dispatch) restores the file", async () => {
  for (
    const body of [
      "begin\n        ShippedPasses();",
      "begin\n        Codeunit.Run(80010);",
      'begin\n        Codeunit.Run(Codeunit::"CGR Shipped Tests");',
      "var\n        Id: Integer;\n    begin\n        Id := 80000;\n        Codeunit.Run(Id + 10);",
      'var\n        Shipped: Codeunit "CGR Shipped Tests";\n    begin\n        Shipped.Run();',
    ]
  ) {
    await assertRestored(
      libWith(`
    procedure Sneaky()
    ${body}
    end;
`),
      "Sneaky",
    );
  }
});

Deno.test("H-21: a helper codeunit with a Subtype other than Normal keeps today's rule (restored)", async () => {
  const install = LIB.replace(
    "{\n    var",
    "{\n    Subtype = Install;\n\n    var",
  );
  await assertRestored(libWith(MAKE_TWO, install), "Subtype", install);
});

Deno.test("H-21: plain procedures added to a shipped Subtype = Test codeunit are not kept in place (today's rule)", async () => {
  const r = await rebuild({
    "Test/src/Shipped.Test.al": SHIPPED_TESTS.replace(/}\n$/, `${MAKE_TWO}}\n`),
  });
  assertEquals(r.v.violations, []);
  assertEquals(
    await Deno.readTextFile(join(r.v.dir, "Test/src/Shipped.Test.al")),
    SHIPPED_TESTS,
  );
});

Deno.test("H-21: mutant_kill builds keep the added helper and still leave the shipped test codeunits out", async () => {
  const r = await rebuild({
    [LIB_REL]: libWith(MAKE_TWO),
    "Test/src/Agent.Test.al": NEW_TESTS,
  }, { dropShippedTests: true });
  assertEquals(r.v.violations, []);
  assertEquals(r.lib, libWith(MAKE_TWO));
  assertEquals(
    await Deno.stat(join(r.v.dir, "Test/src/Shipped.Test.al")).catch(() =>
      null
    ),
    null,
  );
});

Deno.test("H-21: CRLF shipped text: the kept procedure is appended with the shipped line ends", async () => {
  const crlf = LIB.replace(/\n/g, "\r\n");
  const agent = crlf.replace(
    /}\r\n$/,
    `${MAKE_TWO.replace(/\n/g, "\r\n")}}\r\n`,
  );
  const r = await rebuild({ [LIB_REL]: agent }, { lib: crlf });
  assertEquals(r.v.violations, []);
  assertEquals(r.lib, agent);
});

Deno.test("H-21: every scorer version is bumped (added helper procedures change the verdict Test app)", async () => {
  const { SCORER_SUITE } = await import("../../../src/harness/verdict.ts");
  assertEquals(SCORER_SUITE, {
    build: "2",
    // 4 since H-26 (agent-added test reruns); H-21 made it 3.
    pass_to_pass: "4",
    fail_to_pass: "2",
    mutant_kill: "4",
  });
});

Deno.test("H-21 (Sol r1 P1): an added procedure whose name the shipped file uses (a built-in such as Error, a global, any identifier) restores the file", async () => {
  const assertLib = LIB.replace(
    "        exit(7);",
    "        if Counter < 0 then\n            Error('negative');\n        exit(7);",
  );
  await assertRestored(
    libWith(
      `
    local procedure Error(Message: Text)
    begin
    end;
`,
      assertLib,
    ),
    "Error",
    assertLib,
  );
  await assertRestored(
    libWith(`
    procedure Exit7(): Integer
    begin
        exit(7);
    end;

    procedure Integer(): Integer
    begin
        exit(1);
    end;
`),
    "Integer",
  );
});

Deno.test("H-21 (Sol r1 P1): a compiler directive inside an added procedure restores the file", async () => {
  for (
    const d of [
      "#pragma implicitwith disable",
      "#pragma warning disable AL0432",
      "#region x",
    ]
  ) {
    await assertRestored(
      libWith(`
    procedure MakeTwo(): Integer
    begin
${d}
        exit(Seed() - 5);
    end;
`),
      "directive",
    );
  }
});

Deno.test("H-21 (Sol r1 P3): a changed var section keyword (protected var) restores the file", async () => {
  await assertRestored(
    libWith(MAKE_TWO).replace("    var\n", "    protected var\n"),
    "shipped member",
  );
});
