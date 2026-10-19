/**
 * H-35 S3 (design-r3 2, r4 2, r5 3; owner rulings 2026-10-19 "Tenancy
 * REVISED" and "Base state"): the reset before every judge deployment,
 * behind one interface so the mechanism stays pluggable. The production
 * mechanism restores the golden set (lane-ops' reset script); a failed reset
 * is infra and the lane quarantines the container.
 *
 * Script protocol (agreed with lane-ops): one `RESET_STEP <name> <ms>` line
 * per phase (snapshot_guard first, ..., runner_verify, postconditions), then
 * exactly one of `RESET_OK` or `RESET_FAILED <step> <reason>`; exit 0 only
 * with RESET_OK. Anything else is a `protocol` failure.
 */

import { ConfigurationError, ContainerError } from "../errors.ts";

export interface ResetRecord {
  container: string;
  mechanism: string;
  policy_version: number;
  ok: boolean;
  /** The failed step (e.g. snapshot_guard, restore, runner_verify), else null. */
  failed_step: string | null;
  error: string | null;
  phases_ms: Record<string, number>;
}

export interface ResetMechanism {
  readonly id: string;
  readonly policyVersion: number;
  reset(container: string): Promise<ResetRecord>;
}

/** A reset that did not complete: infra; the lane quarantines the container. */
export class ResetFailedError extends ContainerError {
  constructor(readonly record: ResetRecord) {
    super(
      `reset of ${record.container} failed at ${record.failed_step}: ${record.error}`,
      record.container,
      "setup",
    );
    this.name = "ResetFailedError";
  }
}

export function parseResetOutput(
  container: string,
  m: { id: string; policyVersion: number },
  out: { code: number; stdout: string },
): ResetRecord {
  const phases_ms: Record<string, number> = {};
  let ok = false;
  let failed: { step: string; reason: string } | null = null;
  for (const line of out.stdout.split(/\r?\n/)) {
    const step = /^RESET_STEP (\S+) (\d+)\s*$/.exec(line);
    if (step) phases_ms[step[1]!] = Number(step[2]);
    const f = /^RESET_FAILED (\S+) ?(.*)$/.exec(line);
    if (f && !failed) failed = { step: f[1]!, reason: f[2]!.trim() };
    if (/^RESET_OK\b/.test(line)) ok = true;
  }
  const base = {
    container,
    mechanism: m.id,
    policy_version: m.policyVersion,
    phases_ms,
  };
  if (failed) {
    return {
      ...base,
      ok: false,
      failed_step: failed.step,
      error: failed.reason,
    };
  }
  if (!ok || out.code !== 0) {
    return {
      ...base,
      ok: false,
      failed_step: "protocol",
      error: `no RESET_OK with exit 0 (exit ${out.code})`,
    };
  }
  return { ...base, ok: true, failed_step: null, error: null };
}

/**
 * The judging environment's mechanism until a reset lineage is configured:
 * judging refuses (a configuration error, never infra, so nothing is
 * quarantined or rerouted). No judge deployment without a reset.
 */
export const UNCONFIGURED_RESET: ResetMechanism = {
  id: "unconfigured",
  policyVersion: 0,
  reset: () =>
    Promise.reject(
      new ConfigurationError(
        "judging needs a reset lineage (H-35 S3): no judge deployment without a reset",
      ),
    ),
};

/** A mechanism that runs a reset command per container and parses its output. */
export function commandReset(o: {
  id: string;
  policyVersion: number;
  run: (container: string) => Promise<{ code: number; stdout: string }>;
}): ResetMechanism {
  return {
    id: o.id,
    policyVersion: o.policyVersion,
    reset: async (container) =>
      parseResetOutput(container, o, await o.run(container)),
  };
}
