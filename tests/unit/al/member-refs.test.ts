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
});
