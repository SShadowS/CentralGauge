/**
 * H-35 run 004 #1 (r5 2.3): the layer 3 persistence bans over agent
 * production and Test text, before the build. Every positive below compiles
 * only OnPrem (or with layer 1 off): it must be rejected by layer 3 alone.
 * Mock only.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { safeCopyTree } from "../../../src/harness/fsutil.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";
import {
  buildVerdictWorkspace,
  productionPolicyViolations,
  testPolicyViolations,
} from "../../../src/harness/verdict-workspace.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const RULE = "persistence_ref";

const proc = (decl: string, stmt: string) =>
  `    procedure P()\n    var\n${decl}\n    begin\n        ${stmt}\n    end;`;

/** Violations of `body` as production code (Core) and as an agent Test file. */
async function both(body: string, tail = "") {
  const d = await Deno.realPath(await testTempDir());
  await write(
    d,
    "Core/app.json",
    appJson(IDS.core, "CGR Core", [70000, 70099], []),
  );
  await write(
    d,
    "Core/src/Core.Codeunit.al",
    `codeunit 70000 "CGR Core"\n{\n${body}\n}\n${tail}`,
  );
  return {
    production: await productionPolicyViolations(d, await readAppGraph(d)),
    test: testPolicyViolations([[
      "src/Agent.Test.al",
      `codeunit 80160 "Agent T"\n{\n    Subtype = Test;\n${body}\n}\n${tail}`,
    ]]),
  };
}

