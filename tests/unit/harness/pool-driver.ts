/**
 * H-41 (design-final 12): one subprocess of the cross-process judging tests,
 * started by pool-subprocess.test.ts as `deno run --allow-all pool-driver.ts
 * <file holding the DriverArgs json>`. It opens a real environment (openHarnessEnv, its real
 * bench and private-root locks) over its own repoRoot and private dir, on the
 * results dir, quarantine dir and coord root it shares with the other child,
 * with a FakeBc in place of every container. Named pause points stop it until
 * the parent releases them (barrier files); a frozen claim heartbeat lets
 * its claims go stale. The last stdout line is `RESULT <json DriverResult>`.
 */

import { join } from "@std/path";
import {
  harnessJudgePending,
  harnessRejudge,
} from "../../../cli/commands/harness-command.ts";
import {
  type EnvDeps,
  type EnvOptions,
  openHarnessEnv,
} from "../../../cli/commands/harness-env.ts";
import type { BcLane } from "../../../src/harness/bc-lane.ts";
import type {
  ComputedJudgment,
  HarnessEnv,
} from "../../../src/harness/execution.ts";
import { ContainerError } from "../../../src/errors.ts";
import {
  fenceHead,
  judgeOnce,
  recoverFences,
} from "../../../src/harness/execution.ts";
import { exists } from "../../../src/harness/fsutil.ts";
import { acquireBenchLock } from "../../../src/utils/bench-lock.ts";
import { FakeBc, OK_RESET } from "./fake-bc.ts";
import { FakeDocker } from "./fake-docker.ts";
import { noOnPrem } from "./onprem-fixture.ts";
import { poolWorld } from "./pool-fixture.ts";
import { verdictBc } from "./runtime-fixture.ts";

/** Every child's claims go stale this long after their last heartbeat. */
export const STALE_MS = 2_000;

export type Scenario = "rejudge" | "judge-pending" | "open" | "pin";

/**
 * Pause points: `opened` (the environment is open, before any judging),
 * `asked` (rejudge's due list is computed, before any claim), `listed` (the
 * first judgments read of `listed`), `committing` (`pin`: admitted, before
 * its commit), and the commit protocol's hooks
 * `beforeLink:fence`, `beforeLink:pin`, `beforeLink:log` and `afterFence`.
 * Each fires at most once.
 */
export interface DriverArgs {
  name: string;
  scenario: Scenario;
  barriers: string;
  pauses: string[];
  repoRoot: string;
  resultsDir: string;
  privateRoot: string;
  secretsSource: string;
  symbolStore: string;
  quarantineDir: string;
  coordRoot: string;
  containers: string[];
  /** The claim heartbeat never ticks (a suspended holder). */
  frozen?: boolean;
  /** Every exclusive lane call waits this long first (judgings overlap). */
  slowMs?: number;
  /** Every harness test run is an infra fault (the judgment is unscored). */
  unscored?: boolean;
  /** `open`: recoverFences once more after `opened`; its count is reported. */
  recover?: boolean;
  /** The execution whose first judgments read pauses at `listed`. */
  listed?: string;
  /** `pin`: the campaign, execution, computed judgment file, lineage and env_fp. */
  campaign?: string;
  execution?: string;
  computed?: string;
  lineage?: string;
  envFp?: string;
}

export interface DriverResult {
  name: string;
  pid: number;
  ok: boolean;
  error?: string;
  /** Lane calls (compile, compileOn, exclusive) plus `pin` computes: 0 = no compute. */
  computes: number;
  rejudged?: number;
  judged?: number;
  recovered?: number;
  members?: string[];
  committed?: boolean;
  /** `pin`: why judgeOnce dropped W (no throw). */
  dropped?: string;
}

/** A barrier file of `name` at pause point `point` (`.at` arrived, `.go` released). */
export const barrierFile = (
  dir: string,
  name: string,
  point: string,
  kind: "at" | "go",
) => join(dir, `${name}.${point.replace(":", "-")}.${kind}`);

const PAUSE_LIMIT_MS = 120_000;

