/**
 * The shipped non-test helper codeunit of the Test app ("CGR Test Library").
 * H-35 (ruling Q4) replaces the H-21/H-30 member merge: an edited helper is
 * the agent's file as written, judged by the credit rules like a new Test
 * file (violators removed). Unreadable agent text still fails closed: the
 * shipped file stays and no agent test is run or counted. Mock only.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { safeCopyTree } from "../../../src/harness/fsutil.ts";
import { hashTree } from "../../../src/harness/hash.ts";
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

Deno.test("H-21/H-30: every scorer version is bumped (the merged helper changes the verdict Test app)", async () => {
  const { SCORER_SUITE } = await import("../../../src/harness/verdict.ts");
  assertEquals(SCORER_SUITE, {
    // H-21 made build 2, pass_to_pass 3, fail_to_pass 2, mutant_kill 4;
    // H-26 pass_to_pass 4; H-30 ("merge, shipped wins") bumps all four.
    build: "3",
    pass_to_pass: "5",
    fail_to_pass: "3",
    mutant_kill: "5",
  });
});

// ---- H-30 (owner 2026-10-18, "merge, shipped wins") ----

Deno.test("H-30: CRLF shipped text: a kept global and procedure use the shipped line ends", async () => {
  const crlf = LIB.replace(/\n/g, "\r\n");
  const agent = crlf.replace(
    "        Counter: Integer;\r\n",
    "        Counter: Integer;\r\n        Extra: Integer;\r\n",
  ).replace(/}\r\n$/, `${MAKE_TWO.replace(/\n/g, "\r\n")}}\r\n`);
  const r = await rebuild({ [LIB_REL]: agent }, { lib: crlf });
  assertEquals(r.v.violations, []);
  assertEquals(r.lib, agent);
});

Deno.test("H-30: internalsVisibleTo in a production app.json is kept only for the shipped Test identity; other entries and other changed keys are dropped with a note", async () => {
  const p = await pristineDir();
  const a = await tmp();
  await safeCopyTree(p, a);
  const core = JSON.parse(await Deno.readTextFile(join(a, "Core/app.json")));
  const testId = { id: IDS.test, name: "CGR Test", publisher: "CentralGauge" };
  core.internalsVisibleTo = [
    testId,
    { id: IDS.oracle, name: "CGR Oracle", publisher: "CentralGauge" },
  ];
  core.features = ["NoImplicitWith"];
  await write(a, "Core/app.json", JSON.stringify(core, null, 2));
  const v = await buildVerdictWorkspace({
    pristine: p,
    artifact: a,
    out: join(await tmp(), "verdict"),
    symbolIds: new Set([IDS.assert]),
  });
  assertEquals(v.violations, []);
  const merged = JSON.parse(
    await Deno.readTextFile(join(v.dir, "Core/app.json")),
  );
  assertEquals(merged.internalsVisibleTo, [testId]);
  assertEquals(merged.features, undefined);
  const notes = v.notes.join("\n");
  assertStringIncludes(
    notes,
    "Core: app.json internalsVisibleTo entry kept: CGR Test",
  );
  assertStringIncludes(
    notes,
    `Core: app.json internalsVisibleTo entry dropped: ${IDS.oracle} CGR Oracle (not the shipped Test app)`,
  );
  assertStringIncludes(
    notes,
    "Core: app.json features differs from the shipped value; the shipped value is kept",
  );
});

Deno.test("H-30: internalsVisibleTo in the Test app.json itself is dropped with a note; a case-changed id still names the Test app", async () => {
  const p = await pristineDir();
  const a = await tmp();
  await safeCopyTree(p, a);
  const test = JSON.parse(await Deno.readTextFile(join(a, "Test/app.json")));
  test.internalsVisibleTo = [{
    id: IDS.core,
    name: "CGR Core",
    publisher: "CentralGauge",
  }];
  await write(a, "Test/app.json", JSON.stringify(test, null, 2));
  const core = JSON.parse(await Deno.readTextFile(join(a, "Core/app.json")));
  core.internalsVisibleTo = [
    { id: IDS.test.toUpperCase(), name: "CGR Test", publisher: "CentralGauge" },
  ];
  await write(a, "Core/app.json", JSON.stringify(core, null, 2));
  const v = await buildVerdictWorkspace({
    pristine: p,
    artifact: a,
    out: join(await tmp(), "verdict"),
    symbolIds: new Set([IDS.assert]),
  });
  assertEquals(v.violations, []);
  const t = JSON.parse(await Deno.readTextFile(join(v.dir, "Test/app.json")));
  assertEquals(t.internalsVisibleTo, undefined);
  const c = JSON.parse(await Deno.readTextFile(join(v.dir, "Core/app.json")));
  assertEquals(c.internalsVisibleTo.length, 1);
  const notes = v.notes.join("\n");
  assertStringIncludes(
    notes,
    "Test: app.json internalsVisibleTo entry dropped",
  );
  assertStringIncludes(
    notes,
    "Core: app.json internalsVisibleTo entry kept: CGR Test",
  );
});

// ---- H-30 Sol review r1 ----

// ---- H-30 Sol review r2 ----

Deno.test("H-30 (Sol r2 P1): app.json values that are not strings (an id or name object with a broken toString) are dropped or refused with a note, never a crash", async () => {
  const p = await pristineDir();
  const a = await tmp();
  await safeCopyTree(p, a);
  const core = JSON.parse(await Deno.readTextFile(join(a, "Core/app.json")));
  core.internalsVisibleTo = [{
    id: { toString: null },
    name: { toString: null },
    publisher: "Rejected",
  }];
  await write(a, "Core/app.json", JSON.stringify(core, null, 2));
  const test = JSON.parse(await Deno.readTextFile(join(a, "Test/app.json")));
  test.name = { toString: null };
  await write(a, "Test/app.json", JSON.stringify(test, null, 2));
  const v = await buildVerdictWorkspace({
    pristine: p,
    artifact: a,
    out: join(await tmp(), "verdict"),
    symbolIds: new Set([IDS.assert]),
  });
  assertStringIncludes(
    v.violations.join("\n"),
    'Test: name changed from CGR Test to {"toString":null}',
  );
  const c = JSON.parse(await Deno.readTextFile(join(v.dir, "Core/app.json")));
  assertEquals(c.internalsVisibleTo, undefined);
  assertStringIncludes(
    v.notes.join("\n"),
    'Core: app.json internalsVisibleTo entry dropped: {"toString":null} {"toString":null} (not the shipped Test app)',
  );
});

// ---- H-30 Sol review r3 ----

// ---- H-30 Sol review r4 ----

// ---- H-30 run 002 (orchestrator review r1 BLOCKER) ----

/** AL ends a line at these too; the noise stripper only at LF. */
const ODD_EOLS = ["\r", "\u2028", "\u2029", "\u0085"];

