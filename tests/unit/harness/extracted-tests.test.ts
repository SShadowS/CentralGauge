/**
 * M4-17a: [Test] procedures an agent adds to a SHIPPED test codeunit are
 * extracted from the frozen artifact into a generated test codeunit on top of
 * the pristine Test app (items A and B of the task). Mock only.
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { HARNESS_EXTRACTED_TEST_RANGE } from "../../../src/constants.ts";
import { ValidationError } from "../../../src/errors.ts";
import { exists, safeCopyTree } from "../../../src/harness/fsutil.ts";
import {
  addedTestCodeunits,
  buildVerdictWorkspace,
  EXTRACTED_TEST_DIR,
  normalizeAlBody,
} from "../../../src/harness/verdict-workspace.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";

const tmp = async () => await Deno.realPath(await Deno.makeTempDir());
const GEN = `Test/${EXTRACTED_TEST_DIR}/Extracted84990.Codeunit.al`;

const SHIPPED_OTHER =
  `codeunit 80010 "CGR Shipped Tests"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure ShippedPasses()\n    begin\n        Assert.AreEqual(10, 10, 'ten');\n    end;\n}\n`;
const LIB =
  `codeunit 80090 "CGR Test Library"\n{\n    procedure Seed(): Integer\n    begin\n        exit(7);\n    end;\n}\n`;
const SUITE = `codeunit 80020 "CGR Suite"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Counter: Integer;

    trigger OnRun()
    begin
        Counter := 5;
    end;

    [Test]
    procedure "Shipped Price Check"()
    var
        Price: Integer;
    begin
        // shipped
        Price := 10;
        Assert.AreEqual(10, Price, 'Price is ten');
    end;

    local procedure ShippedHelper(): Integer
    begin
        exit(1);
    end;
}
`;

/** The shipped suite with added globals (after the shipped ones) and procedures (before the closing brace). */
const agentSuite = (procs: string, globals = "", shipped = SUITE) =>
  shipped.replace(
    "        Counter: Integer;\n",
    `        Counter: Integer;\n${globals}`,
  ).replace(/}\n$/, `${procs}}\n`);

async function pristineDir(
  extra: Record<string, string> = {},
  coreRange: [number, number] = [70000, 70099],
): Promise<string> {
  const d = await tmp();
  await write(d, "Core/app.json", appJson(IDS.core, "CGR Core", coreRange, []));
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
  await write(d, "Test/src/Shipped.Test.al", SHIPPED_OTHER);
  await write(d, "Test/src/Suite.Test.al", SUITE);
  await write(d, "Test/src/Lib.Codeunit.al", LIB);
  for (const [rel, text] of Object.entries(extra)) await write(d, rel, text);
  return d;
}

async function artifactFrom(
  pristine: string,
  edits: Record<string, string>,
): Promise<string> {
  const a = await tmp();
  await safeCopyTree(pristine, a);
  for (const [rel, text] of Object.entries(edits)) await write(a, rel, text);
  return a;
}

async function rebuild(p: string, a: string) {
  const v = await buildVerdictWorkspace({
    pristine: p,
    artifact: a,
    out: join(await tmp(), "verdict"),
    symbolIds: new Set([IDS.assert]),
  });
  const gen = join(v.dir, ...GEN.split("/"));
  return {
    v,
    gen: await exists(gen) ? await Deno.readTextFile(gen) : null,
    added: await addedTestCodeunits(
      join(p, "Test"),
      join(v.dir, "Test"),
      new Set(v.excluded),
    ),
    notes: v.notes.join("\n"),
  };
}

const counted = (added: { codeunit: number; procedures: string[] }[]) =>
  added.find((a) => a.codeunit === 84990)?.procedures ?? [];

Deno.test("extraction: the reserved range is inside the fixture band: an agent object there is a violation and nothing is generated", async () => {
  assertEquals(HARNESS_EXTRACTED_TEST_RANGE, { start: 84990, end: 84999 });
  const p = await pristineDir();
  const { v, gen } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/Squat.Test.al":
        `codeunit 84990 "Squat"\n{\n    Subtype = Test;\n}\n`,
      "Test/src/Suite.Test.al": agentSuite(`
    [Test]
    procedure Mine()
    begin
        Assert.AreEqual(3, 1 + 2, 'sum');
    end;
`),
    }),
  );
  assertStringIncludes(
    v.violations.join("\n"),
    "codeunit 84990 is in the harness fixture band",
  );
  assertEquals(gen, null);
});