/** A fake Docker container id, one per (case-insensitive) name. */
const fakeId = (c: string) =>
  [...new TextEncoder().encode(c.toLowerCase())]
    .map((b) => b.toString(16).padStart(2, "0")).join("").padEnd(64, "0")
    .slice(0, 64);

const msg = (err: unknown) => err instanceof Error ? err.message : String(err);

async function main(a: DriverArgs): Promise<DriverResult> {
  const fired = new Set<string>();
  const arrive = (point: string) => {
    if (!a.pauses.includes(point) || fired.has(point)) return false;
    fired.add(point);
    Deno.writeTextFileSync(barrierFile(a.barriers, a.name, point, "at"), "");
    return true;
  };
  const pause = async (point: string) => {
    if (!arrive(point)) return;
    const end = Date.now() + PAUSE_LIMIT_MS;
    while (!await exists(barrierFile(a.barriers, a.name, point, "go"))) {
      if (Date.now() > end) throw new Error(`never released at ${point}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  // rejudge's confirmation is synchronous: so is its pause.
  const pauseSync = (point: string) => {
    if (!arrive(point)) return;
    const end = Date.now() + PAUSE_LIMIT_MS;
    const cell = new Int32Array(new SharedArrayBuffer(4));
    for (;;) {
      try {
        Deno.statSync(barrierFile(a.barriers, a.name, point, "go"));
        return;
      } catch {
        if (Date.now() > end) throw new Error(`never released at ${point}`);
        Atomics.wait(cell, 0, 0, 20);
      }
    }
  };

  const bc = verdictBc();
  if (a.unscored) {
    bc.runHarnessTests = (c) =>
      Promise.reject(
        new ContainerError(`SOAP test run on ${c} timed out`, c, "test"),
      );
  }
  const deps: EnvDeps = {
    allocated: (c) => Promise.resolve(c),
    // Both locks are the real ones: this child's repoRoot and private dir.
    acquireLock: (dir, o) => acquireBenchLock(dir, o),
    docker: () => new FakeDocker(),
    setup: (names) =>
      Promise.resolve({ bc, names, dispose: () => Promise.resolve() }),
    inspect: () => new FakeBc(),
    quarantineDir: () => a.quarantineDir,
    coordRoot: () => a.coordRoot,
    allocatedAll: () => Promise.resolve([]),
    running: () => Promise.resolve(true),
    containerId: (c) => Promise.resolve(fakeId(c)),
    resolveHost: () => Promise.resolve("127.0.0.1"),
    owner: () => "HOST1",
    health: () => ({ getState: () => ({ containers: [] }), record: () => {} }),
    verifyEgress: () => Promise.resolve(["not implemented (M1-33)"]),
    admitOnPrem: (l) => noOnPrem(l),
  };

  const n = { calls: 0 };
  const count = (lane: BcLane) => {
    const l = lane as unknown as Record<string, unknown>;
    for (const k of ["compile", "compileOn"] as const) {
      const real = (lane[k] as (...x: unknown[]) => unknown).bind(lane);
      l[k] = (...x: unknown[]) => {
        n.calls++;
        return real(...x);
      };
    }
    const real = lane.exclusive.bind(lane);
    lane.exclusive = ((ctx, fn, signal, opts) => {
      n.calls++;
      return real(
        ctx,
        async (c: string) => {
          if (a.slowMs) await new Promise((r) => setTimeout(r, a.slowMs));
          return await fn(c);
        },
        signal,
        opts,
      );
    }) as typeof lane.exclusive;
  };
  const patch = (env: HarnessEnv) => {
    // No lineage here: judging resets through the fake mechanism.
    env.deploy = { ...env.deploy, reset: OK_RESET };
    env.claimTimings = {
      staleAfterMs: STALE_MS,
      heartbeatMs: a.frozen ? 2_000_000_000 : 250,
    };
    env.hooks = {
      ...env.hooks,
      beforeLink: (what) => pause(`beforeLink:${what}`),
      afterFence: () => pause("afterFence"),
    };
    count(env.lane);
    if (env.judgeLane && env.judgeLane !== env.lane) count(env.judgeLane);
    if (a.listed) {
      const store = env.store;
      const read = store.judgments.bind(store);
      store.judgments = async (id) => {
        const js = await read(id);
        if (id === a.listed) await pause("listed");
        return js;
      };
    }
  };
  const opener = async (eo: EnvOptions) => {
    // judge-pending opens <results>/cells: every child shares one results dir.
    const h = await openHarnessEnv({ ...eo, resultsDir: a.resultsDir }, deps);
    patch(h.env);
    await pause("opened");
    return h;
  };
  const cli = {
    root: a.repoRoot,
    resultsDir: a.resultsDir,
    containers: a.containers,
    backendPort: 0,
    secretsDir: a.secretsSource,
    symbolStore: a.symbolStore,
    privateDir: a.privateRoot,
    credentialLedger: join(a.privateRoot, "credential-runs.jsonl"),
    supervised: false,
    repeat: 1,
    rev: null,
    manifest: null,
    dryRun: false,
    concurrency: 1,
    maxPauseMin: 0,
    yes: !a.pauses.includes("asked"),
  };
  const out: DriverResult = {
    name: a.name,
    pid: Deno.pid,
    ok: true,
    computes: 0,
  };
  try {
    if (a.scenario === "rejudge") {
      const r = await harnessRejudge("contract", cli, opener, () => {
        pauseSync("asked");
        return true;
      });
      out.rejudged = r.rejudged;
    } else if (a.scenario === "judge-pending") {
      out.judged = await harnessJudgePending(cli, opener);
    } else {
      const h = await opener({
        repoRoot: a.repoRoot,
        resultsDir: a.resultsDir,
        containers: a.containers,
        backendPort: 0,
        secretsSource: a.secretsSource,
        symbolStore: a.symbolStore,
        privateRoot: a.privateRoot,
        credentialLedger: cli.credentialLedger,
        command: `pool-driver ${a.name}`,
        supervised: false,
      });
      try {
        if (a.recover) out.recovered = await recoverFences(h.env);
        if (a.scenario === "pin") await pin(a, h.env, out, n, pause);
      } finally {
        await h.close();
      }
    }
  } catch (err) {
    out.ok = false;
    out.error = msg(err);
  }
  out.computes += n.calls;
  return out;
}

/**
 * F6: admit this child's container through a pool pinning on the real env
 * pin (this lineage and env_fp), then commit its computed judgment.
 */
async function pin(
  a: DriverArgs,
  env: HarnessEnv,
  out: DriverResult,
  n: { calls: number },
  pause: (point: string) => Promise<void>,
) {
  env.pinContext = {
    lineage_id: a.lineage!,
    lock_digest: "d".repeat(64),
    command: `pool-driver ${a.name}`,
  };
  const { w, pool } = poolWorld(env.lane.bc, {
    env,
    alloc: a.containers,
    // The pin barrier holds the revalidation's pin step: no step bound hit.
    bounds: { stepMs: 60_000 },
  });
  for (const c of a.containers) w.fp.set(c, a.envFp!);
  try {
    await pool.bind(a.campaign!);
    await pool.refresh();
    out.members = pool.lane.members();
    const e = (await env.store.executions(a.campaign!)).find((x) =>
      x.id === a.execution
    );
    if (!e) throw new Error(`no execution ${a.execution}`);
    const computed = JSON.parse(
      await Deno.readTextFile(a.computed!),
    ) as ComputedJudgment;
    await pause("committing");
    try {
      const r = await judgeOnce(
        env,
        { e, g: await fenceHead(env, e.id) },
        () => {
          n.calls++;
          return Promise.resolve(computed);
        },
        () => Promise.resolve(true),
      );
      out.committed = "judgment" in r;
      if ("dropped" in r) out.dropped = r.dropped;
    } catch (err) {
      out.committed = false;
      out.error = msg(err);
    }
  } finally {
    await pool.close();
  }
}

if (import.meta.main) {
  const r = await main(
    JSON.parse(await Deno.readTextFile(Deno.args[0]!)) as DriverArgs,
  );
  console.log(`RESULT ${JSON.stringify(r)}`);
  Deno.exit(0);
}
