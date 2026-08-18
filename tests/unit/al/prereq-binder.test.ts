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
});
