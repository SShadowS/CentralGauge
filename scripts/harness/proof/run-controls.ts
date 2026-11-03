/**
 * H-35c: lane-ops runs the proof-only controls on one scratch container
 * (Cronus285 under its coord lease). It opens the harness environment like
 * the test-rerun runner (bench lock, private-root lock, lease check, lineage
 * reset with L4), runs each control and writes one proof record per control
 * under $CG_COORD_ROOT/tasks/H-35/proof/controls. Never judging, never a
 * campaign store. Exit 1 when any control did not show its disposition.
 *
 *   deno run --allow-all scripts/harness/proof/run-controls.ts \
 *     --container Cronus285 --coord-lease Cronus285=<token> \
 *     --lineage <abs lineage.json> --symbol-store <dir> --private-root <dir> \
 *     [--control seed-job-queue ...]
 */
import { Command } from "@cliffy/command";
import { join, resolve } from "@std/path";
import { DEFAULT_COORD_ROOT } from "../../../src/harness/allocation.ts";
import {
  PROOF_CONTROLS,
  proofRoot,
  runControl,
  writeProofRecord,
} from "./lib.ts";

async function main(args: string[]) {
  const { options: o } = await new Command()
    .name("run-controls")
    .option("--container <name:string>", "the scratch container", {
      required: true,
    })
    .option("--coord-lease <pair:string>", "<container>=<token>", {
      required: true,
    })
    .option("--lineage <file:string>", "reset lineage (absolute)", {
      required: true,
    })
    .option("--symbol-store <dir:string>", "locked symbol store", {
      required: true,
    })
    .option("--private-root <dir:string>", "private root", { required: true })
    .option("--control <name:string>", "run only these (default: all)", {
      collect: true,
    })
    .parse(args);
  const names = o.control ?? PROOF_CONTROLS.map((c) => c.name);
  const unknown = names.filter((n) =>
    !PROOF_CONTROLS.some((c) => c.name === n)
  );
  if (unknown.length > 0) throw new Error(`unknown control: ${unknown}`);
  const repoRoot = resolve(".");
  const root = proofRoot(Deno.env.get("CG_COORD_ROOT") || DEFAULT_COORD_ROOT);
  const [{ openHarnessEnv }, { parseCoordLease }] = await Promise.all([
    import("../../../cli/commands/harness-env.ts"),
    import("../../../cli/commands/harness-command.ts"),
  ]);
  const h = await openHarnessEnv({
    repoRoot,
    // Kept out of the campaign results (design-r3 11.3).
    resultsDir: join(o.privateRoot, "proof-results"),
    containers: [o.container],
    backendPort: 3211,
    secretAccounts: [{ label: null, dir: join(o.privateRoot, "no-secrets") }],
    symbolStore: o.symbolStore,
    privateRoot: o.privateRoot,
    credentialLedger: null,
    command: "proof run-controls",
    supervised: false,
    lineage: o.lineage,
    coordLeases: new Map([parseCoordLease(o.coordLease)]),
  });
  let failed = 0;
  try {
    const reset = h.env.deploy.reset;
    if (!reset?.fsDigest) throw new Error("the lineage has no L4 capture");
    const env = {
      lane: h.env.lane,
      lock: { store: h.env.symbolStore, packages: h.env.symbols },
      ledgerRoot: h.env.deploy.ledgerRoot,
      reset,
    };
    const work = join(o.privateRoot, "work", `proof-${crypto.randomUUID()}`);
    const todo = PROOF_CONTROLS.filter((c) => names.includes(c.name));
    for (const [i, c] of todo.entries()) {
      // A quarantined container takes no further control: lane-ops recovers
      // it, then reruns the rest with --control.
      if (h.env.lane.quarantined.size > 0) {
        const rest = todo.slice(i).map((x) => x.name);
        console.log(`[STOP] ${o.container} quarantined; not run: ${rest}`);
        failed += rest.length;
        break;
      }
      const outcome = await runControl(env, c, repoRoot, join(work, c.name));
      const file = await writeProofRecord(root, {
        v: 1,
        provenance: { proof: true, harness_commit: h.env.harnessCommit },
        at: new Date().toISOString(),
        outcome,
      });
      if (!outcome.pass) failed++;
      console.log(
        `${
          outcome.pass ? "[OK]" : "[FAIL]"
        } ${c.name}: expected ${c.expect}, observed ${outcome.observed} (${file})`,
      );
    }
    await Deno.remove(work, { recursive: true }).catch(() => {});
  } finally {
    await h.close();
  }
  if (failed > 0) Deno.exit(1);
}

if (import.meta.main) await main(Deno.args);
