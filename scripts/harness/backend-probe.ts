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
import { dirname, join } from "@std/path";
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
import {
  PROBE_HOSTS,
  runQualificationProbe,
} from "../../src/harness/egress-probe.ts";
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
  // The OAuth token belongs to the first-party Anthropic route only (default hosts).
  if (claudeOauth && route !== null && route !== FIRST_PARTY_ROUTE) {
    throw new Error(
      `--claude-oauth needs the first-party Anthropic route (got --route ${route})`,
    );
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

const FIRST_PARTY_ROUTE = "anthropic:first-party-oauth";

/**
 * Filesystem containment of a --mount dir (M9-01a run 002): `dir` must
 * resolve (realPath) to itself and lie strictly under `root`'s real path, and
 * neither the path from `root` down to `dir` nor anything below `dir` may be a
 * reparse point (junction or symlink: realPath differs from the lexical path,
 * or lstat says symlink). Returns `dir`; throws otherwise.
 */
export async function assertMountContained(
  dir: string,
  root = MOUNT_ROOT,
): Promise<string> {
  const lower = (p: string) =>
    winNormalize(p).replace(/\\+$/, "").toLowerCase();
  const realRoot = lower(await Deno.realPath(root));
  const lexical = lower(dir);
  if (!lexical.startsWith(realRoot + "\\")) {
    throw new Error(`--mount ${dir} is not under ${root}`);
  }
  const reparse = async (p: string) => {
    const st = await Deno.lstat(p);
    return st.isSymlink || lower(await Deno.realPath(p)) !== lower(p);
  };
  // Every step from the root down to the mount itself.
  const steps = lexical.slice(realRoot.length + 1).split("\\");
  let cur = realRoot;
  for (const s of steps) {
    cur = `${cur}\\${s}`;
    if (await reparse(cur)) {
      throw new Error(`--mount ${dir}: ${cur} is a reparse point`);
    }
  }
  if (!(await Deno.stat(dir)).isDirectory) {
    throw new Error(`--mount ${dir} is not a directory`);
  }
  // Everything below it, without following links.
  const walk = async (d: string): Promise<void> => {
    for await (const e of Deno.readDir(d)) {
      const p = join(d, e.name);
      if (e.isSymlink || await reparse(p)) {
        throw new Error(`--mount ${dir}: ${p} is a reparse point`);
      }
      if (e.isDirectory) await walk(p);
    }
  };
  await walk(dir);
  return dir;
}

/**
 * Exports an enforced run's proxy log for M9-13 (M9-01a run 002): only the
 * `allow` lines whose host is in `allowedHosts`, reduced to {at, decision,
 * target}, plus a summary line with the number of lines withheld (denied or
 * unexpected targets are attacker-controlled and may carry secrets). Returns
 * problems; [] on success.
 */
export async function exportProxyLog(
  src: string,
  dst: string,
  allowedHosts: string[],
): Promise<string[]> {
  try {
    const kept: string[] = [];
    let withheld = 0;
    for (const raw of (await Deno.readTextFile(src)).split(/\r?\n/)) {
      if (raw.trim() === "") continue;
      let l: { at?: unknown; decision?: unknown; target?: unknown };
      try {
        l = JSON.parse(raw);
      } catch {
        withheld++;
        continue;
      }
      const target = typeof l.target === "string" ? l.target : "";
      const host = target.replace(/:\d+$/, "").toLowerCase();
      if (l.decision === "allow" && allowedHosts.includes(host)) {
        kept.push(
          JSON.stringify({ at: l.at, decision: "allow", target }),
        );
      } else withheld++;
    }
    kept.push(
      JSON.stringify({ summary: true, allowed: kept.length, withheld }),
    );
    await Deno.mkdir(dirname(dst), { recursive: true });
    await Deno.writeTextFile(dst, kept.join("\n") + "\n");
    return [];
  } catch (err) {
    return [
      `proxy log not exported: ${err instanceof Error ? err.message : err}`,
    ];
  }
}

/**
 * M9-01a run 003: runs the probe and exports only after it returned
 * normally (its teardown, capture scrub included, succeeded). A throw
 * propagates with nothing exported.
 */
export async function runThenExport<R>(
  run: () => Promise<R>,
  exportLog: () => Promise<string[]>,
): Promise<{ result: R; exportProblems: string[] }> {
  const result = await run();
  return { result, exportProblems: await exportLog() };
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
  // Filesystem containment (realPath, no reparse point at or under it).
  if (mount !== null) await assertMountContained(mount);
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
      const egress = h.env.egress;
      const exportLog = async (): Promise<string[]> => {
        if (mount === null) return [];
        // M9-13 criterion 6 reuses the allowed-host lines of this run's proxy log.
        const p = await exportProxyLog(
          join(out, "egress.jsonl"),
          join(mount, "out", "egress-proxy.jsonl"),
          hosts ?? PROBE_HOSTS,
        );
        for (const x of p) console.error(`[FAIL] ${x}`);
        return p;
      };
      // Export only after a normal return, i.e. after the teardown scrubbed the
      // captures and the proxy log; on any throw the artifacts stay quarantined
      // in the private probe dir and the run exits non-zero.
      const { result: r, exportProblems } = await runThenExport(
        () =>
          runQualificationProbe({
            docker: h.env.docker,
            egress,
            custody: { privateRoot: h.env.privateRoot, owner: h.env.owner },
            token,
            ...(oauth === null ? {} : {
              releaseAfterPreflight: [{
                name: CLAUDE_OAUTH_FILE,
                value: oauth,
              }],
            }),
            // M5-08a: the token is cut before the sandbox teardown (and again below).
            revoke: () => h.env.backend.revoke(id),
            spec,
            probeCommand,
            out,
            ...(hosts ? { hosts } : {}),
            collect: () =>
              collectEgressState(
                realEgressCollector(
                  join(root, "results", "harness", MARKER_FILE),
                ),
              ),
          }),
        exportLog,
      );
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
      // A missing proxy-log export is a failed run, not a warning.
      Deno.exitCode = probeExitCode({
        problems: [...r.problems, ...exportProblems],
        sandbox: r.sandbox,
      });
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
