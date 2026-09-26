/**
 * The credentialless qualification probe (M1-33 review item 1; M1-34 Step 6).
 * Runs with the marker in `candidate`: the probe sandbox alone goes on the
 * internal network behind the proxy, in the order of an enforced cell
 * (proxy, listener check, empty mount, C:\egress-check.ps1). Only when the
 * preflight passes are the backend token and ready written. The probe lines
 * and the observed network ids are written as probe evidence for
 * `harness egress verify --mark qualified --probe-evidence <path>`.
 */

import { join } from "@std/path";
import type { EgressRuntime, EgressState } from "./egress.ts";
import type {
  DockerCli,
  SandboxResult,
  SandboxSpec,
  SecretCustody,
} from "./sandbox.ts";
import {
  evaluatePreflight,
  preflightExpect,
  PROXY_ENV,
  SANDBOX_NETWORK,
} from "./egress.ts";
import { waitRunning } from "./execution.ts";
import {
  bounded,
  createSecretsDir,
  READY_FILE,
  removeSecrets,
  runSandbox,
  writeSecretFiles,
} from "./sandbox.ts";

/** Step 6 qualifies with the first-party route's fixed host (the OAuth hosts are recorded later, Step 11). */
export const PROBE_HOSTS = ["api.anthropic.com"];
const PROBE_TIMEOUT_MS = 180_000;

export interface QualificationProbe {
  docker: DockerCli;
  egress: EgressRuntime;
  custody: SecretCustody;
  /** The backend token: released only after the preflight passes. */
  token: string;
  spec: Omit<SandboxSpec, "secretsDir" | "network" | "command">;
  /** The probe's own command, run after the ready wait. */
  probeCommand: string[];
  /** Evidence and the proxy log go here. */
  out: string;
  /** The host state at probe time (network id and interface index for the evidence). */
  collect(): Promise<EgressState>;
}

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;

export async function runQualificationProbe(
  o: QualificationProbe,
): Promise<
  { sandbox: SandboxResult | null; problems: string[]; evidence: string }
> {
  const evidence = join(o.out, "probe-evidence.json");
  const egressLog = join(o.out, "egress.jsonl");
  const opMs = o.spec.opTimeoutMs;
  let secrets: string | null = null;
  const proxy = await o.egress.startProxy({
    allowedHosts: PROBE_HOSTS,
    log: (l) => {
      try {
        Deno.writeTextFileSync(egressLog, JSON.stringify(l) + "\n", {
          append: true,
        });
      } catch {
        /* the probe lines are the evidence; the log is a diagnostic */
      }
    },
  });
  try {
    const lp = await bounded(
      o.egress.listeners(),
      opMs,
      "egress listener check",
    );
    if (lp.length > 0) {
      return {
        sandbox: null,
        problems: lp.map((x) => `listeners: ${x}`),
        evidence,
      };
    }
    secrets = await createSecretsDir(o.custody);
    const waitReady =
      "$sw = [Diagnostics.Stopwatch]::StartNew(); while (-not (Test-Path 'C:\\cg-secrets\\ready')) { if ($sw.Elapsed.TotalSeconds -ge 600) { exit 3 }; Start-Sleep -Milliseconds 500 }; ";
    const stop = new AbortController();
    const running = runSandbox(
      o.docker,
      {
        ...o.spec,
        env: { ...o.spec.env, ...PROXY_ENV },
        network: SANDBOX_NETWORK.name,
        secretsDir: secrets,
        command: [
          "powershell",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `${waitReady}& ${
            o.probeCommand.map(q).join(" ")
          }; exit $LASTEXITCODE`,
        ],
      },
      [o.token],
      stop.signal,
    );
    let problems: string[];
    try {
      await waitRunning(o.docker, o.spec.name, running, opMs);
      const lines = await bounded(
        o.egress.probe(o.spec.name, PROBE_HOSTS),
        PROBE_TIMEOUT_MS,
        "egress preflight",
      );
      const s = await o.collect();
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
      problems = evaluatePreflight(lines, preflightExpect(PROBE_HOSTS));
    } catch (err) {
      problems = [err instanceof Error ? err.message : String(err)];
    }
    if (problems.length > 0) stop.abort();
    else {
      await writeSecretFiles(secrets, [{
        name: "backend-token",
        value: o.token,
      }]);
      await Deno.writeTextFile(join(secrets, READY_FILE), "");
    }
    return { sandbox: await running, problems, evidence };
  } finally {
    await bounded(proxy.shutdown(), opMs, "egress proxy shutdown").catch(
      () => {},
    );
    if (secrets) await removeSecrets(secrets);
  }
}
