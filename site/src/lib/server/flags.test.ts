import { describe, it, expect } from 'vitest';
import { loadFlags, type Flags } from './flags';

describe('loadFlags', () => {
  const baseEnv = {} as Record<string, string | undefined>;

  it('returns defaults (all off) when no env overrides', () => {
    const flags = loadFlags(baseEnv as never, false);
    expect(flags.cmd_k_palette).toBe(false);
    expect(flags.sse_live_updates).toBe(false);
    expect(flags.og_dynamic).toBe(false);
    expect(flags.trajectory_charts).toBe(false);
    expect(flags.print_stylesheet).toBe(false);
  });

  it('FLAG_CMD_K_PALETTE=on flips that flag', () => {
    const flags = loadFlags({ FLAG_CMD_K_PALETTE: 'on' } as never, false);
    expect(flags.cmd_k_palette).toBe(true);
    expect(flags.sse_live_updates).toBe(false);
  });

  it('canary mode flips all flags on regardless of env', () => {
    const flags = loadFlags(baseEnv as never, true);
    expect(flags.cmd_k_palette).toBe(true);
    expect(flags.sse_live_updates).toBe(true);
    expect(flags.og_dynamic).toBe(true);
    expect(flags.trajectory_charts).toBe(true);
    expect(flags.print_stylesheet).toBe(true);
  });

  it('FLAG_*=off explicitly disables (overrides any default)', () => {
    const flags = loadFlags(
      { FLAG_PRINT_STYLESHEET: 'off' } as never,
      false,
    );
    expect(flags.print_stylesheet).toBe(false);
  });
});
