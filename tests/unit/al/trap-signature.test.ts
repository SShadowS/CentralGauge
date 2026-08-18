import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists, assertNotEquals } from "@std/assert";

import { deriveTrapSignature } from "../../../src/al/trap-signature.ts";

const CORRECT = `codeunit 71410 "CG X054 Agent"
{
    procedure SetTerms(No: Code[20]; Rate: Integer; Qty: Integer)
    begin
        Quote.Get(No);
        Quote.Validate(Qty, Qty);
        Quote.Validate(Rate, Rate);
        Quote.Modify(true);
    end;
}`;

const NAIVE = `codeunit 71410 "CG X054 Agent"
{
    procedure SetTerms(No: Code[20]; Rate: Integer; Qty: Integer)
    begin
        Quote.Get(No);
        Quote.Validate(Rate, Rate);
        Quote.Qty := Qty;
        Quote.Modify(true);
    end;
}`;

// A pure insertion at the top: the only real change is "Z(); is new. A
// positional (index-for-index) compare would report 4 sites here (every
// statement shifts down one slot and looks different from its counterpart);
// an LCS compare reports exactly 1, because A/B/C are still recognizably the
// same statements, just at different positions. This is the discriminating
// case the brief itself names as the reason a positional compare is wrong.
const INSERT_TOP_CORRECT = `codeunit 71420 "CG Insert Top"
{
    procedure Run()
    begin
        A();
        B();
        C();
    end;
}`;

const INSERT_TOP_NAIVE = `codeunit 71420 "CG Insert Top"
{
    procedure Run()
    begin
        Z();
        A();
        B();
        C();
    end;
}`;

// A table trigger (not a procedure) carrying the divergence directly — the
// shape of the xRec family of committed tasks (M042/M043/M044/X022), where
// xRec is only in scope inside a table or page trigger and there is no
// procedure-based authoring workaround.
const TRIGGER_CORRECT = `table 71421 "CG Trigger Shape"
{
    fields
    {
        field(1; Balance; Decimal) { }
        field(2; "Last Delta"; Decimal) { }
    }

    trigger OnModify()
    begin
        "Last Delta" := Balance - xRec.Balance;
    end;
}`;

const TRIGGER_NAIVE = `table 71421 "CG Trigger Shape"
{
    fields
    {
        field(1; Balance; Decimal) { }
        field(2; "Last Delta"; Decimal) { }
    }

    trigger OnModify()
    begin
        "Last Delta" := Balance;
    end;
}`;

// Two fields with same-named OnValidate triggers; only the second field's
// body diverges. A bare-name key would collide and drop this site.
const FIELD_COLLISION_CORRECT = `table 71422 "CG Field Collision"
{
    fields
    {
        field(1; A; Integer)
        {
            trigger OnValidate()
            begin
                Message('a-shared');
            end;
        }
        field(2; B; Integer)
        {
            trigger OnValidate()
            begin
                Message('b-correct');
            end;
        }
    }
}`;

const FIELD_COLLISION_NAIVE = `table 71422 "CG Field Collision"
{
    fields
    {
        field(1; A; Integer)
        {
            trigger OnValidate()
            begin
                Message('a-shared');
            end;
        }
        field(2; B; Integer)
        {
            trigger OnValidate()
            begin
                Message('b-naive');
            end;
        }
    }
}`;

// A report-level `procedure Apply()` alongside a requestpage-scoped
// `procedure Apply()` of the same name; only the inner one diverges.
const REPORT_SCOPE_CORRECT = `report 71423 "CG Report Scope"
{
    procedure Apply()
    begin
        Message('outer-shared');
    end;

    requestpage
    {
        procedure Apply()
        begin
            Message('inner-correct');
        end;
    }
}`;

const REPORT_SCOPE_NAIVE = `report 71423 "CG Report Scope"
{
    procedure Apply()
    begin
        Message('outer-shared');
    end;

    requestpage
    {
        procedure Apply()
        begin
            Message('inner-naive');
        end;
    }
}`;

