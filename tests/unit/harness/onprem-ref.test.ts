/**
 * H-38 (design 5, 8.1): calls by name to OnPrem members of locked Microsoft
 * objects, banned in production and agent Test text as `onprem_ref`. The
 * index comes from the loader over a ReadyToRun-wrapped fixture package that
 * carries the real Base App entries (codeunit 1293 Get, table 77
 * GetHtmlReportForCust, table 81 events), so every case runs loader ->
 * workspace scan, independent of the L1 Cloud compile.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { safeCopyTree } from "../../../src/harness/fsutil.ts";
import { loadOnPremIndex } from "../../../src/harness/onprem-symbols.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import {
  buildVerdictWorkspace,
  productionPolicyViolations,
  testPolicyViolations,
} from "../../../src/harness/verdict-workspace.ts";
import { baseSlicePackage, onPremStore } from "./onprem-fixture.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const RULE = "onprem_ref";
const INDEX = await loadOnPremIndex(
  await onPremStore([baseSlicePackage(true)]),
);

const ISM = 'Codeunit "Isolated Storage Management"';
const GET = "ISM.Get('k', DataScope::Module, V);";

/** A codeunit with one procedure. */
const cu = (decl: string, stmt: string, globals = "", params = "") =>
  `codeunit 70000 "CGR Core"\n{\n${
    globals ? `    var\n${globals}\n\n` : ""
  }    procedure P(${params})\n    var\n        V: Text;\n${decl}\n    begin\n        ${stmt}\n    end;\n}\n`;

/** onprem_ref violations of `file` as production code (Core, either feature state) and as an agent Test file. */
async function sides(file: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const features of [[], ["NoImplicitWith"]]) {
    const d = await Deno.realPath(await testTempDir());
    const app = JSON.parse(appJson(IDS.core, "CGR Core", [70000, 70099], []));
    if (features.length) app.features = features;
    await write(d, "Core/app.json", JSON.stringify(app));
    await write(d, "Core/src/Core.al", file);
    out[`production ${features.join("") || "implicit with"}`] =
      (await productionPolicyViolations(d, await readAppGraph(d), {}, INDEX))
        .filter((v) => v.startsWith(`${RULE}: `));
  }
  out["Test"] = testPolicyViolations([["src/Agent.Test.al", file]], INDEX)
    .filter((v) => v.startsWith(`${RULE}: `));
  return out;
}

/** Each case: [what, file, detail substring]. */
const BANNED: readonly (readonly [string, string, string])[] = [
  ["a local", cu(`        ISM: ${ISM};`, GET), "ISM.Get (codeunit 1293 Get)"],
  [
    "a global",
    cu("", GET, `        ISM: ${ISM};`),
    "ISM.Get (codeunit 1293 Get)",
  ],
  [
    "a parameter",
    cu("", GET, "", `ISM: ${ISM}`),
    "ISM.Get (codeunit 1293 Get)",
  ],
  [
    "a named return",
    `codeunit 70000 "CGR Core"\n{\n    procedure P() ISM: ${ISM}\n    var\n        V: Text;\n    begin\n        ${GET}\n    end;\n}\n`,
    "ISM.Get (codeunit 1293 Get)",
  ],
  [
    "an array element",
    cu(
      `        ISMs: array[2] of ${ISM};`,
      "ISMs[1].Get('k', DataScope::Module, V);",
    ),
    "(codeunit 1293 Get)",
  ],
  [
    "a variable by id",
    cu("        ISM: Codeunit 1293;", GET),
    "(codeunit 1293 Get)",
  ],
  [
    "a namespace-qualified type",
    cu(
      `        ISM: Codeunit System.Security."Isolated Storage Management";`,
      GET,
    ),
    "(codeunit 1293 Get)",
  ],
  [
    "a quoted receiver and member",
    cu(`        "ISM": ${ISM};`, `"ISM"."Get"('k', DataScope::Module, V);`),
    '"ISM"."Get" (codeunit 1293 Get)',
  ],
  [
    "a complex quoted receiver",
    cu(`        "My ISM": ${ISM};`, `"My ISM".Get('k', DataScope::Module, V);`),
    '"My ISM".Get (codeunit 1293 Get)',
  ],
  [
    "a call without parentheses",
    cu(`        ISM: ${ISM};\n        B: Boolean;`, "B := ISM.Contains;"),
    "(codeunit 1293 Contains)",
  ],
  [
    "an overload-mixed name (Q7)",
    cu(
      '        RS: Record "Report Selections";',
      'RS.GetPdfReportForCust(V, Enum::"Report Selection Usage"::"S.Invoice", V, \'\');',
    ),
    "RS.GetPdfReportForCust (table 77 GetPdfReportForCust)",
  ],
];

