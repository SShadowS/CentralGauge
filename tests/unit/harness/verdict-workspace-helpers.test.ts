/**
 * H-21: NEW plain procedures an agent adds to a SHIPPED non-test helper
 * codeunit of the Test app ("CGR Test Library") survive judging, appended to
 * the shipped text. H-30 (owner 2026-10-18, "merge, shipped wins"): every
 * shipped member stays as shipped and each agent addition (procedure,
 * overload of another arity, global, `using` line) is kept on its own; a
 * changed shipped member, a trigger, a property, an attributed member or any
 * other header change is dropped with a note, never the whole file. A file
 * that cannot be split cleanly is still restored whole. Mock only.
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

/**
 * H-30: the agent's library edit is merged: the verdict library is exactly
 * `want`, and every `whys` text is in the notes.
 */
async function assertMerged(
  libText: string,
  want: string,
  whys: string[],
  lib = LIB,
) {
  const r = await rebuild({
    [LIB_REL]: libText,
    "Test/src/Agent.Test.al": NEW_TESTS,
  }, { lib });
  assertEquals(r.v.violations, []);
  assertEquals(r.lib, want);
  for (const w of whys) assertStringIncludes(r.notes, w);
  return r;
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
  // H-30 note wording: every kept addition is named with its kind.
  assertStringIncludes(r.notes, "agent additions kept: procedure MakeTwo");
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
  assertStringIncludes(
    r.notes,
    "agent additions kept: procedure Helper1, procedure Helper2",
  );
});

// H-21 -> H-30: a changed shipped member no longer restores the whole file.
Deno.test("H-21/H-30: a changed existing procedure is restored as shipped; the added procedure is kept", async () => {
  await assertMerged(
    libWith(MAKE_TWO).replace("exit(7);", "exit(8);"),
    libWith(MAKE_TWO),
    [
      "procedure Seed changes a shipped member",
      "agent additions kept: procedure MakeTwo",
    ],
  );
});

// H-21 -> H-30: shipped wins, so a removed or reordered member is shipped again.
Deno.test("H-21/H-30: a removed or moved shipped member stays as shipped; the added procedure is kept", async () => {
  await assertMerged(
    libWith(MAKE_TWO).replace("    var\n        Counter: Integer;\n\n", ""),
    libWith(MAKE_TWO),
    ["global Counter is removed", "agent additions kept: procedure MakeTwo"],
  );
  const two = LIB.replace(
    /}\n$/,
    "\n    procedure Other()\n    begin\n    end;\n}\n",
  );
  const swapped = LIB.replace(
    "    procedure Seed()",
    "    procedure Other()\n    begin\n    end;\n\n    procedure Seed()",
  );
  await assertMerged(swapped, two, ["shipped members are reordered"], two);
});

// H-21 -> H-30: only the attributed member is dropped (shipped and oracle
// tests bind CGR Test Library, so an added subscriber would fire in them).
Deno.test("H-21/H-30: an added attributed procedure (event subscriber, test, handler, NonDebuggable, event publisher) is dropped; the plain one is kept", async () => {
  for (
    const attr of [
      "[EventSubscriber(ObjectType::Table, Database::Customer, 'OnAfterInsertEvent', '', false, false)]",
      "[Test]",
      "[ConfirmHandler]",
      "[NonDebuggable]",
      "[IntegrationEvent(false, false)]",
    ]
  ) {
    const r = await assertMerged(
      libWith(`${MAKE_TWO}
    ${attr}
    procedure Hooked()
    begin
    end;
`),
      libWith(MAKE_TWO),
      ["procedure Hooked carries an attribute", "procedure MakeTwo"],
    );
    assert(!r.lib.includes("Hooked"));
  }
});

