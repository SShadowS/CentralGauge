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
import { walk } from "@std/fs/walk";
import { dockerContextEnv } from "../../../src/container/docker-context.ts";
import { DEFAULT_COORD_ROOT } from "../../../src/harness/allocation.ts";
import {
  canonicalDenied,
  canonicalPath,
  serverMountProblems,
} from "./access.ts";
import { proofRoot, writeProofRecord } from "./lib.ts";
import { BCH_ROOT, visibleArtifacts } from "../sweep-shared.ts";

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
  const raw: { Source: string; Destination: string; RW: boolean }[] = JSON
    .parse(new TextDecoder().decode(r.stdout));
  // Sol r1 #3: sources and roots by the filesystem's own name.
  const mounts = await Promise.all(
    raw.map(async (m) => ({ ...m, Source: await canonicalPath(m.Source) })),
  );
  const roots = {
    resultsRoot: await canonicalPath(o.resultsDir),
    privateRoot: await canonicalPath(o.privateRoot),
    symbolStore: await canonicalPath(o.symbolStore),
    keyCustody: o.keyCustody ? await canonicalPath(o.keyCustody) : null,
    executionId: "-",
  };
  const problems = serverMountProblems(
    mounts,
    roots,
    o.container,
    await canonicalDenied(roots),
  );
  // H-55 (4): what the mounts SHOW is its own finding, "judge artifacts on
  // shared mount", kept apart from whether a mount is allowed at all (the
  // BCH-mount ruling).
  const artifacts: string[] = [];
  // Sol r1 #7: whatever is actually mapped to C:\Run\my, searched recursively.
  const runMy = mounts.filter((m) =>
    m.Destination.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase() ===
      "c:\\run\\my"
  );
  if (runMy.length === 0) problems.push("no mount maps C:\\Run\\my");
  for (const m of runMy) {
    // Sol r2 #5: any case of .app; a link inside is refused, never followed.
    for await (const e of walk(m.Source, { followSymlinks: false })) {
      if (e.isSymlink) {
        artifacts.push(`${e.path}: a link inside C:\\Run\\my`);
      } else if (e.isFile && e.name.toLowerCase().endsWith(".app")) {
        artifacts.push(`${e.path}: a package left in C:\\Run\\my`);
      }
    }
  }
  for (const i of await visibleArtifacts(mounts, BCH_ROOT)) {
    if (!artifacts.some((a) => a.startsWith(`${i.path}:`))) {
      artifacts.push(`${i.path}: ${i.kind} of ${i.container}`);
    }
  }
  const listed = mounts.map((m) => `${m.Source} -> ${m.Destination}`)
    .join(", ");
  const root = proofRoot(Deno.env.get("CG_COORD_ROOT") || DEFAULT_COORD_ROOT);
  let failed = false;
  for (
    const [control, found, what] of [
      ["access-server-mounts", problems, "problems"],
      ["access-shared-artifacts", artifacts, "judge artifacts on shared mount"],
    ] as const
  ) {
    const pass = found.length === 0;
    failed ||= !pass;
    const detail = `${mounts.length} mounts: ${listed}; ${what}: ${
      found.length === 0 ? "none" : `${found.length}: ${found.join("; ")}`
    }`;
    const file = await writeProofRecord(root, {
      v: 1,
      provenance: { proof: true, harness_commit: null },
      at: new Date().toISOString(),
      outcome: { control, pass, detail },
    });
    console.log(`${pass ? "[OK]" : "[FAIL]"} ${control}: ${detail} (${file})`);
  }
  if (failed) Deno.exit(1);
}

if (import.meta.main) await main(Deno.args);
