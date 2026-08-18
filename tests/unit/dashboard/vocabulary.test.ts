import { describe, it } from "@std/testing/bdd";
import { assertStringIncludes } from "@std/assert";

const UI = new URL("../../../src/dashboard/ui/app.js", import.meta.url);

describe("dashboard/vocabulary", () => {
  it("uses the agreed labels verbatim", async () => {
    const src = await Deno.readTextFile(UI);
    for (
      const label of [
        "Made the mistake",
        "Avoided the mistake",
        "Different approach",
        "Couldn't compare yet",
        "Wrote extra object",
        "not written",
        "Never published to the scoreboard",
      ]
    ) {
      assertStringIncludes(src, label);
    }
  });

  it("does not use the labels the review rejected", async () => {
    const src = await Deno.readTextFile(UI);
    for (const rejected of ["Looks right", "differs", "matches", "trap-side"]) {
      if (src.includes(rejected)) {
        throw new Error(`rejected label present in UI: ${rejected}`);
      }
    }
  });

  it("omits escalation-gated states, which have no data source in plan 1", async () => {
    const src = await Deno.readTextFile(UI);
    for (
      const gated of [
        "Passed first try",
        "Passed on 2nd try",
        "Failed both tries",
      ]
    ) {
      if (src.includes(gated)) {
        throw new Error(`escalation-gated state built too early: ${gated}`);
      }
    }
  });
});
