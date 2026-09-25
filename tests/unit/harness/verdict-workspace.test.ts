import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  exists,
  FREEZE_VIOLATIONS_FILE,
  safeCopyTree,
} from "../../../src/harness/fsutil.ts";
import {
  addedTestCodeunits,
  alObjects,
  buildVerdictWorkspace,
  stripAlNoise,
  testCodeunits,
} from "../../../src/harness/verdict-workspace.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";

const SHIPPED =
  `codeunit 80010 "CGR Shipped Tests"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure ShippedPasses()\n    begin\n        Assert.AreEqual(10, Rental.Price(), 'price');\n    end;\n}\n`;
const tmp = async () => await Deno.realPath(await Deno.makeTempDir());

async function pristineDir(): Promise<string> {
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
    "Core/src/Extra.Codeunit.al",
    `codeunit 70001 "CGR Extra"\n{\n}\n`,
  );
  await write(
    d,
    "Test/app.json",
    appJson(IDS.test, "CGR Test", [80000, 84999], [
      { id: IDS.core, name: "CGR Core" },
      { id: IDS.assert, name: "Library Assert" },
    ]),
  );
  await write(d, "Test/src/Shipped.Test.al", SHIPPED);
  await write(d, ".alpackages/Microsoft_Library Assert_28.0.0.0.app", "sym");
  return d;
}

async function artifactFrom(
  pristine: string,
  edits: Record<string, string | null>,
): Promise<string> {
  const a = await tmp();
  await safeCopyTree(pristine, a, { skip: (r) => r.startsWith(".alpackages") });
  for (const [rel, text] of Object.entries(edits)) {
    if (text === null) await Deno.remove(join(a, rel));
    else await write(a, rel, text);
  }
  return a;
}

const SYM = new Set([IDS.assert]);
const rebuild = async (p: string, a: string, productionFrom?: string) =>
  await buildVerdictWorkspace({
    pristine: p,
    artifact: a,
    out: join(await tmp(), "verdict"),
    symbolIds: SYM,
    productionFrom,
  });

Deno.test("a shipped test edited to always pass is restored", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {
    "Test/src/Shipped.Test.al": SHIPPED.replace(
      /Assert\.AreEqual[^\n]*\n/,
      "\n",
    ),
  });
  const v = await rebuild(p, a);
  assertEquals(
    await Deno.readTextFile(join(v.dir, "Test/src/Shipped.Test.al")),
    SHIPPED,
  );
  assertEquals([v.violations, v.changed], [[], []]);
});

Deno.test("a case alias of a shipped test is a violation", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {
    "Test/src/Shipped.Test.al": null,
    "Test/src/shipped.test.al": "codeunit 80011 X\n{\n}\n",
  });
  const v = await rebuild(p, a);
  assertStringIncludes(
    v.violations.join("\n"),
    "case alias of a shipped test file: Test/src/shipped.test.al",
  );
  assertEquals(
    await Deno.readTextFile(join(v.dir, "Test/src/Shipped.Test.al")),
    SHIPPED,
  );
});

Deno.test("only source files are taken; build output, scripts and new folders are dropped", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {
    "Core/CentralGauge_CGR Core_9.9.9.9.app": "fake",
    ".alpackages/Evil.app": "fake",
    "Core/build.ps1": "Remove-Item C:\\",
    "Core/.vscode/settings.json": "{}",
    "Core/LICENSE": "x",
    "Core/translations/Core.g.xlf": "<xliff/>",
    "NewApp/app.json": appJson("c6a1e000-0000-4000-8000-0000000000ee", "New", [
      70500,
      70599,
    ], []),
    "AGENTS.md": "notes",
  });
  const v = await rebuild(p, a);
  for (
    const gone of [
      "Core/CentralGauge_CGR Core_9.9.9.9.app",
      ".alpackages/Evil.app",
      "Core/build.ps1",
      "Core/.vscode",
      "Core/LICENSE",
      "NewApp",
      "AGENTS.md",
    ]
  ) {
    assert(!await exists(join(v.dir, gone)), gone);
  }
  assert(await exists(join(v.dir, "Core/translations/Core.g.xlf")));
  assert(
    await exists(
      join(v.dir, ".alpackages/Microsoft_Library Assert_28.0.0.0.app"),
    ),
  );
});