Deno.test("H-30 r002: a line terminator other than LF or CRLF in an edited helper (a // comment hiding a subscriber) restores the shipped file whole", async () => {
  for (const eolChar of ODD_EOLS) {
    const hidden = libWith(`
    procedure Added()
    begin
//x${eolChar}end;${eolChar}[EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnAfterPostRentalContract', '', false, false)]${eolChar}local procedure Hook(var Amount: Decimal)${eolChar}begin
        Amount := 0;
    end;
`);
    const r = await rebuild({ [LIB_REL]: hidden });
    assertEquals(r.v.violations, []);
    assertEquals(r.lib, LIB, `restored whole (${JSON.stringify(eolChar)})`);
    assertStringIncludes(
      r.notes,
      "a line terminator other than LF or CRLF; no agent test is run or counted",
    );
  }
});

Deno.test("H-30 r002: a line terminator other than LF or CRLF in a new or edited Test file runs and counts no agent test (the credit rules cannot read it)", async () => {
  for (const eolChar of ODD_EOLS) {
    // The comment hides a procedure that runs a shipped [Test].
    const sneaky = NEW_TESTS.replace(
      "    [Test]\n    procedure UsesAddedHelper()",
      `    procedure Wrap()\n    begin\n//x${eolChar}end;${eolChar}procedure Steal()${eolChar}begin${eolChar}ShippedPasses();\n    end;\n\n    [Test]\n    procedure UsesAddedHelper()`,
    ).replace("Lib.MakeTwo()", "2");
    const r = await rebuild({ "Test/src/Agent.Test.al": sneaky });
    assertEquals(r.v.violations, []);
    assertEquals(
      r.added,
      [],
      `no agent test counts (${JSON.stringify(eolChar)})`,
    );
    assertStringIncludes(
      r.notes,
      "Test/src/Agent.Test.al: a line terminator other than LF or CRLF; no agent test is run or counted",
    );
    const edited = await rebuild({
      "Test/src/Shipped.Test.al": SHIPPED_TESTS.replace(
        /}\n$/,
        `\n    [Test]\n    procedure Extra()\n    begin\n//x${eolChar}ShippedPasses();\n    end;\n}\n`,
      ),
      "Test/src/Agent.Test.al": NEW_TESTS.replace("Lib.MakeTwo()", "2"),
    });
    assertEquals(edited.added, []);
    assertStringIncludes(
      edited.notes,
      "Test/src/Shipped.Test.al: a line terminator other than LF or CRLF; no agent test is run or counted",
    );
  }
});