/** Each case is a [what, body, detail substring, file tail]. */
const BANNED: readonly (readonly [string, string, string, string?])[] = [
  // file and server path
  [
    "File variable",
    proc("        F: File;", "F.Create('C:\\x');"),
    "File",
  ],
  [
    "FileUpload variable",
    proc("        U: FileUpload;", "U.CreateInStream(InS);"),
    "FileUpload",
  ],
  [
    "static File method",
    proc("        N: Text;", "File.Download('C:\\x', '', '', '', N);"),
    "File.Download",
  ],
  [
    "TemporaryPath",
    proc("        X: Text;", "X := TemporaryPath;"),
    "TemporaryPath",
  ],
  [
    "ApplicationPath",
    proc("        X: Text;", "X := ApplicationPath();"),
    "ApplicationPath",
  ],
  [
    "UploadIntoStream",
    proc(
      "        InS: InStream;\n        N: Text;",
      "UploadIntoStream('t', '', '', N, InS);",
    ),
    "UploadIntoStream",
  ],
  [
    "DownloadFromStream",
    proc(
      "        InS: InStream;\n        N: Text;",
      "DownloadFromStream(InS, '', '', '', N);",
    ),
    "DownloadFromStream",
  ],
  [
    "Report.SaveAsPdf to a path",
    proc("        X: Text;", "Report.SaveAsPdf(50000, 'C:\\x.pdf');"),
    "Report.SaveAsPdf",
  ],
  [
    "Report.SaveAsExcel to a path variable",
    proc("        N: Text;", "Report.SaveAsExcel(50000, N);"),
    "Report.SaveAsExcel",
  ],
  [
    "instance SaveAsWord",
    proc("        R: Report 50000;", "R.SaveAsWord('C:\\x.docx');"),
    "SaveAsWord",
  ],
  [
    "Xmlport.Export with a File",
    proc("        OutFile: File;", "Xmlport.Export(50000, OutFile);"),
    "Xmlport.Export",
  ],
  [
    "Xmlport.Import without a stream",
    proc("        N: Text;", "Xmlport.Import(50000, N);"),
    "Xmlport.Import",
  ],
  [
    "Xmlport Filename",
    proc("        XP: Xmlport 50000;", "XP.Filename := 'C:\\x'; XP.Export();"),
    "Filename",
  ],
  [
    'Codeunit "File Management"',
    proc(
      '        FM: Codeunit "File Management";',
      "FM.ServerTempFileName('x');",
    ),
    "codeunit 419",
  ],
  [
    "Codeunit 419",
    proc("        FM: Codeunit 419;", "FM.ServerTempFileName('x');"),
    "codeunit 419",
  ],
  [
    'Codeunit::"File Management"',
    proc("        X: Integer;", 'X := Codeunit::"File Management";'),
    "codeunit 419",
  ],
  // .NET
  [
    "DotNet variable",
    proc("        S: DotNet String;", "S := S.Copy('x');"),
    "DotNet",
  ],
  [
    "dotnet assembly declaration",
    "",
    "assembly",
    'dotnet\n{\n    assembly("mscorlib")\n    {\n        type("System.String"; MyString) { }\n    }\n}\n',
  ],
  // network and external
  ...[
    "HttpClient",
    "HttpRequestMessage",
    "HttpResponseMessage",
    "HttpContent",
    "HttpHeaders",
    "WebServiceActionContext",
  ].map((t) => [t, proc(`        V: ${t};`, "Clear(V);"), t] as const),
  [
    "HttpClient in a List",
    proc("        L: List of [HttpClient];", "Clear(L);"),
    "HttpClient",
  ],
  [
    "Hyperlink",
    proc("        X: Text;", "Hyperlink('http://x');"),
    "Hyperlink",
  ],
  [
    "bare StartSession",
    proc(
      "        Id: Integer;",
      'StartSession(Id, Codeunit::"CGR Core");',
    ),
    "StartSession",
  ],
  [
    "Session.StartSession",
    proc(
      "        Id: Integer;",
      'Session.StartSession(Id, Codeunit::"CGR Core");',
    ),
    "StartSession",
  ],
  [
    "TaskScheduler.CreateTask",
    proc(
      "        G: Guid;",
      'G := TaskScheduler.CreateTask(Codeunit::"CGR Core", 0, true);',
    ),
    "TaskScheduler.CreateTask",
  ],
  // platform OS
  [
    'Codeunit "Environment Information"',
    proc(
      '        E: Codeunit "Environment Information";',
      "if E.IsSaaS() then;",
    ),
    "codeunit 457",
  ],
  [
    "Codeunit 457",
    proc("        E: Codeunit 457;", "if E.IsSaaS() then;"),
    "codeunit 457",
  ],
  // H-35 run 004 Sol r1 H1: a namespace-qualified name is its last segment.
  [
    'qualified Codeunit System.IO."File Management"',
    proc(
      '        FM: Codeunit System.IO."File Management";',
      "FM.ServerTempFileName('x');",
    ),
    "codeunit 419",
  ],
  [
    'qualified Codeunit::System.IO."File Management"',
    proc("        X: Integer;", 'X := Codeunit::System.IO."File Management";'),
    "codeunit 419",
  ],
  [
    'qualified Codeunit System."Environment"."Environment Information"',
    proc(
      '        E: Codeunit System."Environment"."Environment Information";',
      "if E.IsSaaS() then;",
    ),
    "codeunit 457",
  ],
  [
    "qualified Record System.IO.File",
    proc("        F: Record System.IO.File;", "F.FindFirst();"),
    "table 2000000022",
  ],
  // H-35 run 004 Sol r1 H2: a stream name declared in another scope exempts nothing.
  [
    "SaveAsPdf to a Text named like another procedure's OutStream parameter",
    [
      "    local procedure Unrelated(var Destination: OutStream)",
      "    begin",
      "    end;",
      "",
      "    procedure Persist()",
      "    var",
      "        Destination: Text;",
      "    begin",
      "        Destination := 'C:\\Run\\my\\flag.pdf';",
      '        Report.SaveAsPdf(Report::"Customer - List", Destination);',
      "    end;",
    ].join("\n"),
    "Report.SaveAsPdf",
  ],
  [
    "SaveAsPdf to a local Text shadowing a global OutStream",
    [
      "    var",
      "        Destination: OutStream;",
      "",
      proc(
        "        Destination: Text;",
        'Report.SaveAsPdf(Report::"Customer - List", Destination);',
      ),
    ].join("\n"),
    "Report.SaveAsPdf",
  ],
  [
    "a stream array element (known fail-closed)",
    proc(
      "        Streams: array[2] of OutStream;",
      "Report.SaveAs(50000, '', ReportFormat::Pdf, Streams[1]);",
    ),
    "Report.SaveAs",
  ],
  [
    "SaveAsPdf on a Report variable",
    proc("        R: Report 50000;", "R.SaveAsPdf('C:\\x.pdf');"),
    "SaveAsPdf",
  ],
  [
    "a [Scope('OnPrem')] procedure",
    "    [Scope('OnPrem')]\n    procedure Q()\n    begin\n    end;",
    "Scope('OnPrem')",
  ],
];

