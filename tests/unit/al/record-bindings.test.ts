import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import { collectRecordBindings } from "../../../src/al/record-bindings.ts";

const SRC = `codeunit 70054 "CG Agent"
{
    var
        Shared: Record "CG Quote";
        NotARecord: Integer;

    procedure First(var Line: Record "CG Quote"; Pct: Decimal)
    var
        Local: Record "CG Related";
    begin
    end;

    procedure Second()
    var
        Shared: Record "CG Other";
    begin
    end;
}`;

describe("al/record-bindings", () => {
  it("binds parameters and locals, and inherits globals", async () => {
    const procs = await collectRecordBindings(SRC);
    const first = procs.find((p) => p.procedureName === "First");
    assertEquals(first?.bindings.get("line"), "CG Quote");
    assertEquals(first?.bindings.get("local"), "CG Related");
    assertEquals(first?.bindings.get("shared"), "CG Quote");
  });

  it("ignores non-Record variables entirely", async () => {
    const procs = await collectRecordBindings(SRC);
    const first = procs.find((p) => p.procedureName === "First");
    assertEquals(first?.bindings.has("pct"), false);
    assertEquals(first?.bindings.has("notarecord"), false);
  });

  it("lets a local shadow a global of a different table", async () => {
    const procs = await collectRecordBindings(SRC);
    const second = procs.find((p) => p.procedureName === "Second");
    assertEquals(second?.bindings.get("shared"), "CG Other");
  });

  it("returns an empty list when the source does not parse", async () => {
    assertEquals((await collectRecordBindings("codeunit {{{")).length, 0);
  });
});
