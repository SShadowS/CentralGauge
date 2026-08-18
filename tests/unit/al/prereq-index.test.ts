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
});