Deno.test("H-30 r002 (Sol): a multiline string (@'...') in agent Test text fails closed: the helper is restored whole, and in a test file no agent test runs or counts", async () => {
  const hidden = libWith(`
    procedure Added()
    var
        T: Text;
    begin
        T := @'
//'; end; [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnAfterPostRentalContract', '', false, false)] local procedure Hook(var Amount: Decimal) begin
        Amount := 0;
    end;
`);
  const r = await rebuild({ [LIB_REL]: hidden });
  assertEquals(r.lib, LIB);
  assertStringIncludes(
    r.notes,
    "a multiline string (@'...'); no agent test is run or counted",
  );
  const t = await rebuild({
    "Test/src/Agent.Test.al": NEW_TESTS.replace("Lib.MakeTwo()", "2").replace(
      "    [Test]",
      "    procedure Wrap()\n    var\n        T: Text;\n    begin\n        T := @'\n//'; ShippedPasses();\n    end;\n\n    [Test]",
    ),
  });
  assertEquals(t.added, []);
  assertStringIncludes(
    t.notes,
    "Test/src/Agent.Test.al: a multiline string (@'...'); no agent test is run or counted",
  );
});

// ---- H-30 run 003 (owner: unreadable files leave the build) ----

Deno.test("H-30 r003: an unreadable new Test file (bare CR) with an automatic subscriber the credit rules would cut is removed from the build; the other agent files stay but no agent test counts", async () => {
  const subscriber = `codeunit 80031 "CGR Agent Hooks"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnAfterPostRentalContract', '', false, false)]
    local procedure Hook(var Amount: Decimal)
    begin
        // run a shipped test\r        Codeunit.Run(80010);
    end;
}
`;
  const r = await rebuild({
    "Test/src/Hooks.Codeunit.al": subscriber,
    "Test/src/Agent.Test.al": NEW_TESTS.replace("Lib.MakeTwo()", "2"),
  });
  assertEquals(r.v.violations, []);
  assertEquals(
    await Deno.stat(join(r.v.dir, "Test/src/Hooks.Codeunit.al")).catch(() =>
      null
    ),
    null,
    "the unreadable file is not in the build",
  );
  assert(
    await Deno.stat(join(r.v.dir, "Test/src/Agent.Test.al")).then(() => true),
  );
  assertEquals(r.added, []);
  assertStringIncludes(
    r.notes,
    "Test/src/Hooks.Codeunit.al: a line terminator other than LF or CRLF; no agent test is run or counted",
  );
  assertStringIncludes(
    r.notes,
    "Test/src/Hooks.Codeunit.al: removed from the build",
  );
});