Deno.test("extraction: tests added to a shipped codeunit go to a generated codeunit with the added globals and helpers they use; shipped members are not carried", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {
    "Test/src/Suite.Test.al": agentSuite(
      `
    [Test]
    [HandlerFunctions('ConfirmYes')]
    procedure AddedUsesLib()
    begin
        Assert.AreEqual(7, Lib.Seed(), 'seed');
        CheckTwice(Tally);
    end;

    local procedure CheckTwice(N: Integer)
    begin
        Assert.AreEqual(N, N, 'same');
    end;

    [ConfirmHandler]
    procedure ConfirmYes(Question: Text[1024]; var Reply: Boolean)
    begin
        Reply := true;
    end;

    local procedure NotUsed()
    begin
        Error('unused');
    end;
`,
      `        Lib: Codeunit "CGR Test Library";\n        Tally: Integer;\n        Spare: Integer;\n`,
    ),
  });
  const { v, gen, added } = await rebuild(p, a);
  assertEquals(v.violations, []);
  assert(v.changed.includes("Test"));
  assertEquals(
    await Deno.readTextFile(join(v.dir, "Test/src/Suite.Test.al")),
    SUITE,
    "the shipped file stays pristine",
  );
  assert(gen !== null, "a generated codeunit is written");
  for (
    const s of [
      'codeunit 84990 "CG Extracted Tests 84990"',
      "Subtype = Test;",
      "TestPermissions = Disabled;",
      'Assert: Codeunit "Library Assert";',
      'Lib: Codeunit "CGR Test Library";',
      "Tally: Integer;",
      "procedure AddedUsesLib()",
      "[HandlerFunctions('ConfirmYes')]",
      "local procedure CheckTwice(N: Integer)",
      "[ConfirmHandler]",
      "procedure ConfirmYes(",
    ]
  ) {
    assertStringIncludes(gen!, s);
  }
  for (
    const s of [
      "NotUsed",
      "Spare",
      "Shipped Price Check",
      "ShippedHelper",
      "OnRun",
      "Counter",
    ]
  ) {
    assert(!gen!.includes(s), `${s} is not carried`);
  }
  assertEquals(added.map((x) => [x.codeunit, x.file, x.procedures]), [
    [84990, `${EXTRACTED_TEST_DIR}/Extracted84990.Codeunit.al`, [
      "AddedUsesLib",
    ]],
  ]);
});

Deno.test("extraction: an edited shipped procedure is never carried or counted (also under another case)", async () => {
  const p = await pristineDir();
  const edited = SUITE.replace("Price := 10;", "Price := 11;");
  for (
    const text of [
      edited,
      edited.replace('"Shipped Price Check"', '"SHIPPED PRICE CHECK"'),
    ]
  ) {
    const { gen, added } = await rebuild(
      p,
      await artifactFrom(p, { "Test/src/Suite.Test.al": text }),
    );
    assertEquals([gen, added], [null, []]);
  }
  const { gen, added } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/Suite.Test.al": agentSuite(
        `
    [Test]
    procedure Mine()
    begin
        Assert.AreEqual(3, 1 + 2, 'sum');
    end;
`,
        "",
        edited,
      ),
    }),
  );
  assertEquals(counted(added), ["Mine"]);
  assert(!gen!.includes("Price := 11;"), "the edit is not carried");
});

