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

/** The agreed phases, in order (lane-ops' reset-golden.ps1); all of them make a success. */
export const RESET_PHASES = [
  "snapshot_guard",
  "quiesce",
  "verify_sha",
  "stop",
  "restore",
  "start",
  "healthy",
  "runner_verify",
  "postconditions",
] as const;

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
  const seen: string[] = [];
  let oks = 0;
  // Run 002 Sol r3 #1: no phase may follow the success marker.
  let stepAfterOk = false;
  const failed: { step: string; reason: string }[] = [];
  // Orch Sol r1 #1: every line in the reserved RESET_ namespace must be one
  // well-formed marker; any other such line is a protocol failure.
  const malformed: string[] = [];
  for (const raw of out.stdout.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.startsWith("RESET_")) continue;
    // A phase name is one identifier (Sol r3 #1).
    const step = /^RESET_STEP ([a-z_]+) (\d+)$/.exec(line);
    const f = /^RESET_FAILED ([a-z_]+) (\S.*)$/.exec(line);
    if (step) {
      if (oks > 0) stepAfterOk = true;
      seen.push(step[1]!);
      phases_ms[step[1]!] = Number(step[2]);
    } else if (f) failed.push({ step: f[1]!, reason: f[2]!.trim() });
    // Run 002 Sol r2 #1: a success marker is exactly the bare line.
    else if (line === "RESET_OK") oks++;
    else malformed.push(line);
  }
  const base = {
    container,
    mechanism: m.id,
    policy_version: m.policyVersion,
    phases_ms,
  };
  const protocol = (why: string): ResetRecord => ({
    ...base,
    ok: false,
    failed_step: "protocol",
    error: `${why} (exit ${out.code})`,
  });
  if (malformed.length > 0) {
    return protocol(`malformed marker line: ${malformed[0]!.slice(0, 200)}`);
  }
  if (failed.length > 1) return protocol("more than one RESET_FAILED");
  if (failed.length === 1) {
    return {
      ...base,
      ok: false,
      failed_step: failed[0]!.step,
      error: failed[0]!.reason,
    };
  }
  if (oks !== 1 || out.code !== 0) {
    return protocol("not exactly one bare RESET_OK with exit 0");
  }
  if (stepAfterOk) return protocol("a phase after RESET_OK");
  // Sol r2 #1: success means every agreed phase ran, once each, in order.
  if (
    seen.length !== RESET_PHASES.length ||
    seen.some((p, i) => p !== RESET_PHASES[i])
  ) {
    return protocol(
      `phases ${seen.join(",") || "(none)"}, want ${RESET_PHASES.join(",")}`,
    );
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
    reset: async (container) => {
      let out;
      try {
        out = await o.run(container);
      } catch (err) {
        // A refusal stays a refusal; anything else is a recorded failure
        // (run 002 Sol r2 #3), so the lane quarantines the container.
        if (err instanceof ConfigurationError) throw err;
        return failedReset(container, o, "command", err);
      }
      return parseResetOutput(container, o, out);
    },
  };
}

/** A reset that threw, as a failed record (never an unrecorded error). */
export function failedReset(
  container: string,
  m: { id: string; policyVersion: number },
  step: string,
  err: unknown,
): ResetRecord {
  return {
    container,
    mechanism: m.id,
    policy_version: m.policyVersion,
    ok: false,
    failed_step: step,
    error: err instanceof Error ? err.message : String(err),
    phases_ms: {},
  };
}