for (const [what, file, detail] of BANNED) {
  Deno.test(`H-38 (8.1): Codeunit 1293 Get through ${what} is onprem_ref on every side`, async () => {
    for (const [side, vs] of Object.entries(await sides(file))) {
      assert(vs.some((v) => v.includes(detail)), `${side}: ${vs.join("; ")}`);
    }
  });
}

const RS = '"Report Selections"';
const HTML =
  'GetHtmlReportForCust(V, Enum::"Report Selection Usage"::"S.Invoice", V, \'\')';
const body = (prefix: string) => `${prefix}${HTML};`;
const trig = (name: string, stmts: string[]) =>
  `trigger ${name}()\n    var\n        V: Text;\n    begin\n        ${
    stmts.join("\n        ")
  }\n    end;`;
const ALL = [body(""), body("Rec."), body("xRec.")];

/** Implicit receivers (5.1, 5.2): [what, file, statements expected banned]. */
const IMPLICIT: readonly (readonly [string, string, number])[] = [
  [
    "a table extension of Report Selections",
    `tableextension 70010 "CGR RS Ext" extends ${RS}\n{\n    ${
      trig("OnAfterInsert", ALL)
    }\n}\n`,
    3,
  ],
  [
    "a page with SourceTable Report Selections",
    `page 70011 "CGR RS"\n{\n    SourceTable = ${RS};\n\n    ${
      trig("OnOpenPage", ALL)
    }\n}\n`,
    3,
  ],
  [
    "a page with SourceTable 77",
    `page 70011 "CGR RS"\n{\n    SourceTable = 77;\n\n    ${
      trig("OnOpenPage", ALL)
    }\n}\n`,
    3,
  ],
  [
    "a page extension of a page whose SourceTable is 77 (from the index)",
    `pageextension 70012 "CGR RS Sales" extends "Report Selection - Sales"\n{\n    ${
      trig("OnOpenPage", ALL)
    }\n}\n`,
    3,
  ],
  [
    "a codeunit with TableNo Report Selections",
    `codeunit 70013 "CGR RS Run"\n{\n    TableNo = ${RS};\n\n    ${
      trig("OnRun", ALL)
    }\n}\n`,
    3,
  ],
  [
    "a report with a Report Selections dataitem",
    `report 70014 "CGR RS Report"\n{\n    dataset\n    {\n        dataitem(RS; ${RS})\n        {\n            ${
      trig("OnAfterGetRecord", [body(""), body("Rec.")])
    }\n        }\n    }\n}\n`,
    2,
  ],
];

for (const [what, file, n] of IMPLICIT) {
  Deno.test(`H-38 (8.1, 5.2): GetHtmlReportForCust bare and through Rec in ${what} is onprem_ref, NoImplicitWith on and off`, async () => {
    for (const [side, vs] of Object.entries(await sides(file))) {
      const hits = vs.filter((v) =>
        v.includes("(table 77 GetHtmlReportForCust)")
      );
      assertEquals(hits.length, n, `${side}: ${vs.join("; ")}`);
    }
  });
}

Deno.test("H-38 (8.1, 5.1): CurrReport in a report extension and CurrPage in a page extension bind to the base object, Rec to its SourceTable", async () => {
  const rep =
    `reportextension 70015 "CGR Bank" extends "Suggest Bank Acc. Recon. Lines"\n{\n    ${
      trig("OnPreReport", ["CurrReport.OnPreDataItemBankAccount(B);"]).replace(
        "V: Text",
        "B: Boolean",
      )
    }\n}\n`;
  for (const [side, vs] of Object.entries(await sides(rep))) {
    assert(
      vs.some((v) => v.includes("(report 1496 OnPreDataItemBankAccount)")),
      `${side}: ${vs.join("; ")}`,
    );
  }
  // Sol r2 LOW: CurrPage is the extended page (page 21 SetCaption is OnPrem);
  // Rec is its SourceTable, Customer, which has no SetCaption.
  const page =
    `pageextension 70016 "CGR Card" extends "Customer Card"\n{\n    ${
      trig("OnOpenPage", ["CurrPage.SetCaption(V);", "Rec.SetCaption(V);"])
    }\n}\n`;
  for (const [side, vs] of Object.entries(await sides(page))) {
    assertEquals(vs.length, 1, `${side}: ${vs.join("; ")}`);
    assert(vs[0]!.includes("CurrPage.SetCaption (page 21 SetCaption)"), vs[0]);
  }
});

