// SPIKE (throwaway): harness bench M0
// Usage: deno run --allow-all scripts/spikes/harness/run-sandbox.ts <claude|pi> <model> <workspaceDir> <promptFile>
//          [--provider p] [--key-file f] [--kill-after-s N] [--mcp-config C:\\path\\in\\container]
import { parseArgs } from "@std/cli/parse-args";
import { join } from "@std/path";

const a = parseArgs(Deno.args, {
  string: ["provider", "key-file", "kill-after-s", "mcp-config"],
});
const [harness, model, workspace, promptFile] = a._.map(String);
if (!harness || !model || !workspace || !promptFile) {
  throw new Error("usage: see header");
}

const OUT = "H:\\Temp3\\harness-spike";
const SECRETS = Deno.env.get("CG_SPIKE_SECRETS") ??
  "H:\\Temp3\\harness-spike\\secrets";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const name = `cg-harness-spike-${harness}-${stamp}`.toLowerCase();
await Deno.mkdir(OUT, { recursive: true });
const taskDir = await Deno.makeTempDir({ prefix: "cg-harness-spike-task-" });
await Deno.copyFile(promptFile, join(taskDir, "prompt.md"));

const entry = harness === "claude"
  ? [
    "C:\\run-claude.ps1",
    "-Model",
    model,
    ...(a["mcp-config"] ? ["-McpConfig", a["mcp-config"]] : []),
  ]
  : [
    "C:\\run-pi.ps1",
    "-Provider",
    a.provider ?? "openrouter",
    "-Model",
    model,
    "-KeyFile",
    a["key-file"] ?? "openrouter-api-key",
  ];

const args = [
  "run",
  "--name",
  name,
  "--mount",
  `type=bind,src=${workspace},dst=C:\\workspace`,
  "--mount",
  `type=bind,src=${taskDir},dst=C:\\task,readonly`,
  "--mount",
  `type=bind,src=${SECRETS},dst=C:\\cg-secrets,readonly`,
  "centralgauge/harness-spike:windows",
  "powershell",
  "-File",
  ...entry,
];
const env = {
  DOCKER_CONTEXT: Deno.env.get("DOCKER_CONTEXT") ?? "desktop-windows",
};
const t0 = Date.now();
const child = new Deno.Command("docker", {
  args,
  env,
  stdout: "piped",
  stderr: "piped",
}).spawn();
const outPath = join(OUT, `${harness}-${stamp}.jsonl`);
const outFile = await Deno.open(outPath, { write: true, create: true });
const errFile = await Deno.open(join(OUT, `${harness}-${stamp}.stderr.txt`), {
  write: true,
  create: true,
});
let killTimer: ReturnType<typeof setTimeout> | undefined;
if (a["kill-after-s"]) {
  killTimer = setTimeout(() => {
    new Deno.Command("docker", { args: ["kill", name], env }).outputSync();
  }, Number(a["kill-after-s"]) * 1000);
}
try {
  await Promise.all([
    child.stdout.pipeTo(outFile.writable),
    child.stderr.pipeTo(errFile.writable),
  ]);
  const status = await child.status;
  console.log(
    JSON.stringify({
      name,
      exit: status.code,
      wallMs: Date.now() - t0,
      out: outPath,
    }),
  );
} finally {
  if (killTimer) clearTimeout(killTimer);
  new Deno.Command("docker", { args: ["rm", "-f", name], env }).outputSync();
  await Deno.remove(taskDir, { recursive: true });
}
