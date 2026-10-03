// Ops driver for M1-28 Step 4 (no provider credential: not a supervised run, no reservation).
// Usage (container leased, no bench live):
//   DOCKER_CONTEXT=desktop-windows deno run --allow-all scripts/harness/backend-probe.ts <container> <secretsDir>
//     [--enforced] [--command-file <json string array>] [--withhold-token]
//     [--image <ref>] [--route <provider route>]
// Prints statuses only (never the token); the token is revoked when the script ends.
// Exits non-zero on any preflight problem or when the sandbox did not exit 0.
// --command-file (M3-07) replaces the cg-al-probe command; it is a file because a JSON-RPC
// pipeline does not survive shell quoting as one argument. --withhold-token (M3-07 negative
// case) removes the backend token from the mounted secrets; not with --enforced.
// --enforced (M1-33, M1-34 Step 6): runs with the marker in candidate (or later);
// the probe sandbox alone goes on the internal network behind the proxy with the
// backend on the sandbox gateway, in the order of an enforced cell (proxy,
// listener check, empty mount, C:\egress-check.ps1, then only on a pass the
// backend token and ready): runQualificationProbe.
// --image (M3-08) probes in that image instead of claude-code 2.1.282; --route
// (M3-08, needs --enforced) proxies and probes that route's hosts (ROUTE_HOSTS)
// instead of the first-party default. It writes probe-evidence.json
// for `harness egress verify --mark qualified --probe-evidence <path>`.
// --mount <dir> (M9-01a) mounts an absolute host dir under H:\cg-coord\m9\
// read-write at C:\probe; with --enforced, the run's proxy log is copied to
// <dir>\out\egress-proxy.jsonl at the end. --claude-oauth (M9-01a, needs
// --enforced) releases <secretsDir>\claude-oauth-token as
// C:\cg-secrets\claude-oauth-token beside the backend token, only after the
// egress preflight passed. The sandbox always runs as ContainerUser (H-01,
// buildRunArgs) after the harness privilege check, so no --user flag exists.
import { join } from "@std/path";
import {
  isAbsolute as winIsAbsolute,
  normalize as winNormalize,
} from "@std/path/windows";
import type { SandboxResult } from "../../src/harness/sandbox.ts";
import { openHarnessEnv } from "../../cli/commands/harness-env.ts";
import {
  collectEgressState,
  hostsForRoutes,
  MARKER_FILE,
  realEgressCollector,
} from "../../src/harness/egress.ts";
import { runQualificationProbe } from "../../src/harness/egress-probe.ts";
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

const USAGE =
  "usage: backend-probe.ts <container> <secretsDir> [--enforced] [--command-file <path>] [--withhold-token] [--image <ref>] [--route <route>] [--mount <H:\\cg-coord\\m9\\...>] [--claude-oauth]";

/** The only host tree --mount may expose read-write to a probe sandbox (M9-01a). */
const MOUNT_ROOT = "h:\\cg-coord\\m9\\";
export const CLAUDE_OAUTH_FILE = "claude-oauth-token";

/** An absolute dir strictly under H:\cg-coord\m9\ (normalized, case kept), else throws. */
function probeMount(raw: string): string {
  const p = winNormalize(raw).replace(/\\+$/, "");
  if (
    !winIsAbsolute(raw) || !/^[a-z]:\\/i.test(p) ||
    !(p.toLowerCase() + "\\").startsWith(MOUNT_ROOT) ||
    p.length <= MOUNT_ROOT.length - 1
  ) {
    throw new Error(
      `--mount must be an absolute dir under H:\\cg-coord\\m9\\ (got ${raw})`,
    );
  }
  return p;
}

export async function parseProbeArgs(args: string[]): Promise<{
  container: string;
  secretsDir: string;
  enforced: boolean;
  command: string[] | null;
  withholdToken: boolean;
  image: string | null;
  hosts: string[] | null;
  mount: string | null;
  claudeOauth: boolean;
}> {
  const pos: string[] = [];
  let enforced = false;
  let withholdToken = false;
  let claudeOauth = false;
  let commandFile: string | null = null;
  let image: string | null = null;
  let route: string | null = null;
  let mount: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--enforced") enforced = true;
    else if (a === "--withhold-token") withholdToken = true;
    else if (a === "--claude-oauth") claudeOauth = true;
    else if (a === "--command-file") {
      commandFile = args[++i] ?? null;
      if (commandFile === null) throw new Error(USAGE);
    } else if (a === "--image" || a === "--route" || a === "--mount") {
      const v = args[++i];
      if (!v) throw new Error(USAGE);
      if (a === "--image") image = v;
      else if (a === "--route") route = v;
      else mount = probeMount(v);
    } else if (a.startsWith("--")) throw new Error(`${USAGE} (unknown ${a})`);
    else pos.push(a);
  }
  const [container, secretsDir] = pos;
  if (pos.length !== 2 || !container || !secretsDir) throw new Error(USAGE);
  let command: string[] | null = null;
  if (commandFile !== null) {
    const v: unknown = JSON.parse(await Deno.readTextFile(commandFile));
    if (
      !Array.isArray(v) || v.length === 0 ||
      !v.every((x) => typeof x === "string")
    ) {
      throw new Error(`${commandFile}: expected a non-empty JSON string array`);
    }
    command = v;
  }
  if (route !== null && !enforced) {
    throw new Error("--route needs --enforced");
  }
  if (claudeOauth && !enforced) {
    throw new Error("--claude-oauth needs --enforced");
  }
  const hosts = route === null ? null : hostsForRoutes([route], {});
  return {
    container,
    secretsDir,
    enforced,
    command,
    withholdToken,
    image,
    hosts,
    mount,
    claudeOauth,
  };
}

