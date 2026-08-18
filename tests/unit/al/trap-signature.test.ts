import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists, assertNotEquals } from "@std/assert";

import { Language, Parser } from "web-tree-sitter";

import {
  classifyAgainstSignature,
  deriveTrapSignature,
} from "../../../src/al/trap-signature.ts";

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

// A page field named "A" exists TWICE with the exact same DISPLAY name --
// once directly in `layout`, once inside `requestpage`'s own nested layout.
// rawPathNamed (what `procedureName` is built from) only carries NAMED
// boundaries, so both collapse to "A.OnValidate": the keyword-only `layout`,
// `area`, and `requestpage` segments that make each member's INTERNAL
// (scope-qualified) key distinct are exactly the segments the display name
// drops. Classifying by re-deriving `.name === procedureName` picks
// whichever member a `Map` happens to iterate to first (source order: the
// plain `layout` field, inserted before the `requestpage` one) regardless of
// which member a given TrapSite actually names. The trap lives ONLY in the
// requestpage-scoped field (the second one inserted) -- the layout field is
// byte-identical on both sides and contributes no site at all -- so a
// display-name match silently substitutes the wrong (never-diverging)
// member's statements for the one actually being classified.
const SCOPE_COLLISION_CORRECT = `page 71441 "CG Scope Probe"
{
    layout
    {
        area(Content)
        {
            field(A; Rec.A)
            {
                trigger OnValidate()
                begin
                    Message('content-a');
                end;
            }
        }
    }
    requestpage
    {
        layout
        {
            area(Content)
            {
                field(A; Rec.A)
                {
                    trigger OnValidate()
                    begin
                        Message('requestpage-correct');
                    end;
                }
            }
        }
    }
}`;