describe("al/trap-signature", () => {
  it("locates the diverging statements", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    assertEquals(sig.sites.length > 0, true);
    assertEquals(sig.sites[0]?.procedureName.toLowerCase(), "setterms");
  });

  it("records both forms at a site", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    const joinedNaive = sig.sites.map((s) => s.naiveForm ?? "").join(" ");
    assertEquals(joinedNaive.includes(":="), true);
  });

  it("yields no sites when correct and naive are identical", async () => {
    const sig = await deriveTrapSignature([CORRECT], [CORRECT]);
    assertEquals(sig.sites.length, 0);
  });

  it("yields no sites when naive is missing entirely", async () => {
    const sig = await deriveTrapSignature([CORRECT], []);
    assertEquals(sig.sites.length, 0);
  });

  it("ignores formatting and comment differences", async () => {
    const reformatted = CORRECT
      .replace(/\n/g, "\n  ")
      .replace("begin", "begin // do the thing");
    const sig = await deriveTrapSignature([CORRECT], [reformatted]);
    assertEquals(sig.sites.length, 0);
  });

  it("survives real committed AL: comments, multi-line statements, var blocks", async () => {
    const real = await Deno.readTextFile("tests/al/hard/CG-AL-X043.Test.al");
    const perturbed = real.replace(
      `PurchaseLine.Validate("Direct Unit Cost", LibraryRandom.RandDecInRange(100, 500, 2));`,
      `PurchaseLine."Direct Unit Cost" := LibraryRandom.RandDecInRange(100, 500, 2);`,
    );
    // Guard against a silently vacuous test if the file is ever edited and
    // the literal string above no longer matches.
    assertNotEquals(perturbed, real);

    const selfSig = await deriveTrapSignature([real], [real]);
    assertEquals(selfSig.sites.length, 0);

    const perturbedSig = await deriveTrapSignature([real], [perturbed]);
    // Bounded, not `.some(...)`: an unbounded existence check would also
    // pass if the diff over-reported dozens of sites, which is exactly the
    // over-reporting an LCS diff exists to prevent. The perturbation is a
    // single in-place statement replacement, so it must land as exactly one
    // substitution site carrying BOTH forms.
    assertEquals(perturbedSig.sites.length, 1);
    const site = perturbedSig.sites[0];
    assertExists(site);
    assertExists(site.correctForm);
    assertEquals(site.correctForm.includes("validate"), true);
    assertEquals(site.naiveForm?.includes(":="), true);
  });

  it("reports one site for a pure insertion at the top, not a shift of every later statement", async () => {
    const sig = await deriveTrapSignature([INSERT_TOP_CORRECT], [
      INSERT_TOP_NAIVE,
    ]);
    assertEquals(sig.sites.length, 1);
    assertEquals(sig.sites[0]?.naiveForm, "z()");
    assertEquals(sig.sites[0]?.correctForm, undefined);
    assertEquals(sig.sites[0]?.statementIndex, 0);
  });

  it("locates a divergence inside a table trigger, not just procedures", async () => {
    const sig = await deriveTrapSignature([TRIGGER_CORRECT], [
      TRIGGER_NAIVE,
    ]);
    assertEquals(sig.sites.length, 1);
    assertEquals(sig.sites[0]?.procedureName, "OnModify");
    assertEquals(sig.sites[0]?.correctForm?.includes("xrec"), true);
    assertEquals(sig.sites[0]?.naiveForm?.includes("xrec"), false);
  });

  it("keeps same-named field triggers in different fields distinct instead of colliding", async () => {
    const sig = await deriveTrapSignature([FIELD_COLLISION_CORRECT], [
      FIELD_COLLISION_NAIVE,
    ]);
    assertEquals(sig.sites.length, 1);
    assertEquals(sig.sites[0]?.procedureName, "B.OnValidate");
    assertEquals(sig.sites[0]?.correctForm, "message('b-correct')");
    assertEquals(sig.sites[0]?.naiveForm, "message('b-naive')");
  });

  it("keeps a report-level procedure distinct from a same-named requestpage-scoped one", async () => {
    const sig = await deriveTrapSignature([REPORT_SCOPE_CORRECT], [
      REPORT_SCOPE_NAIVE,
    ]);
    assertEquals(sig.sites.length, 1);
    assertEquals(sig.sites[0]?.procedureName, "requestpage.Apply");
    assertEquals(sig.sites[0]?.correctForm, "message('inner-correct')");
    assertEquals(sig.sites[0]?.naiveForm, "message('inner-naive')");
  });
});