for (const [what, body, detail, tail] of BANNED) {
  Deno.test(`H-35 run 004 #1 (r5 2.3): ${what} is ${RULE} in production and in agent Test text`, async () => {
    const { production, test } = await both(body, tail);
    for (
      const [side, vs, where] of [
        ["production", production, "Core/src/Core.Codeunit.al"],
        ["Test", test, "Test/src/Agent.Test.al"],
      ] as const
    ) {
      const hit = vs.find((v) => v.startsWith(`${RULE}: ${where}: `));
      assert(hit, `${side}: ${vs.join("; ")}`);
      assertStringIncludes(
        vs.filter((v) => v.startsWith(`${RULE}: `)).join("\n"),
        detail,
      );
    }
  });
}

Deno.test("H-35 run 004 #1 (r5 2.3): names in strings, comments and quoted identifiers, a FileName Text, an enum value File and the stream overloads are not persistence_ref", async () => {
  const body = proc(
    [
      '        "File Name": Text;',
      "        FileName: Text;",
      "        A, OutS: OutStream;",
      "        InS: InStream;",
      "        XP: Xmlport 50000;",
      '        "HttpClient Setup": Integer;',
    ].join("\n"),
    [
      '// File.Create TemporaryPath DotNet assembly("x") StartSession Hyperlink HttpClient',
      "FileName := 'File.Create(x) TemporaryPath UploadIntoStream Hyperlink(y)';",
      '"File Name" := FileName;',
      '"HttpClient Setup" := 1;',
      "Report.SaveAs(50000, '', ReportFormat::Pdf, OutS);",
      "Xmlport.Export(50000, OutS);",
      "Xmlport.Import(50000, InS);",
      "XP.SetSource(InS); XP.Import();",
      'FileName := Format("Export Type"::File);',
    ].join("\n        "),
  ) + "\n\n    [Scope('Cloud')]\n    procedure Q()\n    begin\n    end;";
  const { production, test } = await both(body);
  assertEquals(production.filter((v) => v.startsWith(`${RULE}: `)), []);
  assertEquals(test.filter((v) => v.startsWith(`${RULE}: `)), []);
});

Deno.test("H-35 run 004 Sol r1 H2/M1: a stream argument in scope (local, or a global with no local of that name) and a user codeunit's SaveAsPdf are not persistence_ref", async () => {
  const body = [
    "    var",
    "        Out: OutStream;",
    '        Exporter: Codeunit "CGR Exporter";',
    "",
    "    procedure ToLocal()",
    "    var",
    "        Destination: OutStream;",
    "    begin",
    '        Report.SaveAsPdf(Report::"Customer - List", Destination);',
    "    end;",
    "",
    "    procedure ToGlobal(Id: Integer)",
    "    begin",
    "        Report.SaveAs(Id, '', ReportFormat::Pdf, Out);",
    "        Xmlport.Export(50000, Out);",
    "    end;",
    "",
    "    trigger OnRun()",
    "    var",
    '        "Local Exporter": Codeunit "CGR Exporter";',
    "    begin",
    "        Exporter.SaveAsPdf('C:\\x.pdf');",
    '        "Local Exporter".SaveAsPdf(50000, Out);',
    "    end;",
  ].join("\n");
  const { production, test } = await both(body);
  assertEquals(production.filter((v) => v.startsWith(`${RULE}: `)), []);
  assertEquals(test.filter((v) => v.startsWith(`${RULE}: `)), []);
});

Deno.test("H-35 run 004 #1 (r5 2.3): the workspace builder rejects a persistence ban on either side before the build", async () => {
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
      proc("        C: HttpClient;", "Clear(C);")
    }\n}\n`,
  );
  await write(
    a,
    "Test/src/Agent.Test.al",
    `codeunit 80160 "Agent T"\n{\n    Subtype = Test;\n\n    [Test]\n${
      proc("        X: Text;", "X := TemporaryPath;").replace("    ", "")
    }\n}\n`,
  );
  const v = await buildVerdictWorkspace({
    pristine: p,
    artifact: a,
    out: join(await Deno.realPath(await testTempDir()), "v"),
    symbolIds: new Set([IDS.assert]),
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
