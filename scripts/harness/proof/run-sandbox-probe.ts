/**
 * H-35c (design-r5 2.5): the agent sandbox identity's access probe, run by
 * lane-ops. It lays out one execution exactly as execution.ts does (its own
 * work dir, a fresh secrets dir), plants canaries in every denied root the
 * harness owns plus the own workspace, starts the real sandbox image through
 * buildRunArgs (the production mounts, user and isolation) with
 * sandbox-probe.ps1 as the command, and passes only when the probe saw the
 * workspace canary and no other. One proof record under tasks/H-35/proof.
 *
 *   deno run --allow-all scripts/harness/proof/run-sandbox-probe.ts \
 *     --image sha256:<64 hex> --results-dir <results/harness> \
 *     --private-root <dir> --symbol-store <dir> [--key-custody <dir>]
 */
import { Command } from "@cliffy/command";
import { dirname, fromFileUrl, join } from "@std/path";
import { dockerContextEnv } from "../../../src/container/docker-context.ts";
import { DEFAULT_COORD_ROOT } from "../../../src/harness/allocation.ts";
import { buildRunArgs } from "../../../src/harness/sandbox.ts";
import {
  type AccessRoots,
  canonicalDenied,
  canonicalPath,
  containerPaths,
  judgeProbe,
  mountProblems,
  plantCanaries,
  removeCanaries,
} from "./access.ts";
import { proofRoot, writeProofRecord } from "./lib.ts";

async function docker(args: string[]) {
  const r = await new Deno.Command("docker", {
    args,
    env: dockerContextEnv(),
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return { code: r.code, out: dec.decode(r.stdout), err: dec.decode(r.stderr) };
}

async function main(argv: string[]) {
  const { options: o } = await new Command()
    .name("run-sandbox-probe")
    .option("--image <id:string>", "sandbox image id (sha256:...)", {
      required: true,
    })
    .option("--results-dir <dir:string>", "results/harness", { required: true })
    .option("--private-root <dir:string>", "private root", { required: true })
    .option("--symbol-store <dir:string>", "symbol store", { required: true })
    .option("--key-custody <dir:string>", "the --key-custody dir, if any")
    .parse(argv);
  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replaceAll("-", "");
  // Sol r1 #3: every root by the filesystem's own name (links, short names).
  const privateRoot = await canonicalPath(o.privateRoot);
  const work = join(privateRoot, "work", id);
  const secretsAt = join(privateRoot, "secrets", `proof-${id}`);
  for (const d of ["workspace", "task", "config"]) {
    await Deno.mkdir(join(work, d), { recursive: true });
  }
  await Deno.mkdir(secretsAt, { recursive: true });
  // Sol r3 #1: the mount sources by their real names too, once they exist
  // (a junctioned work or secrets folder resolves to where it really is).
  const [workspace, taskDir, configDir, secrets] = await Promise.all(
    [
      join(work, "workspace"),
      join(work, "task"),
      join(work, "config"),
      secretsAt,
    ].map(canonicalPath),
  );
  const roots: AccessRoots = {
    resultsRoot: await canonicalPath(o.resultsDir),
    privateRoot,
    symbolStore: await canonicalPath(o.symbolStore),
    keyCustody: o.keyCustody ? await canonicalPath(o.keyCustody) : null,
    executionId: id,
    secretsDir: secrets!,
  };
  await Deno.copyFile(
    join(dirname(fromFileUrl(import.meta.url)), "sandbox-probe.ps1"),
    join(work, "config", "sandbox-probe.ps1"),
  );
  const name = `cg-proof-probe-${id.slice(0, 8)}`;
  const args = buildRunArgs(
    {
      name,
      owner: "h35-proof",
      executionId: id,
      imageId: o.image,
      workspace: workspace!,
      taskDir: taskDir!,
      configDir: configDir!,
      secretsDir: secrets!,
      extraMounts: [],
      env: {},
      command: [
        "powershell",
        "-NoProfile",
        "-File",
        "C:\\config\\sandbox-probe.ps1",
        "-Token",
        token,
        "-Known",
        "C:\\config\\known.txt",
      ],
      timeoutMs: 0,
      killGraceMs: 0,
      opTimeoutMs: 0,
      maxCaptureBytes: 0,
      rawLog: "",
      stderrLog: "",
    } as Parameters<typeof buildRunArgs>[0],
  );
  const layout = mountProblems(args, roots, await canonicalDenied(roots));
  if (layout.length > 0) throw new Error(`mount layout: ${layout.join("; ")}`);
  const planted = await plantCanaries(roots, workspace!, token);
  // Sol r1 #6: the probe also opens every denied canary by its host path,
  // so a folder that refuses listing but serves a known name still counts.
  await Deno.writeTextFile(
    join(work, "config", "known.txt"),
    // Sol r2 #2: by host path and by every container path a mount shows it at.
    planted.filter((p) => !p.positive).flatMap((p) => [
      p.path,
      ...containerPaths(p.path, args),
    ]).join("\r\n"),
  );
  let detail: string;
  let pass = false;
  try {
    const r = await docker(args);
    const lines = r.out.split(/\r?\n/);
    const hits = lines.filter((l) => /^(HIT|OPEN) /.test(l))
      .map((l) => l.replace(/^(HIT|OPEN) /, "").trim());
    const done = lines.find((l) => l.startsWith("DONE "));
    const j = judgeProbe(hits, token);
    pass = r.code === 0 && !!done && j.pass;
    const errs = lines.find((l) => l.startsWith("ERR ")) ?? "ERR ?";
    detail = `exit ${r.code}; ${done ?? "no DONE line"}; ${errs}; planted ${
      planted.map((p) => p.path).join(", ")
    }; workspace canary ${j.positive ? "seen" : "NOT seen"}; leaks: ${
      j.leaks.join(", ") || "none"
    }${r.err ? `; stderr: ${r.err.slice(0, 500)}` : ""}`;
  } finally {
    await docker(["rm", "-f", name]);
    await removeCanaries(planted);
    await Deno.remove(work, { recursive: true }).catch(() => {});
    await Deno.remove(secretsAt, { recursive: true }).catch(() => {});
  }
  const file = await writeProofRecord(
    proofRoot(Deno.env.get("CG_COORD_ROOT") || DEFAULT_COORD_ROOT),
    {
      v: 1,
      provenance: { proof: true, harness_commit: null },
      at: new Date().toISOString(),
      outcome: { control: "access-sandbox", pass, detail },
    },
  );
  console.log(
    `${pass ? "[OK]" : "[FAIL]"} access-sandbox: ${detail} (${file})`,
  );
  if (!pass) Deno.exit(1);
}

if (import.meta.main) await main(Deno.args);
