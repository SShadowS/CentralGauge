/**
 * H-38 8.4 ruling (q-20261021T202145-4e1e5d08): built-in AL system types as
 * receivers (a pinned closed list), an Interface declared in the workspace,
 * and an enum's Ordinals()/Names() List are resolved-safe. Nothing else: a
 * locked-package interface and an unknown chain still go to the fallback.
 * The index adds a package whose OnPrem names include Create, Send and
 * Contains, so each shipped hit shape (HX-005, HX-037, HX-049) would be a
 * fallback hit without the ruling.
 */

import { assert, assertEquals } from "@std/assert";
import { loadOnPremIndex } from "../../../src/harness/onprem-symbols.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import {
  AL_SYSTEM_TYPES,
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
const INDEX = await loadOnPremIndex(
  await onPremStore([baseSlicePackage(), {
    app_id: "8874ed3a-0643-4247-9ced-7a7002f7135d",
    name: "System",
    version: "28.0.53667.0",
    json: {
      AppId: "8874ed3a-0643-4247-9ced-7a7002f7135d",
      Name: "System",
      Publisher: "Microsoft",
      Version: "28.0.53667.0",
      Codeunits: [{
        Id: 9,
        Name: "Fallback Names",
        Methods: ["Create", "Send", "Contains"].map(onPremMethod),
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

const cu = (decl: string, stmt: string) =>
  `codeunit 70000 "CGR Core"\n{\n    procedure P()\n    var\n${decl}\n    begin\n        ${stmt}\n    end;\n}\n`;

const IFACE =
  'interface "CGR Outbox Transport"\n{\n    procedure Send(Payload: Text): Boolean;\n}\n';

Deno.test("H-38 ruling (a): the pinned closed list of AL system types resolved-safe as receivers", () => {
  assertEquals([...AL_SYSTEM_TYPES].sort(), [
    "biginteger",
    "bigtext",
    "blob",
    "boolean",
    "byte",
    "char",
    "code",
    "codeunit",
    "companyproperty",
    "cookie",
    "database",
    "datatransfer",
    "date",
    "dateformula",
    "datetime",
    "debugger",
    "decimal",
    "dialog",
    "dictionary",
    "duration",
    "enum",
    "errorinfo",
    "errortype",
    "executioncontext",
    "executionmode",
    "fieldref",
    "file",
    "filterpagebuilder",
    "guid",
    "httpclient",
    "httpcontent",
    "httpheaders",
    "httprequestmessage",
    "httpresponsemessage",
    "instream",
    "integer",
    "isolatedstorage",
    "jsonarray",
    "jsonobject",
    "jsontoken",
    "jsonvalue",
    "keyref",
    "label",
    "list",
    "media",
    "mediaset",
    "moduledependencyinfo",
    "moduleinfo",
    "navapp",
    "notification",
    "numbersequence",
    "option",
    "outstream",
    "page",
    "productname",
    "query",
    "recordid",
    "recordref",
    "report",
    "secrettext",
    "session",
    "sessionsettings",
    "system",
    "taskscheduler",
    "testaction",
    "testfield",
    "testfilter",
    "testhttprequestmessage",
    "testhttpresponsemessage",
    "testpage",
    "testpart",
    "testrequestpage",
    "text",
    "textbuilder",
    "textconst",
    "time",
    "variant",
    "version",
    "webserviceactioncontext",
    "xmlattribute",
    "xmlattributecollection",
    "xmlcdata",
    "xmlcomment",
    "xmldeclaration",
    "xmldocument",
    "xmldocumenttype",
    "xmlelement",
    "xmlnamespacemanager",
    "xmlnametable",
    "xmlnode",
    "xmlnodelist",
    "xmlport",
    "xmlprocessinginstruction",
    "xmlreadoptions",
    "xmltext",
    "xmlwriteoptions",
  ]);
});

Deno.test("H-38 ruling (a), HX-037 shape: ErrorInfo.Create and a List/Dictionary/Json receiver are not onprem_ref", async () => {
  const file = cu(
    "        Problem: ErrorInfo;\n        L: List of [Integer];\n        J: JsonObject;\n        T: Text;",
    "Problem := ErrorInfo.Create('x', true);\n        if L.Contains(1) then;\n        if J.Contains('k') then;\n        if T.Contains('k') then;",
  );
  for (const [side, vs] of Object.entries(await sides([["Core.al", file]]))) {
    assertEquals(vs, [], side);
  }
});

Deno.test("H-38 ruling (c), HX-005 shape: Enum::X.Ordinals().Contains, an enum value's Names() and an Enum variable's Ordinals() are List methods, not onprem_ref", async () => {
  const file = cu(
    '        M: Enum "CGR Pricing Method";\n        O: Integer;',
    'if Enum::"CGR Pricing Method".Ordinals().Contains(O) then;\n        if "CGR Pricing Method"::Fixed.Names().Contains(\'x\') then;\n        if M.Ordinals().Contains(O) then;',
  );
  for (const [side, vs] of Object.entries(await sides([["Core.al", file]]))) {
    assertEquals(vs, [], side);
  }
});

Deno.test("H-38 ruling (b), HX-049 shape: Send through an Interface declared in the workspace (another file) is not onprem_ref", async () => {
  const file = cu(
    '        Transport: Interface "CGR Outbox Transport";',
    "if Transport.Send('x') then;",
  );
  const r = await sides([["Transport.Interface.al", IFACE], ["Core.al", file]]);
  for (const [side, vs] of Object.entries(r)) assertEquals(vs, [], side);
});

Deno.test("H-38 ruling negatives: an Interface from a locked package, an unknown chain and Ordinals() on a non-enum still fall back", async () => {
  const file = cu(
    '        Transport: Interface "Locked Transport";\n        Cust: Record Customer;\n        O: Integer;',
    "if Transport.Send('x') then;\n        if Cust.Something().Contains(O) then;\n        if Cust.Ordinals().Contains(O) then;\n        if GetList().Contains(O) then;",
  );
  for (const [side, vs] of Object.entries(await sides([["Core.al", file]]))) {
    assertEquals(vs.length, 4, `${side}: ${vs.join("; ")}`);
    for (
      const m of [
        "Transport.Send (unresolved, OnPrem name Send)",
        "Cust.Something().Contains (unresolved, OnPrem name Contains)",
        "Cust.Ordinals().Contains (unresolved, OnPrem name Contains)",
        "GetList().Contains (unresolved, OnPrem name Contains)",
      ]
    ) assert(vs.some((v) => v.includes(m)), `${side}: ${m}: ${vs.join("; ")}`);
  }
});
