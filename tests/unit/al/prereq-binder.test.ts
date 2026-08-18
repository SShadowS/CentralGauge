import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import { buildPrereqIndex } from "../../../src/al/prereq-index.ts";
import { bindResponseToPrereqs } from "../../../src/al/prereq-binder.ts";

const PREREQ = `table 69001 "CG Quote"
{
    fields
    {
        field(1; "Unit Price"; Decimal) { }
        field(2; Status; Integer) { }
    }
    procedure Recalculate() begin end;
}`;

/** A SECOND prereq table, so a mis-bind lands on a real table with real
 *  fields rather than falling out of the index and being silently skipped —
 *  which is what makes the wrong bind visible as a wrong `table` value. */
const OTHER_PREREQ = `table 69002 "CG Other"
{
    fields
    {
        field(1; "Other Field"; Decimal) { }
    }
}`;

async function bind(src: string) {
  return await bindResponseToPrereqs(src, await buildPrereqIndex([PREREQ]));
}

const wrap = (body: string) =>
  `codeunit 70054 "A"
{
    procedure P(var Line: Record "CG Quote")
    begin
${body}
    end;
}`;

describe("al/prereq-binder", () => {
  it("hard-flags an unknown assignment target", async () => {
    const r = await bind(wrap(`        Line.Discount := 1;`));
    const f = r.findings.find((x) => x.member === "Discount");
    assertEquals(f?.tier, "hard");
    assertEquals(f?.table, "CG Quote");
  });

  it("hard-flags an unknown field argument of a curated method", async () => {
    const r = await bind(wrap(`        Line.Validate(Discount, 1);`));
    assertEquals(r.findings.find((x) => x.member === "Discount")?.tier, "hard");
  });

  it("marks a known field as known, not as a finding to fear", async () => {
    const r = await bind(wrap(`        Line."Unit Price" := 1;`));
    assertEquals(
      r.findings.find((x) => x.member === "Unit Price")?.tier,
      "known",
    );
  });

  it("soft-labels an unknown member in call position", async () => {
    const r = await bind(wrap(`        Line.Refresh();`));
    assertEquals(r.findings.find((x) => x.member === "Refresh")?.tier, "soft");
  });

  it("treats a declared table procedure as known", async () => {
    const r = await bind(wrap(`        Line.Recalculate();`));
    assertEquals(
      r.findings.find((x) => x.member === "Recalculate")?.tier,
      "known",
    );
  });

  it("never analyses a variable not bound to a prereq table", async () => {
    const src = `codeunit 70054 "A"
{
    procedure P(var Cust: Record Customer)
    begin
        Cust.MadeUpField := 1;
    end;
}`;
    const r = await bind(src);
    assertEquals(r.findings.length, 0);
  });

  it("degrades instead of guessing when the response does not parse", async () => {
    const r = await bind("codeunit {{{");
    assertEquals(r.degraded, true);
    assertEquals(r.findings.length, 0);
  });

  // An index built from a PARTIAL disk load parses cleanly and looks
  // entirely trustworthy: `hasError` is false and the tables it does hold
  // are correct. It is simply missing whatever never reached it, so every
  // reference to a missing member would be reported as invented on the
  // strength of a disk error. The caller says so; this weakens rather than
  // strengthens.
  it("degrades when the prereq sources themselves loaded incompletely", async () => {
    const index = await buildPrereqIndex([PREREQ]);
    assertEquals(index.hasError, false);
    const r = await bindResponseToPrereqs(
      wrap(`        Line.Discount := 1;`),
      index,
      { sourcesIncomplete: true },
    );
    assertEquals(r.degraded, true);
    assertEquals(r.findings.length, 0);
  });

  it("does not degrade when the sources loaded completely", async () => {
    const index = await buildPrereqIndex([PREREQ]);
    const r = await bindResponseToPrereqs(
      wrap(`        Line.Discount := 1;`),
      index,
      { sourcesIncomplete: false },
    );
    assertEquals(r.degraded, false);
    assertEquals(r.findings.find((x) => x.member === "Discount")?.tier, "hard");
  });

  describe("degraded distinguishes 'could not analyse' from 'analysed, found nothing'", () => {
    it("is NOT degraded for a valid response with no procedures at all", async () => {
      // A table-only (or enum-only) candidate is exactly correct for plenty
      // of trap tasks. Analysis ran fine and correctly found nothing to
      // check — this must never render as "couldn't check the prereq".
      const src = `table 70054 "CG Something"
{
    fields
    {
        field(1; Foo; Text[50]) { }
    }
}`;
      const r = await bind(src);
      assertEquals(r.degraded, false);
      assertEquals(r.findings.length, 0);
    });

    it("is NOT degraded for a valid procedure that never references the prereq", async () => {
      const src = `codeunit 70054 "A"
{
    procedure P()
    begin
    end;
}`;
      const r = await bind(src);
      assertEquals(r.degraded, false);
      assertEquals(r.findings.length, 0);
    });

    it("IS degraded for a genuinely unparseable response", async () => {
      const r = await bind("codeunit {{{");
      assertEquals(r.degraded, true);
      assertEquals(r.findings.length, 0);
    });

    it("IS degraded for prose that is not AL at all", async () => {
      const r = await bind(
        "Here is my implementation of the feature you requested.",
      );
      assertEquals(r.degraded, true);
      assertEquals(r.findings.length, 0);
    });
  });

  it("joins bindings to refs inside a quoted-named procedure", async () => {
    // Regression guard for the join contract: record-bindings.ts and
    // member-refs.ts both key procedureName via unquote(nameNode.text). If
    // that ever diverges, this finding silently disappears — no error, no
    // crash, the binder just stops flagging inside every quoted-named
    // procedure. See prereq-binder.ts's join-contract note.
    const src = `codeunit 70054 "A"
{
    procedure "My Proc"(var Line: Record "CG Quote")
    begin
        Line.Discount := 1;
    end;
}`;
    const r = await bind(src);
    const f = r.findings.find((x) => x.member === "Discount");
    assertEquals(f?.tier, "hard");
    assertEquals(f?.procedureName, "My Proc");
  });

  // Both members below reference a field that provably exists on the table
  // they are actually declared against. A `hard` tier on either one is the
  // exact false accusation this whole module exists to prevent, and in both
  // shapes the finding also NAMED THE WRONG TABLE, so an author could not
  // have spotted the mistake from the rail. Every other fixture in this
  // file is a single object with uniquely-named members, which is the one
  // shape in which neither defect is observable.
  describe("binds each member against its own scope, not a same-named one", () => {
    async function bindTwoTables(src: string) {
      return await bindResponseToPrereqs(
        src,
        await buildPrereqIndex([PREREQ, OTHER_PREREQ]),
      );
    }

    it("keeps two same-named field triggers on one table apart", async () => {
      // One table, two fields, each with its own `trigger OnValidate()` —
      // the most ordinary shape in AL. `procedureName` collides, and a
      // name-keyed `Map` keeps the LAST entry, so every ref in the first
      // trigger used to be bound to the second trigger's table.
      const src = `table 70001 "My Table"
{
    fields
    {
        field(1; A; Integer)
        {
            trigger OnValidate()
            var
                Q: Record "CG Quote";
            begin
                Q."Unit Price" := 1;
            end;
        }
        field(2; B; Integer)
        {
            trigger OnValidate()
            var
                Q: Record "CG Other";
            begin
                Q."Other Field" := 2;
            end;
        }
    }
}`;
      const r = await bindTwoTables(src);
      const first = r.findings.find((x) => x.member === "Unit Price");
      assertEquals(first?.table, "CG Quote");
      assertEquals(first?.tier, "known");
      const second = r.findings.find((x) => x.member === "Other Field");
      assertEquals(second?.table, "CG Other");
      assertEquals(second?.tier, "known");
    });

    it("keeps one object's global out of another object's procedures", async () => {
      // Distinct procedure names, so the join is doing its job — this is
      // the collection side: globals must be scoped to the object that
      // declares them, never pooled across the whole file.
      const src = `codeunit 70002 "A"
{
    var
        Q: Record "CG Quote";

    procedure DoA()
    begin
        Q."Unit Price" := 1;
    end;
}

codeunit 70003 "B"
{
    var
        Q: Record "CG Other";

    procedure DoB()
    begin
        Q."Other Field" := 2;
    end;
}`;
      const r = await bindTwoTables(src);
      const a = r.findings.find((x) => x.procedureName === "DoA");
      assertEquals(a?.table, "CG Quote");
      assertEquals(a?.member, "Unit Price");
      assertEquals(a?.tier, "known");
      const b = r.findings.find((x) => x.procedureName === "DoB");
      assertEquals(b?.table, "CG Other");
      assertEquals(b?.member, "Other Field");
      assertEquals(b?.tier, "known");
    });
  });
});
