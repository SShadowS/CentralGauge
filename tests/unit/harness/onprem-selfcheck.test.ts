/**
 * H-38 self-check r1 (runs/001/selfcheck/sol-r1.md): one regression per
 * scanner bypass, on both policy sides. H1 directive text ending a routine,
 * H2 object-level expressions, H3 `with` over a whole statement (if/else,
 * repeat/until) and builtin names under `with`, H4 a workspace interface by
 * identity, not leaf name; LOW: a declared workspace helper and an unknown
 * type word.
 */

import { assert, assertEquals } from "@std/assert";
import { loadOnPremIndex } from "../../../src/harness/onprem-symbols.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import {
  productionPolicyViolations,
  testPolicyViolations,
} from "../../../src/harness/verdict-workspace.ts";
import { baseSlicePackage, onPremStore } from "./onprem-fixture.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const RULE = "onprem_ref";
const onPremMethod = (Name: string) => ({
  Name,
  Attributes: [{ Name: "Scope", Arguments: [{ Value: "OnPrem" }] }],
});
const SYS = "8874ed3a-0643-4247-9ced-7a7002f7135d";
const INDEX = await loadOnPremIndex(
  await onPremStore([baseSlicePackage(), {
    app_id: SYS,
    name: "System",
    version: "28.0.53667.0",
    json: {
      AppId: SYS,
      Name: "System",
      Publisher: "Microsoft",
      Version: "28.0.53667.0",
      Codeunits: [{
        Id: 9,
        Name: "Fallback Names",
        Methods: ["Send", "Get"].map(onPremMethod),
      }],
      // r3: a locked page with an OnPrem value-returning Count, and a locked
      // table with an OnPrem Update (the real lock's table 130202 "Test
      // Result" has one): builtin-listed names that are OnPrem members.
      Pages: [{
        Id: 9001,
        Name: "Count Page",
        Methods: [onPremMethod("Count")],
      }],
      Tables: [{
        Id: 130202,
        Name: "Test Result",
        Methods: [onPremMethod("Update")],
      }],
      // r2 N3: an indexed value-returning member spelled like structure syntax.
      TableExtensions: [{
        Id: 1,
        Name: "RS Lookup",
        TargetObject: "Report Selections",
        Methods: [onPremMethod("Lookup")],
      }],
      Namespaces: [{
        Name: "Microsoft",
        Namespaces: [{
          Name: "Integration",
          Interfaces: [{
            Name: "Outbox Transport",
            Methods: [{ Name: "Send" }],
          }],
        }],
      }],
    },
  }]),
);

/** onprem_ref details of `files` as production (Core) and as agent Test text. */
async function sides(
  files: readonly (readonly [string, string])[],
): Promise<Record<string, string[]>> {
  const d = await Deno.realPath(await testTempDir());
  await write(
    d,
    "Core/app.json",
    appJson(IDS.core, "CGR Core", [70000, 70099], []),
  );
  for (const [rel, text] of files) await write(d, `Core/src/${rel}`, text);
  const only = (vs: string[]) => vs.filter((v) => v.startsWith(`${RULE}: `));
  return {
    production: only(
      await productionPolicyViolations(d, await readAppGraph(d), {}, INDEX),
    ),
    Test: only(testPolicyViolations(files, INDEX)),
  };
}

async function expectHits(
  files: readonly (readonly [string, string])[],
  details: string[],
) {
  for (const [side, vs] of Object.entries(await sides(files))) {
    assertEquals(vs.length, details.length, `${side}: ${vs.join("; ")}`);
    for (const d of details) {
      assert(vs.some((v) => v.includes(d)), `${side}: ${d}: ${vs.join("; ")}`);
    }
  }
}

const ISM = 'Codeunit "Isolated Storage Management"';
const HTML =
  'GetHtmlReportForCust(V, Enum::"Report Selection Usage"::"S.Invoice", V, \'\')';

Deno.test("H-38 self-check H1: a #region label 'end' does not end the routine; the call after it is onprem_ref", async () => {
  const file =
    `codeunit 70000 "CGR Core"\n{\n    procedure P()\n    var\n        ISM: ${ISM};\n        V: Text;\n    begin\n#region end\n        ISM.Get('k', DataScope::Module, V);\n#endregion\n    end;\n}\n`;
  await expectHits([["Core.al", file]], ["ISM.Get (codeunit 1293 Get)"]);
});

Deno.test("H-38 self-check H2: object-level expressions (a page field source, global receiver and bare call on SourceTable) are onprem_ref", async () => {
  const file =
    `page 70011 "CGR RS"\n{\n    SourceTable = "Report Selections";\n\n    layout\n    {\n        area(Content)\n        {\n            field(Has; ISM.Contains('k', DataScope::Module)) { }\n            field(Html; ${HTML}) { }\n        }\n    }\n\n    var\n        ISM: ${ISM};\n        V: Text;\n}\n`;
  await expectHits([["Page.al", file]], [
    "ISM.Contains (codeunit 1293 Contains)",
    "GetHtmlReportForCust (table 77 GetHtmlReportForCust)",
  ]);
});

