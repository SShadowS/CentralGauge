import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import {
  collectMemberRefs,
  FIELD_NAME_METHODS,
} from "../../../src/al/member-refs.ts";

const SRC = `codeunit 70054 "CG Agent"
{
    procedure Apply(var Line: Record "CG Quote")
    begin
        Line."Unit Price" := 10;
        Line.Validate("Line Discount %", 5);
        Line.SetRange(Status, 1);
        Line.Modify(true);
    end;
}`;

describe("al/member-refs", () => {
  it("classifies an assignment target", async () => {
    const refs = await collectMemberRefs(SRC);
    const r = refs.find((x) => x.member === "Unit Price");
    assertEquals(r?.position, "assignment-target");
    assertEquals(r?.variable, "line");
    assertEquals(r?.procedureName, "Apply");
  });

  it("classifies a field-name argument of a curated method", async () => {
    const refs = await collectMemberRefs(SRC);
    assertEquals(
      refs.find((x) => x.member === "Line Discount %")?.position,
      "curated-method-arg",
    );
    assertEquals(
      refs.find((x) => x.member === "Status")?.position,
      "curated-method-arg",
    );
  });

  it("classifies an ordinary method call as a call", async () => {
    const refs = await collectMemberRefs(SRC);
    assertEquals(refs.find((x) => x.member === "Modify")?.position, "call");
  });

  it("carries the curated method set the spec names", () => {
    for (
      const m of [
        "Validate",
        "SetRange",
        "SetFilter",
        "TestField",
        "CalcFields",
        "CalcSums",
        "FieldError",
        "GetRangeMin",
        "GetRangeMax",
      ]
    ) {
      assertEquals(FIELD_NAME_METHODS.includes(m), true, `missing ${m}`);
    }
  });

  it("returns an empty list when the source does not parse", async () => {
    assertEquals((await collectMemberRefs("codeunit {{{")).length, 0);
  });

  it("flags only the first argument of a first-arg-only curated method, not every identifier-shaped argument", async () => {
    const src = `codeunit 70057 "CG Agent Fix"
{
    procedure Apply(var Line: Record "CG Quote")
    begin
        Line.Validate(Quantity, NewQty);
        Line.SetRange(Amount, MinAmt, MaxAmt);
    end;
}`;
    const refs = await collectMemberRefs(src);
    const curated = refs.filter((x) => x.position === "curated-method-arg");
    assertEquals(curated.map((x) => x.member), ["Quantity", "Amount"]);
    // NewQty/MinAmt/MaxAmt are values/bounds, not fields — they must not
    // appear as ANY ref at all, hard-tier or otherwise.
    assertEquals(refs.some((x) => x.member === "NewQty"), false);
    assertEquals(refs.some((x) => x.member === "MinAmt"), false);
    assertEquals(refs.some((x) => x.member === "MaxAmt"), false);
  });

  it("flags every identifier-shaped argument of an all-args curated method", async () => {
    const src = `codeunit 70058 "CG Agent Fix2"
{
    procedure Apply(var Line: Record "CG Quote")
    begin
        Line.CalcFields(A, B);
    end;
}`;
    const refs = await collectMemberRefs(src);
    const curated = refs.filter((x) => x.position === "curated-method-arg");
    assertEquals(curated.map((x) => x.member), ["A", "B"]);
  });

  it("matches a curated method case-insensitively", async () => {
    const src = `codeunit 70059 "CG Agent Fix3"
{
    procedure Apply(var Line: Record "CG Quote")
    begin
        Line.validate("Line Discount %", 5);
    end;
}`;
    const refs = await collectMemberRefs(src);
    assertEquals(
      refs.find((x) => x.member === "Line Discount %")?.position,
      "curated-method-arg",
    );
  });

  it("classifies a member_expression that is neither an assignment target nor a call as other", async () => {
    const src = `codeunit 70060 "CG Agent Fix4"
{
    procedure Apply(var Line: Record "CG Quote")
    begin
        if Line.Status = 1 then
            Line.Modify(true);
    end;
}`;
    const refs = await collectMemberRefs(src);
    assertEquals(refs.find((x) => x.member === "Status")?.position, "other");
    assertEquals(refs.find((x) => x.member === "Modify")?.position, "call");
  });

  it("does not fabricate a bogus field from a nested member expression inside a curated call's argument list", async () => {
    const src = `codeunit 70061 "CG Agent Fix5"
{
    procedure Apply(var Line: Record "CG Quote"; var Other: Record "CG Other")
    begin
        Line.Validate(Other.Field, 5);
    end;
}`;
    const refs = await collectMemberRefs(src);
    assertEquals(refs.some((x) => x.position === "curated-method-arg"), false);
    const r = refs.find((x) => x.member === "Field");
    assertEquals(r?.position, "other");
    assertEquals(r?.variable, "other");
  });
});
