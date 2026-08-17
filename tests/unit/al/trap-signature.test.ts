import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertNotEquals } from "@std/assert";

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
    assertEquals(
      perturbedSig.sites.some((s) => s.naiveForm?.includes(":=")),
      true,
    );
  });
});