Deno.test("credit: a renamed copy of a shipped [Test] body does not count (case, whitespace, comments, quoted identifiers); a string-literal difference does", async () => {
  const p = await pristineDir();
  const { gen, added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/Suite.Test.al": agentSuite(`
    [Test]
    procedure CopyPlain()
    var
        Price: Integer;
    begin
        // shipped
        Price := 10;
        Assert.AreEqual(10, Price, 'Price is ten');
    end;

    [Test]
    procedure CopyNoisy()
    VAR "price":INTEGER;
    BEGIN
        /* copied */ PRICE:=10; // x
        "Assert".AreEqual(10,"Price",'Price is ten');
    END;

    [Test]
    procedure StringDiffers()
    var
        Price: Integer;
    begin
        Price := 10;
        Assert.AreEqual(10, Price, 'Price is TEN');
    end;
`),
    }),
  );
  assertEquals(counted(added), ["StringDiffers"]);
  assert(!gen!.includes("CopyPlain") && !gen!.includes("CopyNoisy"));
  assertStringIncludes(notes, "CopyPlain");
  assertStringIncludes(notes, "CopyNoisy");
  assertStringIncludes(
    notes,
    "copy of shipped [Test] 80020 Shipped Price Check",
  );
});

Deno.test("credit: a wrapper calling a shipped [Test] does not count (directly, qualified or through an added helper); a shipped library call is allowed", async () => {
  const p = await pristineDir();
  const { gen, added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/Suite.Test.al": agentSuite(
        `
    [Test]
    procedure WrapsUnqualified()
    begin
        "Shipped Price Check"();
    end;

    [Test]
    procedure WrapsQualified()
    var
        Other: Codeunit "CGR Shipped Tests";
    begin
        Other.ShippedPasses();
    end;

    [Test]
    procedure WrapsViaHelper()
    begin
        Relay();
    end;

    local procedure Relay()
    var
        Other: Codeunit "CGR Shipped Tests";
    begin
        Other.shippedpasses();
    end;

    [Test]
    procedure UsesLibrary()
    begin
        Assert.AreEqual(7, Lib.Seed(), 'library helper is fine');
    end;
`,
        `        Lib: Codeunit "CGR Test Library";\n`,
      ),
    }),
  );
  assertEquals(counted(added), ["UsesLibrary"]);
  for (const w of ["WrapsUnqualified", "WrapsQualified", "WrapsViaHelper"]) {
    assert(!gen!.includes(w), `${w} is not carried`);
    assertStringIncludes(notes, `${w}: calls shipped [Test]`);
  }
  assert(
    !gen!.includes("Relay"),
    "a helper only a dropped test uses stays out",
  );
});

Deno.test("extraction: a test needing a shipped local procedure or OnRun state is dropped with a note; a plain shipped global is carried", async () => {
  const p = await pristineDir();
  const { gen, added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/Suite.Test.al": agentSuite(`
    [Test]
    procedure NeedsLocal()
    begin
        Assert.AreEqual(1, ShippedHelper(), 'helper');
    end;

    [Test]
    procedure NeedsOnRunState()
    begin
        Assert.AreEqual(5, Counter, 'set in OnRun');
    end;

    [Test]
    procedure NeedsDroppedTest()
    begin
        NeedsLocal();
    end;

    [Test]
    procedure UsesAssert()
    begin
        Assert.AreEqual(2, 1 + 1, 'plain');
    end;
`),
    }),
  );
  assertEquals(counted(added), ["UsesAssert"]);
  assertStringIncludes(
    notes,
    "NeedsLocal: needs shipped procedure ShippedHelper",
  );
  assertStringIncludes(
    notes,
    "NeedsOnRunState: needs shipped global Counter, which the shipped OnRun trigger uses",
  );
  assertStringIncludes(
    notes,
    "NeedsDroppedTest: needs shipped procedure ShippedHelper (via NeedsLocal)",
  );
  assertStringIncludes(gen!, 'Assert: Codeunit "Library Assert";');
});

Deno.test("extraction: a TestPage in an added procedure marks the generated codeunit (refused by both callers)", async () => {
  const p = await pristineDir();
  const { added } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/Suite.Test.al": agentSuite(`
    [Test]
    procedure UsesPage()
    var
        P: TestPage "Customer Card";
    begin
        P.OpenView();
    end;
`),
    }),
  );
  assertEquals(added.map((x) => [x.codeunit, x.testPage]), [[84990, true]]);
});

Deno.test("extraction: new-file codeunits are unchanged and coexist with the generated one", async () => {
  const p = await pristineDir();
  const fresh =
    `codeunit 80100 "Agent"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure Fresh()\n    begin\n    end;\n}\n`;
  const { added, v } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/Agent.Test.al": fresh,
      "Test/src/Suite.Test.al": agentSuite(`
    [Test]
    procedure Mine()
    begin
        Assert.AreEqual(3, 1 + 2, 'sum');
    end;
`),
    }),
  );
  assertEquals(
    await Deno.readTextFile(join(v.dir, "Test/src/Agent.Test.al")),
    fresh,
  );
  assertEquals(added.map((x) => [x.codeunit, x.procedures]), [
    [80100, ["Fresh"]],
    [84990, ["Mine"]],
  ]);
});

Deno.test("extraction: zero added procedures writes nothing", async () => {
  const p = await pristineDir();
  const { gen, added, v } = await rebuild(p, await artifactFrom(p, {}));
  assertEquals([gen, added, v.notes, v.changed], [null, [], [], []]);
});

Deno.test("extraction: a workspace object in the reserved range fails closed with a note", async () => {
  const p = await pristineDir({
    "Core/src/Taken.Codeunit.al": `codeunit 84990 "Taken"\n{\n}\n`,
  }, [70000, 84999]);
  const { v, gen, added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/Suite.Test.al": agentSuite(`
    [Test]
    procedure Mine()
    begin
        Assert.AreEqual(3, 1 + 2, 'sum');
    end;
`),
    }),
  );
  assertEquals(v.violations, []);
  assertEquals([gen, added], [null, []]);
  assertStringIncludes(notes, "reserved extraction range 84990-84999");
  assertStringIncludes(notes, "Core/src/Taken.Codeunit.al: codeunit 84990");
});

Deno.test("extraction: the HX-002 pilot artifact (tests added to the shipped LeasingTests) is extracted whole", async () => {
  const fx = "tests/fixtures/harness/hx002-shipped-codeunit";
  const pristine = await Deno.readTextFile(
    join(fx, "LeasingTests.pristine.al"),
  );
  const agent = await Deno.readTextFile(join(fx, "LeasingTests.agent.al"));
  const p = await pristineDir({
    "Test/src/LeasingTests.Codeunit.al": pristine,
  });
  const { v, gen, added, notes } = await rebuild(
    p,
    await artifactFrom(p, { "Test/src/LeasingTests.Codeunit.al": agent }),
  );
  assertEquals(v.violations, []);
  assertEquals(notes, "");
  assertEquals(counted(added), [
    "ScheduleHasOneLinePerMonthWithStandardLineNumbers",
    "FirstInstallmentIsDueOnLeaseStartDate",
    "InstallmentDueDatesAreCountedInWholeMonthsFromStartDateWithoutDrift",
    "InstallmentAmountsSplitTotalWithRemainderOnLastLine",
    "RecreatingScheduleReplacesExistingLines",
    "CannotRescheduleLeaseWithInvoicedLine",
  ]);
  assertStringIncludes(gen!, "TestPermissions = Disabled;");
  assertStringIncludes(gen!, 'Assert: Codeunit "Library Assert";');
  assertStringIncludes(gen!, 'Lib: Codeunit "CGR Test Library";');
  assert(!gen!.includes("LeaseRateUsesCoreInternal"), "no shipped procedure");
  assertEquals(
    await Deno.readTextFile(join(v.dir, "Test/src/LeasingTests.Codeunit.al")),
    pristine,
  );
});

Deno.test("normalizeAlBody: the exact normalization", () => {
  assertEquals(
    normalizeAlBody(
      `var\n    X: Integer; // c\n  BEGIN /* b\n */ "My Proc"(); x:=1; Message('Hi  There'); d := 20270131D;\nend;`,
    ),
    `"var" "x" : "integer" ; "begin" "my proc" ( ) ; "x" : = 1 ; "message" ( 'Hi  There' ) ; "d" : = 20270131d ; "end" ;`,
  );
  assertEquals(
    normalizeAlBody(`begin "Assert".AreEqual(1,"Price",'A''b'); end;`),
    normalizeAlBody(`BEGIN\n  assert.areequal( 1, PRICE, 'A''b' ) ;\nEND;`),
  );
  assert(
    normalizeAlBody(`begin Message('a'); end;`) !==
      normalizeAlBody(`begin Message('A'); end;`),
    "string literals are case-sensitive",
  );
});