Deno.test("H-38 (8.1, 5.2): a table extension's own GetHtmlReportForCust, called bare and through this, is still onprem_ref (no local-procedure exemption)", async () => {
  const file =
    `tableextension 70010 "CGR RS Ext" extends ${RS}\n{\n    procedure GetHtmlReportForCust(X: Integer)\n    begin\n    end;\n\n    procedure Q()\n    begin\n        GetHtmlReportForCust(1);\n        this.GetHtmlReportForCust(1);\n    end;\n}\n`;
  for (const [side, vs] of Object.entries(await sides(file))) {
    assertEquals(vs.length, 2, `${side}: ${vs.join("; ")}`);
  }
});

Deno.test("H-38 (8.1, 5.1): resolved-safe receivers are not onprem_ref: a Record Customer Get, a workspace codeunit's Get, a local Text shadowing a global ISM", async () => {
  const file =
    `codeunit 70000 "CGR Core"\n{\n    var\n        ISM: ${ISM};\n\n    procedure P()\n    var\n        Cust: Record Customer;\n        W: Codeunit "CGR Helper";\n        ISM: Text;\n    begin\n        Cust.Get('10000');\n        W.Get();\n        if ISM.Contains('x') then;\n    end;\n}\n`;
  for (const [side, vs] of Object.entries(await sides(file))) {
    assertEquals(vs, [], side);
  }
});

Deno.test("H-38 (8.1, 5.3, 5.4): a call result, a dotted chain and a bare name in nested with are unresolved: the Q2 fallback bans an OnPrem name", async () => {
  const file =
    `codeunit 70000 "CGR Core"\n{\n    procedure GetIsm() R: ${ISM}\n    begin\n    end;\n\n    procedure P()\n    var\n        V: Text;\n        A: Record Customer;\n        ISM: Text;\n        Cust: Record Customer;\n    begin\n        GetIsm().Get('k', DataScope::Module, V);\n        A.ISM.Get('k', DataScope::Module, V);\n        with Cust do\n            with A do begin\n                ${HTML};\n            end;\n    end;\n}\n`;
  for (const [side, vs] of Object.entries(await sides(file))) {
    assertEquals(vs.length, 3, `${side}: ${vs.join("; ")}`);
    assert(
      vs.some((v) => v.includes("GetIsm().Get (unresolved, OnPrem name Get)")),
      vs.join("; "),
    );
    assert(
      vs.some((v) => v.includes("A.ISM.Get (unresolved, OnPrem name Get)")),
      vs.join("; "),
    );
    assert(
      vs.some((v) =>
        v.includes(
          "GetHtmlReportForCust (unresolved, OnPrem name GetHtmlReportForCust)",
        )
      ),
      vs.join("; "),
    );
  }
});

const sub = (args: string) =>
  `codeunit 70000 "CGR Core"\n{\n    [EventSubscriber(${args})]\n    local procedure Handle()\n    begin\n    end;\n}\n`;

