import { assertEquals } from "@std/assert";
import {
  type AlObject,
  objectKey,
  overlayObjects,
  splitAlObjects,
} from "../../../src/tasks/object-overlay.ts";

const STARTER = `table 70001 "CG X001 Ledger"
{
    fields
    {
        field(1; "Entry No."; Integer) { }
    }
}

codeunit 70002 "CG X001 Engine"
{
    procedure Post(): Decimal
    begin
        exit(1);
    end;
}

enum 70003 "CG X001 Kind"
{
    value(0; Open) { }
}`;

function keys(objs: AlObject[]): string[] {
  return objs.map(objectKey);
}

Deno.test("splitAlObjects", async (t) => {
  await t.step("splits every top-level object", () => {
    assertEquals(keys(splitAlObjects(STARTER)), [
      "table:cg x001 ledger",
      "codeunit:cg x001 engine",
      "enum:cg x001 kind",
    ]);
  });

  await t.step("handles bare (unquoted) identifiers", () => {
    const objs = splitAlObjects(`interface IPaymentProcessor\n{\n}\n`);
    assertEquals(keys(objs), ["interface:ipaymentprocessor"]);
  });

  await t.step("ignores prose and fences around the objects", () => {
    const objs = splitAlObjects(
      "Here is the fix:\n```al\ncodeunit 70002 Foo\n{\n}\n```\nDone.",
    );
    assertEquals(keys(objs), ["codeunit:foo"]);
  });

  await t.step("nested braces do not end the object early", () => {
    const objs = splitAlObjects(STARTER);
    assertEquals(
      objs[0]!.text.includes('field(1; "Entry No."; Integer)'),
      true,
    );
    assertEquals(objs[0]!.text.trimEnd().endsWith("}"), true);
  });

  await t.step("an unterminated object still yields its text", () => {
    // Truncated output must reach the compiler as a syntax error, never
    // vanish into a "not returned, keep the starter's" no-op.
    const objs = splitAlObjects(`codeunit 70002 Foo\n{\n    procedure P()`);
    assertEquals(keys(objs), ["codeunit:foo"]);
    assertEquals(objs[0]!.text.includes("procedure P()"), true);
  });
});

Deno.test("overlayObjects", async (t) => {
  await t.step("omitting an object is a no-op, not a failure", () => {
    // The whole point: under rule 2 this response would drop the table and
    // the enum and fail to compile with AL0185.
    const returned = `codeunit 70002 "CG X001 Engine"
{
    procedure Post(): Decimal
    begin
        exit(2);
    end;
}`;
    const r = overlayObjects(STARTER, returned);
    assertEquals(r.replaced, ["codeunit:cg x001 engine"]);
    assertEquals(r.carried, ["table:cg x001 ledger", "enum:cg x001 kind"]);
    assertEquals(r.added, []);
    assertEquals(r.source.includes("exit(2)"), true);
    assertEquals(r.source.includes("exit(1)"), false);
    assertEquals(r.source.includes('"Entry No."'), true);
    assertEquals(r.source.includes("CG X001 Kind"), true);
  });

  await t.step("identity match is case-insensitive", () => {
    const r = overlayObjects(
      STARTER,
      `CODEUNIT 70002 "cg x001 ENGINE"\n{\n    procedure Post(): Decimal begin exit(9); end;\n}`,
    );
    assertEquals(r.replaced, ["codeunit:cg x001 engine"]);
    assertEquals(r.source.includes("exit(9)"), true);
  });

  await t.step("kind participates in identity", () => {
    // Same name, different kind -> an addition, never a replacement.
    const r = overlayObjects(
      STARTER,
      `page 70009 "CG X001 Engine"\n{\n}`,
    );
    assertEquals(r.replaced, []);
    assertEquals(r.added, ["page:cg x001 engine"]);
    assertEquals(r.carried.length, 3);
  });

  await t.step("a genuinely new object is appended", () => {
    const r = overlayObjects(
      STARTER,
      `enum 70010 "CG X001 Status"\n{\n    value(0; New) { }\n}`,
    );
    assertEquals(r.added, ["enum:cg x001 status"]);
    assertEquals(r.replaced, []);
    assertEquals(r.source.includes("CG X001 Status"), true);
  });

  await t.step("starter order is preserved", () => {
    const r = overlayObjects(
      STARTER,
      `enum 70003 "CG X001 Kind"\n{\n    value(0; Closed) { }\n}`,
    );
    const objs = splitAlObjects(r.source);
    assertEquals(keys(objs), [
      "table:cg x001 ledger",
      "codeunit:cg x001 engine",
      "enum:cg x001 kind",
    ]);
  });

  await t.step("a duplicated returned object does not double-append", () => {
    const dup = `enum 70010 "CG X001 Status"\n{\n}`;
    const r = overlayObjects(STARTER, `${dup}\n\n${dup}`);
    assertEquals(r.added, ["enum:cg x001 status"]);
    assertEquals(splitAlObjects(r.source).length, 4);
  });

  await t.step("returning everything reproduces the whole-app contract", () => {
    const r = overlayObjects(STARTER, STARTER);
    assertEquals(r.carried, []);
    assertEquals(r.added, []);
    assertEquals(r.replaced.length, 3);
    assertEquals(splitAlObjects(r.source).length, 3);
  });

  await t.step(
    "an empty response carries the starter through unchanged",
    () => {
      const r = overlayObjects(STARTER, "I could not find the defect.");
      assertEquals(r.replaced, []);
      assertEquals(r.added, []);
      assertEquals(r.carried.length, 3);
      assertEquals(splitAlObjects(r.source).length, 3);
    },
  );
});