/** The OAuth token from the secrets dir, checked in memory; never printed. */
async function readClaudeOauth(secretsDir: string): Promise<string> {
  const v = (await Deno.readTextFile(join(secretsDir, CLAUDE_OAUTH_FILE)))
    .trim();
  if (v === "" || v.startsWith("REPLACE_ME")) {
    throw new Error(
      `${CLAUDE_OAUTH_FILE} in the secrets dir is empty or a placeholder`,
    );
  }
  return v;
}

/**
 * Non-zero on any preflight problem or a sandbox that did not run to exit 0,
 * timed out, is not confirmed gone, or left a cleanup problem (M3-07c).
 */
export function probeExitCode(
  r: {
    problems: readonly string[];
    sandbox:
      | Pick<
        SandboxResult,
        "exitCode" | "timedOut" | "confirmedGone" | "cleanup"
      >
      | null;
  },
): number {
  const s = r.sandbox;
  return r.problems.length === 0 && s !== null && s.exitCode === 0 &&
      !s.timedOut && s.confirmedGone && s.cleanup === "ok"
    ? 0
    : 1;
}

if (import.meta.main) await main();

async function main() {
  const {
    container,
    secretsDir,
    enforced,
    command,
    withholdToken,
    image,
    hosts,
    mount,
    claudeOauth,
  } = await parseProbeArgs(Deno.args);
  if (enforced && withholdToken) {
    throw new Error("--withhold-token is not for --enforced runs");
  }
  if (mount !== null && !(await Deno.stat(mount)).isDirectory) {
    throw new Error(`--mount ${mount} is not a directory`);
  }
  // Read before any environment opens: a missing token stops the run early.
  const oauth = claudeOauth ? await readClaudeOauth(secretsDir) : null;
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
    ...(enforced ? { probe: true } : {}),
  });
  if (enforced !== (h.env.egress !== undefined)) {
    await h.close();
    throw new Error(
      enforced
        ? "--enforced: the egress marker does not place the probe (needs a verified candidate, qualified or authorized marker)"
        : "the egress marker places sandboxes (backend on the sandbox gateway): pass --enforced",
    );
  }
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
    const img = await imageFacts(
      h.env.docker,
      image ?? imageTag("claude-code", "2.1.282"),
      h.env.owner,
    );
    const spec = {
      name,
      owner: h.env.owner,
      executionId: id,
      imageId: img.digest,
      workspace: staged.workspace,
      taskDir: staged.taskDir,
      configDir,
      extraMounts: mount === null
        ? []
        : [{ src: mount, dst: "C:\\probe", readWrite: true }],
      env: { CG_BACKEND_URL: h.env.backendUrl, CG_EXECUTION_ID: id },
      timeoutMs: 20 * 60_000,
      killGraceMs: 60_000,
      opTimeoutMs: 60_000,
      maxCaptureBytes: 16 * 1024 * 1024,
      rawLog: join(out, "probe.jsonl"),
      stderrLog: join(out, "stderr.txt"),
    };
    const probeCommand = command ?? [
      "powershell",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\config\\cg-al-probe.ps1",
    ];
    if (enforced && h.env.egress) {
      const r = await runQualificationProbe({
        docker: h.env.docker,
        egress: h.env.egress,
        custody: { privateRoot: h.env.privateRoot, owner: h.env.owner },
        token,
        ...(oauth === null ? {} : {
          releaseAfterPreflight: [{ name: CLAUDE_OAUTH_FILE, value: oauth }],
        }),
        // M5-08a: the token is cut before the sandbox teardown (and again below).
        revoke: () => h.env.backend.revoke(id),
        spec,
        probeCommand,
        out,
        ...(hosts ? { hosts } : {}),
        collect: () =>
          collectEgressState(
            realEgressCollector(join(root, "results", "harness", MARKER_FILE)),
          ),
      });
      console.log(
        JSON.stringify({
          execution: id,
          sandbox: r.sandbox,
          preflight: r.problems,
          evidence: r.evidence,
          probe: join(out, "probe.jsonl"),
          hostLog,
        }),
      );
      Deno.exitCode = probeExitCode(r);
      if (mount !== null) {
        // M9-13 criterion 6 reuses the proxy log of this run.
        await Deno.mkdir(join(mount, "out"), { recursive: true });
        await Deno.copyFile(
          join(out, "egress.jsonl"),
          join(mount, "out", "egress-proxy.jsonl"),
        ).catch((e) =>
          console.error(`proxy log not copied: ${(e as Error).message}`)
        );
      }
    } else {
      const s = await prepareSecrets(secretsDir, [], token, {
        privateRoot: h.env.privateRoot,
        owner: h.env.owner,
      });
      secrets = s.dir;
      if (withholdToken) await Deno.remove(join(s.dir, "backend-token"));
      const r = await runSandbox(h.env.docker, {
        ...spec,
        secretsDir: s.dir,
        command: probeCommand,
      }, [token]);
      console.log(
        JSON.stringify({
          execution: id,
          sandbox: r,
          probe: join(out, "probe.jsonl"),
          hostLog,
        }),
      );
      Deno.exitCode = probeExitCode({ problems: [], sandbox: r });
    }
  } finally {
    await h.env.backend.revoke(id);
    if (secrets) await removeSecrets(secrets);
    await Deno.remove(work, { recursive: true }).catch(() => {});
    await h.close();
  }
}