const SCOPE_COLLISION_NAIVE = `page 71441 "CG Scope Probe"
{
    layout
    {
        area(Content)
        {
            field(A; Rec.A)
            {
                trigger OnValidate()
                begin
                    Message('content-a');
                end;
            }
        }
    }
    requestpage
    {
        layout
        {
            area(Content)
            {
                field(A; Rec.A)
                {
                    trigger OnValidate()
                    begin
                        Message('requestpage-naive');
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

  // `no-divergence` means "compared, found nothing different — the author's
  // naive/ needs work", which is a confident WRONG instruction when the two
  // sides plainly differ but not at statement level. "Forgot the OnValidate
  // trigger entirely" and "forgot the helper codeunit" are ordinary trap
  // shapes, so these are reachable authoring states, not constructed edges.
  const OUTSIDE_BASE = `codeunit 71411 "Shared"
{
    procedure Alpha()
    begin
        Rec.Validate(Qty, 1);
    end;

    procedure Beta()
    begin
        Rec.Validate(Amt, 2);
    end;
}`;

  it("distinguishes a member present on only one side from no divergence", async () => {
    const naiveMissingBeta = `codeunit 71411 "Shared"
{
    procedure Alpha()
    begin
        Rec.Validate(Qty, 1);
    end;
}`;
    const sig = await deriveTrapSignature([OUTSIDE_BASE], [naiveMissingBeta]);
    assertEquals(sig.sites.length, 0);
    assertEquals(sig.emptyReason, "divergence-outside-statements");
  });

  it("reports divergence-outside-statements when naive adds a member", async () => {
    const naiveExtra = `${OUTSIDE_BASE.slice(0, -1)}
    procedure Gamma()
    begin
        Rec.Validate(Disc, 3);
    end;
}`;
    const sig = await deriveTrapSignature([OUTSIDE_BASE], [naiveExtra]);
    assertEquals(sig.sites.length, 0);
    assertEquals(sig.emptyReason, "divergence-outside-statements");
  });

  it("reports divergence-outside-statements when an object exists on one side only", async () => {
    const extraObject = `codeunit 71412 "Helper"
{
    procedure Helped()
    begin
        Rec.Validate(Qty, 9);
    end;
}`;
    const sig = await deriveTrapSignature(
      [OUTSIDE_BASE, extraObject],
      [OUTSIDE_BASE],
    );
    assertEquals(sig.sites.length, 0);
    assertEquals(sig.emptyReason, "divergence-outside-statements");
  });

  // The discriminating control: identical sides must still say no-divergence,
  // or the new reason would just be a rename of the old one.
  it("still reports no-divergence when the two sides line up exactly", async () => {
    const sig = await deriveTrapSignature([OUTSIDE_BASE], [OUTSIDE_BASE]);
    assertEquals(sig.sites.length, 0);
    assertEquals(sig.emptyReason, "no-divergence");
  });

  // A real statement-level divergence outranks both: an unmatched member
  // elsewhere must not suppress the sites that ARE the trap.
  it("still returns sites when a statement diverges and a member is unmatched", async () => {
    const naive = `codeunit 71411 "Shared"
{
    procedure Alpha()
    begin
        Rec.Qty := 1;
    end;
}`;
    const sig = await deriveTrapSignature([OUTSIDE_BASE], [naive]);
    assertEquals(sig.sites.length > 0, true);
    assertEquals(sig.emptyReason, undefined);
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

  it("gives the site a distinct scope-qualified memberKey even when procedureName collides", async () => {
    // SCOPE_COLLISION's two "A.OnValidate" members are only distinguished by
    // the keyword-only scope segments (layout/area/requestpage) that
    // procedureName drops. memberKey must carry those segments so the two
    // members never look like the same site to a consumer.
    const sig = await deriveTrapSignature([SCOPE_COLLISION_CORRECT], [
      SCOPE_COLLISION_NAIVE,
    ]);
    assertEquals(sig.sites.length, 1);
    assertEquals(sig.sites[0]?.procedureName, "A.OnValidate");
    assertEquals(
      sig.sites[0]?.memberKey,
      "requestpage.layout.area.a.onvalidate",
    );
  });
});

const AL_WASM_URL = new URL(
  "../../../vendor/tree-sitter-al/tree-sitter-al.wasm",
  import.meta.url,
);

// Every node type in this grammar that exists solely to wrap a container's
// children — as opposed to being a genuine named/keyword scope like
// `field_declaration` or `requestpage_section` — ends in `_body`
// (`declaration_body`, `fields_body`, `layout_body`, ...). That is the
// invariant `scopeLabel`'s derived scope-boundary rule in
// src/al/trap-signature.ts depends on: every non-member node that is NOT a
// `_body` wrapper is treated as a scope boundary, so the rule's correctness
// rests entirely on this set being exhaustive.
//
// This is not a hypothetical: vendor/tree-sitter-al was bumped 2.5.1 -> 4.0.1
// in 77fbc7b1, and every defect this task went through fix rounds for was a
// silent member collision a test did not catch. Pinning the exact set here
// means a future grammar bump that adds, removes, or renames a wrapper type
// fails LOUDLY, here, instead of silently changing which containers get
// scope-labeled.
//
// Reading a failure after a grammar bump:
//   - A NEW type in the actual set, not in this list: a wrapper node type
//     was added. Confirm it is a pure wrapper (its children are the
//     container's own declarations; it carries no name or identity of its
//     own), then add it below.
//   - An entry in this list MISSING from the actual set: a container was
//     renamed (or removed). The renamed type no longer ends in `_body`, so
//     `scopeLabel` will now treat it as a scope boundary — investigate
//     whether that is correct (usually it means the type's replacement is a
//     new wrapper, which loops back to the case above) before editing this
//     list to match.
const KNOWN_BODY_NODE_TYPES: readonly string[] = [
  "_preproc_branch_body",
  "_routine_regular_body",
  "action_body",
  "action_group_body",
  "analysisviews_body",
  "assembly_body",
  "case_body",
  "controladdin_body",
  "dataset_body",
  "dataset_mod_body",
  "declaration_body",
  "dotnet_body",
  "elements_body",
  "fieldgroups_body",
  "fields_body",
  "interface_body",
  "keys_body",
  "labels_body",
  "layout_body",
  "layout_container_body",
  "preproc_split_complete_body",
  "preproc_split_procedure_body",
  "query_body",
  "rendering_body",
  "report_body",
  "schema_body",
  "var_body",
  "views_body",
  "views_mod_body",
  "xmlport_body",
].sort();

describe("al/trap-signature: classification", () => {
  it("returns cannot-compare for an empty signature", async () => {
    const c = await classifyAgainstSignature({ sites: [] }, CORRECT);
    assertEquals(c.verdict, "cannot-compare");
  });

  it("says avoided-the-mistake when every site takes the correct form", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    const c = await classifyAgainstSignature(sig, CORRECT);
    assertEquals(c.verdict, "avoided-the-mistake");
  });

  it("says made-the-mistake when any site takes the naive form", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    const c = await classifyAgainstSignature(sig, NAIVE);
    assertEquals(c.verdict, "made-the-mistake");
    assertEquals(c.decidingSite?.procedureName.toLowerCase(), "setterms");
  });

  it("is unaffected by reformatting and comments", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    const reformatted = NAIVE
      .replace(/\n/g, "\n   ")
      .replace("begin", "begin // reformatted");
    assertEquals(
      (await classifyAgainstSignature(sig, reformatted)).verdict,
      "made-the-mistake",
    );
  });

  it("says different-approach when neither form appears", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    const other = CORRECT.replace(
      "Quote.Validate(Qty, Qty);",
      "Quote.SetQuantity(Qty);",
    );
    assertEquals(
      (await classifyAgainstSignature(sig, other)).verdict,
      "different-approach",
    );
  });

  it("says different-approach when the procedure is absent", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    const empty = 'codeunit 71410 "CG X054 Agent"\n{\n}';
    assertEquals(
      (await classifyAgainstSignature(sig, empty)).verdict,
      "different-approach",
    );
  });

  it("says different-approach for prose", async () => {
    const sig = await deriveTrapSignature([CORRECT], [NAIVE]);
    assertEquals(
      (await classifyAgainstSignature(sig, "I cannot help.")).verdict,
      "different-approach",
    );
  });

  it("matches a site to the exact member it names, not just any member sharing its display name", async () => {
    // See SCOPE_COLLISION's own comment: the layout field and the
    // requestpage field share the display name "A.OnValidate", but only the
    // requestpage one actually diverges. A response that reproduces the
    // naive requestpage body must be scored made-the-mistake -- a matcher
    // that instead picks the (identical-on-both-sides, always-satisfied)
    // layout field by display name would report different-approach here
    // instead, silently comparing against the wrong member.
    const sig = await deriveTrapSignature([SCOPE_COLLISION_CORRECT], [
      SCOPE_COLLISION_NAIVE,
    ]);
    assertEquals(sig.sites.length, 1);
    const c = await classifyAgainstSignature(sig, SCOPE_COLLISION_NAIVE);
    assertEquals(c.verdict, "made-the-mistake");
  });
});

describe("al/trap-signature: grammar invariant", () => {
  it("pins the exact set of _body wrapper node types the derived scope-boundary rule relies on", async () => {
    await Parser.init();
    const language = await Language.load(await Deno.readFile(AL_WASM_URL));

    const bodyTypes = new Set<string>();
    for (let id = 0; id < language.nodeTypeCount; id++) {
      const type = language.nodeTypeForId(id);
      if (type && type.endsWith("_body")) bodyTypes.add(type);
    }

    assertEquals([...bodyTypes].sort(), KNOWN_BODY_NODE_TYPES);
  });
});
