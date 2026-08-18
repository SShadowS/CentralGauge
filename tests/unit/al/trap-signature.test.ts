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

// Two fields with same-named OnValidate triggers; only the FIRST field's
// body diverges. A bare-name key collides last-write-wins — field(2; B) is
// what survives the collision — so if the divergence lived only in field(1;
// A) (the one the collision drops), a bare-key implementation would report
// no divergence at all. Diverging the survivor instead would pass under
// both the fixed and the broken implementation, proving nothing.
const FIELD_COLLISION_CORRECT = `table 71422 "CG Field Collision"
{
    fields
    {
        field(1; A; Integer)
        {
            trigger OnValidate()
            begin
                Message('a-correct');
            end;
        }
        field(2; B; Integer)
        {
            trigger OnValidate()
            begin
                Message('b-shared');
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
                Message('a-naive');
            end;
        }
        field(2; B; Integer)
        {
            trigger OnValidate()
            begin
                Message('b-shared');
            end;
        }
    }
}`;

// A report-level `procedure Apply()` alongside a requestpage-scoped
// `procedure Apply()` of the same name; only the OUTER (report-level, first
// in source order) one diverges — the one a last-write-wins collision drops
// in favor of the requestpage-scoped survivor. Same reasoning as above.
const REPORT_SCOPE_CORRECT = `report 71423 "CG Report Scope"
{
    procedure Apply()
    begin
        Message('outer-correct');
    end;

    requestpage
    {
        procedure Apply()
        begin
            Message('inner-shared');
        end;
    }
}`;

const REPORT_SCOPE_NAIVE = `report 71423 "CG Report Scope"
{
    procedure Apply()
    begin
        Message('outer-naive');
    end;

    requestpage
    {
        procedure Apply()
        begin
            Message('inner-shared');
        end;
    }
}`;

// A page with two fields under one group, each with its own OnValidate;
// only the FIRST field diverges. page_field carried no scope segment before
// MUST-FIX A, so both fields' triggers collapsed onto one key exactly like
// the table case above — this is the page-specific instance of that same
// regression, and it independently catches a scopeLabel gate that stops
// recognizing page_field even if the table-field fixture above still passes.
const PAGE_FIELD_COLLISION_CORRECT = `page 71440 "CG Page Field Collision"
{
    layout
    {
        area(Content)
        {
            group(General)
            {
                field(A; Rec.A)
                {
                    trigger OnValidate()
                    begin
                        Message('a-correct');
                    end;
                }
                field(B; Rec.B)
                {
                    trigger OnValidate()
                    begin
                        Message('b-shared');
                    end;
                }
            }
        }
    }
}`;

const PAGE_FIELD_COLLISION_NAIVE = `page 71440 "CG Page Field Collision"
{
    layout
    {
        area(Content)
        {
            group(General)
            {
                field(A; Rec.A)
                {
                    trigger OnValidate()
                    begin
                        Message('a-naive');
                    end;
                }
                field(B; Rec.B)
                {
                    trigger OnValidate()
                    begin
                        Message('b-shared');
                    end;
                }
            }
        }
    }
}`;

// Different id AND name on each side, so no objectKey can line up.
const NO_MATCH_OBJECTS_CORRECT = `codeunit 71424 "CG No Match A"
{
    procedure Foo()
    begin
        A();
    end;
}`;

const NO_MATCH_OBJECTS_NAIVE = `codeunit 71425 "CG No Match B"
{
    procedure Foo()
    begin
        A();
    end;
}`;

// Same object on both sides (matches by objectKey), but no procedure name
// is shared between them.
const NO_MATCH_PROCS_CORRECT = `codeunit 71426 "CG No Match Procs"
{
    procedure Alpha()
    begin
        A();
    end;
}`;

const NO_MATCH_PROCS_NAIVE = `codeunit 71426 "CG No Match Procs"
{
    procedure Beta()
    begin
        B();
    end;
}`;