Deno.test("H-38 self-check H3: with covers its whole statement (if/else, repeat/until), and a builtin name under with is the Q8 fallback", async () => {
  const file =
    `codeunit 70000 "CGR Core"\n{\n    procedure P(Flag: Boolean)\n    var\n        RS: Record "Report Selections";\n        V: Text;\n    begin\n        with RS do\n            if Flag then\n                Message('ok')\n            else\n                ${HTML};\n        with RS do\n            repeat\n                Message('x');\n                Contains('k');\n            until Flag;\n        with RS do\n            Get('x');\n    end;\n}\n`;
  await expectHits([["Core.al", file]], [
    "GetHtmlReportForCust (unresolved, OnPrem name GetHtmlReportForCust)",
    "Contains (unresolved, OnPrem name Contains)",
    "Get (unresolved, OnPrem name Get)",
  ]);
});

const IFACE =
  'namespace CGR.Integration;\n\ninterface "Outbox Transport"\n{\n    procedure Send(Payload: Text): Boolean;\n}\n';
const use = (type: string) =>
  `codeunit 70000 "CGR Core"\n{\n    procedure P()\n    var\n        T: Interface ${type};\n    begin\n        if T.Send('x') then;\n    end;\n}\n`;

Deno.test("H-38 self-check H4: a workspace interface is safe by identity: the locked qualified one and an ambiguous leaf fall back, the workspace-qualified one is safe", async () => {
  const fb = "T.Send (unresolved, OnPrem name Send)";
  await expectHits([
    ["Iface.al", IFACE],
    ["Core.al", use('Microsoft.Integration."Outbox Transport"')],
  ], [fb]);
  await expectHits([
    ["Iface.al", IFACE],
    ["Core.al", use('"Outbox Transport"')],
  ], [fb]);
  await expectHits([
    ["Iface.al", IFACE],
    ["Core.al", use('CGR.Integration."Outbox Transport"')],
  ], []);
});

Deno.test("H-38 self-check LOW: a declared workspace codeunit's Get is safe; a variable of an unknown type word falls back", async () => {
  const helper =
    'codeunit 70001 "CGR Helper"\n{\n    procedure Get()\n    begin\n    end;\n}\n';
  const call = (decl: string) =>
    `codeunit 70000 "CGR Core"\n{\n    procedure P()\n    var\n        W: ${decl};\n    begin\n        W.Get();\n    end;\n}\n`;
  await expectHits([["Helper.al", helper], [
    "Core.al",
    call('Codeunit "CGR Helper"'),
  ]], []);
  await expectHits([["Core.al", call("Mystery")]], [
    "W.Get (unresolved, OnPrem name Get)",
  ]);
});

// ---- self-check r2 (runs/001/selfcheck/sol-r2.md) ----

Deno.test("H-38 self-check r2 N1: directive-looking text inside a block comment does not eat the comment's end; the call after it is onprem_ref", async () => {
  const file =
    `codeunit 70000 "CGR Core"\n{\n    procedure P()\n    var\n        ISM: ${ISM};\n        V: Text;\n    begin\n        /*\n#region */\n        ISM.Get('k', DataScope::Module, V);\n    end;\n}\n`;
  await expectHits([["Core.al", file]], ["ISM.Get (codeunit 1293 Get)"]);
});

Deno.test("H-38 self-check r2 N2: a directive label cannot forge a workspace interface or its namespace; the locked interface still falls back", async () => {
  const fb = "T.Send (unresolved, OnPrem name Send)";
  const forgedIface =
    'namespace Microsoft.Integration;\n#region interface "Outbox Transport" {\n#endregion\n';
  await expectHits([
    ["Forged.al", forgedIface],
    ["Core.al", use('Microsoft.Integration."Outbox Transport"')],
  ], [fb]);
  const forgedNs =
    '#region namespace Microsoft.Integration;\n#endregion\ninterface "Outbox Transport"\n{\n    procedure Send(Payload: Text): Boolean;\n}\n';
  await expectHits([
    ["Forged.al", forgedNs],
    ["Core.al", use('Microsoft.Integration."Outbox Transport"')],
  ], [fb]);
});

Deno.test('H-38 self-check r2 N3: a call spelled like structure syntax ("Lookup"() quoted, and Lookup() that is an indexed OnPrem name) is onprem_ref at object level', async () => {
  const file =
    `page 70011 "CGR RS"\n{\n    SourceTable = "Report Selections";\n\n    layout\n    {\n        area(Content)\n        {\n            field(A; "Lookup"()) { }\n            field(B; Lookup()) { }\n        }\n    }\n}\n`;
  await expectHits([["Page.al", file]], [
    '"Lookup" (table 77 Lookup)',
    "Lookup (table 77 Lookup)",
  ]);
});

// ---- self-check r3 (runs/001/selfcheck/sol-r3.md) ----

Deno.test("H-38 self-check r3: an OnPrem Count of the base page, called from a page extension's source expression quoted and unquoted, is onprem_ref (no builtin exemption for an OnPrem name)", async () => {
  const file =
    `pageextension 70020 "CGR Count" extends "Count Page"\n{\n    layout\n    {\n        addlast(Content)\n        {\n            field(A; Count()) { }\n            field(B; "Count"()) { }\n        }\n    }\n}\n`;
  await expectHits([["PageExt.al", file]], [
    "Count (page 9001 Count)",
    '"Count" (page 9001 Count)',
  ]);
});

Deno.test("H-38 self-check r3: in a routine body, a bare builtin-named call that is an OnPrem member of the extension's base table (Update on 130202) is onprem_ref", async () => {
  const file =
    `tableextension 70021 "CGR TR" extends "Test Result"\n{\n    procedure P()\n    begin\n        Update();\n    end;\n}\n`;
  await expectHits([["TableExt.al", file]], [
    "Update (table 130202 Update)",
  ]);
});
