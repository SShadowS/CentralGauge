import { describe, expect, it } from "vitest";
import { upstreamChip } from "./upstream-chip";

describe("upstreamChip", () => {
  it("hides the chip when nothing was ever recorded and there is no pin", () => {
    expect(upstreamChip({ pin: null, served: [], verification: {} })).toBeNull();
    expect(
      upstreamChip({
        pin: null,
        served: [],
        verification: { not_applicable: 400 },
      }),
    ).toBeNull();
  });

  it("green for a pin whose rows are all verified", () => {
    const c = upstreamChip({
      pin: "novita/fp8",
      served: ["Novita"],
      verification: { verified: 400 },
    })!;
    expect(c.tone).toBe("verified");
    expect(c.label).toBe("novita/fp8");
  });

  it("neutral for unpinned rows, naming the served set", () => {
    const c = upstreamChip({
      pin: null,
      served: ["Google"],
      verification: { unpinned: 400 },
    })!;
    expect(c.tone).toBe("unpinned");
    expect(c.label).toBe("unpinned · Google");
  });

  it("red mixed when more than one upstream served", () => {
    const c = upstreamChip({
      pin: null,
      served: ["Google", "Vertex"],
      verification: { unpinned: 400 },
    })!;
    expect(c.tone).toBe("mixed");
    expect(c.label).toBe("mixed · Google, Vertex");
  });

  it("amber when any row is unverified, not_served or mismatch", () => {
    for (const k of ["unverified", "not_served", "mismatch"] as const) {
      const c = upstreamChip({
        pin: "p",
        served: ["P"],
        verification: { verified: 10, [k]: 1 },
      })!;
      expect(c.tone, k).toBe("warn");
    }
  });

  it("amber, not green, for a pin whose cohort mixes in unpinned rows", () => {
    const c = upstreamChip({
      pin: "novita/fp8",
      served: ["Novita"],
      verification: { verified: 300, unpinned: 296 },
    })!;
    expect(c.tone).toBe("warn");
    expect(c.label).toBe("novita/fp8");
    expect(c.title).toContain("300 of 596");
    expect(c.title).toContain("unpinned or unrecorded");
  });

  it("names no pin in the warn title when the cohort has none", () => {
    const c = upstreamChip({
      pin: null,
      served: ["Novita"],
      verification: { unverified: 4, unpinned: 10 },
    })!;
    expect(c.tone).toBe("warn");
    expect(c.title).not.toContain("the pin");
    expect(c.title).toContain("4 of 14");
  });

  it("grey unrecorded when every row predates capture", () => {
    const c = upstreamChip({
      pin: null,
      served: [],
      verification: { unrecorded: 400 },
    })!;
    expect(c.tone).toBe("unrecorded");
    expect(c.label).toBe("upstream unrecorded");
  });
});
