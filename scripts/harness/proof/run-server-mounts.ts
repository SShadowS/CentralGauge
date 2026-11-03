/**
 * H-35c (design-r5 2.5, server column, the half without AL): lane-ops runs it
 * on the scratch container after run-controls. It checks the BC container's
 * bind mounts against the denied roots (serverMountProblems) and that BCH's
 * host-mapped C:\Run\my holds no .app (no judge package left after publish).
 * One proof record under tasks/H-35/proof; exit 1 on any problem.
 *
 *   deno run --allow-all scripts/harness/proof/run-server-mounts.ts \
 *     --container Cronus285 --results-dir <results/harness> \
 *     --private-root <dir> --symbol-store <dir> [--key-custody <dir>]
 */
import { Command } from "@cliffy/command";
import { join } from "@std/path";
import { dockerContextEnv } from "../../../src/container/docker-context.ts";
import { DEFAULT_COORD_ROOT } from "../../../src/harness/allocation.ts";
import { serverMountProblems } from "./access.ts";
import { proofRoot, writeProofRecord } from "./lib.ts";

async function main(argv: string[]) {
  const { options: o } = await new Command()
    .name("run-server-mounts")
    .option("--container <name:string>", "the scratch container", {
      required: true,
    })
    .option("--results-dir <dir:string>", "results/harness", { required: true })
    .option("--private-root <dir:string>", "private root", { required: true })
    .option("--symbol-store <dir:string>", "symbol store", { required: true })
    .option("--key-custody <dir:string>", "the --key-custody dir, if any")
    .parse(argv);
  const r = await new Deno.Command("docker", {
    args: ["inspect", "--format", "{{json .Mounts}}", o.container],
    env: dockerContextEnv(),
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (r.code !== 0) {
    throw new Error(`docker inspect: ${new TextDecoder().decode(r.stderr)}`);
  }
  const mounts = JSON.parse(new TextDecoder().decode(r.stdout));
  const problems = serverMountProblems(mounts, {
    resultsRoot: o.resultsDir,
    privateRoot: o.privateRoot,
    symbolStore: o.symbolStore,
    keyCustody: o.keyCustody ?? null,
    executionId: "-",
  }, o.container);
  const my = join(
    "C:\\ProgramData\\BcContainerHelper\\Extensions",
    o.container,
    "my",
  );
  for await (const e of Deno.readDir(my)) {
    if (e.isFile && e.name.toLowerCase().endsWith(".app")) {
      problems.push(`${my}\\${e.name}: a package left in C:\\Run\\my`);
    }
  }
  const pass = problems.length === 0;
  const detail = `${mounts.length} mounts: ${
    mounts.map((m: { Source: string; Destination: string }) =>
      `${m.Source} -> ${m.Destination}`
    ).join(", ")
  }; problems: ${problems.join("; ") || "none"}`;
  const file = await writeProofRecord(
    proofRoot(Deno.env.get("CG_COORD_ROOT") || DEFAULT_COORD_ROOT),
    {
      v: 1,
      provenance: { proof: true, harness_commit: null },
      at: new Date().toISOString(),
      outcome: { control: "access-server-mounts", pass, detail },
    },
  );
  console.log(
    `${pass ? "[OK]" : "[FAIL]"} access-server-mounts: ${detail} (${file})`,
  );
  if (!pass) Deno.exit(1);
}

if (import.meta.main) await main(Deno.args);
