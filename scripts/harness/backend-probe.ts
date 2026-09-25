// Ops driver for M1-28 Step 4 (no provider credential: not a supervised run, no reservation).
// Usage (container leased, no bench live):
//   DOCKER_CONTEXT=desktop-windows deno run --allow-all scripts/harness/backend-probe.ts <container> <secretsDir>
// Prints statuses only (never the token); the token is revoked when the script ends.
import { join } from "@std/path";
import { openHarnessEnv } from "../../cli/commands/harness-env.ts";
import { resolveRefapp } from "../../src/harness/identity.ts";
import { imageFacts, imageTag } from "../../src/harness/images.ts";
import {
  prepareSecrets,
  removeSecrets,
  runSandbox,
  sandboxName,
} from "../../src/harness/sandbox.ts";
import { TASK_SOURCES } from "../../src/harness/staging.ts";
import { loadTask } from "../../src/harness/task.ts";

const [container, secretsDir] = Deno.args;
if (!container || !secretsDir) {
  throw new Error("usage: backend-probe.ts <container> <secretsDir>");
}
const root = Deno.cwd();
const privateRoot = join(
  Deno.env.get("LOCALAPPDATA")!,
  "centralgauge",
  "harness",
);
const h = await openHarnessEnv({
  repoRoot: root,
  resultsDir: join(root, "results", "harness", "probes"),
  containers: [container],
  backendPort: 3210,
  secretsSource: secretsDir,
  symbolStore: join(root, "results", "harness", "symbols"),
  privateRoot,
  credentialLedger: null,
  command: "backend-probe",
  supervised: false,
});
const id = crypto.randomUUID();
const work = join(privateRoot, "work", id);
const out = join(privateRoot, "probes", id);
let secrets: string | null = null;
try {
  const task = await loadTask(join(root, "harness-tasks", "tasks", "HX-001"));
  const staged = await TASK_SOURCES[task.task.source]({
    repoRoot: root,
    task,
    refapp: await resolveRefapp(root, task.task.refapp_version),
    symbols: h.env.symbols,
    symbolStore: h.env.symbolStore,
    out: work,
  });
  const configDir = join(work, "config");
  await Deno.mkdir(configDir, { recursive: true });
  await Deno.copyFile(
    join(root, "scripts", "harness", "cg-al-probe.ps1"),
    join(configDir, "cg-al-probe.ps1"),
  );
  await Deno.mkdir(out, { recursive: true });
  const hostLog = join(out, "host-log.jsonl");
  const name = sandboxName("00000000-0000-4000-8000-0000000000b0", id);
  const token = await h.env.backend.grant({
    executionId: id,
    sandbox: name,
    workspace: staged.workspace,
    pristine: staged.pristine,
    trusted: staged.apps,
    symbols: h.env.symbols,
    lock: { store: h.env.symbolStore, packages: h.env.symbols },
    deploy: {
      ledgerRoot: h.env.deploy.ledgerRoot,
      trustedRoots: [staged.pristine],
    },
    hostLog,
  }, 30 * 60_000);
  const s = await prepareSecrets(secretsDir, [], token, {
    privateRoot: h.env.privateRoot,
    owner: h.env.owner,
  });
  secrets = s.dir;
  const img = await imageFacts(
    h.env.docker,
    imageTag("claude-code", "2.1.282"),
  );
  const r = await runSandbox(h.env.docker, {
    name,
    owner: h.env.owner,
    executionId: id,
    imageId: img.digest,
    workspace: staged.workspace,
    taskDir: staged.taskDir,
    configDir,
    secretsDir: s.dir,
    extraMounts: [],
    env: { CG_BACKEND_URL: h.env.backendUrl, CG_EXECUTION_ID: id },
    timeoutMs: 20 * 60_000,
    killGraceMs: 60_000,
    opTimeoutMs: 60_000,
    maxCaptureBytes: 16 * 1024 * 1024,
    rawLog: join(out, "probe.jsonl"),
    stderrLog: join(out, "stderr.txt"),
    command: [
      "powershell",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\config\\cg-al-probe.ps1",
    ],
  }, s.values.map((v) => v.value));
  console.log(
    JSON.stringify({
      execution: id,
      sandbox: r,
      probe: join(out, "probe.jsonl"),
      hostLog,
    }),
  );
} finally {
  await h.env.backend.revoke(id);
  if (secrets) await removeSecrets(secrets);
  await Deno.remove(work, { recursive: true }).catch(() => {});
  await h.close();
}