Deno.test("extraction: carried text that would declare another object in the generated file fails closed", async () => {
  const p = await pristineDir();
  // Unbalanced braces split across two added procedures: carrying only the
  // second would leave "codeunit 70001" at object level in the generated file.
  const { gen, added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/Suite.Test.al": agentSuite(`
    local procedure Opens()
    begin
        {
    end;

    [Test]
    procedure Smuggles()
    begin
        Assert.AreEqual(3, 1 + 2, 'sum');
        } codeunit 70001 "Smuggled"
    end;
`),
    }),
  );
  assertEquals([gen, added], [null, []]);
  assertStringIncludes(notes, "shipped codeunit 80020");
});

Deno.test("credit: a test that names a shipped test codeunit (it could run it whole) does not count", async () => {
  const p = await pristineDir();
  const { added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/Suite.Test.al": agentSuite(`
    [Test]
    procedure RunsSuite()
    begin
        Codeunit.Run(Codeunit::"CGR Shipped Tests");
    end;

    [Test]
    procedure Mine()
    begin
        Assert.AreEqual(3, 1 + 2, 'sum');
    end;
`),
    }),
  );
  assertEquals(counted(added), ["Mine"]);
  assertStringIncludes(
    notes,
    "RunsSuite: uses shipped test codeunit 80010 CGR Shipped Tests",
  );
});

// ---- M4-17a review: credit rules for new files, declarations, numeric ids, cycles, overloads ----

const NEW = "Test/src/Agent.Test.al";
const newFile = (procs: string, globals = "") =>
  `codeunit 80100 "Agent Tests"\n{\n    Subtype = Test;\n\n    var\n        Assert: Codeunit "Library Assert";\n${globals}${procs}}\n`;
const GOOD = `
    [Test]
    procedure Good()
    begin
        Assert.AreEqual(3, 1 + 2, 'sum');
    end;
`;

Deno.test("credit (new file): violating procedures are removed (never run, never counted); the rest of the codeunit is unchanged", async () => {
  const p = await pristineDir();
  const { v, added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      [NEW]: newFile(`
    [Test]
    procedure CopyOfShipped()
    var
        Price: Integer;
    begin
        Price := 10;
        Assert.AreEqual(10, Price, 'Price is ten');
    end;

    [Test]
    procedure Wraps()
    var
        Other: Codeunit "CGR Shipped Tests";
    begin
        Other.ShippedPasses();
    end;

    local procedure Relay()
    var
        Other: Codeunit "CGR Shipped Tests";
    begin
        Other.ShippedPasses();
    end;

    [Test]
    procedure ViaRelay()
    begin
        Relay();
    end;
${GOOD}`),
    }),
  );
  assertEquals(added.map((x) => [x.codeunit, x.procedures]), [
    [80100, ["Good"]],
  ]);
  const text = await Deno.readTextFile(join(v.dir, NEW));
  for (const gone of ["CopyOfShipped", "Wraps", "Relay", "ViaRelay"]) {
    assert(!text.includes(gone), `${gone} is removed`);
  }
  assertStringIncludes(text, GOOD);
  for (
    const n of [
      "CopyOfShipped: copy of shipped [Test] 80020 Shipped Price Check",
      "Wraps: calls shipped [Test] 80010 ShippedPasses",
      "ViaRelay: calls shipped [Test] 80010 ShippedPasses (via Relay)",
    ]
  ) {
    assertStringIncludes(notes, n);
  }
});

Deno.test("credit (new file): a codeunit without violations is left byte for byte", async () => {
  const p = await pristineDir();
  const text = newFile(GOOD);
  const { v, added } = await rebuild(
    p,
    await artifactFrom(p, { [NEW]: text }),
  );
  assertEquals(await Deno.readTextFile(join(v.dir, NEW)), text);
  assertEquals(added.map((x) => [x.codeunit, x.procedures]), [
    [80100, ["Good"]],
  ]);
});

Deno.test("credit (new file): a codeunit the parser cannot read is not run, with a note", async () => {
  const p = await pristineDir();
  const { v, added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      [NEW]: newFile(
        GOOD,
        "        [NonDebuggable]\n        Secret: Text;\n",
      ),
    }),
  );
  assertEquals(v.excluded, [80100]);
  assertEquals(added, []);
  assertStringIncludes(notes, "codeunit 80100");
  assertStringIncludes(notes, "not run");
});

Deno.test("credit: shipped test codeunit types in added globals, locals and parameters do not count", async () => {
  const p = await pristineDir();
  const { added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/Suite.Test.al": agentSuite(
        `
    [Test]
    procedure ViaGlobal()
    begin
        Whole.Run();
    end;

    [Test]
    procedure ViaParam()
    begin
        Take(Whole);
    end;

    local procedure Take(var S: Codeunit "CGR Suite")
    begin
    end;

    [Test]
    procedure ViaLocal()
    var
        S: Codeunit "CGR Shipped Tests";
    begin
        S.Run();
    end;
${GOOD}`,
        `        Whole: Codeunit "CGR Shipped Tests";\n`,
      ),
      [NEW]: newFile(
        `
    [Test]
    procedure NewViaGlobal()
    begin
        Other.Run();
    end;
${GOOD}`,
        `        Other: Codeunit "CGR Shipped Tests";\n`,
      ),
    }),
  );
  assertEquals(counted(added), ["Good"]);
  assertEquals(added.find((x) => x.codeunit === 80100)?.procedures, ["Good"]);
  for (const t of ["ViaGlobal", "ViaParam", "ViaLocal", "NewViaGlobal"]) {
    assertStringIncludes(notes, `${t}:`);
  }
});

Deno.test("credit: numeric references to a shipped test codeunit do not count (Codeunit.Run(n), Codeunit n, Codeunit::n)", async () => {
  const p = await pristineDir();
  const { added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      [NEW]: newFile(`
    [Test]
    procedure RunsById()
    begin
        Codeunit.Run(80010);
    end;

    [Test]
    procedure DeclaresById()
    var
        S: Codeunit 80020;
    begin
        S.Run();
    end;

    [Test]
    procedure ScopesById()
    begin
        Codeunit.Run(Codeunit::80010);
    end;

    [Test]
    procedure OtherIdIsFine()
    begin
        Codeunit.Run(80090);
    end;
${GOOD}`),
    }),
  );
  assertEquals(added.map((x) => x.procedures), [["OtherIdIsFine", "Good"]]);
  for (const t of ["RunsById", "DeclaresById", "ScopesById"]) {
    assertStringIncludes(notes, `${t}: uses shipped test codeunit`);
  }
});

Deno.test("credit: a violation anywhere on a call cycle reaches every member of it (mutual recursion)", async () => {
  const p = await pristineDir();
  const { gen, added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/Suite.Test.al": agentSuite(`
    [Test]
    procedure X()
    begin
        Y();
        Assert.AreEqual(1, ShippedHelper(), 'found after the recursion');
    end;

    local procedure Y()
    begin
        if false then
            X();
    end;

    [Test]
    procedure UsesY()
    begin
        Y();
        Assert.AreEqual(3, 1 + 2, 'sum');
    end;
${GOOD}`),
    }),
  );
  assertEquals(counted(added), ["Good"]);
  assertStringIncludes(notes, "UsesY: needs shipped procedure ShippedHelper");
  assert(!gen!.includes("procedure Y()"));
});

Deno.test("extraction: every overload of an added procedure is carried", async () => {
  const p = await pristineDir();
  const { gen, added } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/Suite.Test.al": agentSuite(`
    [Test]
    procedure UsesBoth()
    begin
        Check(1);
        Check('a');
    end;

    local procedure Check(N: Integer)
    begin
        Assert.AreEqual(N, N, 'int');
    end;

    local procedure Check(T: Text)
    begin
        Assert.AreEqual(T, T, 'text');
    end;
`),
    }),
  );
  assertEquals(counted(added), ["UsesBoth"]);
  assertStringIncludes(gen!, "local procedure Check(N: Integer)");
  assertStringIncludes(gen!, "local procedure Check(T: Text)");
});

Deno.test("credit: an agent object (not a codeunit) that runs a shipped test codeunit excludes every agent test (round 2 N1: it cannot be removed)", async () => {
  const p = await pristineDir();
  const { v, added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/Evil.Table.al":
        `table 80150 "Evil"\n{\n    trigger OnInsert()\n    begin\n        Codeunit.Run(80010);\n    end;\n}\n`,
      [NEW]: newFile(`
    [Test]
    procedure InsertsEvil()
    var
        E: Record "Evil";
    begin
        E.Insert(true);
    end;
${GOOD}`),
    }),
  );
  // Stricter than round 1 (which removed only InsertsEvil): a clean test can
  // fire the trigger too (RecordRef.Open(80150)), so nothing runs.
  assertEquals(added, []);
  assertEquals(v.excluded, [80100]);
  assertStringIncludes(
    notes,
    "Evil: uses shipped test codeunit 80010 CGR Shipped Tests; it cannot be removed, so no agent test is run or counted",
  );
});

// ---- M4-17a review round 2 ----

Deno.test("credit: a rejected member of an object the parser cannot remove (a tableextension trigger) excludes every agent test", async () => {
  const p = await pristineDir();
  const { v, gen, added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/LeaseExt.TableExt.al":
        `tableextension 80160 "Lease Ext" extends "CGR Lease Contract"\n{\n    trigger OnInsert()\n    begin\n        Codeunit.Run(Codeunit::"CGR Shipped Tests");\n    end;\n}\n`,
      [NEW]: newFile(GOOD),
      "Test/src/Suite.Test.al": agentSuite(`
    [Test]
    procedure Mine()
    begin
        Assert.AreEqual(3, 1 + 2, 'sum');
    end;
`),
    }),
  );
  assertEquals(added, []);
  assertEquals(gen, null);
  assert(v.excluded.includes(80100));
  assertStringIncludes(notes, "Lease Ext");
  assertStringIncludes(notes, "no agent test is run or counted");
});

Deno.test("credit: any integer literal equal to a shipped test codeunit id is a reference", async () => {
  const p = await pristineDir();
  const { added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      [NEW]: newFile(`
    [Test]
    procedure RunsViaVariable()
    var
        Id: Integer;
    begin
        Id := 80010;
        Codeunit.Run(Id);
    end;
${GOOD}`),
    }),
  );
  assertEquals(added.map((x) => x.procedures), [["Good"]]);
  assertStringIncludes(
    notes,
    "RunsViaVariable: uses shipped test codeunit 80010",
  );
});

// ---- M4-17a run 002: dispatch by a non-literal codeunit id ----

Deno.test("credit (run 002 regression): Codeunit.Run(80000 + 10) is rejected, in a new file and through a helper of an extracted test", async () => {
  const p = await pristineDir();
  const { gen, added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      [NEW]: newFile(`
    [Test]
    procedure RunsComputed()
    begin
        Codeunit.Run(80000 + 10);
    end;
${GOOD}`),
      "Test/src/Suite.Test.al": agentSuite(`
    [Test]
    procedure ViaDispatch()
    begin
        Dispatch(80000 + 10);
    end;

    local procedure Dispatch(Id: Integer)
    begin
        Codeunit.Run(Id);
    end;
${GOOD}`),
    }),
  );
  assertEquals(added.map((x) => [x.codeunit, x.procedures]), [
    [80100, ["Good"]],
    [84990, ["Good"]],
  ]);
  assert(!gen!.includes("Dispatch"));
  assertStringIncludes(
    notes,
    "RunsComputed: runs a codeunit by a non-literal id",
  );
  assertStringIncludes(
    notes,
    "ViaDispatch: runs a codeunit by a non-literal id (via Dispatch)",
  );
});

Deno.test("credit (run 002): every dynamic-dispatch pattern is rejected; literal ids and names of non-test codeunits stay allowed", async () => {
  const p = await pristineDir();
  const { added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      [NEW]: newFile(`
    [Test]
    procedure ViaVariable()
    var
        Id: Integer;
    begin
        Evaluate(Id, '80010');
        Codeunit.Run(Id);
    end;

    [Test]
    procedure ViaAllObj()
    var
        O: Record AllObj;
    begin
        O.FindFirst();
    end;

    [Test]
    procedure ViaAllObjWithCaption()
    var
        O: Record AllObjWithCaption;
    begin
        O.FindFirst();
    end;

    [Test]
    procedure ViaRecordRef()
    var
        R: RecordRef;
    begin
        R.Open(80150);
    end;

    [Test]
    procedure ViaVariant()
    var
        V: Variant;
    begin
        V := 1;
    end;

    [Test]
    procedure ViaSession()
    var
        S: Integer;
    begin
        StartSession(S, 80090);
    end;

    [Test]
    procedure ViaTask()
    begin
        TaskScheduler.CreateTask(80090, 0);
    end;

    [Test]
    procedure ViaRunCodeunit()
    begin
        Lib.RunCodeunit(80090);
    end;

    [Test]
    procedure LiteralLibraryId()
    begin
        Codeunit.Run(80090);
    end;

    [Test]
    procedure LibraryByName()
    begin
        Codeunit.Run(Codeunit::"CGR Test Library");
    end;

    [Test]
    procedure OtherLiteral()
    begin
        Codeunit.Run(50100);
    end;
${GOOD}`),
    }),
  );
  assertEquals(added.map((x) => x.procedures), [[
    "LiteralLibraryId",
    "LibraryByName",
    "OtherLiteral",
    "Good",
  ]]);
  for (
    const t of [
      "ViaVariable",
      "ViaAllObj",
      "ViaAllObjWithCaption",
      "ViaRecordRef",
      "ViaVariant",
      "ViaSession",
      "ViaTask",
      "ViaRunCodeunit",
    ]
  ) {
    assertStringIncludes(notes, `${t}: `);
  }
});

Deno.test("credit (run 002): a TestRunner codeunit in agent code excludes every agent test", async () => {
  const p = await pristineDir();
  const { v, added, notes } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/Runner.Codeunit.al":
        `codeunit 80170 "Agent Runner"\n{\n    Subtype = TestRunner;\n\n    trigger OnRun()\n    begin\n        Codeunit.Run(80090);\n    end;\n}\n`,
      [NEW]: newFile(GOOD),
    }),
  );
  assertEquals(added, []);
  assertEquals(v.excluded, [80100]);
  assertStringIncludes(notes, "Agent Runner: ");
  assertStringIncludes(notes, "no agent test is run or counted");
});

// ---- M4-17a run 002, R1: mutant_kill builds leave the shipped test codeunits out ----

async function rebuildDropped(p: string, a: string) {
  return await buildVerdictWorkspace({
    pristine: p,
    artifact: a,
    out: join(await tmp(), "verdict"),
    symbolIds: new Set([IDS.assert]),
    dropShippedTests: true,
  });
}

Deno.test("dropShippedTests: every shipped test codeunit is left out; the library, new files and the generated codeunit stay", async () => {
  const p = await pristineDir();
  const v = await rebuildDropped(
    p,
    await artifactFrom(p, {
      [NEW]: newFile(GOOD),
      "Test/src/Suite.Test.al": agentSuite(`
    [Test]
    procedure Mine()
    begin
        Assert.AreEqual(3, 1 + 2, 'sum');
    end;
`),
    }),
  );
  assertEquals(v.violations, []);
  for (
    const shipped of ["Test/src/Shipped.Test.al", "Test/src/Suite.Test.al"]
  ) {
    assertEquals(await exists(join(v.dir, shipped)), false, shipped);
  }
  assert(await exists(join(v.dir, "Test/src/Lib.Codeunit.al")));
  assert(await exists(join(v.dir, NEW)));
  const gen = await Deno.readTextFile(join(v.dir, ...GEN.split("/")));
  assertStringIncludes(gen, "procedure Mine()");
  assertEquals(
    (await addedTestCodeunits(join(p, "Test"), join(v.dir, "Test"))).map((
      x,
    ) => [x.codeunit, x.procedures]),
    [[80100, ["Good"]], [84990, ["Mine"]]],
  );
});

Deno.test("dropShippedTests: a shipped object that references a shipped test codeunit fails closed", async () => {
  const p = await pristineDir({
    "Test/src/Lib.Codeunit.al":
      `codeunit 80090 "CGR Test Library"\n{\n    procedure RunSuite()\n    begin\n        Codeunit.Run(Codeunit::"CGR Suite");\n    end;\n}\n`,
  });
  const a = await artifactFrom(p, {});
  await assertRejects(
    () => rebuildDropped(p, a),
    ValidationError,
    "Test/src/Lib.Codeunit.al references shipped test codeunit 80020 CGR Suite",
  );
});

// ---- M4-17a run 002 review: F1 dangling globals, F2 collisions with shipped objects ----

Deno.test("F1: a new-file global typed as a shipped test codeunit is cut with the members that used it (the var keyword too when its section empties)", async () => {
  const p = await pristineDir();
  const onlyTainted =
    `codeunit 80101 "Agent Two"\n{\n    Subtype = Test;\n\n    var\n        Other: Codeunit "CGR Shipped Tests";\n\n    [Test]\n    procedure Wraps()\n    begin\n        Other.Run();\n    end;\n${GOOD}}\n`;
  const { v, added } = await rebuild(
    p,
    await artifactFrom(p, {
      [NEW]: newFile(
        `
    [Test]
    procedure Wraps()
    begin
        Other.Run();
    end;
${GOOD}`,
        `        Other: Codeunit "CGR Shipped Tests";\n        Keep: Integer;\n`,
      ),
      "Test/src/Two.Test.al": onlyTainted,
    }),
  );
  assertEquals(v.excluded, []);
  const one = await Deno.readTextFile(join(v.dir, NEW));
  assert(!one.includes("CGR Shipped Tests"), one);
  assertStringIncludes(one, "Keep: Integer;");
  assertStringIncludes(one, 'Assert: Codeunit "Library Assert";');
  const two = await Deno.readTextFile(join(v.dir, "Test/src/Two.Test.al"));
  assert(!two.includes("CGR Shipped Tests"), two);
  assert(!/\bvar\b/.test(two), "the emptied var section is gone");
  assertEquals(added.map((x) => [x.codeunit, x.procedures]), [
    [80100, ["Good"]],
    [80101, ["Good"]],
  ]);
});

Deno.test("F2: an agent Test object colliding with a shipped Test object (same kind, id or name) is a violation", async () => {
  const p = await pristineDir();
  const { v } = await rebuild(
    p,
    await artifactFrom(p, {
      "Test/src/SameId.Test.al":
        `codeunit 80010 "Imposter"\n{\n    Subtype = Test;\n}\n`,
      "Test/src/SameName.Test.al":
        `codeunit 80150 "CGR Shipped Tests"\n{\n    Subtype = Test;\n}\n`,
      "Test/src/OtherKind.Table.al": `table 80010 "Fine"\n{\n}\n`,
    }),
  );
  const text = v.violations.join("\n");
  assertStringIncludes(
    text,
    "Test/src/SameId.Test.al: codeunit 80010 collides with shipped codeunit 80010 CGR Shipped Tests",
  );
  assertStringIncludes(
    text,
    "Test/src/SameName.Test.al: codeunit 80150 collides with shipped codeunit 80010 CGR Shipped Tests",
  );
  assert(!text.includes("OtherKind"), text);
});
