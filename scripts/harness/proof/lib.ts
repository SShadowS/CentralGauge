/**
 * H-35c (design-r3 11.3, design-r5 2.5 and 6.5, decision 2026-10-20 change 4):
 * the proof-only builder and its controls. Never a CLI or judging option: no
 * module under src/ imports this one (a test enforces it).
 *
 * - PROOF_POLICY compiles OnPrem, and nothing here runs the L3 policy gate
 *   (ban off). That is the point: each control shows the NEXT layer catching
 *   a fixture once the layers before it are removed.
 * - A control is a paired write/read on one container through the real
 *   deployment path (reset, L2a block, L4 capture, quarantine): the write
 *   deployment is either detected and quarantined (L4), blocked (L2), or
 *   cleared by the reset before the read deployment looks.
 * - Records carry `provenance.proof: true` and are written only under the
 *   coord's tasks/H-35/proof. The campaign store and integrity refuse them.
 */
import { join, normalize, resolve, SEPARATOR } from "@std/path";
import {
  type BcLane,
  type BuildPolicy,
  deployAndTest,
  type DeployTestResult,
  type LockedSymbols,
  prepareApps,
  type TestSpec,
} from "../../../src/harness/bc-lane.ts";
import {
  HostDirtyError,
  type ResetMechanism,
} from "../../../src/harness/reset.ts";
import { readAppGraph } from "../../../src/harness/staging.ts";

export const PROOF_POLICY: BuildPolicy = {
  target: "OnPrem",
  id: "h35-proof-onprem@1",
};

/** What the next layer must do with the fixture. */
export type Disposition = "detected" | "blocked" | "cleared";

export interface ProofControl {
  name: string;
  kind: "hostile" | "seeded";
  /** The layer the control proves (the next one after L1 and L3). */
  layer: "L2" | "L4" | "reset";
  expect: Disposition;
  /** The fixture folder, relative to the repo root. */
  dir: string;
}

const HOSTILE = "tests/fixtures/harness/hostile";
const SEEDED = "tests/fixtures/harness/proof";

/**
 * design-r5 2.5 table (proof-only control column) and 6.5 seeded state. The
 * four hostile fixtures are reserved for the owner (H-35b): absent, they
 * report `fixture_missing` and never pass.
 */
export const PROOF_CONTROLS: readonly ProofControl[] = [
  {
    name: "file-packageid",
    kind: "hostile",
    layer: "L4",
    expect: "detected",
    dir: `${HOSTILE}/file-packageid`,
  },
  {
    name: "http-exfil",
    kind: "hostile",
    layer: "L2",
    expect: "blocked",
    dir: `${HOSTILE}/http-exfil`,
  },
  {
    name: "server-path",
    kind: "hostile",
    layer: "L4",
    expect: "detected",
    dir: `${HOSTILE}/server-path`,
  },
  {
    name: "background-task",
    kind: "hostile",
    layer: "reset",
    expect: "cleared",
    dir: `${HOSTILE}/background-task`,
  },
  {
    name: "seed-isolated-storage",
    kind: "seeded",
    layer: "reset",
    expect: "cleared",
    dir: `${SEEDED}/seed-isolated-storage`,
  },
  {
    name: "seed-job-queue",
    kind: "seeded",
    layer: "reset",
    expect: "cleared",
    dir: `${SEEDED}/seed-job-queue`,
  },
  {
    name: "seed-scheduled-task",
    kind: "seeded",
    layer: "reset",
    expect: "cleared",
    dir: `${SEEDED}/seed-scheduled-task`,
  },
  {
    name: "seed-global-app",
    kind: "seeded",
    layer: "reset",
    expect: "cleared",
    dir: `${SEEDED}/seed-global-app`,
  },
  {
    name: "seed-server-file",
    kind: "seeded",
    layer: "L4",
    expect: "detected",
    dir: `${SEEDED}/seed-server-file`,
  },
];

/** H-46: the NST's text for an HttpClient call the extension setting blocks. */
export const HTTP_BLOCKED_TEXT =
  "The request was blocked by the runtime to prevent accidental use of production services";