Deno.test("H-30 r003: an unreadable edited shipped test file stays exactly as shipped in the build", async () => {
  const r = await rebuild({
    "Test/src/Shipped.Test.al": SHIPPED_TESTS.replace(
      /}\n$/,
      "\n    [EventSubscriber(ObjectType::Codeunit, Codeunit::\"CGR Rental-Post\", 'OnAfterPostRentalContract', '', false, false)]\n    local procedure Hook(var Amount: Decimal)\n    begin\n        //x\r        Amount := 0;\n    end;\n}\n",
    ),
  });
  assertEquals(
    await Deno.readTextFile(join(r.v.dir, "Test/src/Shipped.Test.al")),
    SHIPPED_TESTS,
  );
  assertStringIncludes(
    r.notes,
    "Test/src/Shipped.Test.al: the shipped file stays in the build",
  );
});

// ---- H-35 (design.md 4, design-r2 4.1, ruling Q4): the helper as written; G's raw Test ----

/** H-35: edits the H-30 merge refused, all at once, on top of an added procedure. */
const LIB_REWRITTEN = libWith(`${MAKE_TWO}
    trigger OnRun()
    begin
        Counter := 99;
    end;
`).replace("exit(7);", "exit(8);").replace(
  "{\n    var",
  "{\n    SingleInstance = true;\n\n    var",
);

Deno.test("H-35: the shipped helper is the agent's file as written (a changed shipped procedure, a trigger, a property and an added procedure all kept), with and without the shipped tests", async () => {
  for (const dropShippedTests of [false, true]) {
    const r = await rebuild({
      [LIB_REL]: LIB_REWRITTEN,
      "Test/src/Agent.Test.al": NEW_TESTS,
    }, { dropShippedTests });
    assertEquals(r.v.violations, []);
    assertEquals(r.lib, LIB_REWRITTEN);
    assertEquals(r.added.map((a) => a.codeunit), [80030]);
  }
});

Deno.test("H-35: a helper procedure the credit rules reject is removed from the agent's text; the rest stays as written", async () => {
  const agent = LIB_REWRITTEN.replace(
    /}\n$/,
    "\n    procedure Sneaky()\n    begin\n        Codeunit.Run(80010);\n    end;\n}\n",
  );
  const r = await rebuild({
    [LIB_REL]: agent,
    "Test/src/Agent.Test.al": NEW_TESTS,
  }, { dropShippedTests: true });
  assertEquals(r.v.violations, []);
  assert(!r.lib.includes("Sneaky"));
  const ws = (s: string) => s.replace(/\s+/g, " ");
  assertEquals(ws(r.lib), ws(LIB_REWRITTEN));
  assertStringIncludes(r.notes, "Sneaky");
});

Deno.test("H-35: rawTest copies the pristine Test app byte for byte (app.json included), whatever the agent wrote; production still comes from the artifact", async () => {
  const p = await pristineDir();
  const a = await tmp();
  await safeCopyTree(p, a);
  await write(a, LIB_REL, LIB_REWRITTEN);
  await write(a, "Test/src/Agent.Test.al", NEW_TESTS);
  await write(
    a,
    "Test/src/Shipped.Test.al",
    SHIPPED_TESTS.replace(/}\n$/, `${MAKE_TWO}}\n`),
  );
  await write(
    a,
    "Test/app.json",
    (await Deno.readTextFile(join(p, "Test/app.json"))).replace(
      '"CGR Test"',
      '"CGR Test Renamed"',
    ),
  );
  await write(
    a,
    "Core/src/Core.Codeunit.al",
    `codeunit 70000 "CGR Core"\n{\n    procedure Changed()\n    begin\n    end;\n}\n`,
  );
  const v = await buildVerdictWorkspace({
    pristine: p,
    artifact: a,
    out: join(await tmp(), "g"),
    symbolIds: new Set([IDS.assert]),
    rawTest: true,
  });
  assertEquals(v.violations, []);
  assertEquals(
    await hashTree(join(v.dir, "Test"), "task"),
    await hashTree(join(p, "Test"), "task"),
  );
  assertEquals(
    await Deno.readTextFile(join(v.dir, "Test/app.json")),
    await Deno.readTextFile(join(p, "Test/app.json")),
  );
  assertEquals(v.changed, ["Core"]);
  assertEquals(v.excluded, []);
  assertEquals(v.notes, []);
});
