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
        "Made up this field",
        "Unknown member",
        "Couldn't check the prereq",
        "Nothing from prereq/ referenced",
        // Task 8: spec §6's escalation states, now that Plan 2 wires a real
        // data source (`VerifyOutcome`, Task 1) behind them.
        "Passed first try",
        "Passed on 2nd try",
        "Failed both tries",
        "Didn't compile",
        "Compile & test",
        // Not in spec §6's table — the spec did not anticipate these
        // states. Pinned here so the wording chosen for them (Task 8's
        // brief) cannot silently drift between call sites.
        //
        // `publish_defect`: a candidate that published or installed badly
        // and ran ZERO tests. Never worded as a test result.
        "Didn't publish",
        // `errored`: a genuine infrastructure failure with a real message.
        // Never worded as a test result.
        "Verification error",
        // `running`: the phase is frozen at "staging" for the whole verify
        // call, so the literal phase word is never surfaced — this is
        // deliberately generic.
        "In progress",
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
});