/** `<fixture>/proof.json`: the tests of each step; `read` absent for L2 and L4. */
export interface FixtureSpec {
  /** `leave`: app ids the write's cleanup keeps published (the global app seed). */
  write: {
    tests: TestSpec[];
    leave?: string[];
    /** L4: a regex (case-insensitive) one of the differences' paths must match. */
    detect?: string;
  };
  read?: { tests: TestSpec[] };
}

export type Observed =
  | Disposition
  | "not_detected"
  | "not_blocked"
  | "leaked"
  | "not_persisted"
  | "fixture_missing"
  | "infra";

export interface ControlOutcome {
  control: string;
  layer: ProofControl["layer"];
  expect: Disposition;
  observed: Observed;
  pass: boolean;
  container: string | null;
  /** L4: the paths of the recorded differences. */
  fs_diff: string[];
  detail: string;
}

export interface ProofEnv {
  lane: BcLane;
  lock: LockedSymbols;
  ledgerRoot: string;
  reset: ResetMechanism;
}

async function readSpec(dir: string): Promise<FixtureSpec | null> {
  try {
    return JSON.parse(
      await Deno.readTextFile(join(dir, "proof.json")),
    ) as FixtureSpec;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

/**
 * One OnPrem build plus one deployment of `ws`, on `pin` when given; `reset`
 * false only for the contrast read (no reset, so no L4 capture either).
 */
async function step(
  env: ProofEnv,
  ws: string,
  tests: TestSpec[],
  work: string,
  pin: string | null,
  reset = true,
  leave: readonly string[] = [],
): Promise<{ container: string; result: DeployTestResult }> {
  const kept = new Set(leave.map((id) => id.toLowerCase()));
  const apps = await readAppGraph(ws);
  const prep = await prepareApps(env.lane, {
    pristine: ws,
    pristineApps: apps,
    candidateDir: ws,
    candidateApps: apps,
    changed: apps.map((a) => a.folder),
    workDir: work,
    lock: env.lock,
    // Every app a candidate (L2a block on each), no build cache.
    versionPlan: "judge",
    policy: PROOF_POLICY,
    label: "proof",
  });
  if (!prep.buildOk) {
    throw new Error(
      `proof build of ${ws} failed: ${
        prep.built.filter((b) => !b.ok).flatMap((b) =>
          b.diagnostics.map((d) => `${b.folder} ${d.code}: ${d.message}`)
        ).join("; ")
      }`,
    );
  }
  const held = await env.lane.exclusive(
    { taskId: "h35-proof", variantId: crypto.randomUUID(), attemptNumber: 1 },
    (c) =>
      deployAndTest(env.lane.bc, c, {
        wanted: prep.wanted,
        tests,
        cleanupIds: [...prep.candidateIds].reverse().filter((id) =>
          !kept.has(id.toLowerCase())
        ),
        // The fixture is ours (trusted): its app ids are the removal allowlist.
        ctx: {
          ledgerRoot: env.ledgerRoot,
          trustedRoots: [ws],
          ...(reset ? { reset: env.reset } : {}),
        },
      }),
    undefined,
    {
      // A detection must stay on its container (quarantined), never reroute.
      maxInfraRetries: 0,
      ...(pin ? { exclude: env.lane.containers.filter((c) => c !== pin) } : {}),
    },
  );
  return { container: held.container, result: held.result };
}

const failedRows = (r: DeployTestResult) =>
  r.rows.filter((x) => x.outcome !== "pass").map((x) =>
    `${x.codeunit}.${x.procedure} ${x.outcome}`
  );

/** Runs one control; a missing fixture or an infra fault never passes. */
export async function runControl(
  env: ProofEnv,
  control: ProofControl,
  repoRoot: string,
  work: string,
): Promise<ControlOutcome> {
  const out = (
    observed: Observed,
    detail: string,
    container: string | null = null,
    fs_diff: string[] = [],
  ): ControlOutcome => ({
    control: control.name,
    layer: control.layer,
    expect: control.expect,
    observed,
    pass: observed === control.expect,
    container,
    fs_diff,
    detail,
  });
  const dir = join(repoRoot, control.dir);
  const spec = await readSpec(dir);
  if (!spec) {
    return out(
      "fixture_missing",
      control.kind === "hostile"
        ? "hostile fixture not written: the owner decides its route (H-35b)"
        : `no ${control.dir}/proof.json`,
    );
  }
  let write: { container: string; result: DeployTestResult };
  try {
    write = await step(
      env,
      join(dir, "write"),
      spec.write.tests,
      join(work, "write"),
      null,
      true,
      spec.write.leave ?? [],
    );
  } catch (err) {
    if (err instanceof HostDirtyError) {
      const paths = err.record.diff.map((d) => d.path);
      // An unobservable capture (errors) proves nothing: infra, not detected.
      if (err.record.errors.length > 0 || paths.length === 0) {
        return out("infra", err.message, err.record.container, paths);
      }
      // The fixture's own file must be among the differences, not any noise.
      const want = spec.write.detect
        ? new RegExp(spec.write.detect, "i")
        : null;
      if (want && !paths.some((p) => want.test(p))) {
        return out(
          "not_detected",
          `L4 differences without the fixture's file: ${err.message}`,
          err.record.container,
          paths,
        );
      }
      return out("detected", err.message, err.record.container, paths);
    }
    return out("infra", err instanceof Error ? err.message : String(err));
  }
  const c = write.container;
  if (control.layer === "L4") {
    return out("not_detected", "the write deployment left L4 clean", c);
  }
  if (control.layer === "L2") {
    const hit = write.result.messages.find((m) =>
      m.message.includes(HTTP_BLOCKED_TEXT)
    );
    return hit
      ? out("blocked", `${hit.codeunit}.${hit.procedure}: ${hit.message}`, c)
      : out("not_blocked", "no blocked HttpClient call recorded", c);
  }
  if (!spec.read) return out("infra", "a reset control needs a read step", c);
  // The write must have run: its own tests assert the state was seeded.
  const unseeded = failedRows(write.result);
  if (unseeded.length > 0) {
    return out("infra", `write did not seed: ${unseeded.join(", ")}`, c);
  }
  // The read's tests assert the seeded state is gone. Read twice on the
  // write's container: after the ordinary cleanup alone (design-r5 6.5: the
  // state must survive it, or the seed proves nothing), then after a reset.
  const reads: DeployTestResult[] = [];
  for (const [i, reset] of [false, true].entries()) {
    try {
      reads.push(
        (await step(
          env,
          join(dir, "read"),
          spec.read.tests,
          join(work, `read${i}`),
          c,
          reset,
        )).result,
      );
    } catch (err) {
      return out("infra", err instanceof Error ? err.message : String(err), c);
    }
  }
  if (failedRows(reads[0]!).length === 0) {
    return out(
      "not_persisted",
      "the state was gone after the ordinary cleanup alone",
      c,
    );
  }
  const left = failedRows(reads[1]!);
  return left.length === 0
    ? out("cleared", "the reset removed the seeded state before the read", c)
    : out("leaked", `state survived the reset: ${left.join(", ")}`, c);
}

/** design-r3 11.3: proof records live only under the coord's tasks/H-35/proof. */
export function proofRoot(coordRoot: string): string {
  return join(resolve(coordRoot), "tasks", "H-35", "proof");
}

export interface ProofRecord {
  v: 1;
  provenance: { proof: true; harness_commit: string | null };
  at: string;
  /** A control's outcome, or an access probe's (access.ts). */
  outcome: ControlOutcome | { control: string; pass: boolean; detail: string };
}

/** Write-once under `root`, which must be a proofRoot. */
export async function writeProofRecord(
  root: string,
  rec: ProofRecord,
): Promise<string> {
  const n = normalize(resolve(root)).toLowerCase();
  const tail = ["tasks", "h-35", "proof"].join(SEPARATOR);
  if (!n.endsWith(tail) || rec.provenance.proof !== true) {
    throw new Error(`proof records go only under <coord>/tasks/H-35/proof`);
  }
  const dir = join(root, "controls");
  await Deno.mkdir(dir, { recursive: true });
  const file = join(
    dir,
    `${rec.outcome.control}-${rec.at.replace(/[:.]/g, "")}.json`,
  );
  await Deno.writeTextFile(file, JSON.stringify(rec, null, 2) + "\n", {
    createNew: true,
  });
  return file;
}
