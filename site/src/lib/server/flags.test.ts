import { describe, expect, it } from "vitest";
import { type Flags, loadFlags } from "./flags";

describe("loadFlags", () => {
  const baseEnv = {} as Record<string, string | undefined>;

  it("returns defaults (all off) when no env overrides", () => {
    const flags = loadFlags(baseEnv as never, false);
    expect(flags.cmd_k_palette).toBe(false);
    expect(flags.sse_live_updates).toBe(false);
    expect(flags.og_dynamic).toBe(false);
    expect(flags.trajectory_charts).toBe(false);
    expect(flags.print_stylesheet).toBe(false);
  });

  it("FLAG_CMD_K_PALETTE=on flips that flag", () => {
    const flags = loadFlags({ FLAG_CMD_K_PALETTE: "on" } as never, false);
    expect(flags.cmd_k_palette).toBe(true);
    expect(flags.sse_live_updates).toBe(false);
  });

  it("canary mode flips all flags on regardless of env", () => {
    const flags = loadFlags(baseEnv as never, true);
    expect(flags.cmd_k_palette).toBe(true);
    expect(flags.sse_live_updates).toBe(true);
    expect(flags.og_dynamic).toBe(true);
    expect(flags.trajectory_charts).toBe(true);
    expect(flags.print_stylesheet).toBe(true);
  });

  it("FLAG_*=off explicitly disables (overrides any default)", () => {
    const flags = loadFlags(
      { FLAG_PRINT_STYLESHEET: "off" } as never,
      false,
    );
    expect(flags.print_stylesheet).toBe(false);
  });

  it("density_toggle defaults to false and respects FLAG_DENSITY_TOGGLE", () => {
    expect(loadFlags({}, false).density_toggle).toBe(false);
    expect(loadFlags({ FLAG_DENSITY_TOGGLE: "on" }, false).density_toggle).toBe(
      true,
    );
  });

  it("rum_beacon defaults to false and respects FLAG_RUM_BEACON", () => {
    expect(loadFlags({}, false).rum_beacon).toBe(false);
    expect(loadFlags({ FLAG_RUM_BEACON: "on" }, false).rum_beacon).toBe(true);
  });

  it("canary mode flips both new flags on", () => {
    const f = loadFlags({}, true);
    expect(f.density_toggle).toBe(true);
    expect(f.rum_beacon).toBe(true);
  });
});