// H-21 -> H-30: new globals are kept (owner ruling).
Deno.test("H-21/H-30: a new global variable is kept in the shipped var section", async () => {
  const want = libWith(MAKE_TWO).replace(
    "        Counter: Integer;\n",
    "        Counter: Integer;\n        Extra: Integer;\n",
  );
  await assertMerged(
    libWith(MAKE_TWO).replace(
      "        Counter: Integer;\n",
      "        Counter: Integer;\n        Extra: Integer;\n",
    ),
    want,
    ["agent additions kept: procedure MakeTwo, global Extra"],
  );
  await assertMerged(
    libWith(`
    var
        Late: Integer;
${MAKE_TWO}`),
    libWith(MAKE_TWO).replace(
      "        Counter: Integer;\n",
      "        Counter: Integer;\n        Late: Integer;\n",
    ),
    ["global Late"],
  );
});

Deno.test("H-21/H-30: a new trigger is dropped; the added procedure is kept", async () => {
  await assertMerged(
    libWith(`${MAKE_TWO}
    trigger OnRun()
    begin
        Counter := 99;
    end;
`),
    libWith(MAKE_TWO),
    ["trigger OnRun is added", "procedure MakeTwo"],
  );
});

Deno.test("H-21/H-30: a new codeunit property is dropped; the added procedure is kept", async () => {
  await assertMerged(
    libWith(MAKE_TWO).replace(
      "{\n    var",
      "{\n    SingleInstance = true;\n\n    var",
    ),
    libWith(MAKE_TWO),
    ["property SingleInstance", "procedure MakeTwo"],
  );
});

// H-21 -> H-30: an overload of another arity is kept; one that could take a
// shipped call (same parameter count) or that names a shipped global is not.
Deno.test("H-21/H-30: a new overload with another parameter count is kept; a procedure named like a shipped global is dropped", async () => {
  const seed = `
    procedure SEED(Offset: Integer): Integer
    begin
        exit(7 + Offset);
    end;
`;
  await assertMerged(libWith(seed), libWith(seed), [
    "agent additions kept: procedure SEED",
  ]);
  await assertMerged(
    libWith(`
    procedure "counter"(): Integer
    begin
        exit(0);
    end;
`),
    LIB,
    ["procedure counter has the name of a shipped member"],
  );
});

Deno.test("H-21/H-30: a changed object header is restored, a smuggled object is dropped; the added procedure is kept", async () => {
  await assertMerged(
    libWith(MAKE_TWO).replace(
      '"CGR Test Library"',
      '"CGR Test Library" implements "Some Interface"',
    ),
    libWith(MAKE_TWO),
    ["header is changed", "procedure MakeTwo"],
  );
  await assertMerged(
    `${libWith(MAKE_TWO)}\ncodeunit 80091 "CGR Smuggled"\n{\n}\n`,
    libWith(MAKE_TWO),
    ["codeunit 80091 is not in the shipped file", "procedure MakeTwo"],
  );
});

