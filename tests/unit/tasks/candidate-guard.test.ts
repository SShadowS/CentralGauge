import { assertEquals } from "@std/assert";
import {
  describeCollisions,
  findProtectedNameCollisions,
} from "../../../src/tasks/candidate-guard.ts";

Deno.test("candidate-guard", async (t) => {
  await t.step(
    "rejects the measured incident: a stub codeunit named Any",
    () => {
      // Verbatim shape of gpt-5.5's false-pass submission on CG-AL-X070
      // (2026-08-27): the oracle's Any.IntegerInRange calls bound to this stub.
      const code = `
codeunit 70353 "CG X070 Import Batch"
{
    procedure Run() begin end;
}
codeunit 70354 Any
{
    procedure IntegerInRange(Min: Integer; Max: Integer): Integer
    begin
        exit(Min);
    end;
}
`;
      const hits = findProtectedNameCollisions(code);
      assertEquals(hits.length, 1);
      assertEquals(hits[0]!.name, "Any");
      assertEquals(hits[0]!.kind, "codeunit");
    },
  );

  await t.step("rejects a quoted-name Assert shadow", () => {
    const hits = findProtectedNameCollisions(
      'codeunit 70001 "Assert"\n{\n}\n',
    );
    assertEquals(hits.length, 1);
    assertEquals(hits[0]!.name, "Assert");
  });

  await t.step("rejects Library - * shadows regardless of suffix", () => {
    const hits = findProtectedNameCollisions(
      'codeunit 70002 "Library - Sales"\n{\n}\n',
    );
    assertEquals(hits.length, 1);
  });

  await t.step("rejects oracle-namespace collisions (CG-AL- prefix)", () => {
    // A candidate file named after the oracle would be overwritten by the
    // harness's companion copy; a candidate OBJECT named into that namespace
    // survives the copy and collides at compile or resolution time.
    const hits = findProtectedNameCollisions(
      'codeunit 70003 "CG-AL-X070 Helper"\n{\n}\n',
    );
    assertEquals(hits.length, 1);
  });

  await t.step("is case-insensitive", () => {
    const hits = findProtectedNameCollisions("codeunit 70004 ANY\n{\n}\n");
    assertEquals(hits.length, 1);
  });

  await t.step("accepts an ordinary honest solution", () => {
    const code = `
table 70000 "Product Category"
{
    fields
    {
        field(1; "Code"; Code[20]) { }
    }
}
codeunit 70001 "CG X070 Batch Importer"
{
    procedure CopyAll(): Integer
    var
        AnyCount: Integer; // variable NAMED Any-ish is fine - only declarations match
    begin
        exit(AnyCount);
    end;
}
page 70002 "Product Category Card"
{
    SourceTable = "Product Category";
}
`;
    assertEquals(findProtectedNameCollisions(code), []);
  });

  await t.step(
    "does not flag USES of the libraries, only declarations",
    () => {
      const code = `
codeunit 70005 "CG X999 Solution"
{
    var
        Assert: Codeunit Assert;
        Any: Codeunit Any;
    procedure Check()
    begin
        Assert.IsTrue(Any.IntegerInRange(1, 2) > 0, 'uses are legitimate');
    end;
}
`;
      assertEquals(findProtectedNameCollisions(code), []);
    },
  );

  await t.step("message names the guard so it cannot read as infra", () => {
    const hits = findProtectedNameCollisions("codeunit 70354 Any\n{\n}\n");
    const msg = describeCollisions(hits);
    assertEquals(
      msg.startsWith("candidate rejected by the anti-gaming guard"),
      true,
    );
    assertEquals(msg.includes('"Any"'), true);
  });
});
