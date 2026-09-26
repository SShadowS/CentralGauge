// Ops driver for M1-28 Step 4 (no provider credential: not a supervised run, no reservation).
// Usage (container leased, no bench live):
//   DOCKER_CONTEXT=desktop-windows deno run --allow-all scripts/harness/backend-probe.ts <container> <secretsDir> [--enforced]
// Prints statuses only (never the token); the token is revoked when the script ends.
// --enforced (M1-33, M1-34): the egress marker must place sandboxes (qualified or
// authorized, verified); the probe sandbox then runs on the internal network with
// the backend on the sandbox gateway, as an enforced cell would: proxy, listener
// check, empty mount, C:\egress-check.ps1, then (only when it passes) the backend
// token and ready. It writes probe-evidence.json for `harness egress verify
// --mark qualified --probe-evidence <path>`.
import { join } from "@std/path";
import {
  collectEgressState,
  evaluatePreflight,
  MARKER_FILE,
  preflightExpect,
  PROXY_ENV,
  realEgressCollector,
  SANDBOX_NETWORK,
} from "../../src/harness/egress.ts";
import { waitRunning } from "../../src/harness/execution.ts";
import { openHarnessEnv } from "../../cli/commands/harness-env.ts";
import { resolveRefapp } from "../../src/harness/identity.ts";
import { imageFacts, imageTag } from "../../src/harness/images.ts";
import {
  createSecretsDir,
  prepareSecrets,
  READY_FILE,
  removeSecrets,
  runSandbox,
  sandboxName,
  writeSecretFiles,
} from "../../src/harness/sandbox.ts";
import { TASK_SOURCES } from "../../src/harness/staging.ts";
import { loadTask } from "../../src/harness/task.ts";

const enforced = Deno.args.includes("--enforced");
const [container, secretsDir] = Deno.args.filter((a) => a !== "--enforced");
if (!container || !secretsDir) {
  throw new Error(
    "usage: backend-probe.ts <container> <secretsDir> [--enforced]",
  );
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
if (enforced !== (h.env.egress !== undefined)) {
  await h.close();
  throw new Error(
    enforced
      ? "--enforced: the egress marker does not place sandboxes (needs a verified qualified or authorized marker)"
      : "the egress marker places sandboxes (backend on the sandbox gateway): pass --enforced",
  );
}
/** M1-34 Step 6 qualifies with the first-party route's fixed host (the OAuth hosts are recorded later, Step 11). */
const PROBE_HOSTS = ["api.anthropic.com"];
const id = crypto.randomUUID();
const work = join(privateRoot, "work", id);
const out = join(privateRoot, "probes", id);
let secrets: string | null = null;
let proxy: { shutdown(): Promise<void> } | null = null;
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
  const img = await imageFacts(
    h.env.docker,
    imageTag("claude-code", "2.1.282"),
    h.env.owner,
  );
  const tokenValue = [{ name: "backend-token", value: token }];
  const eg = h.env.egress;
  if (enforced && eg) {
    // Same order as an enforced cell: proxy, listeners, then an empty mount;
    // the token and ready only after the in-sandbox preflight passes.
    const egressLog = join(out, "egress.jsonl");
    proxy = await eg.startProxy({
      allowedHosts: PROBE_HOSTS,
      log: (l) =>
        Deno.writeTextFileSync(egressLog, JSON.stringify(l) + "\n", {
          append: true,
        }),
    });
    const lp = await eg.listeners();
    if (lp.length > 0) {
      throw new Error(`listeners not on the gateway only: ${lp.join("; ")}`);
    }
  }
  secrets = enforced
    ? await createSecretsDir({
      privateRoot: h.env.privateRoot,
      owner: h.env.owner,
    })
    : (await prepareSecrets(secretsDir, [], token, {
      privateRoot: h.env.privateRoot,
      owner: h.env.owner,
    })).dir;
  const probeCmd = "& 'C:\\config\\cg-al-probe.ps1'; exit $LASTEXITCODE";
  const waitReady =
    "$sw = [Diagnostics.Stopwatch]::StartNew(); while (-not (Test-Path 'C:\\cg-secrets\\ready')) { if ($sw.Elapsed.TotalSeconds -ge 600) { exit 3 }; Start-Sleep -Milliseconds 500 }; ";
  const stop = new AbortController();
  const running = runSandbox(
    h.env.docker,
    {
      name,
      owner: h.env.owner,
      executionId: id,
      imageId: img.digest,
      workspace: staged.workspace,
      taskDir: staged.taskDir,
      configDir,
      secretsDir: secrets,
      extraMounts: [],
      env: {
        CG_BACKEND_URL: h.env.backendUrl,
        CG_EXECUTION_ID: id,
        ...(enforced ? PROXY_ENV : {}),
      },
      ...(enforced ? { network: SANDBOX_NETWORK.name } : {}),
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
        "-Command",
        enforced ? waitReady + probeCmd : probeCmd,
      ],
    },
    [token],
    stop.signal,
  );
  let preflight: string[] = [];
  if (enforced && eg) {
    try {
      await waitRunning(h.env.docker, name, running, 60_000);
      const lines = await eg.probe(name, PROBE_HOSTS);
      const s = await collectEgressState(
        realEgressCollector(join(root, "results", "harness", MARKER_FILE)),
      );
      const evidence = join(out, "probe-evidence.json");
      await Deno.writeTextFile(
        evidence,
        JSON.stringify(
          {
            v: 1,
            at: new Date().toISOString(),
            network_id: s.network?.id ?? "",
            interface_index: s.gatewayAdapter?.index ?? -1,
            hosts: PROBE_HOSTS,
            lines,
          },
          null,
          2,
        ) + "\n",
      );
      console.log(`probe evidence: ${evidence}`);
      preflight = evaluatePreflight(lines, preflightExpect(PROBE_HOSTS));
    } catch (err) {
      preflight = [err instanceof Error ? err.message : String(err)];
    }
    if (preflight.length > 0) stop.abort();
    else {
      await writeSecretFiles(secrets, tokenValue);
      await Deno.writeTextFile(join(secrets, READY_FILE), "");
    }
  }
  const r = await running;
  console.log(
    JSON.stringify({
      execution: id,
      sandbox: r,
      preflight,
      probe: join(out, "probe.jsonl"),
      hostLog,
    }),
  );
} finally {
  await proxy?.shutdown();
  await h.env.backend.revoke(id);
  if (secrets) await removeSecrets(secrets);
  await Deno.remove(work, { recursive: true }).catch(() => {});
  await h.close();
}
