/**
 * H-41 (design-final 6, 12): an in-process judging pool over fakes: the
 * allocation, Docker's running flag, foreign records, env_fp admission, the
 * campaign pin and the in-use records are plain mutable state. `events`
 * records every claim, setup, pin, release, dispose and register in order.
 */

import type { HarnessBc } from "../../../src/harness/bc-lane.ts";
import type { HarnessEnv } from "../../../src/harness/execution.ts";
import { ConfigurationError } from "../../../src/errors.ts";
import { ensurePin, pinPath } from "../../../src/harness/execution.ts";
import {
  JudgePool,
  type PoolBounds,
  type PoolDeps,
} from "../../../src/harness/pool.ts";

export const FP = "a".repeat(64);
export const OTHER_FP = "b".repeat(64);

export interface PoolWorld {
  alloc: string[];
  running: Set<string>;
  /** env_fp per container (default FP), or why it is not admissible. */
  fp: Map<string, string>;
  inadmissible: Map<string, string>;
  foreign: Map<string, string>;
  blocked: Map<string, string>;
  /** The fake campaign pin (unused when the pool pins through a real env). */
  pin: string | null;
  /** In-use records this pool holds: container -> id. */
  records: Map<string, string>;
  /** Records the pool kept (container -> why). */
  kept: Map<string, string>;
  registered: string[];
  events: string[];
  /** The setup of a joining container (default: the lane's bc at once). */
  setup: (c: string) => Promise<{ bc: HarnessBc; dispose(): Promise<void> }>;
  /** Seams: a test replaces any check. */
  allocated: () => Promise<string[]>;
  isRunning: (c: string) => Promise<boolean>;
  claimHook: (c: string) => void;
}

export function poolWorld(
  bc: HarnessBc,
  o: {
    alloc?: string[];
    bounds?: Partial<PoolBounds>;
    /** Pin through the real env pin (env-pins/<campaign>.json). */
    env?: HarnessEnv;
    maxInfraRetries?: number;
  } = {},
): { w: PoolWorld; pool: JudgePool; deps: PoolDeps } {
  const w: PoolWorld = {
    alloc: o.alloc ?? ["C1"],
    running: new Set(["C1", "C2", "C3", "C4", "J1", "J2"]),
    fp: new Map(),
    inadmissible: new Map(),
    foreign: new Map(),
    blocked: new Map(),
    pin: null,
    records: new Map(),
    kept: new Map(),
    registered: [],
    events: [],
    setup: (c) =>
      Promise.resolve({
        bc,
        dispose: () => {
          w.events.push(`dispose:${c}`);
          return Promise.resolve();
        },
      }),
    allocated: () => Promise.resolve([...w.alloc]),
    isRunning: (c) => Promise.resolve(w.running.has(c)),
    claimHook: () => {},
  };
  const env = o.env;
  const deps: PoolDeps = {
    allocated: () => w.allocated(),
    excluded: (c) => c === "Cronus28" ? "refused (codeunit 80013)" : null,
    blocked: (c) => w.blocked.get(c) ?? null,
    running: (c) => w.isRunning(c),
    foreign: (c) => Promise.resolve(w.foreign.get(c) ?? null),
    admissible: (c) =>
      Promise.resolve(
        w.inadmissible.has(c)
          ? { why: w.inadmissible.get(c)! }
          : { env_fp: w.fp.get(c) ?? FP },
      ),
    pinned: async (campaign) => {
      if (!env) return w.pin;
      try {
        return JSON.parse(
          await Deno.readTextFile(pinPath(env.resultsRoot, campaign)),
        ).env_fp;
      } catch {
        return null;
      }
    },
    ensurePin: async (campaign, fp) => {
      w.events.push("pin");
      if (env) return await ensurePin(env, campaign, fp);
      if (w.pin !== null && w.pin !== fp) {
        throw new ConfigurationError(`pinned to ${w.pin}, not ${fp}`);
      }
      w.pin = fp;
    },
    claim: (c) => {
      w.events.push(`claim:${c}`);
      w.claimHook(c);
      if (w.records.has(c)) return Promise.resolve({ why: `${c} in use` });
      w.records.set(c, `id-${c}`);
      return Promise.resolve({ id: `id-${c}` });
    },
    release: (c) => {
      w.events.push(`release:${c}`);
      w.records.delete(c);
      return Promise.resolve();
    },
    keep: (c, why) => void w.kept.set(c, why),
    containerId: (c) => Promise.resolve(`id-${c}`),
    join: (c) => {
      w.events.push(`setup:${c}`);
      return w.setup(c);
    },
    register: (c) => {
      w.events.push(`register:${c}`);
      w.registered.push(c);
    },
  };
  const pool = new JudgePool({
    bc,
    deps,
    bounds: {
      stepMs: 500,
      setupMs: 2_000,
      closeMs: 1_000,
      pollMs: 25,
      waitMs: 60_000,
      ...o.bounds,
    },
    ...(o.maxInfraRetries !== undefined
      ? { lane: { maxInfraRetries: o.maxInfraRetries } }
      : {}),
  });
  return { w, pool, deps };
}

/** Resolves once `cond` holds (polled), or throws after `ms`. */
export async function until(
  cond: () => boolean,
  ms = 5_000,
  what = "condition",
): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