Deno.test("app.json: identity changes are violations, compiler settings stay trusted, dependencies are taken", async () => {
  const p = await pristineDir();
  const changed = JSON.parse(
    appJson(
      "c6a1e000-0000-4000-8000-0000000000aa",
      "CGR Core2",
      [70000, 70999],
      [],
    ),
  );
  changed.runtime = "99.0";
  const v1 = await rebuild(
    p,
    await artifactFrom(p, { "Core/app.json": JSON.stringify(changed) }),
  );
  const text = v1.violations.join("\n");
  for (const k of ["id changed", "name changed", "idRanges changed"]) {
    assertStringIncludes(text, `Core: ${k}`);
  }
  const settings = JSON.parse(
    appJson(IDS.core, "CGR Core", [70000, 70099], [{
      id: IDS.assert,
      name: "Library Assert",
    }]),
  );
  settings.runtime = "99.0";
  const v2 = await rebuild(
    p,
    await artifactFrom(p, { "Core/app.json": JSON.stringify(settings) }),
  );
  assertEquals(v2.violations, []);
  const merged = JSON.parse(
    await Deno.readTextFile(join(v2.dir, "Core/app.json")),
  );
  assertEquals(merged.runtime, "17.0");
  assertEquals(merged.dependencies.map((d: { id: string }) => d.id), [
    IDS.assert,
  ]);
});

Deno.test("object ids: outside idRanges, reserved band, oracle band, 80013 and the fixture band", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {
    "Core/src/Far.Codeunit.al": `codeunit 70150 "Far"\n{\n}\n`,
    "Core/src/Reserved.Codeunit.al": `codeunit 75001 "R"\n{\n}\n`,
    "Test/src/Oracle.Test.al":
      `codeunit 85001 "O"\n{\n    Subtype = Test;\n}\n`,
    "Test/src/Clash.Test.al": `codeunit 80013 "C"\n{\n    Subtype = Test;\n}\n`,
    "Test/src/Fixture.Test.al":
      `codeunit 84950 "F"\n{\n    Subtype = Test;\n}\n`,
  });
  const text = (await rebuild(p, a)).violations.join("\n");
  for (
    const n of [
      "codeunit 70150 is outside the app's idRanges",
      "codeunit 75001 is in the reserved band",
      "codeunit 85001 is in the hidden-oracle band",
      "codeunit 80013 is forbidden",
      "codeunit 84950 is in the harness fixture band",
    ]
  ) {
    assertStringIncludes(text, n);
  }
});

Deno.test("stripAlNoise: comments and strings cannot hide or fake a declaration", async () => {
  const src = [
    '// codeunit 75002 "not real"',
    '/* codeunit 75003 "nor this" \'quote */',
    'codeunit 70002 "Fine // not a comment"',
    "{ var s: Text; begin s := '/*'; end; }",
    'codeunit 75004 "Hidden after string"',
    "{ }",
  ].join("\n");
  const d = await tmp();
  await write(d, "x.al", src);
  assertEquals((await alObjects(d)).map((o) => o.id), [70002, 75004]);
  assertEquals(stripAlNoise("a 'b''c' d").replace(/\s+/g, " ").trim(), "a d");
});

Deno.test("freeze violations and unknown dependencies fail validation", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {
    [FREEZE_VIOLATIONS_FILE]:
      "link, reparse point or special file: Core/hostlink\n",
    "Core/app.json": appJson(IDS.core, "CGR Core", [70000, 70099], [{
      id: "11111111-2222-4333-8444-555555555555",
      name: "Unknown",
    }]),
  });
  const text = (await rebuild(p, a)).violations.join("\n");
  assertStringIncludes(
    text,
    "workspace link, reparse point or special file: Core/hostlink",
  );
  assertStringIncludes(text, "11111111-2222-4333-8444-555555555555 is neither");
});

Deno.test("a deleted production file stays deleted and the app is changed", async () => {
  const p = await pristineDir();
  const v = await rebuild(
    p,
    await artifactFrom(p, { "Core/src/Extra.Codeunit.al": null }),
  );
  assert(!await exists(join(v.dir, "Core/src/Extra.Codeunit.al")));
  assertEquals(v.changed, ["Core"]);
});

