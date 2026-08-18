import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import {
  buildPrereqIndex,
  lookupField,
  lookupProcedure,
} from "../../../src/al/prereq-index.ts";

const TABLE = `table 69001 "Product Category"
{
    fields
    {
        field(1; "Code"; Code[20]) { }
        field(2; "Description"; Text[100]) { }
        field(3; Active; Boolean) { }
    }

    procedure Recalculate()
    begin
    end;
}`;

const TABLE_EXTENSION =
  `tableextension 69100 "CG Category Ext" extends "Product Category"
{
    fields
    {
        field(69101; "Extra Field"; Text[10]) { }
    }

    procedure ExtHelper()
    begin
    end;
}`;

// A field whose OnValidate trigger declares a local variable named "field",
// and a procedure whose own local variable is named "procedure" - both
// chosen to collide by TEXT with what this module looks for, to prove
// extraction matches on AST node type/position, not on token spelling, and
// never descends into a matched field's or procedure's own body.
const QUOTED_PROCEDURE_TABLE = `table 69001 "Product Category"
{
    fields
    {
        field(1; "Code"; Code[20]) { }
    }

    procedure "Recalc Totals"()
    begin
    end;

    procedure Plain()
    begin
    end;
}`;

const HOSTILE_TABLE = `table 69001 "Product Category"
{
    fields
    {
        field(1; "Code"; Code[20]) { }
        field(2; Active; Boolean)
        {
            trigger OnValidate()
            var
                field: Integer;
            begin
            end;
        }
    }

    procedure Recalc()
    var
        procedure: Text;
    begin
    end;

    procedure Helper()
    begin
    end;
}`;

describe("al/prereq-index", () => {
  it("indexes fields and procedures of a prereq table", async () => {
    const idx = await buildPrereqIndex([TABLE]);
    const t = idx.tables.get("product category");
    assertEquals(t?.name, "Product Category");
    assertEquals(t?.fields, ["Code", "Description", "Active"]);
    assertEquals(t?.procedures, ["Recalculate"]);
    assertEquals(idx.hasError, false);
  });

  it("looks up members case- and quote-insensitively", async () => {
    const idx = await buildPrereqIndex([TABLE]);
    assertEquals(lookupField(idx, '"Product Category"', '"Code"'), true);
    assertEquals(lookupField(idx, "PRODUCT CATEGORY", "code"), true);
    assertEquals(lookupField(idx, "Product Category", "Nope"), false);
    assertEquals(lookupProcedure(idx, "Product Category", "recalculate"), true);
    assertEquals(lookupProcedure(idx, "Product Category", "Code"), false);
  });

  it("reports a parse failure instead of a silently empty index", async () => {
    const idx = await buildPrereqIndex(["table 1 {{{ broken"]);
    assertEquals(idx.hasError, true);
  });

  it("merges several sources, chained prereqs included", async () => {
    const other =
      `table 69002 "CG Related" { fields { field(1; "Ref"; Code[10]) { } } }`;
    const idx = await buildPrereqIndex([TABLE, other]);
    assertEquals(idx.tables.size, 2);
    assertEquals(lookupField(idx, "CG Related", "Ref"), true);
  });

  it("indexes a tableextension the same way as a table", async () => {
    const idx = await buildPrereqIndex([TABLE_EXTENSION]);
    const t = idx.tables.get("cg category ext");
    assertEquals(t?.name, "CG Category Ext");
    assertEquals(t?.fields, ["Extra Field"]);
    assertEquals(t?.procedures, ["ExtHelper"]);
    assertEquals(idx.hasError, false);
  });

  it("does not let a trigger's or procedure's local variables contaminate extraction", async () => {
    const idx = await buildPrereqIndex([HOSTILE_TABLE]);
    const t = idx.tables.get("product category");
    assertEquals(t?.fields, ["Code", "Active"]);
    assertEquals(t?.procedures, ["Recalc", "Helper"]);
    assertEquals(idx.hasError, false);
  });

  it("indexes both a quoted and an unquoted procedure name", async () => {
    const idx = await buildPrereqIndex([QUOTED_PROCEDURE_TABLE]);
    const t = idx.tables.get("product category");
    assertEquals(t?.procedures, ["Recalc Totals", "Plain"]);
    assertEquals(
      lookupProcedure(idx, "Product Category", "Recalc Totals"),
      true,
    );
    assertEquals(
      lookupProcedure(idx, "Product Category", '"recalc totals"'),
      true,
    );
    assertEquals(lookupProcedure(idx, "Product Category", "Plain"), true);
  });
});