Deno.test("H-38 (8.1, 5.5): a subscriber to an OnPrem event by name, id, namespace-qualified name, other case, with comments and literal commas is onprem_ref; a Cloud event of the same table is not", async () => {
  const E = "'OnCheckGenJournalLinePostRestrictions'";
  for (
    const args of [
      `ObjectType::Table, Database::"Gen. Journal Line", ${E}, '', false, false`,
      `ObjectType::Table, Database::81, ${E}, '', false, false`,
      `ObjectType::Table, 81, ${E}, '', false, false`,
      `ObjectType::Table, Database::Microsoft.Finance.GeneralLedger.Journal."Gen. Journal Line", ${E}, '', false, false`,
      `ObjectType::Table, Database::"Gen. Journal Line", 'oncheckgenjournallinepostrestrictions', '', false, false`,
      `ObjectType::Table /* a, b) */, Database::"Gen. Journal Line" // x, y)\n        , ${E}, ',', false, false`,
      `ObjectType::Table, Database::"Gen. Journal Line", ${E}, ')', false, false`,
    ]
  ) {
    for (const [side, vs] of Object.entries(await sides(sub(args)))) {
      assertEquals(vs.length, 1, `${side} ${args}: ${vs.join("; ")}`);
      assert(
        /subscriber table 81 'OnCheckGenJournalLinePostRestrictions'/i.test(
          vs[0]!,
        ),
        vs[0],
      );
    }
  }
  const cloud = sub(
    `ObjectType::Table, Database::"Gen. Journal Line", 'OnAfterSetupNewLine', '', false, false`,
  );
  for (const [side, vs] of Object.entries(await sides(cloud))) {
    assertEquals(vs, [], side);
  }
  // Arg 2 not of a known shape, arg 3 an OnPrem event name: the Q2 fallback.
  const odd = sub(`ObjectType::Table, GetTableNo(), ${E}, '', false, false`);
  for (const [side, vs] of Object.entries(await sides(odd))) {
    assertEquals(vs.length, 1, side);
    assert(
      vs[0]!.includes(
        "unresolved, OnPrem name OnCheckGenJournalLinePostRestrictions",
      ),
      vs[0],
    );
  }
});

Deno.test("H-38 (8.1): names in comments, strings and inside one quoted identifier are not onprem_ref; Environment Information stays persistence_ref (Q10)", async () => {
  const file =
    `codeunit 70000 "CGR Core"\n{\n    procedure P()\n    var\n        ISM: ${ISM};\n        "ISM.Get(1)": Integer;\n        M: Text;\n        E: Codeunit "Environment Information";\n    begin\n        // ISM.Get('k', DataScope::Module, M);\n        /* GetHtmlReportForCust(M) */\n        M := 'ISM.Get(1) GetHtmlReportForCust(x)';\n        "ISM.Get(1)" := 1;\n        if E.IsSaaS() then;\n    end;\n}\n`;
  for (const [side, vs] of Object.entries(await sides(file))) {
    assertEquals(vs, [], side);
  }
  const d = await Deno.realPath(await testTempDir());
  await write(
    d,
    "Core/app.json",
    appJson(IDS.core, "CGR Core", [70000, 70099], []),
  );
  await write(d, "Core/src/Core.al", file);
  const all = await productionPolicyViolations(
    d,
    await readAppGraph(d),
    {},
    INDEX,
  );
  assert(
    all.some((v) =>
      v.startsWith("persistence_ref: ") && v.includes("codeunit 457")
    ),
    all.join("; "),
  );
});

Deno.test("H-38 (8.3): neither the docs nor the code state the L3 gap any more; the L3 scope names onprem_ref and the fallback", async () => {
  const root = new URL("../../../", import.meta.url);
  const doc = await Deno.readTextFile(new URL("docs/cli/commands.md", root));
  const code = await Deno.readTextFile(
    new URL("src/harness/verdict-workspace.ts", root),
  );
  for (const text of [doc, code]) {
    assert(!/not covered by L3/.test(text));
    assert(!/L1 Cloud\s+compile covers them/.test(text));
  }
  const scope = doc.slice(
    doc.indexOf("**L3 scope.**"),
    doc.indexOf("### Lineage file"),
  );
  assert(
    scope.includes("`onprem_ref`") && scope.includes("cannot resolve"),
    scope,
  );
});

Deno.test("H-38 (6): the workspace builder takes the index and rejects an OnPrem call on either side before the build", async () => {
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
  await write(a, "Core/src/Core.Codeunit.al", cu(`        ISM: ${ISM};`, GET));
  await write(
    a,
    "Test/src/Agent.Test.al",
    cu(`        ISM: ${ISM};`, GET).replace(
      'codeunit 70000 "CGR Core"',
      'codeunit 80160 "Agent T"',
    ),
  );
  const v = await buildVerdictWorkspace({
    pristine: p,
    artifact: a,
    out: join(await Deno.realPath(await testTempDir()), "v"),
    symbolIds: new Set([IDS.assert]),
    onPrem: INDEX,
  });
  const refs = v.violations.filter((x) => x.startsWith(`${RULE}: `));
  assert(
    refs.some((x) => x.startsWith(`${RULE}: Core/src/Core.Codeunit.al: `)),
    v.violations.join("; "),
  );
  assert(
    refs.some((x) => x.startsWith(`${RULE}: Test/src/Agent.Test.al: `)),
    v.violations.join("; "),
  );
});