Deno.test("test-authoring: production from the reference, tests from the artifact", async () => {
  const p = await pristineDir();
  const reference = await artifactFrom(p, {
    "Core/src/Core.Codeunit.al":
      `codeunit 70000 "CGR Core"\n{\n    // reference\n}\n`,
  });
  const a = await artifactFrom(p, {
    "Core/src/Core.Codeunit.al":
      `codeunit 70000 "CGR Core"\n{\n    // agent change\n}\n`,
    "Test/src/Agent.Test.al":
      `codeunit 81000 "Agent"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure PriceIsTen()\n    begin\n    end;\n\n    [Test]\n    [HandlerFunctions('Confirm')]\n    procedure "Rejects Invoiced"()\n    begin\n    end;\n\n    procedure Helper()\n    begin\n    end;\n\n    // [Test] procedure Commented()\n}\n`,
  });
  const v = await rebuild(p, a, reference);
  assertStringIncludes(
    await Deno.readTextFile(join(v.dir, "Core/src/Core.Codeunit.al")),
    "reference",
  );
  const added = await addedTestCodeunits(join(p, "Test"), join(v.dir, "Test"));
  assertEquals(added.map((t) => [t.codeunit, t.procedures]), [[81000, [
    "PriceIsTen",
    "Rejects Invoiced",
  ]]]);
});

Deno.test("alObjects: declarations are found anywhere at object level, not only at a line start", async () => {
  const d = await tmp();
  await write(
    d,
    "mid.al",
    `codeunit 70000 "CGR Core"\n{\n} codeunit 75005 "Hidden" { }\n`,
  );
  await write(d, "split.al", `codeunit\n  85001 "Split"\n{\n}\n`);
  await write(d, "comment.al", `codeunit /*\n*/ 80013 "X"\n{\n}\n`);
  await write(
    d,
    "vars.al",
    `codeunit 70003 "Vars"\n{\n    var\n        P: Page 21;\n        C: Codeunit 80;\n}\n`,
  );
  await write(d, "quoted.al", `codeunit 70004 "x codeunit 75009 y"\n{\n}\n`);
  await write(
    d,
    "string.al",
    `codeunit 70005 A\n{\n    var s: Text; // '\n}\n'\ncodeunit 75006 B\n{\n}\n`,
  );
  const ids = (await alObjects(d)).map((o) => `${o.file}:${o.id}`).sort();
  assertEquals(ids, [
    "comment.al:80013",
    "mid.al:70000",
    "mid.al:75005",
    "quoted.al:70004",
    "split.al:85001",
    "string.al:70005",
    "string.al:75006",
    "vars.al:70003",
  ]);
});

Deno.test("testCodeunits: each codeunit is judged on its own body", async () => {
  const d = await tmp();
  await write(
    d,
    "two.al",
    `codeunit 80020 Helper\n{\n}\ncodeunit 80021 T\n{\n    Subtype = Test;\n\n    [Test]\n    procedure P()\n    begin\n    end;\n}\n`,
  );
  await write(
    d,
    "mid.al",
    `codeunit 80030 A\n{\n} codeunit 80031 B { Subtype = Test; [Test] procedure Q() begin end; }\n`,
  );
  assertEquals(
    (await testCodeunits(d)).map((t) => [t.codeunit, t.procedures]),
    [
      [80021, ["P"]],
      [80031, ["Q"]],
    ],
  );
});

Deno.test("an app folder replaced by a file is a violation, not an exception", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {});
  await Deno.remove(join(a, "Core"), { recursive: true });
  await Deno.writeTextFile(join(a, "Core"), "not a folder");
  await Deno.remove(join(a, "Test"), { recursive: true });
  await Deno.writeTextFile(join(a, "Test"), "not a folder");
  const text = (await rebuild(p, a)).violations.join("\n");
  assertStringIncludes(text, "app folder Core is missing");
  assertStringIncludes(text, "app folder Test is missing");
});

Deno.test("preprocessor conditionals in verdict sources are a violation", async () => {
  const p = await pristineDir();
  const a = await artifactFrom(p, {
    "Core/src/PP.Codeunit.al":
      `#if NEVER\n'\n#endif\ncodeunit 70002 PP\n{\n}\n#if NEVER\n'\n#endif\n`,
  });
  assertStringIncludes(
    (await rebuild(p, a)).violations.join("\n"),
    "Core/src/PP.Codeunit.al: preprocessor conditional",
  );
});