describe("al/trap-signature", () => {
  it("locates the diverging statements", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    assertEquals(sig.sites.length > 0, true);
    assertEquals(sig.sites[0]?.procedureName.toLowerCase(), "setterms");
    assertEquals(sig.emptyReason, undefined);
  });

  it("records both forms at a site", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    const joinedNaive = sig.sites.map((s) => s.naiveForm ?? "").join(" ");
    assertEquals(joinedNaive.includes(":="), true);
  });

  it("yields no sites when correct and naive are identical, reason no-divergence", async () => {
    const sig = await deriveTrapSignature([CORRECT], [CORRECT]);
    assertEquals(sig.sites.length, 0);
    assertEquals(sig.emptyReason, "no-divergence");
  });

  it("yields no sites when naive is missing entirely, reason no-naive-objects", async () => {
    const sig = await deriveTrapSignature([CORRECT], []);
    assertEquals(sig.sites.length, 0);
    assertEquals(sig.emptyReason, "no-naive-objects");
  });

  it("yields no sites when correct is missing entirely, reason no-correct-objects", async () => {
    const sig = await deriveTrapSignature([], [CORRECT]);
    assertEquals(sig.sites.length, 0);
    assertEquals(sig.emptyReason, "no-correct-objects");
  });

  it("prioritizes no-correct-objects when both sides are missing", async () => {
    // no-correct-objects and no-naive-objects only differ in outcome when
    // BOTH sides are empty — either individually-missing test above would
    // still pass if the two priority checks were swapped. This is the one
    // case that pins the documented priority order (correct checked first).
    const sig = await deriveTrapSignature([], []);
    assertEquals(sig.sites.length, 0);
    assertEquals(sig.emptyReason, "no-correct-objects");
  });

  it("yields no sites when no object lines up, reason no-matching-objects", async () => {
    const sig = await deriveTrapSignature([NO_MATCH_OBJECTS_CORRECT], [
      NO_MATCH_OBJECTS_NAIVE,
    ]);
    assertEquals(sig.sites.length, 0);
    assertEquals(sig.emptyReason, "no-matching-objects");
  });

  it("yields no sites when the matched object shares no procedure, reason no-matching-procedures", async () => {
    const sig = await deriveTrapSignature([NO_MATCH_PROCS_CORRECT], [
      NO_MATCH_PROCS_NAIVE,
    ]);
    assertEquals(sig.sites.length, 0);
    assertEquals(sig.emptyReason, "no-matching-procedures");
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
    // The divergence is in field(1; A) — the one a last-write-wins bare-key
    // collision drops in favor of field(2; B), which stays identical on
    // both sides. A gutted bare-key implementation reports 0 sites here.
    const sig = await deriveTrapSignature([FIELD_COLLISION_CORRECT], [
      FIELD_COLLISION_NAIVE,
    ]);
    assertEquals(sig.sites.length, 1);
    assertEquals(sig.sites[0]?.procedureName, "A.OnValidate");
    assertEquals(sig.sites[0]?.correctForm, "message('a-correct')");
    assertEquals(sig.sites[0]?.naiveForm, "message('a-naive')");
  });

  it("keeps a report-level procedure distinct from a same-named requestpage-scoped one", async () => {
    // The divergence is in the OUTER (report-level) Apply — the one a
    // last-write-wins bare-key collision drops in favor of the
    // requestpage-scoped Apply, which stays identical on both sides.
    const sig = await deriveTrapSignature([REPORT_SCOPE_CORRECT], [
      REPORT_SCOPE_NAIVE,
    ]);
    assertEquals(sig.sites.length, 1);
    assertEquals(sig.sites[0]?.procedureName, "Apply");
    assertEquals(sig.sites[0]?.correctForm, "message('outer-correct')");
    assertEquals(sig.sites[0]?.naiveForm, "message('outer-naive')");
  });

  it("keeps same-named page field triggers distinct instead of colliding", async () => {
    // page_field carried no scope segment before the derived-boundary rule
    // (MUST-FIX A); this independently regression-guards that specific
    // container kind, the same way the table-field test above guards
    // field_declaration. Divergence is in the FIRST field for the same
    // last-write-wins reason.
    const sig = await deriveTrapSignature([PAGE_FIELD_COLLISION_CORRECT], [
      PAGE_FIELD_COLLISION_NAIVE,
    ]);
    assertEquals(sig.sites.length, 1);
    assertEquals(sig.sites[0]?.procedureName, "General.A.OnValidate");
    assertEquals(sig.sites[0]?.correctForm, "message('a-correct')");
    assertEquals(sig.sites[0]?.naiveForm, "message('a-naive')");
  });
});