// H-21 -> H-30: the rejected procedure is dropped on its own.
Deno.test("H-21/H-30: an added procedure the credit rules reject (calls a shipped [Test], runs a shipped test codeunit, dynamic dispatch) is dropped; the others are kept", async () => {
  for (
    const body of [
      "begin\n        ShippedPasses();",
      "begin\n        Codeunit.Run(80010);",
      'begin\n        Codeunit.Run(Codeunit::"CGR Shipped Tests");',
      "var\n        Id: Integer;\n    begin\n        Id := 80000;\n        Codeunit.Run(Id + 10);",
      'var\n        Shipped: Codeunit "CGR Shipped Tests";\n    begin\n        Shipped.Run();',
    ]
  ) {
    const r = await assertMerged(
      libWith(`${MAKE_TWO}
    procedure Sneaky()
    ${body}
    end;
`),
      libWith(MAKE_TWO),
      ["added procedure Sneaky:", "agent additions kept: procedure MakeTwo"],
    );
    assert(!r.lib.includes("Sneaky"));
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

// H-21 -> H-30: the rebinding procedure is dropped on its own (it could
// still rebind shipped code, so it is never kept).
Deno.test("H-21 (Sol r1 P1)/H-30: an added procedure whose name the shipped file uses (a built-in such as Error, a global, any identifier) is dropped; the others are kept", async () => {
  const assertLib = LIB.replace(
    "        exit(7);",
    "        if Counter < 0 then\n            Error('negative');\n        exit(7);",
  );
  await assertMerged(
    libWith(
      `
    local procedure Error(Message: Text)
    begin
    end;
`,
      assertLib,
    ),
    assertLib,
    ["procedure Error has a name the shipped file uses"],
    assertLib,
  );
  const exit7 = `
    procedure Exit7(): Integer
    begin
        exit(7);
    end;
`;
  await assertMerged(
    libWith(`${exit7}
    procedure Integer(): Integer
    begin
        exit(1);
    end;
`),
    libWith(exit7),
    [
      "procedure Integer has a name the shipped file uses",
      "agent additions kept: procedure Exit7",
    ],
  );
});

Deno.test("H-21 (Sol r1 P1)/H-30: a compiler directive inside an added procedure drops it", async () => {
  for (
    const d of [
      "#pragma implicitwith disable",
      "#pragma warning disable AL0432",
      "#region x",
    ]
  ) {
    await assertMerged(
      libWith(`
    procedure MakeTwo(): Integer
    begin
${d}
        exit(Seed() - 5);
    end;
`),
      LIB,
      ["procedure MakeTwo contains a compiler directive"],
    );
  }
});

// H-21 -> H-30: the shipped section keyword wins; the addition is kept.
Deno.test("H-21 (Sol r1 P3)/H-30: a changed var section keyword (protected var) is restored as shipped", async () => {
  await assertMerged(
    libWith(MAKE_TWO).replace("    var\n", "    protected var\n"),
    libWith(MAKE_TWO),
    ["global Counter changes a shipped member", "procedure MakeTwo"],
  );
});

// ---- H-30 (owner 2026-10-18, "merge, shipped wins") ----

Deno.test("H-30: a changed shipped procedure is restored while the agent's new procedure in the same file is kept, and the agent test calling it is counted", async () => {
  const r = await assertMerged(
    libWith(MAKE_TWO).replace("        Counter += 1;\n", ""),
    libWith(MAKE_TWO),
    ["procedure Seed changes a shipped member; not kept, the shipped member stays"],
  );
  assertEquals(
    r.added.map((t) => [t.codeunit, t.procedures]),
    [[80030, ["UsesAddedHelper"]]],
  );
  assert(!r.notes.includes("the shipped file is restored"));
});

Deno.test("H-30: a duplicate of a shipped signature is dropped; so is an overload with a shipped overload's parameter count (it could take a shipped call)", async () => {
  await assertMerged(
    libWith(`
    procedure Seed(): Integer
    begin
        exit(8);
    end;
`),
    LIB,
    ["procedure Seed duplicates a shipped signature"],
  );
  const pick = libWith(`
    procedure Pick(X: Decimal): Decimal
    begin
        exit(X);
    end;
`);
  await assertMerged(
    libWith(
      `
    procedure Pick(X: Integer): Decimal
    begin
        exit(X + 1);
    end;
`,
      pick,
    ),
    pick,
    ["procedure Pick has the parameter count of a shipped overload"],
    pick,
  );
});

Deno.test("H-30: a new using line is kept before the object; another header change is restored", async () => {
  const want = `using System.Environment;\n\n${libWith(MAKE_TWO)}`;
  await assertMerged(
    `using System.Environment;\n\n${libWith(MAKE_TWO)}`,
    want,
    ["agent additions kept: procedure MakeTwo, using System.Environment"],
  );
  await assertMerged(
    `using System.Environment;\n#pragma warning disable AL0432\n${
      libWith(MAKE_TWO)
    }`,
    want,
    ["header is changed", "using System.Environment"],
  );
  // Not a plain using statement: restored, never kept.
  await assertMerged(
    `using System.Environment extra;\n${libWith(MAKE_TWO)}`,
    libWith(MAKE_TWO),
    ["header is changed"],
  );
});

Deno.test("H-30: a new global or procedure whose name the shipped file uses is dropped; a global typed as a shipped test codeunit is dropped with its users", async () => {
  const errLib = LIB.replace(
    "        exit(7);",
    "        if Counter < 0 then\n            Error('negative');\n        exit(7);",
  );
  await assertMerged(
    errLib.replace(
      "        Counter: Integer;\n",
      "        Counter: Integer;\n        Error: Integer;\n",
    ),
    errLib,
    ["global Error has a name the shipped file uses"],
    errLib,
  );
  const r = await assertMerged(
    libWith(`
    procedure RunShipped()
    begin
        Shipped.ShippedPasses();
    end;
${MAKE_TWO}`).replace(
      "        Counter: Integer;\n",
      '        Counter: Integer;\n        Shipped: Codeunit "CGR Shipped Tests";\n',
    ),
    libWith(MAKE_TWO),
    ["global Shipped: typed as a shipped test codeunit", "RunShipped"],
  );
  assert(!r.lib.includes("Shipped:"));
});

Deno.test("H-30: an agent file the parser cannot split cleanly is restored whole (fail closed)", async () => {
  await assertRestored(
    libWith(MAKE_TWO).replace(
      "    procedure Seed()",
      "    Garbage Tokens;\n    procedure Seed()",
    ),
    "could not be parsed",
  );
});

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

// The H-28 cells (P-02 realistic arms), reduced to their TestLibrary shapes.
const H28_LIB = `codeunit 80090 "CGR Test Library"
{
    EventSubscriberInstance = Manual;

    var
        LeaseInvoiceLinesCreated: Integer;

    procedure SetV2Setup(RoundingPrecision: Decimal; OutboxMaxAttempts: Integer)
    var
        Setup: Record "CGR Setup";
    begin
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := RoundingPrecision;
        Setup."Outbox Max Attempts" := OutboxMaxAttempts;
        Setup.Modify();
    end;

    procedure CreateReturnedContract(VehicleNo: Code[20]; ReturnKm: Integer): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo);
        RentalMgt.Return(ContractNo, ReturnKm, '');
        exit(ContractNo);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnAfterPostRentalContract', '', false, false)]
    local procedure CountLines(var Amount: Decimal)
    begin
        LeaseInvoiceLinesCreated += 1;
    end;
}
`;

Deno.test("H-30 (H-28 HX-048 ab28da4b): the shipped CreateReturnedContract stays as shipped; the agent's 5-argument overload is kept", async () => {
  const overload = `
    procedure CreateReturnedContract(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo);
        RentalMgt.Return(ContractNo, ReturnKm, DamageDescription);
        exit(ContractNo);
    end;
`;
  const shipped = H28_LIB.slice(
    H28_LIB.indexOf("    procedure CreateReturnedContract"),
    H28_LIB.indexOf("\n    [EventSubscriber"),
  );
  const agent = H28_LIB.replace(
    shipped,
    `    procedure CreateReturnedContract(VehicleNo: Code[20]; ReturnKm: Integer): Code[20]
    begin
        exit(CreateReturnedContract(VehicleNo, ReturnKm, ''));
    end;
${overload}`,
  );
  await assertMerged(
    agent,
    libWith(overload, H28_LIB),
    [
      "procedure CreateReturnedContract changes a shipped member",
      "agent additions kept: procedure CreateReturnedContract",
    ],
    H28_LIB,
  );
});

Deno.test("H-30 (H-28 HX-049): the agent's SetV2Setup change is restored; its new SetOutboxTransport is kept", async () => {
  const setter = `
    procedure SetOutboxTransport(Transport: Enum "CGR Outbox Transport")
    var
        Setup: Record "CGR Setup";
    begin
        Setup.GetOrCreate();
        Setup."Outbox Transport" := Transport;
        Setup.Modify();
    end;
`;
  const agent = H28_LIB.replace(
    `        Setup."Outbox Max Attempts" := OutboxMaxAttempts;
        Setup.Modify();
    end;
`,
    `        Setup."Outbox Max Attempts" := OutboxMaxAttempts;
        Setup."Outbox Transport" := Enum::"CGR Outbox Transport"::"Event";
        Setup.Modify();
    end;
${setter}`,
  );
  await assertMerged(
    agent,
    libWith(setter, H28_LIB),
    [
      "procedure SetV2Setup changes a shipped member",
      "agent additions kept: procedure SetOutboxTransport",
    ],
    H28_LIB,
  );
});

Deno.test("H-30 (H-28 HX-025): a new counter global and its getter are kept; the agent's [EventSubscriber] is dropped", async () => {
  const getter = `
    procedure ServiceRegisteredSeen(): Integer
    begin
        exit(ServiceRegisteredCount);
    end;
`;
  const agent = H28_LIB.replace(
    "        LeaseInvoiceLinesCreated: Integer;\n",
    "        LeaseInvoiceLinesCreated: Integer;\n        ServiceRegisteredCount: Integer;\n",
  ).replace(
    /}\n$/,
    `${getter}
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Service Plan Mgt", 'OnAfterServiceRegistered', '', false, false)]
    local procedure CountServiceRegistered(var Vehicle: Record "CGR Vehicle")
    begin
        ServiceRegisteredCount += 1;
    end;
}
`,
  );
  const r = await assertMerged(
    agent,
    libWith(getter, H28_LIB).replace(
      "        LeaseInvoiceLinesCreated: Integer;\n",
      "        LeaseInvoiceLinesCreated: Integer;\n        ServiceRegisteredCount: Integer;\n",
    ),
    [
      "procedure CountServiceRegistered carries an attribute",
      "agent additions kept: procedure ServiceRegisteredSeen, global ServiceRegisteredCount",
    ],
    H28_LIB,
  );
  assert(!r.lib.includes("CountServiceRegistered"));
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

Deno.test("H-30 (Sol r1 P1): an empty, comment-only or using-only helper file is restored whole (no crash)", async () => {
  for (
    const text of [
      "",
      "// nothing here\n/* at all */\n",
      "using System.Environment;\n",
    ]
  ) {
    await assertRestored(text, "declares no object");
  }
});

Deno.test("H-30 (Sol r1 P2): an overload of an attributed shipped procedure is judged by the procedure's own parameters, not the attribute's", async () => {
  // Shipped subscriber with 2 parameters; its attribute has 6 arguments.
  const sub = H28_LIB.replace(
    "local procedure CountLines(var Amount: Decimal)",
    "local procedure CountLines(var Amount: Decimal; Lines: Integer)",
  );
  const one = `
    procedure CountLines(Amount: Decimal): Integer
    begin
        exit(1);
    end;
`;
  await assertMerged(libWith(one, sub), libWith(one, sub), [
    "agent additions kept: procedure CountLines",
  ], sub);
  await assertMerged(
    libWith(
      `
    procedure CountLines(A: Integer; B: Integer): Integer
    begin
        exit(2);
    end;
`,
      sub,
    ),
    sub,
    ["procedure CountLines has the parameter count of a shipped overload"],
    sub,
  );
});

Deno.test("H-30 (Sol r1 P2): a using inside a comment is never carried; a trailing comment after a using is", async () => {
  await assertMerged(
    `/*\nusing Does.Not.Exist;\n*/\n${libWith(MAKE_TWO)}`,
    libWith(MAKE_TWO),
    ["agent additions kept: procedure MakeTwo"],
  );
  const r = await rebuild({
    [LIB_REL]: `// using Also.Not;\n${libWith(MAKE_TWO)}`,
  });
  assertEquals(r.lib, libWith(MAKE_TWO));
  await assertMerged(
    `using System.Environment; // needed for Company\n\n${libWith(MAKE_TWO)}`,
    `using System.Environment;\n\n${libWith(MAKE_TWO)}`,
    ["using System.Environment"],
  );
});

Deno.test("H-30 (Sol r1 P2): a compiler directive inside an added global drops it", async () => {
  await assertMerged(
    libWith(MAKE_TWO).replace(
      "        Counter: Integer;\n",
      "        Counter: Integer;\n        Extra:\n#pragma implicitwith disable\n            Integer;\n",
    ),
    libWith(MAKE_TWO),
    ["global Extra contains a compiler directive"],
  );
});

Deno.test("H-30 (Sol r1 P2): a helper without globals gets a var section for the agent's first global, before its first procedure", async () => {
  const bare = `codeunit 80090 "CGR Test Library"
{
    procedure Seed(): Integer
    begin
        exit(7);
    end;
}
`;
  const agent = bare.replace(
    "    procedure Seed()",
    "    var\n        Extra: Integer;\n\n    procedure Seed()",
  ).replace(/}\n$/, `${MAKE_TWO}}\n`);
  await assertMerged(agent, agent, [
    "agent additions kept: procedure MakeTwo, global Extra",
  ], bare);
  // No procedure or trigger: the section goes before the closing brace.
  const empty = `codeunit 80090 "CGR Test Library"\n{\n}\n`;
  await assertMerged(
    `codeunit 80090 "CGR Test Library"\n{\n    var\n        Extra: Integer;\n}\n`,
    `codeunit 80090 "CGR Test Library"\n{\n    var\n        Extra: Integer;\n}\n`,
    ["global Extra"],
    empty,
  );
});

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

Deno.test("H-30 (Sol r2 P2): the first global's var section goes at the procedure itself, inside the object, in compact source and after a comment on the procedure's line", async () => {
  const compact =
    `codeunit 80090 "CGR Test Library" { procedure Seed(): Integer begin exit(7); end; }\n`;
  const agent =
    `codeunit 80090 "CGR Test Library" { var Extra: Integer; procedure Seed(): Integer begin exit(7); end; }\n`;
  await assertMerged(
    agent,
    `codeunit 80090 "CGR Test Library" { var\n        Extra: Integer;\n\n    procedure Seed(): Integer begin exit(7); end; }\n`,
    ["agent additions kept: global Extra"],
    compact,
  );
  const commented = `codeunit 80090 "CGR Test Library"
{
    /* helpers
    */ procedure Seed(): Integer
    begin
        exit(7);
    end;
}
`;
  await assertMerged(
    commented.replace("*/ procedure", "*/ var Extra: Integer;\n    procedure"),
    commented.replace(
      "*/ procedure",
      "*/ var\n        Extra: Integer;\n\n    procedure",
    ),
    ["agent additions kept: global Extra"],
    commented,
  );
  // No procedure and the closing brace on the object's line.
  await assertMerged(
    `codeunit 80090 "CGR Test Library" { var Extra: Integer; }\n`,
    `codeunit 80090 "CGR Test Library" { \n    var\n        Extra: Integer;\n}\n`,
    ["global Extra"],
    `codeunit 80090 "CGR Test Library" { }\n`,
  );
});

// ---- H-30 Sol review r3 ----

Deno.test("H-30 (Sol r3 P2): a kept using goes right at the object keyword, never into a shipped comment that ends on the object's line; after a shipped namespace", async () => {
  const commented = `/* trusted header
*/ ${LIB}`;
  await assertMerged(
    `using Agent.Helpers;\n${commented}`,
    // Own line since r4 (a using never shares the comment's closing line).
    `/* trusted header
*/ \nusing Agent.Helpers;

${LIB}`,
    ["using Agent.Helpers"],
    commented,
  );
  const ns = `namespace CGR.Test;\n\n${LIB}`;
  await assertMerged(
    `namespace CGR.Test;\n\nusing Agent.Helpers;\n${LIB}`,
    `namespace CGR.Test;\n\nusing Agent.Helpers;\n\n${LIB}`,
    ["using Agent.Helpers"],
    ns,
  );
});

// ---- H-30 Sol review r4 ----

Deno.test("H-30 (Sol r4 P2): a kept using gets its own line after a compact namespace, and the object keyword is never found inside a quoted object name", async () => {
  const compact = `namespace CGR.Test; ${LIB}`;
  await assertMerged(
    `namespace CGR.Test;\nusing Agent.Helpers;\n${libWith(MAKE_TWO)}`,
    `namespace CGR.Test; \nusing Agent.Helpers;\n\n${libWith(MAKE_TWO)}`,
    ["agent additions kept: procedure MakeTwo, using Agent.Helpers"],
    compact,
  );
  const quoted = LIB.replace('"CGR Test Library"', '"codeunit 80091"');
  await assertMerged(
    `using Agent.Helpers;\n${libWith(MAKE_TWO, quoted)}`,
    `using Agent.Helpers;\n\n${libWith(MAKE_TWO, quoted)}`,
    ["using Agent.Helpers"],
    quoted,
  );
});

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
      "a line terminator other than LF or CRLF; the shipped file is restored",
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
