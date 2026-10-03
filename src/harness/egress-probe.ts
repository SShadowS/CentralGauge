/**
 * The credentialless qualification probe (M1-33 review item 1; M1-34 Step 6).
 * Runs with the marker in `candidate`: the probe sandbox alone goes on the
 * internal network behind the proxy, in the order of an enforced cell
 * (proxy, listener check, empty mount, the H-01 privilege check,
 * C:\egress-check.ps1). Only when the preflight passes are the backend token
 * and ready written. The probe lines
 * and the observed network ids are written as probe evidence for
 * `harness egress verify --mark qualified --probe-evidence <path>`.
 */

import { join } from "@std/path";
import { ContainerError } from "../errors.ts";
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
  checkSandboxPrivilege,
  createSecretsDir,
  READY_FILE,
  runSandbox,
  teardownSandbox,
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
  /**
   * Further secret files released with the backend token, only after the
   * preflight passes (M9-01a: the Claude Code OAuth token of an ops spike).
   * Their values are redacted from the captures like the token.
   */
  releaseAfterPreflight?: { name: string; value: string }[];
  spec: Omit<SandboxSpec, "secretsDir" | "network" | "command">;
  /** The probe's own command, run after the ready wait. */
  probeCommand: string[];
  /** Evidence and the proxy log go here. */
  out: string;
  /** Route hosts the proxy allows and the preflight probes (M3-08 `--route`); default PROBE_HOSTS. */
  hosts?: string[];
  /** The host state at probe time (network id and interface index for the evidence). */
  collect(): Promise<EgressState>;
  /**
   * Revokes `token` at the backend; required, called first in the teardown
   * (M5-08a/b). A failure is reported and fails the probe closed; it never
   * skips the proxy shutdown or the sandbox teardown.
   */
  revoke: () => Promise<unknown>;
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
  const hosts = o.hosts ?? PROBE_HOSTS;
  let secrets: string | null = null;
  const stop = new AbortController();
  /** M5-08a: the started run until it is awaited; the teardown stops it first. */
  let pending: Promise<SandboxResult> | null = null;
  let settled: SandboxResult | null = null;
  const proxy = await o.egress.startProxy({
    allowedHosts: hosts,
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
    const running = pending = runSandbox(
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
      [o.token, ...(o.releaseAfterPreflight ?? []).map((s) => s.value)],
      stop.signal,
    );
    let problems: string[];
    try {
      await waitRunning(o.docker, o.spec.name, running, opMs);
      // H-01: before the preflight and the token, while only image code runs.
      await checkSandboxPrivilege(o.docker, o.spec.name, opMs).catch((err) => {
        throw new Error(
          `sandbox privilege check failed: ${
            err instanceof Error ? err.message : err
          }`,
        );
      });
      const lines = await bounded(
        o.egress.probe(o.spec.name, hosts),
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
            hosts,
            lines,
          },
          null,
          2,
        ) + "\n",
      );
      problems = evaluatePreflight(lines, preflightExpect(hosts));
    } catch (err) {
      problems = [err instanceof Error ? err.message : String(err)];
    }
    if (problems.length > 0) stop.abort();
    else {
      await writeSecretFiles(secrets, [
        { name: "backend-token", value: o.token },
        ...(o.releaseAfterPreflight ?? []),
      ]);
      await Deno.writeTextFile(join(secrets, READY_FILE), "");
    }
    settled = await running;
    return { sandbox: settled, problems, evidence };
  } finally {
    // M5-08a: credentials cut first (run aborted, backend token revoked,
    // proxy shut down), then the sandbox confirmed gone, then its secrets.
    if (pending && !settled) stop.abort();
    let revokeError: string | null = null;
    const failed = (err: unknown) => {
      revokeError = err instanceof Error ? err.message : String(err);
    };
    let revoked: Promise<void>;
    try {
      revoked = Promise.resolve(o.revoke()).then(() => {}, failed);
    } catch (err) {
      failed(err); // a synchronous throw: the teardown still runs
      revoked = Promise.resolve();
    }
    await bounded(proxy.shutdown(), opMs, "egress proxy shutdown").catch(
      () => {},
    );
    const down = await teardownSandbox({
      docker: o.docker,
      name: o.spec.name,
      executionId: o.spec.executionId,
      opTimeoutMs: opMs,
      run: pending,
      abort: () => stop.abort(),
      settled,
      secretsDir: secrets,
    });
    await revoked;
    const problems = [
      ...(revokeError !== null
        ? [`backend token revoke failed: ${revokeError}`]
        : []),
      ...(!down.gone || down.secretsLeft ? down.problems : []),
    ];
    if (revokeError !== null) {
      console.error(
        `[FAIL] qualification probe ${o.spec.name}: backend token revoke failed: ${revokeError}`,
      );
    }
    if (problems.length > 0) {
      // Fail closed and loud; the next start sweeps the container, then the secrets.
      throw new ContainerError(
        `qualification probe ${o.spec.name}: teardown not confirmed (${
          problems.join("; ")
        }); resolve before the next run`,
        o.spec.name,
        "stop",
      );
    }
  }
}
